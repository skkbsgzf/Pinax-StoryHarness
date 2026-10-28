import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import {
  CARRIER_WRITE_CLASS,
  KERNEL_WRITE_TOOL_NAMES,
  guardCarrierWriteGaps,
  guardClassificationGaps,
  guardKernelToolCall
} from '../runtime/kernelWriteGuard.mjs'
import { BUILT_IN_CARRIER_PLUGINS, NOVEL_CARRIER_ID, REFERENCE_CARRIER_ID, SETTING_CARRIER_ID } from '../carriers/index.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * M2 批次 2：内核写族闸。
 * 治的是批次 1 留下的那个真口子——未认领的内核写工具按 projectPath 直接认目录，
 * 模型给一个绝对路径就能绕开板块授权、目录归属和修订号闸（详见 next/runtime/kernelWriteGuard.mjs 的头注）。
 * 这里证的不是「消息写得好看」，而是四件事：名单来源是内核自己的 annotations、
 * 定位只剩当前项目根一条路、认领过的目录写不进、结构动作与 sync 不放行。
 */

const WRITE_FAMILY = [
  'pinax_chapter_write',
  'pinax_chapter_import',
  'pinax_worldbook_write',
  'pinax_rule_write',
  'pinax_project_init',
  'pinax_project_import',
  'pinax_project_index'
]

test('写族名单从内核 annotations 现取，分类表逐条点名且没有多余项', () => {
  assert.deepEqual([...KERNEL_WRITE_TOOL_NAMES].sort(), [...WRITE_FAMILY].sort(), '内核声明会写盘的就这七把；改动了要在这里留名')
  const gaps = guardClassificationGaps()
  assert.deepEqual(gaps.unclassified, [], '新出现的内核写工具必须先定性，否则闸不认它、面里却留着它')
  assert.deepEqual(gaps.staleEntries, [], '分类表里不许留着已经不再是写族的条目')
  assert.deepEqual(gaps.outsideKernel, [], '分类表只能定性内核真有的工具，不许虚增')
})

test('载体写工具落点表与载体 impl 的 annotations 对账：提示只列写这块目录的写工具', () => {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
  const gaps = guardCarrierWriteGaps(registry)
  assert.deepEqual(gaps.unmapped, [], '载体 impl 说是写工具就必须在落点表里点名，否则拒绝提示指不准该走哪把')
  assert.deepEqual(gaps.staleEntries, [], '落点表里不许留着已经没有实现方的写工具')
  assert.deepEqual(gaps.dirOutsideOwner, [], '点名的落点必须是该载体自己认领的 dataDir')

  // 只读工具（列／读）不是写入口，不进落点表——它们也不会出现在「请走…」这句话里。
  for (const readOnly of [
    'pinax_chapter_list', 'pinax_chapter_read', 'pinax_outline_read',
    'pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_rule_list',
    'pinax_proposal_list', 'pinax_proposal_read',
    'pinax_document_list', 'pinax_document_read', 'pinax_reference_search'
  ]) {
    assert.equal(CARRIER_WRITE_CLASS[readOnly], undefined, `${readOnly} 是只读工具，不该被说成写入口`)
  }
  // 写内核元数据的那把（提案弃用）在表里但落点为空：任何 dataDir 的提示都不列它。
  assert.equal(CARRIER_WRITE_CLASS.pinax_proposal_discard.dir, null)
  assert.deepEqual(
    Object.keys(CARRIER_WRITE_CLASS).sort(),
    ['pinax_chapter_save', 'pinax_document_save', 'pinax_notes_save', 'pinax_outline_save', 'pinax_proposal_discard', 'pinax_rule_save', 'pinax_worldbook_save'],
    '载体自有写工具就这七把；新增一把要在这里留名'
  )
})

test('非写族原样放行：读工具与运行时自己的通道不受闸约束', () => {
  for (const name of ['pinax_chapter_read', 'pinax_worldbook_list', 'pinax_knowledge_search', 'pinax_agent_ask']) {
    const passed = guardKernelToolCall({ tool: name, args: { projectPath: 'D:/随便哪个项目' }, root: 'D:/当前项目' })
    assert.equal(passed.ok, true, name)
    assert.equal(passed.value.guard.guarded, false, `${name} 不该被改写参数`)
    assert.equal(passed.value.args.projectPath, 'D:/随便哪个项目', '读族保持今天的本地轨行为，本批不扩面')
  }
})

