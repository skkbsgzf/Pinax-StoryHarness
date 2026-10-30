import fs from 'node:fs'
import { lstat, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import git from 'isomorphic-git'
import { writeFileAtomic } from '../fs/atomicWrite.mjs'

/**
 * R3 裁定（2026-10-28）的变更历史引擎：git 快照，独立 git-dir，内置 git 库。
 *
 * 布局（绝不往项目根放 `.git`——作者的稿子目录本身可能已是别的 git 仓库）：
 *   <root>/.pinax/history.git/     ← git 目录（config／objects／refs）
 *   <root>/.pinax/state/history-dirty.json  ← 脏清单
 *
 * 机制：写入只标脏；提交时把允许前缀整棵目录逐个 `git add` 后提交一次快照。
 *   - 允许前缀：正文/ 大纲/ 世界书/ 构思/ 约束/ 资料/ 剧本/ 素材/ 漫画/ 视频/ 体验/ 联机/、
 *     .pinax/project.json（D0 工单口径；批次40 补剧本与 M4／M5 记录目录）
 *     与 .pinax/proposals/（工单E3：模型改稿的提案也是作者要能回溯的留痕）；
 *   - `assets/` 与 `.pinax/` 的其余部分不进历史（体积与噪声控制，见设计 §4）；
 *   - 脏清单只是「要不要提交」的触发闸，不是增量补丁清单：一次快照永远是允许前缀的完整状态，
 *     这样删除、改名、以及不经 fileService 的 `.pinax/project.json` 变更都不会漏。
 *
 * 返回合同（与 next/fs、next/project 一致）：
 *   成功 { ok:true, value }，失败 { ok:false, error:{ code, message, details? } }。
 *   失败码只有两个（工单 D0 指定）：HISTORY_UNAVAILABLE（仓库／IO／git 调用失败）、
 *   HISTORY_INVALID_INPUT（参数或路径不合法）。任何底层异常都在出口被收成 typed error。
 *
 * 只在主进程使用：渲染层不得 import 本模块（打包门禁核渲染层产物不含 isomorphic-git）。
 */

export const HISTORY_ERROR_CODES = Object.freeze({
  UNAVAILABLE: 'HISTORY_UNAVAILABLE',
  INVALID_INPUT: 'HISTORY_INVALID_INPUT'
})

/** git 目录固定落 `.pinax/history.git`（与工作树分离，项目根上不出现 `.git`）。 */
export const HISTORY_GITDIR = '.pinax/history.git'
/** 脏清单相对路径。 */
export const HISTORY_DIRTY_FILE = '.pinax/state/history-dirty.json'
export const HISTORY_DIRTY_SPEC = 'pinax-history-dirty@1'

/** 仓库本地身份：绝不继承／污染用户全局 git 配置。 */
export const HISTORY_IDENTITY = Object.freeze({ name: 'pinax', email: 'pinax@local' })

/** D0 允许进历史的目录（顶格一级目录名）。
 *  批次40（M4／M5）补上 剧本/ 与五块记录型载体的目录：它们都是作者的项目真源，
 *  只进历史不改变权限口径（写入仍要过各自的载体工具与文件服务三道闸）。 */
export const HISTORY_ALLOWED_DIRS = Object.freeze(['正文', '大纲', '世界书', '构思', '约束', '资料', '剧本', '素材', '漫画', '视频', '体验', '联机'])
/** D0 允许进历史的单文件。 */
export const HISTORY_ALLOWED_FILES = Object.freeze(['.pinax/project.json'])
/** 允许进历史的嵌套目录（相对路径，至少再有一层文件名）——工单E3：提案留痕。
 *  `.pinax/` 整目录仍被 info/exclude 忽略，落库靠 commitLocked 的 force add（与 project.json 同法）。 */
export const HISTORY_ALLOWED_NESTED_DIRS = Object.freeze(['.pinax/proposals'])

const DEFAULT_HISTORY_LIMIT = 50
const MAX_HISTORY_LIMIT = 500
/** Myers trace 的内存上限（Int32 单元数，约 16 MB）；超出后整段退化为删除+新增。 */
const MAX_DIFF_CELLS = 4_000_000

export async function ensureHistoryRepo({ root } = {}) {
  const resolved = await resolveProjectRoot(root)
  if (!resolved.ok) return resolved
  const rootPath = resolved.value
  const { dir, gitdir } = repoPaths(rootPath)
  const already = await fileExists(join(gitdir, 'HEAD'))
  try {
    if (!already) {
      // 注意：isomorphic-git 的 add/commit 需要工作树句柄，所以这里用「独立 gitdir + 工作树」
      // 形态（等价 git --git-dir=.pinax/history.git --work-tree=<root>），而不是没有工作树的 bare。
      // 对作者而言效果相同：项目根上没有 `.git`，历史整个收在一个目录里，删目录即清历史。
      await mkdir(gitdir, { recursive: true })
      await git.init({ fs, dir, gitdir, bare: false, defaultBranch: 'main' })
    }
    await git.setConfig({ fs, dir, gitdir, path: 'user.name', value: HISTORY_IDENTITY.name })
    await git.setConfig({ fs, dir, gitdir, path: 'user.email', value: HISTORY_IDENTITY.email })
    // Windows 换行坑（设计 §9）：不锁 autocrlf，同一份稿子会因换行反复“变更”。
    await git.setConfig({ fs, dir, gitdir, path: 'core.autocrlf', value: 'false' })
    await ensureExcludeFile(gitdir)
    return historyOk({ root: rootPath, gitdir, created: !already })
  } catch (error) {
    return historyFail('UNAVAILABLE', `历史仓库初始化失败：${gitdir}`, { cause: describeError(error) })
  }
}

/**
 * 脏清单合并去重。paths 可以是任意项目内相对路径（含 assets/、日志/ —— 提交时会按允许前缀过滤）；
 * 越出项目根、绝对路径、`.pinax/history.git` 自引用一律 HISTORY_INVALID_INPUT。
 */
export async function markDirty({ root, paths } = {}) {
  const resolved = await resolveProjectRoot(root)
  if (!resolved.ok) return resolved
  const rootPath = resolved.value
  if (!Array.isArray(paths)) return historyFail('INVALID_INPUT', 'paths 必须是数组')
  const normalized = []
  for (const item of paths) {
    const checked = normalizeProjectRelativePath(item)
    if (!checked.ok) return checked
    normalized.push(checked.value)
  }

  return withRootLock(rootPath, async () => {
    const dirty = await readDirtyList(rootPath)
    if (!dirty.ok) return dirty
    const merged = [...new Set([...dirty.value, ...normalized])].sort()
    const payload = { spec: HISTORY_DIRTY_SPEC, updatedAt: new Date().toISOString(), paths: merged }
    try {
      await mkdir(join(rootPath, '.pinax', 'state'), { recursive: true })
      await writeFileAtomic(dirtyPath(rootPath), `${JSON.stringify(payload, null, 2)}\n`)
    } catch (error) {
      return historyFail('UNAVAILABLE', `写入 ${HISTORY_DIRTY_FILE} 失败`, { cause: describeError(error) })
    }
    return historyOk({ paths: merged, added: merged.length - dirty.value.length, updatedAt: payload.updatedAt })
  })
}

/**
 * 提交一次快照。无脏 → { committed:false, reason:'clean' }，不建空提交。
 * 有脏但允许前缀无变化（内容与上一版一致／只脏了 assets）→ { committed:false, reason:'no-changes' }。
 * 成功 → { committed:true, oid, files, removed, message }，并清空脏清单。
 */
export async function commitSnapshot({ root, message } = {}) {
  const resolved = await resolveProjectRoot(root)
  if (!resolved.ok) return resolved
  const rootPath = resolved.value
  if (message !== undefined && message !== null && typeof message !== 'string') {
    return historyFail('INVALID_INPUT', 'message 必须是字符串')
  }
  return withRootLock(rootPath, () => commitLocked(rootPath, message))
}

/** 列某文件的提交历史（新→旧）。未纳入版本化的路径返回空数组，由调用方显示「无历史」。 */
export async function listFileHistory({ root, path, limit } = {}) {
  const resolved = await resolveProjectRoot(root)
  if (!resolved.ok) return resolved
  const rootPath = resolved.value
  const checked = normalizeProjectRelativePath(path)
  if (!checked.ok) return checked
  const filepath = checked.value
  const wantedLimit = limit === undefined || limit === null ? DEFAULT_HISTORY_LIMIT : limit
  if (!Number.isSafeInteger(wantedLimit) || wantedLimit < 1 || wantedLimit > MAX_HISTORY_LIMIT) {
    return historyFail('INVALID_INPUT', `limit 必须是 1–${MAX_HISTORY_LIMIT} 的整数`)
  }
  if (!isHistoryPath(filepath)) return historyOk([])

  const repo = await requireRepo(rootPath)
  if (!repo.ok) return repo
  try {
    const commits = await git.log({
      fs,
      dir: repo.value.dir,
      gitdir: repo.value.gitdir,
      filepath,
      depth: wantedLimit,
      follow: true
    })
    // isomorphic-git 的 filepath + depth 在收尾时可能多推一条（endCommit 不受 depth 约束），
    // 这里按调用方口径裁一次，limit 是硬上限。
    return historyOk(commits.slice(0, wantedLimit).map(({ oid, commit }) => ({
      oid,
      message: String(commit?.message ?? '').trim(),
      when: isoFromTimestamp(commit?.committer?.timestamp ?? commit?.author?.timestamp),
      author: String(commit?.author?.name ?? '')
    })))
  } catch (error) {
    // 仓库还没有任何提交时 HEAD 未出生：这不是故障，是「还没有历史」。
    if (isNotFound(error)) return historyOk([])
    return historyFail('UNAVAILABLE', `读取「${filepath}」的历史失败`, { path: filepath, cause: describeError(error) })
  }
}

/** 读某版本的 UTF-8 文本。value 是字符串（工单 D0 口径）。 */
export async function readVersion({ root, oid, path } = {}) {
  const resolved = await resolveProjectRoot(root)
  if (!resolved.ok) return resolved
  const rootPath = resolved.value
  const checkedOid = normalizeOid(oid)
  if (!checkedOid.ok) return checkedOid
  const checked = normalizeProjectRelativePath(path)
  if (!checked.ok) return checked
  if (!isHistoryPath(checked.value)) {
    return historyFail('INVALID_INPUT', `「${checked.value}」不在历史版本化范围（正文／大纲／世界书／构思／约束／资料／.pinax/project.json／.pinax/proposals/）`, { path: checked.value })
  }
  const repo = await requireRepo(rootPath)
  if (!repo.ok) return repo
  const version = await requireVersion(repo.value, checkedOid.value)
  if (!version.ok) return version
  return readTextAt(repo.value, checkedOid.value, checked.value)
}

/**
 * 两版之间某文件的行级 diff。value = { hunks:[{type:'add'|'del'|'ctx', line, text}] }。
 * line：ctx/add 为新文件行号，del 为旧文件行号（1 起）。文件在某一版不存在时按空内容处理。
 * 算法自写（Myers，前缀/后缀先剥、超限退化为整段替换），没有引用 diff 库。
 */
export async function diffVersions({ root, a, b, path } = {}) {
  const resolved = await resolveProjectRoot(root)
  if (!resolved.ok) return resolved
  const rootPath = resolved.value
  const oidA = normalizeOid(a)
  if (!oidA.ok) return oidA
  const oidB = normalizeOid(b)
  if (!oidB.ok) return oidB
  const checked = normalizeProjectRelativePath(path)
  if (!checked.ok) return checked
  const filepath = checked.value
  if (!isHistoryPath(filepath)) {
    return historyFail('INVALID_INPUT', `「${filepath}」不在历史版本化范围（正文／大纲／世界书／构思／约束／资料／.pinax/project.json／.pinax/proposals/）`, { path: filepath })
  }
  const repo = await requireRepo(rootPath)
  if (!repo.ok) return repo
  const versionA = await requireVersion(repo.value, oidA.value)
  if (!versionA.ok) return versionA
  const versionB = await requireVersion(repo.value, oidB.value)
  if (!versionB.ok) return versionB

  const oldText = await readTextAt(repo.value, oidA.value, filepath, { allowMissing: true })
  if (!oldText.ok) return oldText
  const newText = await readTextAt(repo.value, oidB.value, filepath, { allowMissing: true })
  if (!newText.ok) return newText
  try {
    return historyOk({ hunks: diffLines(splitLines(oldText.value), splitLines(newText.value)) })
  } catch (error) {
    return historyFail('UNAVAILABLE', `计算「${filepath}」的差异失败`, { path: filepath, cause: describeError(error) })
  }
}

// ——— 内部实现 ———

function historyOk(value) {
  return { ok: true, value }
}

function historyFail(code, message, details) {
  const error = { code: HISTORY_ERROR_CODES[code] ?? HISTORY_ERROR_CODES.INVALID_INPUT, message }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, error }
}

