/**
 * S2-3 视角校验（domain 真源，Core 平移件）。
 *
 * 口径：条目在某角色视角、某时点引用了哪些信息，对照 knowledge ledger 判断
 * 「此刻是否已知」；无 perspective 时跳过（skipped:'NO_PERSPECTIVE'），不误报。
 */

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

/** 把两种 ledger 形状统一成 Map<角色名, 记录[]>。 */
export function normalizeKnowledgeLedger(ledger) {
  const map = new Map()
  const push = (character, record) => {
    const name = firstText(character)
    if (!name || !isPlainObject(record)) return
    if (!Array.isArray(map.get(name))) map.set(name, [])
    map.get(name).push(record)
  }
  if (Array.isArray(ledger)) {
    for (const record of ledger) {
      if (!isPlainObject(record)) continue
      push(firstText(record.character, record.who, record.name), record)
    }
  } else if (isPlainObject(ledger)) {
    for (const [character, records] of Object.entries(ledger)) {
      if (Array.isArray(records)) for (const record of records) push(character, record)
    }
  }
  return map
}

function chapterOf(span) {
  if (Number.isSafeInteger(span)) return span
  if (isPlainObject(span)) {
    if (Number.isSafeInteger(span.from)) return span.from
    if (Number.isSafeInteger(span.to)) return span.to
  }
  return null
}

/** 条目引用到的名字（relations.to 与 refs 两类，去重）。 */
export function knowledgeReferencesOf(entry) {
  const names = []
  const push = (value) => {
    const text = str(value).trim()
    if (text && !names.includes(text)) names.push(text)
  }
  if (Array.isArray(entry.relations)) {
    for (const relation of entry.relations) push(relation?.to)
  }
  if (Array.isArray(entry.refs)) {
    for (const ref of entry.refs) push(isPlainObject(ref) ? ref.title : ref)
  }
  return names
}

/**
 * 知情矩阵校验（ADR S2-3 角色向）。
 *
 * entry.perspective = { character: '柯秒', atSpan: { from: 3, to: 3 } }
 * knowledgeLedger 支持两种形状：
 *   { 柯秒: [{ fromEntry: '停摆的表', atSpan: { from: 5, to: 5 }, kind: 'event' }] }
 *   [{ character: '柯秒', fromEntry: '停摆的表', atSpan: { from: 5, to: 5 }, kind: 'event' }]
 *
 * 返回 { ok, character, atChapter, checked, violations }；
 * 无 perspective 时跳过（skipped:'NO_PERSPECTIVE'），不误报。
 */
export function checkPerspective(entry, knowledgeLedger, options = {}) {
  const violations = []
  if (!isPlainObject(entry)) {
    return { ok: false, character: '', atChapter: null, checked: 0, violations: [{ code: 'INVALID_ENTRY', message: '条目必须是对象' }] }
  }
  const perspective = isPlainObject(entry.perspective) ? entry.perspective : null
  const character = firstText(perspective?.character, options.character, entry.character)
  if (!character) {
    return { ok: true, character: '', atChapter: null, checked: 0, skipped: 'NO_PERSPECTIVE', violations }
  }
  const atChapter = chapterOf(perspective?.atSpan) ?? chapterOf(options.atSpan)
  const records = normalizeKnowledgeLedger(knowledgeLedger).get(character) ?? []
  const references = knowledgeReferencesOf(entry)

  for (const referenced of references) {
    if (referenced === str(entry.name).trim()) continue
    const matches = records.filter((record) => str(record.fromEntry).trim() === referenced)
    if (!matches.length) {
      violations.push({
        code: 'PERSPECTIVE_UNKNOWN_INFO',
        character,
        entry: str(entry.name),
        referenced,
        atChapter,
        reason: 'not-in-ledger'
      })
      continue
    }
    if (atChapter === null) continue
    const known = matches.some((record) => {
      const knownAt = chapterOf(record.atSpan)
      return knownAt === null || knownAt <= atChapter
    })
    if (!known) {
      const knownAt = matches
        .map((record) => chapterOf(record.atSpan))
        .filter((value) => value !== null)
        .sort((left, right) => left - right)[0] ?? null
      violations.push({
        code: 'PERSPECTIVE_UNKNOWN_INFO',
        character,
        entry: str(entry.name),
        referenced,
        atChapter,
        knownAt,
        reason: 'known-later'
      })
    }
  }

  return { ok: violations.length === 0, character, atChapter, checked: references.length, violations }
}
