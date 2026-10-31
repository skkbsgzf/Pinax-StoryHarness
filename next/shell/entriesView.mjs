/**
 * 世界书条目的列表/表格/图谱视图记忆与图谱布局（批次28 · 工单3 → 批次36）。
 *
 * 状态三档：list（老版条目树）、table（Dataview 式条目表格）、graph（关系图谱）。
 * 按项目根分开存：键 `entriesView.<projectRoot>`，照 paneForms.<paneId> 的先例——
 * 键名由本模块拼，渲染层不另写键。只影响世界书那一栏；别的栏（小说／资料…）不读这个键。
 *
 * 读写一律 try/catch：隐私模式／配额失败不拦切换，这次会话里状态照样生效。
 *
 * 批次36 起，这里还住着图谱的两只纯函数（entryEdges／radialLayout）——
 * 布局计算不在组件里拼，纯函数才有单测（next/tests/entries-view.test.mjs），
 * EntryGraph.vue 只负责把坐标画出来。d3-hierarchy 是老前端
 * （src/components/geography/LocationTreeMap.vue）就在用的依赖，不算新增。
 */

import { hierarchy, tree } from 'd3-hierarchy'

export const ENTRIES_VIEW_STORAGE_PREFIX = 'entriesView.'

/** 三档视图；词表外的值一律按 list 处理（不认识的存储值不把界面顶成空白）。 */
export const ENTRIES_VIEWS = Object.freeze(['list', 'table', 'graph'])

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

/** 三态循环：list → table → graph → list。词表外的值按 list 起步（下一步是 table）。 */
export function nextEntriesView(view) {
  const index = ENTRIES_VIEWS.indexOf(view)
  return ENTRIES_VIEWS[(index + 1) % ENTRIES_VIEWS.length] ?? 'table'
}

/* —— 看板区（批次44）的纯函数 ———————————————————————————————————————
 * 批次44：世界书的图表列（列表／表格／图谱）从窄栏搬进核心区，成为一块看板区。
 * 分组、筛选、排序、类别树都是纯计算——放在这里，组件只负责画（node 轨可测）。 */

/** 表格列（批次36 定；批次44 随看板区搬到核心区，列本身不变）。 */
export const ENTRY_COLUMNS = Object.freeze([
  { key: 'name', label: '名称' },
  { key: 'cat', label: '类别' },
  { key: 'type', label: '类型' },
  { key: 'keys', label: '关键词' },
  { key: 'chars', label: '字数' },
  { key: 'summary', label: '摘要' }
])

const entryCollator = new Intl.Collator('zh-Hans-CN')

/** 条目的关键词（列表工具给的是 aliases，读工具给的是 keys——两处都认）。 */
export function entryKeysOf(entry) {
  return [...(Array.isArray(entry?.aliases) ? entry.aliases : []), ...(Array.isArray(entry?.keys) ? entry.keys : [])]
}

/**
 * 按类别分组（批次34）：声明序在前、声明外出现过的类别按出现序补后，
 * 没有类别的条目归「未分类」并永远排最后。
 * 没有类别目录的旧项目（categories 为空）不摆「未分类」这个组头——列表与原样一致。
 */
export function groupEntriesByCat(entries, categories) {
  const list = Array.isArray(entries) ? entries : []
  const declared = Array.isArray(categories) ? categories : []
  if (!declared.length) return list.length ? [{ name: '', label: '', items: list }] : []
  const order = [...declared]
  for (const entry of list) {
    const cat = String(entry?.cat ?? '')
    if (cat && !order.includes(cat)) order.push(cat)
  }
  const groups = []
  for (const cat of order) {
    const items = list.filter((entry) => String(entry?.cat ?? '') === cat)
    if (items.length) groups.push({ name: cat, label: cat, items })
  }
  const loose = list.filter((entry) => !String(entry?.cat ?? ''))
  if (loose.length) groups.push({ name: '', label: '未分类', items: loose })
  return groups
}

/**
 * 类别树（批次44 · 窄栏那份导航）：带条数，按声明序／出现序排。
 * 「全部」是第一项——它不是类别，是筛选的清空位。
 */
