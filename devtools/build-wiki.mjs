/**
 * 世界书 Wiki 生成器 v3（作者 2026-11-12 裁定：对齐原版 ref-Novelpedia demo 的单页 Pedia 形态）。
 *
 * 形态（原版 demo/index.html 的结构）：单页 tab 式 Pedia，这里收敛为 8 个视图——
 *   概览 / 章节大纲 / 时间线 / 关系图谱 / 伏笔 / 人物页 / 词条页 / 单章页
 *   侧边导航 + 视图切换 + wiki-links（人物名/词条名点击即跳）+ 手写力导向 SVG 关系图。
 *
 * 与 v2（多页静态 HTML）的区别：整本书一个 index.html，数据内嵌 DETAIL JSON，
 * SPA（wiki-spa.js，独立文件，零依赖）负责渲染；构建期只做确定性派生。
 *
 * 数据源：拆解 JSON（fact.data/v3 条目 + wiki 增补字段）。
 *   · 事件/台词/行为：绑定路径产出，逐字取自原文；
 *   · 梗概/身份/性格：wiki-enrich 模型窄窗归纳，缺了退回确定性派生（标题从原文提取）。
 *
 * 输出：wiki/<id>/index.html 单文件。
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { derivePseudoChapters, hasRealChapters } from './lib/pseudoChapters.mjs'

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const LIB = argOf('--lib', 'D:/Qbook/短篇选题库')
const OUT_ROOT = join(LIB, 'wiki')
const ids = process.argv.slice(2).filter((item) => !item.startsWith('--'))
const SPA_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'wiki-spa.js'), 'utf8')

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
    castTier: entry.castRole?.tier ?? null,
    appearances: involved.length,
    chapters,
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

/** 词条派生：world 层条目（当前 v3 管线为空，留好路径；mentions 从关系边统计）。 */
function deriveTerms(entries, plots) {
  return entries.filter((entry) => entry.layer === 'world').map((entry) => {
    const mentions = plots.reduce((sum, plot) => sum + (plot.relations ?? []).filter((edge) => edge.from === entry.name || edge.to === entry.name).length, 0)
    const chapters = [...new Set(plots.filter((plot) =>
      (plot.who ?? []).includes(entry.name) || (plot.events ?? []).some((event) => event.who === entry.name)
    ).map((plot) => plot.validity?.from).filter(Number.isInteger))].sort((a, b) => a - b)
    const edges = plots.flatMap((plot) => (plot.relations ?? []).filter((edge) => edge.from === entry.name || edge.to === entry.name)
      .map((edge) => ({ person: edge.from === entry.name ? edge.to : edge.from, type: edge.type, how: edge.how ?? '' })))
    return { name: entry.name, mentions, chapters, edges }
  })
}

/* ---------- 单本构建 ---------- */

