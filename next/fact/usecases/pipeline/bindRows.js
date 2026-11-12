/**
 * 绑定 → 抽取行（P-TRIM 三段式第三段：**零模型**）。
 *
 * 输入是切块器（blocks.js）切好的块，加上模型只做的窄绑定（who / ch），
 * 输出就是现行 `EXTRACTION_ROW_SCHEMA` 的完整行——下游 compile／剪枝／lean 落盘一行代码都不用改。
 *
 * 三条铁律（这是「LLM 不用思考」的落点）：
 *   1) **事件正文＝块原文**：模型从不产生事件文本，所以事件永远可原文定位（旧链路只有 29%）；
 *   2) **绑定不合法就退回规则提示**：who 不在本段原文里出现＝幻觉，直接丢弃而不是采信；
 *   3) **模板字段由代码定**：when/where 从段上下文继承，模型只在真异常时给例外。
 *
 * 纯函数、零宿主依赖。
 */

import { BIND_CHANNELS } from './bindPrompt.mjs'
import { isIdentityTitle, normalizeTitleName, perspectiveContextOf } from './perspectiveTitles.js'
import { resolvePronoun } from './pronounResolve.js'
import { isLikelyPersonName } from './nameCandidates.js'

/**
 * 段 id 容错对齐：模型会以三种**可确定性还原**的方式改写 id（实测各占一批）：
 *   1) 精确相等；
 *   2) 抄了提示词的排版前缀或括号（"段 xxx:1:yyy"、"【xxx】"）→ 剥装饰后相等；
 *   3) 截断成首个哈希段（"3b133e6c97"）→ 唯一前缀认领；
 *   4) 改用序号（"第6段" / "6" / "seg:6"）→ 按段序号对齐。
 * 四条都对不上就返回 null（交给规则兜底），绝不猜。
 * @param {string} rawId 模型回的 id
 * @param {string[]|Array<{id:string,index?:number}>} candidates 真 id 列表，或带 index 的单元列表
 */
export function resolveSegmentId(rawId, candidates) {
  const raw = String(rawId ?? '').trim()
  if (!raw) return null
  const list = Array.isArray(candidates) ? candidates : []
  const ids = list.map((item) => (typeof item === 'string' ? item : String(item?.id ?? ''))).filter(Boolean)
  if (ids.includes(raw)) return raw
  const cleaned = raw.replace(/^[【\s]*段?[\s:：]*/u, '').replace(/[】\s]+$/u, '').trim()
  if (cleaned && ids.includes(cleaned)) return cleaned
  // 3) 唯一前缀截断
  if (cleaned.length >= 8) {
    const prefixed = ids.filter((id) => id.startsWith(cleaned))
    if (prefixed.length === 1) return prefixed[0]
  }
  // 4) 序号形态：只认「第N段 / N / seg:N / 段N」这几种明确写法，且该序号在候选里唯一。
  const ordinal = /^(?:第\s*)?(\d{1,5})\s*段?$/u.exec(cleaned) ?? /^seg:?(\d{1,5})$/iu.exec(cleaned)
  if (ordinal) {
    const wanted = Number(ordinal[1])
    const byIndex = list.filter((item) => typeof item === 'object' && Number(item?.index) === wanted)
    if (byIndex.length === 1) return String(byIndex[0].id)
  }
  return null
}

export const BIND_ROWS_VERSION = 'fact-bind-rows/v1'

/** 默认的段级时间地点（模型不给例外时用它；比「让模型每段判一次」便宜 46 字/段）。 */
export const DEFAULT_WHEN = Object.freeze({ story_time: '未明示', timeline: '顺叙' })
export const DEFAULT_WHERE = '未明示'

/** 增量条数上限（可由档位 bind.maxIncrementsPerSegment 覆写）。 */
const DEFAULT_LIMITS = Object.freeze({ settings: 6, knowledge: 4, hooks: 2, relations: 8 })

