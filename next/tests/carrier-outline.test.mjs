import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  OUTLINE_CARRIER,
  OUTLINE_CARRIER_ID,
  OUTLINE_TOOL_NAMES,
  NOVEL_CARRIER_ID,
  createOutlineBlocks,
  createOutlineTools
} from '../carriers/index.mjs'
import { AGENT_CONTEXT_PROFILES } from '../../shared/agentContextProfiles.js'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 协议 v1.1-A：大纲载体（大纲/）——从小说载体整块拆出来的独立一栏。
 * 证五件事：清单过内核校验且只认领内核已有的 pinax_outline_read；
 * 目录归属独立（一目录一主人）；读有两条如实路径（outline.json 优先，散文稿回退且不造节点）；
 * 保存是带修订号的整份覆盖；上下文块与工具同源。
 * 夹具目录在 os.tmpdir() 下，素材是工装种子文件（openProject 之前 raw writeFile），不碰作者原稿。
 */

async function outlineProject(label, { primaryCarrier = OUTLINE_CARRIER_ID, fill = null, startRuntime = true } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '大纲载体靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '大纲载体靶子', primaryCarrier, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  if (fill) {
    // 素材直接落盘（工装目录）：此刻项目还没打开、文件服务还没影，只能用 raw writeFile 种数据。
    const dir = join(root, '大纲')
    await mkdir(dir, { recursive: true })
    for (const [name, text] of Object.entries(fill)) await writeFile(join(dir, name), text, 'utf-8')
  }
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = startRuntime
    ? createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
    : null
  if (runtime) await runtime.start()
  return { workspace, root, registry, opened, runtime }
}

