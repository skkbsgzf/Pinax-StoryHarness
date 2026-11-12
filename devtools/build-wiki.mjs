/**
 * 世界书 Wiki 生成器 v4（作者 2026-11-13 裁定：数据面板形态＋接入 OpenDesign 接口＋高级图表）。
 *
 * 形态：单页 Pedia → 数据面板。侧边导航 + 视图切换（概览仪表盘/人物矩阵/时间线/关系图谱/伏笔/人物页），
 * wiki-links 互跳，全部图表为内嵌 SVG（dashboard skill 约定：inline SVG only, no JS libraries），
 * 设计 token 来自 OpenDesign `dashboard` 设计系统（构建期经 daemon API 拉取，离线回退包文件/内嵌常量）。
 *
 * OpenDesign 接口（2026-11-13 探明）：
 *   · daemon HTTP：127.0.0.1:3000 / :7456 —— GET /api/design-templates、/api/design-systems[/:id]
 *   · 结构化 token 真源：包内 design-systems/dashboard/tokens.css（浅色 analytics 风，sky #0ea5e9）
 *   · 拉取顺序：daemon 详情（拿 provenance/summary）→ 包文件 tokens.css → 内嵌常量
 *
 * 数据源：拆解 JSON（fact.data/v3 条目 + wiki 增补字段）。事件/台词/行为逐字取自原文；
 * 梗概/身份/性格来自 wiki-enrich 窄窗归纳；全部统计（matrix/channels/KPI delta）确定性派生。
 *
 * 输出：wiki/<id>/index.html 单文件。
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
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

/* ---------- OpenDesign 设计系统接入（构建期） ---------- */

const OD_PORTS = [3000, 7456]
const OD_TOKENS_DISK = 'D:/OpenDesign/resources/open-design/design-systems/dashboard/tokens.css'

/** 从 tokens.css 提取图表调色板（SPA SVG 需要具体色值，CSS 变量进 :root）。 */
function extractPalette(css) {
  const grab = (name, fallback) => {
    const m = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css)
    return m ? m[1].trim() : fallback
  }
  return {
    accent: grab('accent', '#0ea5e9'),
    success: grab('success', '#10b981'),
    warn: grab('warn', '#f59e0b'),
    danger: grab('danger', '#ef4444'),
    bg: grab('bg', '#f4f7fb'),
    surface: grab('surface', '#ffffff'),
    fg: grab('fg', '#111827'),
    fg2: grab('fg-2', '#334155'),
    muted: grab('muted', '#64748b'),
    meta: grab('meta', '#0ea5e9'),
    border: grab('border', '#d8e2ee'),
    borderSoft: grab('border-soft', '#edf3f8')
  }
}

/** 内嵌兜底 token（与包内 tokens.css 同值；daemon 与磁盘都不可达时使用）。 */
const FALLBACK_TOKENS_CSS = `:root {
  --bg: #f4f7fb; --surface: #ffffff; --surface-warm: #eef6ff;
  --fg: #111827; --fg-2: #334155; --muted: #64748b; --meta: #0ea5e9;
  --border: #d8e2ee; --border-soft: #edf3f8;
  --accent: #0ea5e9; --success: #10b981; --warn: #f59e0b; --danger: #ef4444;
  --font-body: Inter, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  --text-sm: 13px; --text-base: 15px; --text-xl: 22px; --text-2xl: 30px;
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 18px;
  --motion-base: 200ms; --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}`

/**
 * 解析 dashboard 设计系统：daemon（拿 provenance）→ 包文件 tokens.css → 内嵌兜底。
 * @returns {Promise<{css, palette, summary, source}>}
 */
