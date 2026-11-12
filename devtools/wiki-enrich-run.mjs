/**
 * Wiki 增补执行器（CLI + 可导入函数）。
 *
 * 对已拆解的书跑模型窄窗归纳，结果写回拆解 JSON 的 wiki 字段。
 * 这是 Wiki 的剧情来源——绑定路径只产 who/ch（事件正文取原文），梗概与身份需要归纳。
 *
 * 2026-11-13 v2（作者指出「伏笔和大纲为什么这么简单」）：
 *   · 伪章节：正文无「第N章」标记的短篇按段号切伪章（lib/pseudoChapters.mjs），
 *     章梗概按伪章出——大纲不再塌成单章；
 *   · 章批三合一：同一批窄窗同时出 小标题＋梗概＋伏笔（{"chapter","title","summary","foreshadows"}），
 *     伏笔从此有数据（v3 绑定契约砍了 hooks，语义层在这里补回）；
 *   · 人物档案 / 全书梗概不变。
 *
 * 用法：node devtools/wiki-enrich-run.mjs --lib=D:/Qbook/短篇选题库 --books=<id>[,<id>]
 * 幂等：重跑覆盖 wiki 字段（归纳结果以最后一次为准）。
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

/** dots 调用（key 从环境取，管线不落盘）。 */
async function callJson(prompt, maxTokens = 2000) {
  return dispatchDotsCompletion({ prompt, maxTokens, timeoutMs: 180_000 })
}

/** dots 回包容错解析（缩围栏 + 直接 parse，解析失败返回 null）。 */
function parseReply(text) {
  const raw = String(text ?? '').replace(/^```(?:json)?/u, '').replace(/```$/u, '').trim()
  try { return JSON.parse(raw) } catch { return null }
}

/**
 * 单本增补（供管线复用）。
 * @param {string} id
 * @param {string} lib
 * @param {{protagonist?:string|null}} [options]
 */
