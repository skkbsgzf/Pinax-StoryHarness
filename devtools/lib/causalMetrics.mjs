/**
 * 因果图三指标（设计稿 narrative-architecture-v2 §2.3 C1：闭环率 / 耦合度 / 断点敏感度）。
 *
 * 为什么单独成模块：同一组读数要同时喂三处——wiki 概览卡（作者看「故事够不够紧」）、
 * 推演器（改哪条边最有效）、市场分析（高数据作品的耦合度是否更高）。
 * 三处口径必须完全一致，所以只在这里算一次，调用点不许各自再实现一遍。
 *
 * 图结构（wiki.causalGraph）：
 *   nodes:   [{ id, chapter, event, kind }]
 *   edges:   [{ from, to, type, strength, evidence }]   // from/to 为节点 id
 *   threads: [{ id, name, nodes: [id], closed: boolean }]
 * 也接受 fromChapter/toChapter 直写章号的边——早期手写数据没有节点表。
 *
 * 三个口径为什么这么定：
 *   · 可达性按「章」不按「节点」：断点读数是给作者看的（「改第 3 章这一步」），
 *     章是作者能直接定位的粒度，节点 id 只是采集合成的中间物。
 *   · 章级图必须是「多重图」：同章两个事件各连下一章两个事件，就会落下两条同向的章级边。
 *     断一条不等于断连接，所以用计数而不是布尔，否则「删掉一条平行边」会被误报成命门。
 *   · 「最后 20% 章节」按章序排名取 top-k（至少 1 章），不按章号数值切：
 *     真章书可能缺章（1,2,5,9），按排名取尾才不会因为断号把尾部切歪。
 */

const TAIL_RATIO = 0.2
const TOP_EDGE_LIMIT = 5

