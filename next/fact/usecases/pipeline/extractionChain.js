/**
 * 联合抽取的纯域边界：原文只用于分段/哈希，结构化行严格校验后编译为三层事实。
 * 无模型、存储或宿主依赖；不经过旧 normalizeExtraction 的条数/字数裁剪。
 */
// 分桶分段（作者 2026-11-12）：段不跨章；段文本是原文切片，可逐字溯源。
import { segmentText } from '../../domain/segmentBuckets.js'
import { sha1Hex, stableEntryId } from '../../domain/stableId.js'
import { validateFactEntry } from '../../domain/schema.js'
import { createAliasIndex } from '../../domain/aliases.js'
import { CAST_ROLE_TIERS, CATEGORY_MAP, FACT_SCHEMA, OTHER_SLOT, WORLDVIEW_SLOT_NAMES } from '../../domain/vocabulary.js'
import {
  characterSalience, decideCharacter, fieldsForTier,
  normalizeSaliencePolicy, summarizePruning, worldviewSalience
} from './salience.js'
import { isIdentityTitle } from './perspectiveTitles.js'
import { resolveIdentity } from './identityEvolution.js'

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
      /**
       * 本段原文里对该人物的其它称呼（可选）：模型禁止脑内归一——原文叫什么就抄什么进来，
       * 跨名合并由工具侧别名组（aliasIndex）确定性完成，canonical 取最早出现名。
       * 防弱模型归一失败产生「周明瑞/克莱恩」双条目（guimi E1 实测教训）。
       */
      alsoKnownAsInSource: strings,
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
      // 模型天然给中文分类名（「物品」「现象」「地点」）——枚举必须同时接受中文分类名与标准槽位，
      // 否则整段作废（guimi 真模型实测：21/22 段全因 slot 是中文被拒，模型输出质量其实很好）。
      // 行 schema **不校验** slot 取值：模型自由造词（「道具设定」「氛围设定」「科技/时代设定」），
      // 穷举枚举只会整段作废（guimi 真模型实测：273 次 slot 报错 = 110/115 段全灭）。
      // 归一是 inferSlot 的职责：标准槽位原样用、中文分类走 CATEGORY_MAP、其余关键词兜底到 other。
      slot: nonempty,
      definition: nonempty,
      aliases: strings,
      /**
       * 结构化约束（可选）：rules／events 槽位的条目给了就能被 gate 机判（否则进 undecidable）。
       * 形状 [{key, value, scope?}]——key 是「约束的是什么」（如「钟声次数」「封印期限」），
       * value 是约束值（string/number/boolean/null 均可——校验器已支持联合类型）。
       * scope 默认 'entry'（约束只描述本条目，gate 不跨条目比对）；跨条目对齐需显式 scope:'world'。
       * 防通用词 key（「例外」「条件」）在不同规则间被误判成同一世界变量（guimi E3 实测误报）。
       */
      constraints: {
        type: 'array',
        items: objectSchema({
          key: nonempty,
          value: { type: ['string', 'number', 'boolean', 'null'] },
          scope: { type: 'string', enum: ['entry', 'world'] }
        }, ['key', 'value'])
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
    // source（可选）＝知情来源的实体/物件名（可索引，进 fromEntry）；缺省时回落用 learned 兼容旧形状。
    // learned 永远是一句话语义——两字段分开，不再逼模型在「可索引的名」与「完整语义」之间二选一（guimi E5）。
    items: objectSchema({ character: nonempty, source: nonempty, learned: nonempty }, ['character', 'learned'])
  },
  hooks: strings
}, ['segmentId', 'who', 'when', 'where', 'events', 'notes', 'characters', 'settings']))

/**
 * 行字段名归一（P-LLM 调优）：模型在长输出里会漂移成中文/近义键名（实测同一数组第一条 definition、
 * 第二条「定义」）。这属于表示层噪音，与「名称规范化」同一性质——在入口抹平，不进 schema 校验。
 * 只做同义替换，不改结构、不补内容（缺的字段照旧报错，不猜）。
 */
