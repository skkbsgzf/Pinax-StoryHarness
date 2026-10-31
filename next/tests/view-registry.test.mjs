import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  CUSTOM_VIEW_TYPE,
  HOST_VIEW_TYPES,
  LEGACY_VIEW_BINDINGS,
  VIEW_TYPES,
  createViewRegistry,
  hostViewRegistry,
  legacyBindingForPane,
  matchClaimPath,
  normalizeClaimPath,
  resolvePaneView,
  resolveResourceClaim
} from '../shell/viewRegistry.mjs'

/**
 * 视图注册表单测（M2.5-C 任务二）。
 * 三条边界：宿主视图不许被顶替；第三方只用 pinax.view.custom；插件 dispose 后解析失败。
 * 纯数据模块，不 import Vue。
 */

test('宿主视图词表：八种 ＋ custom；宿主注册表里九种都在，且都标 builtin', () => {
  // 批次44 加了两块形态（见 next/shell/formTaxonomy.mjs）：
  //   pinax.view.board 看板面——结构化数据的视图（列表／表格／图谱，核心区里成块的地方）；
  //   pinax.view.app   应用面——外部端口上的网页应用，宿主给一块内嵌浏览器，不手搓组件。
  // 词表是白名单，多一种就是多一种能顶替宿主渲染器的口子，所以这里逐个列出。
  assert.deepEqual([...HOST_VIEW_TYPES], [
    'pinax.view.tree',
    'pinax.view.list',
    'pinax.view.editor',
    'pinax.view.reader',
    'pinax.view.diff',
    'pinax.view.graph',
    'pinax.view.board',
    'pinax.view.app'
  ])
  assert.equal(CUSTOM_VIEW_TYPE, 'pinax.view.custom')
  assert.deepEqual([...VIEW_TYPES], [...HOST_VIEW_TYPES, CUSTOM_VIEW_TYPE])
  const listed = hostViewRegistry.list()
  assert.equal(listed.length, VIEW_TYPES.length)
  assert.equal(listed.every((entry) => entry.builtin && entry.owner === 'host'), true)
})

test('注册/解析：第三方注册 custom 可解析；同名重复注册拒绝', () => {
  const registry = createViewRegistry()
  const factory = ({ pane }) => ({ kind: 'custom-face', pane: pane?.id })
  const registered = registry.registerView(CUSTOM_VIEW_TYPE, factory, { owner: 'plugin.demo' })
  assert.equal(registered.ok, true, JSON.stringify(registered.error ?? {}))
  const resolved = registry.resolve(CUSTOM_VIEW_TYPE)
  assert.equal(resolved.owner, 'plugin.demo')
  assert.equal(resolved.builtin, false)
  assert.deepEqual(resolved.factory({ pane: { id: 'demo.pane' } }), { kind: 'custom-face', pane: 'demo.pane' })

  const again = registry.registerView(CUSTOM_VIEW_TYPE, () => null, { owner: 'plugin.other' })
  assert.equal(again.ok, false)
  assert.equal(again.error.code, 'DUPLICATE_VIEW')
})

test('保留类型：第三方不许顶替宿主六种视图；宿主自己可以注册', () => {
  const registry = createViewRegistry()
  for (const type of HOST_VIEW_TYPES) {
    const denied = registry.registerView(type, () => ({ kind: 'hijack' }), { owner: 'plugin.evil' })
    assert.equal(denied.ok, false, `${type} 不许被第三方注册`)
    assert.equal(denied.error.code, 'RESERVED_VIEW_TYPE')
  }
  const hostOwn = registry.registerView('pinax.view.tree', () => ({ kind: 'tree' }), { owner: 'host', builtin: true })
  assert.equal(hostOwn.ok, true)
})

test('非法类型与非法工厂拒绝', () => {
  const registry = createViewRegistry()
  assert.equal(registry.registerView('note', () => null).error.code, 'INVALID_VIEW_TYPE')
  assert.equal(registry.registerView('pinax.view.tree', 'not-a-function').error.code, 'INVALID_VIEW_FACTORY')
})

test('解析回落：未知类型得到「认这个名字、没有渲染器」；连类型都没有则 null', () => {
  const registry = createViewRegistry()
  const unknown = registry.bind({ id: 'demo.pane', view: 'pinax.view.graph' })
  assert.deepEqual(unknown, { type: 'pinax.view.graph', factory: null, result: null, owner: null, builtin: false })
  assert.equal(registry.bind({ id: 'demo.pane' }), null, '没声明 view、也不是已知前缀：没有视图')
})

