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
 * 合同（写进门禁的字段就这两个，加字段先改这里和 AppNext 的草稿表单）：
 *   modelPlaneEndpoint：null（用默认 8451）或 http(s)://… 字符串；
 *   uiZoom：null（用默认 0.85）或 0.5–2.0 的数字。
 */

export const PREFS_DEFAULTS = Object.freeze({
  modelPlaneEndpoint: null,
  uiZoom: null
})

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2

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
