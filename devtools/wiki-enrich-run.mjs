/**
 * Wiki 增补执行器（CLI + 可导入函数）。
 *
 * 对已拆解的书跑三组窄窗归纳（章梗概 / 人物档案 / 全书梗概），结果写回拆解 JSON 的 wiki 字段。
 * 这是 Wiki 的剧情来源——绑定路径只产 who/ch（事件正文取原文），梗概与身份需要归纳。
 * 归纳属「需要一点推理」的活，按作者口径允许开（必要时可配 thinking + RAG）。
 *
 * 用法：node devtools/wiki-enrich-run.mjs --lib=D:/短篇选题库 --books=<id>[,<id>]
 * 幂等：重跑覆盖 wiki 字段（归纳结果以最后一次为准）。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dispatchDotsCompletion } from '../next/runtime/factLlmService.mjs'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const LIB = argOf('--lib', 'D:/短篇选题库')
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

  // 章输入：按 validity.from 分组，事件正文拼接（这就是该章的原文摘要）
  const chapterMap = new Map()
  for (const plot of plots) {
    const chapter = Number.isInteger(plot.validity?.from) ? plot.validity.from : 0
    const text = (plot.events ?? []).map((event) => event.content).join('\n')
    chapterMap.set(chapter, `${chapterMap.get(chapter) ?? ''}\n${text}`.trim())
  }
  const chapterInputs = [...chapterMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapter, text]) => ({ chapter, text: text.slice(0, LIMIT) }))

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

  console.log(`  ${book.title}: ${chapterInputs.length} 章 / ${personInputs.length} 个主要人物`)

  // ① 章梗概（批 5 章）
  const chapterSummaries = []
  for (let start = 0; start < chapterInputs.length; start += 5) {
    const batch = chapterInputs.slice(start, start + 5)
    const prompt = [
      '你是小说章节梗概器。输入是**若干章**的事件文本（按章分组、按原文顺序）。',
      '对每一章输出一条 2–3 句的剧情梗概。只概括该章原文里发生的事；每章 60–120 字。',
      '只输出 JSON：{"chapters":[{"chapter":章号,"summary":"梗概"}]}，不要解释。',
      '',
      ...batch.map((item) => `【第 ${item.chapter} 章事件】\n${item.text}`)
    ].join('\n\n')
    try {
      const answer = await callJson(prompt, 2500)
      const parsed = parseReply(answer.text)
      for (const item of batch) {
        chapterSummaries.push({
          chapter: item.chapter,
          summary: parsed?.chapters?.find((c) => Number(c.chapter) === item.chapter)?.summary ?? ''
        })
      }
    } catch {
      // 单批失败退化为空梗概，页面照常渲染事件列表
      for (const item of batch) chapterSummaries.push({ chapter: item.chapter, summary: '' })
    }
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
  const storyInput = chapterSummaries.filter((item) => item.summary).map((item) => `第${item.chapter}章：${item.summary}`).join('\n')
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
    version: 'wiki-enrich@1',
    generated_at: new Date().toISOString(),
    perspective: result.perspective ?? null,
    protagonist: options.protagonist ?? null,
    storySummary,
    arc,
    chapterSummaries,
    characterProfiles
  }
  await writeFile(join(lib, '拆解', `${id}.json`), JSON.stringify(result, null, 2), 'utf8')

  return {
    id, title: book.title,
    chapters: chapterInputs.length,
    chapterSummaries: chapterSummaries.filter((item) => item.summary).length,
    characters: characterProfiles.filter((item) => item.identity || item.summary).length,
    storySummary: Boolean(storySummary)
  }
}

if (process.argv[1] && process.argv[1].endsWith('wiki-enrich-run.mjs')) {
  for (const id of BOOKS) {
    const startedAt = Date.now()
    const summary = await enrichBook(id)
    summary.sec = Math.round((Date.now() - startedAt) / 1000)
    console.log(`✓ ${summary.title}: 章梗概 ${summary.chapterSummaries}/${summary.chapters}，人物 ${summary.characters}，全书梗概 ${summary.storySummary ? '✓' : '✗'}，${summary.sec}s`)
  }
}
