/**
 * 宿主形态词表（协议 v1.2 P18–P21）。M2.5-C 起这里只剩「词」——状态机与持久化搬去了
 * next/shell/workspace.mjs（四轴：placement／minimized／geometry／restore）。
 *
 * 为什么保留这个文件：正文里「打开方式」的菜单顺序与文案是宿主词汇，被 AppNext、设置页与
 * 后续命令面共用；把它们和状态机拆开，词表改文案不会牵动状态。PANE_FORMS 与 workspace 的
 * PLACEMENTS 必须逐项相等（workspace.test.mjs 有一条断言钉住这件事）。
 */

/** 宿主支持的打开位置（P18 词表）。顺序即右键菜单的展示顺序。 */
export const PANE_FORMS = Object.freeze(['dock', 'split', 'overlay', 'fullscreen'])

/** 缺省位置：左键点竖条格＝回到停靠栏（P19「左键默认行为＝defaultForm，缺省 dock」）。 */
export const DEFAULT_PANE_FORM = 'dock'

/** 右键「打开方式」菜单的文案（宿主词汇，载体不自带文案）。 */
export const PANE_FORM_LABELS = Object.freeze({
  dock: '停靠栏',
  split: '在分屏中打开',
  overlay: '在浮窗中打开',
  fullscreen: '全屏'
})

/** 老键前缀：迁移只用一次（next/shell/workspaceMigration.mjs 读，成功后删）。 */
export const PANE_FORM_STORAGE_PREFIX = 'paneForm.'

export function isPaneForm(value) {
  return PANE_FORMS.includes(value)
}

/**
 * 把清单里的 forms 数组收成宿主词表内的形态（去重、按词表顺序）。
 * 词表外的形态不报错、也不出现在菜单里——P18「未声明的形态不出现」。
 * 清单层的「拒装」归内核校验器；渲染层只做最后一道过滤，不让陌生值漏进状态机。
 */
export function sanitizePaneForms(value) {
  if (!Array.isArray(value)) return []
  const declared = new Set(value.filter((item) => typeof item === 'string'))
  return PANE_FORMS.filter((form) => declared.has(form))
}

export function paneFormStorageKey(paneId) {
  return `${PANE_FORM_STORAGE_PREFIX}${String(paneId ?? '')}`
}