function repoPaths(rootPath) {
  return { dir: rootPath, gitdir: join(rootPath, '.pinax', 'history.git') }
}

function dirtyPath(rootPath) {
  return join(rootPath, '.pinax', 'state', 'history-dirty.json')
}

async function resolveProjectRoot(root) {
  if (typeof root !== 'string' || !root.trim()) return historyFail('INVALID_INPUT', 'root 必须是非空字符串')
  const rootPath = resolve(root.trim())
  const info = await stat(rootPath).catch(() => null)
  if (!info?.isDirectory()) return historyFail('INVALID_INPUT', `项目根不存在或不是目录：${rootPath}`)
  return historyOk(rootPath)
}

/** 只做「项目内相对路径」的形状校验；是否进历史由 isHistoryPath 另行判定。 */
function normalizeProjectRelativePath(input) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) {
    return historyFail('INVALID_INPUT', '路径必须是非空字符串')
  }
  const normalized = input.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  const segments = normalized.split('/')
  if (!normalized
    || normalized.startsWith('/')
    || /^[a-zA-Z]:\//u.test(normalized)
    || segments.some((part) => !part || part === '.' || part === '..')) {
    return historyFail('INVALID_INPUT', `路径不合法或越出项目根：${input}`, { path: normalized })
  }
  if (segments[0] === '.git' || normalized === HISTORY_GITDIR || normalized.startsWith(`${HISTORY_GITDIR}/`)) {
    return historyFail('INVALID_INPUT', '历史仓库自身不能进脏清单／历史', { path: normalized })
  }
  return historyOk(normalized)
}

