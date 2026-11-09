/**
 * 编剧技能数据契约（ADR P3）：技能从「prompt 中心」升级为「数据格式中心」。
 *
 * 一张技能卡声明两件事：
 *   requires —— 需要哪些 pedia 投影（层／槽位／跨度／知情角色／节奏），事实包按此裁剪装配；
 *   produces —— 产出什么条目（layer／slot／asStatus／provenance.mode），或非条目产物
 *               （nonEntry：违规清单、关系边、场景骨架这类不进 pedia store 的结果）。
 *
 * 纯域件：只依赖 ../domain 的词表、信封校验与状态机，不碰宿主（无 node 内置、无 process）。
 * 写路径永远先过 schema，再过状态机，最后过契约白名单——三关缺一不可。
 */

import {
  OTHER_SLOT,
  PEDIA_LAYERS,
  PROVENANCE_MODES,
  WORLDVIEW_SLOTS,
  WORLDVIEW_SLOT_NAMES
} from '../domain/vocabulary.js'
import { validatePediaEntry } from '../domain/schema.js'
import { validateStatusTransition } from '../domain/status.js'

export const SKILL_CONTRACT_VERSION = 'skill-contract@1'
/** produces 允许的落库状态：draft＝作者直写草稿；proposed＝等作者采纳的提案。 */
export const PRODUCE_STATUSES = Object.freeze(['proposed', 'draft'])
/** 非条目产物的产物类型词表（与 SKILL.md 的 output 同族）。 */
export const NON_ENTRY_OUTPUTS = Object.freeze(['proposal', 'checklist'])
/** knowledgeOf 的两个作用域词：cast＝事实包里出现的全部角色；focus＝查询聚焦的那一个。 */
export const KNOWLEDGE_SCOPES = Object.freeze(['cast', 'focus'])

const REQUIRES_FIELDS = Object.freeze(['layers', 'slots', 'spans', 'knowledgeOf', 'rhythm'])
const SPAN_FIELDS = Object.freeze(['current', 'before', 'after'])
const PRODUCE_ENTRY_FIELDS = Object.freeze(['layer', 'slot', 'asStatus', 'mode'])
const PRODUCE_NON_ENTRY_FIELDS = Object.freeze(['nonEntry', 'output'])
const CONTRACT_FIELDS = Object.freeze(['version', 'skill', 'requires', 'produces'])

export class SkillContractError extends Error {
  constructor(errors = []) {
    const first = errors[0]
    super(first ? `技能数据契约不合法：${first.field ? `${first.field} ` : ''}${first.message}` : '技能数据契约不合法')
    this.name = 'SkillContractError'
    this.code = 'SKILL_CONTRACT_INVALID'
    this.errors = errors.map((error) => ({ ...error }))
  }
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function pushUnknownFields(source, allowed, field, addError) {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) {
      addError('CONTRACT_UNKNOWN_FIELD', field ? `${field}.${key}` : key, `未知字段「${key}」（允许：${allowed.join(' / ')}）`)
    }
  }
}

