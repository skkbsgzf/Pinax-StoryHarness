import {
  ENTRY_STATUSES,
  FACT_SCHEMA,
  OTHER_SLOT,
  WORLDVIEW_SLOTS,
  isOrderedSlot,
  stableEntryId,
  validateFactEntry
} from '../fact/domain/pediaSchema.js'

/**
 * fact.data/v3 条目 → hub（世界书看板）适配器（S1 · WO-S1-03）。
 *
 * 目的只有一个：让 `拆解/<id>.json` 的 v3 条目能走**和世界书同一条消费链**上屏，
 * 不再绕 markdown。输出形状对齐 `next/wikihub/convert.mjs` 的 `worldbookToHub`：
 *   { ok, schema, valid, entries[], index:{nameToId}, mappings[], stylePack:null,
 *     prefixRules:[], exportLosses:[], losses[], warnings[], validationWarnings[], issues[] }
 * 字段来源逐条如下（“v3 新增”＝手写 md 那条路径没有的字段，允许两条路径不同）：
 *
 *   hub 字段            fact v3 来源                         备注
 *   ─────────────────  ───────────────────────────────────  ─────────────────────────────
 *   id                  entry.id                            缺失时按 layer|domain|slot|name 现算
 *   layer               entry.layer                         worldview / character / plot 原样
 *   name                entry.name                          空名条目进 issues，不伪造名字
 *   domain              entry.domain                        缺省退回书名（bookName／options.book）
 *   slot                entry.slot（仅 worldview）           词表外按 other；软层没有槽位
 *   rank                entry.rank（仅 ordered 槽位）       非整数／<1 落 null
 *   status              entry.status                        v3 新增（md 路径固定 draft）
 *   aliases             entry.aliases                       去掉与 name 相同的那一条
 *   definition          entry.definition → summary → notes  v3 条目常常没有 definition，按序回退
 *   stats.chars         entry.fingerprint.metrics.chars     缺失时按 definition/events 长度
 *   stats.keys          aliases 去重后条数                  与 worldbook 的 keys 口径一致（不含 name）
 *   stats.relations     entry.relations.length              无关系即 0
 *   provenance.mode     entry.provenance.mode               缺省 analyze（拆解产物默认口径）
 *   provenance.book     entry.provenance.book → bookName     文件顶层 book.title 是溯源真源
 *   provenance.book_id  entry.provenance.book_id → bookId   文件顶层 book.id
 *   provenance.chapters entry.provenance.chapters           v3 新增（md 路径给空数组）
 *   provenance.scenes   entry.provenance.scenes             同上
 *   provenance.extractor entry.provenance.extractor          缺省 pinax-next/fact-file@1
 *   provenance.source   {kind:'fact-entry', file, entry_id, revision}
 *                                                           file 是拆解文件名，不是绝对路径
 *   relations[].to/type/howe  entry.relations                stance 兼容 how；原样透传
 *   next.medium         'fact'                               标记这一条不是世界书快照
 *   next.fact.*         status/chapters/relationsCount/…     v3 新增；条目卡新行的数据来源
 *
 * 两条纪律：
 *   1) **不改写 v3 数据**：本模块只做投影，不加 wiki 字段、不写盘；
 *   2) `wiki.*` 一个字不碰（file 顶层的 wiki 段连读都不读）。
 */

export const FACT_HUB_EXTRACTOR = 'pinax-next/fact-file@1'

/** 槽位 → 世界书 type（看板“类型”行的口径；手写 md 那条路径由 worldbookToHub 反向推导）。 */
export const FACT_SLOT_TO_WORLDBOOK_TYPE = Object.freeze({
  power_levels: 'rule',
  abilities: 'rule',
  rules: 'rule',
  locations: 'location',
  items: 'item',
  orgs: 'organization',
  roles: 'character',
  creatures: 'creature',
  concepts: 'lore',
  events: 'event',
  other: 'general'
})

/** 槽位 → 世界书一级类别目录（看板“分类”行）。 */
export const FACT_SLOT_TO_WORLDBOOK_CAT = Object.freeze({
  power_levels: '设定',
  abilities: '设定',
  rules: '设定',
  locations: '地理',
  items: '资料',
  orgs: '势力',
  roles: '人物',
  creatures: '设定',
  concepts: '设定',
  events: '编年',
  other: '设定'
})

