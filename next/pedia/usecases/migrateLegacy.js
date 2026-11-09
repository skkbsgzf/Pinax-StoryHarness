/**
 * P2b 存量迁移器（usecases 层）：Pinax 现有数据 → pedia/v2。
 *
 * ADR D2/D2b：存量数据单向迁入 pedia，迁完 Host store 降级为投影缓存。
 * 本文件只做「库层」四件事，全部注入式输入（不读真实盘、不依赖宿主模块）：
 *
 *   1) worldStore 条目 → worldview（category/group 走 category_map 归 11 槽位）；
 *   2) 大纲 nodes/edges → plot 事件图（causes→causal，foreshadows→hypothesis 轨 setup，
 *      alternative/parallel→relation 边）；
 *   3) 事实账本 v4 条目 → 双时间轴（validity 直接映射）＋ 知情字段 → character.knowledge[]；
 *   4) 章节正文 → 场景骨架（100–300 字段单元，pipelinePending=true，精抽取留给 P2a 管线）。
 *
 * 通用纪律：
 *   - 迁入条目一律 status='proposed'（等仲裁转正），provenance.mode 按来源给 author；
 *   - 条目内容全部确定性生成（无时间戳/随机数），operationId 由内容哈希派生，
 *     重跑同一 fixture = 全量 duplicate，diff=0；
 *   - dryRun=true 只出完整报告，不碰 store；
 *   - 语义有损的部分进 losses[] 如实记账，不静默降级。
 *
 * 不读写磁盘、不接工具面：PediaStore 从端口注入（Core 平移后只换 import 路径）。
 */

import {
  CATEGORY_MAP,
  KNOWLEDGE_KINDS,
  OTHER_SLOT,
  PEDIA_SCHEMA,
  isOrderedSlot,
  slotForCategory
} from '../domain/vocabulary.js'
import { sha1Hex, stableEntryId } from '../domain/stableId.js'
import { validatePediaEntry } from '../domain/schema.js'
import { validityFromSpan } from '../domain/validity.js'
import { charCount, segmentStats, segmentText } from '../domain/segment.js'
import { assertPediaStore } from '../ports/pediaStore.js'
import { persistEntries } from './pipeline/extract.js'

export const LEGACY_MIGRATE_VERSION = 'legacy-migrate@1'
export const LEGACY_WORLDBOOK_EXTRACTOR = 'pinax/legacy-worldStore@1'
export const LEGACY_OUTLINE_EXTRACTOR = 'pinax/legacy-outline@1'
export const LEGACY_LEDGER_EXTRACTOR = 'pinax/legacy-ledger@1'
export const LEGACY_CHAPTER_EXTRACTOR = 'pinax/legacy-chapter@1'

/** 迁移条目一律先落 proposed，由仲裁流程转 adopted。 */
export const MIGRATED_STATUS = 'proposed'

/** 迁移路径 id（报告与 operationId 都用它）。 */
export const MIGRATE_PATHS = Object.freeze(['worldStore', 'outline', 'ledger', 'chapters'])

/** 调用方没给 domain 时的兜底域（保证 worldview 必填 domain 成立）。 */
export const DEFAULT_MIGRATE_DOMAIN = 'legacy'

/** 章节骨架尚未精抽取：这些条目由 P2a 管线补跑。 */
export const CHAPTER_SKELETON_PENDING = true

/* ---------- 通用小工具 ---------- */

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

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map((item) => str(item).trim()).filter(Boolean) : []
}

function uniqueStrings(values) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const text = str(value).trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function integerList(values) {
  const list = Array.isArray(values) ? values.filter((value) => Number.isInteger(value)) : []
  return [...new Set(list)].sort((left, right) => left - right)
}

function refNames(value) {
  return uniqueStrings((Array.isArray(value) ? value : []).map((item) => (
    isPlainObject(item) ? firstText(item.documentId, item.id, item.title, item.name) : item
  )))
}

function cloneJson(value) {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? null : JSON.parse(text)
  } catch {
    return null
  }
}

