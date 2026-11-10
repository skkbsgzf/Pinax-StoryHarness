import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createFileRecordToolsModule } from '@pinax/core/usecases/fileRecordTools'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES, fail, ok } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { MATERIAL_CARRIER_ID } from '../carriers/material/manifest.mjs'
import { MATERIAL_RECORD_CONFIG, MATERIAL_TOOL_NAMES, createMaterialTools } from '../carriers/material/tools.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T7 的单一真源对照：素材载体的记录文献语义来自 `@pinax/core/usecases/fileRecordTools`
 * （0.11 从 Next 记录型载体原样抽出的那一份），不是 0.8 的扁平资料表 materialService。
 * 本文件钉三件事：工具面与 core 同源；core 的文档规则（混用 type/status 不洗、旧文档宽容、
 * 写严格、修订号闸）在真文件链路上成立；二进制只在 refs 里作文本引用。
 */
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
const CORE_MODULE = createFileRecordToolsModule({ randomUUID: () => 'abcdef0123456789', fail, ok })

async function materialProject(label) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '素材核心靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '素材核心靶子', primaryCarrier: MATERIAL_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  await mkdir(join(root, '素材'), { recursive: true })
  const tools = createMaterialTools({ pluginId: MATERIAL_CARRIER_ID, fileService: opened.value.fileService })
  const call = (name, args = {}) => tools.find((tool) => tool.name === name).run(args)
  return { workspace, root, call }
}

function stripRun(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations
  }
}

test('素材工具面由 core 的 fileRecordTools 生成：四把名字、描述与 schema 同一份', async () => {
  const source = await readFile(new URL('../carriers/material/tools.mjs', import.meta.url), 'utf-8')
  assert.match(source, /from '@pinax\/core\/usecases\/fileRecordTools'/u)
  assert.doesNotMatch(source, /jsonRecords\.mjs/u, '素材已切到 core 单一真源，不再走宿主记录底座')

  const tools = createMaterialTools({ pluginId: MATERIAL_CARRIER_ID })
  assert.deepEqual(tools.map((tool) => tool.name), [...MATERIAL_TOOL_NAMES], '工具面仍是列／读／写／删四把')
  const reference = CORE_MODULE.createRecordTools({ pluginId: MATERIAL_CARRIER_ID }, MATERIAL_RECORD_CONFIG)
  assert.deepEqual(tools.map(stripRun), reference.map(stripRun), '同一配置下列出的工具面必须与 core 产物逐字一致')

  const save = tools.find((tool) => tool.name === 'pinax_material_save')
  assert.equal(save.inputSchema.properties.body.maxLength, CORE_MODULE.RECORD_MAX_BODY_CHARS, '正文上限取 core 常量，不在载体另立一套')
})

