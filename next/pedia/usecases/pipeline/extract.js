/**
 * P2a 抽取 usecase：章节原文 → 段（100–300 字）→ LlmPort → pedia/v2 plot 草稿。
 *
 * 业务口径来自 NovelPedia `src/extract.py`（只读参照）：
 *   - `_parse_json` 的容错解析（剥围栏、截取首个对象）；
 *   - `_clean_who` / `_clean_actinfo` 的程序侧硬清洗（渠道白名单、条数上限、同类合并）；
 *   - `extract_scene_v2` 的 who/when/where/actinfo/notes 薄 schema；
 *   - `extract_all` 的失败隔离（单段失败只记 failures，不阻塞其余段）。
 *
 * 与参考实现的差异（ADR P2a）：
 *   - 文本先由 domain/segment.js 切成 100–300 字的段，一段一次 LLM、一份草稿；
 *   - 输出是 pedia/v2 plot 草稿：status=draft、provenance.mode=analyze；
 *   - analyze 模式禁止存原文，provenance 只记 quote_hash（sha1）；
 *   - 同一 bundle 重跑用确定性 operationId 幂等，不重复落库。
 *
 * 不读写磁盘、不依赖宿主模块：LLM 与 PediaStore 都从端口注入。
 */

import { PEDIA_SCHEMA } from '../../domain/vocabulary.js'
import { sha1Hex, stableEntryId } from '../../domain/stableId.js'
import { validatePediaEntry } from '../../domain/schema.js'
import { canTransitionStatus } from '../../domain/status.js'
import { segmentStats, segmentText } from '../../domain/segment.js'
import { assertLlmPort } from '../../ports/llmPort.js'
import { assertPediaStore } from '../../ports/pediaStore.js'
import { EXTRACT_SYSTEM_PROMPT, buildExtractPrompt } from './prompts.mjs'

/** 契约上限：解析失败最多重试 2 次（合计最多 3 次调用）。 */
export const PIPELINE_MAX_RETRIES = 2

export const V2_CHANNELS = Object.freeze(['see', 'hear', 'feel', 'do', 'say', 'recall', 'reason'])
export const V2_MAX_ACTINFO = 12

const ROLES = new Set(['主事', '参与', '提及'])
const TIMELINES = new Set(['顺叙', '倒叙', '插叙'])
const DEFAULT_EXTRACTOR = 'pedia/pipeline/extract@1'

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

function clampRetries(value) {
  if (!Number.isInteger(value)) return PIPELINE_MAX_RETRIES
  return Math.max(0, Math.min(PIPELINE_MAX_RETRIES, value))
}

function integerList(values) {
  const list = Array.isArray(values) ? values.filter((value) => Number.isInteger(value)) : []
  return [...new Set(list)].sort((left, right) => left - right)
}

/**
 * 容错 JSON 解析：剥 ``` 围栏、截取首个 { 到末个 }，再退回数组括号。
 * 返回 { ok, value, code }；不抛异常，由调用方决定是否重试。
 */
export function parseJsonLoose(text) {
  const raw = str(text).trim()
  if (!raw) return { ok: false, value: null, code: 'EMPTY_OUTPUT' }

  let candidate = raw
  if (candidate.startsWith('```')) {
    candidate = candidate.replace(/^```[A-Za-z]*\s*/u, '')
    const end = candidate.lastIndexOf('```')
    if (end !== -1) candidate = candidate.slice(0, end)
  }
  candidate = candidate.trim()

  const attempts = [candidate]
  const objectStart = candidate.indexOf('{')
  const objectEnd = candidate.lastIndexOf('}')
  if (objectStart !== -1 && objectEnd > objectStart) {
    attempts.push(candidate.slice(objectStart, objectEnd + 1))
  }
  const arrayStart = candidate.indexOf('[')
  const arrayEnd = candidate.lastIndexOf(']')
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    attempts.push(candidate.slice(arrayStart, arrayEnd + 1))
  }

  for (const attempt of attempts) {
    try {
      return { ok: true, value: JSON.parse(attempt), code: null }
    } catch {
      // 继续尝试下一个候选切片；全部失败后返回 JSON_PARSE_FAILED。
    }
  }
  return { ok: false, value: null, code: 'JSON_PARSE_FAILED' }
}

/**
 * 调一次 LlmPort，解析失败自动重试（≤2 次）。
 * @param {Object} llm LlmPort
 * @param {{system?:string, prompt:string}} request
 * @param {{maxRetries?:number, expect?:'object'|'array'|'any'}} [options]
 * @returns {Promise<{ok:boolean, value?:*, attempts:number, errors?:Array}>}
 */
