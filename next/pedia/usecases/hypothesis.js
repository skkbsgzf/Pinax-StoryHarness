/**
 * 假设回灌（ADR S3：推演出的「可能剧情」回写成 proposed 事件条目）。
 *
 * 口径：
 *   - 假设一律落 plot 层事件、track=hypothesis、status=proposed（等人/后续章节拍板）；
 *   - 证据链必须有：basedOn 指向事实包里的条目 id 或名称，逐条记录「依据了哪条事实」；
 *   - 证据解析不到的，保留原引用并标记 resolved=false（如实记账，不编造来源）；
 *   - provenance.mode=analyze：假设是分析得来，quote 只留哈希（这里根本不带原文）。
 */

import { PEDIA_SCHEMA } from '../domain/vocabulary.js'
import { stableEntryId } from '../domain/stableId.js'
import { validatePediaEntry } from '../domain/schema.js'

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

function nameOfHypothesis(hypothesis, statement) {
  const explicit = firstText(hypothesis.name, hypothesis.title)
  if (explicit) return explicit
  const text = statement.replace(/\s+/gu, '')
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

function resolveBasis(reference, facts) {
  const ref = isPlainObject(reference) ? reference : { id: str(reference), name: str(reference) }
  const id = firstText(ref.id)
  const name = firstText(ref.name, ref.id)
  const found = facts.find((entry) => (id ? entry.id === id : false))
    ?? facts.find((entry) => (name ? entry.name === name : false))
  if (!found) return null
  return { entry: found, requested: { id: id || null, name: name || null } }
}

/**
 * @param {Object} input
 * @param {Object} input.hypothesis { statement, name?, basedOn: Array<string|Object>, confidence?, validity?, refs? }
 * @param {Object[]} [input.facts] 依据的条目（通常来自 buildFactPack 的源条目集）
 * @param {string} [input.domain]
 * @param {string} [input.book]
 * @param {string} [input.bookId]
 * @param {string} [input.extractor]
 */
export function backflowHypothesis(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const hypothesis = isPlainObject(source.hypothesis) ? source.hypothesis : {}
  const facts = Array.isArray(source.facts) ? source.facts.filter(isPlainObject) : []
  const statement = firstText(hypothesis.statement, hypothesis.text)
  const errors = []
  const warnings = []

  if (!statement) errors.push({ code: 'HYPOTHESIS_STATEMENT_REQUIRED', message: '假设缺少 statement' })
  const basedOn = Array.isArray(hypothesis.basedOn) ? hypothesis.basedOn : []
  if (!basedOn.length) errors.push({ code: 'HYPOTHESIS_WITHOUT_EVIDENCE', message: '假设必须给 basedOn（依据了哪条事实）' })

  const evidence = []
  for (const reference of basedOn) {
    const resolved = resolveBasis(reference, facts)
    if (resolved) {
      evidence.push({
        entryId: str(resolved.entry.id),
        name: str(resolved.entry.name),
        layer: resolved.entry.layer ?? null,
        slot: resolved.entry.slot ?? null,
        definition: str(resolved.entry.definition),
        resolved: true
      })
      continue
    }
    const ref = isPlainObject(reference) ? reference : { name: str(reference), id: '' }
    evidence.push({ entryId: str(ref.id) || null, name: str(ref.name) || null, definition: '', resolved: false })
    warnings.push({ code: 'HYPOTHESIS_EVIDENCE_UNRESOLVED', message: `证据「${firstText(ref.name, ref.id)}」在事实集里找不到` })
  }
  if (evidence.length && !evidence.some((item) => item.resolved)) {
    errors.push({ code: 'HYPOTHESIS_EVIDENCE_ALL_UNRESOLVED', message: '所有证据都解析不到，不能落一条无依据的假设' })
  }

  if (errors.length) return { ok: false, errors, warnings, evidence, entry: null }

  const domain = firstText(source.domain, hypothesis.domain)
  const book = firstText(source.book, hypothesis.book)
  const name = nameOfHypothesis(hypothesis, statement)
  const validity = isPlainObject(hypothesis.validity) ? { ...hypothesis.validity } : undefined
  const entry = {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain, slot: '', name }),
    layer: 'plot',
    name,
    domain,
    status: 'proposed',
    definition: statement,
    fact: statement,
    hypothesis: [{ statement, evidence: evidence.map((item) => ({ ...item })) }],
    events: [{
      index: 1,
      track: 'hypothesis',
      title: name,
      refs: Array.isArray(hypothesis.refs) ? [...hypothesis.refs] : [],
      segments: [],
      novelty: []
    }],
    provenance: {
      mode: 'analyze',
      book,
      book_id: firstText(source.bookId, hypothesis.bookId),
      chapters: [],
      scenes: [],
      extractor: firstText(source.extractor, hypothesis.extractor, 'pedia/hypothesis@1'),
      confidence: typeof hypothesis.confidence === 'number' ? hypothesis.confidence : undefined
    },
    fingerprint: { vec: null, metrics: { evidenceCount: evidence.filter((item) => item.resolved).length } }
  }
  if (validity) entry.validity = validity

  const validation = validatePediaEntry(entry)
  return {
    ok: validation.ok,
    entry,
    evidence,
    validation,
    errors: validation.errors,
    warnings: [...warnings, ...validation.warnings]
  }
}