function normalizeRequires(raw, addError) {
  if (!isPlainObject(raw)) {
    addError('CONTRACT_REQUIRES_INVALID', 'requires', 'requires 必须是对象：{ layers, slots?, spans?, knowledgeOf?, rhythm? }')
    return null
  }
  pushUnknownFields(raw, REQUIRES_FIELDS, 'requires', addError)

  const layers = []
  if (!Array.isArray(raw.layers) || !raw.layers.length) {
    addError('CONTRACT_LAYERS_REQUIRED', 'requires.layers', `requires.layers 必须是非空数组（可写 ${Object.keys(PEDIA_LAYERS).join(' / ')}）`)
  } else {
    for (const item of raw.layers) {
      const layer = str(item).trim()
      if (!PEDIA_LAYERS[layer]) {
        addError('CONTRACT_LAYER_UNKNOWN', 'requires.layers', `未知层「${layer}」（可写 ${Object.keys(PEDIA_LAYERS).join(' / ')}）`)
        continue
      }
      if (!layers.includes(layer)) layers.push(layer)
    }
  }

  let slots = null
  if (raw.slots !== undefined && raw.slots !== null) {
    if (!Array.isArray(raw.slots) || !raw.slots.length) {
      addError('CONTRACT_SLOTS_INVALID', 'requires.slots', 'requires.slots 必须是非空数组或省略')
    } else {
      slots = []
      for (const item of raw.slots) {
        const slot = str(item).trim()
        if (!WORLDVIEW_SLOTS[slot]) {
          addError('CONTRACT_SLOT_UNKNOWN', 'requires.slots', `未知槽位「${slot}」（可写 ${WORLDVIEW_SLOT_NAMES.join(' / ')}）`)
          continue
        }
        if (!slots.includes(slot)) slots.push(slot)
      }
      if (layers.length && !layers.includes('worldview')) {
        addError('CONTRACT_SLOT_WITHOUT_WORLDVIEW', 'requires.slots', '声明了 slots 却没有 requires.layers 里的 worldview：槽位只属于世界观层')
      }
    }
  }

  let spans = null
  if (raw.spans !== undefined && raw.spans !== null) {
    if (!isPlainObject(raw.spans)) {
      addError('CONTRACT_SPANS_INVALID', 'requires.spans', 'requires.spans 必须是 { current?, before?, after? } 对象或省略')
    } else {
      pushUnknownFields(raw.spans, SPAN_FIELDS, 'requires.spans', addError)
      const current = raw.spans.current ?? true
      const before = raw.spans.before ?? 0
      const after = raw.spans.after ?? 0
      if (typeof current !== 'boolean') addError('CONTRACT_SPAN_CURRENT', 'requires.spans.current', 'current 必须是布尔值')
      for (const [key, value] of [['before', before], ['after', after]]) {
        if (!Number.isInteger(value) || value < 0) addError('CONTRACT_SPAN_RANGE', `requires.spans.${key}`, `${key} 必须是 ≥0 的整数`)
      }
      spans = { current: current === true, before: Number.isInteger(before) && before > 0 ? before : 0, after: Number.isInteger(after) && after > 0 ? after : 0 }
    }
  }

  let knowledgeOf = null
  if (raw.knowledgeOf !== undefined && raw.knowledgeOf !== null) {
    if (typeof raw.knowledgeOf === 'string') {
      const scope = raw.knowledgeOf.trim()
      if (!KNOWLEDGE_SCOPES.includes(scope)) {
        addError('CONTRACT_KNOWLEDGE_INVALID', 'requires.knowledgeOf', `knowledgeOf「${scope}」不在词表里（可写 ${KNOWLEDGE_SCOPES.join(' / ')}，或给角色名数组）`)
      } else {
        knowledgeOf = scope
      }
    } else if (Array.isArray(raw.knowledgeOf) && raw.knowledgeOf.length) {
      knowledgeOf = []
      for (const item of raw.knowledgeOf) {
        const name = str(item).trim()
        if (!name) {
          addError('CONTRACT_KNOWLEDGE_NAME', 'requires.knowledgeOf', 'knowledgeOf 数组里的角色名不能为空')
          continue
        }
        if (!knowledgeOf.includes(name)) knowledgeOf.push(name)
      }
    } else {
      addError('CONTRACT_KNOWLEDGE_INVALID', 'requires.knowledgeOf', 'knowledgeOf 必须是 cast／focus 或非空角色名数组')
    }
  }

  let rhythm = false
  if (raw.rhythm !== undefined && raw.rhythm !== null) {
    if (typeof raw.rhythm !== 'boolean') {
      addError('CONTRACT_RHYTHM_INVALID', 'requires.rhythm', 'rhythm 必须是布尔值')
    } else {
      rhythm = raw.rhythm
    }
  }

  return { layers, slots, spans, knowledgeOf, rhythm }
}

