/**
 * 世界书 Wiki 生成器 v2（作者 2026-11-12 裁定：对齐原版 detail_data 结构）。
 *
 * 作者原话：「你再看看原版到底是怎么做的呀，有明确的每一章的大纲拆解，还有一些时间线吧，
 * 这些都是基于 fact 去做的。」
 *
 * 对齐 NovelPedia build_detail.py 的 detail_data.json 结构：
 *   chapters  : [{no,title}]                                  章目录（标题从原文提取）
 *   outlines  : [{no,title,summary,chars,foreshadow,newChars}] 章纲（每章大纲拆解）
 *   timeline  : [{no,events:[…]}]                              时间线（事件按章序归并）
 *   characters: 人物画像（identity/personality/summary 来自增补，言行逐字取自原文）
 *   charGraph : 关系图谱
 *
 * 数据源：拆解 JSON（fact.data/v3 条目 + wiki 增补字段）。
 * 全部确定性派生；梗概/身份来自模型窄窗归纳（wiki-enrich），缺了退回原文拼接。
 *
 * 输出：wiki/<id>/ 下静态 HTML（index / outline / timeline / person-* / relations），零依赖。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const LIB = argOf('--lib', 'D:/短篇选题库')
const OUT_ROOT = join(LIB, 'wiki')
const ids = process.argv.slice(2).filter((item) => !item.startsWith('--'))

const esc = (value) => String(value ?? '')
  .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')

/** 章标题：从原文提取（「第1章 相亲」）。无章节标记的书返回空表。 */
const CHAPTER_TITLE_LINE = /^[ \t　]*(第\s*\d+\s*章[^\n]*)$/gmu

function chapterTitlesFromSource(text) {
  const map = new Map()
  for (const match of String(text ?? '').matchAll(CHAPTER_TITLE_LINE)) {
    const number = /^第\s*(\d+)\s*章/u.exec(match[1])
    if (number) map.set(Number(number[1]), match[1].trim())
  }
  return map
}

