import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime, RUNTIME_CONTRACT } from '../runtime/agentRuntime.mjs'
import { kernelToolNames, toolOwnershipReport } from '../runtime/mcpSurface.mjs'
import { BUILT_IN_CARRIER_PLUGINS } from '../carriers/index.mjs'
import { FIXTURE_NOVEL } from '../testing/fixtures.mjs'
import { createTempWorkspace, probePort } from '../testing/harness.mjs'

async function session(label = 'runtime') {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '运行时靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  registry.install(FIXTURE_NOVEL)
  const created = await createProject({ root, name: '运行时靶子', primaryCarrier: 'fixture.novel', registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService })
  return { workspace, root, registry, opened, runtime }
}

test('运行时是内置一级公民：起得来、列出 19 工具、全程不开端口', async () => {
  const { workspace, runtime, registry } = await session()
  try {
    assert.equal(RUNTIME_CONTRACT.builtIn, true)
    assert.equal(RUNTIME_CONTRACT.disableable, false)
    assert.equal(RUNTIME_CONTRACT.ownsSlot, 'right')

    const started = await runtime.start()
    assert.equal(started.ok, true, JSON.stringify(started.error ?? {}))
    assert.equal(started.value.toolCount, 19)
    assert.equal(started.value.portsOpened, 0)
    assert.equal(await probePort(39551), false, 'Next 运行时不该在任何端口上监听')
    assert.equal(registry.ownerOfTool('pinax_chapter_read'), null, 'M1 阶段工具仍由内核持有')

    const dock = runtime.dockViewModel()
    assert.equal(dock.tools.length, 19)
    assert.equal(dock.tools.every((tool) => tool.owner === 'kernel'), true)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('Next 自建项目：内核文件服务读得到，服务端工具面暂时不认 @2（缺口已在 legacy-interoperability 记账）', async () => {
  const { workspace, root, runtime, opened } = await session()
  try {
    await runtime.start()
    const dirs = opened.value.view.dirs
    assert.ok(dirs.owned.includes('正文'), '板块认领的目录必须落进视图')
    const listing = await opened.value.fileService.list({ pluginId: 'fixture.novel', dir: '正文' })
    assert.equal(listing.ok, true, JSON.stringify(listing.error ?? {}))
    assert.equal(listing.value.entries.length, 0)

    const tool = await runtime.callTool('pinax_project_context', { projectPath: root })
    assert.equal(tool.value.payload.ok, false, '服务端合同仍只认 pinax-project@1，这条是 M2 要收的口')
    assert.equal(tool.value.payload.code, 'ERR_SPEC_MISMATCH')
    assert.equal(tool.value.owner, 'kernel')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('M1 没接模型运行器时如实报错，不编一段回答冒充模型', async () => {
  const { workspace, runtime } = await session()
  try {
    await runtime.start()
    const answer = await runtime.ask('这一章的开场能不能再狠一点？')
    assert.equal(answer.ok, false)
    assert.equal(answer.error.code, 'PINAX_DEPENDENCY_UNMET')
    assert.match(answer.error.message, /未接模型运行器/)
    assert.equal(answer.error.details.toolCount, 19)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('注入 runner 后「问一句话」走通，提案只进 .pinax/proposals/', async () => {
  const { workspace, root, registry, opened } = await session('runtime-runner')
  const runtime = createAgentRuntime({
    registry,
    fileService: opened.value.fileService,
    runner: async ({ question }) => ({ text: `收到问题：${question}`, cited: ['正文'] })
  })
  try {
    await runtime.start()
    const answer = await runtime.ask('开场怎么写？')
    assert.equal(answer.ok, true, JSON.stringify(answer.error ?? {}))
    assert.equal(answer.value.source, 'in-process-runner')
    assert.match(answer.value.text, /开场怎么写/)

    const proposal = await runtime.propose({ name: '提案-开场.md', text: '建议：先给一场雨。' })
    assert.equal(proposal.ok, true, JSON.stringify(proposal.error ?? {}))
    assert.match(proposal.value.path.replaceAll('\\', '/'), /\.pinax\/proposals\/提案-开场\.md$/)
    assert.match(await readFile(proposal.value.path, 'utf-8'), /先给一场雨/)
    assert.deepEqual(await (await import('node:fs/promises')).readdir(join(root, '正文')), [])
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

/**
 * M2 门禁口径（替换 M1 的「全量未认领」）。
 * 两条腿一起核：空注册表必须还是内核全量（证明运行时不依附插件），
 * 装了随框架发布的载体后认领数必须真的往下走，且认领的名字都得有实现——
 * 否则聚合面会静默回落内核，作者看到的归属和实际服务的实现就不是同一回事。
 */
test('工具归属核对：空注册表＝内核全量；装内置载体后认领 5、未认领 14，且认领的都有实现', () => {
  const bare = toolOwnershipReport(createRegistry({ kinds: Object.keys(PROJECT_KINDS) }))
  assert.deepEqual(bare.unclaimed, kernelToolNames(), '不装插件时 19 个名字全由内核服务')
  assert.equal(bare.declaredCount, 0)
  assert.equal(bare.unmappedHints.length, 0, '每个内核工具都要有归属提示，否则 M2 没法搬')

  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry.install(plugin.manifest, plugin.impl, plugin.meta)
  const report = toolOwnershipReport(registry)
  assert.equal(report.kernelCount, 19)
  assert.deepEqual([...report.claimed].sort(), ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_outline_read', 'pinax_worldbook_list', 'pinax_worldbook_read'])
  assert.equal(report.unclaimed.length, 14, 'M2 起未认领清单必须逐批缩小')
  assert.deepEqual(report.declaredOutsideKernel, ['pinax_chapter_save', 'pinax_outline_save', 'pinax_notes_list', 'pinax_notes_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard', 'pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save', 'pinax_document_list', 'pinax_document_read', 'pinax_document_save', 'pinax_reference_search'], '工单A2：设定板块的自有写入口；工单B1 构思这对、工单B2 大纲写半边、工单A 提案三把、工单E2 约束这对、工单G1 资料三把、工单H2 资料检索也是自有名字（断言同步）')
  assert.deepEqual(report.withoutImplementation, [], '声明了却没实现的工具会被面剔掉，这里必须为空')
})