/** 是否属于 D0 允许进历史的范围（目录下至少一层文件，或单文件白名单）。 */
export function isHistoryPath(relativePath) {
  if (typeof relativePath !== 'string') return false
  const normalized = relativePath.replaceAll('\\', '/')
  if (HISTORY_ALLOWED_FILES.includes(normalized)) return true
  // 嵌套目录只收它下面的文件：目录条目本身不是快照对象。
  for (const nested of HISTORY_ALLOWED_NESTED_DIRS) {
    if (normalized.startsWith(`${nested}/`) && normalized.length > nested.length + 1) return true
  }
  const segments = normalized.split('/')
  if (segments.length < 2) return false
  return HISTORY_ALLOWED_DIRS.includes(segments[0])
}

function normalizeOid(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return historyFail('INVALID_INPUT', 'oid 必须是非空字符串')
  }
  const oid = input.trim().toLowerCase()
  // 只收完整对象号：isomorphic-git 的 readCommit/readBlob 不做短号展开（实测短号 → NotFound），
  // 与其把“短号”当合法输入再报不可用，不如在参数层就说清楚。listFileHistory 返回的正是完整号。
  if (!/^[0-9a-f]{40}$/u.test(oid)) {
    return historyFail('INVALID_INPUT', `oid 必须是 40 位十六进制 git 对象号：${input}`)
  }
  return historyOk(oid)
}

