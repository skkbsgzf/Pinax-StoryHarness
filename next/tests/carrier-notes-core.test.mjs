import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { createNoteService } from '@pinax/core/usecases/noteService'
import { createMemoryNoteStore } from '@pinax/core/adapters/memoryNoteStore'
import { countNoteWords } from '@pinax/core/domain/note'
import { CORE_ERROR_CODES } from '@pinax/core/contracts/errors'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { NOTES_CARRIER_ID } from '../carriers/notes/manifest.mjs'
import { createNotesStore, toHostResult } from '../carriers/notes/noteStore.mjs'
import { createNotesTools } from '../carriers/notes/tools.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T6 的行为对照：构思载体的 fileService→NoteStore 适配器与 Core 自己的
 * createMemoryNoteStore 跑同一段剧本，标题/正文/字数必须同形；宿主额外的修订号闸
 * （expectedRevision）在适配器上保持既有 PINAX_STALE_REVISION 回执，不因切 Core 而松掉。
 * 笔记域规则（标题回退、正文裁剪、字数口径、空正文拒绝）只在 Core 一处，本文件不另立标准。
 */
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
const NOTES_DIR = '构思'

async function notesDomain(label) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '构思核心对照')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '构思核心对照', primaryCarrier: NOTES_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const store = createNotesStore({ pluginId: NOTES_CARRIER_ID, fileService: opened.value.fileService, dir: NOTES_DIR })
  return { workspace, root, fileService: opened.value.fileService, store, service: createNoteService({ store }) }
}

test('Core 裸码在适配器边界翻译成宿主 PINAX_*：未登记落 INVALID_INPUT，PINAX_* 原样放行', () => {
  const stale = toHostResult({ ok: false, error: { code: CORE_ERROR_CODES.STALE_REVISION, message: '旧版', details: { expected: 1, actual: 2 } } })
  assert.equal(stale.error.code, NEXT_ERROR_CODES.STALE_REVISION)
  assert.deepEqual(stale.error.details, { expected: 1, actual: 2 })

  const notFound = toHostResult({ ok: false, error: { code: CORE_ERROR_CODES.NOTE_NOT_FOUND, message: '笔记不存在' } })
  assert.equal(notFound.error.code, NEXT_ERROR_CODES.INVALID_INPUT)

  const unregistered = toHostResult({ ok: false, error: { code: CORE_ERROR_CODES.MATERIAL_NOT_FOUND, message: '未登记' } })
  assert.equal(unregistered.error.code, NEXT_ERROR_CODES.INVALID_INPUT, '没登记的 Core 码一律落 INVALID_INPUT')

  const pinax = { ok: false, error: { code: NEXT_ERROR_CODES.DIR_CONFLICT, message: '归属' } }
  assert.equal(toHostResult(pinax), pinax, '文件服务自己的 PINAX_* 原样放行')
  assert.equal(toHostResult({ ok: true, value: 1 }).ok, true)
})

test('记录语义对齐 Core 参照实现：create→read→update 的标题/正文/字数同形', async () => {
  const memoryService = createNoteService({ store: createMemoryNoteStore() })
  const { workspace, root, store, service } = await notesDomain('notes-core-parity')
  try {
    const input = { id: '雨夜的表.md', title: '雨夜的表', content: '袖口的表停在十二点差三分。\nPeople wait.' }
    const memoryCreated = await memoryService.create(input)
    const fileCreated = await service.create(input)
    assert.equal(fileCreated.ok, true, JSON.stringify(fileCreated.error ?? {}))
    assert.deepEqual(
      [fileCreated.value.title, fileCreated.value.content, fileCreated.value.wordCount],
      [memoryCreated.value.title, memoryCreated.value.content, memoryCreated.value.wordCount]
    )
    assert.equal(fileCreated.value.wordCount, countNoteWords(input.content), '字数口径由 Core 的 countNoteWords 决定')
    assert.equal(await readFile(join(root, NOTES_DIR, '雨夜的表.md'), 'utf-8'), input.content)

    const memoryRead = await memoryService.read('雨夜的表.md')
    const fileRead = await service.read('雨夜的表.md')
    assert.deepEqual(
      [fileRead.value.title, fileRead.value.content, fileRead.value.wordCount],
      [memoryRead.value.title, memoryRead.value.content, memoryRead.value.wordCount]
    )

    const next = '表针重新走了起来。'
    const memoryUpdated = await memoryService.update('雨夜的表.md', { content: next })
    const fileUpdated = await store.save('雨夜的表.md', { content: next }, { expectedRevision: 1 })
    assert.equal(fileUpdated.ok, true, JSON.stringify(fileUpdated.error ?? {}))
    assert.deepEqual(
      [fileUpdated.value.content, fileUpdated.value.wordCount],
      [memoryUpdated.value.content, memoryUpdated.value.wordCount]
    )
    assert.equal(await readFile(join(root, NOTES_DIR, '雨夜的表.md'), 'utf-8'), next)

    const memoryList = await memoryService.list()
    const fileList = await service.list()
    assert.deepEqual(fileList.value.map((note) => note.id), memoryList.value.map((note) => note.id))
    assert.deepEqual(fileList.value.map((note) => note.wordCount), memoryList.value.map((note) => note.wordCount))
  } finally {
    await workspace.cleanup()
  }
})

