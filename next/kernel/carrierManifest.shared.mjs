import { fail, ok } from './errors.mjs'

/**
 * 清单校验器共用的形状与路径纪律（批次52 拆文件时从主文件搬出来）。
 * 这里只有纯函数：主入口、四组字段校验器与 license 都从同一份规则读，
 * 避免「entry 守八条、license 守六条」这种两套口径。
 */

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 插件目录内的相对路径（entry / agentMd / service cwd / license agreement）：
 * 不得越出插件自己的目录。与项目内相对路径不同：这里解析基准是插件根，不是项目根，
 * 所以不收 `.pinax` 之类项目语义，只守八条——非空、小于上限、正斜杠、非绝对、
 * 非盘符、无 `.`/`..`/空段、不以点开头、扩展名对得上。
 */
export function validatePluginRelativePath(value, { pluginId, field, ext = null, max = 200, code = 'INVALID_MANIFEST' } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    return fail(code, `${pluginId} 的 ${field} 必须是非空字符串`, { pluginId, field })
  }
  const raw = value.trim()
  if (raw.length > max) {
    return fail(code, `${pluginId} 的 ${field} 过长（上限 ${max} 字）：${raw}`, { pluginId, field })
  }
  if (raw.includes('\\')) {
    return fail(code, `${pluginId} 的 ${field} 请用正斜杠：${raw}`, { pluginId, field })
  }
  if (raw.includes(':') || raw.startsWith('/')) {
    return fail(code, `${pluginId} 的 ${field} 必须是插件目录内的相对路径：${raw}`, { pluginId, field })
  }
  const segments = raw.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) {
    return fail(code, `${pluginId} 的 ${field} 含非法路径段：${raw}`, { pluginId, field })
  }
  if (ext && !raw.toLowerCase().endsWith(ext)) {
    return fail(code, `${pluginId} 的 ${field} 必须以 ${ext} 结尾：${raw}`, { pluginId, field })
  }
  return ok(raw)
}

/** canOpen 的 equals／in 只收声明式标量：函数、对象、数组一律拒（JSON 清单不许夹 JS）。 */
export function isPredicateScalar(value) {
  return typeof value === 'string' ? value.trim().length > 0 && value.length <= 200
    : typeof value === 'number' ? Number.isFinite(value)
      : typeof value === 'boolean'
}

export { ok, fail }
