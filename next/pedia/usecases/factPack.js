/**
 * 事实包投影查询（ADR S2/S3：续写前「此刻世界是什么样」的结构化快照）。
 *
 * 纯函数：entries + 查询（时点/区间、角色、槽位、域）→ 事实包。
 *   - 世界状态规则：worldview 条目按槽位归组，ordered 槽位按 rank 排序；
 *   - 事件图：plot 条目的事件按 fact/hypothesis 双轨拆开；
 *   - 角色知情：角色条目在某时点已知的信息（来自 knowledge ledger）；
 *   - 生效区间：每条命中条目在查询区间内的有效子区间（null 为无界）。
 *
 * 查询区间语义：条目 validity 与查询 span 相交即命中（无界视为全时段）；
 * 「角色此刻知道什么」用已知时点 ≤ 查询起点判断（更早知道的仍然记得）。
 */

import { isActiveAt, intersectValidity, normalizeSpan } from '../domain/validity.js'
import { OTHER_SLOT } from '../domain/vocabulary.js'
import { createAliasIndex } from '../domain/aliases.js'

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function entryName(entry) {
  return str(entry?.name).trim()
}

function entryId(entry) {
  return str(entry?.id)
}

function knowledgeAtSpan(record, span) {
  const at = isPlainObject(record?.atSpan) ? record.atSpan : {}
  const knownFrom = Number.isInteger(at.from) ? at.from : (Number.isInteger(at.to) ? at.to : null)
  if (knownFrom === null) return true
  if (span.from === null) return true
  return knownFrom <= span.from
}

function projectEntry(entry, span) {
  const validity = isPlainObject(entry.validity) ? entry.validity : null
  return {
    id: entryId(entry),
    name: entryName(entry),
    layer: entry.layer,
    slot: entry.slot ?? null,
    rank: Number.isInteger(entry.rank) ? entry.rank : null,
    status: entry.status ?? null,
    definition: str(entry.definition),
    aliases: Array.isArray(entry.aliases) ? [...entry.aliases] : [],
    validity,
    effective: validity ? intersectValidity(validity, span) : { ...span }
  }
}

/**
 * @param {Object[]} entries pedia/v2 条目
 * @param {Object} [query] { span, character, slots, layer, domain, includeInactive }
 * @param {Object} [options] { aliasIndex }
 */