function normalizeProduces(raw, addError) {
  if (!Array.isArray(raw) || !raw.length) {
    addError('CONTRACT_PRODUCES_REQUIRED', 'produces', 'produces 必须是非空数组：至少声明一种产出（条目或 nonEntry）')
    return []
  }
  const produces = []
  raw.forEach((item, index) => {
    const field = `produces[${index}]`
    if (!isPlainObject(item)) {
      addError('CONTRACT_PRODUCE_INVALID', field, 'produces 项必须是对象')
      return
    }
    if (item.nonEntry !== undefined) {
      pushUnknownFields(item, PRODUCE_NON_ENTRY_FIELDS, field, addError)
      const nonEntry = str(item.nonEntry).trim()
      if (!nonEntry) {
        addError('CONTRACT_NON_ENTRY_NAME', `${field}.nonEntry`, 'nonEntry 必须是非空字符串（产物类型名）')
        return
      }
      let output = null
      if (item.output !== undefined && item.output !== null) {
        output = str(item.output).trim()
        if (!NON_ENTRY_OUTPUTS.includes(output)) {
          addError('CONTRACT_NON_ENTRY_OUTPUT', `${field}.output`, `output 必须是 ${NON_ENTRY_OUTPUTS.join(' / ')}`)
          return
        }
      }
      produces.push({ nonEntry, output })
      return
    }

    pushUnknownFields(item, PRODUCE_ENTRY_FIELDS, field, addError)
    const layer = str(item.layer).trim()
    if (!PEDIA_LAYERS[layer]) {
      addError('CONTRACT_PRODUCE_LAYER', `${field}.layer`, `layer 必须是 ${Object.keys(PEDIA_LAYERS).join(' / ')}`)
      return
    }
    let slot = null
    if (item.slot !== undefined && item.slot !== null) {
      slot = str(item.slot).trim()
      if (!WORLDVIEW_SLOTS[slot]) {
        addError('CONTRACT_PRODUCE_SLOT', `${field}.slot`, `slot 必须是 ${WORLDVIEW_SLOT_NAMES.join(' / ')}`)
        return
      }
      if (layer !== 'worldview') {
        addError('CONTRACT_PRODUCE_SLOT_LAYER', `${field}.slot`, 'slot 只属于 worldview 层')
        return
      }
    }
    const asStatus = str(item.asStatus).trim()
    if (!PRODUCE_STATUSES.includes(asStatus)) {
      addError('CONTRACT_PRODUCE_STATUS', `${field}.asStatus`, `asStatus 必须是 ${PRODUCE_STATUSES.join(' / ')}`)
      return
    }
    const mode = str(item.mode).trim() || 'author'
    if (!PROVENANCE_MODES.includes(mode)) {
      addError('CONTRACT_PRODUCE_MODE', `${field}.mode`, `mode 必须是 ${PROVENANCE_MODES.join(' / ')}`)
      return
    }
    produces.push({ layer, slot, asStatus, mode })
  })
  return produces
}

function normalizeContract(raw, addError) {
  if (!isPlainObject(raw)) {
    addError('CONTRACT_INVALID', 'contract', '契约必须是对象：{ skill?, requires, produces }')
    return null
  }
  pushUnknownFields(raw, CONTRACT_FIELDS, '', addError)
  // 已归一化的契约（defineSkillContract／frozenContract 的产物）带 version；再喂进来必须幂等。
  if (raw.version !== undefined && raw.version !== null && str(raw.version) !== SKILL_CONTRACT_VERSION) {
    addError('CONTRACT_VERSION', 'version', `version 必须是 ${SKILL_CONTRACT_VERSION}`)
  }
  let skill = ''
  if (raw.skill !== undefined && raw.skill !== null) {
    skill = str(raw.skill).trim()
    if (!skill) addError('CONTRACT_SKILL_NAME', 'skill', 'skill 不能为空（省略表示不绑定具体技能名）')
  }
  const requires = normalizeRequires(raw.requires, addError)
  const produces = normalizeProduces(raw.produces, addError)
  if (!requires || !produces.length) return null
  return { skill, requires, produces }
}

