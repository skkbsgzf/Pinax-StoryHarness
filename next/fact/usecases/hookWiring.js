/**
 * P4 S3 接线薄层（纯函数）＋ F2 写工具注册表：把「作者保存了什么／续写了什么」翻译成 hook 引擎能吃的输入。
 *
 * 这一层不读盘、不写盘、不认识宿主（ADR S3 的分层仍成立）：
 *   - 保存：从工具参数里取作者写下的文字（内容驱动，不再依赖 @《…》 符号）；
 *   - 实体草案：候选名 → 与 hub 已有条目／既有 proposed 草案去重 → worldview 空草案（pipelinePending）；
 *   - 补全建议：把 suggestCompletion 的结果装成一份待审提案。
 *
 * F2 口径（作者 2026-11-09 纠偏）：fact 的更新与使用绑定在**工具调用**上，与正文符号无关。
 *   - 触发面＝写工具清单（kernel/carrier 落点表由宿主注入），注册表里加一行即接；
 *   - `@《…》` 只是视图层的蓝链解析信号（precheck 仍用它解析引用），不驱动 fact 写入。
 *
 * 两条纪律：
 *   1) 绝不生成覆盖作者条目的东西——这里只造新 id 的草案，不改既有条目；
 *   2) 提案只是 `.pinax/proposals/` 里的一份 JSON，正文与修订号一个字节都不动。
 */

import { createAliasIndex } from '../domain/aliases.js'
import { stableEntryId } from '../domain/stableId.js'
import { OTHER_SLOT, FACT_SCHEMA } from '../domain/vocabulary.js'

export const FACT_HOOK_WIRING_VERSION = 'fact-hook-wiring/v2'

/** 草案来源标识：与拆书管线（analyze）分开，方便管线跑过来时认出这是钩子占的位。 */
export const DRAFT_EXTRACTOR = 'pinax-next/fact-hooks@1'

/** 提案外形版本：`.pinax/proposals/` 的既有 JSON 外壳，kind 用 fact-* 区分。 */
export const FACT_PROPOSAL_SCHEMA = 'pinax-proposal@1'

/* ---------- 取文字：按工具参数形状分策略 ---------- */

/** 从任意参数里按常见正文/定义字段名收集文字（未知写工具的兜底）。 */
function collectTextFields(source, depth = 0) {
  if (depth > 3) return []
  const fields = ['text', 'content', 'body', 'definition', 'summary', 'description', 'note', 'notes', 'excerpt', 'quote', 'title', 'label', 'reason']
  const parts = []
  for (const key of fields) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) parts.push(value.trim())
  }
  for (const value of Object.values(source)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isPlainObject(item)) parts.push(...collectTextFields(item, depth + 1))
    } else if (isPlainObject(value)) {
      parts.push(...collectTextFields(value, depth + 1))
    }
  }
  return parts
}

const TEXT_EXTRACTORS = Object.freeze({
  text: (args) => str(args.text),
  content: (args) => firstText(args.content, args.text, args.body),
  outline: (args) => {
    const parts = []
    for (const node of Array.isArray(args.nodes) ? args.nodes : []) {
      if (!isPlainObject(node)) continue
      const title = firstText(node.title, node.name)
      const body = firstText(node.summary, node.content, node.description, node.text, node.note, node.beat, node.conflict, node.turn)
      if (title) parts.push(title)
      if (body) parts.push(body)
    }
    for (const edge of Array.isArray(args.edges) ? args.edges : []) {
      if (!isPlainObject(edge)) continue
      const label = firstText(edge.label, edge.note, edge.description, edge.reason)
      if (label) parts.push(label)
    }
    return parts.join('\n')
  },
  generic: (args) => collectTextFields(args).join('\n')
})

/* ---------- 写工具注册表 ---------- */

/**
 * 写工具 → 钩子配置的集中表（F2 的「加一行即接」）。
 * `text` 指向 TEXT_EXTRACTORS 的策略键；`refreshHub`＝保存后要不要重量 hub 快照
 * （世界书是唯一会真正改变 hub 派生结果的保存，不重量它 diff 就只剩草稿预检）。
 *
 * 未在表里的写工具（新增的 carrier/kernel 写口）自动落到 DEFAULT_WRITE_HOOK：
 * 按参数里的常见文字字段取样，照样走同一条内容管线——不要求作者为每把新写口再改 fact 代码。
 */
export const WRITE_HOOK_REGISTRY = Object.freeze({
  pinax_chapter_save: Object.freeze({ kind: 'chapter', text: 'text', refreshHub: false }),
  pinax_outline_save: Object.freeze({ kind: 'outline', text: 'outline', refreshHub: false }),
  pinax_worldbook_save: Object.freeze({ kind: 'worldbook', text: 'content', refreshHub: true })
})

export const DEFAULT_WRITE_HOOK = Object.freeze({ kind: 'write', text: 'generic', refreshHub: false })

/**
 * 写工具注册表实例：以宿主注入的写工具清单为触发面，表内配置优先，表外写工具用默认钩子。
 *
 * @param {Object} [input]
 * @param {string[]} [input.writeTools] 宿主侧写工具清单（kernel/carrier 落点表），注入一次即覆盖未来写口
 * @param {Object} [input.registry] 配置表（默认 WRITE_HOOK_REGISTRY，测试可换）
 */
