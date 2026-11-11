/**
 * lean 落盘编解码（P-TRIM Track 1）：`.pinax/extractions/<dataset>.json` 的瘦条目层。
 *
 * 为什么需要它：compileExtractionEntries 产出的 fact.data/v2 全形状条目里，大量字节是
 * 「可从信封与段表确定性重建」的重复（schema/domain/status 常量、provenance.book/chapters、
 * sources 三元组、events[].title/segments、fingerprint.metrics）。
 * 落盘存瘦条目、读时归一回全形状——内存与单条流通（补丁通道/hookWiring/factPack）永远全形状。
 *
 * 信封契约（pinax-extraction-dataset/v2 的 current 新增字段）：
 *   spec           {domain, book, bookId}（既有）
 *   mode           'analyze'（既有常量）
 *   extractor      EXTRACTION_CHAIN_VERSION（既有常量）
 *   statusByLayer  {plot:'draft', character:'proposed', worldview:'proposed'}——compile 的 status 是层纯函数；
 *                  同层混态时该层置 null，条目逐条自带 status（诚实优先于省字节）
 *   entriesFormat  'lean@1'
 *
 * 无损纪律（比 ADR 原稿更严，实测教训）：**只删「读时能确定性重建」的字段；重建不了的保留原样**。
 *   - sources 非空 → srcs＋provenance 瘦形＋删 fingerprint（段表能逐项重建）；
 *   - sources 缺失（外来形状，如旧产线/工作流产物）→ 原样透传 sources/provenance/fingerprint——
 *     它们的 events[].title 就是正文、metrics 无法重算，删了就是数据丢失；
 *   - events[].title 只在 content 存在时删（重建＝content）；segments 只在 segmentIndex 存在时删。
 *   原 ADR 设想的 L7/L8（空数组省略）同样已砍：`aliases: []` 全形状恒存在，删了 roundtrip 就不回。
 *
 * 红线（本模块不碰）：quote_hash（版权溯源，瘦形保留为 provenance.quoteHash，段表每段也有完整 hash）、
 * validity、refs（events[].refs）、name/layer/slot（stableEntryId 输入，id 零漂移的前提）。
 *
 * 纯函数、零宿主依赖：只 import fact 域内相对路径。
 */
import { FACT_SCHEMA } from '../../domain/vocabulary.js'

export const LEAN_FORMAT = 'lean@1'

/** 编译形状条目上，可由信封/段表确定性重建的字段（读时回填）。 */
const DROPPED_ENTRY_FIELDS = new Set(['schema', 'domain', 'fingerprint', 'sources', 'status', 'provenance'])
/** 编译形状事件上可重建的字段：title＝content 复制；segments＝provenance.segmentIndex 的段元数据。 */
const DROPPED_EVENT_FIELDS = new Set(['title', 'segments'])

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

/** 条目层汇总：statusByLayer（同层异态为 null＝该层逐条自带）＋混态层集合。 */
export function summarizeStatuses(entries) {
  const byLayer = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isPlainObject(entry) || !entry.layer) continue
    const status = String(entry.status ?? '')
    if (!byLayer.has(entry.layer)) byLayer.set(entry.layer, new Set())
    byLayer.get(entry.layer).add(status)
  }
  const statusByLayer = {}
  const mixed = new Set()
  for (const [layer, statuses] of byLayer) {
    if (statuses.size === 1) statusByLayer[layer] = [...statuses][0]
    else { statusByLayer[layer] = null; mixed.add(layer) }
  }
  return { statusByLayer, mixedLayers: mixed }
}

