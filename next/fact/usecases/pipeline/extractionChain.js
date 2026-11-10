/**
 * 联合抽取的纯域边界：原文只用于分段/哈希，结构化行严格校验后编译为三层事实。
 * 无模型、存储或宿主依赖；不经过旧 normalizeExtraction 的条数/字数裁剪。
 */
import { segmentText } from '../../domain/segment.js'
import { sha1Hex, stableEntryId } from '../../domain/stableId.js'
import { validateFactEntry } from '../../domain/schema.js'
import { CAST_ROLE_TIERS, FACT_SCHEMA, WORLDVIEW_SLOT_NAMES } from '../../domain/vocabulary.js'

export const EXTRACTION_CHAIN_VERSION = 'fact-chain/v1'

const textSchema = { type: 'string' }
const nonempty = { type: 'string', minLength: 1, pattern: '\\S' }
const strings = { type: 'array', items: textSchema }
const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: 'object', additionalProperties: false, properties, required
})

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child)
    Object.freeze(value)
  }
  return value
}

/** 可直接作为 submit 的 rows.items；protagonist 允许缺目标，另两档遵循 analyze 硬校验。 */
export const EXTRACTION_ROW_SCHEMA = freezeTree(objectSchema({
  segmentId: nonempty,
  who: strings,
  when: objectSchema({
    story_time: textSchema,
    timeline: { type: 'string', enum: ['顺叙', '倒叙', '插叙', '未明示'] }
  }),
  where: textSchema,
  events: {
    type: 'array',
    items: objectSchema({
      who: textSchema,
      channel: { type: 'string', enum: ['do', 'say', 'think', 'feel', 'perceive', 'state', 'event'] },
      content: nonempty
    })
  },
  notes: textSchema,
  characters: {
    type: 'array',
    items: objectSchema({
      name: nonempty,
      aliases: strings,
      identity: textSchema,
      traits: strings,
      speech: strings,
      behavior: strings,
      castRole: {
        anyOf: [
          objectSchema({
            tier: { type: 'string', enum: [CAST_ROLE_TIERS[0]] },
            goal: textSchema,
            plotFunction: textSchema
          }, ['tier']),
          objectSchema({
            tier: { type: 'string', enum: CAST_ROLE_TIERS.filter((tier) => tier !== 'protagonist') },
            goal: nonempty,
            plotFunction: nonempty
          })
        ]
      }
    }, ['name', 'aliases', 'identity', 'traits', 'speech', 'behavior'])
  },
  settings: {
    type: 'array',
    // 只 name/slot/definition 必填：constraints 是可选补强（给了 gate 才能机判，不给不判失败）。
    items: objectSchema({
      name: nonempty,
      slot: { type: 'string', enum: [...WORLDVIEW_SLOT_NAMES] },
      definition: nonempty,
      aliases: strings,
      /**
       * 结构化约束（可选）：rules／events 槽位的条目给了就能被 gate 机判（否则进 undecidable）。
       * 形状 [{key, value}]——key 是「约束的是什么」（如「钟声次数」「封印期限」），
       * value 是约束值。行 schema 只认字符串（校验器没有联合类型），
       * 数字/布尔请写成 "12" / "true"——落库后由 gate 消费侧按需解释。
       */
      constraints: {
        type: 'array',
        items: objectSchema({ key: nonempty, value: { type: 'string' } }, ['key', 'value'])
      }
    }, ['name', 'slot', 'definition'])
  },
  /** 一轮里一并记录的关系/知情/伏笔：都是可选，模型愿意给就给，不给不判失败。 */
  relations: {
    type: 'array',
    items: objectSchema({ from: nonempty, to: nonempty, type: nonempty, how: textSchema })
  },
  knowledge: {
    type: 'array',
    items: objectSchema({ character: nonempty, learned: nonempty })
  },
  hooks: strings
}, ['segmentId', 'who', 'when', 'where', 'events', 'notes', 'characters', 'settings']))

