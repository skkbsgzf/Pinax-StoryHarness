#!/usr/bin/env node
/* eslint-disable no-console */
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { createProject, initBareProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { buildRuntimeEnvelope } from '../runtime/contextProfiles.mjs'
import { BUILT_IN_CARRIER_PLUGINS, COMIC_CARRIER_ID, EXPERIENCE_CARRIER_ID, MATERIAL_CARRIER_ID, NOTES_CARRIER_ID, NOVEL_CARRIER_ID, ONLINE_CARRIER_ID, OUTLINE_CARRIER_ID, REFERENCE_CARRIER_ID, SCRIPT_CARRIER_ID, SETTING_CARRIER_ID, VIDEO_CARRIER_ID, WORLDBOOK_CARRIER_ID } from '../carriers/index.mjs'
import { FIXTURE_NOVEL } from './fixtures.mjs'
import { probePort } from './harness.mjs'

/**
 * 验收跑（M1 空框架清单 ①–⑦ ＋ M2 真载体清单 ⑧–⑭），verify:next 链上的真门禁。
 * 全部在 os.tmpdir() 的隔离目录里跑：绝不碰真实注册表、作者原稿，也不碰本机 3001/5173 服务。
 * 这里刻意不注入模型运行器：外壳主进程才装 runner，验收要保住「没接模型就如实报缺」这条失败路径。
 */
const results = []
const workspace = await mkdtemp(join(tmpdir(), 'pinax-next-accept-'))
process.env.PINAX_APP_DATA = join(workspace, 'appdata')
process.env.PINAX_MIRROR_ROOT = join(workspace, 'mirror')

function record(name, passed, note = '') {
  results.push({ name, passed, note })
  console.log(`${passed ? '✔' : '✘'} ${name}${note ? ` — ${note}` : ''}`)
}

try {
  // ① 不装任何插件也能建项目：磁盘上只出现 .pinax/
  const bareRoot = join(workspace, 'projects', '空框架裸项目')
  const created = await initBareProject({ root: bareRoot, name: '空框架裸项目' })
  const topDirs = created.ok ? await readdir(bareRoot) : []
  record('建项目：只有 .pinax/ 的裸项目可创建', created.ok === true && topDirs.join() === '.pinax', topDirs.join(' '))

  // ② 打开裸项目：停在「选主载体」，不崩、不猜
  const emptyRegistry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const opened = await openProject({ root: bareRoot, registry: emptyRegistry })
  record('打开裸项目：报主载体缺失而不是静默回落 novel',
    opened.ok === false && opened.error.code === 'PINAX_PRIMARY_CARRIER_MISSING',
    String(opened.error?.message || '').slice(0, 44))

  // ③ 运行时＝内置一级公民：不装插件也起得来
  const runtime = createAgentRuntime({ registry: emptyRegistry })
  const started = await runtime.start()
  record('运行时进主进程：in-process 列出 20 工具（内核 19 ＋ 技能读取）',
    started.ok === true && started.value.toolCount === 20,
    `toolCount=${started.value?.toolCount}`)

  // ④ 全程零端口：Express 那一层不需要存在
  record('全程零端口：39551 无监听（运行时不靠 HTTP 活着）', (await probePort(39551)) === false)

  // ⑤ 问一句话：M1 未接模型运行器时如实报缺失
  const answer = await runtime.ask('验收探针：这一章开场能再狠一点吗？')
  record('提问：无运行器时如实报 PINAX_DEPENDENCY_UNMET',
    answer.ok === false && answer.error.code === 'PINAX_DEPENDENCY_UNMET',
    String(answer.error?.message || '').slice(0, 36))
  await runtime.stop()

  // ⑥ 故障隔离：抢右栏的坏清单只挡自己，别人照常启用
  const mixed = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  mixed.install({ ...FIXTURE_NOVEL, id: 'fixture.bad', title: '坏清单（夹具）', panes: [{ slot: 'right', id: 'x', title: '抢右栏' }] })
  mixed.install(FIXTURE_NOVEL)
  const activated = mixed.activate({ primary: 'fixture.novel', enabled: ['fixture.novel', 'fixture.bad'] })
  record('故障隔离：坏清单被拒，外壳视图仍可启用',
    activated.ok === true && mixed.rejected.length === 1 && activated.value.enabled.length === 1,
    `rejected=${mixed.rejected[0]?.error?.code}`)

  // ⑦ 提案写回只进 .pinax/proposals/，正文目录一个字节不动
  const realRoot = join(workspace, 'projects', '提案靶子')
  const projectRegistry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  projectRegistry.install(FIXTURE_NOVEL)
  await createProject({ root: realRoot, name: '提案靶子', primaryCarrier: 'fixture.novel', registry: projectRegistry })
  const openedReal = await openProject({ root: realRoot, registry: projectRegistry })
  const runtimeReal = createAgentRuntime({ registry: projectRegistry, fileService: openedReal.value.fileService })
  await runtimeReal.start()
  const proposal = await runtimeReal.propose({ name: '验收提案.md', text: '验收用提案内容' })
  const manuscriptEntries = await readdir(join(realRoot, '正文'))
  const proposalOnDisk = await stat(join(realRoot, '.pinax', 'proposals', '验收提案.md')).then(() => true, () => false)
  record('提案写回：进 .pinax/proposals/，正文目录保持为空',
    proposal.ok === true && proposalOnDisk && manuscriptEntries.length === 0,
    `正文=${manuscriptEntries.length} 项`)
  await runtimeReal.stop()

  // ── M2 批次 1 起：真载体上盘后的验收（协议 v1.1-A 起是六栏：小说/大纲/构思/世界书/设定/资料）──────
  const carrierRoot = join(workspace, 'projects', '真载体靶子')
  const carrierRegistry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) carrierRegistry.install(plugin.manifest, plugin.impl, plugin.meta)
  const carrierMade = await createProject({ root: carrierRoot, name: '真载体靶子', primaryCarrier: NOVEL_CARRIER_ID, registry: carrierRegistry, extraEnabled: [OUTLINE_CARRIER_ID, NOTES_CARRIER_ID, WORLDBOOK_CARRIER_ID, SETTING_CARRIER_ID, REFERENCE_CARRIER_ID, SCRIPT_CARRIER_ID] })
  record('M2 建项目：主载体小说＋伴生五栏（大纲/构思/世界书/设定/资料），骨架目录全落盘',
    carrierMade.ok === true && (await readdir(carrierRoot)).includes('世界书') && (await readdir(carrierRoot)).includes('资料') && (await readdir(carrierRoot)).includes('大纲') && (await readdir(carrierRoot)).includes('构思'),
    carrierMade.ok ? '' : String(carrierMade.error?.message || ''))

  // 种数据直接落盘（隔离目录）：这些是项目的种子文件，不是面板写入；世界书／约束都有载体自有的写入口。
  await writeFile(join(carrierRoot, '正文', '第001章-入场.md'), '雨从檐口滴下来，巷子里没人。', 'utf-8')
  await writeFile(join(carrierRoot, '大纲', 'outline.json'), JSON.stringify({ nodes: [{ id: 'n1', title: '开场：雨夜进城' }], edges: [] }), 'utf-8')
  await writeFile(join(carrierRoot, '约束', '纪律.md'), '- 不许出现现代词\n- 每章 2000 字', 'utf-8')
  await writeFile(join(carrierRoot, '约束', '文风.md'), '短句为主，一拍一段。', 'utf-8')
  await writeFile(join(carrierRoot, '世界书', '人物·柯秒.md'), '---\nschemaVersion: 1\nid: kb-1\nname: 人物·柯秒\ntype: character\nkeys:\n  - 柯秒\n---\n\n冷穿越剧版主角，醒来在雪夜。', 'utf-8')

  const carrierOpened = await openProject({ root: carrierRoot, registry: carrierRegistry })
  const carrierRuntime = createAgentRuntime({ registry: carrierRegistry, fileService: carrierOpened.value.fileService, view: carrierOpened.value.view })
  const carrierStarted = await carrierRuntime.start()
  record('M2 聚合工具面：19 内核 ∪ 技能读取 1 ∪ 七载体声明＝39，其中 24 个名字由载体服务（5 接管＋19 自有），端口仍为 0（v1.1-A 拆栏不新增工具名：小说 正文写口＋删／改两把＋提案三把；大纲写半边；构思这对；世界书写口；约束这对；资料三把＋检索；剧本三把。批次46A：章节删除／重命名进面）',
    carrierStarted.ok === true
      && carrierStarted.value.toolCount === 39
      && carrierStarted.value.carrierTools === 24
      && [...carrierRuntime.surfaceInfo().carrierToolNames].sort().join() === ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_chapter_save', 'pinax_chapter_delete', 'pinax_chapter_rename', 'pinax_outline_read', 'pinax_outline_save', 'pinax_notes_list', 'pinax_notes_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard', 'pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save', 'pinax_script_list', 'pinax_script_read', 'pinax_script_save', 'pinax_document_list', 'pinax_document_read', 'pinax_document_save', 'pinax_reference_search'].sort().join()
      && carrierStarted.value.portsOpened === 0,
    `toolCount=${carrierStarted.value?.toolCount} carrierTools=${carrierStarted.value?.carrierTools}`)

  const chapterRead = await carrierRuntime.callTool('pinax_chapter_read', { index: 0 })
  const blindWrite = await carrierRuntime.callTool('pinax_chapter_save', { file: '正文/第001章-入场.md', text: '被推翻的写法', expectedRevision: 0 })
  const goodWrite = chapterRead.value.payload.ok
    ? await carrierRuntime.callTool('pinax_chapter_save', { file: '正文/第001章-入场.md', text: `${chapterRead.value.payload.text}作者改的一笔`, expectedRevision: chapterRead.value.payload.revision })
    : { value: { payload: { ok: false } } }
  const chapterOnDisk = await readFile(join(carrierRoot, '正文', '第001章-入场.md'), 'utf-8')
  record('M2 保存闸：未记账的既有稿不许盲写（STALE_REVISION），带修订号才落盘',
    blindWrite.value.payload.ok === false
      && blindWrite.value.payload.code === NEXT_ERROR_CODES.STALE_REVISION
      && goodWrite.value.payload.ok === true
      && /作者改的一笔/.test(chapterOnDisk)
      && !/被推翻的写法/.test(chapterOnDisk),
    `盲写=${blindWrite.value.payload?.code} 正写=${goodWrite.value.payload?.revision ?? '-'}`)

  const worldbookList = await carrierRuntime.callTool('pinax_worldbook_list', {})
  // 工单E2（断言同步）：约束/ 升 rw 后，读写全走两把自有工具——list 把全文随手带回，save 带修订号落盘；
  // 覆写种子文件（expectedRevision 1→2，不新建文件），后面的写族闸 record 靠目录清单不变继续成立。
  const ruleList = await carrierRuntime.callTool('pinax_rule_list', {})
  const ruleSaved = await carrierRuntime.callTool('pinax_rule_save', {
    file: '约束/纪律.md',
    text: '- 不许出现现代词\n- 每章 2000 字\n- 作者在面板改的一笔',
    expectedRevision: 1
  })
  const rulesOnDisk = await readdir(join(carrierRoot, '约束'))
  // 工单A2（断言同步，调度方裁定 dwfq-f2369ffa-3）：世界书 rw 后，写经自有 pinax_worldbook_save 落盘——
  // 覆写种子文件（expectedRevision 1→2，不新建文件），后面的写族闸 record 靠目录清单不变继续成立。
  const worldbookSaved = await carrierRuntime.callTool('pinax_worldbook_save', { path: '世界书/人物·柯秒.md', text: '冷穿越剧版主角，醒来在雪夜。作者在面板改的一笔。', expectedRevision: 1 })
  record('M2 世界书与设定两栏：世界书 1 条读得到、经自有 save 落盘（1→2）；约束 2 份经自有 list 读回全文、save 落盘（1→2），不多建文件',
    worldbookList.value.payload.ok === true && worldbookList.value.payload.total === 1
      && worldbookList.value.owner === WORLDBOOK_CARRIER_ID
      && ruleList.value.payload.ok === true && ruleList.value.payload.total === 2
      && ruleList.value.owner === SETTING_CARRIER_ID
      && ruleList.value.payload.rules.every((rule) => typeof rule.text === 'string' && rule.text.length > 0)
      && ruleSaved.value.payload.ok === true && ruleSaved.value.payload.revision === 2
      && !rulesOnDisk.includes('载体想偷写.md')
      && worldbookSaved.value.payload.ok === true && worldbookSaved.value.payload.revision === 2,
    `条目=${worldbookList.value.payload?.total ?? '-'}（${worldbookList.value.owner}） 约束=${ruleList.value.payload?.total ?? '-'}（${ruleList.value.owner}） 存=${ruleSaved.value.payload?.revision ?? '-'}/${worldbookSaved.value.payload?.revision ?? '-'}`)

  const envelope = await buildRuntimeEnvelope({
    registry: carrierRegistry,
    view: carrierOpened.value.view,
    fileService: carrierOpened.value.fileService,
    question: '柯秒在雨夜进城那场，开场能不能再狠一点？'
  })
  const blockKinds = envelope.ok ? envelope.value.envelope.blocks.map((block) => block.kind) : []
  record('M2 上下文信封：五块齐（selection/outline/rules/style/worldbook）且走只读任务映射',
    envelope.ok === true && ['selection', 'outline', 'rules', 'style', 'worldbook'].every((kind) => blockKinds.includes(kind)) && /authoring\.review\./.test(envelope.value.taskType || ''),
    envelope.ok ? `blocks=${blockKinds.join(',')} task=${envelope.value.taskType}` : String(envelope.error?.message || ''))

  const noRunner = await carrierRuntime.ask('验收探针：这一章开场能再狠一点吗？')
  record('M2 仍不编回答：主进程之外的轨道（测试/验收）不注入 runner，照实报缺',
    noRunner.ok === false && noRunner.error.code === NEXT_ERROR_CODES.DEPENDENCY_UNMET,
    String(noRunner.error?.message || '').slice(0, 30))

  const proposalAfter = await carrierRuntime.propose({ name: 'M2提案.md', text: '建议：先给一场雨。' })
  const manuscriptAfter = await readdir(join(carrierRoot, '正文'))
  record('M2 装了载体后运行时的写回轨不变：提案进 .pinax/proposals/，正文不被运行时改动',
    proposalAfter.ok === true && manuscriptAfter.join() === '第001章-入场.md',
    `正文=${manuscriptAfter.join()}`)

  // ── M2 批次 2：内核写族闸——未认领的内核名字也不再是绕过板块的后门 ──────────────
  const dirsBefore = `${(await readdir(join(carrierRoot, '世界书'))).join()}|${(await readdir(join(carrierRoot, '约束'))).join()}`
  const guardSurface = carrierRuntime.surfaceInfo().writeGuard
  const byId = await carrierRuntime.callTool('pinax_worldbook_write', { projectId: 'nope', name: '按id找项目', content: 'x' })
  const claimedDir = await carrierRuntime.callTool('pinax_worldbook_write', { projectPath: carrierRoot, name: '面板偷写', content: 'x' })
  const claimedManuscript = await carrierRuntime.callTool('pinax_chapter_write', { projectPath: carrierRoot, title: '第002章-闸门', text: 'x' })
  // 工单E2：约束/ 有主人之后，内核 pinax_rule_write 必须被点名到载体自有的 pinax_rule_save。
  const claimedRule = await carrierRuntime.callTool('pinax_rule_write', { projectPath: carrierRoot, name: '纪律·闸门', content: 'x' })
  const structural = await carrierRuntime.callTool('pinax_project_init', { projectPath: join(workspace, 'projects', '闸门外的新项目'), name: '闸门外的新项目' })
  const dirsAfter = `${(await readdir(join(carrierRoot, '世界书'))).join()}|${(await readdir(join(carrierRoot, '约束'))).join()}`
  const outsideOnDisk = await stat(join(workspace, 'projects', '闸门外的新项目')).then(() => true, () => false)
  record('M2 写族闸：内核写族在真链路上被拒（按 id／认领目录／结构动作），磁盘与项目目录不变',
    guardSurface.tools.length === 7
      && guardSurface.projectRoot === carrierRoot
      && byId.value.owner === 'kernel' && byId.value.payload.ok === false && byId.value.payload.code === NEXT_ERROR_CODES.INVALID_INPUT
      && claimedDir.value.payload.ok === false && claimedDir.value.payload.code === NEXT_ERROR_CODES.SCOPE_NOT_GRANTED
      && claimedManuscript.value.payload.ok === false && /pinax_chapter_save/.test(String(claimedManuscript.value.payload.message || ''))
      && claimedRule.value.payload.ok === false && claimedRule.value.payload.code === NEXT_ERROR_CODES.SCOPE_NOT_GRANTED
      && /pinax_rule_save/.test(String(claimedRule.value.payload.message || ''))
      && structural.value.payload.ok === false && structural.value.payload.code === NEXT_ERROR_CODES.SCOPE_NOT_GRANTED
      && dirsAfter === dirsBefore && outsideOnDisk === false,
    `闸=${guardSurface.tools.length} 把 · 拒=${byId.value.payload?.code}/${claimedDir.value.payload?.code}/${claimedRule.value.payload?.code}/${structural.value.payload?.code} · 世界书+约束=${dirsAfter}`)
  await carrierRuntime.stop()
  record('M2 全程零端口：载体工具服务过一轮后 39551 与 3001 仍无监听',
    (await probePort(39551)) === false && (await probePort(3001)) === false)

  // ── 批次40：M4/M5 五块记录型载体（素材／漫画／视频／体验／联机）──────────────────
  // 它们共用一份 JSON 真源＋四把工具；体验的 requires(script.scenes) 由闭包自动带剧本。
  const recordsRoot = join(workspace, 'projects', '记录载体靶子')
  const recordsRegistry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) recordsRegistry.install(plugin.manifest, plugin.impl, plugin.meta)
  const recordsMade = await createProject({
    root: recordsRoot,
    name: '记录载体靶子',
    primaryCarrier: MATERIAL_CARRIER_ID,
    registry: recordsRegistry,
    extraEnabled: [COMIC_CARRIER_ID, VIDEO_CARRIER_ID, EXPERIENCE_CARRIER_ID, ONLINE_CARRIER_ID]
  })
  const recordsDirs = recordsMade.ok ? await readdir(recordsRoot) : []
  record('M4/M5 建项目：素材主载体＋漫画/视频/体验/联机四伴生，五块目录落盘；体验的依赖闭包自动带进剧本载体与 剧本/',
    recordsMade.ok === true
      && ['素材', '漫画', '视频', '体验', '联机', '剧本'].every((dir) => recordsDirs.includes(dir))
      && recordsMade.value.enabled.includes(SCRIPT_CARRIER_ID),
    recordsMade.ok ? `enabled=${recordsMade.value.enabled.join(',')}` : String(recordsMade.error?.message || ''))

  const recordsOpened = await openProject({ root: recordsRoot, registry: recordsRegistry })
  const recordsRuntime = createAgentRuntime({ registry: recordsRegistry, fileService: recordsOpened.value.fileService, view: recordsOpened.value.view })
  const recordsStarted = await recordsRuntime.start()
  record('M4/M5 聚合工具面：19 内核 ∪ 技能读取 1 ∪ 五块记录载体各四把＋剧本三把＝43，其中 23 个名字由载体服务',
    recordsStarted.ok === true && recordsStarted.value.toolCount === 43 && recordsStarted.value.carrierTools === 23,
    `toolCount=${recordsStarted.value?.toolCount} carrierTools=${recordsStarted.value?.carrierTools}`)

  const recordsEmpty = await recordsRuntime.callTool('pinax_material_list', {})
  const recordCreated = await recordsRuntime.callTool('pinax_material_save', {
    title: '雨夜参考图', type: 'reference-image', status: 'inbox', body: '巷口一盏灯，雨线斜着落。', tags: ['雨夜'], meta: { width: 1200 }, expectedRevision: 0
  })
  const recordId = recordCreated.value.payload?.record?.id
  const recordBlind = await recordsRuntime.callTool('pinax_material_save', { id: recordId, status: 'accepted', expectedRevision: 0 })
  const recordUpdated = await recordsRuntime.callTool('pinax_material_save', { id: recordId, status: 'accepted', expectedRevision: 1 })
  const recordRemoved = await recordsRuntime.callTool('pinax_material_remove', { id: recordId, expectedRevision: 2 })
  const recordDoc = JSON.parse(await readFile(join(recordsRoot, '素材', '素材.json'), 'utf-8'))
  record('M4/M5 记录底座：空文档 revision 0；新建 1→改 2→删 3；盲写被 STALE_REVISION 拒；未传字段保留；只删记录不删文件',
    recordsEmpty.value.payload.ok === true && recordsEmpty.value.payload.revision === 0
      && recordCreated.value.payload.ok === true && recordCreated.value.payload.revision === 1
      && recordBlind.value.payload.ok === false && recordBlind.value.payload.code === NEXT_ERROR_CODES.STALE_REVISION
      && recordUpdated.value.payload.ok === true && recordUpdated.value.payload.revision === 2
      && recordUpdated.value.payload.record.tags?.join() === '雨夜'
      && recordUpdated.value.payload.record.meta?.width === 1200
      && recordRemoved.value.payload.ok === true && recordRemoved.value.payload.revision === 3
      && recordDoc.schemaVersion === 1 && recordDoc.records.length === 0,
    `空=${recordsEmpty.value.payload?.revision} 建=${recordCreated.value.payload?.revision} 盲写=${recordBlind.value.payload?.code} 改=${recordUpdated.value.payload?.revision} 删=${recordRemoved.value.payload?.revision}`)

  // 另一块载体写的是另一份文档：互不串修订号。
  const comicSaved = await recordsRuntime.callTool('pinax_comic_save', { title: '第1页', type: 'comic-page', expectedRevision: 0 })
  const materialAfterComic = await recordsRuntime.callTool('pinax_material_list', {})
  record('M4/M5 一载体一文档：漫画写入落 漫画/漫画.json，素材文档修订号不受影响',
    comicSaved.value.payload.ok === true && comicSaved.value.payload.file === '漫画/漫画.json'
      && materialAfterComic.value.payload.file === '素材/素材.json' && materialAfterComic.value.payload.revision === 3,
    `漫画=${comicSaved.value.payload?.file}@${comicSaved.value.payload?.revision} 素材=${materialAfterComic.value.payload?.file}@${materialAfterComic.value.payload?.revision}`)

  await recordsRuntime.stop()

  const failed = results.filter((item) => !item.passed).length
  console.log(`\nM1 空框架＋M2 真载体验收：${results.length - failed}/${results.length} 通过`)
  process.exitCode = failed ? 1 : 0
} finally {
  await rm(workspace, { recursive: true, force: true, maxRetries: 3 })
}