/** 信封事实：spec（domain/book/bookId）＋mode/extractor＋statusByLayer。mode/extractor 缺省回落首条 provenance。 */
export function buildEnvelopeFacts(entries, spec = {}, fallbacks = {}) {
  const first = (Array.isArray(entries) ? entries : []).find((entry) => isPlainObject(entry?.provenance)) ?? null
  return {
    domain: String(spec.domain ?? ''),
    book: String(spec.book ?? ''),
    bookId: String(spec.bookId ?? ''),
    mode: String(fallbacks.mode ?? first?.provenance.mode ?? 'analyze'),
    extractor: String(fallbacks.extractor ?? first?.provenance.extractor ?? ''),
    ...summarizeStatuses(entries)
  }
}

/** 段索引：segmentId → {sourceId, chapterNo, hash, index, chars}（sources 在落盘层不瘦，直接可用）。 */
export function buildSegmentIndex(sources) {
  const index = new Map()
  for (const source of Array.isArray(sources) ? sources : []) {
    if (!isPlainObject(source)) continue
    for (const segment of Array.isArray(source.segments) ? source.segments : []) {
      if (!isPlainObject(segment) || typeof segment.id !== 'string') continue
      index.set(segment.id, {
        sourceId: source.id,
        chapterNo: source.chapterNo,
        hash: segment.hash,
        index: segment.index,
        chars: segment.chars
      })
    }
  }
  return index
}

/**
 * 全形状条目 → 瘦条目。envelope = buildEnvelopeFacts 的产物。
 * 混态层（envelope 里 statusByLayer 为 null）的条目逐条保留 status。
 */
export function toLeanEntry(entry, envelope) {
  if (!isPlainObject(entry)) return entry
  const envelopeStatus = envelope.statusByLayer?.[entry.layer]
  // 无损前提：sources 非空＝provenance/fingerprint/事件段元数据都能从段表确定性重建
  const hasSources = Array.isArray(entry.sources) && entry.sources.length > 0
  const hasSegmentIndex = Number.isInteger(entry.provenance?.segmentIndex)
  const out = {}
  for (const [key, value] of Object.entries(entry)) {
    if (hasSources && DROPPED_ENTRY_FIELDS.has(key)) continue
    out[key] = value
  }
  if (envelopeStatus) out.status = envelopeStatus // 混态层逐条带；同层纯态省略
  if (hasSources) {
    // events：title＝content 复制（重建）；segments＝单段元数据（provenance.segmentIndex ＋ 段表重建）
    if (Array.isArray(entry.events)) {
      out.events = entry.events.map((event) => {
        if (!isPlainObject(event)) return event
        const slim = {}
        for (const [key, value] of Object.entries(event)) {
          if (DROPPED_EVENT_FIELDS.has(key) && (key === 'title' ? typeof event.content === 'string' : hasSegmentIndex)) continue
          slim[key] = value
        }
        return slim
      })
    }
    // sources → srcs：[segmentId, …]——段表里有 sourceId/hash/chars，读时确定性重建三元组（L3）
    out.srcs = entry.sources.map((ref) => ref?.segmentId).filter(Boolean)
    // provenance → {quoteHash, segmentIndex?}：quote_hash 是版权溯源红线，瘦形改名保留；其余信封/段表可重建
    if (isPlainObject(entry.provenance)) {
      const provenance = { quoteHash: entry.provenance.quote_hash ?? null }
      if (hasSegmentIndex) provenance.segmentIndex = entry.provenance.segmentIndex
      out.provenance = provenance
    }
  }
  return out
}

/**
 * 瘦条目 → 全形状（读时归一）。segIndex 由 buildSegmentIndex(sources) 提供。
 * 编译形状：srcs 重建 sources 三元组/chapters/fingerprint；quote_hash 用瘦形里的 provenance.quoteHash（不重算公式，存储即真源）。
 * 外来形状（无 srcs）：原样透传——无损纪律。
 */
