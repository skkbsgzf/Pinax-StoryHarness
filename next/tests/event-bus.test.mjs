import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  PROJECT_EVENT_KINDS,
  clearProjectEvents,
  emitProjectEvent,
  projectEventKindForPath,
  projectEventSubscriberCount,
  subscribeProjectEvents
} from '../runtime/eventBus.mjs'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { FIXTURE_NOVEL, withMutation } from '../testing/fixtures.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 项目事件总线（批次37 · 任务一）。
 * 守四条边界＋一条路径映射；再补一条「宿主真的替声明了 project.changed 的载体挂上了投递」，
 * 否则总线只是自娱自乐，M2.5-C 的 subscriptions 声明依旧没人兑现。
 */

test('事件类别是五类闭集，且路径映射只认目录首段与 .pinax 的两类元数据', () => {
  assert.deepEqual([...PROJECT_EVENT_KINDS], [
    'entries-changed',
    'outline-changed',
    'manuscript-changed',
    'sessions-changed',
    'proposals-changed'
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
  assert.deepEqual(heardA, [{ kind: 'manuscript-changed', at: '2026-10-30T01:02:03.000Z' }])
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
    assert.deepEqual(delivered[0].event, { kind: 'manuscript-changed', at: '2026-10-30T00:00:00.000Z' })
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
