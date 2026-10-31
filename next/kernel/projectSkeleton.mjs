import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fail, ok, NEXT_ERROR_CODES } from './errors.mjs'

/**
 * 固化中文项目骨架（R1 已裁：中文目录是物理真源）。
 * 真源对照：server/services/localMirrorService.js 的 KIND_TEMPLATES —— 两边的
 * 一致性由 next/tests/skeleton-contract.test.mjs 钉住，谁改了另一边的测试就红。
 * Next 不 import 服务端模块，避免内核被 Express 轨拖住（M1 桩 2c 的结论）。
 */
/**
 * 项目合同 @3（协议 v3 同期）：文档字段与 @2 相同，升的是「合同代际」——
 * 项目引用的载体清单已按 pinax-carrier@3 写（自带面板／服务／MCP／agentMd），
 * 老外壳读到 @3 必须显式升级而不是半懂着打开。@1／@2 读侧兼容，写回一律 @3。
 */
export const PROJECT_SPEC = 'pinax-project@3'
export const LEGACY_PROJECT_SPECS = Object.freeze(['pinax-project@1', 'pinax-project@2'])
export const METADATA_DIR = '.pinax'

export const PROJECT_KINDS = Object.freeze({
  novel: Object.freeze(['正文', '大纲', '世界书', '构思', '资料', '日志', '约束']),
  screenplay: Object.freeze(['剧本', '人物', '场景', '大纲', '世界书', '资料', '日志', '约束']),
  generic: Object.freeze(['文档', '资料', '日志', '约束'])
})

/** 骨架里没有插件认领、但已经存在的目录 → 归档视图（D5：只读展示，绝不删）。 */
export const ARCHIVE_FILE_EXTENSIONS = Object.freeze(['.md', '.txt', '.json'])

export function isKnownKind(kind) {
  return Object.prototype.hasOwnProperty.call(PROJECT_KINDS, String(kind || ''))
}

export function skeletonDirs(kind) {
  return PROJECT_KINDS[kind] ?? null
}

/** 全部骨架目录的并集，用于判定「这块地盘是框架的还是外来的」。 */
export function allSkeletonDirs() {
  const set = new Set()
  for (const dirs of Object.values(PROJECT_KINDS)) for (const dir of dirs) set.add(dir)
  return [...set]
}

/**
 * 相对路径合法性（C2）：不得越出项目根、不得含 `..`、不得绝对、不得碰 `.pinax/`。
 * 顶层首段必须是已注册插件拥有的目录，由调用方（fileService）拿注册表继续查。
 */
export function validateRelativePath(input) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) {
    return fail('INVALID_INPUT', '相对路径必须是非空字符串')
  }
  const normalized = input.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  const segments = normalized.split('/')
  if (!normalized
    || normalized.startsWith('/')
    || /^[a-zA-Z]:\//u.test(normalized)
    || segments.some((part) => !part || part === '.' || part === '..')) {
    return fail('PATH_OUTSIDE_PROJECT', `路径不合法或越出项目根：${input}`, { path: normalized })
  }
  if (segments[0] === METADATA_DIR || segments.includes(METADATA_DIR)) {
    return fail('PATH_OUTSIDE_PROJECT', `元数据目录 ${METADATA_DIR}/ 只归内核写，插件请走 dataDirs`, { path: normalized })
  }
  return ok(normalized)
}

/** dataDirs 的物理名规则：段内允许中文，但不得是路径符号或保留名。 */
export function validatePhysicalDir(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return fail('INVALID_MANIFEST', 'dataDirs 的物理目录名不能为空')
  }
  const dir = value.trim()
  if (dir.includes('\\') || dir.includes('/') || dir.includes(':') || dir === '.' || dir === '..' || dir === METADATA_DIR) {
    return fail('INVALID_MANIFEST', `dataDirs 物理目录必须是项目根下的一级目录名：${dir}`, { dir })
  }
  if (!/^[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9._ -]{0,30}$/u.test(dir)) {
    return fail('INVALID_MANIFEST', `dataDirs 物理目录名含非法字符：${dir}`, { dir })
  }
  return ok(dir)
}

/** 骨架落盘：只建缺失的目录，绝不删除、绝不覆盖已有文件。 */
export function ensureSkeleton(kind, root, fsImpl = { mkdirSync: (target) => mkdirRecursive(target) }) {
  const dirs = skeletonDirs(kind)
  if (!dirs) return fail('INVALID_INPUT', `未知项目类型：${kind}`)
  const created = []
  for (const dir of dirs) {
    const target = join(root, dir)
    try {
      fsImpl.mkdirSync(target)
      created.push(dir)
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        return fail('IO_FAILED', `创建骨架目录失败：${dir}`, { dir, cause: String(error?.message || error) })
      }
    }
  }
  return ok({ kind, dirs, created })
}

export { NEXT_ERROR_CODES }

function mkdirRecursive(target) {
  mkdirSync(target, { recursive: true })
}
