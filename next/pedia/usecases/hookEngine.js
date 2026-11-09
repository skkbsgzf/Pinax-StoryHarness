/**
 * S3 hook 引擎：把 pedia 能力挂到创作动作上（Core 侧只暴露这三个入口）。
 *
 *   suggestCompletion  写大纲/续写时自动补全数据 —— 只产出建议，写不写由调用方拍板；
 *   diffValidate       产生变更后做 diff 校验 —— 出 issue 列表，不改数据；
 *   readOnlyQuery      纯文笔润色等只读场景 —— 只查事实包，不碰 store。
 *
 * 铁律：三个入口都**永不写 store**。引擎只调用 store.get / store.list；
 * save / remove 由宿主在用户/拍板动作里自己做（ADR S3）。测试用只读计数器钉住这一点。
 *
 * 依赖注入：createHookEngine({ store?, vector?, llm? })——store 可为空（直接把条目传进来），
 * vector/llm 同样可空；有空端口时对应能力降级并如实写 notes，不假装做过。
 */

import { buildFactPack } from './factPack.js'
import { precheckDraft } from './precheck.js'
import { PEDIA_SCHEMA, RHYTHM_WINDOW_DEFAULTS } from '../domain/vocabulary.js'
import { canTransitionStatus } from '../domain/status.js'
import { validatePediaEntry } from '../domain/schema.js'
import { normalizeSpan, validateValidityShape } from '../domain/validity.js'

export const HOOK_ENGINE_VERSION = 'pedia-hooks/v1'

/** 创作动作 → 引擎入口（与 wikihub/hooks.mjs 的契约同口径）。 */
export const HOOK_ENGINE_ROUTES = Object.freeze({
  onOutlineWrite: 'suggestCompletion',
  onContinueWrite: 'suggestCompletion',
  onDataChange: 'diffValidate',
  onPolish: 'readOnlyQuery'
})

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function sameEntry(left, right) {
  return stableStringify(left) === stableStringify(right)
}

function changedFields(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  return [...keys]
    .filter((key) => stableStringify(before?.[key]) !== stableStringify(after?.[key]))
    .sort()
}

async function loadEntries(store, filter = {}) {
  if (!store) return []
  const result = await store.list(filter)
  if (!result || !Array.isArray(result.entries)) return []
  return result.entries.map((item) => item.entry ?? item).filter(isPlainObject)
}

/**
 * 写大纲/续写前的数据补全建议（不落库）。
 * input: { entries?, query?, draft? }；entries 缺省时从 store 读（只读）。
 */
