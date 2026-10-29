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
  SCRIPT_CARRIER,
  SCRIPT_CARRIER_ID,
  SCRIPT_TOOL_NAMES,
  createScriptTools
} from '../carriers/index.mjs'
import { createScriptBlocks } from '../carriers/script/context.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 批次26（M6 提前）：剧本载体（剧本/）的最小面。
 * 证四件事：清单过内核校验、三把工具都是载体自有名字（认领面不因此虚增内核 19）；
 * 读盘走内核文件服务（归属＋file:剧本:rw＋修订并发）；写只有带 expectedRevision 的一条路；
 * script 上下文块只给「篇名＋字数」清单，读不到只记账、不硬失败。
 * 夹具目录在 os.tmpdir() 下，素材是工装种子文件（openProject 之前 raw writeFile），不碰作者原稿。
 */

async function scriptProject(label, { scripts = {}, subdirs = [], startRuntime = true } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '剧本载体靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '剧本载体靶子', primaryCarrier: SCRIPT_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  // 素材直接落盘（工装目录）：此刻项目还没打开、文件服务还没影，只能用 raw writeFile 种数据。
  // 未记账的既有文件按第 1 版采纳——载体读得到；要再写就必带这个修订号。
  const dir = join(root, '剧本')
  await mkdir(dir, { recursive: true })
  for (const [name, text] of Object.entries(scripts)) await writeFile(join(dir, name), text, 'utf-8')
  for (const name of subdirs) await mkdir(join(dir, name), { recursive: true })
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = startRuntime
    ? createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
    : null
  if (runtime) await runtime.start()
  return { workspace, root, registry, opened, runtime }
}

const SCRIPT_TEXT = '# 第1集《牛肉汤》剧本\n\n## 场1｜创世讲古\n\n△ 黑场。一点幽光亮起。\n\n白灼 旁白：话说，原初之年，世界本是一片洪荒。\n'