async function requireRepo(rootPath) {
  const { dir, gitdir } = repoPaths(rootPath)
  const exists = await fileExists(join(gitdir, 'HEAD'))
  if (!exists) {
    return historyFail('UNAVAILABLE', '历史仓库尚未建立（先调用 ensureHistoryRepo）', { gitdir })
  }
  return historyOk({ dir, gitdir })
}

/** 版本对象是否存在：不存在是仓库侧问题（UNAVAILABLE），不是参数格式问题。 */
async function requireVersion({ dir, gitdir }, oid) {
  try {
    await git.readCommit({ fs, dir, gitdir, oid })
    return historyOk(true)
  } catch (error) {
    if (isNotFound(error)) {
      return historyFail('UNAVAILABLE', `版本不存在：${oid.slice(0, 7)}`, { oid })
    }
    return historyFail('UNAVAILABLE', `读取版本失败：${oid.slice(0, 7)}`, { oid, cause: describeError(error) })
  }
}

async function commitLocked(rootPath, message) {
  const repo = await requireRepo(rootPath)
  if (!repo.ok) return repo
  const dirty = await readDirtyList(rootPath)
  if (!dirty.ok) return dirty
  if (dirty.value.length === 0) {
    return historyOk({ committed: false, reason: 'clean', files: [], removed: [] })
  }

  let current
  let tracked
  try {
    current = await collectSnapshotFiles(rootPath)
    tracked = await listTrackedFiles(repo.value)
  } catch (error) {
    return historyFail('UNAVAILABLE', '读取待快照文件失败', { cause: describeError(error) })
  }
  const currentSet = new Set(current)
  const removed = tracked.filter((filepath) => isHistoryPath(filepath) && !currentSet.has(filepath))

  try {
    // 逐个 add：一个文件失败能指出是哪一个，而不是整批含糊失败。
    for (const filepath of current) {
      // force:true —— info/exclude 里写着 `/.pinax/`，`.pinax/project.json` 必须绕过忽略规则才进得去；
      // 允许进历史的文件集合由本模块的 allowlist 决定，不交给忽略文件决定。
      await git.add({ fs, dir: repo.value.dir, gitdir: repo.value.gitdir, filepath, force: true })
    }
    for (const filepath of removed) {
      await git.remove({ fs, dir: repo.value.dir, gitdir: repo.value.gitdir, filepath })
    }
  } catch (error) {
    return historyFail('UNAVAILABLE', '暂存快照文件失败（脏清单保留）', { cause: describeError(error) })
  }

  const now = new Date()
  const identity = {
    name: HISTORY_IDENTITY.name,
    email: HISTORY_IDENTITY.email,
    timestamp: Math.floor(now.getTime() / 1000),
    timezoneOffset: now.getTimezoneOffset()
  }
  const commitMessage = typeof message === 'string' && message.trim()
    ? message
    : defaultSnapshotMessage(current, now)
  let oid
  try {
    oid = await git.commit({
      fs,
      dir: repo.value.dir,
      gitdir: repo.value.gitdir,
      message: commitMessage,
      author: identity,
      committer: identity,
      disallowEmpty: true
    })
  } catch (error) {
    if (error?.code === 'EmptyCommitError') {
      // 内容与上一版一致：没有可提交的差异。清脏，但不制造空提交。
      const cleared = await clearDirtyList(rootPath)
      if (!cleared.ok) return cleared
      return historyOk({ committed: false, reason: 'no-changes', files: [], removed: [] })
    }
    return historyFail('UNAVAILABLE', '提交历史快照失败（脏清单保留）', { cause: describeError(error) })
  }

  const cleared = await clearDirtyList(rootPath)
  if (!cleared.ok) {
    // 提交已经成功；脏清单没清掉只影响下一次（会得到 no-changes 并再清一次），如实报告而不是伪装成失败。
    return historyOk({ committed: true, oid, files: current, removed, message: commitMessage, dirtyCleared: false, warning: cleared.error.message })
  }
  return historyOk({ committed: true, oid, files: current, removed, message: commitMessage, dirtyCleared: true })
}

