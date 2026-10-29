/**
 * 世界书条目的列表/表格视图记忆（批次28 · 工单3）。
 *
 * 状态只有两档：list（老版条目树）与 table（条目表格）。按项目根分开存：
 * 键 `entriesView.<projectRoot>`，照 paneForms.<paneId> 的先例——键名由本模块拼，渲染层不另写键。
 * 只影响世界书那一栏；别的栏（小说／资料…）不读这个键，也就不会跟着变。
 *
 * 读写一律 try/catch：隐私模式／配额失败不拦切换，这次会话里状态照样生效。
 * 纯数据模块，不 import Vue——IndexWindow 只把它接进一个 ref。
 */

export const ENTRIES_VIEW_STORAGE_PREFIX = 'entriesView.'

/** 两档视图；词表外的值一律按 list 处理（不认识的存储值不把界面顶成空白）。 */
export const ENTRIES_VIEWS = Object.freeze(['list', 'table'])

export function isEntriesView(value) {
  return ENTRIES_VIEWS.includes(value)
}

export function entriesViewStorageKey(projectRoot) {
  return `${ENTRIES_VIEW_STORAGE_PREFIX}${String(projectRoot ?? '')}`
}

/** 取浏览器存储：属性访问本身也可能抛（沙箱 iframe 的 SecurityError），拿不到就按「不持久化」跑。 */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readEntriesView(projectRoot, storage = defaultStorage()) {
  try {
    const raw = storage?.getItem?.(entriesViewStorageKey(projectRoot))
    return isEntriesView(raw) ? raw : 'list'
  } catch {
    return 'list'
  }
}

export function writeEntriesView(projectRoot, view, storage = defaultStorage()) {
  if (!isEntriesView(view)) return false
  try {
    storage?.setItem?.(entriesViewStorageKey(projectRoot), view)
    return true
  } catch {
    return false
  }
}

/** 切换：list ↔ table（词表只有两档，所以就是一个非此即彼的翻转）。 */
export function nextEntriesView(view) {
  return view === 'table' ? 'list' : 'table'
}

export default { readEntriesView, writeEntriesView, nextEntriesView, entriesViewStorageKey }
