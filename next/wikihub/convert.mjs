import { parseWorldbookEntryFile, serializeWorldbookEntryFile } from '@pinax/core/domain/worldbookFileContract'
import { parseRefs } from '../shell/agentReferences.mjs'
import { OTHER_SLOT, PEDIA_SCHEMA, WORLDVIEW_SLOTS, isOrderedSlot, sha1Hex, slotForCategory, stableEntryId, validatePediaEntry } from './pediaSchema.mjs'

/**
 * wikihub 三载体双向转换器（批次 W1 · 数据层，纯函数）。
 *
 * 枢纽格式 = pedia/v1（见 ./pediaSchema.mjs）。本文件只做「载体语义 ↔ 枢纽条目」的翻译，
 * 不碰磁盘、不接工具面、不定义 hub 的存储位置（落盘与入口是 W2 的事）。
 *
 * 三条转换线：
 *   1) 世界书 ↔ worldview（hard 层）：字段全量带过去，正文/frontmatter 收在 next.worldbook
 *      快照里，所以 worldbook → hub → worldbook 无损；纯 pedia 导出时要剥掉 next（版权红线）。
 *   2) 小说章结构 → plot/character 锚点：只做结构映射（章节序、关联引用、按名单做出现锚定），
 *      不做 LLM 抽取——抽事实/因果/人物弧是 NovelPedia 引擎的活，这里明确记账为损失。
 *   3) 剧本集结构 → plot/character 锚点：同上，剧集=场次。
 *
 * 反向：hubToWorldbook 产出可直接交给 pinax_worldbook_save 的草稿；hubToNovelRefs /
 * hubToScriptSkeleton 从 plot 事件骨架重新生成章节/剧集骨架与 @《…》引用行。
 *
 * 两处与工单字面不符、已在 result 里说明：
 *   - parseRefs 一族实际住在 next/shell/agentReferences.mjs（工单写的是 next/kernel）；这里只 import。
 *   - Next 没有章/场景数字锚点：provenance.chapters/scenes 给空数组，真实锚点落在
 *     provenance.source 与 next 扩展里；小说结构映射用「列表序 +1」当章号。
 */

/** 三条转换线的 provenance.extractor 标识。 */
export const WIKIHUB_WORLDBOOK_EXTRACTOR = 'pinax-next/worldbook@1'
export const WIKIHUB_NOVEL_EXTRACTOR = 'pinax-next/novel-structure@1'
export const WIKIHUB_SCRIPT_EXTRACTOR = 'pinax-next/script-structure@1'

const MAX_DEFINITION_CHARS = 600
const MAX_SUMMARY_CHARS = 500
const MAX_RELATION_TARGET_CHARS = 80
const MAX_RELATION_LABEL_CHARS = 32
const MAX_RELATIONS = 32

/**
 * 世界书 type → pedia 分类词表（再经 category_map 归槽）。
 * 这张表是 Next 侧唯一的一套 type 枚举（见 core 的 worldbookFileContract.TYPE_TO_CAT）。
 */
export const WORLDBOOK_TYPE_TO_PEDIA_CATEGORY = Object.freeze({
  character: '人物',
  person: '人物',
  location: '地点',
  place: '地点',
  organization: '组织',
  faction: '势力',
  event: '事件',
  rule: '规则',
  quest: '试炼',
  item: '物品',
  creature: '生物',
  lore: '世界观',
  concept: '概念',
  relationship: '人际关系',
  forbidden: '规则',
  style: '文风',
  source: '资料',
  general: '其他'
})

/** 世界书一级类别目录 → pedia 分类词表。 */
export const WORLDBOOK_DIR_TO_PEDIA_CATEGORY = Object.freeze({
  人物: '人物',
  势力: '势力',
  地理: '地点',
  编年: '事件',
  设定: '设定',
  资料: '资料'
})

/** 这些 type 本来就不是世界观设定，映射进 worldview 是口径妥协，转换时如实警告。 */
export const WORLDBOOK_NON_WORLDVIEW_TYPES = Object.freeze(['style', 'source'])

/** 槽位 → 世界书建档口径（无快照可还原时用）。 */
export const PEDIA_SLOT_TO_WORLDBOOK = Object.freeze({
  power_levels: Object.freeze({ type: 'rule', cat: '设定' }),
  abilities: Object.freeze({ type: 'rule', cat: '设定' }),
  rules: Object.freeze({ type: 'rule', cat: '设定' }),
  locations: Object.freeze({ type: 'location', cat: '地理' }),
  items: Object.freeze({ type: 'item', cat: '设定' }),
  orgs: Object.freeze({ type: 'organization', cat: '势力' }),
  roles: Object.freeze({ type: 'character', cat: '人物' }),
  creatures: Object.freeze({ type: 'lore', cat: '设定' }),
  concepts: Object.freeze({ type: 'lore', cat: '设定' }),
  events: Object.freeze({ type: 'event', cat: '编年' }),
  other: Object.freeze({ type: 'general', cat: '设定' })
})

/** 纯 pedia 导出会丢掉的东西（都在 next 扩展里，导出脚本必须剥离）。 */
export const PEDIA_EXPORT_LOSSES = Object.freeze([
  { code: 'entry-content', field: 'next.worldbook.content', message: '条目正文只在 next 扩展里，开源导出必须剥离（版权红线：只出知识不出原文）' },
  { code: 'entry-frontmatter', field: 'next.worldbook', message: 'injection/profile/extra/status/version 等 frontmatter 只在 next 扩展里' },
  { code: 'worldbook-ids', field: 'next.worldbook.id', message: 'worldbook 自有 id 不是 pedia 稳定 id，两者靠 next 扩展互认' }
])

/** 小说结构映射的软层损失（测试按清单断言，不假装无损）。 */
export const NOVEL_STRUCTURE_LOSSES = Object.freeze([
  { code: 'chapter-prose', field: 'events', message: '章节正文不进 hub：plot 层只有结构骨架' },
  { code: 'plot-dialogue', field: 'events', message: '台词未抽取' },
  { code: 'plot-causality', field: 'events', message: '因果与冲突链未推断（抽取是 NovelPedia 引擎的活）' },
  { code: 'character-extraction', field: 'characterEntries', message: '人物不从正文抽取：只有调用方给的名单，按名字/别名做出现锚定' },
  { code: 'character-arc', field: 'characterEntries', message: '人物弧线/动机未推断' },
  { code: 'style-metrics', field: 'fingerprint', message: '文风指标未计算' },
  { code: 'embedding-vec', field: 'fingerprint.vec', message: '向量为 null（fingerprint.vec），相似度检索暂不可用' }
])