function frozenContract(value) {
  return Object.freeze({
    version: SKILL_CONTRACT_VERSION,
    skill: value.skill,
    requires: Object.freeze({
      layers: Object.freeze([...value.requires.layers]),
      slots: value.requires.slots ? Object.freeze([...value.requires.slots]) : null,
      spans: value.requires.spans ? Object.freeze({ ...value.requires.spans }) : null,
      knowledgeOf: Array.isArray(value.requires.knowledgeOf)
        ? Object.freeze([...value.requires.knowledgeOf])
        : value.requires.knowledgeOf,
      rhythm: value.requires.rhythm === true
    }),
    produces: Object.freeze(value.produces.map((item) => (
      item.nonEntry !== undefined
        ? Object.freeze({ nonEntry: item.nonEntry, output: item.output ?? null })
        : Object.freeze({ layer: item.layer, slot: item.slot ?? null, asStatus: item.asStatus, mode: item.mode })
    )))
  })
}

/**
 * 定义并归一化一份技能契约；不合法直接抛 SkillContractError（errors 逐条带 field）。
 * 装载层要的是「拒装＋记账」而不是异常穿透，所以它走 validateSkillContract。
 */
export function defineSkillContract(input) {
  const errors = []
  const value = normalizeContract(input, (code, field, message) => errors.push({ code, field, message }))
  if (errors.length || !value) throw new SkillContractError(errors)
  return frozenContract(value)
}

/**
 * 非抛错校验：装载层与设置面用这一口。已归一化的契约再喂进来也幂等。
 * @returns {{ ok: boolean, errors: Object[], warnings: Object[], value: Object|null }}
 */
export function validateSkillContract(input) {
  const errors = []
  const value = normalizeContract(input, (code, field, message) => errors.push({ code, field, message }))
  return {
    ok: errors.length === 0 && Boolean(value),
    errors,
    warnings: [],
    value: errors.length || !value ? null : frozenContract(value)
  }
}

/**
 * 产出条目校验：schema → 状态机 → 契约白名单。
 *   · 每条先过 pedia/v2 信封（必填／枚举／id 漂移／状态机）；
 *   · 再按契约找「层＋槽位」白名单，找不到就拒；
 *   · 最后核 asStatus 与 provenance.mode 与契约声明一致——技能不能一边声明提案、一边直写 adopted。
 * @returns {{ ok: boolean, errors: Object[], warnings: Object[], checked: number, contract: Object|null }}
 */
