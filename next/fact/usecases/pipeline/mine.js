/**
 * P2a 挖掘 usecase：抽取记录 → 人物言行锚点 / memoryPoints / 设定定义补充。
 *
 * 业务口径来自 NovelPedia（只读参照）：
 *   - `src/character_agent.py`：`collect_from_actinfo`（按 say/do 渠道聚合言行、共现）
 *     与 `RESUME_SYSTEM/RESUME_USER`（简历式档案）；
 *   - `src/setting_agent.py`：`SET_SYSTEM/SET_USER`（本书专有设定识别、拒收通用词、
 *     别名同实体、定义用"；"拼接）与 `normalize_terms` 的同类别归并纪律；
 *   - `src/stage2_mine.py`：模块失败隔离（单个人物/单章失败不阻塞其余）。
 *
 * 与参考实现的差异（ADR P2a）：
 *   - 输出 fact.data/v2 条目：character 带 anchors{speech,behavior,catchphrase} 与 memoryPoints；
 *     worldview 带 definition/aliases/slot，并给已有条目的 definition 做补充；
 *   - 新条目 status=proposed；已有条目走状态机（adopted 不降级、superseded 不复活）；
 *   - analyze 模式：provenance 只记锚点与哈希口径，不存原文。
 */

import { FACT_SCHEMA, CAST_ROLE_TIERS, slotForCategory } from '../../domain/vocabulary.js'
import { stableEntryId } from '../../domain/stableId.js'
import { validateFactEntry } from '../../domain/schema.js'
import { canTransitionStatus } from '../../domain/status.js'
import { createAliasIndex } from '../../domain/aliases.js'
import { assertLlmPort } from '../../ports/llmPort.js'
import { assertFactStore } from '../../ports/pediaStore.js'
import { completeWithRetries, persistEntries } from './extract.js'
import { MINE_CHARACTER_SYSTEM_PROMPT, MINE_SETTING_SYSTEM_PROMPT, buildMineCharacterPrompt, buildMineSettingPrompt } from './prompts.mjs'

const DEFAULT_EXTRACTOR = 'fact/pipeline/mine@1'

/** 参考实现明确拒收的通用名词（放在别的小说里同样成立，没有记录意义）。 */
export const GENERIC_SETTING_TERMS = Object.freeze([
  '医院', '诊所', '学校', '酒吧',
  '队友', '敌人', '朋友', '同伴',
  '武器', '装备', '药水', '食物'
])

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

function uniqueStrings(values, limit = Infinity) {
  const out = []
  for (const raw of Array.isArray(values) ? values : []) {
    const value = str(raw).trim()
    if (!value || out.includes(value)) continue
    out.push(value)
    if (out.length >= limit) break
  }
  return out
}

function integerUnion(...lists) {
  const set = new Set()
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      if (Number.isInteger(value)) set.add(value)
    }
  }
  return [...set].sort((left, right) => left - right)
}

function stringUnion(...lists) {
  const set = new Set()
  for (const list of lists) {
    for (const raw of Array.isArray(list) ? list : []) {
      const value = str(raw).trim()
      if (value) set.add(value)
    }
  }
  return [...set]
}

/**
 * 已有条目状态 vs 目标状态：
 *   - 合法转移（含同态）→ 目标状态；
 *   - adopted 等不能降级的状态 → 保留原状态（只补字段，不推翻作者决定）；
 *   - superseded 终态 → 返回 null（整条跳过）。
 */
export function resolveTargetStatus(existingStatus, desired, warnings = [], meta = {}) {
  const from = str(existingStatus)
  const to = str(desired)
  if (!from) return to
  if (from === to || canTransitionStatus(from, to)) return to
  if (from === 'superseded') {
    warnings.push({
      code: 'STATUS_TRANSITION_BLOCKED',
      entryId: meta.entryId ?? null,
      from,
      to,
      message: `条目 ${meta.entryId ?? ''} 已 superseded，终态不再回写`
    })
    return null
  }
  warnings.push({
    code: 'STATUS_KEPT',
    entryId: meta.entryId ?? null,
    from,
    to,
    message: `条目 ${meta.entryId ?? ''} 已是 ${from}，不降级为 ${to}；仅补字段`
  })
  return from
}

