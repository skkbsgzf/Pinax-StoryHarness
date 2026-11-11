/**
 * 10 章抽取实跑驱动（P-LLM 落地验证，作者 2026-11-11「真实跑 10 章、留好日志、缺啥补啥」）。
 *
 * 这一层不在产品链路里，是**验证驱动**：
 *   · 它把「项目正文 → 分段 → 逐段调模型 → 校验 → 编译 → 落库 → flush」整条链串起来；
 *   · 产品里这条链由工具面 + 模型 Agent 协作完成（service 不持有 LLM，见 factExtractionService）；
 *   · 此驱动让「一次跑 10 章」可复现、可留痕，不必手工拼工具调用。
 *
 * 日志（作者要求「中途留好日志」）：每个模型的 prompt/回包全文 + 每次调用读数 + 阶段事件，
 * 全部落在 <logRoot>/{calls.jsonl,prompts/,replies/,events.jsonl}，跑完可离线复盘。
 *
 * 用法：
 *   node devtools/run-extract-batch.mjs --project=<项目目录> --chapters=10 \
 *     --dataset=<数据集名> --log=<日志目录> [--fake] [--limit-chars=300]
 *
 *   --fake   用确定性假模型（不调真实模型）——验证工程链路用；产出会标注 fake:true
 *
 * 诚实边界（写在最前面，避免误读）：
 *   · 假模型的产物**不是抽取质量证据**，只证明「链路通」；
 *   · 真模型产物才用于质量评估（S1–S5 判据）；
 *   · 任何一步失败都如实落日志，不静默降级。
 */
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { createExtractionLog } from '../next/runtime/extractionLog.mjs'
import { dispatchPiCompletion } from '../next/runtime/factLlmService.mjs'
import {
  buildExtractionSource, validateExtractionRows, compileExtractionEntries, EXTRACTION_ROW_SCHEMA
} from '../next/fact/usecases/pipeline/extractionChain.js'
import { segmentText } from '../next/fact/domain/segment.js'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const PROJECT = argOf('--project')
const CHAPTERS = Number(argOf('--chapters', '10'))
const DATASET = argOf('--dataset', 'batch')
const LOG_ROOT = argOf('--log', null)
const FAKE = process.argv.includes('--fake')
const LIMIT_CHARS = Number(argOf('--limit-chars', '0')) || 0

if (!PROJECT || !LOG_ROOT) {
  console.error('用法：node devtools/run-extract-batch.mjs --project=<目录> --log=<日志目录> [--chapters=10] [--dataset=x] [--fake]')
  process.exit(2)
}

/* ---------- 假模型：确定性，只用于验证链路 ---------- */

function fakeExtract(text, segment) {
  // 极简启发式：抓「人名＋动作」，够 schema 校验通过即可。**不追求质量**。
  const names = [...new Set([...text.matchAll(/([一-龥]{2,4})(?=说|道|问|看|走|站|坐|抬|转|笑|叹)/gu)].map((m) => m[1]))].slice(0, 4)
  const who = names.length ? names : ['无名氏']
  const contents = text.split(/[。！？\n]+/u).map((line) => line.trim()).filter(Boolean).slice(0, 4)
  const events = contents.map((content, index) => ({
    who: who[index % who.length],
    channel: index % 3 === 0 ? 'do' : index % 3 === 1 ? 'feel' : 'say',
    content: content.slice(0, 40)
  }))
  if (!events.length) events.push({ who: who[0], channel: 'do', content: '静立无语' })
  return JSON.stringify({
    segmentId: segment.id,
    who,
    when: { story_time: '未明示', timeline: '顺叙' },
    where: '未明示',
    events,
    notes: contents[0]?.slice(0, 60) ?? '',
    characters: who.map((name) => ({
      name,
      aliases: [],
      identity: `${name}（${DATASET} 假模型占位身份）`,
      traits: [],
      speech: [],
      behavior: events.filter((event) => event.who === name).map((event) => event.content).slice(0, 3)
    })),
    settings: [],
    relations: [],
    knowledge: [],
    hooks: contents.slice(0, 2)
  })
}

/* ---------- 真模型调用：走 Pi 任务面 ---------- */

