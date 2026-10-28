import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'
import { writeFileAtomic } from '../fs/atomicWrite.mjs'

/**
 * 应用级偏好存储（批次 8①：「偏好与模型」的死菜单收口）。
 *
 * 定位边界：
 *   - 项目无关（不进 .pinax/，不随项目走）——模型面端点、界面缩放是「这台机器上这个应用」的偏好；
 *   - 密钥永不入此文件——模型凭据仍由任务面（serve:pinax）持有，Next 只管「端点指到哪」；
 *   - 文件是 JSON、原子写（复用 fs/atomicWrite）；损坏时按默认值继续，不崩外壳。
 *
 * 合同（写进门禁的字段就这几个，加字段先改这里和 AppNext 的草稿表单）：
 *   modelPlaneEndpoint：null（用默认 8451）或 http(s)://… 字符串；
 *   uiZoom：null（用默认 0.85）或 0.5–2.0 的数字；
 *   historyIntervalMinutes：5（默认）或 0–120 的整数，0＝关闭定时快照（D1）；
 *   writingFontSize：17（默认，＝--nx-fs-lg）或 14–22 的整数——正文字号（工单B 写作偏好节）；
 *   writingLineHeight：1.9（默认）或 1.6–2.4、步进 0.05——正文行高（工单B 写作偏好节）；
 *   theme：可选迁移字段（D2）——'light' / 'dark' / null；缺省表示「还没迁过」，
 *     渲染层用老 localStorage 的值兜底并一次性迁入（老前端退役后删掉那条兜底）。
 */

export const PREFS_DEFAULTS = Object.freeze({
  modelPlaneEndpoint: null,
  uiZoom: null,
  historyIntervalMinutes: 5,
  // 工单B（novel.writing 写作偏好节）：正文字号与行高的应用级默认；
  // 与 next-shell.css 里 .editor-area 的 var() 回退值（--nx-fs-lg / 1.9）保持一致。
  writingFontSize: 17,
  writingLineHeight: 1.9
})

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const HISTORY_INTERVAL_MIN = 0
const HISTORY_INTERVAL_MAX = 120
const WRITING_FONT_SIZE_MIN = 14
const WRITING_FONT_SIZE_MAX = 22
const WRITING_LINE_HEIGHT_MIN = 1.6
const WRITING_LINE_HEIGHT_MAX = 2.4
/** 行高步进 0.05：用百分数判整，绕开 1.9 * 100 = 190.00000000000003 这类浮点尾巴。 */
const WRITING_LINE_HEIGHT_STEP_HUNDREDTHS = 5
const THEMES = new Set(['light', 'dark'])