export async function completeWithRetries(llm, request = {}, options = {}) {
  assertLlmPort(llm)
  const maxRetries = clampRetries(options.maxRetries)
  const expect = options.expect ?? 'object'
  const errors = []

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const prompt = attempt === 1
      ? str(request.prompt)
      : `${str(request.prompt)}\n\n【纠正】上次输出无法解析为 JSON。只输出一个 JSON ${expect === 'array' ? '数组' : '对象'}，不要解释、不要代码围栏。`
    try {
      const result = await llm.complete({
        system: request.system,
        prompt,
        maxTokens: request.maxTokens,
        signal: request.signal
      })
      const text = typeof result === 'string' ? result : str(result?.text)
      const parsed = parseJsonLoose(text)
      const accepts = parsed.ok && (
        expect === 'array' ? Array.isArray(parsed.value)
          : expect === 'any' ? parsed.value !== null && parsed.value !== undefined
            : isPlainObject(parsed.value)
      )
      if (accepts) return { ok: true, value: parsed.value, attempts: attempt }
      errors.push({ attempt, code: parsed.code ?? 'SHAPE_MISMATCH', message: `输出不是期望的 JSON ${expect}` })
    } catch (error) {
      errors.push({ attempt, code: 'LLM_ERROR', message: str(error?.message ?? error) })
    }
  }
  return { ok: false, attempts: maxRetries + 1, errors }
}

/** 清洗人物数组：名称非空去重，role 归一到 主事/参与/提及。 */
export function cleanWho(who) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(who) ? who : []) {
    if (!isPlainObject(item)) continue
    const name = str(item.name).trim()
    if (!name || seen.has(name)) continue
    const role = ROLES.has(str(item.role).trim()) ? str(item.role).trim() : '参与'
    seen.add(name)
    out.push({ name, role })
  }
  return out
}

/**
 * 清洗 actinfo（程序侧硬约束，不依赖模型自觉）：
 *   - event：scope 只留 "*" 或 who 名单内名字，空则兜底 ["*"]；
 *   - act：channel 必须命中白名单且 who 非空，否则丢弃；
 *   - 同一 (type, who, channel) 最多 2 条，第 3 条起并入最近一条；
 *   - 条数上限按原文规模缩放：clamp(floor(chars/60), 2, 12)，仍超则合并相邻同类。
 */
export function cleanActinfo(actinfo, whoNames, srcChars = 0) {
  const names = whoNames instanceof Set ? whoNames : new Set(Array.isArray(whoNames) ? whoNames : [])
  const cleaned = []
  for (const item of Array.isArray(actinfo) ? actinfo : []) {
    if (!isPlainObject(item)) continue
    const type = str(item.type || 'act').trim()
    const content = str(item.content).trim()
    if (!content) continue
    if (type === 'event') {
      const scope = []
      for (const raw of Array.isArray(item.scope) ? item.scope : []) {
        const name = str(raw).trim()
        if (!name || scope.includes(name)) continue
        if (name === '*' || names.has(name)) scope.push(name)
      }
      cleaned.push({ type: 'event', content, scope: scope.length ? scope : ['*'] })
      continue
    }
    const channel = str(item.channel).trim()
    const who = str(item.who).trim()
    if (!V2_CHANNELS.includes(channel) || !who) continue
    cleaned.push({ type: 'act', channel, who, content })
  }

  const counts = new Map()
  const merged = []
  for (const item of cleaned) {
    const key = `${item.type}|${item.who ?? ''}|${item.channel ?? ''}`
    if ((counts.get(key) ?? 0) >= 2) {
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        const target = merged[index]
        if (target.type !== item.type || target.who !== item.who || target.channel !== item.channel) continue
        if (item.type === 'event') {
          for (const name of item.scope) if (!target.scope.includes(name)) target.scope.push(name)
        }
        target.content += `；${item.content}`
        break
      }
      continue
    }
    merged.push({ ...item, ...(item.type === 'event' ? { scope: [...item.scope] } : {}) })
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const cap = srcChars > 0 ? Math.max(2, Math.min(V2_MAX_ACTINFO, Math.floor(srcChars / 60))) : V2_MAX_ACTINFO
  while (merged.length > cap) {
    let best = -1
    for (let index = 0; index < merged.length - 1; index += 1) {
      const left = merged[index]
      const right = merged[index + 1]
      if (left.type === right.type && (left.who === right.who || left.channel === right.channel)) {
        best = index
        break
      }
    }
    if (best === -1) break
    const [left, right] = [merged[best], merged.splice(best + 1, 1)[0]]
    if (right.type === 'event') {
      for (const name of right.scope) if (!left.scope.includes(name)) left.scope.push(name)
    }
    left.content += `；${right.content}`
  }
  return merged.slice(0, cap)
}