/** 定义补充：用"；"拼接，已包含则不重复（参考实现 convolve 的定义合并口径）。 */
export function supplementDefinition(base, addition) {
  const left = str(base).trim()
  const right = str(addition).trim()
  if (!left) return right
  if (!right) return left
  if (left.includes(right)) return left
  if (right.includes(left)) return right
  return `${left}；${right}`
}

/* ==================== 人物：say/do 聚合 ==================== */

/**
 * 从抽取记录聚合人物事实（零 LLM，对应 `collect_from_actinfo`）。
 * @param {Object[]} extractions normalizeExtraction 的输出
 * @returns {Object} { [name]: { name, appearances, sayings, doings, chapters, sceneIds, coOccurrences } }
 */
export function accumulateCharacterFacts(extractions) {
  const facts = {}

  const ensure = (name) => {
    if (!facts[name]) {
      facts[name] = {
        name,
        appearances: [],
        sayings: [],
        doings: [],
        chapters: [],
        sceneIds: [],
        coOccurrences: {}
      }
    }
    return facts[name]
  }

  const recordAppearance = (fact, chapterNo, sceneId, segmentIndex) => {
    const label = `第${chapterNo ?? '?'}章scene${sceneId ?? '?'}${segmentIndex ? `·段${segmentIndex}` : ''}`
    fact.appearances.push(label)
    if (Number.isInteger(chapterNo)) fact.chapters.push(chapterNo)
    if (Number.isInteger(sceneId)) fact.sceneIds.push(sceneId)
  }

  for (const record of Array.isArray(extractions) ? extractions : []) {
    if (!isPlainObject(record)) continue
    const chapterNo = Number.isInteger(record.chapterNo) ? record.chapterNo : null
    const sceneId = Number.isInteger(record.sceneId) ? record.sceneId : null
    const segmentIndex = Number.isInteger(record.segment?.index) ? record.segment.index : null
    const who = Array.isArray(record.who) ? record.who : []
    const names = []
    for (const item of who) {
      const name = str(item?.name).trim()
      if (!name || names.includes(name)) continue
      names.push(name)
      recordAppearance(ensure(name), chapterNo, sceneId, segmentIndex)
    }

    for (const act of Array.isArray(record.actinfo) ? record.actinfo : []) {
      if (!isPlainObject(act) || act.type === 'event') continue
      const name = str(act.who).trim()
      const content = str(act.content).trim()
      if (!name || !content) continue
      const fact = ensure(name)
      recordAppearance(fact, chapterNo, sceneId, segmentIndex)
      const blob = `第${chapterNo ?? '?'}章scene${sceneId ?? '?'}: ${content.slice(0, 80)}`
      if (act.channel === 'say') fact.sayings.push(blob)
      else fact.doings.push(blob)
      for (const other of names) {
        if (!other || other === name) continue
        fact.coOccurrences[other] = (fact.coOccurrences[other] ?? 0) + 1
      }
    }
  }

  for (const fact of Object.values(facts)) {
    fact.appearances = [...new Set(fact.appearances)]
    fact.sayings = fact.sayings.slice(-12)
    fact.doings = fact.doings.slice(-12)
    fact.chapters = integerUnion(fact.chapters)
    fact.sceneIds = integerUnion(fact.sceneIds)
    fact.coOccurrences = Object.fromEntries(
      Object.entries(fact.coOccurrences)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
    )
  }
  return facts
}

function normalizeCastRole(raw, warnings, name) {
  if (!isPlainObject(raw)) return null
  const tier = str(raw.tier).trim()
  if (!CAST_ROLE_TIERS.includes(tier)) return null
  const goal = str(raw.goal).trim()
  const plotFunction = str(raw.plotFunction).trim()
  if ((tier === 'supporting' || tier === 'minor') && (!goal || !plotFunction)) {
    warnings.push({
      code: 'CAST_ROLE_INCOMPLETE',
      name,
      message: `${tier} 角色缺 goal/plotFunction，castRole 已省略（analyze 模式不允许半成品）`
    })
    return null
  }
  const role = { tier }
  if (goal) role.goal = goal
  if (plotFunction) role.plotFunction = plotFunction
  return role
}

