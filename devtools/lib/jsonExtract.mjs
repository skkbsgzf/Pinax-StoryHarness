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
 * 栈式配平：只**插入缺失的闭合符**，不删不改任何内容。
 *
 * 实测成因（dots3 绑定回包）：模型写嵌套数组 `"aka":[["甲","乙"]}` 时漏了外层的 `]`。
 * 这类结构错用正则修不了，但可以确定性修：维护 `[`/`{` 栈，遇到不匹配的闭合符就先补栈顶的闭合符。
 * 修不出的（多余的闭合符、字符串截断）如实返回 null——绝不猜内容。
 */
const balanceBrackets = (value) => {
  const closer = { '[': ']', '{': '}' }
  const stack = []
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of value) {
    if (escaped) { out += ch; escaped = false; continue }
    if (ch === BACKSLASH) { out += ch; escaped = true; continue }
    if (ch === QUOTE) { out += ch; inString = !inString; continue }
    if (inString) { out += ch; continue }
    if (ch === '[' || ch === '{') { stack.push(ch); out += ch; continue }
    if (ch === ']' || ch === '}') {
      // 先补上「必须在本闭合符之前闭合」的栈顶容器。
      while (stack.length && closer[stack[stack.length - 1]] !== ch) {
        const open = stack.pop()
        if (ch === ']' && open === '{') return null  // `{]` 这种不是漏括号，是真错位
        out += closer[open]
      }
      if (!stack.length) return null
      stack.pop()
      out += ch
      continue
    }
    out += ch
  }
  if (inString) return null
  while (stack.length) out += closer[stack.pop()]
  return out
}
/**
 * 数组里多出来的空值：`["a",[]]` / `["a",{}]`。
 * 实测成因（dots3 绑定回包）：模型在 hooks/settings/knowledge 末尾多吐一个空容器。
 * 只删「逗号紧跟空数组或空对象」的情形——有内容的元素一律不动。
 */
const dropEmptyArrayTail = (value) => value.replace(/,\s*(\[\]|\{\})\s*([\]}])/gu, '$2')

/**
 * 多余闭合符：栈为空时遇到的闭合符**只可能是多余的**，删掉它本身（不动别的字符）。
 * 实测成因（dots3 绑定回包）：`"hooks":["…"],[]]}` —— 模型把闭合符写多了。
 * 与 balanceBrackets 互补：一个补缺、一个削多；两者都只增删**括号本身**，绝不改内容。
 */
const dropUnmatchedClosers = (value) => {
  const stack = []
  let out = ''
  let inString = false
  let escaped = false
  let dropped = 0
  for (const ch of value) {
    if (escaped) { out += ch; escaped = false; continue }
    if (ch === BACKSLASH) { out += ch; escaped = true; continue }
    if (ch === QUOTE) { out += ch; inString = !inString; continue }
    if (inString) { out += ch; continue }
    if (ch === '[' || ch === '{') { stack.push(ch); out += ch; continue }
    if (ch === ']' || ch === '}') {
      // 栈顶不匹配时先补闭合（漏闭合的常见形态），再削掉真正的多余闭合符。
      while (stack.length && ({ '[': ']', '{': '}' })[stack[stack.length - 1]] !== ch) out += ({ '[': ']', '{': '}' })[stack.pop()]
      if (!stack.length) { dropped += 1; continue }
      stack.pop()
      out += ch
      continue
    }
    out += ch
  }
  while (stack.length) out += ({ '[': ']', '{': '}' })[stack.pop()]
  return dropped ? out : null
}

/**
 * 保守修复：按「从轻到重」依次尝试，任一成功即返回修复后的文本。
 * @returns {string|null} 可被 JSON.parse 的文本；修不出返回 null
 */
export function repairJsonText(text) {
  const source = String(text ?? '')
  if (!source) return null
  const balanced = balanceBrackets(source)
  const trimmed = dropUnmatchedClosers(dropEmptyArrayTail(source))
  const candidates = [
    source,
    dropTrailingCommas(source),
    quoteBareKeys(source),
    dropTrailingCommas(quoteBareKeys(source)),
    dropTrailingCommas(dropEmptyArrayTail(quoteBareKeys(source))),
    dropTrailingCommas(quoteBareKeys(normalizeQuotes(source))),
    insertMissingCommas(dropTrailingCommas(quoteBareKeys(source))),
    insertMissingCommas(dropTrailingCommas(quoteBareKeys(normalizeQuotes(source)))),
    // 结构错（漏闭合符）放在最后：它改动最大，只有前面全失败才用。
    ...(balanced ? [balanced, dropTrailingCommas(dropEmptyArrayTail(balanced))] : []),
    // 多闭合符同理，也排最后。
    ...(trimmed ? [trimmed, dropTrailingCommas(quoteBareKeys(trimmed))] : [])
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