/**
 * 把模型输出归一成抽取记录（不含原文，只含 who/when/where/actinfo/notes）。
 * @param {Object} raw 模型 JSON
 * @param {{chapterNo?:number, sceneId?:number|string, segment?:{index:number, chars:number}}} [context]
 */
export function normalizeExtraction(raw, context = {}) {
  const source = isPlainObject(raw) ? raw : {}
  const segment = isPlainObject(context.segment) ? context.segment : {}
  const who = cleanWho(source.who)
  const names = new Set(who.map((item) => item.name))
  const chars = Number.isInteger(segment.chars) ? segment.chars : 0
  const actinfo = cleanActinfo(source.actinfo, names, chars)

  for (const item of actinfo) {
    if (item.type !== 'act' || names.has(item.who)) continue
    who.push({ name: item.who, role: '参与' })
    names.add(item.who)
  }

  const when = isPlainObject(source.when) ? source.when : {}
  const timeline = TIMELINES.has(str(when.timeline).trim()) ? str(when.timeline).trim() : '顺叙'
  return {
    schema: 'pedia-extract/v2',
    chapterNo: Number.isInteger(context.chapterNo) ? context.chapterNo : null,
    sceneId: context.sceneId ?? null,
    segment: {
      index: Number.isInteger(segment.index) ? segment.index : 1,
      chars: Number.isInteger(segment.chars) ? segment.chars : 0
    },
    who,
    when: { story_time: firstText(when.story_time, '未明示'), timeline },
    where: firstText(source.where, '未明示'),
    actinfo,
    notes: str(source.notes).trim()
  }
}

/**
 * 抽取记录 → pedia/v2 plot 草稿（status=draft，provenance.mode=analyze，只存 quote_hash）。
 * @param {Object} extraction normalizeExtraction 的输出
 * @param {{domain?:string, book?:string, bookId?:string, sceneId?:number|string, text:string, extractor?:string}} context
 */
export function buildPlotDraft(extraction, context = {}) {
  const record = isPlainObject(extraction) ? extraction : {}
  const segment = isPlainObject(record.segment) ? record.segment : { index: 1, chars: 0 }
  const chapterNo = Number.isInteger(record.chapterNo) ? record.chapterNo : null
  const domain = str(context.domain).trim()
  const name = `第${chapterNo ?? 0}章·段${segment.index}`
  const actinfo = Array.isArray(record.actinfo) ? record.actinfo : []
  const who = Array.isArray(record.who) ? record.who : []

  const acts = actinfo.filter((item) => item.type === 'act').length
  const events = actinfo.filter((item) => item.type === 'event').length
  const whoNames = who.map((item) => item.name)
  const summary = firstText(
    record.notes,
    actinfo.map((item) => item.content).join('；'),
    record.where
  )
  const title = firstText(record.notes, `${record.where}·${whoNames.join('/')}`).slice(0, 24)

  const draft = {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain, slot: '', name }),
    layer: 'plot',
    name,
    domain,
    status: 'draft',
    fact: summary,
    events: [{
      index: 1,
      track: 'fact',
      title,
      refs: whoNames,
      segments: [{ index: segment.index, chars: segment.chars }],
      novelty: []
    }],
    provenance: {
      mode: 'analyze',
      book: str(context.book).trim(),
      book_id: str(context.bookId).trim(),
      chapters: chapterNo === null ? [] : [chapterNo],
      scenes: integerList([context.sceneId]),
      extractor: firstText(context.extractor, DEFAULT_EXTRACTOR),
      quote_hash: sha1Hex(context.text)
    },
    fingerprint: {
      vec: null,
      metrics: { chars: segment.chars, acts, events, characters: who.length }
    }
  }
  if (chapterNo !== null) draft.validity = { from: chapterNo, to: chapterNo }
  return draft
}

/**
 * 幂等落库：确定性 operationId + 状态机保护。
 * 未变内容重跑 = 同一 operationId 重放（duplicate=true），不会新增条目；
 * 已 adopted/superseded 的条目不会因流水线草稿被降级。
 * @returns {Promise<{saved:Object[], warnings:Object[]}>}
 */
