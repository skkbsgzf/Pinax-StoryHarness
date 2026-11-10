/**
 * 章 → 正文渲染用例（ADR M3 第二段）＋ perspective gate 集成（交付物 3）。
 *
 * 双叙述纪律：本模块的渲染 prompt 与游玩 / 推演 prompt（deduce/candidates 的
 * DEDUCE_DRAMA_SYSTEM_PROMPT、hookEngine 的续写建议 prompt）绝不共用。
 * 渲染目标是「小说文体」——连续叙述、不向「玩家」提问、不罗列选项、不用主持 / 提议语气；
 * 游玩 prompt 是「主持问答 / 候选提议体」。两者是两套叙述，互不 import、互不拼接。
 *
 * prompt 组装（buildProsePrompt）：
 *   小说叙述目标（RENDER_PROSE_SYSTEM_PROMPT，明确禁用主持问答体）
 *   ＋ 该章节点 definition 序列（chapterize 产出的 beats）
 *   ＋ 知情约束（只注入 POV 已知事实——复用 buildFactPack 的 character.knowledge 投影，
 *     即工单所指的「factPack knowledgeOf」）
 *   ＋ 文风 styleSpec（targets 目标区间 / samples 代表句 / constraints 禁则清单，参数注入）。
 *
 * styleSpec 形状与 next/wikihub/packs/novel-style.mjs 能力包字段对齐
 * （targets / samples / constraints.forbidden / constraints.required）。本模块不 import wikihub：
 * 静态边界铁律要求 fact 域只 import 域内相对路径，故 styleSpec 由宿主把能力包字段作为参数喂进来。
 *
 * 产出带 provenance：{ batchId, styleSpecHash, chapterId, pov, atSpan, renderKey }，
 * 全部由 sha1Hex ＋ 稳定序列化算出，同数据可确定性重渲染（无时间戳 / 随机数）。
 *
 * perspective gate 集成：渲染稿过确定性断言——复用 precheckDraft（它内部走 checkPerspective /
 * knowledgeLedgerFrom；gate.js 亦明确把 PERSPECTIVE_LEAK 判给写作时的 precheckDraft，见其注释），
 * 不新造第二套视角检查。正文里的 @《…》 引用与裸实体提及合并成 declaredRefs 交给同一个
 * precheckDraft：凡 POV 此刻未知 / 已知得晚的实体 → PERSPECTIVE_LEAK 进违规清单（越知）。
 *
 * LlmPort 注入、零宿主依赖：真实模型由端口注入；不碰 node 内置 / process / 文件系统。
 */

import { buildFactPack } from '../factPack.js'
import { precheckDraft, extractRefs, knowledgeLedgerFrom } from '../precheck.js'
import { createAliasIndex } from '../../domain/aliases.js'
import { sha1Hex } from '../../domain/stableId.js'
import { assertLlmPort } from '../../ports/llmPort.js'

export const PROSE_RENDER_VERSION = 'prose-render@1'

/**
 * 成书渲染 system prompt（小说叙述目标）。
 * 明确禁用主持问答体：不向玩家 / 读者提问、不罗列选项 / 分支 / 清单、不写问答与 JSON。
 * 与 DEDUCE_DRAMA_SYSTEM_PROMPT（推演提议器）是两套叙述，绝不共用、绝不拼接。
 */
export const RENDER_PROSE_SYSTEM_PROMPT = [
  '你是小说成书渲染器：把章纲拍序列改写成连续的小说正文（限知视角叙述）。',
  '目标是小说文体，不是主持问答体，也不是推演提议体。',
  '严禁向「玩家」或读者提问；严禁罗列选项、分支或清单；严禁「你可以…」「请选择…」这类话术。',
  '严禁把剧情写成问答、菜单、选项列表或结构化数据；只按拍序铺陈场景、动作、心理与对白。',
  '只使用本章注入的 POV 已知事实；引用任何实体名一律写成 @《实体名》。',
  '遵守注入的文风规范（目标区间、代表句、禁则清单）。'
].join('\n')

