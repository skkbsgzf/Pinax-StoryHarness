import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { kernelToolNames } from '../runtime/mcpSurface.mjs'
import { readOnlyTaskForProfile } from '../runtime/contextProfiles.mjs'
import {
  BUILT_IN_CARRIER_IDS,
  BUILT_IN_CARRIER_PLUGINS,
  NOTES_CARRIER,
  NOTES_CARRIER_ID,
  NOTES_TOOL_NAMES,
  NOVEL_CARRIER_ID,
  createNotesTools
} from '../carriers/index.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 协议 v1.1-A：构思载体（构思/）——从小说载体整块拆出来的独立一栏。
 * 证四件事：清单过内核校验且两把都是载体自有名字（认领面不虚增）；
 * 目录归属独立；列表把正文随手带回、保存带修订号；盲写／非 .md／空 text 都拒。
 */

async function notesProject(label, { startRuntime = true } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '构思载体靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '构思载体靶子', primaryCarrier: NOTES_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = startRuntime
    ? createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
    : null
  if (runtime) await runtime.start()
  return { workspace, root, registry, opened, runtime }
}

test('构思真清单过校验：两把都是载体自有名字，构思/ 申请 rw，上下文块不谎报', () => {
  const validated = validateCarrierManifest(NOTES_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  assert.deepEqual(NOTES_CARRIER.tools, ['pinax_notes_list', 'pinax_notes_save'])
  assert.equal(NOTES_CARRIER.tools.every((name) => !kernel.has(name)), true, '两把都是载体自有名字（列与读合在一把里，内核没有同名工具），认领面不虚增')
  assert.deepEqual({ ...NOTES_CARRIER.dataDirs }, { notes: '构思' })
  assert.deepEqual(NOTES_CARRIER.permissions, [{ type: 'file', dir: '构思', mode: 'rw' }, 'agent:ask'], 'v2：只申请 构思/ 一块目录的 rw；agent:ask 是运行时调用载体工具的前置授权')
  assert.deepEqual(NOTES_CARRIER.provides, ['notes.ideas'])
  assert.deepEqual(NOTES_CARRIER.context, { providers: [], budgetChars: 20000 }, '构思目前不提供上下文块：空的 providers 比谎报一块不存在的素材诚实')
  assert.deepEqual(NOTES_CARRIER.contributes.panes.map((pane) => pane.id), ['notes.list', 'notes.editor'])
  assert.equal(NOTES_CARRIER.primary.projectKind, 'generic')
  assert.equal(NOTES_CARRIER.primary.defaultPane, 'notes.editor')
  assert.ok(readOnlyTaskForProfile(NOTES_CARRIER.primary.contextProfile), `档案「${NOTES_CARRIER.primary.contextProfile}」在只读任务表里查不到，本板块当主载体时提问会报缺`)
  assert.equal(BUILT_IN_CARRIER_IDS.includes(NOTES_CARRIER_ID), true, '随框架发布：注册表默认装得上这块板块')
  assert.deepEqual(NOTES_TOOL_NAMES, ['pinax_notes_list', 'pinax_notes_save'])
})

test('工具面：构思载体启用后两把工具进面、归属它', async () => {
  const { workspace, runtime, opened } = await notesProject('notes-surface')
  try {
    assert.equal(opened.value.view.projectKind, 'generic', '构思可以是泛型项目的主载体')
    assert.deepEqual([...runtime.surfaceInfo().carrierToolNames].sort(), [...NOTES_TOOL_NAMES].sort())
    assert.equal(runtime.listTools().length, 22, '19 内核 ＋ 技能读取 1 ＋ 构思自有 2')
    assert.equal(runtime.ownerOf('pinax_notes_list'), NOTES_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_notes_save'), NOTES_CARRIER_ID)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('构思速记：列表连正文带回，保存带修订号落盘；盲写与非 .md、空 text 都拒', async () => {
  const { workspace, root, runtime } = await notesProject('notes-crud')
  try {
    // 空目录先列一次：0 篇，不谎报。
    const empty = await runtime.callTool('pinax_notes_list', {})
    assert.equal(empty.value.payload.ok, true, JSON.stringify(empty.value.payload))
    assert.equal(empty.value.payload.total, 0)
    assert.deepEqual(empty.value.payload.notes, [])

    const created = await runtime.callTool('pinax_notes_save', {
      title: '雨夜的表',
      text: '袖口的表停在十二点差三分。',
      expectedRevision: 0
    })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.created, true)
    assert.equal(created.value.payload.revision, 1)
    assert.equal(created.value.payload.file, '构思/雨夜的表.md')
    assert.match(await readFile(join(root, '构思', '雨夜的表.md'), 'utf-8'), /十二点差三分/)

    const listed = await runtime.callTool('pinax_notes_list', {})
    assert.equal(listed.value.payload.total, 1)
    assert.deepEqual(listed.value.payload.notes.map((item) => [item.title, item.revision]), [['雨夜的表', 1]], '返回形状照 chapters：序号、标题、相对路径、修订号')
    assert.equal(listed.value.payload.notes[0].file, '构思/雨夜的表.md')
    assert.equal(listed.value.payload.notes[0].text, '袖口的表停在十二点差三分。', '速记都短：正文随篇目一起带回，省一次读')
    assert.equal(listed.value.payload.notes[0].truncated, false)

    // 修订号闸：盘上已有第 1 版，拿 0 盲写必须拒，而不是静默覆盖。
    const blind = await runtime.callTool('pinax_notes_save', { file: '构思/雨夜的表.md', text: '被推翻的写法', expectedRevision: 0 })
    assert.equal(blind.value.payload.ok, false)
    assert.equal(blind.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.equal(blind.value.payload.details.actual, 1)
    assert.match(await readFile(join(root, '构思', '雨夜的表.md'), 'utf-8'), /十二点差三分/, '拒绝后磁盘内容不动')

    const updated = await runtime.callTool('pinax_notes_save', {
      file: listed.value.payload.notes[0].file,
      text: '表针重新走了起来。',
      expectedRevision: listed.value.payload.notes[0].revision
    })
    assert.equal(updated.value.payload.ok, true, JSON.stringify(updated.value.payload))
    assert.equal(updated.value.payload.revision, 2)
    assert.equal(updated.value.payload.created, false)

    // 非 .md 与空 text 都拦在载体工具的入参上。
    const notMarkdown = await runtime.callTool('pinax_notes_save', { file: '构思/没有扩展名', text: 'x', expectedRevision: 0 })
    assert.equal(notMarkdown.value.payload.ok, false)
    assert.equal(notMarkdown.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    const emptyText = await runtime.callTool('pinax_notes_save', { title: '空速记', text: '', expectedRevision: 0 })
    assert.equal(emptyText.value.payload.ok, false)
    assert.equal(emptyText.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    const noRevision = await runtime.callTool('pinax_notes_save', { title: '没有修订号', text: 'x' })
    assert.equal(noRevision.value.payload.ok, false)
    assert.equal(noRevision.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('长速记在列表里截断并标注，不谎报读全了', async () => {
  const { workspace, opened } = await notesProject('notes-truncate', { startRuntime: false })
  try {
    const long = '长'.repeat(20_050)
    const written = await opened.value.fileService.write({ pluginId: NOTES_CARRIER_ID, dir: '构思', file: '长速记.md', text: long, expectedRevision: 0 })
    assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))
    const list = createNotesTools({ pluginId: NOTES_CARRIER_ID, fileService: opened.value.fileService }).find((tool) => tool.name === 'pinax_notes_list')
    const result = await list.run({})
    assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
    const note = result.value.notes[0]
    assert.equal(note.text.length, 20_000)
    assert.equal(note.totalChars, long.length)
    assert.equal(note.truncated, true)
  } finally {
    await workspace.cleanup()
  }
})

test('一目录一主人：构思/ 归构思载体，小说与大纲写不进来', async () => {
  const { workspace, opened } = await notesProject('notes-fence', { startRuntime: false })
  try {
    const own = await opened.value.fileService.write({ pluginId: NOTES_CARRIER_ID, dir: '构思', file: '想法.md', text: '一句想法。', expectedRevision: 0 })
    assert.equal(own.ok, true, JSON.stringify(own.error ?? {}))
    for (const pluginId of [NOVEL_CARRIER_ID, 'pinax.carrier.outline']) {
      const foreign = await opened.value.fileService.write({ pluginId, dir: '构思', file: '别人偷写.md', text: 'x', expectedRevision: 0 })
      assert.equal(foreign.ok, false, pluginId)
      assert.equal(foreign.error.code, NEXT_ERROR_CODES.DIR_CONFLICT, pluginId)
    }
    // 构思工具的落点固定在 构思/：给一个「正文/…」的 file 也只会落在 构思/正文/… 下（文件服务按板块目录拼路径），
    // 越不出本载体认领的那一块。
    const tools = createNotesTools({ pluginId: NOTES_CARRIER_ID, fileService: opened.value.fileService })
    const save = tools.find((tool) => tool.name === 'pinax_notes_save')
    const anchored = await save.run({ file: '正文/偷写.md', text: 'x', expectedRevision: 0 })
    assert.equal(anchored.ok, true, JSON.stringify(anchored.error ?? {}))
    assert.match(anchored.value.file.replaceAll('\\', '/'), /^构思\//)
    const spilled = await opened.value.fileService.read({ pluginId: NOTES_CARRIER_ID, dir: '正文', file: '偷写.md' })
    assert.equal(spilled.ok, false, '正文目录里没有这篇东西')
  } finally {
    await workspace.cleanup()
  }
})