/** 剧本结构映射的软层损失。 */
export const SCRIPT_STRUCTURE_LOSSES = Object.freeze([
  { code: 'script-body', field: 'events', message: '剧本文本不进 hub：plot 层只有分集骨架' },
  { code: 'script-dialogue', field: 'events', message: '台词未抽取' },
  { code: 'script-stage-direction', field: 'events', message: '舞台提示/镜头说明未抽取' },
  { code: 'cast-extraction', field: 'characterEntries', message: '角色不从剧本抽取：只有调用方给的名单' },
  { code: 'plot-causality', field: 'events', message: '因果与冲突链未推断' },
  { code: 'embedding-vec', field: 'fingerprint.vec', message: '向量为 null（fingerprint.vec），相似度检索暂不可用' }
])

/* ---------- 通用小工具 ---------- */

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : str(item).trim())).filter(Boolean) : []
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

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return {}
  }
}

function firstParagraph(text, limit) {
  const normalized = str(text).replace(/\r\n?/gu, '\n').trim()
  if (!normalized) return ''
  const paragraph = normalized.split(/\n\s*\n/u)[0].replace(/\s+/gu, ' ').trim()
  return paragraph.length > limit ? `${paragraph.slice(0, limit)}…` : paragraph
}

function sanitizeFilename(name) {
  let value = str(name)
    .replace(/[\\/:*?"<>|]/gu, '')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '')
    .replace(/[. ]+$/u, '')
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/iu.test(value)) value = `_${value}`
  return (value || 'untitled').slice(0, 80)
}

function countOccurrences(text, needle) {
  const haystack = str(text)
  const target = str(needle)
  if (!target) return 0
  let count = 0
  let position = haystack.indexOf(target)
  while (position !== -1) {
    count += 1
    position = haystack.indexOf(target, position + target.length)
  }
  return count
}

/* ---------- 世界书 → worldview ---------- */

/**
 * 世界书条目归一：同时接两种形状。
 *   - 契约条目（parseWorldbookEntryFile 的结果）：cat 是数组、带 kind/keysSecondary/extra 等；
 *   - 运行时读回条目（pinax_worldbook_list/read）：cat 是一级目录字符串、只有 keys/summary/content。
 * 丢了哪些字段会在 worldbookToHub 的 losses 里点名，不静默。
 */
export function normalizeWorldbookEntry(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const content = typeof source.content === 'string' ? source.content : ''
  const name = firstString(source.name, source.title, source.id)
  const kind = firstString(source.kind, source.type, 'general')
  const type = firstString(source.type, source.kind, kind)
  const catDir = typeof source.catDir === 'string'
    ? source.catDir.trim()
    : (typeof source.cat === 'string' ? source.cat.trim() : '')
  const catList = Array.isArray(source.cat) ? arrayOfStrings(source.cat) : (catDir ? [catDir] : [])
  const contract = source.contract === true || (source.contract === undefined && typeof source.kind === 'string')
  // 运行时读回的形状（pinax_worldbook_list/read）没有 kind/version/injection…：
  // 区分「字段为空」与「字段没给」，反向时才能如实记账。
  const hasFrontmatter = typeof source.kind === 'string' || typeof source.version !== 'undefined' || isPlainObject(source.extra)
  return {
    id: firstString(source.id),
    name,
    title: firstString(source.title, name),
    kind,
    type,
    status: firstString(source.status, 'active'),
    version: source.version ?? '',
    tags: arrayOfStrings(source.tags),
    links: arrayOfStrings(source.links),
    cat: catList,
    catDir,
    keys: arrayOfStrings(source.keys),
    keysSecondary: arrayOfStrings(source.keysSecondary),
    summary: typeof source.summary === 'string' ? source.summary : '',
    sourceRefs: arrayOfStrings(source.sourceRefs),
    updatedAt: firstString(source.updatedAt),
    relations: normalizeRelationArray(source.relations),
    injection: isPlainObject(source.injection) ? cloneJson(source.injection) : {},
    profile: isPlainObject(source.profile) ? cloneJson(source.profile) : {},
    extra: isPlainObject(source.extra) ? cloneJson(source.extra) : {},
    content,
    path: firstString(source.path),
    revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
    chars: Number.isSafeInteger(source.chars) ? source.chars : content.length,
    contract,
    hasFrontmatter
  }
}

function normalizeRelationArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (isPlainObject(item)) return { ...item }
      if (item === null || item === undefined) return null
      return { to: str(item) }
    })
    .filter(Boolean)
}

/** 世界书型输入：字符串（整份 md）／数组／{entries}／单条；解析失败带错误回来。 */
function collectWorldbookEntries(input) {
  if (typeof input === 'string') {
    const parsed = parseWorldbookEntryFile(input)
    if (!parsed.ok) {
      return { error: { code: 'WORLDBOOK_PARSE_FAILED', message: `世界书 entry md 解析失败：${parsed.error.message}` } }
    }
    return { entries: [{ ...parsed.entry, contract: true }] }
  }
  if (Array.isArray(input)) return { entries: input }
  if (isPlainObject(input) && Array.isArray(input.entries)) return { entries: input.entries }
  if (isPlainObject(input)) return { entries: [input] }
  return { entries: [] }
}

function buildWorldbookNameIndex(entries, extra) {
  const byId = new Map()
  const names = new Set()
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry.name)
    if (entry.name) names.add(entry.name)
  }
  if (isPlainObject(extra)) {
    for (const [id, name] of Object.entries(extra)) {
      if (typeof name === 'string') byId.set(id, name)
    }
  }
  return { byId, names }
}

function resolveRelationTarget(raw, index) {
  const value = str(raw).trim()
  if (!value) return ''
  return index.byId.get(value) ?? value
}

/**
 * 槽位判定：frontmatter 分类（走 category_map）优先，其次 type，再次一级目录。
 * 落到 other 的来源不算「命中」，继续看下一层——否则 type=general 会把所有顶层条目吞成 other，
 * 目录里的地理/编年信息就白丢了。
 */
