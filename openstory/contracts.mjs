/**
 * OpenStory API 契约（OS-2）——纯数据＋纯函数，零依赖。
 *
 * 这份文件是 daemon 与工作台的**唯一契约源**：改请求/响应形状只改这里，两端一起跟。
 * 不 import node:path / node:fs，任何环境（浏览器、Node、测试）都能直接载入。
 *
 * 形状描述用「字段 → 类型串」的扁平对象，看懂即可，不引 schema 库：
 *   string / integer / number / boolean / object / array / messages / true
 *   末尾 `?` 表示可选（undefined、null、空串都算没给）。
 *
 * 错误码词表分两层：
 *   · 壳层：NO_LIBRARY / PATH_ESCAPE / NOT_FOUND / INVALID_ENTRY / REVISION_MISMATCH；
 *   · 写协议：WRITE_PROTOCOL_* 由 S2（writeFactFile）的端口码透传改名，不另造语义。
 * 失败响应统一 `{ ok:false, error:{ code, message, details? } }`。
 */

/** 错误码词表（daemon 只从这里取码；测试按这里校验）。 */
export const API_ERROR_CODES = Object.freeze({
  NO_LIBRARY: 'NO_LIBRARY',
  PATH_ESCAPE: 'PATH_ESCAPE',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_ENTRY: 'INVALID_ENTRY',
  REVISION_MISMATCH: 'REVISION_MISMATCH',
  WRITE_PROTOCOL_OPERATION_ID_REQUIRED: 'WRITE_PROTOCOL_OPERATION_ID_REQUIRED',
  WRITE_PROTOCOL_VALIDATION_FAILED: 'WRITE_PROTOCOL_VALIDATION_FAILED',
  WRITE_PROTOCOL_INVALID_INPUT: 'WRITE_PROTOCOL_INVALID_INPUT',
  WRITE_PROTOCOL_NOT_FOUND: 'WRITE_PROTOCOL_NOT_FOUND',
  WRITE_PROTOCOL_IO_FAILED: 'WRITE_PROTOCOL_IO_FAILED',
  // Agent 通道（OS-4 的前置透传）：上游不可达/非 2xx，不冒充模型回答。
  AGENT_UPSTREAM_ERROR: 'AGENT_UPSTREAM_ERROR'
})

