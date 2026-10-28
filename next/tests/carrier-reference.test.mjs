import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { kernelToolNames, toolOwnershipReport } from '../runtime/mcpSurface.mjs'
import {
  BUILT_IN_CARRIER_IDS,
  BUILT_IN_CARRIER_PLUGINS,
  REFERENCE_CARRIER,
  REFERENCE_CARRIER_ID,
  REFERENCE_TOOL_NAMES
} from '../carriers/index.mjs'
import { createReferenceBlocks } from '../carriers/reference/context.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 工单G1：资料载体（资料/）的最小面。
 * 证四件事：清单过内核校验且三把工具都是载体自有名字（认领面不因此虚增）；
 * 读盘走内核文件服务（归属＋file:资料:rw＋修订并发）；写只有带 expectedRevision 的一条路；
 * reference 上下文块只给「篇名＋字数」清单，读不到只记账、不硬失败。
 * 夹具目录在 os.tmpdir() 下，素材是工装种子文件（openProject 之前 raw writeFile），不碰作者原稿。
 */

async function referenceProject(label, { documents = {}, subdirs = [], startRuntime = true } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '资料载体靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '资料载体靶子', primaryCarrier: REFERENCE_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  // 素材直接落盘（工装目录，不碰作者原稿）：此刻项目还没打开、文件服务还没影，只能用 raw writeFile 种数据。
  // 未记账的既有文件按第 1 版采纳——载体读得到；要再写就必带这个修订号。
  const dir = join(root, '资料')
  await mkdir(dir, { recursive: true })
  for (const [name, text] of Object.entries(documents)) await writeFile(join(dir, name), text, 'utf-8')
  for (const name of subdirs) await mkdir(join(dir, name), { recursive: true })
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = startRuntime
    ? createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
    : null
  if (runtime) await runtime.start()
  return { workspace, root, registry, opened, runtime }
}