function resolveSlot(entry) {
  // hub → 世界书时写在 extra 里的槽位钉子：type=rule/设定 分不清 power_levels 与 concepts，
  // 靠它把槽位（及 rank）原样带回来。
  const pinned = entry.extra?.pediaSlot
  if (typeof pinned === 'string' && WORLDVIEW_SLOTS[pinned]) return { slot: pinned, via: 'extra:pediaSlot' }
  for (const category of entry.cat) {
    const slot = slotForCategory(category)
    if (slot !== OTHER_SLOT) return { slot, via: `cat:${category}` }
  }
  let fallback = null
  const typeCategory = WORLDBOOK_TYPE_TO_PEDIA_CATEGORY[entry.type] ?? WORLDBOOK_TYPE_TO_PEDIA_CATEGORY[entry.kind]
  if (typeCategory) {
    const slot = slotForCategory(typeCategory)
    if (slot !== OTHER_SLOT) return { slot, via: `type:${entry.type}` }
    fallback = { slot: OTHER_SLOT, via: `type:${entry.type}` }
  }
  const dirCategory = WORLDBOOK_DIR_TO_PEDIA_CATEGORY[entry.catDir]
  if (dirCategory) {
    const slot = slotForCategory(dirCategory)
    if (slot !== OTHER_SLOT) return { slot, via: `dir:${entry.catDir}` }
    fallback = fallback ?? { slot: OTHER_SLOT, via: `dir:${entry.catDir}` }
  }
  return fallback ?? { slot: OTHER_SLOT, via: 'unmapped' }
}

function rankOf(entry) {
  for (const candidate of [entry.extra?.rank, entry.profile?.rank]) {
    if (Number.isSafeInteger(candidate) && candidate >= 1) return candidate
  }
  return null
}

function deriveDefinition(entry, warnings) {
  const summary = entry.summary.trim()
  if (summary) return summary
  const paragraph = firstParagraph(entry.content, MAX_DEFINITION_CHARS)
  if (paragraph) {
    warnings.push({ code: 'DEFINITION_EXCERPT', id: entry.id, message: `条目「${entry.name}」没有 summary，definition 取自正文首段（摘录而非概括）` })
    return paragraph
  }
  warnings.push({ code: 'DEFINITION_FALLBACK_NAME', id: entry.id, message: `条目「${entry.name}」没有摘要与正文，definition 回退为名称` })
  return entry.name
}

function composeHow(relation) {
  if (!isPlainObject(relation)) return ''
  const parts = []
  if (typeof relation.stance === 'string' && relation.stance.trim()) parts.push(relation.stance.trim())
  if (relation.covert === true) parts.push('暗线')
  if (typeof relation.weight === 'number' && Number.isFinite(relation.weight)) parts.push(`权重 ${relation.weight}`)
  return parts.join(' · ')
}

function buildHubRelations(entry, index, warnings) {
  const relations = []
  const seen = new Set()
  const push = (rawTarget, origin, raw) => {
    const target = resolveRelationTarget(rawTarget, index)
    if (!target) {
      warnings.push({ code: 'RELATION_WITHOUT_TARGET', id: entry.id, message: `条目「${entry.name}」有一条 ${origin} 关系没有目标，已跳过` })
      return
    }
    if (!index.byId.has(target) && !index.names.has(target)) {
      warnings.push({ code: 'RELATION_TARGET_UNRESOLVED', id: entry.id, message: `条目「${entry.name}」的关系目标「${target}」不在本次输入里（保留原值）` })
    }
    const type = firstString(raw?.type, origin === 'link' ? 'link' : 'related')
    const key = `${origin}|${target}|${type}`
    if (seen.has(key)) return
    seen.add(key)
    const relation = { to: target, type }
    const how = composeHow(raw)
    if (how) relation.how = how
    relation.next = { origin, to_id: str(rawTarget) }
    if (typeof raw?.stance === 'string' && raw.stance.trim()) relation.next.stance = raw.stance.trim()
    if (raw?.covert === true) relation.next.covert = true
    if (typeof raw?.weight === 'number' && Number.isFinite(raw.weight)) relation.next.weight = raw.weight
    if (typeof raw?.src === 'string' && raw.src.trim()) relation.next.src = raw.src.trim()
    relations.push(relation)
  }
  for (const link of entry.links) push(link, 'link', { to: link, type: 'link' })
  for (const relation of entry.relations) push(relation.to, 'relation', relation)
  return relations
}

function worldbookSnapshot(entry, { stripContent }) {
  return {
    id: entry.id,
    name: entry.name,
    title: entry.title,
    kind: entry.kind,
    type: entry.type,
    status: entry.status,
    version: entry.version,
    tags: [...entry.tags],
    links: [...entry.links],
    cat: [...entry.cat],
    catDir: entry.catDir,
    keys: [...entry.keys],
    keysSecondary: [...entry.keysSecondary],
    summary: entry.summary,
    sourceRefs: [...entry.sourceRefs],
    updatedAt: entry.updatedAt,
    relations: entry.relations.map((relation) => ({ ...relation })),
    injection: cloneJson(entry.injection),
    profile: cloneJson(entry.profile),
    extra: cloneJson(entry.extra),
    content: stripContent ? null : entry.content,
    path: entry.path,
    revision: entry.revision,
    chars: entry.chars,
    contract: entry.contract
  }
}

/**
 * 世界书 → hub worldview 条目。
 *
 * input：数组／{entries}／单条条目对象／整份契约 md 文本。
 * options：
 *   book          书名（provenance.book，默认「世界书」）
 *   domain        pedia 域（worldview 必填；默认取 book——Next 没有题材域字段）
 *   idToName      额外 id→名称 表（关系目标在本次输入之外时用）
 *   extractor     provenance.extractor 覆盖
 *   stripContent  true 表示剥离正文（开源导出预演）
 *
 * 返回 { ok, schema, valid, entries, index, mappings, exportLosses, losses, warnings, validationWarnings, issues }。
 * losses 为空 = 无损（正文/frontmatter 都在 next.worldbook 快照里）；exportLosses 是纯 pedia 导出会丢的。
 */
