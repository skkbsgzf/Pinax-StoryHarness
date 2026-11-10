import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_HISTORY_INTERVAL_MINUTES,
  MAX_HISTORY_INTERVAL_MINUTES,
  createHistoryScheduler
} from '../runtime/historyScheduler.mjs'
import { HISTORY_ERROR_CODES, ensureHistoryRepo, markDirty } from '../history/gitHistory.mjs'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'

/**
 * 历史定时调度（D1 → 工单E3 仓内固化）：批次14 只用临时 smoke 验过，这里把那份证据固定成单测。
 * 覆盖：默认 5 分钟、0＝关闭、非法值拒绝、定时器 unref、重启清旧表、requestCommit 串行、
 * probe 仓库缺失、beforeQuit 有根/无根，以及 projectClose 停表的分发器接线。
 * 真仓库用例走 os.tmpdir＋真 gitHistory（与 history-git.test.mjs 同一惯例），不碰作者原稿。
 */

/** 假表：记录 setInterval 的间隔与句柄，clearInterval 单独记账——不靠 sleep 等真实时间。 */
function fakeClock() {
  const intervals = []
  const cleared = []
  const setIntervalFn = (fn, ms) => {
    const handle = { fn, ms, unrefed: false, cleared: false, unref() { this.unrefed = true; return this } }
    intervals.push(handle)
    return handle
  }
  const clearIntervalFn = (handle) => {
    if (handle) handle.cleared = true
    cleared.push(handle)
  }
  return { intervals, cleared, setIntervalFn, clearIntervalFn }
}