test('资料真清单过校验：三把工具都是载体自有名字，资料/ 申请 rw，泛型项目可作主载体', () => {
  const validated = validateCarrierManifest(REFERENCE_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  assert.deepEqual(REFERENCE_CARRIER.tools, ['pinax_document_list', 'pinax_document_read', 'pinax_document_save'])
  assert.equal(REFERENCE_CARRIER.tools.every((name) => !kernel.has(name)), true, '三把都是载体自有名字（内核没有同名工具可认领），认领面不虚增')
  assert.deepEqual({ ...REFERENCE_CARRIER.dataDirs }, { documents: '资料' })
  assert.ok(PROJECT_KINDS.generic.includes('资料'), '资料/ 必须落在泛型骨架里（它是这块板块的主载体 type）')
  assert.deepEqual(REFERENCE_CARRIER.scopes, ['file:资料:rw', 'agent:ask'], '资料随编辑面申请 rw；内核写族闸仍把写入点名到自有 save')
  assert.equal(REFERENCE_CARRIER.primary.projectKind, 'generic')
  assert.equal(REFERENCE_CARRIER.primary.defaultPane, 'reference.documents')
  assert.equal(REFERENCE_CARRIER.primary.contextProfile, 'setting-research', '档案必须是有只读任务的（setting-field 在只读任务表里查不到，提问会报缺）')
  assert.deepEqual(REFERENCE_CARRIER.context, { providers: ['references'], budgetChars: 12000 }, '块种类必须是档案认识的复数 references')
  assert.deepEqual(REFERENCE_CARRIER.panes.map((pane) => pane.id), ['reference.board', 'reference.documents'])
  assert.equal(BUILT_IN_CARRIER_IDS.includes(REFERENCE_CARRIER_ID), true, '随框架发布：注册表默认装得上这块板块')
})

test('工具面：资料载体启用后三把工具进面、归属它；内核认领面（claimed）仍是 5 把', async () => {
  const { workspace, registry, runtime, opened } = await referenceProject('reference-surface')
  try {
    assert.equal(opened.value.view.projectKind, 'generic', '资料可以是泛型项目的主载体')
    assert.deepEqual([...runtime.surfaceInfo().carrierToolNames].sort(), [...REFERENCE_TOOL_NAMES].sort())
    assert.equal(runtime.listTools().length, 22, '19 内核 ＋ 资料自有 3')
    assert.equal(runtime.ownerOf('pinax_document_list'), REFERENCE_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_document_read'), REFERENCE_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_document_save'), REFERENCE_CARRIER_ID)

    const report = toolOwnershipReport(registry)
    assert.deepEqual(report.claimed.length, 5, 'claimed 按内核名字算：小说 3 ＋ 设定 2；资料三把不在内核 19 里')
    assert.equal(report.unclaimed.length, 14)
    assert.deepEqual(report.declaredOutsideKernel.slice(-REFERENCE_TOOL_NAMES.length), [...REFERENCE_TOOL_NAMES], '资料三把是自有名字，逐条留名在门禁白名单里')
    assert.deepEqual(report.withoutImplementation, [], '声明了就必须有实现，否则不许进面')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('pinax_document_list：列 .md 与 .txt，篇目随手带回前 20000 字并标 truncated；非文本不进清单', async () => {
  const long = '长'.repeat(20_050)
  const { workspace, runtime } = await referenceProject('reference-list', {
    documents: {
      '设定集.md': '# 设定集\n旧世界的年表。\n',
      '访谈.txt': '受访者：柯秒。\n',
      '长文.md': long,
      '封面.png': 'not-really-a-png'
    }
  })
  try {
    const listed = await runtime.callTool('pinax_document_list', {})
    assert.equal(listed.value.owner, REFERENCE_CARRIER_ID)
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.equal(listed.value.payload.total, 3, '.png 不进清单（本批只认 .md/.txt）')
    const byTitle = Object.fromEntries(listed.value.payload.documents.map((document) => [document.title, document]))
    assert.deepEqual(Object.keys(byTitle).sort(), ['设定集', '访谈', '长文'].sort())
    assert.equal(byTitle['设定集'].file, '资料/设定集.md')
    assert.equal(byTitle['设定集'].revision, 1, '未记账的既有文件按第 1 版采纳')
    assert.match(byTitle['设定集'].text, /旧世界的年表/, '正文随列表带回')
    assert.equal(byTitle['设定集'].truncated, false)
    assert.equal(byTitle['访谈'].file, '资料/访谈.txt', '.txt 也被认')
    assert.equal(byTitle['长文'].truncated, true, '单篇超 20000 字按上限截断并标注，不谎报读全了')
    assert.equal(byTitle['长文'].text.length, 20_000)
    assert.equal(byTitle['长文'].totalChars, long.length)

    const limited = await runtime.callTool('pinax_document_list', { limit: 1 })
    assert.equal(limited.value.payload.documents.length, 1)
    assert.equal(limited.value.payload.truncated, true)

    const badLimit = await runtime.callTool('pinax_document_list', { limit: 0 })
    assert.equal(badLimit.value.payload.ok, false)
    assert.equal(badLimit.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('pinax_document_read：按 file／index／title 定位读全文；maxChars 越界拒，读不到就说读不到', async () => {
  const long = '雪'.repeat(2500)
  const { workspace, runtime } = await referenceProject('reference-read', {
    documents: { '设定集.md': '旧世界的年表。\n', '访谈.txt': '受访者：柯秒。\n', '长文.md': long }
  })
  try {
    const byFile = await runtime.callTool('pinax_document_read', { file: '资料/设定集.md' })
    assert.equal(byFile.value.owner, REFERENCE_CARRIER_ID)
    assert.equal(byFile.value.payload.ok, true, JSON.stringify(byFile.value.payload))
    assert.equal(byFile.value.payload.document.title, '设定集')
    assert.equal(byFile.value.payload.document.file, '资料/设定集.md')
    assert.equal(byFile.value.payload.document.revision, 1)
    assert.equal(byFile.value.payload.text, '旧世界的年表。\n')
    assert.equal(byFile.value.payload.truncated, false)
    assert.equal(byFile.value.payload.totalChars, byFile.value.payload.text.length)

    const listed = await runtime.callTool('pinax_document_list', {})
    const longIndex = listed.value.payload.documents.find((document) => document.title === '长文').index
    const byIndex = await runtime.callTool('pinax_document_read', { index: longIndex, maxChars: 1000 })
    assert.equal(byIndex.value.payload.ok, true, JSON.stringify(byIndex.value.payload))
    assert.equal(byIndex.value.payload.document.title, '长文')
    assert.equal(byIndex.value.payload.text.length, 1000, 'maxChars 是硬闸')
    assert.equal(byIndex.value.payload.truncated, true)
    assert.equal(byIndex.value.payload.totalChars, long.length)

    const byTitle = await runtime.callTool('pinax_document_read', { title: '访谈' })
    assert.equal(byTitle.value.payload.ok, true)
    assert.equal(byTitle.value.payload.document.file, '资料/访谈.txt')

    const missing = await runtime.callTool('pinax_document_read', { title: '查无此篇' })
    assert.equal(missing.value.payload.ok, false)
    assert.equal(missing.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(missing.value.payload.message, /找不到标题含「查无此篇」的资料/)

    const noLocator = await runtime.callTool('pinax_document_read', {})
    assert.equal(noLocator.value.payload.ok, false)
    assert.match(noLocator.value.payload.message, /需要 index \/ title \/ file/)

    const badChars = await runtime.callTool('pinax_document_read', { file: '资料/设定集.md', maxChars: 999 })
    assert.equal(badChars.value.payload.ok, false)
    assert.equal(badChars.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(badChars.value.payload.message, /maxChars/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('pinax_document_save：带修订号落盘、新建传 0；STALE／空 text／非 .md|.txt 一律拒', async () => {
  const { workspace, opened, runtime } = await referenceProject('reference-save', {
    documents: { '设定集.md': '旧世界的年表。\n' }
  })
  try {
    const listed = await runtime.callTool('pinax_document_list', {})
    const document = listed.value.payload.documents.find((item) => item.title === '设定集')
    assert.equal(document.revision, 1)

    const saved = await runtime.callTool('pinax_document_save', {
      file: document.file,
      text: '旧世界的年表。\n补一条：雪埋了半条街。\n',
      expectedRevision: document.revision
    })
    assert.equal(saved.value.owner, REFERENCE_CARRIER_ID, '写走载体自有的 save，不落回内核')
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    assert.equal(saved.value.payload.file, '资料/设定集.md')
    assert.equal(saved.value.payload.revision, 2, '第 1 版上保存，递增到第 2 版')
    assert.equal(saved.value.payload.created, false)
    const direct = await opened.value.fileService.read({ pluginId: REFERENCE_CARRIER_ID, dir: '资料', file: '设定集.md' })
    assert.equal(direct.ok, true, JSON.stringify(direct.error ?? {}))
    assert.match(direct.value.text, /雪埋了半条街/)

    // 新建：expectedRevision 0，标题落成 资料/<标题>.md。
    const created = await runtime.callTool('pinax_document_save', { title: '年表补遗', text: '补遗一条。\n', expectedRevision: 0 })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.file, '资料/年表补遗.md')
    assert.equal(created.value.payload.revision, 1)
    assert.equal(created.value.payload.created, true)

    // 标题自带扩展名就按它落盘（.txt 也认）。
    const asText = await runtime.callTool('pinax_document_save', { title: '访谈.txt', text: '受访者：柯秒。\n', expectedRevision: 0 })
    assert.equal(asText.value.payload.ok, true, JSON.stringify(asText.value.payload))
    assert.equal(asText.value.payload.file, '资料/访谈.txt')

    // 拿作废的修订号写：STALE，不覆盖不合并；盘上仍是成功那一次。
    const stale = await runtime.callTool('pinax_document_save', { file: '资料/设定集.md', text: '基于旧版的一笔', expectedRevision: 1 })
    assert.equal(stale.value.payload.ok, false)
    assert.equal(stale.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.match(stale.value.payload.message, /已被改动/)
    const afterStale = await opened.value.fileService.read({ pluginId: REFERENCE_CARRIER_ID, dir: '资料', file: '设定集.md' })
    assert.doesNotMatch(afterStale.value.text, /基于旧版的一笔/)

    const empty = await runtime.callTool('pinax_document_save', { file: '资料/设定集.md', text: '', expectedRevision: 2 })
    assert.equal(empty.value.payload.ok, false)
    assert.equal(empty.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(empty.value.payload.message, /text 必填且非空/)

    const noRevision = await runtime.callTool('pinax_document_save', { file: '资料/设定集.md', text: '没有修订号的一笔' })
    assert.equal(noRevision.value.payload.ok, false)
    assert.equal(noRevision.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(noRevision.value.payload.message, /expectedRevision 必填/)

    // 本批只认 .md/.txt：PDF／JSON／图片一律拒，且不落盘。
    for (const file of ['资料/设定集.pdf', '资料/设定集.json', '资料/封面.png']) {
      const rejected = await runtime.callTool('pinax_document_save', { file, text: 'x', expectedRevision: 0 })
      assert.equal(rejected.value.payload.ok, false, file)
      assert.equal(rejected.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT, file)
      assert.match(rejected.value.payload.message, /\.md 或 \.txt/, file)
    }

    const noTarget = await runtime.callTool('pinax_document_save', { text: '没有文件名的一笔', expectedRevision: 0 })
    assert.equal(noTarget.value.payload.ok, false)
    assert.match(noTarget.value.payload.message, /要给 file/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('reference 块：只列篇名与字数、不带正文；读不到只记 warning 不硬失败', async () => {
  const { workspace, registry, opened } = await referenceProject('reference-blocks', {
    documents: { '设定集.md': '旧世界的年表，雪埋了半条街。\n', '访谈.txt': '受访者：柯秒。\n' },
    subdirs: ['章节衍生'],
    startRuntime: false
  })
  try {
    const impl = registry.impl(REFERENCE_CARRIER_ID)
    assert.equal(typeof impl?.blocks, 'function', '注册表里这块板块要有上下文块工厂')
    const material = await impl.blocks({ pluginId: REFERENCE_CARRIER_ID, fileService: opened.value.fileService }).references()
    assert.equal(material.blocks.length, 1, '清单是一块素材，不按篇拆')
    assert.equal(material.blocks[0].kind, 'references')
    assert.match(material.blocks[0].content, /设定集/)
    assert.match(material.blocks[0].content, /访谈/)
    assert.match(material.blocks[0].content, /字/, '字数取自真实读到的文本')
    assert.doesNotMatch(material.blocks[0].content, /雪埋了半条街/, '正文不进上下文，只给清单')
    assert.equal(material.blocks[0].sourceRefs.length, 2)
    assert.match(material.warnings.join('\n'), /子目录/, '子目录没被递归读，如实记账')

    // 没有文件服务：块缺席只是一条 warning——不抛、不把整次提问翻成失败。
    const absent = await createReferenceBlocks({ pluginId: REFERENCE_CARRIER_ID, fileService: null }).references()
    assert.deepEqual(absent.blocks, [])
    assert.equal(absent.warnings.length, 1)
    assert.match(absent.warnings[0], /未绑定项目文件服务/)
  } finally {
    await workspace.cleanup()
  }
})
