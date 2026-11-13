/**
 * 设置页字段规范（工单 P2 · 纯常量与纯函数）。
 *
 * 为什么单独成模块：字段行的度量（标签/控件/说明的间距、控件高度、输入宽度）与
 * 「本节默认值」「总览表」都是可测的纯数据，写进 SFC 就只能靠肉眼看——这里一份，
 * SFC 只负责把这些数摆上屏（经 CSS 变量注入），单测直接读同一份。
 *
 * 边界：
 *   - 不碰 DOM、不碰 IPC、不读文件——渲染层能引，node 单测也能引；
 *   - 默认值是 next/runtime/appPreferences.mjs 的 PREFS_DEFAULTS 的镜像。为什么镜像而不是引用：
 *     appPreferences.mjs 顶部引 node:fs，渲染层引用会把 fs 拖进外壳产物（薄渲染层门禁）。
 *     镜像不会悄悄漂移——next/tests/settings-fields.test.mjs 把两边逐个键对账。
 *   - 总览表的「层/文件」是静态映射（工单 P2-4：数据源＝prefs:get 返回值＋静态层/文件映射）。
 */

/* —— P2-1 字段行度量 ————————————————————————————————————————————————
 * 标签在上（--nx-fs-2xs／600／--text-muted）、控件在下（高 36 或 40）、说明再一行
 * （--nx-fs-2xs／--text-muted）。节内字段间距 16，节间距 32；输入类宽 ≤480，
 * 长文本 textarea 的 min-height 96。CSS 侧一律引这些变量，不另写裸值。 */
export const FIELD_GAP = 16
export const SECTION_GAP = 32
export const CONTROL_HEIGHT = 36
export const CONTROL_HEIGHT_TALL = 40
export const INPUT_MAX_WIDTH = 480
export const TEXTAREA_MIN_HEIGHT = 96

/** 注入到节根节点的 CSS 变量表（SFC 模板 :style 用；纯函数便于单测逐键对账）。 */
export function fieldStyleVars() {
  return {
    '--settings-field-gap': `${FIELD_GAP}px`,
    '--settings-section-gap': `${SECTION_GAP}px`,
    '--settings-control-height': `${CONTROL_HEIGHT}px`,
    '--settings-control-height-tall': `${CONTROL_HEIGHT_TALL}px`,
    '--settings-input-max': `${INPUT_MAX_WIDTH}px`,
    '--settings-textarea-min': `${TEXTAREA_MIN_HEIGHT}px`
  }
}

/* —— P2-2 保存模型 ————————————————————————————————————————————————
 * 每节标题下一句话说明「我改的东西什么时候生效」，二选一，不许留下让作者猜的节。 */
export const SAVE_MODEL = Object.freeze({ explicit: 'explicit', instant: 'instant' })

const SAVE_MODEL_TEXT = Object.freeze({
  [SAVE_MODEL.explicit]: '显式保存：改完点「保存并生效」才写入。',
  [SAVE_MODEL.instant]: '即时保存：改动即写，不用另存。'
})

/** 未知模型给空串（宁可不写，也不编一句错误的承诺）。 */
export function saveModelNote(model) {
  return SAVE_MODEL_TEXT[model] ?? ''
}

/* —— P2-2 显式保存前的就地校验 ————————————————————————————————
 * 返回 patch 与逐字段错误：错误按字段名给出，SFC 摆在对应控件下方，
 * 草稿原样保留（不许整节重置——那会让作者丢掉刚打的字）。 */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2

function isHttpEndpoint(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** 校验「偏好与模型」节的两项草稿；ok 时 patch 可直接交给 prefs:set（空端点归一为 null）。 */
export function validatePrefsDraft(draft = {}) {
  const errors = {}
  const endpoint = String(draft?.modelPlaneEndpoint ?? '').trim()
  if (endpoint && !isHttpEndpoint(endpoint)) {
    errors.modelPlaneEndpoint = '端点要写成 http(s)://… 的形式，或者留空用默认地址。'
  }
  const zoomRaw = draft?.uiZoom
  const zoom = Number(zoomRaw)
  if (zoomRaw === '' || zoomRaw === null || zoomRaw === undefined || !Number.isFinite(zoom) || zoom < ZOOM_MIN || zoom > ZOOM_MAX) {
    errors.uiZoom = `界面缩放要在 ${ZOOM_MIN}–${ZOOM_MAX} 之间。`
  }
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    patch: {
      modelPlaneEndpoint: endpoint || null,
      uiZoom: errors.uiZoom ? null : zoom
    }
  }
}

/* —— P2-3 恢复本节默认 ————————————————————————————————————————————
 * 只重置本节字段：patch 里只出现该节的键，别的偏好（写作排版、通知水位、最近库）
 * 一个都不动。主题不在这一份里——它选完即时生效、走既有换肤事件，不归「保存」这条线。 */
export const SECTION_RESET_DEFAULTS = Object.freeze({
  prefs: Object.freeze({ modelPlaneEndpoint: null, uiZoom: null })
})

/** 该节有没有「恢复本节默认」这一档（没有可重置字段的节不摆死按钮）。 */
export function canResetSection(sectionId) {
  return Object.prototype.hasOwnProperty.call(SECTION_RESET_DEFAULTS, sectionId)
}

/** 本节默认值的一份拷贝；没有这一节返回 null（调用方据此不渲染按钮）。 */
export function resetSectionDefaults(sectionId) {
  const defaults = SECTION_RESET_DEFAULTS[sectionId]
  return defaults ? { ...defaults } : null
}

/** 把默认值并进当前偏好（只用于预览/断言；落盘仍走 prefs:set 的 patch 语义）。 */
export function applySectionReset(prefs, sectionId) {
  const patch = resetSectionDefaults(sectionId)
  if (!patch) return null
  return { ...(prefs && typeof prefs === 'object' ? prefs : {}), ...patch }
}

/* —— P2-4 设置总览（只读） ————————————————————————————————————————
 * 列出每个应用级键、所属层、文件、当前值。层/文件是静态映射，值来自 prefs:get。
 * 键表与 PREFS_DEFAULTS 逐个对账（单测），加字段忘了进总览会红。 */
export const OVERVIEW_LAYER = '应用'
export const OVERVIEW_FILE = 'next-preferences.json'

export const OVERVIEW_KEYS = Object.freeze([
  'modelPlaneEndpoint',
  'uiZoom',
  'historyIntervalMinutes',
  'writingFontSize',
  'writingLineHeight',
  'writingParagraphSpacing',
  'writingTextIndent',
  'writingTypewriter',
  'writingFocusMode',
  'serviceNoticesAckedAt',
  'theme',
  'recentProjects'
])

/** 值的一行摘要：字符串带引号（空串与 null 能分开看），对象/数组走 JSON，其余原样。 */
export function formatOverviewValue(value) {
  if (value === undefined) return 'null'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 总览表的行：key／layer／file／value（显示用）／raw（复制用）。 */
export function buildOverviewRows(prefs) {
  const source = prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {}
  return OVERVIEW_KEYS.map((key) => ({
    key,
    layer: OVERVIEW_LAYER,
    file: OVERVIEW_FILE,
    value: formatOverviewValue(source[key]),
    raw: source[key] === undefined ? null : source[key]
  }))
}

/** 「复制为 JSON」的正文：{ 键: { layer, file, value } }，保持文件里的原值（不二次编码）。 */
export function overviewJson(rows) {
  const out = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.key) continue
    out[row.key] = { layer: row.layer, file: row.file, value: row.raw ?? null }
  }
  return JSON.stringify(out, null, 2)
}
