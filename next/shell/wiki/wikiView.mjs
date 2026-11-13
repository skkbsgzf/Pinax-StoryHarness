/**
 * wiki 五页签的纯函数（S4 · WO-S4-02）。
 *
 * 数据只来自 `fact:wiki:get` 回来的 wiki JSON（deriveWiki 的产物），这里不做任何 IO：
 * 组件负责取数与画，读数一律在这里算——五页签的口径各只有一处，好测也好改。
 *
 * 词表：屏面用「条目／章节／伏笔」；伪章节书把「章」换成「节」（wiki.pseudoChapters）。
 */

export const WIKI_TABS = Object.freeze([
  { id: 'overview', label: '概览' },
  { id: 'matrix', label: '人物矩阵' },
  { id: 'timeline', label: '时间线' },
  { id: 'outline', label: '章纲' },
  { id: 'foreshadow', label: '伏笔' }
])

export const WIKI_TAB_IDS = Object.freeze(WIKI_TABS.map((tab) => tab.id))

export function isWikiTab(value) {
  return WIKI_TAB_IDS.includes(value)
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function text(value) {
  return String(value ?? '').trim()
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 有 wiki 数据才摆页签（沉默层）：空对象／缺派生字段都按「没有」处理。 */
export function hasWikiData(wiki) {
  if (!wiki || typeof wiki !== 'object') return false
  return list(wiki.chapters).length > 0
    || list(wiki.characters).length > 0
    || list(wiki.terms).length > 0
    || list(wiki.timeline).length > 0
}

/** 伪章节书用「节」，真章书用「章」。 */
export function wikiUnitLabel(wiki) {
  return wiki?.pseudoChapters === true ? '节' : '章'
}

const TERM_KIND_ORDER = ['设定', '场景', '道具']

/** 概览：条目总数、类型分布、章节／人物／伏笔计数、可溯源率。 */
export function buildWikiOverview(wiki) {
  const characters = list(wiki?.characters)
  const terms = list(wiki?.terms)
  const chapters = list(wiki?.chapters)
  const kindCount = new Map()
  for (const term of terms) {
    const kind = text(term?.kind) || '设定'
    kindCount.set(kind, (kindCount.get(kind) ?? 0) + 1)
  }
  const kinds = [...kindCount.keys()].sort((a, b) => {
    const left = TERM_KIND_ORDER.indexOf(a)
    const right = TERM_KIND_ORDER.indexOf(b)
    if (left !== right) return (left < 0 ? TERM_KIND_ORDER.length : left) - (right < 0 ? TERM_KIND_ORDER.length : right)
    return a.localeCompare(b, 'zh-Hans-CN')
  })
  const types = [
    { key: 'character', label: '人物', count: characters.length },
    ...kinds.map((kind) => ({ key: `term:${kind}`, label: kind, count: kindCount.get(kind) }))
  ].filter((type) => type.count > 0)
  const foreshadowTotal = chapters.reduce((sum, chapter) => sum + list(chapter?.foreshadow).length, 0)
  const traceable = number(wiki?.quality?.traceableRate)
  return {
    unit: wikiUnitLabel(wiki),
    entryTotal: types.reduce((sum, type) => sum + type.count, 0),
    types,
    chapterTotal: chapters.length,
    characterTotal: characters.length,
    foreshadowTotal,
    traceableRate: traceable === null ? null : Math.round(traceable * 1000) / 10
  }
}

/** 热力档：0 空，1–4 由占最大值的比例分四档（视觉分档，不是裁断）。 */
export function heatLevel(value, max) {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0) return 0
  const peak = Number(max)
  if (!Number.isFinite(peak) || peak <= 0) return 1
  return Math.max(1, Math.min(4, Math.ceil((count / peak) * 4)))
}

/** 人物矩阵：人物 × 章节出场段数（按总出场取前 limit 人）。 */
export function buildWikiMatrix(wiki, { limit = 24 } = {}) {
  const chapters = list(wiki?.chapters)
  const characters = list(wiki?.characters)
  const matrix = list(wiki?.matrix)
  const rows = characters.map((character, index) => {
    const values = list(matrix[index]).map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0))
    return { name: text(character?.name), values, total: values.reduce((sum, value) => sum + value, 0) }
  }).filter((row) => row.name && row.total > 0)
  rows.sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  const top = rows.slice(0, limit)
  const max = Math.max(0, ...top.flatMap((row) => row.values))
  return {
    unit: wikiUnitLabel(wiki),
    chapters: chapters.map((chapter) => ({ no: chapter?.no, title: text(chapter?.title) })),
    rows: top.map((row) => ({
      ...row,
      cells: row.values.map((value) => ({ value, level: heatLevel(value, max) }))
    })),
    max
  }
}

const CHANNEL_LABELS = Object.freeze({
  say: '说',
  do: '做',
  think: '想',
  feel: '感',
  perceive: '察',
  state: '状态',
  event: '事件'
})

/** 时间线：按章归并事件（who／渠道／原文）。 */
export function buildWikiTimeline(wiki) {
  const unit = wikiUnitLabel(wiki)
  return list(wiki?.timeline).map((chapter) => ({
    no: chapter?.no,
    title: text(chapter?.title),
    unit,
    events: list(chapter?.events).map((event) => ({
      who: text(event?.who) || '—',
      channel: text(event?.channel),
      channelLabel: CHANNEL_LABELS[text(event?.channel)] ?? '其他',
      text: text(event?.text)
    }))
  }))
}

/** 章纲：章标题／梗概／功能／情绪／新出场人物／伏笔条数。 */
export function buildWikiOutline(wiki) {
  const unit = wikiUnitLabel(wiki)
  return list(wiki?.chapters).map((chapter) => ({
    no: chapter?.no,
    title: text(chapter?.title),
    unit,
    summary: text(chapter?.summary),
    function: text(chapter?.function),
    emotion: text(chapter?.emotion),
    newChars: list(chapter?.newChars).map((name) => text(name)).filter(Boolean),
    foreshadow: list(chapter?.foreshadow).map((item) => text(item)).filter(Boolean)
  }))
}

/** 伏笔：摊平成「第 N 章 · 原文」。 */
export function buildWikiForeshadows(wiki) {
  const unit = wikiUnitLabel(wiki)
  const rows = []
  for (const chapter of list(wiki?.chapters)) {
    for (const item of list(chapter?.foreshadow)) {
      const body = text(item)
      if (!body) continue
      rows.push({ no: chapter?.no, title: text(chapter?.title), unit, text: body })
    }
  }
  return rows
}
