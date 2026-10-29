import test from 'node:test'
import assert from 'node:assert/strict'
import { canMoveNode, moveNode, nodeDepth, outlineDepths, removeNode, siblingIndex } from '../shell/outlineTree.mjs'

/**
 * 大纲树的纯函数（批次28 · 工单1b）：删节点（连边删）、同级上下移、层级深度。
 * 这些是索引窗缩进与中栏编辑面按钮的同一份实现——这里把边界钉住：
 * 首个上移／末个下移是 no-op，环与悬空边不崩（算不出的归 0），入参不被就地改掉。
 */

const nodes = () => [
  { id: 'n1', title: '开场' },
  { id: 'n2', title: '第一折' },
  { id: 'n3', title: '第二折' }
]

test('removeNode：连同该节点的所有边一起删（from/to 与 source/target 两种写法都算），其余边原样', () => {
  const draft = {
    nodes: nodes(),
    edges: [
      { from: 'n1', to: 'n2' },
      { source: 'n2', target: 'n3' },
      { from: 'n2', to: 'n1' },
      { from: 'n1', to: 'n3' }
    ]
  }
  const result = removeNode(draft, 1)
  assert.equal(result.ok, true)
  assert.equal(result.changed, true)
  assert.deepEqual(result.nodes.map((node) => node.id), ['n1', 'n3'])
  assert.deepEqual(result.edges, [{ from: 'n1', to: 'n3' }], '以 n2 为任一端的边（含 source/target 写法）全删，别的边不动')
  assert.equal(result.index, 1, '删中间那个：选中落到原位置的下一个节点')
  assert.equal(result.removed.id, 'n2')

  // 入参不被就地改掉（draft 是响应式对象，替换整份比原地改更好推理）。
  assert.equal(draft.nodes.length, 3)
  assert.equal(draft.edges.length, 4)

  // 删最后一个：选中回退到新的末尾。
  const last = removeNode(draft, 2)
  assert.equal(last.index, 1)
  assert.deepEqual(last.nodes.map((node) => node.id), ['n1', 'n2'])

  // 删光：index 为 null（调用方据此收掉草稿——空 nodes 存不进 outline.json）。
  const single = removeNode({ nodes: [{ id: 'only', title: '唯一' }], edges: [] }, 0)
  assert.deepEqual(single.nodes, [])
  assert.equal(single.index, null)
})

test('removeNode：越界下标与坏入参是 no-op（changed:false），不抛', () => {
  const draft = { nodes: nodes(), edges: [] }
  for (const index of [-1, 3, 1.5, null, undefined, '1']) {
    const result = removeNode(draft, index)
    assert.equal(result.ok, false, String(index))
    assert.equal(result.changed, false, String(index))
    assert.equal(result.nodes.length, 3)
  }
  const empty = removeNode(null, 0)
  assert.equal(empty.ok, false)
  assert.deepEqual(empty.nodes, [])
})

test('moveNode：同级内互换位置，跨层不动；首个上移与末个下移是 no-op', () => {
  const draft = { nodes: nodes(), edges: [{ from: 'n1', to: 'n2' }] }
  // n1 深度 0，n2 深度 1，n3 深度 0。
  assert.deepEqual(outlineDepths(draft.nodes, draft.edges), [0, 1, 0])

  // n3 上移：同深度的相邻节点只有一个 n1（n2 深度 1 不算同级），直接跳过它。
  const up = moveNode(draft, 2, -1)
  assert.equal(up.changed, true)
  assert.deepEqual(up.nodes.map((node) => node.id), ['n3', 'n2', 'n1'])
  assert.equal(up.index, 0)
  assert.deepEqual(up.edges, draft.edges, '上下移只重排 nodes，edges 一个字不改')
  assert.equal(draft.nodes[0].id, 'n1', '入参不被就地改掉')

  // 首个同级节点上移：no-op。
  const head = moveNode(draft, 0, -1)
  assert.equal(head.changed, false)
  assert.equal(head.ok, false)
  assert.deepEqual(head.nodes.map((node) => node.id), ['n1', 'n2', 'n3'])

  // 末尾同级节点下移：no-op（n3 是最后一个深度 0 的节点）。
  const tail = moveNode(draft, 2, 1)
  assert.equal(tail.changed, false)
  assert.equal(tail.index, 2)

  // 只有子节点自己的同级：n2 是唯一的深度 1 节点，上下都动不了。
  assert.equal(moveNode(draft, 1, -1).changed, false)
  assert.equal(moveNode(draft, 1, 1).changed, false)
})

