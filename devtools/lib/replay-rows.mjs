/**
 * 离线重放：从已有的 calls.jsonl + replies/ 重建行并重新校验编译（不重跑模型）。
 * 用途：修了 schema/归一逻辑后，验「这批回包现在能不能过」，不必花 token 重跑。
 * 用法：node devtools/lib/replay-rows.mjs <run目录> <项目正文目录> <dataset>
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseModelReply } from './jsonExtract.mjs'
import { buildExtractionSource, validateExtractionRows, compileExtractionEntries } from '../../next/fact/usecases/pipeline/extractionChain.js'

const [runDir, bodyDir, dataset] = process.argv.slice(2)
if (!runDir || !bodyDir) {
  console.error('用法：node devtools/lib/replay-rows.mjs <run目录> <正文目录> [dataset]')
  process.exit(2)
}
const rowsMeta = readFileSync(join(runDir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
const sources = []
const sourceByName = new Map()
for (const file of readdirSync(bodyDir).filter((name) => name.endsWith('.md')).sort()) {
  const text = readFileSync(join(bodyDir, file), 'utf8')
  const chapterNo = Number(file.match(/^(\d{3})/u)?.[1] ?? sources.length + 1)
  const source = buildExtractionSource({ id: `正文/${file}`, text, chapterNo })
  sources.push(source)
  sourceByName.set(`正文/${file}`, source)
}

const rows = []
const rejected = []
for (const meta of rowsMeta) {
  if (!meta.replyFile) continue
  let reply = ''
  try { reply = readFileSync(join(runDir, meta.replyFile), 'utf8') } catch { continue }
  const parsedResult = parseModelReply(reply)
  if (!parsedResult.ok) { rejected.push({ seq: meta.seq, code: parsedResult.code }); continue }
  const source = sourceByName.get(meta.sourceId)
  const segMeta = source?.segments.find((segment) => segment.index === meta.segmentIndex)
  if (!segMeta) { rejected.push({ seq: meta.seq, code: 'SEGMENT_NOT_FOUND' }); continue }
  const parsed = { ...parsedResult.value, segmentId: segMeta.id }
  const check = validateExtractionRows([parsed], [segMeta])
  if (!check.ok) { rejected.push({ seq: meta.seq, code: 'ROW_INVALID', details: check.error.details.slice(0, 3).map((d) => `${d.field}: ${d.message}`) }); continue }
  rows.push(check.value[0])
}

console.log(`回包 ${rowsMeta.length} | 解析+校验通过 ${rows.length} | 拒 ${rejected.length}`)
if (rejected.length) {
  const codes = {}
  for (const item of rejected) codes[item.code] = (codes[item.code] ?? 0) + 1
  console.log('拒因:', codes)
  for (const item of rejected.filter((r) => r.code === 'ROW_INVALID').slice(0, 3)) console.log('  样本:', item.details.join(' | '))
}
if (rows.length && dataset) {
  try {
    const compiled = compileExtractionEntries({ sources, rows, domain: dataset, book: dataset, bookId: dataset })
    console.log(`编译 OK: 条目 ${compiled.entries.length} | 分层 ${JSON.stringify(compiled.entries.reduce((a, e) => { a[e.layer] = (a[e.layer] ?? 0) + 1; return a }, {}))}`)
    console.log('剪枝:', JSON.stringify(compiled.pruning.byTier), '剪掉', compiled.pruning.pruned)
  } catch (error) {
    console.log('编译失败:', error.code, String(error.message).slice(0, 100))
    console.log('  详情:', JSON.stringify((error.details ?? []).slice(0, 4)))
  }
}
