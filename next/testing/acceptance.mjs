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
import { BUILT_IN_CARRIER_PLUGINS, NOVEL_CARRIER_ID, SETTING_CARRIER_ID } from '../carriers/index.mjs'
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
  record('运行时进主进程：in-process 列出 19 工具',
    started.ok === true && started.value.toolCount === 19,
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

  // ── M2 批次 1：真载体（小说＋设定）上盘后的验收 ───────────────────────────────
  const carrierRoot = join(workspace, 'projects', '真载体靶子')
  const carrierRegistry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) carrierRegistry.install(plugin.manifest, plugin.impl, plugin.meta)
  const carrierMade = await createProject({ root: carrierRoot, name: '真载体靶子', primaryCarrier: NOVEL_CARRIER_ID, registry: carrierRegistry, extraEnabled: [SETTING_CARRIER_ID] })
  record('M2 建项目：主载体小说＋伴生设定，骨架目录全落盘',
    carrierMade.ok === true && (await readdir(carrierRoot)).includes('世界书'),
    carrierMade.ok ? '' : String(carrierMade.error?.message || ''))

  // 素材直接落盘（隔离目录）：设定板块是只读板块，种数据只能从文件系统侧写。
  await writeFile(join(carrierRoot, '正文', '第001章-入场.md'), '雨从檐口滴下来，巷子里没人。', 'utf-8')
  await writeFile(join(carrierRoot, '大纲', 'outline.json'), JSON.stringify({ nodes: [{ id: 'n1', title: '开场：雨夜进城' }], edges: [] }), 'utf-8')
  await writeFile(join(carrierRoot, '约束', '纪律.md'), '- 不许出现现代词\n- 每章 2000 字', 'utf-8')
  await writeFile(join(carrierRoot, '约束', '文风.md'), '短句为主，一拍一段。', 'utf-8')
  await writeFile(join(carrierRoot, '世界书', '人物·柯秒.md'), '---\nschemaVersion: 1\nid: kb-1\nname: 人物·柯秒\ntype: character\nkeys:\n  - 柯秒\n---\n\n冷穿越剧版主角，醒来在雪夜。', 'utf-8')

  const carrierOpened = await openProject({ root: carrierRoot, registry: carrierRegistry })
  const carrierRuntime = createAgentRuntime({ registry: carrierRegistry, fileService: carrierOpened.value.fileService, view: carrierOpened.value.view })
  const carrierStarted = await carrierRuntime.start()
  record('M2 聚合工具面：19 内核 ∪ 载体声明＝20，其中 6 个名字由载体服务（5 接管＋1 自有），端口仍为 0',
    carrierStarted.ok === true
      && carrierStarted.value.toolCount === 20
      && carrierStarted.value.carrierTools === 6
      && [...carrierRuntime.surfaceInfo().carrierToolNames].sort().join() === ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_chapter_save', 'pinax_outline_read', 'pinax_worldbook_list', 'pinax_worldbook_read'].sort().join()
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
  const settingWrite = await carrierOpened.value.fileService.write({ pluginId: SETTING_CARRIER_ID, dir: '世界书', file: '载体想偷写.md', text: 'x', expectedRevision: 0 })
  const smuggled = await readdir(join(carrierRoot, '世界书'))
  record('M2 只读板块：世界书条目读得到（1 条），板块写盘被 SCOPE_NOT_GRANTED 拒且磁盘无新文件',
    worldbookList.value.payload.ok === true && worldbookList.value.payload.total === 1
      && worldbookList.value.owner === SETTING_CARRIER_ID
      && settingWrite.ok === false && settingWrite.error.code === NEXT_ERROR_CODES.SCOPE_NOT_GRANTED
      && !smuggled.includes('载体想偷写.md'),
    `条目=${worldbookList.value.payload?.total ?? '-'} 拒写=${settingWrite.error?.code}`)

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
  const structural = await carrierRuntime.callTool('pinax_project_init', { projectPath: join(workspace, 'projects', '闸门外的新项目'), name: '闸门外的新项目' })
  const dirsAfter = `${(await readdir(join(carrierRoot, '世界书'))).join()}|${(await readdir(join(carrierRoot, '约束'))).join()}`
  const outsideOnDisk = await stat(join(workspace, 'projects', '闸门外的新项目')).then(() => true, () => false)
  record('M2 写族闸：内核写族在真链路上被拒（按 id／认领目录／结构动作），磁盘与项目目录不变',
    guardSurface.tools.length === 7
      && guardSurface.projectRoot === carrierRoot
      && byId.value.owner === 'kernel' && byId.value.payload.ok === false && byId.value.payload.code === NEXT_ERROR_CODES.INVALID_INPUT
      && claimedDir.value.payload.ok === false && claimedDir.value.payload.code === NEXT_ERROR_CODES.SCOPE_NOT_GRANTED
      && claimedManuscript.value.payload.ok === false && /pinax_chapter_save/.test(String(claimedManuscript.value.payload.message || ''))
      && structural.value.payload.ok === false && structural.value.payload.code === NEXT_ERROR_CODES.SCOPE_NOT_GRANTED
      && dirsAfter === dirsBefore && outsideOnDisk === false,
    `闸=${guardSurface.tools.length} 把 · 拒=${byId.value.payload?.code}/${claimedDir.value.payload?.code}/${structural.value.payload?.code} · 世界书+约束=${dirsAfter}`)
  await carrierRuntime.stop()
  record('M2 全程零端口：载体工具服务过一轮后 39551 与 3001 仍无监听',
    (await probePort(39551)) === false && (await probePort(3001)) === false)

  const failed = results.filter((item) => !item.passed).length
  console.log(`\nM1 空框架＋M2 真载体验收：${results.length - failed}/${results.length} 通过`)
  process.exitCode = failed ? 1 : 0
} finally {
  await rm(workspace, { recursive: true, force: true, maxRetries: 3 })
}
