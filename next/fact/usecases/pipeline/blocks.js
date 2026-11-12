/**
 * 确定性切块器（P-TRIM 三段式第一段，作者 2026-11-11 裁定「LLM 只做机械流水线」）。
 *
 * 为什么：真跑读数（guimi 10 章 / 116 份回包）显示模型在**改写**而不是**标注**——
 *   · events 只有 29% 能在原文里字面定位，其余 71% 是摘要改写；
 *   · say 事件只有 33% 落在引号跨度内，think 只有 1.5% 有邻域线索；
 *   · 每段还要重发 750 字 schema，模型逐段重写全量人物档案（57% 是跨段重复）。
 *
 * 所以先把「什么话是谁说的、哪一句像心理/感知/状态」用**规则**切出来（零模型、零分词库），
 * 模型只剩一件事：给每块指定主体（以及必要时改一个通道）。块的正文就是事件正文——
 * 模型不再产生事件文本，改写空间从「整段自由生成」缩到「一个名字」。
 *
 * 口径：块 ＝ 一个引号跨度 或 一句叙述。段（100–300 字）仍是数据单元，块是标注单元。
 * 纯函数、零宿主依赖：只 import fact 域内相对路径。
 */

import { splitSentences } from '../../domain/segment.js'

export const BLOCKS_VERSION = 'fact-blocks/v1'

/** 引号对：中文作品以 “” 为主，兼容「」『』与半角。同形开闭（"）按配对计数处理。 */
const QUOTE_PAIRS = Object.freeze([
  ['“', '”'], ['「', '」'], ['『', '』'], ['"', '"'], ['‘', '’']
])

/** 说话动词（用于从引号前的叙述里找说话人）。长的在前，保证「笑道」不被「笑」截断。 */
const SPEECH_VERBS = Object.freeze([
  '低声说', '沉声道', '轻声道', '开口道', '回答道', '追问道', '反问道',
  '说道', '问道', '答道', '喊道', '叫道', '笑道', '叹道', '嚷道', '冷哼',
  '说', '道', '问', '答', '喊', '叫', '嚷', '答腔', '接话', '开口',
  '嘟囔', '嘀咕', '低语', '自语', '咕哝', '补充'
])

/** 心理动词：引号前的叙述带这些词时，引号内容是**心里话**而不是说出口的话。 */
const THOUGHT_VERBS = Object.freeze([
  '心想', '暗想', '心道', '暗道', '心中想', '心里想', '思忖', '盘算', '琢磨',
  '自语', '自言自语', '默念', '默道'
])

/** 叙述句的功能线索（顺序即优先级：感知 > 心理 > 感受 > 动作 > 状态）。 */
const PERCEIVE_MARKERS = Object.freeze([
  '看见', '看到', '听见', '听到', '闻见', '闻到', '注意到', '察觉', '发现',
  '望向', '看向', '盯着', '凝视', '注视', '环顾', '扫视', '打量', '观察到', '瞥见'
])
const THOUGHT_MARKERS = Object.freeze([
  '心想', '暗想', '心道', '暗道', '心中', '心里', '念头', '意识到', '回忆起', '想起',
  '记得', '怀疑', '猜测', '明白', '恍然', '思索', '考虑', '盘算', '琢磨', '担心', '希望'
])
const FEEL_MARKERS = Object.freeze([
  '只觉', '感到', '感觉', '觉得', '痛', '疼', '酸', '麻', '累', '困', '饿',
  '害怕', '恐惧', '紧张', '焦虑', '愤怒', '欣喜', '难受', '温暖', '冰冷', '寒意'
])
const ACTION_VERBS = Object.freeze([
  '走', '跑', '站', '坐', '躺', '推', '拉', '抓', '握', '抬', '低', '转', '回',
  '拿', '放', '递', '接', '打', '踢', '撞', '逃', '冲', '跳', '爬', '翻', '穿',
  '脱', '戴', '洗', '擦', '关', '开', '摔', '砸', '扔', '挥', '抖', '甩', '按',
  '敲', '拔', '插', '举', '抱', '扶', '跪', '蹲', '弯', '退', '进', '出'
])

