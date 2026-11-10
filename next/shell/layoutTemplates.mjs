/**
 * 载体布局模板登记表（批次59 · 协议 v1.3（批次59 窗口模型工作名） 铁律四）。
 *
 * 作者原话：「布局按载体性质走模板，左栏不是标配」。于是宿主只认三种模板：
 *
 *   folder   左树＋文档窗（正文／剧本／设定与资料合并体……）
 *   web       左肥右窄的看板（世界书：条目表＋详情节，没有树）
 *   gallery   无左栏网格（素材；批次60 接线，这里先登记）
 *
 * 这是宿主渲染层词汇，不进协议 schema（@4 一字不改）。载体不写 layout：宿主按 pane 的
 * `kind`／id 推断——`entries-workspace` 与 `worldbook.*` 是 web，其余缺省 folder。
 * 载体若显式写了 `board.layout` 以它为准（仍只认登记表里的词，词表外忽略）。
 *
 * 左树因此从「每载体标配」降级为 folder 模板里的一个 pane：web／gallery 不渲染 IndexWindow。
 */

export const LAYOUT_TEMPLATES = Object.freeze(['folder', 'web', 'gallery'])
export const DEFAULT_LAYOUT_TEMPLATE = 'folder'

export const LAYOUT_TEMPLATE_LABELS = Object.freeze({
  folder: '文件夹',
  web: '看板',
  gallery: '图库'
})

/** 模板里挂哪些 pane 位（宿主据此决定渲不渲染树；载体清单不用声明）。 */
export const TEMPLATE_SLOTS = Object.freeze({
  folder: Object.freeze(['tree', 'center']),
  web: Object.freeze(['center']),
  gallery: Object.freeze(['gallery'])
})

const WEB_PANE_KINDS = new Set(['entries-workspace'])
/** 图库模板的 pane id 前缀（批次60：素材；宿主据此不渲染左树、改出网格画廊）。 */
const GALLERY_PANE_PREFIXES = Object.freeze(['material.'])

export function isLayoutTemplate(value) {
  return LAYOUT_TEMPLATES.includes(value)
}

/** 词表外的声明一律当没写（P18「未声明的形态不出现」的同一原则）。 */
export function sanitizeLayoutTemplate(value) {
  return isLayoutTemplate(value) ? value : null
}

/**
 * 单块 pane 的模板推断：显式声明 > kind > id 前缀 > 缺省 folder。
 * 只读 pane 上已有的字段，不改清单、不加 schema。
 */
export function inferLayoutTemplate(pane = {}) {
  if (!pane || typeof pane !== 'object') return DEFAULT_LAYOUT_TEMPLATE
  const explicit = sanitizeLayoutTemplate(pane.layout ?? pane.template)
  if (explicit) return explicit
  const kind = typeof pane.kind === 'string' ? pane.kind : ''
  const id = typeof pane.id === 'string' ? pane.id : ''
  if (WEB_PANE_KINDS.has(kind) || id.startsWith('worldbook.')) return 'web'
  // 批次60：素材＝无左栏网格（卡片点击才开记录窗）。用 id 前缀认，不用 kind——
  // records-editor 是记录型载体的共用面孔，按 kind 认会把漫画／视频等一并拖进图库。
  if (GALLERY_PANE_PREFIXES.some((prefix) => id.startsWith(prefix))) return 'gallery'
  return DEFAULT_LAYOUT_TEMPLATE
}

/**
 * 一个载体（board）的模板：显式 `layout` 优先，其次看它的任一 pane 推断；
 * 一个载体只能有一套骨架，所以「只要有 pane 是 web」就按 web。
 */
export function layoutTemplateForBoard(board = {}) {
  if (!board || typeof board !== 'object') return DEFAULT_LAYOUT_TEMPLATE
  const explicit = sanitizeLayoutTemplate(board.layout)
  if (explicit) return explicit
  const panes = Array.isArray(board.panes) ? board.panes : []
  const inferred = panes.map((pane) => inferLayoutTemplate(pane))
  if (inferred.includes('web')) return 'web'
  if (inferred.includes('gallery')) return 'gallery'
  return DEFAULT_LAYOUT_TEMPLATE
}

export function templateHasTree(template) {
  return (TEMPLATE_SLOTS[sanitizeLayoutTemplate(template) ?? DEFAULT_LAYOUT_TEMPLATE] ?? []).includes('tree')
}