/**
 * 称谓式关系目标：不是条目名（图上是断链节点）。compile 侧也会告警，这里先拦下改写。
 * 两种形态都拦（真跑实测两种都出现）：
 *   · 带前缀的「X的父亲」；
 *   · **裸称谓**「父亲」「哥哥」「妹妹」——模型最爱这么写，但世界书里没有这个条目。
 */
const KINSHIP_WORDS = '父亲|母亲|爸爸|妈妈|哥哥|弟弟|姐姐|妹妹|兄长|儿子|女儿|老师|师父|师傅|上司|下属|主人|仆人|妻子|丈夫|未婚妻|未婚夫|爷爷|奶奶|叔叔|舅舅|阿姨'
const TITLE_TARGET = new RegExp(`^(?:.{1,12}的)?(?:${KINSHIP_WORDS})$`, 'u')

const str = (value) => String(value ?? '').trim()

/** who 必须真的出现在块或段原文里；否则视为幻觉绑定，丢弃并计数。 */
/**
 * 人名合理性判定：`who` 光「在原文里出现」不够——第一人称小说里「我们买」「我找人」「我爸气得」
 * 全都是原文子串，但它们不是人名。真跑（番茄短篇库 8.8k 字样本）实测 21 个「角色」里只有 1 个真名，
 * 其余全是这类句子碎片。
 *
 * 三条确定性拒绝（都不需要模型）：
 *   1) **含虚词/动词**：「的 了 着 过 是 在 把 被 我 你 他 她 它 想 要 去 来 说 道」等——人名几乎不含；
 *   2) **代词本身**：我/你/他/她/它/我们/你们/他们/大家/自己/对方——是第一人称叙事的常态，不是条目；
 *   3) **过长的短语**：>6 字（中文人名极少超 5 字，含少数民族/译名）。
 * 拒绝只记计数、不报错——名字进 index.mentions 的路由在 compile 侧另算。
 */
const NAME_STOP_CHARS = /[的了着过是在把被让我你他她它们想要去来说道问看走坐站笑叹知能会可别没不就都也又而但和与同对这那哪什怎为因为所以如果虽然已经直接继续然后接着突然忽然立即马上顿时终于果然竟然]|\s/u
/** 判定为「可用」的 reason 集合；其余一律计入 hallucinated。 */
const ACCEPTED_WHO_REASONS = new Set(['verified', 'verbatim', 'known', 'empty'])

const PRONOUN_NAMES = new Set([
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '她们', '它们',
  '大家', '众人', '自己', '对方', '有人', '某人', '这人', '那人', '旁人', '所有人'
])

/**
 * 正向证据：真名在叙事里必然与「说话/动作/出现在引号前」共现。
 * 实测（脱轨 7 万字）：余欢出现 795 次、后接说话动词 39 次；碎片「闯祸」「犹豫」「最终」后接 0 次。
 * 所以除了「像不像名字」，还可以问「它在原文里有没有像名字那样被用过」。
 */
const NAME_EVIDENCE_PATTERN = /(说|道|问|答|喊|叫|笑|叹|皱眉|抬头|低头|点头|摇头|转身|走进|走进来|看向|望着|开口|沉声|轻声)/u

/**
 * 名字取证：在原文里找这个串的共现证据。
 * @returns {{mentions:number, withCue:number, inQuote:number}}
 */
