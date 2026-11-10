/**
 * 文风实例化（P-STYLE）：把一份「风格蒸馏产物」编译成渲染可用的 styleSpec。
 *
 * 定位（作者裁定）：文风是**上层包装能力包**，不是 fact 一等公民；只在小说体裁生效。
 * 所以这一层不碰 fact 数据、不占 worldview 槽位，只产出 `normalizeStyleSpec` 认识的那个形状
 * （targets / samples / constraints），渲染器原样吃。
 *
 * 输入是蒸馏产物（四份 markdown：语言DNA / Writing-DNA / 结构模板 / 视角认知），
 * 不是原文。**原文语料不进仓库**——这里只取统计量与短约束短语，prose 一个字都不落地。
 *
 * 三条口径：
 *   1) **只认出现的数字**：解析器只提取材料里显式给出的统计量（平均句长、段均字数、占比…），
 *      抽不到就如实记进 `missing`，绝不拿默认值冒充「解出来的」。
 *   2) **区间由统计量反推**：句长区间取「短句阈值 … 平均句长×1.7」一类可解释的推导，
 *      每一步写进 `derivation`，作者能复核这个区间是怎么来的。
 *   3) **长篇只蒸部分、用户可选**：`selectProfile` 支持按 L1/L2/L3-5 分层开关，
 *      作者可以只挂语言层（写自己的结构），也可以三层全挂。
 *
 * 纯函数、零宿主依赖：只 import fact 域内相对路径；读盘由宿主做，这里只吃字符串。
 */
import { sha1Hex } from '../../domain/stableId.js'

export const STYLE_PROFILE_VERSION = 'style-profile/v1'

/** 分层键：与蒸馏产物的层级对应（L1 语言 / L2 结构 / L3-5 视角认知）。 */
export const STYLE_LAYERS = Object.freeze(['L1', 'L2', 'L3-5'])

function str(value) {
  return String(value ?? '')
}

