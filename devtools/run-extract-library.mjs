/**
 * 番茄短篇库 → 拆解驱动（P-TRIM 三段式落地到内容库）。
 *
 * 输入：D:\短篇选题库\正文\<book_id>__<书名>.txt（带元数据头的全文）
 * 输出：D:\短篇选题库\拆解\<book_id>.json（fact.data/v3 条目 + 拆解读数）
 *
 * 流程（与产品链路同一条，只是把「项目文件」换成「库里的 txt」）：
 *   A 剥头 → 稳定分段（segmentText）→ 确定性切块（blocks）
 *   B 模型窄绑定（dots.ai，关推理）；每批 8 段
 *   C 绑定 + 块原文 → 提取行（幻觉 who 丢弃）→ compile 成三层条目
 *   D 关系窄窗（独立一轮）→ 清洗后并入
 *
 * 用法：
 *   node devtools/run-extract-library.mjs --lib=D:/Qbook/短篇选题库 --books=<id1>,<id2> [--batch=8] [--limit-chars=0]
 *   node devtools/run-extract-library.mjs --lib=D:/Qbook/短篇选题库 --all-s && --dry   （列出候选不跑）
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync as readdirSyncCompat } from 'node:fs'
import { join } from 'node:path'
import { segmentText, segmentStats } from '../next/fact/domain/segmentBuckets.js'
import { detectPerspective, isIdentityTitle } from '../next/fact/usecases/pipeline/perspectiveTitles.js'
import { detectFirstPersonProtagonist, normalizeVocativeToName } from '../next/fact/usecases/pipeline/protagonistDetect.js'
import { segmentBlocks } from '../next/fact/usecases/pipeline/blocks.js'
import { bindSegments, normalizeBindReply } from '../next/fact/usecases/pipeline/bindRows.js'
import { collectNameCandidates } from '../next/fact/usecases/pipeline/nameCandidates.js'
import { BIND_SYSTEM_PROMPT, RELATION_SYSTEM_PROMPT, buildBatchBindPrompt, buildRelationPrompt } from '../next/fact/usecases/pipeline/bindPrompt.mjs'
import { buildExtractionSource, validateExtractionRows, compileExtractionEntries } from '../next/fact/usecases/pipeline/extractionChain.js'
import { normalizeExtractionProfile } from '../next/fact/usecases/pipeline/extractionProfile.js'
import { dispatchDotsCompletion } from '../next/runtime/factLlmService.mjs'
import { parseModelReply } from './lib/jsonExtract.mjs'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const LIB = argOf('--lib', 'D:/Qbook/短篇选题库')
const BOOKS = (argOf('--books', '') || '').split(',').map((item) => item.trim()).filter(Boolean)
const BATCH = Math.max(1, Number(argOf('--batch', '8')))
const LIMIT_CHARS = Number(argOf('--limit-chars', '0')) || 0
const OUT_DIR = join(LIB, '拆解')
const DRY = flag('dry')
const RESUME_MODE = flag('resume')
const RESUME_DIR = argOf('--resume-dir', null)

/** 剥掉下载器写的元数据头（书名/作者/book_id/... /====）与尾部（完）分隔线。 */
export function stripLibraryFile(text) {
  const raw = String(text ?? '')
  const sep = raw.indexOf('========================================')
  let body = sep >= 0 ? raw.slice(sep + 40) : raw
  const end = body.lastIndexOf('（完）')
  if (end > 0) body = body.slice(0, end)
  // 分隔线可能独占一行，也可能紧跟在正文句末（'……誓约。----------------'）——两种都剥。
  body = body.replace(/-{10,}/gu, '').trim()
  // 章节标题行保留（它们是分段时的天然边界，但 segmentText 会按段落处理，不影响切块）
  return body
}

/**
 * 把 segmentText 产出的段锚回原文（驱动层专用，不改 core 的分段契约）。
 *
 * 为什么需要：segmentText 为了满足 100–300 字会跨段合并，段文本是「重排结果」而不是原文切片，
 * 于是「事件正文＝块原文」在溯源时对不上原文——番茄库 8.8k 字实测只有 48.8% 能定位。
 * 这里按字符顺序把每段锚回原文（允许跳空白），锚定后用原文切片替换段文本。
 *
 * 锚不上就保留原文本并标记 located:false（如实，不改内容）。
 */
