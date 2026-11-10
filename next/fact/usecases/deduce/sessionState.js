/** 推演会话状态容器（M1-a）：回合数／AI 动作预算／事件日志（replay 源）。
 * fronts/clocks 见 ./fronts.js（P-M4）：这里持有数组，推进由引擎按确定性源驱动。 */

export function createSessionState({ runId, pov, worldHash, budgetMax = 8, fronts = [] } = {}) {
  return {
    version: 'deduce-session/v1',
    runId,
    pov,
    worldHash,
    budgetMax,
    round: 0,
    aiActionsLeft: budgetMax,
    // P-M4：威胁前线／压力时钟（从世界书 rules 预埋模板立起；空数组＝这一局没有累积压力）
    fronts: Array.isArray(fronts) ? fronts : [],
    // P-WIRE：本局结算累积的知情增量（不含条目级 ledger 里的原始记录）。
    // 局面卡与候选的可见域＝ledger ∪ knownExtra——两处同源，才不会「情报面板知道、局面卡不知道」。
    knownExtra: [],
    log: [] // 事件日志：{round, kind, ...}——replay 与成书渲染的数据源
  }
}

/** 结算知情增量并入本局已知（幂等：重复并入不重复计数）。 */
export function addKnownExtra(state, names = []) {
  const merged = new Set(Array.isArray(state.knownExtra) ? state.knownExtra : [])
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw ?? '').trim()
    if (name) merged.add(name)
  }
  state.knownExtra = [...merged]
  return state.knownExtra
}

export function beginRound(state) {
  state.round += 1
  state.log.push({ round: state.round, kind: 'round-begin' })
  return state.round
}

/** 消耗 AI 动作预算（L-戏剧候选每个耗 1）。预算尽＝本回合只剩必然/命运候选。 */
export function spendAi(state, n = 1) {
  const spend = Math.max(0, Math.min(n, state.aiActionsLeft))
  state.aiActionsLeft -= spend
  return spend
}

export function pushLog(state, kind, data = {}) {
  const row = { round: state.round, kind, ...data }
  state.log.push(row)
  return row
}
