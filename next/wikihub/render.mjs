import { OTHER_SLOT, WORLDVIEW_SLOTS, WORLDVIEW_SLOT_NAMES } from './pediaSchema.mjs'

/**
 * wikihub 离线视图渲染器（pedia/v1 hub → 单文件 HTML）。
 *
 * 作者口径（2026-11-09）：NovelPedia 那种「左侧索引树 ＋ 右上 Infobox ＋ 正文蓝色站内链接」
 * 最顺手——导航逻辑照搬，皮相换成 Pinax Next 的（字体走 --font-interface、字号只走
 * --nx-fs-* 五档、圆角走 --nx-radius-*、主题色走老前端的 --archive-* 调色板、带暗色）。
 *
 * 三条铁律：
 *   1) 自闭环：产物是一个 HTML，样式与脚本全内联，零 CDN、零外部字体、零 fetch——
 *      断网双击就能读（这是「离线知识库」的最低承诺）；
 *   2) 站内闭环：条目名／别名／relations／正文里的 @《…》 全部渲染成 #/e/<id> 蓝链，
 *      目标一定在本次快照里（没收录的如实标「未收录」，不造一个空页）；
 *   3) 不执行数据的 HTML：正文是 markdown 的一个受限子集，先转义再组装，原始 HTML 不生效。
 *
 * 本文件不 import Node 内置模块（只 import 纯函数规范 pediaSchema），可以在浏览器侧复用；
 * 落盘那一半在 ./build.mjs。
 */

export const WIKIHUB_HTML_VERSION = 'wikihub-html/v1'

export const WIKIHUB_LAYER_ORDER = Object.freeze(['worldview', 'character', 'style', 'plot'])

export const WIKIHUB_LAYER_LABELS = Object.freeze({
  worldview: '世界观',
  character: '人物',
  style: '文风',
  plot: '剧情'
})

/** 11 个标准槽位的人话（NovelPedia 的槽位名照抄，读者不用再记英文）。 */
export const WIKIHUB_SLOT_LABELS = Object.freeze({
  power_levels: '力量等级',
  abilities: '技能与能力',
  rules: '规则与机制',
  locations: '地点',
  items: '物品',
  orgs: '组织与势力',
  roles: '身份与角色',
  creatures: '种族与生物',
  concepts: '概念与现象',
  events: '历史事件',
  other: '其他'
})

const SPAN_FIELDS = Object.freeze(['first_chapter', 'last_chapter', 'first_scene', 'last_scene', 'scene_count', 'chapter_count'])

/* ---------- 小工具 ---------- */

const HTML_ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (ch) => HTML_ESCAPES[ch])
}

const escapeAttr = escapeHtml

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function uniqueTexts(value) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const item of value) {
    const next = String(item ?? '').trim()
    if (!next || seen.has(next)) continue
    seen.add(next)
    out.push(next)
  }
  return out
}

function clip(value, limit) {
  const source = String(value ?? '').replace(/\s+/gu, ' ').trim()
  if (source.length <= limit) return source
  return `${source.slice(0, limit)}…`
}

function layerLabel(layer) {
  return WIKIHUB_LAYER_LABELS[layer] ?? String(layer ?? '')
}

function slotLabelOf(slot) {
  return WIKIHUB_SLOT_LABELS[slot] ?? String(slot ?? '')
}

function entryAnchor(id, innerHtml, extraAttrs = '') {
  return `<a class="wl" href="#/e/${escapeAttr(id)}" data-entry-link="${escapeAttr(id)}"${extraAttrs}>${innerHtml}</a>`
}

/* ---------- hub → 渲染模型 ---------- */

/**
 * 把 worldbookToHub 的结果（或任意 { entries } / 条目数组）整理成渲染模型。
 *
 * 返回 { version, book, domain, title, generatedAt, entries, layers, linkIndex, warnings, counts }。
 * warnings 是「视图侧」的问题（缺 id、重 id、未知槽位、条目不是对象），与世界书侧的
 * losses 分开记——这里只影响这一页怎么画，不改数据层口径。
 */
export function prepareHubModel(input, options = {}) {
  const hub = Array.isArray(input) ? { entries: input } : (isPlainObject(input) ? input : {})
  const now = options.generatedAt instanceof Date
    ? options.generatedAt.toISOString()
    : firstText(options.generatedAt) || new Date().toISOString()
  const book = firstText(options.book, hub.book, options.title, hub.title, '世界书')
  const domain = firstText(options.domain, hub.domain, book)
  const warnings = []
  const entries = []
  const seenIds = new Set()

  // 生成侧的提示（读盘失败、未递归的目录、世界书转换警告）也写进本页，离线读者能看到缺了什么。
  for (const notice of Array.isArray(options.notices) ? options.notices : []) {
    const message = typeof notice === 'string' ? notice : text(notice?.message)
    if (message) warnings.push({ code: 'NOTICE', message })
  }

  const rawEntries = Array.isArray(hub.entries) ? hub.entries : []
  rawEntries.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      warnings.push({ code: 'ENTRY_NOT_OBJECT', message: `第 ${index + 1} 条不是对象，已跳过` })
      return
    }
    const entry = normalizeEntry(raw, index, warnings)
    if (seenIds.has(entry.id)) {
      warnings.push({ code: 'DUPLICATE_ID', message: `条目「${entry.name}」与已有条目同 id（${entry.id}），后一条未画进本页` })
      return
    }
    seenIds.add(entry.id)
    entries.push(entry)
  })

  sortEntries(entries)
  const linkIndex = buildLinkIndex(entries)
  const layers = buildLayerGroups(entries)
  return {
    version: WIKIHUB_HTML_VERSION,
    book,
    domain,
    title: firstText(options.title, `${book} 世界百科`),
    generatedAt: now,
    entries,
    layers,
    linkIndex,
    warnings,
    counts: {
      entries: entries.length,
      layers: layers.length,
      relations: entries.reduce((sum, entry) => sum + entry.relations.length, 0),
      links: linkIndex.size
    }
  }
}