export async function suggestCompletion(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {}
  const store = options.store ?? null
  const notes = []
  const entries = Array.isArray(source.entries)
    ? source.entries.filter(isPlainObject)
    : await loadEntries(store, source.filter ?? {})
  if (!Array.isArray(source.entries) && store) notes.push('entries 由 store.list 读取（只读）')

  const factPack = buildFactPack(entries, source.query ?? {})
  const span = normalizeSpan(source.query?.span)
  const suggestions = []

  for (const rule of factPack.world.rules) {
    suggestions.push({
      type: 'world-rule',
      entryId: rule.id,
      name: rule.name,
      message: `世界规则「${rule.name}」在此时段生效，续写不得违反：${rule.definition.slice(0, 80)}`
    })
  }
  for (const ordered of factPack.world.ordered) {
    suggestions.push({
      type: 'ordered-slot',
      slot: ordered.slot,
      sequence: ordered.items.map((item) => ({ name: item.name, rank: item.rank })),
      message: `有序槽位「${ordered.slot}」的当前序列（按 rank）`
    })
  }
  for (const [name, character] of Object.entries(factPack.characters)) {
    const castRole = character.castRole
    if (!castRole) continue
    if ((castRole.tier === 'supporting' || castRole.tier === 'minor') && (!str(castRole.goal).trim() || !str(castRole.plotFunction).trim())) {
      suggestions.push({
        type: 'character-gap',
        entryId: character.id,
        character: name,
        missing: [!str(castRole.goal).trim() ? 'goal' : null, !str(castRole.plotFunction).trim() ? 'plotFunction' : null].filter(Boolean),
        message: `${castRole.tier} 角色「${name}」缺塑造目标/剧情作用（ADR S2-1）`
      })
    }
    if (Array.isArray(character.memoryPoints) && character.memoryPoints.length === 0) {
      suggestions.push({ type: 'character-gap', entryId: character.id, character: name, missing: ['memoryPoints'], message: `角色「${name}」没有记忆点` })
    }
  }
  const noveltySeen = new Set([...factPack.events.facts, ...factPack.events.hypotheses].flatMap((event) => event.novelty))
  if (!noveltySeen.size) {
    const customSpec = entries
      .map((entry) => entry.rhythmSpec)
      .find((spec) => isPlainObject(spec) && Array.isArray(spec.windowChars) && spec.windowChars.length)
    suggestions.push({
      type: 'rhythm-gap',
      windowChars: customSpec ? [...customSpec.windowChars] : [...RHYTHM_WINDOW_DEFAULTS],
      noveltyTags: customSpec && Array.isArray(customSpec.noveltyTags) ? [...customSpec.noveltyTags] : null,
      message: '当前事件没有新意标记（笑/燃/泪/梗），节奏窗口内可能平淡（ADR S2-2）'
    })
  }
  for (const item of factPack.supplements) {
    suggestions.push({
      type: 'reader-supplement',
      entryId: item.id,
      name: item.name,
      message: `读者首次接触「${item.name}」，出场时需补说明（ADR S2-3 读者向）`
    })
  }

  let completion = null
  const llm = options.llm ?? null
  if (llm && options.useLlm === true) {
    const draftText = str(source.draft?.text)
    const prompt = [
      '你是小说续写助手。只给建议，不改设定数据。',
      `事实包摘要：世界规则 ${factPack.world.rules.length} 条；事件 ${factPack.counts.facts} 条；角色 ${factPack.counts.characters} 个。`,
      draftText ? `草稿：${draftText}` : '',
      '请给出 3 条续写建议，每条一句话。'
    ].filter(Boolean).join('\n')
    const result = await llm.complete({ prompt })
    completion = { text: str(result?.text).trim(), usage: result?.usage ?? null }
  } else if (llm && options.useLlm !== true) {
    notes.push('llm 端口已接但 useLlm!==true，未调用模型')
  } else {
    notes.push('未接 llm 端口：只给结构性建议')
  }

  return {
    ok: true,
    kind: 'suggestCompletion',
    version: HOOK_ENGINE_VERSION,
    writesData: false,
    readOnly: true,
    atSpan: span,
    suggestions,
    factPack,
    completion,
    notes,
    warnings: factPack.warnings
  }
}

/**
 * 变更后的 diff 校验（不落库）。
 * before/after 可以是条目数组，也可以是 { entries: [...] }；缺省一侧时从 store 读（只读）。
 */