export async function persistEntries(store, entries, options = {}) {
  if (!store) return { saved: [], warnings: [] }
  assertPediaStore(store)
  const prefix = firstText(options.operationPrefix, 'pedia-pipeline')
  const saved = []
  const warnings = []

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isPlainObject(entry) || !str(entry.id)) continue
    let current = await store.get(entry.id)
    if (current && !canTransitionStatus(current.entry.status, entry.status)) {
      warnings.push({
        code: 'STATUS_TRANSITION_BLOCKED',
        entryId: entry.id,
        from: str(current.entry.status),
        to: str(entry.status),
        message: `条目 ${entry.id} 状态 ${current.entry.status} 不能降到 ${entry.status}，跳过写入`
      })
      saved.push({ id: entry.id, ok: false, code: 'STATUS_TRANSITION_BLOCKED' })
      continue
    }
    const operationId = `${prefix}:${entry.id}:${sha1Hex(JSON.stringify(entry)).slice(0, 12)}`
    const write = () => store.save(entry, {
      operationId,
      expectedRevision: current ? current.revision : 0
    })
    let result = await write()
    if (!result.ok && result.code === 'REVISION_MISMATCH') {
      current = await store.get(entry.id)
      result = await write()
    }
    saved.push({ id: entry.id, ...result })
  }
  return { saved, warnings }
}

/**
 * 抽取一章（或一段 bundle）：
 *   text → segmentText（100–300 字/段）→ LlmPort（容错 + ≤2 次重试）→ plot 草稿。
 * 单段失败只进 failures，不阻塞其余段；传 store 时按确定性 operationId 幂等落库。
 *
 * @param {Object} input
 * @param {string} input.text 章节原文
 * @param {Object} input.llm LlmPort
 * @param {string} [input.domain]
 * @param {number} [input.chapterNo]
 * @param {number|string} [input.sceneId]
 * @param {string} [input.book]
 * @param {string} [input.bookId]
 * @param {string[]} [input.knownNames]
 * @param {string} [input.extractor]
 * @param {Object} [input.store] PediaStore
 * @param {number} [options.maxRetries] 0–2，默认 2
 */
export async function extractChapter(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {}
  const llm = source.llm ?? options.llm
  assertLlmPort(llm)
  const store = source.store ?? options.store
  const text = firstText(source.text, source.chapterText)
  const domain = str(source.domain).trim()
  const chapterNo = Number.isInteger(source.chapterNo) ? source.chapterNo : null
  const sceneId = source.sceneId
  const book = str(source.book).trim()
  const bookId = str(source.bookId).trim()
  const extractor = firstText(source.extractor, DEFAULT_EXTRACTOR)
  const maxRetries = clampRetries(options.maxRetries ?? source.maxRetries)

  if (!text) {
    return {
      ok: false,
      domain,
      chapterNo,
      segments: segmentStats([]),
      extractions: [],
      drafts: [],
      failures: [{ code: 'EMPTY_TEXT', message: '没有可抽取的章节文本' }],
      warnings: [],
      saved: []
    }
  }

  const segments = segmentText(text)
  const extractions = []
  const drafts = []
  const failures = []
  const warnings = []
  let prevTail = ''

  for (const segment of segments) {
    const prompt = buildExtractPrompt({
      segment,
      chapterNo,
      sceneId,
      prevTail,
      knownNames: source.knownNames
    })
    prevTail = segment.text.slice(-40)
    const call = await completeWithRetries(
      llm,
      { system: EXTRACT_SYSTEM_PROMPT, prompt },
      { maxRetries, expect: 'object' }
    )
    if (!call.ok) {
      failures.push({
        segmentIndex: segment.index,
        code: 'EXTRACT_FAILED',
        message: `第 ${segment.index} 段抽取失败（${call.attempts} 次尝试）`,
        attempts: call.attempts,
        errors: call.errors
      })
      continue
    }

    const extraction = normalizeExtraction(call.value, { chapterNo, sceneId, segment })
    extractions.push(extraction)
    const draft = buildPlotDraft(extraction, { domain, book, bookId, sceneId, text: segment.text, extractor })
    const validation = validatePediaEntry(draft)
    if (!validation.ok) {
      failures.push({ segmentIndex: segment.index, code: 'DRAFT_INVALID', errors: validation.errors })
      continue
    }
    if (validation.warnings.length) {
      warnings.push({ segmentIndex: segment.index, code: 'DRAFT_WARNINGS', warnings: validation.warnings })
    }
    drafts.push(draft)
  }

  let saved = []
  if (store && drafts.length) {
    const persistence = await persistEntries(store, drafts, {
      operationPrefix: `pipeline:extract:${bookId || domain || 'default'}:${chapterNo ?? 0}`
    })
    saved = persistence.saved
    warnings.push(...persistence.warnings)
  }

  return {
    ok: failures.length === 0,
    domain,
    chapterNo,
    segments: segmentStats(segments),
    extractions,
    drafts,
    failures,
    warnings,
    saved
  }
}
