import { relativeTime } from './relativeTime.mjs'

/**
 * 库管理器筛选与卡片读数（工单 P1）：全部纯函数，组件只摆、不判。
 *
 * 筛选口径（P1-1，以工单文字为准）：
 *   novel → 小说；script → 剧本；comic → 漫剧；worldbook → 世界书；
 *   reference|dossier → 资料；其余／缺失 → 未分类。
 * 类别只从 recentProjects[].kind 读，不扫盘、不做类型手改。
 *
 * 卡片读数（P1-2）：
 *   count＝项目 正文/ 下章节文件数（novel）或主模块条目数，主进程打开时统计一次；
 *   计数单位为「篇」。旧记录没有 count 就只显示时间，不猜数。
 */

export const LIBRARY_FILTER_ALL = 'all'
export const LIBRARY_FILTER_UNCATEGORIZED = 'uncategorized'

/** 筛选条顺序（工单 P1-1 的字面顺序）；计数为 0 的类别由 buildLibraryFilterTabs 过滤掉。 */
export const LIBRARY_FILTERS = Object.freeze([
  { id: 'novel', label: '小说' },
  { id: 'script', label: '剧本' },
  { id: 'comic', label: '漫剧' },
  { id: 'worldbook', label: '世界书' },
  { id: 'reference', label: '资料' },
  { id: LIBRARY_FILTER_UNCATEGORIZED, label: '未分类' }
])

const KIND_TO_FILTER = Object.freeze({
  novel: 'novel',
  script: 'script',
  comic: 'comic',
  worldbook: 'worldbook',
  reference: 'reference',
  dossier: 'reference'
})

/** kind → 筛选 id；未知/缺失归「未分类」，空串也算缺失。 */
export function libraryFilterId(kind) {
  const key = typeof kind === 'string' ? kind.trim().toLowerCase() : ''
  return KIND_TO_FILTER[key] ?? LIBRARY_FILTER_UNCATEGORIZED
}

/** kind → 卡片类型胶囊文案；未分类不出胶囊（不编一个类型）。 */
export function libraryKindLabel(kind) {
  const id = libraryFilterId(kind)
  if (id === LIBRARY_FILTER_UNCATEGORIZED) return ''
  return LIBRARY_FILTERS.find((item) => item.id === id)?.label ?? ''
}

/**
 * 筛选 tab 清单：第一个永远是「全部」；其后只放有内容的类别（计数为 0 不渲染）。
 * 每次从最近清单现算，不缓存、不落盘。
 */
export function buildLibraryFilterTabs(entries = []) {
  const list = Array.isArray(entries) ? entries : []
  const counts = new Map(LIBRARY_FILTERS.map((item) => [item.id, 0]))
  for (const entry of list) {
    const id = libraryFilterId(entry?.kind)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const tabs = [{ id: LIBRARY_FILTER_ALL, label: '全部', count: list.length }]
  for (const item of LIBRARY_FILTERS) {
    const count = counts.get(item.id) ?? 0
    if (count > 0) tabs.push({ ...item, count })
  }
  return tabs
}

/** 按筛选 id 取卡片；「全部」/空值返回整份清单的浅拷贝（不改传入数组）。 */
export function filterLibraryEntries(entries = [], filterId = LIBRARY_FILTER_ALL) {
  const list = Array.isArray(entries) ? entries : []
  if (!filterId || filterId === LIBRARY_FILTER_ALL) return list.slice()
  return list.filter((entry) => libraryFilterId(entry?.kind) === filterId)
}

/** 卡片第三行：有 count 时「N 篇 · 时间编辑」，没有就只有时间（旧记录不显示错值）。 */
export function formatLibraryCardMeta(entry, now) {
  const count = entry?.count
  const hasCount = Number.isSafeInteger(count) && count >= 0
  const time = relativeTime(entry?.at, now ?? undefined)
  if (!hasCount) return time
  const countText = `${count} 篇`
  return time ? `${countText} · ${time}编辑` : countText
}
