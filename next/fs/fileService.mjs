import { mkdir, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fail, ok } from '../kernel/errors.mjs'
import { canPerform } from '../kernel/scopeGrant.mjs'
import { recoverInterruptedWrites, TMP_PREFIX, writeFileAtomic } from './atomicWrite.mjs'
import { assertNoSymlinkEscape, joinContained } from './projectPath.mjs'
import { snapshotBeforeDestructive } from '../history/gitHistory.mjs'

/**
 * 唯一写盘出口（WP2）。所有插件的文件操作都必须过这三道闸：
 *   1) 归属：目标目录必须在该插件 dataDirs 里（C3，跨板块请走对方 tools）；
 *   2) 作用域：manifest.scopes 未声明 file:<目录>:rw 即拒（第 7 节）；
 *   3) 并发：expectedRevision 不符返回 STALE_REVISION，不覆盖、不合并、不吭声。
 * 工单B（作者裁定「目录递归归认领者」）：file:正文:rw 覆盖 正文/ 及其子目录——
 * list/read/write 的 dir 既可以是精确 dataDir 名，也可以是「dataDir 名＋子路径」
 * （如 正文/第一卷；子路径里的文件归属仍按 正文 判，grant 也按 正文 查）。
 * 前缀判定只认带 `/` 的完整一段（正文2 不算 正文 的子路径）；子路径仍过 C2 的
 * 路径合法性（..／绝对路径／.pinax 一律拒）与软链逃逸检查——这是前缀语义的自然延伸，
 * 不是放松：允许的还是同一块目录，只是不再要求调用方把路径拆成两半。
 * 元数据只进 .pinax/（状态 revisions、提案 proposals），正文永远是人打开资源管理器看得懂的那份。
 */
const REVISIONS_FILE = join('state', 'revisions.json')
/** 提案是内核元数据（不是任何载体的板块目录）：目录固定，作用域闸与归属闸都不适用。 */
const PROPOSALS_DIR = join('.pinax', 'proposals')
/** 提案状态只认这三档：运行时写出来的是 proposed，采纳与弃用各占一档。 */
const PROPOSAL_STATUSES = Object.freeze(['proposed', 'adopted', 'discarded'])

