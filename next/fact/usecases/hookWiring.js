/**
 * P4 S3 接线薄层（纯函数）：把「作者保存了什么／续写了什么」翻译成 hook 引擎能吃的输入。
 *
 * 这一层不读盘、不写盘、不认识宿主（ADR S3 的分层仍成立）：
 *   - 保存：从工具参数里取正文，抽 @《…》 引用，找出 hub 里没有的实体；
 *   - 补全建议：把 suggestCompletion 的结果装成一份待审提案；
 *   - 实体草案：每个缺失实体给一条 worldview 空草案（status=proposed、pipelinePending），
 *     精抽取留给拆书管线批，这里只保证「引用过的名字在 hub 里有个可补全的位置」。
 *
 * 两条纪律：
 *   1) 绝不生成覆盖作者条目的东西——这里只造新 id 的草案，不改既有条目；
 *   2) 提案只是 `.pinax/proposals/` 里的一份 JSON，正文与修订号一个字节都不动。
 */

import { extractRefs } from './precheck.js'
import { createAliasIndex } from '../domain/aliases.js'
import { stableEntryId } from '../domain/stableId.js'
import { OTHER_SLOT, FACT_SCHEMA } from '../domain/vocabulary.js'

export const FACT_HOOK_WIRING_VERSION = 'fact-hook-wiring/v1'

/** 草案来源标识：与拆书管线（analyze）分开，方便管线跑过来时认出这是钩子占的位。 */
export const DRAFT_EXTRACTOR = 'pinax-next/fact-hooks@1'

/** 提案外形版本：`.pinax/proposals/` 的既有 JSON 外壳，kind 用 fact-* 区分。 */
export const FACT_PROPOSAL_SCHEMA = 'pinax-proposal@1'

/**
 * 会触发保存钩子的工具 → 保存物类别。
 * 章节/大纲是工单点名的两条；世界书保存也收进来——它是唯一会真正改变 hub 派生结果的保存，
 * 不收它的话「保存前 hub 快照 vs 保存后」永远是同一份，diff 校验就只剩草稿预检。
 */
export const SAVE_HOOK_TOOLS = Object.freeze({
  pinax_chapter_save: 'chapter',
  pinax_outline_save: 'outline',
  pinax_worldbook_save: 'worldbook'
})

export function saveHookKindOf(tool) {
  return SAVE_HOOK_TOOLS[String(tool ?? '')] ?? null
}

export function isSaveHookTool(tool) {
  return saveHookKindOf(tool) !== null
}

/**
 * 从保存工具的参数里取「作者这次写下的文字」。
 * 只做结构拼接，不做语义抽取：大纲把节点标题/摘要等字符串字段按序拼起来，
 * 世界书取正文；章节直接取 text。取不到就返回空串（调用方据此跳过）。
 */
export function textOfSaveArgs(tool, args = {}) {
  const kind = saveHookKindOf(tool)
  if (!kind) return ''
  const source = isPlainObject(args) ? args : {}
  if (kind === 'chapter') return str(source.text)
  if (kind === 'worldbook') return firstText(source.content, source.text, source.body)
  const parts = []
  for (const node of Array.isArray(source.nodes) ? source.nodes : []) {
    if (!isPlainObject(node)) continue
    const title = firstText(node.title, node.name)
    const body = firstText(node.summary, node.content, node.description, node.text, node.note, node.beat, node.conflict, node.turn)
    if (title) parts.push(title)
    if (body) parts.push(body)
  }
  for (const edge of Array.isArray(source.edges) ? source.edges : []) {
    if (!isPlainObject(edge)) continue
    const label = firstText(edge.label, edge.note, edge.description, edge.reason)
    if (label) parts.push(label)
  }
  return parts.join('\n')
}

/**
 * 正文里出现、但 hub 条目（name／aliases）里没有的引用。
 * 返回去重后的引用名，保持正文出现顺序；同名但只在大小写/空白上不同的仍算命中（trim 口径）。
 */
export function detectMissingEntities({ text, entries } = {}) {
  const list = Array.isArray(entries) ? entries.filter(isPlainObject) : []
  const aliasIndex = createAliasIndex(list)
  const missing = []
  for (const ref of extractRefs(text)) {
    const name = str(ref).trim()
    if (!name || missing.includes(name)) continue
    if (aliasIndex.resolve(name)) continue
    if (list.some((entry) => str(entry.name).trim() === name)) continue
    missing.push(name)
  }
  return missing
}

/**
 * 为缺失实体造一条可校验的 worldview 空草案。
 * 不覆盖作者条目：id 由 stableEntryId 按「层|域|槽|名」算出，已存在同名条目时调用方应先查重
 * （detectMissingEntities 已经保证了「hub 里没有」才会走到这里）。
 */
export function draftEntryForEntity(name, options = {}) {
  const entity = str(name).trim()
  if (!entity) return null
  const domain = firstText(options.domain, options.book, '未分类')
  const book = firstText(options.book, domain)
  const slot = firstText(options.slot, OTHER_SLOT)
  const extractor = firstText(options.extractor, DRAFT_EXTRACTOR)
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain, slot, name: entity }),
    layer: 'worldview',
    domain,
    slot,
    name: entity,
    definition: `正文引用了「${entity}」，这是 fact 钩子自动建的空草案（pipelinePending）；设定正文待作者或拆书管线补齐。`,
    provenance: {
      mode: 'author',
      book,
      book_id: book,
      chapters: [],
      scenes: [],
      extractor
    },
    status: 'proposed',
    pipelinePending: true
  }
}

/**
 * 续写建议提案：内容＝suggestCompletion 的建议清单，采纳与否完全由作者决定。
 * 不写 content 字段（它不是正文提案），老采纳口据此不会把它当成整章替换。
 */
export function buildSuggestionProposal({ action = 'continue', suggestions = [], completion = null, notes = [], counts = null, at = new Date(), id = '' } = {}) {
  const list = Array.isArray(suggestions) ? suggestions : []
  return {
    schema: FACT_PROPOSAL_SCHEMA,
    kind: 'fact-suggestions',
    id: str(id),
    status: 'pending',
    createdAt: toISO(at),
    target: { kind: 'fact', action: str(action) },
    note: `续写补全建议 ${list.length} 条（只给建议，不自动改正文）`,
    suggestions: list,
    completion: completion ?? null,
    notes: Array.isArray(notes) ? [...notes] : [],
    counts: isPlainObject(counts) ? { ...counts } : null
  }
}

/** 缺失实体提案：一份 JSON 里带全部草案条目，作者或管线一次性补全。 */
export function buildDraftEntriesProposal({ tool = '', entries = [], missing = [], at = new Date(), id = '' } = {}) {
  const list = Array.isArray(entries) ? entries : []
  const names = list.map((entry) => str(entry?.name).trim()).filter(Boolean)
  return {
    schema: FACT_PROPOSAL_SCHEMA,
    kind: 'fact-draft-entries',
    id: str(id),
    status: 'pending',
    createdAt: toISO(at),
    target: { kind: 'fact', source: str(tool) },
    note: `保存后发现 ${list.length} 个正文引用但 hub 没有的条目（${names.join('、')}）；草案 status=proposed、pipelinePending=true，等作者或拆书管线补全。`,
    entries: list,
    missing: Array.isArray(missing) && missing.length ? [...missing] : names
  }
}

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

function toISO(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}
