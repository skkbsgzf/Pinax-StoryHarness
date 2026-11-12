/**
 * 番茄短篇库 · 拆解流水线（作者 2026-11-12：「流程需要固化」）。
 *
 * 一条命令跑完全流程，替代之前散落的四段手工操作：
 *
 *   ① 拆解   run-extract-library  剥头 → 分桶切块 → 模型窄绑定 → 回组装 → 编译
 *   ② 整合   lib/integrate        落库双向引用（入库索引 decompose 字段 + 拆解索引 + 报告）
 *   ②.5 增补  wiki-enrich           章梗概/人物档案/全书梗概（模型窄窗归纳）
 *   ③ Wiki   build-wiki           人物/章节/关系/地点静态页 + 总索引（读增补渲染剧情）
 *
 * 断点续跑：① 每批落盘到 --resume-dir，中断后重跑同一命令即从断点继续。
 * 幂等：② ③ 纯派生重跑无副作用；②.5 重跑覆盖归纳结果。
 *
 * 用法：
 *   node devtools/library-pipeline.mjs --lib=D:/短篇选题库 --books=<id1>,<id2>
 *   node devtools/library-pipeline.mjs --lib=D:/短篇选题库 --all-s          # 全部 S 级未拆的
 *   可选：--batch=8 --timeout=300000 --retries=2 --skip-wiki --skip-extract
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { extractBook } from './run-extract-library.mjs'
import { runIntegrate } from './lib/integrate-decompose.mjs'
import { buildBook } from './build-wiki.mjs'
import { buildWikiIndex } from './build-wiki-index.mjs'
import { enrichBook } from './wiki-enrich-run.mjs'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const LIB = argOf('--lib', 'D:/短篇选题库')
const BOOKS = (argOf('--books', '') || '').split(',').map((item) => item.trim()).filter(Boolean)
const BATCH = Math.max(1, Number(argOf('--batch', '8')))
const TIMEOUT_MS = Number(argOf('--timeout', '300000')) || 300_000
const CALL_RETRIES = Math.max(1, Number(argOf('--retries', '2')))
const RESUME_ROOT = join(LIB, '.resume')
const OUT_DIR = join(LIB, '拆解')
const SKIP_EXTRACT = flag('skip-extract')
const SKIP_WIKI = flag('skip-wiki')
  // Wiki 增补（作者 2026-11-12）：剧情梗概/人物档案需要归纳，默认开；--skip-enrich 跳过
  const SKIP_ENRICH = flag('skip-enrich')

async function loadIndex() {
  const path = join(LIB, '正文', '入库索引.json')
  if (!existsSync(path)) throw new Error(`找不到入库索引：${path}`)
  return JSON.parse(await readFile(path, 'utf8'))
}

async function pickBooks(index) {
  const done = new Set(Object.entries(index).filter(([, book]) => book.decompose?.status === 'ok').map(([id]) => id))
  if (BOOKS.length) return { ids: BOOKS, skipped: [] }
  const list = Object.values(index)
  if (flag('all-s')) {
    return {
      ids: list.filter((book) => book.grade === 'S' && !done.has(book.id)).map((book) => book.id),
      skipped: []
    }
  }
  if (flag('all')) return { ids: list.map((book) => book.id), skipped: [] }
  throw new Error('需要 --books=<id,...> 或 --all / --all-s')
}

async function main() {
  const index = await loadIndex()
  const { ids } = await pickBooks(index)
  if (!ids.length) { console.log('没有待拆解的书'); return }

  // key 由环境提供（PINAX_FACT_LLM_KEY），管线不落盘、不打印
  const pipelineEnv = {
    LIB, BATCH, CALL_RETRIES,
    RESUME_MODE: true,
    RESUME_DIR: ''
  }
  const profile = (await import('../next/fact/usecases/pipeline/extractionProfile.js'))
    .normalizeExtractionProfile('short').value

  await mkdir(OUT_DIR, { recursive: true })
  const startedAll = Date.now()
  const results = []

  for (const id of ids) {
    const book = index[id]
    if (!book) { results.push({ id, error: 'NOT_IN_INDEX' }); continue }
    const resumeDir = join(RESUME_ROOT, id)
    await mkdir(resumeDir, { recursive: true })
    const startedAt = Date.now()
    try {
      // ① 拆解
      const result = SKIP_EXTRACT && existsSync(join(OUT_DIR, `${id}.json`))
        ? JSON.parse(await readFile(join(OUT_DIR, `${id}.json`), 'utf8'))
        : await extractBook(book, index, profile, {
            ...pipelineEnv,
            RESUME_DIR: resumeDir
          })
      await writeFile(join(OUT_DIR, `${id}.json`), JSON.stringify(result, null, 2), 'utf8')

      const byLayer = result.entries.reduce((acc, entry) => { acc[entry.layer] = (acc[entry.layer] ?? 0) + 1; return acc }, {})
      results.push({
        id, title: book.title, words: book.word_count,
        ms: Date.now() - startedAt,
        segments: result.source.segments, blocks: result.source.blocks,
        entries: result.entries.length, byLayer,
        characters: result.entries.filter((entry) => entry.layer === 'character').map((entry) => entry.name),
        relations: result.relationLanded ?? 0,
        hallucinated: result.bindStats?.hallucinated ?? null,
        rejected: result.rejected?.length ?? 0
      })
      console.log(`✓ [${results.length}/${ids.length}] ${book.title}（${book.word_count} 字）→ ${result.entries.length} 条 / ${result.calls} 次调用 / ${Math.round((Date.now() - startedAt) / 1000)}s`)
    } catch (error) {
      results.push({ id, title: book?.title, error: error?.message ?? String(error) })
      console.error(`✗ ${book?.title ?? id}: ${error?.message ?? error}`)
    }
  }

  // ② 整合（全部已拆的书一起重算读数，幂等）
  const integrated = runIntegrate(LIB)

  // ②.5 Wiki 增补（模型窄窗归纳：章梗概/人物档案/全书梗概）——剧情就是从这里来的
  if (!SKIP_ENRICH) {
    for (const id of okIds) {
      const enriched = await enrichBook(id, LIB, { protagonist: null })
      console.log(`  📖 增补 ${enriched.title}: 章梗概 ${enriched.chapterSummaries}/${enriched.chapters}，人物 ${enriched.characters}，全书梗概 ${enriched.storySummary ? '✓' : '✗'}`)
    }
  }

  // ③ Wiki
  const okIds = results.filter((item) => !item.error).map((item) => item.id)
  if (!SKIP_WIKI) {
    for (const id of okIds) buildBook(id)
    buildWikiIndex(LIB)
  }

  const done = integrated.books.filter((book) => okIds.includes(book.id))
  console.log('\n' + JSON.stringify({
    pipeline: { totalMs: Date.now() - startedAll, books: okIds.length },
    integrated: { decomposed: integrated.decomposed, total: integrated.total },
    summary: done.map((book) => ({
      id: book.id, title: book.title, chapters: book.chapters,
      entries: book.entries, characters: book.characters.length,
      traceableRate: book.traceableRate
    }))
  }, null, 2))
}

await main()
