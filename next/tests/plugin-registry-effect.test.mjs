import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { createServiceLogPool } from '../runtime/serviceLogPool.mjs'
import { projectEventSubscriberCount, subscribeProjectEventsEffect } from '../runtime/eventBus.mjs'
import { CUSTOM_VIEW_TYPE, createViewRegistry, registerViewEffect } from '../shell/viewRegistry.mjs'
import { attachPanelBridgeEffect } from '../shell/pluginBridge.mjs'
import { FIXTURE_NOVEL } from '../testing/fixtures.mjs'

/**
 * 批次51 · 可逆效应纪律的门禁。
 *
 * 三条硬断言（工单 §5 原样）：
 *   ① 不返回 disposer 的注册被拒（INVALID_EFFECT）；
 *   ② 卸载后事件总线上该插件的监听器数量为 0（用 eventBus 的可观测计数，不靠「没报错」间接判）；
 *   ③ 一个 disposer 抛错时其余仍被执行，且逆序顺序正确（失败要进 serviceLogPool 的 error 条目）。
 *
 * 另外钉住两条迁移面的真效果：视图注册与面板桥监听都能被效应回卷真正拆掉。
 */

const KINDS = ['novel', 'screenplay', 'generic']

function makeRegistry(options = {}) {
  return createRegistry({ kinds: KINDS, ...options })
}

function installFixture(registry) {
  const installed = registry.install(FIXTURE_NOVEL)
  assert.equal(installed.ok, true, JSON.stringify(installed.error ?? {}))
}

test('① 不返回 disposer 的注册被拒：undefined／null／空数组／坏元素一律 INVALID_EFFECT', () => {
  const registry = makeRegistry()
  installFixture(registry)
  const badSetups = [
    () => undefined,
    () => null,
    () => [],
    () => [() => {}, 'not-a-function']
  ]
  for (const setup of badSetups) {
    const result = registry.registerEffect('fixture.novel', setup, '坏效应')
    assert.equal(result.ok, false, `setup=${String(setup)} 应被拒`)
    assert.equal(result.error.code, NEXT_ERROR_CODES.INVALID_EFFECT)
  }
  assert.equal(registry.effectCount('fixture.novel'), 0, '被拒的注册不得留在效应栈里')

  const setupThrows = registry.registerEffect('fixture.novel', () => { throw new Error('setup 里就炸了') })
  assert.equal(setupThrows.ok, false)
  assert.equal(setupThrows.error.code, NEXT_ERROR_CODES.INVALID_EFFECT)
  assert.match(setupThrows.error.message, /setup 里就炸了/)
})

test('② 卸载后事件总线上该插件的监听器计数归零（可观测计数，不靠没报错）', () => {
  const registry = makeRegistry()
  installFixture(registry)
  const root = join(tmpdir(), 'pinax-next-effect-bus')
  const heard = []
  const subscribed = subscribeProjectEventsEffect(
    registry,
    'fixture.novel',
    root,
    (event) => heard.push(event),
    'fixture 订阅'
  )
  assert.equal(subscribed.ok, true, JSON.stringify(subscribed.error ?? {}))
  assert.equal(projectEventSubscriberCount(root), 1)
  assert.equal(projectEventSubscriberCount(root, 'fixture.novel'), 1)

  const removed = registry.uninstall('fixture.novel')
  assert.equal(removed.ok, true)
  assert.equal(projectEventSubscriberCount(root, 'fixture.novel'), 0, '插件卸载后总线上它的监听器必须是 0')
  assert.equal(projectEventSubscriberCount(root), 0)
  assert.equal(heard.length, 0)
})

