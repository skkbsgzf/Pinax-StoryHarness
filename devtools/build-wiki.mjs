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
    archetype: profile?.archetype || '',
    goal: profile?.goal || '',
    personality: profile?.personality?.length ? profile.personality : (entry.traits ?? []),
    arc: profile?.arc ?? null,
    keyChoices: profile?.keyChoices ?? [],
    mirror: profile?.mirror || '',
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
function deriveTerms(entries, plots, wiki = null) {
  const factTerms = entries.filter((entry) => entry.layer === 'world').map((entry) => {
    const mentions = plots.reduce((sum, plot) => sum + (plot.relations ?? []).filter((edge) => edge.from === entry.name || edge.to === entry.name).length, 0)
    const chapters = [...new Set(plots.filter((plot) =>
      (plot.who ?? []).includes(entry.name) || (plot.events ?? []).some((event) => event.who === entry.name)
    ).map((plot) => plot.validity?.from).filter(Number.isInteger))].sort((a, b) => a - b)
    const edges = plots.flatMap((plot) => (plot.relations ?? []).filter((edge) => edge.from === entry.name || edge.to === entry.name)
      .map((edge) => ({ person: edge.from === entry.name ? edge.to : edge.from, type: edge.type, how: edge.how ?? '' })))
    return { name: entry.name, kind: '设定', desc: entry.definition ?? '', mentions, chapters, edges }
  })
  // 世界要素（图谱一等公民同源）：场景/道具按权重（出现章数）入 wiki 词条
  const we = wiki?.worldElements ?? null
  const sceneTerms = (we?.scenes ?? []).map((scene) => ({ name: scene.name, kind: '场景', desc: scene.desc, mentions: scene.chapters.length, chapters: scene.chapters, edges: [] }))
  const itemTerms = (we?.items ?? []).map((item) => ({ name: item.name, kind: '道具', desc: `${item.desc}${item.holder ? `（掌握者：${item.holder}）` : ''}`, mentions: item.chapters.length, chapters: item.chapters, edges: [] }))
  return [...factTerms, ...sceneTerms, ...itemTerms]
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
  const chapterInfo = (no) => wiki?.chapterSummaries?.find((item) => item.chapter === no) ?? null

  // 人物派生
  const charactersAll = characterEntries.map((entry) => deriveCharacter(entry, plots, enrichProfile(entry.name)))
  // 碎片降噪（显示侧过滤，不改 fact 数据）：出场 <3 段且无档案（identity/summary/archetype）的
  // 是绑定噪声（相亲/甚至/心头/司机…），侧栏/矩阵/图谱都不要。真配角有档案或出场足够，保留。
  // 停用黑名单兜底：时间/副词类 who 偶有出场 ≥3 的（「最后」），形态上就不是人名。
  const NOISE_NAMES = new Set(['最后', '然后', '突然', '继续', '应该', '生怕', '疑惑', '记得', '招呼', '简洁', '勇气', '心头', '自己', '相亲', '甚至', '许久才', '原来', '终于'])
  const characters = charactersAll.filter((c) => !NOISE_NAMES.has(c.name) && (c.appearances >= 3 || c.identity || c.summary || c.archetype))
  const firstByChapter = firstAppearances(plots, characters)

  // 章数据（大纲/单章/时间线共用）
  const chapters = chapterNumbers.map((no) => {
    const chapterPlots = byChapter.get(no) ?? []
    const events = chapterPlots.flatMap((plot) => plot.events ?? [])
    return {
      no,
      title: enrichTitle(no) || (chapterTitles.get(no) ?? (usePseudo ? `第 ${no} 节` : `第 ${no} 章`)),
      summary: chapterSummary(no),
      // 细化层（kb/deconstruct/protocol）：章节功能九类＋核心情绪＋剧情点密度
      function: chapterInfo(no)?.function ?? '',
      emotion: chapterInfo(no)?.emotion ?? '',
      beats: chapterInfo(no)?.beats ?? null,
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
  const terms = deriveTerms(result.entries, plots, wiki)

  // 知识图谱（作者 2026-11-14：一等公民，人物/事件/场景/道具四类都要）
  // 节点：人物（半径∝出场）＋事件（半径∝剧情点）＋场景/道具（半径∝出现章数）
  // 边：关系窄窗（实线）＋同场共现（浅线）＋**事件↔在场人物/场景/道具**（结构性边，权重=出现次数）
  const pairKey = (a, b) => [a, b].sort().join('|')
  const unitLabel = usePseudo ? '节' : '章'
  const eventNodeId = (no) => `事件·第${no}${unitLabel}`
  const graphEdges = []
  const edgeSeen = new Set()
  const addEdge = (a, b, type, weight) => {
    if (a === b) return
    const key = pairKey(a, b)
    if (edgeSeen.has(key)) return
    edgeSeen.add(key)
    graphEdges.push({ a, b, type, weight })
  }

  // ① 关系窄窗（两端都已知才收）
  const knownNames = new Set([...characters.map((c) => c.name), ...terms.map((t) => t.name)])
  for (const plot of plots) {
    for (const edge of plot.relations ?? []) {
      if (!knownNames.has(edge.from) || !knownNames.has(edge.to)) continue
      addEdge(edge.from, edge.to, edge.type)
    }
  }

  // ② 同场共现（确定性，≥2 次）
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
  for (const [key, count] of [...coCount.entries()].filter(([key, count]) => count >= 2 && !related.has(key)).sort((a, b) => b[1] - a[1]).slice(0, 60)) {
    const [a, b] = key.split('|')
    addEdge(a, b, '同场', count)
  }

  // ③ 事件 ↔ 人物/场景/道具（结构性边：事件是图谱的一等公民，靠它把场景道具接进来）
  const eventNodes = []
  const sceneTermByName = new Map(terms.filter((t) => t.kind === '场景').map((t) => [t.name, t]))
  const itemTermByName = new Map(terms.filter((t) => t.kind === '道具').map((t) => [t.name, t]))
  const we = wiki?.worldElements ?? null
  for (const chapter of chapters) {
    const chapterPlots = byChapter.get(chapter.no) ?? []
    // 该节在场人物（按出现次数加权）
    const presence = new Map()
    for (const plot of chapterPlots) {
      for (const who of plot.who ?? []) if (knownNames.has(who)) presence.set(who, (presence.get(who) ?? 0) + 1)
    }
    // 该节涉及场景/道具（worldElements 的 chapters 列表）
    const scenes = (we?.scenes ?? []).filter((scene) => scene.chapters.includes(chapter.no))
    const items = (we?.items ?? []).filter((item) => item.chapters.includes(chapter.no))
    const beats = wiki?.chapterSummaries?.find((s) => s.chapter === chapter.no)?.beats ?? 1
    const nodeId = eventNodeId(chapter.no)
    eventNodes.push({
      id: nodeId,
      kind: 'event',
      r: 5 + Math.min(6, beats),
      label: chapter.title,
      no: chapter.no
    })
    for (const [name, count] of presence) addEdge(nodeId, name, '在场', count)
    for (const scene of scenes) {
      const target = sceneTermByName.get(scene.name)
      if (target) addEdge(nodeId, target.name, '发生于', 1)
    }
    for (const item of items) {
      const target = itemTermByName.get(item.name)
      if (target) addEdge(nodeId, target.name, '使用', 1)
    }
  }

  const maxApp = Math.max(...characters.map((c) => c.appearances), 1)
  const maxWeight = Math.max(...terms.map((t) => t.mentions), 1)
  const charGraph = {
    nodes: [
      ...characters.map((c) => ({ id: c.name, kind: 'person', r: 6 + Math.round(Math.sqrt(c.appearances / maxApp) * 10), label: c.name })),
      ...eventNodes,
      ...terms.map((t) => ({
        id: t.name,
        kind: t.kind === '场景' ? 'scene' : t.kind === '道具' ? 'item' : 'term',
        r: 6 + Math.round(Math.sqrt((t.mentions ?? 1) / maxWeight) * 7),
        label: t.name
      }))
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
    // 六槽位拆解交付物（kb/deconstruct/protocol）：gimmick / plot-design / intro / 文风九维
    slots: wiki?.slots ?? null,
    excerpts: wiki?.excerpts ?? [],
    // 状态台账（推演/一致性的终局快照）：谁知道什么 + 关键物/关系状态
    ledger: wiki?.ledger ?? null,
    // 枚举表（章节功能九类/核心情绪八种/结构六母型）
    enums: wiki?.enums ?? null,
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
/* ---------- 视觉强化层（作者 2026-11-13：精致好看） ----------
 * 从「文档排版」升级为「编辑设计（editorial design）」：
 * 封面主视觉渐变、KPI 迷你折线、分区序号强调、悬浮层次、表格斑马纹、数字等宽。 */
:root {
  --ink: #0b1220;
  --ink-2: #334155;
  --paper: #fbfcfe;
  --hairline: rgba(15, 23, 42, .07);
  --shadow-1: 0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06);
  --shadow-2: 0 4px 12px rgba(15,23,42,.06), 0 12px 32px rgba(15,23,42,.05);
  --shadow-lift: 0 10px 28px rgba(15,23,42,.10), 0 2px 6px rgba(15,23,42,.06);
  --serif: "Songti SC", "Noto Serif SC", "Source Han Serif SC", Georgia, serif;
}
body { background:
  radial-gradient(1100px 460px at 8% -8%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 62%),
  radial-gradient(900px 400px at 96% 4%, color-mix(in srgb, var(--warn) 7%, transparent), transparent 60%),
  var(--paper); }

/* 封面主视觉（概览首屏）*/
.hero { position:relative; overflow:hidden; border-radius:20px; padding:34px 34px 30px; margin:0 0 22px;
  background: linear-gradient(135deg, #0b1220 0%, #132441 48%, #1c3a63 100%); color:#eef4ff; box-shadow: var(--shadow-2); }
.hero::after { content:""; position:absolute; inset:0;
  background: radial-gradient(620px 300px at 88% 8%, rgba(122,162,255,.32), transparent 66%),
              radial-gradient(520px 260px at 6% 96%, rgba(255,180,84,.18), transparent 68%); pointer-events:none; }
.hero > * { position:relative; z-index:1; }
.hero .h-eyebrow { font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:#8fb0e8; margin-bottom:10px; }
.hero h1 { font-family:var(--serif); font-size:34px; line-height:1.24; font-weight:700; margin:0 0 14px; letter-spacing:-.01em; color:#fff; }
.hero .h-meta { display:flex; flex-wrap:wrap; gap:8px 16px; font-size:12.5px; color:#a9c0e4; margin-bottom:18px; }
.hero .h-meta b { color:#fff; font-weight:600; }
.hero .h-logline { font-size:15.5px; line-height:1.72; color:#dce8fb; max-width:74ch;
  border-left:2px solid rgba(143,176,232,.5); padding-left:14px; }
.hero .h-tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:16px; }
.hero .h-tags span { font-size:11.5px; padding:3px 10px; border-radius:999px;
  background:rgba(255,255,255,.10); border:1px solid rgba(255,255,255,.16); color:#cfe0ff; }

/* KPI 卡：加迷你折线与强调角标 */
.kpis { gap:14px; }
.kpi { position:relative; overflow:hidden; box-shadow:var(--shadow-1); border-color:var(--hairline);
  transition:transform .18s ease, box-shadow .18s ease; }
.kpi:hover { transform:translateY(-2px); box-shadow:var(--shadow-lift); }
.kpi .k-value { font-family:var(--serif); font-size:31px; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
.kpi .spark { position:absolute; right:10px; bottom:8px; opacity:.55; }
.kpi .k-label::before { content:""; display:inline-block; width:5px; height:5px; border-radius:50%;
  background:var(--accent); margin-right:7px; vertical-align:middle; }

/* 分区标题：序号强调条 */
#view h2 { position:relative; padding-left:15px; border-bottom:1px solid var(--hairline); font-weight:650; }
#view h2::before { content:""; position:absolute; left:0; top:52%; transform:translateY(-50%);
  width:3px; height:15px; border-radius:2px; background:linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 35%, transparent)); }
#view h2 small { margin-left:10px; }

/* 卡片/面板统一悬浮层次 */
.chartbox, .slotcard, .outline-ch, details.drill, .card { box-shadow:var(--shadow-1); border-color:var(--hairline); transition:box-shadow .18s ease, border-color .18s ease; }
.chartbox:hover, .slotcard:hover, .outline-ch:hover { box-shadow:var(--shadow-2); }
.outline-ch h3 { font-family:var(--serif); font-size:17.5px; font-weight:700; letter-spacing:-.005em; }
.outline-ch { position:relative; }
.outline-ch::before { content:""; position:absolute; left:0; top:14px; bottom:14px; width:2px; border-radius:2px;
  background:linear-gradient(180deg, var(--accent), transparent); opacity:.5; }

/* 剧情梗概：引言式排版 */
.summary { font-size:15px; line-height:1.95; color:var(--ink-2); position:relative;
  background:linear-gradient(180deg, var(--surface-warm), var(--surface)); box-shadow:var(--shadow-1); }
.summary::before { content:"“"; position:absolute; right:16px; top:2px; font-family:var(--serif); font-size:56px;
  color:color-mix(in srgb, var(--accent) 18%, transparent); line-height:1; }

/* 表格：斑马纹＋等宽数字＋首列强调 */
.kv tr:nth-child(even) td { background:color-mix(in srgb, var(--border-soft) 42%, transparent); }
.kv td:first-child { font-weight:600; color:var(--ink); letter-spacing:.01em; }
.kv td { font-variant-numeric:tabular-nums; }

/* 侧边栏：分组标题与激活态强化 */
#side { box-shadow:1px 0 0 var(--hairline); background:linear-gradient(180deg, var(--surface), color-mix(in srgb, var(--surface-warm) 60%, var(--surface))); }
#side h3 { color:var(--ink-2); font-weight:700; letter-spacing:.14em; }
.nav a { position:relative; transition:background .15s ease, color .15s ease, padding-left .15s ease; }
.nav a:hover { padding-left:14px; }
.nav a.on { background:color-mix(in srgb, var(--accent) 13%, transparent); }
.nav a.on::before { content:""; position:absolute; left:0; top:20%; bottom:20%; width:3px; border-radius:2px; background:var(--accent); }

/* chips / tags 微调 */
.chip { font-weight:500; }
.tag { border:1px solid var(--hairline); }

/* 图表盒内部留白与图例 */
.chartbox { padding:18px 20px 12px; }
.legend { line-height:2; }
.hover-read { font-variant-numeric:tabular-nums; letter-spacing:.01em; }

/* 事件卡（钻取层）：左侧色条 */
.event { border-left:2px solid color-mix(in srgb, var(--accent) 30%, transparent); }
.event .who { font-variant-numeric:normal; }
.event:hover { border-left-color:var(--accent); background:color-mix(in srgb, var(--accent) 4%, var(--surface)); }

/* 关系图谱容器 */
svg.relation { box-shadow:var(--shadow-1); border-color:var(--hairline); }

/* 页脚 */
#dsFooter { letter-spacing:.02em; }

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
/* 六槽位卡（kb/deconstruct/protocol 对齐） */
.slotcard { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px 18px; margin:10px 0; }
.slotcard .logline { font-size:17px; font-weight:600; color:var(--fg); line-height:1.5; letter-spacing:-0.01em; }
.kv { width:100%; border-collapse:collapse; margin-top:10px; font-size:13px; }
.kv td { padding:5px 10px 5px 0; vertical-align:top; line-height:1.6; }
.kv td:first-child { width:72px; color:var(--muted); white-space:nowrap; }
.kv tr + tr td { border-top:1px solid var(--border-soft); }
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