/** 名称规范化：全角 ASCII→半角、空白归一、去首尾引号；不做同义改写，只抹表示层噪音。 */
export function normalizeName(value) {
  // 全角 ASCII（U+FF01–U+FF5E）与全角空格（U+3000）按码点归一，避免正则里出现不规则空白字面量。
  let text = ''
  for (const ch of String(value ?? '')) {
    const code = ch.codePointAt(0)
    if (code >= 0xFF01 && code <= 0xFF5E) text += String.fromCharCode(code - 0xFEE0)
    else if (code === 0x3000) text += ' '
    else text += ch
  }
  return text.replace(/\s+/gu, ' ').trim().replace(/^[「『“"']/gu, '').replace(/[」』”"']$/gu, '').trim()
}

/** 一轮抽取的映射兜底：槽位只为 other 的条目按名称/别名/定义关键词补标准槽位；不覆盖模型已给的合法槽位。 */
const SLOT_KEYWORDS = Object.freeze([
  ['power_levels', ['等级', '境界', '阶位', '序列', '层次', '品阶']],
  ['abilities', ['能力', '法术', '技能', '仪式', '术法', '秘术']],
  ['rules', ['规则', '机制', '定律', '禁忌', '契约', '法则']],
  ['locations', ['之城', '之界', '街', '巷', '山', '河', '殿', '塔', '楼', '门', '院', '厅', '殿', '窟']],
  ['items', ['之书', '刀', '剑', '符', '令牌', '戒指', '镜', '壶', '灯', '怀表', '卷轴']],
  ['orgs', ['学会', '教团', '议会', '公会', '商会', '帮', '派', '局', '组织']],
  ['roles', ['身份', '职业', '学徒', '骑士', '守夜人', '执事', '祭司']],
  ['creatures', ['之兽', '灵体', '妖', '怪', '种族', '异种']],
  ['events', ['之变', '之夜', '之战', '纪元', '大灾', '事件']]
])

/** 槽位兜底推断：命中即用，未命中保持原值（other 也是合法槽位，不强行编造）。 */
export function inferSlot(item = {}) {
  const given = String(item.slot ?? '')
  if (given && given !== 'other' && WORLDVIEW_SLOT_NAMES.includes(given)) return given
  const hay = [item.name, ...(Array.isArray(item.aliases) ? item.aliases : []), item.definition ?? ''].join(' ')
  for (const [slot, words] of SLOT_KEYWORDS) {
    if (words.some((word) => hay.includes(word))) return slot
  }
  return given || 'other'
}

const positiveInteger = { type: 'integer', minimum: 1 }
const hashSchema = { type: 'string', pattern: '^[0-9a-f]{40}$' }
const segmentSchema = objectSchema({ id: nonempty, index: positiveInteger, chars: positiveInteger, hash: hashSchema })
const sourceSchema = objectSchema({
  id: nonempty, chapterNo: positiveInteger, hash: hashSchema,
  segments: { type: 'array', minItems: 1, items: segmentSchema }
})
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const issue = (details, field, message) => details.push({ field, message })

/** 只接受 JSON 数据；拒绝特殊键、非普通原型、访问器及数组附加属性，不执行 getter。 */
function checkContainer(value, field, details, array = false) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) !== array) {
    issue(details, field, array ? '必须是数组' : '必须是对象')
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    issue(details, field, '必须是普通 JSON 数据，禁止自定义原型')
    return false
  }
  let valid = true
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || forbiddenKeys.has(key)
      || !descriptor.enumerable || !own(descriptor, 'value')
      || (array && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length))) {
      issue(details, `${field}.${String(key)}`, '禁止特殊键、访问器或非 JSON 属性')
      valid = false
    }
  }
  return valid
}