function countBy(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

function firstParagraph(text, limit) {
  const normalized = str(text).replace(/\r\n?/gu, '\n').trim()
  if (!normalized) return ''
  const paragraph = normalized.split(/\n\s*\n/u)[0].replace(/\s+/gu, ' ').trim()
  return paragraph.length > limit ? `${paragraph.slice(0, limit)}…` : paragraph
}

/** validity 只接受整数或 null；形状不对返回 null（调用方决定 warning）。 */
function validityOrNull(value) {
  if (!isPlainObject(value)) return null
  const out = {}
  for (const key of ['from', 'to']) {
    const raw = value[key]
    if (raw === undefined || raw === null) out[key] = null
    else if (Number.isInteger(raw)) out[key] = raw
    else return null
  }
  if (out.from !== null && out.to !== null && out.from > out.to) return null
  return out
}

function resolveDomain(options, input) {
  const source = isPlainObject(input) ? input : {}
  return firstText(options.domain, source.domain, options.book, source.book, DEFAULT_MIGRATE_DOMAIN)
}

function resolveBook(options, input, domain) {
  const source = isPlainObject(input) ? input : {}
  return firstText(options.book, source.book, domain)
}

/** 校验整批条目：硬错误不进 entries（记 issues），警告不拦转。 */
function finalize(path, entries, losses, warnings, issues) {
  const valid = []
  for (const entry of entries) {
    const result = validatePediaEntry(entry)
    if (!result.ok) {
      issues.push({ code: 'ENTRY_INVALID', path, id: entry.id, name: entry.name, errors: result.errors })
      continue
    }
    valid.push(entry)
  }
  return { ok: issues.length === 0, path, entries: valid, losses, warnings, issues }
}

/* ---------- 路径 1：worldStore → worldview ---------- */

const WORLDBOOK_RELATION_CHANNELS = Object.freeze(['characters', 'locations', 'tags', 'events', 'organizations', 'items'])

function collectWorldStoreEntries(input) {
  if (Array.isArray(input)) return input
  if (!isPlainObject(input)) return []
  if (Array.isArray(input.entries)) return input.entries
  if (input.name || input.id) return [input]
  return []
}

function isKnownTarget(target, knownNames) {
  return knownNames.has(target)
}

/**
 * 世界书 relations 两种形状都收：
 *   - 数组 [{to, type, how}]（新一点的手写形状）；
 *   - 对象 { characters: [...], locations: [...], tags: [...], events: [...] }（worldStore 运行时形状）。
 * 每条关系保留 origin/channel，后续可回溯到 Host 字段。
 */
function normalizeWorldStoreRelations(raw, name, knownNames, warnings) {
  const relations = []
  const seen = new Set()
  const push = (targetValue, type, how, channel, rawItem) => {
    const target = firstText(targetValue)
    if (!target) {
      warnings.push({ code: 'RELATION_WITHOUT_TARGET', entry: name, channel, message: `条目「${name}」有一条关系没有目标，已跳过` })
      return
    }
    const key = `${target}|${type}`
    if (seen.has(key)) return
    seen.add(key)
    if (!isKnownTarget(target, knownNames)) {
      warnings.push({
        code: 'RELATION_TARGET_UNRESOLVED',
        entry: name,
        target,
        channel,
        message: `条目「${name}」的关系目标「${target}」不在本次输入里（保留原值）`
      })
    }
    const relation = { to: target, type, next: { origin: 'worldStore', channel, raw: cloneJson(rawItem) } }
    if (how) relation.how = how
    relations.push(relation)
  }

  if (Array.isArray(raw.relations)) {
    for (const item of raw.relations) {
      if (isPlainObject(item)) {
        push(
          firstText(item.to, item.target, item.name, item.title),
          firstText(item.type, item.kind, 'related'),
          firstText(item.how, item.note, item.desc),
          'list',
          item
        )
      } else if (typeof item === 'string') {
        push(item, 'related', '', 'list', item)
      }
    }
  } else if (isPlainObject(raw.relations)) {
    for (const [channel, values] of Object.entries(raw.relations)) {
      if (!Array.isArray(values)) continue
      const knownChannel = WORLDBOOK_RELATION_CHANNELS.includes(channel) ? channel : 'other'
      for (const item of values) {
        if (isPlainObject(item)) {
          push(
            firstText(item.to, item.target, item.name, item.title),
            'related',
            firstText(item.how, item.note, item.desc, `世界书关系·${channel}`),
            knownChannel,
            item
          )
        } else {
          push(str(item), 'related', `世界书关系·${channel}`, knownChannel, item)
        }
      }
    }
  }
  return relations
}

function worldbookSnapshot(raw) {
  return {
    id: str(raw.id),
    name: firstText(raw.name, raw.title),
    title: firstText(raw.title, raw.name),
    type: firstText(raw.type, raw.kind),
    kind: firstText(raw.kind, raw.type),
    category: firstText(raw.category),
    group: firstText(raw.group),
    status: firstText(raw.status),
    version: raw.version ?? '',
    tier: raw.tier ?? null,
    tags: arrayOfStrings(raw.tags),
    keys: arrayOfStrings(raw.keys),
    keysSecondary: arrayOfStrings(raw.keysSecondary),
    aliases: arrayOfStrings(raw.aliases),
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    injection: cloneJson(raw.injection) ?? {},
    profile: cloneJson(raw.profile) ?? {},
    extra: cloneJson(raw.extra) ?? {},
    relations: cloneJson(raw.relations),
    content: typeof raw.content === 'string' ? raw.content : '',
    path: firstText(raw.path)
  }
}

function buildWorldbookEntry(raw, name, context) {
  const { domain, book, knownNames, losses, warnings } = context
  const content = typeof raw.content === 'string' ? raw.content : ''
  const category = firstText(
    raw.category,
    raw.group,
    isPlainObject(raw.injection) ? raw.injection.group : '',
    typeof raw.cat === 'string' ? raw.cat : '',
    raw.slot
  )
  const slot = slotForCategory(category)
  if (!category) {
    losses.push({ code: 'worldStore-category-unmapped', entry: name, column: '', message: `条目「${name}」没有 category/group，落 other 槽位` })
  } else if (slot === OTHER_SLOT && !CATEGORY_MAP[category]) {
    losses.push({ code: 'worldStore-category-unmapped', entry: name, category, message: `分类「${category}」不在 category_map 里，落 other 槽位` })
  }

  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  let definition = summary
  if (!definition) {
    definition = firstParagraph(content, 600)
    if (definition) {
      warnings.push({ code: 'DEFINITION_EXCERPT', entry: name, message: `条目「${name}」没有 summary，definition 取自正文首段（摘录而非概括）` })
    } else {
      definition = name
      warnings.push({ code: 'DEFINITION_FALLBACK_NAME', entry: name, message: `条目「${name}」没有摘要与正文，definition 回退为名称` })
    }
  }

  const keys = uniqueStrings([
    ...arrayOfStrings(raw.keys),
    ...arrayOfStrings(raw.keysSecondary),
    ...arrayOfStrings(raw.aliases)
  ])
  const aliases = keys.filter((key) => key !== name)
  const relations = normalizeWorldStoreRelations(raw, name, knownNames, warnings)

  const entry = {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain, slot, name }),
    layer: 'worldview',
    name,
    domain,
    slot,
    status: MIGRATED_STATUS,
    definition,
    provenance: {
      mode: 'author',
      book,
      book_id: firstText(raw.bookId, raw.book_id),
      chapters: [],
      scenes: [],
      extractor: LEGACY_WORLDBOOK_EXTRACTOR,
      source: `worldStore/${str(raw.id)}`
    },
    fingerprint: {
      vec: null,
      metrics: { chars: charCount(content), keys: keys.length, relations: relations.length }
    },
    next: { worldbook: worldbookSnapshot(raw) }
  }
  if (aliases.length) entry.aliases = aliases
  if (relations.length) entry.relations = relations

  const rank = Number.isInteger(raw.rank)
    ? raw.rank
    : (isPlainObject(raw.profile) && Number.isInteger(raw.profile.rank) ? raw.profile.rank : null)
  if (rank !== null && rank >= 1) {
    if (isOrderedSlot(slot)) entry.rank = rank
    else warnings.push({ code: 'RANK_ON_UNORDERED_SLOT', entry: name, message: `槽位 ${slot} 无序，rank=${rank} 未带入` })
  }

  if (raw.validity !== undefined && raw.validity !== null) {
    const validity = validityOrNull(raw.validity)
    if (validity) entry.validity = validity
    else warnings.push({ code: 'VALIDITY_IGNORED', entry: name, message: `条目「${name}」的 validity 形状非法，已忽略` })
  }
  return entry
}

