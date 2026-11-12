/**
 * 离线重编译：用已落盘的断点绑定（.resume）重新编译拆解结果，不调模型。
 *
 * 为什么：真跑 267 段要 50+ 次调用，上游一超时整轮就白跑；
 * 而 compile 逻辑（章号、关系、剪枝）改过之后，绑定数据本身不需要重抽。
 * 这个脚本就是把「已有绑定 + 新代码」重新走一遍 C 段。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { segmentText } from '../next/fact/domain/segmentBuckets.js'
import { segmentBlocks } from '../next/fact/usecases/pipeline/blocks.js'
import { bindSegments } from '../next/fact/usecases/pipeline/bindRows.js'
import { buildExtractionSource, validateExtractionRows, compileExtractionEntries } from '../next/fact/usecases/pipeline/extractionChain.js'
import { normalizeExtractionProfile } from '../next/fact/usecases/pipeline/extractionProfile.js'
import { collectNameCandidates } from '../next/fact/usecases/pipeline/nameCandidates.js'
import { detectPerspective, isIdentityTitle } from '../next/fact/usecases/pipeline/perspectiveTitles.js'
import { detectFirstPersonProtagonist, normalizeVocativeToName } from '../next/fact/usecases/pipeline/protagonistDetect.js'

const LIB = 'D:/短篇选题库'
const id = process.argv[2]
const resumeDir = process.argv[3]
if (!id || !resumeDir) {
  console.error('用法：node recompile-from-resume.mjs <book_id> <resume_dir>')
  process.exit(1)
}

const index = JSON.parse(readFileSync(join(LIB, '正文', '入库索引.json'), 'utf8'))
const book = index[id]
if (!book) throw new Error(`索引里没有 ${id}`)

function stripLibraryFile(text) {
  const raw = String(text ?? '')
  const sep = raw.indexOf('========================================')
  let body = sep >= 0 ? raw.slice(sep + 40) : raw
  const end = body.lastIndexOf('（完）')
  if (end > 0) body = body.slice(0, end)
  return body.replace(/-{10,}/gu, '').trim()
}

const body = stripLibraryFile(readFileSync(join(LIB, '正文', book.file), 'utf8'))
const profile = normalizeExtractionProfile('short').value
const source = buildExtractionSource({
  id: `正文/${book.file}`, text: body, chapterNo: 1, segment: profile.segment
})
const units = segmentText(body, profile.segment)
const nameCandidates = collectNameCandidates(body)
const perspective = detectPerspective(body)
const detected = detectFirstPersonProtagonist(body, nameCandidates)
const protagonist = detected.name ? normalizeVocativeToName(detected.name, nameCandidates).name : null

// 段 ↔ 块
const segments = units.map((unit) => {
  const meta = source.segments.find((item) => item.index === unit.index)
  const { blocks } = segmentBlocks(unit.text, { ...profile.blocks })
  return { id: meta.id, index: unit.index, chars: unit.chars, text: unit.text, blocks, chapterNo: unit.chapterNo }
})

// 读回断点绑定
const bindings = []
const knownNames = []
let covered = 0
for (const name of readdirSync(resumeDir).filter((item) => item.startsWith('bindings-')).sort()) {
  const saved = JSON.parse(readFileSync(join(resumeDir, name), 'utf8'))
  for (const item of saved.bindings) {
    // 只保留这次分段里还存在的段（防分段口径变化导致错位）
    if (segments.some((segment) => segment.id === item.id)) {
      bindings.push(item)
      covered += 1
    }
  }
  for (const who of saved.knownNames ?? []) if (!knownNames.includes(who)) knownNames.push(who)
}

console.log(`读回 ${bindings.length} 段绑定（覆盖 ${covered}/${segments.length}）`)
const { rows, stats } = bindSegments(segments, bindings, { knownNames, nameCandidates, protagonist, perspective })
const accepted = []
const rejected = []
for (const row of rows) {
  const meta = source.segments.find((item) => item.id === row.segmentId)
  const check = meta
    ? validateExtractionRows([row], [meta])
    : { ok: false, error: { details: [{ field: 'segmentId', message: '未知段' }] } }
  if (check.ok) accepted.push(check.value[0])
  else rejected.push({ segmentId: row.segmentId, details: check.error.details.slice(0, 3) })
}

const compiled = compileExtractionEntries({
  sources: [source], rows: accepted,
  domain: book.subject_group || '短篇', book: book.title, bookId: book.id,
  minimal: true, policy: profile.salience
})

const chapters = [...new Set(compiled.entries.filter((entry) => entry.layer === 'plot').map((entry) => entry.validity?.from))].filter(Number.isInteger).sort((a, b) => a - b)
const out = {
  book: {
    id: book.id, title: book.title, author: book.author,
    subject_group: book.subject_group, grade: book.grade,
    word_count: book.word_count, read_count: book.read_count,
    length_tier: book.length_tier, url: book.url
  },
  source: { file: book.file, chars: body.length, segments: segments.length, blocks: segments.reduce((sum, item) => sum + item.blocks.length, 0) },
  perspective: { perspective: perspective.perspective, confidence: perspective.confidence },
  protagonist,
  calls: 0,
  recompiledFrom: { resumeDir, batches: readdirSync(resumeDir).filter((item) => item.startsWith('bindings-')).length },
  bindStats: stats,
  relationCalls: 0,
  relationLanded: 0,
  relationDropped: { missing: 0, hallucinated: 0, self: 0, titleTarget: 0, pronoun: 0 },
  relationFailures: [],
  accepted: accepted.length,
  rejected,
  entries: compiled.entries,
  index: compiled.index,
  pruning: compiled.pruning,
  extractor: 'fact-chain/v1'
}
writeFileSync(join(LIB, '拆解', `${id}.json`), JSON.stringify(out, null, 2), 'utf8')

console.log(JSON.stringify({
  id, title: book.title, segments: segments.length, accepted: accepted.length, rejected: rejected.length,
  entries: compiled.entries.length,
  byLayer: compiled.entries.reduce((acc, entry) => { acc[entry.layer] = (acc[entry.layer] ?? 0) + 1; return acc }, {}),
  chapters: chapters.length, chapterRange: chapters.length ? [chapters[0], chapters[chapters.length - 1]] : [],
  characters: compiled.entries.filter((entry) => entry.layer === 'character').map((entry) => entry.name)
}, null, 2))
