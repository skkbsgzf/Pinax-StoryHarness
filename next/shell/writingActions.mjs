/**
 * 写作动作（批次41）：老前端正文面上那排「续写／改写／扩写／压缩／润色」，收成一张闭集表。
 *
 * 为什么是一张表而不是界面里散着写：动作词会同时被三处用——渲染层出按钮、主进程校验、
 * 提示词组装。三处各抄一份，很快就对不上（按钮叫「润色」，通道收到 polish 却不认）。
 * 这里只留数据与纯函数，不 import 任何东西：渲染层可以直接用，主进程也直接 import 这一份。
 *
 * 两条边界：
 *   1) 动作是闭集。未登记的动作一律拒不执行，不做「猜一个近义词」的兜底；
 *   2) 提示词只由这里拼。渲染层递上来的是「动作＋正文＋选区＋额外要求」，递不上来自由提示词——
 *      模型面只收这颗内核认得的请求，不是一条通用模型管道。
 */

/** 续写只往前看这么多字；选中类动作两侧各留这么多字当上下文。 */
export const CONTEXT_BEFORE_CHARS = 3000
export const CONTEXT_AROUND_CHARS = 800
/** 一次请求带上去的正文上限（与章节工具的 200k 口径一致）。 */
export const WRITING_MAX_TEXT_CHARS = 200_000
/** 额外要求的上限：作者写一句「别用成语」就够，不把要求框当第二个正文框。 */
export const WRITING_MAX_INSTRUCTION_CHARS = 500

/**
 * 动作表。`target` 决定结果怎么落：
 *   insert  —— 落在光标处，不动原文（续写）；
 *   replace —— 替换选中段（改写类）。
 * needsSelection 的动作在没有选区时直接拒，界面也不出按钮——不给「点了没反应」的假动作。
 */
export const WRITING_ACTIONS = Object.freeze([
  Object.freeze({
    id: 'continue',
    label: '续写',
    target: 'insert',
    needsSelection: false,
    brief: '顺着上文往下写，衔接紧一点，别复述已经写过的内容'
  }),
  Object.freeze({
    id: 'rewrite',
    label: '改写',
    target: 'replace',
    needsSelection: true,
    brief: '保持信息量与情节不变，换一种写法重写这一段'
  }),
  Object.freeze({
    id: 'expand',
    label: '扩写',
    target: 'replace',
    needsSelection: true,
    brief: '在不加入新情节的前提下把这一段写细：动作、感官、停顿'
  }),
  Object.freeze({
    id: 'condense',
    label: '压缩',
    target: 'replace',
    needsSelection: true,
    brief: '删掉重复与铺垫，保留必要的动作与信息，篇幅收紧'
  }),
  Object.freeze({
    id: 'polish',
    label: '润色',
    target: 'replace',
    needsSelection: true,
    brief: '只动措辞与节奏，不改情节、不改人物口吻'
  })
])

const ACTION_BY_ID = new Map(WRITING_ACTIONS.map((action) => [action.id, action]))

/** 按 id 取动作；不认识的返回 null（调用方据此拒，不兜底）。 */
export function writingActionOf(id) {
  return ACTION_BY_ID.get(String(id ?? '')) ?? null
}

/**
 * 选区归一：渲染层偶尔会在文本换掉之后才报选区，越界就钳住而不是报错炸掉整次请求。
 * 反向拖选（start > end）在这里换成正序——作者从下往上选是常态。
 */
export function normalizeSelection(selection, text) {
  const length = String(text ?? '').length
  const rawStart = Number.isFinite(selection?.start) ? Math.trunc(selection.start) : length
  const rawEnd = Number.isFinite(selection?.end) ? Math.trunc(selection.end) : rawStart
  const start = Math.min(Math.max(0, Math.min(rawStart, rawEnd)), length)
  const end = Math.min(Math.max(0, Math.max(rawStart, rawEnd)), length)
  return { start, end, collapsed: start === end }
}

/**
 * 请求校验：动作在闭集里、正文非空、选区在正文内、需要选区的动作真的选了东西。
 * 返回 { ok:true, value } 或 { ok:false, message }——message 是给作者看的人话。
 */
