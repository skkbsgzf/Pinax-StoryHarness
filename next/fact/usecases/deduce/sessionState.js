/** 推演会话状态容器（M1-a）：回合数／AI 动作预算／事件日志（replay 源）。
 * fronts/clocks 是 M4：这里只留 fronts 接口形状（空实现＋TODO），不假装已实现。 */

export function createSessionState({ runId, pov, worldHash, budgetMax = 8 } = {}) {
  return {
    version: 'deduce-session/v1',
    runId,
    pov,
    worldHash,
    budgetMax,
    round: 0,
    aiActionsLeft: budgetMax,
    fronts: {}, // M4：威胁前线／压力时钟接口占位（本批不实现，见 ADR 裁定 ②）
    log: [] // 事件日志：{round, kind, ...}——replay 与成书渲染的数据源
  }
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