export function worldbookToHub(input, options = {}) {
  const losses = []
  const warnings = []
  const issues = []
  const collected = collectWorldbookEntries(input)
  if (collected.error) {
    return { ok: false, schema: PEDIA_SCHEMA, valid: false, entries: [], index: { nameToId: {} }, mappings: [], exportLosses: [...PEDIA_EXPORT_LOSSES], losses, warnings, validationWarnings: [], issues: [collected.error] }
  }

  const entries = collected.entries.map(normalizeWorldbookEntry)
  const book = firstString(options.book, options.worldbookName, '世界书')
  const domain = firstString(options.domain, book)
  const extractor = firstString(options.extractor, WIKIHUB_WORLDBOOK_EXTRACTOR)
  const stripContent = options.stripContent === true
  const nameIndex = buildWorldbookNameIndex(entries, options.idToName)

  const hubEntries = []
  const mappings = []
  for (const entry of entries) {
    if (!entry.name) {
      issues.push({ code: 'ENTRY_WITHOUT_NAME', id: entry.id, message: '世界书条目没有名称（name/title/id 全空），已跳过' })
      continue
    }
    if (WORLDBOOK_NON_WORLDVIEW_TYPES.includes(entry.type)) {
      warnings.push({ code: 'TYPE_NOT_WORLDVIEW', id: entry.id, message: `条目「${entry.name}」的 type=${entry.type} 本来不是世界观设定，映射进 worldview 是口径妥协` })
    }
    if (!entry.contract) {
      warnings.push({ code: 'WORLDBOOK_UNPARSED', id: entry.id, message: `条目「${entry.name}」未按世界书文件契约建档（裸 md），只能按运行时读回字段转换` })
    }
    if (!entry.hasFrontmatter) {
      losses.push({ code: 'worldbook-frontmatter-unavailable', field: 'next.worldbook', message: `条目「${entry.name}」来自运行时读回形状，kind/version/injection/profile/extra 等 frontmatter 字段未提供` })
    }

    const slotInfo = resolveSlot(entry)
    const slot = slotInfo.slot
    const aliases = uniqueStrings(entry.keys.filter((key) => key !== entry.name))
    const relations = buildHubRelations(entry, nameIndex, warnings)
    const id = stableEntryId({ layer: 'worldview', domain, slot, name: entry.name })

    const hubEntry = {
      schema: PEDIA_SCHEMA,
      id,
      layer: 'worldview',
      name: entry.name,
      domain,
      slot,
      rank: isOrderedSlot(slot) ? rankOf(entry) : null,
      definition: deriveDefinition(entry, warnings),
      stats: { chars: entry.chars, keys: entry.keys.length, relations: relations.length },
      provenance: {
        book,
        book_id: sha1Hex(book).slice(0, 8),
        // Next 没有章/场景数字锚点：给空数组，真实锚点在 source 里（工单允许的偏离）。
        chapters: [],
        scenes: [],
        extractor,
        confidence: 1,
        source: {
          kind: 'worldbook-entry',
          path: entry.path,
          entry_id: entry.id,
          cat: entry.catDir,
          revision: entry.revision,
          chars: entry.chars
        }
      },
      next: {
        medium: 'worldbook',
        worldbook: worldbookSnapshot(entry, { stripContent })
      }
    }
    if (aliases.length) hubEntry.aliases = aliases
    // relations 为空的字段不落，保持信封干净（规范里它是 optional）。
    if (relations.length) hubEntry.relations = relations
    if (stripContent) {
      losses.push({ code: 'entry-content-stripped', field: 'next.worldbook.content', message: `条目「${entry.name}」的正文按 stripContent 剥离` })
    }

    hubEntries.push(hubEntry)
    mappings.push({ id: entry.id, name: entry.name, type: entry.type, cat: entry.catDir, slot, via: slotInfo.via })
  }

  const checked = hubEntries.map((entry) => ({ id: entry.id, name: entry.name, ...validatePediaEntry(entry) }))
  const validationWarnings = checked.flatMap((item) => item.warnings.map((warning) => ({ id: item.id, name: item.name, ...warning })))
  const invalid = checked.filter((item) => !item.ok)
  for (const item of invalid) {
    issues.push({ code: 'PEDIA_INVALID', id: item.id, name: item.name, errors: item.errors })
  }

  const nameToId = {}
  for (const entry of hubEntries) nameToId[entry.name] = entry.id

  return {
    ok: true,
    schema: PEDIA_SCHEMA,
    valid: invalid.length === 0,
    entries: hubEntries,
    index: { nameToId },
    mappings,
    exportLosses: PEDIA_EXPORT_LOSSES.map((item) => ({ ...item })),
    losses,
    warnings,
    validationWarnings,
    issues
  }
}

/* ---------- worldview → 世界书 ---------- */

function restoreWorldbookEntry(snapshot, hubEntry, options, losses) {
  const restored = normalizeWorldbookEntry(snapshot)
  if (!restored.id) restored.id = firstString(hubEntry.id) || stableEntryId({
    layer: 'worldview',
    domain: firstString(hubEntry.domain),
    slot: firstString(hubEntry.slot),
    name: firstString(hubEntry.name)
  })
  if (snapshot.content === null || snapshot.content === undefined) {
    const reconstructed = typeof options.content === 'string' ? options.content : firstString(hubEntry.definition)
    restored.content = reconstructed
    losses.push({ code: 'entry-content-unavailable', field: 'content', message: '快照里没有正文（导出剥离），正文以调用方给的 content 或 definition 顶替' })
  }
  return restored
}

function clipLabel(value, field, losses) {
  const text = str(value).trim()
  if (text.length <= MAX_RELATION_LABEL_CHARS) return text
  losses.push({ code: 'relation-label-truncated', field: `relations.${field}`, message: `关系标签「${text.slice(0, 12)}…」超出 ${MAX_RELATION_LABEL_CHARS} 字，已截断` })
  return text.slice(0, MAX_RELATION_LABEL_CHARS)
}

function relationStance(relation, losses) {
  if (typeof relation?.next?.stance === 'string' && relation.next.stance.trim()) {
    return clipLabel(relation.next.stance, 'stance', losses)
  }
  const how = firstString(relation?.how)
  if (!how) return ''
  if (how.length > MAX_RELATION_LABEL_CHARS) {
    losses.push({ code: 'relation-how-dropped', field: 'relations.stance', message: `关系说明「${how.slice(0, 12)}…」超出 ${MAX_RELATION_LABEL_CHARS} 字，未落进 worldbook` })
    return ''
  }
  return how
}

