import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createFileRecordToolsModule } from '@pinax/core/usecases/fileRecordTools'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES, fail, ok } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { COMIC_CARRIER_ID } from '../carriers/comic/manifest.mjs'
import { COMIC_RECORD_CONFIG, COMIC_TOOL_NAMES, createComicTools } from '../carriers/comic/tools.mjs'
import { normalizeComicMetaForSave, normalizeComicPanelRecord } from '../carriers/comic/comicPageStore.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T8 的单一真源对照：漫画载体的记录文献语义来自 `@pinax/core/usecases/fileRecordTools`，
 * 漫画格的「显示选择／阶段产物 vs 普通图片候选」来自 `@pinax/core/media/comicPanelDisplay`。
 * 本文件钉三件事：工具面与 core 同源；作者可见的记录／回执／修订号一个字不变；
 * core 的选中规则只落在作者真写了的字段上，不注入页模型默认值。
 */
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
const CORE_MODULE = createFileRecordToolsModule({ randomUUID: () => 'abcdef0123456789', fail, ok })

async function comicProject(label) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '漫画核心靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '漫画核心靶子', primaryCarrier: COMIC_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  await mkdir(join(root, '漫画'), { recursive: true })
  const tools = createComicTools({ pluginId: COMIC_CARRIER_ID, fileService: opened.value.fileService })
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

test('漫画工具面由 core 的 fileRecordTools 生成：四把名字、描述与 schema 同一份', async () => {
  const source = await readFile(new URL('../carriers/comic/tools.mjs', import.meta.url), 'utf-8')
  assert.match(source, /from '@pinax\/core\/usecases\/fileRecordTools'/u)
  assert.doesNotMatch(source, /jsonRecords\.mjs/u, '漫画已切到 core 单一真源，不再走宿主记录底座')
  const adapter = await readFile(new URL('../carriers/comic/comicPageStore.mjs', import.meta.url), 'utf-8')
  assert.match(adapter, /from '@pinax\/core\/media\/comicPanelDisplay'/u, '显示选择规则取 core 媒体域，不在载体另写一份')

  const tools = createComicTools({ pluginId: COMIC_CARRIER_ID })
  assert.deepEqual(tools.map((tool) => tool.name), [...COMIC_TOOL_NAMES], '工具面仍是列／读／写／删四把')
  const reference = CORE_MODULE.createRecordTools({ pluginId: COMIC_CARRIER_ID }, COMIC_RECORD_CONFIG)
  assert.deepEqual(tools.map(stripRun), reference.map(stripRun), '同一配置下列出的工具面必须与 core 产物逐字一致')

  const save = tools.find((tool) => tool.name === 'pinax_comic_save')
  assert.equal(save.inputSchema.properties.body.maxLength, CORE_MODULE.RECORD_MAX_BODY_CHARS, '正文上限取 core 常量')
  assert.equal(save.inputSchema.required.includes('expectedRevision'), true, '修订号必填的契约仍由 core 给')
})

test('真文件链路：作者可见的记录形状、修订号闸与 PINAX_* 回执不变', async () => {
  const { workspace, root, call } = await comicProject('comic-core-records')
  try {
    const empty = await call('pinax_comic_list')
    assert.equal(empty.ok, true, JSON.stringify(empty))
    assert.deepEqual([empty.value.file, empty.value.revision, empty.value.total], ['漫画/漫画.json', 0, 0])

    const panels = [{ composition: '全景·雨巷', dialogue: '你终于来了。' }, { composition: '特写·眼睛' }]
    const created = await call('pinax_comic_save', {
      title: '雨夜开场',
      type: 'comic-page',
      status: 'draft',
      order: 0,
      body: '页说明',
      tags: ['开篇'],
      refs: ['素材/参考/雨巷.png'],
      meta: { panels },
      expectedRevision: 0
    })
    assert.equal(created.ok, true, JSON.stringify(created))
    assert.equal(created.value.revision, 1)
    assert.equal(created.value.created, true)
    assert.deepEqual(created.value.record.meta, { panels }, '没有选中字段的格一个字节不改，不注入 core 页模型默认值')

    const record = created.value.record
    const stale = await call('pinax_comic_save', { id: record.id, title: '抢先改', expectedRevision: 0 })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, NEXT_ERROR_CODES.STALE_REVISION, '修订号不符必须拒，不覆盖不合并')
    assert.match(stale.error.code, /^PINAX_/u, '回执只出宿主码')

    const updated = await call('pinax_comic_save', { id: record.id, title: '雨夜开场（校）', expectedRevision: 1 })
    assert.equal(updated.ok, true, JSON.stringify(updated))
    assert.equal(updated.value.revision, 2)
    assert.deepEqual(updated.value.record.meta, { panels }, '未传 meta 时原样保留')
    assert.equal(updated.value.record.body, '页说明', '未传字段保留')

    const read = await call('pinax_comic_read', { id: record.id })
    assert.equal(read.ok, true, JSON.stringify(read))
    assert.deepEqual(read.value.record.meta, { panels })

    const disk = JSON.parse(await readFile(join(root, '漫画', '漫画.json'), 'utf-8'))
    assert.equal(disk.schemaVersion, CORE_MODULE.RECORD_SCHEMA_VERSION, '盘上 schema 版本取 core 常量')
    assert.deepEqual(disk.records[0].meta, { panels })

    const removed = await call('pinax_comic_remove', { id: record.id, expectedRevision: 2 })
    assert.equal(removed.ok, true, JSON.stringify(removed))
    assert.deepEqual(
      JSON.parse(await readFile(join(root, '漫画', '漫画.json'), 'utf-8')),
      { schemaVersion: CORE_MODULE.RECORD_SCHEMA_VERSION, records: [] },
      '只删记录不删文件'
    )
  } finally {
    await workspace.cleanup()
  }
})

