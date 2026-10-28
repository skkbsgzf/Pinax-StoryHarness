import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fail, ok } from '../kernel/errors.mjs'
import { canPerform } from '../kernel/scopeGrant.mjs'
import { recoverInterruptedWrites, writeFileAtomic } from './atomicWrite.mjs'
import { assertNoSymlinkEscape, joinContained } from './projectPath.mjs'

/**
 * 唯一写盘出口（WP2）。所有插件的文件操作都必须过这三道闸：
 *   1) 归属：目标目录必须在该插件 dataDirs 里（C3，跨板块请走对方 tools）；
 *   2) 作用域：manifest.scopes 未声明 file:<目录>:rw 即拒（第 7 节）；
 *   3) 并发：expectedRevision 不符返回 STALE_REVISION，不覆盖、不合并、不吭声。
 * 元数据只进 .pinax/（状态 revisions、提案 proposals），正文永远是人打开资源管理器看得懂的那份。
 */
const REVISIONS_FILE = join('state', 'revisions.json')

export function createFileService({ root, registry, fsImpl, onWrite } = {}) {
  const projectRoot = resolve(String(root || '.'))
  const io = {
    readFile: fsImpl?.readFile || readFile,
    mkdir: fsImpl?.mkdir || mkdir,
    stat: fsImpl?.stat || stat,
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

function manifestDirs(manifest) {
  return manifest?.dataDirs ?? {}
}
