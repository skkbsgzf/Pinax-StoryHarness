import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PROJECT_EVENT_KINDS,
  PROJECT_EVENT_TOPICS,
  clearProjectEvents,
  emitProjectEvent,
  projectEventKindForPath,
  projectEventKindsForTopic,
  projectEventSubscriberCount,
  projectEventTopicForKind,
  subscribeProjectEvents
} from '../runtime/eventBus.mjs'
import { CARRIER_SUBSCRIPTIONS } from '../kernel/carrierManifest.mjs'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { createFileService } from '../fs/fileService.mjs'
import { createFileWorkspaceStore } from '../workspaceStore.mjs'
import { FIXTURE_NOVEL, withMutation } from '../testing/fixtures.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 项目事件总线（批次37 · 任务一）。
 * 守四条边界＋一条路径映射；再补一条「宿主真的替声明了 project.changed 的载体挂上了投递」，
 * 否则总线只是自娱自乐，M2.5-C 的 subscriptions 声明依旧没人兑现。
 * 批次66 任务四再加两条：订阅词 ↔ kind 的同构表（词表三个都得有人覆盖），
 * 以及 file.changed／layout.changed 两个新事件的真实发射点（写盘一次，总线收到一次）。
 */

test('事件类别是七类闭集，且路径映射只认目录首段与 .pinax 的两类元数据', () => {
  assert.deepEqual([...PROJECT_EVENT_KINDS], [
    'entries-changed',
    'outline-changed',
    'manuscript-changed',
    'sessions-changed',
    'proposals-changed',
    'file-changed',
    'layout-changed'
  ])
  assert.equal(projectEventKindForPath('正文/第一卷/第一章.md'), 'manuscript-changed')
  assert.equal(projectEventKindForPath('大纲/第一卷.md'), 'outline-changed')
  for (const dir of ['世界书', '构思', '约束', '剧本', '资料']) {
    assert.equal(projectEventKindForPath(`${dir}/x.md`), 'entries-changed', dir)
  }
  assert.equal(projectEventKindForPath('.pinax/proposals/20261030-x.json'), 'proposals-changed')
  assert.equal(projectEventKindForPath('.pinax/sessions/ask-1.jsonl'), 'sessions-changed')
  // Windows 反斜杠、前导 ./ 与 / 都归一到同一套首段判断。
  assert.equal(projectEventKindForPath('.\\正文\\第一章.md'), 'manuscript-changed')
  assert.equal(projectEventKindForPath('./大纲/x.md'), 'outline-changed')
  // 认不出的不发「某处变了」：项目文件、日志、未知目录一律 null。
  assert.equal(projectEventKindForPath('project.json'), null)
  assert.equal(projectEventKindForPath('.pinax/logs/2026-10-30.log'), null)
  assert.equal(projectEventKindForPath('附件/图.png'), null)
  assert.equal(projectEventKindForPath(''), null)
  assert.equal(projectEventKindForPath(undefined), null)
})

test('同 root 广播、跨 root 隔离、退订幂等、订阅者抛错不拦别人', () => {
  clearProjectEvents()
  const rootA = join('tmp', '小说甲')
  const rootB = join('tmp', '小说乙')
  const heardA = []
  const heardB = []
  const offA = subscribeProjectEvents(rootA, (event) => heardA.push(event))
  subscribeProjectEvents(rootB, (event) => heardB.push(event))

  assert.equal(projectEventSubscriberCount(rootA), 1)
  assert.equal(emitProjectEvent(rootA, { kind: 'manuscript-changed', at: '2026-10-30T01:02:03.000Z' }), 1)
  // 负载恒定四个键（批次66）：kind／topic／at／path，取不到的摊成 null，订阅方不用逐次判形状。
  assert.deepEqual(heardA, [{ kind: 'manuscript-changed', topic: 'project.changed', at: '2026-10-30T01:02:03.000Z', path: null }])
  assert.equal(heardB.length, 0, '别的项目的订阅者不得收到')

  // 路径写法的差异必须落到同一个键：带尾分隔符与 resolve 后的等价写法。
  assert.equal(emitProjectEvent(`${rootA}${process.platform === 'win32' ? '\\' : '/'}`, { kind: 'outline-changed' }), 1)
  assert.equal(heardA.length, 2)

  offA()
  offA()
  offA()
  assert.equal(projectEventSubscriberCount(rootA), 0, '退订幂等且退干净')
  assert.equal(emitProjectEvent(rootA, { kind: 'outline-changed' }), 0)

  // 一个坏订阅者不阻止另一个收到；bad 的异常也不外抛。
  const good = []
  subscribeProjectEvents(rootA, () => { throw new Error('订阅者坏了') })
  subscribeProjectEvents(rootA, (event) => good.push(event.kind))
  assert.equal(emitProjectEvent(rootA, { kind: 'entries-changed' }), 1)
  assert.deepEqual(good, ['entries-changed'])
  clearProjectEvents()
})