test('显示选择与阶段产物：core 只归作者真写了的选中字段，未知字段原样保留', async () => {
  const { workspace, root, call } = await comicProject('comic-core-selection')
  try {
    const input = {
      panels: [
        {
          composition: '中景·门开',
          dialogue: '门开了。',
          imageTakeIds: ['take-1', 'take-1', ' take-2 '],
          selectedTakeId: 'take-1',
          displaySelection: { type: 'take', assetId: 'take-1' },
          custom: { keep: true }
        },
        {
          composition: '近景·眼',
          dialogue: '……',
          imageTakeIds: ['take-3'],
          selectedTakeId: 'take-ghost',
          displaySelection: { type: 'stage', stage: 'rough', assetId: 'art-1' },
          production: {
            rough: { status: 'approved', artifactIds: ['art-1', 'art-1'], selectedArtifactId: 'art-1' },
            line: { status: 'review', artifactIds: ['art-2'], selectedArtifactId: 'art-ghost' }
          }
        },
        {
          composition: '远景',
          displaySelection: { type: 'stage', stage: 'sketch', assetId: 'art-x' }
        },
        {
          composition: '空镜',
          displaySelection: { type: 'take' }
        }
      ]
    }
    const created = await call('pinax_comic_save', {
      title: '选中口径',
      type: 'comic-page',
      meta: input,
      expectedRevision: 0
    })
    assert.equal(created.ok, true, JSON.stringify(created))

    const panels = created.value.record.meta.panels
    assert.deepEqual(panels[0].imageTakeIds, ['take-1', 'take-2'], '普通图片候选按 core 去重、去空白')
    assert.equal(panels[0].selectedTakeId, 'take-1', '候选在 imageTakeIds 里才算选中')
    assert.deepEqual(panels[0].displaySelection, { type: 'take', assetId: 'take-1' })
    assert.deepEqual(panels[0].custom, { keep: true }, '未知字段不因界面不认识就被洗掉')
    assert.equal(panels[0].composition, '中景·门开')
    assert.equal(panels[0].dialogue, '门开了。')

    assert.equal(panels[1].selectedTakeId, null, '不在 imageTakeIds 里的 selectedTakeId 按 core 归 null')
    assert.deepEqual(panels[1].displaySelection, { type: 'stage', stage: 'rough', assetId: 'art-1' }, '阶段产物是 stage 选中，不是普通图片候选')
    assert.deepEqual(panels[1].production.rough.artifactIds, ['art-1'])
    assert.equal(panels[1].production.rough.selectedArtifactId, 'art-1', '阶段产物在 artifactIds 里才算选中')
    assert.equal(panels[1].production.line.selectedArtifactId, null, '阶段产物不在 artifactIds 里归 null')

    assert.equal(panels[2].displaySelection, null, 'core 不认的阶段名按 normalize 归 null')
    assert.equal(panels[3].displaySelection, null, '缺 assetId 的显示选择归 null')

    const disk = JSON.parse(await readFile(join(root, '漫画', '漫画.json'), 'utf-8'))
    assert.deepEqual(disk.records[0].meta.panels[1].production.line.selectedArtifactId, null, '归一结果真落盘，不是只在回执里好看')
  } finally {
    await workspace.cleanup()
  }
})

test('归一器是纯函数：无 panels／非数组 meta 原样交还，输入对象不被改写', () => {
  const meta = { ink: 'blue' }
  assert.equal(normalizeComicMetaForSave(meta), meta)

  const panelsMeta = { panels: 'not-an-array', keep: 1 }
  assert.equal(normalizeComicMetaForSave(panelsMeta), panelsMeta)

  const panel = {
    composition: '全景',
    imageTakeIds: ['take-1'],
    selectedTakeId: 'take-ghost',
    displaySelection: { type: 'take', assetId: 'take-1' }
  }
  const normalized = normalizeComicPanelRecord(panel)
  assert.equal(normalized.selectedTakeId, null)
  assert.equal(panel.selectedTakeId, 'take-ghost', '不就地改调用方对象')
  assert.notEqual(normalized, panel)

  const metaWithPanels = { panels: [panel] }
  const normalizedMeta = normalizeComicMetaForSave(metaWithPanels)
  assert.notEqual(normalizedMeta, metaWithPanels)
  assert.equal(metaWithPanels.panels[0].selectedTakeId, 'take-ghost', '原 meta 的格不被就地改')
})