test('v1 前缀回退：老 pane 不写 view 也能落到内容面；长前缀优先', () => {
  const registry = createViewRegistry()
  for (const type of HOST_VIEW_TYPES) registry.registerView(type, ({ pane }) => ({ kind: `${type}:${pane.id}` }), { owner: 'host', builtin: true })

  assert.equal(legacyBindingForPane('novel.editor').kind, 'chapter-editor')
  assert.equal(legacyBindingForPane('outline.widget').kind, 'outline-editor')
  assert.equal(legacyBindingForPane('unknown.pane'), null)

  const bound = registry.bind({ id: 'novel.editor' })
  assert.equal(bound.type, 'pinax.view.editor')
  assert.equal(bound.result.kind, 'pinax.view.editor:novel.editor')

  const declared = registry.bind({ id: 'novel.editor', view: 'pinax.view.reader' })
  assert.equal(declared.type, 'pinax.view.reader', '声明了 view 就按声明解析，不再按前缀猜')

  // 提案审阅是正文面的一个状态，不是新类型：production 的 hostViewFactory 走这条。
  assert.equal(LEGACY_VIEW_BINDINGS[0].prefix, 'novel.')
  assert.equal(hostViewRegistry.bind({ id: 'novel.editor' }, { selection: { type: 'proposal' } }).result.kind, 'proposal-review')
})

test('插件 dispose：disposeOwner 释放它注册的视图，宿主视图不受影响', () => {
  const registry = createViewRegistry()
  registry.registerView('pinax.view.tree', () => ({ kind: 'tree' }), { owner: 'host', builtin: true })
  assert.equal(registry.registerView(CUSTOM_VIEW_TYPE, () => ({ kind: 'custom' }), { owner: 'plugin.demo' }).ok, true)

  assert.equal(registry.resolve(CUSTOM_VIEW_TYPE).owner, 'plugin.demo')
  assert.equal(registry.disposeOwner('plugin.demo'), 1)
  assert.equal(registry.resolve(CUSTOM_VIEW_TYPE), null)
  assert.equal(registry.resolve('pinax.view.tree').builtin, true, '宿主视图不能被谁的 dispose 带走')
  const afterDispose = registry.bind({ id: 'demo.pane', view: CUSTOM_VIEW_TYPE })
  assert.deepEqual(afterDispose, { type: CUSTOM_VIEW_TYPE, factory: null, result: null, owner: null, builtin: false })
})

