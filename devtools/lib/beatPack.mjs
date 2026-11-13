/**
 * 推演上下文包（审计 2026-11-13 §四 D：下游装配验证）。
 *
 * 按「拍」装配推演上下文：一个拍 = 一章/一节内的一次剧情推进。
 * 装配原则：事实层给逐字事件流（按 refs/when/where 圈定），语义层给窄标注（goal/台账/情绪/伏笔），
 * 预算 ≤4k tokens（中文 ≈5.5k 字符）——不浪费上下文：不投全书，只投当前拍需要的。
 *
 * scoreBeat：候选拍四维打分（人设一致性/推动力/OOC/情绪），chat+JSON（同编剧推演引擎口径，
 * 打分形态走同模型 chat+JSON，不做 logprob）。
 */
import { dispatchDotsCompletion } from '../../next/runtime/factLlmService.mjs'
import { derivePseudoChapters, hasRealChapters } from './pseudoChapters.mjs'
import { parseModelReply } from './jsonExtract.mjs'

const BUDGET_CHARS = 5500

/**
 * @param {object} decomposition 拆解 JSON（含 wiki 增补）
 * @param {number} chapterNo 拍所在章/节号
 * @param {{candidate?:string, eventsCap?:number}} [options]
 * @returns {{pack:string, chars:number, present:string[], missing:string[]}}
 */
export function buildBeatPack(decomposition, chapterNo, options = {}) {
  const wiki = decomposition.wiki ?? {}
  const unit = wiki.pseudoChapters ? '节' : '章'
  const plots = decomposition.entries.filter((entry) => entry.layer === 'plot')
  // 章分组与 enrich/build-wiki 共用同一伪章公式（伪章书的 validity.from 恒 1，不能直接过滤）
  const usePseudo = wiki.pseudoChapters ?? !hasRealChapters(plots)
  const chapterPlots = usePseudo
    ? (derivePseudoChapters(plots, decomposition.source?.chars ?? decomposition.book?.word_count ?? 0).find((group) => group.no === chapterNo)?.plots ?? [])
    : plots.filter((plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : 0) === chapterNo)
  const chapterSummary = wiki.chapterSummaries?.find((item) => item.chapter === chapterNo) ?? null
  const prevSummary = wiki.chapterSummaries?.find((item) => item.chapter === chapterNo - 1) ?? null
  const profiles = wiki.characterProfiles ?? []
  const ledger = wiki.ledger ?? null

  // 在场人物：本段 who 并集 ∩ 人物表
  const charNames = new Set(decomposition.entries.filter((entry) => entry.layer === 'character').map((entry) => entry.name))
  const present = [...new Set(chapterPlots.flatMap((plot) => plot.who ?? []))].filter((who) => charNames.has(who))

  const parts = []
  parts.push(`【作品】${decomposition.book.title}（${wiki.perspective?.perspective ?? '?'} 视角）`)
  parts.push(`【前情】第${chapterNo - 1}${unit}：${prevSummary?.summary?.slice(0, 160) ?? '（开篇）'}`)
  parts.push(`【本章】第${chapterNo}${unit}「${chapterSummary?.title ?? ''}」 功能=${chapterSummary?.function ?? '—'} 情绪=${chapterSummary?.emotion ?? '—'} 剧情点=${chapterSummary?.beats ?? '—'}`)
  parts.push(`【梗概】${chapterSummary?.summary?.slice(0, 220) ?? '（无）'}`)

  // 事件流（逐字，截断到预算）
  const cap = options.eventsCap ?? 2200
  const events = chapterPlots.flatMap((plot) => (plot.events ?? []).map((event) => event.content))
  let eventsText = events.join('\n')
  if (eventsText.length > cap) eventsText = eventsText.slice(0, cap) + '…（截断）'
  parts.push(`【事件流·原文】\n${eventsText}`)

  // 在场人物卡（goal/archetype/性格 + 声线样本 1 条）
  const cardLines = (present.length ? present : profiles.slice(0, 4).map((p) => p.name)).map((name) => {
    const profile = profiles.find((item) => item.name === name)
    if (!profile) return `- ${name}（无档案）`
    const quote = profile.quote ?? (profile.speechSample ?? '')
    return `- ${name}｜身份:${profile.identity || '—'}｜模式:${profile.archetype || '—'}｜动机:${profile.goal || '—'}｜性格:${(profile.personality ?? []).join('/') || '—'}${quote ? `｜声线样例:「${quote.slice(0, 30)}」` : ''}`
  })
  parts.push(`【在场人物卡】\n${cardLines.join('\n')}`)

  // 台账：在场人物的知情 + 关键物态
  if (ledger?.knowledgeLedger?.length) {
    const relevant = ledger.knowledgeLedger.filter((item) => present.includes(item.character))
    if (relevant.length) parts.push(`【知情台账】\n${relevant.map((item) => `- ${item.character} 知道：${item.knows}（约第${item.chapter}${unit}）`).join('\n')}`)
  }
  if (ledger?.stateLedger?.length) {
    parts.push(`【状态台账】\n${ledger.stateLedger.map((item) => `- ${item.object}：${item.state}（第${item.chapter}${unit}确认）`).join('\n')}`)
  }

  // 悬空伏笔（本章前埋下、本章尚未回收的）
  const openHooks = (wiki.foreshadows ?? []).filter((hook) => hook.chapter <= chapterNo).slice(-4)
  if (openHooks.length) parts.push(`【在途伏笔】\n${openHooks.map((hook) => `- 第${hook.chapter}${unit}: ${hook.text}`).join('\n')}`)

  if (options.candidate) parts.push(`【候选拍】${options.candidate}`)

  const pack = parts.join('\n\n')
  const missing = []
  if (!chapterSummary?.summary) missing.push('章梗概')
  if (!present.length) missing.push('在场人物')
  if (!ledger) missing.push('状态台账')
  return { pack, chars: pack.length, present, missing, withinBudget: pack.length <= BUDGET_CHARS }
}

/**
 * 候选拍四维打分（人设一致性/推动力/OOC/情绪），chat+JSON。
 * @returns {Promise<{ok:boolean, scores?:object, raw?:string}>}
 */
export async function scoreBeat(pack, candidate) {
  const prompt = [
    '你是剧情拍打分器。上下文包给了：前情、本章事件流（原文）、人物卡（动机/模式/性格/声线样例）、知情台账、在途伏笔。',
    '对给出的【候选拍】打四维分（每维 1–10）：',
    '1) 人设：候选拍里各人物的言行是否与人物卡的模式/性格一致；',
    '2) 推动力：是否推进了人物动机或主线冲突；',
    '3) OOC：是否有人物说出/做出违背其声线样例与知情范围的事（知情台账之外的信息被使用＝扣分）；',
    '4) 情绪：与本章核心情绪的贴合度。',
    // 扁平键（实测嵌套对象回包易截断）：{"人设":8,"人设Reason":"≤30字",…,"verdict":"…"}
    '输出 JSON（扁平键）：{"人设":8,"人设Reason":"≤30字","推动力":9,"推动力Reason":"≤30字","OOC":7,"OOCReason":"≤30字","情绪":6,"情绪Reason":"≤30字","verdict":"continue|revise|reject"}',
    '',
    pack,
    '',
    `【候选拍】${candidate}`
  ].join('\n')
  const answer = await dispatchDotsCompletion({ prompt, maxTokens: 900, timeoutMs: 180_000 })
  const parsed = parseModelReply(answer.text)
  if (!parsed.ok) return { ok: false, raw: answer.text }
  return { ok: true, scores: parsed.value }
}
