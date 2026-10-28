import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fail, ok } from '../kernel/errors.mjs'
import { canPerform } from '../kernel/scopeGrant.mjs'
import { recoverInterruptedWrites, TMP_PREFIX, writeFileAtomic } from './atomicWrite.mjs'
import { assertNoSymlinkEscape, joinContained } from './projectPath.mjs'

/**
 * 唯一写盘出口（WP2）。所有插件的文件操作都必须过这三道闸：
 *   1) 归属：目标目录必须在该插件 dataDirs 里（C3，跨板块请走对方 tools）；
 *   2) 作用域：manifest.scopes 未声明 file:<目录>:rw 即拒（第 7 节）；
 *   3) 并发：expectedRevision 不符返回 STALE_REVISION，不覆盖、不合并、不吭声。
 * 元数据只进 .pinax/（状态 revisions、提案 proposals），正文永远是人打开资源管理器看得懂的那份。
 */
const REVISIONS_FILE = join('state', 'revisions.json')
/** 提案是内核元数据（不是任何载体的板块目录）：目录固定，作用域闸与归属闸都不适用。 */
const PROPOSALS_DIR = join('.pinax', 'proposals')
/** 提案状态只认这三档：运行时写出来的是 proposed，采纳与弃用各占一档。 */
const PROPOSAL_STATUSES = Object.freeze(['proposed', 'adopted', 'discarded'])

export function createFileService({ root, registry, fsImpl, onWrite } = {}) {
  const projectRoot = resolve(String(root || '.'))
  const io = {
    readFile: fsImpl?.readFile || readFile,
    mkdir: fsImpl?.mkdir || mkdir,
    stat: fsImpl?.stat || stat,
    readdir: fsImpl?.readdir || readdir,
    unlink: fsImpl?.unlink || unlink,
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
      const grant = canPerform(registry.grantFor(pluginId), { type: 'file', dir, mode: 'read' })
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
      const grant = canPerform(registry.grantFor(pluginId), { type: 'file', dir, mode: 'write' })
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

    /** 列板块内容：只在该插件自己认领的目录里走。 */
    async list({ pluginId, dir }) {
      const located = await locate({ pluginId, dir, file: '.' })
      if (!located.ok) return located
      const grant = canPerform(registry.grantFor(pluginId), { type: 'file', dir, mode: 'read' })
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
    if (!Object.values(manifest.dataDirs).includes(dir)) {
      return fail('DIR_CONFLICT', `插件 ${pluginId} 未认领目录「${dir}」；它的板块是 ${Object.values(manifest.dataDirs).join(' / ')}（C3）`, {
        pluginId, dir, owned: Object.values(manifest.dataDirs)
      })
    }
    const relativeInput = file === '.' || file === '' ? dir : `${dir}/${String(file).replaceAll('\\', '/')}`
    const contained = joinContained(projectRoot, relativeInput)
    if (!contained.ok) return contained
    const { target, relativePath } = contained.value
    const targetDir = relativePath === dir ? target : resolve(target, '..')
    const escape = await assertNoSymlinkEscape(projectRoot, target, { realpath: io.realpath, lstat: io.lstat })
    if (!escape.ok) return escape
    return ok({
      targetFile: target,
      targetDir: file === '.' || file === '' ? target : targetDir,
      relativePath
    })
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
    if (revisions.has(relativePath)) return revisions.get(relativePath)
    const exists = await io.stat(join(projectRoot, relativePath)).then(() => true, () => false)
    if (!exists) return 0
    revisions.set(relativePath, 1)
    return 1
  }

  return service
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
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
