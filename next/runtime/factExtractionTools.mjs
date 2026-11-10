import { createFactExtractionService } from './factExtractionService.mjs'
import { EXTRACTION_ROW_SCHEMA } from '../fact/usecases/pipeline/extractionChain.js'

export const EXTRACTION_TOOL_NAMES = Object.freeze(['pinax_extract_prepare', 'pinax_extract_next', 'pinax_extract_submit', 'pinax_extract_status', 'pinax_extract_finish', 'pinax_fact_check'])
const text = { type: 'string', minLength: 1 }
const key = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' }
const integer = { type: 'integer', minimum: 0 }
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const source = object({ pluginId: text, dir: text, file: text, chapterNo: { type: 'integer', minimum: 1 } }, ['pluginId', 'dir', 'file', 'chapterNo'])
const schemas = {
  prepare: object({ dataset: key, requestId: key, fromRunId: key, mode: { enum: ['initialize', 'update', 'repair'] }, domain: text, book: text, bookId: text,
    sources: { type: 'array', minItems: 1, items: source }, sourceIds: { type: 'array', minItems: 1, items: text }, batchChars: { type: 'integer', minimum: 300, maximum: 12000 } }, ['dataset', 'requestId']),
  next: object({ dataset: key, runId: key }, ['dataset', 'runId']),
  submit: object({ dataset: key, runId: key, expectedRevision: integer, taskId: text, submissionId: key,
    rows: { type: 'array', items: EXTRACTION_ROW_SCHEMA } }, ['dataset', 'runId', 'expectedRevision', 'taskId', 'submissionId']),
  status: object({ dataset: key, runId: key, view: { enum: ['summary', 'sources', 'manifest', 'entries', 'entry', 'row', 'changes', 'warnings', 'index'] }, pluginId: text, dir: text, id: text, offset: integer }),
  finish: object({ dataset: key, runId: key, expectedRevision: integer }, ['dataset', 'runId', 'expectedRevision']),
  fact_check: object({ dataset: key, runId: key, scope: { enum: ['summary', 'full'] } }, ['dataset'])
}
const descriptions = {
  prepare: '准备产品抽取运行：initialize首次、update存量、repair定向补抽。sources是完整项目文件范围（省略沿用基线），不传正文。保留100–300字单元并批量派发。只建派生断点，不调用模型、不改原稿。requestId保证重放幂等；恢复直接next旧runId。',
  next: '读取未抽取的下一批原文。单轮扫描：一次同时抽剧情、人物、设定、关系、知情与伏笔，抽完即ready，没有复核轮。相同断点重读不耗推理；done且phase:ready才能finish。',
  submit: '提交当前批的结构化结果，必须带taskId、expectedRevision与稳定submissionId。可只交合法部分，遗漏段仍待办。rows是该段完整记录；工具自动校验、归并、生成ID/来源并原子保存；不填写usage或自造provenance。',
  status: '读取断点、源目录及成果。sources不需dataset：先列已启用板块，再带pluginId/dir列文件。summary列runId；manifest列范围；entries列三层条目；entry/row按id和offset读JSON分片，拼到nextOffset:null；changes/warnings列影响清单。分页沿用同一快照版本。',
  finish: '覆盖检查通过后发布draft/proposed三层快照＋基础索引及差异清单。原稿变更、漏段或并发基线冲突会拒绝。不会自动采纳，不会覆盖作者已adopted/superseded事实；成果用status读取，后续作者采纳另走事实库入口。',
  fact_check: '整库一致性检测（只读，不写断点、不改条目）：锚点/规则/时间轴/知情四类断言＋关系与知情引用悬空、同名跨层、槽位堆积、伏笔统计。可判定项进 conflicts（error）与 warnings；不可判定项如实列 undecidable。全书拆解完成或改编改写前过一遍；不带 runId 检测已发布快照，带 runId 检测进行中已交的行。'
}

// nativeMap不像内核路由那样自带入参验证；校验与披露使用同一份schema。
// 此处只实现本模块schema用到的JSON Schema子集，不对陌生关键字宣称通用支持。
function validate(value, schema, path = 'arguments') {
  if (schema.enum && !schema.enum.includes(value)) return `${path}不在允许枚举中`
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return `${path}须为普通对象`
    for (const field of schema.required ?? []) if (!Object.hasOwn(value, field)) return `${path}.${field}为必填`
    for (const [field, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(field)) return `${path}.${field}不是合法字段`
      if (!Object.hasOwn(schema.properties ?? {}, field)) {
        if (schema.additionalProperties === false) return `${path}.${field}是未知字段`
        continue
      }
      const error = validate(child, schema.properties[field], `${path}.${field}`)
      if (error) return error
    }
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path}须为数组`
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path}条数不足`
    for (let index = 0; index < value.length; index += 1) {
      const error = validate(value[index], schema.items, `${path}[${index}]`)
      if (error) return error
    }
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${path}须为字符串`
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) return `${path}不能为空`
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return `${path}格式不符`
  }
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return `${path}整数范围不符`
  return null
}

export function createFactExtractionTools(options = {}) {
  const service = options.service ?? createFactExtractionService(options)
  return new Map(EXTRACTION_TOOL_NAMES.map((name) => {
    const method = name.startsWith('pinax_extract_') ? name.slice('pinax_extract_'.length) : 'fact_check'
    const readOnly = method === 'next' || method === 'status' || method === 'fact_check'
    return [name, { pluginId: 'kernel.runtime.extraction', tool: {
      name, title: `事实抽取·${method}`, description: descriptions[method], inputSchema: schemas[method],
      // 非破坏性提交只写派生checkpoint；单轮抽取无复核态，读口恒定可用。
      annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true },
      async run(args = {}) {
        const error = validate(args, schemas[method])
        if (error) return { ok: false, error: { code: 'INVALID_INPUT', message: error } }
        return service.call(method, args)
      }
    } }]
  }))
}