/** 引号内出现这些词，说明它不是台词而是书名/牌匾/标语/术语引用——不参与事件标注。 */
const MENTION_ONLY_QUOTE = Object.freeze(['《', '》', '第', '号', '型', '式', '款', '章', '节', '条例', '规定', '通知', '公告', '碑文', '刻着', '写着', '印着'])
/** 引号内是单个词/短语（≤5 字）且无标点，多为「强调引号」而不是台词或成句心里话。
 *  可被档位 blocks.shortQuoteMax 覆写（体裁不同，「短」的阈值不同）。 */
const SHORT_QUOTE_MAX = 5

const hasAny = (text, words) => words.some((word) => text.includes(word))

/** 块的目标长度区间：块是**标注单元**不是句子。
 *  实测按句切会得到 8.7 块/段（模型输出被碎片撑大），按通道切又会把一句话拆成两条事件。
 *  所以按「25–70 字、通道取块内主导」打包——一条块≈一个叙事节拍。 */
export const BLOCK_MIN_CHARS = 25
export const BLOCK_MAX_CHARS = 70
/** 低于此长度且无信息量的碎片（「…」「嘶…」）并入邻块，不单独成块。 */
const FRAGMENT_MAX_CHARS = 4
const CHAPTER_HEAD = /^第\s*[0-9一二三四五六七八九十百千零两]+\s*章[^\n]{0,20}?\n?/u
/** 通道主导优先级：感知 > 心理 > 感受 > 动作 > 状态（越靠前越"贵"，一块里出现就取它）。 */
const CHANNEL_PRIORITY = Object.freeze(['perceive', 'think', 'feel', 'do', 'state'])

/**
 * 提取引号跨度。不配对（有开无闭）时把剩余文本当叙述——宁可少切一刀，不产半块。
 * @returns {{spans: Array<{start:number,end:number,text:string,quote:string}>, pairs:number}}
 */
export function extractQuoteSpans(text) {
  const source = String(text ?? '')
  const spans = []
  let index = 0
  while (index < source.length) {
    const opener = QUOTE_PAIRS.find(([open]) => source[index] === open)
    if (!opener) { index += 1; continue }
    const [open, close] = opener
    const closeAt = source.indexOf(close, index + 1)
    if (closeAt < 0) break
    const inner = source.slice(index + 1, closeAt)
    if (inner.trim()) spans.push({ start: index, end: closeAt + 1, text: inner, quote: `${open}${close}` })
    index = closeAt + 1
  }
  return { spans, pairs: spans.length }
}

/** 叙述句 → 通道提示。先看感知/心理/感受，再看动作，都无则归 state（描写/静态）。 */
export function channelHintOfSentence(sentence) {
  const text = String(sentence ?? '')
  if (!text.trim()) return 'state'
  if (hasAny(text, PERCEIVE_MARKERS)) return 'perceive'
  if (hasAny(text, THOUGHT_MARKERS)) return 'think'
  if (hasAny(text, FEEL_MARKERS)) return 'feel'
  if (hasAny(text, ACTION_VERBS)) return 'do'
  return 'state'
}

/** 多句合并后按「主导通道」定块通道：出现过的最高优先级通道即块通道（不做加权，可复现）。 */
function dominantChannel(sentences) {
  const present = new Set(sentences.map((sentence) => channelHintOfSentence(sentence)))
  return CHANNEL_PRIORITY.find((channel) => present.has(channel)) ?? 'state'
}

/** 谓语起始字：名字在这类字前断开（「周明瑞皱起眉头」→ 周明瑞）。 */
const PREDICATE_START = new Set([
  '皱', '抬', '低', '转', '微', '笑', '点', '摇', '站', '坐', '走', '跑', '看', '望', '盯', '伸',
  '收', '握', '推', '拉', '抓', '挥', '叹', '沉', '轻', '冷', '怒', '愣', '怔', '抿', '咬', '眨',
  '闭', '睁', '侧', '俯', '弯', '蹲', '跪', '迈', '退', '喘', '咳', '喝', '拿', '放', '递', '接',
  '打', '踢', '撞', '冲', '跳', '翻', '穿', '脱', '戴', '洗', '擦', '关', '开', '摔', '砸', '扔',
  '抖', '甩', '按', '敲', '拔', '插', '举', '抱', '扶', '靠', '回', '进', '出', '把', '将', '从',
  '向', '对', '在', '的', '了', '着', '过', '是', '和', '与', '也', '都', '又', '却', '便', '就'
])
/** 名字里出现的虚词即判为非名（与 mine.js 的 NAME_FORBIDDEN_CHARS 同口径）。 */
const NAME_FORBIDDEN = /[的了着过是在把被让给和与同吗呢吧啊呀哦嗯不没就都也又而但确其之这那哪什怎为]/u

