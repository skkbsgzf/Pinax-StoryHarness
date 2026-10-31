/**
 * 协议 v1.2 的位置词表——批次59 起只作兼容读：渲染层不再有位置菜单，
 * 任何打开的内容都是同一扇 PaneWindow（状态机在 next/shell/workspace.mjs v2）。
 *
 * 保留文件的原因：宿主描述导出（next/testing/exportHostDescriptor.mjs）仍要给出
 * manifest.panes[].forms 的词表，12 份清单本身不动。新代码不要再 import 这里的
 * 词表来驱动界面；状态只认 geometry／z／minimized／maximized／tiledWith／tileSide。
 */

/** 旧词表（仅兼容导出用；界面不再据此列入口）。 */
export const PANE_FORMS = Object.freeze(['dock', 'split', 'overlay', 'fullscreen', 'immersive'])

/** 旧缺省位置（兼容读；批次59 后不存在「缺省位置」这一说）。 */
export const DEFAULT_PANE_FORM = 'dock'

/** 旧词表文案（兼容导出用）。 */
export const PANE_FORM_LABELS = Object.freeze({
  dock: '停靠栏',
  split: '分屏',
  overlay: '浮窗',
  fullscreen: '全屏',
  immersive: '沉浸'
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
