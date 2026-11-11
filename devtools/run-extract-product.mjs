/**
 * 产品链路真模型验收（P-1）：走 pinax_extract_* 工具面 + dots.ai 窄绑定。
 *
 * 与 run-extract-blocks.mjs 的区别：那个是**验证驱动**（自己调模型、自己回组装），
 * 这个走**产品工具面**——next 拿块、模型只回绑定、submit 交 bindings、服务端回组装，
 * 证明 agent 侧真的可以「不切句、不写正文、不判批」。
 *
 * 用法：node devtools/run-extract-product.mjs --project=<项目根> --chapters=10 --log=<日志>
 */
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { createRegistry } from '../next/kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../next/kernel/projectSkeleton.mjs'
import { createProject } from '../next/project/createProject.mjs'
import { openProject } from '../next/project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../next/carriers/index.mjs'
import { NOVEL_CARRIER_ID } from '../next/carriers/novel/manifest.mjs'
import { createFactExtractionTools } from '../next/runtime/factExtractionTools.mjs'
import { BIND_SYSTEM_PROMPT, RELATION_SYSTEM_PROMPT, buildRelationPrompt } from '../next/fact/usecases/pipeline/bindPrompt.mjs'
import { dispatchDotsCompletion } from '../next/runtime/factLlmService.mjs'
import { parseModelReply } from './lib/jsonExtract.mjs'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const ROOT = argOf('--project')
const BODY = argOf('--body')
const CHAPTERS = Number(argOf('--chapters', '10'))
const LOG = argOf('--log', null)
if (!ROOT || !BODY || !LOG) {
  console.error('用法：node devtools/run-extract-product.mjs --project=<新建项目根> --body=<正文目录> --log=<日志目录> [--chapters=10]')
  process.exit(2)
}

const logLines = []
async function log(kind, data) {
  const line = JSON.stringify({ at: new Date().toISOString(), kind, ...data })
  logLines.push(line)
  await appendFile(join(LOG, 'events.jsonl'), `${line}\n`, 'utf8')
}
await mkdir(LOG, { recursive: true })
await mkdir(join(LOG, 'prompts'), { recursive: true })
await mkdir(join(LOG, 'replies'), { recursive: true })

/** 每次调用的 prompt/回包全文落盘——真跑出问题时没有回包就无从复盘。 */
let seq = 0
async function dumpRound(prompt, reply) {
  seq += 1
  const name = `${String(seq).padStart(4, '0')}.txt`
  await writeFile(join(LOG, 'prompts', name), prompt, 'utf8')
  await writeFile(join(LOG, 'replies', name), reply, 'utf8')
  return name
}

/* ---------- 建项目并写入正文 ---------- */

const plugins = await loadBuiltInCarrierPlugins()
const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
for (const plugin of plugins) {
  const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
  if (!installed.ok) throw new Error(`载体装载失败：${plugin.manifest?.id} ${JSON.stringify(installed)}`)
}
const created = await createProject({ root: ROOT, name: basename(ROOT), primaryCarrier: NOVEL_CARRIER_ID, registry })
if (!created.ok) throw new Error(`建项目失败：${JSON.stringify(created.error)}`)
const opened = await openProject({ root: ROOT, registry })
if (!opened.ok) throw new Error(`打开项目失败：${JSON.stringify(opened.error)}`)
const { fileService, view } = opened.value
const dir = Object.values(registry.get(NOVEL_CARRIER_ID).dataDirs)[0]

const files = readdirSync(BODY).filter((name) => /\.(md|txt)$/u.test(name)).sort().slice(0, CHAPTERS)
const sources = []
for (const [index, file] of files.entries()) {
  const chapterNo = Number(file.match(/^(\d{3})(?!\d)/u)?.[1] ?? file.match(/^ch0*(\d+)/iu)?.[1] ?? index + 1)
  const text = readFileSync(join(BODY, file), 'utf8')
  const write = await fileService.write({ pluginId: NOVEL_CARRIER_ID, dir, file: `第${String(chapterNo).padStart(3, '0')}章.md`, text, expectedRevision: 0 })
  if (!write.ok) throw new Error(`写正文失败：${JSON.stringify(write.error)}`)
  sources.push({ pluginId: NOVEL_CARRIER_ID, dir, file: write.value?.file ?? `第${String(chapterNo).padStart(3, '0')}章.md`, chapterNo })
}
await log('sources-written', { files: sources.length })