export function nameEvidence(name, text) {
  const target = str(name)
  const source = String(text ?? '')
  const stats = { mentions: 0, withCue: 0, inQuote: 0, beforeQuote: 0 }
  if (!target || !source) return stats
  let index = source.indexOf(target)
  while (index >= 0) {
    stats.mentions += 1
    const after = source.slice(index + target.length, index + target.length + 4)
    if (NAME_EVIDENCE_PATTERN.test(after)) stats.withCue += 1
    const before = source.slice(Math.max(0, index - 2), index)
    if (/[“「"]/u.test(before)) stats.inQuote += 1
    // 说话人常写在后接引号前：「岑思犹豫了一下：“我也去。”」——引号在后也是线索。
    if (/[“「"]/u.test(source.slice(index + target.length, index + target.length + 12))) stats.beforeQuote += 1
    index = source.indexOf(target, index + 1)
  }
  return stats
}

/**
 * @param {string} value 待判定的 who
 * @param {{text?:string, nameTable?:string[]}} [context] 段原文与已确认名表
 * @returns {{ok:boolean, reason:string}}
 */
/**
 * 名尾修正：模型常把「名字＋动词首字」粘成一个 who（实测「林逸拍桌」→ 报成「林逸拍」）。
 * 处理：若这个名字的前缀恰好是一个**已知名**（或本段高频出现的候选名），就截到已知名。
 * 只做「向后截断」，绝不向前补字；截完仍要过形态闸。
 * @returns {string} 修正后的名字（无需修正时原样返回）
 */
export function trimNameTail(name, knownNames = []) {
  const value = str(name)
  if (!value) return value
  let best = value
  for (const known of knownNames) {
    const candidate = str(known)
    if (!candidate || candidate === value) continue
    if (value.startsWith(candidate) && value.length > candidate.length) {
      // 只接受「多余部分是 1 字」的情形（动词首字最常见的粘连长度）。
      // 尾巴允许 1–2 字（「林逸拍」「林逸斩钉」都是把动作粘进了名字）。
      const tail = value.length - candidate.length
      if (tail >= 1 && tail <= 2 && candidate.length < best.length) best = candidate
    }
  }
  return best
}

export function judgePersonName(value, context = {}) {
  // 先修正名尾粘连（「林逸拍」→「林逸」），再走形态闸。
  const name = trimNameTail(str(value), context.nameTable)
  // 有全书候选统计时以它为准：形态 + 分布双重判据，比单段证据可靠（实测 8/8 真名过、8/8 碎片拒）。
  if (context.nameCandidates) {
    // isLikelyPersonName 会做前缀截断，返回它修正后的 name（调用方用这个值）。
    return isLikelyPersonName(str(value), context.nameCandidates)
  }
  if (!name) return { ok: false, reason: 'empty' }
  if (PRONOUN_NAMES.has(name)) return { ok: false, reason: 'pronoun' }
  if (name.length > 6) return { ok: false, reason: 'too-long' }
  if (NAME_STOP_CHARS.test(name)) return { ok: false, reason: 'stop-char' }
  // 已在名表里＝前文确认过，直接放行（跨段一致性优先）。
  if (Array.isArray(context.nameTable) && context.nameTable.includes(name)) return { ok: true, reason: 'known' }
  const text = context.text
  if (!text) return { ok: true, reason: 'no-context' }
  const evidence = nameEvidence(name, text)
  if (!evidence.mentions) return { ok: false, reason: 'not-present' }
  // 只出现一次且没有任何名字式共现 → 是句子碎片（真名哪怕只出现一次也常带说话动词）。
  // 只出现一次时要求更强证据：后接动作词，或紧邻引号（说话人位置）。
  // 单靠「出现一次」会放过「犹豫」「最终」这类高频副词——它们在任意文本里都出现。
  if (evidence.mentions === 1 && evidence.withCue === 0 && evidence.inQuote === 0 && evidence.beforeQuote === 0) {
    return { ok: false, reason: 'weak-evidence' }
  }
  return { ok: true, reason: 'evidence' }
}

/** 兼容旧调用：只做形态判定（不带原文证据）。 */
export function looksLikePersonName(value) {
  return judgePersonName(value).ok
}

/**
 * 判定一个 who 能不能用。顺序：形态 → 原文出现 → 名字式证据。
 * @param {string} value
 * @param {{text:string, haystack:string, nameTable:string[]}} context
 */
function explainWho(value, context) {
  // 称谓即身份（作者裁定）：第一人称段里出现的「男友」「妈妈」「闺蜜」直接可用，不必等真名。
  // 这是第一人称小说的常态——全文可能一直只用称谓指称，强求真名会让条目整段丢失。
  const identityTitle = normalizeTitleName(str(value))
  // 本段在场性：who 必须真的出现在这段原文里（否则是模型从别处串过来的名字）。
  // 实测：某段绑了 who=「继续」，但这段原文根本没有「继续」——全书的候选统计通过了，它却不在场。
  // 称谓与代词映射走各自的闸，不受此限。
  const inSegment = context.text.includes(str(value))
  if (!inSegment && !isIdentityTitle(str(value))) return { name: '', reason: 'not-in-segment' }

  if (context.perspective === 'first' && isIdentityTitle(identityTitle)) {
    return { name: identityTitle, reason: 'identity-title' }
  }

  const verdict = judgePersonName(str(value), {
    text: context.text,
    nameTable: context.nameTable,
    nameCandidates: context.nameCandidates
  })
  if (!verdict.ok) return { name: '', reason: verdict.reason }
  // 用 verdict.name：判定器可能做了前缀截断（「林逸拍」→「林逸」），那个才是可用名字。
  return { name: verdict.name ?? str(value), reason: 'verified' }
}

/** 段级 when/where 例外：只收模型明确给出的字段，其余保持 undefined（由 run 默认继承）。 */
function normalizeTimeException(binding) {
  const when = binding?.when
  const out = {}
  if (when && typeof when === 'object' && !Array.isArray(when)) {
    if (str(when.story_time)) out.story_time = str(when.story_time)
    if (['顺叙', '倒叙', '插叙', '未明示'].includes(str(when.timeline))) out.timeline = str(when.timeline)
  }
  return out
}

/**
 * 单段：blocks + binding → 行。
 * @param {{id:string,index:number,chars:number,text:string,blocks:Array}} segment
 * @param {{blocks?:Array, settings?:Array, knowledge?:Array, hooks?:Array, aka?:Array, when?:Object, where?:string}} binding
 * @param {{knownNames?:string[], when?:Object, where?:string}} [options]
 * @returns {{row:Object, stats:Object}}
 */
export function bindSegment(segment, binding = {}, options = {}) {
  const blocks = Array.isArray(segment?.blocks) ? segment.blocks : []
  const knownNames = Array.isArray(options.knownNames) ? options.knownNames.filter(Boolean) : []
  // P-4：段级例外优先于 run 级默认值。模型只在「这一段真的不在默认时空」时才给 when/where，
  // 其余由代码继承——这是把 when/where 从「每段必答」降级成「只在异常时答」的关键。
  const when = {
    ...DEFAULT_WHEN,
    ...(options.when ?? {}),
    ...normalizeTimeException(binding)
  }
  const where = str(binding?.where) || str(options.where) || DEFAULT_WHERE
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) }
  // 全书名字候选统计（驱动侧一次性算好传进来）：有它就用它判，比「本段证据」可靠得多。
  const nameCandidates = options.nameCandidates ?? null
  // 视角上下文（作者 2026-11-12）：第一人称里「男友」「妈妈」这类称谓本身就是身份，可直接作 who。
  // 视角上下文：options.perspective 可传字符串（'first'/'third'）或 {perspective, confidence} 对象，两种都收。
  const perspectiveInput = typeof options.perspective === 'string'
    ? { perspective: options.perspective }
    : (options.perspective ?? null)
  const perspective = perspectiveContextOf(segment, { ...options, perspective: perspectiveInput })
  const byId = new Map()
  for (const item of binding?.blocks ?? []) {
    const id = str(item?.id)
    if (id) byId.set(id, item)
  }

  const stats = { blocks: blocks.length, bound: 0, hallucinated: 0, ruleFallback: 0, unknownChannel: 0 }
  const events = []
  for (const block of blocks) {
    const bound = byId.get(block.id) ?? null
    if (!bound) stats.ruleFallback += 1
    const channel = BIND_CHANNELS.includes(str(bound?.ch))
      ? str(bound?.ch)
      : (BIND_CHANNELS.includes(block.channelHint) ? block.channelHint : 'state')
    if (bound && str(bound?.ch) && !BIND_CHANNELS.includes(str(bound.ch))) stats.unknownChannel += 1

    const whoContext = { text: segment?.text ?? '', nameTable: knownNames, nameCandidates, perspective: perspective.perspective, titles: perspective.titles }
    const candidate = bound ? explainWho(bound.who, whoContext) : explainWho(block.speakerHint, whoContext)
    // 幻觉（原文没有）与「像句子不像人名」都是模型给错的 who，统一计入 hallucinated：
    // 对调用方而言「这个名字不能用」是同一件事，分两个计数器只会让人漏看。
    // 所有「名字不可用」的理由都计入 hallucinated：对调用方是同一件事。
    if (candidate.reason && !ACCEPTED_WHO_REASONS.has(candidate.reason)) stats.hallucinated += 1
    if (bound && candidate.name) stats.bound += 1

    events.push({
      who: candidate.name,
      channel,
      content: block.text
    })
  }

  // who 汇总：事件主体按出现序去重（这就是旧链路由模型逐个复述的那个字段）
  const who = [...new Set(events.map((event) => event.who).filter(Boolean))]

  // 人物档案：speech/behavior 由块本身聚合——模型不再逐段重写履历（旧链路 57% 是重复）
  const profiles = new Map()
  const touch = (name) => {
    if (!profiles.has(name)) {
      profiles.set(name, { name, aliases: [], identity: '', traits: [], speech: [], behavior: [] })
    }
    return profiles.get(name)
  }
  for (const event of events) {
    if (!event.who) continue
    const profile = touch(event.who)
    if (event.channel === 'say' && !profile.speech.includes(event.content)) profile.speech.push(event.content)
    if (event.channel === 'do' && !profile.behavior.includes(event.content)) profile.behavior.push(event.content)
  }

  const settings = (Array.isArray(binding?.settings) ? binding.settings : [])
    .map((item) => (typeof item === 'string'
      // 模型偶尔把设定写成一句话（实测 26 条全是句子）：兜成「名=首段/定义=整句」，
      // 交给 inferSlot ＋ 后续 consolidate 决定去留；不整条丢弃，因为句子本身是真信息。
      ? { name: item.split(/[，。；：、,;:]/u)[0].slice(0, 24), slot: 'other', definition: item, aliases: [] }
      : {
          name: str(item?.name),
          slot: str(item?.slot) || 'other',
          definition: str(item?.definition),
          aliases: Array.isArray(item?.aliases) ? item.aliases.map(str).filter(Boolean) : []
        }))
    .filter((item) => item.name && item.definition)
    .slice(0, limits.settings)

  const knowledgeRaw = (Array.isArray(binding?.knowledge) ? binding.knowledge : [])
    .map((item) => (typeof item === 'string'
      ? { character: '', source: '', learned: item }
      : {
          character: str(item?.character),
          source: str(item?.source),
          learned: str(item?.learned)
        }))
  // 知情记录必须挂到人身上（compile 按 character 聚合）；没有 character 的丢弃并计数，不静默吞。
  const knowledge = knowledgeRaw.filter((item) => item.character && item.learned).slice(0, limits.knowledge)
  const knowledgeDropped = knowledgeRaw.length - knowledge.length

  const hooks = (Array.isArray(binding?.hooks) ? binding.hooks : []).map(str).filter(Boolean).slice(0, limits.hooks)

  // 关系（P-6）：模型给 {from,to,type,how}，代码做三条确定性清洗——
  //   1) from/to 必须都在本段原文里出现（否则是幻觉关系，丢弃并计数）；
  //   2) 自指（from===to）丢弃；
  //   3) 称谓目标（「X的父亲」或裸「父亲」）不当 to：改写进 how，条目名回到 from。
  const relationsRaw = (Array.isArray(binding?.relations) ? binding.relations : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      from: str(item.from),
      to: str(item.to),
      type: str(item.type),
      how: str(item.how)
    }))
  // 代词映射（作者 2026-11-12）：第一人称里关系端点常是「我」「他」，
  // 它们不是条目名，落库即断链。按视角映射到主角/唯一候选人；映射不了就丢弃并计数。
  const pronounContext = {
    perspective: perspective.perspective,
    protagonist: options.protagonist ?? null,
    others: [...new Set([...who, ...profiles.keys()])]
  }
  const relations = []
  const relationDropped = { missing: 0, hallucinated: 0, self: 0, titleTarget: 0, pronoun: 0 }
  const hay = String(segment?.text ?? '')
  for (const relation of relationsRaw) {
    if (!relation.from || !relation.to || !relation.type) { relationDropped.missing += 1; continue }
    // 代词先解析成实体，再做后续所有检查。
    const resolvedFrom = resolvePronoun(relation.from, pronounContext)
    const resolvedTo = resolvePronoun(relation.to, pronounContext)
    if (!resolvedFrom.name || !resolvedTo.name) { relationDropped.pronoun += 1; continue }
    relation.from = resolvedFrom.name
    relation.to = resolvedTo.name
    // 原文校验只对「原文里直接写的名字」生效。代词映射出来的实体（我→沈岚）本段原文当然没有，
    // 拿它去比对必然误判幻觉——映射本身就是「用视角信息补原文没写的东西」。
    const fromNeedsProof = !resolvedFrom.mapped
    const toNeedsProof = !resolvedTo.mapped
    if ((fromNeedsProof && !hay.includes(relation.from)) || (toNeedsProof && !hay.includes(relation.to))) { relationDropped.hallucinated += 1; continue }
    if (relation.from === relation.to) { relationDropped.self += 1; continue }
    // 称谓当 from 也不行：关系边必须有真实主体（「哥哥→进出口公司」这种 from 不是条目）。
    if (TITLE_TARGET.test(relation.from)) { relationDropped.titleTarget += 1; continue }
    if (TITLE_TARGET.test(relation.to)) {
      // 称谓不是实体：保留关系语义（写进 how），但不指向一个不存在的条目。
      relationDropped.titleTarget += 1
      relation.how = relation.how ? `${relation.how}（目标：${relation.to}）` : `目标：${relation.to}`
      relation.to = relation.from
      continue
    }
    relations.push(relation)
  }

  // aka：模型只在「原文明确断言同一人」时给的别名对。这里只做**收集**，
  // 真正的 entity 合并由 compile 的 aliasIndex 完成（代码干合并，模型只给判断）。
  const akaPairs = (Array.isArray(binding?.aka) ? binding.aka : [])
    .map((pair) => (Array.isArray(pair) ? pair.map(str).filter(Boolean) : []))
    .filter((pair) => pair.length === 2)

  // 别名落到档案上（同段内即可见；跨段由 compile 的 alsoKnownAsInSource 通道继续）。
  for (const [left, right] of akaPairs) {
    for (const [self, other] of [[left, right], [right, left]]) {
      if (!profiles.has(self)) {
        // 只给别名、不产空档案：主体没见过就先不建档，避免造出无证据条目。
        continue
      }
      const profile = profiles.get(self)
      if (!profile.aliases.includes(other)) profile.aliases.push(other)
      if (!profile.alsoKnownAsInSource) profile.alsoKnownAsInSource = []
      if (!profile.alsoKnownAsInSource.includes(other)) profile.alsoKnownAsInSource.push(other)
    }
  }

  return {
    row: {
      segmentId: str(segment?.id),
      who,
      when,
      where,
      events,
      notes: '',
      characters: [...profiles.values()],
      settings,
      relations,
      knowledge,
      hooks
    },
    stats: { ...stats, akaPairs: akaPairs.length, knowledgeDropped, relations: relations.length, relationDropped }
  }
}

