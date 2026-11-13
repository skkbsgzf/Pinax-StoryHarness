/**
 * 世界书板左栏的分组列表（工单 P3）。
 *
 * 口径（与工单文字一致，机器可测）：
 *   1) 分组键＝条目 `type`，映射成人话组名（character→人物、location→地点、item→物件…）；
 *      type 认不出来的保留原样当组名，缺 type 的归「其他」并永远排最后；
 *   2) 组序固定：人物、地点、物件、势力、编年、设定……表外的组按出现序补在后面；
 *   3) 组内顺序沿用列表工具给的顺序（分组是第一维，这里不再造第二套排序）；
 *   4) 搜索按 name／keys（列表工具叫 aliases）／summary 做不区分大小写的包含匹配——
 *      直接复用 entriesView.mjs 的 filterEntries，两个入口不会各写一套匹配规则；
 *   5) 「关系图谱 N 节点」不是分组，是列表顶上的一枚组头；N＝整份条目数
 *      （点开的是整书图谱，不跟着搜索框缩水）。
 *
 * 段数口径（工单 P3-1「segs.length 或正文按空行切分，取已有字段，不新算其它指标」）：
 *   - 条目自带 `segs` 数组 → segs.length；
 *   - `segs` 是非负数字 → 原样取整（上游若已算好，这里不重算）；
 *   - 否则用条目 `content` 按空行（\n\n 或 \r\n\r\n，允许行间空白）切段，只数非空段；
 *   - 两个字段都没有 → null（界面不摆「0 段」，把「不知道」伪装成「零段」是假读数）。
 *   注意：`chars` 只是字数，不能拿来估算段数——那是另一套指标，工单明确不做。
 */

import { filterEntries } from './entriesView.mjs'

/** type → 人话组名。键一律小写；中文键原样命中（有的项目直接写中文 type）。 */
export const ENTRY_TYPE_LABELS = Object.freeze({
  character: '人物',
  person: '人物',
  人物: '人物',
  location: '地点',
  place: '地点',
  地点: '地点',
  地理: '地点',
  item: '物件',
  object: '物件',
  prop: '物件',
  物件: '物件',
  物品: '物件',
  organization: '势力',
  faction: '势力',
  势力: '势力',
  event: '编年',
  编年: '编年',
  事件: '编年',
  setting: '设定',
  设定: '设定',
  rule: '规则',
  forbidden: '规则',
  规则: '规则',
  quest: '试炼',
  试炼: '试炼',
  creature: '生物',
  生物: '生物',
  lore: '世界观',
  世界观: '世界观',
  concept: '概念',
  概念: '概念',
  relationship: '人际关系',
  人际关系: '人际关系',
  style: '文风',
  文风: '文风',
  source: '资料',
  资料: '资料',
  general: '其他',
  其他: '其他'
})

/**
 * 组序：先按这张表，表外的组按首次出现序接在表内组之后。
 * 「其他」永远垫底——没有 type 的条目不插在正经分组中间，也不被未知 type 顶到前面。
 */
export const ENTRY_GROUP_ORDER = Object.freeze([
  '人物',
  '地点',
  '物件',
  '势力',
  '编年',
  '设定',
  '规则',
  '试炼',
  '生物',
  '世界观',
  '概念',
  '人际关系',
  '文风',
  '资料',
  '其他'
])

/** 条目 type → 人话组名；认不出来的保留原样，空值归「其他」。 */
export function entryTypeLabel(type) {
  const raw = String(type ?? '').trim()
  if (!raw) return '其他'
  const mapped = ENTRY_TYPE_LABELS[raw.toLowerCase()]
  return mapped ?? raw
}

/**
 * 按 type 分组。返回 [{ key, label, count, entries }]，组序见 ENTRY_GROUP_ORDER。
 * 同一人话组名下的多个原始 type（person／character／人物）合并成一组。
 * 入参不改：分组只读条目，组内数组是新数组、元素仍指向原条目。
 */
export function groupEntriesByType(entries) {
  const list = Array.isArray(entries) ? entries : []
  const buckets = new Map()
  let firstSeen = 0
  for (const entry of list) {
    const label = entryTypeLabel(entry?.type)
    let bucket = buckets.get(label)
    if (!bucket) {
      bucket = { key: label, label, count: 0, entries: [], firstSeen: firstSeen++ }
      buckets.set(label, bucket)
    }
    bucket.entries.push(entry)
    bucket.count += 1
  }
  const rankOf = (group) => {
    if (group.label === '其他') return Number.MAX_SAFE_INTEGER
    const fixed = ENTRY_GROUP_ORDER.indexOf(group.label)
    return fixed >= 0 ? fixed : ENTRY_GROUP_ORDER.length + group.firstSeen
  }
  return [...buckets.values()]
    .sort((left, right) => rankOf(left) - rankOf(right) || left.firstSeen - right.firstSeen)
    .map(({ firstSeen: _firstSeen, ...group }) => group)
}

/** 空行切段：\n\n／\r\n\r\n 都认，段首段尾空白不算内容。 */
const PARAGRAPH_BREAK = /\r?\n\s*\r?\n/u

/**
 * 段数：segs 数组 → segs.length；segs 数字 → 取整；否则正文按空行切；都没有 → null。
 * 口径写在上面的文件头注释里（工单要求），这里只实现。
 */
export function entrySegmentCount(entry) {
  const segs = entry?.segs
  if (Array.isArray(segs)) return segs.length
  if (typeof segs === 'number' && Number.isFinite(segs) && segs >= 0) return Math.trunc(segs)
  const content = entry?.content
  if (typeof content === 'string') {
    return content
      .split(PARAGRAPH_BREAK)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .length
  }
  return null
}

/** 行右读数：「16 段」；段数未知时给空串（界面据此不摆这一格）。 */
export function entrySegmentLabel(entry) {
  const count = entrySegmentCount(entry)
  return count === null ? '' : `${count} 段`
}

/**
 * 左栏一份完整读模型：搜索 → 分组 → 折叠标记。
 *   graph：{ label:'关系图谱', count: 整份条目数 }（节点数不跟搜索缩水，点开的是整书图谱）；
 *   groups：组头带 count 与 collapsed；
 *   matched／total：给空态用——total>0 且 matched=0 才是「没有匹配的条目」。
 * collapsed 是会话内的组名数组，只影响这次的 collapsed 标记，不落盘。
 */
export function groupedEntryList(entries, { text = '', collapsed = [] } = {}) {
  const all = Array.isArray(entries) ? entries : []
  const visible = filterEntries(all, { text })
  const collapsedKeys = new Set(Array.isArray(collapsed) ? collapsed : [])
  return {
    graph: { label: '关系图谱', count: all.length },
    groups: groupEntriesByType(visible).map((group) => ({
      ...group,
      collapsed: collapsedKeys.has(group.key)
    })),
    matched: visible.length,
    total: all.length
  }
}

export default {
  ENTRY_TYPE_LABELS,
  ENTRY_GROUP_ORDER,
  entryTypeLabel,
  groupEntriesByType,
  entrySegmentCount,
  entrySegmentLabel,
  groupedEntryList
}
