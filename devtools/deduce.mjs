/**
 * 推演器（作者 2026-11-13：「基于已有数据能否推演——xx 为什么怎么做、如果条件改变会如何，结合 RAG」）。
 *
 * 两种模式，全部走 RAG 取证（kb_search 按需取卡，不塞全书）＋ dots 窄推理：
 *   why     动机解释：检索人物卡/事件卡/台账 → 「为什么这样做」＋证据（章号/卡片引用）
 *   whatif  反事实推演：改变一个条件 → 检索受影响节点 → 分支推演（链式步骤＋对各人物的影响＋知情台账的连锁变化）
 *
 * 取证纪律（对齐六槽位溯源）：每个结论必须给依据（检索命中卡片＋章号）；推断与事实分开关；检索不到就说检索不到。
 *
 * 用法：
 *   node devtools/deduce.mjs --book=<id> --mode=why     --q="宋戟 为什么 囚禁 陈落芸"
 *   node devtools/deduce.mjs --book=<id> --mode=whatif  --q="如果 陈落芸 第1节 就知道 自己 真千金"
 * 可选 --k=8（检索卡数）--lib=…
 */
import { join } from 'node:path'
import { dispatchDotsCompletion } from '../next/runtime/factLlmService.mjs'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const LIB = argOf('--lib', 'D:/Qbook/短篇选题库')
const BOOK = argOf('--book', null)
const MODE = argOf('--mode', 'why')
const Q = argOf('--q', '')
const K = Number(argOf('--k', '8')) || 8
const RUNTIME_ROOT = 'D:/Pinax-next/.runtime/knowledge'
const CACHE_ROOT = join(LIB, 'knowledge-cache')

/** 检索词：标点转空格、按词取（内核空格分词），滤单字。 */
function queryTerms(q) {
  return [...new Set(String(q ?? '').replace(/[，。？！、：；「」『』（）\s]+/gu, ' ').split(/\s+/).filter((term) => term.length >= 2))].slice(0, 8)
}

function parseReply(text) {
  const raw = String(text ?? '').replace(/^```(?:json)?/u, '').replace(/```$/u, '').trim()
  try { return JSON.parse(raw) } catch { return null }
}

const TRACE_RULES = [
  '推理纪律：',
  '1) 每个结论必须给依据：引用输入卡片里的内容（章号/条目名）；检索材料覆盖不到的部分明确说「材料未覆盖」；',
  '2) 区分 原文事实 / 合理推断 / 纯猜测，在字段里标注；',
  '3) 人物行为解释必须落在人物卡的性格/动机/知情台账范围内（OOC 的解释就是解释不通，不要硬圆）。'
].join('\n')

async function main() {
  if (!BOOK || !Q) {
    console.error('用法：--book=<id> --mode=why|whatif --q="问题"')
    process.exit(2)
  }
  const root = join(LIB, 'rag', BOOK)
  const { createKnowledgeService } = await import('../next/runtime/knowledgeService.mjs')
  const service = createKnowledgeService({ runtimeRoot: RUNTIME_ROOT, cacheRoot: CACHE_ROOT })

  // ① RAG 取证：多组检索词并取（问题原词＋拆词）
  const terms = queryTerms(Q)
  const seen = new Set()
  const cards = []
  for (const term of [terms.join(' '), ...terms].filter(Boolean)) {
    const searched = await service.search({ root, verb: 'kb_search', q: term, k: K })
    if (!searched.ok) { console.error('检索失败：', JSON.stringify(searched.error)); process.exit(1) }
    for (const hit of searched.value?.hits ?? []) {
      if (seen.has(hit.id)) continue
      seen.add(hit.id)
      cards.push(hit)
    }
    if (cards.length >= K + 4) break
  }
  cards.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const top = cards.slice(0, K)

  console.error(`[RAG] 检索命中 ${cards.length} 卡，取前 ${top.length}：`)
  for (const hit of top) console.error(`  - ${hit.title}（${hit.dir}，score ${hit.score}）`)

  // ② 组装推演上下文（卡片原文摘录）
  const dossier = top.map((hit, index) => `【卡${index + 1}】${hit.title}（${hit.dir}）\n${String(hit.excerpt ?? '').slice(0, 700)}`).join('\n\n')

  const prompt = MODE === 'why'
    ? [
        '你推演一部小说的人物动机。输入是 RAG 检索出的知识卡（人物卡/事件卡/场景/道具/台账）。',
        '回答问题：为什么当事人会这样做？',
        '输出 JSON：{',
        ' "answer": "2–4 句直接回答",',
        ' "motives": [ { "layer": "动机层（性格/知情/处境/关系，选一）", "explain": "≤40 字", "evidence": "依据哪张卡＋章号" } ],',
        ' "confidence": "fact|inferred|speculation"',
        '}',
        '',
        TRACE_RULES,
        '',
        `【问题】${Q}`,
        '',
        '【知识卡】',
        dossier
      ].join('\n')
    : [
        '你推演一部小说的反事实分支。输入是 RAG 检索出的知识卡（人物卡/事件卡/场景/道具/台账）。',
        '问题假设某个条件被改变，推演后续走向。',
        '输出 JSON：{',
        ' "premise": "复述被改变的条件与原时间线锚点（章号）",',
        ' "branches": [ { "name": "分支名（最可能/次可能/意外）", "likelihood": 1-10, "chain": [ { "step": "第几步", "who": "谁", "what": "做什么 ≤30字" } ], "basis": "依据哪张卡" } ],',
        ' "impacts": [ { "character": "谁", "change": "境遇/关系如何改变 ≤30字" } ],',
        ' "ledgerShifts": [ "知情台账的哪一条被改变 → 连锁影响谁" ],',
        ' "confidence": "inferred|speculation"',
        '}',
        '纪律：branches 2–3 条，chain 3–5 步，每步都要能从知识卡里找到行为依据；与原文人物性格冲突的分支降低 likelihood 并说明。',
        '',
        TRACE_RULES,
        '',
        `【假设条件】${Q}`,
        '',
        '【知识卡】',
        dossier
      ].join('\n')

  const answer = await dispatchDotsCompletion({ prompt, maxTokens: 2200, timeoutMs: 180_000 })
  const parsed = parseReply(answer.text)
  if (!parsed) {
    console.error('推理回包解析失败，原文：\n' + String(answer.text ?? '').slice(0, 600))
    process.exit(1)
  }
  console.log(JSON.stringify({ mode: MODE, q: Q, ragCards: top.map((hit) => ({ title: hit.title, dir: hit.dir, score: hit.score })), result: parsed }, null, 1))
}

await main()
