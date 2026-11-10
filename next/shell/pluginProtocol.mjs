/**
 * 插件自带面板的协议层（协议 v3 的 `entry` 面）。
 *
 * 面板页面由插件目录里的静态文件组成，宿主用自定义协议 `pinax-plugin://<pluginId>/<相对路径>` 供它。
 * 为什么用协议而不是 file://：file:// 在 Electron 里等于给了页面本机文件系统，
 * 而面板要的是「只能读自己那一块目录」。协议这一层就是那道闸。
 *
 * 这个模块**不 import node:path**：渲染层也要用它拼 iframe 的 src，两边共用一份解析口径。
 * 真正落盘的那一半（读文件、目录越界检查）在 next/shell/pluginFileServer.mjs。
 */
export const PLUGIN_PROTOCOL = 'pinax-plugin'

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9.-]{0,79}$/u

const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
})

/** 面板入口 URL：pinax-plugin://<pluginId>/<插件目录内的相对路径>。 */
export function pluginEntryUrl(pluginId, relativePath) {
  const id = String(pluginId ?? '')
  if (!PLUGIN_ID_PATTERN.test(id)) return null
  const rel = normalizeRelativePath(relativePath)
  if (!rel) return null
  return `${PLUGIN_PROTOCOL}://${id}/${rel}`
}

/** 解析 pinax-plugin:// URL：认协议、认插件 id、认相对路径；不认就返回 null。 */
export function parsePluginUrl(url) {
  const text = String(url ?? '')
  if (!text.startsWith(`${PLUGIN_PROTOCOL}://`)) return null
  const rest = text.slice(`${PLUGIN_PROTOCOL}://`.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const pluginId = rest.slice(0, slash)
  if (!PLUGIN_ID_PATTERN.test(pluginId)) return null
  const relativePath = normalizeRelativePath(rest.slice(slash + 1))
  if (!relativePath) return null
  return { pluginId, relativePath }
}

/** 相对路径归一：去前导斜杠、拒穿越（..）、拒盘符冒号；空串视为不认。 */
export function normalizeRelativePath(value) {
  const raw = String(value ?? '').trim().replaceAll('\\', '/')
  if (!raw) return null
  const cleaned = raw.replace(/^\/+/u, '')
  if (!cleaned) return null
  if (cleaned.includes('..')) return null
  if (cleaned.includes(':')) return null
  return cleaned
}

/** 内容类型：认得的按表给，认不得的按 octet-stream（不猜 html，避免把未知文件当页面执行）。 */
export function contentTypeFor(filePath) {
  const text = String(filePath ?? '').toLowerCase()
  const dot = text.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return CONTENT_TYPES[text.slice(dot)] ?? 'application/octet-stream'
}
