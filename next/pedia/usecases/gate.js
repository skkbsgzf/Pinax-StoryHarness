/**
 * P5 作品化质量门禁（ADR P5：确定性检查先行，模型评画质后置）。
 *
 * 四类确定性断言（全量扫描；只读，不写 store、不改条目）：
 *   1) 角色言行 vs anchors（U2）：重复锚点、同一句既说又做、口头禅未落在 speech、
 *      被剧情引用的角色没有任何言行锚点、主角全空锚点；
 *   2) 世界规则 vs events 槽位：只认结构化约束字段（constraint:{key,value}）——
 *      同 key 不同 value 且 validity 相交即冲突；没有结构化约束的规则如实记成「不可判定」，
 *      绝不拿自由文本猜语义冲突（诚实边界）；
 *   3) 时间轴：validity/atSpan 区间倒置、事件序号重复、结构事件序号越出 plot validity、
 *      同域两份结构 plot 的事件序号在重叠时段相撞；
 *   4) 知情一致性：precheck 的批量版——逐章纲事件跑引用解析/生效区间校验，
 *      外加 knowledge 的 fromEntry 解析、知情早于来源、重复记录。
 *
 * 两条分层纪律：
 *   - 本文件在 pedia 域内，不 import wikihub/convert（静态边界铁律）。round-trip 保真
 *     通过 options.roundTrip 端口注入：宿主/测试用 convert 做导出→回读，把结果交回来；
 *   - 归一化（别名合并／分类归并）是纯结构报告，不猜跨条目的同义。
 *
 * 汇总出口 runPediaGate(entries) → { assertions, conflicts, undecidable, roundTrip, normalization }：
 *   assertions  全部断言项（error/warning 都在，带 category/rule/decidable）；
 *   conflicts   assertions 里 severity=error 且可判定的子集（门禁真正的红）；
 *   undecidable 规则槽位里只有自由文本、无法确定性判定的条目（如实记账）。
 */

import { CATEGORY_MAP, CHARACTER_ANCHOR_CHANNELS, OTHER_SLOT, WORLDVIEW_SLOTS } from '../domain/vocabulary.js'
import { createAliasIndex } from '../domain/aliases.js'
import { intersectValidity, spansOverlap, validityBounds } from '../domain/validity.js'
import { precheckDraft } from './precheck.js'

export const PEDIA_GATE_VERSION = 'pedia-gate/v1'

/** 断言类别；每类对应 runPediaGate 的一个检查器。 */
export const GATE_CATEGORIES = Object.freeze({
  characterAnchors: 'character-anchors',
  worldRules: 'world-rules',
  timeline: 'timeline',
  knowledge: 'knowledge'
})

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

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').map((item) => item.trim()) : []
}

function asList(value) {
  return Array.isArray(value) ? value.filter(isPlainObject) : []
}

function makeAssertion({ category, rule, severity = 'warning', entryId = '', message, key = '', details = null }) {
  return {
    id: `${rule}:${entryId || 'global'}${key ? `:${key}` : ''}`,
    category,
    rule,
    severity,
    decidable: true,
    entryId,
    message,
    ...(details ? { details } : {})
  }
}

/* ---------- 1) 角色言行 vs anchors（U2） ---------- */

/**
 * 全量扫描人物条目与剧情事件里的角色引用：
 *   - anchors 通道内重复句 → ANCHOR_DUPLICATE；
 *   - speech 与 behavior 出现同一句 → ANCHOR_CHANNEL_CONFLICT（一句话不能既说又做）；
 *   - catchphrase 未落在 speech 里 → CATCHPHRASE_UNANCHORED；
 *   - 被 plot 事件 refs 引用却没有任何锚点 → CHARACTER_REFERENCED_WITHOUT_ANCHORS；
 *   - protagonist 全空锚点 → PROTAGONIST_WITHOUT_ANCHORS。
 * 全部为 warning：锚点缺失是塑造完整度问题，不拦保存。
 */