function deriveRelation(relation, losses) {
  const target = firstString(relation?.to)
  if (!target) return null
  if (target.length > MAX_RELATION_TARGET_CHARS) {
    losses.push({ code: 'relation-target-dropped', field: 'relations.to', message: `关系目标「${target.slice(0, 12)}…」超出 ${MAX_RELATION_TARGET_CHARS} 字，已丢弃` })
    return null
  }
  const edge = { to: target }
  const type = firstString(relation?.type)
  if (type) edge.type = clipLabel(type, 'type', losses)
  const stance = relationStance(relation, losses)
  if (stance) edge.stance = stance
  if (relation?.next?.covert === true) edge.covert = true
  if (typeof relation?.next?.weight === 'number' && Number.isFinite(relation.next.weight)) edge.weight = relation.next.weight
  return edge
}

function deriveWorldbookEntry(hubEntry, options, losses) {
  const name = firstString(hubEntry.name, hubEntry.id, '未命名条目')
  const mapping = PEDIA_SLOT_TO_WORLDBOOK[hubEntry.slot] ?? PEDIA_SLOT_TO_WORLDBOOK[OTHER_SLOT]
  const definition = typeof hubEntry.definition === 'string' ? hubEntry.definition : ''
  const summary = definition.length > MAX_SUMMARY_CHARS ? definition.slice(0, MAX_SUMMARY_CHARS) : definition
  if (summary !== definition) {
    losses.push({ code: 'definition-truncated', field: 'summary', message: `definition 超出 ${MAX_SUMMARY_CHARS} 字，summary 已截断` })
  }

  const extra = {}
  // worldbook 没有槽位字段：把 pedia 槽位与有序 rank 钉进 extra，下一次 worldbookToHub 能原样读回。
  if (typeof hubEntry.slot === 'string' && hubEntry.slot !== OTHER_SLOT && WORLDVIEW_SLOTS[hubEntry.slot]) {
    extra.pediaSlot = hubEntry.slot
  }
  if (isOrderedSlot(hubEntry.slot) && Number.isSafeInteger(hubEntry.rank) && hubEntry.rank >= 1) extra.rank = hubEntry.rank

  const relations = []
  for (const relation of Array.isArray(hubEntry.relations) ? hubEntry.relations : []) {
    const edge = deriveRelation(relation, losses)
    if (edge) relations.push(edge)
    if (relations.length >= MAX_RELATIONS) {
      losses.push({ code: 'relations-truncated', field: 'relations', message: `关系超过 ${MAX_RELATIONS} 条，超出的未落进 worldbook` })
      break
    }
  }

  const hasContent = typeof options.content === 'string'
  const content = hasContent ? options.content : definition
  if (!hasContent) {
    losses.push({ code: 'content-from-definition', field: 'content', message: '没有 next.worldbook 快照，正文以 definition 顶替' })
  }
  for (const field of ['stats', 'votes', 'fingerprint', 'span']) {
    if (hubEntry[field] !== undefined) {
      losses.push({ code: `${field}-dropped`, field, message: `worldbook 没有 ${field} 字段，未落盘` })
    }
  }
  losses.push({ code: 'worldbook-type-inferred', field: 'type', message: `type/cat 由槽位 ${hubEntry.slot} 反推为 ${mapping.type}/${mapping.cat}` })

  return normalizeWorldbookEntry({
    id: firstString(hubEntry.id),
    name,
    kind: mapping.type,
    type: mapping.type,
    status: 'active',
    version: '',
    tags: [],
    links: [],
    cat: [mapping.cat],
    catDir: mapping.cat,
    keys: Array.isArray(hubEntry.aliases) ? uniqueStrings(hubEntry.aliases) : [],
    keysSecondary: [],
    summary,
    sourceRefs: [],
    updatedAt: '',
    relations,
    injection: {},
    profile: {},
    extra,
    content,
    path: '',
    revision: 0,
    chars: content.length,
    contract: true
  })
}

function deriveWorldbookPath(entry) {
  const base = sanitizeFilename(entry.name || entry.id || 'untitled')
  const dir = entry.catDir
  return dir ? `${dir}/${dir}·${base}.md` : `${base}.md`
}

/**
 * 序列化只认契约字段：path／revision／catDir／chars 这些运行时字段若混进去，
 * serializeWorldbookEntryFile 会把它们当未知 frontmatter 键写回文件（多出新行）。
 */
const WORLDBOOK_FILE_FIELDS = Object.freeze([
  'id', 'name', 'title', 'kind', 'type', 'status', 'version', 'tags', 'links', 'cat',
  'keys', 'keysSecondary', 'summary', 'sourceRefs', 'updatedAt', 'relations',
  'injection', 'profile', 'extra', 'content'
])

function worldbookFileEntry(entry) {
  const out = {}
  for (const field of WORLDBOOK_FILE_FIELDS) {
    if (entry[field] !== undefined) out[field] = entry[field]
  }
  return out
}

function buildWorldbookMeta(entry) {
  const relations = []
  for (const relation of entry.relations.slice(0, MAX_RELATIONS)) {
    const edge = { to: relation.to }
    if (relation.type) edge.type = relation.type
    if (relation.stance) edge.stance = relation.stance
    if (relation.covert === true) edge.covert = true
    if (typeof relation.weight === 'number' && Number.isFinite(relation.weight)) edge.weight = relation.weight
    relations.push(edge)
  }
  return {
    keys: [...entry.keys],
    tags: [...entry.tags],
    summary: entry.summary.slice(0, MAX_SUMMARY_CHARS),
    relations
  }
}

/**
 * hub worldview 条目 → 世界书条目草稿（不落盘）。
 *
 * 有 next.worldbook 快照时逐字段还原（无损）；没有时由 slot 反推 type/cat、definition 顶正文，
 * 损失逐条记进 losses。draft 三件套给 W2 直接喂 pinax_worldbook_save：
 *   draft.fileText  新建用（整份带 frontmatter，expectedRevision 0）
 *   draft.content   改稿用（只换正文，expectedRevision 用读到的修订号）
 *   draft.meta      改稿用（keys/tags/summary/relations 元数据口）
 */