test('空 root / 空 kind / 无订阅者时 emit 是空操作；payload 是拷贝且自动补 at', () => {
  clearProjectEvents()
  assert.equal(emitProjectEvent('', { kind: 'entries-changed' }), 0)
  assert.equal(emitProjectEvent('tmp/某项目', {}), 0)
  assert.equal(emitProjectEvent('tmp/某项目', { kind: 'entries-changed' }), 0)

  const received = []
  subscribeProjectEvents('tmp/某项目', (event) => received.push(event))
  emitProjectEvent('tmp/某项目', { kind: 'entries-changed' })
  assert.equal(received.length, 1)
  assert.equal(received[0].kind, 'entries-changed')
  assert.match(received[0].at, /^\d{4}-\d{2}-\d{2}T/u, '缺省 at 是 ISO 时刻')

  const first = received[0]
  first.kind = '被订阅者改坏'
  assert.equal(emitProjectEvent('tmp/某项目', { kind: 'outline-changed' }), 1)
  assert.equal(received[1].kind, 'outline-changed', '每次投递是独立拷贝')

  // 非函数 handler 与空 root 都返回空退订，调用方不必先判空。
  assert.equal(typeof subscribeProjectEvents('tmp/某项目', null), 'function')
  assert.equal(typeof subscribeProjectEvents('', () => {}), 'function')
  clearProjectEvents()
})

