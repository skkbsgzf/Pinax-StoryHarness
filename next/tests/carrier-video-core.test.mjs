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
import { VIDEO_CARRIER_ID } from '../carriers/video/manifest.mjs'
import { VIDEO_RECORD_CONFIG, VIDEO_TOOL_NAMES, createVideoTools } from '../carriers/video/tools.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T21 的单一真源对照：视频载体的记录文献语义来自 `@pinax/core/usecases/fileRecordTools`。
 * 本文件钉三件事：工具面与 core 同一份；记录 CRUD 的真文件链路（修订号闸、meta 原样搬运、
 * PINAX_* 回执）成立；二进制只在 refs 里作文本引用，渲染与原件归档仍留在宿主之外。
 */
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
const CORE_MODULE = createFileRecordToolsModule({ randomUUID: () => 'abcdef0123456789', fail, ok })

async function videoProject(label) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '视频核心靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '视频核心靶子', primaryCarrier: VIDEO_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  await mkdir(join(root, '视频'), { recursive: true })
  const tools = createVideoTools({ pluginId: VIDEO_CARRIER_ID, fileService: opened.value.fileService })
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

test('视频工具面由 core 的 fileRecordTools 生成：四把名字、描述与 schema 同一份', async () => {
  const source = await readFile(new URL('../carriers/video/tools.mjs', import.meta.url), 'utf-8')
  assert.match(source, /from '@pinax\/core\/usecases\/fileRecordTools'/u)
  assert.doesNotMatch(source, /jsonRecords\.mjs/u, '视频已切到 core 单一真源，不再走宿主记录底座')

  const tools = createVideoTools({ pluginId: VIDEO_CARRIER_ID })
  assert.deepEqual(tools.map((tool) => tool.name), [...VIDEO_TOOL_NAMES], '工具面仍是列／读／写／删四把')
  const reference = CORE_MODULE.createRecordTools({ pluginId: VIDEO_CARRIER_ID }, VIDEO_RECORD_CONFIG)
  assert.deepEqual(tools.map(stripRun), reference.map(stripRun), '同一配置下列出的工具面必须与 core 产物逐字一致')

  const save = tools.find((tool) => tool.name === 'pinax_video_save')
  assert.equal(save.inputSchema.properties.body.maxLength, CORE_MODULE.RECORD_MAX_BODY_CHARS, '正文上限取 core 常量')
  assert.equal(save.inputSchema.required.includes('expectedRevision'), true, '修订号必填的契约仍由 core 给')
})

test('真文件链路：记录形状、修订号闸与 PINAX_* 回执不变，meta 里的时长／画幅／提示词原样搬运', async () => {
  const { workspace, root, call } = await videoProject('video-core-records')
  try {
    const empty = await call('pinax_video_list')
    assert.equal(empty.ok, true, JSON.stringify(empty))
    assert.deepEqual([empty.value.file, empty.value.revision, empty.value.total], ['视频/视频.json', 0, 0])

    const shotMeta = {
      durationMs: 4200,
      aspect: '16:9',
      prompt: '雨夜的霓虹巷口，慢推镜头',
      refs: { original: '视频/原件/场1-镜头1.mp4', mask: '视频/原件/场1-镜头1-mask.png' }
    }
    const created = await call('pinax_video_save', {
      title: '场1-镜头1',
      type: 'shot',
      status: 'rendering',
      body: '黑场之后第一束霓虹亮起。',
      tags: ['场1'],
      refs: ['视频/原件/场1-镜头1.mp4'],
      meta: shotMeta,
      expectedRevision: 0
    })
    assert.equal(created.ok, true, JSON.stringify(created))
    assert.equal(created.value.revision, 1)
    const record = created.value.record
    assert.equal(record.type, 'shot')
    assert.equal(record.status, 'rendering', 'status 原样收进来，不硬枚举')
    assert.deepEqual(record.meta, shotMeta, '时长／画幅／提示词不因界面没显示就被洗掉')

    const stale = await call('pinax_video_save', { id: record.id, status: 'ready', expectedRevision: 0 })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, NEXT_ERROR_CODES.STALE_REVISION, '修订号不符必须拒，不覆盖不合并')

    const missing = await call('pinax_video_read', { id: 'shot-不存在' })
    assert.equal(missing.ok, false)
    for (const failure of [stale, missing]) {
      assert.match(failure.error.code, /^PINAX_/u, `回执只出宿主码，不许漏 CORE 裸码：${failure.error.code}`)
    }

    const updated = await call('pinax_video_save', { id: record.id, status: 'ready', expectedRevision: 1 })
    assert.equal(updated.ok, true, JSON.stringify(updated))
    assert.equal(updated.value.revision, 2)
    assert.equal(updated.value.record.body, '黑场之后第一束霓虹亮起。', '未传字段保留')
    assert.deepEqual(updated.value.record.meta, shotMeta)

    const disk = JSON.parse(await readFile(join(root, '视频', '视频.json'), 'utf-8'))
    assert.equal(disk.schemaVersion, CORE_MODULE.RECORD_SCHEMA_VERSION, '盘上 schema 版本取 core 常量')
    assert.equal(disk.records.length, 1)

    const binaryCopied = await stat(join(root, '视频', '原件', '场1-镜头1.mp4')).then(() => true, () => false)
    assert.equal(binaryCopied, false, 'refs 只是文本引用：渲染原件不由记录工具代拷')

    const removed = await call('pinax_video_remove', { id: record.id, expectedRevision: 2 })
    assert.equal(removed.ok, true, JSON.stringify(removed))
    assert.equal(removed.value.revision, 3)
    assert.deepEqual(
      JSON.parse(await readFile(join(root, '视频', '视频.json'), 'utf-8')),
      { schemaVersion: CORE_MODULE.RECORD_SCHEMA_VERSION, records: [] },
      '只删记录不删文件：作者还能回看与恢复'
    )
  } finally {
    await workspace.cleanup()
  }
})

test('坏文档与版本漂移：拒绝按记录集读取，也不自作主张升级', async () => {
  const { workspace, root, call } = await videoProject('video-core-legacy')
  const docPath = join(root, '视频', '视频.json')
  try {
    await writeFile(docPath, '{ 这不是 JSON', 'utf-8')
    const bad = await call('pinax_video_list')
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(String(bad.error.message), /不是合法 JSON/u)

    await writeFile(docPath, JSON.stringify({ schemaVersion: 2, records: [] }), 'utf-8')
    const drifted = await call('pinax_video_list')
    assert.equal(drifted.ok, false)
    assert.match(String(drifted.error.message), /schemaVersion=2/u, '不自作主张升级／降级')
  } finally {
    await workspace.cleanup()
  }
})
