/**
 * Wiki 增补执行器 v3（CLI + 可导入函数）。
 *
 * 2026-11-13 对齐 author 编剧/文学 skill（storymasterv4/knowledge）：
 *   · 拆书总协议六槽位（kb/deconstruct/protocol）：gimmick / character / plot-design / intro / plot-refine / excerpt
 *   · 双层拆解：设计层（结构母型选型+核心情绪）＋细化层（章节功能九类+剧情点+伏笔落点）
 *   · 文风学习协议九维（kb/deconstruct/style-learning）：情绪笔墨密度/句式节奏/信息控制/对话权力关系/动作代心理…
 *   · 溯源纪律（block 级）：章号证据、三态区分（事实/推断/未确认）、不虚构未读取情节
 *
 * 调用预算：章批（5 章/批，五合一输出）＋ gimmick 1 ＋ plot-design 1 ＋ intro 1 ＋ 文风 1-2 ＋ 人物档案 top12。
 * 事件正文恒为原文切片（fact 层不动）；语义槽位全部落 wiki 字段（wiki-enrich@3）。
 *
 * 用法：node devtools/wiki-enrich-run.mjs --lib=D:/Qbook/短篇选题库 --books=<id>[,<id>]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dispatchDotsCompletion } from '../next/runtime/factLlmService.mjs'
import { derivePseudoChapters, hasRealChapters } from './lib/pseudoChapters.mjs'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const LIB = argOf('--lib', 'D:/Qbook/短篇选题库')
const BOOKS = (argOf('--books', '') || '').split(',').map((item) => item.trim()).filter(Boolean)
const LIMIT = Number(argOf('--limit-chars', '2400')) || 2400

async function callJson(prompt, maxTokens = 2000) {
  return dispatchDotsCompletion({ prompt, maxTokens, timeoutMs: 180_000 })
}

function parseReply(text) {
  const raw = String(text ?? '').replace(/^```(?:json)?/u, '').replace(/```$/u, '').trim()
  try { return JSON.parse(raw) } catch { return null }
}

/** 溯源纪律（block 级）进每个窗的公共头。 */
const TRACE_HEADER = [
  '溯源纪律（必须遵守）：',
  '1) 所有判断必须能给章节号依据；不得补写人物经历、不得虚构未读取的情节；',
  '2) 三态区分：原文事实 / 合理推断 / 暂时无法确认——推断与未确认在对应字段注明；',
  '3) 引用原文仅限极短（≤40 字），其余用概括。'
].join('\n')

// 枚举表（来自 kb/structure/catalog 六母型、kb/deconstruct/protocol 章节功能九类、核心情绪八种）
const STRUCTURE_TYPES = ['复仇', '救猫咪', '逆袭升级', '双线交叉', '倒钩回归', '单元宿命', '复合（须注明主辅）']
const CHAPTER_FUNCTIONS = ['建立', '铺垫', '叠加', '误导', '打击', '觉醒', '对峙', '揭露', '收束']
const EMOTIONS = ['甜', '痛', '爽', '悔', '疑', '燃', '压迫', '释然']

/**
 * 单本增补（六槽位版）。
 * @param {string} id
 * @param {string} lib
 * @param {{protagonist?:string|null}} [options]
 */