const KEY_ALIASES = Object.freeze({
  定义: 'definition', 描述: 'definition', 说明: 'definition',
  名称: 'name', 名字: 'name', 别名: 'aliases',
  身份: 'identity', 特质: 'traits', 性格: 'traits',
  言语: 'speech', 台词: 'speech', 行为: 'behavior', 动作: 'behavior',
  内容: 'content', 渠道: 'channel', 角色: 'who', 类型: 'type',
  时间: 'when', 地点: 'where', 事件: 'events', 笔记: 'notes', 备注: 'notes',
  人物: 'characters', 设定: 'settings', 关系: 'relations', 知情: 'knowledge',
  伏笔: 'hooks', 作用: 'type', 来源: 'source', 学到: 'learned',
  塑造目标: 'goal', 剧情作用: 'plotFunction', 档位: 'tier',
  从: 'from', 到: 'to', 如何: 'how', 槽位: 'slot', 为什么: 'how'
})

/**
 * 行级宽容归一（P-LLM 调优第二层）：把「语义合法但形式不合契约」的常见形态抹平，
 * 只做**无损**变换（不编内容、不猜语义），让模型的可信产出不被形式问题整段作废。
 *
 * 三条（全部实测高频）：
 *   1) 行内重复角色：同一段里同一角色出现两次（模型常先写概览再补细节）→ 合并成一条，
 *      数组字段并集去重、标量取首个非空；
 *   2) 角色数组里混入字符串（`characters: ["周明瑞"]`）→ 包成 `{name, aliases:[], ...}` 最小形状；
 *   3) `relations[].content` 这类常见误键 → 已有 KEY_ALIASES 覆盖，这里再兜「未知键整体降级进 how」。
 */
export function normalizeRowShapes(row) {
  if (!row || typeof row !== 'object') return row
  // 与 normalizeRowKeys 同款安全前置：自定义原型/访问器/特殊键一律原样返回，
  // 交回校验如实拒——`{...row}` 会把原型抹平、把 getter 求值，等于绕过两道安全闸。
  const proto = Object.getPrototypeOf(row)
  if (proto !== Object.prototype && proto !== null) return row
  for (const key of Reflect.ownKeys(row)) {
    if (typeof key !== 'string') return row
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return row
    const descriptor = Object.getOwnPropertyDescriptor(row, key)
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return row
  }
  const out = { ...row }
  if (Array.isArray(row.characters)) {
    const byName = new Map()
    for (const item of row.characters) {
      // 形态 2：裸字符串 → 最小对象（identity 留空，后续 joined 自然为空，不编内容）
      const character = typeof item === 'string'
        ? { name: item, aliases: [], identity: '', traits: [], speech: [], behavior: [] }
        : item
      if (!character || typeof character !== 'object') continue
      const name = String(character.name ?? '').trim()
      // name 缺失**不能丢**——静默丢一条比报错严重得多（校验要让「缺 name」如实报错）。
      // 用占位键保留原对象，交回 schema 报「name 必填」。
      if (!name) { byName.set(` missing-name-${byName.size}`, character); continue }
      const prior = byName.get(name)
      if (!prior) { byName.set(name, { ...character }); continue }
      // 形态 1：同名合并——数组并集、标量取首个非空
      const merged = { ...prior }
      for (const [key, value] of Object.entries(character)) {
        if (Array.isArray(value)) merged[key] = [...new Set([...(Array.isArray(merged[key]) ? merged[key] : []), ...value])]
        else if (merged[key] === undefined || merged[key] === '' || merged[key] === null) merged[key] = value
      }
      byName.set(name, merged)
    }
    out.characters = [...byName.values()]
  }
  // 形态 3：relations 里只有 content 没有 how → 把 content 当依据，未知键丢弃（它是描述不是数据）
  if (Array.isArray(row.relations)) {
    out.relations = row.relations.filter((item) => item && typeof item === 'object').map((item) => {
      const { content, ...rest } = item
      if (rest.how === undefined && typeof content === 'string' && content.trim()) rest.how = content.trim()
      return rest
    })
  }
  return out
}

