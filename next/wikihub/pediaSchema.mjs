/**
 * pedia/v2 统一数据规范（Next wikihub 垫床实现，语义冻结版）。
 *
 * 规范唯一来源：`D:\Pinax-e2e\wikihub-arch\pedia-v2-adr-final.md`（2026-11-09 作者裁定）。
 * v1 来源：作者自有仓库 NovelPedia 的 `src/pedia_schema.json`（commit eb4f140…，允许入仓）。
 *
 * 相对 v1 的语义变更（逐条对应 ADR）：
 *   - S1：一等公民层只有 worldview（hard）／character（soft）／plot（soft）；style 移出，
 *         改由 `./packs/novel-style.mjs` 文风能力包承载（仅小说体裁生效）。
 *   - 条目信封：provenance.mode（analyze|author）＋ status（draft/proposed/adopted/superseded）
 *         的状态机、validity 双时间轴；analyze 的 quote 只存哈希。
 *   - S2-1：character.anchors／memoryPoints／castRole（supporting/minor 必须 goal+plotFunction）。
 *   - S2-2：plot.rhythmSpec／events[].novelty／structureTemplates。
 *   - S2-3：character.knowledge 知情矩阵＋readerCognition 标记＋ checkPerspective 纯函数。
 *
 * 枢纽约定（沿用 v1）：
 *   - worldview 是 hard 层：name/domain/slot/definition/provenance 必填，只有它参与跨书迁移；
 *   - character/plot 是 soft 层：不强行统一结构，只要求 provenance + fingerprint；
 *   - 稳定 id = sha1(layer|domain|slot|name)[:12]；soft 层没有 slot 时按空串参与哈希；
 *   - category_map 把 34 种自由分类收敛到 11 个标准槽位（未知分类落 other）。
 */

export const PEDIA_SCHEMA = 'pedia/v2'

export const PEDIA_SOURCE = Object.freeze({
  repository: 'NovelPedia (pedia/v1 vendored) + pinax pedia-v2 ADR',
  file: 'src/pedia_schema.json → pedia-v2-adr-final.md',
  commit: 'eb4f14018a61153023d32aed3679c1bb2682f336',
  schema: PEDIA_SCHEMA,
  updated: '2026-11-09'
})