test('moveNode：同级有多个时与相邻那个互换，跨层不越界', () => {
  const draft = {
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'a1', title: 'A 的子' },
      { id: 'c', title: 'C' }
    ],
    edges: [{ from: 'a', to: 'a1' }]
  }
  assert.deepEqual(outlineDepths(draft.nodes, draft.edges), [0, 0, 1, 0])
  const down = moveNode(draft, 0, 1)
  assert.deepEqual(down.nodes.map((node) => node.id), ['b', 'a', 'a1', 'c'])
  assert.equal(down.index, 1)
  const downAgain = moveNode(down, 1, 1)
  assert.deepEqual(downAgain.nodes.map((node) => node.id), ['b', 'c', 'a1', 'a'])
  assert.equal(downAgain.index, 3)

  assert.equal(siblingIndex(draft.nodes, draft.edges, 0, 1), 1)
  assert.equal(siblingIndex(draft.nodes, draft.edges, 1, -1), 0)
  assert.equal(siblingIndex(draft.nodes, draft.edges, 2, 1), null, '深度 1 只有 a1 自己，没有同级可换')
  assert.equal(siblingIndex(draft.nodes, draft.edges, 2, -1), null, '深度 1 只有它自己')
  assert.equal(canMoveNode(draft, 0, -1), false)
  assert.equal(canMoveNode(draft, 3, 1), false)
  assert.equal(canMoveNode(draft, 0, 1), true)
})

test('nodeDepth：BFS 逐层；悬空边、自环、环、重复 id 都只让相关节点留在 0，不崩', () => {
  // 正常链：n1 → n2 → n3。
  const chain = {
    nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }, { id: 'loose' }],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }]
  }
  assert.deepEqual(outlineDepths(chain.nodes, chain.edges), [0, 1, 2, 0])
  assert.equal(nodeDepth(chain.nodes, chain.edges, 2), 2)
  assert.equal(nodeDepth(chain.nodes, chain.edges, 3), 0, '孤立节点是一级')
  assert.equal(nodeDepth(chain.nodes, chain.edges, 99), 0, '越界下标回 0，不抛')

  // 悬空边（指向不存在的节点）：那条线不算，其余连线照常算层级。
  const dangling = {
    nodes: [{ id: 'n1' }, { id: 'n2' }],
    edges: [{ from: 'n1', to: '查无此节点' }, { from: 'n1', to: 'n2' }]
  }
  assert.deepEqual(outlineDepths(dangling.nodes, dangling.edges), [0, 1])

  // 只剩悬空边：两端都不在表里 → 谁也不是谁的子节点，整份一级。
  assert.deepEqual(outlineDepths(dangling.nodes, [{ from: 'x', to: 'y' }]), [0, 0])

  // 自环不算边。
  assert.deepEqual(outlineDepths([{ id: 'a' }], [{ from: 'a', to: 'a' }]), [0])

  // 环（a→b→a，没有根可进）：环里每个节点都有入边、进不了 BFS → 全部 0；BFS 不会转圈。
  const cycle = { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'a', to: 'c' }] }
  assert.deepEqual(outlineDepths(cycle.nodes, cycle.edges), [0, 0, 0], '没有根的环整片归 0，不崩也不编层级')

  // 根可达的环：根 → a → b → a，visited 挡住回头，深度按最浅一层。
  const reachableCycle = { nodes: [{ id: 'root' }, { id: 'a' }, { id: 'b' }], edges: [{ from: 'root', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }
  assert.deepEqual(outlineDepths(reachableCycle.nodes, reachableCycle.edges), [0, 1, 2])

  // 重复 id：指向谁都不确定 → 该 id 上的连线一律不算。
  const duplicate = { nodes: [{ id: 'x' }, { id: 'x' }, { id: 'leaf' }], edges: [{ from: 'x', to: 'leaf' }] }
  assert.deepEqual(outlineDepths(duplicate.nodes, duplicate.edges), [0, 0, 0])

  // 多父节点：取最先到达的最浅一层。
  const multi = { nodes: [{ id: 'r' }, { id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'r', to: 'a' }, { from: 'a', to: 'c' }, { from: 'r', to: 'b' }] }
  assert.deepEqual(outlineDepths(multi.nodes, multi.edges), [0, 1, 1, 2])

  // 缺 id 的节点只能是根；没有 edges 时整份一级。
  assert.deepEqual(outlineDepths([{ title: '没有 id' }, { id: 'n1' }], [{ from: 'n1', to: '' }]), [0, 0])
  assert.deepEqual(outlineDepths([{ id: 'n1' }, { id: 'n2' }], []), [0, 0])
  assert.deepEqual(outlineDepths([], []), [])
})
