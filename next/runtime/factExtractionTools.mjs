import { createFactExtractionService } from './factExtractionService.mjs'
import { EXTRACTION_ROW_SCHEMA } from '../fact/usecases/pipeline/extractionChain.js'

export const EXTRACTION_TOOL_NAMES = Object.freeze([
  'pinax_extract_prepare', 'pinax_extract_next', 'pinax_extract_submit', 'pinax_extract_status',
  'pinax_extract_finish', 'pinax_fact_check'
])
const text = { type: 'string', minLength: 1 }
const key = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' }
const integer = { type: 'integer', minimum: 0 }
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const source = object({ pluginId: text, dir: text, file: text, chapterNo: { type: 'integer', minimum: 1 } }, ['pluginId', 'dir', 'file', 'chapterNo'])
/** 窄绑定（P-1 三段式）：模型只交 {id,who,ch}，事件正文由服务端取块原文。 */
const bindingBlock = object({ id: text, who: { type: 'string' }, ch: { type: 'string' } }, ['id'])
// 绑定是模型产物，会带各种多余字段（name/reason/content…）：**宽容接收**，服务端只用 id/who/ch。
// 严格拒绝未知字段在这里只会把「模型多写一个字」放大成整批作废——与本链路目标相反。
bindingBlock.additionalProperties = true
const binding = object({
  id: text,
  blocks: { type: 'array', items: bindingBlock },
  settings: { type: 'array' },
  knowledge: { type: 'array' },
  hooks: { type: 'array' },
  /** 关系（P-6）：{from,to,type,how}，服务端做幻觉/自指/称谓目标三条清洗。 */
  relations: { type: 'array' },
  aka: { type: 'array' },
  when: object({ story_time: { type: 'string' }, timeline: { enum: ['顺叙', '倒叙', '插叙', '未明示'] } }),
  where: { type: 'string' }
}, ['id'])
/** run 级时间地点默认值（P-4）：不传就是「未明示＋顺叙」，段级可覆盖。 */
const timeDefaults = object({
  when: object({ story_time: { type: 'string' }, timeline: { enum: ['顺叙', '倒叙', '插叙', '未明示'] } }),
  where: { type: 'string' }
})
/**
 * 抽取档位（作者 2026-11-11「不同体裁采集节奏不一样，要参数化」）。
 * 只写想覆写的部分，其余继承默认档；也可传预置档名（novel-web-tight/script/nonfiction）。
 * **一旦 prepare 就固化在 run 里**：同一 dataset 不能改档位（改档＝换采集口径，另起 dataset）。
 */