export function checkCharacterAnchors(entries, options = {}) {
  const list = asList(entries)
  const aliasIndex = options.aliasIndex ?? createAliasIndex(list)
  const characters = list.filter((entry) => entry.layer === 'character')
  const characterNames = new Set(characters.map((entry) => str(entry.name).trim()).filter(Boolean))

  const referenced = new Map()
  for (const plot of list.filter((entry) => entry.layer === 'plot')) {
    for (const event of Array.isArray(plot.events) ? plot.events : []) {
      if (!isPlainObject(event) || !Array.isArray(event.refs)) continue
      for (const ref of event.refs) {
        const raw = str(ref).trim()
        if (!raw) continue
        const canonical = aliasIndex.resolve(raw) ?? raw
        if (!characterNames.has(canonical)) continue
        const hits = referenced.get(canonical) ?? []
        hits.push({ plotId: str(plot.id), plotName: str(plot.name), eventIndex: Number.isInteger(event.index) ? event.index : null })
        referenced.set(canonical, hits)
      }
    }
  }

  const assertions = []
  for (const entry of characters) {
    const entryId = str(entry.id)
    const name = str(entry.name)
    const anchors = isPlainObject(entry.anchors) ? entry.anchors : {}
    const channels = {}
    for (const channel of CHARACTER_ANCHOR_CHANNELS) channels[channel] = stringArray(anchors[channel]).filter(Boolean)

    for (const channel of CHARACTER_ANCHOR_CHANNELS) {
      const seen = new Map()
      channels[channel].forEach((line, index) => {
        if (seen.has(line)) {
          assertions.push(makeAssertion({
            category: GATE_CATEGORIES.characterAnchors,
            rule: 'ANCHOR_DUPLICATE',
            entryId,
            key: `${channel}:${index}`,
            message: `角色「${name}」的 ${channel} 锚点重复：「${line}」`,
            details: { character: name, channel, line, firstIndex: seen.get(line), index }
          }))
        } else {
          seen.set(line, index)
        }
      })
    }

    const behaviorSet = new Set(channels.behavior)
    const uniqueSpeech = [...new Set(channels.speech)]
    uniqueSpeech.forEach((line, index) => {
      if (!behaviorSet.has(line)) return
      assertions.push(makeAssertion({
        category: GATE_CATEGORIES.characterAnchors,
        rule: 'ANCHOR_CHANNEL_CONFLICT',
        entryId,
        key: `speech-behavior:${index}`,
        message: `角色「${name}」同一句既列为 speech 又列为 behavior：「${line}」`,
        details: { character: name, line, channels: ['speech', 'behavior'] }
      }))
    })

    const speechSet = new Set(channels.speech)
    channels.catchphrase.forEach((line, index) => {
      if (speechSet.has(line)) return
      assertions.push(makeAssertion({
        category: GATE_CATEGORIES.characterAnchors,
        rule: 'CATCHPHRASE_UNANCHORED',
        entryId,
        key: `catchphrase:${index}`,
        message: `角色「${name}」的口头禅「${line}」没有落在 speech 锚点里`,
        details: { character: name, line, index }
      }))
    })

    const hasAnchors = CHARACTER_ANCHOR_CHANNELS.some((channel) => channels[channel].length)
    const hits = referenced.get(aliasIndex.resolve(name) ?? name) ?? []
    if (hits.length && !hasAnchors) {
      assertions.push(makeAssertion({
        category: GATE_CATEGORIES.characterAnchors,
        rule: 'CHARACTER_REFERENCED_WITHOUT_ANCHORS',
        entryId,
        message: `角色「${name}」被剧情事件引用 ${hits.length} 次，但没有任何言行锚点（U2）`,
        details: { character: name, referencedBy: hits.slice(0, 8), total: hits.length }
      }))
    }

    const tier = str(entry.castRole?.tier)
    if (tier === 'protagonist' && !hasAnchors) {
      assertions.push(makeAssertion({
        category: GATE_CATEGORIES.characterAnchors,
        rule: 'PROTAGONIST_WITHOUT_ANCHORS',
        entryId,
        message: `主角「${name}」没有任何言行锚点（speech/behavior/catchphrase 全空）`,
        details: { character: name }
      }))
    }
  }
  return assertions
}

/* ---------- 2) 世界规则 vs events 槽位 ---------- */