const EXTRACT_SYSTEM = [
  '你是小说拆书师。读一个 100–300 字的片段，把它读成结构化 JSON。',
  '只输出 JSON，不解释。字段必须严格符合给定 schema：',
  JSON.stringify({
    segmentId: '片段 id（原样回填）',
    who: ['人物名'],
    when: { story_time: '故事内时间或"未明示"', timeline: '顺叙|倒叙|插叙' },
    where: '地点',
    events: [{ who: '人物名', channel: 'do|say|think|feel|perceive|state|event', content: '短语10-25字' }],
    notes: '补充信息',
    characters: [{ name: '人物名', aliases: [], identity: '身份', traits: [], speech: [], behavior: [] }],
    settings: [{ name: '设定名', slot: '11 槽之一', definition: '定义', aliases: [] }],
    relations: [{ from: '实体名', to: '实体名', type: '关系性质', how: '依据' }],
    knowledge: [{ character: '谁', source: '知情来源实体名', learned: '一句话学到了什么' }],
    hooks: ['伏笔一句话']
  }),
  '要求：who 只收真实出现的人物；events 按原文先后；同角色同 channel 最多 2 条；不编造原文没有的信息。'
].join('\n')

async function realExtract(prompt) {
  const answer = await dispatchPiCompletion({ prompt, timeoutMs: 180_000 })
  return answer.text
}

/* ---------- 主流程 ---------- */

const log = createExtractionLog({ root: LOG_ROOT })
await log.event('batch-start', {
  project: PROJECT, dataset: DATASET, chapters: CHAPTERS, fake: FAKE,
  limitChars: LIMIT_CHARS || null, at: new Date().toISOString()
})

const bodyDir = join(PROJECT, '正文')
let files = []
try {
  files = readdirSync(bodyDir).filter((name) => name.endsWith('.md')).sort().slice(0, CHAPTERS)
} catch (error) {
  await log.event('batch-failed', { reason: `正文目录读不到：${error.message}` })
  console.error('正文目录读不到：', bodyDir)
  process.exit(1)
}
if (!files.length) {
  await log.event('batch-failed', { reason: '正文目录没有 .md 文件' })
  console.error('正文目录没有 .md 文件：', bodyDir)
  process.exit(1)
}
await log.event('chapters-found', { files, count: files.length })

const sources = []
const rows = []
let sequence = 0
for (const file of files) {
  const text = readFileSync(join(bodyDir, file), 'utf8')
  const chapterNo = Number(file.match(/^(\d{3})/u)?.[1] ?? ++sequence)
  const source = buildExtractionSource({ id: `正文/${file}`, text, chapterNo })
  sources.push(source)
  const units = segmentText(text)
  await log.event('chapter-start', { file, chapterNo, chars: text.length, segments: units.length })
  for (const unit of units) {
    const meta = source.segments.find((segment) => segment.index === unit.index)
    const prompt = [
      `【片段 id】${meta.id}`,
      `【第 ${chapterNo} 章 段 ${unit.index}（${unit.chars} 字）】`,
      unit.text,
      '',
      EXTRACT_SYSTEM
    ].join('\n')
    const startedAt = Date.now()
    let reply = ''
    let error = null
    try {
      reply = FAKE ? fakeExtract(unit.text, meta) : await realExtract(prompt)
    } catch (caught) {
      error = caught
    }
    const ms = Date.now() - startedAt
    let parsed = null
    if (!error) {
      const match = /\{[\s\S]*\}/u.exec(reply)
      if (!match) error = Object.assign(new Error('回包里找不到 JSON 对象'), { code: 'REPLY_NO_JSON' })
      else {
        try {
          parsed = JSON.parse(match[0])
          // segmentId 强制回填（模型常写错）
          parsed.segmentId = meta.id
        } catch (caught) {
          error = Object.assign(caught, { code: 'REPLY_BAD_JSON' })
        }
      }
    }
    await log.call({
      stage: 'extract',
      sourceId: `正文/${file}`,
      segmentIndex: unit.index,
      prompt,
      reply,
      ms,
      ok: !error,
      usage: null, // 假模型无 usage；真模型 dispatchPiCompletion 会回（此驱动暂不拆）
      error
    })
    if (parsed) {
      const check = validateExtractionRows([parsed], [meta])
      if (check.ok) rows.push(check.value[0])
      else {
        await log.event('row-invalid', { sourceId: `正文/${file}`, segmentIndex: unit.index, details: check.error.details.slice(0, 8) })
      }
    }
  }
  await log.event('chapter-done', { file, chapterNo, rows: rows.length })
}

await log.event('rows-collected', { rows: rows.length, sources: sources.length })

let compiled = null
let compileError = null
try {
  compiled = compileExtractionEntries({ sources, rows, domain: DATASET, book: DATASET, bookId: DATASET })
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
      mentions: Object.keys(compiled.index.mentions ?? {}).length
    })

const summary = await log.summarize()
await log.event('batch-done', { summary, compileOk: !compileError })
console.log(JSON.stringify({ logRoot: LOG_ROOT, files: files.length, rows: rows.length, compileOk: !compileError, summary }, null, 2))
