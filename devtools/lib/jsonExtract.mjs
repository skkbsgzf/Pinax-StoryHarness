/**
 * 从模型回包里取第一个完整 JSON 对象，并对常见语法错做**保守修复**。
 *
 * 为什么需要：dots3-note-prev 在抽取任务上 JSON 合规率约 70%（实测 44 段 20 段报错），
 * 错误集中在四类，全部可机械修：
 *   1) 裸键名：`}],settings":[` —— 模型漏写键引号（高频）
 *   2) 尾逗号：`[...,]` / `{...,}`
 *   3) 中文引号误用
 *   4) 缺逗号：两个值之间
 * 修不出的（结构缺失如少一个 `]`）如实返回 null，由调用方重试——绝不猜内容。
 */

const BACKSLASH = String.fromCharCode(92)
const QUOTE = String.fromCharCode(34)

/**
 * 从首个 `{` 起做括号配平扫描（正确处理字符串内的括号与转义）。
 * 不用贪婪正则：`/\{[\s\S]*\}/` 会把两个相邻对象粘成一个，
 * 表现为「Unexpected non-whitespace character after JSON at position N」。
 * @returns {string|null}
 */
export function firstJsonObject(text) {
  const source = String(text ?? '')
  const start = source.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index]
    if (escaped) { escaped = false; continue }
    if (ch === BACKSLASH) { escaped = true; continue }
    if (ch === QUOTE) { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

/** 尾逗号：`[1,2,]` → `[1,2]`。 */
const dropTrailingCommas = (value) => value.replace(/,\s*([}\]])/gu, '$1')

/** 裸键名补引号：`}],settings":[` → `}],"settings":[`。只动「{ 或 , 之后、到 : 之前」的标识符。 */
const quoteBareKeys = (value) => value.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]{0,40})(\s*:)/gu, '$1"$2"$3')

/** 中文引号 → 英文引号（仅当原文本严格解析失败时才试，避免误伤正文里的引号）。 */
const normalizeQuotes = (value) => value.replace(/[\u201c\u201d]/gu, '"')

/**
 * 缺逗号补全：`"a":"b"\s*"c":` → `"a":"b","c":`；`]` 后紧跟 `{` 或引号也补。
 * 这是最容易误伤的一类，所以排在最后、且只补「明显是键值边界」的位置。
 */
const insertMissingCommas = (value) => value
  .replace(/([}\]"0-9])(\s*)(["{[])/gu, (match, left, space, right) => (
    // 已经在字符串里的情况不处理（这里只看裸字符）——粗粒度但有效
    left === QUOTE && right === QUOTE ? `${left},${space}${right}` : match
  ))
  .replace(/([}\]"\d])(\s*)("(?:[^"\\]|\\.)*"\s*:)/gu, '$1,$2$3')

/**
 * 保守修复：按「从轻到重」依次尝试，任一成功即返回修复后的文本。
 * @returns {string|null} 可被 JSON.parse 的文本；修不出返回 null
 */
export function repairJsonText(text) {
  const source = String(text ?? '')
  if (!source) return null
  const candidates = [
    source,
    dropTrailingCommas(source),
    quoteBareKeys(source),
    dropTrailingCommas(quoteBareKeys(source)),
    dropTrailingCommas(quoteBareKeys(normalizeQuotes(source))),
    insertMissingCommas(dropTrailingCommas(quoteBareKeys(source))),
    insertMissingCommas(dropTrailingCommas(quoteBareKeys(normalizeQuotes(source))))
  ]
  for (const candidate of candidates) {
    try {
      JSON.parse(candidate)
      return candidate
    } catch { /* 试下一个 */ }
  }
  return null
}

/** 一步到位：回包文本 → 解析好的对象（或 null）。调用方只用这个即可。 */
export function parseModelReply(reply) {
  const objectText = firstJsonObject(reply)
  if (!objectText) return { ok: false, code: 'REPLY_NO_JSON', error: '回包里找不到完整的 JSON 对象（括号不配平）', text: null }
  try {
    return { ok: true, value: JSON.parse(objectText), text: objectText, repaired: false }
  } catch (strictError) {
    const repaired = repairJsonText(objectText)
    if (repaired) {
      try {
        return { ok: true, value: JSON.parse(repaired), text: repaired, repaired: true }
      } catch { /* 落到失败 */ }
    }
    return { ok: false, code: 'REPLY_BAD_JSON', error: strictError.message, text: objectText }
  }
}