function normalizeEntry(raw, index, warnings) {
  const snapshot = isPlainObject(raw.next?.worldbook) ? raw.next.worldbook : {}
  const layer = text(raw.layer).trim() || 'worldview'
  let slot = layer === 'worldview' ? (text(raw.slot).trim() || OTHER_SLOT) : text(raw.slot).trim()
  const name = firstText(raw.name, raw.title, raw.id, `未命名条目 ${index + 1}`)
  let id = firstText(raw.id)
  if (!id) {
    id = `entry-${index + 1}`
    warnings.push({ code: 'MISSING_ID', message: `条目「${name}」没有 pedia id，本页用占位 id ${id}` })
  }
  if (layer === 'worldview' && !WORLDVIEW_SLOTS[slot]) {
    warnings.push({ code: 'UNKNOWN_SLOT', message: `条目「${name}」的槽位「${slot}」不认识，按 other 显示` })
    slot = OTHER_SLOT
  }
  const aliases = uniqueTexts(raw.aliases)
  const tags = uniqueTexts(Array.isArray(snapshot.tags) ? snapshot.tags : raw.tags)
  const span = isPlainObject(raw.span) ? raw.span : null
  const relations = (Array.isArray(raw.relations) ? raw.relations : [])
    .filter((relation) => isPlainObject(relation) && typeof relation.to === 'string' && relation.to.trim())
    .map((relation) => ({
      to: relation.to.trim(),
      type: text(relation.type).trim(),
      how: text(relation.how).trim()
    }))
  const definition = typeof raw.definition === 'string' ? raw.definition : ''
  const content = typeof snapshot.content === 'string' ? snapshot.content : ''
  const type = firstText(snapshot.type, snapshot.kind, raw.type)
  const status = firstText(snapshot.status, raw.status)
  const path = firstText(snapshot.path, raw.provenance?.source?.path, raw.path)
  const revision = Number.isSafeInteger(snapshot.revision) ? snapshot.revision : 0
  const chars = Number.isSafeInteger(snapshot.chars) ? snapshot.chars : content.length
  const updatedAt = firstText(snapshot.updatedAt, raw.updatedAt)
  const rank = Number.isSafeInteger(raw.rank) && raw.rank >= 1 ? raw.rank : null
  const domain = text(raw.domain).trim()
  const slotLabel = layer === 'worldview' ? slotLabelOf(slot) : ''
  const search = [
    name,
    ...aliases,
    ...tags,
    type,
    status,
    slotLabel,
    layerLabel(layer)
  ].filter(Boolean).join(' ').toLowerCase()

  return {
    id,
    name,
    layer,
    slot,
    slotLabel,
    rank,
    domain,
    definition,
    content,
    type,
    status,
    path,
    revision,
    chars,
    updatedAt,
    aliases,
    tags,
    relations,
    span,
    search
  }
}

function sortEntries(entries) {
  const layerOrder = (layer) => {
    const index = WIKIHUB_LAYER_ORDER.indexOf(layer)
    return index < 0 ? WIKIHUB_LAYER_ORDER.length : index
  }
  const slotOrder = (slot) => {
    const index = WORLDVIEW_SLOT_NAMES.indexOf(slot)
    return index < 0 ? WORLDVIEW_SLOT_NAMES.length : index
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')
  entries.sort((a, b) => {
    const byLayer = layerOrder(a.layer) - layerOrder(b.layer)
    if (byLayer !== 0) return byLayer
    if (a.layer !== b.layer) return a.layer.localeCompare(b.layer)
    const bySlot = slotOrder(a.slot) - slotOrder(b.slot)
    if (bySlot !== 0) return bySlot
    if (a.layer === 'worldview' && WORLDVIEW_SLOTS[a.slot]?.ordered) {
      const rankA = a.rank ?? Number.MAX_SAFE_INTEGER
      const rankB = b.rank ?? Number.MAX_SAFE_INTEGER
      if (rankA !== rankB) return rankA - rankB
    }
    return byName(a, b)
  })
}

/**
 * 蓝链词表：条目名优先；别名只在「全快照里唯一指向一条」时才收。
 * 歧义别名宁可不链——链错一条比链不上更糟。
 */
function buildLinkIndex(entries) {
  const index = new Map()
  const aliasOwners = new Map()
  for (const entry of entries) {
    if (!index.has(entry.name)) index.set(entry.name, entry.id)
    for (const alias of entry.aliases) {
      if (!aliasOwners.has(alias)) aliasOwners.set(alias, [])
      aliasOwners.get(alias).push(entry.id)
    }
  }
  for (const [alias, owners] of aliasOwners) {
    if (owners.length !== 1 || index.has(alias)) continue
    index.set(alias, owners[0])
  }
  return index
}

function buildLayerGroups(entries) {
  const order = []
  const byLayer = new Map()
  for (const entry of entries) {
    if (!byLayer.has(entry.layer)) {
      byLayer.set(entry.layer, [])
      order.push(entry.layer)
    }
    byLayer.get(entry.layer).push(entry)
  }
  const known = (layer) => {
    const index = WIKIHUB_LAYER_ORDER.indexOf(layer)
    return index < 0 ? WIKIHUB_LAYER_ORDER.length : index
  }
  order.sort((a, b) => known(a) - known(b) || a.localeCompare(b))
  return order.map((layer) => {
    const list = byLayer.get(layer)
    const groups = []
    if (layer === 'worldview') {
      const bySlot = new Map()
      for (const entry of list) {
        if (!bySlot.has(entry.slot)) bySlot.set(entry.slot, [])
        bySlot.get(entry.slot).push(entry)
      }
      for (const slot of WORLDVIEW_SLOT_NAMES) {
        if (bySlot.has(slot)) groups.push({ key: slot, label: slotLabelOf(slot), entries: bySlot.get(slot) })
      }
      for (const [slot, slotEntries] of bySlot) {
        if (WORLDVIEW_SLOTS[slot]) continue
        groups.push({ key: slot, label: slotLabelOf(slot), entries: slotEntries })
      }
    } else {
      groups.push({ key: layer, label: layerLabel(layer), entries: list })
    }
    return { layer, label: layerLabel(layer), entries: list, groups }
  })
}

/* ---------- 内联 markdown（转义优先，只认受限子集） ---------- */

function buildVocabulary(linkIndex) {
  const words = [...linkIndex.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b))
  const byFirst = new Map()
  for (const word of words) {
    const first = word[0]
    if (!byFirst.has(first)) byFirst.set(first, [])
    byFirst.get(first).push(word)
  }
  return {
    matchWord(source, at) {
      const bucket = byFirst.get(source[at])
      if (!bucket) return null
      for (const word of bucket) {
        if (source.startsWith(word, at)) return { word, id: linkIndex.get(word) }
      }
      return null
    }
  }
}

