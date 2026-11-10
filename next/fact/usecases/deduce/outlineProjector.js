/**
 * 会话 → 章纲投影器（ADR M2）：M1-b replay 后的事件流 → 大纲原生形状 { nodes, edges }。
 *
 * 与 P2b migrateLegacy 的 migrateOutline 输入对称：迁移器进什么形状，投影器就出什么形状——
 * node 用 id/title/intent/summary/definition，edge 用 kind/fromNodeId/toNodeId/note。
 * 投影结果可直接喂回 migrateOutline 还原 fact plot 事件图（foresee 见测试）。
 *
 * 纯函数、零宿主依赖：本模块不 import 任何东西（domain / usecases / Node 内建 / 工具面都不碰），
 * 不读写盘、不发模型调用、不改传入的事件流；同一事件流 → 深度相等的同一投影。
 *
 * 事件流口径（replay 后 listEvents().events，按 seq 单调递增；也接受 { events } 包装）：
 *   - { type:'settle', seq, text|definition, source?, decidedBy?, round? }        → 一拍一节点
 *   - { type:'director-inject'|'inject', seq, name, definition?, round? }           → 一拍一节点（decidedBy:'author'）
 *   - { type:'candidates', seq, candidates:[{ text, source, adopted, ... }], round? }
 *       其中 adopted:false（且 source≠命运）→ alternative 边留档（未选分支也是资产）
 *   - { type:'hypothesis'|'open', seq, text|definition, open?:true, round? }        → foreshadows 边（setup）
 *   其余事件（opening / round-begin / knowledge-delta / checkpoint / session-end / ...）不投影。
 *
 * 四类边 / 标记语义：
 *   - 相邻拍           → causes 导致边（推演因果链主干，n-1 条）
 *   - open 假设轨       → foreshadows 伏笔边（toNodeId 留空＝payoff 未定，待后续拍/其他 POV 回收）
 *   - 未选候选         → alternative 边（toNodeId 留空＝分支未提交，仅留档）
 *   - 导演注入事件     → node 带 decidedBy:'author'
 */
export const PROJECTOR_VERSION = 'outline-projector@1'

export const OUTLINE_EDGE_KINDS = Object.freeze({
  CAUSES: 'causes',
  FORESHADOWS: 'foreshadows',
  ALTERNATIVE: 'alternative'
})

const BEAT_TYPES = new Set(['settle', 'beat', 'director-inject', 'inject'])
const OPEN_TYPES = new Set(['hypothesis', 'open'])