/** 从句首取 2–4 字名字；必须在谓语前断开且不含虚词，否则返回 null（不猜）。 */
function leadingName(clause) {
  const text = String(clause ?? '')
  let length = 0
  while (length < 4 && length < text.length) {
    const ch = text[length]
    if (!/[\u4e00-\u9fa5·]/u.test(ch) || PREDICATE_START.has(ch)) break
    length += 1
  }
  if (length < 2) return null
  const name = text.slice(0, length)
  return NAME_FORBIDDEN.test(name) ? null : name
}

/**
 * 引号块的主体线索：在引号**之前紧邻的叙述**里找。
 * 优先级（basis 如实标注，认不出就是 none——绝不编人名）：
 *   1) `known`：从句里唯一命中已知名表（最可靠，用运行时真名表）；
 *   2) `cue`：短从句（≤12 字）且名字紧贴说话动词（「周明瑞皱眉，低声说」）；
 *   3) `candidate`：同一从句出现多个已知名 → 有歧义，不认领。
 * 从句回退最多两层：名字在前一句是汉语叙事的常态，但再远就不可靠了。
 * @returns {{name:string|null, verb:string|null, basis:string, thought:boolean}}
 */
export function speakerHintOf(before, knownNames = []) {
  const window = String(before ?? '').slice(-40)
  if (!window.trim()) return { name: null, verb: null, basis: 'none', thought: false }
  const verbs = [...THOUGHT_VERBS, ...SPEECH_VERBS].sort((left, right) => right.length - left.length)
  const thought = hasAny(window, THOUGHT_VERBS)
  const clauses = window.split(/[，。！？；：、\s]+/u).filter(Boolean)
  // 说话动词所在从句：优先取最后一个（离引号最近）。
  let verbAt = -1
  let verb = null
  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const hit = verbs.find((item) => clauses[index].includes(item))
    if (hit) { verbAt = index; verb = hit; break }
  }
  const from = verbAt >= 0 ? verbAt : clauses.length - 1

  // 1) 已知名：从最近的从句往回最多两层，唯一命中才认领。
  let sawAmbiguous = false
  for (let index = from; index >= Math.max(0, from - 2); index -= 1) {
    const hits = [...new Set(knownNames.filter((name) => name && clauses[index].includes(name)))]
    if (hits.length === 1) return { name: hits[0], verb, basis: 'known', thought }
    if (hits.length > 1) sawAmbiguous = true
  }
  // 2) cue：名字紧贴说话动词。只在短从句上做，长从句里的「当然识字…」这类会被误当成人名。
  if (verbAt >= 0) {
    const clause = clauses[verbAt]
    const prefix = clause.slice(0, clause.indexOf(verb))
    if (prefix && prefix.length <= 6) {
      const name = leadingName(prefix)
      if (name) return { name, verb, basis: 'cue', thought }
    }
    const previous = clauses[verbAt - 1]
    if (previous && previous.length <= 12) {
      const name = leadingName(previous)
      if (name) return { name, verb, basis: 'cue', thought }
    }
  }
  return { name: null, verb, basis: sawAmbiguous ? 'candidate' : 'none', thought }
}