function renderRefToken(title, token, ctx) {
  const id = ctx.linkIndex.get(title)
  if (id) return entryAnchor(id, escapeHtml(token), ' data-ref-token="1"')
  return `<span class="wl wl-missing" title="当前快照里没有「${escapeAttr(title)}」">${escapeHtml(token)}</span>`
}

function renderMarkdownLink(label, target, ctx) {
  if (/^#\/e\/[0-9A-Za-z_-]+$/u.test(target)) {
    const id = target.slice(4)
    if (ctx.linkIndexById.has(id)) return entryAnchor(id, renderInline(label, ctx))
  }
  if (target.startsWith('#')) {
    return `<a class="wl" href="${escapeAttr(target)}">${renderInline(label, ctx)}</a>`
  }
  // 站外/项目内文件引用不产生 href：离线快照旁边没有那个文件，链出去只会 404。
  return `${renderInline(label, ctx)}<span class="md-ref" title="离线快照不包含这个引用目标">（${escapeHtml(target)}）</span>`
}

/** 行内扫描器：代码 → 加粗 → 斜体 → 链接 → @《…》 → 蓝链词表 → 普通字符。 */
function renderInline(source, ctx) {
  const raw = String(source ?? '')
  let out = ''
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]

    if (ch === '`') {
      const end = raw.indexOf('`', i + 1)
      if (end > i) {
        out += `<code>${escapeHtml(raw.slice(i + 1, end))}</code>`
        i = end + 1
        continue
      }
      out += '`'
      i += 1
      continue
    }

    if (raw.startsWith('**', i)) {
      const end = raw.indexOf('**', i + 2)
      if (end > i + 2) {
        out += `<strong>${renderInline(raw.slice(i + 2, end), ctx)}</strong>`
        i = end + 2
        continue
      }
    }

    if (ch === '*') {
      const end = raw.indexOf('*', i + 1)
      if (end > i + 1 && raw.slice(i + 1, end).trim()) {
        out += `<em>${renderInline(raw.slice(i + 1, end), ctx)}</em>`
        i = end + 1
        continue
      }
    }

    if (ch === '[') {
      const link = /^\[([^\]\n]{1,200})\]\(([^)\s]{1,400})\)/u.exec(raw.slice(i))
      if (link) {
        out += renderMarkdownLink(link[1], link[2], ctx)
        i += link[0].length
        continue
      }
    }

    if (ch === '@' && raw.startsWith('@《', i)) {
      const ref = /^@《([^》\n]{1,80})》/u.exec(raw.slice(i))
      if (ref) {
        out += renderRefToken(ref[1].trim(), ref[0], ctx)
        i += ref[0].length
        continue
      }
    }

    const hit = ctx.vocabulary.matchWord(raw, i)
    if (hit) {
      out += entryAnchor(hit.id, escapeHtml(hit.word))
      i += hit.word.length
      continue
    }

    out += escapeHtml(ch)
    i += 1
  }
  return out
}

function splitTableRow(line) {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  return row.split('|').map((cell) => cell.trim())
}

function tryTable(lines, start, ctx) {
  const head = lines[start]
  if (!head.includes('|')) return null
  const separator = lines[start + 1]
  if (!separator || !separator.includes('|')) return null
  const headCells = splitTableRow(head)
  const separatorCells = splitTableRow(separator)
  if (headCells.length !== separatorCells.length) return null
  if (!separatorCells.every((cell) => /^:?-{2,}:?$/u.test(cell))) return null
  const aligns = separatorCells.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return ''
  })
  const body = []
  let cursor = start + 2
  while (cursor < lines.length && lines[cursor].trim() && lines[cursor].includes('|')) {
    body.push(splitTableRow(lines[cursor]))
    cursor += 1
  }
  const styleOf = (index) => (aligns[index] ? ` style="text-align:${aligns[index]}"` : '')
  const thead = headCells.map((cell, index) => `<th${styleOf(index)}>${renderInline(cell, ctx)}</th>`).join('')
  const rows = body.map((cells) => {
    const tds = headCells.map((_, index) => `<td${styleOf(index)}>${renderInline(cells[index] ?? '', ctx)}</td>`).join('')
    return `<tr>${tds}</tr>`
  }).join('')
  return {
    html: `<table class="md-table"><thead><tr>${thead}</tr></thead>${rows ? `<tbody>${rows}</tbody>` : ''}</table>`,
    next: cursor
  }
}