export function hubToWorldbook(hubEntry, options = {}) {
  const losses = []
  const warnings = []
  if (!isPlainObject(hubEntry)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'hubToWorldbook 需要一条 pedia 条目对象' }, losses, warnings }
  }
  if (hubEntry.layer !== 'worldview') {
    return { ok: false, error: { code: 'WRONG_LAYER', message: `hubToWorldbook 只接 worldview 层（收到 ${str(hubEntry.layer) || '空'}）` }, losses, warnings }
  }

  const snapshot = isPlainObject(hubEntry.next?.worldbook) ? hubEntry.next.worldbook : null
  const entry = snapshot
    ? restoreWorldbookEntry(snapshot, hubEntry, options, losses)
    : deriveWorldbookEntry(hubEntry, options, losses)
  const path = snapshot?.path ? snapshot.path : deriveWorldbookPath(entry)
  entry.path = path

  const fileText = serializeWorldbookEntryFile(worldbookFileEntry(entry))
  const meta = buildWorldbookMeta(entry)
  if (!entry.content) {
    warnings.push({ code: 'EMPTY_CONTENT', message: `条目「${entry.name}」没有正文，保存工具会拒绝空 text` })
  }

  return {
    ok: true,
    entry,
    draft: { path, fileText, content: entry.content, meta },
    losses,
    warnings
  }
}

/* ---------- 小说／剧本结构 → plot / character 锚点 ---------- */

function normalizeNovelUnits(input) {
  const source = Array.isArray(input) ? input : (Array.isArray(input?.chapters) ? input.chapters : [])
  const units = source.map((chapter, position) => ({
    index: Number.isSafeInteger(chapter?.index) ? chapter.index + 1 : position + 1,
    title: firstString(chapter?.title, chapter?.name, `第 ${position + 1} 章`),
    path: firstString(chapter?.path, chapter?.file),
    group: firstString(chapter?.volume),
    revision: Number.isSafeInteger(chapter?.revision) ? chapter.revision : null,
    text: typeof chapter?.text === 'string' ? chapter.text : null,
    chars: Number.isSafeInteger(chapter?.totalChars) ? chapter.totalChars : (typeof chapter?.text === 'string' ? chapter.text.length : null),
    truncated: chapter?.truncated === true
  }))
  units.sort((left, right) => left.index - right.index)
  return units
}

function normalizeScriptUnits(input) {
  const source = Array.isArray(input)
    ? input
    : (Array.isArray(input?.scripts) ? input.scripts : (Array.isArray(input?.episodes) ? input.episodes : []))
  const units = source.map((script, position) => ({
    index: Number.isSafeInteger(script?.index) ? script.index + 1 : position + 1,
    title: firstString(script?.title, script?.name, `第 ${position + 1} 集`),
    path: firstString(script?.path, script?.file),
    group: '',
    revision: Number.isSafeInteger(script?.revision) ? script.revision : null,
    text: typeof script?.text === 'string' ? script.text : null,
    chars: Number.isSafeInteger(script?.totalChars) ? script.totalChars : (typeof script?.text === 'string' ? script.text.length : null),
    truncated: script?.truncated === true
  }))
  units.sort((left, right) => left.index - right.index)
  return units
}

function normalizeCharacters(input) {
  const list = Array.isArray(input?.characters) ? input.characters : (Array.isArray(input) ? [] : [])
  const characters = []
  for (const character of list) {
    const name = firstString(character?.name)
    if (!name) continue
    characters.push({
      name,
      aliases: uniqueStrings(arrayOfStrings(character?.aliases).filter((alias) => alias !== name)),
      entryId: firstString(character?.entryId, character?.entry_id, character?.sourceEntryId),
      hasText: false
    })
  }
  return characters
}