/** 结构化约束：顶层 constraint 或 next.constraint；数组逐条收，{key|name|subject, value}。 */
export function structuredConstraintsOf(entry) {
  const candidates = []
  for (const source of [entry?.constraint, entry?.next?.constraint]) {
    if (Array.isArray(source)) candidates.push(...source)
    else if (isPlainObject(source)) candidates.push(source)
  }
  const constraints = []
  for (const item of candidates) {
    if (!isPlainObject(item)) continue
    const key = firstText(item.key, item.name, item.subject)
    if (!key) continue
    const value = Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : null
    constraints.push({ key, value })
  }
  return constraints
}

/**
 * 规则/事件槽位的确定性冲突：
 *   - 两条规则声明同一别名词 → RULE_TERM_CONFLICT（warning）；
 *   - 同一约束 key 在同一时点给出不同 value → RULE_RULE_CONFLICT / RULE_EVENT_CONFLICT（error）/
 *     EVENT_CONSTRAINT_CONFLICT（事件之间，warning：历史演变可能合法，交人判断）；
 *   - 同一规则内同一 key 声明两次 → RULE_CONSTRAINT_DUPLICATE（warning）。
 * 没有结构化约束的条目一律进 undecidable（NO_STRUCTURED_CONSTRAINT），不猜。
 */
export function checkWorldRules(entries, options = {}) {
  const list = asList(entries)
  const aliasIndex = options.aliasIndex ?? createAliasIndex(list)
  const assertions = []
  const undecidable = []

  const rulesEntries = list.filter((entry) => entry.layer === 'worldview' && str(entry.slot) === 'rules')
  const rulesByName = new Map(rulesEntries.map((entry) => [str(entry.name).trim(), entry]))
  for (const conflict of aliasIndex.conflicts()) {
    const left = rulesByName.get(conflict.claimants[0])
    const right = rulesByName.get(conflict.claimants[1])
    if (!left || !right) continue
    assertions.push(makeAssertion({
      category: GATE_CATEGORIES.worldRules,
      rule: 'RULE_TERM_CONFLICT',
      entryId: str(left.id),
      key: conflict.term,
      message: `规则「${str(left.name)}」与「${str(right.name)}」都声明了词「${conflict.term}」，指向不唯一`,
      details: { term: conflict.term, claimants: [...conflict.claimants], otherEntryId: str(right.id) }
    }))
  }

  const constrained = []
  const subjects = list.filter((entry) => entry.layer === 'worldview' && (str(entry.slot) === 'rules' || str(entry.slot) === 'events'))
  for (const entry of subjects) {
    const slot = str(entry.slot)
    const constraints = structuredConstraintsOf(entry)
    if (!constraints.length) {
      undecidable.push({
        category: GATE_CATEGORIES.worldRules,
        entryId: str(entry.id),
        name: str(entry.name),
        slot,
        decidable: false,
        reason: 'NO_STRUCTURED_CONSTRAINT',
        message: `${slot === 'rules' ? '规则' : '事件'}「${str(entry.name)}」只有自由文本，没有结构化约束字段（constraint:{key,value}），冲突不可判定`
      })
      continue
    }
    const seenKeys = new Set()
    for (const constraint of constraints) {
      if (seenKeys.has(constraint.key)) {
        assertions.push(makeAssertion({
          category: GATE_CATEGORIES.worldRules,
          rule: 'RULE_CONSTRAINT_DUPLICATE',
          entryId: str(entry.id),
          key: constraint.key,
          message: `条目「${str(entry.name)}」对约束 key「${constraint.key}」声明了多次`,
          details: { key: constraint.key }
        }))
      }
      seenKeys.add(constraint.key)
      constrained.push({ entry, slot, key: constraint.key, value: constraint.value, validity: entry.validity })
    }
  }

  for (let leftIndex = 0; leftIndex < constrained.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < constrained.length; rightIndex += 1) {
      const left = constrained[leftIndex]
      const right = constrained[rightIndex]
      if (left.key !== right.key) continue
      if (stableStringify(left.value) === stableStringify(right.value)) continue
      const overlap = intersectValidity(validityBounds(left.validity), validityBounds(right.validity))
      if (!overlap) continue
      const involvesRule = left.slot === 'rules' || right.slot === 'rules'
      const rule = left.slot === 'rules' && right.slot === 'rules'
        ? 'RULE_RULE_CONFLICT'
        : (involvesRule ? 'RULE_EVENT_CONFLICT' : 'EVENT_CONSTRAINT_CONFLICT')
      assertions.push(makeAssertion({
        category: GATE_CATEGORIES.worldRules,
        rule,
        severity: involvesRule ? 'error' : 'warning',
        entryId: str(left.entry.id),
        key: left.key,
        message: `约束「${left.key}」在时段 ${formatSpan(overlap)} 内取值冲突：「${str(left.entry.name)}」=${stableStringify(left.value)}，「${str(right.entry.name)}」=${stableStringify(right.value)}`,
        details: {
          key: left.key,
          overlap,
          left: { entryId: str(left.entry.id), name: str(left.entry.name), slot: left.slot, value: left.value },
          right: { entryId: str(right.entry.id), name: str(right.entry.name), slot: right.slot, value: right.value }
        }
      }))
    }
  }

  return { assertions, undecidable }
}