/** 受限 markdown 块解析：标题／段落／列表／引用／代码块／分隔线／表格。 */
function renderMarkdown(source, ctx) {
  const lines = String(source ?? '').replace(/\r\n?/gu, '\n').split('\n')
  const out = []
  let paragraph = []
  let i = 0
  const flush = () => {
    if (!paragraph.length) return
    out.push(`<p>${paragraph.map((line) => renderInline(line, ctx)).join('<br>')}</p>`)
    paragraph = []
  }

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      flush()
      i += 1
      continue
    }

    const fence = /^\s*```([\w-]*)\s*$/u.exec(line)
    if (fence) {
      flush()
      const body = []
      i += 1
      while (i < lines.length && !/^\s*```\s*$/u.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      const lang = fence[1] ? ` data-lang="${escapeAttr(fence[1])}"` : ''
      out.push(`<pre class="md-pre"${lang}><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/u.exec(line)
    if (heading) {
      flush()
      const level = Math.min(6, heading[1].length + 1)
      out.push(`<h${level}>${renderInline(heading[2], ctx)}</h${level}>`)
      i += 1
      continue
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      flush()
      out.push('<hr>')
      i += 1
      continue
    }

    if (/^\s*>/u.test(line)) {
      flush()
      const quote = []
      while (i < lines.length && /^\s*>/u.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/u, ''))
        i += 1
      }
      out.push(`<blockquote>${quote.map((item) => renderInline(item, ctx)).join('<br>')}</blockquote>`)
      continue
    }

    const table = tryTable(lines, i, ctx)
    if (table) {
      flush()
      out.push(table.html)
      i = table.next
      continue
    }

    const listItem = /^\s*(?:([-*+])|(\d+)\.)\s+(.*)$/u.exec(line)
    if (listItem) {
      flush()
      const ordered = Boolean(listItem[2])
      const items = []
      while (i < lines.length) {
        const item = /^\s*(?:([-*+])|(\d+)\.)\s+(.*)$/u.exec(lines[i])
        if (!item || Boolean(item[2]) !== ordered) break
        items.push(`<li>${renderInline(item[3], ctx)}</li>`)
        i += 1
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }

    paragraph.push(line)
    i += 1
  }
  flush()
  return out.join('\n')
}

/* ---------- 页面骨架 ---------- */

function infoboxRow(key, valueHtml, field) {
  return `<tr data-ib="${escapeAttr(field)}"><th scope="row">${escapeHtml(key)}</th><td>${valueHtml}</td></tr>`
}

function renderInfobox(entry) {
  const rows = [infoboxRow('名称', escapeHtml(entry.name), 'name')]
  if (entry.aliases.length) rows.push(infoboxRow('别名', entry.aliases.map(escapeHtml).join('、'), 'alias'))
  rows.push(infoboxRow('分类', escapeHtml(entry.layer === 'worldview' ? entry.slotLabel : layerLabel(entry.layer)), 'slot'))
  if (entry.domain) rows.push(infoboxRow('域', escapeHtml(entry.domain), 'domain'))
  if (entry.type) rows.push(infoboxRow('类型', escapeHtml(entry.type), 'type'))
  if (entry.status) rows.push(infoboxRow('状态', escapeHtml(entry.status), 'status'))
  if (entry.tags.length) {
    rows.push(infoboxRow('标签', entry.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(''), 'tags'))
  }
  if (entry.rank) rows.push(infoboxRow('序位', `第 ${entry.rank} 档`, 'rank'))
  if (entry.path) rows.push(infoboxRow('来源', `<span class="mono">${escapeHtml(entry.path)}</span>`, 'source'))
  if (entry.revision > 0) rows.push(infoboxRow('修订', `r${entry.revision}`, 'revision'))
  if (entry.chars > 0) rows.push(infoboxRow('篇幅', `${entry.chars} 字`, 'chars'))
  if (entry.relations.length) rows.push(infoboxRow('关系', `${entry.relations.length} 条`, 'relations'))
  if (entry.updatedAt) rows.push(infoboxRow('更新', escapeHtml(entry.updatedAt), 'updated'))
  const initial = [...entry.name][0] ?? '？'
  const subtitle = entry.definition ? clip(entry.definition, 56) : entry.slotLabel
  return [
    `<aside class="infobox" data-infobox="${escapeAttr(entry.id)}">`,
    `<div class="ib-h">${escapeHtml(entry.name)}<div class="sub">${escapeHtml(subtitle)}</div></div>`,
    `<div class="ib-av" aria-hidden="true"><span class="ini">${escapeHtml(initial)}</span></div>`,
    `<table>${rows.join('')}</table>`,
    '<div class="ib-note">由「世界书」离线快照生成 · pedia/v1</div>',
    '</aside>'
  ].join('')
}

function renderRelations(entry, ctx) {
  if (!entry.relations.length) return ''
  const items = entry.relations.map((relation) => {
    const id = ctx.linkIndex.get(relation.to)
    const target = id
      ? entryAnchor(id, escapeHtml(relation.to), ` data-relation-to="${escapeAttr(id)}"`)
      : `<span class="wl wl-missing" title="这条关系目标不在当前快照里">${escapeHtml(relation.to)}</span>`
    const type = relation.type ? `<span class="cat-badge">${escapeHtml(relation.type)}</span>` : ''
    const how = relation.how ? `<span class="rel-how">${renderInline(relation.how, ctx)}</span>` : ''
    return `<li>${target}${type}${how}</li>`
  })
  return [
    '<section class="sec" data-sec="relations">',
    `<h2>关系 <span class="sec-count">${entry.relations.length}</span></h2>`,
    `<ul class="rel-list">${items.join('')}</ul>`,
    '</section>'
  ].join('')
}

function siblingEntries(entry, model) {
  const sameSlot = entry.layer === 'worldview'
  return model.entries
    .filter((other) => other.id !== entry.id && other.layer === entry.layer && (!sameSlot || other.slot === entry.slot))
    .slice(0, 24)
}

function renderSiblings(entry, model) {
  const siblings = siblingEntries(entry, model)
  if (!siblings.length) return ''
  const chips = siblings.map((other) => entryAnchor(other.id, escapeHtml(other.name), ' data-sibling="1"'))
  return [
    '<section class="sec" data-sec="siblings">',
    `<h2>${entry.layer === 'worldview' ? '同类条目' : '同层条目'}</h2>`,
    `<div class="tag-cloud">${chips.join('')}</div>`,
    '</section>'
  ].join('')
}

function spanText(entry) {
  const span = entry.span
  if (!isPlainObject(span)) return ''
  for (const field of SPAN_FIELDS) {
    if (Number.isInteger(span[field])) return `第 ${span[field]} 章`
  }
  return ''
}

function renderArticle(entry, model, ctx) {
  const title = escapeHtml(entry.name)
  const label = entry.layer === 'worldview' ? entry.slotLabel : layerLabel(entry.layer)
  const crumb = [
    '<nav class="crumb" aria-label="位置">',
    '<a href="#/" data-crumb-home>总览</a><span class="sep">›</span>',
    `<span>${escapeHtml(layerLabel(entry.layer))}</span>`,
    entry.layer === 'worldview' ? `<span class="sep">›</span><span>${escapeHtml(entry.slotLabel)}</span>` : '',
    `<span class="sep">›</span><span>${title}</span>`,
    '</nav>'
  ].join('')
  const subtitleBits = [layerLabel(entry.layer)]
  if (entry.domain) subtitleBits.push(`域：${entry.domain}`)
  if (entry.type) subtitleBits.push(entry.type)
  const span = spanText(entry)
  if (span) subtitleBits.push(span)

  const parts = [
    `<article class="wiki-entry" id="wiki-entry-${escapeAttr(entry.id)}" data-entry="${escapeAttr(entry.id)}" data-title="${escapeAttr(entry.name)}" data-layer="${escapeAttr(entry.layer)}" data-slot="${escapeAttr(entry.slot)}" hidden>`,
    crumb,
    `<h1 class="art">${title}<span class="cat-badge">${escapeHtml(label)}</span></h1>`,
    `<p class="subtitle">${escapeHtml(subtitleBits.join(' · '))}</p>`,
    renderInfobox(entry)
  ]
  if (entry.definition.trim()) {
    parts.push(`<div class="lead">${renderInline(entry.definition, ctx)}</div>`)
  }
  const content = entry.content.trim()
  if (content && content !== entry.definition.trim()) {
    parts.push(`<section class="sec" data-sec="body"><h2>正文</h2>${renderMarkdown(content, ctx)}</section>`)
  } else if (!content) {
    parts.push('<p class="empty">这条只有摘要，没有正文（可能是从运行时读回的形状，正文没随快照进来）。</p>')
  }
  parts.push(renderRelations(entry, ctx))
  parts.push(renderSiblings(entry, model))
  parts.push(`<footer class="art-foot">pedia/v1 · ${escapeHtml(entry.layer)}${entry.slot ? ` · ${escapeHtml(entry.slot)}` : ''} · id ${escapeHtml(entry.id)}</footer>`)
  parts.push('</article>')
  return parts.join('')
}

function renderSidebar(model) {
  const defaultLayer = model.layers[0]?.layer
  const defaultGroup = model.layers[0]?.groups[0]?.key
  const parts = ['<aside class="side" aria-label="世界百科索引">']
  parts.push('<div class="side-search">')
  parts.push('<input id="wiki-search" type="search" placeholder="检索条目 / 别名 / 标签" aria-label="检索条目" autocomplete="off">')
  parts.push('<div class="search-count" id="wiki-search-count" aria-live="polite"></div>')
  parts.push('</div>')
  parts.push('<nav id="wiki-nav" aria-label="条目树">')
  parts.push('<a class="nav-home" href="#/" data-nav-home>总览</a>')
  for (const layer of model.layers) {
    parts.push(`<section class="layer" data-layer="${escapeAttr(layer.layer)}">`)
    parts.push(`<h3>${escapeHtml(layer.label)}<span class="layer-count">${layer.entries.length}</span></h3>`)
    for (const group of layer.groups) {
      const groupOpen = layer.layer === defaultLayer && group.key === defaultGroup
      parts.push(`<details class="grp" data-slot="${escapeAttr(group.key)}"${groupOpen ? ' open' : ''}>`)
      parts.push(`<summary><span class="grp-label">${escapeHtml(group.label)}</span><span class="grp-count">${group.entries.length}</span></summary>`)
      parts.push('<div class="items">')
      for (const entry of group.entries) {
        const attrs = ` data-nav-entry="${escapeAttr(entry.id)}" data-search="${escapeAttr(entry.search)}"`
        parts.push(entryAnchor(entry.id, escapeHtml(entry.name), attrs))
      }
      parts.push('</div>')
      parts.push('</details>')
    }
    parts.push('</section>')
  }
  parts.push('</nav>')
  parts.push('</aside>')
  return parts.join('')
}

function renderOverview(model) {
  const worldviews = model.entries.filter((entry) => entry.layer === 'worldview').length
  const stats = [
    ['条目', model.counts.entries],
    ['世界观', worldviews],
    ['软层', model.counts.entries - worldviews],
    ['关系', model.counts.relations]
  ]
  const parts = ['<section class="overview" id="wiki-overview">']
  parts.push(`<h1 class="art">${escapeHtml(model.book)}<span class="cat-badge">离线世界百科</span></h1>`)
  parts.push(`<p class="subtitle">pedia/v1 快照 · ${escapeHtml(model.generatedAt)} · 断网可读</p>`)
  parts.push(`<div class="statgrid">${stats.map(([key, value]) => `<div class="stat"><div class="k">${escapeHtml(key)}</div><div class="v">${value}</div></div>`).join('')}</div>`)
  if (model.warnings.length) {
    const items = model.warnings.slice(0, 12).map((warning) => `<li>${escapeHtml(warning.message)}</li>`).join('')
    const more = model.warnings.length > 12 ? `<p class="empty">另有 ${model.warnings.length - 12} 条提示未列出。</p>` : ''
    parts.push(`<div class="wiki-warning" role="note"><b>生成提示</b><ul>${items}</ul>${more}</div>`)
  }
  if (!model.entries.length) {
    parts.push('<p class="empty">世界书/ 里还没有可展示的条目。</p>')
  } else {
    parts.push('<p class="ov-tip">左侧索引按「层 → 槽位」分组；正文里的蓝色链接全部指向本快照内的条目，点开即可跳转。</p>')
    for (const layer of model.layers) {
      parts.push(`<section class="ov-layer"><h2>${escapeHtml(layer.label)}<span class="sec-count">${layer.entries.length}</span></h2>`)
      for (const group of layer.groups) {
        parts.push(`<div class="ov-slot" data-ov-slot="${escapeAttr(group.key)}">`)
        parts.push(`<h3>${escapeHtml(group.label)}</h3>`)
        parts.push(`<div class="tag-cloud">${group.entries.map((entry) => entryAnchor(entry.id, escapeHtml(entry.name), ' data-overview="1"')).join('')}</div>`)
        parts.push('</div>')
      }
      parts.push('</section>')
    }
  }
  parts.push('</section>')
  return parts.join('')
}

/* ---------- 样式与客户端脚本（全内联） ---------- */

/* 字体／字号／圆角：与 next/shell/styles/next-shell.css 同一套刻度；颜色：老前端 legacy.css 的调色板。 */
const BASE_TOKENS = `
  --font-interface: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Inter", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --nx-fs-2xs: 11px;
  --nx-fs-md: 13px;
  --nx-fs-lg: 15px;
  --nx-fs-xl: 17px;
  --nx-fs-2xl: 19px;
  --nx-radius-xs: 6px;
  --nx-radius-pill: 999px;
  --nx-section-gap: 18px;
  --radius-control: 10px;
  --radius-surface: 24px;
  --radius-popover: 16px;
`

const LIGHT_TOKENS = `
  --bg-primary: #f3f3f3;
  --bg-secondary: #ffffff;
  --bg-tertiary: #f3f3f3;
  --bg-hover: #e6e8eb;
  --text-primary: #1a1a1a;
  --text-secondary: #575b62;
  --text-muted: #6b7078;
  --accent: #0078d4;
  --accent-hover: #106ebe;
  --accent-light: rgba(0, 120, 212, 0.10);
  --border: #e1e3e7;
  --border-strong: #b5bac2;
  --archive-paper: #ffffff;
  --archive-paper-soft: #ffffff;
  --archive-paper-strong: #e1e3e7;
  --archive-ink: #1a1a1a;
  --archive-ink-soft: #575b62;
  --archive-olive: #0078d4;
  --archive-olive-strong: #106ebe;
  --hairline-soft: rgba(32, 33, 36, 0.08);
  --surface-workbench: #ffffff;
  --surface-workbench-raised: #ffffff;
  --surface-workbench-muted: #f3f3f2;
  --surface-workbench-input: #f0f0ef;
  --workbench-chrome: #f3f3f2;
  --workbench-selected: #e2e3e2;
`

const DARK_TOKENS = `
  --bg-primary: #1b1c1e;
  --bg-secondary: #131314;
  --bg-tertiary: #202124;
  --bg-hover: #292b2f;
  --text-primary: #f0f1f2;
  --text-secondary: #a9adb3;
  --text-muted: #969ba3;
  --accent: #96b1c6;
  --accent-hover: #b5c9d8;
  --accent-light: rgba(150, 177, 198, 0.12);
  --border: #303236;
  --border-strong: #45484e;
  --archive-paper: #131314;
  --archive-paper-soft: #1e1f20;
  --archive-paper-strong: #303236;
  --archive-ink: #edf0f3;
  --archive-ink-soft: #b1b5bc;
  --archive-olive: #96b1c6;
  --archive-olive-strong: #b5c9d8;
  --hairline-soft: rgba(255, 255, 255, 0.075);
  --surface-workbench: #131314;
  --surface-workbench-raised: #1e1f20;
  --surface-workbench-muted: #1b1c1e;
  --surface-workbench-input: #202124;
  --workbench-chrome: #1b1c1e;
  --workbench-selected: #303236;
`

const WIKIHUB_CSS = `
:root {
  color-scheme: light dark;
${BASE_TOKENS}${LIGHT_TOKENS}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${DARK_TOKENS}
  }
}
html[data-theme="dark"] {
${DARK_TOKENS}
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--surface-workbench-muted);
  color: var(--archive-ink);
  font-family: var(--font-interface);
  font-size: var(--nx-fs-lg);
  line-height: 1.7;
}
[hidden] { display: none !important; }
a { color: var(--archive-olive); text-decoration: none; }
a:hover { color: var(--archive-olive-strong); text-decoration: underline; }
:focus-visible { outline: 2px solid var(--archive-olive); outline-offset: 2px; }
.mono { font-family: var(--font-mono); font-size: var(--nx-fs-2xs); }

.topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 18px;
  background: var(--archive-paper);
  border-bottom: 1px solid var(--border);
}
.brand { font-size: var(--nx-fs-2xl); font-weight: 700; letter-spacing: 0.2px; }
.brand small { margin-left: 8px; font-size: var(--nx-fs-2xs); font-weight: 400; color: var(--text-muted); }
.topbar-meta { font-size: var(--nx-fs-2xs); color: var(--text-muted); }
.theme-btn {
  margin-left: auto;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--nx-radius-pill);
  background: var(--surface-workbench-raised);
  color: var(--archive-ink-soft);
  font: inherit;
  font-size: var(--nx-fs-2xs);
  cursor: pointer;
}
.theme-btn:hover { background: var(--bg-hover); }

.layout { display: flex; align-items: flex-start; max-width: 1480px; margin: 0 auto; }
.side {
  position: sticky;
  top: 53px;
  flex: 0 0 264px;
  height: calc(100vh - 53px);
  overflow-y: auto;
  padding: 12px 0 48px;
  background: var(--surface-workbench-muted);
  border-right: 1px solid var(--hairline-soft);
}
.side-search { padding: 0 14px 10px; }
.side-search input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-input);
  color: var(--archive-ink);
  font: inherit;
  font-size: var(--nx-fs-md);
}
.side-search input:focus { border-color: var(--archive-olive); }
.search-count { min-height: 16px; padding-top: 4px; font-size: var(--nx-fs-2xs); color: var(--text-muted); }
.side h3 {
  display: flex;
  justify-content: space-between;
  margin: 16px 14px 6px;
  font-size: var(--nx-fs-2xs);
  font-weight: 700;
  letter-spacing: 0.6px;
  color: var(--text-muted);
}
.layer-count, .grp-count, .sec-count { font-weight: 400; color: var(--text-muted); }
.nav-home,
.side .items a {
  display: block;
  padding: 4px 14px 4px 23px;
  border-left: 3px solid transparent;
  font-size: var(--nx-fs-md);
  color: var(--archive-olive);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nav-home { padding-left: 14px; font-weight: 600; }
.nav-home:hover,
.side .items a:hover { background: var(--accent-light); text-decoration: none; }
.nav-home.on,
.side .items a.on {
  background: var(--accent-light);
  border-left-color: var(--archive-olive);
  color: var(--archive-ink);
  font-weight: 600;
}
.grp { margin-bottom: 2px; }
.grp summary {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 14px;
  font-size: var(--nx-fs-md);
  color: var(--archive-ink-soft);
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.grp summary::-webkit-details-marker { display: none; }
.grp summary::before { content: '▸'; margin-right: 5px; color: var(--text-muted); }
.grp[open] > summary::before { content: '▾'; }
.grp summary:hover { background: var(--bg-hover); }
.grp .items { padding-bottom: 2px; }

.main { flex: 1 1 auto; min-width: 0; padding: 22px 34px 80px; }
.article-col { max-width: 990px; }

.crumb {
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.crumb .sep { margin: 0 6px; color: var(--border-strong); }
h1.art {
  margin: 0 0 4px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-strong);
  font-size: var(--nx-fs-2xl);
  font-weight: 700;
  line-height: 1.35;
}
.cat-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 9px;
  border: 1px solid var(--border);
  border-radius: var(--nx-radius-pill);
  background: var(--surface-workbench-raised);
  color: var(--archive-ink-soft);
  font-size: var(--nx-fs-2xs);
  font-weight: 400;
  vertical-align: middle;
}
.subtitle { margin: 4px 0 16px; font-size: var(--nx-fs-2xs); color: var(--text-muted); }

.infobox {
  float: right;
  width: 272px;
  margin: 4px 0 var(--nx-section-gap) 20px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-popover);
  background: var(--surface-workbench-muted);
  font-size: var(--nx-fs-md);
  line-height: 1.55;
  overflow: hidden;
}
.ib-h {
  padding: 9px 12px;
  background: var(--workbench-selected);
  border-bottom: 1px solid var(--border-strong);
  text-align: center;
  font-size: var(--nx-fs-lg);
  font-weight: 700;
}
.ib-h .sub { margin-top: 2px; font-size: var(--nx-fs-2xs); font-weight: 400; color: var(--text-secondary); }
.ib-av {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96px;
  background: var(--archive-paper);
  border-bottom: 1px solid var(--border);
}
.ini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--accent-light);
  color: var(--archive-olive);
  font-size: var(--nx-fs-xl);
  font-weight: 700;
}
.infobox table { width: 100%; border-collapse: collapse; }
.infobox th,
.infobox td { padding: 5px 10px; border-top: 1px solid var(--hairline-soft); text-align: left; vertical-align: top; font-size: var(--nx-fs-md); font-weight: 400; }
.infobox th { width: 62px; color: var(--text-secondary); white-space: nowrap; background: var(--surface-workbench-muted); }
.infobox td { background: var(--archive-paper); }
.ib-note { padding: 6px 10px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: var(--nx-fs-2xs); text-align: center; }

