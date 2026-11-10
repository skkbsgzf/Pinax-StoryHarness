import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'

/**
 * 项目备份与恢复（工单G2 · R3 本地化后解锁的设置节）。
 *
 * 口径（调度方已定，照做）：零新依赖、不做 zip。
 *   - 备份＝把项目目录树递归复制到 `<targetParent>/<项目目录名>-backup-<YYYYMMDD-HHmmss>/`；
 *   - 恢复＝从该备份目录复制回一个**空目录**（防止覆盖现稿），复制时跳过备份根上的 backup-manifest.json；
 *   - `backup-manifest.json`（pinax-backup@1）是「这是一份 Pinax 备份」的唯一凭据，恢复先校验它。
 *
 * 为什么不用老桌面轨的 electron/projects/projectBackup.mjs：那份与 better-sqlite3 的
 * checkpoint 绑死（projectDatabase.mjs），Next 的项目是纯文件夹、没有 sqlite，复用会把数据库依赖拖进来。
 *
 * 三条如实写在这里的边界，不假装覆盖面比这更大：
 *   1) 默认不拷 `.pinax/history.git`（git 仓体积大、且历史节已覆盖时间线）；includeHistory=true 时才拷；
 *   2) 符号链接不跟随（读到的 dirent 既不是文件也不是目录就跳过），避免把项目外的内容卷进备份；
 *   3) 恢复只支持不存在或空的目录；已存在的目录里有任何条目就拒（防止把现稿盖掉）。
 *
 * 两个 typed code（BACKUP_INVALID / BACKUP_TARGET_NOT_EMPTY）按工单原文返回。
 * 内核码表 next/kernel/errors.mjs 不在本工单可改的文件里，且 fail() 会把它不认识的码折成
 * PINAX_INVALID_INPUT——所以这两个码由本模块直接构造，不经码表映射；IO 失败仍走内核的 PINAX_IO_FAILED。
 */
export const BACKUP_SCHEMA = 'pinax-backup@1'
export const BACKUP_MANIFEST_NAME = 'backup-manifest.json'
export const BACKUP_ERROR_CODES = Object.freeze({
  INVALID: 'BACKUP_INVALID',
  TARGET_NOT_EMPTY: 'BACKUP_TARGET_NOT_EMPTY'
})

const HISTORY_DIR = '.pinax/history.git'
const TMP_PREFIX = '.pinax-tmp-'

/** 备份服务自己的 typed failure（不经 fail() 的码表映射，见文件头注）。 */
function backupFail(code, message, details) {
  const error = { code, message }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, error }
}

/**
 * 导出备份：递归复制 `root` 到 `<targetParent>/<basename(root)>-backup-<YYYYMMDD-HHmmss>/`，
 * 在备份根写一份 backup-manifest.json，返回 { ok, path, fileCount, bytes }。
 * 备份位置落在项目目录里面时直接拒：递归复制会把备份自己再拷一遍（无限套娃），
 * 这不是「作者想要更大的备份」，是路径选错了。
 */
