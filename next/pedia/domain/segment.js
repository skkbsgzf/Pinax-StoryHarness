/**
 * pedia/v2 数据粒度纯函数（ADR S4，domain 真源，Core 平移件）。
 *
 * 口径：数据单元＝段（非句）；每段 100–300 字：
 *   - 超过 300 字：按均衡原则拆开，拆点优先落在句末标点、逗号/顿号或空白处；
 *   - 不足 100 字：并入邻段（优先并右）；两边合并都会超 300 时从邻段搬字补到 100；
 *   - 整篇不足 100 字、或没有可搬的邻段时，保留原样并如实返回。
 *
 * 管线（P2a）与存量迁移器（P2b）共用这一份实现：不读磁盘、不依赖宿主内置模块。
 * 字数按 Unicode 码点计（中文 1 字、英文 1 字符、空格计入）。
 */

export const SEGMENT_MIN_CHARS = 100
export const SEGMENT_MAX_CHARS = 300

const TERMINATORS = new Set(['。', '！', '？', '!', '?', '；', ';', '…'])
const SOFT_BREAKS = new Set(['，', ',', '、', '：', ':', ' ', '\t', '—', '-'])
const CJK_LAST = /[\u3000-\u9fff\uff00-\uffef]/u
const WORD_LAST = /[A-Za-z0-9)\]'".,!?;:]/u
const WORD_FIRST = /[A-Za-z0-9([{'"]/u

function codePoints(text) {
  return Array.from(String(text ?? ''))
}

export function charCount(text) {
  return codePoints(text).length
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function normalizeOptions(options = {}) {
  const first = positiveInteger(options.min, SEGMENT_MIN_CHARS)
  const second = positiveInteger(options.max, SEGMENT_MAX_CHARS)
  return { min: Math.min(first, second), max: Math.max(first, second) }
}

export function splitParagraphs(text) {
  return String(text ?? '')
    .replace(/\r\n?/gu, '\n')
    .split(/\n[ \t]*\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

/** 按句末标点切句；标点留在句尾。段落内没有句末标点时整段算一句。 */
export function splitSentences(paragraph) {
  const sentences = []
  let current = ''
  for (const ch of codePoints(paragraph)) {
    current += ch
    if (TERMINATORS.has(ch)) {
      if (current.trim()) sentences.push(current.trim())
      current = ''
    }
  }
  if (current.trim()) sentences.push(current.trim())
  return sentences
}

/**
 * 在目标位置附近找一个不切断词/句的落点（优先空白与软标点，其次硬切）。
 * 返回切点下标（1..target），不会超过 max。
 */
function preferredCut(chars, target, max) {
  const limit = Math.min(target, max, chars.length - 1)
  if (limit <= 0) return 0
  const floor = Math.max(1, limit - 20)
  for (let index = limit; index >= floor; index -= 1) {
    const ch = chars[index - 1]
    if (ch && (SOFT_BREAKS.has(ch) || TERMINATORS.has(ch))) return index
  }
  return limit
}

/** 超长句均衡拆分：保证每段 ≤ max，并尽量让每段 ≥ min。 */
function splitLongSentence(sentence, { min, max }) {
  const chars = codePoints(sentence)
  if (chars.length <= max) return [sentence]
  const count = Math.ceil(chars.length / max)
  const target = Math.min(max, Math.max(1, Math.max(min, Math.ceil(chars.length / count))))
  const parts = []
  let rest = chars
  while (rest.length > max) {
    const cut = preferredCut(rest, Math.min(target, max), max)
    if (cut <= 0) break
    const head = rest.slice(0, cut).join('').trim()
    if (head) parts.push(head)
    rest = rest.slice(cut)
  }
  const tail = rest.join('').trim()
  if (tail) parts.push(tail)
  return parts
}

function joinText(left, right) {
  if (!left) return right
  if (!right) return left
  const last = codePoints(left).pop() ?? ''
  const first = codePoints(right)[0] ?? ''
  if (!CJK_LAST.test(last) && WORD_LAST.test(last) && WORD_FIRST.test(first)) return `${left} ${right}`
  return `${left}${right}`
}

/** 段内先按句打包到 ≤ max；不主动凑满，短段留给 mergeUnits 合并。 */
function packParagraph(paragraph, limits) {
  const units = []
  let current = ''
  const flush = () => {
    const text = current.trim()
    if (text) units.push(text)
    current = ''
  }
  for (const sentence of splitSentences(paragraph)) {
    const parts = charCount(sentence) > limits.max ? splitLongSentence(sentence, limits) : [sentence]
    for (const part of parts) {
      if (!part) continue
      if (current && charCount(current) + charCount(part) > limits.max) flush()
      current = joinText(current, part)
    }
  }
  flush()
  return units
}

/** 从下一段搬 prefix 给短段；优先落在空白/软标点。 */
function takePrefix(text, need) {
  const chars = codePoints(text)
  if (need <= 0 || !chars.length) return ''
  const cut = preferredCut(chars, Math.min(need, chars.length - 1), chars.length)
  return chars.slice(0, Math.max(1, cut)).join('')
}

/**
 * 短段合并：左右能放得下就并（优先并右）；放不下时从邻段搬字补到 min。
 * 只处理「< min」的段，≥ min 的段不主动重排。
 */
function mergeUnits(units, { min, max }) {
  const normalized = units
    .map((text) => ({ text, chars: charCount(text) }))
    .filter((unit) => unit.chars > 0)

  const merged = []
  for (const unit of normalized) {
    const last = merged[merged.length - 1]
    const short = last ? last.chars < min : false
    if (last && (short || unit.chars < min)) {
      const joined = joinText(last.text, unit.text)
      if (charCount(joined) <= max) {
        last.text = joined
        last.chars = charCount(joined)
        continue
      }
    }
    merged.push({ ...unit })
  }

  for (let index = 0; index < merged.length - 1; index += 1) {
    const current = merged[index]
    if (current.chars >= min) continue
    const next = merged[index + 1]
    const need = min - current.chars
    if (next.chars - need < min || next.chars <= need) continue
    const moved = takePrefix(next.text, need)
    if (!moved) continue
    current.text = joinText(current.text, moved)
    current.chars = charCount(current.text)
    next.text = next.text.slice(moved.length).replace(/^\s+/u, '')
    next.chars = charCount(next.text)
    // 软落点可能少搬几个字：再按硬切补足，邻段仍须 ≥ min。
    const remaining = min - current.chars
    if (remaining > 0 && next.chars - remaining >= min) {
      const extra = codePoints(next.text).slice(0, remaining).join('')
      current.text = joinText(current.text, extra)
      current.chars = charCount(current.text)
      next.text = next.text.slice(extra.length).replace(/^\s+/u, '')
      next.chars = charCount(next.text)
    }
  }

  return merged.filter((unit) => unit.chars > 0)
}

/**
 * 文本 → 段序列。返回 [{ index, text, chars }]；空文本返回 []。
 * options.min / options.max 可覆盖 100/300（非法值回落默认）。
 */
export function segmentText(text, options = {}) {
  const limits = normalizeOptions(options)
  const units = []
  for (const paragraph of splitParagraphs(text)) {
    units.push(...packParagraph(paragraph, limits))
  }
  return mergeUnits(units, limits).map((unit, index) => ({
    index: index + 1,
    text: unit.text,
    chars: unit.chars
  }))
}

/** 段序列的读数（测试与管线共用）：越界计数是「规则没做到」的诚实账。 */
export function segmentStats(segments, options = {}) {
  const limits = normalizeOptions(options)
  const list = Array.isArray(segments) ? segments : []
  const chars = list.map((segment) => (Number.isInteger(segment?.chars) ? segment.chars : charCount(segment?.text)))
  return {
    count: list.length,
    totalChars: chars.reduce((sum, value) => sum + value, 0),
    minChars: chars.length ? Math.min(...chars) : 0,
    maxChars: chars.length ? Math.max(...chars) : 0,
    underMin: chars.filter((value) => value < limits.min).length,
    overMax: chars.filter((value) => value > limits.max).length,
    limits
  }
}