/**
 * 人物事实 + 模型档案 → fact.data/v2 character 草稿（status=proposed）。
 * 锚点 speech/behavior 来自 say/do 渠道的确定性样本，catchphrase/memoryPoints 来自模型。
 */
export function buildCharacterEntry({ name, fact, profile, domain, book, bookId, extractor, warnings = [] }) {
  const source = isPlainObject(profile) ? profile : {}
  const record = isPlainObject(fact) ? fact : {}
  const chapters = integerUnion(record.chapters)
  const entry = {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain, slot: '', name }),
    layer: 'character',
    name,
    domain,
    status: 'proposed',
    relations: [],
    anchors: {
      speech: uniqueStrings(record.sayings, 8),
      behavior: uniqueStrings(record.doings, 8),
      catchphrase: uniqueStrings(source.anchors?.catchphrase, 3)
    },
    memoryPoints: uniqueStrings(source.memoryPoints, 5),
    provenance: {
      mode: 'analyze',
      book,
      book_id: bookId,
      chapters,
      scenes: integerUnion(record.sceneIds),
      extractor
    },
    fingerprint: {
      vec: null,
      metrics: {
        appearances: Array.isArray(record.appearances) ? record.appearances.length : 0,
        sayings: Array.isArray(record.sayings) ? record.sayings.length : 0,
        doings: Array.isArray(record.doings) ? record.doings.length : 0
      }
    }
  }

  const identity = firstText(source.identity)
  const personality = firstText(source.personality)
  const trajectory = firstText(source.trajectory, record.doings?.slice(-3).join('；'))
  if (identity) entry.identity = identity
  if (personality) entry.personality = personality
  if (trajectory) entry.trajectory = trajectory

  for (const item of Array.isArray(source.relations) ? source.relations : []) {
    if (!isPlainObject(item)) continue
    const to = str(item.name).trim()
    if (!to) continue
    entry.relations.push({ to, type: '关系', how: str(item.relation).trim() })
    if (entry.relations.length >= 5) break
  }
  if (!entry.relations.length) delete entry.relations

  const castRole = normalizeCastRole(source.castRole, warnings, name)
  if (castRole) entry.castRole = castRole
  if (typeof source.confidence === 'number' && source.confidence >= 0 && source.confidence <= 1) {
    entry.provenance.confidence = source.confidence
  }
  if (chapters.length) entry.validity = { from: Math.min(...chapters), to: Math.max(...chapters) }
  return entry
}

/**
 * 人物挖掘：`accumulateCharacterFacts` → （可选）LlmPort 生成档案 → character 草稿。
 * 单人物模型失败只进 failures，确定性锚点仍会产出草稿（失败隔离）。
 *
 * @param {Object} input { extractions, llm?, facts?, domain, book, bookId, store?, minAppearances? }
 * @param {Object} [options] { maxRetries }
 */