/* ---------- 3) 时间轴 ---------- */

function isStructurePlot(entry) {
  const next = entry?.next
  return isPlainObject(next) && (next.structure === 'outline' || typeof next.anchor_kind === 'string')
}

function eventIndices(entry) {
  return new Set((Array.isArray(entry?.events) ? entry.events : [])
    .filter(isPlainObject)
    .map((event) => event.index)
    .filter((index) => Number.isInteger(index)))
}

/**
 * 双时间轴的全库批量校验（P1 只有单条 validity 形状校验，这里出冲突清单）：
 *   - VALIDITY_RANGE_INVERTED：条目 validity.from > to；
 *   - KNOWLEDGE_RANGE_INVERTED：知情记录 atSpan.from > to；
 *   - EVENT_INDEX_DUPLICATE：同一 plot 内事件序号重复；
 *   - EVENT_OUTSIDE_PLOT_VALIDITY：带结构锚点（anchor）的事件序号越出 plot validity；
 *   - PLOT_EVENT_INDEX_COLLISION：同域两份结构 plot 在重叠时段用同一事件序号（warning）。
 * 结构锚点口径只认 convert 产出的 plot（next.structure=outline / anchor_kind），
 * 流水线草稿的事件序号是段内序号，不是章号，不套用本条。
 */