function averageChars(units) {
  const values = units.map((unit) => unit.chars).filter((value) => Number.isSafeInteger(value) && value >= 0)
  if (!values.length) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function buildRefIndex(events) {
  const index = {}
  for (const event of events) {
    for (const title of event.refs) {
      if (!index[title]) index[title] = []
      if (!index[title].includes(event.index)) index[title].push(event.index)
    }
  }
  return index
}

function buildStructureAnchors({ medium, units, book, domain, extractor, mediumLosses, warnings, characters, plotName, eventAnchorKind }) {
  const isNovel = medium === 'novel'
  const events = units.map((unit) => {
    const refs = unit.text === null ? [] : uniqueStrings(parseRefs(unit.text).map((ref) => ref.title))
    return {
      index: unit.index,
      title: unit.title,
      anchor: {
        kind: eventAnchorKind,
        path: unit.path,
        group: unit.group || null,
        revision: unit.revision
      },
      refs,
      chars: unit.chars,
      truncated: unit.truncated
    }
  })
  const textMissing = units.filter((unit) => unit.text === null).length
  if (textMissing) {
    warnings.push({ code: 'UNIT_TEXT_UNAVAILABLE', message: `${textMissing}/${units.length} 个单位没有正文，@《…》引用未能扫描` })
  }

  const unitNumbers = events.map((event) => event.index)
  const cover = {
    book,
    book_id: sha1Hex(book).slice(0, 8),
    chapters: isNovel ? unitNumbers : [],
    scenes: isNovel ? [] : unitNumbers,
    extractor,
    confidence: 1,
    source: {
      kind: isNovel ? 'novel-structure' : 'script-structure',
      units: units.map((unit) => ({ path: unit.path, group: unit.group || null, revision: unit.revision }))
    }
  }
  const first = unitNumbers.length ? unitNumbers[0] : null
  const last = unitNumbers.length ? unitNumbers[unitNumbers.length - 1] : null
  const span = isNovel
    ? { first_chapter: first, last_chapter: last, first_scene: null, last_scene: null, scene_count: units.length, chapter_count: units.length }
    : { first_chapter: null, last_chapter: null, first_scene: first, last_scene: last, scene_count: units.length, chapter_count: null }

  const refIndex = buildRefIndex(events)
  const plotEntry = {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain, slot: '', name: plotName }),
    layer: 'plot',
    name: plotName,
    domain,
    events,
    provenance: cover,
    fingerprint: {
      vec: null,
      metrics: {
        chapter_count: isNovel ? units.length : null,
        scene_count: isNovel ? null : units.length,
        event_count: events.length,
        ref_count: Object.keys(refIndex).length,
        avg_chars: averageChars(units)
      }
    },
    span,
    next: { medium, structure: 'outline', anchor_kind: eventAnchorKind }
  }

  const characterEntries = []
  for (const character of characters) {
    const needles = [character.name, ...character.aliases]
    const hits = []
    let mentions = 0
    for (const unit of units) {
      if (unit.text === null) continue
      let count = 0
      for (const needle of needles) count += countOccurrences(unit.text, needle)
      if (count > 0) {
        hits.push(unit.index)
        mentions += count
      }
    }
    if (character.name.length <= 1) {
      warnings.push({ code: 'SINGLE_CHAR_NAME_OVERCOUNT', message: `角色「${character.name}」名字只有 1 个字，出现次数可能偏高` })
    }
    const hitFirst = hits.length ? hits[0] : null
    const hitLast = hits.length ? hits[hits.length - 1] : null
    characterEntries.push({
      schema: PEDIA_SCHEMA,
      id: stableEntryId({ layer: 'character', domain, slot: '', name: character.name }),
      layer: 'character',
      name: character.name,
      domain,
      aliases: character.aliases,
      identity: { aliases: character.aliases, source_entry_id: character.entryId || null },
      provenance: {
        book,
        book_id: sha1Hex(book).slice(0, 8),
        chapters: isNovel ? hits : [],
        scenes: isNovel ? [] : hits,
        extractor,
        confidence: hits.length ? 1 : 0,
        source: { kind: 'character-list', entry_id: character.entryId || null, anchor_kind: eventAnchorKind }
      },
      fingerprint: {
        vec: null,
        metrics: {
          appearance_count: hits.length,
          chapter_count: isNovel ? hits.length : null,
          scene_count: isNovel ? null : hits.length,
          mention_count: mentions,
          alias_count: character.aliases.length
        }
      },
      span: isNovel
        ? { first_chapter: hitFirst, last_chapter: hitLast, first_scene: null, last_scene: null, scene_count: null, chapter_count: hits.length }
        : { first_chapter: null, last_chapter: null, first_scene: hitFirst, last_scene: hitLast, scene_count: hits.length, chapter_count: null }
    })
  }

  const losses = mediumLosses.map((item) => ({ ...item }))
  if (characters.length && textMissing) {
    losses.push({ code: 'character-appearances-not-scanned', field: 'characterEntries', message: '部分单位没有正文，角色出现锚点不完整' })
  }

  const entries = [plotEntry, ...characterEntries]
  const checked = entries.map((entry) => ({ id: entry.id, name: entry.name, ...validatePediaEntry(entry) }))
  const validationWarnings = checked.flatMap((item) => item.warnings.map((warning) => ({ id: item.id, name: item.name, ...warning })))
  const invalid = checked.filter((item) => !item.ok)
  const issues = invalid.map((item) => ({ code: 'PEDIA_INVALID', id: item.id, name: item.name, errors: item.errors }))

  return {
    ok: true,
    schema: PEDIA_SCHEMA,
    valid: invalid.length === 0,
    entries,
    plotEntry,
    characterEntries,
    refIndex,
    losses,
    warnings,
    validationWarnings,
    issues
  }
}

/**
 * 小说章结构 → hub plot（一份章纲）+ character（按名单做出现锚定）。
 *
 * input：pinax_chapter_list 的 chapters 数组／{chapters, characters}。
 * 不做 LLM 抽取：事件就是章节结构本身，refs 是正文里已有的 @《…》 token。
 * 章号 = 列表序 + 1（工单允许的结构化偏离：Next 章没有数字编号）。
 */
export function novelToHubAnchors(input = {}, options = {}) {
  const book = firstString(options.book, options.bookName, input?.bookName, input?.book, '本书')
  const domain = firstString(options.domain, book)
  const extractor = firstString(options.extractor, WIKIHUB_NOVEL_EXTRACTOR)
  const units = normalizeNovelUnits(input)
  const warnings = []
  if (!units.length) warnings.push({ code: 'NO_CHAPTERS', message: '没有章节可映射：先取 pinax_chapter_list 的 chapters' })
  return buildStructureAnchors({
    medium: 'novel',
    units,
    book,
    domain,
    extractor,
    mediumLosses: NOVEL_STRUCTURE_LOSSES,
    warnings,
    characters: normalizeCharacters(input),
    plotName: `《${book}》·章纲`,
    eventAnchorKind: 'novel-chapter'
  })
}

/**
 * 剧本集结构 → hub plot（分集骨架）+ character（按名单做出现锚定）。
 * input：pinax_script_list 的 scripts 数组／{scripts, characters}；剧集即场次（provenance.scenes）。
 */
export function scriptToHubAnchors(input = {}, options = {}) {
  const book = firstString(options.book, options.bookName, input?.bookName, input?.book, '本剧')
  const domain = firstString(options.domain, book)
  const extractor = firstString(options.extractor, WIKIHUB_SCRIPT_EXTRACTOR)
  const units = normalizeScriptUnits(input)
  const warnings = []
  if (!units.length) warnings.push({ code: 'NO_EPISODES', message: '没有剧集可映射：先取 pinax_script_list 的 scripts' })
  return buildStructureAnchors({
    medium: 'script',
    units,
    book,
    domain,
    extractor,
    mediumLosses: SCRIPT_STRUCTURE_LOSSES,
    warnings,
    characters: normalizeCharacters(input),
    plotName: `《${book}》·分集骨架`,
    eventAnchorKind: 'script-file'
  })
}

/* ---------- 反向：骨架与 @《…》 ---------- */

function pickPlotEntry(input) {
  if (isPlainObject(input?.plot)) return input.plot
  if (isPlainObject(input) && input.layer === 'plot') return input
  const entries = Array.isArray(input?.entries) ? input.entries : (Array.isArray(input) ? input : [])
  return entries.find((entry) => isPlainObject(entry) && entry.layer === 'plot') ?? null
}

function pickUnits(input) {
  if (Array.isArray(input?.chapters)) return input.chapters
  if (Array.isArray(input?.scripts)) return input.scripts
  if (Array.isArray(input?.episodes)) return input.episodes
  return []
}

