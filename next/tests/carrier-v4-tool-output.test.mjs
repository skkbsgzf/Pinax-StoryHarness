import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { CARRIER_SPEC_V3, V4_ONLY_TOOL_FIELDS, validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import {
  TOOL_OUTPUT_SCHEMA_DEPTH_MAX,
  TOOL_OUTPUT_SCHEMA_MAX_CHARS,
  TOOL_PRESENTATION_META_MAX_CHARS
} from '../kernel/carrierManifest.toolOutputs.mjs'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { TOOL_OUTPUT_META_KEY } from '../runtime/surfaceAggregate.mjs'
import { BUILT_IN_CARRIER_PLUGINS } from '../carriers/index.mjs'
import { FIXTURE_NOVEL, withMutation } from '../testing/fixtures.mjs'
import { FIXTURE_V4 } from '../testing/fixtures/carrierV4.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 工具输出契约（批次56 · 路线图 ①档）。
 *
 * 本批只做两件事，测试也按这两条切：
 *   1) 清单校验收 output：合法声明进归一结果（toolOutputs），非法 schema 在安装期真拒；
 *      没声明的存量工具照装（兼容面），@3 及更老写 output 一律拒。
 *   2) 元数据透出、零消费：聚合工具面的工具描述带 _meta['pinax/output']，
 *      但返回体不按 schema 校验——故意返回一个不合声明的结果，调用仍成功。
 */

function rejects(manifest, code = 'INVALID_MANIFEST') {
  const result = validateCarrierManifest(manifest)
  assert.equal(result.ok, false, '应当拒绝')
  assert.equal(result.error.code, code.startsWith('PINAX_') ? code : `PINAX_${code}`, result.error.message)
  return result.error
}

function withTools(tools) {
  return withMutation(FIXTURE_V4, (manifest) => { manifest.tools = tools })
}

function validOutput(schema, presentationMeta) {
  return presentationMeta === undefined ? { schema } : { schema, presentationMeta }
}

const SIMPLE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    text: { type: 'string' }
  },
  required: ['ok', 'text'],
  additionalProperties: false
}

// ── 兼容面：存量清单没有 output 也照装，归一结果不多出死字段 ─────────────────

test('兼容：12 份内建清单 44 把工具零 output 照装（toolOutputs 不出键）', () => {
  assert.equal(BUILT_IN_CARRIER_PLUGINS.length, 12)
  let declared = 0
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const validated = validateCarrierManifest(plugin.manifest)
    assert.equal(validated.ok, true, `${plugin.manifest.id}: ${validated.error?.message}`)
    assert.equal('toolOutputs' in validated.value, false, `${plugin.manifest.id}：没声明 output 就不出新键`)
    declared += validated.value.tools.length
    const installed = registry.install(plugin.manifest, plugin.impl, plugin.meta)
    assert.equal(installed.ok, true, `${plugin.manifest.id}: ${installed.error?.message}`)
  }
  assert.equal(registry.rejected.length, 0, JSON.stringify(registry.rejected))
  // 计数写理由：批次56 的记账口径——十二块载体共声明 44 把工具，全部还没有 output 声明。
  assert.equal(declared, 44, '存量缺声明的条数变了先说明为什么，再改这里')
})

test('兼容：@1 夹具照装，归一结果没有 toolOutputs', () => {
  const result = validateCarrierManifest(FIXTURE_NOVEL)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.equal('toolOutputs' in result.value, false)
  assert.deepEqual(result.value.tools, FIXTURE_NOVEL.tools)
})

// ── 合法声明（≥3 例）：形状归一，tools 读取面仍是字符串数组 ─────────────────

test('合法①：基础对象 schema —— tools 归一成名字数组，toolOutputs 只带真声明的那把', () => {
  const result = validateCarrierManifest(withTools([
    { name: 'v4.read', output: validOutput(SIMPLE_SCHEMA) },
    'v4.write'
  ]))
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.deepEqual(result.value.tools, ['v4.read', 'v4.write'])
  assert.deepEqual(result.value.toolOutputs, { 'v4.read': { schema: SIMPLE_SCHEMA } })
})

test('合法②：presentationMeta 原样保留（顶层对象、JSON 值）', () => {
  const presentationMeta = { render: 'list', density: 'compact', columns: 2 }
  const result = validateCarrierManifest(withTools([
    { name: 'v4.read', output: validOutput(SIMPLE_SCHEMA, presentationMeta) }
  ]))
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.deepEqual(result.value.toolOutputs['v4.read'], { schema: SIMPLE_SCHEMA, presentationMeta })
})

