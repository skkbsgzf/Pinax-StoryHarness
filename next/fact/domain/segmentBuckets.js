/**
 * 分桶分段（作者 2026-11-12 裁定）。
 *
 * 作者原话：「分段不合理的这个，明显是代码考虑少了，肯定是优先按照桶的原理，
 * 一段一段文字放，优先保证完整章节，这个算法很简单，需要补。」
 *
 * 三层：**章（桶）→ 段**：
 *   1) 按章节标记把全文切桶；没有章节标记时整篇一个桶；
 *   2) 桶内按段落/句子贪心装到 ≤ max；
 *   3) **合并不跨桶**——一章末尾哪怕只剩 20 字，也不并到下一章；
 *   4) 章标题行不单独成段（它并进该章首段，前缀保留）；
 *   5) 段文本是**原文切片**（记 [start,end) 再从原文切），保证逐字可溯源。
 *
 * 纯函数、零宿主依赖。
 */

export const SEGMENT_MIN_CHARS = 100
export const SEGMENT_MAX_CHARS = 300

const TERMINATORS = new Set(['。', '！', '？', '!', '?', '；', ';', '…'])
const SOFT_BREAKS = new Set(['，', ',', '、', '：', ':', ' ', '\t', '—', '-'])
const CJK_LAST = /[\u3000-\u9fff\uff00-\uffef]/u
const WORD_LAST = /[A-Za-z0-9)\]'".,!?;:]/u
const WORD_FIRST = /[A-Za-z0-9([{'"]/u

/** 章节标记行：`第1章 …` / `第一章 …` / `Chapter 1 …`。 */
const CHAPTER_LINE = new RegExp('^[ \\t\\u3000]*(?:第\\s*(?:\\d+|[一二三四五六七八九十百千零两]+)\\s*[章节回]|Chapter\\s+\\d+)', 'iu')
const CHAPTER_NUMBER = /(?:第\s*(\d+|[一二三四五六七八九十百千零两]+)\s*[章节回]|Chapter\s+(\d+))/iu

const codePoints = (text) => Array.from(String(text ?? ''))
export const charCount = (text) => codePoints(text).length
/** 正文字数（不含空白）——「100–300 字」的口径。 */
export const contentCharCount = (text) => codePoints(String(text ?? '').replace(/\s+/gu, '')).length

const positiveInteger = (value, fallback) => (Number.isSafeInteger(value) && value > 0 ? value : fallback)

function normalizeLimits(options = {}) {
  const first = positiveInteger(options.min, SEGMENT_MIN_CHARS)
  const second = positiveInteger(options.max, SEGMENT_MAX_CHARS)
  return { min: Math.min(first, second), max: Math.max(first, second) }
}

/** 中文数字 → 阿拉伯数字；解析不出返回 null。 */
export function toChapterNumber(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (/^\d+$/u.test(text)) return Number(text)
  const DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const UNITS = { 十: 10, 百: 100, 千: 1000 }
  let section = 0
  let digit = 0
  for (const ch of text) {
    if (ch in DIGITS) { digit = DIGITS[ch]; continue }
    if (ch in UNITS) { section += (digit || 1) * UNITS[ch]; digit = 0; continue }
    return null
  }
  const total = section + digit
  return total > 0 ? total : null
}

/**
 * 全文 → 桶（章）。桶是分段上界，段永不跨桶。
 * @returns {Array<{text:string,start:number,end:number,chapterNo:number|null,title:string|null}>}
 */
export function splitBuckets(text) {
  const raw = String(text ?? '').replace(/\r\n?/gu, '\n')
  if (!raw.trim()) return []

  const lines = raw.split('\n')
  const spans = []
  let cursor = 0
  for (const line of lines) {
    spans.push({ start: cursor, end: cursor + line.length })
    cursor += line.length + 1
  }

  const cuts = []
  lines.forEach((line, index) => { if (CHAPTER_LINE.test(line)) cuts.push(index) })
  if (!cuts.length) cuts.push(0)

  const buckets = []
  for (let order = 0; order < cuts.length; order += 1) {
    const from = cuts[order]
    const to = order + 1 < cuts.length ? cuts[order + 1] : lines.length
    const start = spans[from].start
    const end = spans[to - 1].end
    const body = raw.slice(start, end)
    if (!body.trim()) continue
    const match = CHAPTER_NUMBER.exec(lines[from])
    const chapterNo = match ? (match[1] ? toChapterNumber(match[1]) : Number(match[2])) : null
    buckets.push({
      text: body,
      start,
      end,
      chapterNo,
      title: CHAPTER_LINE.test(lines[from]) ? lines[from].trim() : null
    })
  }
  return buckets
}

export function splitParagraphs(text) {
  return String(text ?? '')
    .replace(/\r\n?/gu, '\n')
    .split(/\n[ \t]*\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

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

const joinText = (left, right) => {
  if (!left) return right
  if (!right) return left
  const last = codePoints(left).pop() ?? ''
  const first = codePoints(right)[0] ?? ''
  if (!CJK_LAST.test(last) && WORD_LAST.test(last) && WORD_FIRST.test(first)) return `${left} ${right}`
  return `${left}${right}`
}

/**
 * 桶内打包成段（只产出原文连续区间；段文本最后由 segmentText 从原文反切）。
 */
function packBucket(bucket, limits) {
  /** 收集 piece；章标题行不独立成段，作为该章首段的**前缀**并进去。 */
  const pieces = []
  let titlePrefix = null
  for (const paragraph of splitParagraphs(bucket.text)) {
    const paragraphAt = bucket.text.indexOf(paragraph)
    let searchFrom = 0
    for (const sentence of splitSentences(paragraph)) {
      // 整句就是章标题（「第1章 相亲」）→ 记作前缀，不入 pieces。
      if (CHAPTER_LINE.test(sentence.trim()) && sentence.trim().length <= 40) {
        titlePrefix = titlePrefix ? `${titlePrefix}${sentence.trim()}` : sentence.trim()
        searchFrom += sentence.length
        continue
      }
      const parts = charCount(sentence) > limits.max ? splitLongSentence(sentence, limits) : [sentence]
      for (const part of parts) {
        if (!part) continue
        const at = paragraph.indexOf(part, searchFrom)
        const local = at >= 0 ? at : searchFrom
        searchFrom = local + part.length
        const abs = bucket.start + Math.max(0, paragraphAt) + local
        pieces.push({ text: part, start: abs, end: abs + part.length })
      }
    }
  }

  const units = []
  let current = null
  const flush = () => { if (current) units.push(current); current = null }
  for (const piece of pieces) {
    if (current && contentCharCount(`${current.text}${piece.text}`) > limits.max) flush()
    if (!current) current = { start: piece.start, end: piece.end, text: piece.text }
    else { current.text = joinText(current.text, piece.text); current.end = piece.end }
  }
  flush()

  // 章标题前缀并进本章首段（段文本仍从原文切，所以前缀只用于「组句」判断，不影响切片）。
  if (titlePrefix && units.length) units[0].text = joinText(titlePrefix, units[0].text)

  // 桶内合并：相邻短段能并就并（绝不跨桶）。
  const merged = []
  for (const unit of units) {
    const last = merged[merged.length - 1]
    if (last && contentCharCount(last.text) < limits.min
      && contentCharCount(`${last.text}${unit.text}`) <= limits.max) {
      last.text = joinText(last.text, unit.text)
      last.end = unit.end
      continue
    }
    merged.push({ ...unit })
  }
  // 仍偏短且桶内还有后续段：从段首搬字补到 min（桶内最后一段如实偏短）。
  for (let index = 0; index < merged.length - 1; index += 1) {
    const item = merged[index]
    const need = limits.min - contentCharCount(item.text)
    if (need <= 0) continue
    const next = merged[index + 1]
    if (contentCharCount(next.text) - need < limits.min) continue
    const moved = codePoints(next.text).slice(0, need).join('')
    item.text = joinText(item.text, moved)
    item.end = item.start + item.text.length
    next.text = next.text.slice(moved.length).trimStart()
    next.start += moved.length
  }
  return { units: merged }
}

/**
 * 文本 → 桶 → 段。
 * @param {string} text
 * @param {{min?:number,max?:number}} [options]
 */
export function segmentText(text, options = {}) {
  const limits = normalizeLimits(options)
  const raw = String(text ?? '').replace(/\r\n?/gu, '\n')
  const out = []
  for (const bucket of splitBuckets(raw)) {
    const { units } = packBucket(bucket, limits)
    for (const unit of units) {
      // 段文本 = 原文切片；章标题若属于本段则前置（标题在原文里就在本段之前）。
      // 段文本严格取原文切片。章标题只进 chapterTitle 元数据——拼进正文会破坏溯源。
      const slice = raw.slice(unit.start, unit.end).trim() || unit.text
      out.push({
        index: out.length + 1,
        text: slice,
        chars: contentCharCount(slice),
        start: unit.start,
        end: unit.end,
        chapterNo: bucket.chapterNo,
        chapterTitle: bucket.title,
        located: Boolean(raw.slice(unit.start, unit.end).trim())
      })
    }
  }
  return out
}

/** 段序列读数。越界计数是「规则没做到」的诚实账。 */
export function segmentStats(segments, options = {}) {
  const limits = normalizeLimits(options)
  const list = Array.isArray(segments) ? segments : []
  const chars = list.map((segment) => (Number.isInteger(segment?.chars) ? segment.chars : contentCharCount(segment?.text)))
  const chapters = new Set(list.map((segment) => segment?.chapterNo ?? null))
  return {
    count: list.length,
    totalChars: chars.reduce((sum, value) => sum + value, 0),
    minChars: chars.length ? Math.min(...chars) : 0,
    maxChars: chars.length ? Math.max(...chars) : 0,
    underMin: chars.filter((value) => value < limits.min).length,
    overMax: chars.filter((value) => value > limits.max).length,
    buckets: chapters.size,
    limits
  }
}