/** 人物派生：言行逐字 + 增补档案（identity/personality/summary）。 */
function deriveCharacter(entry, plots, profile) {
  const name = entry.name
  const aliases = entry.aliases ?? []
  const allNames = [name, ...aliases]
  const involved = plots.filter((plot) => {
    if ((plot.who ?? []).some((who) => allNames.includes(who))) return true
    return (plot.events ?? []).some((event) => allNames.includes(event.who))
  })
  const chapters = [...new Set(involved.map((plot) => plot.validity?.from).filter(Number.isInteger))].sort((a, b) => a - b)

  const speech = [...new Set([
    ...(entry.anchors?.speech ?? []),
    ...involved.flatMap((plot) => (plot.events ?? []).filter((event) => event.channel === 'say' && allNames.includes(event.who)).map((event) => event.content))
  ])].filter((line) => String(line).trim().length >= 6)

  const behavior = [...new Set([
    ...(entry.anchors?.behavior ?? []),
    ...involved.flatMap((plot) => (plot.events ?? []).filter((event) => event.channel === 'do' && allNames.includes(event.who)).map((event) => event.content))
  ])].filter((line) => String(line).trim().length >= 8)

  const cooccur = new Map()
  for (const plot of involved) {
    for (const other of plot.who ?? []) {
      if (allNames.includes(other)) continue
      cooccur.set(other, (cooccur.get(other) ?? 0) + 1)
    }
  }

  // 关系边：直接引用 + 别名都算（边可能来自「我→林逸」这类代词映射后的实体名）
  const edges = []
  const seen = new Set()
  for (const plot of plots) {
    for (const edge of plot.relations ?? []) {
      const from = edge.from, to = edge.to
      const involves = allNames.includes(from) ? { other: to, dir: 'out' }
        : allNames.includes(to) ? { other: from, dir: 'in' } : null
      if (!involves) continue
      const key = `${involves.other}|${edge.type}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ other: involves.other, dir: involves.dir, type: edge.type, how: edge.how ?? '' })
    }
  }

  return {
    name,
    aliases,
    identity: profile?.identity || entry.identity || '',
    personality: profile?.personality?.length ? profile.personality : (entry.traits ?? []),
    summary: profile?.summary || '',
    castRole: entry.castRole ?? null,
    appearances: involved.length,
    chapters,
    firstChapter: chapters[0] ?? null,
    lastChapter: chapters[chapters.length - 1] ?? null,
    speech: speech.slice(0, 12),
    speechTotal: speech.length,
    behavior: behavior.slice(0, 10),
    cooccur: [...cooccur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    edges
  }
}

/** 三色标注：每章首次出场的人物。 */
function firstAppearances(plots, characters) {
  const firstCh = new Map()
  for (const person of characters) {
    const allNames = [person.name, ...(person.aliases ?? [])]
    for (const plot of plots) {
      const chapter = plot.validity?.from
      const present = (plot.who ?? []).some((who) => allNames.includes(who))
        || (plot.events ?? []).some((event) => allNames.includes(event.who))
      if (present && Number.isInteger(chapter)) {
        if (!firstCh.has(person.name) || chapter < firstCh.get(person.name)) firstCh.set(person.name, chapter)
        break
      }
    }
  }
  const byChapter = new Map()
  for (const [name, chapter] of firstCh) {
    if (!byChapter.has(chapter)) byChapter.set(chapter, [])
    byChapter.get(chapter).push(name)
  }
  return byChapter
}

/* ---------- 页面骨架 ---------- */

const CSS = `
:root { --bg:#12141a; --panel:#1a1d26; --line:#2a2f3d; --text:#e6e8ee; --dim:#9aa3b5; --accent:#7aa2ff; --warm:#ffb454; --green:#7ddc9a; --red:#ff7a8a; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
.wrap { max-width:1080px; margin:0 auto; padding:32px 24px 80px; }
h1 { font-size:28px; margin:0 0 8px; } h2 { font-size:20px; margin:36px 0 12px; padding-bottom:8px; border-bottom:1px solid var(--line); }
.meta { color:var(--dim); font-size:13px; margin-bottom:24px; } .meta span + span::before { content:" · "; }
.summary { background:var(--panel); border-left:3px solid var(--accent); padding:14px 18px; border-radius:0 8px 8px 0; margin:14px 0; line-height:1.9; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:14px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; }
.card h4 { margin:0 0 6px; font-size:16px; } .card .sub { color:var(--dim); font-size:12px; margin-top:6px; }
.tag { display:inline-block; background:#232838; color:var(--dim); border-radius:4px; padding:1px 7px; font-size:12px; margin:2px 4px 2px 0; }
.tag.warm { background:#3a2c18; color:var(--warm); } .tag.green { background:#183222; color:var(--green); } .tag.red { background:#3a1820; color:var(--red); }
ul { margin:6px 0; padding-left:20px; } li { margin:4px 0; }
.quote { border-left:2px solid var(--accent); padding-left:12px; color:#cfd6e6; margin:6px 0; }
.event { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:10px 14px; margin:6px 0; }
.event .who { color:var(--warm); font-weight:600; } .event .ch { color:var(--dim); font-size:12px; }
.stat { display:flex; gap:26px; flex-wrap:wrap; margin:18px 0; } .stat div b { display:block; font-size:24px; color:var(--accent); } .stat div span { font-size:12px; color:var(--dim); }
.tl { position:relative; padding-left:24px; } .tl::before { content:""; position:absolute; left:8px; top:0; bottom:0; width:2px; background:var(--line); }
.tl-item { position:relative; margin:14px 0; } .tl-item::before { content:""; position:absolute; left:-22px; top:10px; width:10px; height:10px; border-radius:50%; background:var(--accent); }
.outline-ch { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 18px; margin:12px 0; }
.outline-ch h3 { margin:0 0 8px; font-size:17px; color:var(--warm); }
.nav { display:flex; gap:16px; flex-wrap:wrap; margin:18px 0; font-size:14px; }
`

function page({ title, body, back = null }) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="wrap">
${back ? `<div class="back"><a href="${esc(back)}">← 返回书页</a></div>` : ''}
${body}
</div></body></html>`
}

/* ---------- 单本构建 ---------- */

function buildBook(id) {
  const result = JSON.parse(readFileSync(join(LIB, '拆解', `${id}.json`), 'utf8'))
  const book = result.book
  const wiki = result.wiki ?? null
  const plots = result.entries.filter((entry) => entry.layer === 'plot')
  const characterEntries = result.entries.filter((entry) => entry.layer === 'character')
  const allRelations = result.entries.flatMap((entry) => entry.relations ?? [])

  const enrichProfile = (name) => wiki?.characterProfiles?.find((item) => item.name === name) ?? null
  const chapterSummary = (chapter) => wiki?.chapterSummaries?.find((item) => item.chapter === chapter)?.summary ?? ''

  // 章标题：从原文提取
  let chapterTitles = new Map()
  try {
    chapterTitles = chapterTitlesFromSource(readFileSync(join(LIB, '正文', result.source.file), 'utf8'))
  } catch { /* 无原文时标题留空 */ }

  // 按章分组
  const chapterOf = (plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : null)
  const byChapter = new Map()
  for (const plot of plots) {
    const chapter = chapterOf(plot)
    if (chapter === null) continue
    if (!byChapter.has(chapter)) byChapter.set(chapter, [])
    byChapter.get(chapter).push(plot)
  }
  const chapters = [...byChapter.keys()].sort((a, b) => a - b)
  const personSet = new Set(characterEntries.map((entry) => entry.name))
  const linkPerson = (name) => (personSet.has(name)
    ? `<a href="person-${encodeURIComponent(name)}.html">${esc(name)}</a>`
    : `<span>${esc(name)}</span>`)

  // 人物派生
  const characters = characterEntries.map((entry) => deriveCharacter(entry, plots, enrichProfile(entry.name)))
  const topPeople = [...characters].sort((a, b) => b.appearances - a.appearances)

  // 三色标注
  const firstByChapter = firstAppearances(plots, characters)

  // 章纲（原版 outlines 结构）
  const outlines = chapters.map((no) => {
    const chapterPlots = byChapter.get(no) ?? []
    const events = chapterPlots.flatMap((plot) => plot.events ?? [])
    const chars = [...new Set(chapterPlots.flatMap((plot) => plot.who ?? []))]
    const foreshadow = [...new Set(chapterPlots.flatMap((plot) => plot.hooks ?? []))]
    return {
      no,
      title: chapterTitles.get(no) ?? `第 ${no} 章`,
      summary: chapterSummary(no),
      events: events.length,
      chars,
      foreshadow,
      newChars: firstByChapter.get(no) ?? []
    }
  })

  const dir = join(OUT_ROOT, id)
  mkdirSync(dir, { recursive: true })

  /* ---------- 总览页 ---------- */
  const storySummary = wiki?.storySummary ?? ''
  const arc = wiki?.arc ?? []
  const indexBody = `
<h1>${esc(book.title)} · 世界书</h1>
<div class="meta">
  <span>${esc(book.author || '佚名')}</span><span>${book.word_count ?? '?'} 字</span>
  <span>${esc(book.subject_group ?? '')}</span><span>${esc(book.length_tier ?? '')}</span>
  <span>${chapters.length} 章</span>
  ${book.url ? `<span><a href="${esc(book.url)}">番茄原文</a></span>` : ''}
</div>
${storySummary ? `<h2>剧情梗概</h2><div class="summary">${esc(storySummary)}</div>` : ''}
${arc.length ? `<h2>故事结构</h2>${arc.map((phase) => `<div class="outline-ch"><h3>${esc(phase.phase)}</h3><div>${esc(phase.text)}</div></div>`).join('')}` : ''}
<div class="stat">
  <div><b>${plots.length}</b><span>剧情条目</span></div>
  <div><b>${characters.length}</b><span>人物</span></div>
  <div><b>${allRelations.length}</b><span>关系</span></div>
  <div><b>${chapters.length}</b><span>章</span></div>
  <div><b>${((result.quality?.traceableRate ?? 0) * 100).toFixed(1)}%</b><span>可溯源</span></div>
</div>
<div class="nav">
  <a href="outline.html">📖 章节大纲</a>
  <a href="timeline.html">⏱ 时间线</a>
  <a href="relations.html">🔗 关系图谱</a>
</div>
<h2>人物（${characters.length}）</h2>
<div class="grid">
${topPeople.map((person) => `<div class="card">
  <h4><a href="${esc(`person-${encodeURIComponent(person.name)}.html`)}">${esc(person.name)}</a></h4>
  ${person.identity ? `<div class="sub">${esc(person.identity)}</div>` : ''}
  ${person.personality.length ? `<div style="margin-top:6px">${person.personality.slice(0, 3).map((word) => `<span class="tag warm">${esc(word)}</span>`).join('')}</div>` : ''}
  <div class="sub" style="margin-top:6px">${person.appearances} 段 · ${person.chapters.length ? `第 ${person.firstChapter}${person.lastChapter !== person.firstChapter ? `~${person.lastChapter}` : ''} 章` : ''}</div>
  ${person.summary ? `<div class="sub" style="margin-top:6px">${esc(person.summary.slice(0, 60))}…</div>` : ''}
</div>`).join('')}
</div>
<h2>章节大纲（${outlines.length}）</h2>
${outlines.slice(0, 12).map((outline) => `<div class="outline-ch">
  <h3><a href="${esc(`chapter-${outline.no}.html`)}">${esc(outline.title)}</a></h3>
  ${outline.summary ? `<div>${esc(outline.summary)}</div>` : ''}
  <div style="margin-top:8px">${outline.chars.map((char) => linkPerson(char, personSet)).join(' ')}${outline.foreshadow.length ? `<span class="tag red">伏笔 ×${outline.foreshadow.length}</span>` : ''}</div>
</div>`).join('')}
${outlines.length > 12 ? `<p><a href="outline.html">查看全部 ${outlines.length} 章大纲 →</a></p>` : ''}
`
  writeFileSync(join(dir, 'index.html'), page({ title: `${book.title} · 世界书`, body: indexBody }), 'utf8')

  /* ---------- 章节大纲页 ---------- */
  const outlineBody = `
<h1>章节大纲</h1>
<div class="meta"><span>《${esc(book.title)}》</span><span>${outlines.length} 章</span><span>梗概来自模型归纳；出场人物与伏笔来自 fact 条目</span></div>
${outlines.map((outline) => `<div class="outline-ch">
  <h3><a href="${esc(`chapter-${outline.no}.html`)}">${esc(outline.title)}</a></h3>
  ${outline.summary ? `<div class="summary">${esc(outline.summary)}</div>` : '<div class="sub">（梗概未生成）</div>'}
  <div style="margin-top:8px">
    ${outline.chars.map((char) => linkPerson(char, personSet)).join(' ')}
    ${outline.newChars.map((char) => `<span class="tag green">新出场：${esc(char)}</span>`).join('')}
    ${outline.foreshadow.map((hook) => `<div class="quote" style="margin-top:6px">🎣 ${esc(hook)}</div>`).join('')}
  </div>
</div>`).join('')}
`
  writeFileSync(join(dir, 'outline.html'), page({ title: `章节大纲 · ${book.title}`, body: outlineBody, back: 'index.html' }), 'utf8')

  /* ---------- 时间线页 ---------- */
  const timelineBody = `
<h1>时间线</h1>
<div class="meta"><span>《${esc(book.title)}》</span><span>${plots.length} 段 / ${plots.reduce((sum, plot) => sum + (plot.events?.length ?? 0), 0)} 事件，按章序归并</span></div>
<div class="tl">
${chapters.map((chapter) => {
  const chapterPlots = byChapter.get(chapter) ?? []
  const title = chapterTitles.get(chapter) ?? `第 ${chapter} 章`
  const events = chapterPlots.flatMap((plot) => plot.events ?? [])
  return `<div class="tl-item"><h3 style="margin:0 0 8px"><a href="${esc(`chapter-${chapter}.html`)}">${esc(title)}</a></h3>
    ${events.map((event) => `<div class="event"><span class="who">${esc(event.who || '—')}</span> <span class="ch">[${esc(event.channel)}]</span><div>${esc(event.content)}</div></div>`).join('')}
  </div>`
}).join('')}
</div>
`
  writeFileSync(join(dir, 'timeline.html'), page({ title: `时间线 · ${book.title}`, body: timelineBody, back: 'index.html' }), 'utf8')

  /* ---------- 人物页 ---------- */
  for (const person of characters) {
    const body = `
<div class="top"><div>
  <h1>${esc(person.name)}</h1>
  <div class="meta"><span>《${esc(book.title)}》</span><span>${person.appearances} 段出场</span>
  ${person.chapters.length ? `<span>第 ${person.firstChapter}${person.lastChapter !== person.firstChapter ? `~${person.lastChapter}` : ''} 章</span>` : ''}
  ${person.castRole?.tier ? `<span>剧作档：${esc(person.castRole.tier)}</span>` : ''}</div>
</div></div>
${person.aliases.length ? `<div>${person.aliases.map((alias) => `<span class="tag">别名：${esc(alias)}</span>`).join('')}</div>` : ''}
${person.identity ? `<h2>身份</h2><p>${esc(person.identity)}</p>` : ''}
${person.summary ? `<h2>人物小传</h2><div class="summary">${esc(person.summary)}</div>` : ''}
${person.personality.length ? `<h2>性格</h2><div>${person.personality.map((word) => `<span class="tag warm">${esc(word)}</span>`).join('')}</div>` : ''}
${person.edges.length ? `<h2>关系</h2><ul>${person.edges.map((edge) => {
  const arrow = edge.dir === 'out' ? '→' : '←'
  return `<li>${arrow} ${linkPerson(edge.other, personSet)} <span class="tag">${esc(edge.type)}</span>${edge.how ? ` <span class="sub">${esc(edge.how)}</span>` : ''}</li>`
}).join('')}</ul>` : ''}
${person.speech.length ? `<h2>台词（摘 ${person.speech.length} / 共 ${person.speechTotal}）</h2>${person.speech.map((line) => `<div class="quote">“${esc(line)}”</div>`).join('')}` : ''}
${person.behavior.length ? `<h2>行为（${person.behavior.length}）</h2><ul>${person.behavior.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}
${person.cooccur.length ? `<h2>同场人物</h2><ul>${person.cooccur.map(([other, count]) => `<li>${linkPerson(other, personSet)} <span class="sub">${count} 段同场</span></li>`).join('')}</ul>` : ''}
`
    writeFileSync(join(dir, `person-${encodeURIComponent(person.name)}.html`), page({
      title: `${person.name} · ${book.title}`, body, back: 'index.html'
    }), 'utf8')
  }

  /* ---------- 关系图谱页 ---------- */
  const byType = new Map()
  for (const edge of allRelations) {
    const type = edge.type || '其他'
    if (!byType.has(type)) byType.set(type, [])
    byType.get(type).push(edge)
  }
  const relationsBody = `
<h1>关系图谱</h1>
<div class="meta"><span>《${esc(book.title)}》</span><span>${allRelations.length} 条 / ${byType.size} 种类型</span></div>
${[...byType.entries()].map(([type, edges]) => `
<h2>${esc(type)}（${edges.length}）</h2>
<ul>${edges.map((edge) => `<li>${linkPerson(edge.from, personSet)} → ${linkPerson(edge.to, personSet)}${edge.how ? ` <span class="sub">${esc(edge.how)}</span>` : ''}</li>`).join('')}</ul>`).join('')}
`
  writeFileSync(join(dir, 'relations.html'), page({ title: `关系图谱 · ${book.title}`, body: relationsBody, back: 'index.html' }), 'utf8')

  /* ---------- 章节页 ---------- */
  for (const chapter of chapters) {
    const outline = outlines.find((item) => item.no === chapter)
    const chapterPlots = byChapter.get(chapter) ?? []
    const title = chapterTitles.get(chapter) ?? `第 ${chapter} 章`
    const events = chapterPlots.flatMap((plot) => plot.events ?? [])
    const body = `
<h1>${esc(outline?.title ?? title)}</h1>
<div class="meta"><span>《${esc(book.title)}》</span><span>${chapterPlots.length} 段</span><span>${events.length} 事件</span></div>
${outline?.summary ? `<div class="summary">${esc(outline.summary)}</div>` : ''}
${outline?.newChars.length ? `<div>${outline.newChars.map((char) => `<span class="tag green">新出场：${esc(char)}</span>`).join('')}</div>` : ''}
${outline?.foreshadow.length ? `<h2>本章伏笔</h2><ul>${outline.foreshadow.map((hook) => `<li>${esc(hook)}</li>`).join('')}</ul>` : ''}
<h2>事件</h2>
${events.map((event) => `<div class="event"><span class="who">${esc(event.who || '—')}</span> <span class="ch">[${esc(event.channel)}]</span><div>${esc(event.content)}</div></div>`).join('')}
`
    writeFileSync(join(dir, `chapter-${chapter}.html`), page({ title: `${title} · ${book.title}`, body, back: 'index.html' }), 'utf8')
  }

  return {
    id, title: book.title, dir,
    characters: characters.length, chapters: chapters.length,
    outlines: outlines.length, relations: allRelations.length,
    pages: 3 + characters.length + chapters.length
  }
}

const built = ids.map(buildBook)
console.log(JSON.stringify(built, null, 2))