test('定位只有一条路：foreign 路径拒、等价写法放行、没给就注入当前根', () => {
  const root = 'D:/工作区/靶子项目'
  const foreign = guardKernelToolCall({ tool: 'pinax_rule_write', args: { projectPath: 'D:/别的作家的原稿' }, root, registry: null })
  assert.equal(foreign.ok, false)
  assert.equal(foreign.error.code, NEXT_ERROR_CODES.PATH_OUTSIDE_PROJECT)
  assert.match(foreign.error.message, /只允许写当前打开的 Next 项目/, '拒的时候要讲清楚只能写哪个根')

  // Windows 下同一个根的反斜杠／尾斜杠／大小写写法都算当前项目，否则会把合法调用误判成越界。
  for (const variant of ['D:\\工作区\\靶子项目', `${root}/`, 'd:/工作区/靶子项目']) {
    const same = guardKernelToolCall({ tool: 'pinax_project_index', args: { projectPath: variant }, root })
    assert.equal(same.ok, true, variant)
    assert.equal(same.value.guard.injectedProjectPath, false, '调用方自己给了当前根，就不算注入')
  }

  const bare = guardKernelToolCall({ tool: 'pinax_project_index', args: {}, root })
  assert.equal(bare.ok, true)
  assert.equal(bare.value.args.projectPath, root, '没给路径时由闸注入当前根，调用方无从选择别的目录')
  assert.equal(bare.value.guard.injectedProjectPath, true)
})

test('projectId 一律拒：Next 的项目不在服务端注册表里，按 id 找会读到别的项目', () => {
  const byId = guardKernelToolCall({ tool: 'pinax_worldbook_write', args: { projectId: 'dameng-em56-local', name: '人物·新角', content: 'x' }, root: 'D:/工作区/靶子项目' })
  assert.equal(byId.ok, false)
  assert.equal(byId.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  assert.match(byId.error.message, /不接受 projectId/)

  const emptyId = guardKernelToolCall({ tool: 'pinax_worldbook_write', args: { projectId: '  ', content: 'x' }, root: 'D:/工作区/靶子项目', registry: createRegistry({ kinds: Object.keys(PROJECT_KINDS) }) })
  assert.equal(emptyId.ok, false, '空串 projectId 也不许静默当没给——形状含糊就让它说清楚')
})

test('一目录一主人：认领过的目录内核写不进，未认领的目录才由内核兜底', () => {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
  const root = 'D:/工作区/靶子项目'

  const manuscript = guardKernelToolCall({ tool: 'pinax_chapter_write', args: { projectPath: root, title: '第002章', text: 'x' }, root, registry })
  assert.equal(manuscript.ok, false)
  assert.equal(manuscript.error.code, NEXT_ERROR_CODES.SCOPE_NOT_GRANTED)
  assert.match(manuscript.error.message, /正文\/ 的主人/)
  assert.match(manuscript.error.message, /pinax_chapter_save/, '拒的时候要把合法的那条路（带修订号）点名出来')
  // 提示精确化（批次16 记账，批次19 H1 收尾）：只列写这块目录的写工具——
  // 只读工具（pinax_chapter_list／pinax_outline_read）与写别的目录的工具（大纲／构思／提案）都不混进来。
  for (const noise of ['pinax_outline_save', 'pinax_notes_save', 'pinax_proposal_discard', 'pinax_chapter_list', 'pinax_outline_read', 'pinax_proposal_list']) {
    assert.doesNotMatch(manuscript.error.message, new RegExp(noise), `「正文/」的提示不该点名 ${noise}`)
  }
  assert.equal(manuscript.error.details.owner, NOVEL_CARRIER_ID)

  const book = guardKernelToolCall({ tool: 'pinax_worldbook_write', args: { projectPath: root, name: '人物·新角', content: 'x' }, root, registry })
  assert.equal(book.ok, false)
  assert.equal(book.error.details.owner, SETTING_CARRIER_ID)
  assert.match(book.error.message, /pinax_worldbook_save/, '世界书的主人自有写工具了（工单A2）：拒时点名那条带修订号的路（断言同步，调度方裁定 dwfq-f2369ffa-1）')
  // 同一个载体的「约束」写工具也是写工具，但不写世界书——不许混进这句话；只读的 list 同样不列。
  for (const noise of ['pinax_rule_save', 'pinax_rule_list', 'pinax_worldbook_list', 'pinax_worldbook_read']) {
    assert.doesNotMatch(book.error.message, new RegExp(noise), `「世界书/」的提示不该点名 ${noise}`)
  }

  // 把设定板块停掉后，「世界书/」在注册表里仍是它认领的目录（认领关系不随开关消失），所以照旧拒。
  const disabled = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  disabled.install(BUILT_IN_CARRIER_PLUGINS[0].manifest, BUILT_IN_CARRIER_PLUGINS[0].impl ?? {})
  const noOwner = guardKernelToolCall({ tool: 'pinax_worldbook_write', args: { projectPath: root, name: '人物·新角', content: 'x' }, root, registry: disabled })
  assert.equal(noOwner.ok, true, '只剩小说板块时世界书没有主人，内核兜底——这正是 unclaimed 的搬迁底稿')
  assert.deepEqual(noOwner.value.guard.class, { dir: '世界书', unclaimed: true })
})

test('结构动作与 sync 不放行：建骨架／跨目录导入归服务端轨，索引只读盘点', () => {
  const root = 'D:/工作区/靶子项目'
  for (const name of ['pinax_project_init', 'pinax_project_import']) {
    const blocked = guardKernelToolCall({ tool: name, args: { projectPath: root, sourcePath: 'D:/素材' }, root })
    assert.equal(blocked.ok, false, name)
    assert.equal(blocked.error.code, NEXT_ERROR_CODES.SCOPE_NOT_GRANTED)
    assert.match(blocked.error.message, /结构动作/)
  }
  const sync = guardKernelToolCall({ tool: 'pinax_project_index', args: { projectPath: root, action: 'sync' }, root })
  assert.equal(sync.ok, false)
  assert.equal(sync.error.code, NEXT_ERROR_CODES.DEPENDENCY_UNMET, 'sync 要打本机 3001，与 Next 零端口口径冲突')
  assert.match(sync.error.message, /action:"status"/)
})

test('没绑定项目根＝写族整组拒：stdio 出口那句「不改项目文件」由此变成闸', () => {
  const blocked = guardKernelToolCall({ tool: 'pinax_chapter_write', args: { projectPath: 'D:/作家的原稿', title: '第001章', text: 'x' }, root: null })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, NEXT_ERROR_CODES.SCOPE_NOT_GRANTED)
  assert.match(blocked.error.message, /没有绑定已打开的项目根/)

  const readPass = guardKernelToolCall({ tool: 'pinax_chapter_read', args: { projectPath: 'D:/作家的原稿' }, root: null })
  assert.equal(readPass.ok, true, '读族维持今天的本地轨行为（未认领，本批不扩面）')
})