export function entryCategoryTree(entries, categories) {
  const list = Array.isArray(entries) ? entries : []
  const declared = Array.isArray(categories) ? categories : []
  const order = []
  for (const cat of declared) {
    if (cat && !order.includes(cat)) order.push(cat)
  }
  for (const entry of list) {
    const cat = String(entry?.cat ?? '')
    if (cat && !order.includes(cat)) order.push(cat)
  }
  const nodes = order.map((cat) => ({
    name: cat,
    label: cat,
    count: list.filter((entry) => String(entry?.cat ?? '') === cat).length
  }))
  const loose = list.filter((entry) => !String(entry?.cat ?? '')).length
  if (loose) nodes.push({ name: '', label: '未分类', count: loose })
  return [{ name: '__all', label: '全部', count: list.length }, ...nodes]
}

/** 筛选：类别精确匹配；文本对名称／关键词／摘要做不区分大小写的包含匹配。 */
export function filterEntries(entries, { text = '', cat = '' } = {}) {
  const list = Array.isArray(entries) ? entries : []
  const needle = String(text ?? '').trim().toLowerCase()
  const wantCat = String(cat ?? '')
  if (!needle && !wantCat) return list
  return list.filter((entry) => {
    if (wantCat && String(entry?.cat ?? '') !== wantCat) return false
    if (!needle) return true
    const haystack = [
      String(entry?.name ?? ''),
      entryKeysOf(entry).join('、'),
      String(entry?.summary ?? '')
    ].join('\n').toLowerCase()
    return haystack.includes(needle)
  })
}

function entrySortValue(entry, key) {
  if (key === 'chars') return Number(entry?.chars ?? 0) || 0
  if (key === 'keys') return entryKeysOf(entry).join('、')
  if (key === 'cat') return String(entry?.cat ?? '')
  if (key === 'type') return String(entry?.type ?? '')
  if (key === 'summary') return String(entry?.summary ?? '')
  return String(entry?.name ?? '')
}

/** 组内排序（组头顺序不动——分组是第一维，排序是组内第二维）。sort 为空＝按原序。 */
export function sortEntriesBy(items, sort) {
  const list = Array.isArray(items) ? items : []
  if (!sort?.key) return list
  const dir = sort.dir === 'desc' ? -1 : 1
  return [...list].sort((a, b) => {
    const left = entrySortValue(a, sort.key)
    const right = entrySortValue(b, sort.key)
    if (sort.key === 'chars') return (left - right) * dir
    return entryCollator.compare(String(left), String(right)) * dir
  })
}

/** 摘要列只占一格：截 40 字（截断只发生在显示上，磁盘与详情面仍是全文）。 */
export function clipEntrySummary(value, max = 40) {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/* —— 图谱的边与布局（批次36 · 任务二）—————————————————————————————— */

/**
 * 把条目的 relations[].to 解析成图谱的边。
 * 目标按条目名匹配（relations 的 to 存的就是名字，批次28 的编辑面同一口径）；
 * 匹配不到的边如实计数（unmatched），不画幽灵节点——图谱是只读总览，宁缺毋假。
 * 自环（to 指向自己）画出来是一条零长度线，没有信息量：跳过，也不算「未落图」。
 * 无向去重：a→b 与 b→a 只画一条。
 */
export function entryEdges(entries) {
  const list = Array.isArray(entries) ? entries : []
  const names = new Set(list.map((entry) => String(entry?.name ?? '')).filter(Boolean))
  const seen = new Set()
  const edges = []
  let unmatched = 0
  for (const entry of list) {
    const source = String(entry?.name ?? '')
    const relations = Array.isArray(entry?.relations) ? entry.relations : []
    for (const relation of relations) {
      const target = String(relation?.to ?? '').trim()
      if (!source || !target || source === target) continue
      if (!names.has(target)) {
        unmatched += 1
        continue
      }
      const key = [source, target].sort().join('\u0000')
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ source, target })
    }
  }
  return { edges, unmatched }
}

/** 类别着色的六档色：全部取自老前端 token（明暗两套主题各自成立），孤立的「未分类」走 muted。 */
export const ENTRY_CAT_PALETTE = Object.freeze([
  'var(--accent)',
  'var(--accent-teal)',
  'var(--accent-amber)',
  'var(--accent-purple)',
  'var(--accent-rose)',
  'var(--accent-emerald)'
])
export const ENTRY_UNCAT_COLOR = 'var(--text-muted)'