.lead { font-size: var(--nx-fs-lg); line-height: 1.8; }
.sec { margin-top: var(--nx-section-gap); }
.sec h2 {
  margin: 0 0 10px;
  padding-bottom: 3px;
  border-bottom: 1px solid var(--border);
  font-size: var(--nx-fs-xl);
  font-weight: 700;
}
.sec h3 { margin: 14px 0 6px; font-size: var(--nx-fs-lg); }
.sec h4, .sec h5, .sec h6 { margin: 12px 0 5px; font-size: var(--nx-fs-md); }
.sec p { margin: 0 0 10px; }
.sec ul, .sec ol { margin: 0 0 10px; padding-left: 22px; }
.sec li { margin-bottom: 4px; }
.sec hr { margin: 14px 0; border: 0; border-top: 1px solid var(--border); }
blockquote {
  margin: 0 0 10px;
  padding: 7px 12px;
  border-left: 3px solid var(--border-strong);
  background: var(--surface-workbench-raised);
  color: var(--archive-ink-soft);
  font-size: var(--nx-fs-md);
}
code {
  padding: 0 4px;
  border-radius: var(--nx-radius-xs);
  background: var(--surface-workbench-input);
  font-family: var(--font-mono);
  font-size: var(--nx-fs-md);
}
.md-pre {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-input);
  overflow-x: auto;
}
.md-pre code { padding: 0; background: transparent; }
.md-table { width: 100%; margin: 0 0 12px; border-collapse: collapse; font-size: var(--nx-fs-md); }
.md-table th, .md-table td { padding: 5px 9px; border: 1px solid var(--border); text-align: left; }
.md-table th { background: var(--surface-workbench-muted); }