/** 本模块所用 JSON schema 子集的明确校验；只克隆合法数据，不强转、不删未知字段。 */
function validateShape(value, schema, field, details) {
  if (schema.anyOf) {
    const failures = []
    for (const candidate of schema.anyOf) {
      const errors = []
      const normalized = validateShape(value, candidate, field, errors)
      if (!errors.length) return normalized
      failures.push(errors)
    }
    issue(details, field, 'castRole 不符合 analyze 规则：supporting/minor 必须有非空 goal 和 plotFunction')
    for (const errors of failures) for (const error of errors) details.push(error)
    return undefined
  }
  if (schema.type === 'object') {
    if (!checkContainer(value, field, details)) return undefined
    const out = {}
    for (const key of Object.keys(value)) {
      if (!own(schema.properties, key)) issue(details, `${field}.${key}`, '未知字段')
    }
    for (const key of schema.required) {
      if (!own(value, key)) issue(details, `${field}.${key}`, '缺少必填字段')
    }
    for (const [key, rule] of Object.entries(schema.properties)) {
      if (own(value, key)) out[key] = validateShape(value[key], rule, `${field}.${key}`, details)
    }
    return out
  }
  if (schema.type === 'array') {
    if (!checkContainer(value, field, details, true)) return undefined
    if (schema.minItems && value.length < schema.minItems) issue(details, field, '数组不能为空')
    const out = []
    for (let index = 0; index < value.length; index += 1) {
      if (!own(value, index)) issue(details, `${field}[${index}]`, '数组不能有空洞')
      else out.push(validateShape(value[index], schema.items, `${field}[${index}]`, details))
    }
    return out
  }
  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum) issue(details, field, '必须是正安全整数')
  } else if (typeof value !== 'string') {
    issue(details, field, '必须是字符串')
  } else {
    if (schema.minLength && Array.from(value).length < schema.minLength) issue(details, field, '字符串不能为空')
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) issue(details, field, '字符串格式不合法或仅含空白')
    if (schema.enum && !schema.enum.includes(value)) issue(details, field, `必须为 ${schema.enum.join('|')}`)
  }
  // 字符串原样保留：不做大小写/NFC/长度归一，也不把两个不同的名称合并。
  return value
}

function fail(code, message, details) {
  throw Object.assign(new Error(message), { code, details })
}

function segmentId(sourceId, index, hash) {
  return `${sha1Hex(sourceId).slice(0, 10)}:${index}:${hash.slice(0, 8)}`
}

export function buildExtractionSource(input = {}) {
  const details = []
  validateShape(input, objectSchema({ id: nonempty, text: nonempty, chapterNo: positiveInteger }), 'source', details)
  if (details.length) fail('INVALID_INPUT', '抽取来源无效', details)
  const { id, text, chapterNo } = input
  return {
    id,
    chapterNo,
    hash: sha1Hex(text), // 整份输入的精确哈希，包含原始换行/空白。
    segments: segmentText(text).map((segment) => {
      const hash = sha1Hex(segment.text)
      return { id: segmentId(id, segment.index, hash), index: segment.index, chars: segment.chars, hash }
    })
  }
}

export function validateExtractionRows(rows, segments) {
  const details = []
  const known = validateShape(segments, { type: 'array', items: segmentSchema }, 'segments', details)
  const value = validateShape(rows, { type: 'array', items: EXTRACTION_ROW_SCHEMA }, 'rows', details)
  if (!details.length) {
    const ids = new Set()
    for (const segment of known) {
      if (ids.has(segment.id)) issue(details, 'segments', `重复段标识：${segment.id}`)
      ids.add(segment.id)
    }
    const seen = new Set()
    value.forEach((row, index) => {
      const field = `rows[${index}]`
      if (!ids.has(row.segmentId)) issue(details, `${field}.segmentId`, `未知段：${row.segmentId}`)
      if (seen.has(row.segmentId)) issue(details, `${field}.segmentId`, `重复段：${row.segmentId}`)
      seen.add(row.segmentId)
      for (const [key, identity] of [
        ['characters', (item) => item.name],
        ['settings', (item) => JSON.stringify([item.slot, item.name])]
      ]) {
        const names = new Set()
        row[key].forEach((item, position) => {
          const name = identity(item)
          if (names.has(name)) issue(details, `${field}.${key}[${position}]`, '行内重复名称/槽位')
          names.add(name)
        })
      }
    })
  }
  return details.length
    ? { ok: false, error: { code: 'INVALID_EXTRACTION', message: '抽取行校验失败', details } }
    : { ok: true, value }
}