function trimmed(value) {
  return str(value).trim()
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function unique(list) {
  const out = []
  const seen = new Set()
  for (const item of list) {
    const text = trimmed(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

/** 从 markdown 表格行里取「指标 → 数字」：`| 平均句长 | 23.4 字 | 中短 |`。 */
function tableNumber(text, label) {
  const pattern = new RegExp(`\\|\\s*${label}[^|]*\\|\\s*([\\d.]+)`, 'u')
  const match = pattern.exec(str(text))
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

/** 从正文句子型描述里取百分比：`对话字数约占正文 25%`；也认「约占 1/4」这类分数写法。 */
function inlinePercent(text, pattern) {
  const source = str(text)
  const match = pattern.exec(source)
  if (match) {
    const value = Number(match[1])
    if (Number.isFinite(value)) return value
  }
  return null
}

/** 「约占 1/4」→ 25。材料里两种写法都有，不认分数就会漏掉对话占比。 */
function fractionPercent(text, pattern) {
  const match = pattern.exec(str(text))
  if (!match) return null
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  return Number(((numerator / denominator) * 100).toFixed(1))
}

/**
 * 取禁则条目。材料里有两种写法，都要认：
 *   ① 列表项开头的「忌：A；B」——中文分号切分；
 *   ② 句子中间的「……禁连续三句等长复句」——从「禁」起截到句末。
 */
function collectForbidden(dnaText) {
  const out = []
  const text = str(dnaText)
  for (const match of text.matchAll(/[-*]?\s*(?:忌|禁忌|禁用)\s*[:：]\s*([^\n]+)/gu)) {
    for (const part of match[1].split(/[；;]/u)) {
      const item = trimmed(part).replace(/[。.]$/u, '').replace(/\*\*/gu, '')
      if (item.length >= 2) out.push(item)
    }
  }
  // 行内「…禁X」：从「禁」开始到句末。列表项里的「3. 设定投放：禁开篇…」也要认，
  // 所以前置不限定「。；」——只要不是「禁」出现在另一个禁则短语中间就好（用行首锚点兜住）。
  for (const match of text.matchAll(/(?:^|[\n。；;：:）)]\s*)\d*[.、]?\s*[^\n]{0,20}?禁\s*([^。；;\n]+)/gu)) {
    const item = trimmed(match[1]).replace(/\*\*/gu, '')
    if (item.length >= 4 && item.length <= 80) out.push(`禁${item}`)
  }
  return unique(out)
}

/** 取硬要求。材料写法：「强指纹：**…**」/「复刻必留」/「必须」/「必留」。 */
function collectRequired(dnaText) {
  const out = []
  const text = str(dnaText)
  for (const match of text.matchAll(/(?:强指纹|复刻必留|必留|必含|必须)\s*[:：]?\s*([^\n]+)/gu)) {
    const item = trimmed(match[1]).replace(/[。.]$/u, '').replace(/\*\*/gu, '')
    // 太长的是整段解释，不是一条可执行约束——按中文句号切开取第一句。
    const firstSentence = item.split(/[。]/u)[0]
    // 过滤碎片：单个标点/括号结尾这种是正则吃掉半句的产物，不是约束。
    if (firstSentence.length < 4 || firstSentence.length > 80) continue
    if (/^[）)】\]」』，,、。]+$/u.test(firstSentence)) continue
    out.push(firstSentence)
  }
  return unique(out)
}

/** 取单章骨架（结构模板里的代码块）：L2 结构模板，进 styleSpec 后由渲染器按段落铺。 */
function collectSkeleton(templateText) {
  const match = /```[a-z]*\n([\s\S]*?)```/u.exec(str(templateText))
  if (!match) return ''
  return match[1].split('\n').map((line) => line.trimEnd()).filter((line) => line.trim()).join('\n')
}

/** 取视角纪律（L3）：一条一句，去掉 markdown 标记。 */
function collectPerspective(perspectiveText) {
  const out = []
  const text = str(perspectiveText)
  const l3 = /##\s*L3[^\n]*\n([\s\S]*?)(?:\n##\s|$)/u.exec(text)
  const block = l3 ? l3[1] : text
  for (const line of block.split('\n')) {
    const item = trimmed(line).replace(/^[-*]\s*/u, '').replace(/\*\*/gu, '')
    if (!item || item.startsWith('#')) continue
    if (item.length >= 6 && item.length <= 120) out.push(item)
  }
  return unique(out).slice(0, 8)
}

/**
 * 解析一份蒸馏产物 → 结构化 profile。
 *
 * @param {Object} input
 *   name            作品名（用于 id 与展示）
 *   languageDna     语言DNA.md 全文
 *   writingDna      Writing-DNA.md 全文
 *   structureTemplate 文章结构模板.md 全文
 *   perspective     写作视角与认知框架.md 全文
 * @returns {{ok:true, version, id, name, metrics, targets, constraints, structure, perspective, missing, derivation, digest}}
 */
export function parseStyleProfile(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const name = trimmed(source.name) || '未命名文风'
  const language = str(source.languageDna) || str(source.writingDna)
  const missing = []
  const derivation = {}

  const avgSentence = tableNumber(language, '平均句长')
  const avgParagraph = tableNumber(language, '段均字数')
  const shortRatio = tableNumber(language, '短句\\s*[≤<]?\\s*15\\s*字占比') ?? inlinePercent(language, /短句[^\n]{0,12}?(\d{1,2}(?:\.\d+)?)\s*%/u)
  // 对话占比常写在 Writing-DNA 而统计表在语言DNA：两份都试，任一命中即可。
  const dialoguePercent = inlinePercent(language, /对话[^\n]{0,12}?(\d{1,3}(?:\.\d+)?)\s*%/u)
    ?? fractionPercent(language, /对话[^\n]{0,10}?(\d+)\s*\/\s*(\d+)/u)
    ?? inlinePercent(str(source.writingDna), /对话[^\n]{0,12}?(\d{1,3}(?:\.\d+)?)\s*%/u)
    ?? fractionPercent(str(source.writingDna), /对话[^\n]{0,10}?(\d+)\s*\/\s*(\d+)/u)

  for (const [key, value] of [['avgSentenceChars', avgSentence], ['avgParagraphChars', avgParagraph], ['shortSentenceRatio', shortRatio], ['dialogueRatio', dialoguePercent]]) {
    if (value === null) missing.push(key)
  }

  // 区间推导：作者可复核每一步。
  const targets = {}
  if (avgSentence !== null) {
    // 平均句长 23.4、短句阈值 15 → 句长目标取 [短句阈值, 平均×1.7]（1.7 覆盖到长句少见的上沿）。
    const floor = 12
    const ceiling = Math.round(avgSentence * 1.7)
    targets.sentenceChars = [floor, ceiling]
    derivation.sentenceChars = `平均句长 ${avgSentence} 字 × 1.7 ≈ ${ceiling}，下限取短句阈值 ${floor}`
  }
  if (avgParagraph !== null) {
    // 段均字数远低于 fact 粒度（100–300）时如实两边都记：文风要短段，数据粒度要长段——渲染时按文风切段。
    targets.paragraphChars = [Math.max(10, Math.round(avgParagraph)), Math.max(60, Math.round(avgParagraph * 4))]
    derivation.paragraphChars = `段均字数 ${avgParagraph} 字；上沿取 4 倍 ≈ ${Math.round(avgParagraph * 4)}（单句成段的短行不设下限）`
  }
  if (dialoguePercent !== null) {
    const ratio = dialoguePercent / 100
    targets.dialogueRatio = [Math.max(0, Number((ratio - 0.1).toFixed(2))), Math.min(1, Number((ratio + 0.15).toFixed(2)))]
    derivation.dialogueRatio = `对话占正文 ${dialoguePercent}% → 目标区间 [${targets.dialogueRatio.join(', ')}]`
  }

  // 禁则与硬要求分散在两份产物里（语言DNA 有「忌：」与「强指纹」，Writing-DNA 有行内「禁…」与「必留」），
  // 两份都扫，结果去重——只扫一份会漏掉另一份的关键纪律。
  const dnaCorpus = [str(source.languageDna), str(source.writingDna)].filter(Boolean).join('\n\n')
  const forbidden = collectForbidden(dnaCorpus)
  const required = collectRequired(dnaCorpus)
  if (!forbidden.length) missing.push('constraints.forbidden')
  if (!required.length) missing.push('constraints.required')

  const skeleton = collectSkeleton(source.structureTemplate)
  if (!skeleton) missing.push('structure.skeleton')
  const perspectiveRules = collectPerspective(source.perspective)
  if (!perspectiveRules.length) missing.push('perspective.rules')

  const profile = {
    ok: true,
    version: STYLE_PROFILE_VERSION,
    name,
    id: `style-${sha1Hex(`profile|${name}|${avgSentence ?? ''}|${avgParagraph ?? ''}`).slice(0, 10)}`,
    metrics: {
      avgSentenceChars: avgSentence,
      avgParagraphChars: avgParagraph,
      shortSentenceRatio: shortRatio === null ? null : Number((shortRatio > 1 ? shortRatio : shortRatio * 100).toFixed(1)),
      dialogueRatio: dialoguePercent === null ? null : Number(dialoguePercent.toFixed(1))
    },
    targets,
    constraints: { forbidden, required },
    structure: { skeleton },
    perspective: { rules: perspectiveRules },
    missing,
    derivation
  }
  profile.digest = sha1Hex(JSON.stringify({
    metrics: profile.metrics, targets: profile.targets, constraints: profile.constraints,
    structure: profile.structure, perspective: profile.perspective
  })).slice(0, 12)
  return profile
}

/**
 * 从原文语料里挑代表句（samples）——**只返回短句文本，不落任何原文到仓库**。
 *
 * 挑法确定性：取长度落在 [minSentence, maxSentence] 内、且句尾是。！？ 的句子，
 * 按「长度离句长中值最近」排序取前 N 条。没有语料就返回空并如实说明。
 *
 * @param {string[]} texts 章正文（调用方从 raw/ 读进来，不给就不产 samples）
 */
export function pickStyleSamples(texts, { limit = 12, minSentence = 6, maxSentence = 40 } = {}) {
  const list = Array.isArray(texts) ? texts : []
  if (!list.length) return { samples: [], note: '没有传入语料：samples 为空（代表句只能从原文取，不能编）' }
  const candidates = []
  for (const text of list) {
    for (const raw of str(text).split(/[。！？!?\n]+/u)) {
      const sentence = raw.trim().replace(/^["“「『]+|["”」』]+$/gu, '')
      if (sentence.length < minSentence || sentence.length > maxSentence) continue
      // 明显是元信息行（章名、目录、空行）跳过。
      if (/^第?\s*\d+\s*[章节]/u.test(sentence)) continue
      candidates.push(sentence)
    }
  }
  if (!candidates.length) return { samples: [], note: '语料里没有落在句长区间内的句子：samples 为空' }
  const lengths = candidates.map((item) => item.length).sort((a, b) => a - b)
  const median = lengths[Math.floor(lengths.length / 2)]
  const picked = []
  const seen = new Set()
  for (const sentence of [...candidates].sort((a, b) => Math.abs(a.length - median) - Math.abs(b.length - median))) {
    if (seen.has(sentence)) continue
    seen.add(sentence)
    picked.push(sentence)
    if (picked.length >= limit) break
  }
  return { samples: picked, note: `从 ${list.length} 段语料里挑 ${picked.length} 句（句长中值 ${median} 字）` }
}

/**
 * profile → 渲染器认识的 styleSpec（`normalizeStyleSpec` 的形状）。
 * @param {Object} profile parseStyleProfile 的产物
 * @param {{layers?:string[], samples?:string[], name?:string}} [options]
 *        layers：只挂指定层（'L1' 语言 / 'L2' 结构 / 'L3-5' 视角）；缺省全挂。
 */
export function styleSpecFromProfile(profile, options = {}) {
  const source = isPlainObject(profile) ? profile : {}
  const opts = isPlainObject(options) ? options : {}
  const layers = Array.isArray(opts.layers) && opts.layers.length
    ? opts.layers.filter((layer) => STYLE_LAYERS.includes(layer))
    : [...STYLE_LAYERS]
  const useL1 = layers.includes('L1')
  const useL2 = layers.includes('L2')
  const usePerspective = layers.includes('L3-5')

  const forbidden = []
  const required = []
  if (useL1) {
    forbidden.push(...(source.constraints?.forbidden ?? []))
    required.push(...(source.constraints?.required ?? []))
  }
  if (useL2 && source.structure?.skeleton) {
    // 结构模板进 required：渲染器把它当「本章骨架」约束，而不是自由发挥。
    required.push(...source.structure.skeleton.split('\n').map((line) => trimmed(line).replace(/^[-→\s]+/u, '')).filter((line) => line.length >= 4).slice(0, 8))
  }
  if (usePerspective) {
    required.push(...(source.perspective?.rules ?? []))
  }

  const spec = {
    name: trimmed(opts.name) || trimmed(source.name) || '未命名文风',
    targets: useL1 && isPlainObject(source.targets) ? { ...source.targets } : {},
    samples: Array.isArray(opts.samples) ? opts.samples.map(trimmed).filter(Boolean) : [],
    constraints: { forbidden: unique(forbidden), required: unique(required) }
  }
  // 只挂部分层时如实记下——作者要知道这一份 styleSpec 不是全量。
  if (layers.length !== STYLE_LAYERS.length) spec.layers = [...layers]
  return spec
}

/**
 * 语料规模判定（作者裁定「长篇只蒸部分、用户可选」的执行侧）：
 * 给一个语料规模，返回建议挂哪几层，以及「部分蒸馏」的具体含义。
 *
 * 判据是**统计稳定性**，不是主观偏好：句子级统计（L1）在中型语料上已稳定；
 * 结构/视角（L2/L3-5）需要跨章抽样才能覆盖多种场景类型，语料太少会过拟合到某一章。
 */
export function suggestLayers({ chapters = 0, chars = 0 } = {}) {
  const chapterCount = Number(chapters) || 0
  const charCount = Number(chars) || 0
  if (chapterCount >= 300 || charCount >= 600_000) {
    return { layers: [...STYLE_LAYERS], scope: 'full', note: '语料充足：三层全蒸（L1 语言 / L2 结构 / L3-5 视角）' }
  }
  if (chapterCount >= 50 || charCount >= 100_000) {
    return { layers: ['L1', 'L2'], scope: 'partial', note: '中型语料：L1 语言＋L2 结构稳定；L3-5 视角可能过拟合到少数场景，建议人工补' }
  }
  return { layers: ['L1'], scope: 'minimal', note: '小语料：只蒸 L1 语言（句长/段长/对话占比）；结构模板与视角框架请作者手写' }
}