export async function mineCharacters(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {}
  const llm = source.llm ?? options.llm
  if (llm) assertLlmPort(llm)
  const store = source.store ?? options.store
  const domain = str(source.domain).trim()
  const book = str(source.book).trim()
  const bookId = str(source.bookId).trim()
  const extractor = firstText(source.extractor, DEFAULT_EXTRACTOR)
  const minAppearances = Number.isInteger(source.minAppearances) ? source.minAppearances : 1
  const facts = isPlainObject(source.facts) ? source.facts : accumulateCharacterFacts(source.extractions)
  const maxRetries = options.maxRetries ?? source.maxRetries

  const entries = []
  const failures = []
  const warnings = []
  const names = Object.keys(facts).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))

  for (const name of names) {
    const fact = facts[name]
    if (fact.appearances.length < minAppearances) continue
    let profile = {}
    if (llm) {
      const prompt = buildMineCharacterPrompt({
        name,
        appearances: fact.appearances.slice(0, 10),
        sayings: fact.sayings.slice(-6),
        doings: fact.doings.slice(-6),
        coOccurrences: fact.coOccurrences,
        clues: []
      })
      const call = await completeWithRetries(
        llm,
        { system: MINE_CHARACTER_SYSTEM_PROMPT, prompt },
        { maxRetries, expect: 'object' }
      )
      if (call.ok) profile = call.value
      else failures.push({ name, code: 'CHARACTER_MINE_FAILED', attempts: call.attempts, errors: call.errors })
    }

    const entry = buildCharacterEntry({
      name,
      fact,
      profile,
      domain,
      book,
      bookId,
      extractor,
      warnings
    })
    const validation = validateFactEntry(entry)
    if (!validation.ok) {
      failures.push({ name, code: 'CHARACTER_ENTRY_INVALID', errors: validation.errors })
      continue
    }
    if (validation.warnings.length) warnings.push({ name, code: 'CHARACTER_ENTRY_WARNINGS', warnings: validation.warnings })
    entries.push(entry)
  }

  let saved = []
  if (store && entries.length) {
    const merged = await mergeWithExisting(store, entries, warnings)
    const persistence = await persistEntries(store, merged, {
      operationPrefix: `pipeline:mine:character:${bookId || domain || 'default'}`
    })
    saved = persistence.saved
    warnings.push(...persistence.warnings)
  }

  return { ok: failures.length === 0, entries, failures, warnings, facts, saved }
}

/* ==================== 设定：识别 + 定义补充 ==================== */

function termsFrom(value) {
  if (Array.isArray(value)) return value
  if (!isPlainObject(value)) return null
  for (const key of ['terms', 'entities', 'data', 'result', 'items']) {
    if (Array.isArray(value[key])) return value[key]
  }
  if (firstText(value.name)) return [value]
  return null
}

function cleanSettingTerm(raw, extraction, aliasIndex) {
  if (!isPlainObject(raw)) {
    return { ok: false, warning: { code: 'SETTING_SHAPE', message: '设定项不是对象' } }
  }
  const rawName = str(raw.name).trim()
  if (!rawName) return { ok: false, warning: { code: 'SETTING_NAME_MISSING', message: '设定项缺少 name' } }
  if (GENERIC_SETTING_TERMS.includes(rawName)) {
    return {
      ok: false,
      warning: { code: 'SETTING_GENERIC_REJECTED', name: rawName, message: `通用名词「${rawName}」没有记录意义，已拒收` }
    }
  }
  const definition = str(raw.definition).trim()
  if (!definition) {
    return {
      ok: false,
      warning: { code: 'SETTING_DEFINITION_MISSING', name: rawName, message: `设定「${rawName}」缺客观定义，跳过` }
    }
  }

  const name = aliasIndex.resolve(rawName) ?? rawName
  const category = str(raw.category).trim()
  const aliases = uniqueStrings(raw.aliases).filter((alias) => alias !== name)
  const related = []
  for (const item of Array.isArray(raw.related) ? raw.related : []) {
    if (!isPlainObject(item)) continue
    const to = str(item.to).trim()
    if (!to) continue
    const relation = { to, type: firstText(item.type, '关联'), how: str(item.how).trim() }
    if (!related.some((existing) => existing.to === relation.to && existing.type === relation.type)) {
      related.push(relation)
    }
  }
  const cognition = isPlainObject(raw.readerCognition) ? raw.readerCognition : {}
  const chapterNo = Number.isInteger(extraction?.chapterNo) ? extraction.chapterNo : null
  const sceneId = Number.isInteger(extraction?.sceneId) ? extraction.sceneId : null

  return {
    ok: true,
    term: {
      name,
      category,
      slot: slotForCategory(category),
      definition,
      aliases,
      related,
      readerCognition: {
        firstMention: cognition.firstMention === true,
        supplementNeeded: cognition.supplementNeeded === true
      },
      chapters: chapterNo === null ? [] : [chapterNo],
      scenes: sceneId === null ? [] : [sceneId]
    }
  }
}