function buildBook(id) {
  const result = JSON.parse(readFileSync(join(LIB, '拆解', `${id}.json`), 'utf8'))
  const book = result.book
  const wiki = result.wiki ?? null
  const plots = result.entries.filter((entry) => entry.layer === 'plot')
  const characterEntries = result.entries.filter((entry) => entry.layer === 'character')

  const enrichProfile = (name) => wiki?.characterProfiles?.find((item) => item.name === name) ?? null
  const chapterSummary = (chapter) => wiki?.chapterSummaries?.find((item) => item.chapter === chapter)?.summary ?? ''

  // 章标题：从原文提取
  let chapterTitles = new Map()
  try {
    chapterTitles = chapterTitlesFromSource(readFileSync(join(LIB, '正文', result.source.file), 'utf8'))
  } catch { /* 无原文时标题留空 */ }

  // 按章分组：真章按 validity.from；无章节标记的书按段号切伪章（作者 2026-11-13：大纲塌成单章的问题）
  const usePseudo = !hasRealChapters(plots)
  const byChapter = new Map()
  if (usePseudo) {
    for (const group of derivePseudoChapters(plots, result.source?.chars ?? book.word_count ?? 0)) {
      byChapter.set(group.no, group.plots)
    }
  } else {
    const chapterOf = (plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : null)
    for (const plot of plots) {
      const chapter = chapterOf(plot)
      if (chapter === null) continue
      if (!byChapter.has(chapter)) byChapter.set(chapter, [])
      byChapter.get(chapter).push(plot)
    }
  }
  const chapterNumbers = [...byChapter.keys()].sort((a, b) => a - b)
  // 伪章标题优先用增补小标题（enrich 与本侧用同一伪章切分公式，章号对得上）
  const enrichTitle = (no) => (usePseudo ? (wiki?.chapterSummaries?.find((item) => item.chapter === no)?.title ?? '') : '')

  // 人物派生
  const characters = characterEntries.map((entry) => deriveCharacter(entry, plots, enrichProfile(entry.name)))
  const firstByChapter = firstAppearances(plots, characters)

  // 章数据（大纲/单章/时间线共用）
  const chapters = chapterNumbers.map((no) => {
    const chapterPlots = byChapter.get(no) ?? []
    const events = chapterPlots.flatMap((plot) => plot.events ?? [])
    return {
      no,
      title: enrichTitle(no) || (chapterTitles.get(no) ?? (usePseudo ? `第 ${no} 节` : `第 ${no} 章`)),
      summary: chapterSummary(no),
      segments: chapterPlots.length,
      events: events.length,
      chars: [...new Set(chapterPlots.flatMap((plot) => plot.who ?? []))],
      // 伏笔：语义层来自增补窄窗（wiki.foreshadows）；绑定层 hooks（v3 恒空）留作兜底
      foreshadow: [...new Set([
        ...(wiki?.foreshadows ?? []).filter((hook) => hook.chapter === no).map((hook) => String(hook.text)),
        ...chapterPlots.flatMap((plot) => plot.hooks ?? [])
      ])],
      newChars: firstByChapter.get(no) ?? []
    }
  })

  // 词条（world 层；当前为空）
  const terms = deriveTerms(result.entries, plots)

  // 关系图：节点 = 人物（+词条）；边 = 去重（无向对），两端都已知才收
  const knownNames = new Set([...characters.map((c) => c.name), ...terms.map((t) => t.name)])
  const graphEdges = []
  const edgeSeen = new Set()
  for (const plot of plots) {
    for (const edge of plot.relations ?? []) {
      if (!knownNames.has(edge.from) || !knownNames.has(edge.to)) continue
      const pair = [edge.from, edge.to].sort().join('|')
      if (edgeSeen.has(pair)) continue
      edgeSeen.add(pair)
      graphEdges.push({ a: edge.from, b: edge.to, type: edge.type })
    }
  }
  // 同场边（确定性）：两人同段共现 ≥2 次即连边。关系窄窗覆盖低（假千金 50 段才 4 条边），
  // 单靠它图必断——同场共现是 plot.who 里现成的确定性数据（作者 2026-11-13「图为什么断成这样」）。
  const pairKey = (a, b) => [a, b].sort().join('|')
  const coCount = new Map()
  for (const plot of plots) {
    const who = [...new Set((plot.who ?? []).filter((name) => knownNames.has(name)))]
    for (let i = 0; i < who.length; i++) {
      for (let j = i + 1; j < who.length; j++) {
        const key = pairKey(who[i], who[j])
        coCount.set(key, (coCount.get(key) ?? 0) + 1)
      }
    }
  }
  const related = new Set(graphEdges.map((edge) => pairKey(edge.a, edge.b)))
  const coEdges = [...coCount.entries()]
    .filter(([key, count]) => count >= 2 && !related.has(key))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
  for (const [key, count] of coEdges) {
    const [a, b] = key.split('|')
    graphEdges.push({ a, b, type: '同场', weight: count })
  }
  const maxApp = Math.max(...characters.map((c) => c.appearances), 1)
  const charGraph = {
    nodes: [
      ...characters.map((c) => ({ id: c.name, kind: 'person', r: 6 + Math.round(Math.sqrt(c.appearances / maxApp) * 10) })),
      ...terms.map((t) => ({ id: t.name, kind: 'term', r: 7 }))
    ],
    edges: graphEdges
  }

  // 时间线：按章归并事件
  const timeline = chapters.map((chapter) => ({
    no: chapter.no,
    title: chapter.title,
    events: (byChapter.get(chapter.no) ?? []).flatMap((plot) => (plot.events ?? []).map((event) => ({
      who: event.who ?? '', channel: event.channel ?? '', text: event.content ?? ''
    })))
  }))

  // 数据面板素材（确定性派生，作者 2026-11-13：不当数据库呈现，要面板＋矩形曲线）：
  //   matrix[人物][章] = 出场段数（热力图/节奏曲线/屏份份额的数据源）
  //   channels[人物] = {say, do, other} 渠道构成
  const matrix = characters.map((c) => {
    const allNames = [c.name, ...(c.aliases ?? [])]
    const present = (plot) => (plot.who ?? []).some((who) => allNames.includes(who))
      || (plot.events ?? []).some((event) => allNames.includes(event.who))
    return chapters.map((ch) => (byChapter.get(ch.no) ?? []).filter(present).length)
  })
  const channels = characters.map((c) => {
    const allNames = [c.name, ...(c.aliases ?? [])]
    const cnt = { say: 0, do: 0, other: 0 }
    for (const plot of plots) {
      for (const event of plot.events ?? []) {
        if (!allNames.includes(event.who)) continue
        if (event.channel === 'say') cnt.say++
        else if (event.channel === 'do') cnt.do++
        else cnt.other++
      }
    }
    return cnt
  })

  const detail = {
    book: {
      id: book.id ?? id,
      title: book.title,
      author: book.author || '佚名',
      words: book.word_count ?? null,
      group: [book.subject_group, book.length_tier].filter(Boolean).join(' · '),
      url: book.url ?? null
    },
    pseudoChapters: usePseudo,
    chapters,
    characters,
    matrix,
    channels,
    terms,
    charGraph,
    timeline,
    enrich: {
      perspective: result.perspective ?? wiki?.perspective ?? null,
      storySummary: wiki?.storySummary ?? '',
      arc: wiki?.arc ?? []
    },
    quality: { traceableRate: result.quality?.traceableRate ?? null }
  }

  // 单文件 HTML：样式 + DOM 骨架 + DETAIL JSON + SPA
  const dataJson = JSON.stringify(detail).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${book.title} · 世界书</title>
<style>
:root { --bg:#12141a; --panel:#1a1d26; --line:#2a2f3d; --text:#e6e8ee; --dim:#9aa3b5; --accent:#7aa2ff; --warm:#ffb454; --green:#7ddc9a; --red:#ff7a8a; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
a { color:var(--accent); text-decoration:none; cursor:pointer; } a:hover { text-decoration:underline; }
#side { position:fixed; left:0; top:0; bottom:0; width:264px; overflow-y:auto; background:var(--panel); border-right:1px solid var(--line); padding:20px 14px; z-index:30; transition:transform .2s; }
#side h3 { font-size:12px; color:var(--dim); margin:18px 0 6px; text-transform:uppercase; letter-spacing:.08em; }
#side h3:first-child { margin-top:0; }
.nav a { display:block; padding:5px 10px; border-radius:6px; color:var(--text); font-size:14px; }
.nav a:hover { background:#232838; text-decoration:none; }
.nav a.on { background:#232838; color:var(--accent); font-weight:600; }
#view { margin-left:264px; max-width:940px; padding:36px 32px 90px; }
h1 { font-size:26px; margin:0 0 8px; line-height:1.4; } h2 { font-size:19px; margin:34px 0 12px; padding-bottom:8px; border-bottom:1px solid var(--line); }
h2 small { font-size:12px; color:var(--dim); font-weight:400; margin-left:10px; }
.chartbox { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px 8px; margin:10px 0 4px; position:relative; }
.hover-read { position:absolute; right:16px; top:10px; font-size:12px; color:var(--dim); opacity:.35; transition:opacity .15s; pointer-events:none; }
.hbar { display:flex; align-items:center; gap:10px; margin:5px 0; }
.hbar .hb-label { width:110px; text-align:right; font-size:13px; color:var(--text); flex:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hbar .hb-track { flex:1; height:12px; background:#232838; border-radius:6px; overflow:hidden; }
.hbar .hb-fill { display:block; height:100%; border-radius:6px; opacity:.85; }
.hbar .hb-val { width:86px; font-size:12px; color:var(--dim); flex:none; }
.hbar .hb-val em { font-style:normal; color:#72777d; margin-left:4px; }
.hbars .hbar .hb-label { width:52px; }
.sharebar { display:flex; height:18px; border-radius:9px; overflow:hidden; margin:12px 0 8px; background:#232838; }
.sharebar .seg { display:block; height:100%; opacity:.88; }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 4px; }
.chip { font-size:12px; color:var(--dim); background:#232838; border-radius:10px; padding:2px 10px; }
.chip b { color:var(--text); font-weight:600; }
.chip.green { background:#183222; color:var(--green); } .chip.red { background:#3a1820; color:var(--red); }
details.drill { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 14px; margin:8px 0; }
details.drill summary { cursor:pointer; color:var(--dim); font-size:13px; user-select:none; }
details.drill summary:hover { color:var(--accent); }
details.drill[open] summary { border-bottom:1px solid var(--line); padding-bottom:8px; margin-bottom:8px; }
.arc-range { font-size:12px; color:var(--dim); font-weight:400; margin-left:10px; }
.meta { color:var(--dim); font-size:13px; margin-bottom:22px; } .meta span + span::before { content:" · "; }
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
.chbar { display:flex; align-items:flex-end; gap:2px; height:52px; margin:10px 0 4px; }
.chbar div { width:8px; background:var(--accent); border-radius:2px 2px 0 0; opacity:.75; }
.tl { position:relative; padding-left:24px; } .tl::before { content:""; position:absolute; left:8px; top:0; bottom:0; width:2px; background:var(--line); }
.tl-item { position:relative; margin:14px 0; } .tl-item::before { content:""; position:absolute; left:-22px; top:10px; width:10px; height:10px; border-radius:50%; background:var(--accent); }
.outline-ch { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 18px; margin:12px 0; }
.outline-ch h3 { margin:0 0 8px; font-size:17px; color:var(--warm); }
svg.relation { display:block; width:100%; height:480px; background:var(--panel); border:1px solid var(--line); border-radius:12px; }
.legend { color:var(--dim); font-size:13px; margin-top:10px; } .legend .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin:0 6px 0 12px; }
#sideToggle { display:none; position:fixed; left:14px; top:14px; z-index:50; background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 12px; font-size:16px; cursor:pointer; }
#sideMask { display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:25; }
#homeLink { position:fixed; right:18px; top:14px; z-index:40; font-size:13px; color:var(--dim); background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:5px 12px; }
#homeLink:hover { color:var(--accent); text-decoration:none; }
@media (max-width: 900px) {
  #side { transform:translateX(-100%); } #side.open { transform:none; }
  #view { margin-left:0; padding:64px 16px 70px; }
  #sideToggle { display:block; } #sideMask.on { display:block; }
}
</style></head>
<body>
<button id="sideToggle">☰ 目录</button>
<div id="sideMask"></div>
<nav id="side"><div id="sideNav"></div></nav>
<a id="homeLink" href="../index.html">📖 书库索引</a>
<main id="view"></main>
<script>const DETAIL = ${dataJson};var D = DETAIL;</script>
<script>
${SPA_SRC}
</script>
</body></html>`

  const dir = join(OUT_ROOT, id)
  // 书目录是纯派生产物：整目录重建（清掉 v2 时代的多页残留）
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), html, 'utf8')

  return {
    id, title: book.title, dir,
    chapters: chapters.length, characters: characters.length,
    terms: terms.length, relations: graphEdges.length,
    events: timeline.reduce((sum, t) => sum + t.events.length, 0),
    bytes: Buffer.byteLength(html)
  }
}

// CLI：node devtools/build-wiki.mjs --lib=D:/Qbook/短篇选题库 <id...>
const isCli = process.argv[1] && process.argv[1].endsWith('build-wiki.mjs')
if (isCli) {
  if (!ids.length) {
    console.error('用法：node devtools/build-wiki.mjs --lib=<库目录> <id> [<id>...]')
    process.exit(2)
  }
  console.log(JSON.stringify(ids.map(buildBook), null, 2))
}

export { buildBook }
