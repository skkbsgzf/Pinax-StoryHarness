/** 推演开局（M1-a）：世界冻结快照 v0 ＋ POV 绑定 ＋ runId 签发。
 * ADR：拒绝从草稿开局——worldview 条目必须全部 adopted，否则拒（D2 判据的世界侧前置）。
 * P-M4：开局从世界书 rules 槽位预埋 fronts 模板立起威胁前线（有没有模板决定这一局有无累积压力）。
 * P-M5：换视角重演（同期重演）时，先跑视角的已确认拍作为固定端点进状态——端点固定、路径自由。
 * 禁宿主依赖：仅 import fact 域内模块。 */
import { sha1Hex } from '../../domain/stableId.js'
import { createSessionState } from './sessionState.js'
import { frontsFromRules } from './fronts.js'
import { replayBackdrop } from './patchChannel.js'

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

export function openDeduceSession({ entries, pov, runId, priorEvents = [], lineage = null } = {}) {
  const list = Array.isArray(entries) ? entries : []
  const worldview = list.filter((e) => e && e.layer === 'worldview')
  const drafts = worldview.filter((e) => e.status !== 'adopted').map((e) => e.name)
  if (drafts.length > 0) {
    const error = new Error('WORLD_NOT_ADOPTED 世界书存在非 adopted 条目，拒绝从草稿开局')
    error.code = 'WORLD_NOT_ADOPTED'
    error.details = { drafts }
    throw error
  }
  if (worldview.length === 0) {
    const error = new Error('WORLD_EMPTY 世界书没有任何 worldview 条目，无法开局')
    error.code = 'WORLD_EMPTY'
    throw error
  }
  const povEntry = list.find((e) => e && e.layer === 'character' && e.name === pov)
  if (!povEntry) {
    const error = new Error(`POV_NOT_FOUND 主视角角色不存在：${pov}`)
    error.code = 'POV_NOT_FOUND'
    throw error
  }
  const frozen = worldview.map((e) => clone(e))
  const worldHash = sha1Hex(JSON.stringify(frozen.map((e) => [e.id, e.status]).sort()))
  const session = {
    runId: runId || sha1Hex(`deduce|${pov}|${worldHash}`).slice(0, 12),
    pov,
    worldHash,
    openedAt: new Date().toISOString()
  }
  // P-M5 换视角重演：先跑视角的已确认拍进本局上下文（端点固定、路径自由）。
  // 只在真的传了 priorEvents 时才算重演——首周目不该凭空带上别人的端点。
  if (Array.isArray(priorEvents) && priorEvents.length) {
    const backdrop = replayBackdrop(priorEvents, { pov })
    session.lineage = lineage ?? null
    session.replay = {
      fixedEndpoints: backdrop.fixedEndpoints,
      coveredRounds: backdrop.coveredRounds,
      excludedOwn: backdrop.counts.excludedOwn
    }
  } else if (lineage) {
    session.lineage = lineage
  }
  // 威胁前线从世界书 rules 里的 fronts 模板立起——没写模板就没有累积压力（如实为空，不凭空造威胁）。
  const fronts = frontsFromRules(list, { atRound: 0 })
  session.frontCount = fronts.length
  const state = createSessionState({ runId: session.runId, pov, worldHash, fronts })
  // 重演端点进状态：presentTurn 把它交给候选生成，戏剧层据此「端点固定、路径自由」。
  if (session.replay) state.replayEndpoints = session.replay.fixedEndpoints
  return { session, frozen, state, povEntry: clone(povEntry) }
}