/** 走允许前缀目录，收集当前真实存在的普通文件；软链与原子写半成品一律跳过。 */
async function collectSnapshotFiles(rootPath) {
  const files = []
  for (const dirName of HISTORY_ALLOWED_DIRS) {
    const dirPath = join(rootPath, dirName)
    const info = await lstat(dirPath).catch(() => null)
    if (!info?.isDirectory() || info.isSymbolicLink()) continue
    await walk(dirPath)
  }
  // 嵌套目录（工单E3：.pinax/proposals/）：与顶格目录同一条走法，文件仍逐个过 isHistoryPath。
  for (const nested of HISTORY_ALLOWED_NESTED_DIRS) {
    const nestedPath = join(rootPath, nested)
    const info = await lstat(nestedPath).catch(() => null)
    if (!info?.isDirectory() || info.isSymbolicLink()) continue
    await walk(nestedPath)
  }
  for (const filepath of HISTORY_ALLOWED_FILES) {
    const info = await lstat(join(rootPath, filepath)).catch(() => null)
    if (info?.isFile() && !info.isSymbolicLink()) files.push(filepath)
  }
  files.sort()

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      // 不跟随软链：历史里只存内容，不存“指向项目外”的指针。
      if (entry.isSymbolicLink()) continue
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.startsWith('.pinax-tmp-')) continue
      const filepath = relative(rootPath, abs).replaceAll('\\', '/')
      if (isHistoryPath(filepath)) files.push(filepath)
    }
  }

  return [...new Set(files)].sort()
}