/** 三层对齐口径；style 已解耦，不在 PEDIA_LAYERS 里（见 ADR S1）。 */
export const PEDIA_LAYERS = Object.freeze({
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

/* ---------- 稳定 id：sha1(layer|domain|slot|name)[:12] ---------- */

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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function utf8Bytes(text) {
  return new TextEncoder().encode(text)
}

/**
 * 纯 JS SHA-1（不依赖 node:crypto / Buffer），保证同一函数在 Node 与浏览器侧同值。
 * 只用于稳定 id 与 quote_hash，不做任何安全用途。
 */
export function sha1Hex(input) {
  const bytes = utf8Bytes(str(input))
  const bitLength = bytes.length * 8
  const total = Math.ceil((bytes.length + 9) / 64) * 64
  const data = new Uint8Array(total)
  data.set(bytes)
  data[bytes.length] = 0x80
  const view = new DataView(data.buffer)
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(total - 4, bitLength >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 80; i += 1) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = ((x << 1) | (x >>> 31)) >>> 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let i = 0; i < 80; i += 1) {
      let f
      let k
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const temp = ((((a << 5) | (a >>> 27)) >>> 0) + (f >>> 0) + e + k + w[i]) >>> 0
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  return [h0, h1, h2, h3, h4].map((value) => value.toString(16).padStart(8, '0')).join('')
}

/** 稳定 id：sha1(layer|domain|slot|name)[:12]；soft 层没有 slot 时按空串参与。 */
export function stableEntryId({ layer, domain = '', slot = '', name = '' } = {}) {
  const key = [str(layer), str(domain), str(slot), str(name)].join('|')
  return sha1Hex(key).slice(0, 12)
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

/* ---------- 状态机纯函数 ---------- */

/** 合法转移判定；同状态按幂等放行。 */
export function canTransitionStatus(from, to) {
  const source = str(from)
  const target = str(to)
  if (!ENTRY_STATUSES.includes(source) || !ENTRY_STATUSES.includes(target)) return false
  if (source === target) return true
  return (STATUS_TRANSITIONS[source] ?? []).includes(target)
}

/**
 * 校验一次状态迁移。
 * 返回 { ok, from, to, allowed } 或 { ok:false, code, message, from, to, allowed }。
 */
export function validateStatusTransition(from, to) {
  const source = str(from)
  const target = str(to)
  const allowed = [...(STATUS_TRANSITIONS[source] ?? [])]
  if (!ENTRY_STATUSES.includes(source)) {
    return { ok: false, code: 'UNKNOWN_STATUS', message: `未知状态：${source || '空'}`, from: source, to: target, allowed: [...ENTRY_STATUSES] }
  }
  if (!ENTRY_STATUSES.includes(target)) {
    return { ok: false, code: 'UNKNOWN_STATUS', message: `未知目标状态：${target || '空'}`, from: source, to: target, allowed: [...ENTRY_STATUSES] }
  }
  if (!canTransitionStatus(source, target)) {
    return { ok: false, code: 'ILLEGAL_STATUS_TRANSITION', message: `${source} → ${target} 不是合法转移（允许：${allowed.join('/') || '无'}）`, from: source, to: target, allowed }
  }
  return { ok: true, from: source, to: target, allowed }
}

/** 条目状态迁移：非法转移直接拒，合法时返回新条目（不改原对象）。 */
export function transitionEntryStatus(entry, to) {
  if (!isPlainObject(entry)) {
    return { ok: false, error: { code: 'INVALID_ENTRY', message: '转移状态的条目必须是对象' } }
  }
  const check = validateStatusTransition(entry.status, to)
  if (!check.ok) return { ok: false, error: check }
  return { ok: true, from: check.from, to: check.to, entry: { ...entry, status: check.to } }
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

/* ---------- 条目信封校验 ---------- */

const SPAN_FIELDS = Object.freeze([
  'first_chapter', 'last_chapter', 'first_scene', 'last_scene', 'scene_count', 'chapter_count'
])

function validateProvenance(entry, addError, addWarning) {
  const provenance = entry.provenance
  if (!isPlainObject(provenance)) {
    addError('MISSING_REQUIRED', 'provenance', 'provenance 必须是对象')
    return
  }
  const mode = str(provenance.mode)
  if (!mode) {
    addError('PROVENANCE_MODE', 'provenance.mode', `缺少 mode（${PROVENANCE_MODES.join('|')}）：转换器/迁移器须显式落值`)
  } else if (!PROVENANCE_MODES.includes(mode)) {
    addError('PROVENANCE_MODE', 'provenance.mode', `mode 必须是 ${PROVENANCE_MODES.join('|')}`)
  }
  if (provenance.quote !== undefined && provenance.quote !== null) {
    if (typeof provenance.quote !== 'string') {
      addError('PROVENANCE_QUOTE', 'provenance.quote', 'quote 必须是字符串')
    } else if (mode === 'analyze') {
      addError('PROVENANCE_QUOTE_NOT_HASHED', 'provenance.quote', 'analyze 模式只允许存 quote_hash，quote 原文必须剥离')
    }
  }
  if (typeof provenance.book !== 'string') addWarning('PROVENANCE_BOOK', 'provenance.book', '缺少 book（书名）')
  if (typeof provenance.book_id !== 'string') addWarning('PROVENANCE_BOOK_ID', 'provenance.book_id', '缺少 book_id')
  for (const key of ['chapters', 'scenes']) {
    const value = provenance[key]
    if (value === undefined) {
      addWarning('PROVENANCE_ANCHORS', `provenance.${key}`, `缺少 ${key}（没有数字锚点时应给空数组）`)
      continue
    }
    if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item))) {
      addError('PROVENANCE_ANCHORS', `provenance.${key}`, `${key} 必须是整数数组`)
    }
  }
  if (typeof provenance.extractor !== 'string' || !provenance.extractor.trim()) {
    addWarning('PROVENANCE_EXTRACTOR', 'provenance.extractor', '缺少 extractor（抽取器标识）')
  }
  if (provenance.confidence !== undefined) {
    if (typeof provenance.confidence !== 'number' || provenance.confidence < 0 || provenance.confidence > 1) {
      addError('PROVENANCE_CONFIDENCE', 'provenance.confidence', 'confidence 必须是 0–1 的数字')
    }
  }
  if (provenance.quote_hash !== undefined && typeof provenance.quote_hash !== 'string') {
    addError('PROVENANCE_QUOTE_HASH', 'provenance.quote_hash', 'quote_hash 必须是字符串（只存哈希，不存原文）')
  }
}

function validateFingerprint(entry, addError, addWarning) {
  const fingerprint = entry.fingerprint
  if (!isPlainObject(fingerprint)) {
    addError('MISSING_REQUIRED', 'fingerprint', 'fingerprint 必须是对象')
    return
  }
  if (fingerprint.vec !== undefined && fingerprint.vec !== null && !Array.isArray(fingerprint.vec)) {
    addError('FINGERPRINT_VEC', 'fingerprint.vec', 'vec 必须是浮点数组或 null')
  }
  if (fingerprint.vec === null) {
    addWarning('FINGERPRINT_NO_VECTOR', 'fingerprint.vec', '无向量：只有结构指标，相似度检索暂不可用')
  }
  if (fingerprint.metrics !== undefined && !isPlainObject(fingerprint.metrics)) {
    addError('FINGERPRINT_METRICS', 'fingerprint.metrics', 'metrics 必须是对象')
  }
}

function validateRelations(entry, addError) {
  if (entry.relations === undefined) return
  if (!Array.isArray(entry.relations)) {
    addError('RELATION_SHAPE', 'relations', 'relations 必须是数组')
    return
  }
  entry.relations.forEach((relation, index) => {
    const field = `relations[${index}]`
    if (!isPlainObject(relation)) {
      addError('RELATION_SHAPE', field, '关系项必须是对象')
      return
    }
    if (typeof relation.to !== 'string' || !relation.to.trim()) {
      addError('RELATION_TARGET', `${field}.to`, '关系目标不能为空')
    }
    if (relation.type !== undefined && typeof relation.type !== 'string') {
      addError('RELATION_TYPE', `${field}.type`, '关系类型必须是字符串')
    }
    if (relation.how !== undefined && typeof relation.how !== 'string') {
      addError('RELATION_HOW', `${field}.how`, '关系说明必须是字符串')
    }
  })
}

function validateOptionals(entry, addError) {
  if (entry.aliases !== undefined) {
    if (!Array.isArray(entry.aliases) || entry.aliases.some((alias) => typeof alias !== 'string')) {
      addError('ALIASES_SHAPE', 'aliases', 'aliases 必须是字符串数组')
    }
  }
  if (entry.stats !== undefined && !isPlainObject(entry.stats)) {
    addError('STATS_SHAPE', 'stats', 'stats 必须是对象')
  }
  if (entry.votes !== undefined) {
    if (!isPlainObject(entry.votes)) addError('VOTES_SHAPE', 'votes', 'votes 必须是对象')
    else {
      for (const key of ['up', 'down']) {
        if (entry.votes[key] !== undefined && !Number.isInteger(entry.votes[key])) {
          addError('VOTES_COUNT', `votes.${key}`, `${key} 必须是整数`)
        }
      }
    }
  }
  if (entry.span !== undefined) {
    if (!isPlainObject(entry.span)) addError('SPAN_SHAPE', 'span', 'span 必须是对象')
    else {
      for (const key of SPAN_FIELDS) {
        const value = entry.span[key]
        if (value !== undefined && value !== null && !Number.isInteger(value)) {
          addError('SPAN_VALUE', `span.${key}`, `${key} 必须是整数或 null`)
        }
      }
    }
  }
}

/** 双时间轴：from/to 为整数或 null，且 from ≤ to。 */
function validateValidity(entry, addError) {
  const validity = entry.validity
  if (validity === undefined) return
  if (!isPlainObject(validity)) {
    addError('VALIDITY_SHAPE', 'validity', 'validity 必须是 { from, to } 对象')
    return
  }
  for (const key of ['from', 'to']) {
    const value = validity[key]
    if (value !== undefined && value !== null && !Number.isInteger(value)) {
      addError('VALIDITY_VALUE', `validity.${key}`, 'from/to 必须是整数或 null')
    }
  }
  if (Number.isInteger(validity.from) && Number.isInteger(validity.to) && validity.from > validity.to) {
    addError('VALIDITY_RANGE', 'validity', 'validity.from 不能大于 validity.to')
  }
}

function validateStatus(entry, addError) {
  if (entry.status === undefined) {
    addError('MISSING_REQUIRED', 'status', `缺少 status（默认应为 ${DEFAULT_ENTRY_STATUS}）`)
    return
  }
  if (!ENTRY_STATUSES.includes(str(entry.status))) {
    addError('STATUS_INVALID', 'status', `status 必须是 ${ENTRY_STATUSES.join('|')}`)
  }
}

function validateReaderCognition(entry, addError) {
  const cognition = entry.readerCognition
  if (cognition === undefined) return
  if (!isPlainObject(cognition)) {
    addError('READER_COGNITION_SHAPE', 'readerCognition', 'readerCognition 必须是对象')
    return
  }
  for (const key of ['firstMention', 'supplementNeeded']) {
    if (cognition[key] !== undefined && typeof cognition[key] !== 'boolean') {
      addError('READER_COGNITION_FLAG', `readerCognition.${key}`, `${key} 必须是布尔值`)
    }
  }
}

function validateAtSpan(atSpan, field, addError) {
  if (!isPlainObject(atSpan)) {
    addError('KNOWLEDGE_AT_SPAN', field, 'atSpan 必须是 { from, to } 对象')
    return
  }
  for (const key of ['from', 'to']) {
    const value = atSpan[key]
    if (value !== undefined && value !== null && !Number.isInteger(value)) {
      addError('KNOWLEDGE_AT_SPAN', `${field}.${key}`, 'atSpan.from/to 必须是整数或 null')
    }
  }
}

function validateCharacterFields(entry, addError, addWarning) {
  const mode = str(entry.provenance?.mode)
  if (entry.anchors !== undefined) {
    if (!isPlainObject(entry.anchors)) {
      addError('ANCHORS_SHAPE', 'anchors', 'anchors 必须是对象')
    } else {
      for (const [channel, values] of Object.entries(entry.anchors)) {
        if (!CHARACTER_ANCHOR_CHANNELS.includes(channel)) {
          addError('ANCHORS_CHANNEL', `anchors.${channel}`, `未知锚点通道（允许：${CHARACTER_ANCHOR_CHANNELS.join('/')}）`)
          continue
        }
        if (!isStringArray(values)) {
          addError('ANCHORS_VALUES', `anchors.${channel}`, `${channel} 必须是字符串数组`)
        }
      }
    }
  }
  if (entry.memoryPoints !== undefined && !isStringArray(entry.memoryPoints)) {
    addError('MEMORY_POINTS_SHAPE', 'memoryPoints', 'memoryPoints 必须是字符串数组')
  }
  if (entry.castRole !== undefined) {
    const castRole = entry.castRole
    if (!isPlainObject(castRole)) {
      addError('CAST_ROLE_SHAPE', 'castRole', 'castRole 必须是对象')
    } else {
      const tier = str(castRole.tier)
      if (!CAST_ROLE_TIERS.includes(tier)) {
        addError('CAST_ROLE_TIER', 'castRole.tier', `tier 必须是 ${CAST_ROLE_TIERS.join('|')}`)
      }
      const needsGoal = tier === 'supporting' || tier === 'minor'
      for (const field of ['goal', 'plotFunction']) {
        const value = castRole[field]
        if (value !== undefined && typeof value !== 'string') {
          addError('CAST_ROLE_FIELD', `castRole.${field}`, `${field} 必须是字符串`)
          continue
        }
        if (needsGoal && !str(value).trim()) {
          // S2-1：小角色/支线角色必须有塑造目标与剧情作用；作者模式下先警告，分析模式下直接拒。
          const code = 'CAST_ROLE_INCOMPLETE'
          const message = `${tier} 角色必须填写 ${field}`
          if (mode === 'analyze') addError(code, `castRole.${field}`, message)
          else addWarning(code, `castRole.${field}`, message)
        }
      }
    }
  }
  if (entry.knowledge !== undefined) {
    if (!Array.isArray(entry.knowledge)) {
      addError('KNOWLEDGE_SHAPE', 'knowledge', 'knowledge 必须是数组')
    } else {
      entry.knowledge.forEach((record, index) => {
        const field = `knowledge[${index}]`
        if (!isPlainObject(record)) {
          addError('KNOWLEDGE_SHAPE', field, '知情记录必须是对象')
          return
        }
        if (!isNonEmptyString(record.fromEntry)) {
          addError('KNOWLEDGE_FROM_ENTRY', `${field}.fromEntry`, 'fromEntry 必须是非空字符串（从哪条事件/设定获得）')
        }
        if (!KNOWLEDGE_KINDS.includes(str(record.kind))) {
          addError('KNOWLEDGE_KIND', `${field}.kind`, `kind 必须是 ${KNOWLEDGE_KINDS.join('|')}`)
        }
        validateAtSpan(record.atSpan, `${field}.atSpan`, addError)
      })
    }
  }
}

function validateRhythmSpec(entry, addError) {
  const spec = entry.rhythmSpec
  if (spec === undefined) return
  if (!isPlainObject(spec)) {
    addError('RHYTHM_SPEC_SHAPE', 'rhythmSpec', 'rhythmSpec 必须是对象')
    return
  }
  if (!Array.isArray(spec.windowChars) || !spec.windowChars.length) {
    addError('RHYTHM_WINDOW', 'rhythmSpec.windowChars', 'windowChars 必须是非空整数数组')
  } else {
    let previous = 0
    spec.windowChars.forEach((value, index) => {
      if (!Number.isInteger(value) || value <= 0) {
        addError('RHYTHM_WINDOW', `rhythmSpec.windowChars[${index}]`, '窗口必须是正整数')
      } else if (value <= previous) {
        addError('RHYTHM_WINDOW_ORDER', `rhythmSpec.windowChars[${index}]`, '窗口必须严格递增')
      } else {
        previous = value
      }
    })
  }
  if (!isStringArray(spec.noveltyTags) || !spec.noveltyTags.length) {
    addError('RHYTHM_NOVELTY', 'rhythmSpec.noveltyTags', 'noveltyTags 必须是非空字符串数组')
  }
}

function validatePlotEvents(entry, addError) {
  if (entry.events === undefined) return
  if (!Array.isArray(entry.events)) {
    addError('PLOT_EVENTS_SHAPE', 'events', 'events 必须是数组')
    return
  }
  entry.events.forEach((event, index) => {
    const field = `events[${index}]`
    if (!isPlainObject(event)) {
      addError('PLOT_EVENT_SHAPE', field, '事件必须是对象')
      return
    }
    if (event.track !== undefined && !PLOT_EVENT_TRACKS.includes(str(event.track))) {
      addError('PLOT_EVENT_TRACK', `${field}.track`, `track 必须是 ${PLOT_EVENT_TRACKS.join('|')}`)
    }
    if (event.novelty !== undefined && !isStringArray(event.novelty)) {
      addError('PLOT_EVENT_NOVELTY', `${field}.novelty`, 'novelty 必须是字符串数组')
    }
    if (event.segments !== undefined) {
      if (!Array.isArray(event.segments)) {
        addError('PLOT_EVENT_SEGMENTS', `${field}.segments`, 'segments 必须是数组')
      } else {
        event.segments.forEach((segment, position) => {
          const segmentField = `${field}.segments[${position}]`
          if (!isPlainObject(segment)) {
            addError('PLOT_EVENT_SEGMENT_SHAPE', segmentField, '段元数据必须是对象')
            return
          }
          if (segment.index !== undefined && (!Number.isInteger(segment.index) || segment.index < 1)) {
            addError('PLOT_EVENT_SEGMENT_INDEX', `${segmentField}.index`, '段序号必须是 ≥1 的整数')
          }
          if (!Number.isInteger(segment.chars) || segment.chars <= 0) {
            addError('PLOT_EVENT_SEGMENT_CHARS', `${segmentField}.chars`, '段字数必须是正整数')
          }
        })
      }
    }
  })
}

function validateStructureTemplates(entry, addError) {
  if (entry.structureTemplates === undefined) return
  if (!Array.isArray(entry.structureTemplates)) {
    addError('STRUCTURE_TEMPLATES_SHAPE', 'structureTemplates', 'structureTemplates 必须是数组')
    return
  }
  entry.structureTemplates.forEach((template, index) => {
    const field = `structureTemplates[${index}]`
    if (!isPlainObject(template)) {
      addError('STRUCTURE_TEMPLATE_SHAPE', field, '模板必须是对象')
      return
    }
    if (!firstText(template.id, template.name)) {
      addError('STRUCTURE_TEMPLATE_NAME', field, '模板必须有 id 或 name')
    }
    if (template.kind !== undefined && !STRUCTURE_TEMPLATE_KINDS.includes(str(template.kind))) {
      addError('STRUCTURE_TEMPLATE_KIND', `${field}.kind`, `kind 必须是 ${STRUCTURE_TEMPLATE_KINDS.join('|')}`)
    }
    if (template.beats !== undefined && !isStringArray(template.beats)) {
      addError('STRUCTURE_TEMPLATE_BEATS', `${field}.beats`, 'beats 必须是字符串数组')
    }
    if (template.instantiateOf !== undefined && !isNonEmptyString(template.instantiateOf)) {
      addError('STRUCTURE_TEMPLATE_INSTANCE', `${field}.instantiateOf`, 'instantiateOf 必须是非空字符串')
    }
  })
}

/**
 * 校验一个 pedia/v2 条目信封。
 * 返回 { ok, errors, warnings }；errors 是硬错误（必填/类型/枚举/id 漂移/状态机），warnings 不拦转。
 * 注意：castRole 完整性在 analyze 模式是 errors、author 模式是 warnings（ADR S2-1）。
 */
export function validatePediaEntry(entry) {
  const errors = []
  const warnings = []
  const addError = (code, field, message) => errors.push({ code, field, message })
  const addWarning = (code, field, message) => warnings.push({ code, field, message })

  if (!isPlainObject(entry)) {
    addError('INVALID_ENTRY', 'entry', '条目必须是对象')
    return { ok: false, errors, warnings }
  }
  if (entry.schema !== PEDIA_SCHEMA) {
    addError('SCHEMA_MISMATCH', 'schema', `schema 必须是 ${PEDIA_SCHEMA}`)
  }
  const layer = str(entry.layer)
  const spec = PEDIA_LAYERS[layer]
  if (!spec) {
    addError('UNKNOWN_LAYER', 'layer', `layer 必须是 ${Object.keys(PEDIA_LAYERS).join('/')}`)
  }

  for (const field of spec?.required ?? []) {
    const value = entry[field]
    if (field === 'provenance' || field === 'fingerprint') continue
    if (typeof value !== 'string' || !value.trim()) {
      addError('MISSING_REQUIRED', field, `${field} 不能为空`)
    }
  }
  if (layer === 'worldview') {
    if (str(entry.slot) && !WORLDVIEW_SLOTS[entry.slot]) {
      addError('UNKNOWN_SLOT', 'slot', `slot 必须是 ${WORLDVIEW_SLOT_NAMES.join('/')}`)
    }
    if (entry.rank !== undefined && entry.rank !== null) {
      if (!Number.isInteger(entry.rank) || entry.rank < 1) {
        addError('RANK_INVALID', 'rank', 'rank 必须是 ≥1 的整数或 null')
      }
      if (WORLDVIEW_SLOTS[entry.slot] && !isOrderedSlot(entry.slot)) {
        addWarning('RANK_ON_UNORDERED_SLOT', 'rank', '非 ordered 槽位不应有 rank')
      }
    } else if (isOrderedSlot(entry.slot)) {
      addWarning('ORDERED_SLOT_WITHOUT_RANK', 'rank', 'ordered 槽位缺 rank，序列无法排序/补档')
    }
    validateReaderCognition(entry, addError)
  }
  if (entry.domain !== undefined && typeof entry.domain !== 'string') {
    addError('DOMAIN_TYPE', 'domain', 'domain 必须是字符串')
  }

  validateStatus(entry, addError)
  validateValidity(entry, addError)

  if (entry.provenance !== undefined || spec?.required.includes('provenance')) {
    validateProvenance(entry, addError, addWarning)
  }
  if (entry.fingerprint !== undefined || spec?.required.includes('fingerprint')) {
    validateFingerprint(entry, addError, addWarning)
  }
  validateRelations(entry, addError)
  validateOptionals(entry, addError)

  if (layer === 'character') validateCharacterFields(entry, addError, addWarning)
  if (layer === 'plot') {
    validateRhythmSpec(entry, addError)
    validatePlotEvents(entry, addError)
    validateStructureTemplates(entry, addError)
    validateReaderCognition(entry, addError)
  }

  if (entry.id !== undefined) {
    if (typeof entry.id !== 'string' || !/^[0-9a-f]{12}$/iu.test(entry.id)) {
      addError('ID_FORMAT', 'id', 'id 必须是 sha1(layer|domain|slot|name)[:12] 的 12 位小写十六进制')
    } else if (typeof entry.name === 'string' && typeof entry.domain === 'string') {
      const expected = stableEntryId({ layer, domain: entry.domain, slot: entry.slot ?? '', name: entry.name })
      if (entry.id !== expected) {
        addError('ID_MISMATCH', 'id', `id 与稳定 id 不一致（应为 ${expected}）`)
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** 便捷判定：worldview 条目（hard 层）。 */
export function isWorldviewEntry(entry) {
  return isPlainObject(entry) && entry.layer === 'worldview'
}

/* ---------- S2-3 视角校验（纯函数，引擎批才接 hook） ---------- */

function normalizeKnowledgeLedger(ledger) {
  const map = new Map()
  const push = (character, record) => {
    const name = firstText(character)
    if (!name || !isPlainObject(record)) return
    if (!Array.isArray(map.get(name))) map.set(name, [])
    map.get(name).push(record)
  }
  if (Array.isArray(ledger)) {
    for (const record of ledger) {
      if (!isPlainObject(record)) continue
      push(firstText(record.character, record.who, record.name), record)
    }
  } else if (isPlainObject(ledger)) {
    for (const [character, records] of Object.entries(ledger)) {
      if (Array.isArray(records)) for (const record of records) push(character, record)
    }
  }
  return map
}

function chapterOf(span) {
  if (Number.isSafeInteger(span)) return span
  if (isPlainObject(span)) {
    if (Number.isSafeInteger(span.from)) return span.from
    if (Number.isSafeInteger(span.to)) return span.to
  }
  return null
}

function referencesOf(entry) {
  const names = []
  const push = (value) => {
    const text = str(value).trim()
    if (text && !names.includes(text)) names.push(text)
  }
  if (Array.isArray(entry.relations)) {
    for (const relation of entry.relations) push(relation?.to)
  }
  if (Array.isArray(entry.refs)) {
    for (const ref of entry.refs) push(isPlainObject(ref) ? ref.title : ref)
  }
  return names
}

/**
 * 知情矩阵校验（ADR S2-3 角色向）：条目在某角色视角、某时点引用了哪些信息，
 * 对照 knowledge ledger 判断「此刻是否已知」。
 *
 * entry.perspective = { character: '柯秒', atSpan: { from: 3, to: 3 } }
 * knowledgeLedger 支持两种形状：
 *   { 柯秒: [{ fromEntry: '停摆的表', atSpan: { from: 5, to: 5 }, kind: 'event' }] }
 *   [{ character: '柯秒', fromEntry: '停摆的表', atSpan: { from: 5, to: 5 }, kind: 'event' }]
 *
 * 返回 { ok, character, atChapter, checked, violations }；
 * 无 perspective 时跳过（skipped:'NO_PERSPECTIVE'），不误报。
 */
export function checkPerspective(entry, knowledgeLedger, options = {}) {
  const violations = []
  if (!isPlainObject(entry)) {
    return { ok: false, character: '', atChapter: null, checked: 0, violations: [{ code: 'INVALID_ENTRY', message: '条目必须是对象' }] }
  }
  const perspective = isPlainObject(entry.perspective) ? entry.perspective : null
  const character = firstText(perspective?.character, options.character, entry.character)
  if (!character) {
    return { ok: true, character: '', atChapter: null, checked: 0, skipped: 'NO_PERSPECTIVE', violations }
  }
  const atChapter = chapterOf(perspective?.atSpan) ?? chapterOf(options.atSpan)
  const records = normalizeKnowledgeLedger(knowledgeLedger).get(character) ?? []
  const references = referencesOf(entry)

  for (const referenced of references) {
    if (referenced === str(entry.name).trim()) continue
    const matches = records.filter((record) => str(record.fromEntry).trim() === referenced)
    if (!matches.length) {
      violations.push({
        code: 'PERSPECTIVE_UNKNOWN_INFO',
        character,
        entry: str(entry.name),
        referenced,
        atChapter,
        reason: 'not-in-ledger'
      })
      continue
    }
    if (atChapter === null) continue
    const known = matches.some((record) => {
      const knownAt = chapterOf(record.atSpan)
      return knownAt === null || knownAt <= atChapter
    })
    if (!known) {
      const knownAt = matches
        .map((record) => chapterOf(record.atSpan))
        .filter((value) => value !== null)
        .sort((left, right) => left - right)[0] ?? null
      violations.push({
        code: 'PERSPECTIVE_UNKNOWN_INFO',
        character,
        entry: str(entry.name),
        referenced,
        atChapter,
        knownAt,
        reason: 'known-later'
      })
    }
  }

  return { ok: violations.length === 0, character, atChapter, checked: references.length, violations }
}