/**
 * 段 → 块序列。块序即原文序；每块带通道提示与主体线索，供窄提示词「确认或改一个字」。
 *
 * 打包规则（块是标注单元，不是句子——实测按句切会得到 11 块/段，模型输出反被碎片撑大）：
 *   1) 章名行（「第一章 绯红」）剥掉，不参与标注：它是版式不是叙事；
 *   2) 同通道相邻句合并到 ≤ BLOCK_TARGET_CHARS；
 *   3) 纯标点/≤4 字碎片（「…」「嘶…」）无条件并入前一块（后面无块时并入后一块）；
 *   4) 引号块独立成块——它的主体可能与周围叙述不同，合并会把两个人的话糊成一条。
 * @param {string} text 段原文（100–300 字）
 * @param {{knownNames?: string[]}} [options]
 * @returns {{blocks: Array, stats: Object}}
 */
export function segmentBlocks(text, options = {}) {
  const source = String(text ?? '').replace(CHAPTER_HEAD, '')
  const knownNames = Array.isArray(options.knownNames) ? options.knownNames.filter(Boolean) : []
  // 档位覆写（extractionProfile.blocks）：不传就用模块默认，既有调用行为不变。
  const minChars = Number.isSafeInteger(options.min) && options.min > 0 ? options.min : BLOCK_MIN_CHARS
  const maxChars = Number.isSafeInteger(options.max) && options.max > 0 ? options.max : BLOCK_MAX_CHARS
  const shortQuoteMax = Number.isSafeInteger(options.shortQuoteMax) && options.shortQuoteMax >= 0
    ? options.shortQuoteMax
    : SHORT_QUOTE_MAX
  const { spans } = extractQuoteSpans(source)
  const blocks = []
  const dropped = []
  let cursor = 0
  let pending = []   // 待打包的叙述句（凑到 BLOCK_MIN_CHARS 才落块）

  const flushPending = () => {
    if (!pending.length) return
    const items = pending
    pending = []
    // 关键：从原文切出 [首句 start, 末句 end) —— 块文本因此**恒为原文子串**。
    const text = source.slice(items[0].start, items[items.length - 1].end).trim()
    // 空块不产：切片可能因偏移落在纯空白区而变空（真跑撞到 1/323 段整批被拒）。
    if (!text) return
    blocks.push({
      id: '',
      kind: 'narration',
      text,
      channelHint: dominantChannel(items.map((item) => item.text)),
      speakerHint: null,
      hintBasis: 'rule'
    })
  }

  /**
   * 叙述入待打包队列。**保留原文偏移**：块文本必须能从段原文原样切出来，
   * 否则「事件正文＝块原文」就退化成「事件正文＝重新拼接的句子」，可溯源率会掉
   * （番茄库实测：join('') 让 320 条事件只有 47.5% 能在原文定位）。
   */
  const pushNarration = (chunk, chunkOffset = 0) => {
    const raw = String(chunk ?? '')
    // 按句切分但记录每句在原 chunk 内的位置，压入带偏移的条目。
    let cursor = 0
    for (const sentence of splitSentences(raw)) {
      const at = raw.indexOf(sentence, cursor)
      const start = at >= 0 ? at : cursor
      cursor = start + sentence.length
      const clean = sentence.trim()
      if (!clean) continue
      const informative = clean.replace(/[\s…—\-.·、，。！？；：]/gu, '')
      if (informative.length <= FRAGMENT_MAX_CHARS && !pending.length && !blocks.length) {
        dropped.push(clean)
        continue
      }
      // 记录绝对偏移（chunkOffset 是 chunk 在段内的起点）。
      pending.push({ text: clean, start: chunkOffset + start, end: chunkOffset + start + sentence.length })
      const length = pending.reduce((sum, item) => sum + item.text.length, 0)
      if (length >= minChars || length >= maxChars) flushPending()
    }
  }

  for (const span of spans) {
    pushNarration(source.slice(cursor, span.start))
    const immediate = source.slice(Math.max(0, span.start - 40), span.start)
    // 强调引号（「轻纱」「嘴巴」「1」这种单词语）不是台词：并回叙述，不单独成块。
    // 判据：长度 ≤ SHORT_QUOTE_MAX 且不是疑问/感叹/成句、不以书名号类开头——真台词极少这么短。
    // 注意顺序：这个判断必须在 flushPending 之前——否则叙述会被这一刀切断。
    const inner = span.text.trim()
    const innerCore = inner.replace(/[\s…—\-.·、，。！？；：]/gu, '')
    const emphasis = innerCore.length <= shortQuoteMax
      && !/[？！?!…。]/u.test(inner)
      && !MENTION_ONLY_QUOTE.some((mark) => inner.startsWith(mark))
    if (emphasis) {
      // 强调引号也是原文片段：用 span 的真实起止偏移入队（块文本仍能从原文切出）。
      pending.push({ text: `“${inner}”`, start: span.start, end: span.end })
      cursor = span.end
      continue
    }
    flushPending()  // 引号块必须独立：主体可能与周围叙述不同，合并会把两个人的话糊成一条
    // 紧邻窗口找不到主体时，回退到上一块的叙述（「周明瑞皱眉。『……』」这种名字在上一句的写法很常见）。
    const lastNarration = [...blocks].reverse().find((block) => block.kind === 'narration')
    let hint = speakerHintOf(immediate, knownNames)
    if (!hint.name && lastNarration) {
      const fallback = speakerHintOf(`${lastNarration.text}${immediate}`, knownNames)
      if (fallback.name) hint = { ...fallback, basis: `prev-${fallback.basis}` }
    }
    // 代词主语回退：窗口里是「他/她」且上一块只有一个已知名 → 认领该名（basis='pronoun'）。
    if (!hint.name && /(^|[，。！？；：\s])(他|她)(?![们])/u.test(immediate) && lastNarration) {
      const names = [...new Set(knownNames.filter((name) => lastNarration.text.includes(name)))]
      if (names.length === 1) hint = { name: names[0], verb: null, basis: 'pronoun', thought: hint.thought }
    }
    // 引号前是「心想/暗道」这类心理动词 → 这段引号是心里话；否则默认说出口。
    blocks.push({
      id: '',
      kind: 'quote',
      text: span.text.trim(),
      channelHint: hint.thought ? 'think' : 'say',
      speakerHint: hint.name,
      hintBasis: hint.basis,
      verb: hint.verb
    })
    cursor = span.end
  }
  pushNarration(source.slice(cursor))
  flushPending()

  // 尾块过短（< BLOCK_MIN_CHARS/2）且前块也是叙述：并进去，避免最后剩一条碎片。
  while (blocks.length > 1) {
    const last = blocks[blocks.length - 1]
    const prev = blocks[blocks.length - 2]
    const short = last.text.length < Math.ceil(minChars / 2)
    if (last.kind !== 'narration' || prev.kind !== 'narration' || !short) break
    prev.text = `${prev.text}${last.text}`
    if (CHANNEL_PRIORITY.indexOf(last.channelHint) < CHANNEL_PRIORITY.indexOf(prev.channelHint)) {
      prev.channelHint = last.channelHint
    }
    blocks.pop()
    dropped.push(`merged-tail:${last.text.slice(0, 8)}`)
  }

  const stats = {
    version: BLOCKS_VERSION,
    blocks: blocks.length,
    quotes: blocks.filter((block) => block.kind === 'quote').length,
    speakerHints: blocks.filter((block) => block.speakerHint).length,
    droppedFragments: dropped.length,
    byChannelHint: blocks.reduce((acc, block) => {
      acc[block.channelHint] = (acc[block.channelHint] ?? 0) + 1
      return acc
    }, {})
  }
  return {
    blocks: blocks.map((block, index) => ({ ...block, id: `b${index + 1}`, index: index + 1 })),
    stats
  }
}

/** 多段批量：返回 [{id, index, chars, text, blocks, stats}]，段序与入参一致。options 原样透传给 segmentBlocks（含档位）。 */
export function blocksOfSegments(segments, options = {}) {
  const list = Array.isArray(segments) ? segments : []
  return list.map((segment) => {
    const text = String(segment?.text ?? '')
    const { blocks, stats } = segmentBlocks(text, options)
    return {
      id: String(segment?.id ?? ''),
      index: Number.isInteger(segment?.index) ? segment.index : 1,
      chars: Number.isInteger(segment?.chars) ? segment.chars : text.length,
      text,
      blocks,
      stats
    }
  })
}