test('剧本真清单过校验：三把工具都是载体自有名字，剧本/ 申请 rw，screenplay 项目可作主载体', () => {
  const validated = validateCarrierManifest(SCRIPT_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  assert.deepEqual(SCRIPT_CARRIER.tools, ['pinax_script_list', 'pinax_script_read', 'pinax_script_save'])
  assert.equal(SCRIPT_CARRIER.tools.every((name) => !kernel.has(name)), true, '三把都是载体自有名字（内核 19 里没有 pinax_script_*），内核工具面不虚增')
  assert.deepEqual({ ...SCRIPT_CARRIER.dataDirs }, { script: '剧本' })
  assert.ok(PROJECT_KINDS.screenplay.includes('剧本'), '剧本/ 必须落在 screenplay 骨架里（它是这块板块的主载体 type）')
  assert.deepEqual(SCRIPT_CARRIER.permissions, [{ type: 'file', dir: '剧本', mode: 'rw' }, 'agent:ask'], 'v2：剧本随编辑面申请 rw；agent:ask 是运行时调用载体工具的前置授权')
  assert.equal(SCRIPT_CARRIER.primary.projectKind, 'screenplay')
  assert.equal(SCRIPT_CARRIER.primary.defaultPane, 'script.editor')
  assert.equal(SCRIPT_CARRIER.primary.contextProfile, 'authoring-knowledge', '档案必须是只读任务表里有的，且块表含 references')
  assert.deepEqual(SCRIPT_CARRIER.context, { providers: ['script', 'references'], budgetChars: 12000 })
  assert.deepEqual(SCRIPT_CARRIER.contributes.panes.map((pane) => pane.id), ['script.board', 'script.editor'], '左树＋中栏编辑（照世界书那一栏）')
  assert.equal(SCRIPT_CARRIER.provides[0], 'script.scenes')
  assert.equal(BUILT_IN_CARRIER_IDS.includes(SCRIPT_CARRIER_ID), true, '随框架发布：注册表默认装得上这块板块')
  assert.deepEqual(SCRIPT_TOOL_NAMES, ['pinax_script_list', 'pinax_script_read', 'pinax_script_save'])
})

test('注册顺序：剧本排在 worldbook 之后（竖条一格一载体）', () => {
  const ids = BUILT_IN_CARRIER_PLUGINS.map((plugin) => plugin.manifest.id)
  assert.deepEqual(ids, [
    'pinax.carrier.novel',
    'pinax.carrier.outline',
    'pinax.carrier.notes',
    'pinax.carrier.worldbook',
    'pinax.carrier.script',
    'pinax.carrier.setting',
    'pinax.carrier.reference'
  ])
})

test('工具面：剧本载体启用后三把工具进面、归属它；内核 19 面不变', async () => {
  const { workspace, runtime, opened } = await scriptProject('script-surface')
  try {
    assert.equal(opened.value.view.projectKind, 'screenplay', '剧本可以是剧本项目的主载体')
    assert.deepEqual([...runtime.surfaceInfo().carrierToolNames].sort(), [...SCRIPT_TOOL_NAMES].sort())
    assert.equal(runtime.listTools().length, 23, '19 内核 ＋ 技能读取 1 ＋ 剧本自有 3')
    assert.equal(runtime.ownerOf('pinax_script_list'), SCRIPT_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_script_read'), SCRIPT_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_script_save'), SCRIPT_CARRIER_ID)

    const reportRegistry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
    for (const plugin of BUILT_IN_CARRIER_PLUGINS) reportRegistry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    const report = toolOwnershipReport(reportRegistry)
    for (const name of SCRIPT_TOOL_NAMES) {
      assert.equal(report.declaredOutsideKernel.includes(name), true, `剧本三把逐条留名在门禁白名单里：${name}`)
    }
    assert.deepEqual(report.withoutImplementation, [], '声明了就必须有实现，否则不许进面')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('pinax_script_list：列 .md、篇目随手带回前 20000 字并标 truncated；非 md 不进清单', async () => {
  const long = '长'.repeat(20_050)
  const { workspace, runtime } = await scriptProject('script-list', {
    scripts: {
      '第001集-牛肉汤.md': SCRIPT_TEXT,
      '第002集-雪夜.md': '# 第2集\n\n## 场1\n\n柯秒：雪停了。\n',
      '长剧本.md': long,
      '分镜.txt': '不是剧本正文',
      '封面.png': 'not-really-a-png'
    }
  })
  try {
    const listed = await runtime.callTool('pinax_script_list', {})
    assert.equal(listed.value.owner, SCRIPT_CARRIER_ID)
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.equal(listed.value.payload.total, 3, '.txt/.png 不进清单（本批只认 .md）')
    const byTitle = Object.fromEntries(listed.value.payload.scripts.map((item) => [item.title, item]))
    assert.deepEqual(Object.keys(byTitle).sort(), ['第001集-牛肉汤', '第002集-雪夜', '长剧本'].sort())
    assert.equal(byTitle['第001集-牛肉汤'].file, '剧本/第001集-牛肉汤.md')
    assert.equal(byTitle['第001集-牛肉汤'].revision, 1, '未记账的既有文件按第 1 版采纳')
    assert.match(byTitle['第001集-牛肉汤'].text, /白灼 旁白/, '正文随列表带回，省一次单独的读取')
    assert.equal(byTitle['第001集-牛肉汤'].truncated, false)
    assert.equal(byTitle['长剧本'].truncated, true, '单篇超 20000 字按上限截断并标注')
    assert.equal(byTitle['长剧本'].text.length, 20_000)
    assert.equal(byTitle['长剧本'].totalChars, long.length)

    const limited = await runtime.callTool('pinax_script_list', { limit: 1 })
    assert.equal(limited.value.payload.scripts.length, 1)
    assert.equal(limited.value.payload.truncated, true)

    const badLimit = await runtime.callTool('pinax_script_list', { limit: 0 })
    assert.equal(badLimit.value.payload.ok, false)
    assert.equal(badLimit.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('pinax_script_read：按 file／index／title 定位读全文；maxChars 越界拒，读不到就说读不到', async () => {
  const long = '雪'.repeat(2500)
  const { workspace, runtime } = await scriptProject('script-read', {
    scripts: { '第001集-牛肉汤.md': SCRIPT_TEXT, '长剧本.md': long }
  })
  try {
    const byFile = await runtime.callTool('pinax_script_read', { file: '剧本/第001集-牛肉汤.md' })
    assert.equal(byFile.value.owner, SCRIPT_CARRIER_ID)
    assert.equal(byFile.value.payload.ok, true, JSON.stringify(byFile.value.payload))
    assert.equal(byFile.value.payload.script.title, '第001集-牛肉汤')
    assert.equal(byFile.value.payload.script.file, '剧本/第001集-牛肉汤.md')
    assert.equal(byFile.value.payload.script.revision, 1)
    assert.equal(byFile.value.payload.text, SCRIPT_TEXT)
    assert.equal(byFile.value.payload.truncated, false)

    const listed = await runtime.callTool('pinax_script_list', {})
    const longIndex = listed.value.payload.scripts.find((item) => item.title === '长剧本').index
    const byIndex = await runtime.callTool('pinax_script_read', { index: longIndex, maxChars: 1000 })
    assert.equal(byIndex.value.payload.ok, true, JSON.stringify(byIndex.value.payload))
    assert.equal(byIndex.value.payload.text.length, 1000, 'maxChars 是硬闸')
    assert.equal(byIndex.value.payload.truncated, true)
    assert.equal(byIndex.value.payload.totalChars, long.length)

    const byTitle = await runtime.callTool('pinax_script_read', { title: '牛肉汤' })
    assert.equal(byTitle.value.payload.ok, true)
    assert.equal(byTitle.value.payload.script.file, '剧本/第001集-牛肉汤.md')

    const missing = await runtime.callTool('pinax_script_read', { title: '查无此集' })
    assert.equal(missing.value.payload.ok, false)
    assert.equal(missing.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(missing.value.payload.message, /找不到标题含「查无此集」的剧本/)

    const noLocator = await runtime.callTool('pinax_script_read', {})
    assert.equal(noLocator.value.payload.ok, false)
    assert.match(noLocator.value.payload.message, /需要 index \/ title \/ file/)

    const badChars = await runtime.callTool('pinax_script_read', { file: '剧本/第001集-牛肉汤.md', maxChars: 999 })
    assert.equal(badChars.value.payload.ok, false)
    assert.match(badChars.value.payload.message, /maxChars/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('pinax_script_save：带修订号落盘、新建传 0；STALE／空 text／非 .md 一律拒', async () => {
  const { workspace, opened, runtime } = await scriptProject('script-save', {
    scripts: { '第001集-牛肉汤.md': SCRIPT_TEXT }
  })
  try {
    const listed = await runtime.callTool('pinax_script_list', {})
    const script = listed.value.payload.scripts.find((item) => item.title === '第001集-牛肉汤')
    assert.equal(script.revision, 1)

    const saved = await runtime.callTool('pinax_script_save', {
      file: script.file,
      text: `${SCRIPT_TEXT}\n陆漫 画外音：哇，好有意思啊这一版。\n`,
      expectedRevision: script.revision
    })
    assert.equal(saved.value.owner, SCRIPT_CARRIER_ID, '写走载体自有的 save，不落回内核')
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    assert.equal(saved.value.payload.file, '剧本/第001集-牛肉汤.md')
    assert.equal(saved.value.payload.revision, 2, '第 1 版上保存，递增到第 2 版')
    assert.equal(saved.value.payload.created, false)
    const direct = await opened.value.fileService.read({ pluginId: SCRIPT_CARRIER_ID, dir: '剧本', file: '第001集-牛肉汤.md' })
    assert.equal(direct.ok, true, JSON.stringify(direct.error ?? {}))
    assert.match(direct.value.text, /陆漫 画外音/)

    // 新建：expectedRevision 0，标题落成 剧本/<标题>.md。
    const created = await runtime.callTool('pinax_script_save', { title: '第002集-雪夜', text: '# 第2集\n', expectedRevision: 0 })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.file, '剧本/第002集-雪夜.md')
    assert.equal(created.value.payload.revision, 1)
    assert.equal(created.value.payload.created, true)

    // 拿作废的修订号写：STALE，不覆盖不合并；盘上仍是成功那一次。
    const stale = await runtime.callTool('pinax_script_save', { file: '剧本/第001集-牛肉汤.md', text: '基于旧版的一笔', expectedRevision: 1 })
    assert.equal(stale.value.payload.ok, false)
    assert.equal(stale.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.match(stale.value.payload.message, /已被改动/)
    const afterStale = await opened.value.fileService.read({ pluginId: SCRIPT_CARRIER_ID, dir: '剧本', file: '第001集-牛肉汤.md' })
    assert.doesNotMatch(afterStale.value.text, /基于旧版的一笔/)

    const empty = await runtime.callTool('pinax_script_save', { file: '剧本/第001集-牛肉汤.md', text: '', expectedRevision: 2 })
    assert.equal(empty.value.payload.ok, false)
    assert.equal(empty.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(empty.value.payload.message, /text 必填且非空/)

    const noRevision = await runtime.callTool('pinax_script_save', { file: '剧本/第001集-牛肉汤.md', text: '没有修订号的一笔' })
    assert.equal(noRevision.value.payload.ok, false)
    assert.equal(noRevision.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(noRevision.value.payload.message, /expectedRevision 必填/)

    // 本批只认 .md：PDF／TXT／图片一律拒，且不落盘。
    for (const file of ['剧本/第001集-牛肉汤.pdf', '剧本/第001集-牛肉汤.txt', '剧本/封面.png']) {
      const rejected = await runtime.callTool('pinax_script_save', { file, text: 'x', expectedRevision: 0 })
      assert.equal(rejected.value.payload.ok, false, file)
      assert.equal(rejected.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT, file)
      assert.match(rejected.value.payload.message, /必须以 \.md 结尾/, file)
    }

    const noTarget = await runtime.callTool('pinax_script_save', { text: '没有文件名的一笔', expectedRevision: 0 })
    assert.equal(noTarget.value.payload.ok, false)
    assert.match(noTarget.value.payload.message, /要给 file/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('script 块（context）：只列篇名与字数、不带正文；script 与 references 给同一份清单；读不到只记 warning', async () => {
  const { workspace, registry, opened } = await scriptProject('script-blocks', {
    scripts: { '第001集-牛肉汤.md': `${SCRIPT_TEXT}\n柯秒在巷口站住。\n` },
    subdirs: ['第001章'],
    startRuntime: false
  })
  try {
    const impl = registry.impl(SCRIPT_CARRIER_ID)
    assert.equal(typeof impl?.blocks, 'function', '注册表里这块板块要有上下文块工厂')
    const blocks = impl.blocks({ pluginId: SCRIPT_CARRIER_ID, fileService: opened.value.fileService })
    assert.deepEqual(Object.keys(blocks).sort(), ['references', 'script'], '两个种类名指向同一份清单（档案表只认 references）')
    const material = await blocks.script()
    assert.equal(material.blocks.length, 1, '清单是一块素材，不按篇拆')
    assert.equal(material.blocks[0].kind, 'script')
    assert.match(material.blocks[0].content, /第001集-牛肉汤/)
    assert.match(material.blocks[0].content, /字/, '字数取自真实读到的文本')
    assert.doesNotMatch(material.blocks[0].content, /白灼 旁白/, '正文不进上下文，只给清单')
    assert.equal(material.blocks[0].sourceRefs.length, 1)
    assert.match(material.warnings.join('\n'), /子目录/, '子目录没被递归读，如实记账')

    const alias = await blocks.references()
    assert.equal(alias.blocks[0].content, material.blocks[0].content, 'references 是同一份清单的档案侧入口')

    // 没有文件服务：块缺席只是一条 warning——不抛、不把整次提问翻成失败。
    const absent = await createScriptBlocks({ pluginId: SCRIPT_CARRIER_ID, fileService: null }).script()
    assert.deepEqual(absent.blocks, [])
    assert.equal(absent.warnings.length, 1)
    assert.match(absent.warnings[0], /未绑定项目文件服务/)
  } finally {
    await workspace.cleanup()
  }
})

test('剧本/ 目录归属：别的板块写不进来（DIR_CONFLICT 先于 scope 闸）', async () => {
  const { workspace, opened } = await scriptProject('script-scope', { startRuntime: false })
  try {
    const own = await opened.value.fileService.write({
      pluginId: SCRIPT_CARRIER_ID,
      dir: '剧本',
      file: '第003集-开场.md',
      text: '# 第3集\n',
      expectedRevision: 0
    })
    assert.equal(own.ok, true, JSON.stringify(own.error ?? {}))

    const foreign = await opened.value.fileService.write({
      pluginId: 'pinax.carrier.novel',
      dir: '剧本',
      file: '别人偷写.md',
      text: 'x',
      expectedRevision: 0
    })
    assert.equal(foreign.ok, false)
    assert.equal(foreign.error.code, NEXT_ERROR_CODES.DIR_CONFLICT)
  } finally {
    await workspace.cleanup()
  }
})

test('工具在空框架下如实报缺（没有文件服务就不假装能列）', async () => {
  const tools = createScriptTools({ pluginId: SCRIPT_CARRIER_ID })
  const listed = await tools.find((tool) => tool.name === 'pinax_script_list').run({})
  assert.equal(listed.ok, false)
  assert.equal(listed.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  assert.match(listed.error.message, /需要已打开项目的文件服务/)
})