const tools = createFactExtractionTools({ root: ROOT, fileService, registry, view })
const call = async (method, args) => {
  const result = await tools.get(`pinax_extract_${method}`).tool.run(args)
  if (!result.ok) throw new Error(`${method} 失败：${result.error.code} ${result.error.message} ${JSON.stringify(result.error.details ?? null)}`)
  return result.value
}

/* ---------- 走产品工具面 ---------- */

const startedAll = Date.now()
const prepared = await call('prepare', {
  dataset: 'product', requestId: 'product-run', domain: '验收', book: '验收书', sources
})
await log('prepared', { runId: prepared.runId, segments: prepared.segments })

let calls = 0
let promptChars = 0
let completionTokens = 0
let bindStatsTotal = { segments: 0, blocks: 0, bound: 0, hallucinated: 0, ruleFallback: 0, unknownChannel: 0, akaPairs: 0, relations: 0 }
let step = 0
let finalRevision = null
let finished = null
for (let safety = 0; safety < 200; safety += 1) {
  const task = await call('next', { dataset: 'product', runId: prepared.runId })
  if (task.done) {
    finalRevision = task.revision
    break
  }
  step += 1
  // 窄绑定提示词：块清单已由服务端切好，这里只把块交给模型。
  const section = task.units.map((unit) => [
    `=== ${unit.id} | 第 ${unit.index} 段 | ${unit.chars} 字 ===`,
    ...unit.blocks.map((block) => `  [${block.id}] (${block.hint}${block.speakerHint ? ` hint=${block.speakerHint}` : ''}) ${block.text}`),
    '  【增量】settings:[{name,slot,definition}] knowledge:[{character,source,learned}] hooks:[一句话] aka:[[称呼,称呼]] relations:[{from,to,type,how}]'
  ].join('\n'))
  const prompt = [
    BIND_SYSTEM_PROMPT,
    '',
    `共 ${task.units.length} 段。逐段逐块绑定，输出一次 JSON：`,
    '{"segments":[{"id":"段id","blocks":[{"id":"b1","who":"","ch":"state"}],"settings":[],"knowledge":[],"hooks":[],"aka":[],"relations":[]}]}',
    `【已知人物】${(task.knownNames ?? []).join('、') || '(无)'}`,
    '',
    ...section
  ].join('\n')

  const answer = await dispatchDotsCompletion({ prompt, maxTokens: 4000, timeoutMs: 180_000 })
  calls += 1
  promptChars += prompt.length
  completionTokens += answer.usage?.completionTokens ?? 0
  const files = await dumpRound(prompt, answer.text)
  let parsed = parseModelReply(answer.text)
  if (!parsed.ok) {
    // 一次严格重试：把解析错误回喂（与离线重放同一口径），仍失败才判这批报废。
    const retryPrompt = `${prompt}\n\n【上次输出不是合法 JSON】解析错误：${parsed.error}\n重新输出完整且语法正确的 JSON。`
    const retry = await dispatchDotsCompletion({ prompt: retryPrompt, maxTokens: 4000, timeoutMs: 180_000 })
    calls += 1
    completionTokens += retry.usage?.completionTokens ?? 0
    await dumpRound(retryPrompt, retry.text)
    const second = parseModelReply(retry.text)
    if (!second.ok) throw new Error(`第 ${step} 批解析失败（已重试）：${parsed.code} ${parsed.error}｜回包见 ${files}`)
    parsed = second
  }
  const bindings = Array.isArray(parsed.value.segments) ? parsed.value.segments : []
  const submitted = await call('submit', {
    dataset: 'product', runId: prepared.runId, expectedRevision: task.revision,
    taskId: task.taskId, submissionId: `step-${step}`, bindings
  })
  if (submitted.bindStats) {
    for (const key of Object.keys(bindStatsTotal)) bindStatsTotal[key] += submitted.bindStats[key] ?? 0
  }
  await log('step', {
    step, revision: task.revision, units: task.units.length, blocks: task.units.reduce((sum, unit) => sum + unit.blocks.length, 0),
    replyChars: answer.text.length, usage: answer.usage ?? null, bindStats: submitted.bindStats ?? null
  })
}

