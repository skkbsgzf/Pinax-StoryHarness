/**
 * 会话迁移（M2.5-B · 任务三）：把老 localStorage 里那份 `agentSessions.<projectRoot>`
 * 交给主进程写进 `.pinax/sessions/<id>.jsonl`，成功后才删老键。
 *
 * 为什么删键这一步放在渲染层：localStorage 只有渲染进程碰得到；
 * 主进程只管「写盘成不成」，成不成由这边根据回执决定——写盘失败就保留老键并如实报，
 * 不静默丢作者的历史对话（工单 §3 的硬要求）。
 *
 * 纯数据模块，不 import Vue、不 import fs：node:test 用假 storage + 假 importVia 就能测。
 */
/**
 * 取浏览器存储：属性访问本身也可能抛（沙箱 iframe 的 SecurityError）。
 * 这是 next/shell 里唯一允许碰 localStorage 的地方，而且只读老键、迁移成功后删它；
 * 新会话一律走主进程的 `.pinax/sessions/`——localStorage 不再是任何数据的真相源。
 */
export function legacyLocalStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export async function migrateLegacySessions({ storage, key, importVia, parse = JSON.parse } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof key !== 'string' || !key) {
    return { ok: false, migrated: 0, removed: false, kept: false, reason: 'NO_STORAGE' }
  }
  let raw = null
  try {
    raw = storage.getItem(key)
  } catch {
    return { ok: false, migrated: 0, removed: false, kept: true, reason: 'STORAGE_UNREADABLE' }
  }
  if (typeof raw !== 'string' || !raw) {
    return { ok: true, migrated: 0, removed: false, kept: false, reason: 'EMPTY' }
  }
  let legacy = null
  try {
    legacy = parse(raw)
  } catch {
    // 老键坏了：不删——里面也许还有作者能救的东西，删了就真没了。
    return { ok: false, migrated: 0, removed: false, kept: true, reason: 'BAD_LEGACY_JSON' }
  }
  if (!legacy || typeof legacy !== 'object' || !Array.isArray(legacy.sessions)) {
    return { ok: false, migrated: 0, removed: false, kept: true, reason: 'BAD_LEGACY_SHAPE' }
  }
  if (typeof importVia !== 'function') {
    return { ok: false, migrated: 0, removed: false, kept: true, reason: 'NO_IMPORT_CHANNEL' }
  }

  let result = null
  try {
    result = await importVia(legacy)
  } catch (error) {
    return { ok: false, migrated: 0, removed: false, kept: true, reason: 'IMPORT_FAILED', message: String(error?.message || error) }
  }
  if (!result?.ok) {
    return {
      ok: false,
      migrated: 0,
      removed: false,
      kept: true,
      reason: 'IMPORT_REJECTED',
      message: String(result?.error?.message ?? '')
    }
  }

  // 写盘成了才删：删失败也不算迁移失败（磁盘上已经有了），但要如实说键还在。
  let removed = false
  try {
    storage.removeItem(key)
    removed = true
  } catch {
    removed = false
  }
  return {
    ok: true,
    migrated: Number(result.value?.imported) || 0,
    skipped: Number(result.value?.skipped) || 0,
    removed,
    kept: !removed,
    warnings: Array.isArray(result.value?.warnings) ? result.value.warnings : []
  }
}