export function validateProduces(contract, entries) {
  const normalized = validateSkillContract(contract)
  if (!normalized.ok) {
    return {
      ok: false,
      errors: normalized.errors.map((error) => ({ ...error, code: error.code.startsWith('CONTRACT_') ? error.code : `CONTRACT_${error.code}` })),
      warnings: [],
      checked: 0,
      contract: null
    }
  }
  const spec = normalized.value
  const list = Array.isArray(entries) ? entries : []
  const errors = []
  const warnings = []

  list.forEach((entry, index) => {
    const field = `entries[${index}]`
    if (!isPlainObject(entry)) {
      errors.push({ code: 'INVALID_ENTRY', field, message: '条目必须是对象' })
      return
    }
    const schema = validatePediaEntry(entry)
    for (const error of schema.errors) errors.push({ code: error.code, field: `${field}.${error.field}`, message: error.message })
    for (const warning of schema.warnings) warnings.push({ code: warning.code, field: `${field}.${warning.field}`, message: warning.message })

    const layer = str(entry.layer).trim()
    const slot = entry.slot === undefined || entry.slot === null ? '' : str(entry.slot).trim()
    if (!PEDIA_LAYERS[layer]) return

    if (layer !== 'worldview' && slot) {
      errors.push({ code: 'PRODUCES_SLOT_NOT_ALLOWED', field: `${field}.slot`, message: `只有 worldview 层有槽位；${layer} 条目不应带 slot` })
      return
    }
    const sameLayer = spec.produces.filter((item) => item.layer === layer)
    if (!sameLayer.length) {
      errors.push({ code: 'PRODUCES_LAYER_NOT_ALLOWED', field: `${field}.layer`, message: `契约不产出 ${layer} 层（允许：${[...new Set(spec.produces.filter((item) => item.layer).map((item) => item.layer))].join(' / ') || '无条目产物'}）` })
      return
    }
    const allowed = sameLayer.filter((item) => item.slot === null || item.slot === slot)
    if (!allowed.length) {
      errors.push({ code: 'PRODUCES_SLOT_NOT_ALLOWED', field: `${field}.slot`, message: `契约不产出 ${layer}/${slot || '(空槽位)'}（允许：${sameLayer.map((item) => item.slot ?? '任意槽').join(' / ')}）` })
      return
    }
    const matched = allowed[0]
    if (str(entry.provenance?.mode) !== matched.mode) {
      errors.push({ code: 'PRODUCES_MODE_MISMATCH', field: `${field}.provenance.mode`, message: `契约声明 mode=${matched.mode}，条目实际是 ${str(entry.provenance?.mode) || '(缺)'}` })
    }
    if (str(entry.status) !== matched.asStatus) {
      errors.push({ code: 'PRODUCES_STATUS_MISMATCH', field: `${field}.status`, message: `契约声明 asStatus=${matched.asStatus}，条目实际是 ${str(entry.status) || '(缺)'}` })
    }
    const transition = validateStatusTransition('draft', matched.asStatus)
    if (!transition.ok) {
      errors.push({ code: 'PRODUCES_STATUS_UNREACHABLE', field: `${field}.status`, message: transition.message })
    }
  })

  return { ok: errors.length === 0, errors, warnings, checked: list.length, contract: spec }
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = cloneValue(item)
    return out
  }
  return value
}

function emptyEvents() {
  return { facts: [], hypotheses: [] }
}

/**
 * 按 requires 裁剪事实包（杜绝全量塞 prompt）。
 *
 * 事实包（buildFactPack 的产物）是全域投影；这里只保留契约点名的层／槽位／角色，
 * 并把被裁掉的部分做成 dropped 账（只记名字与数量，不回灌正文）。
 * 没有对应投影时如实给 warnings/losses，不凭空编造（比如 requires.rhythm 而事实包没带节奏规格）。
 */