function skeletonForNovel(index, title, refLine) {
  const head = `## 第${index}章 ${title}`
  return refLine ? `${head}\n\n${refLine}\n\n（正文待写）\n` : `${head}\n\n（正文待写）\n`
}

function skeletonForScript(index, title, refLine) {
  const head = `# 第${index}集 ${title}`
  return refLine ? `${head}\n\n【参考】${refLine}\n\n（场次待写）\n` : `${head}\n\n（场次待写）\n`
}

function buildSkeletonRows({ plot, hints, extraRefs, medium }) {
  const events = Array.isArray(plot?.events) ? plot.events : []
  const rows = []
  for (const [position, event] of events.entries()) {
    const index = Number.isSafeInteger(event?.index) ? event.index : position + 1
    const hint = hints.find((item) => Number.isSafeInteger(item?.index) && item.index + 1 === index) ?? hints[position] ?? null
    const title = firstString(event?.title, hint?.title, medium === 'novel' ? `第 ${index} 章` : `第 ${index} 集`)
    const path = firstString(event?.anchor?.path, hint?.path, hint?.file)
    const extras = Array.isArray(extraRefs?.[index]) ? extraRefs[index] : (Array.isArray(extraRefs?.[position]) ? extraRefs[position] : [])
    const titles = uniqueStrings([...(Array.isArray(event?.refs) ? event.refs : []), ...extras])
    const refs = titles.map((name) => ({ title: name, token: `@《${name}》` }))
    const refLine = refs.map((ref) => ref.token).join(' ')
    const skeleton = medium === 'novel' ? skeletonForNovel(index, title, refLine) : skeletonForScript(index, title, refLine)
    rows.push({ index, title, path, refs, refLine, skeleton })
  }
  return rows
}

/**
 * hub plot 事件骨架 → 小说章节骨架与 @《…》引用行。
 * input：{plot}／plot 条目本身／{entries}／字符骨架提示 {chapters}。
 * 只生成骨架与引用行，正文不生成（losses 会点名）。
 */
export function hubToNovelRefs(input = {}, options = {}) {
  const losses = []
  const warnings = []
  const plot = pickPlotEntry(input)
  const chapters = buildSkeletonRows({ plot, hints: pickUnits(input), extraRefs: options.extraRefs, medium: 'novel' })
  if (!chapters.length) warnings.push({ code: 'PLOT_EVENTS_EMPTY', message: 'plot 条目没有 events，生成不出章节骨架' })
  losses.push({ code: 'chapter-body', field: 'chapters', message: '只生成章纲与 @ 引用行，正文不生成' })
  const noRefs = chapters.filter((row) => !row.refs.length).length
  if (noRefs) warnings.push({ code: 'CHAPTERS_WITHOUT_REFS', message: `${noRefs}/${chapters.length} 章没有引用行` })
  return { ok: true, chapters, losses, warnings }
}

/**
 * hub plot 事件骨架 → 剧本分集骨架与 @《…》引用行。
 * input：{plot}／plot 条目本身／{entries}／字符骨架提示 {scripts|episodes}。
 */
export function hubToScriptSkeleton(input = {}, options = {}) {
  const losses = []
  const warnings = []
  const plot = pickPlotEntry(input)
  const episodes = buildSkeletonRows({ plot, hints: pickUnits(input), extraRefs: options.extraRefs, medium: 'script' })
  if (!episodes.length) warnings.push({ code: 'PLOT_EVENTS_EMPTY', message: 'plot 条目没有 events，生成不出分集骨架' })
  losses.push({ code: 'script-body', field: 'episodes', message: '只生成分集骨架与引用行，剧本正文不生成' })
  const noRefs = episodes.filter((row) => !row.refs.length).length
  if (noRefs) warnings.push({ code: 'EPISODES_WITHOUT_REFS', message: `${noRefs}/${episodes.length} 集没有引用行` })
  return { ok: true, episodes, losses, warnings }
}

/* ---------- @《…》 ↔ hub relations ---------- */

/**
 * hub relations → @《…》 token 行。to 即被引用的标题；空目标与不可表示的标题跳过并记账。
 * options.limit 可限制条数（运行时提问的参考预算默认 4，见 MEMORY）。
 */
export function relationsToRefs(relations, options = {}) {
  const list = Array.isArray(relations) ? relations : []
  const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : list.length
  const refs = []
  const skipped = []
  const seen = new Set()
  for (const relation of list) {
    if (refs.length >= limit) break
    const title = firstString(relation?.to)
    if (!title) {
      skipped.push({ reason: 'empty-target', relation })
      continue
    }
    if (title.includes('》') || /[\r\n]/u.test(title)) {
      skipped.push({ reason: 'unrepresentable-title', title })
      continue
    }
    if (seen.has(title)) continue
    seen.add(title)
    const token = `@《${title}》`
    const ref = { title, token }
    if (typeof relation?.type === 'string' && relation.type.trim()) ref.type = relation.type.trim()
    refs.push(ref)
  }
  return { ok: true, refs, text: refs.map((ref) => ref.token).join(' '), skipped }
}

function normalizeTokenInput(input) {
  if (typeof input === 'string') return parseRefs(input)
  if (!Array.isArray(input)) return []
  const tokens = []
  for (const item of input) {
    if (typeof item === 'string') {
      tokens.push(...parseRefs(item))
      continue
    }
    const title = firstString(item?.title)
    if (title) tokens.push({ title, token: typeof item?.token === 'string' ? item.token : `@《${title}》` })
  }
  return tokens
}

/**
 * @《…》 token（正文或 token 清单）→ hub relations。
 * 与 relationsToRefs 互逆；how 存原 token，next.origin 标明来源，方便反向还原。
 */
export function refsToRelations(input, options = {}) {
  const type = firstString(options.type, 'reference')
  const tokens = normalizeTokenInput(input)
  const relations = []
  const seen = new Set()
  for (const token of tokens) {
    if (seen.has(token.title)) continue
    seen.add(token.title)
    relations.push({
      to: token.title,
      type,
      how: token.token,
      next: { origin: 'ref-token', token: token.token }
    })
  }
  return { ok: true, relations, tokens }
}
