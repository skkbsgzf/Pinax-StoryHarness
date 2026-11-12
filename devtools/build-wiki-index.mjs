import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Wiki 总索引：把多本书的 wiki 串到一个入口页。
 * 只读各书的拆解结果，不重新生成页面。
 */
function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const LIB = argOf('--lib', 'D:/短篇选题库')
const WIKI = join(LIB, 'wiki')

const esc = (value) => String(value ?? '')
  .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')

export function buildWikiIndex(lib = LIB) {
const index = JSON.parse(readFileSync(join(LIB, '正文', '入库索引.json'), 'utf8'))
const books = []

for (const dir of existsSync(WIKI) ? readdirSync(WIKI) : []) {
  const resultPath = join(LIB, '拆解', `${dir}.json`)
  if (!existsSync(resultPath)) continue
  const result = JSON.parse(readFileSync(resultPath, 'utf8'))
  const plots = result.entries.filter((entry) => entry.layer === 'plot')
  const characters = result.entries.filter((entry) => entry.layer === 'character')
  const relations = result.entries.flatMap((entry) => entry.relations ?? [])
  const chapters = [...new Set(plots.map((plot) => plot.validity?.from).filter(Number.isInteger))]
  books.push({
    id: dir,
    title: result.book?.title ?? dir,
    author: result.book?.author ?? '',
    words: result.book?.word_count ?? 0,
    grade: result.book?.grade ?? '',
    group: result.book?.subject_group ?? '',
    url: result.book?.url ?? '',
    plots: plots.length,
    characters: characters.length,
    relations: relations.length,
    chapters: chapters.length,
    traceable: result.quality?.traceableRate ?? null
  })
}

books.sort((left, right) => left.title.localeCompare(right.title, 'zh-Hans-CN'))

const CSS = `
:root { --bg:#12141a; --panel:#1a1d26; --line:#2a2f3d; --text:#e6e8ee; --dim:#9aa3b5; --accent:#7aa2ff; --warm:#ffb454; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
.wrap { max-width:1080px; margin:0 auto; padding:40px 24px 80px; }
h1 { font-size:30px; margin:0 0 6px; }
h2 { font-size:20px; margin:36px 0 12px; padding-bottom:8px; border-bottom:1px solid var(--line); }
.meta { color:var(--dim); font-size:13px; margin-bottom:28px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px; }
.card h3 { margin:0 0 6px; font-size:18px; }
.card .sub { color:var(--dim); font-size:12px; margin-bottom:8px; }
.stat { display:flex; gap:14px; flex-wrap:wrap; margin-top:10px; font-size:12px; color:var(--dim); }
.stat b { color:var(--accent); }
`

const body = `
<h1>番茄短篇 · 世界书 Wiki</h1>
<div class="meta">共 ${books.length} 本 · 全部由拆解数据确定性生成（fact.data/v3），正文事件可逐字溯源到原文</div>
<h2>书目（${books.length}）</h2>
<div class="grid">
${books.map((book) => `<div class="card">
  <h3><a href="${esc(book.id)}/index.html">${esc(book.title)}</a></h3>
  <div class="sub">${esc(book.author)}${book.group ? ` · ${esc(book.group)}` : ''}${book.grade ? ` · ${esc(book.grade)} 级` : ''} · ${book.words.toLocaleString()} 字</div>
  <div class="stat">
    <span><b>${book.chapters}</b> 章</span>
    <span><b>${book.plots}</b> 段</span>
    <span><b>${book.characters}</b> 人物</span>
    <span><b>${book.relations}</b> 关系</span>
    ${book.traceable !== null ? `<span>可溯源 <b>${(book.traceable * 100).toFixed(1)}%</b></span>` : ''}
  </div>
  ${book.url ? `<div class="sub" style="margin-top:8px"><a href="${esc(book.url)}">番茄原文 →</a></div>` : ''}
</div>`).join('')}
</div>
<h2>说明</h2>
<ul style="color:var(--dim);line-height:1.9">
  <li>每本书内部有：总览页、人物页（台词/行为取自原文，不是概括）、章节页（逐段事件）、关系图谱。</li>
  <li>数据来自三段式抽取管线：确定性切块 → 模型窄绑定（只给 who/ch）→ 确定性回组装。</li>
  <li>「可溯源」＝事件正文能在原书里逐字找到的比例；两本均在 99% 以上。</li>
  <li>纯静态 HTML，无外部依赖，双击即可打开。</li>
</ul>
`

writeFileSync(join(WIKI, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>番茄短篇 · 世界书 Wiki</title><style>${CSS}</style></head>
<body><div class="wrap">${body}</div></body></html>`, 'utf8')

  return { root: WIKI, books: books.map((book) => ({ id: book.id, title: book.title, chapters: book.chapters, characters: book.characters })) }

}

if (process.argv[1] && process.argv[1].endsWith('build-wiki-index.mjs')) {
  const result = buildWikiIndex(LIB)
  console.log(JSON.stringify(result, null, 2))
}