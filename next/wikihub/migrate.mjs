/**
 * pedia/v1 → pedia/v2 条目迁移器（ADR D2 切换判据之一：迁移器 diff=0 的前置工具）。
 *
 * 纯函数：不读磁盘、不改入参、不依赖 Node 内置模块。
 * 迁移规则（对应工单第 7 条）：
 *   1) schema 升到 pedia/v2；
 *   2) provenance.mode 缺失时按来源推断：世界书载体（next.medium='worldbook'）＝ author，
 *      小说/剧本结构锚点（分析得来）＝ analyze；
 *   3) status 缺失时补 draft；validity 缺失时按 span 推双时间轴（无锚点给 null/null）；
 *   4) analyze 模式下 provenance.quote 原文必须剥离，只留 quote_hash（并记账）；
 *   5) character 补 anchors/memoryPoints/knowledge 默认空值；plot 补 rhythmSpec/structureTemplates、
 *      events 双轨默认 fact；
 *   6) style 层条目改投文风能力包（S1 解耦），不再进 hub 一等公民层。
 */

import {
  DEFAULT_ENTRY_STATUS,
  ENTRY_STATUSES,
  PEDIA_SCHEMA,
  createRhythmSpec,
  sha1Hex,
  validatePediaEntry
} from '../pedia/domain/pediaSchema.js'
import { validityFromSpan } from '../pedia/domain/validity.js'
import { createNovelStylePack, styleEntryFromWorldbook } from './packs/novel-style.mjs'
import { segmentText } from '../pedia/domain/segment.js'

export const PEDIA_MIGRATION_VERSION = 'pedia/v1→v2'

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function isEmptySpan(span) {
  return !isPlainObject(span)
}

function inferMode(entry) {
  const provenanceMode = str(entry?.provenance?.mode)
  if (provenanceMode === 'analyze' || provenanceMode === 'author') return provenanceMode
  return entry?.next?.medium === 'worldbook' ? 'author' : 'analyze'
}

function segmentMetadata(events) {
  if (!Array.isArray(events)) return events
  return events.map((event) => {
    if (!isPlainObject(event) || typeof event.text !== 'string') return event
    // 只落段的数量/字数结构，不把正文搬进 plot 层。
    const segments = segmentText(event.text).map((segment) => ({ index: segment.index, chars: segment.chars }))
    return { ...event, segments }
  })
}

function migratePlot(entry, losses, warnings) {
  const next = { ...entry }
  if (next.rhythmSpec === undefined) next.rhythmSpec = createRhythmSpec()
  if (next.structureTemplates === undefined) next.structureTemplates = []
  if (Array.isArray(next.events)) {
    let defaulted = 0
    next.events = next.events.map((event) => {
      if (!isPlainObject(event)) return event
      if (event.track === 'fact' || event.track === 'hypothesis') return event
      defaulted += 1
      return { ...event, track: 'fact' }
    })
    next.events = segmentMetadata(next.events)
    if (defaulted) {
      warnings.push({ code: 'PLOT_TRACK_DEFAULTED', message: `${defaulted} 个事件没有双轨标记，迁移按 fact 处理` })
    }
  }
  return next
}

function migrateCharacter(entry) {
  const next = { ...entry }
  if (next.anchors === undefined) next.anchors = { speech: [], behavior: [], catchphrase: [] }
  if (next.memoryPoints === undefined) next.memoryPoints = []
  if (next.knowledge === undefined) next.knowledge = []
  return next
}

/**
 * 迁移单条 v1 条目。
 * 返回 { ok, entry, styleEntry, checks, losses, warnings }；
 * style 条目返回 entry=null、styleEntry=能力包条目（不参与 pedia 校验）。
 */
export function migrateV1Entry(entry, _options = {}) {
  const losses = []
  const warnings = []
  if (!isPlainObject(entry)) {
    return {
      ok: false,
      entry: null,
      styleEntry: null,
      losses,
      warnings,
      checks: { ok: false, errors: [{ code: 'INVALID_ENTRY', field: 'entry', message: '条目必须是对象' }], warnings: [] }
    }
  }
  if (entry.layer === 'style') {
    const styleEntry = styleEntryFromWorldbook(entry, { slot: entry.slot })
    return { ok: true, entry: null, styleEntry, losses, warnings, checks: { ok: true, errors: [], warnings: [] } }
  }

  const next = { ...entry, schema: PEDIA_SCHEMA }
  if (next.status === undefined) {
    next.status = DEFAULT_ENTRY_STATUS
  } else if (!ENTRY_STATUSES.includes(str(next.status))) {
    warnings.push({ code: 'STATUS_RESET', message: `未知状态「${next.status}」已重置为 ${DEFAULT_ENTRY_STATUS}` })
    next.status = DEFAULT_ENTRY_STATUS
  }

  const provenance = isPlainObject(entry.provenance) ? { ...entry.provenance } : {}
  provenance.mode = inferMode(entry)
  if (typeof provenance.quote === 'string') {
    if (provenance.mode === 'analyze') {
      if (!provenance.quote_hash) provenance.quote_hash = sha1Hex(provenance.quote)
      delete provenance.quote
      losses.push({ code: 'quote-hashed', field: 'provenance.quote', message: 'analyze 模式的 quote 原文已剥离，只保留 quote_hash' })
    }
  }
  next.provenance = provenance

  if (isEmptySpan(next.validity)) next.validity = validityFromSpan(next.span)

  if (next.layer === 'character') Object.assign(next, migrateCharacter(next))
  if (next.layer === 'plot') Object.assign(next, migratePlot(next, losses, warnings))

  const checks = validatePediaEntry(next)
  return { ok: checks.ok, entry: next, styleEntry: null, checks, losses, warnings }
}

/**
 * 迁移一组 v1 条目。style 条目汇总成文风能力包。
 * 返回 { ok, schema, entries, stylePack, losses, warnings, issues, valid }。
 */
export function migrateV1Hub(input, options = {}) {
  const source = Array.isArray(input) ? input : (Array.isArray(input?.entries) ? input.entries : [])
  const entries = []
  const styleEntries = []
  const losses = []
  const warnings = []
  const issues = []

  for (const raw of source) {
    const result = migrateV1Entry(raw, options)
    losses.push(...result.losses)
    warnings.push(...result.warnings)
    if (result.styleEntry) {
      styleEntries.push(result.styleEntry)
      continue
    }
    if (!result.entry) {
      issues.push({ code: 'MIGRATION_FAILED', id: raw?.id, name: raw?.name, message: '条目无法迁移' })
      continue
    }
    if (!result.ok) {
      issues.push({ code: 'PEDIA_INVALID', id: result.entry.id, name: result.entry.name, errors: result.checks.errors })
    }
    entries.push(result.entry)
  }

  const stylePack = styleEntries.length
    ? createNovelStylePack({ entries: styleEntries, genre: options.genre ?? 'novel' })
    : null

  return {
    ok: issues.length === 0,
    schema: PEDIA_SCHEMA,
    version: PEDIA_MIGRATION_VERSION,
    valid: issues.length === 0,
    entries,
    stylePack,
    losses,
    warnings,
    issues
  }
}

export default migrateV1Hub
