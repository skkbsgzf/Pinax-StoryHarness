/**
 * pedia/v1 统一数据规范（vendored）。
 *
 * 来源：作者自有仓库 NovelPedia 的 `src/pedia_schema.json`（作者自有 IP，允许入仓）。
 * 参照克隆：`D:\Pinax-e2e\ref-Novelpedia`（只读）
 * 来源 commit：eb4f14018a61153023d32aed3679c1bb2682f336
 * 规范版本：pedia/v1（schema.json 的 updated: 2026-08-29）
 *
 * 本文件只搬运「层／槽位／归并映射／条目信封」四件事，并把规范里的格式化描述落成可执行的
 * 校验与稳定 id；不引入 NovelPedia 的引擎、抽取器或存储布局（那是 W2 之后的事）。
 *
 * 枢纽约定（照规范原意）：
 *   - worldview 是 hard 层：name/domain/slot/definition/provenance 必填，只有它参与跨书迁移；
 *   - character/style/plot 是 soft 层：不强行统一结构，只要求 provenance + fingerprint；
 *   - 稳定 id = sha1(layer|domain|slot|name)[:12]；soft 层没有 slot 时按空串参与哈希；
 *   - category_map 把 34 种自由分类收敛到 11 个标准槽位（未知分类落 other）。
 */

export const PEDIA_SCHEMA = 'pedia/v1'

export const PEDIA_SOURCE = Object.freeze({
  repository: 'NovelPedia',
  file: 'src/pedia_schema.json',
  commit: 'eb4f14018a61153023d32aed3679c1bb2682f336',
  schema: PEDIA_SCHEMA,
  updated: '2026-08-29'
})

/** 四层对齐口径；required/optional 逐字来自规范。 */
export const PEDIA_LAYERS = Object.freeze({
  worldview: Object.freeze({
    align: 'hard',
    desc: '世界观设定层：跨书可借鉴度最高，必须落 domain + slot（有序槽位才有 rank）。',
    required: Object.freeze(['name', 'domain', 'slot', 'definition', 'provenance']),
    optional: Object.freeze(['rank', 'aliases', 'relations', 'stats', 'fingerprint', 'votes'])
  }),
  character: Object.freeze({
    align: 'soft',
    desc: '人物层：不强行统一结构，只要求可比较的 fingerprint。',
    required: Object.freeze(['name', 'provenance', 'fingerprint']),
    optional: Object.freeze(['identity', 'personality', 'trajectory', 'relations', 'stats'])
  }),
  style: Object.freeze({
    align: 'soft',
    desc: '文风层：不统一结构，只要求可比较的 metrics。',
    required: Object.freeze(['provenance', 'fingerprint']),
    optional: Object.freeze(['summary', 'samples'])
  }),
  plot: Object.freeze({
    align: 'soft',
    desc: '剧情层：不统一结构，只要求事件序列 + 向量。',
    required: Object.freeze(['provenance', 'fingerprint']),
    optional: Object.freeze(['fact', 'hypothesis', 'events'])
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

const SPAN_FIELDS = Object.freeze([
  'first_chapter', 'last_chapter', 'first_scene', 'last_scene', 'scene_count', 'chapter_count'
])

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
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

/* ---------- 稳定 id：sha1(layer|domain|slot|name)[:12] ---------- */

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

/* ---------- 条目信封校验 ---------- */

function validateProvenance(entry, addError, addWarning) {
  const provenance = entry.provenance
  if (!isPlainObject(provenance)) {
    addError('MISSING_REQUIRED', 'provenance', 'provenance 必须是对象')
    return
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

/**
 * 校验一个 pedia/v1 条目信封。
 * 返回 { ok, errors, warnings }；errors 是硬错误（必填/类型/枚举/id 漂移），warnings 不拦转。
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
  }
  if (entry.domain !== undefined && typeof entry.domain !== 'string') {
    addError('DOMAIN_TYPE', 'domain', 'domain 必须是字符串')
  }

  if (entry.provenance !== undefined || spec?.required.includes('provenance')) {
    validateProvenance(entry, addError, addWarning)
  }
  if (entry.fingerprint !== undefined || spec?.required.includes('fingerprint')) {
    validateFingerprint(entry, addError, addWarning)
  }
  validateRelations(entry, addError)
  validateOptionals(entry, addError)

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