const FACT_LAYER_TO_WORLDBOOK_TYPE = Object.freeze({ character: 'person', plot: 'event' })
const FACT_LAYER_TO_WORLDBOOK_CAT = Object.freeze({ character: '人物', plot: '编年' })
/**
 * 看板投影用的槽位钉子。v3 的 plot/character 是软层，没有槽位；但现有 EntriesBoard 的三栏
 * 分组只认 worldview 槽位，所以给一条**展示用**的落点：人物→roles（人物组），剧情→other（其他组）。
 * 这只是看板投影，不写回条目、不影响 fact 的层语义（原 layer/slot 仍随条目保留）。
 */
const FACT_LAYER_TO_BOARD_SLOT = Object.freeze({ character: 'roles', plot: OTHER_SLOT })

function str(value) {
  return String(value ?? '')
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function uniqueStrings(values) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const text = str(value).trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/** v3 条目没有统一 summary 字段：definition → summary → notes 依次回退（与 factFileStore 同口径）。 */
export function factSummaryOf(entry) {
  return firstText(entry?.definition, entry?.summary, entry?.notes)
}

/** 看板阅读列的内容：definition → events 拼接 → notes。只读派生，不改原文。 */
export function factContentOf(entry) {
  const definition = firstText(entry?.definition)
  if (definition) return definition
  const events = Array.isArray(entry?.events) ? entry.events : []
  const joined = events
    .map((event) => str(event?.content).trim())
    .filter(Boolean)
    .join('\n\n')
  if (joined) return joined
  return firstText(entry?.notes)
}

function factCharsOf(entry) {
  const chars = Number(entry?.fingerprint?.metrics?.chars)
  if (Number.isSafeInteger(chars) && chars >= 0) return chars
  return factContentOf(entry).length
}

function factKeysOf(entry) {
  return uniqueStrings([
    ...(Array.isArray(entry?.aliases) ? entry.aliases : []),
    ...(Array.isArray(entry?.keys) ? entry.keys : [])
  ])
}

function factStatusOf(entry) {
  const status = str(entry?.status).trim()
  return ENTRY_STATUSES.includes(status) ? status : 'draft'
}

function factLayerOf(entry) {
  const layer = str(entry?.layer).trim()
  return layer === 'worldview' || layer === 'character' || layer === 'plot' ? layer : ''
}

function factSlotOf(entry, layer) {
  if (layer !== 'worldview') return ''
  const slot = str(entry?.slot).trim()
  return WORLDVIEW_SLOTS[slot] ? slot : OTHER_SLOT
}

function factRankOf(entry, layer, slot) {
  if (layer !== 'worldview' || !isOrderedSlot(slot)) return null
  const rank = Number(entry?.rank)
  return Number.isSafeInteger(rank) && rank >= 1 ? rank : null
}

function normalizeRelations(entry) {
  const relations = Array.isArray(entry?.relations) ? entry.relations : []
  const out = []
  for (const relation of relations) {
    if (!isPlainObject(relation)) continue
    const to = str(relation.to).trim()
    if (!to) continue
    const row = { to }
    if (typeof relation.type === 'string' && relation.type.trim()) row.type = relation.type.trim()
    const how = firstText(relation.how, relation.stance)
    if (how) row.how = how
    if (relation.covert === true) row.covert = true
    if (typeof relation.weight === 'number' && Number.isFinite(relation.weight)) row.weight = relation.weight
    out.push(row)
  }
  return out
}

function provenanceOf(entry, { book, bookName }) {
  const source = isPlainObject(entry?.provenance) ? entry.provenance : {}
  const bookTitle = firstText(source.book, book, bookName)
  const bookId = firstText(source.book_id, entry?.bookId, '')
  const provenance = {
    mode: source.mode === 'author' ? 'author' : 'analyze',
    book: bookTitle,
    book_id: bookId,
    chapters: Array.isArray(source.chapters) ? source.chapters.filter((item) => Number.isInteger(item)) : [],
    scenes: Array.isArray(source.scenes) ? source.scenes.filter((item) => Number.isInteger(item)) : [],
    extractor: firstText(source.extractor, FACT_HUB_EXTRACTOR),
    confidence: typeof source.confidence === 'number' ? source.confidence : 1,
    source: {
      kind: 'fact-entry',
      file: firstText(entry?.sourceFile, ''),
      entry_id: firstText(entry?.id, ''),
      book_id: bookId,
      revision: Number.isSafeInteger(entry?.revision) ? entry.revision : null
    }
  }
  if (typeof source.quote_hash === 'string' && source.quote_hash) provenance.quote_hash = source.quote_hash
  return provenance
}

function hubEntryOf(entry, { book, bookName }) {
  const layer = factLayerOf(entry)
  const slot = factSlotOf(entry, layer)
  const name = str(entry?.name).trim()
  const domain = firstText(entry?.domain, book, bookName, '拆解')
  const id = firstText(entry?.id) || stableEntryId({ layer, domain, slot: slot || '', name })
  const aliases = factKeysOf(entry).filter((alias) => alias !== name)
  const relations = normalizeRelations(entry)
  const definition = factSummaryOf(entry) || name
  const stats = isPlainObject(entry?.stats)
    ? cloneJson(entry.stats)
    : { chars: factCharsOf(entry), keys: aliases.length, relations: relations.length }

  const hubEntry = {
    schema: FACT_SCHEMA,
    id,
    layer,
    name,
    domain,
    slot,
    rank: factRankOf(entry, layer, slot),
    status: factStatusOf(entry),
    validity: isPlainObject(entry?.validity)
      ? cloneJson(entry.validity)
      : { from: null, to: null },
    definition,
    stats,
    provenance: provenanceOf(entry, { book, bookName }),
    next: {
      medium: 'fact',
      // 条目卡新行的数据来源：来源章节／状态／关系数这三样只有 v3 有。
      fact: {
        layer,
        slot: str(entry?.slot).trim(),
        status: factStatusOf(entry),
        chapters: Array.isArray(entry?.provenance?.chapters) ? entry.provenance.chapters.filter((item) => Number.isInteger(item)) : [],
        scenes: Array.isArray(entry?.provenance?.scenes) ? entry.provenance.scenes.filter((item) => Number.isInteger(item)) : [],
        relationsCount: relations.length,
        eventsCount: Array.isArray(entry?.events) ? entry.events.length : 0,
        sourcesCount: Array.isArray(entry?.sources) ? entry.sources.length : 0,
        bookId: firstText(entry?.bookId, ''),
        bookName: firstText(entry?.bookName, book),
        sourceFile: firstText(entry?.sourceFile, ''),
        revision: Number.isSafeInteger(entry?.revision) ? entry.revision : null
      }
    }
  }
  if (aliases.length) hubEntry.aliases = aliases
  if (relations.length) hubEntry.relations = relations
  return hubEntry
}

/**
 * @param {Array<object>} input fact.data/v3 条目数组（fact:list 的 entries）
 * @param {{ book?: string, bookName?: string, domain?: string }} [options]
 */
export function factEntriesToHub(input, options = {}) {
  const list = Array.isArray(input) ? input : (Array.isArray(input?.entries) ? input.entries : [])
  const book = firstText(options.book, options.bookName, list[0]?.bookName, list[0]?.provenance?.book, '拆解')
  const bookName = firstText(options.bookName, book)
  const entries = []
  const mappings = []
  const warnings = []
  const issues = []
  const validationWarnings = []
  const losses = []

  for (const raw of list) {
    if (!isPlainObject(raw)) {
      issues.push({ code: 'ENTRY_NOT_OBJECT', message: 'fact 条目不是对象，已跳过' })
      continue
    }
    const layer = factLayerOf(raw)
    const name = str(raw?.name).trim()
    if (!layer) {
      issues.push({ code: 'UNKNOWN_LAYER', id: str(raw?.id), message: `条目「${name || str(raw?.id)}」的 layer 不在 worldview/character/plot 里，已跳过` })
      continue
    }
    if (!name) {
      issues.push({ code: 'ENTRY_WITHOUT_NAME', id: str(raw?.id), message: '条目没有名称（name 为空），已跳过' })
      continue
    }

    // 校验只作旁路事实：v3 存量里可能有历史口径（v2 schema／软层缺 fingerprint），
    // 读路径不因为一条警告把整本挡在门外；真写入时 S2 的 writeFactFile 才拿 errors 当闸。
    const checked = validateFactEntry(raw)
    for (const warning of checked.warnings) validationWarnings.push({ id: str(raw.id), name, ...warning })
    if (!checked.ok) {
      warnings.push({ code: 'FACT_ENTRY_INVALID', id: str(raw.id), name, message: `条目「${name}」没通过 v3 信封校验（读路径照常展示，写路径会拒）`, errors: checked.errors })
    }

    const hubEntry = hubEntryOf(raw, { book, bookName })
    entries.push(hubEntry)
    mappings.push({
      id: hubEntry.id,
      name,
      layer: hubEntry.layer,
      slot: hubEntry.slot,
      status: hubEntry.status,
      chapters: hubEntry.next.fact.chapters,
      via: 'fact-entry'
    })
    if (hubEntry.layer !== 'worldview') {
      losses.push({
        code: 'soft-layer-no-worldbook-type',
        field: 'type',
        message: `条目「${name}」是 ${hubEntry.layer} 软层，没有世界书 type；看板投影按层给类型`
      })
    }
  }

  const nameToId = {}
  for (const entry of entries) nameToId[entry.name] = entry.id

  return {
    ok: true,
    schema: FACT_SCHEMA,
    valid: warnings.every((warning) => warning.code !== 'FACT_ENTRY_INVALID'),
    book,
    domain: firstText(options.domain, entries[0]?.domain, book),
    entries,
    index: { nameToId },
    mappings,
    stylePack: null,
    prefixRules: [],
    exportLosses: [],
    losses,
    warnings,
    validationWarnings,
    issues
  }
}

/**
 * 看板数据面的投影（S1 · WO-S1-04）：现有 EntriesBoard 仍会自己做一次 worldbookToHub，
 * 所以这里给的是**世界书运行时条目形状**（name/content/summary/keys/type/cat/extra…），
 * 由 EntriesBoard 的那条既有转换链变成三栏模型——版式与组件一个字不用动。
 *
 * 与 factEntriesToHub 的分工：前者是 hub 真身（将来直接喂 buildHubViewModel 的入口），
 * 这里是「就地兼容」的运行时投影；两者字段同源（都从同一条 v3 条目读），不各猜一套。
 * 投影里保留原 layer/slot/status/chapters 等 v3 字段，S3 换版式时可直接读，不必再取一次数。
 */
export function factEntriesToBoardEntries(input, options = {}) {
  const hub = factEntriesToHub(input, options)
  const sourceById = new Map()
  for (const entry of Array.isArray(input) ? input : []) {
    if (isPlainObject(entry) && str(entry.id)) sourceById.set(str(entry.id), entry)
  }

  return hub.entries.map((entry) => {
    const source = sourceById.get(entry.id) ?? {}
    const layer = factLayerOf(source) || entry.layer
    const boardSlot = layer === 'worldview' ? (entry.slot || OTHER_SLOT) : (FACT_LAYER_TO_BOARD_SLOT[layer] ?? OTHER_SLOT)
    const type = layer === 'worldview'
      ? (FACT_SLOT_TO_WORLDBOOK_TYPE[boardSlot] ?? 'general')
      : (FACT_LAYER_TO_WORLDBOOK_TYPE[layer] ?? 'general')
    const catDir = layer === 'worldview'
      ? (FACT_SLOT_TO_WORLDBOOK_CAT[boardSlot] ?? '设定')
      : (FACT_LAYER_TO_WORLDBOOK_CAT[layer] ?? '设定')
    const content = factContentOf(source) || entry.definition
    const aliases = factKeysOf(source).filter((alias) => alias !== entry.name)
    const relations = normalizeRelations(source)
    return {
      id: entry.id,
      name: entry.name,
      type,
      kind: type,
      cat: [catDir],
      catDir,
      tags: [],
      keys: aliases,
      aliases,
      summary: entry.definition,
      content,
      relations,
      chars: factCharsOf(source),
      revision: Number.isSafeInteger(source.revision) ? source.revision : 1,
      path: '',
      contract: true,
      // v3 真值随投影一起带着走（worldbookToHub 不读这些键，界面将来读得到）：
      layer,
      slot: layer === 'worldview' ? (entry.slot || OTHER_SLOT) : '',
      status: entry.status,
      domain: entry.domain,
      definition: entry.definition,
      provenance: entry.provenance,
      sources: Array.isArray(source.sources) ? source.sources : [],
      extra: {
        // 槽位钉子：worldbookToHub 的 resolveSlot 只认 extra.pediaSlot，靠它把分组带过去。
        pediaSlot: boardSlot,
        fact: entry.next.fact
      }
    }
  })
}