/**
 * 路径 1：worldStore 条目 → worldview。
 * @param {Object[]|{entries:Object[]}} input 注入的 legacy store 形状
 * @param {{domain?:string, book?:string}} [options]
 */
export function migrateWorldStore(input, options = {}) {
  const opts = isPlainObject(options) ? options : {}
  const losses = []
  const warnings = []
  const issues = []
  const domain = resolveDomain(opts, input)
  const book = resolveBook(opts, input, domain)

  const normalized = []
  for (const raw of collectWorldStoreEntries(input)) {
    if (!isPlainObject(raw)) continue
    const name = firstText(raw.name, raw.title, arrayOfStrings(raw.keys)[0], raw.id)
    if (!name) {
      issues.push({ code: 'ENTRY_WITHOUT_NAME', path: 'worldStore', id: str(raw.id), message: '世界书条目没有名称/id，无法生成稳定 id' })
      continue
    }
    normalized.push({ raw, name })
  }

  const knownNames = new Set(normalized.map((item) => item.name))
  const entries = normalized.map(({ raw, name }) => buildWorldbookEntry(raw, name, {
    domain, book, knownNames, losses, warnings
  }))
  return finalize('worldStore', entries, losses, warnings, issues)
}

/* ---------- 路径 2：大纲 nodes/edges → plot 事件图 ---------- */

