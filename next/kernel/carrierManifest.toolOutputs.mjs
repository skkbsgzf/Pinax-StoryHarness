import { fail, ok } from './errors.mjs'
import { isPlainObject } from './carrierManifest.shared.mjs'

/**
 * 工具输出契约（批次56 · 路线图 ①档：只定义合同，不执行校验）。
 *
 *   tools: [{ name: 'x.read', output: { schema: <JSON Schema 对象>, presentationMeta?: 对象 } }]
 *
 * 三条边界写死在合同里，不给「以后再说」留口子：
 *   1) 只认 JSON Schema 2020-12 的一个子集（关键字白名单）。白名单外一律拒装——
 *      不收未登记的关键字，避免载体写进去却没人认。
 *   2) 根必须是 `type: 'object'`：工具返回体在框架里恒为对象信封（toMcpResult 的 { ok, ... }），
 *      MCP 的 outputSchema 也要求根是 object。根不是 object 的 schema 声明了也用不上。
 *   3) 只校验形状与预算（深度／节点数／序列化长度），不解析 $ref、不做语义推演：
 *      `$ref` 只收本文档内引用（`#/...`），远端引用在本批没有解析器。
 *
 * 本批**不消费**这份 schema：声明了 output 的工具，其返回体本批不校验（消费在 ②档）。
 * 宿主只把它原样透出到聚合工具面的 `_meta['pinax/output']`，让后续渲染／校验由同一份声明读取。
 *
 * `render` 明确不做：渲染归宿主，载体只声明数据形状与展示元数据（presentationMeta）。
 * 写了 render 即拒——与「声明了却不生效就拒装」同一条纪律。
 */
export const TOOL_OUTPUT_FIELDS = Object.freeze(['schema', 'presentationMeta'])
export const TOOL_OUTPUT_SCHEMA_TYPES = Object.freeze(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
export const TOOL_OUTPUT_SCHEMA_MAX_CHARS = 20_000
export const TOOL_OUTPUT_SCHEMA_DEPTH_MAX = 16
export const TOOL_OUTPUT_SCHEMA_NODES_MAX = 400
export const TOOL_PRESENTATION_META_MAX_CHARS = 4_000

/** JSON Schema 2020-12 子集：白名单外的关键字一律拒装。 */
export const TOOL_OUTPUT_SCHEMA_KEYWORDS = Object.freeze([
  // 标识与注释
  '$schema', '$id', '$ref', '$defs', 'definitions', '$comment', 'title', 'description',
  'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
  // 类型与取值
  'type', 'enum', 'const', 'format',
  // 数值
  'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum',
  // 字符串
  'maxLength', 'minLength', 'pattern', 'contentEncoding', 'contentMediaType', 'contentSchema',
  // 数组
  'maxItems', 'minItems', 'uniqueItems', 'prefixItems', 'items', 'contains', 'maxContains', 'minContains', 'unevaluatedItems',
  // 对象
  'maxProperties', 'minProperties', 'required', 'dependentRequired', 'properties', 'patternProperties',
  'additionalProperties', 'propertyNames', 'dependentSchemas', 'unevaluatedProperties',
  // 组合
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'
])

const SINGLE_SUBSCHEMA_KEYWORDS = Object.freeze([
  'additionalProperties', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems',
  'items', 'contains', 'contentSchema', 'not', 'if', 'then', 'else'
])
const SUBSCHEMA_ARRAY_KEYWORDS = Object.freeze(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const SUBSCHEMA_MAP_KEYWORDS = Object.freeze(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])
const NON_NEGATIVE_INTEGER_KEYWORDS = Object.freeze([
  'maxLength', 'minLength', 'maxItems', 'minItems', 'maxContains', 'minContains', 'maxProperties', 'minProperties'
])
const FINITE_NUMBER_KEYWORDS = Object.freeze([
  'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum'
])
const STRING_KEYWORDS = Object.freeze(['$schema', '$id', '$comment', 'title', 'description', 'format', 'contentEncoding', 'contentMediaType'])
const BOOLEAN_KEYWORDS = Object.freeze(['deprecated', 'readOnly', 'writeOnly', 'uniqueItems'])

/**
 * 校验一条工具条目里的 output。返回归一后的 { schema, presentationMeta? }；
 * presentationMeta 未声明时不出这个键（归一结果不多出死键）。
 */
export function validateToolOutput(value, { pluginId, toolName } = {}) {
  if (!isPlainObject(value)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的工具 ${toolName}.output 必须是对象 { schema, presentationMeta? }`, { pluginId, toolName })
  }
  for (const key of Object.keys(value)) {
    if (!TOOL_OUTPUT_FIELDS.includes(key)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的工具 ${toolName}.output 含未知字段 "${key}"：可声明 schema / presentationMeta（render 归宿主，本批不做）`, { pluginId, toolName, key })
    }
  }
  if (value.schema === undefined) {
    return fail('INVALID_MANIFEST', `${pluginId} 的工具 ${toolName}.output 必须给 schema（输出体形状）`, { pluginId, toolName })
  }
  if (!isPlainObject(value.schema)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的工具 ${toolName}.output.schema 必须是 JSON Schema 对象`, { pluginId, toolName })
  }
  if (value.schema.type !== 'object') {
    return fail('INVALID_MANIFEST', `${pluginId} 的工具 ${toolName}.output.schema 根必须是 type: 'object'（工具返回体恒为对象信封）`, {
      pluginId, toolName, type: value.schema.type ?? null
    })
  }

  const ctx = { pluginId, toolName, nodes: 0 }
  const shape = validateSchemaNode(value.schema, ctx, 1, 'schema')
  if (!shape.ok) return shape
  const serialized = stringifySchema(value.schema)
  if (!serialized.ok) return serialized
  if (serialized.value.length > TOOL_OUTPUT_SCHEMA_MAX_CHARS) {
    return fail('INVALID_MANIFEST', `${pluginId} 的工具 ${toolName}.output.schema 过大：${serialized.value.length} 字（上限 ${TOOL_OUTPUT_SCHEMA_MAX_CHARS}）`, {
      pluginId, toolName, chars: serialized.value.length
    })
  }

  const normalized = { schema: value.schema }
  if (value.presentationMeta !== undefined) {
    if (!isPlainObject(value.presentationMeta)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的工具 ${toolName}.output.presentationMeta 必须是顶层对象`, { pluginId, toolName })
    }
    const json = jsonOffender(value.presentationMeta, 1)
    if (json) {
      return fail('INVALID_MANIFEST', `${pluginId} 的工具 ${toolName}.output.presentationMeta 只收 JSON 值：${json}`, { pluginId, toolName })
    }
    const text = stringifySchema(value.presentationMeta)
    if (!text.ok) return text
    if (text.value.length > TOOL_PRESENTATION_META_MAX_CHARS) {
      return fail('INVALID_MANIFEST', `${pluginId} 的工具 ${toolName}.output.presentationMeta 过大：${text.value.length} 字（上限 ${TOOL_PRESENTATION_META_MAX_CHARS}）`, {
        pluginId, toolName, chars: text.value.length
      })
    }
    normalized.presentationMeta = value.presentationMeta
  }
  return ok(normalized)
}