export async function diffValidate(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {}
  const store = options.store ?? null
  const load = async (value) => {
    if (Array.isArray(value)) return value.filter(isPlainObject)
    if (isPlainObject(value) && Array.isArray(value.entries)) return value.entries.filter(isPlainObject)
    return loadEntries(store, source.filter ?? {})
  }
  const before = await load(source.before)
  const after = await load(source.after)
  const issues = []
  const warnings = []
  const notes = []

  const beforeById = new Map(before.map((entry) => [str(entry.id), entry]))
  const afterById = new Map(after.map((entry) => [str(entry.id), entry]))
  const summary = { added: 0, removed: 0, changed: 0, unchanged: 0 }

  for (const [id, entry] of afterById) {
    const previous = beforeById.get(id)
    if (!previous) {
      summary.added += 1
      const validation = validatePediaEntry(entry)
      for (const error of validation.errors) {
        issues.push({ code: 'INVALID_ENTRY', severity: 'error', entryId: id, field: error.field, message: `新增条目 ${id} 不合 schema：${error.message}` })
      }
      continue
    }
    if (sameEntry(previous, entry)) {
      summary.unchanged += 1
      continue
    }
    summary.changed += 1
    const fields = changedFields(previous, entry)
    issues.push({ code: 'ENTRY_CHANGED', severity: 'warning', entryId: id, name: str(entry.name), fields, message: `条目「${str(entry.name)}」字段变更：${fields.join(', ')}` })

    const validation = validatePediaEntry(entry)
    for (const error of validation.errors) {
      issues.push({ code: 'INVALID_ENTRY', severity: 'error', entryId: id, field: error.field, message: `变更后不合 schema：${error.message}` })
    }
    if (previous.status !== entry.status && !canTransitionStatus(previous.status, entry.status)) {
      issues.push({
        code: 'ILLEGAL_STATUS_TRANSITION',
        severity: 'error',
        entryId: id,
        from: previous.status,
        to: entry.status,
        message: `状态转移 ${previous.status} → ${entry.status} 非法`
      })
    }
    const validityCheck = validateValidityShape(entry.validity)
    for (const error of validityCheck.errors) {
      issues.push({ code: 'INVALID_VALIDITY', severity: 'error', entryId: id, field: error.field, message: error.message })
    }
    if (str(previous.name) !== str(entry.name)) {
      issues.push({ code: 'RENAME', severity: 'warning', entryId: id, from: str(previous.name), to: str(entry.name), message: '条目改名会影响稳定 id 与引用，请人工确认' })
    }
    if (Array.isArray(previous.relations) && Array.isArray(entry.relations)) {
      const removedRefs = previous.relations.map((relation) => str(relation?.to)).filter((to) => to && !entry.relations.some((relation) => str(relation?.to) === to))
      const addedRefs = entry.relations.map((relation) => str(relation?.to)).filter((to) => to && !previous.relations.some((relation) => str(relation?.to) === to))
      if (removedRefs.length || addedRefs.length) {
        issues.push({
          code: 'RELATION_CHANGED',
          severity: 'warning',
          entryId: id,
          added: addedRefs,
          removed: removedRefs,
          message: `关系变更：+${addedRefs.join('/') || '无'} −${removedRefs.join('/') || '无'}`
        })
      }
    }
  }
  for (const [id, entry] of beforeById) {
    if (afterById.has(id)) continue
    summary.removed += 1
    issues.push({ code: 'ENTRY_REMOVED', severity: 'warning', entryId: id, name: str(entry.name), message: `条目「${str(entry.name)}」被删除` })
  }

  if (source.draft) {
    const precheck = precheckDraft({ draft: source.draft, entries: after.length ? after : before })
    issues.push(...precheck.issues)
    // 预检的 warnings（如 REFERENCE_UNRESOLVED）不是硬伤，但宿主上报时不能凭空丢掉——
    // 它们是「正文引用了 hub 里没有的名字」这条链唯一的证据。
    warnings.push(...(Array.isArray(precheck.warnings) ? precheck.warnings : []))
  } else {
    notes.push('未提供 draft：只做条目级 diff，不做视角/时间轴预检')
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    kind: 'diffValidate',
    version: HOOK_ENGINE_VERSION,
    writesData: false,
    readOnly: true,
    schema: PEDIA_SCHEMA,
    summary,
    issues,
    warnings,
    notes
  }
}

/**
 * 只读查询（纯文笔润色等场景）。只出事实包，不写 store、不改条目。
 */
export async function readOnlyQuery(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {}
  const store = options.store ?? null
  const entries = Array.isArray(source.entries)
    ? source.entries.filter(isPlainObject)
    : await loadEntries(store, source.filter ?? {})
  const factPack = buildFactPack(entries, source.query ?? {})
  return {
    ok: true,
    kind: 'readOnlyQuery',
    version: HOOK_ENGINE_VERSION,
    writesData: false,
    readOnly: true,
    factPack,
    warnings: factPack.warnings
  }
}

/**
 * 绑定端口后得到三个入口。store/vector/llm 都可空；空端口只会降级，不会偷偷写库。
 */
export function createHookEngine(deps = {}) {
  const options = isPlainObject(deps) ? deps : {}
  return {
    version: HOOK_ENGINE_VERSION,
    routes: { ...HOOK_ENGINE_ROUTES },
    suggestCompletion: (input) => suggestCompletion(input, options),
    diffValidate: (input) => diffValidate(input, options),
    readOnlyQuery: (input) => readOnlyQuery(input, options)
  }
}
