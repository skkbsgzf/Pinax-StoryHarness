/** 有界推进回合（M1-a）：phase 序列 present→candidates→settle→advance；预算/序列硬约束。
 * 前线（fronts/clocks）是 P-M4：每拍按确定性源推进（检定失败／挂机／导演点火），满格＝世界动作待接。
 *
 * P-WIRE：局面卡四字段全部改从 factPack 投影出来的 sceneContext 取数——
 * 在场角色只有 POV 认识的人、地点只有 POV 知道的地方、钩子优先取已埋的悬置伏笔。
 * 旧写法（取前 4 个角色名／第一个地点条目）会让第一视角在开场就报出角色这辈子没见过的地方。 */
import { generateCandidates } from './candidates.js'
import { pushLog } from './sessionState.js'
import { buildSceneContext } from './sceneContext.js'
import { braidFronts, advanceFront, pendingTriggers, tensionReading, tensionText, tickIdleFronts, touchFront, resolveFront } from './fronts.js'

/** 呈现一拍：局面卡（who/where/张力/钩子 四字段简笔）＋ 2–4 个混合候选。 */
export async function presentTurn({ state, entries, pov, llmPort, seed, seedPrompt, span, extraKnown } = {}) {
  const begin = state.round + 1
  state.log.push({ round: begin, kind: 'round-begin' })
  state.round = begin
  // P-M4：挂机推进先跑——同一条 frontline 连续多拍没被碰过就自己走一格。
  // 放在候选生成之前，于是这一拍的张力读数与候选都看得到「世界刚刚逼近了一步」。
  const idleAdvances = tickIdleFronts(state.fronts, { round: state.round })
  if (idleAdvances.length) pushLog(state, 'fronts-idle', { advances: idleAdvances })
  // 知情增量以状态为准（面板每拍并入 knowledgeDelta.gained），调用方传的 extraKnown 优先。
  const context = buildSceneContext({
    entries,
    pov,
    span: span ?? state.atSpan,
    extraKnown: Array.isArray(extraKnown) ? extraKnown : (state.knownExtra ?? [])
  })
  // P-M4 伏笔编织：前线全空时，把已悬置的伏笔接成新威胁（不凭空造——没伏笔就什么都不发生）。
  // 顺带缓存给导演的 braid 动作——导演手动编织与自动编织用同一份伏笔清单。
  state.openHypothesesCache = context.openHypotheses
  const braided = braidFronts(state.fronts, context.openHypotheses, { round: state.round })
  if (braided.length) pushLog(state, 'fronts-braid', { created: braided.map((item) => ({ id: item.id, name: item.name })) })
  const { candidates, rng, sceneContext } = await generateCandidates({
    entries, state, pov, llmPort, seed, seedPrompt, sceneContext: context
  })
  const pack = buildSceneCard({ sceneContext, pov, candidates, seed: rng, fronts: state.fronts })
  return {
    candidates,
    sceneCard: pack.sceneCard,
    rngState: pack.rngState,
    sceneContext,
    tension: pack.tension,
    triggers: pack.triggers,
    idleAdvances,
    braided: braided.map((item) => ({ id: item.id, name: item.name }))
  }
}

function buildSceneCard({ sceneContext, pov, candidates, seed, fronts }) {
  const context = sceneContext ?? {}
  const present = (Array.isArray(context.present) ? context.present : []).map((item) => item.name)
  const locations = (Array.isArray(context.locations) ? context.locations : []).map(String)
  const hooks = Array.isArray(context.openHypotheses) ? context.openHypotheses : []
  const fate = candidates.find((c) => c.source === '命运')
  // 钩子优先取已埋的悬置伏笔（推演张力来自「上一拍没解决的事」），没有才退回候选文本。
  const openHook = hooks.find((item) => item.definition || item.name)
  const candidateHook = candidates.find((c) => c.source === '戏剧') ?? candidates.find((c) => c.source === '必然')
  // 张力：有 frontline 时报最紧那条的时钟读数（累积压力），没有才退回单拍骰点。
  const frontText = tensionText(fronts)
  const tension = frontText === '平缓' && fate
    ? `命运骰 ${fate.trace.sum}（${fate.trace.success ? '顺遂' : '受阻'}）`
    : frontText
  return {
    sceneCard: {
      who: [pov, ...present.filter((name) => name !== pov)].slice(0, 4),
      // 地点只列 POV 知道的；一个都不知道时如实说「未标记」，不编一个世界书里的地名顶上。
      where: locations[0] ?? '未标记地点',
      tension,
      hook: openHook ? `伏笔·${openHook.definition || openHook.name}` : (candidateHook?.text ?? '……')
    },
    rngState: seed,
    tension: tensionReading(fronts),
    triggers: pendingTriggers(fronts)
  }
}

/** 作者决策应用：choose（选候选→settle）／veto（弃，无落库）／reroll（同槽新骰）／inject（author 直落）。
 * P-M4 导演四动：fire（手动点火＝推进一条前线）／touch（这条线被处理，挂机计数归零）／
 * resolve（结掉这条前线＝唯一缓解路径）／braid（把悬置伏笔接成新威胁）。 */
export function applyDirectorAction({ state, action, candidate, name, definition, frontId, note } = {}) {
  if (action === 'veto') {
    pushLog(state, 'director-veto', { candidateId: candidate?.id })
    return { action: 'veto', entry: null }
  }
  if (action === 'reroll') {
    pushLog(state, 'director-reroll', { candidateId: candidate?.id })
    return { action: 'reroll', entry: null, note: '重掷由调用方以新 seed 重新 presentTurn——引擎不重掷已结算拍（重试不重掷纪律）' }
  }
  if (action === 'inject') {
    pushLog(state, 'director-inject', { name })
    return { action: 'inject', entry: { name, definition } }
  }
  if (action === 'fire') {
    const result = advanceFront(state.fronts, frontId, { round: state.round, source: 'director', note: note ?? '导演点火' })
    if (!result.ok) return { action: 'fire', ok: false, code: result.code, message: result.message }
    pushLog(state, 'fronts-advance', { frontId, name: result.front?.name, value: result.value, filled: result.filled, triggered: result.triggered, source: 'director' })
    return { action: 'fire', ok: true, value: result.value, filled: result.filled, triggered: result.triggered }
  }
  if (action === 'touch') {
    const result = touchFront(state.fronts, frontId)
    if (!result.ok) return { action: 'touch', ok: false, code: result.code }
    pushLog(state, 'fronts-touch', { frontId })
    return { action: 'touch', ok: true }
  }
  if (action === 'resolve') {
    const result = resolveFront(state.fronts, frontId, { round: state.round, note })
    if (!result.ok) return { action: 'resolve', ok: false, code: result.code }
    pushLog(state, 'fronts-resolve', { frontId, note: note ?? '' })
    return { action: 'resolve', ok: true }
  }
  if (action === 'braid') {
    const created = braidFronts(state.fronts, state.openHypothesesCache ?? [], { round: state.round })
    if (created.length) pushLog(state, 'fronts-braid', { created: created.map((item) => ({ id: item.id, name: item.name })) })
    return { action: 'braid', ok: true, created: created.map((item) => ({ id: item.id, name: item.name })) }
  }
  return { action: String(action ?? 'unknown'), entry: null }
}