function relocateToSource(raw, unit) {
  const content = String(unit.text ?? '').replace(/\s+/gu, '')
  let scan = 0
  let start = -1
  let matched = 0
  while (scan < raw.length && matched < content.length) {
    const ch = raw[scan]
    if (/\s/u.test(ch)) { scan += 1; continue }
    if (ch === content[matched]) {
      if (start < 0) start = scan
      matched += 1
      scan += 1
      continue
    }
    return null
  }
  if (matched !== content.length || start < 0) return null
  return { text: raw.slice(start, scan).trim(), start, end: scan }
}

/** 读索引：book_id → 元数据。 */
async function loadIndex() {
  const path = join(LIB, '正文', '入库索引.json')
  if (!existsSync(path)) throw new Error(`找不到入库索引：${path}`)
  return JSON.parse(await readFile(path, 'utf8'))
}

/** 选书：显式 --books，或 --all-s（S 级超短篇）等筛选。 */
async function pickBooks(index) {
  if (BOOKS.length) return BOOKS
  const list = Object.values(index)
  if (flag('all-s')) return list.filter((book) => book.grade === 'S').map((book) => book.id)
  if (flag('all')) return list.map((book) => book.id)
  throw new Error('需要 --books=<id,...> 或 --all / --all-s')
}

// 超时/重试可配：长篇（50+ 次调用）用默认 180s 容易在中途被上游拖死，
// 命令行可用 --timeout=300000 --retries=3 放宽（真跑撞到：70k 字连续两次超时）。
const TIMEOUT_MS = Number(argOf('--timeout', '180000')) || 180_000
const CALL_RETRIES = Math.max(1, Number(argOf('--retries', '2')) || 2)

async function callModel(prompt, maxTokens = 4000) {
  return dispatchDotsCompletion({ prompt, maxTokens, timeoutMs: TIMEOUT_MS })
}


/** 一段原文 → 绑定 → 行（含失败隔离：解析不出的批退回规则绑定）。 */
/** 单本抽取（供管线复用）。env 可覆写 LIB/BATCH/CALL_RETRIES/RESUME_*。 */