/** 8 个端点的形状合同。`path` 不含 query；query 字段在 request.query 里单列。 */
export const ENDPOINTS = Object.freeze({
  libraries: {
    method: 'GET',
    path: '/api/libraries',
    request: { query: {} },
    response: {
      ok: 'true',
      libraries: 'array',
      warnings: 'array',
      preferencesPath: 'string?',
      defaultRoot: 'string?'
    },
    errors: []
  },
  entries: {
    method: 'GET',
    path: '/api/entries',
    request: {
      query: {
        root: 'string',
        layer: 'string?',
        offset: 'integer?',
        limit: 'integer?'
      }
    },
    response: { ok: 'true', entries: 'array', total: 'integer', warnings: 'array' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY']
  },
  entry: {
    method: 'GET',
    path: '/api/entry',
    request: { query: { root: 'string', id: 'string' } },
    response: { ok: 'true', entry: 'object', revision: 'integer' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  chapterGet: {
    method: 'GET',
    path: '/api/chapter',
    request: { query: { root: 'string', file: 'string' } },
    response: { ok: 'true', name: 'string', text: 'string', chars: 'integer' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  chapterPut: {
    method: 'PUT',
    path: '/api/chapter',
    request: { body: { root: 'string', file: 'string', text: 'string' } },
    response: { ok: 'true', chars: 'integer', savedAt: 'string', backup: 'string?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  wiki: {
    method: 'GET',
    path: '/api/wiki',
    request: { query: { root: 'string', bookId: 'string' } },
    response: { ok: 'true', wiki: 'object?', derivedFrom: 'object?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  wikiDerive: {
    method: 'POST',
    path: '/api/wiki/derive',
    request: { body: { root: 'string', bookId: 'string', operationId: 'string' } },
    response: { ok: 'true', wiki: 'object?', derivedFrom: 'object?', revision: 'integer?', duplicate: 'boolean?' },
    errors: [
      'NO_LIBRARY',
      'PATH_ESCAPE',
      'INVALID_ENTRY',
      'NOT_FOUND',
      'REVISION_MISMATCH',
      'WRITE_PROTOCOL_OPERATION_ID_REQUIRED',
      'WRITE_PROTOCOL_VALIDATION_FAILED',
      'WRITE_PROTOCOL_INVALID_INPUT',
      'WRITE_PROTOCOL_IO_FAILED'
    ]
  },
  agentChat: {
    method: 'POST',
    path: '/api/agent/chat',
    // 成功响应是 text/event-stream，不是 JSON；response 描述的是「开始流之前的错误形状」之外的口径：
    // SSE 每一帧原样透传上游 data:，工作台按 OpenAI 兼容 chunk 解析。
    request: {
      body: {
        messages: 'messages',
        model: 'string?',
        endpoint: 'string?',
        apiKey: 'string?'
      }
    },
    response: { stream: 'string' },
    errors: ['INVALID_ENTRY', 'AGENT_UPSTREAM_ERROR']
  }
})

export const ENDPOINT_LIST = Object.freeze(Object.values(ENDPOINTS))

/** 方法＋路径 → 端点 id；容忍结尾斜杠。找不到给 null（daemon 回 404）。 */
export function endpointFor(method, pathname) {
  const wantedMethod = String(method ?? '').toUpperCase()
  const wantedPath = String(pathname ?? '').replace(/\/+$/u, '') || '/'
  for (const [id, endpoint] of Object.entries(ENDPOINTS)) {
    if (endpoint.method === wantedMethod && endpoint.path === wantedPath) return id
  }
  return null
}

export function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function text(value) {
  return String(value ?? '')
}

function isMissing(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/** 将 query 里的数字串规整成数字；非法就保持原值交给类型校验报错。 */
function coerceType(type, value) {
  if (type === 'integer' || type === 'number') {
    if (typeof value !== 'string' || value.trim() === '') return value
    const number = Number(value)
    return Number.isFinite(number) ? number : value
  }
  return value
}

function checkOne(type, value, field, errors) {
  let kind = type
  let optional = false
  if (kind.endsWith('?')) {
    optional = true
    kind = kind.slice(0, -1)
  }
  if (isMissing(value)) {
    if (!optional) errors.push({ field, message: `${field} 必填（${type}）` })
    return
  }
  switch (kind) {
    case 'true':
      if (value !== true) errors.push({ field, message: `${field} 必须是 true` })
      return
    case 'string':
      if (typeof value !== 'string') errors.push({ field, message: `${field} 必须是字符串` })
      return
    case 'integer':
      if (!Number.isSafeInteger(value)) errors.push({ field, message: `${field} 必须是整数` })
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push({ field, message: `${field} 必须是数字` })
      return
    case 'boolean':
      if (typeof value !== 'boolean') errors.push({ field, message: `${field} 必须是布尔值` })
      return
    case 'object':
      if (!isPlainObject(value)) errors.push({ field, message: `${field} 必须是对象` })
      return
    case 'array':
      if (!Array.isArray(value)) errors.push({ field, message: `${field} 必须是数组` })
      return
    case 'messages':
      if (!Array.isArray(value) || value.length === 0) {
        errors.push({ field, message: `${field} 必须是非空消息数组` })
        return
      }
      value.forEach((item, index) => {
        if (!isPlainObject(item) || typeof item.role !== 'string' || typeof item.content !== 'string') {
          errors.push({ field: `${field}[${index}]`, message: '每条消息必须是 { role:string, content:string }' })
        }
      })
      return
    default:
      errors.push({ field, message: `${field} 的契约类型 ${type} 未定义` })
  }
}

function validateShape(shape, input, errors, options = {}) {
  const value = isPlainObject(input) ? input : {}
  for (const [field, type] of Object.entries(shape)) {
    const given = options.coerce ? coerceType(type.replace(/\?$/u, ''), value[field]) : value[field]
    checkOne(type, given, field, errors)
    if (options.coerce) value[field] = given
  }
  return value
}

/**
 * 请求校验：query 端点允许全是字符串（HTTP query 本来就是字符串），会把 integer 规整成数字；
 * body 端点按 JSON 原类型校验。返回 `{ ok, errors, value }`，value 是规整后的副本。
 */
export function validateRequest(endpointId, input = {}) {
  const endpoint = ENDPOINTS[endpointId]
  if (!endpoint) return { ok: false, errors: [{ field: 'endpoint', message: `未知端点 ${endpointId}` }], value: {} }
  const errors = []
  if (endpoint.request.query) {
    const value = validateShape(endpoint.request.query, input, errors, { coerce: true })
    return { ok: errors.length === 0, errors, value }
  }
  const value = validateShape(endpoint.request.body, input, errors)
  return { ok: errors.length === 0, errors, value }
}

/** 响应校验：daemon 发出去之前、测试断言形状时共用。 */
export function validateResponse(endpointId, payload = {}) {
  const endpoint = ENDPOINTS[endpointId]
  if (!endpoint) return { ok: false, errors: [{ field: 'endpoint', message: `未知端点 ${endpointId}` }] }
  const errors = []
  validateShape(endpoint.response, payload, errors)
  return { ok: errors.length === 0, errors }
}

/** 失败载荷（daemon 与测试共用一套形状）。 */
export function errorEnvelope(code, message, details) {
  const error = { code: String(code), message: text(message) }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, error }
}

/** 库记录规整：recentProjects 只保底 path，其余字段缺了就补人话默认值。 */
export function normalizeLibraryRecord(value) {
  if (!isPlainObject(value)) return null
  const path = text(value.path).trim()
  if (!path) return null
  const fallbackName = path.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() || path
  return {
    path,
    name: text(value.name).trim() || fallbackName,
    kind: text(value.kind).trim() || '未分类',
    count: Number.isSafeInteger(Number(value.count)) && Number(value.count) >= 0 ? Number(value.count) : 0,
    at: text(value.at).trim()
  }
}

/** 清单规整：坏条跳过、按路径去重（Windows 大小写不敏感），保留先出现的（即较新的）。 */
export function normalizeLibraries(raw) {
  const libraries = []
  const warnings = []
  if (!Array.isArray(raw)) return { libraries, warnings }
  const seen = new Set()
  raw.forEach((item, index) => {
    const record = normalizeLibraryRecord(item)
    if (!record) {
      warnings.push({ code: 'LIBRARY_ENTRY_SKIPPED', index, message: '库里有一条记录没有 path，已跳过' })
      return
    }
    const key = record.path.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
    if (seen.has(key)) {
      warnings.push({ code: 'LIBRARY_ENTRY_DUPLICATE', path: record.path, message: '同一路径重复登记，保留先出现的一条' })
      return
    }
    seen.add(key)
    libraries.push(record)
  })
  return { libraries, warnings }
}
