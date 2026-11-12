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
 *   node devtools/run-extract-library.mjs --lib=D:/短篇选题库 --books=<id1>,<id2> [--batch=8] [--limit-chars=0]
 *   node devtools/run-extract-library.mjs --lib=D:/短篇选题库 --all-s && --dry   （列出候选不跑）
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { segmentText } from '../next/fact/domain/segment.js'
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

const LIB = argOf('--lib', 'D:/短篇选题库')
const BOOKS = (argOf('--books', '') || '').split(',').map((item) => item.trim()).filter(Boolean)
const BATCH = Math.max(1, Number(argOf('--batch', '8')))
const LIMIT_CHARS = Number(argOf('--limit-chars', '0')) || 0
const OUT_DIR = join(LIB, '拆解')
const DRY = flag('dry')

/** 剥掉下载器写的元数据头（书名/作者/book_id/... /====）与尾部（完）分隔线。 */
export function stripLibraryFile(text) {
  const raw = String(text ?? '')
  const sep = raw.indexOf('========================================')
  let body = sep >= 0 ? raw.slice(sep + 40) : raw
  const end = body.lastIndexOf('（完）')
  if (end > 0) body = body.slice(0, end)
  body = body.replace(/^-{10,}\s*$/gmu, '').trim()
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

async function callModel(prompt, maxTokens = 4000) {
  return dispatchDotsCompletion({ prompt, maxTokens, timeoutMs: 180_000 })
}

/** 一段原文 → 绑定 → 行（含失败隔离：解析不出的批退回规则绑定）。 */
async function extractBook(book, index, profile) {
  const filePath = join(LIB, '正文', book.file)
  const text = stripLibraryFile(await readFile(filePath, 'utf8'))
  const body = LIMIT_CHARS > 0 ? text.slice(0, LIMIT_CHARS) : text

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
    const slice = relocateToSource(body.slice(searchFrom), unit)
    const text = slice ? slice.text : unit.text
    if (slice) searchFrom += slice.end
    const { blocks } = segmentBlocks(text, { ...profile.blocks })
    return { id: meta.id, index: unit.index, chars: unit.chars, text, blocks, located: Boolean(slice) }
  })

  // B：模型窄绑定（批式串行——短篇量小，避免打爆上游）
  const knownNames = []
  const bindings = []
  const callLog = []
  for (let start = 0; start < segments.length; start += BATCH) {
    const batch = segments.slice(start, start + BATCH)
    const prompt = [BIND_SYSTEM_PROMPT, '', buildBatchBindPrompt({ segments: batch, knownNames, priorNames: [] })].join('\n')
    let reply = ''
    let parsedBinding = null
    for (let attempt = 1; attempt <= 2; attempt += 1) {
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
  }

  const { rows, stats } = bindSegments(segments, bindings, { knownNames, nameCandidates })
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
  const multiParty = segments.filter((segment) => new Set(segment.blocks.map((block) => block.speakerHint).filter(Boolean)).size >= 2)
  for (const segment of multiParty.slice(0, 20)) {
    const prompt = [RELATION_SYSTEM_PROMPT, '', buildRelationPrompt(segment)].join('\n')
    try {
      const answer = await callModel(prompt, 1500)
      relationCalls += 1
      const parsed = parseModelReply(answer.text)
      if (!parsed.ok || !Array.isArray(parsed.value.relations)) continue
      const { row, stats: relStats } = bindSegments([segment], [{ id: segment.id, relations: parsed.value.relations }], { knownNames })
      for (const key of Object.keys(relationDropped)) relationDropped[key] += relStats.relationDropped?.[key] ?? 0
      if (row[0].relations.length) {
        relationLanded += row[0].relations.length
        const target = compiled.entries.find((entry) => entry.layer === 'plot' && entry.name.includes(`段${segment.index}`))
        if (target) target.relations = row[0].relations
      }
    } catch { /* 单段关系失败不影响主链路 */ }
  }

  return {
    book: {
      id: book.id, title: book.title, author: book.author,
      subject_group: book.subject_group, grade: book.grade,
      word_count: book.word_count, read_count: book.read_count,
      length_tier: book.length_tier, url: book.url
    },
    source: { file: book.file, chars: body.length, segments: segments.length, blocks: segments.reduce((sum, item) => sum + item.blocks.length, 0) },
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

await main()