/** 递归把对象/数组里的键名按 KEY_ALIASES 归一（值不动；标准键优先，后到的同义键不覆盖）。 */
export function normalizeRowKeys(value, depth = 0) {
  if (depth > 8) return value
  if (Array.isArray(value)) {
    // 数组附加属性（array.extra = ...）也要拦：map 会静默丢掉它们，等于绕过安全闸。
    // 有非下标自有键就整数组原样返回，让 checkContainer 照旧报错。
    // 合法的自有键只有 length 与「数组索引」——索引上限 2^32-2（4294967295 不是索引，是附加属性）
    const MAX_INDEX = 4294967294
    const isIndex = (key) => typeof key === 'string' && /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) <= MAX_INDEX
    if (Reflect.ownKeys(value).some((key) => key !== 'length' && !isIndex(key))) return value
    return value.map((item) => normalizeRowKeys(item, depth + 1))
  }
  if (!value || typeof value !== 'object') return value
  // 安全闸优先：出现特殊键就**整个对象原样返回**，不做任何归一——
  // 让下游 checkContainer 照旧报「禁止特殊键」。归一绝不能成为绕过安全闸的通道。
  // 用 Reflect.ownKeys + 属性描述符：Object.keys/entries 只看到可枚举自有键，
  // 而 `__proto__` 常以 defineProperty（不可枚举）或访问器形态出现，那时会被静默跳过。
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return value
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return value
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return value
  }
  // 自定义原型同样原样返回（下游 checkContainer 会拒）
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const out = {}
  for (const [key, raw] of Object.entries(value)) {
    const canonical = Object.prototype.hasOwnProperty.call(KEY_ALIASES, key) ? KEY_ALIASES[key] : key
    if (!Object.prototype.hasOwnProperty.call(out, canonical)) {
      out[canonical] = normalizeRowKeys(raw, depth + 1)
    } else if (Array.isArray(out[canonical]) && Array.isArray(raw)) {
      out[canonical] = [...out[canonical], ...normalizeRowKeys(raw, depth + 1)]
    }
    // 标量冲突：标准键优先（先到的保留），同义键的值丢弃——不猜谁对
  }
  return out
}

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
  const given = String(item.slot ?? '').trim()
  // 1) 已是标准槽位 → 原样用
  if (given && given !== OTHER_SLOT && WORLDVIEW_SLOT_NAMES.includes(given)) return given
  // 2) 中文分类名 → 走 CATEGORY_MAP 官方 34→11 归并表（模型天然给「物品」「现象」「地点」）
  if (given && CATEGORY_MAP[given]) return CATEGORY_MAP[given]
  // 3) 关键词兜底（按名称/别名/定义推断）
  const hay = [item.name, ...(Array.isArray(item.aliases) ? item.aliases : []), item.definition ?? ''].join(' ')
  for (const [slot, words] of SLOT_KEYWORDS) {
    if (words.some((word) => hay.includes(word))) return slot
  }
  // 4) 都归不出 → other（**不能返回原词**：fact.data/v2 的 slot 是闭集枚举，
  //    原词（「道具设定」「氛围设定」）会让 validateFactEntry 报 UNKNOWN_SLOT 整条作废）
  return OTHER_SLOT
}

const positiveInteger = { type: 'integer', minimum: 1 }
const hashSchema = { type: 'string', pattern: '^[0-9a-f]{40}$' }
const segmentSchema = objectSchema({ id: nonempty, index: positiveInteger, chars: positiveInteger, hash: hashSchema, chapterNo: positiveInteger }, ['id', 'index', 'chars', 'hash'])
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

/** 单类型匹配（联合类型的分母）；只支持标量叶子——object/array 联合没法带分支 schema 深校验，明确拒绝。 */
function matchesScalarType(value, type) {
  if (type === 'string') return typeof value === 'string'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'integer') return Number.isSafeInteger(value)
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'null') return value === null
  return false
}

