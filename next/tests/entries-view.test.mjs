import test from 'node:test'
import assert from 'node:assert/strict'
import { ENTRIES_VIEWS, entryEdges, isEntriesView, nextEntriesView, radialLayout, readEntriesView, writeEntriesView } from '../shell/entriesView.mjs'

/**
 * 条目图谱的纯函数（批次36 · 任务二）：边解析（entryEdges）与径向布局（radialLayout）。
 * 布局函数是 EntryGraph.vue 的坐标来源——这里钉住：环不崩、孤点落外圈、
 * 未落图的边如实计数、入参不被就地改掉。
 */

test('视图词表三态循环：list → table → graph → list；词表外的值按 list 起步', () => {
  assert.deepEqual([...ENTRIES_VIEWS], ['list', 'table', 'graph'])
  assert.equal(isEntriesView('graph'), true)
  assert.equal(isEntriesView('map'), false)
  assert.equal(nextEntriesView('list'), 'table')
  assert.equal(nextEntriesView('table'), 'graph')
  assert.equal(nextEntriesView('graph'), 'list')
  assert.equal(nextEntriesView('nonsense'), 'list', '词表外的值折回 list（ readEntriesView 的兜底同档）')
})

test('视图记忆：三档都进 localStorage（entriesView.<projectRoot>），词表外读回 list', () => {
  const store = new Map()
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value))
  }
  for (const view of ENTRIES_VIEWS) {
    assert.equal(writeEntriesView('D:/tmp/大梦', view, storage), true)
    assert.equal(readEntriesView('D:/tmp/大梦', storage), view)
  }
  assert.equal(writeEntriesView('D:/tmp/大梦', 'map', storage), false, '词表外的值不写')
  store.set('entriesView.D:/tmp/大梦', 'graph')
  assert.equal(readEntriesView('D:/tmp/大梦', storage), 'graph')
})

test('entryEdges：relations[].to 按名字解析成边；自环跳过；无向去重；未落图如实计数', () => {
  const entries = [
    { name: '柯秒', cat: '人物', relations: [{ to: '钟楼' }, { to: '柯秒' }, { to: '查无此人' }] },
    { name: '钟楼', cat: '设定', relations: [{ to: '柯秒' }, { to: '钟楼' }] },
    { name: '停摆的表', cat: '编年', relations: [] }
  ]
  const { edges, unmatched } = entryEdges(entries)
  // a→b 与 b→a 是同一条边：只留一条；自环（to 指向自己）没有信息量，跳过且不算未落图。
  assert.deepEqual(edges, [{ source: '柯秒', target: '钟楼' }])
  assert.equal(unmatched, 1, '目标不存在的边如实计数（不画幽灵节点）')
})

test('entryEdges：relations 缺失／形状不对按没有关系处理，不崩', () => {
  assert.deepEqual(entryEdges([]), { edges: [], unmatched: 0 })
  assert.deepEqual(entryEdges([{ name: '柯秒' }]), { edges: [], unmatched: 0 })
  assert.deepEqual(entryEdges([{ name: '柯秒', relations: 'bad' }]), { edges: [], unmatched: 0 })
  assert.deepEqual(entryEdges([{ name: '柯秒', relations: [null, {}] }]), { edges: [], unmatched: 0 })
  assert.equal(entryEdges(null).unmatched, 0)
})

test('radialLayout：被引用最多的条目为根（圆心 0,0），其余沿生成树展开；点数＝条目数', () => {
  const nodes = [
    { name: '钟楼', cat: '设定' },
    { name: '柯秒', cat: '人物' },
    { name: '停摆的表', cat: '编年' },
    { name: '雨夜', cat: '编年' }
  ]
  const edges = [
    { source: '柯秒', target: '钟楼' },
    { source: '停摆的表', target: '钟楼' },
    { source: '雨夜', target: '停摆的表' }
  ]
  const layout = radialLayout(nodes, edges)
  assert.equal(layout.root, '钟楼', '钟楼被引用两次，是根')
  const root = layout.points.find((point) => point.name === '钟楼')
  assert.deepEqual([root.x, root.y], [0, 0], '根在圆心')
  assert.equal(layout.points.length, nodes.length, '每个条目都有坐标（不吞点）')
  assert.equal(layout.lines.length, edges.length, '每条边都落图')
  for (const line of layout.lines) {
    assert.ok(Number.isFinite(line.x1) && Number.isFinite(line.y1) && Number.isFinite(line.x2) && Number.isFinite(line.y2))
  }
  assert.deepEqual(layout.outer, [], '全连通时没有外圈点')
})

test('radialLayout：环（a→b→c→a）不崩，也不重复画边；点数与边数守恒', () => {
  const nodes = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'a' }
  ]
  const layout = radialLayout(nodes, edges)
  assert.equal(layout.points.length, 3)
  assert.equal(layout.lines.length, 3)
  for (const point of layout.points) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), '环上的点都有有限坐标')
  }
})

test('radialLayout：孤点沿外圈（isolate 标记），孤点在首位也不挤掉主分量的根', () => {
  const nodes = [
    { name: '孤点', cat: '' },
    { name: 'a', cat: '人物' },
    { name: 'b', cat: '设定' },
    { name: 'c', cat: '编年' }
  ]
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' }
  ]
  const layout = radialLayout(nodes, edges)
  assert.equal(layout.root, 'b', '根＝入度最高的条目（b 与 c 各被引一次，并列时比总度数，b 胜出）')
  const isolate = layout.points.find((point) => point.name === '孤点')
  assert.equal(isolate.isolate, true, '孤点带 isolate 标记')
  const radius = Math.hypot(isolate.x, isolate.y)
  const inner = layout.points.filter((point) => !point.isolate && point.name !== layout.root)
  for (const point of inner) {
    assert.ok(Math.hypot(point.x, point.y) < radius, '孤点应比树上的点更靠外')
  }
  assert.deepEqual(layout.outer, ['孤点'])
})

test('radialLayout：全孤点（没有边）也能排布——根在圆心，其余沿外圈', () => {
  const nodes = [{ name: '甲' }, { name: '乙' }, { name: '丙' }]
  const layout = radialLayout(nodes, [])
  assert.equal(layout.points.length, 3)
  assert.equal(layout.lines.length, 0)
  const root = layout.points.find((point) => point.name === '甲')
  assert.deepEqual([root.x, root.y], [0, 0])
  for (const point of layout.points.filter((item) => item.name !== '甲')) {
    assert.equal(point.isolate, true)
    assert.ok(Math.hypot(point.x, point.y) > 0, '外圈点不在圆心上')
  }
})

test('radialLayout：空输入与畸形输入不崩', () => {
  assert.deepEqual(radialLayout([], []), { points: [], lines: [], root: null, outer: [] })
  assert.equal(radialLayout(null, null).points.length, 0)
  const layout = radialLayout([{ name: '柯秒' }], [{ source: '柯秒', target: '查无此人' }])
  assert.equal(layout.points.length, 1, '边两端的点不在图里就不画这条线')
  assert.equal(layout.lines.length, 0)
})

test('radialLayout：入参不被就地改掉（points 是新对象，条目清单原样）', () => {
  const nodes = [{ name: 'a', cat: '人物' }, { name: 'b', cat: '设定' }]
  const edges = [{ source: 'a', target: 'b' }]
  radialLayout(nodes, edges)
  assert.deepEqual(nodes, [{ name: 'a', cat: '人物' }, { name: 'b', cat: '设定' }])
  assert.deepEqual(edges, [{ source: 'a', target: 'b' }])
})
