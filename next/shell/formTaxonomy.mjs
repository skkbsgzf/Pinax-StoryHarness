/**
 * 形态三分类（批次44 · 作者 2026-10-31：「我希望你在**一开始**就想明白，每个类型的组件
 * 到底是用文档还是用 HTML 去实现 … 后续假如我们真的要把 ComfyUI 挪进来，
 * 那一定是要通过浏览器去把这个端口承载起来，而不可能说我们自己手搓一个组件」）。
 *
 * 三种形态，渲染器一律归宿主：
 *   文档面 document —— md 文档为主：宿主渲染阅读态（md → HTML）与编辑态（textarea）。
 *   看板面 board   —— 结构化数据（清单／表格／图谱）：宿主渲染视图，数据来自载体的 JSON 清单。
 *   应用面 app     —— 外部网页应用（ComfyUI 那种自带端口的服务）：宿主只给一块内嵌浏览器，
 *                    它的界面自己长，我们不手搓组件。
 *
 * 视图类型与形态一一对应（viewRegistry 的宿主视图类型就是这张表的取值）：
 *   文档面 → reader / editor
 *   看板面 → board / tree / list / graph / diff
 *   应用面 → app / custom（custom＝插件自带面板，也是「别人的页面，宿主只给一块地」）
 *
 * 跳转与悬浮的三条去处（同一份口径，界面层照它选形态）：
 *   1. 小窗：overlay 槽的浮窗（宿主渲染与定位，载体只声明意图）；
 *   2. 弹窗：上下文菜单／设置二级页（宿主 chrome）；
 *   3. 内嵌浏览器：应用面（外部端口上的服务，宿主给 iframe）。
 * 三条都是宿主的地盘——载体不自己开窗、不自己弹层。
 */

export const PANE_FORM = Object.freeze({
  DOCUMENT: 'document',
  BOARD: 'board',
  APP: 'app'
})

export const PANE_FORMS = Object.freeze([PANE_FORM.DOCUMENT, PANE_FORM.BOARD, PANE_FORM.APP])

/** 形态 → 视图类型（宿主注册的那些）。 */
export const FORM_VIEW_TYPES = Object.freeze({
  [PANE_FORM.DOCUMENT]: Object.freeze(['pinax.view.reader', 'pinax.view.editor']),
  [PANE_FORM.BOARD]: Object.freeze(['pinax.view.board', 'pinax.view.tree', 'pinax.view.list', 'pinax.view.graph', 'pinax.view.diff']),
  [PANE_FORM.APP]: Object.freeze(['pinax.view.app', 'pinax.view.custom'])
})

/** 内容面（kind）→ 形态。kind 是权威来源（协议 v3）：同一块 pane 说什么形态，就是什么形态。 */
export const KIND_FORMS = Object.freeze({
  'chapter-editor': PANE_FORM.DOCUMENT,
  'outline-editor': PANE_FORM.DOCUMENT,
  'notes-editor': PANE_FORM.DOCUMENT,
  'entry-detail': PANE_FORM.DOCUMENT,
  'script-editor': PANE_FORM.DOCUMENT,
  'rule-editor': PANE_FORM.DOCUMENT,
  'document-detail': PANE_FORM.DOCUMENT,
  'proposal-review': PANE_FORM.DOCUMENT,
  'records-editor': PANE_FORM.BOARD,
  'entries-workspace': PANE_FORM.BOARD,
  'entries-categories': PANE_FORM.BOARD,
  'external-app': PANE_FORM.APP,
  'custom-panel': PANE_FORM.APP
})

/** 视图类型 → 形态（反查表；词表外的视图类型一律当文档面——不认识就按最保守的来）。 */
export const VIEW_FORMS = Object.freeze(Object.entries(FORM_VIEW_TYPES).reduce((acc, [form, types]) => {
  for (const type of types) acc[type] = form
  return acc
}, {}))

export function formOfView(view) {
  return VIEW_FORMS[String(view ?? '')] ?? PANE_FORM.DOCUMENT
}

export function formOfKind(kind) {
  return KIND_FORMS[String(kind ?? '')] ?? null
}

export function isDocumentKind(kind) {
  return formOfKind(kind) === PANE_FORM.DOCUMENT
}

export function isBoardKind(kind) {
  return formOfKind(kind) === PANE_FORM.BOARD
}

export function isAppKind(kind) {
  return formOfKind(kind) === PANE_FORM.APP
}

export default { PANE_FORM, PANE_FORMS, FORM_VIEW_TYPES, KIND_FORMS, VIEW_FORMS, formOfView, formOfKind }
