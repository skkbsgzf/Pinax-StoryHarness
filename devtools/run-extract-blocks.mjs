/**
 * 三段式抽取驱动（P-TRIM 流水线落地验证）：Code → LLM(窄绑定) → Code。
 *
 * 与旧 `run-extract-batch.mjs` 的差别（这是作者 2026-11-11「LLM 只做机械流水线」的落地件）：
 *   · 旧驱动：1 段 = 1 次模型调用，模型自由生成事件文本（实测 71% 不能原文定位）；
 *   · 新驱动：1 批 = N 段 = 1 次模型调用，模型只输出 {id, who, ch} 绑定（不产生事件文本）。
 *
 * 流程：
 *   A blocks.js   原文 → 块（引号跨度／说话人线索／通道提示，零模型）
 *   B bindPrompt  块清单 → 模型窄绑定（批式，可并发）
 *   C bindRows    绑定 → 现行 EXTRACTION_ROW_SCHEMA 行（事件正文取块原文，零模型）
 *
 * 用法：
 *   node devtools/run-extract-blocks.mjs --project=<项目> --log=<日志> \
 *     [--chapters=10] [--dataset=x] [--batch=8] [--concurrency=4] [--fake]
 *
 * 诚实边界：
 *   · --fake 只用规则绑定（不调模型），验证的是工程链路，不是语义质量；
 *   · 真模型下 B 段是唯一有模型的环节，A/C 全确定性——所以成本可直接由调用数读出。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createExtractionLog } from '../next/runtime/extractionLog.mjs'
import { parseModelReply } from './lib/jsonExtract.mjs'
import { dispatchDotsCompletion, dispatchPiCompletion } from '../next/runtime/factLlmService.mjs'
import {
  buildExtractionSource, validateExtractionRows, compileExtractionEntries
} from '../next/fact/usecases/pipeline/extractionChain.js'
import { segmentText } from '../next/fact/domain/segment.js'
import { segmentBlocks } from '../next/fact/usecases/pipeline/blocks.js'
import { BIND_SYSTEM_PROMPT, buildBatchBindPrompt } from '../next/fact/usecases/pipeline/bindPrompt.mjs'
import { bindSegments, normalizeBindReply } from '../next/fact/usecases/pipeline/bindRows.js'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const PROJECT = argOf('--project')
/** 正文目录：默认 <project>/正文，可用 --body 直接指到别处（只读，不往项目里写任何东西）。 */
const BODY_DIR = argOf('--body', PROJECT ? join(PROJECT, '正文') : null)
const CHAPTERS = Number(argOf('--chapters', '10'))
const DATASET = argOf('--dataset', 'blocks')
const LOG_ROOT = argOf('--log', null)
const BATCH = Math.max(1, Number(argOf('--batch', '8')))
const CONCURRENCY = Math.max(1, Number(argOf('--concurrency', '4')))
const FAKE = process.argv.includes('--fake')
const MODEL = argOf('--model', null)

if (!PROJECT || !LOG_ROOT) {
  console.error('用法：node devtools/run-extract-blocks.mjs --project=<目录> --log=<日志目录> [--chapters=10] [--batch=8] [--concurrency=4] [--fake]')
  process.exit(2)
}

/** 真模型调用：默认 dots.ai（关推理已在通道内），可切 Pi 任务面。 */
async function callModel(prompt) {
  if (MODEL === 'pi') return dispatchPiCompletion({ prompt, maxTokens: 8000, timeoutMs: 300_000 })
  return dispatchDotsCompletion({ prompt: `${BIND_SYSTEM_PROMPT}\n\n${prompt}`, maxTokens: 4000, timeoutMs: 180_000 })
}

/** 假模型：完全规则绑定（不调模型），只用来验证 A→C 的工程链路。 */
function fakeBind(segments) {
  return {
    segments: segments.map((segment) => ({
      id: segment.id,
      blocks: segment.blocks.map((block) => ({ id: block.id, who: block.speakerHint ?? '', ch: block.channelHint })),
      settings: [],
      knowledge: [],
      hooks: []
    }))
  }
}