test('合法③：组合关键字与 $defs/$ref（本文档内引用）、enum、oneOf 都认', () => {
  const schema = {
    type: 'object',
    $defs: {
      entry: {
        type: 'object',
        properties: { id: { type: 'string' }, kind: { enum: ['chapter', 'note'] } },
        required: ['id']
      }
    },
    properties: {
      ok: { type: 'boolean' },
      entry: { $ref: '#/$defs/entry' },
      label: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      tags: { type: 'array', items: { type: 'string' }, uniqueItems: true }
    },
    required: ['ok']
  }
  const result = validateCarrierManifest(withTools([{ name: 'v4.read', output: validOutput(schema) }]))
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.deepEqual(result.value.toolOutputs['v4.read'].schema, schema)
})

test('合法④：@4 对象条目可以不带 output（对象形态本身不算错）', () => {
  const result = validateCarrierManifest(withTools([{ name: 'v4.read' }, 'v4.write']))
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.equal('toolOutputs' in result.value, false)
  assert.deepEqual(result.value.tools, ['v4.read', 'v4.write'])
})

// ── 非法声明（≥3 例）：形状不对就在安装期真拒 ──────────────────────────────

test('非法①：schema 不是对象／根本不给 schema／output 不是对象', () => {
  rejects(withTools([{ name: 'v4.read', output: { schema: 'object' } }]))
  rejects(withTools([{ name: 'v4.read', output: {} }]))
  rejects(withTools([{ name: 'v4.read', output: SIMPLE_SCHEMA }]))
})

test('非法②：根不是 type:object／白名单外关键字／未知类型字', () => {
  const wrongRoot = rejects(withTools([{ name: 'v4.read', output: validOutput({ type: 'string' }) }]))
  assert.match(wrongRoot.message, /type: 'object'/u)

  const unknownKeyword = rejects(withTools([{ name: 'v4.read', output: validOutput({ type: 'object', props: {} }) }]))
  assert.match(unknownKeyword.message, /props/u)

  const unknownType = rejects(withTools([{ name: 'v4.read', output: validOutput({ type: 'object', properties: { a: { type: 'date' } } }) }]))
  assert.match(unknownType.message, /date/u)
})

test('非法③：properties／required／$ref／pattern 的形状逐条守', () => {
  rejects(withTools([{ name: 'v4.read', output: validOutput({ type: 'object', properties: [] }) }]))
  rejects(withTools([{ name: 'v4.read', output: validOutput({ type: 'object', required: [1] }) }]))
  rejects(withTools([{ name: 'v4.read', output: validOutput({ type: 'object', properties: { a: { $ref: 'https://example.com/schema.json' } } }) }]))
  rejects(withTools([{ name: 'v4.read', output: validOutput({ type: 'object', properties: { a: { type: 'string', pattern: '(' } } }) }]))
  rejects(withTools([{ name: 'v4.read', output: validOutput({ type: 'object', enum: [] }) }]))
})

test('非法④：深度与序列化长度有上限（*_MAX 家族）', () => {
  let deep = { type: 'string' }
  for (let index = 0; index <= TOOL_OUTPUT_SCHEMA_DEPTH_MAX; index += 1) {
    deep = { type: 'object', properties: { child: deep } }
  }
  const deepError = rejects(withTools([{ name: 'v4.read', output: validOutput(deep) }]))
  assert.match(deepError.message, new RegExp(`${TOOL_OUTPUT_SCHEMA_DEPTH_MAX} 层`, 'u'))

  const longSchema = { type: 'object', description: 'x'.repeat(TOOL_OUTPUT_SCHEMA_MAX_CHARS) }
  const longError = rejects(withTools([{ name: 'v4.read', output: validOutput(longSchema) }]))
  assert.match(longError.message, new RegExp(`${TOOL_OUTPUT_SCHEMA_MAX_CHARS}`, 'u'))
})

test('非法⑤：presentationMeta 必须是 JSON 对象（数组／函数／超长都拒）', () => {
  rejects(withTools([{ name: 'v4.read', output: validOutput(SIMPLE_SCHEMA, []) }]))
  rejects(withTools([{ name: 'v4.read', output: validOutput(SIMPLE_SCHEMA, { format: () => 'x' }) }]))
  rejects(withTools([{ name: 'v4.read', output: validOutput(SIMPLE_SCHEMA, { note: 'x'.repeat(TOOL_PRESENTATION_META_MAX_CHARS) }) }]))
})

test('非法⑥：render 明确不做——output 只认 schema／presentationMeta，条目只认 name／output', () => {
  const renderError = rejects(withTools([{ name: 'v4.read', output: { schema: SIMPLE_SCHEMA, render: 'list' } }]))
  assert.match(renderError.message, /render/u)
  const entryError = rejects(withTools([{ name: 'v4.read', extra: true }]))
  assert.match(entryError.message, /extra/u)
  assert.deepEqual(V4_ONLY_TOOL_FIELDS, ['output'])
})

test('非法⑦：重复工具名仍按 TOOL_CONFLICT 拒（对象与字符串混写也算重复）', () => {
  const error = rejects(withTools([{ name: 'v4.read' }, 'v4.read']), 'TOOL_CONFLICT')
  assert.match(error.message, /v4\.read/u)
})