export function checkTimeline(entries) {
  const list = asList(entries)
  const assertions = []

  for (const entry of list) {
    const bounds = validityBounds(entry.validity)
    if (bounds.from !== null && bounds.to !== null && bounds.from > bounds.to) {
      assertions.push(makeAssertion({
        category: GATE_CATEGORIES.timeline,
        rule: 'VALIDITY_RANGE_INVERTED',
        severity: 'error',
        entryId: str(entry.id),
        message: `条目「${str(entry.name)}」的 validity 区间倒置：${formatSpan(bounds)}`,
        details: { validity: { ...bounds } }
      }))
    }
  }

  for (const entry of list) {
    if (!Array.isArray(entry.knowledge)) continue
    entry.knowledge.forEach((record, index) => {
      if (!isPlainObject(record)) return
      const bounds = validityBounds(record.atSpan)
      if (bounds.from === null || bounds.to === null || bounds.from <= bounds.to) return
      assertions.push(makeAssertion({
        category: GATE_CATEGORIES.timeline,
        rule: 'KNOWLEDGE_RANGE_INVERTED',
        severity: 'error',
        entryId: str(entry.id),
        key: `knowledge:${index}`,
        message: `角色「${str(entry.name)}」第 ${index + 1} 条知情的 atSpan 区间倒置：${formatSpan(bounds)}`,
        details: { character: str(entry.name), index, atSpan: { ...bounds } }
      }))
    })
  }

  const plots = list.filter((entry) => entry.layer === 'plot')
  for (const plot of plots) {
    const events = Array.isArray(plot.events) ? plot.events.filter(isPlainObject) : []
    const byIndex = new Map()
    for (const event of events) {
      if (!Number.isInteger(event.index)) continue
      const first = byIndex.get(event.index)
      if (first) {
        assertions.push(makeAssertion({
          category: GATE_CATEGORIES.timeline,
          rule: 'EVENT_INDEX_DUPLICATE',
          severity: 'error',
          entryId: str(plot.id),
          key: `event:${event.index}`,
          message: `plot「${str(plot.name)}」的事件序号 ${event.index} 重复（「${str(first.title)}」／「${str(event.title)}」）`,
          details: { index: event.index, firstTitle: str(first.title), secondTitle: str(event.title) }
        }))
      } else {
        byIndex.set(event.index, event)
      }
      if (!isPlainObject(event.anchor)) continue
      const bounds = validityBounds(plot.validity)
      const outside = (bounds.from !== null && event.index < bounds.from) || (bounds.to !== null && event.index > bounds.to)
      if (!outside) continue
      assertions.push(makeAssertion({
        category: GATE_CATEGORIES.timeline,
        rule: 'EVENT_OUTSIDE_PLOT_VALIDITY',
        severity: 'error',
        entryId: str(plot.id),
        key: `event:${event.index}`,
        message: `plot「${str(plot.name)}」的事件序号 ${event.index} 越出其 validity ${formatSpan(bounds)}`,
        details: { index: event.index, validity: { ...bounds } }
      }))
    }
  }

  const structurePlots = plots.filter(isStructurePlot)
  for (let leftIndex = 0; leftIndex < structurePlots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < structurePlots.length; rightIndex += 1) {
      const left = structurePlots[leftIndex]
      const right = structurePlots[rightIndex]
      if (str(left.domain) !== str(right.domain)) continue
      if (!spansOverlap(validityBounds(left.validity), validityBounds(right.validity))) continue
      const rightIndices = eventIndices(right)
      const shared = [...eventIndices(left)].filter((index) => rightIndices.has(index)).sort((a, b) => a - b)
      if (!shared.length) continue
      assertions.push(makeAssertion({
        category: GATE_CATEGORIES.timeline,
        rule: 'PLOT_EVENT_INDEX_COLLISION',
        entryId: str(left.id),
        key: str(right.id),
        message: `同域 plot「${str(left.name)}」与「${str(right.name)}」在重叠时段使用相同事件序号：${shared.join('/')}`,
        details: { indices: shared, otherEntryId: str(right.id), otherName: str(right.name) }
      }))
    }
  }

  return assertions
}

/* ---------- 4) 知情一致性（precheck 批量版） ---------- */

/**
 * 知情矩阵 + 引用生效区间的全库校验：
 *   - KNOWLEDGE_FROM_UNRESOLVED：fromEntry 解析不到条目（warning）；
 *   - KNOWLEDGE_PREDATES_SOURCE：知情起点早于来源事件/设定的生效起点（error：不可能先知后发生）；
 *   - KNOWLEDGE_DUPLICATE：同一角色重复记同一条知情（warning）；
 *   - 逐 plot 事件跑 precheckDraft：REFERENCE_OUTSIDE_VALIDITY（error）与
 *     REFERENCE_UNRESOLVED（warning）升到库级清单里。
 * 视角（PERSPECTIVE_LEAK）仍按事件无法判定 POV，留给写作时的 precheckDraft（见 limitations）。
 */