function validateSchemaNode(node, ctx, depth, path) {
  if (!isPlainObject(node)) {
    return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 在 ${path} 必须是对象`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
  }
  if (depth > TOOL_OUTPUT_SCHEMA_DEPTH_MAX) {
    return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 嵌套超过 ${TOOL_OUTPUT_SCHEMA_DEPTH_MAX} 层（${path}）`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
  }
  ctx.nodes += 1
  if (ctx.nodes > TOOL_OUTPUT_SCHEMA_NODES_MAX) {
    return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 节点超过 ${TOOL_OUTPUT_SCHEMA_NODES_MAX} 个（${path}）`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
  }
  for (const key of Object.keys(node)) {
    if (!TOOL_OUTPUT_SCHEMA_KEYWORDS.includes(key)) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 含白名单外的关键字 "${key}"（${path}）：只认 JSON Schema 2020-12 子集`, {
        pluginId: ctx.pluginId, toolName: ctx.toolName, keyword: key
      })
    }
    const keyword = validateKeyword(key, node[key], ctx, depth, path)
    if (!keyword.ok) return keyword
  }
  return ok(true)
}

function validateKeyword(key, value, ctx, depth, path) {
  const at = `${path}.${key}`
  if (SINGLE_SUBSCHEMA_KEYWORDS.includes(key)) {
    if (typeof value === 'boolean') return ok(true)
    return validateSchemaNode(value, ctx, depth + 1, at)
  }
  if (SUBSCHEMA_ARRAY_KEYWORDS.includes(key)) {
    if (!Array.isArray(value) || value.length === 0) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是非空数组`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    for (const [index, item] of value.entries()) {
      const result = validateSchemaNode(item, ctx, depth + 1, `${at}[${index}]`)
      if (!result.ok) return result
    }
    return ok(true)
  }
  if (SUBSCHEMA_MAP_KEYWORDS.includes(key)) {
    if (!isPlainObject(value)) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是对象（键 → 子 schema）`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    for (const [name, item] of Object.entries(value)) {
      if (key === 'patternProperties') {
        const tested = safeRegex(name)
        if (!tested) {
          return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 键不是合法正则：${name}`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
        }
      }
      const result = validateSchemaNode(item, ctx, depth + 1, `${at}.${name}`)
      if (!result.ok) return result
    }
    return ok(true)
  }
  if (key === 'type') return validateType(value, ctx, at)
  if (key === 'required') return validateStringList(value, ctx, at, { unique: true })
  if (key === 'dependentRequired') {
    if (!isPlainObject(value)) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是对象`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    for (const [name, list] of Object.entries(value)) {
      const result = validateStringList(list, ctx, `${at}.${name}`, { unique: true })
      if (!result.ok) return result
    }
    return ok(true)
  }
  if (key === 'enum') {
    if (!Array.isArray(value) || value.length === 0) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是非空数组`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    const seen = new Set()
    for (const item of value) {
      const json = jsonOffender(item, 1)
      if (json) return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 只收 JSON 值：${json}`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
      const text = stringifySchema(item)
      if (!text.ok) return text
      if (seen.has(text.value)) {
        return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 含重复取值`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
      }
      seen.add(text.value)
    }
    return ok(true)
  }
  if (key === 'const' || key === 'default') {
    const json = jsonOffender(value, 1)
    if (json) return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 只收 JSON 值：${json}`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    return ok(true)
  }
  if (key === 'examples') {
    if (!Array.isArray(value)) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是数组`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    const json = jsonOffender(value, 1)
    if (json) return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 只收 JSON 值：${json}`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    return ok(true)
  }
  if (key === 'pattern') {
    if (typeof value !== 'string' || !safeRegex(value)) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是可编译的正则字符串`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    return ok(true)
  }
  if (key === '$ref') {
    if (typeof value !== 'string' || !value.startsWith('#')) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 只收本文档内引用（#/...）：${String(value)}`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    return ok(true)
  }
  if (STRING_KEYWORDS.includes(key)) {
    if (typeof value !== 'string') {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是字符串`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    return ok(true)
  }
  if (BOOLEAN_KEYWORDS.includes(key)) {
    if (typeof value !== 'boolean') {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是布尔`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    return ok(true)
  }
  if (key === 'multipleOf') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是大于 0 的有限数字`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    return ok(true)
  }
  if (FINITE_NUMBER_KEYWORDS.includes(key)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是有限数字`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    return ok(true)
  }
  if (NON_NEGATIVE_INTEGER_KEYWORDS.includes(key)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是非负整数`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    return ok(true)
  }
  // 白名单已收口，走到这里说明常量表与校验分支脱节——宁可拒装，也不静默放行。
  return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的关键字 "${key}" 没有校验分支`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
}

function validateType(value, ctx, at) {
  const words = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null
  if (!words || words.length === 0) {
    return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是类型名或类型名数组`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
  }
  if (typeof value === 'string' && !TOOL_OUTPUT_SCHEMA_TYPES.includes(value)) {
    return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 含未知类型 "${value}"：可用 ${TOOL_OUTPUT_SCHEMA_TYPES.join(' / ')}`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
  }
  if (Array.isArray(value)) {
    if (value.some((word) => typeof word !== 'string' || !TOOL_OUTPUT_SCHEMA_TYPES.includes(word))) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 含未知类型：可用 ${TOOL_OUTPUT_SCHEMA_TYPES.join(' / ')}`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
    if (new Set(value).size !== value.length) {
      return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 类型不能重复`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
    }
  }
  return ok(true)
}

function validateStringList(value, ctx, at, { unique = false } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 必须是非空字符串数组`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
  }
  if (unique && new Set(value).size !== value.length) {
    return fail('INVALID_MANIFEST', `${ctx.pluginId} 的工具 ${ctx.toolName}.output.schema 的 ${at} 不能重复`, { pluginId: ctx.pluginId, toolName: ctx.toolName })
  }
  return ok(true)
}

/** JSON 值检查：清单只收能跨进程传输的数据，函数／符号／BigInt／非有限数一律拒。 */
function jsonOffender(value, depth) {
  if (depth > TOOL_OUTPUT_SCHEMA_DEPTH_MAX) return '嵌套过深'
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return null
  if (type === 'number') return Number.isFinite(value) ? null : '数字必须是有限值'
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const offender = jsonOffender(item, depth + 1)
      if (offender) return `[${index}] ${offender}`
    }
    return null
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const offender = jsonOffender(item, depth + 1)
      if (offender) return `${key} ${offender}`
    }
    return null
  }
  return `不收 ${type}`
}

function safeRegex(text) {
  try {
    new RegExp(text)
    return true
  } catch {
    return false
  }
}

/** 序列化只用于长度记账；环引用由深度上限先拦住，这里的异常仍如实转成清单错误。 */
function stringifySchema(value) {
  try {
    return ok(JSON.stringify(value))
  } catch (error) {
    return fail('INVALID_MANIFEST', `工具输出声明无法序列化为 JSON：${String(error?.message || error)}`)
  }
}