test('③ 一个 disposer 抛错时其余仍执行且逆序；失败进 serviceLogPool 的 error 条目', () => {
  const pool = createServiceLogPool()
  const registry = makeRegistry({ serviceLogPool: pool })
  installFixture(registry)
  const calls = []

  assert.equal(registry.registerEffect('fixture.novel', () => () => calls.push('first')).ok, true)
  assert.equal(registry.registerEffect('fixture.novel', () => [
    () => calls.push('second-1'),
    () => {
      calls.push('second-2')
      throw new Error('第二段炸了')
    }
  ]).ok, true)
  assert.equal(registry.registerEffect('fixture.novel', () => () => calls.push('third')).ok, true)

  const removed = registry.uninstall('fixture.novel')
  assert.equal(removed.ok, true)
  assert.deepEqual(calls, ['third', 'second-2', 'second-1', 'first'], '回卷必须整体逆序，且抛错不中断其余')

  const errors = pool.list({ level: 'error' })
  assert.equal(errors.length, 1, '每个失败的 disposer 要留一条 error')
  assert.match(errors[0].message, /第二段炸了/)
  assert.equal(errors[0].source.carrierId, 'fixture.novel')
  assert.equal(removed.value.disposed.some((entry) => entry.error), true, '失败要出现在 uninstall 的回执里')
})

test('向已卸载插件注册效应直接抛 EFFECT_ON_DISPOSED；重新 install 后恢复', () => {
  const registry = makeRegistry()
  installFixture(registry)
  registry.uninstall('fixture.novel')

  assert.throws(
    () => registry.registerEffect('fixture.novel', () => () => {}),
    (error) => error?.code === NEXT_ERROR_CODES.EFFECT_ON_DISPOSED
  )
  assert.equal(NEXT_ERROR_CODES.EFFECT_ON_DISPOSED, 'PINAX_EFFECT_ON_DISPOSED')

  installFixture(registry)
  const again = registry.registerEffect('fixture.novel', () => () => {})
  assert.equal(again.ok, true, '重新安装＝新生命周期，旧标记不得误伤')
})

test('视图注册走效应：插件卸载自动解注册，宿主内置视图不受影响', () => {
  const kernelRegistry = makeRegistry()
  installFixture(kernelRegistry)
  const views = createViewRegistry()
  views.registerView('pinax.view.tree', () => ({ kind: 'tree' }), { owner: 'host', builtin: true })

  const registered = registerViewEffect({
    kernelRegistry,
    viewRegistry: views,
    pluginId: 'fixture.novel',
    type: CUSTOM_VIEW_TYPE,
    factory: () => ({ kind: 'custom' })
  })
  assert.equal(registered.ok, true, JSON.stringify(registered.error ?? {}))
  assert.equal(views.resolve(CUSTOM_VIEW_TYPE).owner, 'fixture.novel')

  kernelRegistry.uninstall('fixture.novel')
  assert.equal(views.resolve(CUSTOM_VIEW_TYPE), null, '卸载后视图必须真的消失')
  assert.equal(views.resolve('pinax.view.tree').builtin, true, '宿主视图不能被谁的卸载带走')
})

test('面板桥监听走效应：单独回卷后 window 上的 message 监听器真的被移除', () => {
  const kernelRegistry = makeRegistry()
  installFixture(kernelRegistry)
  const target = {
    listeners: new Set(),
    addEventListener(type, fn) {
      if (type === 'message') this.listeners.add(fn)
    },
    removeEventListener(type, fn) {
      if (type === 'message') this.listeners.delete(fn)
    }
  }
  const requests = []
  const attached = attachPanelBridgeEffect({
    kernelRegistry,
    pluginId: 'fixture.novel',
    target,
    onRequest: (request) => requests.push(request)
  })
  assert.equal(attached.ok, true, JSON.stringify(attached.error ?? {}))
  assert.equal(target.listeners.size, 1, '登记效应时监听器要真加上')

  const [listener] = [...target.listeners]
  listener({
    data: {
      type: 'pinax.panel.callTool',
      id: 'call-1',
      name: 'pinax_material_list',
      arguments: { query: '雨' }
    }
  })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].name, 'pinax_material_list')

  const rolledBack = kernelRegistry.disposeEffects('fixture.novel')
  assert.equal(rolledBack.ok, true)
  assert.equal(target.listeners.size, 0, '回卷必须把监听器移除，不能只清记账')
})