const profile = object({
  name: { type: 'string' },
  description: { type: 'string' },
  segment: object({ min: { type: 'integer', minimum: 1 }, max: { type: 'integer', minimum: 1 } }),
  blocks: object({
    min: { type: 'integer', minimum: 1 },
    max: { type: 'integer', minimum: 1 },
    shortQuoteMax: { type: 'integer', minimum: 0 }
  }),
  bind: object({
    batchChars: { type: 'integer', minimum: 300, maximum: 12000 },
    channels: { type: 'array', items: text },
    maxIncrementsPerSegment: object({
      settings: { type: 'integer', minimum: 0 },
      knowledge: { type: 'integer', minimum: 0 },
      hooks: { type: 'integer', minimum: 0 },
      relations: { type: 'integer', minimum: 0 }
    })
  }),
  salience: object({
    characterEntryFloor: { type: 'number' },
    characterTiers: { type: 'array' },
    worldviewEntryFloor: { type: 'number' }
  }),
  cache: object({
    flushEntries: { type: 'integer', minimum: 1 },
    flushChapters: { type: 'integer', minimum: 1 },
    flushChars: { type: 'integer', minimum: 1 },
    retrieveLimit: { type: 'integer', minimum: 1 },
    retrieveChars: { type: 'integer', minimum: 1 }
  })
})
const schemas = {
  prepare: object({ dataset: key, requestId: key, fromRunId: key, mode: { enum: ['initialize', 'update', 'repair'] }, domain: text, book: text, bookId: text,
    sources: { type: 'array', minItems: 1, items: source }, sourceIds: { type: 'array', minItems: 1, items: text },
    batchChars: { type: 'integer', minimum: 300, maximum: 12000 }, timeDefaults, profile }, ['dataset', 'requestId']),
  next: object({ dataset: key, runId: key }, ['dataset', 'runId']),
  submit: object({ dataset: key, runId: key, expectedRevision: integer, taskId: text, submissionId: key,
    rows: { type: 'array', items: EXTRACTION_ROW_SCHEMA },
    bindings: { type: 'array', items: binding },
    /** 关系窄窗（B4）：只补关系、不推进抽取进度。relationsBySegment = { [segmentId]: [{from,to,type,how}] } */
    relationsOnly: { type: 'boolean' },
    segmentIds: { type: 'array', items: text },
    relationsBySegment: { type: 'object' } }, ['dataset', 'runId', 'expectedRevision', 'submissionId']),
  status: object({ dataset: key, runId: key, view: { enum: ['summary', 'sources', 'manifest', 'entries', 'entry', 'row', 'changes', 'warnings', 'index', 'archive'] }, pluginId: text, dir: text, id: text, offset: integer }),
  finish: object({
    dataset: key, runId: key, expectedRevision: integer,
    // 缓存池水位（Track 4，全可配）：不传用默认（120 条 / 4 章 / 6 万字）
    flushPolicy: object({
      flushEntries: { type: 'integer', minimum: 1 },
      flushChapters: { type: 'integer', minimum: 1 },
      flushChars: { type: 'integer', minimum: 1000 },
      retrieveLimit: { type: 'integer', minimum: 1 },
      retrieveChars: { type: 'integer', minimum: 200 },
      keepReferenced: { type: 'boolean' }
    })
  }, ['dataset', 'runId', 'expectedRevision']),
  fact_check: object({ dataset: key, runId: key, scope: { enum: ['summary', 'full'] } }, ['dataset'])
}
const descriptions = {
  prepare: '准备产品抽取运行：initialize首次、update存量、repair定向补抽。sources是完整项目文件范围（省略沿用基线），不传正文。保留100–300字单元并批量派发。只建派生断点，不调用模型、不改原稿。requestId保证重放幂等；恢复直接next旧runId。',
  next: '读取未抽取的下一批，**原文已切好块**（零模型）：每个 unit 带 blocks[{id,kind,text,hint,speakerHint}]，模型只需逐块给 {id,who,ch} 绑定，不必自己切句或写事件文本。单轮扫描：一次同时抽剧情、人物、设定、关系、知情与伏笔。相同断点重读不耗推理；done且phase:ready才能finish。',
  submit: '提交当前批结果，必须带expectedRevision与稳定submissionId。三种形态：① bindings（推荐，窄绑定 {id,blocks:[{id,who,ch}],settings,knowledge,hooks,aka}，服务端按块原文回组装事件正文并校验幻觉 who；需带 taskId）；② rows（完整行，兼容旧用法；需带 taskId）；③ relationsOnly + segmentIds + relationsBySegment（关系窄窗，只补关系不推进进度；不需 taskId）。可只交合法部分，遗漏段仍待办；工具自动校验、归并、生成ID/来源并原子保存。',
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
    // 只校验形状、不校验元素时（约定为「省略 items」），元素照原样交给服务层做业务校验。
    // 之前这里对没写 items 的 schema 会解引用 undefined 直接崩（P-1 真跑撞到）。
    if (!schema.items) return null
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
  // 档位里的阈值是小数（显著度门槛 2.0、1.5…），必须有 number 这一档；
  // 之前只实现 integer/string/array/object，写 type:'number' 等于**不校验**（静默放行）。
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)
    || (schema.minimum !== undefined && value < schema.minimum)
    || (schema.maximum !== undefined && value > schema.maximum))) return `${path}数值范围不符`
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
