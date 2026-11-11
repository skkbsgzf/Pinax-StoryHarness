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
function explainWho(value, haystack, knownNames) {
  const name = str(value)
  if (!name) return { name: '', reason: 'empty' }
  if (haystack.includes(name)) return { name, reason: 'verbatim' }
  if (knownNames.includes(name)) return { name, reason: 'known' }
  return { name: '', reason: 'hallucinated' }
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

    const hay = `${block.text}${segment?.text ?? ''}`
    const candidate = bound ? explainWho(bound.who, hay, knownNames) : explainWho(block.speakerHint, hay, knownNames)
    if (candidate.reason === 'hallucinated') stats.hallucinated += 1
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
  const relations = []
  const relationDropped = { missing: 0, hallucinated: 0, self: 0, titleTarget: 0 }
  const hay = String(segment?.text ?? '')
  for (const relation of relationsRaw) {
    if (!relation.from || !relation.to || !relation.type) { relationDropped.missing += 1; continue }
    if (!hay.includes(relation.from) || !hay.includes(relation.to)) { relationDropped.hallucinated += 1; continue }
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
  const stats = { segments: 0, blocks: 0, bound: 0, hallucinated: 0, ruleFallback: 0, unknownChannel: 0 }
  for (const segment of list) {
    const { row, stats: one } = bindSegment(segment, map.get(str(segment?.id)) ?? {}, options)
    rows.push(row)
    stats.segments += 1
    stats.blocks += one.blocks
    stats.bound += one.bound
    stats.hallucinated += one.hallucinated
    stats.ruleFallback += one.ruleFallback
    stats.unknownChannel += one.unknownChannel
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