const OUTLINE_EDGE_TYPES = Object.freeze({
  causes: 'causal',
  foreshadows: 'setup',
  alternative: 'alternative',
  parallel: 'parallel'
})

function outlineNodeName(node, titleCounts) {
  const title = node.title
  return titleCounts.get(title) > 1 ? `${title}·${node.id}` : title
}

function buildOutlineNodeEntry(node, name, context) {
  const { domain, book } = context
  const chapterRefs = integerList(node.raw.chapterRefs)
  const explorationRefs = refNames(node.raw.explorationRefs)
  const entry = {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain, slot: '', name }),
    layer: 'plot',
    name,
    domain,
    status: MIGRATED_STATUS,
    fact: firstText(node.raw.intent, node.raw.note, node.raw.summary, node.title),
    events: [{
      index: 1,
      track: 'fact',
      title: node.title,
      refs: [],
      segments: [],
      novelty: []
    }],
    provenance: {
      mode: 'author',
      book,
      book_id: firstText(node.raw.bookId),
      chapters: chapterRefs,
      scenes: [],
      extractor: LEGACY_OUTLINE_EXTRACTOR,
      source: `outline/node/${node.id}`
    },
    fingerprint: {
      vec: null,
      metrics: { chapterRefs: chapterRefs.length, explorationRefs: explorationRefs.length }
    },
    next: {
      outline: {
        id: node.id,
        title: node.title,
        status: firstText(node.raw.status),
        intent: firstText(node.raw.intent),
        chapterRefs,
        explorationRefs,
        raw: cloneJson(node.raw)
      }
    }
  }
  if (chapterRefs.length) {
    entry.validity = validityFromSpan({ first_chapter: chapterRefs[0], last_chapter: chapterRefs[chapterRefs.length - 1] })
    entry.span = {
      chapter_count: chapterRefs.length,
      scene_count: 1,
      first_chapter: chapterRefs[0],
      last_chapter: chapterRefs[chapterRefs.length - 1]
    }
  }
  return entry
}

/**
 * 路径 2：大纲 nodes/edges → plot 条目与关系/假设事件。
 * - causes → relation(type=causal)；
 * - foreshadows → relation(type=setup)＋ hypothesis 轨事件（payoff 只作建议字段）；
 * - alternative/parallel → relation 边（alternative 的语义降级进 losses）；
 * - 自环/缺端点的边丢弃并记账（outline-edge-dropped）。
 */