/** 边端点 → 章号：数字即章号；字符串先查节点表，查不到再当纯数字章号。 */
function resolveChapter(value, chapterOf) {
  if (Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  if (chapterOf.has(value)) {
    const chapter = chapterOf.get(value)
    return Number.isFinite(chapter) ? chapter : null
  }
  const asNumber = Number(value)
  return value.trim() !== '' && Number.isFinite(asNumber) ? asNumber : null
}

/**
 * 顶点键：边端点能对上节点表就用节点 id，否则退化成章号键。
 * 环检测必须在事件粒度做——章级投影会把「第2章→第1章」的回跳当成环，
 * 哪怕事件之间其实没有回路，UI 会被假的 hasCycles 吓到。
 */
function vertexKey(value, chapter, chapterOf) {
  if (typeof value === 'string' && chapterOf.has(value)) return value
  if (Number.isFinite(chapter)) return `ch:${chapter}`
  return null
}

/**
 * 把 causalGraph 统一投影成「章级多重图」。
 * 先归一化再算，是因为三条指标必须共用同一套端点解析规则；
 * 谁在哪一步漏掉一种端点写法，三个读数就会互相矛盾。
 *
 * @returns {{nodes:object[], edges:{fromChapter:number|null,toChapter:number|null,fromKey:string|null,toKey:string|null,edge:object}[], threads:object[], chapters:number[]}}
 */
function normalizeGraph(causalGraph) {
  const source = causalGraph ?? {}
  const nodes = (Array.isArray(source.nodes) ? source.nodes : []).filter((node) => node && typeof node === 'object')
  const rawEdges = (Array.isArray(source.edges) ? source.edges : []).filter((edge) => edge && typeof edge === 'object')
  const threads = (Array.isArray(source.threads) ? source.threads : []).filter((thread) => thread && typeof thread === 'object')

  const chapterOf = new Map()
  const chapters = new Set()
  for (const node of nodes) {
    if (node.id != null) chapterOf.set(String(node.id), Number.isFinite(node.chapter) ? node.chapter : null)
    if (Number.isFinite(node.chapter)) chapters.add(node.chapter)
  }

  const edges = rawEdges.map((edge) => {
    // 两种写法都要收：node id 优先走节点表，直写章号的直接落数
    const fromChapter = resolveChapter(edge.fromChapter, chapterOf) ?? resolveChapter(edge.from, chapterOf)
    const toChapter = resolveChapter(edge.toChapter, chapterOf) ?? resolveChapter(edge.to, chapterOf)
    if (Number.isFinite(fromChapter)) chapters.add(fromChapter)
    if (Number.isFinite(toChapter)) chapters.add(toChapter)
    return {
      fromChapter,
      toChapter,
      fromKey: vertexKey(edge.from, fromChapter, chapterOf),
      toKey: vertexKey(edge.to, toChapter, chapterOf),
      edge
    }
  })

  return { nodes, edges, threads, chapters: [...chapters].sort((a, b) => a - b) }
}

/** 尾部章节集合：按章序排名取最后 20%（至少 1 章，否则短篇会算出空尾）。 */
function tailChapters(chapters) {
  if (!chapters.length) return new Set()
  const count = Math.max(1, Math.ceil(chapters.length * TAIL_RATIO))
  return new Set(chapters.slice(chapters.length - count))
}

/** 章级邻接表：from → (to → 平行边条数)。条数是断点敏感度的关键，不能压成布尔。 */
function buildAdjacency(edges) {
  const adjacency = new Map()
  for (const edge of edges) {
    if (!Number.isFinite(edge.fromChapter) || !Number.isFinite(edge.toChapter)) continue
    if (!adjacency.has(edge.fromChapter)) adjacency.set(edge.fromChapter, new Map())
    const targets = adjacency.get(edge.fromChapter)
    targets.set(edge.toChapter, (targets.get(edge.toChapter) ?? 0) + 1)
  }
  return adjacency
}

function cloneAdjacency(adjacency) {
  const copy = new Map()
  for (const [from, targets] of adjacency) copy.set(from, new Map(targets))
  return copy
}

/** 从邻接表里摘掉一条边实例；还有平行边就只减计数，连接依然成立。 */
function removeEdgeInstance(adjacency, edge) {
  const targets = adjacency.get(edge.fromChapter)
  if (!targets) return
  const left = (targets.get(edge.toChapter) ?? 0) - 1
  if (left > 0) targets.set(edge.toChapter, left)
  else targets.delete(edge.toChapter)
}

/** BFS 可达章数（含起点自身——起点恒可达，所以前后相减时它自动抵消）。 */
function reachableCount(adjacency, start) {
  const seen = new Set([start])
  const queue = [start]
  for (let head = 0; head < queue.length; head += 1) {
    const targets = adjacency.get(queue[head])
    if (!targets) continue
    for (const [next, count] of targets) {
      if (count <= 0 || seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen.size
}

/**
 * 有向环检测（三色 DFS）。
 * 为什么关心环：故事里出现「A 导致 B 又倒回来导致 A」多半是采集错误或时序错位，
 * 有环时断点敏感度的读数也不可信，UI 需要能提示这一点。
 */
function detectCycle(normalized) {
  const adjacency = new Map()
  const vertices = new Set()
  for (const edge of normalized.edges) {
    if (!edge.fromKey || !edge.toKey) continue
    vertices.add(edge.fromKey)
    vertices.add(edge.toKey)
    if (!adjacency.has(edge.fromKey)) adjacency.set(edge.fromKey, [])
    adjacency.get(edge.fromKey).push(edge.toKey)
  }
  const state = new Map()
  const visit = (vertex) => {
    state.set(vertex, 1)
    for (const next of adjacency.get(vertex) ?? []) {
      const mark = state.get(next) ?? 0
      if (mark === 1) return true
      if (mark === 0 && visit(next)) return true
    }
    state.set(vertex, 2)
    return false
  }
  for (const vertex of vertices) {
    if ((state.get(vertex) ?? 0) === 0 && visit(vertex)) return true
  }
  return false
}

function couplingOf(normalized) {
  const { edges, chapters } = normalized
  if (!edges.length) return null
  const tail = tailChapters(chapters)
  // 端点解析不出来的边照样计入分母：它是真实存在的边，只是归不到章节——
  // 悄悄丢掉会让耦合度在脏数据上虚高，反而掩盖采集问题。
  const converging = edges.filter((edge) => Number.isFinite(edge.toChapter) && tail.has(edge.toChapter)).length
  return converging / edges.length
}

function breaksOf(normalized) {
  const { edges, chapters } = normalized
  if (!chapters.length || !edges.length) return { topEdges: [], maxImpact: 0 }
  const start = chapters[0]
  const baseAdjacency = buildAdjacency(edges)
  const baseline = reachableCount(baseAdjacency, start)

  const impacts = edges.map((edge) => {
    if (!Number.isFinite(edge.fromChapter) || !Number.isFinite(edge.toChapter)) return { ...edge, impact: 0 }
    const cut = cloneAdjacency(baseAdjacency)
    removeEdgeInstance(cut, edge)
    return { ...edge, impact: baseline - reachableCount(cut, start) }
  })
  const maxImpact = impacts.reduce((max, item) => Math.max(max, item.impact), 0)

  const seen = new Set()
  const topEdges = impacts
    .sort((a, b) => b.impact - a.impact || a.fromChapter - b.fromChapter || b.toChapter - a.toChapter)
    // 平行边断哪条影响都一样，输出里也分不出来，只留一行；
    // 不去按 impact>0 过滤——榜单要的是「最大的 5 条」，impact=0 是有效信息（这条边不承重）。
    .filter((item) => {
      const key = `${item.fromChapter}->${item.toChapter}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, TOP_EDGE_LIMIT)
    .map((item) => ({
      fromChapter: item.fromChapter,
      toChapter: item.toChapter,
      impact: item.impact,
      // 边的语义字段要一起带出：UI 的因果边表要显示类型与证据，
      // 只给章号的话榜单只剩「1→2 影响1」，读不出这条边是什么关系。
      type: item.edge?.type ?? '',
      strength: item.edge?.strength ?? null,
      evidence: item.edge?.evidence ?? '',
      // 分母用总章数而非「总章数-1」：与设计稿「受影响节点数 / 总节点」一致，
      // 代价是起点自身永不受影响，所以理论上限是 (n-1)/n 而不是 1。
      impactRatio: chapters.length ? item.impact / chapters.length : 0
    }))

  return { topEdges, maxImpact }
}

/**
 * 闭环率 = closed=true 的线索占比。
 * 作者最痛的点是「埋了不收」，所以这里只认严格的 true，字段缺失按未闭环处理。
 *
 * @param {object} causalGraph wiki.causalGraph
 * @returns {number|null} 0-1；没有 threads 时返回 null（无数据 ≠ 0 分）
 */
export function closedThreadRate(causalGraph) {
  const threads = causalGraph?.threads
  if (!Array.isArray(threads) || !threads.length) return null
  return threads.filter((thread) => thread?.closed === true).length / threads.length
}

/**
 * 耦合度 = 汇入最后 20% 章节的因果边数 / 总边数。越高越「所有线收束到结局」（欧亨利式）。
 *
 * @param {object} causalGraph wiki.causalGraph
 * @returns {number|null} 0-1；没有边时返回 null
 */
export function couplingScore(causalGraph) {
  return couplingOf(normalizeGraph(causalGraph))
}

/**
 * 断点敏感度：逐条断开，看有多少章从最小章号出发变得不可达。
 * 这是推演器「改哪一步最有效」的依据，也是作者定位结构命门的入口。
 *
 * @param {object} causalGraph wiki.causalGraph
 * @returns {{topEdges: {fromChapter:number,toChapter:number,impact:number,impactRatio:number}[], maxImpact:number}}
 */
export function breakSensitivity(causalGraph) {
  return breaksOf(normalizeGraph(causalGraph))
}

/**
 * 汇总读数，供 UI 直接显示（字段与设计稿 C1 对齐，调用方不要再二次改名）。
 *
 * @param {object} causalGraph wiki.causalGraph
 * @returns {{nodeCount:number,edgeCount:number,threadCount:number,closedRate:number|null,coupling:number|null,maxImpact:number,hasCycles:boolean}}
 */
export function causalSummary(causalGraph) {
  const normalized = normalizeGraph(causalGraph)
  return {
    nodeCount: normalized.nodes.length,
    edgeCount: normalized.edges.length,
    threadCount: normalized.threads.length,
    closedRate: closedThreadRate(causalGraph),
    coupling: couplingOf(normalized),
    maxImpact: breaksOf(normalized).maxImpact,
    hasCycles: detectCycle(normalized)
  }
}
