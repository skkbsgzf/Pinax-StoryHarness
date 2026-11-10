/**
 * 局面上下文投影（P-WIRE）：factPack → 推演编排输入。
 *
 * 为什么单开这一层：candidates.js 原来的「一致性筛」只问「这个实体在世界里存不存在」，
 * 那是作者视角；第一视角要问的是「POV 此刻知不知道」。两者差一整层知情账本——
 * 世界书里有条目 ≠ 玩家角色认得它。把这两个判据混成一条，就会出现角色在推演里
 * 随口提到他这辈子没见过的地方/组织。这一层把 factPack 的 knowledge 投影与 worldview
 * 槽位合成编排要用的四张清单，让场景卡与戏剧候选都从同一把尺子上取数。
 *
 * 口径（与 ADR「端点固定、路径自由」一致）：
 *   - known      POV 此刻已知的实体名（知情账本 ∩ 时点，含别名归一到规范名，含 POV 自己）；
 *   - present    已知角色（castRole 主导的排序：protagonist → supporting → minor）；
 *   - locations  已知地点（第一视角不认识的场景不进场）；
 *   - rules      世界规则（物理级约束，不按知情筛——规则对谁都成立，但只当约束用）；
 *   - openHypotheses 悬而未决（plot 条目 hypothesis+open，推演张力的现成来源）。
 *
 * 纯函数、零宿主依赖：只 import fact 域内相对路径，不碰 node 内置 / process / 文件系统。
 */
import { buildFactPack } from '../factPack.js'
import { createAliasIndex } from '../../domain/aliases.js'
import { isActiveAt, normalizeSpan } from '../../domain/validity.js'

export const SCENE_CONTEXT_VERSION = 'scene-context@1'

/** castRole 档位的进场优先序（越小越靠前）；无 castRole 的排最后。 */
const TIER_ORDER = Object.freeze({ protagonist: 0, supporting: 1, minor: 2 })

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function trimmed(value) {
  return str(value).trim()
}

/**
 * 已知名字集合（含别名归一到规范名）。
 * extraKnown 是本局结算累积的知情增量——DeducePanel 每拍把 knowledgeDelta.gained 并进来，
 * 于是「局面卡里的在场角色」与「情报面板里列的已知情报」永远是同一份账。
 */
export function knownNamesOf(pack, { pov, aliasIndex, extraKnown = [] } = {}) {
  const canon = (name) => aliasIndex?.resolve(name) ?? trimmed(name)
  const known = new Set()
  const focus = trimmed(pov)
  if (focus) known.add(focus)
  const record = focus ? (pack?.characters?.[focus] ?? pack?.characters?.[canon(focus)]) : null
  for (const item of Array.isArray(record?.knowledge) ? record.knowledge : []) {
    const name = canon(item?.fromEntry)
    if (name) known.add(name)
  }
  for (const raw of Array.isArray(extraKnown) ? extraKnown : []) {
    const name = canon(raw)
    if (name) known.add(name)
  }
  return known
}

/**
 * @param {Object} input
 * @param {Object[]} input.entries fact.data/v2 条目（或已归一的 worldbook 条目）
 * @param {string} input.pov 主视角角色名
 * @param {number|{from:number|null,to:number|null}} [input.span] 时点／区间（缺省无界）
 * @param {string[]} [input.extraKnown] 本局累积的知情增量
 * @returns {{version, pov, atSpan, known:string[], present:Object[], locations:string[],
 *   rules:Object[], openHypotheses:Object[], warnings:Object[], losses:Object[]}}
 */
