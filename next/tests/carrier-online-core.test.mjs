import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createFileRecordToolsModule } from '@pinax/core/usecases/fileRecordTools'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES, fail, ok } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { ONLINE_CARRIER_ID } from '../carriers/online/manifest.mjs'
import { ONLINE_RECORD_CONFIG, ONLINE_TOOL_NAMES, createOnlineTools } from '../carriers/online/tools.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T21 的单一真源对照：联机载体的记录文献语义来自 `@pinax/core/usecases/fileRecordTools`。
 * 本文件钉三件事：工具面与 core 同一份；房间／成员／邀请记录的真文件链路成立；
 * 联机仍是「只记，不连」——服务器地址、邀请码只当 meta 文本搬运，core 不碰网络。
 */
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
const CORE_MODULE = createFileRecordToolsModule({ randomUUID: () => 'abcdef0123456789', fail, ok })

async function onlineProject(label) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '联机核心靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '联机核心靶子', primaryCarrier: ONLINE_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  await mkdir(join(root, '联机'), { recursive: true })
  const tools = createOnlineTools({ pluginId: ONLINE_CARRIER_ID, fileService: opened.value.fileService })
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

test('联机工具面由 core 的 fileRecordTools 生成：四把名字、描述与 schema 同一份', async () => {
  const source = await readFile(new URL('../carriers/online/tools.mjs', import.meta.url), 'utf-8')
  assert.match(source, /from '@pinax\/core\/usecases\/fileRecordTools'/u)
  assert.doesNotMatch(source, /jsonRecords\.mjs/u, '联机已切到 core 单一真源，不再走宿主记录底座')

  const tools = createOnlineTools({ pluginId: ONLINE_CARRIER_ID })
  assert.deepEqual(tools.map((tool) => tool.name), [...ONLINE_TOOL_NAMES], '工具面仍是列／读／写／删四把')
  const reference = CORE_MODULE.createRecordTools({ pluginId: ONLINE_CARRIER_ID }, ONLINE_RECORD_CONFIG)
  assert.deepEqual(tools.map(stripRun), reference.map(stripRun), '同一配置下列出的工具面必须与 core 产物逐字一致')

  const save = tools.find((tool) => tool.name === 'pinax_online_save')
  assert.equal(save.inputSchema.properties.body.maxLength, CORE_MODULE.RECORD_MAX_BODY_CHARS, '正文上限取 core 常量')
})

test('真文件链路：房间／成员记录带修订号落盘，meta 里的服务器与邀请码原样搬运（只记，不连）', async () => {
  const { workspace, root, call } = await onlineProject('online-core-records')
  try {
    const empty = await call('pinax_online_list')
    assert.equal(empty.ok, true, JSON.stringify(empty))
    assert.deepEqual([empty.value.file, empty.value.revision, empty.value.total], ['联机/联机.json', 0, 0])

    const roomMeta = {
      endpoint: 'wss://example.invalid/rooms',
      inviteCode: 'NIGHT-42',
      maxMembers: 6,
      visibility: 'friends'
    }
    const created = await call('pinax_online_save', {
      title: '雨夜长桌',
      type: 'room',
      status: 'open',
      body: '周五晚八点，六人局，剧本已定。',
      tags: ['周五'],
      meta: roomMeta,
      expectedRevision: 0
    })
    assert.equal(created.ok, true, JSON.stringify(created))
    assert.equal(created.value.revision, 1)
    const record = created.value.record
    assert.equal(record.status, 'open', 'status 原样收进来，不硬枚举')
    assert.deepEqual(record.meta, roomMeta, '服务器地址／邀请码只是记录字段，不做连接')

    const stale = await call('pinax_online_save', { id: record.id, status: 'closed', expectedRevision: 0 })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.match(stale.error.code, /^PINAX_/u)

    const updated = await call('pinax_online_save', { id: record.id, status: 'closed', expectedRevision: 1 })
    assert.equal(updated.ok, true, JSON.stringify(updated))
    assert.equal(updated.value.revision, 2)
    assert.equal(updated.value.record.body, '周五晚八点，六人局，剧本已定。', '未传字段保留')
    assert.deepEqual(updated.value.record.meta, roomMeta)

    const disk = JSON.parse(await readFile(join(root, '联机', '联机.json'), 'utf-8'))
    assert.equal(disk.schemaVersion, CORE_MODULE.RECORD_SCHEMA_VERSION)
    assert.equal(disk.records[0].meta.inviteCode, 'NIGHT-42')

    const removed = await call('pinax_online_remove', { id: record.id, expectedRevision: 2 })
    assert.equal(removed.ok, true, JSON.stringify(removed))
    assert.deepEqual(
      JSON.parse(await readFile(join(root, '联机', '联机.json'), 'utf-8')),
      { schemaVersion: CORE_MODULE.RECORD_SCHEMA_VERSION, records: [] },
      '只删记录不删文件'
    )
  } finally {
    await workspace.cleanup()
  }
})

test('旧文档宽容、写严格：未知顶层字段原样保留；坏 JSON 与版本漂移拒绝按记录集读取', async () => {
  const { workspace, root, call } = await onlineProject('online-core-legacy')
  const docPath = join(root, '联机', '联机.json')
  try {
    const legacy = {
      schemaVersion: 1,
      records: [{
        id: 'room-legacy-00000001',
        title: '旧房间',
        type: 'room',
        status: 'open',
        order: 0,
        body: '旧数据里混进来的字段要原样留着。',
        tags: [],
        refs: [],
        meta: { from: 'localStorage' },
        origin: { host: 'web', version: 'narrative_assets_v1' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }]
    }
    await writeFile(docPath, JSON.stringify(legacy, null, 2), 'utf-8')

    const listed = await call('pinax_online_list')
    assert.equal(listed.ok, true, JSON.stringify(listed))
    assert.equal(listed.value.revision, 1)

    const saved = await call('pinax_online_save', { id: legacy.records[0].id, title: '旧房间（校）', expectedRevision: 1 })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.deepEqual(saved.value.record.origin, { host: 'web', version: 'narrative_assets_v1' }, '未知顶层字段不因界面不显示就被洗掉')

    await writeFile(docPath, '{ 这不是 JSON', 'utf-8')
    const bad = await call('pinax_online_list')
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(String(bad.error.message), /不是合法 JSON/u)

    await writeFile(docPath, JSON.stringify({ schemaVersion: 2, records: [] }), 'utf-8')
    const drifted = await call('pinax_online_list')
    assert.equal(drifted.ok, false)
    assert.match(String(drifted.error.message), /schemaVersion=2/u)
  } finally {
    await workspace.cleanup()
  }
})