/**
 * radialLayout(nodes, edges, options) → { points, lines, root, outer }
 *   nodes：[{ name, cat }]；edges：[{ source, target }]（entryEdges 的产物）。
 *   points：每个条目一个 { name, cat, x, y, isolate }——x/y 是以圆心为原点的画布坐标；
 *   isolate＝没连进主连通分量的点（真孤点＋其他分量），沿外圈排布；
 *   lines：每条边一个 { source, target, x1, y1, x2, y2 }；root＝被引用最多的条目名。
 *
 * 布局用 d3-hierarchy 的 tree() 径向档（size([360, radius])：x 是角度、y 是半径深度），
 * 生成树由根出发 BFS 得到——环（a→b→c→a）在 visited 这一层自然断掉，不崩也不重复画。
 * d3 抛错时整份退化为「根在圆心、其余沿外圈」，图谱仍可读。
 */
export function radialLayout(nodes, edges, { radius = 100, outerGap = 56 } = {}) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((node) => node && String(node?.name ?? '').trim())
  const points = new Map(list.map((node) => [String(node.name), {
    name: String(node.name),
    cat: String(node.cat ?? ''),
    x: 0,
    y: 0,
    isolate: false
  }]))
  const result = { points: [], lines: [], root: null, outer: [] }
  if (!list.length) return result

  const links = (Array.isArray(edges) ? edges : [])
    .map((link) => ({ source: String(link?.source ?? ''), target: String(link?.target ?? '') }))
    .filter((link) => link.source !== link.target && points.has(link.source) && points.has(link.target))

  // 度数：入度（被引用数）选根，并列时比总度数，再并列按清单序——孤点在首位也不至于把主分量挤到外圈。
  const inDegree = new Map(list.map((node) => [String(node.name), 0]))
  const degree = new Map(list.map((node) => [String(node.name), 0]))
  const adjacency = new Map(list.map((node) => [String(node.name), []]))
  for (const link of links) {
    inDegree.set(link.target, (inDegree.get(link.target) ?? 0) + 1)
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1)
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1)
    adjacency.get(link.source).push(link.target)
    adjacency.get(link.target).push(link.source)
  }
  let rootName = String(list[0].name)
  for (const node of list) {
    const name = String(node.name)
    const better = (inDegree.get(name) ?? 0) > (inDegree.get(rootName) ?? 0)
      || ((inDegree.get(name) ?? 0) === (inDegree.get(rootName) ?? 0)
        && (degree.get(name) ?? 0) > (degree.get(rootName) ?? 0))
    if (better) rootName = name
  }
  result.root = rootName

  // BFS 生成树（parent 表）：环在这里断掉——已入队的节点不再展开。
  const parentOf = new Map([[rootName, null]])
  const queue = [rootName]
  while (queue.length) {
    const current = queue.shift()
    for (const next of adjacency.get(current) ?? []) {
      if (parentOf.has(next)) continue
      parentOf.set(next, current)
      queue.push(next)
    }
  }
  const childrenOf = new Map()
  for (const [name, parent] of parentOf) {
    if (parent === null) continue
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent).push(name)
  }

  let placed = false
  try {
    const buildNode = (name) => ({ name, children: (childrenOf.get(name) ?? []).map(buildNode) })
    const root = hierarchy(buildNode(rootName), (node) => node.children)
    tree().size([360, radius])(root)
    for (const node of root.descendants()) {
      const point = points.get(node.data.name)
      if (!point) continue
      const angle = ((node.x - 90) * Math.PI) / 180
      point.x = Math.cos(angle) * node.y
      point.y = Math.sin(angle) * node.y
    }
    placed = true
  } catch {
    placed = false
  }

  // 没连进生成树的点（含布局失败时的全部非根点）沿外圈均分角度排布。
  const outerNames = list
    .map((node) => String(node.name))
    .filter((name) => name !== rootName && (!placed || !parentOf.has(name)))
  const outerCount = Math.max(outerNames.length, 1)
  outerNames.forEach((name, index) => {
    const point = points.get(name)
    const angle = ((360 / outerCount) * index - 90) * (Math.PI / 180)
    point.x = Math.cos(angle) * (radius + outerGap)
    point.y = Math.sin(angle) * (radius + outerGap)
    point.isolate = true
  })

  for (const link of links) {
    const a = points.get(link.source)
    const b = points.get(link.target)
    if (!a || !b || a === b) continue
    result.lines.push({ source: a.name, target: b.name, x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  result.points = [...points.values()]
  result.outer = outerNames
  return result
}

export default {
  readEntriesView,
  writeEntriesView,
  nextEntriesView,
  entriesViewStorageKey,
  entryEdges,
  radialLayout,
  ENTRY_COLUMNS,
  entryKeysOf,
  groupEntriesByCat,
  entryCategoryTree,
  filterEntries,
  sortEntriesBy,
  clipEntrySummary
}
