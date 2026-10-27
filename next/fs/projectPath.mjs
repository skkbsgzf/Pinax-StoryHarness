import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'
import { METADATA_DIR, validateRelativePath } from '../kernel/projectSkeleton.mjs'

/**
 * 项目内路径解析（C2）：字面 containment ＋ 软链逃逸检查。
 * 桌面轨的同类实现把允许的前缀写死成 manuscript|reference（shared/desktopProjectContract.js），
 * 与「中文目录为物理真源」冲突，所以 Next 自带一份，规则来源是注册表而不是常量表。
 */
export function normalizeRelative(input) {
  const validation = validateRelativePath(input)
  if (!validation.ok) return validation
  return ok(validation.value)
}

export function joinContained(root, relativePath) {
  const rootPath = resolve(String(root || ''))
  const normalized = normalizeRelative(relativePath)
  if (!normalized.ok) return normalized
  const target = resolve(rootPath, normalized.value)
  if (!isContained(rootPath, target)) {
    return fail('PATH_OUTSIDE_PROJECT', `路径越出项目根：${relativePath}`, { path: normalized.value })
  }
  return ok({ rootPath, target, relativePath: normalized.value })
}

/** 已存在的最近祖先做 realpath，防软链把写操作送出项目根。 */
export async function assertNoSymlinkEscape(rootPath, targetPath, deps = {}) {
  const readRealpath = deps.realpath || realpath
  const stat = deps.lstat || lstat
  let realRoot
  try {
    realRoot = await readRealpath(rootPath)
  } catch {
    return fail('IO_FAILED', `项目根不可用：${rootPath}`)
  }
  let current = targetPath
  for (let guard = 0; guard < 64; guard += 1) {
    try {
      await stat(current)
      break
    } catch (error) {
      if (error?.code !== 'ENOENT') return fail('IO_FAILED', `路径检查失败：${error?.code ?? error}`)
      const parent = resolve(current, '..')
      if (parent === current) return fail('IO_FAILED', '路径检查到达根节点')
      current = parent
    }
  }
  let realAncestor
  try {
    realAncestor = await readRealpath(current)
  } catch {
    realAncestor = current
  }
  if (!isContained(realRoot, realAncestor)) {
    return fail('PATH_OUTSIDE_PROJECT', '路径经软链越出项目根', { target: targetPath })
  }
  return ok({ realRoot, realAncestor })
}

export function metadataPath(root, inside) {
  return resolve(root, METADATA_DIR, inside)
}

/**
 * 项目根的规范化写法：Windows 下同一个根可以是 `D:\a\b`、`D:/a/b/`、`d:/a/b`，
 * 「是不是当前打开的那个项目」必须先归一再比，否则载体与闸会各判各的。
 */
export function normalizeProjectRoot(input) {
  return String(input ?? '').trim().replaceAll('\\', '/').replace(/\/+$/u, '')
}

/** 同一个项目根？归一后再比大小写（NTFS 大小写不敏感，区分大小写会把真路径误判成越界）。 */
export function isSameProjectRoot(a, b) {
  const left = normalizeProjectRoot(a)
  const right = normalizeProjectRoot(b)
  if (!left || !right) return false
  return left.toLowerCase() === right.toLowerCase()
}

function isContained(root, target) {
  const child = relative(root, target)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
}
