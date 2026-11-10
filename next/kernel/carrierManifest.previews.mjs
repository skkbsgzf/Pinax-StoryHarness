import { fail, ok } from './errors.mjs'
import { isPlainObject } from './carrierManifest.shared.mjs'

/**
 * 渲染器注册（批次52，对 Cordis `ctx.documentPreviews.register({ extensions, priority, loading })`）。
 *
 *   preview.register = [{ id, extensions: ['.md', '.txt'], priority, loading, maxBytes }]
 *
 * `loading` 是本次最值钱的借鉴：它把「大文件怎么读」写进合同——
 *   text-pages    按页读（宿主只把当前页文本交给渲染器）
 *   bytes-complete 整份字节一次性读完（二进制／需要完整结构的格式）
 * 批次55 直接消费这一档，不再靠渲染器自己猜。
 *
 * extensions 必须小写带点；maxBytes 沿用 `*_MAX` 常量家族的写法，
 * 由宿主统一封顶（单个预览注册最多读 64 MiB），不让某载体把内存吃穿。
 */
export const PREVIEW_LOADING_MODES = Object.freeze(['text-pages', 'bytes-complete'])
export const PREVIEW_REGISTER_MAX = 16
export const PREVIEW_EXTENSIONS_MAX = 16
export const PREVIEW_MAX_BYTES_MAX = 64 * 1024 * 1024
export const PREVIEW_MAX_BYTES_MIN = 1
export const PREVIEW_PRIORITY_MIN = 0
export const PREVIEW_PRIORITY_MAX = 100

const PREVIEW_ID_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u
const PREVIEW_EXTENSION_PATTERN = /^\.[a-z0-9]{1,10}$/u

export function validatePreview(value, pluginId) {
  if (value === undefined || value === null) return ok(null)
  if (!isPlainObject(value)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 preview 必须是对象 { register: [...] }`, { pluginId })
  }
  for (const key of Object.keys(value)) {
    if (key !== 'register') {
      return fail('INVALID_MANIFEST', `${pluginId} 的 preview 含未知字段 "${key}"：本批只认 register`, { pluginId, key })
    }
  }
  if (!Array.isArray(value.register) || value.register.length === 0) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register 必须是非空数组`, { pluginId })
  }
  if (value.register.length > PREVIEW_REGISTER_MAX) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register 最多 ${PREVIEW_REGISTER_MAX} 条，收到 ${value.register.length}`, { pluginId })
  }
  const fields = ['id', 'extensions', 'priority', 'loading', 'maxBytes']
  const seenIds = new Set()
  const seenExtensions = new Set()
  const out = []
  for (const item of value.register) {
    if (!isPlainObject(item)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register 项必须是对象`, { pluginId })
    }
    for (const key of Object.keys(item)) {
      if (!fields.includes(key)) {
        return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register 含未知字段 "${key}"：可声明 ${fields.join(' / ')}`, { pluginId, key })
      }
    }
    if (typeof item.id !== 'string' || !PREVIEW_ID_PATTERN.test(item.id)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register id 须匹配 ${PREVIEW_ID_PATTERN}`, { id: item.id })
    }
    if (seenIds.has(item.id)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register id 重复：${item.id}`, { pluginId, id: item.id })
    }
    seenIds.add(item.id)
    if (!Array.isArray(item.extensions) || item.extensions.length === 0 || item.extensions.length > PREVIEW_EXTENSIONS_MAX) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register(${item.id}) extensions 必须是 1–${PREVIEW_EXTENSIONS_MAX} 项的数组`, { pluginId, id: item.id })
    }
    const extensions = []
    for (const extension of item.extensions) {
      if (typeof extension !== 'string' || !PREVIEW_EXTENSION_PATTERN.test(extension)) {
        return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register(${item.id}) 扩展名必须是小写带点（如 .md／.txt），收到 ${String(extension)}`, { pluginId, id: item.id, extension })
      }
      if (seenExtensions.has(extension)) {
        return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register 重复认领扩展名 ${extension}：同一清单内一个扩展名只能有一个渲染器`, { pluginId, id: item.id, extension })
      }
      seenExtensions.add(extension)
      extensions.push(extension)
    }
    const priority = item.priority === undefined ? 0 : item.priority
    if (!Number.isSafeInteger(priority) || priority < PREVIEW_PRIORITY_MIN || priority > PREVIEW_PRIORITY_MAX) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register(${item.id}) priority 须是 ${PREVIEW_PRIORITY_MIN}–${PREVIEW_PRIORITY_MAX} 的整数`, { pluginId, id: item.id, priority: item.priority })
    }
    if (!PREVIEW_LOADING_MODES.includes(item.loading)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register(${item.id}) loading 须是 ${PREVIEW_LOADING_MODES.join(' / ')}，收到 ${String(item.loading)}`, { pluginId, id: item.id, loading: item.loading })
    }
    if (!Number.isSafeInteger(item.maxBytes) || item.maxBytes < PREVIEW_MAX_BYTES_MIN || item.maxBytes > PREVIEW_MAX_BYTES_MAX) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 preview.register(${item.id}) maxBytes 须是 ${PREVIEW_MAX_BYTES_MIN}–${PREVIEW_MAX_BYTES_MAX} 的整数`, { pluginId, id: item.id, maxBytes: item.maxBytes })
    }
    out.push({ id: item.id, extensions, priority, loading: item.loading, maxBytes: item.maxBytes })
  }
  return ok({ register: out })
}
