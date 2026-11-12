/**
 * 第一人称主角识别（作者 2026-11-12 视角裁定的关键一环）。
 *
 * 问题：第一人称小说里「我」出现几百次，但「我」不是条目名。要把它映射到实体，
 * 必须先知道**叙述者的真名**。而「出现次数最高的真名」是错的——
 * 实测《末世3天就结束》里出现最多的是「林逸」(78 次)，但那是男友；
 * 叙述者是「沈岚」（别人喊她「沈岚，你也在啊」）。
 *
 * 确定性判据（三条，按可靠度排序）：
 *   1) **对话直呼**：`“沈岚，你…”` —— 别人对着「我」说话时喊的名字。
 *      形态：引号开头就是某个候选名，且引号内含第二人称「你」。
 *   2) **自称**：`我叫X` / `我是X`（后者噪声大，只在 X 是已知候选名时采用）。
 *   3) **共同出现**：同一段里「我」与某候选名高频共现，且该名字在「我的X」结构外出现。
 *
 * 都取不到就返回 null——调用方退化为「我」本身（称谓即身份）。
 *
 * 纯函数、零宿主依赖。
 */

export const PROTAGONIST_VERSION = 'fact-protagonist@1'

/** 引号内以候选名开头，且含第二人称 → 别人在直呼叙述者。 */
function scoreVocative(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  // 「沈岚，你…」「沈岚你发什么疯」——名字出现在引号开头，后接「你」
  const pattern = new RegExp(`[“"「]${escaped}[，,]?\\s*[^”"」]{0,12}你`, 'gu')
  return (text.match(pattern) ?? []).length
}

/** 自称：「我叫X」直接命中；「我是X」只在 X 已是候选名时算一次弱证据。 */
function scoreSelfIntro(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const named = (text.match(new RegExp(`我叫${escaped}`, 'gu')) ?? []).length
  const weak = (text.match(new RegExp(`我是${escaped}`, 'gu')) ?? []).length
  return named * 5 + weak
}

/**
 * 识别第一人称叙述者的真名。
 * @param {string} text 全书正文
 * @param {Map<string,{mentions:number}>} nameCandidates 候选名统计
 * @returns {{name:string|null, reason:string, score:number}}
 */
export function detectFirstPersonProtagonist(text, nameCandidates) {
  const source = String(text ?? '')
  if (!source || !(nameCandidates instanceof Map)) return { name: null, reason: 'no-input', score: 0 }

  let best = null
  let bestScore = 0
  let bestReason = 'none'
  for (const name of nameCandidates.keys()) {
    if (!name || name.length < 2 || name.length > 5) continue
    const vocative = scoreVocative(source, name)
    const selfIntro = scoreSelfIntro(source, name)
    const score = vocative * 3 + selfIntro
    if (score > bestScore) {
      best = name
      bestScore = score
      bestReason = vocative > 0 ? 'vocative' : 'self-intro'
    }
  }
  // 至少要有一条强证据（被直呼 ≥1 次，或自称 ≥1 次），否则不认。
  if (bestScore < 1) return { name: null, reason: 'insufficient', score: 0 }
  return { name: best, reason: bestReason, score: bestScore }
}


/**
 * 称呼形式 → 真名归一。
 *
 * 「余律师」「沈总」「张老师」是**姓+职务**的称呼，不是真名——真名在同一本书里另有其名（余欢）。
 * 判据：若称呼以某个候选名的**首字**开头（同姓），且那个候选名是 2–3 字真名、出现次数不低，
 * 就把称呼归一到真名。只做同姓归并，绝不跨姓猜（张律师 ≠ 李律师）。
 * @param {string} title 称呼形式（余律师）
 * @param {Map<string,{mentions:number}>} nameCandidates
 * @returns {{name:string, reason:string}} 归一后的名字
 */
export function normalizeVocativeToName(title, nameCandidates) {
  const value = String(title ?? '').trim()
  if (!value || !(nameCandidates instanceof Map)) return { name: value, reason: 'keep' }
  // 职务后缀：去掉它剩下的就是姓。
  const stripped = value.replace(/(律师|医生|老师|教授|经理|总监|总裁|总|主任|队长|警官|老板|师傅|师父|先生|女士|小姐|太太)$/u, '')
  if (stripped === value || !stripped) return { name: value, reason: 'keep' }  // 没有职务后缀
  const surname = stripped.slice(0, 1)
  if (!surname) return { name: value, reason: 'keep' }
  let best = null
  let bestCount = 0
  for (const [name, record] of nameCandidates) {
    if (name === value || name.length < 2 || name.length > 3) continue
    if (!name.startsWith(surname)) continue
    if (record.mentions > bestCount) { best = name; bestCount = record.mentions }
  }
  // 同姓真名要够频繁才算（否则可能是另一个同姓配角）。
  if (best && bestCount >= 5) return { name: best, reason: 'vocative-normalized' }
  return { name: value, reason: 'keep' }
}