/**
 * 全库重建 Wiki（批量拆解跑完后统一重建）。
 *
 * 只重建 wiki 层（不做拆解/enrich）：读全库已拆解 JSON，重建每本书的单页面板＋总索引。
 * 用法：node devtools/rebuild-all-wiki.mjs [--lib=…]
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildBook, resolveDesignSystem } from './build-wiki.mjs'
import { buildWikiIndex } from './build-wiki-index.mjs'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const LIB = argOf('--lib', 'D:/Qbook/短篇选题库')
const DIR = join(LIB, '拆解')

const ids = readdirSync(DIR)
  .filter((name) => /^\d+\.json$/.test(name))
  .map((name) => name.replace(/\.json$/, ''))
  .filter((id) => {
    try {
      const data = JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8'))
      return Array.isArray(data.entries) && data.entries.some((entry) => entry.layer === 'plot')
    } catch { return false }
  })

console.log(`重建 ${ids.length} 本 wiki…`)
const ds = await resolveDesignSystem()
console.log(`设计系统：${ds.source}`)
const results = []
const failures = []
for (const [index, id] of ids.entries()) {
  try {
    const built = buildBook(id, ds)
    results.push(built)
    console.log(`[${index + 1}/${ids.length}] ✓ ${built.title}（${built.chapters} 章/${built.characters} 人/${built.relations} 边，${(built.bytes / 1024).toFixed(0)}KB）`)
  } catch (error) {
    failures.push({ id, error: String(error?.message ?? error) })
    console.error(`[${index + 1}/${ids.length}] ✗ ${id}: ${error?.message ?? error}`)
  }
}
const index = buildWikiIndex(LIB)
console.log(`\n完成：${results.length} 本成功${failures.length ? `，${failures.length} 本失败` : ''}；总索引 ${index.books.length} 本`)
if (failures.length) console.log(JSON.stringify(failures, null, 1))