export function checkKnowledge(entries, options = {}) {
  const list = asList(entries)
  const aliasIndex = options.aliasIndex ?? createAliasIndex(list)
  const assertions = []

  for (const entry of list.filter((item) => item.layer === 'character')) {
    const records = Array.isArray(entry.knowledge) ? entry.knowledge : []
    const seen = new Set()
    records.forEach((record, index) => {
      if (!isPlainObject(record)) return
      const fromEntry = str(record.fromEntry).trim()
      if (!fromEntry) return
      const canonical = aliasIndex.resolve(fromEntry) ?? fromEntry
      const source = list.find((item) => str(item.name).trim() === canonical)
      if (!source) {
        assertions.push(makeAssertion({
          category: GATE_CATEGORIES.knowledge,
          rule: 'KNOWLEDGE_FROM_UNRESOLVED',
          entryId: str(entry.id),
          key: `knowledge:${index}`,
          message: `角色「${str(entry.name)}」的知情来源「${fromEntry}」在条目集里找不到`,
          details: { character: str(entry.name), fromEntry, index }
        }))
      } else {
        const recordFrom = validityBounds(record.atSpan).from
        const sourceFrom = validityBounds(source.validity).from
        if (recordFrom !== null && sourceFrom !== null && recordFrom < sourceFrom) {
          assertions.push(makeAssertion({
            category: GATE_CATEGORIES.knowledge,
            rule: 'KNOWLEDGE_PREDATES_SOURCE',
            severity: 'error',
            entryId: str(entry.id),
            key: `knowledge:${index}`,
            message: `角色「${str(entry.name)}」在第 ${recordFrom} 章就知道「${canonical}」，但该来源从第 ${sourceFrom} 章才生效`,
            details: { character: str(entry.name), fromEntry: canonical, knownFrom: recordFrom, sourceFrom, index }
          }))
        }
      }
      const key = `${canonical}|${str(record.kind)}|${stableStringify(record.atSpan)}`
      if (seen.has(key)) {
        assertions.push(makeAssertion({
          category: GATE_CATEGORIES.knowledge,
          rule: 'KNOWLEDGE_DUPLICATE',
          entryId: str(entry.id),
          key: `knowledge:${index}`,
          message: `角色「${str(entry.name)}」重复记录了同一条知情（${fromEntry}／${str(record.kind)}）`,
          details: { character: str(entry.name), fromEntry: canonical, index }
        }))
      } else {
        seen.add(key)
      }
    })
  }

  for (const plot of list.filter((item) => item.layer === 'plot')) {
    for (const event of Array.isArray(plot.events) ? plot.events : []) {
      if (!isPlainObject(event)) continue
      const refs = Array.isArray(event.refs) ? event.refs.map((ref) => str(ref).trim()).filter(Boolean) : []
      if (!refs.length) continue
      const atSpan = Number.isInteger(event.index) ? event.index : null
      const result = precheckDraft({
        draft: { name: `${str(plot.name)}#${event.index ?? '?'}`, refs, atSpan },
        entries: list
      }, { aliasIndex })
      const eventKey = `event:${event.index ?? '?'}`
      result.issues.forEach((issue, index) => {
        assertions.push(makeAssertion({
          category: GATE_CATEGORIES.knowledge,
          rule: str(issue.code),
          severity: 'error',
          entryId: str(plot.id),
          key: `${eventKey}:${index}`,
          message: `事件 ${event.index ?? '?'}：${str(issue.message)}`,
          details: { eventIndex: event.index ?? null, ref: issue.ref ?? null, code: str(issue.code), atSpan }
        }))
      })
      result.warnings.forEach((warning, index) => {
        assertions.push(makeAssertion({
          category: GATE_CATEGORIES.knowledge,
          rule: str(warning.code),
          entryId: str(plot.id),
          key: `${eventKey}:${index}`,
          message: `事件 ${event.index ?? '?'}：${str(warning.message)}`,
          details: { eventIndex: event.index ?? null, code: str(warning.code), atSpan }
        }))
      })
    }
  }

  return assertions
}

/* ---------- 归一化报告（别名合并＋分类归并） ---------- */

/**
 * 归一化结构报告：别名并组、声明冲突、分类表规模与实际落槽分布。
 * 只报告同一条目内 name＋aliases 的合并；跨条目同义不猜（冲突如实列出）。
 */
export function buildNormalizationReport(entries, options = {}) {
  const list = asList(entries)
  const aliasIndex = options.aliasIndex ?? createAliasIndex(list)
  const groups = aliasIndex.groups()
  const conflicts = aliasIndex.conflicts()
  const used = {}
  for (const entry of list) {
    if (entry.layer !== 'worldview') continue
    const slot = str(entry.slot).trim() || OTHER_SLOT
    used[slot] = (used[slot] ?? 0) + 1
  }
  return {
    ok: conflicts.length === 0,
    alias: {
      terms: aliasIndex.size(),
      groups,
      mergedGroups: groups.filter((group) => group.aliases.length).length,
      conflicts
    },
    categories: {
      tableSize: Object.keys(CATEGORY_MAP).length,
      slots: [...Object.keys(WORLDVIEW_SLOTS)],
      used,
      otherCount: used[OTHER_SLOT] ?? 0
    }
  }
}

/* ---------- round-trip 保真（端口注入） ---------- */