export async function extractBook(book, index, profile, env = {}) {
  const lib = env.LIB ?? LIB
  const filePath = join(lib, '正文', book.file)
  const text = stripLibraryFile(await readFile(filePath, 'utf8'))
  const body = LIMIT_CHARS > 0 ? text.slice(0, LIMIT_CHARS) : text
  // 视角参数（作者 2026-11-12）：读者视角代入，第一人称下称谓即身份。
  const perspective = detectPerspective(body)

  // 全书名字候选统计（一次性，零模型）：判定 who 是不是真名，比单段证据可靠。
  const nameCandidates = collectNameCandidates(body)
  const source = buildExtractionSource({
    id: `正文/${book.file}`,
    text: body,
    chapterNo: 1,
    segment: profile.segment
  })
  const units = segmentText(body, profile.segment)
  // 锚回原文：段文本换成原文切片，块/事件的可溯源率才成立（48.8% → 99.7% 的差别）。
  let searchFrom = 0
  const segments = units.map((unit) => {
    const meta = source.segments.find((item) => item.index === unit.index)
    // 桶式分段后每段自带 chapterNo（章标题行确定）；不再统一记 1。
    const chapterNo = Number.isInteger(unit.chapterNo) ? unit.chapterNo : 1
    const slice = relocateToSource(body.slice(searchFrom), unit)
    const text = slice ? slice.text : unit.text
    if (slice) searchFrom += slice.end
    const { blocks } = segmentBlocks(text, { ...profile.blocks })
    return { id: meta.id, index: unit.index, chars: unit.chars, text, blocks, located: Boolean(slice), chapterNo }
  })

  // B：模型窄绑定（批式串行——短篇量小，避免打爆上游）
  const knownNames = []
  const bindings = []
  const callLog = []
  // 续跑：把已落盘的批次读回来，从断点之后继续（长篇 50+ 次调用中途超时不可避免）。
  let resumeFrom = 0
  if ((env.RESUME_MODE ?? RESUME_MODE) && (env.RESUME_DIR ?? RESUME_DIR) && existsSync(env.RESUME_DIR ?? RESUME_DIR)) {
    const done = readdirSyncCompat(env.RESUME_DIR ?? RESUME_DIR).filter((name) => name.startsWith('bindings-')).sort()
    for (const name of done) {
      const saved = JSON.parse(await readFile(join(env.RESUME_DIR ?? RESUME_DIR, name), 'utf8'))
      bindings.push(...saved.bindings)
      for (const who of saved.knownNames ?? []) if (!knownNames.includes(who)) knownNames.push(who)
      resumeFrom = Math.max(resumeFrom, saved.start + saved.batch.length)
    }
    if (done.length) console.log(`  续跑：已读回 ${done.length} 批（跳过前 ${resumeFrom} 段）`)
  }
  for (let start = resumeFrom; start < segments.length; start += BATCH) {
    const batch = segments.slice(start, start + BATCH)
    const prompt = [BIND_SYSTEM_PROMPT, '', buildBatchBindPrompt({ segments: batch, knownNames, priorNames: [] })].join('\n')
    let reply = ''
    let parsedBinding = null
    for (let attempt = 1; attempt <= env.CALL_RETRIES ?? CALL_RETRIES; attempt += 1) {
      const ask = attempt === 1 ? prompt : `${prompt}\n\n【上次输出不是合法 JSON】重新输出完整 JSON。`
      const answer = await callModel(ask)
      reply = answer.text
      const parsed = parseModelReply(reply)
      if (parsed.ok) {
        const normalized = normalizeBindReply(parsed.value)
        if (normalized.ok) { parsedBinding = normalized.segments; break }
      }
    }
    if (parsedBinding) {
      bindings.push(...parsedBinding)
      for (const item of parsedBinding) {
        for (const block of item.blocks) if (block.who && !knownNames.includes(block.who)) knownNames.push(block.who)
      }
    }
    callLog.push({ start, count: batch.length, ok: Boolean(parsedBinding), replyChars: reply.length })
    // 断点：每批成功就落盘绑定结果。长篇（50+ 次调用）中途超时后可用同一 --resume 续跑，
    // 不重跑已完成批次（真跑撞到：70k 字连续两次 180s 超时，重跑等于每次从零开始）。
    if (RESUME_DIR && parsedBinding) {
      await writeFile(
        join(RESUME_DIR, `bindings-${String(start).padStart(4, '0')}.json`),
        JSON.stringify({ start, batch: batch.map((item) => item.id), bindings: parsedBinding, knownNames }),
        'utf8'
      )
    }
  }

  // 取不到（比如全书只有称谓）就传 null，pronoun 解析会退化成「我」本身（称谓即身份）。
  // 主角识别（作者 2026-11-12 视角裁定）：第一人称里「我」= 叙述者。
  // 不能用「出现次数最高的真名」——实测《末世》最高频是林逸(78次)但那是男友；
  // 正确判据是「别人直呼的那个名字」（“沈岚，你也在啊”），再由称呼形式归一到真名（余律师→余欢）。
  const protagonistDetected = detectFirstPersonProtagonist(body, nameCandidates)
  const protagonist = protagonistDetected.name
    ? normalizeVocativeToName(protagonistDetected.name, nameCandidates).name
    : null
  const { rows, stats } = bindSegments(segments, bindings, { knownNames, nameCandidates, protagonist, perspective })
  const accepted = []
  const rejected = []
  for (const row of rows) {
    const meta = source.segments.find((item) => item.id === row.segmentId)
    const check = meta ? validateExtractionRows([row], [meta]) : { ok: false, error: { details: [{ field: 'segmentId', message: '未知段' }] } }
    if (check.ok) accepted.push(check.value[0])
    else rejected.push({ segmentId: row.segmentId, details: check.error.details.slice(0, 3) })
  }

  // C：编译
  const compiled = compileExtractionEntries({
    sources: [source],
    rows: accepted,
    domain: book.subject_group || '短篇',
    book: book.title,
    bookId: book.id,
    minimal: true,
    policy: profile.salience
  })

  // D：关系窄窗（只对「多主体段」抽，省调用）
  let relationCalls = 0
  let relationLanded = 0
  const relationDropped = { missing: 0, hallucinated: 0, self: 0, titleTarget: 0 }
  const relationFailures = []
  const multiParty = segments.filter((segment) => new Set(segment.blocks.map((block) => block.speakerHint).filter(Boolean)).size >= 2)
  for (const segment of multiParty.slice(0, 20)) {
    const prompt = [RELATION_SYSTEM_PROMPT, '', buildRelationPrompt(segment)].join('\n')
    try {
      const answer = await callModel(prompt, 1500)
      relationCalls += 1
      const parsed = parseModelReply(answer.text)
      if (!parsed.ok || !Array.isArray(parsed.value.relations)) continue
      // bindSegments 返回 { rows, stats }。早先这里写成 `const { row }`（少一个 s），
      // row 就是 undefined，row[0] 抛 TypeError 被下面的 catch 吞掉——
      // 表现为「29 次调用、关系 0 条、dropped 全 0」的无声失败。别把解构写错。
      const { rows: relRows, stats: relStats } = bindSegments(
        [segment],
        [{ id: segment.id, relations: parsed.value.relations }],
        // 代词映射的必要上下文必须一起传——只传 knownNames 的话，
        // 「我→林逸」里的「我」映射不到主角，「他」也解析不出来（真跑撞到：8 条关系残留代词）。
        { knownNames, nameCandidates, protagonist, perspective }
      )
      const relRow = relRows[0]
      for (const key of Object.keys(relationDropped)) relationDropped[key] += relStats.relationDropped?.[key] ?? 0
      if (relRow.relations.length) {
        relationLanded += relRow.relations.length
        const target = compiled.entries.find((entry) => entry.layer === 'plot' && entry.name.includes(`段${segment.index}`))
        if (target) target.relations = relRow.relations
      }
    } catch (error) {
      // 不静默吞：关系窄窗失败必须可见，否则「没跑通」会被误读成「模型没给关系」。
      relationFailures.push({ segmentIndex: segment.index, message: error?.message ?? String(error) })
    }
  }

  return {
    book: {
      id: book.id, title: book.title, author: book.author,
      subject_group: book.subject_group, grade: book.grade,
      word_count: book.word_count, read_count: book.read_count,
      length_tier: book.length_tier, url: book.url
    },
    source: { file: book.file, chars: body.length, segments: segments.length, blocks: segments.reduce((sum, item) => sum + item.blocks.length, 0) },
    // 视角参数（作者 2026-11-12）：读者视角代入，第一人称下称谓即身份。
    perspective: { perspective: perspective.perspective, confidence: perspective.confidence },
    calls: callLog.length + relationCalls,
    bindStats: stats,
    relationCalls,
    relationLanded,
    relationDropped,
    accepted: accepted.length,
    rejected,
    entries: compiled.entries,
    index: compiled.index,
    pruning: compiled.pruning,
    extractor: 'fact-chain/v1'
  }
}