/** 多段批量绑定 → 行数组（顺序与入参一致）。 */
export function bindSegments(segments, bindings = [], options = {}) {
  const list = Array.isArray(segments) ? segments : []
  const ids = list.map((segment) => str(segment?.id)).filter(Boolean)
  const map = new Map()
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const id = resolveSegmentId(item?.id, ids)
    if (id) map.set(id, item)
  }
  const rows = []
  const stats = { segments: 0, blocks: 0, bound: 0, hallucinated: 0, ruleFallback: 0, unknownChannel: 0, akaPairs: 0, knowledgeDropped: 0, relations: 0, relationDropped: { missing: 0, hallucinated: 0, self: 0, titleTarget: 0 } }
  for (const segment of list) {
    const { row, stats: one } = bindSegment(segment, map.get(str(segment?.id)) ?? {}, options)
    rows.push(row)
    stats.segments += 1
    stats.blocks += one.blocks
    stats.bound += one.bound
    stats.hallucinated += one.hallucinated
    stats.ruleFallback += one.ruleFallback
    stats.unknownChannel += one.unknownChannel
    // 关系与别名的读数也要聚合——否则调用方看到 relationDropped 全 0，误以为「没被清洗」（真跑撞到）。
    stats.akaPairs += one.akaPairs ?? 0
    stats.knowledgeDropped += one.knowledgeDropped ?? 0
    stats.relations += one.relations ?? 0
    for (const key of Object.keys(stats.relationDropped)) stats.relationDropped[key] += one.relationDropped?.[key] ?? 0
  }
  return { rows, stats }
}

