/**
 * 拍循环推演（推演引擎 Phase 1，作者 2026-11-13 批准）。
 *
 * 闭环：四象限候选生成 → 四维打分 → 作者点击 → 记账 → 下一拍。
 * 「作家只负责选择，引擎生成可能世界」——前情用已选拍序列（可能世界），不用原作梗概；
 * 原作该节走向只在结果末尾作对照展示（不进生成上下文，避免锚定）。
 * 节奏骨架（功能/情绪/剧情点）取原作槽位——推演在骨架内改写内容。
 *
 * 数据源：拆解 JSON 直读（人物卡/台账/伏笔/骨架，确定性）；RAG 检索已在 deduce 验证，此处不依赖。
 * 每节成本：生成 1 call + 打分 1 call。
 *
 * 用法：
 *   node devtools/simulate.mjs --book=<id> --start=4            # 开始/续跑：第 4 节起推演（输出候选+打分）
 *   node devtools/simulate.mjs --book=<id> --pick=2             # 选第 2 候选 → 记账 → 生成下一节候选
 *   node devtools/simulate.mjs --book=<id> --status             # 查看会话（已选拍序列）
 * 可选 --lib=…
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dispatchDotsCompletion } from '../next/runtime/factLlmService.mjs'
import { derivePseudoChapters, hasRealChapters } from './lib/pseudoChapters.mjs'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const LIB = argOf('--lib', 'D:/Qbook/短篇选题库')
const BOOK = argOf('--book', null)
const START = Number(argOf('--start', '0')) || 0
const PICK = argOf('--pick', null)
const STATUS = process.argv.includes('--status')
const SESSION_DIR = join(LIB, 'sim')
const SESSION_FILE = BOOK ? join(SESSION_DIR, `${BOOK}.json`) : null

function parseReply(text) {
  const raw = String(text ?? '').replace(/^```(?:json)?/u, '').replace(/```$/u, '').trim()
  try { return JSON.parse(raw) } catch { return null }
}

async function callJson(prompt, maxTokens) {
  const answer = await dispatchDotsCompletion({ prompt, maxTokens, timeoutMs: 180_000 })
  const parsed = parseReply(answer.text)
  if (!parsed) throw new Error('回包解析失败：' + String(answer.text ?? '').slice(0, 200))
  return parsed
}

/** 推演上下文装配（不含原作内容——前情=已选拍序列，骨架=原作节奏槽位）。 */
function assemblePack(result, session) {
  const wiki = result.wiki ?? {}
  const unit = wiki.pseudoChapters ? '节' : '章'
  const cursor = session.cursor
  const summary = (wiki.chapterSummaries ?? []).find((item) => item.chapter === cursor)
  const chosen = session.steps.filter((step) => step.picked != null)
  const chosenText = chosen.length
    ? chosen.map((step) => `第${step.chapter}${unit}：作者选择了「${step.candidates[step.picked]?.name ?? ''}」——${step.candidates[step.picked]?.text ?? ''}`).join('\n')
    : '（从本节起推演，尚无改写）'
  const profiles = wiki.characterProfiles ?? []
  const cardLines = profiles.map((profile) => `- ${profile.name}｜身份:${profile.identity || '—'}｜模式:${profile.archetype || '—'}｜动机:${profile.goal || '—'}｜性格:${(profile.personality ?? []).join('/') || '—'}${profile.quote || profile.speechSample ? `｜声线:「${String(profile.quote ?? profile.speechSample ?? '').slice(0, 30)}」` : ''}`)
  const ledger = wiki.ledger
  const openHooks = (wiki.foreshadows ?? []).filter((hook) => hook.chapter <= cursor).slice(-5)
  return [
    `【作品】${result.book.title}（${wiki.perspective?.perspective ?? '?'} 视角，共 ${(wiki.chapterSummaries ?? []).length} ${unit}）`,
    `【推演位置】第 ${cursor} ${unit}；原作节奏骨架：功能=${summary?.function ?? '—'} 情绪=${summary?.emotion ?? '—'} 剧情点=${summary?.beats ?? '—'}`,
    `【前情·可能世界（作者已选拍）】\n${chosenText}`,
    `【原作前情参考】${(wiki.chapterSummaries ?? []).filter((item) => item.chapter < cursor).slice(-2).map((item) => `第${item.chapter}${unit}「${item.title}」${item.summary}`).join('\n') || '（开篇）'}`,
    `【人物卡】\n${cardLines.join('\n')}`,
    ...(ledger?.knowledgeLedger?.length ? [`【知情台账】\n${ledger.knowledgeLedger.map((item) => `- ${item.character} 知道：${item.knows}（约第 ${item.chapter ?? '?'} ${unit}）`).join('\n')}`] : []),
    ...(ledger?.stateLedger?.length ? [`【状态台账】\n${ledger.stateLedger.map((item) => `- ${item.object}：${item.state}`).join('\n')}`] : []),
    ...(openHooks.length ? [`【在途伏笔】\n${openHooks.map((hook) => `- 第${hook.chapter}${unit}: ${hook.text}`).join('\n')}`] : [])
  ].join('\n\n')
}