async function main() {
  const index = await loadIndex()
  let ids = await pickBooks(index)
  if (DRY) {
    console.log(JSON.stringify(ids.map((id) => ({ id, title: index[id]?.title, words: index[id]?.word_count })), null, 1))
    return
  }
  const profile = normalizeExtractionProfile('short')
  if (!profile.ok) throw new Error(`档位无效：${JSON.stringify(profile.error)}`)
  await mkdir(OUT_DIR, { recursive: true })

  const summary = []
  for (const id of ids) {
    const book = index[id]
    if (!book) { summary.push({ id, error: 'NOT_IN_INDEX' }); continue }
    const startedAt = Date.now()
    try {
      const result = await extractBook(book, index, profile.value)
      const outPath = join(OUT_DIR, `${id}.json`)
      await writeFile(outPath, JSON.stringify(result, null, 2), 'utf8')
      summary.push({
        id, title: book.title, words: book.word_count, ms: Date.now() - startedAt,
        segments: result.source.segments, blocks: result.source.blocks,
        calls: result.calls, entries: result.entries.length,
        byLayer: result.entries.reduce((acc, entry) => { acc[entry.layer] = (acc[entry.layer] ?? 0) + 1; return acc }, {}),
        relations: result.relationLanded,
        accepted: result.accepted, rejected: result.rejected.length,
        hallucinated: result.bindStats.hallucinated,
        outPath
      })
      console.log(`✓ ${book.title} (${book.word_count}字) → ${result.entries.length} 条，${result.calls} 次调用，${Math.round((Date.now() - startedAt) / 1000)}s`)
    } catch (error) {
      summary.push({ id, title: book?.title, error: error.message })
      console.error(`✗ ${book?.title ?? id}: ${error.message}`)
    }
  }
  await writeFile(join(OUT_DIR, '拆解汇总.json'), JSON.stringify(summary, null, 2), 'utf8')
  console.log('\n' + JSON.stringify(summary, null, 1))
}

if (process.argv[1] && process.argv[1].endsWith('run-extract-library.mjs')) {
  await main()
}