export function buildFactPack(entries, query = {}, options = {}) {
  const list = Array.isArray(entries) ? entries.filter(isPlainObject) : []
  const source = isPlainObject(query) ? query : {}
  const span = normalizeSpan(source.span)
  const warnings = []
  const losses = []
  const aliasIndex = options.aliasIndex ?? createAliasIndex(list)

  if (source.span !== undefined && !Number.isInteger(source.span) && !isPlainObject(source.span)) {
    warnings.push({ code: 'SPAN_MALFORMED', message: 'span 不是整数或 {from,to}，按无界处理' })
  }

  const slotFilter = Array.isArray(source.slots) && source.slots.length ? new Set(source.slots) : null
  const domainFilter = str(source.domain).trim() || null
  const layerFilter = str(source.layer).trim() || null

  const active = list.filter((entry) => {
    if (layerFilter && entry.layer !== layerFilter) return false
    if (domainFilter && entry.domain !== domainFilter) return false
    if (source.includeInactive !== true && !isActiveAt(entry.validity, span)) return false
    return true
  })

  const worldview = active.filter((entry) => entry.layer === 'worldview')
  const slots = {}
  for (const entry of worldview) {
    const slot = str(entry.slot) || OTHER_SLOT
    if (slotFilter && !slotFilter.has(slot)) continue
    if (!slots[slot]) slots[slot] = []
    slots[slot].push(projectEntry(entry, span))
  }
  const ordered = []
  for (const [slot, items] of Object.entries(slots)) {
    items.sort((left, right) => {
      if (left.rank !== null && right.rank !== null) return left.rank - right.rank
      return left.name.localeCompare(right.name, 'zh-Hans-CN')
    })
    if (items.some((item) => item.rank !== null)) ordered.push({ slot, items: items.map((item) => ({ id: item.id, name: item.name, rank: item.rank })) })
  }

  const events = { facts: [], hypotheses: [] }
  for (const entry of active.filter((item) => item.layer === 'plot')) {
    const trackEvents = Array.isArray(entry.events) ? entry.events : []
    for (const event of trackEvents) {
      if (!isPlainObject(event)) continue
      const track = event.track === 'hypothesis' ? 'hypothesis' : 'fact'
      events[track === 'hypothesis' ? 'hypotheses' : 'facts'].push({
        entryId: entryId(entry),
        entryName: entryName(entry),
        index: Number.isInteger(event.index) ? event.index : null,
        title: str(event.title),
        refs: Array.isArray(event.refs) ? [...event.refs] : [],
        segments: Array.isArray(event.segments) ? event.segments.map((segment) => ({ ...segment })) : [],
        novelty: Array.isArray(event.novelty) ? [...event.novelty] : []
      })
    }
  }

  const focus = str(source.character).trim()
  const characters = {}
  const characterEntries = active.filter((entry) => entry.layer === 'character' || entry.castRole !== undefined)
  for (const entry of characterEntries) {
    const name = entryName(entry)
    if (focus && name !== focus && aliasIndex.resolve(focus) !== name) continue
    characters[name] = {
      id: entryId(entry),
      name,
      castRole: isPlainObject(entry.castRole) ? { ...entry.castRole } : null,
      anchors: isPlainObject(entry.anchors) ? { ...entry.anchors } : null,
      memoryPoints: Array.isArray(entry.memoryPoints) ? [...entry.memoryPoints] : [],
      knowledge: (Array.isArray(entry.knowledge) ? entry.knowledge : [])
        .filter((record) => isPlainObject(record) && knowledgeAtSpan(record, span))
        .map((record) => ({
          fromEntry: str(record.fromEntry),
          kind: str(record.kind),
          atSpan: isPlainObject(record.atSpan) ? { ...record.atSpan } : null
        }))
    }
  }
  if (focus && !characters[focus] && !Object.keys(characters).length) {
    const resolved = aliasIndex.resolve(focus)
    warnings.push({ code: 'QUERY_CHARACTER_UNKNOWN', message: `查询角色「${focus}」在条目集里找不到${resolved ? `（别名指向 ${resolved}）` : ''}` })
  }

  const supplements = active
    .filter((entry) => isPlainObject(entry.readerCognition))
    .filter((entry) => entry.readerCognition.firstMention === true || entry.readerCognition.supplementNeeded === true)
    .map((entry) => ({
      id: entryId(entry),
      name: entryName(entry),
      firstMention: entry.readerCognition.firstMention === true,
      supplementNeeded: entry.readerCognition.supplementNeeded === true
    }))

  const effective = active.map((entry) => {
    const projected = projectEntry(entry, span)
    return { id: projected.id, name: projected.name, layer: projected.layer, validity: projected.validity, effective: projected.effective }
  })

  if (list.length === 0) {
    losses.push({ code: 'EMPTY_ENTRY_SET', message: '事实包为空：没有任何条目可供投影' })
  }

  return {
    ok: true,
    query: {
      span,
      character: focus || null,
      slots: slotFilter ? [...slotFilter] : null,
      layer: layerFilter,
      domain: domainFilter
    },
    world: {
      slots,
      ordered,
      rules: slots.rules ?? []
    },
    events,
    characters,
    supplements,
    effective,
    counts: {
      entries: active.length,
      worldview: worldview.length,
      facts: events.facts.length,
      hypotheses: events.hypotheses.length,
      characters: Object.keys(characters).length
    },
    warnings,
    losses
  }
}