export function isValidEndpoint(value) {
  if (value === null || value === undefined || value === '') return true
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizePrefs(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = { ...PREFS_DEFAULTS }
  if ('modelPlaneEndpoint' in source) {
    const value = source.modelPlaneEndpoint
    if (!isValidEndpoint(value)) return { ok: false, error: `modelPlaneEndpoint 必须是 http(s)://… 或 null，收到：${JSON.stringify(value ?? null)}` }
    out.modelPlaneEndpoint = value ? String(value).replace(/\/+$/, '') : null
  }
  if ('uiZoom' in source) {
    const value = source.uiZoom
    if (value === null || value === undefined || value === '') out.uiZoom = null
    else {
      const num = Number(value)
      if (!Number.isFinite(num) || num < ZOOM_MIN || num > ZOOM_MAX) return { ok: false, error: `uiZoom 必须在 ${ZOOM_MIN}–${ZOOM_MAX} 之间，收到：${JSON.stringify(value ?? null)}` }
      out.uiZoom = num
    }
  }
  if ('historyIntervalMinutes' in source) {
    const value = source.historyIntervalMinutes
    if (value === null || value === undefined || value === '') {
      out.historyIntervalMinutes = PREFS_DEFAULTS.historyIntervalMinutes
    } else {
      const num = typeof value === 'number' ? value : Number(String(value).trim())
      if (!Number.isInteger(num) || num < HISTORY_INTERVAL_MIN || num > HISTORY_INTERVAL_MAX) {
        return { ok: false, error: `historyIntervalMinutes 必须是 ${HISTORY_INTERVAL_MIN}–${HISTORY_INTERVAL_MAX} 的整数（0＝关闭），收到：${JSON.stringify(value ?? null)}` }
      }
      out.historyIntervalMinutes = num
    }
  }
  if ('writingFontSize' in source) {
    const value = source.writingFontSize
    if (value === null || value === undefined || value === '') {
      out.writingFontSize = PREFS_DEFAULTS.writingFontSize
    } else {
      const num = Number(value)
      if (!Number.isInteger(num) || num < WRITING_FONT_SIZE_MIN || num > WRITING_FONT_SIZE_MAX) {
        return { ok: false, error: `writingFontSize 必须是 ${WRITING_FONT_SIZE_MIN}–${WRITING_FONT_SIZE_MAX} 的整数，收到：${JSON.stringify(value ?? null)}` }
      }
      out.writingFontSize = num
    }
  }
  if ('writingLineHeight' in source) {
    const value = source.writingLineHeight
    if (value === null || value === undefined || value === '') {
      out.writingLineHeight = PREFS_DEFAULTS.writingLineHeight
    } else {
      const num = Number(value)
      if (!Number.isFinite(num) || num < WRITING_LINE_HEIGHT_MIN || num > WRITING_LINE_HEIGHT_MAX) {
        return { ok: false, error: `writingLineHeight 必须在 ${WRITING_LINE_HEIGHT_MIN}–${WRITING_LINE_HEIGHT_MAX} 之间，收到：${JSON.stringify(value ?? null)}` }
      }
      // 步进 0.05：百分数必须是 5 的倍数（1.75 ✓、1.91 ✗）；存回两位小数，避免浮点尾巴进偏好文件。
      const hundredths = Math.round(num * 100)
      if (hundredths % WRITING_LINE_HEIGHT_STEP_HUNDREDTHS !== 0) {
        return { ok: false, error: `writingLineHeight 必须以 0.05 为步进（${WRITING_LINE_HEIGHT_MIN}／${WRITING_LINE_HEIGHT_MIN + 0.05}／…），收到：${JSON.stringify(value ?? null)}` }
      }
      out.writingLineHeight = hundredths / 100
    }
  }
  if ('theme' in source) {
    // D2 主题迁移：null / 空串表示「还没迁过」，渲染层用老 localStorage 的值兜底。
    const value = source.theme
    if (value === null || value === undefined || value === '') out.theme = null
    else if (THEMES.has(String(value))) out.theme = String(value)
    else return { ok: false, error: `theme 必须是 light／dark 或 null，收到：${JSON.stringify(value ?? null)}` }
  }
  return { ok: true, value: out }
}

export function createAppPreferences({ file } = {}) {
  if (!file) throw new Error('createAppPreferences 需要 file（偏好 JSON 的绝对路径）')
  let cache = null

  async function ensureDir() {
    await mkdir(dirname(file), { recursive: true })
  }

  async function read() {
    if (cache) return ok({ ...cache })
    let raw = null
    try {
      raw = JSON.parse(await readFile(file, 'utf-8'))
    } catch {
      // 文件不存在或损坏都按默认值继续：偏好坏了不能拦住作者进应用。
      cache = { ...PREFS_DEFAULTS }
      return ok({ ...cache })
    }
    const normalized = normalizePrefs(raw)
    if (!normalized.ok) {
      // 字段被手改坏：宁可用默认值也不让外壳起不来。
      cache = { ...PREFS_DEFAULTS }
      return ok({ ...cache })
    }
    cache = normalized.value
    return ok({ ...cache })
  }

  async function write(patch) {
    const current = await read()
    if (!current.ok) return current
    const normalized = normalizePrefs({ ...current.value, ...(patch && typeof patch === 'object' ? patch : {}) })
    if (!normalized.ok) return fail('INVALID_INPUT', normalized.error)
    await ensureDir()
    await writeFileAtomic(file, `${JSON.stringify(normalized.value, null, 2)}\n`)
    cache = normalized.value
    return ok({ ...cache })
  }

  return { read, write, file }
}