/** 语义实体名集合：条目名 ∪ plot 事件 refs ∪ 关系目标（跨载体都算「实体」）。 */
function entitiesOf(list) {
  const names = new Set()
  for (const entry of list) {
    const name = str(entry.name).trim()
    if (name) names.add(name)
    for (const event of Array.isArray(entry.events) ? entry.events : []) {
      if (!isPlainObject(event) || !Array.isArray(event.refs)) continue
      for (const ref of event.refs) {
        const title = str(ref).trim()
        if (title) names.add(title)
      }
    }
    for (const relation of Array.isArray(entry.relations) ? entry.relations : []) {
      if (!isPlainObject(relation)) continue
      const to = str(relation.to).trim()
      if (to) names.add(to)
    }
  }
  return [...names]
}

function relationPairsOf(list) {
  const pairs = []
  for (const entry of list) {
    const from = str(entry.name).trim()
    if (!from) continue
    for (const relation of Array.isArray(entry.relations) ? entry.relations : []) {
      if (!isPlainObject(relation)) continue
      const to = str(relation.to).trim()
      if (!to) continue
      pairs.push(`${from}→${to}|${str(relation.type)}`)
    }
  }
  return pairs
}

function anchorsOf(list) {
  const map = new Map()
  for (const entry of list) {
    if (entry.layer !== 'character') continue
    const name = str(entry.name).trim()
    if (!name) continue
    const anchors = isPlainObject(entry.anchors) ? entry.anchors : {}
    map.set(name, {
      speech: stringArray(anchors.speech).filter(Boolean),
      behavior: stringArray(anchors.behavior).filter(Boolean),
      catchphrase: stringArray(anchors.catchphrase).filter(Boolean)
    })
  }
  return map
}

/**
 * 语义要素比对（导出前 vs 回读后）：
 *   - entities  实体名集合：缺失即丢实体；
 *   - relations 关系对（from→to|type）：缺失即丢关系；
 *   - anchors   人物锚点逐行：缺失即丢塑造锚点。
 * 只比结构语义，不比对行文；载体本身做不到的字段由调用方在 losses 里记账。
 */
export function buildRoundTripReport(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const before = asList(source.before)
  const after = asList(source.after)
  const losses = Array.isArray(source.losses) ? source.losses.map((item) => (isPlainObject(item) ? { ...item } : { code: 'LOSS', message: str(item) })) : []
  const warnings = Array.isArray(source.warnings) ? source.warnings.map((item) => (isPlainObject(item) ? { ...item } : { code: 'WARNING', message: str(item) })) : []
  const notes = Array.isArray(source.notes) ? source.notes.map((item) => str(item)) : []

  const expectedEntities = entitiesOf(before)
  const actualEntities = entitiesOf(after)
  const actualEntitySet = new Set(actualEntities)
  const expectedEntitySet = new Set(expectedEntities)
  const entities = {
    expected: expectedEntities,
    actual: actualEntities,
    missing: expectedEntities.filter((name) => !actualEntitySet.has(name)),
    extra: actualEntities.filter((name) => !expectedEntitySet.has(name))
  }

  const expectedRelations = relationPairsOf(before)
  const actualRelations = relationPairsOf(after)
  const actualRelationSet = new Set(actualRelations)
  const expectedRelationSet = new Set(expectedRelations)
  const relations = {
    expected: expectedRelations,
    actual: actualRelations,
    missing: expectedRelations.filter((pair) => !actualRelationSet.has(pair)),
    extra: actualRelations.filter((pair) => !expectedRelationSet.has(pair))
  }

  const beforeAnchors = anchorsOf(before)
  const afterAnchors = anchorsOf(after)
  const missingAnchors = []
  let checkedAnchors = 0
  for (const [character, channels] of beforeAnchors) {
    const restored = afterAnchors.get(character)
    for (const channel of CHARACTER_ANCHOR_CHANNELS) {
      for (const line of channels[channel]) {
        checkedAnchors += 1
        if (restored && restored[channel].includes(line)) continue
        missingAnchors.push({ character, channel, line })
      }
    }
  }

  return {
    ok: entities.missing.length === 0 && relations.missing.length === 0 && missingAnchors.length === 0,
    entities,
    relations,
    anchors: { checked: checkedAnchors, missing: missingAnchors },
    losses,
    warnings,
    notes
  }
}