test('大纲真清单过校验：只认领 pinax_outline_read，大纲/ 申请 rw，上下文档案认得 outline 块', () => {
  const validated = validateCarrierManifest(OUTLINE_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  assert.deepEqual(OUTLINE_CARRIER.tools, ['pinax_outline_read', 'pinax_outline_save'])
  assert.deepEqual(OUTLINE_CARRIER.tools.filter((name) => kernel.has(name)), ['pinax_outline_read'], '只读名从内核认领；保存是载体自有写入口')
  assert.equal(kernel.has('pinax_outline_save'), false, 'pinax_outline_save 是载体自有（内核只有 pinax_outline_read）')
  assert.deepEqual({ ...OUTLINE_CARRIER.dataDirs }, { outline: '大纲' })
  assert.deepEqual(OUTLINE_CARRIER.permissions, [{ type: 'file', dir: '大纲', mode: 'rw' }, 'agent:ask'], 'v2：只申请 大纲/ 一块目录的 rw；agent:ask 是运行时调用载体工具的前置授权')
  assert.deepEqual(OUTLINE_CARRIER.provides, ['outline.tree'])
  assert.deepEqual(OUTLINE_CARRIER.context, { providers: ['outline'], budgetChars: 20000 })
  // 协议 v1.1-C / 工单C：第三枚是悬浮小工具窗（overlay），宽度过合同校验（200–600，缺省 300）。
  assert.deepEqual(OUTLINE_CARRIER.contributes.panes.map((pane) => pane.id), ['outline.tree', 'outline.editor', 'outline.widget'])
  const widget = validated.value.panes.find((pane) => pane.id === 'outline.widget')
  assert.equal(widget.slot, 'overlay')
  assert.equal(widget.width, 300, '宿主 FloatingWidget 按这个宽度渲染；校验器保留 width')
  assert.equal(OUTLINE_CARRIER.primary.projectKind, 'generic', '大纲可以是泛型项目的主载体，也可在小说/剧本里当伴生板块')
  assert.equal(OUTLINE_CARRIER.primary.defaultPane, 'outline.editor')
  // 档案必须是只读任务表里查得到的，且档案块表含 outline——否则载体声明的提供者在信封里会被静默忽略。
  const definition = readOnlyTaskForProfile(OUTLINE_CARRIER.primary.contextProfile)
  assert.ok(definition, `档案「${OUTLINE_CARRIER.primary.contextProfile}」在只读任务表里查不到，本板块当主载体时提问会报缺`)
  assert.ok(AGENT_CONTEXT_PROFILES[definition.contextProfile].blocks.includes('outline'), '档案不认 outline 块')
  assert.equal(BUILT_IN_CARRIER_IDS.includes(OUTLINE_CARRIER_ID), true, '随框架发布：注册表默认装得上这块板块')
  assert.deepEqual(OUTLINE_TOOL_NAMES, ['pinax_outline_read', 'pinax_outline_save'])
})

test('工具面：大纲载体启用后两把工具进面、归属它，内核写族照旧不认领', async () => {
  const { workspace, runtime, opened } = await outlineProject('outline-surface')
  try {
    assert.equal(opened.value.view.projectKind, 'generic', '大纲可以是泛型项目的主载体')
    assert.deepEqual([...runtime.surfaceInfo().carrierToolNames].sort(), [...OUTLINE_TOOL_NAMES].sort())
    assert.equal(runtime.listTools().length, 22, '19 内核 ＋ 技能读取 1 ＋ 服务日志读取 1 ＋ 大纲自有 1 个新名字（outline_save）；outline_read 是认领名不虚增')
    assert.equal(runtime.ownerOf('pinax_outline_read'), OUTLINE_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_outline_save'), OUTLINE_CARRIER_ID)
    const tools = new Map(runtime.listTools().map((tool) => [tool.name, tool]))
    assert.equal(tools.get('pinax_outline_read').annotations.readOnlyHint, true)
    assert.equal(tools.get('pinax_outline_save').annotations.readOnlyHint, false)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('大纲读取：结构化优先；只有散文稿时如实给警告，不凭空造节点；两样都没有就拒', async () => {
  const { workspace, root, runtime } = await outlineProject('outline-read', {
    fill: {
      'outline.json': JSON.stringify({ nodes: [{ id: 'n1', title: '开场：雨夜进城' }, { id: 'n2', title: '第一折' }], edges: [{ from: 'n1', to: 'n2' }] }, null, 2)
    }
  })
  try {
    const read = await runtime.callTool('pinax_outline_read', { maxNodes: 300 })
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload))
    assert.equal(read.value.payload.nodeTotal, 2)
    assert.deepEqual(read.value.payload.nodes.map((node) => node.id), ['n1', 'n2'])
    assert.equal(read.value.payload.warning, null)
    assert.match(read.value.payload.source.replaceAll('\\', '/'), /大纲\/outline\.json$/)

    const limited = await runtime.callTool('pinax_outline_read', { maxNodes: 1 })
    assert.equal(limited.value.payload.nodes.length, 1)
    assert.equal(limited.value.payload.truncated, true)

    const badNodes = await runtime.callTool('pinax_outline_read', { maxNodes: 0 })
    assert.equal(badNodes.value.payload.ok, false)
    assert.equal(badNodes.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    // 只有散文稿的第二种项目：警告要有，节点必须是空数组。
    const prose = await outlineProject('outline-prose', { fill: { '大纲.md': '第一卷：雨夜。\n第二卷：停摆。' } })
    try {
      const result = await prose.runtime.callTool('pinax_outline_read', {})
      assert.equal(result.value.payload.ok, true, JSON.stringify(result.value.payload))
      assert.deepEqual(result.value.payload.nodes, [])
      assert.match(result.value.payload.warning, /未凭空生成节点树/)
      assert.match(result.value.payload.text, /第一卷：雨夜/)
    } finally {
      await prose.runtime.stop()
      await prose.workspace.cleanup()
    }

    // 两样都没有：如实拒绝（新建项目的常态，界面据此给「新建大纲」）。
    const empty = await outlineProject('outline-empty')
    try {
      const nothing = await empty.runtime.callTool('pinax_outline_read', {})
      assert.equal(nothing.value.payload.ok, false)
      assert.equal(nothing.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
      assert.match(nothing.value.payload.message, /既没有 outline\.json 也没有 大纲\.md/)
    } finally {
      await empty.runtime.stop()
      await empty.workspace.cleanup()
    }
    assert.ok(join(root, '大纲'))
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('大纲保存：整份覆盖落盘、修订号递增；盲写与非法结构都拒', async () => {
  const { workspace, root, runtime } = await outlineProject('outline-save', {
    fill: { 'outline.json': JSON.stringify({ nodes: [{ id: 'n1', title: '开场：雨夜进城', summary: '雪夜，柯秒进了城。' }], edges: [] }, null, 2) }
  })
  try {
    const read = await runtime.callTool('pinax_outline_read', {})
    assert.equal(read.value.payload.revision, 1)

    const saved = await runtime.callTool('pinax_outline_save', {
      nodes: [{ id: 'n1', title: '开场：雨夜进城（改）', summary: '雪夜，柯秒进了城。' }, { id: 'n2', title: '第一折' }],
      edges: [{ from: 'n1', to: 'n2' }],
      expectedRevision: read.value.payload.revision
    })
    assert.equal(saved.value.owner, OUTLINE_CARRIER_ID, '写走大纲载体自己的 save，不落回内核')
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    assert.equal(saved.value.payload.revision, 2)
    assert.equal(saved.value.payload.nodeTotal, 2)
    assert.equal(saved.value.payload.file, '大纲/outline.json')
    const onDisk = JSON.parse(await readFile(join(root, '大纲', 'outline.json'), 'utf-8'))
    assert.deepEqual(onDisk.nodes.map((node) => node.title), ['开场：雨夜进城（改）', '第一折'])
    assert.equal(onDisk.nodes[0].summary, '雪夜，柯秒进了城。', '节点上的其余字段原样保留，不洗掉')
    assert.deepEqual(onDisk.edges, [{ from: 'n1', to: 'n2' }])

    // 修订号不符：盘上第 2 版，拿 1 盲写必须拒，磁盘不动。
    const stale = await runtime.callTool('pinax_outline_save', { nodes: [{ id: 'n1', title: '被推翻的写法' }], expectedRevision: 1 })
    assert.equal(stale.value.payload.ok, false)
    assert.equal(stale.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.equal(stale.value.payload.details.actual, 2)
    assert.match(JSON.parse(await readFile(join(root, '大纲', 'outline.json'), 'utf-8')).nodes[0].title, /（改）/, '拒绝后磁盘内容不动')

    // 非法结构：缺 nodes、空 nodes、节点缺 title、edges 不是数组、缺 expectedRevision。
    for (const [label, args] of [
      ['缺 nodes', { expectedRevision: 2 }],
      ['空 nodes', { nodes: [], expectedRevision: 2 }],
      ['节点缺 title', { nodes: [{ id: 'n1' }], expectedRevision: 2 }],
      ['edges 不是数组', { nodes: [{ id: 'n1', title: 'x' }], edges: 'n1-n2', expectedRevision: 2 }],
      ['缺 expectedRevision', { nodes: [{ id: 'n1', title: 'x' }] }]
    ]) {
      const rejected = await runtime.callTool('pinax_outline_save', args)
      assert.equal(rejected.value.payload.ok, false, label)
      assert.equal(rejected.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT, label)
    }
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('大纲首建：outline.json 还不存在时传 0 直接建档（不靠散文稿掩护）', async () => {
  const { workspace, root, runtime } = await outlineProject('outline-create')
  try {
    const created = await runtime.callTool('pinax_outline_save', { nodes: [{ id: 'n1', title: '第一笔' }], expectedRevision: 0 })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.revision, 1)
    assert.equal(created.value.payload.nodeTotal, 1)
    assert.match(await readFile(join(root, '大纲', 'outline.json'), 'utf-8'), /第一笔/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('大纲上下文块：与工具同一份节点表；散文稿进块并带警告；没绑定文件服务只记账', async () => {
  const { workspace, opened, registry } = await outlineProject('outline-block', {
    fill: { 'outline.json': JSON.stringify({ nodes: [{ id: 'n1', title: '开场：雨夜进城', summary: '雪夜，柯秒进了城。' }], edges: [] }, null, 2) }
  })
  try {
    const impl = registry.impl(OUTLINE_CARRIER_ID)
    assert.equal(typeof impl?.blocks, 'function', '注册表里这块板块要有上下文块工厂')
    const material = await impl.blocks({ pluginId: OUTLINE_CARRIER_ID, fileService: opened.value.fileService }).outline()
    assert.equal(material.blocks.length, 1)
    assert.equal(material.blocks[0].kind, 'outline')
    assert.match(material.blocks[0].content, /开场：雨夜进城/)
    assert.match(material.blocks[0].content, /雪夜，柯秒进了城/)
    assert.match(material.blocks[0].sourceRefs[0], /^outline:大纲\//)

    // 散文稿回退：节点为空、正文进块、警告随块带回（不硬失败）。
    const proseRoot = join(workspace.projects, '散文大纲块靶子')
    const registry2 = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
    for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry2.install(plugin.manifest, plugin.impl, plugin.meta)
    await createProject({ root: proseRoot, name: '散文大纲块靶子', primaryCarrier: OUTLINE_CARRIER_ID, registry: registry2 })
    await writeFile(join(proseRoot, '大纲', '大纲.md'), '第一卷：雨夜。', 'utf-8')
    const opened2 = await openProject({ root: proseRoot, registry: registry2 })
    const proseBlocks = await createOutlineBlocks({ pluginId: OUTLINE_CARRIER_ID, fileService: opened2.value.fileService }).outline()
    assert.equal(proseBlocks.blocks.length, 1)
    assert.match(proseBlocks.blocks[0].content, /散文稿/)
    assert.match(proseBlocks.warnings.join('\n'), /未凭空生成节点树/)

    // 没有文件服务：块缺席只是一条 warning——不抛、不把整次提问翻成失败。
    const absent = await createOutlineBlocks({ pluginId: OUTLINE_CARRIER_ID, fileService: null }).outline()
    assert.deepEqual(absent.blocks, [])
    assert.equal(absent.warnings.length, 1)
    assert.match(absent.warnings[0], /未取得/)
  } finally {
    await workspace.cleanup()
  }
})

test('一目录一主人：大纲/ 归大纲载体，小说与设定写不进来；大纲工具也写不出正文', async () => {
  const { workspace, opened } = await outlineProject('outline-fence', { startRuntime: false })
  try {
    const own = await opened.value.fileService.write({ pluginId: OUTLINE_CARRIER_ID, dir: '大纲', file: 'outline.json', text: '{"nodes":[],"edges":[]}', expectedRevision: 0 })
    assert.equal(own.ok, true, JSON.stringify(own.error ?? {}))
    for (const pluginId of [NOVEL_CARRIER_ID, 'pinax.carrier.setting']) {      const foreign = await opened.value.fileService.write({ pluginId, dir: '大纲', file: '别人偷写.json', text: '{}', expectedRevision: 0 })
      assert.equal(foreign.ok, false, pluginId)
      assert.equal(foreign.error.code, NEXT_ERROR_CODES.DIR_CONFLICT, pluginId)
    }
    // 载体工具自己也不越界：大纲 save 只写死 outline.json，正文目录一个字不进。
    const tools = createOutlineTools({ pluginId: OUTLINE_CARRIER_ID, fileService: opened.value.fileService })
    const save = tools.find((tool) => tool.name === 'pinax_outline_save')
    const saved = await save.run({ nodes: [{ id: 'n1', title: '第一笔' }], expectedRevision: 1 })
    assert.equal(saved.ok, true, JSON.stringify(saved.error ?? {}))
    const escaped = await opened.value.fileService.write({ pluginId: OUTLINE_CARRIER_ID, dir: '正文', file: '偷.md', text: 'x', expectedRevision: 0 })
    assert.equal(escaped.ok, false)
    assert.equal(escaped.error.code, NEXT_ERROR_CODES.DIR_CONFLICT)
  } finally {
    await workspace.cleanup()
  }
})