export function createFileService({ root, registry, fsImpl, onWrite, snapshot = snapshotBeforeDestructive } = {}) {
  const projectRoot = resolve(String(root || '.'))
  const io = {
    readFile: fsImpl?.readFile || readFile,
    mkdir: fsImpl?.mkdir || mkdir,
    stat: fsImpl?.stat || stat,
    readdir: fsImpl?.readdir || readdir,
    unlink: fsImpl?.unlink || unlink,
    rename: fsImpl?.rename || rename,
    atomicWrite: fsImpl?.writeFileAtomic || writeFileAtomic,
    recover: fsImpl?.recover || recoverInterruptedWrites,
    realpath: fsImpl?.realpath,
    lstat: fsImpl?.lstat
  }
  let revisions = new Map()
  let queue = Promise.resolve()
  let writeHook = typeof onWrite === 'function' ? onWrite : null

  const service = {
    root: projectRoot,

    async init() {
      await io.mkdir(join(projectRoot, '.pinax', 'state'), { recursive: true })
      await io.mkdir(join(projectRoot, '.pinax', 'proposals'), { recursive: true })
      await loadRevisions()
      const cleanup = await service.enqueue(() => sweepInterruptedWrites())
      return ok({ revisionCount: revisions.size, cleanedTmp: cleanup.cleaned })
    },

    /** 写链串行化：同一项目内的落盘按序执行，避免 revision 记账竞态。 */
    enqueue(task) {
      const next = queue.then(task, task)
      queue = next.then(() => undefined, () => undefined)
      return next
    },

    /**
     * 重挂写入钩子（D1）：fileService 会随 openProject/carriers 刷新重建，
     * 主进程每次拿到新实例后经这里把「写成功→标脏」接回去。传 null 即摘掉。
     */
    setOnWrite(hook) {
      writeHook = typeof hook === 'function' ? hook : null
      return ok({ attached: Boolean(writeHook) })
    },

    /** 板块注册即建目录：只补缺，绝不删除。 */
    async ensurePluginDirs(pluginId) {
      const manifest = registry.get(pluginId)
      if (!manifest) return fail('INVALID_INPUT', `未安装的插件：${pluginId}`)
      const created = []
      for (const dir of Object.values(manifest.dataDirs)) {
        const located = await locate({ pluginId, dir, file: '.' , manifest })
        if (!located.ok) return located
        const already = await io.stat(located.value.targetDir).then(() => true, () => false)
        if (already) continue
        try {
          await io.mkdir(located.value.targetDir, { recursive: true })
          created.push(dir)
        } catch (error) {
          if (error?.code !== 'EEXIST') return fail('IO_FAILED', `建目录失败：${dir}`, { cause: String(error?.message || error) })
        }
      }
      return ok({ pluginId, created })
    },

    async read({ pluginId, dir, file }) {
      const located = await locate({ pluginId, dir, file })
      if (!located.ok) return located
      const grant = canPerform(registry.grantFor(pluginId), { type: 'file', dir: located.value.ownerDir, mode: 'read' })
      if (!grant.ok) return grant
      let text
      try {
        text = await io.readFile(located.value.targetFile, 'utf-8')
      } catch (error) {
        if (error?.code === 'ENOENT') return fail('INVALID_INPUT', `文件不存在：${located.value.relativePath}`, { path: located.value.relativePath })
        return fail('IO_FAILED', `读取失败：${located.value.relativePath}`, { cause: String(error?.message || error) })
      }
      return ok({
        relativePath: located.value.relativePath,
        text,
        revision: await adoptRevision(located.value.relativePath),
        sha256: sha256(text),
        bytes: Buffer.byteLength(text, 'utf-8')
      })
    },

    /** 修订并发：expectedRevision 必填；新建文件传 0。 */
    async write({ pluginId, dir, file, text, expectedRevision }) {
      if (typeof text !== 'string') return fail('INVALID_INPUT', '写入内容必须是字符串')
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return fail('INVALID_INPUT', '写入必须带 expectedRevision（新建传 0）')
      }
      const located = await locate({ pluginId, dir, file })
      if (!located.ok) return located
      const grant = canPerform(registry.grantFor(pluginId), { type: 'file', dir: located.value.ownerDir, mode: 'write' })
      if (!grant.ok) return grant

      return service.enqueue(async () => {
        const tracked = revisions.has(located.value.relativePath)
        const actual = await adoptRevision(located.value.relativePath)
        if (actual !== expectedRevision) {
          const hint = !tracked && actual === 1
            ? '「未记账的既有文件」按第 1 版处理：新建请换文件名，改稿先读一次拿到修订号（作者原稿不允许盲写）'
            : null
          return fail('STALE_REVISION', `「${located.value.relativePath}」已被改动（第 ${actual} 版），本次基于第 ${expectedRevision} 版的写入被拒绝${hint ? `：${hint}` : ''}`, {
            path: located.value.relativePath, expected: expectedRevision, actual, preexisting: !tracked && actual === 1
          })
        }
        await io.mkdir(dirname(located.value.targetFile), { recursive: true })
        await io.atomicWrite(located.value.targetFile, text)
        const revision = actual + 1
        revisions.set(located.value.relativePath, revision)
        const persisted = await saveRevisions()
        if (!persisted.ok) return persisted
        await notifyWrite({ relativePath: located.value.relativePath, revision })
        return ok({ relativePath: located.value.relativePath, revision, sha256: sha256(text), bytes: Buffer.byteLength(text, 'utf-8') })
      })
    },

    /**
     * 受控删除（批次46A）：归属闸／作用域闸照旧，多一道「删前强制快照」。
     * 不做回收站：历史快照就是安全网，快照失败即中止，磁盘一个字节不动。
     * 有未审提案（status:'proposed'）指向这一章时拒删，提示里点名提案文件名。
     */
    async deleteFile({ pluginId, dir, file } = {}) {
      const located = await locate({ pluginId, dir, file })
      if (!located.ok) return located
      const grant = canPerform(registry.grantFor(pluginId), { type: 'file', dir: located.value.ownerDir, mode: 'write' })
      if (!grant.ok) return grant
      const relativePath = located.value.relativePath

      return service.enqueue(async () => {
        const exists = await io.stat(located.value.targetFile).then((info) => info.isFile(), () => false)
        if (!exists) return fail('INVALID_INPUT', `文件不存在：${relativePath}`, { path: relativePath })
        const blocked = await pendingProposalsFor(relativePath)
        if (!blocked.ok) return blocked
        if (blocked.value.length) return proposalBlocked(relativePath, blocked.value, '删除')
        const taken = await takeSnapshot(relativePath, '删除')
        if (!taken.ok) return taken
        try {
          await io.unlink(located.value.targetFile)
        } catch (error) {
          if (error?.code === 'ENOENT') return fail('INVALID_INPUT', `文件不存在：${relativePath}`, { path: relativePath })
          return fail('IO_FAILED', `删除失败：${relativePath}`, { cause: String(error?.message || error) })
        }
        revisions.delete(relativePath)
        const persisted = await saveRevisions()
        if (!persisted.ok) return persisted
        await notifyWrite({ relativePath, revision: 0, deleted: true })
        return ok({ relativePath, deleted: true })
      })
    },

    /**
     * 受控改名（批次46A）：只改同一目录下的文件名（含 001- 前缀的调整），
     * 跨目录移动／拖拽排序本批不做——新名字带路径分隔符一律拒，不猜作者想搬到哪。
     * 与删除同一套安全网：有未审提案指向旧路径即拒；快照失败即中止；
     * 修订号账本按「盘为准」迁到新路径（新文件从旧路径那一版接着记）。
     */
    async renameFile({ pluginId, dir, file, nextFile } = {}) {
      const located = await locate({ pluginId, dir, file })
      if (!located.ok) return located
      const grant = canPerform(registry.grantFor(pluginId), { type: 'file', dir: located.value.ownerDir, mode: 'write' })
      if (!grant.ok) return grant
      const relativePath = located.value.relativePath
      const name = String(nextFile ?? '').trim()
      const checked = checkRenameName(name)
      if (!checked.ok) return checked
      const parent = dirname(relativePath).replaceAll('\\', '/')
      if (!parent || parent === '.' || parent === '..') {
        return fail('INVALID_INPUT', `不能改项目根上的文件：${relativePath}`, { path: relativePath })
      }
      const nextLocated = await locate({ pluginId, dir: parent, file: name })
      if (!nextLocated.ok) return nextLocated
      const nextPath = nextLocated.value.relativePath
      if (nextPath === relativePath) return fail('INVALID_INPUT', `新旧文件名相同：${relativePath}`, { path: relativePath })

      return service.enqueue(async () => {
        const exists = await io.stat(located.value.targetFile).then((info) => info.isFile(), () => false)
        if (!exists) return fail('INVALID_INPUT', `文件不存在：${relativePath}`, { path: relativePath })
        const occupied = await io.stat(nextLocated.value.targetFile).then(() => true, () => false)
        if (occupied) {
          return fail('INVALID_INPUT', `目标文件名已存在：${nextPath}`, { path: relativePath, nextPath })
        }
        const blocked = await pendingProposalsFor(relativePath)
        if (!blocked.ok) return blocked
        if (blocked.value.length) return proposalBlocked(relativePath, blocked.value, '改名')
        const revision = await adoptRevision(relativePath)
        const taken = await takeSnapshot(relativePath, '改名')
        if (!taken.ok) return taken
        try {
          await io.rename(located.value.targetFile, nextLocated.value.targetFile)
        } catch (error) {
          if (error?.code === 'ENOENT') return fail('INVALID_INPUT', `文件不存在：${relativePath}`, { path: relativePath })
          return fail('IO_FAILED', `改名失败：${relativePath} → ${nextPath}`, { cause: String(error?.message || error) })
        }
        revisions.delete(relativePath)
        if (revision > 0) revisions.set(nextPath, revision)
        const persisted = await saveRevisions()
        if (!persisted.ok) return persisted
        await notifyWrite({ relativePath, revision: 0, deleted: true })
        await notifyWrite({ relativePath: nextPath, revision })
        return ok({ relativePath: nextPath, previousPath: relativePath, revision, renamed: true })
      })
    },

    /** 列板块内容：只在该插件自己认领的目录里走。 */
    async list({ pluginId, dir }) {
      const located = await locate({ pluginId, dir, file: '.' })
      if (!located.ok) return located
      const grant = canPerform(registry.grantFor(pluginId), { type: 'file', dir: located.value.ownerDir, mode: 'read' })
      if (!grant.ok) return grant
      try {
        await io.stat(located.value.targetDir)
      } catch {
        return ok({ dir, entries: [], missing: true })
      }
      const { readdir } = await import('node:fs/promises')
      const names = await readdir(located.value.targetDir, { withFileTypes: true })
      return ok({
        dir,
        entries: names.filter((entry) => !entry.name.startsWith('.pinax-tmp-')).map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? 'dir' : 'file',
          logical: entry.isDirectory() ? Object.keys(manifestDirs(registry.get(pluginId))).find((key) => manifestDirs(registry.get(pluginId))[key] === entry.name) ?? null : null
        }))
      })
    },

    /** 运行时的提案出口：只写 .pinax/proposals/，绝不动正文（规范第 5 节硬约束）。 */
    async writeProposal({ name, text }) {
      if (typeof text !== 'string') return fail('INVALID_INPUT', '提案内容必须是字符串')
      const safeName = String(name || '').replaceAll('\\', '/').replace(/[^A-Za-z0-9._\u4e00-\u9fa5-]/g, '_').slice(0, 120)
      if (!safeName || safeName === '.' || safeName === '..') return fail('INVALID_INPUT', '提案名不合法')
      const target = join(projectRoot, '.pinax', 'proposals', safeName)
      await io.mkdir(dirname(target), { recursive: true })
      await io.atomicWrite(target, text)
      // 批次16 E3 余账：提案也要进历史——标脏让下一次定时快照收编（批次14 记账：原来不标脏，
      // 只写提案不写别的时，快照永远不会落这笔）。
      await notifyWrite({ relativePath: '.pinax/proposals/' + safeName, revision: 0 })
      return ok({ path: target, bytes: Buffer.byteLength(text, 'utf-8') })
    },

    /**
     * 提案审阅（工单A）：.pinax/proposals/ 是内核元数据，不走载体 scope 闸。
     * 列的是「目录里此刻真有什么」：JSON 提案解析成可读的摘要，坏 JSON 跳过并记账，
     * 运行时轨写下的纯文本提案以 kind:'raw' 只给名字与大小（不冒充可审阅的提案）。
     */
    async listProposals() {
      const dir = join(projectRoot, PROPOSALS_DIR)
      let entries
      try {
        entries = await io.readdir(dir, { withFileTypes: true })
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return ok({ dir: '.pinax/proposals', proposals: [], raw: [], warnings: [], total: 0, rawTotal: 0 })
        }
        return fail('IO_FAILED', '读取提案目录失败：.pinax/proposals', { cause: String(error?.message || error) })
      }
      const proposals = []
      const raw = []
      const warnings = []
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (entry.name.startsWith(TMP_PREFIX)) continue
        const full = join(dir, entry.name)
        let info
        try {
          info = await io.stat(full)
        } catch (error) {
          warnings.push(`「${entry.name}」读不到大小，已跳过：${String(error?.message || error)}`)
          continue
        }
        if (!/\.json$/iu.test(entry.name)) {
          raw.push({ name: entry.name, kind: 'raw', bytes: info.size })
          continue
        }
        let parsed
        try {
          parsed = JSON.parse(await io.readFile(full, 'utf-8'))
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('顶层不是对象')
        } catch (error) {
          warnings.push(`「${entry.name}」不是合法的提案 JSON，已跳过：${String(error?.message || error)}`)
          continue
        }
        const content = typeof parsed.content === 'string' ? parsed.content : ''
        proposals.push({
          name: entry.name,
          kind: 'proposal',
          schema: typeof parsed.schema === 'string' ? parsed.schema : null,
          id: typeof parsed.id === 'string' && parsed.id ? parsed.id : entry.name.replace(/\.json$/iu, ''),
          status: typeof parsed.status === 'string' ? parsed.status : null,
          target: {
            index: Number.isSafeInteger(parsed.target?.index) ? parsed.target.index : null,
            title: typeof parsed.target?.title === 'string' ? parsed.target.title : null,
            file: typeof parsed.target?.file === 'string' ? parsed.target.file : null,
            chars: Number.isSafeInteger(parsed.target?.chars) ? parsed.target.chars : null
          },
          contentChars: Number.isSafeInteger(parsed.contentChars) ? parsed.contentChars : content.length,
          createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
          note: typeof parsed.note === 'string' && parsed.note ? parsed.note : null,
          bytes: info.size
        })
      }
      // 降序：新建的提案排在最上面；createdAt 缺省或相同的按文件名倒序，保证每次列出来是同一顺序。
      proposals.sort((left, right) => {
        const a = left.createdAt ?? ''
        const b = right.createdAt ?? ''
        if (a !== b) return a < b ? 1 : -1
        return left.name < right.name ? 1 : left.name > right.name ? -1 : 0
      })
      raw.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      return ok({
        dir: '.pinax/proposals',
        proposals,
        raw,
        warnings,
        total: proposals.length,
        rawTotal: raw.length
      })
    },

    /** 读一份 JSON 提案（整份原样返回，内容不做任何裁剪）。 */
    async readProposal({ name } = {}) {
      const checked = proposalFilePath(projectRoot, name)
      if (!checked.ok) return checked
      const { target, fileName } = checked.value
      const escape = await assertNoSymlinkEscape(projectRoot, target, { realpath: io.realpath, lstat: io.lstat })
      if (!escape.ok) return escape
      let text
      try {
        text = await io.readFile(target, 'utf-8')
      } catch (error) {
        if (error?.code === 'ENOENT') return fail('INVALID_INPUT', `提案不存在：${fileName}`, { name: fileName })
        return fail('IO_FAILED', `读取提案失败：${fileName}`, { cause: String(error?.message || error) })
      }
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        return fail('INVALID_INPUT', `「${fileName}」不是 JSON 提案：运行时的纯文本提案只在列表里展示，不能进审阅面`, { name: fileName })
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail('INVALID_INPUT', `「${fileName}」不是 pinax-proposal@1 对象`, { name: fileName })
      }
      return ok({ name: fileName, path: `.pinax/proposals/${fileName}`, proposal: parsed })
    },

    /** 弃用＝删掉这份提案文件（正文与修订号一概不动，提案从未进过正文账）。 */
    async discardProposal({ name } = {}) {
      const checked = proposalFilePath(projectRoot, name)
      if (!checked.ok) return checked
      const { target, fileName } = checked.value
      const escape = await assertNoSymlinkEscape(projectRoot, target, { realpath: io.realpath, lstat: io.lstat })
      if (!escape.ok) return escape
      try {
        await io.unlink(target)
      } catch (error) {
        if (error?.code === 'ENOENT') return fail('INVALID_INPUT', `提案不存在：${fileName}`, { name: fileName })
        return fail('IO_FAILED', `弃用提案失败：${fileName}`, { cause: String(error?.message || error) })
      }
      return ok({ discarded: true, name: fileName })
    },

    /**
     * 把提案的 status 写回 JSON（原子写）。采纳后留档：提案文件不删，作者以后还查得到这一版新稿从哪来。
     * 与 discardProposal 同一套名字校验，走同一条写链，避免与并发的采纳/弃用打架。
     */
    async markProposalStatus({ name, status } = {}) {
      const checked = proposalFilePath(projectRoot, name)
      if (!checked.ok) return checked
      const { target, fileName } = checked.value
      const normalized = String(status ?? '')
      if (!PROPOSAL_STATUSES.includes(normalized)) {
        return fail('INVALID_INPUT', `提案状态只能写 ${PROPOSAL_STATUSES.join(' / ')}`, { got: status })
      }
      const escape = await assertNoSymlinkEscape(projectRoot, target, { realpath: io.realpath, lstat: io.lstat })
      if (!escape.ok) return escape
      return service.enqueue(async () => {
        let parsed
        try {
          parsed = JSON.parse(await io.readFile(target, 'utf-8'))
        } catch (error) {
          if (error?.code === 'ENOENT') return fail('INVALID_INPUT', `提案不存在：${fileName}`, { name: fileName })
          return fail('INVALID_INPUT', `「${fileName}」不是合法的提案 JSON，状态写不进去`, { name: fileName })
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return fail('INVALID_INPUT', `「${fileName}」不是 pinax-proposal@1 对象`, { name: fileName })
        }
        const updatedAt = new Date().toISOString()
        parsed.status = normalized
        parsed.statusUpdatedAt = updatedAt
        try {
          await io.atomicWrite(target, `${JSON.stringify(parsed, null, 2)}\n`)
        } catch (error) {
          return fail('IO_FAILED', `写回提案状态失败：${fileName}`, { cause: String(error?.message || error) })
        }
        return ok({ name: fileName, status: normalized, updatedAt })
      })
    },

    /** 目录的认领者（批次46B）：导入按认领者的 pluginId 走文件服务的三道闸。 */
    ownerOfDir(dir) {
      return resolveOwner(null, String(dir ?? '正文'))
    },

    /**
     * 全书查找（批次46B · 任务①）：按章节顺序扫正文，命中的每一处带行号、上下文与序号。
     *
     * 只读：不写盘、不动修订号；目录范围仍是「插件认领的 正文/」——
     * 归属／作用域闸照旧走 list／read，不另开一条读文件的路。
     * 顺序与章节树一致：一级子目录（卷）按目录名、卷内按文件名，平铺章排在卷后。
     * 命中超过 maxHits（默认 500、上限 1000）即停并标 truncated——不静默截断。
     */
    async searchChapters(query, { caseSensitive = false, maxHits = 500, dir = '正文', pluginId = null } = {}) {
      const needle = String(query ?? '')
      if (!needle.trim()) return fail('INVALID_INPUT', '查找需要关键词（不能是空白）', { query })
      if (needle.length > 200) return fail('INVALID_INPUT', '查找关键词过长（上限 200 字）', { length: needle.length })
      const cap = Number.isSafeInteger(maxHits) ? Math.min(Math.max(maxHits, 1), 1000) : 500
      const owner = resolveOwner(pluginId, dir)
      if (!owner) return fail('DIR_CONFLICT', `没有插件认领目录「${dir}」：这本书没有可查找的正文`, { dir })
      const files = await listChapterFiles(owner, dir)
      if (!files.ok) return files
      const pattern = new RegExp(escapeRegExp(needle), caseSensitive ? 'gu' : 'giu')
      const hits = []
      const warnings = []
      let truncated = false
      for (const chapter of files.value) {
        if (hits.length >= cap) {
          truncated = true
          break
        }
        const read = await service.read({ pluginId: owner, dir, file: dirRelative(dir, chapter.file) })
        if (!read.ok) {
          warnings.push(`「${chapter.file}」读失败，已跳过：${read.error.message}`)
          continue
        }
        const text = read.value.text
        let matchIndex = 0
        // 行号按命中顺序增量推进：一处一处往后数，不从头重算（大章里命中多也不做 O(n×m)）。
        let lineCursor = 0
        let line = 1
        for (const match of text.matchAll(pattern)) {
          if (hits.length >= cap) {
            truncated = true
            break
          }
          for (; lineCursor < match.index; lineCursor += 1) {
            if (text.charCodeAt(lineCursor) === 10) line += 1
          }
          hits.push({
            file: chapter.file,
            chapterTitle: chapter.title,
            line,
            snippet: hitSnippet(text, match.index, match.index + match[0].length),
            matchIndex
          })
          matchIndex += 1
        }
        if (truncated) break
      }
      return ok({
        query: needle,
        caseSensitive: Boolean(caseSensitive),
        total: hits.length,
        truncated,
        chaptersScanned: files.value.length,
        hits,
        warnings
      })
    },

    /**
     * 当前章替换（批次46B · 任务①）：替换范围只有一章，仍走同一条修订号闸。
     * 先读（adoptRevision）拿到盘上修订号并核对 expectedRevision，再算替换文本，
     * 最后交 service.write 在写链里再核一次——两次之间有人改了这一章也一样被 STALE 拒掉。
     * all=false 只换第一处；replace 不许为空串（那等于一键删掉所有命中，不做静默清空）。
     */
    async replaceInChapter({ file, find, replace: replacement = '', expectedRevision, caseSensitive = false, all = true, dir = '正文', pluginId = null } = {}) {
      const needle = String(find ?? '')
      if (!needle) return fail('INVALID_INPUT', '替换需要查找词（不能为空）', { find })
      if (needle.length > 200) return fail('INVALID_INPUT', '查找词过长（上限 200 字）', { length: needle.length })
      if (typeof replacement !== 'string') return fail('INVALID_INPUT', '替换内容必须是字符串')
      if (!replacement) return fail('INVALID_INPUT', '替换内容不能为空：那会一键删掉所有命中，请逐处手动删改', { find })
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return fail('INVALID_INPUT', '替换必须带 expectedRevision（新建传 0）')
      }
      const owner = resolveOwner(pluginId, dir)
      if (!owner) return fail('DIR_CONFLICT', `没有插件认领目录「${dir}」：这本书没有可替换的正文`, { dir })
      // 章节树给的 file 带「正文/」前缀（如 正文/第一卷/第003章.md）；file 服务要的是相对 dir 的路径。
      const relativeFile = dirRelative(dir, file)
      if (!relativeFile) return fail('INVALID_INPUT', '替换需要指出是哪一章', { file })
      const read = await service.read({ pluginId: owner, dir, file: relativeFile })
      if (!read.ok) return read
      if (read.value.revision !== expectedRevision) {
        return fail('STALE_REVISION', `「${read.value.relativePath}」已被改动（第 ${read.value.revision} 版），本次基于第 ${expectedRevision} 版的替换被拒绝：不静默合并，请重新载入该章`, {
          path: read.value.relativePath,
          expected: expectedRevision,
          actual: read.value.revision
        })
      }
      const replaced = replaceOccurrences(read.value.text, needle, replacement, { caseSensitive, all })
      if (!replaced.count) {
        return ok({ file: read.value.relativePath, replaced: 0, revision: read.value.revision, changed: false })
      }
      const written = await service.write({ pluginId: owner, dir, file: relativeFile, text: replaced.text, expectedRevision })
      if (!written.ok) return written
      return ok({ file: written.value.relativePath, replaced: replaced.count, revision: written.value.revision, changed: true })
    },

    /** 对外取修订号：与 read/write 同一套采纳规则，异步（可能要 stat 磁盘）。 */
    async revisionOf(relativePath) {
      return adoptRevision(String(relativePath).replaceAll('\\', '/'))
    },

    async shaOf({ pluginId, dir, file }) {
      const read = await service.read({ pluginId, dir, file })
      return read.ok ? ok(read.value.sha256) : read
    }
  }

  async function locate({ pluginId, dir, file, manifest: given }) {
    const manifest = given || registry.get(pluginId)
    if (!manifest) return fail('INVALID_INPUT', `未安装的插件：${pluginId}`)
    const owned = ownedDirOf(manifest, dir)
    if (!owned) {
      return fail('DIR_CONFLICT', `插件 ${pluginId} 未认领目录「${dir}」；它的板块是 ${Object.values(manifest.dataDirs).join(' / ')}（C3）`, {
        pluginId, dir, owned: Object.values(manifest.dataDirs)
      })
    }
    // dir 既可以是精确 dataDir 名，也可以是「dataDir 名＋子路径」：归属按一级目录名判，
    // 子路径原样拼回相对路径（仍过 C2 的 ..／绝对路径／.pinax 检查）。
    const baseDir = owned.subPath ? `${owned.ownerDir}/${owned.subPath}` : owned.ownerDir
    const relativeInput = file === '.' || file === '' ? baseDir : `${baseDir}/${String(file).replaceAll('\\', '/')}`
    const contained = joinContained(projectRoot, relativeInput)
    if (!contained.ok) return contained
    const { target, relativePath } = contained.value
    const targetDir = relativePath === baseDir ? target : resolve(target, '..')
    const escape = await assertNoSymlinkEscape(projectRoot, target, { realpath: io.realpath, lstat: io.lstat })
    if (!escape.ok) return escape
    return ok({
      targetFile: target,
      targetDir: file === '.' || file === '' ? target : targetDir,
      relativePath,
      ownerDir: owned.ownerDir
    })
  }

  /**
   * dir 归一成「一级 dataDir ＋ 子路径」（工单B：「目录递归归认领者」）。
   * 物理目录名不含 `/`（validatePhysicalDir 守着），所以前缀只认带 `/` 的完整一段：
   * 「正文/第一卷」是 正文 的子路径，「正文2」不是。返回 null ＝ 这块目录没有主人。
   */
  function ownedDirOf(manifest, dir) {
    const raw = String(dir ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
    if (!raw) return null
    const physical = Object.values(manifest.dataDirs)
    if (physical.includes(raw)) return { ownerDir: raw, subPath: '' }
    const ownerDir = physical.find((name) => raw.startsWith(`${name}/`))
    if (!ownerDir) return null
    return { ownerDir, subPath: raw.slice(ownerDir.length + 1) }
  }

  /**
   * 「谁来读这本书的正文」（批次46B）：显式给了 pluginId 就用它（仍要校验已安装），
   * 没给就按注册表查这块目录的认领者，多个认领者时取 id 排序第一个——
   * 顺序固定，不随 Map 插入顺序漂移。
   */
  function resolveOwner(pluginId, dir) {
    if (pluginId) return registry.get(pluginId) ? String(pluginId) : null
    const claims = typeof registry.dirClaims === 'function' ? registry.dirClaims().get(String(dir)) : null
    const owners = claims ? [...claims].sort() : []
    return owners[0] ?? null
  }

  /**
   * 章节文件顺序（批次46B）：与章节树同一口径——卷（一级子目录）按目录名、卷内按文件名，
   * 平铺章排在卷后；更深的层级不展开（两级封顶）。每项带 { file, title }。
   */
  async function listChapterFiles(pluginId, dir) {
    const listed = await service.list({ pluginId, dir })
    if (!listed.ok) return listed
    if (listed.value.missing) return ok([])
    const entries = listed.value.entries ?? []
    const volumes = entries.filter((entry) => entry.kind === 'dir').map((entry) => entry.name).sort(compareChapterNames)
    const files = []
    for (const volume of volumes) {
      const nested = await service.list({ pluginId, dir: `${dir}/${volume}` })
      if (!nested.ok) return nested
      const names = (nested.value.entries ?? [])
        .filter((entry) => entry.kind === 'file' && /\.md$/iu.test(entry.name))
        .map((entry) => entry.name)
        .sort(compareChapterNames)
      for (const name of names) files.push({ file: `${dir}/${volume}/${name}`, title: chapterTitleOf(name) })
    }
    const loose = entries
      .filter((entry) => entry.kind === 'file' && /\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareChapterNames)
    for (const name of loose) files.push({ file: `${dir}/${name}`, title: chapterTitleOf(name) })
    return ok(files)
  }

  /** 崩溃恢复：半成品临时文件落在目标文件同目录，所以根目录＋每个一级板块目录都要扫一遍。 */
  async function sweepInterruptedWrites() {
    let cleaned = 0
    const directories = [projectRoot, join(projectRoot, '.pinax')]
    try {
      const { readdir } = await import('node:fs/promises')
      const entries = await readdir(projectRoot, { withFileTypes: true })
      for (const entry of entries) if (entry.isDirectory()) directories.push(join(projectRoot, entry.name))
    } catch {
      // 根目录读不出来时仍按已知两处清理
    }
    for (const directory of new Set(directories)) {
      const result = await io.recover(directory)
      cleaned += result.removed?.length ?? 0
    }
    return { cleaned }
  }

  async function loadRevisions() {
    try {
      const raw = await io.readFile(join(projectRoot, '.pinax', REVISIONS_FILE), 'utf-8')
      const parsed = JSON.parse(raw)
      revisions = new Map(Object.entries(parsed?.revisions ?? {}))
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      revisions = new Map()
    }
  }

  async function saveRevisions() {
    const payload = { spec: 'pinax-state@1', updatedAt: new Date().toISOString(), revisions: Object.fromEntries(revisions) }
    try {
      await io.atomicWrite(join(projectRoot, '.pinax', REVISIONS_FILE), `${JSON.stringify(payload, null, 2)}\n`)
      return ok(true)
    } catch (error) {
      return fail('IO_FAILED', '写入 .pinax/state/revisions.json 失败', { cause: String(error?.message || error) })
    }
  }

  /**
   * 写入后的旁路通知（D1：历史标脏的单一接入点，不让各载体自己标）。
   * 历史是旁路：钩子失败绝不能让已经落盘的写作失败，异常在这里吞掉。
   */
  async function notifyWrite(info) {
    if (!writeHook) return
    try {
      await writeHook({ root: projectRoot, ...info })
    } catch {
      // 忽略：历史面板会经 probe 如实显示不可用，写作本身不受影响。
    }
  }

  /**
   * 修订号采纳（M2 补的洞）：作者整目录导入的既有稿子没进过账，若按 0 处理，
   * 「新建文件传 0」就成了盲写原稿的通道。磁盘上有文件而账上没记录 → 记为第 1 版，
   * 于是 expectedRevision 0 只可能是真正的新建。
   */
  async function adoptRevision(relativePath) {
    if (revisions.has(relativePath)) {
      // 账上有记录也要对一次盘：文件可能被作者在盘外删掉，或整目录拷贝带来了陈账
      // （账说第 1 版、盘上没有）。以盘为准清掉陈条目按未建档（0）处理——
      // 否则同名文件永远建不回来（STALE 指着一个不存在的「第 1 版」）。
      const tracked = revisions.get(relativePath)
      const exists = await io.stat(join(projectRoot, relativePath)).then(() => true, () => false)
      if (exists) return tracked
      revisions.delete(relativePath)
      return 0
    }
    const exists = await io.stat(join(projectRoot, relativePath)).then(() => true, () => false)
    if (!exists) return 0
    revisions.set(relativePath, 1)
    return 1
  }

  /**
   * 待审提案保护（批次46A）：两轨通拦——MCP 内容提案（status:'proposed'）与 agent
   * 工具调用提案（writePolicy review 档经 proposalStore 落盘，status:'pending'），
   * 只要还没变成已采纳／已弃用的留痕就拦。路径 MCP 轨在 target.file，agent 轨在
   * args.file（原始参数不补默认值）。坏 JSON 与纯文本提案跳过：它们本来就不能被
   * 采纳，不构成本章的未决改动。
   */
  async function pendingProposalsFor(relativePath) {
    const dir = join(projectRoot, PROPOSALS_DIR)
    let entries
    try {
      entries = await io.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return ok([])
      return fail('IO_FAILED', '读取提案目录失败：.pinax/proposals', { cause: String(error?.message || error) })
    }
    const names = []
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(TMP_PREFIX) || !/\.json$/iu.test(entry.name)) continue
      let parsed
      try {
        parsed = JSON.parse(await io.readFile(join(dir, entry.name), 'utf-8'))
      } catch {
        continue
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const status = String(parsed.status ?? '')
      if (status === 'adopted' || status === 'discarded') continue
      const targets = [parsed.target?.file, parsed.args?.file]
      const hit = targets.some((value) => String(value ?? '').replaceAll('\\', '/') === relativePath)
      if (!hit) continue
      names.push(entry.name)
    }
    names.sort()
    return ok(names)
  }

  /** 破坏性操作前的强制快照：调用方注入的快照器失败（含历史仓库不可用）即中止。 */
  async function takeSnapshot(relativePath, verb) {
    let result
    try {
      result = await snapshot({ root: projectRoot, paths: [relativePath] })
    } catch (error) {
      return fail('IO_FAILED', `「${relativePath}」${verb}前的快照失败，已中止：${String(error?.message || error)}`, { path: relativePath })
    }
    if (!result?.ok) {
      const reason = result?.error?.message ?? '历史快照不可用'
      return fail('IO_FAILED', `「${relativePath}」${verb}前的快照失败，已中止：${reason}`, {
        path: relativePath,
        cause: result?.error ?? null
      })
    }
    return ok({ committed: Boolean(result.value?.committed), oid: result.value?.oid ?? null })
  }

  return service
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

