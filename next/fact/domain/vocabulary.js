/**
 * fact.data/v2 版本化词汇表（domain 真源，Core 平移件）。
 *
 * 规范唯一来源：`pedia-v2-adr-final.md`（2026-11-09 作者裁定）。
 * v1 来源：NovelPedia 的 `src/pedia_schema.json`（commit eb4f140…，允许入仓）。
 *
 * 这里只放「词与枚举」以及由词表直接派生的纯函数；校验器在 ./schema.js，
 * 状态机在 ./status.js，双时间轴在 ./validity.js，视角校验在 ./perspective.js。
 */

import { sha1Hex } from './stableId.js'

export const FACT_SCHEMA = 'fact.data/v2'

export const FACT_SOURCE = Object.freeze({
  repository: 'NovelPedia (pedia/v1 vendored) + pinax pedia-v2 ADR',
  file: 'src/pedia_schema.json → pedia-v2-adr-final.md',
  commit: 'eb4f14018a61153023d32aed3679c1bb2682f336',
  schema: FACT_SCHEMA,
  updated: '2026-11-09'
})

/** 三层对齐口径；style 已解耦，不在 FACT_LAYERS 里（见 ADR S1）。 */
export const FACT_LAYERS = Object.freeze({
  worldview: Object.freeze({
    align: 'hard',
    desc: '世界观设定层：跨书可借鉴度最高，必须落 domain + slot（有序槽位才有 rank）。',
    required: Object.freeze(['name', 'domain', 'slot', 'definition', 'provenance']),
    optional: Object.freeze(['rank', 'aliases', 'relations', 'stats', 'fingerprint', 'votes', 'readerCognition', 'validity', 'status'])
  }),
  character: Object.freeze({
    align: 'soft',
    desc: '人物层：不强行统一结构，只要求可比较的 fingerprint；塑造字段与知情矩阵按需补齐。',
    required: Object.freeze(['name', 'provenance', 'fingerprint']),
    optional: Object.freeze([
      'identity', 'personality', 'trajectory', 'relations', 'stats', 'aliases',
      'anchors', 'memoryPoints', 'castRole', 'knowledge', 'validity', 'status'
    ])
  }),
  plot: Object.freeze({
    align: 'soft',
    desc: '剧情层：不强行统一结构，只要求事件序列 + 向量；节奏规格与结构模板挂在层上。',
    required: Object.freeze(['provenance', 'fingerprint']),
    optional: Object.freeze([
      'fact', 'hypothesis', 'events', 'span', 'rhythmSpec', 'structureTemplates',
      'readerCognition', 'validity', 'status'
    ])
  })
})

/** 11 个标准世界观槽位；ordered=true 的槽位才有 rank。 */
export const WORLDVIEW_SLOTS = Object.freeze({
  power_levels: Object.freeze({ ordered: true, desc: '力量等级序列（从弱到强）' }),
  abilities: Object.freeze({ ordered: false, desc: '技能/法术/仪式/能力' }),
  rules: Object.freeze({ ordered: false, desc: '规则/机制/试炼/评分/游戏系统' }),
  locations: Object.freeze({ ordered: false, desc: '地点/场景/疆域' }),
  items: Object.freeze({ ordered: false, desc: '物品/道具/装备/材料' }),
  orgs: Object.freeze({ ordered: false, desc: '组织/势力/机构' }),
  roles: Object.freeze({ ordered: false, desc: '身份/职业/群体称谓' }),
  creatures: Object.freeze({ ordered: false, desc: '种族/生物/怪物' }),
  concepts: Object.freeze({ ordered: false, desc: '世界观概念/现象/信息' }),
  events: Object.freeze({ ordered: false, desc: '历史事件/大事件' }),
  other: Object.freeze({ ordered: false, desc: '无法归入上述槽位（应尽可能少）' })
})

export const WORLDVIEW_SLOT_NAMES = Object.freeze(Object.keys(WORLDVIEW_SLOTS))
export const OTHER_SLOT = 'other'

/*
 * 〔S1 文风解耦〕v1 里「剧作·」前缀条目曾落 style 层、slot=creative_rules。
 * v2 起 hub 主条目不再携带 style 层：这类条目由 convert 改投文风能力包
 * （./packs/novel-style.mjs），creative_rules 只是能力包内的分组键，不进 worldview 槽位词表。
 */