export function fromLeanEntry(lean, envelope, segIndex) {
  if (!isPlainObject(lean)) return lean
  const spec = envelope ?? {}
  const out = {}
  for (const [key, value] of Object.entries(lean)) {
    // status/provenance/srcs 三个瘦形字段在下面按形状重建；srcs 漏删会让归一产物混进瘦形残留
    if (key === 'status' || key === 'provenance' || key === 'srcs') continue
    out[key] = value
  }
  out.schema = FACT_SCHEMA
  out.domain = spec.domain ?? ''
  const status = lean.status ?? spec.statusByLayer?.[lean.layer] ?? null
  if (status) out.status = status
  const hasSrcs = Array.isArray(lean.srcs) && lean.srcs.length > 0
  if (hasSrcs) {
    const refs = lean.srcs.map((segmentId) => {
      const segment = segIndex.get(segmentId) ?? null
      return { sourceId: segment?.sourceId ?? null, segmentId, quote_hash: segment?.hash ?? null }
    })
    out.sources = refs
    const chapters = [...new Set(refs.map((ref) => segIndex.get(ref.segmentId)?.chapterNo).filter((value) => Number.isInteger(value)))]
      .sort((a, b) => a - b)
    out.provenance = {
      mode: spec.mode ?? 'analyze',
      book: spec.book ?? '',
      book_id: spec.bookId ?? '',
      chapters,
      scenes: [],
      extractor: spec.extractor ?? '',
      quote_hash: lean.provenance?.quoteHash ?? null,
      ...(Number.isInteger(lean.provenance?.segmentIndex) ? { segmentIndex: lean.provenance.segmentIndex } : {})
    }
    out.fingerprint = {
      vec: null,
      metrics: {
        sources: refs.length,
        chars: refs.reduce((sum, ref) => sum + (segIndex.get(ref.segmentId)?.chars ?? 0), 0)
      }
    }
    // events：title＝content（编译口径原样复制）；segments＝本条目首段元数据（chars 取本条 src）
    if (Array.isArray(lean.events)) {
      const segmentIndex = Number.isInteger(lean.provenance?.segmentIndex) ? lean.provenance.segmentIndex : null
      const ownSegment = segmentIndex !== null ? segIndex.get(lean.srcs[0]) ?? null : null
      const segmentChars = ownSegment && ownSegment.index === segmentIndex ? ownSegment.chars : null
      out.events = lean.events.map((event) => ({
        ...event,
        // v3 瘦条目本就没有 title（≢ 读时重建的字段）；只在原始事件确实带 title 时保留。
        ...(event.title !== undefined ? { title: event.title } : {}),
        novelty: Array.isArray(event.novelty) ? event.novelty : [],
        ...(segmentIndex !== null && segmentChars !== null ? { segments: [{ index: segmentIndex, chars: segmentChars }] } : {})
      }))
    }
  } else {
    // 外来形状：provenance/fingerprint 原样保留（toLean 没删它们）
    if (lean.provenance !== undefined) out.provenance = lean.provenance
    if (lean.fingerprint !== undefined) out.fingerprint = lean.fingerprint
    if (Array.isArray(lean.events)) {
      out.events = lean.events.map((event) => (isPlainObject(event) && event.title === undefined && typeof event.content === 'string'
        ? { ...event, title: event.content }
        : event))
    }
  }
  return out
}

/**
 * 读时归一（tolerant reader）：编译形状条目（带 schema＝v1 全形状）原样过；瘦条目归一回全形状。
 * 归一产物是刚构造的新对象；编译形状条目原样引用（调用方不改它）。
 */
export function normalizeDatasetEntries(rawEntries, envelope, segIndex) {
  const list = Array.isArray(rawEntries) ? rawEntries : []
  return list.map((entry) => (isPlainObject(entry) && entry.schema === FACT_SCHEMA ? entry : fromLeanEntry(entry, envelope, segIndex)))
}

/** 落盘前把 current.entries 瘦化（write 侧统一出口；条目顺序不变）。 */
export function leanDatasetEntries(rawEntries, envelope) {
  return (Array.isArray(rawEntries) ? rawEntries : []).map((entry) => toLeanEntry(entry, envelope))
}