/** 章节排序（批次46B）：数字前缀按数值比（2 排在 10 前面），其余按中文口径。 */
const CHAPTER_COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
function compareChapterNames(left, right) {
  return CHAPTER_COLLATOR.compare(left, right)
}

/** 「003-倒带.md」→「倒带」：与小说载体的标题口径一致（只剥 .md 与数字前缀）。 */
function chapterTitleOf(name) {
  return String(name ?? '').replace(/\.md$/iu, '').replace(/^\d{1,3}-/u, '')
}

/** 章节树／搜索命中给的路径带「正文/」前缀；file 服务的 file 是相对 dir 的那一段。 */
function dirRelative(dir, file) {
  const normalized = String(file ?? '').replaceAll('\\', '/')
  return normalized.startsWith(`${dir}/`) ? normalized.slice(dir.length + 1) : normalized
}

/** 上下文 ±40 字，空白折叠成单个空格；被裁掉的一端补省略号。 */
function hitSnippet(text, start, end) {
  const before = text.slice(Math.max(0, start - 40), start)
  const after = text.slice(end, Math.min(text.length, end + 40))
  const head = before ? `${before.length < 40 || start === 0 ? '' : '…'}${before}` : ''
  const tail = after ? `${after}${after.length < 40 || end === text.length ? '' : '…'}` : ''
  return `${head}${text.slice(start, end)}${tail}`.replace(/\s+/gu, ' ').trim()
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * 字面量替换（批次46B）：不是正则——作者找的就是这几个字。
 * 大小写不敏感时用小写对照定位，但保留原文切片，不改变未命中部分的大小写。
 */
function replaceOccurrences(text, find, replacement, { caseSensitive = false, all = true } = {}) {
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? find : find.toLowerCase()
  let cursor = 0
  let count = 0
  let output = ''
  while (cursor <= text.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index < 0) break
    output += text.slice(cursor, index) + replacement
    cursor = index + find.length
    count += 1
    if (!all) break
  }
  if (!count) return { text, count: 0 }
  output += text.slice(cursor)
  return { text: output, count }
}