const unique = (values) => [...new Set(values)]
const joined = (values) => unique(values).filter((value) => value !== '').join('\n')
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0
const references = (evidence) => evidence.map(({ source, segment }) => ({
  sourceId: source.id, segmentId: segment.id, quote_hash: segment.hash
}))

function envelope(layer, name, evidence, context, slot = '') {
  const refs = references(evidence)
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer, domain: context.domain, slot, name }),
    layer,
    name,
    domain: context.domain,
    status: layer === 'plot' ? 'draft' : 'proposed',
    ...(slot ? { slot } : {}),
    sources: refs,
    provenance: {
      mode: 'analyze',
      book: context.book,
      book_id: context.bookId,
      chapters: unique(evidence.map(({ source }) => source.chapterNo)).sort((a, b) => a - b),
      scenes: [],
      extractor: EXTRACTION_CHAIN_VERSION,
      // 多段聚合哈希标识有序出处清单；每段原文哈希始终完整保留在 sources。
      quote_hash: refs.length === 1 ? refs[0].quote_hash : sha1Hex(JSON.stringify(refs))
    },
    fingerprint: {
      vec: null,
      metrics: { sources: refs.length, chars: evidence.reduce((sum, { segment }) => sum + segment.chars, 0) }
    }
  }
}

function compilePlot(row, evidence, context) {
  const { source, segment } = evidence
  const name = `第${source.chapterNo}章·${source.id}·段${segment.index}`
  const entry = envelope('plot', name, [evidence], context)
  const plot = {
    ...entry,
    who: [...row.who],
    when: { ...row.when },
    where: row.where,
    notes: row.notes,
    fact: [...row.events.map((event) => `${event.who ? `${event.who}：` : ''}[${event.channel}] ${event.content}`), row.notes]
      .filter((value) => value !== '').join('\n'),
    events: row.events.map((event, index) => ({
      ...event,
      index: index + 1,
      track: 'fact',
      title: event.content,
      refs: event.who ? [event.who] : [...row.who],
      segments: [{ index: segment.index, chars: segment.chars }],
      novelty: []
    })),
    validity: { from: source.chapterNo, to: source.chapterNo }
  }
  const hooks = unique((row.hooks ?? []).map((text) => String(text ?? '').trim()).filter(Boolean))
  if (hooks.length) plot.hooks = hooks
  return plot
}

