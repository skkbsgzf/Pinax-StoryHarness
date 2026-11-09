/**
 * 文风能力包（ADR S1：style 从 pedia/v2 一等公民层解耦）。
 *
 * 定位：文风与「剧本格式」「画风」同级，是更上层的**包装能力包**——挂 data-小说，
 * 仅在小说体裁生效；不参与 Core pedia 的跨书迁移，也不占 worldview 的 11 个槽位。
 *
 * 包内承载 v1 style 层的 metrics/samples/生成约束：
 *   - targets：目标区间（句长/段长/对话占比等，可配置）；
 *   - samples：代表句；
 *   - constraints：生成约束/禁则（forbidden / required）。
 *
 * 本文件纯函数、无磁盘依赖；入口在 convert.mjs（世界书 style 类条目改投）与 migrate.mjs（v1 迁移）。
 */

import { sha1Hex } from '../../pedia/domain/stableId.js'

export const NOVEL_STYLE_PACK_ID = 'novel-style'
export const NOVEL_STYLE_PACK_VERSION = 'novel-style/v1'
export const NOVEL_STYLE_GENRE = 'novel'

/** 默认目标区间与 S4 粒度口径对齐（段 100–300 字）；可整体覆盖。 */
export const DEFAULT_STYLE_TARGETS = Object.freeze({
  sentenceChars: Object.freeze([12, 40]),
  paragraphChars: Object.freeze([100, 300]),
  dialogueRatio: Object.freeze([0.2, 0.6])
})

const DEFAULT_CONSTRAINTS = Object.freeze({
  forbidden: Object.freeze([]),
  required: Object.freeze([])
})

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
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

function cloneTargets(targets) {
  const source = isPlainObject(targets) ? targets : DEFAULT_STYLE_TARGETS
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    out[key] = Array.isArray(value) ? [...value] : value
  }
  return out
}

function cloneConstraints(constraints) {
  const source = isPlainObject(constraints) ? constraints : DEFAULT_CONSTRAINTS
  return {
    forbidden: uniqueStrings(Array.isArray(source.forbidden) ? source.forbidden : []),
    required: uniqueStrings(Array.isArray(source.required) ? source.required : [])
  }
}

/** 世界书侧：type/kind 是 style 的条目（文风类设定）。 */
export function isStyleWorldbookEntry(entry) {
  return entry?.type === 'style' || entry?.kind === 'style'
}

/**
 * 条目的能力包槽位：名称前缀（剧作·）命中的用 creative_rules；type=style 的用 style。
 * 返回空串表示不是文风类条目。
 */
export function stylePackSlot(worldbookEntry, slotInfo) {
  if (slotInfo?.layer === 'style') return slotInfo.slot || 'creative_rules'
  if (isStyleWorldbookEntry(worldbookEntry)) return 'style'
  return ''
}

function snapshotOf(entry) {
  return isPlainObject(entry?.next?.worldbook) ? entry.next.worldbook : null
}

function textOf(entry) {
  const snapshot = snapshotOf(entry)
  return firstText(
    snapshot?.content,
    snapshot?.summary,
    entry?.content,
    entry?.summary,
    entry?.definition,
    entry?.text
  )
}

/**
 * 一条文风类条目 → 能力包条目（v1 hub style 条目或 normalized 世界书条目都接）。
 * creative_rules 是包内分组键，不再冒充世界观槽位。
 */
export function styleEntryFromWorldbook(entry, options = {}) {
  const snapshot = snapshotOf(entry)
  const name = firstText(entry?.name, snapshot?.name, entry?.title, entry?.id, '未命名文风条目')
  const slot = firstText(options.slot, entry?.slot, snapshot?.type === 'style' ? 'style' : '') || 'style'
  const path = firstText(snapshot?.path, entry?.path, entry?.provenance?.source?.path)
  const sourceEntryId = firstText(entry?.id, snapshot?.id)
  const samples = [
    ...(Array.isArray(entry?.samples) ? entry.samples : []),
    ...(Array.isArray(entry?.summarySamples) ? entry.summarySamples : [])
  ]
  return {
    id: `style-${sha1Hex([name, path, slot].join('|')).slice(0, 10)}`,
    name,
    kind: slot === 'creative_rules' ? 'creative-rule' : 'style',
    slot,
    text: textOf(entry),
    summary: firstText(entry?.summary, snapshot?.summary, entry?.definition),
    tags: uniqueStrings([...(Array.isArray(entry?.tags) ? entry.tags : []), ...(Array.isArray(snapshot?.tags) ? snapshot.tags : [])]),
    keys: uniqueStrings([...(Array.isArray(entry?.keys) ? entry.keys : []), ...(Array.isArray(snapshot?.keys) ? snapshot.keys : [])]),
    path,
    sourceEntryId,
    samples: uniqueStrings(samples),
    metrics: isPlainObject(entry?.fingerprint?.metrics) ? { ...entry.fingerprint.metrics } : null
  }
}

/**
 * 生成文风能力包。
 *
 * entries 可以是 normalized 世界书条目（convert 传入）或 v1 hub style 条目（migrate 传入）。
 * genre 决定 active：只有 novel 体裁生效（ADR S1）。
 */
export function createNovelStylePack({ entries = [], genre = NOVEL_STYLE_GENRE, targets, samples, constraints, note = '' } = {}) {
  const packEntries = (Array.isArray(entries) ? entries : []).map((entry) => (
    entry && entry.packEntry === true ? entry : styleEntryFromWorldbook(entry)
  ))
  const derivedSamples = packEntries.flatMap((entry) => entry.samples ?? [])
  const active = normalizeGenre(genre) === NOVEL_STYLE_GENRE
  return {
    pack: NOVEL_STYLE_PACK_ID,
    version: NOVEL_STYLE_PACK_VERSION,
    genre: NOVEL_STYLE_GENRE,
    appliesTo: [NOVEL_STYLE_GENRE],
    active,
    ...(note ? { note } : {}),
    targets: cloneTargets(targets),
    samples: uniqueStrings([...(Array.isArray(samples) ? samples : []), ...derivedSamples]),
    constraints: cloneConstraints(constraints),
    entries: packEntries,
    sourceEntryIds: uniqueStrings(packEntries.map((entry) => entry.sourceEntryId))
  }
}

export function normalizeGenre(genre) {
  return str(genre).trim().toLowerCase()
}

/** 能力包是否在当前体裁生效：只有小说体裁挂载（剧本/其他返回 active:false 与原因）。 */
export function resolveStylePack(pack, { genre = NOVEL_STYLE_GENRE } = {}) {
  if (!isPlainObject(pack)) {
    return { active: false, reason: 'NO_PACK', pack: null }
  }
  const normalized = normalizeGenre(genre)
  if (normalized !== NOVEL_STYLE_GENRE) {
    return { active: false, reason: 'GENRE_NOT_SUPPORTED', pack }
  }
  return { active: true, reason: 'NOVEL', pack }
}

/** 从一组能力包条目里汇总生成约束（供渲染/技能读取；本批只提供纯函数）。 */
export function styleConstraintsOf(pack) {
  if (!isPlainObject(pack)) return { forbidden: [], required: [] }
  return cloneConstraints(pack.constraints)
}
