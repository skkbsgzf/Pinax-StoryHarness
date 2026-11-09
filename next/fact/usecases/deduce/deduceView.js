/**
 * 推演视图薄封装（M1-c）：把 M1-a/M1-b 的纯引擎形状接到「第一视角」面板上。
 *
 * 禁宿主依赖：只 import fact 域内模块（domain / usecases），因此渲染层可以直接 import，
 * 不会把 Node 内建、fs、wikihub 或内核工具面拖进 renderer（打包门禁 f/f2 守的正是这件事）。
 * 这里只做「形状转换」与「POV 裁剪」，不持有会话状态、不落盘——会话编排仍在引擎与外壳组件里。
 *
 * 职责：
 *   - normalizeFactEntries：世界书面条目 → fact.data/v2 形状（layer/slot/status/definition/relations）；
 *     已是 fact 形状的条目原样保留，不做「草稿冒充 adopted」的静默改判。
 *   - povKnown：factPack 的 characters[pov].knowledge（knowledgeOf POV）→ 已知情报名清单；
 *   - povRelations：POV 只见已知的人物关系（两端都必须在 POV 的已知集合里）；
 *   - sceneViewModel：局面卡四字段 ＋ 候选徽章（命运骰 trace 文案）的展示形状；
 *   - archiveSnapshot：收束／中断的快照留档形状（纯数据，供 M1-b checkpoint 事件的 data 用）。
 */
import { buildFactPack } from '../factPack.js'
import { stableEntryId } from '../../domain/stableId.js'
import { FACT_SCHEMA } from '../../domain/vocabulary.js'
import { stateHash } from './sessionStore.js'

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function trimmed(value) {
  return str(value).trim()
}

/** 类别词 → 标准世界观槽位；命中即停，未命中归 other。 */
const CATEGORY_SLOT = Object.freeze({
  地点: 'locations', 地理: 'locations', location: 'locations', place: 'locations',
  事件: 'events', 编年: 'events', event: 'events',
  规则: 'rules', 设定: 'rules', rule: 'rules', 试炼: 'rules', forbidden: 'rules',
  组织: 'orgs', 势力: 'orgs', organization: 'orgs', faction: 'orgs',
  物品: 'items', item: 'items',
  概念: 'concepts', concept: 'concepts', lore: 'concepts',
  生物: 'creatures', creature: 'creatures',
  身份: 'roles', 职业: 'roles',
  力量: 'power_levels', 序列: 'power_levels',
  技能: 'abilities', ability: 'abilities'
})

const CHARACTER_HINTS = new Set(['人物', '角色', '主角', 'character', 'person', 'cast', 'protagonist'])

function categoriesOf(raw) {
  const out = []
  const cat = raw.cat
  if (Array.isArray(cat)) out.push(...cat.map((item) => trimmed(item).toLowerCase()))
  else if (typeof cat === 'string' && cat.trim()) out.push(cat.trim().toLowerCase())
  for (const key of ['catDir', 'type', 'kind']) {
    const value = trimmed(raw[key])
    if (value) out.push(value.toLowerCase())
  }
  return out
}

function slotOf(categories) {
  for (const cat of categories) {
    if (CATEGORY_SLOT[cat]) return CATEGORY_SLOT[cat]
    if (CHARACTER_HINTS.has(cat)) continue
    for (const [word, slot] of Object.entries(CATEGORY_SLOT)) {
      if (cat.includes(word)) return slot
    }
  }
  return 'other'
}

function isCharacter(raw, categories) {
  if (raw.castRole !== undefined) return true
  return categories.some((cat) => CHARACTER_HINTS.has(cat))
}

function definitionOf(raw, name) {
  const summary = trimmed(raw.summary || raw.definition)
  if (summary) return summary.slice(0, 200)
  const content = str(raw.content).trim()
  if (content) return content.split('\n')[0].trim().slice(0, 200) || name
  return name
}

function normalizeRelations(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    const relation = isPlainObject(item) ? item : { to: item }
    const to = trimmed(relation.to ?? relation.target ?? relation.name)
    if (!to) continue
    out.push({
      to,
      label: trimmed(relation.label ?? relation.kind ?? relation.type) || '关联'
    })
  }
  return out
}

function normalizeKnowledge(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    const record = isPlainObject(item) ? item : { fromEntry: item }
    const fromEntry = trimmed(record.fromEntry ?? record.name)
    if (!fromEntry) continue
    out.push({ fromEntry, kind: trimmed(record.kind) || '已知' })
  }
  return out
}

/**
 * 世界书面条目 → fact 形状条目。
 * - 已是 fact 形状（带 layer）：保留 layer/slot/status/knowledge/relations，补最小字段；
 * - 世界书形状：按 cat/type/kind 判 layer=character|worldview，按类别判 slot，status=adopted。
 * 返回的是新数组，不改原条目（世界书面数据由外壳持有，推演层不写回）。
 */
