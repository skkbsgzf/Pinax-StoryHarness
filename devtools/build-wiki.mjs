/**
 * 世界书 Wiki 生成器（作者 2026-11-12：把两本书的世界书 Wiki 建起来）。
 *
 * 输入：D:\短篇选题库\拆解\<id>.json（fact.data/v3 条目 + 拆解读数）
 * 输出：D:\短篇选题库\wiki\<id>\ 下的静态 HTML（单文件，无外部依赖、可直接双击打开）
 *
 * 设计原则：**全部确定性派生，不调模型**。
 *   · 人物页：identity 空就从事件里派生（首次出场、活动章节、关键台词、共现人物）；
 *   · 地点页：where 模型没填就从事件文本里抽地名（确定性规则）；
 *   · 章节页：按 provenance.chapters 分组，展示该章全部事件；
 *   · 关系图：直接用 relations 边，按类型分组渲染成文字版关系网。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const LIB = argOf('--lib', 'D:/短篇选题库')
const OUT_ROOT = join(LIB, 'wiki')

function argOf(prefix, fallback = null) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const ids = process.argv.slice(2).filter((item) => !item.startsWith('--'))
const esc = (value) => String(value ?? '')
  .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')

/**
 * 地点抽取（确定性，但**保守**）。
 *
 * 实测教训：中文地名边界靠「后缀词表」判不准——会把「万的房」「他还去了我公司」当地点。
 * 所以这里只收**形态干净**且**反复出现**的：
 *   · 前面必须是「在/去/到/进/回/从/往」这类位移动词，否则不算；
 *   · 候选里不能含代词/助词/动词（我你他 的 了 是 去 在 有 这 那 …）；
 *   · 全书出现 ≥3 次才建页（一次性的场景不算条目）。
 * 一本书里地点本来就不多——「末世囤货」这种题材模型判 where=未明示其实是对的，
 * 强行抽只会产出噪声，所以宁可少建页。
 */
const PLACE_SUFFIX = '(?:室|厅|房|楼|店|站|路|街|巷|山|洞|城|镇|村|公园|广场|中心|公司|学校|大学|医院|餐厅|咖啡厅|公寓|别墅|酒店|商场|超市|银行|机场|车站|厨房|卧室|客厅|书房|阳台|门口|走廊|电梯|厕所|办公室|会议室|大厅|小区)'
const PLACE_CLEAN = /^[\u4e00-\u9fa5]{2,6}$/u
const PLACE_FORBIDDEN = /[我你他她它们的了着过是在有这那哪什怎为因为所以如果虽然已经就都也又而但和与同对把被让给和从向往]/u

function extractPlaces(text) {
  const source = String(text ?? '')
  const counts = new Map()
  const pattern = new RegExp(`(?:在|去|到|进|回|从|往)([\\u4e00-\\u9fa5]{2,6}?${PLACE_SUFFIX})`, 'gu')
  for (const match of source.matchAll(pattern)) {
    const raw = match[1]
    if (!raw || raw.length < 2) continue
    if (!PLACE_CLEAN.test(raw)) continue
    if (PLACE_FORBIDDEN.test(raw)) continue
    counts.set(raw, (counts.get(raw) ?? 0) + 1)
  }
  // 只留反复出现的（≥3 次）：一次性场景不建条目页。
  return [...counts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1])
}