async function resolveDesignSystem() {
  for (const port of OD_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/design-systems/dashboard`, { signal: AbortSignal.timeout(1500) })
      if (!res.ok) continue
      const data = await res.json()
      const summary = data?.designSystem?.summary ?? 'Dashboard'
      if (existsSync(OD_TOKENS_DISK)) {
        const css = readFileSync(OD_TOKENS_DISK, 'utf8')
        return { css, palette: extractPalette(css), summary, source: `opendesign-daemon:${port}` }
      }
    } catch { /* daemon 未起则下一个端口/回退 */ }
  }
  if (existsSync(OD_TOKENS_DISK)) {
    const css = readFileSync(OD_TOKENS_DISK, 'utf8')
    return { css, palette: extractPalette(css), summary: 'Dashboard', source: 'opendesign-bundled' }
  }
  return { css: FALLBACK_TOKENS_CSS, palette: extractPalette(FALLBACK_TOKENS_CSS), summary: 'Dashboard', source: 'embedded-fallback' }
}

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

function buildBook(id, ds) {
  if (!ds?.palette) throw new Error('buildBook 需要 ds（await resolveDesignSystem()）')
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
    quality: { traceableRate: result.quality?.traceableRate ?? null },
    // OpenDesign dashboard 设计系统（token 真源＋SVG 图表调色板＋来源标识）
    ds: { id: 'dashboard', title: 'Dashboard', summary: ds.summary, source: ds.source, palette: ds.palette }
  }

  // 单文件 HTML：样式 + DOM 骨架 + DETAIL JSON + SPA
  const dataJson = JSON.stringify(detail).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${book.title} · 世界书</title>
<style>
/* OpenDesign dashboard 设计系统 token（构建期自 daemon/包文件拉取） */
${ds.css}
/* ---------- 组件层（全部走 DS token） ---------- */
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:var(--text-base)/1.6 var(--font-body, Inter, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif); }
a { color:var(--accent); text-decoration:none; cursor:pointer; transition:color var(--motion-base) var(--ease-standard); } a:hover { text-decoration:underline; }
#side { position:fixed; left:0; top:0; bottom:0; width:264px; overflow-y:auto; background:var(--surface); border-right:1px solid var(--border); padding:20px 14px; z-index:30; transition:transform .2s; }
#side h3 { font-size:11px; color:var(--muted); margin:18px 0 6px; text-transform:uppercase; letter-spacing:.08em; }
#side h3:first-child { margin-top:0; }
.nav a { display:block; padding:5px 10px; border-radius:var(--radius-sm); color:var(--fg-2); font-size:14px; transition:background 120ms var(--ease-standard), color var(--motion-base) var(--ease-standard); }
.nav a:hover { background:var(--border-soft); text-decoration:none; }
.nav a.on { background:color-mix(in srgb, var(--accent) 12%, transparent); color:var(--accent); font-weight:600; }
#view { margin-left:264px; max-width:960px; padding:36px 32px 90px; }
h1 { font-size:26px; margin:0 0 8px; line-height:1.3; letter-spacing:-0.01em; }
h2 { font-size:17px; margin:34px 0 12px; padding-bottom:8px; border-bottom:1px solid var(--border-soft); }
h2 small { font-size:12px; color:var(--muted); font-weight:400; margin-left:10px; }
.meta { color:var(--muted); font-size:13px; margin-bottom:22px; } .meta span + span::before { content:" · "; }
.summary { background:var(--surface-warm); border-left:3px solid var(--accent); padding:14px 18px; border-radius:0 var(--radius-sm) var(--radius-sm) 0; margin:14px 0; line-height:1.85; color:var(--fg-2); }
/* KPI 卡片行（dashboard skill Row 1 约定） */
.kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:20px 0 6px; }
.kpi { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:14px 16px; box-shadow:0 1px 2px rgba(15,23,42,.04); }
.kpi .k-label { font-size:12px; color:var(--muted); }
.kpi .k-value { font-size:var(--text-2xl); font-weight:700; color:var(--fg); line-height:1.2; margin-top:4px; font-variant-numeric:tabular-nums; }
.kpi .k-delta { display:inline-block; margin-top:6px; font-size:11px; border-radius:9999px; padding:1px 9px; }
.kpi .k-delta.up { background:color-mix(in srgb, var(--success) 14%, transparent); color:var(--success); }
.kpi .k-delta.down { background:color-mix(in srgb, var(--danger) 14%, transparent); color:var(--danger); }
.kpi .k-delta.flat { background:var(--border-soft); color:var(--muted); }
@media (max-width:760px) { .kpis { grid-template-columns:repeat(2,1fr); } }
/* 图表盒 */
.chartbox { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:14px 16px 8px; margin:10px 0 4px; position:relative; }
.hover-read { position:absolute; right:16px; top:10px; font-size:12px; color:var(--muted); opacity:.35; transition:opacity .15s; pointer-events:none; font-variant-numeric:tabular-nums; }
.hbar { display:flex; align-items:center; gap:10px; margin:5px 0; }
.hbar .hb-label { width:110px; text-align:right; font-size:13px; color:var(--fg-2); flex:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hbar .hb-track { flex:1; height:12px; background:var(--border-soft); border-radius:6px; overflow:hidden; }
.hbar .hb-fill { display:block; height:100%; border-radius:6px; transition:width var(--motion-base) var(--ease-standard); }
.hbar .hb-val { width:86px; font-size:12px; color:var(--muted); flex:none; font-variant-numeric:tabular-nums; }
.hbar .hb-val em { font-style:normal; color:var(--muted); margin-left:4px; }
.hbars .hbar .hb-label { width:52px; }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 4px; }
.chip { font-size:12px; color:var(--fg-2); background:var(--border-soft); border:1px solid var(--border-soft); border-radius:9999px; padding:2px 10px; }
.chip b { color:var(--fg); font-weight:600; }
.chip.green { background:color-mix(in srgb, var(--success) 12%, transparent); color:var(--success); border-color:transparent; }
.chip.red { background:color-mix(in srgb, var(--danger) 12%, transparent); color:var(--danger); border-color:transparent; }
details.drill { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:10px 14px; margin:8px 0; }
details.drill summary { cursor:pointer; color:var(--muted); font-size:13px; user-select:none; }
details.drill summary:hover { color:var(--accent); }
details.drill[open] summary { border-bottom:1px solid var(--border-soft); padding-bottom:8px; margin-bottom:8px; }
.arc-range { font-size:12px; color:var(--muted); font-weight:400; margin-left:10px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:14px; }
.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px; }
.card h4 { margin:0 0 6px; font-size:16px; } .card .sub { color:var(--muted); font-size:12px; margin-top:6px; }
.tag { display:inline-block; background:var(--border-soft); color:var(--muted); border-radius:4px; padding:1px 7px; font-size:12px; margin:2px 4px 2px 0; }
.tag.warm { background:color-mix(in srgb, var(--warn) 12%, transparent); color:var(--warn); }
.tag.green { background:color-mix(in srgb, var(--success) 12%, transparent); color:var(--success); }
.tag.red { background:color-mix(in srgb, var(--danger) 12%, transparent); color:var(--danger); }
ul { margin:6px 0; padding-left:20px; } li { margin:4px 0; }
.quote { border-left:2px solid var(--accent); padding-left:12px; color:var(--fg-2); margin:6px 0; }
.event { background:var(--surface); border:1px solid var(--border-soft); border-radius:var(--radius-sm); padding:10px 14px; margin:6px 0; }
.event .who { color:var(--accent); font-weight:600; } .event .ch { color:var(--muted); font-size:12px; }
.outline-ch { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:14px 18px; margin:12px 0; }
.outline-ch h3 { margin:0 0 8px; font-size:16px; color:var(--fg); font-weight:650; }
svg.relation { display:block; width:100%; height:480px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); }
.legend { color:var(--muted); font-size:13px; margin-top:10px; } .legend .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin:0 6px 0 12px; }
#dsFooter { color:var(--muted); font-size:11px; margin-top:56px; border-top:1px solid var(--border-soft); padding-top:12px; }
#sideToggle { display:none; position:fixed; left:14px; top:14px; z-index:50; background:var(--surface); color:var(--fg); border:1px solid var(--border); border-radius:var(--radius-sm); padding:6px 12px; font-size:16px; cursor:pointer; }
#sideMask { display:none; position:fixed; inset:0; background:rgba(15,23,42,.35); z-index:25; }
#homeLink { position:fixed; right:18px; top:14px; z-index:40; font-size:13px; color:var(--fg-2); background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:5px 12px; }
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
  const ds = await resolveDesignSystem()
  const built = ids.map((id) => buildBook(id, ds))
  console.log(JSON.stringify(built.map((b) => ({ ...b, designSystem: ds.source })), null, 2))
}

export { buildBook, resolveDesignSystem }
