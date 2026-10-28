import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import * as defaultGitHistory from '../history/gitHistory.mjs'
import { HISTORY_ERROR_CODES, HISTORY_GITDIR } from '../history/gitHistory.mjs'

/**
 * 历史定时调度（D1）：只由主进程创建，一次只服务一个已打开的项目。
 *
 * 职责边界：
 *   - 只管「什么时候提交」与串行化；快照内容仍由 gitHistory.commitSnapshot 决定（允许前缀整树）；
 *   - start 不建仓库：建仓是项目打开时的一次性动作（main.mjs 先 ensureHistoryRepo 再 start），
 *     建仓失败就不启动定时器，历史面板经 probe 如实显示不可用；
 *   - intervalMinutes=0 表示关闭定时提交（手动/关窗兜底仍可用）；
 *   - 定时器 unref()：不因为等下一次快照而拖住进程退出。
 *
 * 返回合同沿用 gitHistory：成功 { ok:true, value }，失败 { ok:false, error:{ code, message, details? } }。
 * 失败码同样只有 HISTORY_UNAVAILABLE / HISTORY_INVALID_INPUT。
 */

export const DEFAULT_HISTORY_INTERVAL_MINUTES = 5
export const MAX_HISTORY_INTERVAL_MINUTES = 120

export function createHistoryScheduler({
  gitHistory = defaultGitHistory,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => new Date()
} = {}) {
  let timer = null
  let root = null
  let intervalMinutes = DEFAULT_HISTORY_INTERVAL_MINUTES
  let running = false
  let lastCommitAt = null
  let lastResult = null
  let queue = Promise.resolve()

  function clearTimer() {
    if (!timer) return
    clearIntervalFn(timer)
    timer = null
  }

  /** 绑定项目并（重）启定时器。重复调用＝换项目/换间隔，旧定时器先清掉。 */
  function start({ root: nextRoot, intervalMinutes: nextInterval = DEFAULT_HISTORY_INTERVAL_MINUTES } = {}) {
    if (typeof nextRoot !== 'string' || !nextRoot.trim()) {
      return historyFail('INVALID_INPUT', 'historyScheduler.start 需要项目根 root')
    }
    const minutes = normalizeInterval(nextInterval)
    if (!minutes.ok) return minutes
    clearTimer()
    root = resolve(nextRoot.trim())
    intervalMinutes = minutes.value
    running = intervalMinutes > 0
    if (running) {
      timer = setIntervalFn(() => {
        // 定时提交的失败不往外抛：上一次失败不能把后续定时器打死；状态留在 lastResult 里。
        requestCommit().catch(() => {})
      }, intervalMinutes * 60_000)
      // 不拖住进程退出（Electron 正常退出另有 before-quit 兜底提交）。
      timer?.unref?.()
    }
    return historyOk({ root, intervalMinutes, running })
  }

  function stop() {
    clearTimer()
    running = false
    return historyOk({ root, intervalMinutes, running })
  }

  /**
   * 请求一次快照（手动「存一个快照」、定时器、关窗兜底都走这里）。
   * 同一根上的提交严格按调用顺序串行：git index 是共享状态，不能并发写。
   */
  function requestCommit(message) {
    const job = queue.then(() => performCommit(message), () => performCommit(message))
    queue = job.then(() => undefined, () => undefined)
    return job
  }

  async function performCommit(message) {
    if (!root) {
      return historyFail('UNAVAILABLE', '历史调度尚未绑定项目（先打开一个项目）')
    }
    let result
    try {
      result = await gitHistory.commitSnapshot({ root, message })
    } catch (error) {
      // gitHistory 按合同不抛裸异常；这里是最后一道保险，调度器自己也不许把异常漏给 IPC。
      result = historyFail('UNAVAILABLE', `历史提交失败：${String(error?.message || error)}`)
    }
    lastResult = result
    if (result.ok && result.value?.committed) lastCommitAt = now().toISOString()
    return result
  }

  /** 关窗兜底：先停表，再补一次提交（无脏时 commitSnapshot 自己返回 committed:false）。 */
  async function beforeQuit() {
    clearTimer()
    running = false
    if (!root) return historyOk({ committed: false, reason: 'no-project' })
    return requestCommit()
  }

  function status() {
    return historyOk({
      root,
      intervalMinutes,
      running,
      lastCommitAt,
      lastResult: summarize(lastResult)
    })
  }

  /** 历史入口的可用性探测：仓库是否真的落在磁盘上，以及调度是否活着。 */
  async function probe() {
    const base = {
      root,
      intervalMinutes,
      running,
      lastCommitAt,
      lastResult: summarize(lastResult)
    }
    if (!root) return historyOk({ available: false, reason: 'no-project', ...base })
    const repoReady = await stat(join(root, HISTORY_GITDIR, 'HEAD')).then((info) => info.isFile(), () => false)
    return historyOk({ available: repoReady, reason: repoReady ? null : 'history-repo-missing', ...base })
  }

  return { start, stop, requestCommit, beforeQuit, status, probe }
}

function normalizeInterval(input) {
  if (input === undefined || input === null || input === '') {
    return historyOk(DEFAULT_HISTORY_INTERVAL_MINUTES)
  }
  const minutes = typeof input === 'number' ? input : Number(String(input).trim())
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_HISTORY_INTERVAL_MINUTES) {
    return historyFail('INVALID_INPUT', `intervalMinutes 必须是 0–${MAX_HISTORY_INTERVAL_MINUTES} 的整数（0＝关闭），收到：${JSON.stringify(input ?? null)}`)
  }
  return historyOk(minutes)
}

function summarize(result) {
  if (!result) return null
  if (!result.ok) return { ok: false, error: result.error ?? null }
  return {
    ok: true,
    committed: Boolean(result.value?.committed),
    oid: result.value?.oid ?? null,
    reason: result.value?.reason ?? null
  }
}

function historyOk(value) {
  return { ok: true, value }
}

function historyFail(code, message, details) {
  const error = { code: HISTORY_ERROR_CODES[code] ?? HISTORY_ERROR_CODES.INVALID_INPUT, message }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, error }
}