export function migrateOutline(input, options = {}) {
  const opts = isPlainObject(options) ? options : {}
  const source = isPlainObject(input) ? input : {}
  const losses = []
  const warnings = []
  const issues = []
  const domain = resolveDomain(opts, source)
  const book = resolveBook(opts, source, domain)

  const nodesRaw = Array.isArray(source.nodes) ? source.nodes : []
  const nodes = []
  const nodeIds = new Set()
  for (const raw of nodesRaw) {
    if (!isPlainObject(raw)) continue
    const id = firstText(raw.id)
    if (!id) {
      issues.push({ code: 'OUTLINE_NODE_WITHOUT_ID', path: 'outline', message: '大纲节点缺 id，无法建立边映射' })
      continue
    }
    if (nodeIds.has(id)) {
      warnings.push({ code: 'DUPLICATE_NODE_ID', path: 'outline', id, message: `大纲节点 id「${id}」重复，保留首个` })
      continue
    }
    nodeIds.add(id)
    nodes.push({
      raw,
      id,
      title: firstText(raw.title, `节点${nodes.length + 1}`)
    })
  }

  const titleCounts = countBy(nodes.map((node) => node.title))
  const entries = []
  const entryById = new Map()
  for (const node of nodes) {
    const name = outlineNodeName(node, titleCounts)
    const entry = buildOutlineNodeEntry(node, name, { domain, book })
    entries.push(entry)
    entryById.set(node.id, entry)
  }

  const nameById = new Map()
  for (const [id, entry] of entryById) nameById.set(id, entry.name)

  const edgesRaw = Array.isArray(source.edges) ? source.edges : []
  for (const [index, raw] of edgesRaw.entries()) {
    if (!isPlainObject(raw)) continue
    const edgeId = firstText(raw.id, `edge-${index + 1}`)
    const fromId = firstText(raw.fromNodeId, raw.from)
    const toId = firstText(raw.toNodeId, raw.to)
    const kind = firstText(raw.kind, raw.type, 'causes')
    const sourceEntry = fromId ? entryById.get(fromId) : null
    const targetEntry = toId ? entryById.get(toId) : null
    const sourceName = sourceEntry ? sourceEntry.name : ''
    const targetName = targetEntry ? targetEntry.name : toId

    if (!fromId || !toId || fromId === toId) {
      losses.push({
        code: 'outline-edge-dropped',
        path: 'outline',
        edgeId,
        kind,
        reason: !fromId || !toId ? 'endpoint-missing' : 'self-loop',
        message: `大纲边「${edgeId}」${!fromId || !toId ? '缺端点' : '是自环'}，pedia 事件图不保留`
      })
      continue
    }
    if (!sourceEntry) {
      losses.push({
        code: 'outline-edge-dropped',
        path: 'outline',
        edgeId,
        kind,
        reason: 'source-node-missing',
        message: `大纲边「${edgeId}」的起点节点「${fromId}」不在本次输入里，无法挂接`
      })
      continue
    }
    if (!targetEntry) {
      warnings.push({
        code: 'RELATION_TARGET_UNRESOLVED',
        path: 'outline',
        edgeId,
        target: toId,
        message: `大纲边「${edgeId}」的终点节点「${toId}」不在本次输入里（关系按原 id 保留）`
      })
    }

    const note = firstText(raw.note, raw.label, raw.title)
    const mappedType = OUTLINE_EDGE_TYPES[kind]
    const relationType = mappedType ?? kind
    if (!mappedType) {
      losses.push({
        code: 'outline-edge-kind-unmapped',
        path: 'outline',
        edgeId,
        kind,
        message: `大纲边 kind「${kind}」没有既定 pedia 语义，按普通关系保留`
      })
    }

    const relations = sourceEntry.relations ?? []
    const relationKey = `${relationType}|${targetName}`
    if (!relations.some((relation) => `${relation.type}|${relation.to}` === relationKey)) {
      const relation = {
        to: targetName,
        type: relationType,
        next: { origin: 'outline-edge', edgeId, kind, from: fromId, to: toId }
      }
      const how = firstText(note, kind === 'causes' ? '因果' : kind === 'foreshadows' ? '伏笔' : '')
      if (how) relation.how = how
      relations.push(relation)
      sourceEntry.relations = relations
    }

    if (kind === 'foreshadows') {
      sourceEntry.events.push({
        index: sourceEntry.events.length + 1,
        track: 'hypothesis',
        title: `伏笔·${targetName}`,
        refs: [targetName],
        segments: [],
        novelty: [],
        setup: { edgeId, from: sourceName, to: targetName, note },
        payoffSuggestion: { to: targetName, note: firstText(note, '回收建议') }
      })
      losses.push({
        code: 'outline-payoff-suggestion-only',
        path: 'outline',
        edgeId,
        message: `大纲边「${edgeId}」的伏笔以 hypothesis 轨事件迁入，回收（payoff）只能作建议字段，pedia 没有一等的 payoff 语义`
      })
    }
    if (kind === 'alternative') {
      losses.push({
        code: 'outline-alternative-degraded',
        path: 'outline',
        edgeId,
        message: `大纲边「${edgeId}」是 alternative（未选分支），pedia 只有普通 relation，分支语义降级`
      })
    }
  }

  return finalize('outline', entries, losses, warnings, issues)
}

/* ---------- 路径 3：事实账本 v4 → 双时间轴 / 知情矩阵 ---------- */

function collectLedgerFacts(input) {
  if (Array.isArray(input)) return input
  if (!isPlainObject(input)) return []
  for (const key of ['entries', 'facts', 'factVersions', 'versions']) {
    if (Array.isArray(input[key])) return input[key]
  }
  if (input.subjectKey || input.predicate) return [input]
  return []
}

function collectLedgerKnowledge(input) {
  if (isPlainObject(input) && Array.isArray(input.knowledge)) return input.knowledge
  return []
}

/**
 * validity 映射顺序：pedia 形 {from,to} → validFrom/validTo → 故事时间区间（era ordinal 近似）。
 * 故事时间轴（timelineId/era/ordinal）与 pedia 章/场序不是同一把尺，按 ordinal 近似并记账。
 */
function ledgerValidity(raw, losses) {
  const direct = validityOrNull(raw.validity)
  if (direct) return direct
  if (Number.isInteger(raw.validFrom) || Number.isInteger(raw.validTo)) {
    const from = Number.isInteger(raw.validFrom) ? raw.validFrom : null
    const to = Number.isInteger(raw.validTo) ? raw.validTo : null
    return { from, to }
  }
  const interval = isPlainObject(raw.validInterval)
    ? raw.validInterval
    : (isPlainObject(raw.storyInterval) ? raw.storyInterval : null)
  if (interval) {
    const from = isPlainObject(interval.start) && Number.isInteger(interval.start.ordinal) ? interval.start.ordinal : null
    const to = isPlainObject(interval.end) && Number.isInteger(interval.end.ordinal) ? interval.end.ordinal : null
    if (from !== null || to !== null) {
      losses.push({
        code: 'ledger-story-interval-ordinal-approx',
        path: 'ledger',
        message: '故事时间区间按 era ordinal 近似映射到 pedia validity；跨纪元 ordinal 不可直接比较'
      })
      return { from, to }
    }
    losses.push({
      code: 'ledger-story-interval-unmapped',
      path: 'ledger',
      message: '故事时间区间没有可用的 ordinal 端点，validity 保持无界（原区间留在 next.ledger）'
    })
    return null
  }
  losses.push({
    code: 'ledger-validity-unbounded',
    path: 'ledger',
    message: '账本条目没有时间区间，迁入后 validity 无界'
  })
  return null
}