/** 本模块所用 JSON schema 子集的明确校验；只克隆合法数据，不强转、不删未知字段。 */
function validateShape(value, schema, field, details) {
  // 联合类型（仅标量叶子）：任一分支匹配即通过，值原样保留（不做跨分支归一）。
  if (Array.isArray(schema.type)) {
    if (schema.type.some((type) => type === 'object' || type === 'array')) {
      issue(details, field, '联合类型只支持标量叶子（string/number/integer/boolean/null）')
      return value
    }
    if (!schema.type.some((type) => matchesScalarType(value, type))) {
      issue(details, field, `必须为 ${schema.type.join('|')} 之一`)
    }
    return value
  }
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

/**
 * 从来源 id 解析章号（X7）：优先「第N章」；其次 basename 的 3 位零填充前导段
 * （仓内章节文件契约 `NNN-标题.md`，'001-绯红.md' → 1）。合成名（'甲.txt'/'正文/1.txt'）
 * 与中文数字（'第一章'）解析不出 → null，调用方不比对——文件名没有章号是合法形态。
 */
export function parseChapterNoFromId(id) {
  const text = String(id ?? '')
  const chapterMark = /第\s*(\d{1,4})\s*章/u.exec(text)
  if (chapterMark) return Number(chapterMark[1])
  const basename = text.split('/').pop() ?? ''
  const padded = /^(\d{3})(?!\d)/u.exec(basename)
  return padded ? Number(padded[1]) : null
}

export function buildExtractionSource(input = {}) {
  const details = []
  validateShape(input, objectSchema({
    id: nonempty, text: nonempty, chapterNo: positiveInteger,
    // 分段档位（可选）：min/max 覆盖 100–300 默认。段 id 由分段结果算出，所以档位一旦定下不随 run 变。
    segment: objectSchema({ min: positiveInteger, max: positiveInteger }, [])
  }, ['id', 'text', 'chapterNo']), 'source', details)
  if (details.length) fail('INVALID_INPUT', '抽取来源无效', details)
  const { id, text, chapterNo } = input
  // 分段档位（作者 2026-11-11「不同体裁采集节奏不一样」）：缺省＝100–300。
  // 段 id 由分段结果算出，所以档位必须在建来源时给定且同 run 内不变。
  const segmentLimits = input.segment && typeof input.segment === 'object' ? input.segment : {}
  // X7：文件名能解析出章号时必须与传入值一致——不一致在源头拒，防 validity 静默错位（guimi C2）。
  // 解析不出就不比对：文件名没有章号是合法形态，不逼作者重命名。
  const parsed = parseChapterNoFromId(id)
  if (parsed !== null && parsed !== chapterNo) {
    issue(details, 'chapterNo', `来源「${id}」的文件名解析出章号 ${parsed}，与传入的 ${chapterNo} 不一致`)
  }
  if (details.length) fail('INVALID_INPUT', '抽取来源无效', details)
  return {
    id,
    chapterNo,
    hash: sha1Hex(text), // 整份输入的精确哈希，包含原始换行/空白。
    segments: segmentText(text, segmentLimits).map((segment) => {
      const hash = sha1Hex(segment.text)
      // 段级章号：桶式分段会给每段 chapterNo（章标题行确定）。
      // 保留它，下游 plot 的 validity/provenance.chapters 才不会全塌成 1（真跑撞到：267 段全记第 1 章）。
      const segChapter = Number.isInteger(segment.chapterNo) ? segment.chapterNo : chapterNo
      return { id: segmentId(id, segment.index, hash), index: segment.index, chars: segment.chars, hash, chapterNo: segChapter }
    })
  }
}

export function validateExtractionRows(rows, segments) {
  const details = []
  const known = validateShape(segments, { type: 'array', items: segmentSchema }, 'segments', details)
  // 入口先抹键名漂移（中文/近义键 → schema 键），再进严格校验——表示层噪音不该让整段作废
  // 归一只能作用于「已经是数组」的输入：非数组（null/{}/'[]'/Array(1) 空洞）原样交回，
  // 让校验如实拒——这层绝不能把非法输入洗成合法的空行集（会静默吞掉整个提交）。
  // 数组自身也要查附加属性：map 只产生下标元素，`rows.extra = …` 会被静默丢掉。
  // 有非下标自有键 → 整个数组原样交回，让 checkContainer 照旧报错。
  const rowsArrayClean = Array.isArray(rows) && Reflect.ownKeys(rows).every((key) => (
    key === 'length' || (typeof key === 'string' && /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) <= 4294967294)
  ))
  const normalizedRows = rowsArrayClean
    ? rows.map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? normalizeRowShapes(normalizeRowKeys(row)) : row))
    : rows
  const value = validateShape(normalizedRows, { type: 'array', items: EXTRACTION_ROW_SCHEMA }, 'rows', details)
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