/** 简易并发池：固定并发跑任务，结果按入参顺序回。 */
async function pool(tasks, limit) {
  const results = new Array(tasks.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      results[index] = await tasks[index]()
    }
  })
  await Promise.all(workers)
  return results
}

const log = createExtractionLog({ root: LOG_ROOT })
await log.event('blocks-start', {
  project: PROJECT, dataset: DATASET, chapters: CHAPTERS, batch: BATCH, concurrency: CONCURRENCY,
  fake: FAKE, model: MODEL ?? 'dots', at: new Date().toISOString()
})

const bodyDir = BODY_DIR
let files = []
try {
  files = readdirSync(bodyDir).filter((name) => /\.(md|txt)$/u.test(name)).sort().slice(0, CHAPTERS)
} catch (error) {
  await log.event('blocks-failed', { reason: `正文目录读不到：${error.message}` })
  console.error('正文目录读不到：', bodyDir)
  process.exit(1)
}
if (!files.length) {
  await log.event('blocks-failed', { reason: '正文目录没有 .md 文件' })
  console.error('正文目录没有 .md 文件：', bodyDir)
  process.exit(1)
}

/* ---------- A：切块（零模型） ---------- */

const sources = []
const prepared = []   // [{sourceId, segment:{id,index,chars,text,blocks}}]
let sequence = 0
for (const file of files) {
  const text = readFileSync(join(bodyDir, file), 'utf8')
  // 章号：文件名前缀 "001-" 或 "ch01-" 都能解析；都没有时按枚举序。
  const chapterNo = Number(
    file.match(/^(\d{3})(?!\d)/u)?.[1]
    ?? file.match(/^ch0*(\d+)/iu)?.[1]
    ?? file.match(/^0*(\d+)[-_]/u)?.[1]
    ?? ++sequence
  )
  const source = buildExtractionSource({ id: `正文/${file}`, text, chapterNo })
  sources.push(source)
  const units = segmentText(text)
  await log.event('chapter-start', { file, chapterNo, chars: text.length, segments: units.length })
  for (const unit of units) {
    const meta = source.segments.find((segment) => segment.index === unit.index)
    const { blocks, stats } = segmentBlocks(unit.text)
    prepared.push({
      sourceId: source.id,
      segment: { id: meta.id, index: unit.index, chars: unit.chars, text: unit.text, blocks },
      stats
    })
  }
}
const blockStats = prepared.reduce((acc, item) => {
  acc.segments += 1
  acc.blocks += item.stats.blocks
  acc.quotes += item.stats.quotes
  acc.speakerHints += item.stats.speakerHints
  for (const [channel, count] of Object.entries(item.stats.byChannelHint)) {
    acc.byChannelHint[channel] = (acc.byChannelHint[channel] ?? 0) + count
  }
  return acc
}, { segments: 0, blocks: 0, quotes: 0, speakerHints: 0, byChannelHint: {} })
await log.event('blocks-prepared', blockStats)

/* ---------- B：窄绑定（模型唯一参与的环节，批式＋并发） ---------- */

const batches = []
for (let index = 0; index < prepared.length; index += BATCH) {
  batches.push(prepared.slice(index, index + BATCH))
}
await log.event('batches-planned', { batches: batches.length, batchSize: BATCH, concurrency: CONCURRENCY })