// ── 老版本写 @4 工具字段：拒装并指向 @4 ────────────────────────────────────

test('@1／@3 清单写 output：拒装并提示升级到 @4', () => {
  const v1 = rejects(withMutation(FIXTURE_NOVEL, (manifest) => {
    manifest.tools = [{ name: 'chapter.read', output: validOutput(SIMPLE_SCHEMA) }]
  }))
  assert.match(v1.message, /pinax-carrier@4/u)

  const v3 = rejects(withMutation(FIXTURE_V4, (manifest) => {
    manifest.spec = CARRIER_SPEC_V3
    manifest.manifestVersion = 3
    manifest.tools = [{ name: 'v4.read', output: validOutput(SIMPLE_SCHEMA) }]
    // 只留 @3 认的形状：@4 专属字段（license/maxKernel/preview/pane 七字段/adopt）全部剥掉，
    // 这样拒绝原因只可能是 output，而不是「@3 写了别的 @4 字段」。
    delete manifest.license
    delete manifest.maxKernel
    delete manifest.preview
    for (const pane of manifest.panes) {
      for (const field of ['multiplicity', 'scope', 'keyField', 'claims', 'priority', 'canOpen', 'takes']) delete pane[field]
    }
    for (const service of manifest.services ?? []) delete service.adopt
  }))
  assert.match(v3.message, /pinax-carrier@4/u)
})

// ── 聚合面透出与零消费（真运行时链路）─────────────────────────────────────

const OUTPUT_CARRIER = {
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: 'fixture.output',
  title: '工具输出契约（夹具）',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',
  primary: { projectKind: 'generic', defaultPane: 'output.pane', contextProfile: 'authoring' },
  dataDirs: { notes: '构思' },
  panes: [{ slot: 'center', id: 'output.pane', title: '输出', view: 'pinax.view.notes', kind: 'notes-editor' }],
  capabilities: [],
  requires: [],
  tools: [
    { name: 'fixture_read', output: validOutput(SIMPLE_SCHEMA, { mode: 'list' }) },
    'fixture_write'
  ],
  context: { providers: [], budgetChars: 2000 },
  scopes: ['file:构思:rw', 'agent:ask']
}

/** 返回体故意不合声明：text 是数字，而 schema 要求 string。本批不该有人拦它。 */
const OUTPUT_IMPL = {
  tools: () => [
    {
      name: 'fixture_read',
      description: '读（声明了 output，返回体故意不符）',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run: async () => ({ ok: true, value: { ok: true, text: 42 } })
    },
    {
      name: 'fixture_write',
      description: '写（没有 output 声明）',
      inputSchema: { type: 'object', properties: {} },
      run: async () => ({ ok: true, value: { ok: true } })
    }
  ]
}

async function openOutputSession() {
  const workspace = await createTempWorkspace('tool-output')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const installed = registry.install(OUTPUT_CARRIER, OUTPUT_IMPL)
  assert.equal(installed.ok, true, JSON.stringify(installed.error ?? {}))
  const root = join(workspace.projects, '输出契约靶子')
  const created = await createProject({ root, name: '输出契约靶子', primaryCarrier: OUTPUT_CARRIER.id, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  const started = await runtime.start()
  assert.equal(started.ok, true, JSON.stringify(started.error ?? {}))
  return { workspace, runtime }
}

test('聚合面透出：声明了 output 的工具带 _meta[\'pinax/output\']，没声明的工具不带', async () => {
  const { workspace, runtime } = await openOutputSession()
  try {
    assert.equal(TOOL_OUTPUT_META_KEY, 'pinax/output')
    const tools = runtime.listTools()
    const read = tools.find((tool) => tool.name === 'fixture_read')
    const write = tools.find((tool) => tool.name === 'fixture_write')
    assert.ok(read && write, tools.map((tool) => tool.name).join(','))
    assert.deepEqual(read._meta?.[TOOL_OUTPUT_META_KEY], {
      schema: SIMPLE_SCHEMA,
      presentationMeta: { mode: 'list' }
    })
    assert.equal('_meta' in write, false, '没声明 output 的工具不透出 _meta')
    assert.deepEqual([...runtime.surfaceInfo().carrierToolNames].sort(), ['fixture_read', 'fixture_write'])
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('零消费：返回体不符合声明 schema 仍照常成功（本批只透出，toolLoop 不校验）', async () => {
  const { workspace, runtime } = await openOutputSession()
  try {
    const result = await runtime.callTool('fixture_read', {})
    assert.equal(result.ok, true, JSON.stringify(result.value ?? {}))
    assert.equal(result.value.payload.ok, true)
    // schema 要求 text:string，实现返回 42——没有任何一层把它挡下来，这正是 ①档的口径。
    assert.equal(result.value.payload.text, 42)
    assert.equal(result.value.payload.code, undefined)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})