function buildLedgerFactEntry(item, name, context) {
  const { domain, book, losses } = context
  const { raw, subject, predicate, object } = item
  const entry = {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain, slot: '', name }),
    layer: 'plot',
    name,
    domain,
    status: MIGRATED_STATUS,
    fact: firstText(object, predicate, subject),
    events: [{
      index: 1,
      track: 'fact',
      title: firstText(predicate, object.slice(0, 24), subject),
      refs: [subject],
      segments: [],
      novelty: []
    }],
    provenance: {
      mode: 'author',
      book,
      book_id: firstText(raw.bookId),
      chapters: [],
      scenes: [],
      extractor: LEGACY_LEDGER_EXTRACTOR,
      source: `ledger/fact/${str(raw.id)}`
    },
    fingerprint: { vec: null, metrics: { objectChars: charCount(object) } },
    next: { ledger: cloneJson(raw) ?? {} }
  }
  const validity = ledgerValidity(raw, losses)
  if (validity) entry.validity = validity
  return entry
}

function buildKnowledgeRecord(record, warnings) {
  const kindValid = KNOWLEDGE_KINDS.includes(record.kind)
  const kind = kindValid ? record.kind : 'event'
  if (!kindValid) {
    warnings.push({
      code: 'KNOWLEDGE_KIND_DEFAULTED',
      path: 'ledger',
      character: firstText(record.character, record.who, record.name),
      kind: str(record.kind),
      message: '知情记录 kind 不在 event|setting 里，按 event 迁移'
    })
  }
  return {
    fromEntry: firstText(record.fromEntry, record.entry, record.source, record.subject),
    kind,
    atSpan: validityOrNull(record.atSpan) ?? { from: null, to: null }
  }
}

function buildCharacterKnowledgeEntry(character, records, context) {
  const { domain, book } = context
  return {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'character', domain, slot: '', name: character }),
    layer: 'character',
    name: character,
    domain,
    status: MIGRATED_STATUS,
    knowledge: records,
    provenance: {
      mode: 'author',
      book,
      book_id: '',
      chapters: [],
      scenes: [],
      extractor: LEGACY_LEDGER_EXTRACTOR,
      source: `ledger/knowledge/${character}`
    },
    fingerprint: { vec: null, metrics: { knowledge: records.length } }
  }
}

/**
 * 路径 3：事实账本 v4 → plot 事实条目（validity 直接映射）＋ character.knowledge[]。
 * 账本事实的来源是作者拍板记录，provenance.mode=author。
 */
export function migrateLedger(input, options = {}) {
  const opts = isPlainObject(options) ? options : {}
  const source = isPlainObject(input) ? input : {}
  const losses = []
  const warnings = []
  const issues = []
  const domain = resolveDomain(opts, source)
  const book = resolveBook(opts, source, domain)

  const facts = []
  for (const raw of collectLedgerFacts(input)) {
    if (!isPlainObject(raw)) continue
    const subject = firstText(raw.subjectLabel, raw.subject, raw.subjectKey, raw.entity)
    const predicate = firstText(raw.predicate, raw.action, raw.relation)
    const object = firstText(raw.object, raw.value, raw.objectLabel, raw.claim)
    if (!subject) {
      issues.push({ code: 'LEDGER_ENTRY_WITHOUT_SUBJECT', path: 'ledger', id: str(raw.id), message: '账本事实缺主语，无法生成 pedia 条目' })
      continue
    }
    facts.push({
      raw,
      subject,
      predicate,
      object,
      baseName: `${subject}·${predicate || object.slice(0, 24) || '事实'}`
    })
  }

  const baseCounts = countBy(facts.map((item) => item.baseName))
  const entries = facts.map((item, index) => {
    const name = baseCounts.get(item.baseName) > 1
      ? `${item.baseName}·${firstText(item.raw.id, String(index + 1))}`
      : item.baseName
    return buildLedgerFactEntry(item, name, { domain, book, losses, warnings })
  })

  const knowledgeRaw = [
    ...collectLedgerKnowledge(input),
    ...facts.flatMap((item) => (Array.isArray(item.raw.knowledge) ? item.raw.knowledge : []))
  ]
  const byCharacter = new Map()
  for (const record of knowledgeRaw) {
    if (!isPlainObject(record)) continue
    const character = firstText(record.character, record.who, record.name)
    if (!character) {
      losses.push({ code: 'ledger-knowledge-orphan', path: 'ledger', message: '知情记录没有角色名，无法并入 character.knowledge[]' })
      continue
    }
    const built = buildKnowledgeRecord(record, warnings)
    if (!built.fromEntry) {
      warnings.push({ code: 'KNOWLEDGE_FROM_ENTRY_MISSING', path: 'ledger', character, message: '知情记录缺 fromEntry（从哪条事件/设定获得），已跳过' })
      continue
    }
    if (!byCharacter.has(character)) byCharacter.set(character, [])
    byCharacter.get(character).push(built)
  }
  for (const [character, records] of byCharacter) {
    entries.push(buildCharacterKnowledgeEntry(character, records, { domain, book }))
  }

  return finalize('ledger', entries, losses, warnings, issues)
}

