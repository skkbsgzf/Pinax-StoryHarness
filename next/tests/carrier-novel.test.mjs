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
import { setCarrierEnabled } from '../project/carriers.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { kernelToolNames, toolOwnershipReport } from '../runtime/mcpSurface.mjs'
import { BUILT_IN_CARRIER_PLUGINS, NOVEL_CARRIER, NOVEL_CARRIER_ID } from '../carriers/index.mjs'
import { NOVEL_TOOL_NAMES } from '../carriers/novel/tools.mjs'
import { FIXTURE_SCRIPT } from '../testing/fixtures.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * M2 · WP5/WP6：第一个真实载体（小说）与工具面聚合。
 * 这里用的必须是 next/carriers/ 里的真清单，不再用 testing/fixtures.mjs 的夹具——
 * 夹具证的是合同本身，真载体证的是「合同跑得起一个能读能写的小说板块」。
 */

async function novelProject(label, { primaryCarrier = NOVEL_CARRIER_ID, extraEnabled = [], plugins = BUILT_IN_CARRIER_PLUGINS } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '小说载体靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of plugins) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '小说载体靶子', primaryCarrier, registry, extraEnabled })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  return { workspace, root, registry, created, opened, runtime }
}

test('真清单过内核校验：认领的都是内核已有的名字，板块都在小说骨架里', () => {
  const validated = validateCarrierManifest(NOVEL_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  const claimed = NOVEL_CARRIER.tools.filter((name) => kernel.has(name))
  assert.deepEqual(claimed, ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_outline_read'], '认领＝同名接管，不虚增工具面')
  for (const dir of Object.values(NOVEL_CARRIER.dataDirs)) {
    assert.ok(PROJECT_KINDS.novel.includes(dir), `载体目录「${dir}」必须落在固化小说骨架里`)
  }
  assert.deepEqual(validated.value.context.providers, ['selection', 'outline'], 'providers 必须写上下文块的种类名，运行时按名字找提供者')
  assert.equal(NOVEL_CARRIER.primary.contextProfile, 'writing-chapter', '上下文档案名要对齐 shared/agentContextProfiles')
})

test('工具面聚合：启用小说后面是 26 个工具，三个只读名归属载体，声明无实现的绝不虚列', async () => {
  const { workspace, registry, runtime } = await novelProject('carrier-surface')
  try {
    const started = await runtime.start()
    assert.equal(started.ok, true, JSON.stringify(started.error ?? {}))
    assert.equal(started.value.toolCount, 26, '19 内核 ＋ 载体自有七把：正文 pinax_chapter_save、大纲 pinax_outline_save（工单B2）、构思这对 pinax_notes_list/pinax_notes_save（工单B1）与提案三把（工单A；断言同步，裁定 dwfq-f2369ffa-1/3 口径）')
    assert.equal(started.value.aggregatedSurface, true)
    assert.deepEqual(runtime.surfaceInfo().carrierToolNames.sort(), [...NOVEL_TOOL_NAMES].sort())

    const names = runtime.listTools().map((tool) => tool.name)
    assert.equal(names.filter((name) => name === 'pinax_chapter_list').length, 1, '同名工具去重，载体接管不重复列')
    assert.equal(runtime.ownerOf('pinax_chapter_list'), NOVEL_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_project_list'), 'kernel')

    // 载体确实接住了调用：不传 projectPath 也能列出章节（内核那份必须要项目参数）。
    const listed = await runtime.callTool('pinax_chapter_list', {})
    assert.equal(listed.value.owner, NOVEL_CARRIER_ID)
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.deepEqual(listed.value.payload.chapters, [])

    const report = toolOwnershipReport(registry)
    assert.equal(report.claimed.length, 5, '小说 3 把只读 ＋ 设定 2 把只读（认领面按已安装的清单算，不看启用开关）')
    assert.equal(report.unclaimed.length, 14, 'M2 起未认领清单必须往下走')
    assert.deepEqual(report.declaredOutsideKernel, ['pinax_chapter_save', 'pinax_outline_save', 'pinax_notes_list', 'pinax_notes_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard', 'pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save', 'pinax_document_list', 'pinax_document_read', 'pinax_document_save', 'pinax_reference_search'], '工单A2 起设定板块有了自有写入口；工单B1 构思这对、工单B2 大纲写半边、工单A 提案三把、工单E2 约束这对、工单G1 资料三把、工单H2 资料检索（内核没有同名）也是自有名字（断言同步）')
    assert.deepEqual(report.withoutImplementation, [], '小说声明的名字都得有实现')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('保存→读回→列表：修订号一路对上；既有文件不许用 0 盲写', async () => {
  const { workspace, root, runtime } = await novelProject('carrier-save')
  try {
    await runtime.start()
    const created = await runtime.callTool('pinax_chapter_save', {
      title: '第001章-入场',
      text: '雨从檐口滴下来。',
      expectedRevision: 0
    })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.created, true)
    assert.equal(created.value.payload.revision, 1)
    assert.equal(created.value.payload.file, '正文/第001章-入场.md')
    assert.match(await readFile(join(root, '正文', '第001章-入场.md'), 'utf-8'), /雨从檐口滴下来/)

    // 作者原稿保护：磁盘上已有这个文件，再拿 0 来写必须是并发拒绝，而不是静默覆盖。
    const blind = await runtime.callTool('pinax_chapter_save', { file: '正文/第001章-入场.md', text: '被推翻的写法', expectedRevision: 0 })
    assert.equal(blind.value.payload.ok, false)
    assert.equal(blind.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.equal(blind.value.payload.details.actual, 1)
    assert.match(await readFile(join(root, '正文', '第001章-入场.md'), 'utf-8'), /雨从檐口滴下来/, '拒绝后磁盘内容不动')

    const read = await runtime.callTool('pinax_chapter_read', { index: 0 })
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload))
    assert.equal(read.value.payload.revision, 1)
    assert.equal(read.value.payload.text, '雨从檐口滴下来。')
    assert.equal(read.value.payload.truncated, false)

    const updated = await runtime.callTool('pinax_chapter_save', {
      file: read.value.payload.chapter.file,
      text: '雨从檐口滴下来，巷子里没人。',
      expectedRevision: read.value.payload.revision
    })
    assert.equal(updated.value.payload.ok, true, JSON.stringify(updated.value.payload))
    assert.equal(updated.value.payload.revision, 2)
    assert.equal(updated.value.payload.created, false)

    const listed = await runtime.callTool('pinax_chapter_list', { limit: 10 })
    assert.equal(listed.value.payload.total, 1)
    assert.deepEqual(listed.value.payload.chapters.map((item) => [item.title, item.revision]), [['第001章-入场', 2]])

    const byTitle = await runtime.callTool('pinax_chapter_read', { title: '入场', maxChars: 1000 })
    assert.equal(byTitle.value.payload.ok, true)
    assert.equal(byTitle.value.payload.matchedBy, 'title-contains')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('构思速记（工单B1）：列表连正文带回，保存带修订号落盘；盲写与非 .md、空 text 都拒', async () => {
  const { workspace, root, runtime } = await novelProject('carrier-notes')
  try {
    await runtime.start()
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
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('提案三把（工单A）：列出／读回／弃用；采纳在 chapter_save 成功后把提案标成 adopted', async () => {
  const { workspace, root, runtime, opened } = await novelProject('carrier-proposals')
  try {
    await runtime.start()
    // 空目录先列一次：0 条提案，raw 也为空，不谎报。
    const empty = await runtime.callTool('pinax_proposal_list', {})
    assert.equal(empty.value.payload.ok, true, JSON.stringify(empty.value.payload))
    assert.equal(empty.value.payload.total, 0)
    assert.deepEqual(empty.value.payload.proposals, [])
    assert.deepEqual(empty.value.payload.raw, [])

    // 目标章与一份 pinax-proposal@1（种数据走 fileService.writeProposal：.pinax/ 是内核元数据）。
    const seeded = await runtime.callTool('pinax_chapter_save', { title: '第001章-入场', text: '雨从檐口滴下来。', expectedRevision: 0 })
    assert.equal(seeded.value.payload.ok, true, JSON.stringify(seeded.value.payload))
    const proposalPayload = {
      schema: 'pinax-proposal@1',
      id: '20261028T140000-ch0-abcdef12',
      origin: 'mcp',
      mode: 'review',
      status: 'proposed',
      project: { projectId: 'p-1', name: '小说载体靶子' },
      target: { index: 0, title: '第001章-入场', file: '正文/第001章-入场.md', chars: 8, revision: 'local-chapter:0:0' },
      content: '雨从檐口滴下来，巷子里没人。',
      contentChars: 14,
      note: '把巷子空出来',
      expert: null,
      requestId: 'req-1',
      createdAt: '2026-10-28T06:00:00.000Z'
    }
    const writtenProposal = await opened.value.fileService.writeProposal({ name: '提案-雨夜.json', text: JSON.stringify(proposalPayload, null, 2) })
    assert.equal(writtenProposal.ok, true, JSON.stringify(writtenProposal.error ?? {}))
    // 运行时轨的纯文本散件：只列名字与大小，不当成可审阅的提案。
    await opened.value.fileService.writeProposal({ name: '运行时-建议.md', text: '建议：先给一场雨。' })
    // 坏 JSON：跳过并计入 warnings，不把整栏拖垮。
    await opened.value.fileService.writeProposal({ name: '坏提案.json', text: '{ 不是 JSON' })

    const listed = await runtime.callTool('pinax_proposal_list', {})
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.equal(listed.value.payload.total, 1)
    const summary = listed.value.payload.proposals[0]
    assert.equal(summary.name, '提案-雨夜.json')
    assert.equal(summary.status, 'proposed')
    assert.equal(summary.target.title, '第001章-入场')
    assert.equal(summary.target.file, '正文/第001章-入场.md')
    assert.equal(summary.contentChars, 14)
    assert.equal(summary.createdAt, '2026-10-28T06:00:00.000Z')
    assert.equal(summary.note, '把巷子空出来')
    assert.deepEqual(listed.value.payload.raw.map((item) => [item.name, item.kind]), [['运行时-建议.md', 'raw']])
    assert.match(listed.value.payload.warnings.join('\n'), /坏提案\.json/)

    const read = await runtime.callTool('pinax_proposal_read', { name: '提案-雨夜.json' })
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload))
    assert.equal(read.value.payload.proposal.content, '雨从檐口滴下来，巷子里没人。')
    assert.equal(read.value.payload.proposal.schema, 'pinax-proposal@1')
    assert.equal(read.value.payload.name, '提案-雨夜.json')

    // 路径安全：带分隔符／「..」／空名的名字一律拒，不给出「按名字读项目里任意文件」的第二条路。
    for (const bad of ['../提案.json', 'a/提案.json', 'a\\提案.json', '..', '']) {
      const rejected = await runtime.callTool('pinax_proposal_read', { name: bad })
      assert.equal(rejected.value.payload.ok, false, bad)
      assert.equal(rejected.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT, bad)
    }
    const rawRead = await runtime.callTool('pinax_proposal_read', { name: '运行时-建议.md' })
    assert.equal(rawRead.value.payload.ok, false, '纯文本提案不进审阅面')
    assert.match(rawRead.value.payload.message, /不是 JSON 提案/)

    // 采纳：先读当前修订号，再走载体 save；成功后提案 status 写成 adopted，文件仍在。
    const current = await runtime.callTool('pinax_chapter_read', { file: '正文/第001章-入场.md' })
    assert.equal(current.value.payload.revision, 1)
    const adopted = await runtime.callTool('pinax_chapter_save', {
      file: '正文/第001章-入场.md',
      text: read.value.payload.proposal.content,
      expectedRevision: current.value.payload.revision,
      proposal: '提案-雨夜.json'
    })
    assert.equal(adopted.value.payload.ok, true, JSON.stringify(adopted.value.payload))
    assert.equal(adopted.value.payload.revision, 2)
    assert.deepEqual(adopted.value.payload.proposal, { name: '提案-雨夜.json', status: 'adopted' })
    assert.match(await readFile(join(root, '正文', '第001章-入场.md'), 'utf-8'), /巷子里没人/)
    const afterAdopt = await runtime.callTool('pinax_proposal_read', { name: '提案-雨夜.json' })
    assert.equal(afterAdopt.value.payload.proposal.status, 'adopted', '采纳后状态写回 JSON，提案不删')
    assert.equal((await runtime.callTool('pinax_proposal_list', {})).value.payload.total, 1)

    // 修订号不符的采纳：正文不写、状态不动（STALE 由文件服务拒，外壳不做静默合并）。
    const staleAdopt = await runtime.callTool('pinax_chapter_save', {
      file: '正文/第001章-入场.md',
      text: '基于旧版的一笔',
      expectedRevision: 1,
      proposal: '运行时-建议.md'
    })
    assert.equal(staleAdopt.value.payload.ok, false)
    assert.equal(staleAdopt.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)

    // 弃用：删掉提案文件；正文一个字节不动。
    const discarded = await runtime.callTool('pinax_proposal_discard', { name: '提案-雨夜.json' })
    assert.equal(discarded.value.payload.ok, true, JSON.stringify(discarded.value.payload))
    assert.equal(discarded.value.payload.discarded, true)
    assert.equal(discarded.value.payload.name, '提案-雨夜.json')
    assert.equal((await runtime.callTool('pinax_proposal_list', {})).value.payload.total, 0)
    const again = await runtime.callTool('pinax_proposal_discard', { name: '提案-雨夜.json' })
    assert.equal(again.value.payload.ok, false)
    assert.equal(again.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(await readFile(join(root, '正文', '第001章-入场.md'), 'utf-8'), /巷子里没人/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('载体写不了别人的板块：越界路径、跨目录、非 .md 都拦在文件服务，不在载体里防', async () => {
  const { workspace, runtime, opened } = await novelProject('carrier-fence')
  try {
    await runtime.start()
    const escape = await runtime.callTool('pinax_chapter_save', { file: '../../../逃逸.md', text: 'x', expectedRevision: 0 })
    assert.equal(escape.value.payload.ok, false)
    assert.equal(escape.value.payload.code, NEXT_ERROR_CODES.PATH_OUTSIDE_PROJECT)

    const metadata = await runtime.callTool('pinax_chapter_save', { file: '../.pinax/偷写.md', text: 'x', expectedRevision: 0 })
    assert.equal(metadata.value.payload.ok, false)
    assert.equal(metadata.value.payload.code, NEXT_ERROR_CODES.PATH_OUTSIDE_PROJECT)

    const missingArgs = await runtime.callTool('pinax_chapter_save', { title: '没正文' })
    assert.equal(missingArgs.value.payload.ok, false)
    assert.equal(missingArgs.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    const notMarkdown = await runtime.callTool('pinax_chapter_save', { file: '正文/没有扩展名', text: 'x', expectedRevision: 0 })
    assert.equal(notMarkdown.value.payload.ok, false)
    assert.equal(notMarkdown.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    // 世界书不是小说的板块：归属闸（C3）先拒，跟它申请了什么 scope 无关。
    const foreign = await opened.value.fileService.write({ pluginId: NOVEL_CARRIER_ID, dir: '世界书', file: '偷.md', text: 'x', expectedRevision: 0 })
    assert.equal(foreign.ok, false)
    assert.equal(foreign.error.code, NEXT_ERROR_CODES.DIR_CONFLICT)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('大纲：结构化优先，只有散文稿时如实给警告，不凭空造节点', async () => {
  const { workspace, root, runtime, opened } = await novelProject('carrier-outline')
  try {
    await runtime.start()
    const empty = await runtime.callTool('pinax_outline_read', {})
    assert.equal(empty.value.payload.ok, false, '大纲目录空着就是没有大纲，不返回空节点冒充读到了')

    const written = await opened.value.fileService.write({
      pluginId: NOVEL_CARRIER_ID,
      dir: '大纲',
      file: 'outline.json',
      text: JSON.stringify({ nodes: [{ id: 'n1', title: '开场：雨夜进城' }, { id: 'n2', title: '第一折' }], edges: [{ from: 'n1', to: 'n2' }] }, null, 2),
      expectedRevision: 0
    })
    assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))

    const read = await runtime.callTool('pinax_outline_read', { maxNodes: 300 })
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload))
    assert.equal(read.value.payload.nodeTotal, 2)
    assert.deepEqual(read.value.payload.nodes.map((node) => node.id), ['n1', 'n2'])
    assert.equal(read.value.payload.warning, null)
    assert.match(await readFile(join(root, '大纲', 'outline.json'), 'utf-8'), /雨夜进城/)

    // 只有散文稿的第二种项目：警告要有，节点必须是空数组。
    const proseRoot = join(workspace.projects, '散文大纲靶子')
    const registry2 = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
    for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry2.install(plugin.manifest, plugin.impl, plugin.meta)
    const made = await createProject({ root: proseRoot, name: '散文大纲靶子', primaryCarrier: NOVEL_CARRIER_ID, registry: registry2 })
    assert.equal(made.ok, true, JSON.stringify(made.error ?? {}))
    const opened2 = await openProject({ root: proseRoot, registry: registry2 })
    await opened2.value.fileService.write({ pluginId: NOVEL_CARRIER_ID, dir: '大纲', file: '大纲.md', text: '第一卷：雨夜。', expectedRevision: 0 })
    const runtime2 = createAgentRuntime({ registry: registry2, fileService: opened2.value.fileService, view: opened2.value.view })
    await runtime2.start()
    const prose = await runtime2.callTool('pinax_outline_read', {})
    assert.equal(prose.value.payload.ok, true)
    assert.deepEqual(prose.value.payload.nodes, [])
    assert.match(prose.value.payload.warning, /未凭空生成节点树/)
    await runtime2.stop()
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('大纲保存（工单B2）：整份覆盖落盘、修订号递增；盲写与非法结构都拒', async () => {
  const { workspace, root, runtime, opened } = await novelProject('carrier-outline-save')
  try {
    await runtime.start()
    // 先种一份大纲（修订号 1）：保存口吃的是 read 给的那份文档。
    const seeded = await opened.value.fileService.write({
      pluginId: NOVEL_CARRIER_ID,
      dir: '大纲',
      file: 'outline.json',
      text: JSON.stringify({ nodes: [{ id: 'n1', title: '开场：雨夜进城', summary: '雪夜，柯秒进了城。' }], edges: [] }, null, 2),
      expectedRevision: 0
    })
    assert.equal(seeded.ok, true, JSON.stringify(seeded.error ?? {}))
    const read = await runtime.callTool('pinax_outline_read', {})
    assert.equal(read.value.payload.ok, true)
    assert.equal(read.value.payload.revision, 1)

    // 成功：改名＋加一节＋一条连线，整份 nodes 原样回传（summary 等其余字段保留）。
    const saved = await runtime.callTool('pinax_outline_save', {
      nodes: [{ id: 'n1', title: '开场：雨夜进城（改）', summary: '雪夜，柯秒进了城。' }, { id: 'n2', title: '第一折' }],
      edges: [{ from: 'n1', to: 'n2' }],
      expectedRevision: read.value.payload.revision
    })
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

    // 非法结构：缺 nodes、空 nodes、节点缺 title、节点不是对象、edges 不是数组、缺 expectedRevision。
    const noNodes = await runtime.callTool('pinax_outline_save', { expectedRevision: 2 })
    assert.equal(noNodes.value.payload.ok, false)
    assert.equal(noNodes.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    const emptyNodes = await runtime.callTool('pinax_outline_save', { nodes: [], expectedRevision: 2 })
    assert.equal(emptyNodes.value.payload.ok, false)
    assert.equal(emptyNodes.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    const noTitle = await runtime.callTool('pinax_outline_save', { nodes: [{ id: 'n1' }], expectedRevision: 2 })
    assert.equal(noTitle.value.payload.ok, false)
    assert.equal(noTitle.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    const badEdges = await runtime.callTool('pinax_outline_save', { nodes: [{ id: 'n1', title: 'x' }], edges: 'n1-n2', expectedRevision: 2 })
    assert.equal(badEdges.value.payload.ok, false)
    assert.equal(badEdges.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    const noRevision = await runtime.callTool('pinax_outline_save', { nodes: [{ id: 'n1', title: 'x' }] })
    assert.equal(noRevision.value.payload.ok, false)
    assert.equal(noRevision.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    // 首建：outline.json 还不存在时传 0 直接建档（工具对「两样都没有」回 INVALID_INPUT 之后的那条路）。
    const freshRoot = join(workspace.projects, '无大纲靶子')
    const registry2 = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
    for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry2.install(plugin.manifest, plugin.impl, plugin.meta)
    await createProject({ root: freshRoot, name: '无大纲靶子', primaryCarrier: NOVEL_CARRIER_ID, registry: registry2 })
    const opened2 = await openProject({ root: freshRoot, registry: registry2 })
    const runtime2 = createAgentRuntime({ registry: registry2, fileService: opened2.value.fileService, view: opened2.value.view })
    await runtime2.start()
    const created = await runtime2.callTool('pinax_outline_save', { nodes: [{ id: 'n1', title: '第一笔' }], expectedRevision: 0 })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.revision, 1)
    assert.match(await readFile(join(freshRoot, '大纲', 'outline.json'), 'utf-8'), /第一笔/)
    await runtime2.stop()
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('停用载体后工具面回落内核：面少一个名字，同名工具回到内核实现', async () => {
  const { workspace, root, registry, opened, runtime } = await novelProject('carrier-disable', {
    primaryCarrier: FIXTURE_SCRIPT.id,
    extraEnabled: [NOVEL_CARRIER_ID],
    plugins: [...BUILT_IN_CARRIER_PLUGINS, { manifest: FIXTURE_SCRIPT }]
  })
  try {
    await runtime.start()
    assert.equal(runtime.listTools().length, 26)
    assert.ok(opened.value.view.enabled.includes(NOVEL_CARRIER_ID))

    const disabled = await setCarrierEnabled({ root, registry, pluginId: NOVEL_CARRIER_ID, enabled: false, expectedRevision: opened.value.document.carriers.revision })
    assert.equal(disabled.ok, true, JSON.stringify(disabled.error ?? {}))
    const reopened = await openProject({ root, registry })
    assert.equal(reopened.ok, true, JSON.stringify(reopened.error ?? {}))
    assert.equal(reopened.value.view.enabled.includes(NOVEL_CARRIER_ID), false)

    const runtimeAfter = createAgentRuntime({ registry, fileService: reopened.value.fileService, view: reopened.value.view })
    await runtimeAfter.start()
    const names = runtimeAfter.listTools().map((tool) => tool.name)
    assert.equal(names.length, 19, '载体工具从面上下掉，内核 19 工具一个不少')
    assert.equal(names.includes('pinax_chapter_save'), false)
    assert.equal(runtimeAfter.ownerOf('pinax_chapter_list'), 'kernel', '停用＝回落内核，不拿停用者的 scope 卡人')

    const kernelAnswer = await runtimeAfter.callTool('pinax_chapter_list', {})
    assert.equal(kernelAnswer.value.owner, 'kernel')
    assert.equal(kernelAnswer.value.payload.ok, false, '内核那份要项目参数，这里如实失败')
    await runtimeAfter.stop()
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('没有项目（view 为空）时面就是内核 19 工具——空框架轨道不被真载体污染', async () => {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry.install(plugin.manifest, plugin.impl, plugin.meta)
  const runtime = createAgentRuntime({ registry })
  const started = await runtime.start()
  assert.equal(started.value.toolCount, 19)
  assert.equal(started.value.aggregatedSurface, false)
  assert.deepEqual(runtime.surfaceInfo().carrierToolNames, [])
  await runtime.stop()
})
