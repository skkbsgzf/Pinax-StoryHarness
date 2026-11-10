/** 有界推进回合（M1-a）：phase 序列 present→candidates→settle→advance；预算/序列硬约束。
 * 前线（fronts）是 M4：接口占位——张力读数本批用命运骰与最近拍文本替代，不假装已实现。
 *
 * P-WIRE：局面卡四字段全部改从 factPack 投影出来的 sceneContext 取数——
 * 在场角色只有 POV 认识的人、地点只有 POV 知道的地方、钩子优先取已埋的悬置伏笔。
 * 旧写法（取前 4 个角色名／第一个地点条目）会让第一视角在开场就报出角色这辈子没见过的地方。 */
import { generateCandidates } from './candidates.js'
import { pushLog } from './sessionState.js'
import { buildSceneContext } from './sceneContext.js'

/** 呈现一拍：局面卡（who/where/张力/钩子 四字段简笔）＋ 2–4 个混合候选。 */
export async function presentTurn({ state, entries, pov, llmPort, seed, seedPrompt, span, extraKnown } = {}) {
  const begin = state.round + 1
  state.log.push({ round: begin, kind: 'round-begin' })
  state.round = begin
  // 知情增量以状态为准（面板每拍并入 knowledgeDelta.gained），调用方传的 extraKnown 优先。
  const context = buildSceneContext({
    entries,
    pov,
    span: span ?? state.atSpan,
    extraKnown: Array.isArray(extraKnown) ? extraKnown : (state.knownExtra ?? [])
  })
  const { candidates, rng, sceneContext } = await generateCandidates({
    entries, state, pov, llmPort, seed, seedPrompt, sceneContext: context
  })
  const pack = buildSceneCard({ sceneContext, pov, candidates, seed: rng })
  return { candidates, sceneCard: pack.sceneCard, rngState: pack.rngState, sceneContext }
}

function buildSceneCard({ sceneContext, pov, candidates, seed }) {
  const context = sceneContext ?? {}
  const present = (Array.isArray(context.present) ? context.present : []).map((item) => item.name)
  const locations = (Array.isArray(context.locations) ? context.locations : []).map(String)
  const hooks = Array.isArray(context.openHypotheses) ? context.openHypotheses : []
  const fate = candidates.find((c) => c.source === '命运')
  // 钩子优先取已埋的悬置伏笔（推演张力来自「上一拍没解决的事」），没有才退回候选文本。
  const openHook = hooks.find((item) => item.definition || item.name)
  const candidateHook = candidates.find((c) => c.source === '戏剧') ?? candidates.find((c) => c.source === '必然')
  return {
    sceneCard: {
      who: [pov, ...present.filter((name) => name !== pov)].slice(0, 4),
      // 地点只列 POV 知道的；一个都不知道时如实说「未标记」，不编一个世界书里的地名顶上。
      where: locations[0] ?? '未标记地点',
      tension: fate ? `命运骰 ${fate.trace.sum}（${fate.trace.success ? '顺遂' : '受阻'}）` : '平缓',
      hook: openHook ? `伏笔·${openHook.definition || openHook.name}` : (candidateHook?.text ?? '……')
    },
    rngState: seed
  }
}

/** 作者决策应用：choose（选候选→settle）／veto（弃，无落库）／reroll（同槽新骰）／inject（author 直落）。 */
export function applyDirectorAction({ state, action, candidate, name, definition }) {
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
  return { action: String(action ?? 'unknown'), entry: null }
}
