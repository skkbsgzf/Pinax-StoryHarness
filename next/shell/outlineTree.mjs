/**
 * 大纲树的纯函数（批次28 · 工单1b）：层级深度、删节点（连边一起删）、同级上下移。
 *
 * 不 import Vue、不碰 DOM、不读状态——索引窗（画缩进）与 useBoardData（草稿编辑）吃同一份实现，
 * 「深度怎么算」从此只有一个答案（批次18 G3 那份 outlineDepths 原先埋在 useBoardData 里）。
 *
 * 深度口径（工单1a）：edges 的 from→to 是父子；无入边的节点是根（depth 0），BFS 向下逐层 +1，
 * 同一子节点被多条线指向时取最先到达的最浅一层。**算不出的归 0**，绝不让一条坏连线把整棵树炸掉：
 *   • 端点缺失／指向不存在的节点（悬空边）→ 那条连线不算；
 *   • 自环不算；指向自己的环让环里那几个节点到不了根 → 它们保持 0；
 *   • 重复 id 无法确定指向谁 → 该 id 上的连线一律不算（相关节点按根处理）；
 *   • 缺 id 的节点只能是独立根。环不会让 BFS 转圈（visited 挡着）。
 * edges 两种字段名都认：{ from, to }（本仓 outline.json 的既有形状）与 { source, target }。
 *
 * 编辑操作一律返回新数组、不改入参（draft 是响应式对象，替换整份比原地改更好推理）：
 *   { ok, changed, index, nodes, edges }——index 是操作后应选中的节点下标（删光时为 null）。
 */

function edgeFrom(edge) {
  return edge?.from ?? edge?.source
}

function edgeTo(edge) {
  return edge?.to ?? edge?.target
}

function nodeIdOf(node) {
  return typeof node?.id === 'string' && node.id.trim() ? node.id.trim() : ''
}

function copyNodes(nodes) {
  return Array.isArray(nodes) ? nodes.slice() : []
}

function copyEdges(edges) {
  return Array.isArray(edges) ? edges.slice() : []
}

/**
 * 每个节点的深度（与 nodes 同下标）。没有 edges 时整份都是 0（还没连线的草稿是常态）。
 */
export function outlineDepths(nodes, edges) {
  const list = Array.isArray(nodes) ? nodes : []
  const depths = list.map(() => 0)
  const links = Array.isArray(edges) ? edges : []
  if (!list.length || !links.length) return depths

  // id → 下标；重复 id 记成 ambiguous（连线指向谁都不确定，整条连线不算）。
  const indexById = new Map()
  const ambiguous = new Set()
  for (const [index, node] of list.entries()) {
    const id = nodeIdOf(node)
    if (!id) continue
    if (indexById.has(id)) ambiguous.add(id)
    else indexById.set(id, index)
  }
  if (!indexById.size) return depths

  const children = new Map()
  const indegree = list.map(() => 0)
  for (const edge of links) {
    const from = edgeFrom(edge)
    const to = edgeTo(edge)
    if (typeof from !== 'string' || typeof to !== 'string') continue
    if (ambiguous.has(from) || ambiguous.has(to)) continue
    const parent = indexById.get(from)
    const child = indexById.get(to)
    if (parent === undefined || child === undefined || parent === child) continue
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(child)
    indegree[child] += 1
  }

  const visited = list.map(() => false)
  const queue = []
  for (let index = 0; index < list.length; index += 1) {
    if (indegree[index] !== 0) continue
    visited[index] = true
    queue.push(index)
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    for (const child of children.get(current) ?? []) {
      if (visited[child]) continue
      visited[child] = true
      depths[child] = depths[current] + 1
      queue.push(child)
    }
  }
  return depths
}

/** 单个节点的深度（算不出＝0；越界下标也回 0，调用方不用先判范围）。 */
export function nodeDepth(nodes, edges, index) {
  if (!Number.isSafeInteger(index) || index < 0) return 0
  return outlineDepths(nodes, edges)[index] ?? 0
}

/**
 * 同级相邻节点的下标：同深度里往前（delta<0）或往后（delta>0）最近的一个。
 * 不跨层——上移第一行、下移最后一行都没有相邻同级，返回 null（调用方按 no-op 处理）。
 */
export function siblingIndex(nodes, edges, index, delta) {
  const list = Array.isArray(nodes) ? nodes : []
  if (!Number.isSafeInteger(index) || index < 0 || index >= list.length) return null
  const step = delta < 0 ? -1 : 1
  const depths = outlineDepths(list, edges)
  const depth = depths[index] ?? 0
  for (let cursor = index + step; cursor >= 0 && cursor < list.length; cursor += step) {
    if ((depths[cursor] ?? 0) === depth) return cursor
  }
  return null
}

/** 这个方向上还动得动吗（界面的按钮禁用态与 moveNode 的判定同一份来源）。 */
export function canMoveNode(draft, index, delta) {
  return siblingIndex(draft?.nodes, draft?.edges, index, delta) !== null
}

/**
 * 删节点：连同以它为任一端的连线一起删（from/to 与 source/target 两种写法都算）。
 * 删的是草稿——改完自动落盘，所以界面上不做二次确认。
 */
export function removeNode(draft, index) {
  const nodes = copyNodes(draft?.nodes)
  const edges = copyEdges(draft?.edges)
  if (!Number.isSafeInteger(index) || index < 0 || index >= nodes.length) {
    return { ok: false, changed: false, index: null, nodes, edges }
  }
  const [removed] = nodes.splice(index, 1)
  const id = nodeIdOf(removed)
  const keptEdges = id
    ? edges.filter((edge) => edgeFrom(edge) !== id && edgeTo(edge) !== id)
    : edges
  const nextIndex = nodes.length ? Math.min(index, nodes.length - 1) : null
  return { ok: true, changed: true, index: nextIndex, nodes, edges: keptEdges, removed }
}

/**
 * 同级上移／下移：与相邻同级节点互换位置（只重排 nodes 数组，edges 一个字不改）。
 * 首行上移、末行下移是 no-op（changed:false，index 原样返回）。
 */
export function moveNode(draft, index, delta) {
  const nodes = copyNodes(draft?.nodes)
  const edges = copyEdges(draft?.edges)
  if (!Number.isSafeInteger(index) || index < 0 || index >= nodes.length) {
    return { ok: false, changed: false, index: null, nodes, edges }
  }
  const target = siblingIndex(nodes, edges, index, delta)
  if (target === null) return { ok: false, changed: false, index, nodes, edges }
  const swapped = nodes[target]
  nodes[target] = nodes[index]
  nodes[index] = swapped
  return { ok: true, changed: true, index: target, nodes, edges }
}

export default { outlineDepths, nodeDepth, siblingIndex, canMoveNode, removeNode, moveNode }
