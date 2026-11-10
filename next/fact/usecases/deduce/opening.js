/** 推演开局（M1-a）：世界冻结快照 v0 ＋ POV 绑定 ＋ runId 签发。
 * ADR：拒绝从草稿开局——worldview 条目必须全部 adopted，否则拒（D2 判据的世界侧前置）。
 * 禁宿主依赖：仅 import fact 域内模块。 */
import { sha1Hex } from '../../domain/stableId.js'
import { createSessionState } from './sessionState.js'

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

export function openDeduceSession({ entries, pov, runId } = {}) {
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
  const state = createSessionState({ runId: session.runId, pov, worldHash })
  return { session, frozen, state, povEntry: clone(povEntry) }
}