function runRoundTripPort(port, entries) {
  const skipped = (reason) => ({ ok: true, skipped: true, reason, losses: [], warnings: [], notes: [] })
  if (typeof port !== 'function') {
    return skipped('未注入 roundTrip 端口：pedia 层不 import wikihub/convert（宿主或测试注入导出→回读）')
  }
  let raw
  try {
    raw = port(entries)
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: { code: 'ROUNDTRIP_FAILED', message: str(error?.message ?? error) },
      losses: [],
      warnings: [],
      notes: []
    }
  }
  if (raw && typeof raw.then === 'function') {
    return {
      ok: false,
      skipped: false,
      error: { code: 'ROUNDTRIP_ASYNC', message: 'roundTrip 端口必须同步返回；异步导出请在宿主侧 await 后再调用 runPediaGate' },
      losses: [],
      warnings: [],
      notes: []
    }
  }
  if (Array.isArray(raw)) return { ...buildRoundTripReport({ before: entries, after: raw }), skipped: false }
  if (isPlainObject(raw) && Array.isArray(raw.after)) {
    return {
      ...buildRoundTripReport({ before: entries, after: raw.after, losses: raw.losses, warnings: raw.warnings, notes: raw.notes }),
      skipped: false
    }
  }
  if (isPlainObject(raw) && isPlainObject(raw.entities) && isPlainObject(raw.relations)) {
    return { ...raw, skipped: false }
  }
  return {
    ok: false,
    skipped: false,
    error: { code: 'ROUNDTRIP_SHAPE', message: 'roundTrip 端口须返回 { after: [...], losses }、条目数组或完整报告' },
    losses: [],
    warnings: [],
    notes: []
  }
}

/* ---------- 汇总出口 ---------- */

/**
 * 全量门禁：四类断言 + 归一化报告 + 可选的 round-trip 端口。
 *
 * @param {Object[]} entries pedia/v2 条目
 * @param {Object} [options] { aliasIndex, roundTrip }
 *   roundTrip(entries) → { after, losses, warnings?, notes? } | 条目数组 | buildRoundTripReport 形状
 * @returns {{ ok, version, assertions, conflicts, undecidable, roundTrip, normalization, counts, warnings }}
 */
export function runPediaGate(entries, options = {}) {
  const source = Array.isArray(entries) ? entries : []
  const list = source.filter(isPlainObject)
  const warnings = []
  if (source.length !== list.length) {
    warnings.push({ code: 'ENTRY_DROPPED', message: `${source.length - list.length} 个非对象条目被跳过` })
  }
  if (!list.length) {
    warnings.push({ code: 'EMPTY_ENTRY_SET', message: '没有条目可扫描：门禁按空集通过' })
  }

  const aliasIndex = options.aliasIndex ?? createAliasIndex(list)
  const worldRules = checkWorldRules(list, { aliasIndex })
  const assertions = [
    ...checkCharacterAnchors(list, { aliasIndex }),
    ...worldRules.assertions,
    ...checkTimeline(list),
    ...checkKnowledge(list, { aliasIndex })
  ]
  const conflicts = assertions.filter((item) => item.severity === 'error' && item.decidable)
  const roundTrip = runRoundTripPort(options.roundTrip, list)
  const normalization = buildNormalizationReport(list, { aliasIndex })

  const byCategory = {}
  for (const item of assertions) {
    const bucket = byCategory[item.category] ?? { error: 0, warning: 0 }
    bucket[item.severity] += 1
    byCategory[item.category] = bucket
  }

  return {
    ok: conflicts.length === 0 && roundTrip.ok !== false,
    version: PEDIA_GATE_VERSION,
    assertions,
    conflicts,
    undecidable: worldRules.undecidable,
    roundTrip,
    normalization,
    counts: {
      entries: list.length,
      assertions: assertions.length,
      errors: conflicts.length,
      warnings: assertions.length - conflicts.length,
      undecidable: worldRules.undecidable.length,
      byCategory
    },
    warnings
  }
}

function formatSpan(span) {
  const bounds = validityBounds(span)
  const from = bounds.from === null ? '−∞' : bounds.from
  const to = bounds.to === null ? '+∞' : bounds.to
  return `${from}..${to}`
}