test('CarrierPaneHost 走注册表：源码查 resolvePaneView，不再按 pane id 前缀写七个分支', async () => {
  const host = await readFile(fileURLToPath(new URL('../shell/CarrierPaneHost.vue', import.meta.url)), 'utf-8')
  assert.ok(host.includes('resolvePaneView'), 'CarrierPaneHost 必须经 viewRegistry 解析视图')
  assert.doesNotMatch(host, /paneId\.value\.startsWith\(/u, '不许再在外壳里按 pane id 前缀写死分支')
  assert.ok(host.includes('viewPlaceholderReason'), '认不出的视图要如实说明原因（占位）')
})

test('宿主单例解析：大纲 pane 落在编辑器面，产物归宿主', () => {
  const bound = resolvePaneView({ id: 'outline.editor', view: 'pinax.view.editor' }, {})
  assert.equal(bound.type, 'pinax.view.editor')
  assert.equal(bound.builtin, true)
  assert.equal(bound.owner, 'host')
  assert.equal(bound.result.kind, 'outline-editor')
})

test('v3 pane.kind 是权威：同一 id 前缀下以声明为准，不再被前缀改写', () => {
  const declared = resolvePaneView({ id: 'novel.editor', view: 'pinax.view.editor', kind: 'records-editor' }, {})
  assert.equal(declared.result.kind, 'records-editor', '显式 kind 优先于 novel. 前缀')

  // 提案审阅仍是 chapter-editor 的一个状态，不是新视图类型。
  const proposal = resolvePaneView({ id: 'novel.editor', view: 'pinax.view.editor', kind: 'chapter-editor' }, { selection: { type: 'proposal' } })
  assert.equal(proposal.result.kind, 'proposal-review')

  // 没有 kind、也没有认得出的前缀：如实返回 null（宿主出占位）。
  assert.equal(resolvePaneView({ id: 'unknown.pane', view: 'pinax.view.editor' }, {}).result, null)
})

/**
 * 资源认领裁决（批次53 · 协议 @4）：同一份资源被多块 pane 认领时，谁赢要能断言。
 * 顺序：claims 命中 → canOpen 谓词 → takes 档位（extension > fallback）→ priority → paneId。
 */
test('认领 glob：** 独占一段可零段，* 不跨目录，路径分隔统一成 /', () => {
  const backslash = String.fromCharCode(92)
  assert.equal(normalizeClaimPath(`.${backslash}世界书${backslash}a.md/`), '世界书/a.md')
  assert.equal(matchClaimPath('正文/**/*.md', '正文/第001章.md'), true, '** 可以零段')
  assert.equal(matchClaimPath('正文/**/*.md', '正文/第一卷/第001章.md'), true)
  assert.equal(matchClaimPath('正文/*.md', '正文/第一卷/第001章.md'), false, '* 不跨目录')
  assert.equal(matchClaimPath('世界书/**', '世界书/人物/张三.md'), true)
  assert.equal(matchClaimPath('世界书/**', '约束/人物/张三.md'), false)
})

test('裁决：extension 档胜过 fallback 档——正文编辑器赢过书架（同一份章节）', () => {
  const decision = resolveResourceClaim([
    { id: 'novel.shelf', pluginId: 'pinax.carrier.novel', title: '书架', claims: ['正文/**'], priority: 30, takes: 'fallback' },
    { id: 'novel.editor', pluginId: 'pinax.carrier.novel', title: '正文', claims: ['正文/**/*.md'], priority: 70, takes: 'extension' }
  ], { path: '正文/第一卷/第001章.md', kind: 'chapter' })

  assert.equal(decision.winner.paneId, 'novel.editor', '编辑器必须赢（extension 接管）')
  assert.equal(decision.winner.won, true)
  const shelf = decision.considered.find((pane) => pane.paneId === 'novel.shelf')
  assert.equal(shelf.status, 'lost')
  assert.match(shelf.reason, /lost-take/u, '落选原因要可读：同命中时输在 takes 档位')
})

test('裁决：canOpen 谓词不命中即退出竞争，且缺字段也算不命中', () => {
  const panes = [
    { id: 'worldbook.board', claims: ['世界书/**'], priority: 30, takes: 'fallback' },
    { id: 'worldbook.entries', claims: ['世界书/**/*.md'], priority: 70, takes: 'extension', canOpen: { field: 'kind', in: ['entry', 'proposal'] } }
  ]

  // kind 命中：看板区赢。
  const hit = resolveResourceClaim(panes, { path: '世界书/人物/张三.md', kind: 'entry' })
  assert.equal(hit.winner.paneId, 'worldbook.entries')
  assert.equal(hit.considered.find((pane) => pane.paneId === 'worldbook.board').reason, 'lost-take')

  // kind 不命中：看板区 predicate-miss，导航树兜底赢。
  const miss = resolveResourceClaim(panes, { path: '世界书/人物/张三.md', kind: 'outline' })
  assert.equal(miss.winner.paneId, 'worldbook.board')
  assert.equal(miss.considered.find((pane) => pane.paneId === 'worldbook.entries').reason, 'predicate-miss')

  // 资源没带 kind：谓词字段缺失＝不命中（不静默放行）。
  const missing = resolveResourceClaim(panes, { path: '世界书/人物/张三.md' })
  assert.equal(missing.winner.paneId, 'worldbook.board')
  assert.equal(missing.considered.find((pane) => pane.paneId === 'worldbook.entries').reason, 'predicate-missing-field')
})

test('裁决：同档同谓词时按 priority 降序、再按 paneId 升序，落选原因逐项可读', () => {
  const decision = resolveResourceClaim([
    { id: 'b.editor', claims: ['文档/**'], priority: 50, takes: 'extension' },
    { id: 'a.editor', claims: ['文档/**'], priority: 50, takes: 'extension' },
    { id: 'c.editor', claims: ['文档/**'], priority: 80, takes: 'extension' },
    { id: 'other.pane', claims: ['资料/**'], priority: 99, takes: 'extension' }
  ], { path: '文档/草稿.md' })

  assert.equal(decision.winner.paneId, 'c.editor', 'priority 高的赢')
  const a = decision.considered.find((pane) => pane.paneId === 'a.editor')
  const b = decision.considered.find((pane) => pane.paneId === 'b.editor')
  assert.equal(a.status, 'lost')
  assert.equal(a.reason, 'lost-priority')
  assert.equal(b.reason, 'lost-priority')
  assert.equal(decision.considered.find((pane) => pane.paneId === 'other.pane').reason, 'claim-miss')

  // 同 priority 时 paneId 升序：a 赢 b。
  const tie = resolveResourceClaim([
    { id: 'b.editor', claims: ['文档/**'], priority: 50, takes: 'extension' },
    { id: 'a.editor', claims: ['文档/**'], priority: 50, takes: 'extension' }
  ], { path: '文档/草稿.md' })
  assert.equal(tie.winner.paneId, 'a.editor')
  assert.equal(tie.considered.find((pane) => pane.paneId === 'b.editor').reason, 'lost-order')
})

test('裁决：没写 claims 的 pane 不参评（认领是显式声明，不按 id 猜）', () => {
  const decision = resolveResourceClaim([
    { id: 'novel.shelf', claims: ['正文/**'], priority: 30, takes: 'fallback' },
    { id: 'novel.editor', priority: 70 }
  ], { path: '正文/第001章.md', kind: 'chapter' })

  assert.equal(decision.winner.paneId, 'novel.shelf')
  assert.equal(decision.considered.some((pane) => pane.paneId === 'novel.editor'), false, '无 claims 的 pane 连参评都算不上')
})