function deriveCharacter(entry, plots, relations) {
  const name = entry.name
  const aliases = entry.aliases ?? []
  const involved = plots.filter((plot) => {
    if ((plot.who ?? []).includes(name)) return true
    if ((plot.who ?? []).some((who) => aliases.includes(who))) return true
    return (plot.events ?? []).some((event) => event.who === name || aliases.includes(event.who))
  })
  // 章号取 validity.from（compile 落在这里）；provenance.chapters 是旧路径。
  const chapters = [...new Set(involved.map((plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : null)).filter(Number.isInteger))].sort((a, b) => a - b)

  // 台词：优先用 anchors.speech，没有就从事件里挑 say 通道
  const speech = [
    ...(entry.anchors?.speech ?? []),
    ...involved.flatMap((plot) => (plot.events ?? []).filter((event) => event.channel === 'say' && event.who === name).map((event) => event.content))
  ]

  // 行为
  const behavior = [
    ...(entry.anchors?.behavior ?? []),
    ...involved.flatMap((plot) => (plot.events ?? []).filter((event) => event.channel === 'do' && event.who === name).map((event) => event.content))
  ]

  // 共现人物：和该角色出现在同一段里的人
  const cooccur = new Map()
  for (const plot of involved) {
    for (const other of plot.who ?? []) {
      if (other === name || aliases.includes(other)) continue
      cooccur.set(other, (cooccur.get(other) ?? 0) + 1)
    }
  }

  // 该角色参与的关系边
  const edges = relations.filter((edge) => edge.from === name || edge.to === name || aliases.includes(edge.from) || aliases.includes(edge.to))

  // 出场地点（从该角色所在事件文本里抽）
  const places = extractPlaces(involved.flatMap((plot) => (plot.events ?? []).map((event) => event.content)).join('\n'))

  return {
    name,
    aliases,
    identity: entry.identity || '',
    traits: entry.traits ?? [],
    castRole: entry.castRole ?? null,
    appearances: involved.length,
    chapters,
    firstAppearance: involved.length ? involved[0] : null,
    // 过滤碎片：块切片会在句中断开，产出「对林逸道：」这类残句。小于 8 字的不进档案。
    speech: [...new Set(speech)].filter((line) => String(line).trim().length >= 8).slice(0, 12),
    behavior: [...new Set(behavior)].filter((line) => String(line).trim().length >= 8).slice(0, 12),
    cooccur: [...cooccur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    edges,
    places: places.slice(0, 8),
    memoryPoints: entry.memoryPoints ?? []
  }
}

const CSS = `
:root { --bg:#12141a; --panel:#1a1d26; --line:#2a2f3d; --text:#e6e8ee; --dim:#9aa3b5; --accent:#7aa2ff; --warm:#ffb454; --green:#7ddc9a; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
a { color:var(--accent); text-decoration:none; }
a:hover { text-decoration:underline; }
.wrap { max-width:1080px; margin:0 auto; padding:32px 24px 80px; }
h1 { font-size:28px; margin:0 0 8px; letter-spacing:.5px; }
h2 { font-size:20px; margin:36px 0 12px; padding-bottom:8px; border-bottom:1px solid var(--line); }
h3 { font-size:16px; margin:24px 0 8px; color:var(--warm); }
.meta { color:var(--dim); font-size:13px; margin-bottom:24px; }
.meta span + span::before { content:" · "; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; }
.card h4 { margin:0 0 6px; font-size:16px; }
.card .sub { color:var(--dim); font-size:12px; }
.tag { display:inline-block; background:#232838; color:var(--dim); border-radius:4px; padding:1px 7px; font-size:12px; margin:2px 4px 2px 0; }
.tag.warm { background:#3a2c18; color:var(--warm); }
.tag.green { background:#183222; color:var(--green); }
ul { margin:6px 0; padding-left:20px; }
li { margin:3px 0; }
.quote { border-left:2px solid var(--accent); padding-left:12px; color:#cfd6e6; margin:6px 0; }
.event { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px 14px; margin:8px 0; }
.event .who { color:var(--warm); font-weight:600; }
.event .ch { color:var(--dim); font-size:12px; }
.bar { height:6px; background:#232838; border-radius:3px; overflow:hidden; }
.bar > i { display:block; height:100%; background:var(--accent); }
.top { display:flex; justify-content:space-between; align-items:baseline; gap:16px; flex-wrap:wrap; }
.back { font-size:13px; color:var(--dim); }
.stat { display:flex; gap:22px; flex-wrap:wrap; margin:16px 0 8px; }
.stat div b { display:block; font-size:22px; color:var(--accent); }
.stat div span { font-size:12px; color:var(--dim); }
`

function page({ title, body, back = null }) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="wrap">
${back ? `<div class="back"><a href="${esc(back)}">← 返回</a></div>` : ''}
${body}
</div></body></html>`
}

export function buildBook(id) {
  const result = JSON.parse(readFileSync(join(LIB, '拆解', `${id}.json`), 'utf8'))
  const book = result.book
  const plots = result.entries.filter((entry) => entry.layer === 'plot')
  const characters = result.entries.filter((entry) => entry.layer === 'character')
  const relations = result.entries.flatMap((entry) => entry.relations ?? [])
  const personNames = new Set(characters.map((entry) => entry.name))
  // 关系端点不一定都是人物（「山洞」「仓库钥匙」是地点/物品）——只有人物才给链接，否则纯文本，
  // 避免死链（实测 100 个链接里 34 个断在非人物目标上）。
  const linkPerson = (name) => (personNames.has(name)
    ? `<a href="person-${encodeURIComponent(name)}.html">${esc(name)}</a>`
    : `<span>${esc(name)}</span>`)

  const derived = characters.map((entry) => deriveCharacter(entry, plots, relations))
  // 章号优先取 validity（compile 落在这里）；provenance.chapters 是旧路径的写法。
  const chapterOf = (plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : null)
  const chapters = [...new Set(plots.map(chapterOf).filter(Number.isInteger))].sort((a, b) => a - b)
  const places = extractPlaces(plots.flatMap((plot) => (plot.events ?? []).map((event) => event.content)).join('\n'))

  const dir = join(OUT_ROOT, id)
  mkdirSync(dir, { recursive: true })

  // ---------- 人物页 ----------
  for (const [index, person] of derived.entries()) {
    const edgeRows = person.edges.map((edge) => {
      const other = edge.from === person.name ? edge.to : edge.from
      const dir2 = edge.from === person.name ? '→' : '←'
      return `<li>${dir2} ${linkPerson(other)} <span class="tag">${esc(edge.type)}</span>${edge.how ? ` <span class="sub">${esc(edge.how)}</span>` : ''}</li>`
    }).join('')
    const body = `
<div class="top">
  <div><h1>${esc(person.name)}</h1>
  <div class="meta"><span>《${esc(book.title)}》</span><span>${person.appearances} 段出场</span>${person.chapters.length ? `<span>第 ${person.chapters.join('、')} 章</span>` : ''}${person.castRole?.tier ? `<span>剧作档：${esc(person.castRole.tier)}</span>` : ''}</div></div>
</div>
${person.aliases.length ? `<div>${person.aliases.map((alias) => `<span class="tag">别名：${esc(alias)}</span>`).join('')}</div>` : ''}
${person.identity ? `<h2>身份</h2><p>${esc(person.identity)}</p>` : ''}
${person.traits.length ? `<h2>性格线索</h2><div>${person.traits.map((traits) => `<span class="tag warm">${esc(traits)}</span>`).join('')}</div>` : ''}
${person.speech.length ? `<h2>台词（${person.speech.length}）</h2>${person.speech.map((line) => `<div class="quote">“${esc(line)}”</div>`).join('')}` : ''}
${person.behavior.length ? `<h2>行为（${person.behavior.length}）</h2><ul>${person.behavior.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}
${person.cooccur.length ? `<h2>同场人物</h2><ul>${person.cooccur.map(([other, count]) => `<li>${linkPerson(other)} <span class="sub">${count} 段同场</span></li>`).join('')}</ul>` : ''}
${edgeRows ? `<h2>关系</h2><ul>${edgeRows}</ul>` : ''}
${person.places.length ? `<h2>活动地点</h2><div>${person.places.map(([place, count]) => `<span class="tag green">${esc(place)} ×${count}</span>`).join('')}</div>` : ''}
${person.memoryPoints.length ? `<h2>记忆点</h2><ul>${person.memoryPoints.map((point) => `<li>${esc(point)}</li>`).join('')}</ul>` : ''}
`
    writeFileSync(join(dir, `person-${encodeURIComponent(person.name)}.html`), page({
      title: `${person.name} · ${book.title}`, body, back: 'index.html'
    }), 'utf8')
  }

  // ---------- 章节页 ----------
  const chapterList = []
  for (const chapter of chapters) {
    const chapterPlots = plots.filter((plot) => chapterOf(plot) === chapter)
    const events = chapterPlots.flatMap((plot) => (plot.events ?? []).map((event) => ({ ...event, plot })))
    const people = [...new Set(chapterPlots.flatMap((plot) => plot.who ?? []))]
    const body = `
<h1>第 ${chapter} 章</h1>
<div class="meta"><span>《${esc(book.title)}》</span><span>${chapterPlots.length} 段</span><span>${events.length} 个事件</span></div>
${people.length ? `<div>${people.map((person) => `${linkPerson(person)}`).join('')}</div>` : ''}
<h2>事件</h2>
${events.map((event) => `<div class="event"><span class="who">${esc(event.who || '（未标注）')}</span> <span class="ch">[${esc(event.channel)}]</span><div>${esc(event.content)}</div></div>`).join('')}
`
    const file = `chapter-${chapter}.html`
    writeFileSync(join(dir, file), page({ title: `第 ${chapter} 章 · ${book.title}`, body, back: 'index.html' }), 'utf8')
    chapterList.push({ chapter, plots: chapterPlots.length, events: events.length, people })
  }

  // ---------- 地点页 ----------
  for (const [place, count] of places) {
    const inPlace = plots.filter((plot) => (plot.events ?? []).some((event) => String(event.content).includes(place)))
    const people = [...new Set(inPlace.flatMap((plot) => plot.who ?? []))]
    const body = `
<h1>${esc(place)}</h1>
<div class="meta"><span>《${esc(book.title)}》</span><span>${count} 次出现</span></div>
${people.length ? `<div>${people.map((person) => `${linkPerson(person)}`).join('')}</div>` : ''}
<h2>相关段落</h2>
${inPlace.slice(0, 12).map((plot) => (plot.events ?? []).filter((event) => String(event.content).includes(place)).map((event) => `<div class="event"><span class="who">${esc(event.who || '—')}</span><div>${esc(event.content)}</div></div>`).join('')).join('')}
`
    writeFileSync(join(dir, `place-${encodeURIComponent(place)}.html`), page({
      title: `${place} · ${book.title}`, body, back: 'index.html'
    }), 'utf8')
  }

  // ---------- 关系页 ----------
  const TYPE_ORDER = ['情侣', '亲属', '朋友', '同伴', '交易', '持有', '位于', '隶属']
  const byType = new Map()
  for (const edge of relations) {
    const type = edge.type || '其他'
    if (!byType.has(type)) byType.set(type, [])
    byType.get(type).push(edge)
  }
  const relationBody = `
<h1>关系图谱</h1>
<div class="meta"><span>《${esc(book.title)}》</span><span>${relations.length} 条关系</span><span>${byType.size} 种类型</span></div>
${[...byType.entries()].sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0])).map(([type, edges]) => `
<h2>${esc(type)}（${edges.length}）</h2>
<ul>${edges.map((edge) => `<li>${linkPerson(edge.from)} → ${linkPerson(edge.to)}${edge.how ? ` <span class="sub">${esc(edge.how)}</span>` : ''}</li>`).join('')}</ul>`).join('')}
`
  writeFileSync(join(dir, 'relations.html'), page({ title: `关系图谱 · ${book.title}`, body: relationBody, back: 'index.html' }), 'utf8')

  // ---------- 总览 ----------
  const tierCount = derived.reduce((acc, person) => {
    const tier = person.castRole?.tier ?? 'unrated'
    acc[tier] = (acc[tier] ?? 0) + 1
    return acc
  }, {})
  const topPeople = [...derived].sort((a, b) => b.appearances - a.appearances)
  const indexBody = `
<h1>${esc(book.title)}</h1>
<div class="meta">
  <span>${esc(book.author || '佚名')}</span>
  <span>${book.word_count ?? '?'} 字</span>
  <span>${esc(book.subject_group ?? '')}</span>
  <span>${esc(book.length_tier ?? '')}</span>
  ${book.url ? `<span><a href="${esc(book.url)}">番茄原文</a></span>` : ''}
</div>
<div class="stat">
  <div><b>${plots.length}</b><span>剧情条目</span></div>
  <div><b>${derived.length}</b><span>人物</span></div>
  <div><b>${relations.length}</b><span>关系</span></div>
  <div><b>${places.length}</b><span>地点</span></div>
  <div><b>${((result.quality?.traceableRate ?? 0) * 100).toFixed(1)}%</b><span>可溯源</span></div>
</div>
<h2>人物（${derived.length}）</h2>
<div class="grid">
${topPeople.map((person) => `<div class="card">
  <h4><a href="${esc(`person-${encodeURIComponent(person.name)}.html`)}">${esc(person.name)}</a></h4>
  <div class="sub">${person.appearances} 段 · ${person.chapters.length} 章${person.castRole?.tier ? ` · ${esc(person.castRole.tier)}` : ''}</div>
  ${person.traits.length ? `<div>${person.traits.slice(0, 3).map((traits) => `<span class="tag warm">${esc(traits)}</span>`).join('')}</div>` : ''}
  ${person.speech.length ? `<div class="sub" style="margin-top:6px">“${esc(person.speech[0].slice(0, 32))}”</div>` : ''}
</div>`).join('')}
</div>
<h2>章节（${chapters.length}）</h2>
<div class="grid">
${chapterList.map((item) => `<div class="card"><h4><a href="${esc(`chapter-${item.chapter}.html`)}">第 ${item.chapter} 章</a></h4><div class="sub">${item.plots} 段 · ${item.events} 事件 · ${item.people.length} 人</div></div>`).join('')}
</div>
${places.length ? `<h2>地点（${places.length}）</h2><div>${places.slice(0, 30).map(([place, count]) => `<a class="tag green" href="${esc(`place-${encodeURIComponent(place)}.html`)}">${esc(place)} ×${count}</a>`).join('')}</div>` : ''}
<h2>关系图谱</h2>
<p><a href="relations.html">查看全部 ${relations.length} 条关系 →</a></p>
<h2>数据说明</h2>
<ul>
  <li>全部内容由 <strong>fact.data/v3</strong> 条目确定性派生，未调用模型二次创作。</li>
  <li>可溯源 ${((result.quality?.traceableRate ?? 0) * 100).toFixed(1)}%：事件正文能在原文逐字找到。</li>
  <li>人物档案里的台词/行为直接取自该角色在原文中的言行，不是概括。</li>
  <li>地点由事件文本按后缀规则抽取（室/厅/楼/店/…），可能含少量噪声。</li>
</ul>
`
  writeFileSync(join(dir, 'index.html'), page({ title: `${book.title} · 世界书`, body: indexBody }), 'utf8')

  return { id, title: book.title, dir, characters: derived.length, chapters: chapters.length, places: places.length, relations: relations.length, plots: plots.length }
}

// 直接执行时才跑（被 import 时只取 buildBook）
if (process.argv[1] && process.argv[1].endsWith('build-wiki.mjs')) {
if (!ids.length) {
  console.error('用法：node build-wiki.mjs <book_id> [book_id...]')
  process.exit(1)
}

const built = ids.map(buildBook)
console.log(JSON.stringify(built, null, 2))
}