function accumulateSetting(map, term, warnings, aliasIndex) {
  const current = map.get(term.name)
  if (!current) {
    map.set(term.name, {
      ...term,
      aliases: [...term.aliases],
      related: term.related.map((item) => ({ ...item })),
      chapters: integerUnion(term.chapters),
      scenes: integerUnion(term.scenes)
    })
    aliasIndex.add(term.name, term.aliases)
    return
  }
  if (current.slot !== term.slot) {
    warnings.push({
      code: 'SETTING_SLOT_CONFLICT',
      name: term.name,
      kept: current.slot,
      dropped: term.slot,
      message: `设定「${term.name}」多次分类不一致，保留首个槽位 ${current.slot}`
    })
  }
  current.definition = supplementDefinition(current.definition, term.definition)
  current.aliases = stringUnion(current.aliases, term.aliases)
  for (const item of term.related) {
    if (!current.related.some((existing) => existing.to === item.to && existing.type === item.type)) {
      current.related.push(item)
    }
  }
  current.readerCognition = {
    firstMention: current.readerCognition.firstMention || term.readerCognition.firstMention,
    supplementNeeded: current.readerCognition.supplementNeeded || term.readerCognition.supplementNeeded
  }
  current.chapters = integerUnion(current.chapters, term.chapters)
  current.scenes = integerUnion(current.scenes, term.scenes)
  aliasIndex.add(term.name, term.aliases)
}

function findExistingEntry(existingEntries, name) {
  return existingEntries.find((entry) => str(entry?.name).trim() === name) ?? null
}

function buildWorldviewEntry(term, existing, context, warnings) {
  const name = term.name
  const id = stableEntryId({ layer: 'worldview', domain: context.domain, slot: term.slot, name })
  const targetStatus = resolveTargetStatus(existing?.status, 'proposed', warnings, { entryId: id })
  if (!targetStatus) return null

  const aliases = stringUnion(existing?.aliases, term.aliases).filter((alias) => alias !== name)
  const chapters = integerUnion(existing?.provenance?.chapters, term.chapters)
  const scenes = integerUnion(existing?.provenance?.scenes, term.scenes)
  const definition = existing
    ? supplementDefinition(existing.definition, term.definition)
    : term.definition

  const entry = {
    schema: FACT_SCHEMA,
    id,
    layer: 'worldview',
    name,
    domain: context.domain,
    slot: term.slot,
    status: targetStatus,
    definition,
    aliases,
    relations: term.related.map((item) => ({ ...item })),
    readerCognition: { ...term.readerCognition },
    provenance: {
      mode: 'analyze',
      book: context.book,
      book_id: context.bookId,
      chapters,
      scenes,
      extractor: context.extractor
    },
    fingerprint: {
      vec: null,
      metrics: { sources: chapters.length, aliases: aliases.length }
    }
  }
  if (existing && Number.isInteger(existing.rank)) entry.rank = existing.rank
  if (!entry.relations.length) delete entry.relations
  if (existing?.validity !== undefined) entry.validity = { ...existing.validity }
  else if (chapters.length) entry.validity = { from: Math.min(...chapters), to: null }
  return entry
}

/**
 * 设定挖掘：逐段问模型 → 归并同实体 → worldview 草稿 / 已有条目定义补充。
 * 通用名词拒收；别名归并用 domain/aliases 的 union-find；单段失败只进 failures。
 *
 * @param {Object} input { extractions, llm, entries?, domain, book, bookId, store? }
 * @param {Object} [options] { maxRetries }
 */