function compilePlot(row, evidence, context, minimal = false) {
  const { source, segment } = evidence
  const name = `第${source.chapterNo}章·${source.id}·段${segment.index}`
  const entry = envelope('plot', name, [evidence], context)
  // X1（guimi A2）：段序号落结构化字段——剧本分集/粒度对齐不再从 name 里正则抠「段N」。
  entry.provenance.segmentIndex = segment.index
  const chapterOf = Number.isInteger(segment.chapterNo) ? segment.chapterNo : source.chapterNo
  const plot = {
    ...entry,
    who: [...row.who],
    when: { ...row.when },
    where: row.where,
    notes: row.notes,
    // v3 瘦编译（minimal）：fact 是 events 的拼接副本，可确定性重建；长篇不必在内存里再存一份。
    ...(minimal ? {} : {
  fact: [...row.events.map((event) => `${event.who ? `${event.who}：` : ''}[${event.channel}] ${event.content}`), row.notes]
  .filter((value) => value !== '').join('\n'),
    }),
    events: row.events.map((event, index) => ({
      ...event,
      index: index + 1,
      track: 'fact',
      ...(minimal ? {} : { title: event.content }),
      refs: event.who ? [event.who] : [...row.who],
      segments: [{ index: segment.index, chars: segment.chars }],
      novelty: []
    })),
    // 章号优先取**段级**（分桶分段按章标题行确定），退回来源级。
    // 旧实现只用 source.chapterNo（恒为 1），导致 38 章的小说全部塌成「第 1 章」（真跑撞到）。
    validity: { from: chapterOf, to: chapterOf }
  }
  const hooks = unique((row.hooks ?? []).map((text) => String(text ?? '').trim()).filter(Boolean))
  if (hooks.length) plot.hooks = hooks
  return plot
}

/** 称谓式关系目标：不是条目名（没有对应条目），图上是断链节点——compile 时如实告警。 */
const TITLE_TARGET = /^.{1,12}的(?:父亲|母亲|爸爸|妈妈|哥哥|弟弟|姐姐|妹妹|兄长|儿子|女儿|老师|师父|师傅|上司|下属|主人|仆人|妻子|丈夫|未婚妻|未婚夫)$/u

