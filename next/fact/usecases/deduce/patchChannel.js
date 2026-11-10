/**
 * 补丁通道（P-M5 / ADR 裁定 ⑤）：一局的已确认事实 → 回写世界书。
 *
 * 为什么需要它：M1–M4 的产物都在会话里（事件流、拍、假设轨），对世界书**只读**。
 * 一局玩完，世界书还是开局那份——下一本接着写时，这一局发生过的事一个字都没留下，
 * 所谓「连续宇宙」就是假的。补丁通道补的就是这条回程。
 *
 * 三条裁定（照 ADR 原文）：
 *   1) **只认已确认事实**：传闻/推测/未采纳不算。判定是结构性的，不看文本——
 *      必须是 status=adopted、非 hypothesis 的 plot 事件（settle 落的那些），
 *      candidate.proposed 的戏剧层没被作者选中就不在事件流里，天然进不来。
 *   2) **一律 proposed 落地**：补丁不直接改世界书。每条产出 status='proposed' 的条目，
 *      由作者显式 adopt——世界书是作者的地盘，推演不能悄悄往里写。
 *   3) **同一事件图被多双眼睛各织一遍**：每局的 patch 带 runId/pov 出处，
 *      多周目/多视角的补丁可以并存（同一事件被两个视角确认＝两条补丁，不互相覆盖）。
 *
 * 关键设计：**补丁是幂等的**。stableEntryId 按「层|域|槽|名」算，同一个事件同一次回写
 * 得到同一个 id；重复回写不会产生重复条目，只会被 dedupe 掉（如实计数）。
 *
 * 纯函数、零宿主依赖：只 import fact 域内相对路径。
 */
import { FACT_SCHEMA } from '../../domain/vocabulary.js'
import { stableEntryId } from '../../domain/stableId.js'

export const PATCH_CHANNEL_VERSION = 'fact-patch@1'

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function trimmed(value) {
  return str(value).trim()
}

/** 会话事件流里「已确认的拍」：settle 事件，且不是命运受阻留下的假设。 */
function confirmedBeats(events) {
  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!isPlainObject(event)) return false
    if (event.type !== 'settle') return false
    if (event.hypothesis === true) return false
    return true
  })
}

/**
 * 一局的收束事件流 → 世界书补丁。
 *
 * @param {Object} input
 * @param {Object[]} input.events      该局的 listEvents().events（含 lineage 前缀）
 * @param {string}   input.domain      域（书名）
 * @param {string}   input.bookId      书 id
 * @param {string}   [input.extractor] 出处标识
 * @param {Set|string[]} [input.existingIds] 世界书已有条目 id（用于 dedupe 计数）
 * @returns {{ok:true, version, patches, counts, notes}}
 */
export function buildWorldbookPatch({ events = [], domain = '', bookId = '', extractor = '', existingIds = [] } = {}) {
  const beats = confirmedBeats(events)
  const existing = existingIds instanceof Set ? existingIds : new Set((Array.isArray(existingIds) ? existingIds : []).map((id) => str(id)))
  const patches = []
  const notes = []
  let skippedNoText = 0
  let duplicate = 0

  for (const event of beats) {
    const text = trimmed(event.text) || trimmed(event.definition)
    if (!text) {
      skippedNoText += 1
      continue
    }
    const pov = trimmed(event.pov)
    const goal = trimmed(event.goal)
    // 名字要可辨且稳定：带拍序与视角，文件名/条目名一眼看出是哪一局的哪一拍。
    const round = Number.isInteger(event.round) ? event.round : null
    const name = `推演补丁·${pov || '未知视角'}·第${round ?? '?'}拍·${text.slice(0, 14)}${text.length > 14 ? '…' : ''}`
    const id = stableEntryId({ layer: 'plot', domain, slot: '', name })
    if (existing.has(id) || patches.some((patch) => patch.id === id)) {
      duplicate += 1
      continue
    }
    patches.push({
      schema: FACT_SCHEMA,
      id,
      layer: 'plot',
      domain,
      slot: '',
      name,
      status: 'proposed', // 裁定 2：一律 proposed，作者显式 adopt
      definition: text,
      events: [{
        index: 1,
        track: 'fact',
        title: text.slice(0, 40),
        refs: [...(Array.isArray(event.refs) ? event.refs : [])].map((item) => str(item)).filter(Boolean),
        segments: [],
        novelty: Array.isArray(event.novelty) ? [...event.novelty] : []
      }],
      provenance: {
        mode: 'author',
        book: domain,
        book_id: bookId,
        chapters: [],
        scenes: [],
        extractor: extractor || 'deduce/patch@1',
        // 裁定 3：补丁带出处——哪一局、哪个视角、哪一拍、谁定的。
        runId: trimmed(event.runId) || null,
        pov: pov || null,
        round,
        decidedBy: trimmed(event.decidedBy) || null,
        source: trimmed(event.source) || null
      },
      ...(goal ? { goal } : {}),
      fingerprint: { vec: null, metrics: {} }
    })
  }

  if (skippedNoText) notes.push(`${skippedNoText} 条已确认拍没有文本（settle 事件缺 text/definition），没生成补丁`)
  if (duplicate) notes.push(`${duplicate} 条补丁与既有条目或本批重复（stableEntryId 相同），已跳过——补丁幂等`)

  return {
    ok: true,
    version: PATCH_CHANNEL_VERSION,
    patches,
    counts: {
      confirmedBeats: beats.length,
      patches: patches.length,
      skippedNoText,
      duplicate
    },
    notes
  }
}