.rel-list { margin: 0; padding: 0; list-style: none; }
.rel-list li { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; padding: 6px 0; border-bottom: 1px dashed var(--hairline-soft); }
.rel-how { color: var(--text-muted); font-size: var(--nx-fs-2xs); }
.tag-cloud { display: flex; flex-wrap: wrap; gap: 6px; }
.tag {
  display: inline-block;
  margin: 0 0 2px;
  padding: 1px 9px;
  border: 1px solid var(--border);
  border-radius: var(--nx-radius-pill);
  background: var(--surface-workbench-raised);
  color: var(--archive-ink-soft);
  font-size: var(--nx-fs-2xs);
  white-space: nowrap;
}
a.tag:hover { border-color: var(--archive-olive); color: var(--archive-olive); text-decoration: none; }
.wl { cursor: pointer; }
.wl:hover { text-decoration: underline; }
.wl-missing { color: var(--text-muted); border-bottom: 1px dotted var(--border-strong); cursor: help; }
.md-ref { color: var(--text-muted); font-size: var(--nx-fs-2xs); }
.art-foot { margin-top: var(--nx-section-gap); padding-top: 8px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: var(--nx-fs-2xs); }
.empty { padding: 10px 0; color: var(--text-muted); font-size: var(--nx-fs-md); }

.statgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: var(--nx-section-gap) 0; }
.stat { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface-workbench-raised); }
.stat .k { font-size: var(--nx-fs-2xs); color: var(--text-muted); }
.stat .v { font-size: var(--nx-fs-2xl); font-weight: 700; }
.ov-tip { color: var(--text-secondary); font-size: var(--nx-fs-md); }
.ov-layer { margin-top: var(--nx-section-gap); }
.ov-layer h2 { margin: 0 0 4px; padding-bottom: 3px; border-bottom: 1px solid var(--border); font-size: var(--nx-fs-xl); }
.ov-slot { margin-top: 10px; }
.ov-slot h3 { margin: 0 0 6px; font-size: var(--nx-fs-md); color: var(--text-secondary); }
.wiki-warning {
  margin: var(--nx-section-gap) 0;
  padding: 10px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-raised);
  font-size: var(--nx-fs-md);
}
.wiki-warning ul { margin: 6px 0 0; padding-left: 20px; }
.wiki-warning li { margin-bottom: 3px; }

noscript { display: block; padding: 10px 16px; background: var(--surface-workbench-raised); border-bottom: 1px solid var(--border); font-size: var(--nx-fs-md); }