export async function exportProject({ root, targetParent, includeHistory = false, now = () => new Date() } = {}) {
  if (!String(root ?? '').trim() || !String(targetParent ?? '').trim()) {
    return backupFail(BACKUP_ERROR_CODES.INVALID, '导出备份需要项目根（root）与备份位置（targetParent）')
  }
  const sourceRoot = resolve(String(root))
  const parent = resolve(String(targetParent))
  const info = await stat(sourceRoot).catch(() => null)
  if (!info?.isDirectory()) {
    return backupFail(BACKUP_ERROR_CODES.INVALID, `要备份的项目目录不存在：${sourceRoot}`, { root: sourceRoot })
  }
  if (isInside(sourceRoot, parent)) {
    return backupFail(BACKUP_ERROR_CODES.INVALID, `备份位置不能在项目目录里面（${parent}）：递归复制会把备份自己再拷一遍，请在项目外选一个位置`, {
      root: sourceRoot,
      targetParent: parent
    })
  }

  const at = now()
  const baseName = `${basename(sourceRoot)}-backup-${formatStamp(at)}`
  let backupDir
  try {
    await mkdir(parent, { recursive: true })
    backupDir = await uniquePath(parent, baseName)
    const copied = await copyTree({ sourceDir: sourceRoot, targetDir: backupDir, excludeHistory: !includeHistory })
    const identity = await readProjectIdentity(sourceRoot)
    const manifest = {
      schema: BACKUP_SCHEMA,
      projectName: identity.projectName,
      projectId: identity.projectId,
      exportedAt: at.toISOString(),
      sourceRoot,
      includesHistory: Boolean(includeHistory),
      fileCount: copied.fileCount
    }
    await writeFile(join(backupDir, BACKUP_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
    return ok({ path: backupDir, fileCount: copied.fileCount, bytes: copied.bytes })
  } catch (error) {
    // 半成品备份不留：作者看到的是一个失败，而不是一个「看起来像备份」的残缺目录。
    if (backupDir) await rm(backupDir, { recursive: true, force: true }).catch(() => {})
    return fail('IO_FAILED', `备份失败：${String(error?.message || error)}`, { root: sourceRoot, targetParent: parent })
  }
}

/**
 * 恢复备份：先校验 backup-manifest.json（存在且 schema=pinax-backup@1），
 * 再要求 targetRoot 不存在或为空目录，然后把备份树复制回去（跳过备份根上的 manifest）。
 * 返回 { ok, root }；校验失败是 BACKUP_INVALID／BACKUP_TARGET_NOT_EMPTY，不写一个字节。
 */
export async function restoreProject({ backupDir, targetRoot } = {}) {
  if (!String(backupDir ?? '').trim() || !String(targetRoot ?? '').trim()) {
    return backupFail(BACKUP_ERROR_CODES.INVALID, '恢复需要备份目录（backupDir）与新的项目位置（targetRoot）')
  }
  const source = resolve(String(backupDir))
  const target = resolve(String(targetRoot))
  const checked = await readBackupManifest({ backupDir: source })
  if (!checked.ok) return checked
  const empty = await assertMissingOrEmpty(target)
  if (!empty.ok) return empty

  const existed = empty.value.existed
  try {
    await copyTree({ sourceDir: source, targetDir: target, excludeHistory: false, skipRootManifest: true })
  } catch (error) {
    // 目标本来不存在：清掉半成品（它是这次恢复造出来的）。目标本来就有（空目录）：不动它里面的东西，只报失败。
    if (!existed) await rm(target, { recursive: true, force: true }).catch(() => {})
    return fail('IO_FAILED', `恢复失败：${String(error?.message || error)}`, { backupDir: source, targetRoot: target })
  }
  return ok({ root: target })
}

/**
 * 读备份根上的 backup-manifest.json（恢复区的「预检」用它：选完备份目录先把摘要摊给作者）。
 * 只认 pinax-backup@1；缺文件／坏 JSON／schema 不符都是 BACKUP_INVALID。
 */
export async function readBackupManifest({ backupDir } = {}) {
  if (!String(backupDir ?? '').trim()) {
    return backupFail(BACKUP_ERROR_CODES.INVALID, '要读取的备份目录（backupDir）必填')
  }
  const dir = resolve(String(backupDir))
  let raw
  try {
    raw = await readFile(join(dir, BACKUP_MANIFEST_NAME), 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return backupFail(BACKUP_ERROR_CODES.INVALID, `不是一份 Pinax 备份：缺 ${BACKUP_MANIFEST_NAME}（${dir}）`, { backupDir: dir })
    }
    return fail('IO_FAILED', `读取备份清单失败：${String(error?.message || error)}`, { backupDir: dir })
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return backupFail(BACKUP_ERROR_CODES.INVALID, `${BACKUP_MANIFEST_NAME} 不是合法 JSON：${String(error?.message || error)}`, { backupDir: dir })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return backupFail(BACKUP_ERROR_CODES.INVALID, `${BACKUP_MANIFEST_NAME} 顶层必须是对象`, { backupDir: dir })
  }
  if (parsed.schema !== BACKUP_SCHEMA) {
    return backupFail(BACKUP_ERROR_CODES.INVALID, `备份清单 schema 不匹配：${String(parsed.schema)}（需要 ${BACKUP_SCHEMA}）`, {
      backupDir: dir,
      got: parsed.schema,
      wanted: BACKUP_SCHEMA
    })
  }
  return ok({ manifest: parsed })
}

/** 目标目录：不存在（existed:false）与存在但空（existed:true）都放行；有内容即拒。 */
async function assertMissingOrEmpty(target) {
  let info
  try {
    info = await stat(target)
  } catch (error) {
    if (error?.code === 'ENOENT') return ok({ existed: false })
    return fail('IO_FAILED', `无法读取目标位置：${target}`, { cause: String(error?.message || error) })
  }
  if (!info.isDirectory()) {
    return backupFail(BACKUP_ERROR_CODES.INVALID, `目标位置已存在且不是目录：${target}`, { targetRoot: target })
  }
  let entries
  try {
    entries = await readdir(target)
  } catch (error) {
    return fail('IO_FAILED', `无法读取目标目录：${target}`, { cause: String(error?.message || error) })
  }
  if (entries.length) {
    return backupFail(BACKUP_ERROR_CODES.TARGET_NOT_EMPTY, `目标目录非空：${target}。恢复只支持空目录（防止覆盖现稿），请另选一个位置`, {
      targetRoot: target,
      entries: entries.slice(0, 8)
    })
  }
  return ok({ existed: true })
}

/**
 * 递归复制目录树。返回 { fileCount, bytes }（只数文件；空目录照样建，骨架目录必须跟着回）。
 * excludeHistory：跳过 `.pinax/history.git`（默认备份不含历史仓）。
 * skipRootManifest：恢复时跳过备份根上的 backup-manifest.json（它是备份的凭据，不是项目文件）。
 */
async function copyTree({ sourceDir, targetDir, excludeHistory = false, skipRootManifest = false }) {
  let fileCount = 0
  let bytes = 0

  async function walk(from, to, relativePath) {
    await mkdir(to, { recursive: true })
    const entries = await readdir(from, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(TMP_PREFIX)) continue
      const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
      if (!relativePath && skipRootManifest && entry.name === BACKUP_MANIFEST_NAME) continue
      if (excludeHistory && (childPath === HISTORY_DIR || childPath.startsWith(`${HISTORY_DIR}/`))) continue
      const fromPath = join(from, entry.name)
      const toPath = join(to, entry.name)
      if (entry.isDirectory()) {
        await walk(fromPath, toPath, childPath)
        continue
      }
      // 符号链接／设备文件不跟随：备份不该把项目外的内容卷进来（也不该复制一个指向不存在的目标）。
      if (!entry.isFile()) continue
      await copyFile(fromPath, toPath)
      const copied = await stat(toPath)
      fileCount += 1
      bytes += copied.size
    }
  }

  await walk(sourceDir, targetDir, '')
  return { fileCount, bytes }
}

/** 同一秒内重复导出时不覆盖上一份：后缀 -2、-3…（baseName 仍是工单约定的形状）。 */
async function uniquePath(parent, baseName) {
  let candidate = join(parent, baseName)
  let suffix = 2
  while (await stat(candidate).then(() => true, () => false)) {
    candidate = join(parent, `${baseName}-${suffix}`)
    suffix += 1
  }
  return candidate
}

/** `.pinax/project.json` 的 name／projectId（读不动就退回目录名与 null：备份不该被一份坏元数据拦住）。 */
async function readProjectIdentity(root) {
  try {
    const parsed = JSON.parse(await readFile(join(root, '.pinax', 'project.json'), 'utf-8'))
    const name = typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null
    const projectId = typeof parsed?.projectId === 'string' && parsed.projectId.trim() ? parsed.projectId.trim() : null
    return { projectName: name ?? basename(root), projectId }
  } catch {
    return { projectName: basename(root), projectId: null }
  }
}

/** child 是否就是 parent 或落在 parent 里面（与备份的「别选项目内部」判据同一条）。 */
function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function two(value) {
  return String(value).padStart(2, '0')
}

/** YYYYMMDD-HHmmss（本地时刻，与作者看到的文件名一致）。 */
function formatStamp(date) {
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
}