/** 待审提案拦下删除/改名时的统一失败载荷（点名提案文件名，作者知道该先处理哪几份）。 */
function proposalBlocked(relativePath, names, verb) {
  return fail('INVALID_INPUT', `「${relativePath}」还有 ${names.length} 份未审提案（${names.join(' / ')}）：先采纳或弃用，再${verb}`, {
    path: relativePath,
    proposals: names
  })
}

/**
 * 改名的新文件名形状：本批只做「同目录换名」，所以拒一切路径分隔符与目录穿越。
 * 允许中文、空格、连字符与 001- 前缀调整；隐藏文件名（点开头）与超长名拒。
 */
function checkRenameName(name) {
  if (!name) return fail('INVALID_INPUT', '改名要给新文件名')
  if (name.length > 200) return fail('INVALID_INPUT', '新文件名过长', { length: name.length })
  if (name.includes('/') || name.includes('\\')) {
    return fail('INVALID_INPUT', `本批只支持同目录改名：新文件名不许带路径分隔符（${name}）`, { name })
  }
  if (name === '.' || name === '..' || name.startsWith('.')) {
    return fail('INVALID_INPUT', `新文件名不合法：${name}`, { name })
  }
  if (/\p{Cc}/u.test(name)) return fail('INVALID_INPUT', '新文件名含控制字符', { name })
  return ok(name)
}