test('真文件链路：空文档起步、混用 type/status 不洗、修订号闸与 PINAX_* 回执', async () => {
  const { workspace, root, call } = await materialProject('material-core-records')
  try {
    const empty = await call('pinax_material_list')
    assert.equal(empty.ok, true, JSON.stringify(empty))
    assert.deepEqual([empty.value.file, empty.value.revision, empty.value.total], ['素材/素材.json', 0, 0])

    const created = await call('pinax_material_save', {
      title: '旧稿残页',
      type: 'legacy-note',
      status: '写了一半',
      body: '老数据里本来就有混用。',
      tags: ['旧稿'],
      refs: ['资料/参考/雨夜.png', 'https://example.invalid/ref.png'],
      meta: { ink: 'blue', nested: { keep: true } },
      expectedRevision: 0
    })
    assert.equal(created.ok, true, JSON.stringify(created))
    assert.equal(created.value.revision, 1)
    const record = created.value.record
    assert.equal(record.type, 'legacy-note', '记录文献不按 0.8 资料表的 kind 白名单洗值')
    assert.equal(record.status, '写了一半', 'status 原样收进来，不硬枚举')
    assert.deepEqual(record.refs, ['资料/参考/雨夜.png', 'https://example.invalid/ref.png'])

    const stale = await call('pinax_material_save', { id: record.id, status: 'accepted', expectedRevision: 0 })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, NEXT_ERROR_CODES.STALE_REVISION, '修订号不符必须拒，不覆盖不合并')

    const missing = await call('pinax_material_read', { id: 'material-不存在' })
    assert.equal(missing.ok, false)

    const failures = [stale, missing]
    for (const failure of failures) {
      assert.match(failure.error.code, /^PINAX_/u, `回执只出宿主码，不许漏 CORE 裸码：${failure.error.code}`)
    }

    const updated = await call('pinax_material_save', { id: record.id, title: '旧稿残页（校）', expectedRevision: 1 })
    assert.equal(updated.ok, true, JSON.stringify(updated))
    assert.equal(updated.value.revision, 2)
    assert.equal(updated.value.record.body, '老数据里本来就有混用。', '未传字段保留')
    assert.deepEqual(updated.value.record.meta, { ink: 'blue', nested: { keep: true } }, 'meta 不被界面没显示洗掉')
    assert.equal(updated.value.record.type, 'legacy-note')

    const disk = JSON.parse(await readFile(join(root, '素材', '素材.json'), 'utf-8'))
    assert.equal(disk.schemaVersion, CORE_MODULE.RECORD_SCHEMA_VERSION, '盘上 schema 版本取 core 常量')
    assert.equal(disk.records.length, 1)
    assert.equal(disk.records[0].meta.nested.keep, true)

    const binaryCopied = await stat(join(root, '资料', '参考', '雨夜.png')).then(() => true, () => false)
    assert.equal(binaryCopied, false, 'refs 只是文本引用：二进制不进这份文档，也不由载体代拷')

    const removed = await call('pinax_material_remove', { id: record.id, expectedRevision: 2 })
    assert.equal(removed.ok, true, JSON.stringify(removed))
    assert.equal(removed.value.revision, 3)
    assert.deepEqual(
      JSON.parse(await readFile(join(root, '素材', '素材.json'), 'utf-8')),
      { schemaVersion: CORE_MODULE.RECORD_SCHEMA_VERSION, records: [] },
      '只删记录不删文件：作者还能回看与恢复'
    )
  } finally {
    await workspace.cleanup()
  }
})

test('旧文档宽容、写严格：未知顶层字段原样保留；坏 JSON 与版本漂移拒绝按记录集读取', async () => {
  const { workspace, root, call } = await materialProject('material-core-legacy')
  const docPath = join(root, '素材', '素材.json')
  try {
    const legacy = {
      schemaVersion: 1,
      records: [{
        id: 'material-legacy-00000001',
        title: '迁移旧页',
        type: 'inspiration',
        status: 'inbox',
        order: 0,
        body: '旧数据里混进来的字段要原样留着。',
        tags: ['旧'],
        refs: [],
        meta: { from: 'localStorage' },
        origin: { host: 'web', version: 'narrative_assets_v1' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }]
    }
    await writeFile(docPath, JSON.stringify(legacy, null, 2), 'utf-8')

    const listed = await call('pinax_material_list')
    assert.equal(listed.ok, true, JSON.stringify(listed))
    assert.equal(listed.value.revision, 1, '盘上既有文件按第 1 版处理，expectedRevision 0 只留给真正的新建')

    const saved = await call('pinax_material_save', { id: legacy.records[0].id, title: '迁移旧页（校）', expectedRevision: 1 })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual(saved.value.record.origin, { host: 'web', version: 'narrative_assets_v1' }, '未知顶层字段不因界面不显示就被洗掉')
    assert.equal(saved.value.record.createdAt, legacy.records[0].createdAt)

    await writeFile(docPath, '{ 这不是 JSON', 'utf-8')
    const bad = await call('pinax_material_list')
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(String(bad.error.message), /不是合法 JSON/u)
    const refusedSave = await call('pinax_material_save', { title: '不许盲写', expectedRevision: 2 })
    assert.equal(refusedSave.ok, false, '读不出文档就不能覆盖它')

    await writeFile(docPath, JSON.stringify({ schemaVersion: 2, records: [] }), 'utf-8')
    const drifted = await call('pinax_material_list')
    assert.equal(drifted.ok, false)
    assert.match(String(drifted.error.message), /schemaVersion=2/u, '不自作主张升级／降级')
  } finally {
    await workspace.cleanup()
  }
})
