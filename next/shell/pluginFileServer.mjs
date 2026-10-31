import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { contentTypeFor, parsePluginUrl } from './pluginProtocol.mjs'

/**
 * 面板文件的供给（主进程那一半）。
 *
 * 边界只有一条：面板只能读**自己那个插件目录**里的文件。
 *   - 插件 id 认不出、插件没登记目录、路径越出目录 → 一律 404，不给第二次机会；
 *   - 读的是真实磁盘文件，不缓存（作者改了面板刷新就见效）。
 *
 * fs 与目录解析都做成注入项：node:test 不用起 Electron 也能测这条链。
 */
export const PLUGIN_FILE_STATUS = Object.freeze({
  ok: 200,
  notFound: 404,
  forbidden: 403,
  error: 500
})

/** 相对路径落到插件目录里的绝对路径；越界返回 null。 */
export function resolvePluginFile(pluginDir, relativePath) {
  const dir = String(pluginDir ?? '')
  if (!dir) return null
  const base = resolve(dir)
  const target = resolve(base, String(relativePath ?? ''))
  const inside = relative(base, target)
  if (inside.startsWith('..') || isAbsolute(inside)) return null
  return target
}

/**
 * 造一个处理器：给 URL，回 { status, contentType, body }。
 * resolvePluginDir(pluginId) → 目录绝对路径（认不出就回 null）；readFile 可注入。
 */
export function createPluginFileHandler({ resolvePluginDir, read = readFile } = {}) {
  return async function handle(url) {
    const parsed = parsePluginUrl(url)
    if (!parsed) return { status: PLUGIN_FILE_STATUS.notFound, contentType: 'text/plain; charset=utf-8', body: '未知的面板资源' }
    const dir = typeof resolvePluginDir === 'function' ? await resolvePluginDir(parsed.pluginId) : null
    if (!dir) return { status: PLUGIN_FILE_STATUS.notFound, contentType: 'text/plain; charset=utf-8', body: '这个插件没有面板目录' }
    const file = resolvePluginFile(dir, parsed.relativePath)
    if (!file) return { status: PLUGIN_FILE_STATUS.forbidden, contentType: 'text/plain; charset=utf-8', body: '面板资源越出了插件目录' }
    try {
      const body = await read(file)
      return { status: PLUGIN_FILE_STATUS.ok, contentType: contentTypeFor(file), body }
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
        return { status: PLUGIN_FILE_STATUS.notFound, contentType: 'text/plain; charset=utf-8', body: '面板资源不存在' }
      }
      return { status: PLUGIN_FILE_STATUS.error, contentType: 'text/plain; charset=utf-8', body: `面板资源读不出来：${String(error?.message || error)}` }
    }
  }
}