/**
 * 提案文件名校验：只接受 .pinax/proposals/ 里的一层文件名。
 * 拒空、拒路径分隔符、拒「..」、拒隐藏/临时文件（都以点开头）、拒控制字符——
 * 提案接口永远不该成为「按名字读项目里任意文件」的第二条路。
 */
function proposalFilePath(projectRoot, name) {
  const raw = String(name ?? '').trim()
  if (!raw) return fail('INVALID_INPUT', '要给出提案文件名')
  if (raw.length > 240) return fail('INVALID_INPUT', '提案文件名过长', { length: raw.length })
  if (raw.includes('/') || raw.includes('\\')) return fail('INVALID_INPUT', `提案文件名不许带路径分隔符：${raw}`, { name: raw })
  if (raw.includes('..')) return fail('INVALID_INPUT', `提案文件名不许含「..」：${raw}`, { name: raw })
  if (raw.startsWith('.')) return fail('INVALID_INPUT', `提案文件名不许以点开头：${raw}`, { name: raw })
  if (/\p{Cc}/u.test(raw)) return fail('INVALID_INPUT', '提案文件名含控制字符', { name: raw })
  return ok({ target: join(projectRoot, PROPOSALS_DIR, raw), fileName: raw })
}

function manifestDirs(manifest) {
  return manifest?.dataDirs ?? {}
}
