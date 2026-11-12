/**
 * Wiki 增补（作者 2026-11-12：「这个 wiki 也太简陋了吧，剧情啥也没有」）。
 *
 * 绑定路径为了「模型不思考」砍掉了梗概/身份/性格——事件正文是原文切片，罗列出来不是剧情。
 * 但世界书需要「可读」：读者要能从 Wiki 看懂这本书讲什么、人物是谁、剧情怎么走。
 *
 * 分工（延续「机械归机械、语义归语义」的口径）：
 *   · 事件/台词/行为：绑定路径产出，逐字取自原文（已有）；
 *   · **梗概/身份/性格：本模块用模型窄窗归纳**——这是「需要一点推理」的活，
 *     按作者口径允许开（ADR §13.3：「必要的时候也允许流程打开 thinking 结合已有的 rag 推理」）。
 *     输入全部来自拆解数据（事件原文、台词锚点），模型只做压缩归纳、不引入外部知识。
 *
 * 产出写进拆解 JSON 的 `wiki` 字段，build-wiki 渲染时优先用它、缺了退回确定性派生。
 */

import { dispatchDotsCompletion } from '../next/runtime/factLlmService.mjs'
import { parseModelReply } from './lib/jsonExtract.mjs'

export const WIKI_ENRICH_VERSION = 'wiki-enrich@1'

const CHAPTER_SYSTEM = [
  '你是小说章节梗概器。输入是**若干章**的事件文本（按章分组、按原文顺序）。',
  '对每一章输出一条 2–3 句的剧情梗概。',
  '规则：',
  '1) 只概括该章原文里发生的事，不推测、不评价、不引入原文没有的信息；',
  '2) 写清楚「谁做了什么、这一章推进了什么」；',
  '3) 每章梗概 60–120 字；',
  '4) 只输出 JSON，章号与输入一一对应：{"chapters":[{"chapter":章号,"summary":"梗概"}]}，不要解释。'
].join('\n')

const CHARACTER_SYSTEM = [
  '你是人物档案归纳器。输入是某个角色在全书中的**台词**与**行为/经历**（均取自原文）。',
  '只做归纳，不编造：',
  '输出 JSON：{"identity":"一句话身份定位","personality":["性格词",…],"summary":"2–3 句人物小传"}',
  '规则：',
  '1) identity 从言行中推断（职业/身份/处境），推断不出就给空串；',
  '2) personality 给 2–4 个词；',
  '3) summary 只概括原文里展现的言行与经历；',
  '4) 不引入原文没有的信息。'
].join('\n')

const STORY_SYSTEM = [
  '你是小说梗概器。输入是全书各章的剧情梗概（按章序）。',
  '输出 JSON：{"storySummary":"全书梗概 3–6 句","arc":[{"phase":"阶段名","chapters":[起,止],"text":"该阶段剧情"}]}',
  '规则：',
  '1) storySummary 概括主线（谁、什么处境、遇到什么、结果如何）；',
  '2) arc 按剧情阶段切分（如 开端/发展/高潮/结局），phase 命名贴故事本身；',
  '3) 只依据输入的章节梗概，不引入外部信息。'
].join('\n')

async function callJson(prompt, maxTokens = 2000) {
  const answer = await dispatchDotsCompletion({ prompt, maxTokens, timeoutMs: 180_000 })
  const parsed = parseModelReply(answer.text)
  if (!parsed.ok) throw new Error(parsed.code ?? 'parse failed')
  return parsed.value
}

/** 章梗概：一次一批（5 章），输入为该章事件原文拼接。 */
export async function enrichChapterSummaries(chapterInputs, callModel = callJson) {
  const summaries = []
  for (let start = 0; start < chapterInputs.length; start += 5) {
    const batch = chapterInputs.slice(start, start + 5)
    const prompt = [
      CHAPTER_SYSTEM,
      '',
      ...batch.map((item) => `【第 ${item.chapter} 章事件】\n${item.text.slice(0, 2400)}`)
    ].join('\n\n')
    try {
      const out = await callJson(prompt, 2500)
      const map = new Map((out.chapters ?? out.summaries ?? []).map((item) => [Number(item.chapter), String(item.summary ?? '')]))
      for (const item of batch) {
        summaries.push({ chapter: item.chapter, summary: map.get(item.chapter) ?? '' })
      }
    } catch {
      // 单批失败不阻塞：该批章节退化为空梗概，页面照常渲染事件列表
      for (const item of batch) summaries.push({ chapter: item.chapter, summary: '' })
    }
  }
  return summaries
}

/** 人物档案：一次一个（输入为该角色全部言行）。 */
export async function enrichCharacterProfile(person, callModel = callJson) {
  const speechText = (person.speech ?? []).map((line) => `「${line}」`).join('\n')
  const behaviorText = (person.behavior ?? []).map((line) => `- ${line}`).join('\n')
  const prompt = [
    CHARACTER_SYSTEM,
    '',
    `【角色名】${person.name}`,
    person.aliases?.length ? `【别名】${person.aliases.join('、')}` : '',
    `【台词】\n${speechText || '（无台词）'}`,
    `【行为/经历】\n${behaviorText || '（无）'}`,
    `【出场】第 ${person.chapters?.join('、') ?? '?'} 章`
  ].join('\n')
  try {
    const out = await callJson(prompt, 1500)
    return {
      identity: String(out.identity ?? ''),
      personality: Array.isArray(out.personality) ? out.personality.slice(0, 4).map(String) : [],
      summary: String(out.summary ?? '')
    }
  } catch {
    return { identity: '', personality: [], summary: '' }
  }
}

/** 全书梗概：输入为各章梗概。 */
export async function enrichStorySummary(chapterSummaries, callModel = callJson) {
  const input = chapterSummaries
    .filter((item) => item.summary)
    .map((item) => `第${item.chapter}章：${item.summary}`)
    .join('\n')
  const prompt = [STORY_SYSTEM, '', input || '（无章节梗概）'].join('\n')
  try {
    const out = await callJson(prompt, 1500)
    return {
      storySummary: String(out.storySummary ?? ''),
      arc: Array.isArray(out.arc) ? out.arc.slice(0, 6).map((item) => ({
        phase: String(item.phase ?? ''),
        chapters: Array.isArray(item.chapters) ? item.chapters : [],
        text: String(item.text ?? '')
      })) : []
    }
  } catch {
    return { storySummary: '', arc: [] }
  }
}