/**
 * 绑定回包校验：只认 {segments:[...]} 或 {blocks:[...]} 两种形状，
 * 字段做闭集检查（ch 必须在枚举内、who 必须是字符串）——不合法就整条丢弃，
 * 由调用方按 ruleFallback 兜底（**坏绑定不能污染事件正文**，因为正文取块原文）。
 */
export function normalizeBindReply(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'BIND_SHAPE' }
  if (Array.isArray(value.segments)) {
    return {
      ok: true,
      segments: value.segments
        .filter((item) => item && typeof item === 'object' && str(item.id))
        .map((item) => ({
          id: str(item.id),
          blocks: normalizeBlockBindings(item.blocks),
          settings: Array.isArray(item.settings) ? item.settings : [],
          knowledge: Array.isArray(item.knowledge) ? item.knowledge : [],
          hooks: Array.isArray(item.hooks) ? item.hooks : [],
          aka: Array.isArray(item.aka) ? item.aka : [],
          when: item.when && typeof item.when === 'object' ? item.when : undefined,
          where: str(item.where) || undefined
        }))
    }
  }
  if (Array.isArray(value.blocks)) {
    return {
      ok: true,
      segments: [{
        id: str(value.segmentId),
        blocks: normalizeBlockBindings(value.blocks),
        settings: Array.isArray(value.settings) ? value.settings : [],
        knowledge: Array.isArray(value.knowledge) ? value.knowledge : [],
        hooks: Array.isArray(value.hooks) ? value.hooks : [],
        aka: Array.isArray(value.aka) ? value.aka : [],
        when: value.when && typeof value.when === 'object' ? value.when : undefined,
        where: str(value.where) || undefined
      }]
    }
  }
  return { ok: false, code: 'BIND_SHAPE' }
}

function normalizeBlockBindings(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item === 'object' && str(item.id))
    .map((item) => ({ id: str(item.id), who: str(item.who), ch: str(item.ch) }))
}
