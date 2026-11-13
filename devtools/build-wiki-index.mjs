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

const LIB = argOf('--lib', 'D:/Qbook/短篇选题库')
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
/* 书库索引（与单书 wiki 同一套编辑设计语言） */
:root {
  --paper:#fbfcfe; --surface:#ffffff; --surface-warm:#eef6ff; --ink:#0b1220; --ink-2:#334155;
  --muted:#64748b; --hairline:rgba(15,23,42,.07); --accent:#0c5cab; --accent-2:#0ea5e9;
  --warn:#f59e0b; --success:#10b981; --danger:#ef4444;
  --shadow-1:0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06);
  --shadow-2:0 4px 12px rgba(15,23,42,.06), 0 12px 32px rgba(15,23,42,.05);
  --serif:"Songti SC","Noto Serif SC","Source Han Serif SC",Georgia,serif;
}
* { box-sizing:border-box; }
body { margin:0; color:var(--ink); font:15px/1.7 Inter,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
  background: radial-gradient(1100px 460px at 8% -8%, rgba(14,165,233,.10), transparent 62%),
              radial-gradient(900px 420px at 96% 2%, rgba(245,158,11,.07), transparent 60%), var(--paper); }
a { color:var(--accent); text-decoration:none; transition:color .15s ease; } a:hover { text-decoration:underline; }
.wrap { max-width:1180px; margin:0 auto; padding:36px 24px 90px; }