function isObj(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function trunc(value, n) {
  const s = str(value)
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

function seqOf(event) {
  return Number.isSafeInteger(event.seq) && event.seq >= 1 ? event.seq : 0
}

function asEventList(input) {
  if (Array.isArray(input)) return input.filter(isObj)
  if (isObj(input) && Array.isArray(input.events)) return input.events.filter(isObj)
  return []
}

/** 按 seq 排序（seq 即序）；同 seq 用原始下标稳定兜底，不改输入数组。 */
function orderedEvents(list) {
  return list
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (seqOf(a.event) - seqOf(b.event)) || (a.index - b.index))
    .map((row) => row.event)
}

function authorMarked(event) {
  return event.type === 'director-inject' || event.type === 'inject'
    || event.source === '导演注入' || event.decidedBy === 'author'
}

function beatDefinition(event) {
  return firstText(
    event.definition, event.text, event.fact,
    authorMarked(event) ? `${firstText(event.name)}——导演注入` : ''
  )
}

function isBeat(event) {
  return BEAT_TYPES.has(event.type)
}

function isOpen(event) {
  if (isBeat(event)) return false
  return OPEN_TYPES.has(event.type) || event.open === true || event.hypothesis === true
}

function isCandidates(event) {
  return event.type === 'candidates'
}

/** 未选候选：adopted:false 的戏剧/必然项；命运骰是确定性结算，不是分支资产。 */
function unadoptedOf(event) {
  const list = Array.isArray(event.candidates)
    ? event.candidates
    : (Array.isArray(event.unadopted) ? event.unadopted : [])
  return list.filter(isObj).filter((c) => c.adopted === false && firstText(c.source) !== '命运')
}

/**
 * 一拍一节点：order 是紧凑拍序（1..N，大纲里「第几拍」），seq 是该拍在 M1-b 事件流里的
 * 权威序号（事件溯源 lineage，排序依据＝「seq 即序」）。两者都保留，不互相顶替。
 *
 * P-WIRE：事件带 pov/goal 时一并落进节点——M3 chapterize 靠「视角∷目标」分章；
 * 缺了这两个标记，多视角重演的所有拍会退回按 domain 分组，分不出章。
 */
function buildBeatNode(event, order, seq, domain) {
  const definition = beatDefinition(event)
  const label = firstText(event.title, event.name, trunc(definition, 18)) || '未命名拍'
  const node = {
    id: `beat-${order}`,
    title: `第${order}拍·${label}`,
    definition,
    intent: definition,
    summary: definition,
    status: 'adopted',
    seq,
    order,
    domain
  }
  const source = firstText(event.source)
  if (source) node.source = source
  const pov = firstText(event.pov)
  if (pov) node.pov = pov
  const goal = firstText(event.goal)
  if (goal) node.goal = goal
  if (authorMarked(event)) node.decidedBy = 'author'
  return node
}

/** 把 candidates/open 事件挂到对应拍节点：优先按 round 对齐，再按事件流 seq 前后找。 */
function resolveOwner(event, beats, mode) {
  if (!beats.length) return null
  const round = Number.isSafeInteger(event.round) ? event.round : null
  if (round !== null) {
    const same = beats.find((b) => b.round === round)
    if (same) return same.entry
  }
  if (mode === 'next') {
    const after = beats.find((b) => b.seq > seqOf(event))
    if (after) return after.entry
  }
  const before = beats.filter((b) => b.seq <= seqOf(event))
  return (before.length ? before[before.length - 1] : beats[0]).entry
}

/**
 * replay 后的事件流 → 大纲原生形状 { nodes, edges }。
 * @param {Object[]|{events:Object[]}} sessionEvents
 * @param {{domain?:string}} [options]
 */
export function projectOutline(sessionEvents, options = {}) {
  const domain = str(isObj(options) ? options.domain : '')
  const events = orderedEvents(asEventList(sessionEvents))

  const beats = []
  const candidateEvents = []
  const openEvents = []
  for (const event of events) {
    if (isBeat(event)) {
      const order = beats.length + 1
      const seq = seqOf(event)
      beats.push({
        entry: buildBeatNode(event, order, seq, domain),
        order,
        seq,
        round: Number.isSafeInteger(event.round) ? event.round : null
      })
    } else if (isCandidates(event)) {
      candidateEvents.push(event)
    } else if (isOpen(event)) {
      openEvents.push(event)
    }
  }

  const nodes = beats.map((b) => b.entry)
  const edges = []

  // 1) 相邻拍 → causes 导致边（因果链主干）
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({
      id: `edge-causes-${beats[i].order}-${beats[i + 1].order}`,
      kind: OUTLINE_EDGE_KINDS.CAUSES,
      fromNodeId: nodes[i].id,
      toNodeId: nodes[i + 1].id,
      note: '推演因果主干·相邻拍'
    })
  }

  // 2) 未选候选 → alternative 边留档（未选分支也是资产，toNodeId 留空＝未提交）
  for (const [eIndex, event] of candidateEvents.entries()) {
    const owner = resolveOwner(event, beats, 'next')
    if (!owner) continue
    unadoptedOf(event).forEach((candidate, cIndex) => {
      const edge = {
        id: `edge-alternative-${seqOf(event)}-${eIndex}-${cIndex}`,
        kind: OUTLINE_EDGE_KINDS.ALTERNATIVE,
        fromNodeId: owner.id,
        toNodeId: '',
        note: firstText(candidate.text, candidate.definition, '未选分支'),
        branchText: firstText(candidate.text, candidate.definition, ''),
        archived: true
      }
      const source = firstText(candidate.source)
      if (source) edge.source = source
      edges.push(edge)
    })
  }

  // 3) open 假设轨 → foreshadows 伏笔边（planted setup，payoff 留空待后续拍/其他 POV 回收）
  for (const [eIndex, event] of openEvents.entries()) {
    const owner = resolveOwner(event, beats, 'before')
    if (!owner) continue
    edges.push({
      id: `edge-foreshadows-${seqOf(event)}-${eIndex}`,
      kind: OUTLINE_EDGE_KINDS.FORESHADOWS,
      fromNodeId: owner.id,
      toNodeId: '',
      note: firstText(event.text, event.definition, '悬而未决'),
      open: true,
      payoff: null
    })
  }

  return { nodes, edges }
}

/**
 * { nodes, edges } → 成书章纲文本（供 P2a extract 拆书回读用）。
 * 每拍一行带 〔拍N〕 标记；伏笔/未选分支以行内标记标注，因果主干由拍的先后顺序承载。
 * 纯字符串拼接、确定性，不含时间戳/随机数。
 */
export function renderOutlineText(nodes = [], edges = []) {
  const nodeList = Array.isArray(nodes) ? nodes : []
  const edgeList = Array.isArray(edges) ? edges : []
  const lines = []
  for (const node of nodeList) {
    if (!isObj(node)) continue
    lines.push(`〔拍${node.order}〕${str(node.title)}：${str(node.definition)}。`)
    for (const edge of edgeList) {
      if (!isObj(edge) || edge.fromNodeId !== node.id) continue
      if (edge.kind === OUTLINE_EDGE_KINDS.FORESHADOWS) {
        lines.push(`〔伏笔·开放〕${firstText(edge.note, '悬而未决')}（payoff 留空，待后续拍或其他 POV 回收）。`)
      } else if (edge.kind === OUTLINE_EDGE_KINDS.ALTERNATIVE) {
        lines.push(`〔未选分支〕${firstText(edge.note, edge.branchText, '未选分支')}。`)
      }
    }
  }
  return lines.join('\n')
}