/* ---------- 关系窄窗（B4）：独立一轮，只问关系 ---------- */
let relationCalls = 0
let relationsLanded = 0
const relationDropped = { missing: 0, hallucinated: 0, self: 0, titleTarget: 0 }
{
  // 找还需要关系的段（已绑定但 relations 为空）
  const statePath = join(ROOT, '.pinax', 'extractions', 'product.json')
  const raw = JSON.parse(readFileSync(statePath, 'utf8'))
  const rows = raw.runs[prepared.runId].rows
  const targets = Object.keys(rows).filter((id) => Array.isArray(rows[id].relations) && rows[id].relations.length === 0).slice(0, 12)
  for (let index = 0; index < targets.length; index += 4) {
    const batch = targets.slice(index, index + 4)
    const relationsBySegment = {}
    for (const id of batch) {
      // finish 之前 current 还是 null：sources 从 run 上读（run.sources 在 prepare 时就已固化）。
      const source = raw.runs[prepared.runId].sources.find((item) => item.segments.some((segment) => segment.id === id))
      const meta = source?.segments.find((segment) => segment.id === id)
      if (!meta) continue
      const prompt = [RELATION_SYSTEM_PROMPT, '', buildRelationPrompt({
        id, index: meta.index, text: (rows[id].events ?? []).map((event) => event.content).join(''), blocks: []
      })].join(String.fromCharCode(10))
      const answer = await dispatchDotsCompletion({ prompt, maxTokens: 1500, timeoutMs: 120_000 })
      relationCalls += 1
      const parsed = parseModelReply(answer.text)
      if (parsed.ok && Array.isArray(parsed.value.relations)) relationsBySegment[id] = parsed.value.relations
      else await dumpRound(prompt, answer.text)
    }
    if (!Object.keys(relationsBySegment).length) continue
    // relationsOnly 不消费新段，所以 revision 用「最后一次绑定的 revision」，
    // 不能调 next（抽完时 next 直接返回 done 且不带 revision）。
    const applied = await call('submit', {
      dataset: 'product', runId: prepared.runId, expectedRevision: finalRevision,
      submissionId: `relations-${index}`, relationsOnly: true,
      segmentIds: Object.keys(relationsBySegment), relationsBySegment
    })
    finalRevision = (applied.revision ?? finalRevision + 1)
    relationsLanded += applied.applied ?? 0
    for (const key of Object.keys(relationDropped)) relationDropped[key] += applied.relationDropped?.[key] ?? 0
    await log('relations', { batch: batch.length, applied: applied.applied, dropped: applied.relationDropped })
  }
}
// 关系补完再 finish（finish 会锁 run，必须最后做）
if (finalRevision !== null) {
  finished = await call('finish', { dataset: 'product', runId: prepared.runId, expectedRevision: finalRevision })
}
const totalMs = Date.now() - startedAll
await log('done', { totalMs, calls, relationCalls, relationsLanded, relationDropped, promptChars, completionTokens, bindStatsTotal, finish: finished })
await writeFile(join(LOG, 'summary.json'), JSON.stringify({
  totalMs, calls, relationCalls, relationsLanded, relationDropped, promptChars, completionTokens, bindStatsTotal, finished
}, null, 2), 'utf8')
console.log(JSON.stringify({
  totalMs, calls, promptChars, completionTokens, bindStatsTotal,
  segments: finished?.segments, extracted: finished?.extracted, resultPath: finished?.resultPath
}, null, 2))