function compileCharacter(name, records, context, warnings, extras = {}) {
  const entry = envelope('character', name, records.map((record) => record.evidence), context)
  // 身份演进（作者 2026-11-12）：采集期先到先得，呈现期真名 > 昵称 > 称谓。
  // 若本条目聚合到的名字里存在更高 rank 的（真名压过「男友」这类称谓），
  // 就把显示名换成它，原名字降为别名——**条目 id 不变**，历史引用不断链。
  const occurrences = [
    ...records.map((record) => ({ name: record.item?.name ?? name, isTitle: isIdentityTitle(record.item?.name ?? name) })),
    ...(extras.memberNames ?? []).map((member) => ({ name: member }))
  ].filter((item) => item.name)
  const identity = resolveIdentity(occurrences)
  if (identity.displayName && identity.displayName !== name) {
    entry.aliases = [...new Set([...(entry.aliases ?? []), name])].filter((alias) => alias !== identity.displayName)
    entry.name = identity.displayName
    entry.identityNote = { previousName: name, upgradedBy: 'identity-rank' }
  }
  const profiles = records.map((record) => record.item)
  // X3 跨名合并：组员 surface 名与 alsoKnownAsInSource 全部并入别名（排除 canonical 本名）——
  // 「周明瑞/克莱恩」成一个条目、一个 id，别名组供 aliasIndex 解析与 Track 3 fold 匹配。
  const memberNames = unique((extras.memberNames ?? []).filter((member) => member && member !== name))
  entry.aliases = unique([
    ...profiles.flatMap((item) => (item.aliases ?? []).map((alias) => normalizeName(alias))),
    ...profiles.flatMap((item) => (item.alsoKnownAsInSource ?? []).map((alias) => normalizeName(alias))),
    ...memberNames
  ]).filter((alias) => alias && alias !== name)
  // 一轮里记录的关系/知情直接落到人物条目。
  // X5（guimi E9）：反向边归一为「本条目 → 对方」出边（旧实现丢弃 from 产生自指边）；
  // 自指（from===to）无信息量，丢弃并告警；称谓式目标（「X的父亲」）不是实体名，告警不静默。
  const related = (extras.relations ?? []).filter((item) => item.from === name || item.to === name)
  if (related.length) {
    const seen = new Set()
    const edges = []
    for (const item of related) {
      const other = item.from === name ? item.to : item.from
      if (other === name) {
        warnings.push({ code: 'RELATION_SELF_DROP', entryId: entry.id, name, message: `关系 from/to 都指向「${name}」（自指无信息量），已丢弃` })
        continue
      }
      const key = `${[name, other].slice().sort(compareText).join('|')}|${item.type}`
      if (seen.has(key)) continue
      seen.add(key)
      if (TITLE_TARGET.test(other)) {
        warnings.push({ code: 'RELATION_TITLE_TARGET', entryId: entry.id, to: other, message: `关系目标是称谓（「${other}」），不是条目名——要么抽成独立实体、要么把称谓写进 how 描述` })
      }
      edges.push({ to: other, type: item.type, how: item.how })
    }
    if (edges.length) entry.relations = edges
  }
  // X2（guimi E5）：knowledge 拆双字段——source（实体名，可索引）进 fromEntry；learned（一句话语义）留 note。
  // source 缺省回落 learned（兼容旧行形状）：这时不写 note，免得 note 与 fromEntry 重复。
  const known = (extras.knowledge ?? []).filter((item) => item.character === name)
  if (known.length) {
    const seen = new Set()
    entry.knowledge = known.filter((item) => {
      const key = `${item.source}|${item.learned}|${item.evidence.source.chapterNo}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).map((item) => ({
      fromEntry: item.source || item.learned,
      kind: 'event',
      atSpan: { from: item.evidence.source.chapterNo, to: item.evidence.source.chapterNo },
      ...(item.source && item.learned ? { note: item.learned } : {})
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
 * 形状对齐 gate 的 structuredConstraintsOf：`{key, value, scope}`——scope 缺省 'entry'（X0）。
 */
function collectConstraints(records) {
  const byKey = new Map()
  for (const { item } of records) {
    for (const raw of Array.isArray(item?.constraints) ? item.constraints : []) {
      if (!raw || typeof raw !== 'object') continue
      const key = String(raw.key ?? '').trim()
      if (!key || byKey.has(key)) continue
      byKey.set(key, {
        key,
        value: Object.prototype.hasOwnProperty.call(raw, 'value') ? raw.value : null,
        scope: raw.scope === 'world' ? 'world' : 'entry'
      })
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
export function compileExtractionEntries({ sources, rows, domain = '', book = '', bookId = '', policy = undefined, minimal = false } = {}, options = {}) {
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

  // X3 跨名合并（激进版，作者裁定）：身份联合**只用 alsoKnownAsInSource**——
  // aliases 是检索别名（可多人共享「小柯」），并进去会把素不相识的人并成一组，所以不参与。
  // from/to/character 与分组 key 全部归一到 canonical（组内最早注册名，确定性）。
  // 「周明瑞/克莱恩」在模型显式声明 alsoKnownAsInSource 后一个条目、一个 id——归一不再发生在模型脑子里（guimi E1）。
  const aliasIndex = createAliasIndex()
  for (const [id] of bySegment) {
    const row = rowMap.get(id)
    if (!row) continue
    for (const item of row.characters ?? []) {
      const name = normalizeName(item.name)
      if (!name) continue
      aliasIndex.add(name, (item.alsoKnownAsInSource ?? []).map(normalizeName))
    }
  }
  // 两遍走：先全部注册，再按 surface 名归组（登记序＝bySegment 序，canonical 确定）。
  const memberNames = new Map() // canonical → 本组出现过的 surface 名（按出现序）
  const canon = (value) => aliasIndex.resolve(value) ?? value
  for (const [id] of bySegment) {
    const row = rowMap.get(id)
    if (!row) continue
    for (const item of row.characters ?? []) {
      const surface = normalizeName(item.name)
      if (!surface) continue
      const canonical = canon(surface)
      if (!memberNames.has(canonical)) memberNames.set(canonical, [])
      if (!memberNames.get(canonical).includes(surface)) memberNames.get(canonical).push(surface)
    }
  }

  for (const [id, evidence] of bySegment) {
    const row = rowMap.get(id)
    if (!row) continue // 部分提交合法；覆盖率由外层链负责。
    plots.push(compilePlot(row, evidence, context, minimal))
    for (const item of row.relations ?? []) {
      relations.push({
        from: canon(normalizeName(item.from)),
        to: canon(normalizeName(item.to)),
        type: item.type, how: item.how ?? '', evidence
      })
    }
    for (const item of row.knowledge ?? []) {
      knowledge.push({
        character: canon(normalizeName(item.character)),
        source: canon(normalizeName(item.source ?? '')),
        learned: normalizeName(item.learned),
        evidence
      })
    }
    for (const [items, target, keyOf] of [
      [row.characters, characters, (item) => canon(normalizeName(item.name))],
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
  // 显著度剪枝（T-2 前置件，作者 2026-11-11 裁定）：权重不够的角色**不建条目**——
  // 「经理」这类只被顺口一提、无台词无动作的角色只作为提及名登记（index.mentions），不占世界书。
  // 权重只看可数证据（出场段/台词/动作/跨章/关系/知情/剧作档），阈值从 options.policy 注入，全可配。
  const saliencePolicy = normalizeSaliencePolicy(policy ?? options.policy)
  const pruningDecisions = []
  const prunedNames = []
  const characterRecords = [...characters].map(([name, records]) => {
    const evidence = records.map((record) => record.evidence)
    const chapterSet = new Set(evidence.map(({ source }) => source.chapterNo))
    const tiers = records.map(({ item }) => item?.castRole?.tier).filter(Boolean)
    const castTier = tiers.includes('protagonist') ? 'protagonist' : tiers.includes('supporting') ? 'supporting' : tiers.length ? 'minor' : null
    // 行为通道计数：从本 run 的行里数（同一段内该角色做/说了几次）
    let sayings = 0
    let actings = 0
    let perceivings = 0
    for (const row of validation.value) {
      for (const event of row.events ?? []) {
        if (canon(normalizeName(event.who)) !== name) continue
        if (event.channel === 'say') sayings += 1
        else if (event.channel === 'do') actings += 1
        else if (['see', 'hear', 'feel', 'think', 'perceive', 'state', 'recall'].includes(event.channel)) perceivings += 1
      }
    }
    const salience = characterSalience({
      segments: new Set(evidence.map(({ segment }) => segment.id)).size,
      chapters: chapterSet.size,
      sayings, actings, perceivings,
      relations: relations.filter((edge) => edge.from === name || edge.to === name).length,
      knowledge: knowledge.filter((record) => record.character === name).length,
      castTier
    }, policy)
    const decision = decideCharacter(salience.score, policy)
    pruningDecisions.push({ name, decision: { ...decision, breakdown: salience.breakdown } })
    if (!decision.keep) prunedNames.push(name)
    return { name, records, decision }
  })
  const keptCharacters = characterRecords.filter((item) => item.decision.keep)
  // 剪掉的角色的关系/知情一并剪（否则被剪的名字会以关系目标形态漏进别的条目）
  const prunedSet = new Set(prunedNames)
  const keptRelations = relations.filter((edge) => !prunedSet.has(edge.from) && !prunedSet.has(edge.to))
  const keptKnowledge = knowledge.filter((record) => !prunedSet.has(record.character))

  const entities = [
    ...keptCharacters.map(({ name, records, decision }) => {
      const entry = compileCharacter(name, records, context, warnings, {
        relations: keptRelations, knowledge: keptKnowledge, memberNames: memberNames.get(name) ?? []
      })
      // 深度分层：按档裁剪字段组（minimal 只留身份；brief 砍记忆点/剧作功能/知情；full 全留）
      const allowed = new Set(fieldsForTier(decision.tier))
      for (const key of ['personality', 'traits', 'anchors', 'castRole', 'castRoles', 'knowledge', 'relations', 'memoryPoints']) {
        if (!allowed.has(key) && entry[key] !== undefined) delete entry[key]
      }
      if (decision.tier !== 'full') entry.salienceTier = decision.tier
      return entry
    }),
    ...[...settings.values()].map((records) => {
      const draft = compileSetting(records, context, warnings)
      const definitionChars = typeof draft.definition === 'string' ? draft.definition.length : 0
      const segments = new Set(records.map((record) => record.evidence.segment.id)).size
      return { draft, verdict: worldviewSalience({ definitionChars, segments }, saliencePolicy) }
    }).filter(({ draft, verdict }) => {
      if (verdict.keep) return true
      warnings.push({ code: 'WORLDVIEW_PRUNED', entryId: draft.id, name: draft.name, message: verdict.reason })
      return false
    }).map(({ draft }) => draft)
  ]
  const pruning = summarizePruning(pruningDecisions)
  if (pruning.pruned) {
    warnings.push({
      code: 'SALIENCE_PRUNED',
      count: pruning.pruned,
      names: pruning.prunedNames,
      message: `${pruning.pruned} 个角色显著度低于门槛，未建条目（只作提及名登记）：${pruning.prunedNames.join('、')}`
    })
  }
  // 跨名合并的冲突留痕：同一个称呼被两条不同条目声明为 alias/组员 → union-find 会把两组并成一个，
  // 这是激进版的既定行为，但必须记账（谁和谁被哪个称呼并到一起了），不许静默。
  for (const conflict of aliasIndex.conflicts()) {
    warnings.push({
      code: 'ALIAS_GROUP_CONFLICT',
      term: conflict.term,
      claimants: [...conflict.claimants],
      message: `称呼「${conflict.term}」被多条目声明（${conflict.claimants.join('、')}），跨名合并已将其并为一组——若实为不同人物，请在 alsoKnownAsInSource 里去掉该称呼`
    })
  }
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
  return {
    entries, warnings, pruning,
    index: buildIndex(entries, {
      mentions: prunedNames,
      pruning: { version: saliencePolicy.version, kept: pruning.kept, pruned: pruning.pruned, byTier: pruning.byTier, prunedNames: pruning.prunedNames }
    })
  }
}

/** 基础索引：名/别名/槽位/层 → 条目 ID。只留查得到的索引，不做第二份内容副本。 */
export function buildIndex(entries, options = {}) {
  const byName = {}
  const byAlias = {}
  const bySlot = {}
  const byLayer = {}
  const mentions = {}
  // 剪掉的提及名：名字确实存在过、只是没建条目。引用解析据此区分「悬空（数据错）」与「剪枝（正常）」。
  for (const name of Array.isArray(options.mentions) ? options.mentions : []) {
    const token = normalizeName(name)
    if (token) mentions[token] = 'pruned'
  }
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
  return {
    entries: entries.length, byLayer, bySlot, byName, byAlias,
    ...(Object.keys(mentions).length ? { mentions } : {}),
    ...(options.pruning ? { pruning: options.pruning } : {})
  }
}