const knownNames = []
const startedAll = Date.now()
const batchResults = await pool(batches.map((batch, batchIndex) => async () => {
  const segments = batch.map((item) => item.segment)
  const prompt = buildBatchBindPrompt({ segments, knownNames, priorNames: [] })
  const startedAt = Date.now()
  let reply = ''
  let usage = null
  let error = null
  let bindings = []
  try {
    if (FAKE) {
      reply = JSON.stringify(fakeBind(segments))
    } else {
      const answer = await callModel(prompt)
      reply = answer.text
      usage = answer.usage ?? null
    }
    const parsed = parseModelReply(reply)
    if (!parsed.ok) throw Object.assign(new Error(parsed.error), { code: parsed.code })
    const normalized = normalizeBindReply(parsed.value)
    if (!normalized.ok) throw Object.assign(new Error('绑定回包形状不对'), { code: normalized.code })
    bindings = normalized.segments
    if (!FAKE) {
      for (const item of bindings) {
        for (const block of item.blocks) if (block.who && !knownNames.includes(block.who)) knownNames.push(block.who)
      }
    }
  } catch (caught) {
    error = caught
  }
  // 局部失败：批里解析不出的段降级为「仅规则绑定」而不是整批丢弃——
  // 旧链路整批报废的放大效应（29/130 行因一行错全灭）在批式下会被放大 N 倍，必须避免。
  const surviving = new Set((bindings ?? []).map((item) => item.id))
  const degraded = batch
    .filter((item) => !surviving.has(item.segment.id))
    .map((item) => item.segment.id)
  await log.call({
    stage: 'bind',
    sourceId: batch[0]?.sourceId ?? '',
    segmentIndex: batch[0]?.segment.index ?? null,
    attempt: 1,
    prompt,
    reply,
    ms: Date.now() - startedAt,
    ok: !error,
    usage,
    error,
    batchIndex,
    segments: batch.map((item) => item.segment.id),
    degraded
  })
  return { bindings, error, degraded }
}), CONCURRENCY)
const totalMs = Date.now() - startedAll

/* ---------- C：回组装（零模型） → 校验 → 编译 ---------- */

const allBindings = []
let bindFailures = 0
for (const result of batchResults) {
  if (result.error) { bindFailures += 1; continue }
  allBindings.push(...result.bindings)
}
const segments = prepared.map((item) => item.segment)
const { rows, stats: bindStats } = bindSegments(segments, allBindings, {
  knownNames,
  when: { story_time: '未明示', timeline: '顺叙' },
  where: '未明示'
})
await log.event('bound', { ...bindStats, bindFailures, batches: batches.length })

const rejected = []
const goodRows = []
// 校验只需要段元数据（id/index/chars/hash）——不能把 text/blocks 递进严格 schema。
const metaById = new Map()
for (const source of sources) {
  for (const meta of source.segments) metaById.set(meta.id, meta)
}
for (const row of rows) {
  const meta = metaById.get(row.segmentId)
  const check = meta
    ? validateExtractionRows([row], [meta])
    : { ok: false, error: { details: [{ field: 'segmentId', message: '未知段' }] } }
  if (check.ok) goodRows.push(check.value[0])
  else rejected.push({ segmentId: row.segmentId, details: check.error.details.slice(0, 6) })
}
await log.event('validated', { rows: rows.length, accepted: goodRows.length, rejected: rejected.length, samples: rejected.slice(0, 5) })

let compiled = null
let compileError = null
try {
  compiled = compileExtractionEntries({ sources, rows: goodRows, domain: DATASET, book: DATASET, bookId: DATASET })
} catch (error) {
  compileError = error
}
await log.event('compiled', compileError
  ? { ok: false, code: compileError.code, message: compileError.message, details: (compileError.details ?? []).slice(0, 10) }
  : {
      ok: true,
      entries: compiled.entries.length,
      byLayer: compiled.entries.reduce((acc, entry) => { acc[entry.layer] = (acc[entry.layer] ?? 0) + 1; return acc }, {}),
      pruning: compiled.pruning,
      mentions: Object.keys(compiled.index?.mentions ?? {}).length
    })

const summary = await log.summarize()
await log.event('blocks-done', { summary, compileOk: !compileError, totalMs })
console.log(JSON.stringify({
  logRoot: LOG_ROOT,
  files: files.length,
  segments: prepared.length,
  batches: batches.length,
  calls: FAKE ? 0 : batches.length,
  blockedStats: blockStats,
  bindStats,
  accepted: goodRows.length,
  rejected: rejected.length,
  compileOk: !compileError,
  entries: compiled?.entries.length ?? 0,
  totalMs,
  summary
}, null, 2))