export function buildSceneContext({ entries, pov, span, extraKnown = [] } = {}) {
  const list = Array.isArray(entries) ? entries.filter(isPlainObject) : []
  const focus = trimmed(pov)
  const aliasIndex = createAliasIndex(list)
  const atSpan = normalizeSpan(span)
  const query = span === undefined || span === null ? {} : { span }
  let pack
  try {
    pack = buildFactPack(list, query, { aliasIndex })
  } catch (error) {
    return {
      version: SCENE_CONTEXT_VERSION,
      pov: focus,
      atSpan,
      known: focus ? [focus] : [],
      present: [],
      locations: [],
      rules: [],
      openHypotheses: [],
      warnings: [{ code: 'FACT_PACK_FAILED', message: `事实包投影失败：${str(error?.message || error)}` }],
      losses: []
    }
  }

  const known = knownNamesOf(pack, { pov: focus, aliasIndex, extraKnown })

  // 知情保真度：POV 有条目级 knowledge 记录才叫「按账本裁」；一条都没有时无从判断，
  // 如实降级成世界级可见并记账——绝不假装「玩家知道世界书里的每一条」，也不把局面卡做成空的。
  const warnings = Array.isArray(pack.warnings) ? [...pack.warnings] : []
  const ledgerRecords = Array.isArray(pack.characters?.[focus]?.knowledge) ? pack.characters[focus].knowledge.length : 0
  const knowledgeFidelity = ledgerRecords > 0 ? 'ledger' : 'world'
  if (knowledgeFidelity === 'world' && focus) {
    warnings.push({
      code: 'KNOWLEDGE_LEDGER_EMPTY',
      message: `主视角「${focus}」没有知情账本记录：本局按世界级可见降级（不是「他全知」，是「无从判定他知什么」）。补齐 knowledge 后可恢复第一视角裁剪。`
    })
  }
  // 可见域：ledger 模式＝已知集合（POV 只认识他知道的人与地方）；world 模式＝全部条目名。
  // present/locations 都从这一份取数——降级时若仍按 know 集过滤，局面卡会空无一人。
  const canon = (name) => aliasIndex?.resolve(name) ?? trimmed(name)
  const visible = new Set(known)
  if (knowledgeFidelity === 'world') {
    for (const entry of list) {
      const name = canon(entry.name)
      if (name) visible.add(name)
    }
  }

  const present = []
  for (const [name, character] of Object.entries(pack.characters ?? {})) {
    if (!isPlainObject(character) || name === focus || !visible.has(name)) continue
    const castRole = isPlainObject(character.castRole) ? character.castRole : null
    present.push({
      name,
      tier: trimmed(castRole?.tier) || null,
      goal: trimmed(castRole?.goal),
      plotFunction: trimmed(castRole?.plotFunction),
      memoryPoints: Array.isArray(character.memoryPoints) ? [...character.memoryPoints] : []
    })
  }
  present.sort((left, right) => {
    const tierLeft = TIER_ORDER[left.tier] ?? 9
    const tierRight = TIER_ORDER[right.tier] ?? 9
    if (tierLeft !== tierRight) return tierLeft - tierRight
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })

  const locations = (pack.world?.slots?.locations ?? [])
    .filter((item) => isPlainObject(item) && visible.has(trimmed(item.name)))
    .map((item) => trimmed(item.name))

  const rules = (pack.world?.rules ?? [])
    .filter((item) => isPlainObject(item) && (item.status ?? 'adopted') === 'adopted')
    .map((item) => ({ id: str(item.id), name: trimmed(item.name), definition: trimmed(item.definition) }))

  // 悬置伏笔：plot 条目 hypothesis+open（M1-a settleHypothesis 落的）——有效区间覆盖当前时点的才算。
  const openHypotheses = list
    .filter((entry) => entry.layer === 'plot' && entry.hypothesis === true && entry.open === true)
    .filter((entry) => (span === undefined || span === null ? true : isActiveAt(entry.validity, atSpan)))
    .map((entry) => ({
      id: str(entry.id),
      name: trimmed(entry.name),
      definition: trimmed(entry.definition),
      runId: trimmed(entry.provenance?.runId),
      pov: trimmed(entry.provenance?.pov)
    }))

  // 知情保真度与可见域在上面已算出（present/locations 依赖它），这里只做返回。

  return {
    version: SCENE_CONTEXT_VERSION,
    pov: focus,
    atSpan,
    knowledgeFidelity,
    known: [...known],
    present,
    locations,
    rules,
    openHypotheses,
    warnings,
    losses: Array.isArray(pack.losses) ? pack.losses : []
  }
}

/** 候选可见域：按知情保真度取「已知集合」或「世界全集」（world 降级时用后者，并已在 warnings 记账）。 */
export function visibleNamesOf(context, entries, aliasIndex = null) {
  const source = isPlainObject(context) ? context : {}
  if (source.knowledgeFidelity !== 'world') {
    return new Set(Array.isArray(source.known) ? source.known : [])
  }
  const canon = (name) => aliasIndex?.resolve(name) ?? trimmed(name)
  const all = new Set()
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isPlainObject(entry)) continue
    const name = canon(entry.name)
    if (name) all.add(name)
  }
  for (const name of Array.isArray(source.known) ? source.known : []) all.add(name)
  return all
}

/**
 * 候选引用是否落在 POV 已知集合内（别名归一后再判）。
 * 用于戏剧✦候选：玩家角色只能顺着自己知道的东西行动——引用未知实体＝玩家视角穿帮。
 */
export function refsWithinKnown(candidate, known, aliasIndex = null) {
  const set = known instanceof Set ? known : new Set(Array.isArray(known) ? known : [])
  const canon = (name) => aliasIndex?.resolve(name) ?? trimmed(name)
  for (const ref of Array.isArray(candidate?.refs) ? candidate.refs : []) {
    const name = canon(ref)
    if (!name || !set.has(name)) return false
  }
  return true
}