function compileCharacter(name, records, context, warnings, extras = {}) {
  const entry = envelope('character', name, records.map((record) => record.evidence), context)
  const profiles = records.map((record) => record.item)
  entry.aliases = unique(profiles.flatMap((item) => (item.aliases ?? []).map((alias) => normalizeName(alias)))).filter((alias) => alias && alias !== name)
  // 一轮里记录的关系/知情直接落到人物条目；同一行重复的按 to+type 去重，不合并冲突主张。
  const related = (extras.relations ?? []).filter((item) => item.from === name || item.to === name)
  if (related.length) {
    const seen = new Set()
    entry.relations = related.filter((item) => {
      const key = `${item.from}|${item.to}|${item.type}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).map((item) => ({ to: item.to, type: item.type, how: item.how }))
  }
  const known = (extras.knowledge ?? []).filter((item) => item.character === name)
  if (known.length) {
    const seen = new Set()
    entry.knowledge = known.filter((item) => {
      const key = `${item.learned}|${item.evidence.source.chapterNo}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).map((item) => ({
      fromEntry: item.learned,
      kind: 'event',
      atSpan: { from: item.evidence.source.chapterNo, to: item.evidence.source.chapterNo }
    }))
  }
  entry.identity = joined(profiles.map((item) => item.identity))
  entry.traits = unique(profiles.flatMap((item) => item.traits))
  entry.personality = joined(entry.traits)
  entry.anchors = {
    speech: unique(profiles.flatMap((item) => item.speech)),
    behavior: unique(profiles.flatMap((item) => item.behavior))
  }
  const roles = new Map()
  for (const { item, evidence } of records) {
    if (!item.castRole) continue
    const tier = item.castRole.tier
    if (!roles.has(tier)) roles.set(tier, [])
    roles.get(tier).push({ role: item.castRole, evidence })
  }
  const castRoles = [...roles].map(([tier, list]) => ({
    tier,
    goal: joined(list.map(({ role }) => role.goal ?? '')),
    plotFunction: joined(list.map(({ role }) => role.plotFunction ?? '')),
    sources: references(list.map((record) => record.evidence))
  }))
  if (castRoles.length === 1) {
    const { tier, goal, plotFunction } = castRoles[0]
    entry.castRole = { tier, goal, plotFunction }
  } else if (castRoles.length > 1) {
    // tier 不能串联为非法枚举，也不能替作者裁定；保留全部带出处版本，省略单值断言。
    entry.castRoles = castRoles
    warnings.push({ code: 'CAST_ROLE_CONFLICT', entryId: entry.id, message: '同名人物有不同 tier，已保留 castRoles，未裁定单值 castRole' })
  }
  return entry
}

function compileSetting(records, context, warnings) {
  const name = normalizeName(records[0].item.name)
  const slot = inferSlot(records[0].item)
  const entry = envelope('worldview', name, records.map((record) => record.evidence), context, slot)
  entry.aliases = unique(records.flatMap(({ item }) => (item.aliases ?? []).map((alias) => normalizeName(alias)))).filter((alias) => alias && alias !== name)
  entry.definitions = unique(records.map(({ item }) => item.definition))
  entry.definition = entry.definitions.join('\n')
  if (entry.definitions.length > 1) {
    warnings.push({ code: 'DEFINITION_VARIANTS', entryId: entry.id, name, slot, message: '同名设定的定义存在差异，全部保留，未判定覆盖或矛盾' })
  }
  // 结构化约束（可选）：模型给了就落进 entry.constraint，使 gate 能机判这条规则；
  // 不给就保持自由文本（那条会进 undecidable，如实记账——不猜语义）。
  const constraints = collectConstraints(records)
  if (constraints.length) entry.constraint = constraints
  // rank 并非必填；不把出现次序伪装为等级事实。真实 schema 会给缺 rank 告警。
  return entry
}

/**
 * 汇总一组同名设定记录里的结构化约束：按 key 去重（同 key 取第一条，冲突如实告警）。
 * 形状对齐 gate 的 structuredConstraintsOf：`{key, value}`。
 */
function collectConstraints(records) {
  const byKey = new Map()
  for (const { item } of records) {
    for (const raw of Array.isArray(item?.constraints) ? item.constraints : []) {
      if (!raw || typeof raw !== 'object') continue
      const key = String(raw.key ?? '').trim()
      if (!key || byKey.has(key)) continue
      byKey.set(key, { key, value: Object.prototype.hasOwnProperty.call(raw, 'value') ? raw.value : null })
    }
  }
  return [...byKey.values()]
}

function warnAliases(entries, warnings) {
  const tokens = new Map()
  for (const entry of entries) {
    for (const token of unique([entry.name, ...entry.aliases])) {
      if (!token.trim()) continue
      if (!tokens.has(token)) tokens.set(token, [])
      tokens.get(token).push({ entryId: entry.id, alias: entry.aliases.includes(token) })
    }
  }
  for (const [alias, matches] of tokens) {
    if (matches.length > 1 && matches.some((match) => match.alias)) {
      warnings.push({ code: 'ALIAS_AMBIGUITY', alias, entryIds: matches.map((match) => match.entryId), message: '别名指向多个实体，仅告警，不合并' })
    }
  }
}

/** 编译失败抛带 code/details 的错误；绝不返回部分成功或跳过非法条目。 */
export function compileExtractionEntries({ sources, rows, domain = '', book = '', bookId = '' } = {}) {
  const details = []
  const normalizedSources = validateShape(sources, { type: 'array', items: sourceSchema }, 'sources', details)
  const context = validateShape({ domain, book, bookId }, objectSchema({ domain: textSchema, book: textSchema, bookId: textSchema }), 'context', details)
  if (details.length) fail('INVALID_INPUT', '抽取编译输入无效', details)

  const bySegment = new Map()
  const sourceIds = new Set()
  const orderedSources = [...normalizedSources].sort((a, b) => a.chapterNo - b.chapterNo || compareText(a.id, b.id))
  for (const source of orderedSources) {
    if (sourceIds.has(source.id)) issue(details, 'sources', `重复来源：${source.id}`)
    sourceIds.add(source.id)
    const indices = new Set()
    for (const segment of [...source.segments].sort((a, b) => a.index - b.index)) {
      if (indices.has(segment.index)) issue(details, 'sources.segments', `来源内重复序号：${source.id}/${segment.index}`)
      indices.add(segment.index)
      if (segment.id !== segmentId(source.id, segment.index, segment.hash)) issue(details, 'sources.segments', `段标识与来源/哈希不符：${segment.id}`)
      if (bySegment.has(segment.id)) issue(details, 'sources.segments', `重复段：${segment.id}`)
      bySegment.set(segment.id, { source, segment })
    }
  }
  if (details.length) fail('INVALID_INPUT', '抽取来源标识无效', details)
  const validation = validateExtractionRows(rows, [...bySegment.values()].map(({ segment }) => segment))
  if (!validation.ok) fail(validation.error.code, validation.error.message, validation.error.details)

  const rowMap = new Map(validation.value.map((row) => [row.segmentId, row]))
  const plots = []
  const characters = new Map()
  const settings = new Map()
  const warnings = []
  const relations = []
  const knowledge = []
  for (const [id, evidence] of bySegment) {
    const row = rowMap.get(id)
    if (!row) continue // 部分提交合法；覆盖率由外层链负责。
    plots.push(compilePlot(row, evidence, context))
    for (const item of row.relations ?? []) {
      relations.push({ from: normalizeName(item.from), to: normalizeName(item.to), type: item.type, how: item.how ?? '', evidence })
    }
    for (const item of row.knowledge ?? []) {
      knowledge.push({ character: normalizeName(item.character), learned: normalizeName(item.learned), evidence })
    }
    for (const [items, target, keyOf] of [
      [row.characters, characters, (item) => normalizeName(item.name)],
      [row.settings, settings, (item) => JSON.stringify([inferSlot(item), normalizeName(item.name)])]
    ]) {
      for (const item of items) {
        const key = keyOf(item)
        if (!key || key === '""') continue
        if (!target.has(key)) target.set(key, [])
        target.get(key).push({ item, evidence })
      }
    }
  }
  const entities = [
    ...[...characters].map(([name, records]) => compileCharacter(name, records, context, warnings, { relations, knowledge })),
    ...[...settings.values()].map((records) => compileSetting(records, context, warnings))
  ]
  warnAliases(entities, warnings)
  const entries = [...plots, ...entities]
  const entryIds = new Set()
  for (const entry of entries) {
    if (entryIds.has(entry.id)) issue(details, 'entries.id', `稳定 ID 碰撞：${entry.id}`)
    entryIds.add(entry.id)
    const result = validateFactEntry(entry)
    for (const error of result.errors) details.push({ entryId: entry.id, ...error })
    for (const warning of result.warnings) warnings.push({ entryId: entry.id, ...warning })
  }
  if (details.length) fail('INVALID_EXTRACTION', '编译结果不符合 fact.data/v2', details)
  return { entries, warnings, index: buildIndex(entries) }
}

/** 基础索引：名/别名/槽位/层 → 条目 ID。只留查得到的索引，不做第二份内容副本。 */
export function buildIndex(entries) {
  const byName = {}
  const byAlias = {}
  const bySlot = {}
  const byLayer = {}
  for (const entry of entries) {
    byName[entry.name] = entry.id
    byLayer[entry.layer] = (byLayer[entry.layer] ?? 0) + 1
    if (entry.layer === 'worldview' && entry.slot) (bySlot[entry.slot] ??= []).push(entry.id)
    for (const alias of entry.aliases ?? []) {
      const token = normalizeName(alias)
      if (!token || token === entry.name) continue
      ;(byAlias[token] ??= []).push(entry.id)
    }
  }
  return { entries: entries.length, byLayer, bySlot, byName, byAlias }
}
