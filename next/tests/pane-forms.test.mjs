import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PANE_FORM,
  PANE_FORMS,
  PANE_FORM_LABELS,
  PANE_FORM_STORAGE_PREFIX,
  createPaneFormStore,
  getPaneForm,
  hostPaneForms,
  isPaneForm,
  paneFormStorageKey,
  resetPaneForms,
  sanitizePaneForms,
  setPaneForm,
  subscribePaneForms
} from '../shell/paneForms.mjs'

/**
 * 多形态打开的状态机单测（协议 v1.2 P18–P21）。
 * 纯 node:test：paneForms.mjs 不 import Vue，状态机与持久化都能脱离浏览器直接测。
 */

/** 最小的 localStorage 替身：只实现 getItem/setItem，另给 dump() 方便断言键值。 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    dump() {
      return Object.fromEntries(map)
    }
  }
}

test('P18 形态词表：四档固定，词表外形态被过滤（不出现、也不进状态机）', () => {
  assert.deepEqual(PANE_FORMS, ['dock', 'split', 'overlay', 'fullscreen'])
  assert.equal(DEFAULT_PANE_FORM, 'dock')
  assert.deepEqual(Object.keys(PANE_FORM_LABELS), [...PANE_FORMS])
  assert.equal(PANE_FORM_STORAGE_PREFIX, 'paneForm.')
  assert.equal(paneFormStorageKey('novel.editor'), 'paneForm.novel.editor')

  for (const form of PANE_FORMS) assert.equal(isPaneForm(form), true)
  for (const bad of ['window', '', null, undefined, 'DOCK', 'split-left']) {
    assert.equal(isPaneForm(bad), false, `词表外形态不应通过：${String(bad)}`)
  }
  // 去重 + 按宿主词表顺序；未知形态静默剔除（P18：未声明的形态不出现）。
  assert.deepEqual(sanitizePaneForms(['split', 'window', 'dock', 'split']), ['dock', 'split'])
  assert.deepEqual(sanitizePaneForms(null), [])
  assert.deepEqual(sanitizePaneForms('split'), [])

  const storage = memoryStorage()
  const store = createPaneFormStore({ storage })
  assert.equal(store.get('novel.editor'), 'dock')
  const rejected = store.set('novel.editor', 'window')
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'UNKNOWN_PANE_FORM')
  assert.equal(store.get('novel.editor'), 'dock', '拒绝的形态不能改状态')
  assert.deepEqual(storage.dump(), {}, '拒绝的形态不能落盘')
  assert.equal(store.set('', 'split').error.code, 'INVALID_PANE_ID')
})

test('P21 状态机：默认 dock、切换、幂等、订阅快照、每 pane 独立', () => {
  const storage = memoryStorage()
  const store = createPaneFormStore({ storage })
  const snapshots = []
  const unsubscribe = store.subscribe((snapshot) => snapshots.push(snapshot))

  assert.equal(store.get('novel.editor'), 'dock', '没设过＝缺省 dock')
  assert.deepEqual(store.snapshot(), {})

  const first = store.set('novel.editor', 'split')
  assert.deepEqual(first, { ok: true, changed: true, paneId: 'novel.editor', form: 'split', previous: 'dock' })
  assert.equal(store.get('novel.editor'), 'split')
  assert.deepEqual(store.snapshot(), { 'novel.editor': 'split' })
  assert.deepEqual(snapshots.at(-1), { 'novel.editor': 'split' })

  // 同值再设：幂等，不落盘第二次、不通知订阅者。
  const before = snapshots.length
  const again = store.set('novel.editor', 'split')
  assert.equal(again.ok, true)
  assert.equal(again.changed, false)
  assert.equal(snapshots.length, before, '幂等切换不应发通知')

  store.set('novel.editor', 'fullscreen')
  store.set('outline.widget', 'overlay')
  assert.deepEqual(store.snapshot(), { 'novel.editor': 'fullscreen', 'outline.widget': 'overlay' })
  assert.equal(store.get('notes.editor'), 'dock', '不同 pane 互不干扰')

  unsubscribe()
  store.set('novel.editor', 'dock')
  assert.equal(snapshots.at(-1)['novel.editor'], 'fullscreen', '取消订阅后不再收快照')

  store.reset()
  assert.deepEqual(store.snapshot(), {})
  assert.equal(store.get('novel.editor'), 'dock')
})

test('持久化：键 paneForm.<paneId> 写入；新实例 hydrate 读回；坏值与抛错存储都不拦状态', () => {
  const storage = memoryStorage()
  const first = createPaneFormStore({ storage })
  first.set('novel.editor', 'split')
  first.set('outline.widget', 'overlay')
  assert.deepEqual(storage.dump(), {
    'paneForm.novel.editor': 'split',
    'paneForm.outline.widget': 'overlay'
  })

  // 新实例＝下一次启动：hydrate 把已存形态读回。
  const second = createPaneFormStore({ storage })
  assert.equal(second.get('novel.editor'), 'dock')
  second.hydrate(['novel.editor', 'outline.widget'])
  assert.equal(second.get('novel.editor'), 'split')
  assert.equal(second.get('outline.widget'), 'overlay')

  // 同一实例里改过之后，旧存储值不许再把内存状态覆盖回去（hydrated 只读一次）。
  second.set('novel.editor', 'fullscreen')
  second.hydrate(['novel.editor'])
  assert.equal(second.get('novel.editor'), 'fullscreen')

  // 坏值（词表外／空串）当作没存过：留在缺省 dock。
  const dirty = memoryStorage({ 'paneForm.x.y': 'window', 'paneForm.z.w': '' })
  const third = createPaneFormStore({ storage: dirty })
  third.hydrate(['x.y', 'z.w'])
  assert.equal(third.get('x.y'), 'dock')
  assert.equal(third.get('z.w'), 'dock')

  // 隐私模式/配额：getItem/setItem 抛错也不能拦切换与 hydrate。
  const hostile = {
    getItem() { throw new Error('denied') },
    setItem() { throw new Error('denied') }
  }
  const fourth = createPaneFormStore({ storage: hostile })
  assert.doesNotThrow(() => fourth.hydrate(['a.b']))
  const result = fourth.set('a.b', 'overlay')
  assert.equal(result.ok, true)
  assert.equal(fourth.get('a.b'), 'overlay', '落盘失败时本次会话仍然生效')
})

test('宿主统一 API：setPaneForm / getPaneForm 走同一份 module 单例，订阅可收到通知', () => {
  resetPaneForms()
  const snapshots = []
  const unsubscribe = subscribePaneForms((snapshot) => snapshots.push(snapshot))
  const result = setPaneForm('host.pane', 'overlay')
  assert.equal(result.ok, true)
  assert.equal(result.changed, true)
  assert.equal(getPaneForm('host.pane'), 'overlay')
  assert.deepEqual(hostPaneForms.snapshot(), { 'host.pane': 'overlay' })
  assert.deepEqual(snapshots.at(-1), { 'host.pane': 'overlay' })
  assert.equal(setPaneForm('host.pane', 'nope').error.code, 'UNKNOWN_PANE_FORM')
  assert.equal(getPaneForm('host.pane'), 'overlay')
  unsubscribe()
  resetPaneForms()
  assert.equal(getPaneForm('host.pane'), 'dock')
  assert.deepEqual(hostPaneForms.snapshot(), {})
})