/* ---------- 路径 4：章节正文 → 场景骨架 ---------- */

function collectChapters(input) {
  if (Array.isArray(input)) return input
  if (!isPlainObject(input)) return []
  if (Array.isArray(input.chapters)) return input.chapters
  if (typeof input.text === 'string' || typeof input.content === 'string') return [input]
  return []
}

/**
 * 路径 4：章节正文按 100–300 字切段，只迁场景骨架（不迁原文）。
 * 精抽取（who/when/where/actinfo）留给 P2a 管线；条目打 pipelinePending，避免被当成已抽取事实。
 */
export function migrateChapters(input, options = {}) {
  const opts = isPlainObject(options) ? options : {}
  const source = isPlainObject(input) ? input : {}
  const losses = []
  const warnings = []
  const issues = []
  const domain = resolveDomain(opts, source)
  const book = resolveBook(opts, source, domain)

  const chaptersRaw = collectChapters(input)
  const normalized = []
  for (const [index, raw] of chaptersRaw.entries()) {
    if (!isPlainObject(raw)) continue
    const no = Number.isInteger(raw.no)
      ? raw.no
      : (Number.isInteger(raw.chapterNo) ? raw.chapterNo : index + 1)
    const title = firstText(raw.title, raw.name)
    const text = typeof raw.text === 'string'
      ? raw.text
      : (typeof raw.content === 'string' ? raw.content : (typeof raw.body === 'string' ? raw.body : ''))
    const path = firstText(raw.path, raw.file)
    if (!text.trim()) {
      warnings.push({ code: 'CHAPTER_EMPTY', path, chapterNo: no, message: `第 ${no} 章没有正文，跳过骨架生成` })
      continue
    }
    normalized.push({ raw, no, title, text, path })
  }

  const baseNames = normalized.map((item) => `第${item.no}章·场景骨架`)
  const baseCounts = countBy(baseNames)
  const entries = []
  const pendingChapters = []
  for (const [index, item] of normalized.entries()) {
    const baseName = baseNames[index]
    const name = baseCounts.get(baseName) > 1
      ? `${baseName}·${firstText(item.path, item.title, String(index + 1))}`
      : baseName
    const segments = segmentText(item.text)
    const stats = segmentStats(segments)
    if (stats.underMin > 0) {
      warnings.push({
        code: 'SEGMENT_UNDER_MIN',
        path: 'chapters',
        chapterNo: item.no,
        count: stats.underMin,
        message: `第 ${item.no} 章有 ${stats.underMin} 个段不足 100 字（尾段/短章如实保留）`
      })
    }
    if (stats.overMax > 0) {
      warnings.push({
        code: 'SEGMENT_OVER_MAX',
        path: 'chapters',
        chapterNo: item.no,
        count: stats.overMax,
        message: `第 ${item.no} 章有 ${stats.overMax} 个段超过 300 字`
      })
    }

    const entry = {
      schema: PEDIA_SCHEMA,
      id: stableEntryId({ layer: 'plot', domain, slot: '', name }),
      layer: 'plot',
      name,
      domain,
      status: MIGRATED_STATUS,
      fact: `第${item.no}章场景骨架（待管线精抽取）`,
      events: segments.map((segment) => ({
        index: segment.index,
        track: 'fact',
        title: `段${segment.index}`,
        refs: [],
        segments: [{ index: segment.index, chars: segment.chars }],
        novelty: []
      })),
      span: {
        chapter_count: 1,
        scene_count: segments.length,
        first_chapter: item.no,
        last_chapter: item.no
      },
      validity: { from: item.no, to: item.no },
      provenance: {
        mode: 'author',
        book,
        book_id: firstText(item.raw.bookId),
        chapters: [item.no],
        scenes: [],
        extractor: LEGACY_CHAPTER_EXTRACTOR,
        quote_hash: sha1Hex(item.text)
      },
      fingerprint: { vec: null, metrics: { chars: stats.totalChars, segments: stats.count } },
      pipelinePending: CHAPTER_SKELETON_PENDING,
      next: {
        sceneSkeleton: {
          chapterNo: item.no,
          title: item.title,
          path: item.path,
          segmentCount: stats.count,
          segmentStats: stats
        }
      }
    }
    entries.push(entry)
    pendingChapters.push(item.no)
    losses.push({
      code: 'chapter-prose-outside-pedia',
      path: 'chapters',
      chapterNo: item.no,
      message: `第 ${item.no} 章只迁场景骨架：正文留在原稿，pedia 不出原文（quote_hash 记账）`
    })
  }

  if (pendingChapters.length) {
    warnings.push({
      code: 'PIPELINE_PENDING',
      path: 'chapters',
      chapters: pendingChapters,
      message: `${pendingChapters.length} 章已建场景骨架，精抽取待 P2a 管线补跑（pipelinePending=true）`
    })
  }

  return finalize('chapters', entries, losses, warnings, issues)
}