test('宿主替声明 project.changed 的载体挂投递：start 订阅当前根、stop 退订，没声明的收不到', async () => {
  clearProjectEvents()
  const workspace = await createTempWorkspace('event-bus')
  const root = join(workspace.projects, '事件靶子')
  const delivered = []
  const noisy = withMutation(FIXTURE_NOVEL, (manifest) => {
    manifest.subscriptions = ['project.changed']
  })
  const silent = withMutation(FIXTURE_NOVEL, (manifest) => {
    manifest.id = 'fixture.silent'
    manifest.title = '不订阅的（夹具）'
    manifest.dataDirs = {}
    manifest.tools = []
    manifest.scopes = []
    manifest.panes = [{ slot: 'right', id: 'silent', title: '静默板' }]
    manifest.primary = false
  })
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  registry.install(noisy, { onProjectEvent: (event, meta) => delivered.push({ event, meta }) })
  registry.install(silent, { onProjectEvent: (event) => delivered.push({ event, silent: true }) })
  const created = await createProject({ root, name: '事件靶子', primaryCarrier: 'fixture.novel', registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  try {
    const started = await runtime.start()
    assert.equal(started.ok, true, JSON.stringify(started.error ?? {}))
    assert.equal(started.value.subscribedCarriers, 1)
    assert.deepEqual(runtime.surfaceInfo().subscribedCarriers, ['fixture.novel'])
    assert.equal(projectEventSubscriberCount(root), 1, '宿主必须真的在总线上了')

    assert.equal(emitProjectEvent(root, { kind: 'manuscript-changed', at: '2026-10-30T00:00:00.000Z' }), 1)
    assert.equal(delivered.length, 1)
    assert.deepEqual(delivered[0].event, { kind: 'manuscript-changed', topic: 'project.changed', at: '2026-10-30T00:00:00.000Z', path: null })
    assert.deepEqual(delivered[0].meta, { pluginId: 'fixture.novel' })
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
  assert.equal(projectEventSubscriberCount(root), 0, 'stop 之后旧根的投递必须摘掉')
  emitProjectEvent(root, { kind: 'manuscript-changed' })
  assert.equal(delivered.length, 1)
  clearProjectEvents()
})

test('投递不因载体处理器抛错而中断别的订阅者', async () => {
  clearProjectEvents()
  const workspace = await createTempWorkspace('event-bus-throw')
  const root = join(workspace.projects, '坏处理器')
  const received = []
  const noisy = withMutation(FIXTURE_NOVEL, (manifest) => {
    manifest.subscriptions = ['project.changed']
  })
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  registry.install(noisy, { onProjectEvent: () => { throw new Error('载体处理器炸了') } })
  const created = await createProject({ root, name: '坏处理器', primaryCarrier: 'fixture.novel', registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  try {
    await runtime.start()
    // 另一个独立订阅者照常收到：投递隔离在 deliverProjectEvent 内部，总线本身不被拖垮。
    subscribeProjectEvents(root, (event) => received.push(event.kind))
    assert.equal(emitProjectEvent(root, { kind: 'entries-changed' }), 2)
    assert.deepEqual(received, ['entries-changed'])
  } finally {
    await runtime.stop()
    clearProjectEvents()
    await workspace.cleanup()
  }
})

/* —— 批次66 任务四：订阅词表扩展与两处真实发射点 ————————————————————————— */

test('订阅词 ↔ kind 同构：三个词都有 kind 覆盖，七个 kind 都归得到一个词', () => {
  assert.deepEqual([...CARRIER_SUBSCRIPTIONS], ['project.changed', 'file.changed', 'layout.changed'])
  // 表不重复、不漏项：PROJECT_EVENT_TOPICS 的键集必须与 kind 闭集一模一样。
  assert.deepEqual(Object.keys(PROJECT_EVENT_TOPICS).sort(), [...PROJECT_EVENT_KINDS].sort())
  for (const kind of PROJECT_EVENT_KINDS) {
    assert.ok(CARRIER_SUBSCRIPTIONS.includes(projectEventTopicForKind(kind)), `${kind} 归到了一个不在词表里的词`)
  }
  // 反查闭合：按词取回的 kind，再问它的词，必须回到同一个词；词的 kind 数合计＝kind 总数（没有孤儿）。
  let covered = 0
  for (const topic of CARRIER_SUBSCRIPTIONS) {
    const kinds = projectEventKindsForTopic(topic)
    assert.ok(kinds.length, `${topic} 这个订阅词没有任何 kind 覆盖（声明了却没人发）`)
    for (const kind of kinds) assert.equal(projectEventTopicForKind(kind), topic, kind)
    covered += kinds.length
  }
  assert.equal(covered, PROJECT_EVENT_KINDS.length, '词表与 kind 必须严丝合缝：既不重复也不漏')
  assert.equal(projectEventKindsForTopic('project.changed').length, 5, '批次37 那五类仍归 project.changed')
  assert.deepEqual(projectEventKindsForTopic('selection.changed'), [], '登记不做的词不许有 kind 落进来')
  assert.equal(projectEventTopicForKind('没听过的类别'), null, '认不出不猜近义')
})

test('挑词的订阅者只收自己那个词覆盖的 kind；不挑词的照旧全收（批次39 行为逐字不变）', () => {
  clearProjectEvents()
  const root = join('tmp', '挑词的订阅者')
  const files = []
  const coarse = []
  const all = []
  subscribeProjectEvents(root, (event) => files.push(event.path), { subscriptions: ['file.changed'] })
  subscribeProjectEvents(root, (event) => coarse.push(event.kind), { subscriptions: ['project.changed'] })
  subscribeProjectEvents(root, (event) => all.push(event.kind))
  assert.equal(projectEventSubscriberCount(root), 3)

  // 细的那条：只有挑了 file.changed 的和不挑词的两家收到；挑 project.changed 的那家不该被细事件打扰。
  assert.equal(emitProjectEvent(root, { kind: 'file-changed', path: '正文/第一章.md' }), 2)
  assert.deepEqual(files, ['正文/第一章.md'])
  assert.deepEqual(coarse, [])
  assert.deepEqual(all, ['file-changed'])

  // 粗的那条反过来：三家都收（file.changed 那家除外）。
  assert.equal(emitProjectEvent(root, { kind: 'manuscript-changed' }), 2)
  assert.deepEqual(coarse, ['manuscript-changed'])
  assert.equal(files.length, 1, '粗类别不该打进只挑 file.changed 的订阅者')

  // 布局那条：谁也没挑 layout.changed，只有不挑词的那家收到。
  assert.equal(emitProjectEvent(root, { kind: 'layout-changed', path: '.pinax/workspace.json' }), 1)
  assert.deepEqual(all, ['file-changed', 'manuscript-changed', 'layout-changed'])

  // 空数组＝不挑词（与不传一致）：调用方那边的「没声明就不订阅」才是排除的地方。
  const loose = []
  subscribeProjectEvents(root, (event) => loose.push(event.kind), { subscriptions: [] })
  assert.equal(emitProjectEvent(root, { kind: 'layout-changed' }), 2)
  assert.deepEqual(loose, ['layout-changed'])

  // 拼错的词＝什么都收不到（不猜近义，也不静默降级成全收）：三家里收到的是 files／all／loose。
  const typo = []
  subscribeProjectEvents(root, (event) => typo.push(event.kind), { subscriptions: ['file.change'] })
  assert.equal(emitProjectEvent(root, { kind: 'file-changed' }), 3)
  assert.deepEqual(typo, [])
  clearProjectEvents()
})

test('file.changed 的真实发射点：一次受控写盘，细的那条先上总线，粗的那条随后到', async () => {
  clearProjectEvents()
  const workspace = await createTempWorkspace('event-file-changed')
  const root = await workspace.projectPath('落盘靶子')
  for (const dir of PROJECT_KINDS.novel) await mkdir(join(root, dir), { recursive: true })
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  registry.install(FIXTURE_NOVEL)
  // 宿主那条写入钩子住在 main.mjs（不在本批允许文件内），这里按同一口径把「目录首段 → 粗类别」补一次，
  // 测的就是细的（fileService 自己发）与粗的（钩子发）在同一次落盘里的先后。
  const service = createFileService({
    root,
    registry,
    onWrite: ({ relativePath }) => {
      const kind = projectEventKindForPath(relativePath)
      if (kind) emitProjectEvent(root, { kind })
    }
  })
  await service.init()
  const heard = []
  subscribeProjectEvents(root, (event) => heard.push({ kind: event.kind, topic: event.topic, path: event.path }))
  try {
    const wrote = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-雨夜.md', text: '雨从檐口滴下来。\n', expectedRevision: 0 })
    assert.equal(wrote.ok, true, JSON.stringify(wrote.error ?? {}))
    // 两条都在：细的（file-changed，带路径）先，粗的（manuscript-changed，按目录归类）后。
    assert.deepEqual(heard.map((item) => item.kind), ['file-changed', 'manuscript-changed'])
    assert.deepEqual(heard[0], { kind: 'file-changed', topic: 'file.changed', path: '正文/第001章-雨夜.md' })
    assert.equal(heard[1].topic, 'project.changed', '五类老 kind 的订阅词没变')
    assert.equal(heard[1].path, null, '粗类别历史上不带路径，摊成 null 而不是缺键')

    heard.length = 0
    const proposal = await service.writeProposal({ name: 'p-1.json', text: '{"kind":"patch"}' })
    assert.equal(proposal.ok, true, JSON.stringify(proposal.error ?? {}))
    assert.deepEqual(heard.map((item) => item.kind), ['file-changed', 'proposals-changed'])
    assert.equal(heard[0].path, '.pinax/proposals/p-1.json')

    // 写入失败的落盘不发事件：闸拦下的那次磁盘一个字都没动，总线也不该收到「某份文件变了」。
    heard.length = 0
    const stale = await service.write({ pluginId: 'fixture.novel', dir: '正文', file: '第001章-雨夜.md', text: '再改一次。\n', expectedRevision: 0 })
    assert.equal(stale.ok, false)
    assert.equal(stale.error?.code, 'PINAX_STALE_REVISION')
    assert.deepEqual(heard, [], '被拒的写入不产生 file.changed')
  } finally {
    clearProjectEvents()
    await workspace.cleanup()
  }
})

test('layout.changed 的真实发射点：workspace.json 真落一次盘发一条，内容没变被跳过的那次不发假的', async () => {
  clearProjectEvents()
  const workspace = await createTempWorkspace('event-layout-changed')
  const root = join(workspace.projects, '布局靶子')
  const heard = []
  subscribeProjectEvents(root, (event) => heard.push({ kind: event.kind, topic: event.topic, path: event.path }))
  try {
    const store = createFileWorkspaceStore({ root })
    const snapshot = {
      version: 3,
      entries: { 'novel.editor#1': { instance: 'novel.editor#1', pane: 'novel.editor', resource: 'chapter:正文/第001章-雨夜.md', group: 'main', order: 1, form: 'page' } },
      active: { main: 'novel.editor#1', side: null },
      focus: 'main',
      lastOpenFiles: [{ pane: 'novel.editor', resource: 'chapter:正文/第001章-雨夜.md' }]
    }
    const first = await store.write(snapshot)
    assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
    assert.deepEqual(heard, [{ kind: 'layout-changed', topic: 'layout.changed', path: '.pinax/workspace.json' }])

    // 同一份内容再交一次：规矩 3「内容没变就不写」，于是也不发事件（发了就是假事件）。
    const again = await store.write(snapshot)
    assert.equal(again.ok, true)
    assert.equal(again.value.skipped, true)
    assert.equal(heard.length, 1, '被跳过的那次写盘不许再发一条 layout.changed')

    // 换了形态＝内容真的变了：落盘、发第二条。
    const moved = await store.write({ ...snapshot, entries: { 'novel.editor#1': { ...snapshot.entries['novel.editor#1'], form: 'tab' } } })
    assert.equal(moved.ok, true)
    assert.equal(moved.value.skipped, false)
    assert.equal(heard.length, 2)

    // 被拒的快照（不是工作区形状）不落盘，当然也不发。
    const rejected = await store.write({ version: 3, entries: [] })
    assert.equal(rejected.ok, false)
    assert.equal(heard.length, 2)
  } finally {
    clearProjectEvents()
    await workspace.cleanup()
  }
})

test('新事件沿批次39 那条投递链送到载体的 onProjectEvent：负载带 topic／path，投递名单不因扩词表而变', async () => {
  clearProjectEvents()
  const workspace = await createTempWorkspace('event-deliver-new')
  const root = join(workspace.projects, '新事件靶子')
  const delivered = []
  const noisy = withMutation(FIXTURE_NOVEL, (manifest) => {
    manifest.subscriptions = ['project.changed', 'file.changed', 'layout.changed']
  })
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  registry.install(noisy, { onProjectEvent: (event, meta) => delivered.push({ event, meta }) })
  const created = await createProject({ root, name: '新事件靶子', primaryCarrier: 'fixture.novel', registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  try {
    const started = await runtime.start()
    assert.equal(started.value.subscribedCarriers, 1, '声明了订阅词的载体仍在宿主投递名单里')
    assert.equal(emitProjectEvent(root, { kind: 'file-changed', path: '正文/第001章-雨夜.md' }), 1)
    assert.deepEqual(delivered[0].event, { kind: 'file-changed', topic: 'file.changed', at: delivered[0].event.at, path: '正文/第001章-雨夜.md' })
    assert.deepEqual(delivered[0].meta, { pluginId: 'fixture.novel' })
    assert.equal(emitProjectEvent(root, { kind: 'layout-changed', path: '.pinax/workspace.json' }), 1)
    assert.equal(delivered[1].event.topic, 'layout.changed')
  } finally {
    await runtime.stop()
    clearProjectEvents()
    await workspace.cleanup()
  }
})