/** settings_graph.category → 标准槽位（规范原文的 34→11 归并表，逐条搬运）。 */
export const CATEGORY_MAP = Object.freeze({
  力量体系: 'power_levels',
  等级: 'power_levels',
  境界: 'power_levels',
  技能: 'abilities',
  法术: 'abilities',
  仪式: 'abilities',
  能力: 'abilities',
  行为体系: 'abilities',
  规则: 'rules',
  试炼: 'rules',
  特殊试炼: 'rules',
  特殊试练: 'rules',
  评分体系: 'rules',
  游戏系统: 'rules',
  策略: 'rules',
  地点: 'locations',
  场所: 'locations',
  物品: 'items',
  道具: 'items',
  装备: 'items',
  材料: 'items',
  物品来源: 'items',
  组织: 'orgs',
  势力: 'orgs',
  角色: 'roles',
  职业: 'roles',
  人物: 'roles',
  人物群体: 'roles',
  角色类型: 'roles',
  历史人物: 'roles',
  人际关系: 'roles',
  专业: 'roles',
  生物: 'creatures',
  种族: 'creatures',
  怪物: 'creatures',
  世界观: 'concepts',
  概念: 'concepts',
  现象: 'concepts',
  信息: 'concepts',
  状态: 'concepts',
  情绪: 'concepts',
  情感: 'concepts',
  命途: 'concepts',
  事件: 'events',
  历史: 'events',
  活动: 'events',
  行为: 'other',
  其他: 'other'
})

/* ---------- 条目信封词表（v2 新增） ---------- */

/** D4：条目级 provenance.mode。analyze＝拆书得来（quote 只存哈希），author＝作者自写。 */
export const PROVENANCE_MODES = Object.freeze(['analyze', 'author'])

/** 条目生命周期状态。 */
export const ENTRY_STATUSES = Object.freeze(['draft', 'proposed', 'adopted', 'superseded'])
export const DEFAULT_ENTRY_STATUS = 'draft'

/**
 * 状态机合法转移（同态转移按幂等放行，不算非法）：
 *   draft      → proposed / superseded
 *   proposed   → adopted / draft / superseded
 *   adopted    → superseded
 *   superseded → （终态）
 */
export const STATUS_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['proposed', 'superseded']),
  proposed: Object.freeze(['adopted', 'draft', 'superseded']),
  adopted: Object.freeze(['superseded']),
  superseded: Object.freeze([])
})

/** plot 事件双轨：事实／假设。 */
export const PLOT_EVENT_TRACKS = Object.freeze(['fact', 'hypothesis'])

/** S2-2 默认节奏窗口（字）与新意标签；可被 plot.rhythmSpec 覆盖。 */
export const RHYTHM_WINDOW_DEFAULTS = Object.freeze([500, 1500, 4500])
export const NOVELTY_TAGS = Object.freeze(['笑', '燃', '泪', '梗'])

export const DEFAULT_RHYTHM_SPEC = Object.freeze({
  windowChars: RHYTHM_WINDOW_DEFAULTS,
  noveltyTags: NOVELTY_TAGS
})

/** S2-1 人物塑造字段词表。 */
export const CHARACTER_ANCHOR_CHANNELS = Object.freeze(['speech', 'behavior', 'catchphrase'])
export const CAST_ROLE_TIERS = Object.freeze(['protagonist', 'supporting', 'minor'])
export const KNOWLEDGE_KINDS = Object.freeze(['event', 'setting'])

/** plot.structureTemplates 的模板种类（beat sheet／节奏／桥段）。 */
export const STRUCTURE_TEMPLATE_KINDS = Object.freeze(['beat-sheet', 'rhythm', 'trope'])

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function isOrderedSlot(slot) {
  return WORLDVIEW_SLOTS[slot]?.ordered === true
}

/** 分类名 → 标准槽位；未知或空分类落 other（规范：应尽可能少）。 */
export function slotForCategory(category) {
  const key = str(category).trim()
  if (!key) return OTHER_SLOT
  return CATEGORY_MAP[key] ?? OTHER_SLOT
}

/* ---------- S2-2 节奏规格 ---------- */

/** 生成一份节奏规格；未给或非法字段回落到默认值（默认：500/1500/4500 字、笑/燃/泪/梗）。 */
export function createRhythmSpec(overrides = {}) {
  const source = isPlainObject(overrides) ? overrides : {}
  const windowChars = Array.isArray(source.windowChars) && source.windowChars.length
    ? [...source.windowChars]
    : [...RHYTHM_WINDOW_DEFAULTS]
  const noveltyTags = Array.isArray(source.noveltyTags) && source.noveltyTags.length
    ? [...source.noveltyTags]
    : [...NOVELTY_TAGS]
  return { windowChars, noveltyTags }
}

/**
 * 结构模板实例化：复制模板并打上实例 id / instanceOf，模板本身不动（可多次实例化）。
 * 模板没有 id 时用名称 + 内容哈希生成稳定实例 id。
 */
export function instantiateStructureTemplate(template, options = {}) {
  if (!isPlainObject(template)) return null
  const sourceId = firstText(template.id, template.name)
  if (!sourceId) return null
  const instanceId = firstText(options.id) || `${sourceId}-inst-${sha1Hex(JSON.stringify(template)).slice(0, 6)}`
  return { ...template, id: instanceId, instanceOf: firstText(template.instanceOf, sourceId) }
}
