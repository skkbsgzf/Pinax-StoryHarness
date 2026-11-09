/**
 * 一致性预检（ADR S2-3 + 双时间轴）：写正文/大纲前的「硬伤」检查。
 *
 * 两类断言：
 *   1) 视角：草稿在某角色视角、某时点引用的设定/事件，必须在该角色的知情矩阵里且已知时点不晚于此刻；
 *      —— 防上帝视角（角色说出他此刻不可能知道的事）。
 *   2) 双时间轴：草稿引用的条目 validity 必须覆盖草稿时点；草稿自身若带 validity，也要与写作时点相交。
 *
 * 只读：不写 store、不改条目。返回 issues 列表，severity=error 表示必须改，warning 可人工判断。
 */

import { checkPerspective } from '../domain/perspective.js'
import { isActiveAt, intersectValidity, normalizeSpan, spansOverlap } from '../domain/validity.js'
import { createAliasIndex } from '../domain/aliases.js'

const REF_PATTERN = /@《([^》]+)》/gu

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

/** 从正文里取 @《…》 引用（与 shell 的解析同口径，域内不依赖宿主）。 */
export function extractRefs(text) {
  const refs = []
  for (const match of str(text).matchAll(REF_PATTERN)) {
    const ref = match[1].trim()
    if (ref && !refs.includes(ref)) refs.push(ref)
  }
  return refs
}

/** 从条目集抽知情矩阵：{ 角色名: [{fromEntry, kind, atSpan}] }（只收 character.knowledge）。 */
export function knowledgeLedgerFrom(entries) {
  const ledger = {}
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isPlainObject(entry) || !Array.isArray(entry.knowledge)) continue
    const name = str(entry.name).trim()
    if (!name) continue
    const records = entry.knowledge
      .filter((record) => isPlainObject(record) && str(record.fromEntry).trim())
      .map((record) => ({
        fromEntry: str(record.fromEntry).trim(),
        kind: str(record.kind),
        atSpan: isPlainObject(record.atSpan) ? { ...record.atSpan } : null
      }))
    if (!records.length) continue
    ledger[name] = [...(ledger[name] ?? []), ...records]
  }
  return ledger
}

/**
 * @param {Object} input
 * @param {Object} input.draft { name?, text?, refs?, character?, atSpan?, validity? }
 * @param {Object[]} input.entries 参照条目集
 * @param {Object} [options] { aliasIndex }
 */
export function precheckDraft(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {}
  const draft = isPlainObject(source.draft) ? source.draft : {}
  const entries = Array.isArray(source.entries) ? source.entries.filter(isPlainObject) : []
  const aliasIndex = options.aliasIndex ?? createAliasIndex(entries)
  const span = normalizeSpan(draft.atSpan ?? source.atSpan)
  const issues = []
  const warnings = []

  const declaredRefs = Array.isArray(draft.refs) ? draft.refs : extractRefs(draft.text)
  const refs = [...new Set(declaredRefs.map((ref) => str(ref).trim()).filter(Boolean))]

  const resolvedRefs = []
  for (const ref of refs) {
    const canonical = aliasIndex.resolve(ref) ?? ref
    const entry = entries.find((item) => str(item.name).trim() === canonical)
      ?? entries.find((item) => Array.isArray(item.aliases) && item.aliases.includes(ref))
    if (!entry) {
      warnings.push({ code: 'REFERENCE_UNRESOLVED', message: `引用「${ref}」在条目集里找不到对应条目` })
      continue
    }
    resolvedRefs.push({ ref, entry })
    if (!isActiveAt(entry.validity, span)) {
      issues.push({
        code: 'REFERENCE_OUTSIDE_VALIDITY',
        severity: 'error',
        message: `引用「${ref}」在写作时点不生效（条目 validity=${formatSpan(entry.validity)}，写作时点=${formatSpan(span)}）`,
        ref,
        entryId: str(entry.id),
        entryValidity: isPlainObject(entry.validity) ? { ...entry.validity } : null,
        atSpan: { ...span }
      })
    }
  }

  const character = str(draft.character ?? source.character).trim()
  let perspective = { checked: 0, violations: [], skipped: true }
  if (character) {
    const ledger = knowledgeLedgerFrom(entries)
    const pseudo = {
      name: str(draft.name) || '草稿',
      relations: resolvedRefs.map((item) => ({ to: str(item.entry.name) })),
      perspective: { character, atSpan: { ...span } }
    }
    perspective = { ...checkPerspective(pseudo, ledger), skipped: false }
    for (const violation of perspective.violations) {
      issues.push({
        code: 'PERSPECTIVE_LEAK',
        severity: 'error',
        message: `角色「${character}」此刻不该知道「${violation.referenced}」（${violation.reason === 'known-later' ? `已知时点 ${violation.knownAt ?? '未知'} 晚于写作时点` : '不在其知情矩阵里'}）`,
        character,
        referenced: violation.referenced,
        atChapter: violation.atChapter,
        reason: violation.reason
      })
    }
  }

  let validity = null
  if (isPlainObject(draft.validity)) {
    validity = {
      self: { ...draft.validity },
      atSpan: { ...span },
      effective: intersectValidity(draft.validity, span),
      active: spansOverlap(draft.validity, span)
    }
    if (!validity.active) {
      issues.push({
        code: 'DRAFT_OUTSIDE_VALIDITY',
        severity: 'error',
        message: `草稿自身 validity=${formatSpan(draft.validity)} 与写作时点=${formatSpan(span)} 不相交`,
        validity: { ...draft.validity },
        atSpan: { ...span }
      })
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    issues,
    warnings,
    checked: {
      refs: refs.length,
      resolvedRefs: resolvedRefs.length,
      perspective: character ? perspective.checked : 0,
      character: character || null
    },
    atSpan: span,
    validity
  }
}

function formatSpan(span) {
  if (!isPlainObject(span)) return '无界'
  const from = Number.isInteger(span.from) ? span.from : '−∞'
  const to = Number.isInteger(span.to) ? span.to : '+∞'
  return `${from}..${to}`
}