test('真运行时里闸是生效的：内核写族被拒，带修订号的载体保存照旧落盘', async () => {
  const workspace = await createTempWorkspace('guard-runtime')
  const root = join(workspace.projects, '写族闸靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
  const created = await createProject({ root, name: '写族闸靶子', primaryCarrier: NOVEL_CARRIER_ID, registry, extraEnabled: [SETTING_CARRIER_ID, REFERENCE_CARRIER_ID] })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  const started = await runtime.start()
  assert.equal(started.ok, true)
  try {
    assert.equal(started.value.toolCount, 33, '闸不改面的形状：内核 19 ∪ 载体自有 14（工单A2：pinax_worldbook_save；工单B1：构思这对；工单B2：pinax_outline_save；工单A：提案三把；工单E2：约束这对；工单G1：资料三把；工单H2：pinax_reference_search；断言同步）')
    const guard = runtime.surfaceInfo().writeGuard
    assert.deepEqual([...guard.tools].sort(), [...WRITE_FAMILY].sort(), '右栏要能读出此刻受约束的是哪几把')
    assert.equal(guard.projectRoot, opened.value.fileService.root)

    for (const [tool, args] of [
      ['pinax_worldbook_write', { projectPath: root, name: '人物·偷写', content: 'x' }],
      ['pinax_rule_write', { projectPath: root, name: '纪律·偷写', content: 'x' }],
      ['pinax_chapter_write', { projectPath: root, title: '第002章', text: 'x' }]
    ]) {
      const call = await runtime.callTool(tool, args)
      assert.equal(call.ok, true, '调用本身送达了，拒的是载荷')
      assert.equal(call.value.owner, 'kernel', `${tool} 还没被认领，服务它的仍是内核那份`)
      assert.equal(call.value.payload.ok, false, tool)
      assert.equal(call.value.payload.code, NEXT_ERROR_CODES.SCOPE_NOT_GRANTED, tool)
    }
    assert.deepEqual(await readdir(join(root, '世界书')), [], '拒完不留痕')
    assert.deepEqual(await readdir(join(root, '约束')), [])
    assert.deepEqual(await readdir(join(root, '正文')), [])

    // 被拒不等于写不了：合法那条路（载体带修订号）必须照常通，闸只掐绕过它的口子。
    const saved = await runtime.callTool('pinax_chapter_save', { title: '第001章-入场', text: '雨从檐口滴下来。', expectedRevision: 0 })
    assert.equal(saved.ok, true, JSON.stringify(saved.value?.payload ?? saved.error ?? {}))
    assert.equal(saved.value.owner, NOVEL_CARRIER_ID)
    assert.deepEqual(await readdir(join(root, '正文')), ['第001章-入场.md'])
    const again = await runtime.callTool('pinax_chapter_save', { file: '正文/第001章-入场.md', text: '雨更大了。', expectedRevision: 0 })
    assert.equal(again.value.payload.ok, false, '修订号闸没被绕过')
    assert.equal(again.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})