/* 页头主视觉 */
.libhero { position:relative; overflow:hidden; border-radius:20px; padding:36px 36px 32px; margin-bottom:22px;
  background:linear-gradient(135deg,#0b1220 0%,#132441 48%,#1c3a63 100%); color:#eef4ff; box-shadow:var(--shadow-2); }
.libhero::after { content:""; position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(620px 300px at 88% 8%,rgba(122,162,255,.32),transparent 66%),
             radial-gradient(520px 260px at 6% 96%,rgba(255,180,84,.18),transparent 68%); }
.libhero > * { position:relative; z-index:1; }
.libhero .eyebrow { font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:#8fb0e8; margin-bottom:10px; }
.libhero h1 { font-family:var(--serif); font-size:36px; margin:0 0 12px; font-weight:700; color:#fff; letter-spacing:-.01em; }
.libhero .lede { color:#c3d6f4; font-size:14.5px; max-width:76ch; line-height:1.75; }
.libhero .kpis { display:flex; gap:30px; flex-wrap:wrap; margin-top:22px; }
.libhero .kpis div b { display:block; font-family:var(--serif); font-size:29px; color:#fff; line-height:1.15; font-variant-numeric:tabular-nums; }
.libhero .kpis div span { font-size:11.5px; color:#9db6dc; letter-spacing:.06em; }

h2 { font-size:18px; margin:34px 0 14px; padding:0 0 10px 14px; border-bottom:1px solid var(--hairline); position:relative; font-weight:700; }
h2::before { content:""; position:absolute; left:0; top:4px; width:3px; height:15px; border-radius:2px;
  background:linear-gradient(180deg,var(--accent-2),color-mix(in srgb,var(--accent-2) 30%,transparent)); }
.meta { color:var(--muted); font-size:13px; margin-bottom:26px; }

/* 筛选条 */
.filters { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 16px; }
.filters button { font:inherit; font-size:12.5px; padding:6px 14px; border-radius:999px; cursor:pointer;
  border:1px solid var(--hairline); background:var(--surface); color:var(--ink-2); transition:all .15s ease; }
.filters button:hover { border-color:color-mix(in srgb,var(--accent-2) 40%,var(--hairline)); color:var(--accent); }
.filters button.on { background:var(--ink); color:#fff; border-color:var(--ink); }

/* 书卡网格 */
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(304px,1fr)); gap:16px; }
.card { position:relative; overflow:hidden; background:var(--surface); border:1px solid var(--hairline);
  border-radius:16px; padding:20px 20px 18px; box-shadow:var(--shadow-1);
  transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
.card:hover { transform:translateY(-3px); box-shadow:0 10px 28px rgba(15,23,42,.10), 0 2px 6px rgba(15,23,42,.06); border-color:color-mix(in srgb,var(--accent-2) 30%,var(--hairline)); }
.card::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px;
  background:linear-gradient(180deg,var(--accent-2),transparent); opacity:.65; }
.card .grade { position:absolute; right:14px; top:14px; font-size:11px; font-weight:700; letter-spacing:.06em;
  padding:2px 9px; border-radius:999px; }
.g-S { background:color-mix(in srgb,var(--danger) 12%,transparent); color:var(--danger); }
.g-A { background:color-mix(in srgb,var(--warn) 14%,transparent); color:#b45309; }
.g-B { background:color-mix(in srgb,var(--accent-2) 12%,transparent); color:var(--accent); }
.g-C { background:color-mix(in srgb,var(--muted) 12%,transparent); color:var(--muted); }
.card h3 { margin:0 26px 6px 0; font-family:var(--serif); font-size:18px; font-weight:700; line-height:1.35; letter-spacing:-.005em; }
.card h3 a { color:var(--ink); } .card h3 a:hover { color:var(--accent); text-decoration:none; }
.card .sub { color:var(--muted); font-size:12px; margin-bottom:10px; }
.stat { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
.stat span { font-size:11.5px; color:var(--ink-2); background:color-mix(in srgb,var(--accent-2) 7%,var(--paper));
  border:1px solid var(--hairline); border-radius:8px; padding:3px 9px; }
.stat b { color:var(--ink); font-variant-numeric:tabular-nums; font-weight:650; }
.card .foot { margin-top:12px; font-size:11.5px; color:var(--muted); display:flex; justify-content:space-between; gap:10px; }

/* 说明区 */
.notes { background:var(--surface); border:1px solid var(--hairline); border-radius:14px; padding:18px 22px; box-shadow:var(--shadow-1); }
.notes ul { color:var(--ink-2); line-height:1.95; margin:0; padding-left:18px; font-size:13.5px; }
.notes code { background:var(--surface-warm); padding:1px 6px; border-radius:5px; font-size:12px; }
`

// 统计（封面用）
const totalWords = books.reduce((sum, book) => sum + (book.words || 0), 0)
const totalChars = books.reduce((sum, book) => sum + book.characters, 0)
const totalRelations = books.reduce((sum, book) => sum + book.relations, 0)
const gradeCounts = books.reduce((acc, book) => { acc[book.grade || '—'] = (acc[book.grade || '—'] ?? 0) + 1; return acc }, {})
const avgTrace = books.filter((book) => book.traceable !== null)
const avgTraceValue = avgTrace.length ? avgTrace.reduce((sum, book) => sum + book.traceable, 0) / avgTrace.length : null

const body = `
<section class="libhero">
  <div class="eyebrow">Pinax · 番茄短篇 · World Library</div>
  <h1>世界书书库</h1>
  <div class="lede">全部由拆解数据确定性生成（fact.data/v3 ＋ 六槽位增补）。事件正文逐字溯源到原文，人物/事件/场景/道具四类知识节点带权重入图——既供人读，也供推演与 RAG 检索。</div>
  <div class="kpis">
    <div><b>${books.length}</b><span>已拆解书目</span></div>
    <div><b>${(totalWords / 10000).toFixed(1)}万</b><span>累计字数</span></div>
    <div><b>${totalChars}</b><span>人物条目</span></div>
    <div><b>${totalRelations}</b><span>关系边</span></div>
    <div><b>${avgTraceValue !== null ? (avgTraceValue * 100).toFixed(1) + '%' : '—'}</b><span>平均可溯源</span></div>
  </div>
</section>
<div class="meta">${Object.entries(gradeCounts).sort().map(([grade, count]) => `${grade} 级 ${count} 本`).join(' · ')}</div>
<div class="filters" id="filters">
  <button class="on" data-grade="">全部 ${books.length}</button>
  ${Object.entries(gradeCounts).sort().map(([grade, count]) => `<button data-grade="${esc(grade)}">${esc(grade)} 级 ${count}</button>`).join('')}
</div>
<h2>书目（${books.length}）</h2>
<div class="grid" id="grid">
${books.map((book) => `<article class="card" data-grade="${esc(book.grade || '')}">
  ${book.grade ? `<span class="grade g-${esc(book.grade)}">${esc(book.grade)}</span>` : ''}
  <h3><a href="${esc(book.id)}/index.html">${esc(book.title)}</a></h3>
  <div class="sub">${esc(book.author)}${book.group ? ` · ${esc(book.group)}` : ''} · ${book.words.toLocaleString()} 字</div>
  <div class="stat">
    <span><b>${book.chapters}</b> ${book.group && /超短篇/.test(book.group) ? '节' : '章'}</span>
    <span><b>${book.plots}</b> 段</span>
    <span><b>${book.characters}</b> 人物</span>
    <span><b>${book.relations}</b> 关系</span>
    ${book.traceable !== null ? `<span>可溯源 <b>${(book.traceable * 100).toFixed(1)}%</b></span>` : ''}
  </div>
  <div class="foot"><span>${book.url ? `<a href="${esc(book.url)}" target="_blank" rel="noreferrer">番茄原文 ↗</a>` : ''}</span><span>世界书 →</span></div>
</article>`).join('')}
</div>
<h2>说明</h2>
<div class="notes"><ul>
  <li>每本书是单页数据面板：侧边导航切换 概览仪表盘／拆解报告（六槽位）／章节大纲／人物矩阵／时间线／关系图谱／伏笔；人物名与词条名全程可点击互跳。</li>
  <li>管线：确定性切块 → 模型窄绑定（只给 who/ch）→ 确定性回组装 → 六槽位增补（结构选型/文风九维/动机弧光/状态台账/世界要素）。</li>
  <li>「可溯源」＝事件正文能在原书逐字找到的比例（全库 ${avgTraceValue !== null ? (avgTraceValue * 100).toFixed(1) : '—'}%）。</li>
  <li>纯静态 HTML，零外部依赖，双击即开。</li>
</ul></div>
<script>
(function () {
  var buttons = Array.prototype.slice.call(document.querySelectorAll('#filters button'));
  var cards = Array.prototype.slice.call(document.querySelectorAll('#grid .card'));
  buttons.forEach(function (button) {
    button.onclick = function () {
      buttons.forEach(function (other) { other.classList.remove('on'); });
      button.classList.add('on');
      var grade = button.dataset.grade || '';
      cards.forEach(function (card) {
        card.style.display = (!grade || card.dataset.grade === grade) ? '' : 'none';
      });
    };
  });
})();
</script>
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