async function listTrackedFiles({ dir, gitdir }) {
  try {
    return await git.listFiles({ fs, dir, gitdir, ref: 'HEAD' })
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
}

async function readDirtyList(rootPath) {
  let raw
  try {
    raw = await readFile(dirtyPath(rootPath), 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return historyOk([])
    return historyFail('UNAVAILABLE', `读取 ${HISTORY_DIRTY_FILE} 失败`, { cause: describeError(error) })
  }
  try {
    const parsed = JSON.parse(raw)
    const paths = Array.isArray(parsed?.paths) ? parsed.paths : []
    // 脏清单是内核自写的状态文件；坏行按空清单自愈，不把历史引擎卡死。
    return historyOk([...new Set(paths.filter((item) => typeof item === 'string' && item.trim()))].sort())
  } catch {
    return historyOk([])
  }
}

async function clearDirtyList(rootPath) {
  try {
    await mkdir(join(rootPath, '.pinax', 'state'), { recursive: true })
    const payload = { spec: HISTORY_DIRTY_SPEC, updatedAt: new Date().toISOString(), paths: [] }
    await writeFileAtomic(dirtyPath(rootPath), `${JSON.stringify(payload, null, 2)}\n`)
    return historyOk(true)
  } catch (error) {
    return historyFail('UNAVAILABLE', `清空 ${HISTORY_DIRTY_FILE} 失败`, { cause: describeError(error) })
  }
}

async function ensureExcludeFile(gitdir) {
  const excludePath = join(gitdir, 'info', 'exclude')
  await mkdir(join(gitdir, 'info'), { recursive: true })
  const existing = await readFile(excludePath, 'utf-8').catch(() => '')
  const required = ['/.pinax/', '/assets/']
  const missing = required.filter((line) => !existing.includes(line))
  if (missing.length === 0) return
  const prefix = existing.trim() ? `${existing.trimEnd()}\n` : ''
  await writeFileAtomic(excludePath, `${prefix}${missing.join('\n')}\n`)
}

async function readTextAt({ dir, gitdir }, oid, filepath, { allowMissing = false } = {}) {
  try {
    const { blob } = await git.readBlob({ fs, dir, gitdir, oid, filepath })
    return historyOk(new TextDecoder('utf-8').decode(blob))
  } catch (error) {
    if (allowMissing && isNotFound(error)) return historyOk('')
    if (isNotFound(error)) {
      return historyFail('INVALID_INPUT', `版本 ${oid.slice(0, 7)} 中没有「${filepath}」`, { oid, path: filepath })
    }
    return historyFail('UNAVAILABLE', `读取版本 ${oid.slice(0, 7)} 的「${filepath}」失败`, { oid, path: filepath, cause: describeError(error) })
  }
}

function isNotFound(error) {
  return error?.code === 'NotFoundError' || error?.name === 'NotFoundError'
}

function describeError(error) {
  if (!error) return 'unknown error'
  const code = error.code ?? error.name
  const message = String(error.message ?? error)
  return code && !message.includes(String(code)) ? `${code}: ${message}` : message
}

function isoFromTimestamp(timestamp) {
  const seconds = Number.isFinite(timestamp) ? timestamp : 0
  return new Date(seconds * 1000).toISOString()
}

function defaultSnapshotMessage(files, now) {
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const body = files.length ? `\n\n${files.join('\n')}\n` : '\n'
  return `snapshot ${stamp} · ${files.length} 文件${body}`
}

/**
 * 同进程内的 per-root 串行队列：定时提交、关窗前提交、手动快照可能同时打到同一个仓库，
 * 而 git index 是共享状态。跨进程仍有风险——D1 只由主进程启动历史调度，不另开写者。
 */
const rootLocks = new Map()

function withRootLock(rootPath, task) {
  const key = rootPath.replaceAll('\\', '/').toLowerCase()
  const previous = rootLocks.get(key) ?? Promise.resolve()
  const run = previous.then(task, task)
  rootLocks.set(key, run.then(() => undefined, () => undefined))
  return run
}

// ——— 行级 diff（自写，无 diff 库依赖） ———

function splitLines(text) {
  const normalized = String(text ?? '').replace(/\r\n/gu, '\n').replace(/\r/gu, '\n')
  if (!normalized) return []
  const lines = normalized.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function diffLines(oldLines, newLines) {
  const prefix = []
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    prefix.push({ type: 'ctx', line: start + 1, text: oldLines[start] })
    start += 1
  }
  let suffixCount = 0
  while (
    suffixCount < oldLines.length - start
    && suffixCount < newLines.length - start
    && oldLines[oldLines.length - 1 - suffixCount] === newLines[newLines.length - 1 - suffixCount]
  ) {
    suffixCount += 1
  }
  const oldMiddle = oldLines.slice(start, oldLines.length - suffixCount)
  const newMiddle = newLines.slice(start, newLines.length - suffixCount)
  const middle = diffMiddle(oldMiddle, newMiddle, start)
  const suffix = []
  for (let index = suffixCount; index > 0; index -= 1) {
    const text = newLines[newLines.length - index]
    suffix.push({ type: 'ctx', line: newLines.length - index + 1, text })
  }
  return [...prefix, ...middle, ...suffix]
}

function diffMiddle(oldLines, newLines, offset) {
  const n = oldLines.length
  const m = newLines.length
  if (n === 0) return newLines.map((text, index) => ({ type: 'add', line: offset + index + 1, text }))
  if (m === 0) return oldLines.map((text, index) => ({ type: 'del', line: offset + index + 1, text }))

  const max = n + m
  const rowCells = 2 * max + 1
  const maxD = Math.min(max, Math.max(1, Math.floor(MAX_DIFF_CELLS / rowCells)))
  const v = new Int32Array(rowCells)
  const trace = []
  let done = -1
  for (let d = 0; d <= maxD && done < 0; d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      const tookDelete = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1])
      let x = tookDelete ? v[max + k + 1] : v[max + k - 1] + 1
      let y = x - k
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x += 1
        y += 1
      }
      v[max + k] = x
      if (x >= n && y >= m) {
        done = d
        break
      }
    }
  }

  if (done < 0) {
    // 编辑距离超出内存预算：整段旧行删除 + 新行新增。仍是合法 diff，只是不是最小编辑脚本。
    return [
      ...oldLines.map((text, index) => ({ type: 'del', line: offset + index + 1, text })),
      ...newLines.map((text, index) => ({ type: 'add', line: offset + index + 1, text }))
    ]
  }

  const ops = []
  let x = n
  let y = m
  for (let d = done; d >= 0; d -= 1) {
    const vd = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vd[max + k - 1] < vd[max + k + 1]) ? k + 1 : k - 1
    const prevX = vd[max + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ type: 'ctx', line: offset + y, text: newLines[y - 1] })
      x -= 1
      y -= 1
    }
    if (d === 0) break
    if (x === prevX) {
      ops.push({ type: 'add', line: offset + y, text: newLines[y - 1] })
      y -= 1
    } else {
      ops.push({ type: 'del', line: offset + x, text: oldLines[x - 1] })
      x -= 1
    }
  }
  ops.reverse()
  return ops
}

async function fileExists(target) {
  return stat(target).then((info) => info.isFile(), () => false)
}
