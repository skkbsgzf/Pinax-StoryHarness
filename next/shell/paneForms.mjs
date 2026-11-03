/**
 * 载体清单 `panes[].forms` 的词表与文案的单一来源（批次61 · 作者裁定③「形态切换多用右键，
 * 不必做成死按钮」）：页签右键与窗头右键弹出的那一份「形态」菜单据此列项，
 * 未声明的形态不出现在菜单里（P18）。批次59 那句「只作兼容读，新代码不要 import」随本批作废——
 * 那时死的是消费端，12 份清单的 `forms` 声明一直是活的。
 *
 * v3 状态轴（next/shell/workspace.mjs）的落点映射见 FORM_ACTIONS：
 *   dock     → 占为页（留在当前页组）
 *   split    → 移到对面页组（对半）
 *   overlay  → 浮出为窗
 * 批次66（前置裁定 Q2）：两个在 v3 没有独立落点的旧词（整窗占满类形态）从词表删除——
 * 页态天然铺满，浮窗的双击另有子态；登记未采用照 chain 先例（见 carrierManifest.paneSemantics）。
 * 词表三值与 FORM_ACTIONS 一一同构，「声明了形态却没有落点」这条口子从此不存在。
 */

/** 协议词表（清单与宿主描述符都用这三个值；批次66 起与状态机落点一一同构）。 */
export const PANE_FORMS = Object.freeze(['dock', 'split', 'overlay'])

/** 词表三值的落点表（批次66 起与 PANE_FORMS 一一同构：有词必有动作，不存在「声明了却没落点」）。 */
export const FORM_ACTIONS = Object.freeze({
  dock: { action: 'dock', label: '占为页' },
  split: { action: 'side', label: '移到侧页组（对半）' },
  overlay: { action: 'float', label: '浮出为窗' }
})

/** 缺省形态（批次61 起＝页：`form:'page'`）。旧值 `dock` 只作兼容读。 */
export const DEFAULT_PANE_FORM = 'dock'

/**
 * 菜单动作 → v3 形态的映射（宿主 applyFormAction 与单测共用这一张表）：
 * 右键菜单发的是清单词表里的动作名，状态机认的是 v3 形态，两边各留一份表迟早对不上。
 * `side` 的落点也是页态——「分屏」是页组的存在，宿主随后再把它搬进对面那一组。
 * `close` 不在这里：它删记录，不是第四种形态。
 */
export const MENU_TARGET_FORM = Object.freeze({ dock: 'page', side: 'page', float: 'floating', tab: 'tab' })

/** 词表文案（菜单与宿主描述符共用；批次66 起与 PANE_FORMS 三值一一对应）。 */
export const PANE_FORM_LABELS = Object.freeze({
  dock: '停靠栏',
  split: '分屏',
  overlay: '浮窗'
})

/** 右键菜单里「页操作」那一组：不属于 forms 词表（v3 自有形态与关闭），故恒在。 */
export const PAGE_ACTIONS = Object.freeze([
  { action: 'tab', label: '收成侧缘标签' },
  { action: 'close', label: '关闭这一页' }
])

/** 老键前缀：迁移只用一次（next/shell/workspaceMigration.mjs 读，成功后删）。 */
export const PANE_FORM_STORAGE_PREFIX = 'paneForm.'

export function isPaneForm(value) {
  return PANE_FORMS.includes(value)
}

/**
 * 把清单里的 forms 数组收进宿主词表内的形态（去重、按词表顺序）。
 * 词表外的形态不报错、也不出现在菜单里——P18「未声明的形态不出现」。
 * 清单层的「拒装」归内核校验器；渲染层只做最后一道过滤，不让陌生值漏进状态机。
 */
export function sanitizePaneForms(value) {
  if (!Array.isArray(value)) return []
  const declared = new Set(value.filter((item) => typeof item === 'string'))
  return PANE_FORMS.filter((form) => declared.has(form))
}

/**
 * 形态菜单的那一组项＝`sanitizePaneForms(pane.forms)` ∩ 本批可落点。
 * 顺序跟词表（dock→split→overlay），项里带上 v3 的落点动作，菜单组件只管画与发。
 */
export function formMenuItems(value) {
  return sanitizePaneForms(value)
    .filter((form) => FORM_ACTIONS[form])
    .map((form) => ({ form, ...FORM_ACTIONS[form] }))
}

export function paneFormStorageKey(paneId) {
  return `${PANE_FORM_STORAGE_PREFIX}${String(paneId ?? '')}`
}