test('修订号闸仍在：盲写与旧版改稿报 PINAX_STALE_REVISION，盘上不动；盘上没有的篇按第 0 版判', async () => {
  const { workspace, root, store, service } = await notesDomain('notes-core-stale')
  try {
    assert.equal((await service.create({ id: '速记.md', title: '速记', content: '第一版。' })).ok, true)

    const blind = await service.create({ id: '速记.md', title: '速记', content: '盲写覆盖' })
    assert.equal(blind.ok, false)
    assert.equal(blind.error.code, NEXT_ERROR_CODES.STALE_REVISION, '文件服务的 PINAX_* 码原样经过适配器')
    assert.equal(blind.error.details.actual, 1)

    const stale = await store.save('速记.md', { content: '基于旧版的一笔' }, { expectedRevision: 0 })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.deepEqual([stale.error.details.expected, stale.error.details.actual], [0, 1])
    assert.equal(await readFile(join(root, NOTES_DIR, '速记.md'), 'utf-8'), '第一版。', 'STALE 拒绝后磁盘不动')

    const missing = await store.save('第404篇.md', { content: 'x' }, { expectedRevision: 3 })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.deepEqual([missing.error.details.expected, missing.error.details.actual], [3, 0])
    assert.equal(missing.error.details.path, `${NOTES_DIR}/第404篇.md`)
    assert.equal(await stat(join(root, NOTES_DIR, '第404篇.md')).then(() => true, () => false), false, 'STALE 不落盘')
  } finally {
    await workspace.cleanup()
  }
})

test('正文清洗沿用 Core：首尾空白裁掉、纯空白拒绝（作者看到的仍是 PINAX_INVALID_INPUT）', async () => {
  const { workspace, root, fileService } = await notesDomain('notes-core-content')
  try {
    const save = createNotesTools({ pluginId: NOTES_CARRIER_ID, fileService }).find((tool) => tool.name === 'pinax_notes_save')

    const created = await save.run({ title: '留白', text: '  第一行  \n', expectedRevision: 0 })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
    assert.equal(await readFile(join(root, NOTES_DIR, '留白.md'), 'utf-8'), '第一行', 'Core 的正文裁剪是保存语义的一部分')

    const blank = await save.run({ title: '空白', text: '   \n ', expectedRevision: 0 })
    assert.equal(blank.ok, false)
    assert.equal(blank.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.equal(await stat(join(root, NOTES_DIR, '空白.md')).then(() => true, () => false), false, '空正文不落盘')
  } finally {
    await workspace.cleanup()
  }
})

test('工具回执形状不变：save 五键、list 条目八键', async () => {
  const { workspace, fileService } = await notesDomain('notes-core-receipt')
  try {
    const tools = createNotesTools({ pluginId: NOTES_CARRIER_ID, fileService })
    const save = tools.find((tool) => tool.name === 'pinax_notes_save')
    const list = tools.find((tool) => tool.name === 'pinax_notes_list')

    const created = await save.run({ title: '形状', text: '一句话。', expectedRevision: 0 })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
    assert.deepEqual(Object.keys(created.value).sort(), ['bytes', 'created', 'file', 'revision', 'sha256'])
    assert.deepEqual(
      { file: created.value.file, revision: created.value.revision, created: created.value.created },
      { file: '构思/形状.md', revision: 1, created: true }
    )

    const listed = await list.run({})
    assert.equal(listed.ok, true, JSON.stringify(listed.error ?? {}))
    assert.deepEqual(Object.keys(listed.value).sort(), ['notes', 'total', 'truncated'])
    assert.deepEqual(
      Object.keys(listed.value.notes[0]).sort(),
      ['file', 'index', 'name', 'revision', 'text', 'title', 'totalChars', 'truncated']
    )
  } finally {
    await workspace.cleanup()
  }
})