export function assembleRequires(contract, factPack) {
  const normalized = validateSkillContract(contract)
  if (!normalized.ok) return { ok: false, errors: normalized.errors, warnings: [], losses: [] }
  const c = normalized.value
  const requires = c.requires
  const pack = isPlainObject(factPack) ? factPack : {}
  const layers = new Set(requires.layers)
  const wantedSlots = requires.slots ? new Set(requires.slots) : null

  const worldSource = isPlainObject(pack.world) ? pack.world : {}
  const worldSourceSlots = isPlainObject(worldSource.slots) ? worldSource.slots : {}
  // package.effective 只带 {id,name,layer,validity,effective}，没有 slot——按槽位裁剪时用 world.slots 的 id→slot 反查。
  const slotById = new Map()
  for (const [slot, items] of Object.entries(worldSourceSlots)) {
    for (const item of Array.isArray(items) ? items : []) {
      if (isPlainObject(item) && item.id) slotById.set(str(item.id), slot)
    }
  }
  const slotOf = (item) => str(item.slot) || slotById.get(str(item.id)) || OTHER_SLOT

  const effectiveSource = Array.isArray(pack.effective) ? pack.effective.filter(isPlainObject) : []
  const effective = effectiveSource
    .filter((item) => layers.has(item.layer))
    .filter((item) => item.layer !== 'worldview' || !wantedSlots || wantedSlots.has(slotOf(item)))
    .map(cloneValue)
  const keptIds = new Set(effective.map((item) => str(item.id)).filter(Boolean))

  const slots = {}
  if (layers.has('worldview')) {
    for (const [slot, items] of Object.entries(worldSourceSlots)) {
      if (wantedSlots && !wantedSlots.has(slot)) continue
      slots[slot] = Array.isArray(items) ? items.map(cloneValue) : []
    }
  }
  const ordered = layers.has('worldview') && Array.isArray(worldSource.ordered)
    ? worldSource.ordered
      .filter((item) => isPlainObject(item))
      .filter((item) => !wantedSlots || wantedSlots.has(str(item.slot)))
      .map(cloneValue)
    : []

  const eventsSource = isPlainObject(pack.events) ? pack.events : {}
  const events = layers.has('plot')
    ? {
        facts: Array.isArray(eventsSource.facts) ? eventsSource.facts.filter(isPlainObject).map(cloneValue) : [],
        hypotheses: Array.isArray(eventsSource.hypotheses) ? eventsSource.hypotheses.filter(isPlainObject).map(cloneValue) : []
      }
    : emptyEvents()

  const charactersSource = isPlainObject(pack.characters) ? pack.characters : {}
  const characters = {}
  if (layers.has('character')) {
    let names = Object.keys(charactersSource)
    if (requires.knowledgeOf === 'focus') {
      const focus = str(pack.query?.character).trim()
      names = focus ? names.filter((name) => name === focus) : names
    } else if (Array.isArray(requires.knowledgeOf)) {
      names = names.filter((name) => requires.knowledgeOf.includes(name))
    }
    for (const name of names) characters[name] = cloneValue(charactersSource[name])
  }

  const supplements = Array.isArray(pack.supplements)
    ? pack.supplements.filter((item) => isPlainObject(item) && keptIds.has(str(item.id))).map(cloneValue)
    : []

  const warnings = Array.isArray(pack.warnings) ? pack.warnings.map((item) => ({ ...item })) : []
  const losses = Array.isArray(pack.losses) ? pack.losses.map((item) => ({ ...item })) : []

  let rhythm = null
  if (requires.rhythm) {
    rhythm = pack.rhythm ?? pack.rhythmSpec ?? null
    if (!rhythm) {
      warnings.push({
        code: 'RHYTHM_NOT_IN_FACT_PACK',
        message: 'requires.rhythm 要求节奏规格，但事实包未携带 rhythm／rhythmSpec：应由装配方另行补投影'
      })
    }
  }

  return {
    ok: true,
    version: SKILL_CONTRACT_VERSION,
    requires,
    spans: requires.spans,
    query: {
      ...(isPlainObject(pack.query) ? cloneValue(pack.query) : {}),
      layers: [...requires.layers],
      slots: requires.slots ? [...requires.slots] : null,
      knowledgeOf: Array.isArray(requires.knowledgeOf) ? [...requires.knowledgeOf] : requires.knowledgeOf
    },
    world: { slots, ordered, rules: Array.isArray(worldSource.rules) ? worldSource.rules.map(cloneValue) : [] },
    events,
    characters,
    supplements,
    effective,
    rhythm,
    counts: {
      entries: effective.length,
      worldview: effective.filter((item) => item.layer === 'worldview').length,
      facts: events.facts.length,
      hypotheses: events.hypotheses.length,
      characters: Object.keys(characters).length,
      slots: Object.keys(slots).length
    },
    dropped: {
      layers: Object.keys(PEDIA_LAYERS).filter((layer) => !layers.has(layer)),
      slots: Object.keys(worldSourceSlots).filter((slot) => Boolean(wantedSlots) && !wantedSlots.has(slot)),
      characters: Object.keys(charactersSource).filter((name) => !(name in characters))
    },
    warnings,
    losses
  }
}