export function validateWritingRequest(input = {}) {
  const action = writingActionOf(input.action)
  if (!action) return { ok: false, message: `不认识的写作动作：${String(input.action ?? '')}` }
  const text = typeof input.text === 'string' ? input.text : ''
  if (!text.trim()) return { ok: false, message: '正文是空的，没有可以接下去的上下文' }
  if (text.length > WRITING_MAX_TEXT_CHARS) {
    return { ok: false, message: `正文超过 ${WRITING_MAX_TEXT_CHARS} 字，先分章再让模型读` }
  }
  const selection = normalizeSelection(input.selection, text)
  if (action.needsSelection && selection.collapsed) {
    return { ok: false, message: `「${action.label}」要先选中一段文字` }
  }
  const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : ''
  if (instruction.length > WRITING_MAX_INSTRUCTION_CHARS) {
    return { ok: false, message: `额外要求最多 ${WRITING_MAX_INSTRUCTION_CHARS} 字` }
  }
  return { ok: true, value: { action, text, selection, instruction } }
}

/** 截断到上限，保留尾部（续写要的是最近的上文，不是开头）。 */
function tail(text, max) {
  const value = String(text ?? '')
  return value.length <= max ? value : value.slice(value.length - max)
}

function head(text, max) {
  const value = String(text ?? '')
  return value.length <= max ? value : value.slice(0, max)
}

/**
 * 组装一次补全请求。主进程与测试都用这一份，界面不碰提示词。
 * 输出形状对齐 forwardComplete 的入参：{ systemPrompt, messages, maxTokens }。
 */
export function buildWritingRequest(validated) {
  const { action, text, selection, instruction } = validated
  const systemPrompt = [
    '你是中文小说写作助手，替作者在现有稿子上动笔。',
    '只输出可以直接粘回正文的汉字段落：不写解释、不写标题、不加引号包裹、不用项目符号，也不要复述要求。',
    '保持原文的人称、时态与叙述视角；不确定的地方宁可按原文的路子写，也不要另起一段设定。'
  ].join('\n')

  let before = ''
  let focus = ''
  let after = ''
  if (action.needsSelection) {
    before = tail(text.slice(0, selection.start), CONTEXT_AROUND_CHARS)
    focus = text.slice(selection.start, selection.end)
    after = head(text.slice(selection.end), CONTEXT_AROUND_CHARS)
  } else {
    // 续写：光标之前是上文，光标之后（如果有）也不能假装不存在——作者可能是在中间插一段。
    before = tail(text.slice(0, selection.end), CONTEXT_BEFORE_CHARS)
    after = head(text.slice(selection.end), CONTEXT_AROUND_CHARS)
  }

  const parts = []
  if (before) parts.push(`【上文】\n${before}`)
  if (action.needsSelection) parts.push(`【要处理的段落】\n${focus}`)
  if (after) parts.push(`【后文（续写时不要与之矛盾）】\n${after}`)
  parts.push(`【任务】${action.brief}。`)
  if (instruction) parts.push(`【额外要求】${instruction}`)
  if (action.target === 'insert') parts.push('【输出】只写接下来的一段，不要重复上文最后一句话。')

  return {
    systemPrompt,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
    maxTokens: action.target === 'insert' ? 1200 : 1600
  }
}

/** 模型回的正文：去掉首尾空白，以及偶尔包上来的整段代码围栏。 */
export function cleanWritingResult(raw) {
  let value = String(raw ?? '').replace(/\r\n/g, '\n').trim()
  const fenced = value.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/u)
  if (fenced) value = fenced[1].trim()
  return value
}

/**
 * 结果落位：返回新正文与新光标位。
 *   insert  —— 插在选区末端（没有选区时就是文末/光标处），原文一字不动；
 *   replace —— 顶掉选中段。
 * 空结果返回 null：界面据此提示「模型没给内容」，而不是悄悄插入一段空白。
 */
export function applyWritingResult({ text, selection, action, result }) {
  const clean = cleanWritingResult(result)
  if (!clean) return null
  const source = String(text ?? '')
  const range = normalizeSelection(selection, source)
  const target = action?.target === 'replace' ? 'replace' : 'insert'
  if (target === 'replace') {
    if (range.collapsed) return null
    return {
      text: source.slice(0, range.start) + clean + source.slice(range.end),
      caret: range.start + clean.length,
      mode: 'replace'
    }
  }
  const at = range.end
  const glue = needsSeparator(source, at) ? '\n\n' : ''
  const inserted = `${glue}${clean}`
  return {
    text: source.slice(0, at) + inserted + source.slice(at),
    caret: at + inserted.length,
    mode: 'insert'
  }
}

/** 插在句子中间就不加空行；落在文末或已有换行处才另起一段。 */
function needsSeparator(text, at) {
  if (at <= 0) return false
  if (at < text.length) return false
  return !/\n\s*$/u.test(text.slice(0, at))
}

/** 界面用它决定出哪些按钮：续写恒可用，其余跟着选区走。 */
export function availableWritingActions({ hasSelection = false } = {}) {
  return WRITING_ACTIONS.filter((action) => !action.needsSelection || hasSelection)
}