/* ---------- 编排器 ---------- */

const PATH_RUNNERS = Object.freeze({
  worldStore: migrateWorldStore,
  outline: migrateOutline,
  ledger: migrateLedger,
  chapters: migrateChapters
})

function requestedPaths(source, options) {
  if (Array.isArray(options.paths) && options.paths.length) {
    return options.paths.filter((path) => MIGRATE_PATHS.includes(path))
  }
  return MIGRATE_PATHS.filter((path) => source[path] !== undefined && source[path] !== null)
}

/**
 * 存量迁移总入口。
 *
 * input：{ worldStore?, outline?, ledger?, chapters? }（四条路径各自注入口径）
 * options：
 *   domain/book        迁入条目的域与书名（缺省取 input 的 domain/book，再兜底）
 *   store              PediaStore（dryRun=true 时完全不碰）
 *   dryRun             true = 只出报告，不写库（默认 false）
 *   paths              只跑指定路径（默认：input 里出现的路径）
 *   operationPrefix    落库 operationId 前缀（默认 migrate:<domain>）
 *
 * 返回报告：{ ok, dryRun, domain, book, wouldMigrate, entries, entriesByPath,
 *            paths[], losses[], warnings[], issues[], saved[] }。
 * 同一 fixture 重跑：entries 完全一致，saved 全为 duplicate，库内 diff=0。
 */
export async function migrateLegacy(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {}
  const opts = isPlainObject(options) ? options : {}
  const domain = resolveDomain(opts, source)
  const book = resolveBook(opts, source, domain)
  const dryRun = opts.dryRun === true

  const selected = requestedPaths(source, opts)
  const reports = selected.map((path) => PATH_RUNNERS[path](source[path], { ...opts, domain, book }))

  const entries = []
  const seen = new Set()
  const duplicateWarnings = []
  for (const report of reports) {
    for (const entry of report.entries) {
      if (seen.has(entry.id)) {
        duplicateWarnings.push({
          code: 'DUPLICATE_ENTRY_ID',
          path: report.path,
          id: entry.id,
          name: entry.name,
          message: `稳定 id「${entry.id}」已由前序路径迁入，保留首个`
        })
        continue
      }
      seen.add(entry.id)
      entries.push(entry)
    }
  }

  const warnings = [...duplicateWarnings]
  const losses = []
  const issues = []
  for (const report of reports) {
    for (const warning of report.warnings) warnings.push({ path: report.path, ...warning })
    for (const loss of report.losses) losses.push({ path: report.path, ...loss })
    for (const issue of report.issues) issues.push({ path: report.path, ...issue })
  }

  let saved = []
  if (!dryRun && opts.store) {
    assertPediaStore(opts.store)
    const persistence = await persistEntries(opts.store, entries, {
      operationPrefix: firstText(opts.operationPrefix, `migrate:${domain}`)
    })
    saved = persistence.saved
    warnings.push(...persistence.warnings)
  }

  return {
    ok: issues.length === 0 && saved.every((item) => item.ok !== false),
    dryRun,
    version: LEGACY_MIGRATE_VERSION,
    domain,
    book,
    wouldMigrate: entries.length,
    entries,
    entriesByPath: Object.fromEntries(reports.map((report) => [report.path, report.entries])),
    paths: reports.map((report) => ({
      path: report.path,
      entries: report.entries.length,
      names: report.entries.map((entry) => entry.name),
      losses: report.losses,
      warnings: report.warnings,
      issues: report.issues
    })),
    losses,
    warnings,
    issues,
    saved
  }
}