export async function enrichBook(id, lib = LIB, options = {}) {
  const result = JSON.parse(await readFile(join(lib, '拆解', `${id}.json`), 'utf8'))
  const book = result.book
  const plots = result.entries.filter((entry) => entry.layer === 'plot')

  // 章输入：真章按 validity.from 分组；无章节标记的书按段号切伪章
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

  // 人物输入：按出场段数排序取 top（≤12），言行取事件（原文逐字）
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

  console.log(`  ${book.title}: ${chapterInputs.length} ${usePseudo ? '节(伪章)' : '章'} / ${personInputs.length} 个主要人物`)

  // ① 章批三合一：小标题 + 梗概 + 伏笔（每批 5 章）
  const chapterSummaries = []
  const foreshadows = []
  for (let start = 0; start < chapterInputs.length; start += 5) {
    const batch = chapterInputs.slice(start, start + 5)
    const prompt = [
      '你是小说章节分析器。输入是**若干章**的事件文本（按章分组、按原文顺序）。',
      '对每一章输出：',
      '1) title：2–6 字的小标题（贴该章剧情，如「假千金露馅」「兄妹相认」）；',
      '2) summary：2–3 句剧情梗概（60–120 字，只概括该章原文里发生的事）；',
      '3) foreshadows：该章埋下的伏笔/悬念（0–3 条，每条一句话写清「什么悬念被埋下」；没有就给空数组）。',
      '只依据原文，不推测、不引入原文没有的信息。',
      '只输出 JSON：{"chapters":[{"chapter":章号,"title":"标题","summary":"梗概","foreshadows":["…"]}]}，章号与输入一一对应，不要解释。',
      '',
      ...batch.map((item) => `【第 ${item.chapter} ${usePseudo ? '节' : '章'}事件】\n${item.text}`)
    ].join('\n\n')
    try {
      const answer = await callJson(prompt, 4000)
      const parsed = parseReply(answer.text)
      for (const item of batch) {
        const row = parsed?.chapters?.find((c) => Number(c.chapter) === item.chapter)
        const hooks = Array.isArray(row?.foreshadows) ? row.foreshadows.slice(0, 3).map(String).filter(Boolean) : []
        chapterSummaries.push({ chapter: item.chapter, title: String(row?.title ?? ''), summary: String(row?.summary ?? '') })
        for (const hook of hooks) foreshadows.push({ chapter: item.chapter, text: hook })
      }
    } catch {
      // 单批失败退化为空梗概，页面照常渲染事件列表
      for (const item of batch) chapterSummaries.push({ chapter: item.chapter, title: '', summary: '' })
    }
  }

  // ①.5 小标题回填：章批里模型偶发漏 title，用已有梗概单次调用补齐（summary 是回填的可靠依据）
  const missingTitle = chapterSummaries.filter((item) => item.summary && !item.title)
  if (missingTitle.length) {
    const prompt = [
      '你是章节小标题器。输入是若干章的剧情梗概（按章号）。',
      '给每一章起一个 2–6 字的小标题，贴该章最核心的剧情转折（如「假千金露馅」「兄妹相认」）。',
      '只输出 JSON：{"chapters":[{"chapter":章号,"title":"小标题"}]}，章号与输入一一对应，不要解释。',
      '',
      ...missingTitle.map((item) => `第${item.chapter}${usePseudo ? '节' : '章'}：${item.summary}`)
    ].join('\n')
    try {
      const answer = await callJson(prompt, 1000)
      const parsed = parseReply(answer.text)
      for (const item of missingTitle) {
        const row = parsed?.chapters?.find((c) => Number(c.chapter) === item.chapter)
        if (row?.title) item.title = String(row.title).slice(0, 12)
      }
    } catch { /* 标题补不齐就退回 第N节 */ }
  }

  // ② 人物档案（一次一个）
  const characterProfiles = []
  for (const person of personInputs) {
    const prompt = [
      '你是人物档案归纳器。输入是某个角色在全书中的**台词**与**行为/经历**（均取自原文）。只做归纳，不编造。',
      '输出 JSON：{"identity":"一句话身份定位","personality":["性格词",…],"summary":"2–3 句人物小传"}',
      '不引入原文没有的信息。推断不出就给空。',
      '',
      `【角色名】${person.name}`,
      `【台词】\n${person.speech.map((line) => `「${line}」`).join('\n') || '（无台词）'}`,
      `【行为/经历】\n${person.behavior.map((line) => `- ${line}`).join('\n') || '（无）'}`,
      `【出场】第 ${person.chapters.join('、')} 章`
    ].join('\n')
    try {
      const answer = await callJson(prompt, 1500)
      const parsed = parseReply(answer.text)
      characterProfiles.push({
        name: person.name, chapters: person.chapters,
        identity: String(parsed?.identity ?? ''),
        personality: Array.isArray(parsed?.personality) ? parsed.personality.slice(0, 4).map(String) : [],
        summary: String(parsed?.summary ?? '')
      })
    } catch {
      characterProfiles.push({ name: person.name, identity: '', personality: [], summary: '' })
    }
  }

  // ③ 全书梗概
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
    } catch { /* 全书梗概失败不阻塞 */ }
  }

  result.wiki = {
    version: 'wiki-enrich@2',
    generated_at: new Date().toISOString(),
    perspective: result.perspective ?? null,
    protagonist: options.protagonist ?? null,
    pseudoChapters: usePseudo,
    storySummary,
    arc,
    chapterSummaries,
    foreshadows,
    characterProfiles
  }
  await writeFile(join(lib, '拆解', `${id}.json`), JSON.stringify(result, null, 2), 'utf8')

  return {
    id, title: book.title,
    chapters: chapterInputs.length,
    pseudo: usePseudo,
    chapterSummaries: chapterSummaries.filter((item) => item.summary).length,
    characters: characterProfiles.filter((item) => item.identity || item.summary).length,
    foreshadows: foreshadows.length,
    storySummary: Boolean(storySummary)
  }
}

if (process.argv[1] && process.argv[1].endsWith('wiki-enrich-run.mjs')) {
  for (const id of BOOKS) {
    const startedAt = Date.now()
    const summary = await enrichBook(id)
    summary.sec = Math.round((Date.now() - startedAt) / 1000)
    console.log(`✓ ${summary.title}: ${summary.chapters} ${summary.pseudo ? '节' : '章'}，梗概 ${summary.chapterSummaries}/${summary.chapters}，人物 ${summary.characters}，伏笔 ${summary.foreshadows}，全书梗概 ${summary.storySummary ? '✓' : '✗'}，${summary.sec}s`)
  }
}
