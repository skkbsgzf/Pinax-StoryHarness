import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { kernelToolNames, toolOwnershipReport } from '../runtime/mcpSurface.mjs'
import { BUILT_IN_CARRIER_IDS, loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { DOSSIER_CARRIER, DOSSIER_CARRIER_ID, DOSSIER_LEGACY_IDS } from '../carriers/dossier/manifest.mjs'
import { DOSSIER_TOOL_NAMES, createDossierTools } from '../carriers/dossier/tools.mjs'
import { NOVEL_CARRIER_ID } from '../carriers/novel/manifest.mjs'
import { OUTLINE_CARRIER_ID } from '../carriers/outline/manifest.mjs'
import { NOTES_CARRIER_ID } from '../carriers/notes/manifest.mjs'
import { SCRIPT_CARRIER_ID } from '../carriers/script/manifest.mjs'
import { WORLDBOOK_CARRIER_ID } from '../carriers/worldbook/manifest.mjs'
import { createDossierBlocks } from '../carriers/dossier/context.mjs'

// 批次65b（框架计划 J2「一切从磁盘装载，内置只是随包已安装」）：随包载体不再静态 import 实现数组，
// 装载走 pluginLoader 从货架取（开发轨 next/carriers/，装机轨 next/.build/next/carriers/）。
// 本文件的断言一字未动，只是拿到同一份 { manifest, impl, meta } 的方式换了。
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 批次60：设定（约束/）与资料（资料/）合并为「设定与资料」载体。
 *
 * 这份测试由原 carrier-setting ＋ carrier-reference 两份合并而来，证五件事：
 *   1) 清单只有一份、两扇目录（资料／约束），六把工具保持原名（对外工具名不变，Agent 披露不断）；
 *   2) 两个目录的 rw 互不越界，别的板块进不来；
 *   3) 约束／资料的读写语义与原载体逐条一致（列表截断、修订号、STALE、空 text、扩展名闸）；
 *   4) 上下文块三种名（rules／style／references）各归其位；
 *   5) 旧 id 的打开期映射（《大梦》enabled 七块→六块），project.json 一字不动。
 */

async function dossierProject(label, { rules = {}, documents = {}, subdirs = [], startRuntime = true } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '设定资料靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '设定资料靶子', primaryCarrier: DOSSIER_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  // 种子是 raw writeFile（工装目录）：未记账的既有文件按第 1 版采纳，读得到、改要带修订号。
  const rulesDir = join(root, '约束')
  await mkdir(rulesDir, { recursive: true })
  for (const [name, text] of Object.entries(rules)) await writeFile(join(rulesDir, name), text, 'utf-8')
  const docsDir = join(root, '资料')
  await mkdir(docsDir, { recursive: true })
  for (const [name, text] of Object.entries(documents)) await writeFile(join(docsDir, name), text, 'utf-8')
  for (const name of subdirs) await mkdir(join(docsDir, name), { recursive: true })
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = startRuntime
    ? createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
    : null
  if (runtime) await runtime.start()
  return { workspace, root, registry, opened, runtime }
}