async function makeHistoryProject(t) {
  const root = await mkdtemp(join(tmpdir(), 'pinax-history-sched-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }))
  for (const dir of ['正文', '大纲', '世界书', '构思', '约束', '资料']) {
    await mkdir(join(root, dir), { recursive: true })
  }
  await mkdir(join(root, '.pinax'), { recursive: true })
  await writeFile(join(root, '.pinax', 'project.json'), '{"spec":"pinax-project@2","name":"调度测试"}\n', 'utf-8')
  const ensured = await ensureHistoryRepo({ root })
  assert.equal(ensured.ok, true, JSON.stringify(ensured.error ?? {}))
  return root
}

test('默认间隔 5 分钟：start 后起一枚定时器且 unref（不拖住进程退出）', () => {
  const clock = fakeClock()
  const scheduler = createHistoryScheduler({ setIntervalFn: clock.setIntervalFn, clearIntervalFn: clock.clearIntervalFn })
  assert.equal(DEFAULT_HISTORY_INTERVAL_MINUTES, 5)

  const started = scheduler.start({ root: 'D:/工作区/靶子' })
  assert.equal(started.ok, true, JSON.stringify(started.error ?? {}))
  assert.equal(started.value.intervalMinutes, 5)
  assert.equal(started.value.running, true)
  assert.equal(clock.intervals.length, 1)
  assert.equal(clock.intervals[0].ms, 5 * 60_000)
  assert.equal(clock.intervals[0].unrefed, true, '定时器必须 unref')

  scheduler.stop()
})

test('0＝关闭定时提交；缺 root 与非法间隔一律 typed INVALID_INPUT', () => {
  const clock = fakeClock()
  const scheduler = createHistoryScheduler({ setIntervalFn: clock.setIntervalFn, clearIntervalFn: clock.clearIntervalFn })

  const on = scheduler.start({ root: 'D:/工作区/靶子' })
  assert.equal(on.value.running, true)
  const firstTimer = clock.intervals.at(-1)

  const off = scheduler.start({ root: 'D:/工作区/靶子', intervalMinutes: 0 })
  assert.equal(off.ok, true)
  assert.equal(off.value.running, false)
  assert.equal(off.value.intervalMinutes, 0)
  assert.equal(firstTimer.cleared, true, '改 0 必须把旧定时器清掉')
  assert.equal(clock.intervals.length, 1, '0 不再起新表')

  for (const bad of [-1, MAX_HISTORY_INTERVAL_MINUTES + 1, 5.5, 'abc', {}]) {
    const rejected = scheduler.start({ root: 'D:/工作区/靶子', intervalMinutes: bad })
    assert.equal(rejected.ok, false, `应拒绝间隔：${JSON.stringify(bad)}`)
    assert.equal(rejected.error.code, HISTORY_ERROR_CODES.INVALID_INPUT)
    assert.match(rejected.error.message, /intervalMinutes/)
  }

  const noRoot = scheduler.start({})
  assert.equal(noRoot.ok, false)
  assert.equal(noRoot.error.code, HISTORY_ERROR_CODES.INVALID_INPUT)
  assert.match(noRoot.error.message, /需要项目根 root/)
})

test('重启（换项目/换间隔）先清旧表；stop 幂等', () => {
  const clock = fakeClock()
  const scheduler = createHistoryScheduler({ setIntervalFn: clock.setIntervalFn, clearIntervalFn: clock.clearIntervalFn })

  scheduler.start({ root: 'D:/工作区/甲', intervalMinutes: 3 })
  const first = clock.intervals.at(-1)
  const restarted = scheduler.start({ root: 'D:/工作区/乙', intervalMinutes: 10 })
  assert.equal(restarted.ok, true)
  assert.equal(first.cleared, true, '换项目必须先清旧表')
  assert.equal(clock.intervals.at(-1).ms, 10 * 60_000)
  assert.equal(scheduler.status().value.root.endsWith('乙'), true)
  assert.equal(scheduler.status().value.intervalMinutes, 10)

  scheduler.stop()
  const stopped = scheduler.status()
  assert.equal(stopped.value.running, false)
  assert.equal(clock.intervals.at(-1).cleared, true)
  scheduler.stop()
  assert.equal(scheduler.status().value.running, false, 'stop 幂等')
})

test('requestCommit 严格串行：三次并发请求同一根，同一时刻只有一笔在跑，顺序不串', async () => {
  const order = []
  let inFlight = 0
  let maxInFlight = 0
  const gitHistory = {
    commitSnapshot: async ({ message }) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      order.push(`start:${message}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      order.push(`end:${message}`)
      return { ok: true, value: { committed: true, oid: 'a'.repeat(40), files: [], removed: [] } }
    }
  }
  const scheduler = createHistoryScheduler({ gitHistory })
  scheduler.start({ root: 'D:/工作区/靶子', intervalMinutes: 0 })

  const results = await Promise.all([
    scheduler.requestCommit('一'),
    scheduler.requestCommit('二'),
    scheduler.requestCommit('三')
  ])
  assert.equal(maxInFlight, 1, 'git index 是共享状态，提交不得并发')
  assert.deepEqual(order, ['start:一', 'end:一', 'start:二', 'end:二', 'start:三', 'end:三'])
  assert.equal(results.every((result) => result.ok === true), true)
  assert.equal(scheduler.status().value.lastCommitAt === null, false, '成功提交要记 lastCommitAt')
})

test('requestCommit：未绑定项目如实报缺；底层抛异常也收成 typed UNAVAILABLE', async () => {
  const bare = createHistoryScheduler({ gitHistory: { commitSnapshot: async () => ({ ok: true, value: {} }) } })
  const noProject = await bare.requestCommit()
  assert.equal(noProject.ok, false)
  assert.equal(noProject.error.code, HISTORY_ERROR_CODES.UNAVAILABLE)
  assert.match(noProject.error.message, /尚未绑定项目/)

  const throwing = createHistoryScheduler({ gitHistory: { commitSnapshot: async () => { throw new Error('boom') } } })
  throwing.start({ root: 'D:/工作区/靶子', intervalMinutes: 0 })
  const failed = await throwing.requestCommit()
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, HISTORY_ERROR_CODES.UNAVAILABLE)
  assert.match(failed.error.message, /boom/)
})

test('probe：没项目 / 仓库缺失 / 仓库就绪三态如实报告', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pinax-history-probe-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }))
  const scheduler = createHistoryScheduler()

  const noProject = await scheduler.probe()
  assert.equal(noProject.ok, true)
  assert.equal(noProject.value.available, false)
  assert.equal(noProject.value.reason, 'no-project')

  scheduler.start({ root, intervalMinutes: 0 })
  const missing = await scheduler.probe()
  assert.equal(missing.value.available, false)
  assert.equal(missing.value.reason, 'history-repo-missing')

  const ensured = await ensureHistoryRepo({ root })
  assert.equal(ensured.ok, true, JSON.stringify(ensured.error ?? {}))
  const ready = await scheduler.probe()
  assert.equal(ready.value.available, true)
  assert.equal(ready.value.reason, null)
})

test('beforeQuit：无根如实报 no-project 且停表；有根先停表再补一次真提交', async (t) => {
  // 从未绑定项目：如实报 no-project，不编一次提交。
  const idle = createHistoryScheduler()
  const noRoot = await idle.beforeQuit()
  assert.equal(noRoot.ok, true)
  assert.deepEqual(noRoot.value, { committed: false, reason: 'no-project' })

  const root = await makeHistoryProject(t)
  await writeFile(join(root, '正文', '001-入场.md'), '雨从檐口滴下来。\n', 'utf-8')
  assert.equal((await markDirty({ root, paths: ['正文/001-入场.md'] })).ok, true)

  const clock2 = fakeClock()
  const scheduler = createHistoryScheduler({ setIntervalFn: clock2.setIntervalFn, clearIntervalFn: clock2.clearIntervalFn })
  scheduler.start({ root, intervalMinutes: 5 })
  const timer = clock2.intervals.at(-1)
  const quit = await scheduler.beforeQuit()
  assert.equal(quit.ok, true, JSON.stringify(quit.error ?? {}))
  assert.equal(quit.value.committed, true, '关窗兜底要走真 gitHistory 提交一次')
  assert.match(quit.value.oid, /^[0-9a-f]{40}$/)
  assert.equal(timer.cleared, true)
  assert.equal(scheduler.status().value.running, false)
})

test('projectClose 停表接线（工单E3）：分发器在关闭后调 onProjectClosed，定时器真的停', async () => {
  const clock = fakeClock()
  const scheduler = createHistoryScheduler({ setIntervalFn: clock.setIntervalFn, clearIntervalFn: clock.clearIntervalFn })
  scheduler.start({ root: 'D:/工作区/靶子' })
  const timer = clock.intervals.at(-1)

  let closed = false
  const session = {
    kernel: { kinds: [] },
    project: null,
    runtime: null,
    projectRoot: 'D:/工作区/靶子',
    close: async () => { closed = true; return { ok: true, value: { closed: true } } }
  }
  const dispatcher = createIpcDispatcher({ session, onProjectClosed: async () => { scheduler.stop() } })
  const result = await dispatcher.dispatch(IPC_CHANNELS.projectClose, {})
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.equal(closed, true)
  assert.equal(timer.cleared, true, 'projectClose 必须让历史定时器停摆')
  assert.equal(scheduler.status().value.running, false)

  // 不注入回调时行为与旧版一致：照样关得掉。
  const plain = createIpcDispatcher({ session })
  const again = await plain.dispatch(IPC_CHANNELS.projectClose, {})
  assert.equal(again.ok, true)

  // 回调抛错也不能把「已关闭」翻成失败（历史是旁路）。
  const throwing = createIpcDispatcher({ session, onProjectClosed: async () => { throw new Error('停表失败') } })
  const still = await throwing.dispatch(IPC_CHANNELS.projectClose, {})
  assert.equal(still.ok, true)
})