export async function enrichBook(id, lib = LIB, options = {}) {
  const result = JSON.parse(await readFile(join(lib, '拆解', `${id}.json`), 'utf8'))
  const book = result.book
  const plots = result.entries.filter((entry) => entry.layer === 'plot')
  const failures = []

  // 章分组：真章按 validity.from；无标记书按段号伪章
  const usePseudo = !hasRealChapters(plots)
  const chapterGroups = usePseudo
    ? derivePseudoChapters(plots, result.source?.chars ?? book.word_count ?? 0)
    : [...new Set(plots.map((plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : 0)))]
        .sort((a, b) => a - b)
        .map((chapter) => ({ no: chapter, plots: plots.filter((plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : 0) === chapter) }))

  const chapterInputs = chapterGroups.map((group) => ({
    chapter: group.no,
    text: group.plots.flatMap((plot) => (plot.events ?? []).map((event) => event.content)).join('\n').slice(0, LIMIT)
  }))

  // 人物输入：出场段数 top12
  const byName = new Map()
  for (const plot of plots) {
    const chapter = Number.isInteger(plot.validity?.from) ? plot.validity.from : 0
    for (const event of plot.events ?? []) {
      const who = event.who
      if (!who) continue
      if (!byName.has(who)) byName.set(who, { name: who, speech: [], behavior: [], chapters: new Set() })
      const record = byName.get(who)
      record.chapters.add(chapter)
      if (event.channel === 'say' && record.speech.length < 14) record.speech.push(event.content)
      if (event.channel === 'do' && record.behavior.length < 14) record.behavior.push(event.content)
    }
  }
  const personInputs = [...byName.values()]
    .map((record) => ({ ...record, chapters: [...record.chapters].sort((a, b) => a - b) }))
    .sort((a, b) => (b.speech.length + b.behavior.length) - (a.speech.length + a.behavior.length))
    .slice(0, 12)

  console.log(`  ${book.title}: ${chapterInputs.length} ${usePseudo ? '节(伪章)' : '章'} / ${personInputs.length} 人物`)

  /* ---------- 槽位 plot-refine＋excerpt：章批五合一 ---------- */
  const chapterSummaries = []
  const foreshadows = []
  const excerpts = []
  for (let start = 0; start < chapterInputs.length; start += 3) {
    const batch = chapterInputs.slice(start, start + 3)
    const prompt = [
      '你是小说章节拆解器（细化层）。输入是若干章的事件文本（按章分组、按原文顺序）。',
      '对每一章输出：',
      `1) title：2–6 字小标题；`,
      `2) summary：2–3 句剧情梗概（60–120 字，只概括原文发生的事）；`,
      `3) function：本章主功能，从 [${CHAPTER_FUNCTIONS.join('/')}] 里选一个；`,
      `4) emotion：本章核心情绪，从 [${EMOTIONS.join('/')}] 里选一个；`,
      `5) beats：本章承载的剧情点数（1–5 的整数，推进了多少个独立剧情点）；`,
      `6) foreshadows：埋下的伏笔/悬念 0–3 条；`,
      `7) excerpt：本章最高光片段 { "beat": "场景概括 ≤40 字", "quote": "原文摘引 ≤40 字" }（没有高光就给 null）。`,
      '',
      TRACE_HEADER,
      '',
      `只输出 JSON：{"chapters":[{"chapter":章号,"title":"","summary":"","function":"","emotion":"","beats":1,"foreshadows":[],"excerpt":null}]}`,
      '',
      ...batch.map((item) => `【第 ${item.chapter} ${usePseudo ? '节' : '章'}事件】\n${item.text}`)
    ].join('\n\n')
    let parsed = null
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const answer = await callJson(prompt, 5200)
        parsed = parseReply(answer.text)
        if (!parsed && attempt === 0) await new Promise((resolve) => setTimeout(resolve, 5000))
      } catch (error) {
        if (attempt === 1) failures.push({ stage: 'chapter-batch', chapter: batch.map((b) => b.chapter).join(','), reason: String(error?.message ?? error) })
      }
    }
    if (!parsed) failures.push({ stage: 'chapter-batch', chapter: batch.map((b) => b.chapter).join(','), reason: 'parse-failed' })
    for (const item of batch) {
      const row = parsed?.chapters?.find((c) => Number(c.chapter) === item.chapter)
      const hooks = Array.isArray(row?.foreshadows) ? row.foreshadows.slice(0, 3).map(String).filter(Boolean) : []
      chapterSummaries.push({
        chapter: item.chapter,
        title: String(row?.title ?? ''),
        summary: String(row?.summary ?? ''),
        function: CHAPTER_FUNCTIONS.includes(row?.function) ? row.function : '',
        emotion: EMOTIONS.includes(row?.emotion) ? row.emotion : '',
        beats: Number.isInteger(row?.beats) ? Math.max(1, Math.min(5, row.beats)) : null
      })
      for (const hook of hooks) foreshadows.push({ chapter: item.chapter, text: hook })
      if (row?.excerpt && typeof row.excerpt === 'object' && row.excerpt.beat) {
        excerpts.push({
          chapter: item.chapter,
          beat: String(row.excerpt.beat).slice(0, 60),
          quote: String(row.excerpt.quote ?? '').slice(0, 60)
        })
      }
    }
  }

  /* ---------- 槽位 gimmick：卖点/元素/共情点/爽点内核/情绪承诺 ---------- */
  let gimmick = null
  {
    const titleList = chapterSummaries.map((c) => `第${c.chapter}${usePseudo ? '节' : '章'}「${c.title}」`).join('、')
    const prompt = [
      '你是拆书器（槽位 gimmick·梗）。输入是书名、题材标签与全书章纲。',
      '输出 JSON：{',
      ' "logline": "一句话卖点（≤40 字，谁+什么处境+遇到什么+结果钩子）",',
      ' "elements": ["题材元素组合", "…"],',
      ' "empathy": "共情点：击中目标读者的什么处境与渴望",',
      ' "coolPoint": "爽点内核：以什么对什么形成什么压制与释放",',
      ' "emotionPromise": "核心情绪承诺，从 [' + EMOTIONS.join('/') + '] 里选主情绪并一句话说明",',
      ' "confidence": "fact|inferred|unconfirmed"',
      '}',
      '',
      TRACE_HEADER,
      '',
      `【书名】${book.title}`,
      `【题材】${[book.subject_group, book.subject_names].filter(Boolean).join(' / ') || '未标注'}`,
      `【章纲】${titleList}`
    ].join('\n')
    try {
      const answer = await callJson(prompt, 1200)
      const parsed = parseReply(answer.text)
      if (parsed?.logline) gimmick = parsed
      else failures.push({ stage: 'gimmick', reason: 'empty' })
    } catch (error) { failures.push({ stage: 'gimmick', reason: String(error?.message ?? error) }) }
  }

  /* ---------- 槽位 plot-design：结构母型选型＋阶段＋转折 ---------- */
  let plotDesign = null
  {
    const outline = chapterSummaries.map((c) => `第${c.chapter}${usePseudo ? '节' : '章'}「${c.title}」：${c.summary}`).join('\n')
    const prompt = [
      '你是拆书器（槽位 plot-design·剧情设计/宏观骨架）。输入是全书章纲。',
      `结构母型枚举：[${STRUCTURE_TYPES.join('/')}]。`,
      '输出 JSON：{',
      ' "structure": { "picked": "母型名", "evidence": "判定依据（引章号）", "confidence": "fact|inferred|unconfirmed" },',
      ' "mainline": "主线一句话",',
      ' "subplot": "支线一句话（没有就空串）",',
      ' "stages": [ { "phase": "阶段名", "chapters": [起,止], "job": "该阶段在结构里干什么" } ],',
      ' "turningPoints": [ { "chapter": 章, "event": "转折事件 ≤30 字" } ]',
      '}',
      '',
      TRACE_HEADER,
      '',
      outline
    ].join('\n')
    try {
      const answer = await callJson(prompt, 2000)
      const parsed = parseReply(answer.text)
      if (parsed?.structure?.picked) plotDesign = parsed
      else failures.push({ stage: 'plot-design', reason: 'empty' })
    } catch (error) { failures.push({ stage: 'plot-design', reason: String(error?.message ?? error) }) }
  }

  /* ---------- 槽位 intro：开局钩子结构 ---------- */
  let intro = null
  {
    const head = chapterInputs.slice(0, 2).map((item) => `【第 ${item.chapter} ${usePseudo ? '节' : '章'}】\n${item.text}`).join('\n\n')
    const prompt = [
      '你是拆书器（槽位 intro·导语设计）。输入是全书开头（前两章）事件文本。',
      '输出 JSON：{',
      ' "entry": "切入方式一句话（从什么状态/场景切入）",',
      ' "hookType": "钩子类型（悬念/反常/身份落差/危机开局/金手指亮出/其他，可组合）",',
      ' "firstBeat": "开局第一拍是什么（≤30 字）",',
      ' "expectation": "建立的核心期待",',
      ' "confidence": "fact|inferred|unconfirmed"',
      '}',
      '',
      TRACE_HEADER,
      '',
      head || '（无文本）'
    ].join('\n')
    try {
      const answer = await callJson(prompt, 1200)
      const parsed = parseReply(answer.text)
      if (parsed?.entry) intro = parsed
      else failures.push({ stage: 'intro', reason: 'empty' })
    } catch (error) { failures.push({ stage: 'intro', reason: String(error?.message ?? error) }) }
  }

  /* ---------- 文风画像（文学层·九维） ---------- */
  let style = null
  {
    const sample = chapterInputs
      .map((item) => item.text.slice(0, Math.ceil(LIMIT / Math.min(6, chapterInputs.length))))
      .join('\n')
      .slice(0, 2600)
    const prompt = [
      '你是文风拆解器（文学层·九维观察）。输入是全书事件文本抽样。',
      '标尺：写什么不重要，怎么写才重要；产物必须是可直接执行的写手规则，不是评论。',
      '输出 JSON：{',
      ' "density": "情绪笔墨密度规律（何处放慢细写、何处果断带过，引章号例证）",',
      ' "sentence": "句式与段落节奏（句长配比/独句成段/段尾翻转补刀）",',
      ' "pov": "叙述视角与信息控制（读者跟随谁的认知；何时给何时藏）",',
      ' "dialogue": "对话写法（标签/密度/留白/短-短-长；权力关系如何经话语暴露）",',
      ' "action": "动作写法（动作代心理的具体规律）",',
      ' "character": "人物写法（标签特征/情绪按钮/靠选择与沉默站住）",',
      ' "environment": "环境写法（是否作为情绪容器）",',
      ' "transition": "转场与时间处理",',
      ' "ending": "章节收束方式（钩子类型）",',
      ' "rules": ["可直接执行的写手规则 3–6 条"]',
      '}',
      '',
      TRACE_HEADER,
      '',
      sample || '（无文本）'
    ].join('\n')
    try {
      const answer = await callJson(prompt, 2200)
      const parsed = parseReply(answer.text)
      if (parsed?.rules?.length) style = parsed
      else failures.push({ stage: 'style', reason: 'empty' })
    } catch (error) { failures.push({ stage: 'style', reason: String(error?.message ?? error) }) }
  }

  /* ---------- 槽位 character：人物卡（模式/弧光/关键选择/镜像） ---------- */
  const characterProfiles = []
  for (const person of personInputs) {
    const prompt = [
      '你是人物拆解器（槽位 character·人物卡）。输入是某角色全书的台词与行为/经历（取自原文）。',
      '输出 JSON：{',
      ' "identity": "一句话身份定位",',
      ' "archetype": "人设模式（如 替罪羊/觉醒者/镜像施害者/守护者，贴人物本身）",',
      ' "personality": ["性格词 2–4 个"],',
      ' "arc": { "start": "起点状态", "end": "终点状态", "turnChapter": 转变章号或 null, "evidence": "转变依据（引章号）" },',
      ' "keyChoices": [ { "chapter": 章, "choice": "关键选择 ≤25 字" } ],',
      ' "mirror": "镜像/对立人物是谁、如何互为镜像（没有就空串）",',
      ' "summary": "2–3 句人物小传"',
      '}',
      '',
      TRACE_HEADER,
      '',
      `【角色名】${person.name}`,
      `【台词】\n${person.speech.map((line) => `「${line}」`).join('\n') || '（无台词）'}`,
      `【行为/经历】\n${person.behavior.map((line) => `- ${line}`).join('\n') || '（无）'}`,
      `【出场】第 ${person.chapters.join('、')} 章`
    ].join('\n')
    try {
      const answer = await callJson(prompt, 1800)
      const parsed = parseReply(answer.text)
      characterProfiles.push({
        name: person.name,
        chapters: person.chapters,
        identity: String(parsed?.identity ?? ''),
        archetype: String(parsed?.archetype ?? ''),
        personality: Array.isArray(parsed?.personality) ? parsed.personality.slice(0, 4).map(String) : [],
        arc: parsed?.arc && typeof parsed.arc === 'object' ? {
          start: String(parsed.arc.start ?? ''),
          end: String(parsed.arc.end ?? ''),
          turnChapter: Number.isInteger(parsed.arc.turnChapter) ? parsed.arc.turnChapter : null,
          evidence: String(parsed.arc.evidence ?? '')
        } : null,
        keyChoices: Array.isArray(parsed?.keyChoices) ? parsed.keyChoices.slice(0, 5).map((item) => ({
          chapter: Number(item?.chapter) || null,
          choice: String(item?.choice ?? '').slice(0, 40)
        })).filter((item) => item.choice) : [],
        mirror: String(parsed?.mirror ?? ''),
        summary: String(parsed?.summary ?? '')
      })
    } catch (error) {
      failures.push({ stage: 'character', name: person.name, reason: String(error?.message ?? error) })
      characterProfiles.push({ name: person.name, identity: '', archetype: '', personality: [], arc: null, keyChoices: [], mirror: '', summary: '' })
    }
  }

  /* ---------- 全书梗概（沿用，供 wiki 概览） ---------- */
  let storySummary = ''
  let arc = []
  const storyInput = chapterSummaries
    .filter((item) => item.summary)
    .map((item) => `第${item.chapter}${usePseudo ? '节' : '章'}${item.title ? `「${item.title}」` : ''}：${item.summary}`)
    .join('\n')
  if (storyInput) {
    const prompt = [
      '你是小说梗概器。输入是全书各章的剧情梗概（按章序）。',
      '输出 JSON：{"storySummary":"全书梗概 3–6 句","arc":[{"phase":"阶段名","chapters":[起,止],"text":"该阶段剧情"}]}',
      '只依据输入，不引入外部信息。',
      '',
      storyInput
    ].join('\n')
    try {
      const answer = await callJson(prompt, 1500)
      const parsed = parseReply(answer.text)
      storySummary = String(parsed?.storySummary ?? '')
      arc = Array.isArray(parsed?.arc) ? parsed.arc.slice(0, 6).map((item) => ({
        phase: String(item.phase ?? ''),
        chapters: Array.isArray(item.chapters) ? item.chapters : [],
        text: String(item.text ?? '')
      })) : []
    } catch { /* 不阻塞 */ }
  }

  result.wiki = {
    version: 'wiki-enrich@3',
    generated_at: new Date().toISOString(),
    perspective: result.perspective ?? null,
    protagonist: options.protagonist ?? null,
    pseudoChapters: usePseudo,
    enums: { structures: STRUCTURE_TYPES, chapterFunctions: CHAPTER_FUNCTIONS, emotions: EMOTIONS },
    slots: { gimmick, plotDesign, intro, style },
    storySummary,
    arc,
    chapterSummaries,
    foreshadows,
    excerpts,
    characterProfiles,
    failures
  }
  await writeFile(join(lib, '拆解', `${id}.json`), JSON.stringify(result, null, 2), 'utf8')

  const slotsLanded = [gimmick, plotDesign, intro, style].filter(Boolean).length
  return {
    id, title: book.title,
    chapters: chapterInputs.length,
    pseudo: usePseudo,
    summaries: chapterSummaries.filter((item) => item.summary).length,
    functions: chapterSummaries.filter((item) => item.function).length,
    emotions: chapterSummaries.filter((item) => item.emotion).length,
    excerpts: excerpts.length,
    profiles: characterProfiles.filter((item) => item.identity || item.summary).length,
    arcs: characterProfiles.filter((item) => item.arc?.end).length,
    slots: `${slotsLanded}/4`,
    failures: failures.length,
    storySummary: Boolean(storySummary)
  }
}

if (process.argv[1] && process.argv[1].endsWith('wiki-enrich-run.mjs')) {
  for (const id of BOOKS) {
    const startedAt = Date.now()
    const summary = await enrichBook(id)
    summary.sec = Math.round((Date.now() - startedAt) / 1000)
    console.log(`✓ ${summary.title}: ${summary.chapters} ${summary.pseudo ? '节' : '章'}，梗概 ${summary.summaries}/${summary.chapters}，功能 ${summary.functions}，情绪 ${summary.emotions}，高光 ${summary.excerpts}，弧光 ${summary.arcs}/${summary.profiles}，槽位 ${summary.slots}，失败 ${summary.failures}，${summary.sec}s`)
  }
}