/**
 * 补丁采纳（作者显式动作）：proposed → adopted。
 * 这是补丁通道唯一会改世界书的动作，且必须由作者触发（本函数只做状态转移与校验）。
 */
export function adoptPatch(patch) {
  if (!isPlainObject(patch)) return { ok: false, code: 'INVALID_PATCH', message: '补丁必须是对象' }
  if (trimmed(patch.status) !== 'proposed') {
    return { ok: false, code: 'NOT_PROPOSED', message: `只有 proposed 补丁可采纳，当前是 ${trimmed(patch.status) || '(空)'}` }
  }
  return { ok: true, patch: { ...patch, status: 'adopted' } }
}

/**
 * 多周目／多视角并存检查：同一事件被不同 runId/pov 各确认一次时，两条补丁的关系。
 *
 * 裁定 7（端点固定、路径自由）：先跑角色的已确认结果是后跑角色的固定背景。
 * 所以两条补丁不是「冲突」，是「同一事件图被两双眼睛各织一遍」；
 * 但同一个 runId+pov+round **重复**才是真的重复（同一局回写了两次）。
 *
 * @param {Object[]} patches 既有补丁池
 * @param {Object[]} incoming 新补丁
 */
export function reconcilePatches(patches = [], incoming = []) {
  const pool = Array.isArray(patches) ? patches.filter(isPlainObject) : []
  const keyOf = (patch) => [
    trimmed(patch?.provenance?.runId), trimmed(patch?.provenance?.pov), trimmed(patch?.provenance?.round)
  ].join('|')
  const poolIds = new Set(pool.map((patch) => str(patch.id)))
  const poolKeys = new Map()
  for (const patch of pool) {
    const key = keyOf(patch)
    if (!poolKeys.has(key)) poolKeys.set(key, [])
    poolKeys.get(key).push(str(patch.id))
  }
  const accepted = []
  const duplicates = []
  const parallel = []
  for (const patch of Array.isArray(incoming) ? incoming.filter(isPlainObject) : []) {
    const id = str(patch.id)
    const key = keyOf(patch)
    // 同 id：完全重复（同一事件同一次回写）。
    if (poolIds.has(id)) {
      duplicates.push({ id, reason: 'same-id' })
      continue
    }
    // 同 runId+pov+round 但不同 id：同一局同一拍出现两个不同文本，这是引擎侧异常，如实报。
    if (poolKeys.has(key)) {
      duplicates.push({ id, reason: 'same-run-pov-round', existing: poolKeys.get(key) })
      continue
    }
    // 同一名字不同视角/不同局：并存（叠加微调）。
    const siblings = pool.filter((item) => trimmed(item.name) === trimmed(patch.name))
    if (siblings.length) parallel.push({ id, siblings: siblings.map((item) => str(item.id)), pov: trimmed(patch.provenance?.pov) })
    accepted.push(patch)
    poolIds.add(id)
  }
  return {
    ok: true,
    version: PATCH_CHANNEL_VERSION,
    accepted,
    duplicates,
    parallel,
    counts: { incoming: (Array.isArray(incoming) ? incoming : []).length, accepted: accepted.length, duplicates: duplicates.length, parallel: parallel.length }
  }
}

/**
 * 多视角重演的一致性叠加（ADR 裁定 6/7）：
 * 后跑视角开局时，先跑视角的已确认拍成为固定背景（终点钉死、路径自由）。
 *
 * 产出两份东西：
 *   fixedEndpoints  必须发生的事（后跑视角不能改写，只能换路径到达）
 *   freeSpace       先跑视角没确认的拍（后跑者可以自由织）
 *
 * @param {Object[]} priorEvents 先跑那一局的事件流
 * @param {{pov?:string}} [options] 后跑视角（用于排除自己那一局的拍，避免自己钉死自己）
 */
export function replayBackdrop(priorEvents = [], options = {}) {
  const pov = trimmed(options.pov)
  const beats = confirmedBeats(priorEvents).filter((event) => !pov || trimmed(event.pov) !== pov)
  const fixedEndpoints = beats.map((event) => ({
    round: Number.isInteger(event.round) ? event.round : null,
    pov: trimmed(event.pov) || null,
    text: trimmed(event.text) || trimmed(event.definition),
    decidedBy: trimmed(event.decidedBy) || null,
    runId: trimmed(event.runId) || null,
    // 端点固定：文本即结果，后跑者不得改写（只能选不同的到达路径）。
    fixed: true
  }))
  const coveredRounds = new Set(fixedEndpoints.map((item) => item.round).filter((round) => round !== null))
  return {
    version: PATCH_CHANNEL_VERSION,
    pov: pov || null,
    fixedEndpoints,
    coveredRounds: [...coveredRounds].sort((a, b) => a - b),
    freeSpace: {
      // 「路径自由」是语义承诺，不是一个数据结构：引擎没有「未确认的拍」清单（拍是玩家造的），
      // 所以这里只如实说明——后跑者的自由空间＝固定端点之间的一切。
      note: '固定端点之间的到达路径由后跑视角自由编织；引擎不预生成剧情，只钉住端点。',
      betweenEndpoints: [...coveredRounds].sort((a, b) => a - b)
    },
    counts: { fixed: fixedEndpoints.length, excludedOwn: confirmedBeats(priorEvents).length - beats.length }
  }
}