async function stepNext(result, session) {
  const wiki = result.wiki ?? {}
  const unit = wiki.pseudoChapters ? '节' : '章'
  const pack = assemblePack(result, session)
  const Quadrants = ['激进（冲突/秘密升级）', '保守（关系维持/试探）', '意外（新信息/新人入场）', '倒钩（回收在途伏笔）']

  // ① 四象限候选生成（不给原作该节梗概——可能世界不被锚定）
  const genPrompt = [
    '你是剧情拍推演器。输入：推演位置、作者已选的前情（可能世界）、人物卡、知情/状态台账、在途伏笔、本节节奏骨架。',
    `为本节生成 3 个候选拍，覆盖不同象限：${Quadrants.slice(0, 3).join('／')}（第 3 个可换成「${Quadrants[3]}」若在途伏笔有料）。`,
    '每个候选拍是一段 40–70 字的「这一拍发生什么」（谁+做什么+推进什么），必须落在人物卡性格与知情台账范围内。',
    '输出 JSON：{"candidates":[{"name":"2-6字名","quadrant":"象限名","text":"40-70字"}]}',
    '',
    pack
  ].join('\n')
  process.stderr?.write?.('[gen] 生成候选…\n')
  const gen = await callJson(genPrompt, 1600)
  const candidates = (gen.candidates ?? []).slice(0, 3)

  // ② 四维打分（合并 1 call；OOC 用知情台账判）
  const scorePrompt = [
    '你是剧情拍打分器。对给出的每个候选拍打四维分（1–10）：人设（符合人物卡模式/性格）、推动力（推进动机或冲突）、OOC（违背声线样例或使用知情台账之外的信息＝低分）、情绪（贴合本节情绪槽位）。',
    '输出 JSON（扁平键，逐候选）：{"scores":[{"index":1,"人设":8,"人设Reason":"≤20字","推动力":9,"推动力Reason":"≤20字","OOC":7,"OOCReason":"≤20字","情绪":6,"情绪Reason":"≤20字","verdict":"continue|revise|reject"}]}',
    '',
    pack,
    '',
    '【候选拍】',
    ...candidates.map((candidate, index) => `${index + 1}. ${candidate.name}（${candidate.quadrant}）：${candidate.text}`)
  ].join('\n')
  process.stderr?.write?.('[score] 四维打分…\n')
  const scored = await callJson(scorePrompt, 1400)

  session.steps.push({ chapter: session.cursor, candidates, scores: scored.scores ?? [], picked: null, at: new Date().toISOString() })
  saveSession(session)

  // ③ 展示
  const step = session.steps[session.steps.length - 1]
  console.log(`\n=== 第 ${session.cursor} ${unit} · 推演候选（原作骨架：功能=${summary0(result, session.cursor)} 情绪=${emotion0(result, session.cursor)}）===`)
  step.candidates.forEach((candidate, index) => {
    const score = step.scores.find((item) => Number(item.index) === index + 1) ?? {}
    console.log(`\n[${index + 1}] ${candidate.name}（${candidate.quadrant}）`)
    console.log(`    ${candidate.text}`)
    console.log(`    人设 ${score['人设'] ?? '—'}｜推动力 ${score['推动力'] ?? '—'}｜OOC ${score['OOC'] ?? '—'}｜情绪 ${score['情绪'] ?? '—'} → ${score.verdict ?? '—'}`)
    if (score['OOCReason']) console.log(`    OOC 注：${score['OOCReason']}`)
  })
  console.log(`\n作者选择：node devtools/simulate.mjs --book=${BOOK} --pick=<1-3>`)
  const original = (wiki.chapterSummaries ?? []).find((item) => item.chapter === session.cursor)
  if (original) console.log(`\n（原作走向对照：${original.summary}）`)
}