export function createWriteHookRegistry({ writeTools = [], registry = WRITE_HOOK_REGISTRY } = {}) {
  const declared = Array.isArray(writeTools) ? writeTools.map((name) => str(name).trim()).filter(Boolean) : []
  const table = registry && typeof registry === 'object' ? registry : WRITE_HOOK_REGISTRY
  const tools = [...new Set([...Object.keys(table), ...declared])]

  function resolve(tool) {
    const name = str(tool).trim()
    if (!name) return null
    const config = table[name]
    const hook = config ? { ...config } : tools.includes(name) ? { ...DEFAULT_WRITE_HOOK } : null
    if (!hook) return null
    const extract = TEXT_EXTRACTORS[hook.text] ?? TEXT_EXTRACTORS.generic
    return { ...hook, tool: name, extract }
  }

  return Object.freeze({
    version: FACT_HOOK_WIRING_VERSION,
    tools: Object.freeze(tools),
    isWriteTool(tool) {
      return resolve(tool) !== null
    },
    kindOf(tool) {
      return resolve(tool)?.kind ?? null
    },
    textOf(tool, args = {}) {
      const hook = resolve(tool)
      if (!hook) return ''
      return hook.extract(isPlainObject(args) ? args : {})
    },
    resolve
  })
}

/* ---------- 去重：候选 vs hub vs 既有草案 ---------- */

/**
 * 把内容管线挖出的候选名筛成「真缺失」：
 *   - hub 已收录（name／aliases，别名归一口径）→ 跳过；
 *   - 已有同名 proposed 草案（包括上一次保存留下的）→ 跳过并计数，不重复造草案。
 *
 * @param {Object} input
 * @param {string[]} input.candidates 候选名（内容管线输出）
 * @param {Object[]} [input.entries] hub 条目集
 * @param {string[]} [input.proposed] 既有 proposed 草案名（宿主从提案目录读出）
 * @returns {{missing:string[], skipped:{hub:string[], proposed:string[]}}}
 */
export function filterMissingEntities({ candidates = [], entries = [], proposed = [] } = {}) {
  const list = Array.isArray(entries) ? entries.filter(isPlainObject) : []
  const aliasIndex = createAliasIndex(list)
  const knownNames = new Set(list.map((entry) => str(entry.name).trim()).filter(Boolean))
  const pendingNames = new Set((Array.isArray(proposed) ? proposed : []).map((name) => str(name).trim()).filter(Boolean))
  const missing = []
  const skipped = { hub: [], proposed: [] }
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const name = str(raw).trim()
    if (!name || missing.includes(name)) continue
    if (knownNames.has(name) || aliasIndex.resolve(name)) {
      if (!skipped.hub.includes(name)) skipped.hub.push(name)
      continue
    }
    if (pendingNames.has(name)) {
      if (!skipped.proposed.includes(name)) skipped.proposed.push(name)
      continue
    }
    missing.push(name)
  }
  return { missing, skipped }
}

/**
 * 为缺失实体造一条可校验的 worldview 空草案。
 * 不覆盖作者条目：id 由 stableEntryId 按「层|域|槽|名」算出，已存在同名条目／草案时
 * 调用方应先经 filterMissingEntities 查重。
 */
export function draftEntryForEntity(name, options = {}) {
  const entity = str(name).trim()
  if (!entity) return null
  const domain = firstText(options.domain, options.book, '未分类')
  const book = firstText(options.book, domain)
  const slot = firstText(options.slot, OTHER_SLOT)
  const extractor = firstText(options.extractor, DRAFT_EXTRACTOR)
  const source = firstText(options.source)
  const evidence = Array.isArray(options.evidence) ? options.evidence.map(str).filter(Boolean).slice(0, 3) : []
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain, slot, name: entity }),
    layer: 'worldview',
    domain,
    slot,
    name: entity,
    definition: `保存的内容里出现了「${entity}」，这是 fact 钩子自动建的空草案（pipelinePending）；设定正文待作者或拆书管线补齐。`,
    provenance: {
      mode: 'author',
      book,
      book_id: book,
      chapters: [],
      scenes: [],
      extractor,
      ...(source ? { source } : {}),
      ...(evidence.length ? { evidence } : {})
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
export function buildDraftEntriesProposal({ tool = '', entries = [], missing = [], skipped = null, at = new Date(), id = '' } = {}) {
  const list = Array.isArray(entries) ? entries : []
  const names = list.map((entry) => str(entry?.name).trim()).filter(Boolean)
  const skipNote = isPlainObject(skipped) && (skipped.proposed?.length || skipped.hub?.length)
    ? `（已跳过：hub 已有 ${skipped.hub?.length ?? 0} 个、既有草案 ${skipped.proposed?.length ?? 0} 个）`
    : ''
  return {
    schema: FACT_PROPOSAL_SCHEMA,
    kind: 'fact-draft-entries',
    id: str(id),
    status: 'pending',
    createdAt: toISO(at),
    target: { kind: 'fact', source: str(tool) },
    note: `保存后发现 ${list.length} 个内容里出现但 hub 没有的实体（${names.join('、')}）${skipNote}；草案 status=proposed、pipelinePending=true，等作者或拆书管线补全。`,
    entries: list,
    missing: Array.isArray(missing) && missing.length ? [...missing] : names,
    skipped: isPlainObject(skipped)
      ? { hub: [...(skipped.hub ?? [])], proposed: [...(skipped.proposed ?? [])] }
      : { hub: [], proposed: [] }
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
