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
 * 协议 v1.1-A 起小说栏只认 正文/：大纲与构思的自有测试搬去 carrier-outline / carrier-notes。
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

test('真清单过内核校验：小说只认领 正文/，认领的都是内核已有的名字', () => {
  const validated = validateCarrierManifest(NOVEL_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  const claimed = NOVEL_CARRIER.tools.filter((name) => kernel.has(name))
  assert.deepEqual(claimed, ['pinax_chapter_list', 'pinax_chapter_read'], '认领＝同名接管，不虚增工具面；大纲只读名随大纲载体迁出（v1.1-A）')
  assert.deepEqual({ ...NOVEL_CARRIER.dataDirs }, { manuscript: '正文' }, '协议 v1.1-A：小说栏只有正文一棵本域内容树')
  for (const dir of Object.values(NOVEL_CARRIER.dataDirs)) {
    assert.ok(PROJECT_KINDS.novel.includes(dir), `载体目录「${dir}」必须落在固化小说骨架里`)
  }
  assert.deepEqual(validated.value.context.providers, ['selection'], '大纲块随大纲载体迁出，小说只剩正文块')
  assert.equal(NOVEL_CARRIER.primary.contextProfile, 'writing-chapter', '上下文档案名要对齐 shared/agentContextProfiles')
  assert.deepEqual(NOVEL_CARRIER.permissions, [{ type: 'file', dir: '正文', mode: 'rw' }, 'agent:ask'], 'v2：文件权限走对象，agent:ask 仍按作用域串')
  assert.deepEqual(NOVEL_CARRIER.provides, ['text.chapters'])
  assert.deepEqual(NOVEL_CARRIER.contributes.panes.map((pane) => pane.id), ['novel.shelf', 'novel.editor'])
})

test('工具面聚合：启用小说后面是 23 个工具，两个只读名归属载体，声明无实现的绝不虚列', async () => {
  const { workspace, registry, runtime } = await novelProject('carrier-surface')
  try {
    const started = await runtime.start()
    assert.equal(started.ok, true, JSON.stringify(started.error ?? {}))
    assert.equal(started.value.toolCount, 24, '19 内核 ＋ 技能读取一把 ＋ 载体自有四把（正文 pinax_chapter_save 与提案三把）；两个认领名不虚增面')
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
    assert.equal(report.claimed.length, 5, '小说 2 把只读 ＋ 大纲 1 把只读 ＋ 世界书 2 把只读（认领面按已安装的清单算，不看启用开关）')
    assert.equal(report.unclaimed.length, 14, 'M2 起未认领清单必须往下走')
    assert.deepEqual(report.declaredOutsideKernel, ['pinax_chapter_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard', 'pinax_outline_save', 'pinax_notes_list', 'pinax_notes_save', 'pinax_worldbook_save', 'pinax_script_list', 'pinax_script_read', 'pinax_script_save', 'pinax_rule_list', 'pinax_rule_save', 'pinax_document_list', 'pinax_document_read', 'pinax_document_save', 'pinax_reference_search', 'pinax_material_list', 'pinax_material_read', 'pinax_material_save', 'pinax_material_remove', 'pinax_comic_list', 'pinax_comic_read', 'pinax_comic_save', 'pinax_comic_remove', 'pinax_video_list', 'pinax_video_read', 'pinax_video_save', 'pinax_video_remove', 'pinax_experience_list', 'pinax_experience_read', 'pinax_experience_save', 'pinax_experience_remove', 'pinax_online_list', 'pinax_online_read', 'pinax_online_save', 'pinax_online_remove'], '十二载体自有名字：正文写口＋提案三把（小说）、大纲写半边、构思这对、世界书写口、剧本三条（批次26）、约束这对、资料三把＋检索、M4/M5 五块记录载体各四把（断言同步）')
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

test('卷→章（工单B）：正文/ 下一级子目录＝卷，嵌套章进清单带 volume；嵌套章读／存都通', async () => {
  const { workspace, root, runtime } = await novelProject('carrier-volumes')
  try {
    await runtime.start()
    // 种两卷（中文数字命名，验证不是按拼音倒序）＋一个平铺章。
    await mkdir(join(root, '正文', '第一卷'), { recursive: true })
    await mkdir(join(root, '正文', '第二卷'), { recursive: true })
    await writeFile(join(root, '正文', '第一卷', '第001章-雨夜.md'), '雨夜。', 'utf-8')
    await writeFile(join(root, '正文', '第二卷', '第002章-雪夜.md'), '雪夜。', 'utf-8')
    await writeFile(join(root, '正文', '第000章-序.md'), '序。', 'utf-8')

    const listed = await runtime.callTool('pinax_chapter_list', { limit: 10 })
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.equal(listed.value.payload.total, 3)
    // 卷在前（按卷号：第一卷→第二卷），平铺章在后；每条带 volume（顶层为 null）。
    assert.deepEqual(listed.value.payload.chapters.map((item) => [item.file, item.volume]), [
      ['正文/第一卷/第001章-雨夜.md', '第一卷'],
      ['正文/第二卷/第002章-雪夜.md', '第二卷'],
      ['正文/第000章-序.md', null]
    ])
    assert.equal(listed.value.payload.chapters[0].title, '第001章-雨夜', '标题取文件名去扩展名，不带卷名')

    // 嵌套章读得回（此前只列顶层，基名＝相对路径才恰好没暴露；这里按 file 定位）。
    const read = await runtime.callTool('pinax_chapter_read', { file: '正文/第一卷/第001章-雨夜.md' })
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload))
    assert.equal(read.value.payload.text, '雨夜。')
    assert.equal(read.value.payload.chapter.title, '第001章-雨夜')

    // 嵌套章保存：带读到的修订号落盘，磁盘真的变了（write 的 locate/grant 对嵌套路径没被破坏）。
    const saved = await runtime.callTool('pinax_chapter_save', {
      file: '正文/第一卷/第001章-雨夜.md',
      text: '雨夜，巷子里没人。',
      expectedRevision: read.value.payload.revision
    })
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    assert.equal(saved.value.payload.revision, 2)
    assert.match(await readFile(join(root, '正文', '第一卷', '第001章-雨夜.md'), 'utf-8'), /巷子里没人/)

    // 盲写同一嵌套章仍被并发闸拒。
    const stale = await runtime.callTool('pinax_chapter_save', { file: '正文/第一卷/第001章-雨夜.md', text: '基于旧版的一笔', expectedRevision: 1 })
    assert.equal(stale.value.payload.ok, false)
    assert.equal(stale.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)

    // 新建也落在卷里（file 带子目录）。
    const created = await runtime.callTool('pinax_chapter_save', { file: '正文/第二卷/第003章-尾.md', text: '第三。', expectedRevision: 0 })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.file, '正文/第二卷/第003章-尾.md')
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

    // 大纲／构思／世界书都不是小说的板块（协议 v1.1-A：各有主人）：归属闸（C3）先拒，跟它申请了什么 scope 无关。
    for (const [dir, file] of [['大纲', '偷.json'], ['构思', '偷.md'], ['世界书', '偷.md']]) {
      const foreign = await opened.value.fileService.write({ pluginId: NOVEL_CARRIER_ID, dir, file, text: 'x', expectedRevision: 0 })
      assert.equal(foreign.ok, false, dir)
      assert.equal(foreign.error.code, NEXT_ERROR_CODES.DIR_CONFLICT, dir)
    }
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
    assert.equal(runtime.listTools().length, 24, '19 内核 ＋ 技能读取 1 ＋ 小说自有 4（停用后回落内核：只剩内核＋技能读取）')
    assert.ok(opened.value.view.enabled.includes(NOVEL_CARRIER_ID))

    const disabled = await setCarrierEnabled({ root, registry, pluginId: NOVEL_CARRIER_ID, enabled: false, expectedRevision: opened.value.document.carriers.revision })
    assert.equal(disabled.ok, true, JSON.stringify(disabled.error ?? {}))
    const reopened = await openProject({ root, registry })
    assert.equal(reopened.ok, true, JSON.stringify(reopened.error ?? {}))
    assert.equal(reopened.value.view.enabled.includes(NOVEL_CARRIER_ID), false)

    const runtimeAfter = createAgentRuntime({ registry, fileService: reopened.value.fileService, view: reopened.value.view })
    await runtimeAfter.start()
    const names = runtimeAfter.listTools().map((tool) => tool.name)
    assert.equal(names.length, 20, '载体工具从面上下掉，内核 19 工具＋技能读取一个不少')
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

test('没有项目（view 为空）时面就是内核 19 工具＋技能读取——空框架轨道不被真载体污染', async () => {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry.install(plugin.manifest, plugin.impl, plugin.meta)
  const runtime = createAgentRuntime({ registry })
  const started = await runtime.start()
  assert.equal(started.value.toolCount, 20)
  assert.equal(started.value.aggregatedSurface, false)
  assert.deepEqual(runtime.surfaceInfo().carrierToolNames, [])
  await runtime.stop()
})

test('章节标题剥排序前缀（批次34）：003-倒带 → 倒带，file 与排序仍按原名', async () => {
  const { workspace, root, runtime } = await novelProject('carrier-title-prefix')
  try {
    await runtime.start()
    await writeFile(join(root, '正文', '003-倒带.md'), '倒带。', 'utf-8')
    await writeFile(join(root, '正文', '010-进城.md'), '进城。', 'utf-8')
    await writeFile(join(root, '正文', '第001章-入场.md'), '入场。', 'utf-8')

    const listed = await runtime.callTool('pinax_chapter_list', { limit: 10 })
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    const byFile = Object.fromEntries(listed.value.payload.chapters.map((item) => [item.file, item.title]))
    // 只剥「1–3 位数字＋连字符」这一种前缀：第001章-入场 这种命名一个字都不改。
    assert.equal(byFile['正文/003-倒带.md'], '倒带')
    assert.equal(byFile['正文/010-进城.md'], '进城')
    assert.equal(byFile['正文/第001章-入场.md'], '第001章-入场')

    // file 保留原名：读写定位靠它，剥前缀不影响任何落盘路径。
    assert.deepEqual(listed.value.payload.chapters.map((item) => item.file).sort(), ['正文/003-倒带.md', '正文/010-进城.md', '正文/第001章-入场.md'].sort())

    // 剥过前缀的标题与原名都能定位到同一章（作者可能照文件名来点）。
    for (const title of ['倒带', '003-倒带']) {
      const read = await runtime.callTool('pinax_chapter_read', { title, maxChars: 1000 })
      assert.equal(read.value.payload.ok, true, `${title}：${JSON.stringify(read.value.payload)}`)
      assert.equal(read.value.payload.chapter.title, '倒带')
      assert.equal(read.value.payload.chapter.file, '正文/003-倒带.md')
      assert.equal(read.value.payload.text, '倒带。')
    }
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})