test('设定与资料真清单过校验：两扇目录、六把原名字工具、泛型项目可作主载体', () => {
  const validated = validateCarrierManifest(DOSSIER_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  assert.deepEqual(DOSSIER_CARRIER.tools, [
    'pinax_rule_list',
    'pinax_rule_save',
    'pinax_document_list',
    'pinax_document_read',
    'pinax_document_save',
    'pinax_reference_search'
  ])
  assert.equal(DOSSIER_CARRIER.tools.every((name) => !kernel.has(name)), true, '六把都是载体自有名字：对外工具名一个不改，Agent 既有披露不断')
  assert.deepEqual({ ...DOSSIER_CARRIER.dataDirs }, { documents: '资料', constraints: '约束' }, '两目录两逻辑名（@4 合法）')
  assert.ok(PROJECT_KINDS.generic.includes('资料'), '资料/ 必须落在泛型骨架里')
  assert.ok(PROJECT_KINDS.generic.includes('约束'), '约束/ 必须落在泛型骨架里')
  assert.deepEqual(DOSSIER_CARRIER.permissions, [
    { type: 'file', dir: '资料', mode: 'rw' },
    { type: 'file', dir: '约束', mode: 'rw' },
    'agent:ask'
  ], '两扇目录各申请 rw；agent:ask 是运行时调用载体工具的前置授权')
  assert.equal(DOSSIER_CARRIER.primary.projectKind, 'generic')
  assert.equal(DOSSIER_CARRIER.primary.defaultPane, 'dossier.editor')
  assert.equal(DOSSIER_CARRIER.primary.contextProfile, 'setting-research', '档案必须是有只读任务的（setting-field 查不到只读任务）')
  assert.deepEqual(DOSSIER_CARRIER.context, { providers: ['rules', 'style', 'references'], budgetChars: 20000 })
  assert.deepEqual(DOSSIER_CARRIER.provides, ['constraint.rules', 'reference.documents'], '两份能力面合在一条清单里')
  assert.deepEqual(DOSSIER_CARRIER.contributes.panes.map((pane) => pane.id), ['dossier.board', 'dossier.editor'])
  assert.equal(DOSSIER_CARRIER.title, '设定与资料')
  assert.deepEqual(DOSSIER_LEGACY_IDS, {
    'pinax.carrier.setting': DOSSIER_CARRIER_ID,
    'pinax.carrier.reference': DOSSIER_CARRIER_ID
  }, '兼容映射是唯一的旧 id 落点（其余地方零命中）')
  assert.equal(BUILT_IN_CARRIER_IDS.includes(DOSSIER_CARRIER_ID), true, '随框架发布：注册表默认装得上这块板块')
  assert.deepEqual(DOSSIER_TOOL_NAMES, [...DOSSIER_CARRIER.tools])
})

test('工具面：合并体启用后六把工具进面、归属它；内核认领面（claimed）仍是 5 把', async () => {
  const { workspace, registry, runtime, opened } = await dossierProject('dossier-surface')
  try {
    assert.equal(opened.value.view.projectKind, 'generic', '合并体可以是泛型项目的主载体')
    assert.deepEqual([...runtime.surfaceInfo().carrierToolNames].sort(), [...DOSSIER_TOOL_NAMES].sort())
    assert.equal(runtime.listTools().length, 33, '25 内核 ＋ 技能读取 1 ＋ 服务日志读取 1 ＋ 合并体自有 6')
    for (const name of DOSSIER_TOOL_NAMES) assert.equal(runtime.ownerOf(name), DOSSIER_CARRIER_ID, name)

    const report = toolOwnershipReport(registry)
    assert.deepEqual(report.claimed.length, 5, 'claimed 按内核名字算：小说 3 ＋ 合并体 2；资料三把不在内核 20 里')
    assert.equal(report.unclaimed.length, 15)
    assert.deepEqual(report.declaredOutsideKernel.filter((name) => /^pinax_(document|reference)_/u.test(name)).sort(), [
      'pinax_document_list',
      'pinax_document_read',
      'pinax_document_save',
      'pinax_reference_search'
    ].sort(), '资料四把仍是自有名字')
    assert.deepEqual(report.withoutImplementation, [], '声明了就必须有实现，否则不许进面')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('两扇目录一主人：合并体 rw 后可写，别的板块照旧进不来', async () => {
  const { workspace, opened } = await dossierProject('dossier-scope', { startRuntime: false })
  try {
    for (const [dir, file] of [['约束', '纪律.md'], ['资料', '设定集.md']]) {
      const own = await opened.value.fileService.write({
        pluginId: DOSSIER_CARRIER_ID,
        dir,
        file,
        text: `${file}\n`,
        expectedRevision: 0
      })
      assert.equal(own.ok, true, JSON.stringify(own.error ?? {}))
      // 一目录一主人：两扇目录都归合并体，小说板块连目录都定位不到（DIR_CONFLICT 先于 scope 闸）。
      const foreign = await opened.value.fileService.write({
        pluginId: NOVEL_CARRIER_ID,
        dir,
        file: `别人偷写-${dir}.md`,
        text: 'x',
        expectedRevision: 0
      })
      assert.equal(foreign.ok, false, dir)
      assert.equal(foreign.error.code, NEXT_ERROR_CODES.DIR_CONFLICT, dir)
    }
  } finally {
    await workspace.cleanup()
  }
})

test('约束读回：list 列篇目并随手带回全文，修订号按文件服务现取；超长截断并标注', async () => {
  const long = '长'.repeat(20_050)
  const { workspace, root, runtime } = await dossierProject('dossier-rule-list', {
    rules: { '纪律.md': '- 不许出现现代词\n- 每章 2000 字\n', '文风.md': '短句为主，一拍一段。\n', '长文.md': long }
  })
  try {
    const listed = await runtime.callTool('pinax_rule_list', {})
    assert.equal(listed.value.owner, DOSSIER_CARRIER_ID)
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.equal(listed.value.payload.total, 3)
    assert.equal(listed.value.payload.truncated, false)
    assert.equal(listed.value.payload.projectRoot.replaceAll('\\', '/').endsWith('设定资料靶子'), true)

    const byTitle = Object.fromEntries(listed.value.payload.rules.map((rule) => [rule.title, rule]))
    assert.deepEqual(Object.keys(byTitle).sort(), ['文风', '纪律', '长文'].sort())
    assert.equal(byTitle['纪律'].file, '约束/纪律.md')
    assert.equal(byTitle['纪律'].revision, 1, '未记账的既有文件按第 1 版采纳')
    assert.match(byTitle['纪律'].text, /每章 2000 字/, '正文随列表带回，省一次单独的读取')
    assert.equal(byTitle['纪律'].truncated, false)
    assert.equal(byTitle['纪律'].totalChars, byTitle['纪律'].text.length)

    assert.equal(byTitle['长文'].truncated, true, '单篇超 20000 字按上限截断并标注，不谎报读全了')
    assert.equal(byTitle['长文'].text.length, 20_000)
    assert.equal(byTitle['长文'].totalChars, long.length)

    const limited = await runtime.callTool('pinax_rule_list', { limit: 1 })
    assert.equal(limited.value.payload.rules.length, 1)
    assert.equal(limited.value.payload.truncated, true)

    const elsewhere = await runtime.callTool('pinax_rule_list', { projectPath: 'D:/别的小说/别的书' })
    assert.equal(elsewhere.value.payload.ok, false)
    assert.equal(elsewhere.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(elsewhere.value.payload.message, /只服务当前打开的 Next 项目/)

    const badLimit = await runtime.callTool('pinax_rule_list', { limit: 0 })
    assert.equal(badLimit.value.payload.ok, false)
    assert.equal(badLimit.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    assert.ok(join(root, '约束'))
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('约束保存：带读到的修订号落盘、新建传 0；STALE／空 text／非 .md／缺修订号一律拒', async () => {
  const { workspace, opened, runtime } = await dossierProject('dossier-rule-save', {
    rules: { '纪律.md': '- 不许出现现代词\n' }
  })
  try {
    const listed = await runtime.callTool('pinax_rule_list', {})
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    const rule = listed.value.payload.rules[0]
    assert.equal(rule.revision, 1)

    const saved = await runtime.callTool('pinax_rule_save', {
      file: rule.file,
      text: '- 不许出现现代词\n- 每章 2000 字\n',
      expectedRevision: rule.revision
    })
    assert.equal(saved.value.owner, DOSSIER_CARRIER_ID, '写走载体自有的 save，不落回内核')
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    assert.equal(saved.value.payload.file, '约束/纪律.md')
    assert.equal(saved.value.payload.revision, 2, '第 1 版上保存，递增到第 2 版')
    assert.equal(saved.value.payload.created, false)
    const direct = await opened.value.fileService.read({ pluginId: DOSSIER_CARRIER_ID, dir: '约束', file: '纪律.md' })
    assert.equal(direct.ok, true, JSON.stringify(direct.error ?? {}))
    assert.match(direct.value.text, /每章 2000 字/)

    const created = await runtime.callTool('pinax_rule_save', { title: '文风', text: '短句为主，一拍一段。\n', expectedRevision: 0 })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.file, '约束/文风.md')
    assert.equal(created.value.payload.revision, 1)
    assert.equal(created.value.payload.created, true)

    const stale = await runtime.callTool('pinax_rule_save', { file: '约束/纪律.md', text: '基于旧版的一笔', expectedRevision: 1 })
    assert.equal(stale.value.payload.ok, false)
    assert.equal(stale.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.match(stale.value.payload.message, /已被改动/)
    const afterStale = await opened.value.fileService.read({ pluginId: DOSSIER_CARRIER_ID, dir: '约束', file: '纪律.md' })
    assert.doesNotMatch(afterStale.value.text, /基于旧版的一笔/)

    const empty = await runtime.callTool('pinax_rule_save', { file: '约束/纪律.md', text: '', expectedRevision: 2 })
    assert.equal(empty.value.payload.ok, false)
    assert.equal(empty.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(empty.value.payload.message, /text 必填且非空/)

    const noRevision = await runtime.callTool('pinax_rule_save', { file: '约束/纪律.md', text: '没有修订号的一笔' })
    assert.equal(noRevision.value.payload.ok, false)
    assert.equal(noRevision.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(noRevision.value.payload.message, /expectedRevision 必填/)

    const notMarkdown = await runtime.callTool('pinax_rule_save', { file: '约束/纪律.txt', text: 'x', expectedRevision: 0 })
    assert.equal(notMarkdown.value.payload.ok, false)
    assert.equal(notMarkdown.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(notMarkdown.value.payload.message, /必须以 \.md 结尾/)

    const noTarget = await runtime.callTool('pinax_rule_save', { text: '没有文件名的一笔', expectedRevision: 0 })
    assert.equal(noTarget.value.payload.ok, false)
    assert.match(noTarget.value.payload.message, /要给 file/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('pinax_document_list：列 .md 与 .txt，篇目随手带回前 20000 字并标 truncated；非文本不进清单', async () => {
  const long = '长'.repeat(20_050)
  const { workspace, runtime } = await dossierProject('dossier-doc-list', {
    documents: {
      '设定集.md': '# 设定集\n旧世界的年表。\n',
      '访谈.txt': '受访者：柯秒。\n',
      '长文.md': long,
      '封面.png': 'not-really-a-png'
    }
  })
  try {
    const listed = await runtime.callTool('pinax_document_list', {})
    assert.equal(listed.value.owner, DOSSIER_CARRIER_ID)
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.equal(listed.value.payload.total, 3, '.png 不进清单（只认 .md/.txt）')
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
  const { workspace, runtime } = await dossierProject('dossier-doc-read', {
    documents: { '设定集.md': '旧世界的年表。\n', '访谈.txt': '受访者：柯秒。\n', '长文.md': long }
  })
  try {
    const byFile = await runtime.callTool('pinax_document_read', { file: '资料/设定集.md' })
    assert.equal(byFile.value.owner, DOSSIER_CARRIER_ID)
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
  const { workspace, opened, runtime } = await dossierProject('dossier-doc-save', {
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
    assert.equal(saved.value.owner, DOSSIER_CARRIER_ID, '写走载体自有的 save，不落回内核')
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    assert.equal(saved.value.payload.file, '资料/设定集.md')
    assert.equal(saved.value.payload.revision, 2, '第 1 版上保存，递增到第 2 版')
    assert.equal(saved.value.payload.created, false)
    const direct = await opened.value.fileService.read({ pluginId: DOSSIER_CARRIER_ID, dir: '资料', file: '设定集.md' })
    assert.equal(direct.ok, true, JSON.stringify(direct.error ?? {}))
    assert.match(direct.value.text, /雪埋了半条街/)

    const created = await runtime.callTool('pinax_document_save', { title: '年表补遗', text: '补遗一条。\n', expectedRevision: 0 })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.file, '资料/年表补遗.md')
    assert.equal(created.value.payload.revision, 1)
    assert.equal(created.value.payload.created, true)

    const asText = await runtime.callTool('pinax_document_save', { title: '访谈.txt', text: '受访者：柯秒。\n', expectedRevision: 0 })
    assert.equal(asText.value.payload.ok, true, JSON.stringify(asText.value.payload))
    assert.equal(asText.value.payload.file, '资料/访谈.txt')

    const stale = await runtime.callTool('pinax_document_save', { file: '资料/设定集.md', text: '基于旧版的一笔', expectedRevision: 1 })
    assert.equal(stale.value.payload.ok, false)
    assert.equal(stale.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.match(stale.value.payload.message, /已被改动/)
    const afterStale = await opened.value.fileService.read({ pluginId: DOSSIER_CARRIER_ID, dir: '资料', file: '设定集.md' })
    assert.doesNotMatch(afterStale.value.text, /基于旧版的一笔/)

    const empty = await runtime.callTool('pinax_document_save', { file: '资料/设定集.md', text: '', expectedRevision: 2 })
    assert.equal(empty.value.payload.ok, false)
    assert.equal(empty.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(empty.value.payload.message, /text 必填且非空/)

    const noRevision = await runtime.callTool('pinax_document_save', { file: '资料/设定集.md', text: '没有修订号的一笔' })
    assert.equal(noRevision.value.payload.ok, false)
    assert.equal(noRevision.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(noRevision.value.payload.message, /expectedRevision 必填/)

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

test('pinax_reference_search：verb 固定 kb_search、q 必填、dir 恒限定 资料；mock knowledgeService 透传', async () => {
  const { workspace, opened } = await dossierProject('dossier-search', { startRuntime: false })
  try {
    const calls = []
    const knowledgeService = {
      async search(args) {
        calls.push(args)
        return {
          ok: true,
          value: {
            total: 1,
            hits: [{ id: 'kb/资料/设定集.md', title: '设定集', readRef: '资料/设定集.md', excerpt: '雪埋了半条街。', source: 'project' }],
            coverage: { projectCards: 1 }
          }
        }
      }
    }
    const tools = createDossierTools({
      pluginId: DOSSIER_CARRIER_ID,
      fileService: opened.value.fileService,
      root: opened.value.root,
      knowledgeService
    })
    const search = tools.find((tool) => tool.name === 'pinax_reference_search')
    assert.ok(search, '清单声明了就必须有实现')
    assert.equal(search.annotations.readOnlyHint, true)

    const result = await search.run({ q: ' 雪 ', k: 2 })
    assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
    assert.equal(result.value.hits[0].readRef, '资料/设定集.md')
    assert.deepEqual(calls, [{ root: opened.value.root, verb: 'kb_search', q: '雪', k: 2, dir: '资料' }])

    await search.run({ q: '雪', dir: '资料/' })
    assert.deepEqual(calls.at(-1), { root: opened.value.root, verb: 'kb_search', q: '雪', dir: '资料' })
    const badDir = await search.run({ q: '雪', dir: '世界书' })
    assert.equal(badDir.ok, false)
    assert.equal(badDir.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(badDir.error.message, /只覆盖「资料\/」/)

    const noQuery = await search.run({})
    assert.equal(noQuery.ok, false)
    assert.equal(noQuery.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(noQuery.error.message, /q 必填/)

    const badK = await search.run({ q: '雪', k: 0 })
    assert.equal(badK.ok, false)
    assert.match(badK.error.message, /k 须是 1–30/)

    const busyTool = createDossierTools({
      pluginId: DOSSIER_CARRIER_ID,
      root: opened.value.root,
      knowledgeService: { search: async () => ({ ok: false, error: { code: 'KNOWLEDGE_BUSY', message: '知识检索正在处理其他请求' } }) }
    }).find((tool) => tool.name === 'pinax_reference_search')
    const busy = await busyTool.run({ q: '雪' })
    assert.equal(busy.ok, false)
    assert.equal(busy.error.code, 'KNOWLEDGE_BUSY')

    const absent = createDossierTools({ pluginId: DOSSIER_CARRIER_ID, root: opened.value.root })
      .find((tool) => tool.name === 'pinax_reference_search')
    const missing = await absent.run({ q: '雪' })
    assert.equal(missing.ok, false)
    assert.match(missing.error.message, /知识服务未接入/)
  } finally {
    await workspace.cleanup()
  }
})

test('上下文块：rules／style 分约束，references 只列篇名与字数、不带正文；读不到只记 warning', async () => {
  const { workspace, registry, opened } = await dossierProject('dossier-blocks', {
    rules: { '纪律.md': '- 不许出现现代词\n', '文风.md': '短句为主，一拍一段。\n' },
    documents: { '设定集.md': '旧世界的年表，雪埋了半条街。\n', '访谈.txt': '受访者：柯秒。\n' },
    subdirs: ['章节衍生'],
    startRuntime: false
  })
  try {
    const blocks = createDossierBlocks({ pluginId: DOSSIER_CARRIER_ID, fileService: opened.value.fileService })
    assert.deepEqual(Object.keys(blocks).sort(), ['references', 'rules', 'style'], '合并体给三种块')

    const rules = await blocks.rules()
    const style = await blocks.style()
    assert.deepEqual(rules.blocks.map((block) => block.kind), ['rules'])
    assert.match(rules.blocks[0].content, /纪律/)
    assert.doesNotMatch(rules.blocks[0].content, /文风/)
    assert.deepEqual(style.blocks.map((block) => block.kind), ['style'])
    assert.match(style.blocks[0].content, /短句为主/)

    const references = await blocks.references()
    assert.equal(references.blocks.length, 1, '清单是一块素材，不按篇拆')
    assert.equal(references.blocks[0].kind, 'references')
    assert.match(references.blocks[0].content, /设定集/)
    assert.match(references.blocks[0].content, /访谈/)
    assert.match(references.blocks[0].content, /字/, '字数取自真实读到的文本')
    assert.doesNotMatch(references.blocks[0].content, /雪埋了半条街/, '正文不进上下文，只给清单')
    assert.equal(references.blocks[0].sourceRefs.length, 2)
    assert.match(references.warnings.join('\n'), /子目录/, '子目录没被递归读，如实记账')

    const impl = registry.impl(DOSSIER_CARRIER_ID)
    assert.equal(typeof impl?.blocks, 'function', '注册表里这块板块要有上下文块工厂')

    const absent = createDossierBlocks({ pluginId: DOSSIER_CARRIER_ID, fileService: null })
    for (const kind of ['rules', 'style', 'references']) {
      const material = await absent[kind]()
      assert.deepEqual(material.blocks, [], kind)
      assert.match(material.warnings.join('\n'), /未绑定项目文件服务/, kind)
    }
  } finally {
    await workspace.cleanup()
  }
})

test('打开期迁移：旧 id 映射到合并体（七块→六块），.pinax/project.json 一字不动', async () => {
  const workspace = await createTempWorkspace('dossier-migration')
  const root = join(workspace.projects, '大梦对靶')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
  try {
    const created = await createProject({
      root,
      name: '大梦对靶',
      primaryCarrier: NOVEL_CARRIER_ID,
      registry,
      extraEnabled: [OUTLINE_CARRIER_ID, NOTES_CARRIER_ID, WORLDBOOK_CARRIER_ID, SCRIPT_CARRIER_ID]
    })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
    // 模拟作者盘上已有的《大梦》：enabled 写着七块旧 id，primary 仍指向旧设定载体。
    const projectFile = join(root, '.pinax', 'project.json')
    const document = JSON.parse(await readFile(projectFile, 'utf-8'))
    document.carriers = {
      primary: 'pinax.carrier.setting',
      enabled: [
        NOVEL_CARRIER_ID,
        OUTLINE_CARRIER_ID,
        NOTES_CARRIER_ID,
        WORLDBOOK_CARRIER_ID,
        'pinax.carrier.setting',
        SCRIPT_CARRIER_ID,
        'pinax.carrier.reference'
      ],
      revision: document.carriers.revision ?? 1
    }
    const serialized = `${JSON.stringify(document, null, 2)}\n`
    await writeFile(projectFile, serialized, 'utf-8')

    const opened = await openProject({ root, registry })
    assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
    const enabled = opened.value.document.carriers.enabled
    assert.equal(enabled.length, 6, '两个旧 id 合成一块：七块 → 六块')
    assert.equal(enabled.filter((id) => id === DOSSIER_CARRIER_ID).length, 1)
    assert.equal(enabled.some((id) => Object.hasOwn(DOSSIER_LEGACY_IDS, id)), false, '启用集里不再留旧 id')
    assert.equal(opened.value.document.carriers.primary, DOSSIER_CARRIER_ID, '主载体随旧 id 一起映射')
    const activeCarriers = opened.value.view.enabled
    assert.deepEqual(activeCarriers.sort(), [
      NOVEL_CARRIER_ID,
      OUTLINE_CARRIER_ID,
      NOTES_CARRIER_ID,
      WORLDBOOK_CARRIER_ID,
      SCRIPT_CARRIER_ID,
      DOSSIER_CARRIER_ID
    ].sort())
    // 迁移只在内存：盘上仍是一个字没动的旧载荷（《大梦》目录结构零改动）。
    assert.equal(await readFile(projectFile, 'utf-8'), serialized)
  } finally {
    await workspace.cleanup()
  }
})

test('守卫：旧载体 id 只活在兼容映射里（next/ 生产文件零命中）', async () => {
  const nextRoot = fileURLToPath(new URL('../', import.meta.url))
  const skipDirs = new Set(['.build', 'tests', 'node_modules'])
  // 唯一豁免：兼容映射本身（打开期把旧 id 换成合并体）——它的存在是被测事实。
  const skipFiles = new Set([join(nextRoot, 'carriers', 'dossier', 'manifest.mjs')])
  const legacyIds = Object.keys(DOSSIER_LEGACY_IDS)
  const hits = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) await walk(full)
        continue
      }
      if (!/\.(?:mjs|js|vue|css|json)$/u.test(entry.name) || skipFiles.has(full)) continue
      const text = await readFile(full, 'utf-8')
      for (const legacy of legacyIds) if (text.includes(legacy)) hits.push(`${entry.name}: ${legacy}`)
    }
  }
  await walk(nextRoot)
  assert.deepEqual(hits, [], 'setting／reference 退役后在兼容映射之外零命中')
})