export async function mineSettings(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {}
  const llm = source.llm ?? options.llm
  assertLlmPort(llm)
  const store = source.store ?? options.store
  const domain = str(source.domain).trim()
  const book = str(source.book).trim()
  const bookId = str(source.bookId).trim()
  const extractor = firstText(source.extractor, DEFAULT_EXTRACTOR)
  const maxRetries = options.maxRetries ?? source.maxRetries
  const extractions = Array.isArray(source.extractions) ? source.extractions.filter(isPlainObject) : []

  let existingEntries = Array.isArray(source.entries) ? source.entries.filter(isPlainObject) : []
  if (store && !existingEntries.length) {
    assertFactStore(store)
    const listed = await store.list({ domain })
    existingEntries = listed.entries.map((record) => record.entry)
  }

  const aliasIndex = createAliasIndex(existingEntries)
  const accumulated = new Map()
  const failures = []
  const warnings = []

  for (const extraction of extractions) {
    const actinfo = Array.isArray(extraction.actinfo) ? extraction.actinfo : []
    const existingTerms = [
      ...new Set([
        ...existingEntries.map((entry) => str(entry.name).trim()).filter(Boolean),
        ...accumulated.keys()
      ])
    ]
    const prompt = buildMineSettingPrompt({
      chapterNo: extraction.chapterNo,
      sceneId: extraction.sceneId,
      where: extraction.where,
      who: (Array.isArray(extraction.who) ? extraction.who : []).map((item) => str(item.name)).filter(Boolean),
      actinfo: actinfo.map((item) => str(item.content)).filter(Boolean),
      notes: extraction.notes,
      existingTerms
    })
    const call = await completeWithRetries(
      llm,
      { system: MINE_SETTING_SYSTEM_PROMPT, prompt },
      { maxRetries, expect: 'any' }
    )
    if (!call.ok) {
      failures.push({
        chapterNo: extraction.chapterNo ?? null,
        sceneId: extraction.sceneId ?? null,
        code: 'SETTING_MINE_FAILED',
        attempts: call.attempts,
        errors: call.errors
      })
      continue
    }
    const list = termsFrom(call.value)
    if (!list) {
      failures.push({
        chapterNo: extraction.chapterNo ?? null,
        sceneId: extraction.sceneId ?? null,
        code: 'SETTING_SHAPE_INVALID',
        message: '设定挖掘输出既不是数组，也找不到 terms/entities/data/result/items'
      })
      continue
    }
    for (const raw of list) {
      const cleaned = cleanSettingTerm(raw, extraction, aliasIndex)
      if (!cleaned.ok) {
        warnings.push(cleaned.warning)
        continue
      }
      accumulateSetting(accumulated, cleaned.term, warnings, aliasIndex)
    }
  }

  for (const conflict of aliasIndex.conflicts()) {
    warnings.push({
      code: 'ALIAS_CONFLICT',
      term: conflict.term,
      claimants: [...conflict.claimants],
      message: `「${conflict.term}」被多条条目声明为别名，已如实记账（不静默选边）`
    })
  }

  const context = { domain, book, bookId, extractor }
  const entries = []
  const names = [...accumulated.keys()].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  for (const name of names) {
    const term = accumulated.get(name)
    const existing = findExistingEntry(existingEntries, name)
    const entry = buildWorldviewEntry(term, existing, context, warnings)
    if (!entry) continue
    const validation = validateFactEntry(entry)
    if (!validation.ok) {
      failures.push({ name, code: 'SETTING_ENTRY_INVALID', errors: validation.errors })
      continue
    }
    if (validation.warnings.length) warnings.push({ name, code: 'SETTING_ENTRY_WARNINGS', warnings: validation.warnings })
    entries.push(entry)
  }

  let saved = []
  if (store && entries.length) {
    const persistence = await persistEntries(store, entries, {
      operationPrefix: `pipeline:mine:setting:${bookId || domain || 'default'}`
    })
    saved = persistence.saved
    warnings.push(...persistence.warnings)
  }

  return { ok: failures.length === 0, entries, failures, warnings, terms: [...accumulated.values()], saved }
}

/* ==================== 状态机落库共用 ==================== */

async function mergeWithExisting(store, entries, warnings) {
  const merged = []
  for (const entry of entries) {
    const current = await store.get(entry.id)
    if (!current) {
      merged.push(entry)
      continue
    }
    const targetStatus = resolveTargetStatus(current.entry.status, entry.status, warnings, { entryId: entry.id })
    if (!targetStatus) continue
    merged.push({ ...current.entry, ...entry, status: targetStatus })
  }
  return merged
}
