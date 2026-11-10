import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionStore } from '../shell/agentSessions.mjs'
import { createSessionStore as createCoreSessionStore } from '@pinax/core/agent/fileSessionState'

/**
 * T11c：`next/shell/agentSessions.mjs` 的 `persist()` 与 core `agent/fileSessionState` 对表。
 *
 * T11b 对表时发现两处唯一漂移就是 `persist()`：core 0.11 起把**异步失败回执**（`false`／`{ok:false}`）
 * 也当降级处理（`degraded=true`＋通知），宿主侧异步路径此前一律返回成功——主进程拒写时
 * 界面会一直显示「已持久化」。本批把宿主对齐到 core 口径，这份用例逐格验同一件事：
 *
 *   同一组 save 行为（同步／异步、成功／失败／回执失败／抛错），
 *   宿主 store 与 core store 的 `persistent` 轨迹必须**逐格相同**，
 *   且失败结局都必须推出一次 `persistent=false` 的快照（不再假装成功）。
 *
 * 六格里的期望值是 core 0.11 起的行为，不是照抄宿主实现：
 *   - 同步成功路径不变（返回 undefined／真值＝写成功，`persistent` 仍 true）；
 *   - 异步回执失败要等回执到达才降级（append 当刻仍 true，随后通知 false）；
 *   - 同步抛错／同步 `false`／`{ok:false}` 当场降级。
 */

const clock = (() => {
  let value = 1_760_000_000_000
  return () => (value += 1_000)
})()

/** 等异步 save 的回执落地（Promise 链＋notify 都跑完）。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 跑一格：注入某一种 save，追加一条消息，记下 `persistent` 的同步态与随后收到的通知。
 * `makeSave()` 返回 null 表示这一格不注入 save（没打开项目／没桥）。
 */
async function observe(createStore, makeSave, asyncSettle) {
  const save = makeSave()
  const store = createStore('D:/t11c', save ? { save, now: clock } : { now: clock })
  const notified = []
  store.subscribe((snapshot) => notified.push(snapshot.persistent))

  store.append({ role: 'user', text: '这一问落盘会不会坏？' })
  const afterAppend = store.snapshot().persistent
  const notifiedAtAppend = notified.length

  if (asyncSettle) await settle()

  return {
    afterAppend,
    finalPersistent: store.snapshot().persistent,
    // append 当刻已推的快照数（后面再推的就是「晚到的降级通知」）。
    notifiedAtAppend,
    lateNotifiedUnpersistent: notified.slice(notifiedAtAppend).includes(false),
    trajectory: notified,
    messages: store.active().messages.length
  }
}

/**
 * 六格 save 行为。`persistentAfterAppend`／`persistentFinal`／`lateNotifiedUnpersistent`
 * 是 core 口径下的期望值（见文件头）；`asyncSettle` 表示要等异步回执。
 */
const CASES = [
  {
    name: '不注入 save：只在内存，不假装持久化',
    makeSave: () => null,
    asyncSettle: false,
    persistentAfterAppend: false,
    persistentFinal: false,
    lateNotifiedUnpersistent: false
  },
  {
    name: '同步成功（返回 undefined）：同步成功路径不变',
    makeSave: () => () => undefined,
    asyncSettle: false,
    persistentAfterAppend: true,
    persistentFinal: true,
    lateNotifiedUnpersistent: false
  },
  {
    name: '同步成功（返回 true）：同步成功路径不变',
    makeSave: () => () => true,
    asyncSettle: false,
    persistentAfterAppend: true,
    persistentFinal: true,
    lateNotifiedUnpersistent: false
  },
  {
    name: '同步拒写（返回 false）：当场降级',
    makeSave: () => () => false,
    asyncSettle: false,
    persistentAfterAppend: false,
    persistentFinal: false,
    lateNotifiedUnpersistent: false
  },
  {
    name: '同步拒写（回执 {ok:false}）：当场降级，不把回执当成功',
    makeSave: () => () => ({ ok: false, error: { code: 'PINAX_INVALID_INPUT' } }),
    asyncSettle: false,
    persistentAfterAppend: false,
    persistentFinal: false,
    lateNotifiedUnpersistent: false
  },
  {
    name: '同步抛错：当场降级（既有行为）',
    makeSave: () => () => { throw new Error('ipc 断了') },
    asyncSettle: false,
    persistentAfterAppend: false,
    persistentFinal: false,
    lateNotifiedUnpersistent: false
  },
  {
    name: '异步成功（回执 {ok:true}）：保持持久化，不推降级通知',
    makeSave: () => () => Promise.resolve({ ok: true, value: null }),
    asyncSettle: true,
    persistentAfterAppend: true,
    persistentFinal: true,
    lateNotifiedUnpersistent: false
  },
  {
    name: '异步失败回执 {ok:false}：回执到达即降级＋通知（core 0.11 口径）',
    makeSave: () => () => Promise.resolve({ ok: false, error: { code: 'PINAX_INVALID_INPUT' } }),
    asyncSettle: true,
    persistentAfterAppend: true,
    persistentFinal: false,
    lateNotifiedUnpersistent: true
  },
  {
    name: '异步失败回执 false：回执到达即降级＋通知',
    makeSave: () => () => Promise.resolve(false),
    asyncSettle: true,
    persistentAfterAppend: true,
    persistentFinal: false,
    lateNotifiedUnpersistent: true
  },
  {
    name: '异步拒绝（磁盘满／进程崩）：回执到达即降级＋通知（既有行为）',
    makeSave: () => () => Promise.reject(new Error('磁盘满')),
    asyncSettle: true,
    persistentAfterAppend: true,
    persistentFinal: false,
    lateNotifiedUnpersistent: true
  }
]

test('T11c persist 对表：宿主与 core 在同一组 save 行为下 persistent 轨迹逐格一致', async () => {
  for (const item of CASES) {
    const host = await observe(createSessionStore, item.makeSave, item.asyncSettle)
    const core = await observe(createCoreSessionStore, item.makeSave, item.asyncSettle)

    // 第一层：宿主自己的行为符合 core 口径（失败回执不再假装成功）。
    assert.equal(host.afterAppend, item.persistentAfterAppend, `${item.name}：append 当刻的 persistent`)
    assert.equal(host.finalPersistent, item.persistentFinal, `${item.name}：回执落地后的 persistent`)
    assert.equal(host.lateNotifiedUnpersistent, item.lateNotifiedUnpersistent, `${item.name}：是否晚推降级通知`)
    assert.equal(host.messages, 1, `${item.name}：落盘成败不许动内存里的会话`)

    // 第二层：与 core 逐格一致（包括通知次数——多推或漏推都算漂移）。
    assert.deepEqual(host, core, `${item.name}：宿主与 core 的 persistent 轨迹必须相同`)
  }
})
