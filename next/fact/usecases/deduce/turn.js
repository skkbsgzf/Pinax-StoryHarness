/** 有界推进回合（M1-a）：phase 序列 present→candidates→settle→advance；预算/序列硬约束。
 * 前线（fronts）是 M4：接口占位——张力读数本批用命运骰与最近拍文本替代，不假装已实现。 */
import { generateCandidates } from './candidates.js'
import { pushLog } from './sessionState.js'

/** 呈现一拍：局面卡（who/where/张力/钩子 四字段简笔）＋ 2–4 个混合候选。 */
export async function presentTurn({ state, entries, pov, llmPort, seed, seedPrompt } = {}) {
  const begin = state.round + 1
  state.log.push({ round: begin, kind: 'round-begin' })
  state.round = begin
  const { candidates, rng } = await generateCandidates({ entries, state, pov, llmPort, seed, seedPrompt })
  const pack = buildSceneCard({ entries, pov, candidates, seed: rng })
  return { candidates, sceneCard: pack.sceneCard, rngState: pack.rngState }
}

function buildSceneCard({ entries, pov, candidates, seed }) {
  const characters = (Array.isArray(entries) ? entries : []).filter((e) => e?.layer === 'character').map((e) => e.name)
  const locations = (Array.isArray(entries) ? entries : []).filter((e) => e?.layer === 'worldview' && e.slot === 'locations').map((e) => e.name)
  const rules = (Array.isArray(entries) ? entries : []).filter((e) => e?.layer === 'worldview' && e.slot === 'rules').map((e) => e.name)
  const fate = candidates.find((c) => c.source === '命运')
  const hook = candidates.find((c) => c.source === '戏剧') ?? candidates.find((c) => c.source === '必然')
  return {
    sceneCard: {
      who: [pov, ...characters.filter((n) => n !== pov)].slice(0, 4),
      where: locations[0] ?? '未标记地点',
      tension: fate ? `命运骰 ${fate.trace.sum}（${fate.trace.success ? '顺遂' : '受阻'}）` : '平缓',
      hook: hook?.text ?? '……'
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