function isObj(value) {
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

/** 稳定序列化（键排序）：同数据 → 同字符串 → 同 hash，供 provenance 确定性重渲染。 */
export function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (isObj(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * styleSpec 归一化：与 novel-style.mjs 字段形状对齐（参数注入，不 import 能力包）。
 * @param {{name?, targets?, samples?, constraints?:{forbidden?, required?}}} styleSpec
 */
export function normalizeStyleSpec(styleSpec) {
  const source = isObj(styleSpec) ? styleSpec : {}
  const constraints = isObj(source.constraints) ? source.constraints : {}
  return {
    name: str(source.name).trim(),
    targets: isObj(source.targets) ? { ...source.targets } : {},
    samples: (Array.isArray(source.samples) ? source.samples : []).map(str).filter(Boolean),
    constraints: {
      forbidden: (Array.isArray(constraints.forbidden) ? constraints.forbidden : []).map(str).filter(Boolean),
      required: (Array.isArray(constraints.required) ? constraints.required : []).map(str).filter(Boolean)
    }
  }
}

/** styleSpec hash：同 styleSpec → 同 hash；不同文风 → 不同 hash（多文风重渲染可区分）。 */
export function styleSpecHash(styleSpec) {
  return sha1Hex(stableSerialize(normalizeStyleSpec(styleSpec)))
}

/**
 * POV 已知事实集合（「factPack knowledgeOf」）：复用 buildFactPack 的 character.knowledge 投影，
 * 只取 atSpan 起点 ≤ 本章时点的记录；并纳入 POV 自身（角色当然知道自己）。
 * @returns {Set<string>} 实体规范名集合
 */
export function povKnownNames(entries, pov, atSpan) {
  const known = new Set()
  const focus = str(pov).trim()
  if (focus) known.add(focus)
  if (!focus) return known
  let pack
  try {
    pack = buildFactPack(Array.isArray(entries) ? entries.filter(isObj) : [], { character: focus, span: atSpan })
  } catch {
    return known
  }
  for (const character of Object.values(pack.characters ?? {})) {
    for (const record of Array.isArray(character.knowledge) ? character.knowledge : []) {
      const name = str(record?.fromEntry).trim()
      if (name) known.add(name)
    }
  }
  return known
}

/** 裸实体提及：正文里出现条目名 / 别名 → 记其规范名；排除 POV 自身。 */
function mentionedEntityNames(text, entries, exclude) {
  const source = str(text)
  const names = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isObj(entry)) continue
    const canonical = str(entry.name).trim()
    if (!canonical || exclude.has(canonical)) continue
    const terms = [canonical, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
    for (const term of terms) {
      if (str(term).trim() && source.includes(str(term).trim())) {
        if (!names.includes(canonical)) names.push(canonical)
        break
      }
    }
  }
  return names
}

/**
 * perspective gate 集成：渲染稿过确定性断言（复用 precheckDraft，不新造第二套）。
 *
 * 把正文里的 @《…》 引用与裸实体提及合并成 declaredRefs，交给同一个 precheckDraft：
 *   - PERSPECTIVE_LEAK          POV 此刻未知 / 已知得晚的实体（越知）→ 违规清单；
 *   - REFERENCE_OUTSIDE_VALIDITY 引用条目在本章时点不生效；
 *   - DRAFT_OUTSIDE_VALIDITY     草稿自身时点不相交。
 *
 * @param {{text, entries, pov, atSpan?, name?}} input
 */
export function gateProseKnowledge(input = {}) {
  const source = isObj(input) ? input : {}
  const text = str(source.text)
  const entries = Array.isArray(source.entries) ? source.entries.filter(isObj) : []
  const pov = str(source.pov).trim()
  const atSpan = source.atSpan ?? null
  const aliasIndex = createAliasIndex(entries)
  const povCanonical = aliasIndex.resolve(pov) ?? pov

  // 知情约束侧：POV 已知集合（factPack 投影，供 prompt 注入与读数）。
  const knownNames = povKnownNames(entries, pov, atSpan)

  // 显式 @《…》 引用 + 裸实体提及；POV 自指不算越知，先剔除。
  const refTags = extractRefs(text)
  const mentioned = mentionedEntityNames(text, entries, new Set([povCanonical]))
  const declaredRefs = [...new Set([...refTags, ...mentioned])].filter((ref) => {
    const canonical = aliasIndex.resolve(ref) ?? ref
    return canonical !== povCanonical
  })

  // 决定性断言全部来自 precheckDraft（内部即 checkPerspective + knowledgeLedgerFrom）。
  const precheck = precheckDraft({
    draft: {
      name: firstText(source.name) || '渲染稿',
      text,
      character: pov,
      atSpan,
      refs: declaredRefs
    },
    entries
  }, { aliasIndex })

  const violations = [...precheck.issues]
  const knowledgeLeaks = violations.filter((issue) => issue.code === 'PERSPECTIVE_LEAK')

  return {
    ok: violations.length === 0,
    pov,
    atSpan,
    knownNames: [...knownNames],
    refTags,
    mentioned,
    declaredRefs,
    violations,
    knowledgeLeaks,
    ledgerCharacters: Object.keys(knowledgeLedgerFrom(entries)),
    precheck
  }
}

/**
 * 组装本章渲染 prompt（小说叙述目标 + definition 序列 + 知情约束 + 文风 styleSpec）。
 * 纯字符串拼接，确定性；system 另由 renderChapter 取 RENDER_PROSE_SYSTEM_PROMPT。
 *
 * P-WIRE：章带上 goal（目标弧）与 openHooks（本章该回收/该继续埋的伏笔）时一并注入——
 * 否则推演时埋的伏笔在成书这一步静默丢掉，读者看到的是一章没有钩子的平铺。
 */
export function buildProsePrompt(input = {}) {
  const source = isObj(input) ? input : {}
  const chapter = isObj(source.chapter) ? source.chapter : {}
  const entries = Array.isArray(source.entries) ? source.entries.filter(isObj) : []
  const pov = firstText(source.pov, chapter.pov)
  const atSpan = source.atSpan ?? null
  const spec = normalizeStyleSpec(source.styleSpec)
  const known = povKnownNames(entries, pov, atSpan)
  const beats = Array.isArray(chapter.beats) ? chapter.beats : []
  const goal = firstText(chapter.goal, source.goal)
  const openHooks = (Array.isArray(chapter.openHooks) ? chapter.openHooks : (Array.isArray(source.openHooks) ? source.openHooks : []))
    .map((item) => firstText(item?.definition, item?.name, item))
    .filter(Boolean)

  const knownList = known.size ? [...known].join('、') : '（空）'
  const lines = [
    '【叙述目标】',
    RENDER_PROSE_SYSTEM_PROMPT,
    `【本章视角 POV】${pov || '（未指定）'}`,
    ...(goal ? [`【本章目标弧】${goal}`] : []),
    `【本章拍序（definition 序列）】共 ${beats.length} 拍`,
    ...beats.map((beat, index) => `〔拍${index + 1}〕${str(beat.definition)}`),
    ...(openHooks.length
      ? ['【未回收伏笔】下列钩子已埋下，本章可继续加码或按下不表，但不得与之矛盾：', ...openHooks.map((item) => `· ${item}`)]
      : []),
    '【知情约束】本章只允许涉及下列 POV 已知事实；禁止出现未在该集合中的实体；引用实体一律写成 @《实体名》。',
    `POV 已知集合：${knownList}`,
    '【文风规范 styleSpec】',
    `目标区间 targets：${stableSerialize(spec.targets)}`,
    `代表句 samples：${spec.samples.length ? spec.samples.join(' / ') : '（无）'}`,
    `禁则清单 forbidden：${spec.constraints.forbidden.length ? spec.constraints.forbidden.join('、') : '（无）'}`,
    `必含 required：${spec.constraints.required.length ? spec.constraints.required.join('、') : '（无）'}`,
    '【输出】仅输出本章小说正文，不解释、不列项、不回显以上任何指令。'
  ]
  return lines.join('\n')
}


/**
 * 章 → 正文渲染用例（LlmPort 注入）。
 * 产出 prose ＋ provenance（batchId ＋ styleSpecHash，同数据可重渲染）＋ gate（越知违规清单）。
 *
 * @param {{chapter, entries?, pov?, atSpan?, styleSpec?, llm?, llmPort?, batchId?, maxTokens?}} input
 */
export async function renderChapter(input = {}) {
  const source = isObj(input) ? input : {}
  const chapter = isObj(source.chapter) ? source.chapter : null
  if (!chapter) {
    return { ok: false, error: { code: 'NO_CHAPTER', message: 'renderChapter 需要 chapter（chapterize 产出）' } }
  }
  const entries = Array.isArray(source.entries) ? source.entries.filter(isObj) : []
  const pov = firstText(source.pov, chapter.pov)
  const atSpan = Number.isInteger(source.atSpan) ? source.atSpan : (Number.isInteger(chapter.index) ? chapter.index : null)
  const styleSpec = normalizeStyleSpec(source.styleSpec)
  const llm = source.llm ?? source.llmPort ?? null
  assertLlmPort(llm)

  const prompt = buildProsePrompt({ chapter, entries, pov, atSpan, styleSpec, openHooks: source.openHooks })
  const result = await llm.complete({
    system: RENDER_PROSE_SYSTEM_PROMPT,
    prompt,
    maxTokens: Number.isInteger(source.maxTokens) ? source.maxTokens : 1200
  })
  const prose = str(result?.text).trim()

  const styleHash = styleSpecHash(styleSpec)
  const chapterId = str(chapter.id) || `chapter-${chapter.index ?? '?'}`
  const batchId = firstText(source.batchId) || sha1Hex([chapterId, styleHash, pov].join('|')).slice(0, 12)
  const renderKey = sha1Hex([batchId, styleHash, chapterId].join('|')).slice(0, 12)
  const gate = gateProseKnowledge({ text: prose, entries, pov, atSpan, name: `第${chapter.index ?? '?'}章` })

  return {
    ok: true,
    version: PROSE_RENDER_VERSION,
    chapterId,
    pov,
    atSpan,
    prose,
    prompt,
    provenance: { batchId, styleSpecHash: styleHash, chapterId, pov, atSpan, renderKey },
    structure: {
      chapterId,
      index: Number.isInteger(chapter.index) ? chapter.index : null,
      marker: str(chapter.marker),
      nodeIds: Array.isArray(chapter.nodeIds) ? [...chapter.nodeIds] : [],
      beatCount: Number.isInteger(chapter.beatCount) ? chapter.beatCount : (Array.isArray(chapter.beats) ? chapter.beats.length : 0)
    },
    gate
  }
}
