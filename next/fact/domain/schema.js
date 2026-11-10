/**
 * fact.data/v2 条目信封校验器（domain 真源，Core 平移件）。
 *
 * 校验分两档：errors 是硬错误（必填/类型/枚举/id 漂移/状态机），warnings 不拦转。
 * 注意：castRole 完整性在 analyze 模式是 errors、author 模式是 warnings（ADR S2-1）。
 */

import {
  CAST_ROLE_TIERS,
  CHARACTER_ANCHOR_CHANNELS,
  DEFAULT_ENTRY_STATUS,
  ENTRY_STATUSES,
  KNOWLEDGE_KINDS,
  FACT_LAYERS,
  FACT_SCHEMA,
  PLOT_EVENT_TRACKS,
  PROVENANCE_MODES,
  STRUCTURE_TEMPLATE_KINDS,
  WORLDVIEW_SLOTS,
  WORLDVIEW_SLOT_NAMES,
  isOrderedSlot
} from './vocabulary.js'
import { stableEntryId } from './stableId.js'
import { validateValidityShape } from './validity.js'

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

/** 双时间轴：from/to 为整数或 null，且 from ≤ to（规则真源在 ./validity.js）。 */
function validateValidity(entry, addError) {
  const result = validateValidityShape(entry.validity)
  for (const error of result.errors) addError(error.code, error.field, error.message)
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
 * 校验一个 fact.data/v2 条目信封。
 * 返回 { ok, errors, warnings }；errors 是硬错误（必填/类型/枚举/id 漂移/状态机），warnings 不拦转。
 */
export function validateFactEntry(entry) {
  const errors = []
  const warnings = []
  const addError = (code, field, message) => errors.push({ code, field, message })
  const addWarning = (code, field, message) => warnings.push({ code, field, message })

  if (!isPlainObject(entry)) {
    addError('INVALID_ENTRY', 'entry', '条目必须是对象')
    return { ok: false, errors, warnings }
  }
  if (entry.schema !== FACT_SCHEMA) {
    addError('SCHEMA_MISMATCH', 'schema', `schema 必须是 ${FACT_SCHEMA}`)
  }
  const layer = str(entry.layer)
  const spec = FACT_LAYERS[layer]
  if (!spec) {
    addError('UNKNOWN_LAYER', 'layer', `layer 必须是 ${Object.keys(FACT_LAYERS).join('/')}`)
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