function summary0(result, chapter) {
  return (result.wiki?.chapterSummaries ?? []).find((item) => item.chapter === chapter)?.function ?? '—'
}
function emotion0(result, chapter) {
  return (result.wiki?.chapterSummaries ?? []).find((item) => item.chapter === chapter)?.emotion ?? '—'
}

function loadSession(result) {
  if (existsSync(SESSION_FILE)) return JSON.parse(readFileSync(SESSION_FILE, 'utf8'))
  const wiki = result.wiki ?? {}
  const total = (wiki.chapterSummaries ?? []).length
  return { bookId: BOOK, total, cursor: 0, steps: [] }
}

function saveSession(session) {
  mkdirSync(SESSION_DIR, { recursive: true })
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 1), 'utf8')
}

async function main() {
  if (!BOOK) { console.error('用法：--book=<id> [--start=N | --pick=M | --status]'); process.exit(2) }
  const result = JSON.parse(readFileSync(join(LIB, '拆解', `${BOOK}.json`), 'utf8'))
  const wiki = result.wiki ?? {}
  const unit = wiki.pseudoChapters ? '节' : '章'
  const total = (wiki.chapterSummaries ?? []).length
  if (!total) { console.error('本书无章纲（先跑 enrich）'); process.exit(1) }

  if (STATUS) {
    const session = existsSync(SESSION_FILE) ? JSON.parse(readFileSync(SESSION_FILE, 'utf8')) : { cursor: 0, steps: [] }
    console.log(JSON.stringify({ cursor: session.cursor, total, picked: session.steps.filter((step) => step.picked != null).map((step) => ({ chapter: step.chapter, picked: step.candidates[step.picked]?.name, text: step.candidates[step.picked]?.text })) }, null, 1))
    return
  }

  let session = loadSession(result)
  if (START > 0) { session.cursor = Math.min(START, total); session.steps = session.steps.filter((step) => step.chapter < session.cursor) }
  if (!session.cursor) session.cursor = 1
  if (PICK != null) {
    const step = session.steps.find((item) => item.chapter === session.cursor && item.picked == null)
    if (!step) { console.error(`第 ${session.cursor} ${unit} 无待选候选（先 --start）`); process.exit(1) }
    const pick = Number(PICK) - 1
    if (!(pick >= 0 && pick < step.candidates.length)) { console.error('候选序号越界'); process.exit(1) }
    step.picked = pick
    step.decision = { by: 'author', at: new Date().toISOString(), scores: step.scores.find((item) => Number(item.index) === pick + 1) ?? null }
    session.cursor += 1
    saveSession(session)
    console.log(`✓ 第 ${step.chapter} ${unit} 已选「${step.candidates[pick].name}」→ 记账，游标到第 ${session.cursor} ${unit}`)
    if (session.cursor > total) { console.log('全节推演完毕。--status 查看可能世界全览'); return }
  }
  await stepNext(result, session)
}

await main()