export function normalizeFactEntries(boardEntries) {
  const list = Array.isArray(boardEntries) ? boardEntries : []
  const out = []
  for (const raw of list) {
    if (!isPlainObject(raw)) continue
    const name = trimmed(raw.name ?? raw.title ?? raw.id)
    if (!name) continue

    if (raw.layer === 'worldview' || raw.layer === 'character' || raw.layer === 'plot') {
      out.push({
        ...raw,
        name,
        status: raw.status ?? 'adopted',
        definition: trimmed(raw.definition) || name,
        relations: normalizeRelations(raw.relations),
        knowledge: normalizeKnowledge(raw.knowledge),
        aliases: Array.isArray(raw.aliases) ? raw.aliases.map((item) => trimmed(item)).filter(Boolean) : []
      })
      continue
    }

    const categories = categoriesOf(raw)
    const layer = isCharacter(raw, categories) ? 'character' : 'worldview'
    const slot = layer === 'character' ? '' : slotOf(categories)
    const keys = [...(Array.isArray(raw.keys) ? raw.keys : []), ...(Array.isArray(raw.aliases) ? raw.aliases : [])]
    out.push({
      schema: FACT_SCHEMA,
      id: trimmed(raw.id) || stableEntryId({ layer, domain: '', slot, name }),
      name,
      layer,
      slot,
      domain: trimmed(raw.domain),
      status: 'adopted',
      definition: definitionOf(raw, name),
      aliases: keys.map((item) => trimmed(item)).filter(Boolean),
      relations: normalizeRelations(raw.relations),
      knowledge: normalizeKnowledge(raw.knowledge)
    })
  }
  return out
}

/** 视角角色候选（绑主角下拉用）。 */
export function characterOptions(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.layer === 'character' && trimmed(entry.name))
    .map((entry) => ({ name: trimmed(entry.name), definition: trimmed(entry.definition) }))
}

/**
 * 已知情报：factPack 的 knowledgeOf POV。
 * buildFactPack(entries, { character: pov }) 已经把 knowledge ledger 按 atSpan 与焦点裁过一次，
 * 这里再收成去重、去掉 POV 自己的名字清单——「第一视角只见已知」的基准集合。
 */
export function povKnown(entries, pov) {
  const focus = trimmed(pov)
  if (!focus) return []
  const pack = buildFactPack(Array.isArray(entries) ? entries : [], { character: focus })
  const record = pack.characters?.[focus]
  const names = []
  for (const item of record?.knowledge ?? []) {
    const name = trimmed(item?.fromEntry)
    if (name && name !== focus && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * 人物关系（轻列表）：两端都必须在 POV 已知集合（含 POV 自己）里才可见。
 * knownNames 一般由 povKnown ＋ 本局结算累积的 knowledgeDelta.gained 合并而来——
 * 于是「POV 只见已知」在关系面板与情报面板是同一把尺子，不会两边各裁各的。
 */
export function povRelations(entries, pov, knownNames = []) {
  const focus = trimmed(pov)
  const known = new Set([focus, ...(Array.isArray(knownNames) ? knownNames : [])].map(trimmed).filter(Boolean))
  const rows = []
  const seen = new Set()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const from = trimmed(entry?.name)
    if (!from || !known.has(from)) continue
    for (const relation of Array.isArray(entry.relations) ? entry.relations : []) {
      const to = trimmed(relation?.to)
      if (!to || !known.has(to) || to === from) continue
      const key = `${from}\u0000${to}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ from, to, label: trimmed(relation?.label) || '关联' })
    }
  }
  return rows.slice(0, 24)
}

/** 来源徽章词表（与 candidates.js 的 badge/source 一一对应）。 */
export const CANDIDATE_BADGES = Object.freeze([
  Object.freeze({ source: '必然', badge: '▮', label: '必然' }),
  Object.freeze({ source: '命运', badge: '⚙', label: '命运' }),
  Object.freeze({ source: '戏剧', badge: '✦', label: '戏剧' })
])

/** 局面卡四字段 ＋ 候选展示形状（含命运骰 2d6 trace 文案）。 */
export function sceneViewModel(sceneCard = {}, candidates = []) {
  const card = isPlainObject(sceneCard) ? sceneCard : {}
  const fields = [
    { key: 'who', label: '在场', value: (Array.isArray(card.who) ? card.who : []).map(trimmed).filter(Boolean).join('、') || '—' },
    { key: 'where', label: '地点', value: trimmed(card.where) || '—' },
    { key: 'tension', label: '张力', value: trimmed(card.tension) || '—' },
    { key: 'hook', label: '钩子', value: trimmed(card.hook) || '—' }
  ]
  const options = (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
    id: trimmed(candidate?.id),
    source: trimmed(candidate?.source),
    badge: trimmed(candidate?.badge),
    text: trimmed(candidate?.text),
    proposed: candidate?.proposed === true,
    adopted: candidate?.adopted === true,
    refs: Array.isArray(candidate?.refs) ? candidate.refs.map(trimmed).filter(Boolean) : [],
    trace: isPlainObject(candidate?.trace) ? { ...candidate.trace } : null,
    traceText: isPlainObject(candidate?.trace)
      ? `2d6 ${candidate.trace.a}+${candidate.trace.b}=${candidate.trace.sum} · ${candidate.trace.success ? '顺遂' : '受阻'}`
      : ''
  }))
  return { fields, options }
}

/** 收束／中断的快照留档形状（纯数据，供 M1-b checkpoint 事件的 data 与面板回执用）。 */
export function archiveSnapshot({ state, session, reason = 'final', events = [], at = new Date().toISOString() } = {}) {
  const snapshot = isPlainObject(state) ? state : {}
  const meta = isPlainObject(session) ? session : {}
  return {
    runId: trimmed(meta.runId ?? snapshot.runId),
    pov: trimmed(meta.pov ?? snapshot.pov),
    worldHash: trimmed(meta.worldHash ?? snapshot.worldHash),
    round: Number.isInteger(snapshot.round) ? snapshot.round : 0,
    reason: reason === 'interrupt' ? 'interrupt' : 'final',
    archivedAt: at,
    logLength: Array.isArray(snapshot.log) ? snapshot.log.length : 0,
    eventCount: Array.isArray(events) ? events.length : 0,
    stateHash: stateHash(snapshot)
  }
}