@media (max-width: 900px) {
  .layout { display: block; }
  .side { position: static; width: auto; height: auto; border-right: 0; border-bottom: 1px solid var(--hairline-soft); }
  .main { padding: 18px 16px 60px; }
  .infobox { float: none; width: auto; margin: 0 0 var(--nx-section-gap); }
}
`

const CLIENT_SCRIPT = `(function () {
  'use strict'
  var data = {}
  try {
    var dataEl = document.getElementById('wikihub-data')
    data = JSON.parse((dataEl && dataEl.textContent) || '{}')
  } catch (error) {
    data = {}
  }
  var articles = Array.prototype.slice.call(document.querySelectorAll('article.wiki-entry'))
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('a[data-nav-entry]'))
  var homeLink = document.querySelector('a[data-nav-home]')
  var overview = document.getElementById('wiki-overview')
  var search = document.getElementById('wiki-search')
  var searchCount = document.getElementById('wiki-search-count')
  var themeButton = document.getElementById('wiki-theme')
  var baseTitle = (data.book || '世界百科') + ' · 世界百科'

  function entryIdFromHash() {
    var hash = String(window.location.hash || '')
    if (hash.indexOf('#/e/') !== 0) return ''
    var id = hash.slice(4)
    if (id.indexOf('/') >= 0 || id.indexOf('?') >= 0 || id.indexOf('#') >= 0) return ''
    try { return decodeURIComponent(id) } catch (error) { return id }
  }

  function currentTheme() {
    var attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'dark' || attr === 'light') return attr
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
    return 'light'
  }

  function syncThemeButton() {
    if (themeButton) themeButton.textContent = currentTheme() === 'dark' ? '浅色' : '深色'
  }

  function openAncestors(node) {
    var group = node && node.closest ? node.closest('details') : null
    while (group) {
      group.open = true
      var parent = group.parentElement
      group = parent && parent.closest ? parent.closest('details') : null
    }
  }

  function route() {
    var id = entryIdFromHash()
    var hit = null
    for (var i = 0; i < articles.length; i += 1) {
      if (articles[i].getAttribute('data-entry') === id) { hit = articles[i]; break }
    }
    for (var j = 0; j < articles.length; j += 1) articles[j].hidden = articles[j] !== hit
    if (overview) overview.hidden = Boolean(hit)
    var active = null
    for (var k = 0; k < navLinks.length; k += 1) {
      var isActive = Boolean(hit) && navLinks[k].getAttribute('data-nav-entry') === id
      navLinks[k].classList.toggle('on', isActive)
      if (isActive) active = navLinks[k]
    }
    if (homeLink) homeLink.classList.toggle('on', !hit)
    if (active) openAncestors(active)
    document.title = hit ? (hit.getAttribute('data-title') || '') + ' · 世界百科' : baseTitle
    if (hit && window.scrollTo) window.scrollTo(0, 0)
  }

  function applyFilter() {
    var query = search ? String(search.value || '').trim().toLowerCase() : ''
    var shown = 0
    for (var i = 0; i < navLinks.length; i += 1) {
      var link = navLinks[i]
      var haystack = link.getAttribute('data-search') || ''
      var match = !query || haystack.indexOf(query) >= 0
      link.hidden = !match
      if (match) shown += 1
    }
    var groups = document.querySelectorAll('#wiki-nav details')
    for (var g = 0; g < groups.length; g += 1) {
      var hasHit = groups[g].querySelector('a[data-nav-entry]:not([hidden])')
      groups[g].hidden = Boolean(query) && !hasHit
      if (query && hasHit) groups[g].open = true
    }
    if (searchCount) searchCount.textContent = query ? '命中 ' + shown + ' 条' : ''
  }

  window.addEventListener('hashchange', route)
  route()
  syncThemeButton()

  var stored = ''
  try { stored = window.localStorage.getItem('pinax.wikihub.theme') || '' } catch (error) { stored = '' }
  if (stored === 'dark' || stored === 'light') {
    document.documentElement.setAttribute('data-theme', stored)
    syncThemeButton()
  }

  if (themeButton) {
    themeButton.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      try { window.localStorage.setItem('pinax.wikihub.theme', next) } catch (error) { /* file:// 下存储可能被禁用 */ }
      syncThemeButton()
    })
  }

  if (window.matchMedia) {
    var media = window.matchMedia('(prefers-color-scheme: dark)')
    if (media && media.addEventListener) media.addEventListener('change', syncThemeButton)
  }

  if (search) {
    search.addEventListener('input', applyFilter)
    search.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return
      event.preventDefault()
      var first = document.querySelector('#wiki-nav a[data-nav-entry]:not([hidden])')
      if (first) window.location.hash = first.getAttribute('href')
    })
  }
})()
`

/* ---------- 组装文档 ---------- */

function serializeJsonForScript(value) {
  return JSON.stringify(value).replace(/</gu, '\\u003c')
}

export function renderHubHtml(input, options = {}) {
  const model = prepareHubModel(input, options)
  const ctx = {
    linkIndex: model.linkIndex,
    linkIndexById: new Set(model.entries.map((entry) => entry.id)),
    vocabulary: buildVocabulary(model.linkIndex)
  }

  const title = `${model.book} · 世界百科`
  const payload = {
    version: WIKIHUB_HTML_VERSION,
    generatedAt: model.generatedAt,
    book: model.book,
    domain: model.domain,
    entries: model.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      layer: entry.layer,
      slot: entry.slot,
      aliases: entry.aliases,
      tags: entry.tags,
      type: entry.type,
      status: entry.status,
      path: entry.path
    }))
  }

  const articles = model.entries.map((entry) => renderArticle(entry, model, ctx)).join('\n')
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="generator" content="pinax ${WIKIHUB_HTML_VERSION}">`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>${WIKIHUB_CSS}</style>`,
    '</head>',
    '<body>',
    '<header class="topbar">',
    `<div class="brand">${escapeHtml(model.book)}<small>世界百科</small></div>`,
    `<span class="topbar-meta">${model.entries.length} 条 · 快照 ${escapeHtml(model.generatedAt.slice(0, 10))}</span>`,
    '<button type="button" class="theme-btn" id="wiki-theme">深色</button>',
    '</header>',
    '<div class="layout">',
    renderSidebar(model),
    '<main class="main" id="wiki-main">',
    '<div class="article-col">',
    renderOverview(model),
    articles,
    '</div>',
    '</main>',
    '</div>',
    '<noscript>本页为离线快照：索引与正文已经在 HTML 里，跳转需要脚本（脚本随文件自带，不联网）。</noscript>',
    `<script type="application/json" id="wikihub-data">${serializeJsonForScript(payload)}</script>`,
    `<script>${CLIENT_SCRIPT}</script>`,
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

export default renderHubHtml
