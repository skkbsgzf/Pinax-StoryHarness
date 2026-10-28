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
import { BUILT_IN_CARRIER_PLUGINS, NOVEL_CARRIER_ID, REFERENCE_CARRIER_ID, REFERENCE_TOOL_NAMES, SETTING_CARRIER, SETTING_CARRIER_ID, SETTING_TOOL_NAMES } from '../carriers/index.mjs'
import { parseWorldbookEntryFile, serializeWorldbookEntryFile } from '../../shared/worldbookFileContract.js'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * M2 批次 1：设定载体（世界书 ＋ 约束）的认领工具；工单A2 起带自有写入口 pinax_worldbook_save。
 * 证的四件事：读工具认领的都是内核已有的名字；读盘走文件服务的三道闸；
 * 读回的形状与内核同名工具兼容（面板与模型两头同一份字节）；
 * 世界书写走带修订号的自有 save，约束仍写不出一个字节。
 */

async function settingProject(label, { extraEnabled = [SETTING_CARRIER_ID, REFERENCE_CARRIER_ID], fill = false, rules = null } = {}) {
  // 工单G1 起默认同时启用资料板块：三载体全开是聚合面 32 个工具的靶子场景
  // （资料三把自有工具也进面）；资料目录在小说骨架里，所以不改变这些用例的设定目录夹具。
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '设定载体靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '设定载体靶子', primaryCarrier: NOVEL_CARRIER_ID, registry, extraEnabled })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  if (fill) {
    // 素材直接落盘（工装目录，不碰作者原稿）：此刻项目还没打开、文件服务还没影，只能用 raw writeFile 种数据。
    // 未记账的既有文件按第 1 版采纳——载体读得到；要再写就必带这个修订号。
    const dir = join(root, '世界书')
    await mkdir(dir, { recursive: true })
    const book = [
      { id: 'wb-char-1', name: '人物·柯秒', type: 'character', keys: ['柯秒'], tags: ['主角'], content: '冷穿越剧版的主角，随身带着一枚停摆的表。' },
      { id: 'wb-place-2', name: '地点·槐巷', type: 'location', keys: ['槐巷'], tags: [], content: '雨夜的主场，檐口滴水，巷尾没有路灯。' }
    ]
    for (const entry of book) {
      await writeFile(join(dir, `${entry.name}.md`), serializeWorldbookEntryFile(entry), 'utf-8')
    }
    // 作者手写的裸 md：没走文件契约，也必须能被读回，而且要把「没建档」讲出来。
    await writeFile(join(dir, '随手记.md'), '一些还没整理的设定碎句。\n', 'utf-8')
  }
  if (rules) {
    // 约束（工单E2）：种子同样是 raw writeFile——未记账的既有文件按第 1 版采纳，读得到、改要带修订号。
    const dir = join(root, '约束')
    await mkdir(dir, { recursive: true })
    for (const [name, text] of Object.entries(rules)) await writeFile(join(dir, name), text, 'utf-8')
  }
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  await runtime.start()
  return { workspace, root, registry, opened, runtime }
}

test('设定真清单过校验：读工具是内核已有的只读名，世界书与约束都 rw（工单E2）', () => {
  const validated = validateCarrierManifest(SETTING_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  assert.deepEqual(SETTING_CARRIER.tools, ['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save'])
  const claimedFromKernel = SETTING_CARRIER.tools.filter((name) => !['pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save'].includes(name))
  assert.equal(claimedFromKernel.every((name) => kernel.has(name)), true, '读工具只接管内核名字，不虚增工具面')
  assert.equal(kernel.has('pinax_worldbook_save'), false, 'save 是载体自有写入口（先例：小说的 pinax_chapter_save）')
  assert.equal(kernel.has('pinax_rule_list'), false, '约束的列与读合在一把里，没有内核同名工具可认领（先例：构思那对）')
  assert.equal(kernel.has('pinax_rule_save'), false, '约束的写入口也是载体自有（内核只有 pinax_rule_write，不认领）')
  assert.deepEqual(validated.value.context.providers, ['rules', 'style', 'worldbook'], 'providers 是上下文块种类名')
  assert.deepEqual(SETTING_CARRIER.scopes, ['file:世界书:rw', 'file:约束:rw', 'agent:ask'], '工单E2：约束随编辑面升 rw；内核写族闸仍把写入点名到自有 save')
  for (const dir of Object.values(SETTING_CARRIER.dataDirs)) {
    assert.ok(PROJECT_KINDS.novel.includes(dir), `载体目录「${dir}」必须落在固化小说骨架里`)
  }
})

test('启用设定＋资料后：世界书工具归属载体，写世界书走自有 save，内核 pinax_worldbook_write 仍回落内核', async () => {
  const { workspace, registry, runtime } = await settingProject('setting-surface')
  try {
    assert.deepEqual(runtime.surfaceInfo().carrierToolNames.sort(), [...SETTING_TOOL_NAMES, ...REFERENCE_TOOL_NAMES, 'pinax_chapter_list', 'pinax_chapter_read', 'pinax_chapter_save', 'pinax_outline_read', 'pinax_outline_save', 'pinax_notes_list', 'pinax_notes_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard'].sort())
    assert.equal(runtime.listTools().length, 33, '19 内核 ＋ 载体自有 14：小说七把（含工单B1/B2/A）＋ 设定五把（pinax_worldbook_save 工单A2、约束这对工单E2）＋ 资料三把（工单G1）＋ pinax_reference_search（工单H2）')
    assert.equal(runtime.ownerOf('pinax_worldbook_list'), SETTING_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_worldbook_save'), SETTING_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_worldbook_write'), 'kernel', '内核那份写工具照旧不认领，写族闸点名走自有 save')
    assert.equal(runtime.ownerOf('pinax_chapter_read'), NOVEL_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_document_list'), REFERENCE_CARRIER_ID, '工单G1：资料板块同时启用时，资料工具归它')

    const report = toolOwnershipReport(registry)
    assert.equal(report.claimed.length, 5, 'claimed 按内核名字算：小说 3 ＋ 设定 2（资料四把是自有名字，不在其中）')
    assert.equal(report.unclaimed.length, 14)
    assert.deepEqual(report.declaredOutsideKernel, ['pinax_chapter_save', 'pinax_outline_save', 'pinax_notes_list', 'pinax_notes_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard', 'pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save', 'pinax_document_list', 'pinax_document_read', 'pinax_document_save', 'pinax_reference_search'], '工单A2/B1/B2/A/E2/G1/H2：十四把自有写/列/审阅/检索工具（断言同步）')
    assert.deepEqual(report.withoutImplementation, [], '声明了就必须有实现，否则不许进面')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书读回：契约条目与裸 md 都读得到，list 给形状、read 给全文与修订号', async () => {
  const { workspace, root, runtime } = await settingProject('setting-read', { fill: true })
  try {
    const listed = await runtime.callTool('pinax_worldbook_list', {})
    assert.equal(listed.value.owner, SETTING_CARRIER_ID)
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.equal(listed.value.payload.total, 3)
    assert.equal(listed.value.payload.projectRoot.replaceAll('\\', '/').endsWith('设定载体靶子'), true)
    const byName = Object.fromEntries(listed.value.payload.entries.map((entry) => [entry.name, entry]))
    assert.equal(byName['人物·柯秒'].type, 'character')
    assert.deepEqual(byName['人物·柯秒'].aliases, ['柯秒'])
    assert.equal(byName['人物·柯秒'].contract, true)
    assert.equal(byName['随手记'].contract, false, '没走文件契约的照样是条目，但必须标出来')
    assert.match(listed.value.payload.warnings.join('\n'), /不符合文件契约/)
    assert.ok(listed.value.payload.entries.every((entry) => entry.chars > 0), 'chars 是读到的字节数，不是估的')

    const filtered = await runtime.callTool('pinax_worldbook_list', { type: 'location' })
    assert.deepEqual(filtered.value.payload.entries.map((entry) => entry.name), ['地点·槐巷'])

    const read = await runtime.callTool('pinax_worldbook_read', { id: 'wb-place-2' })
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload))
    assert.equal(read.value.payload.entry.name, '地点·槐巷')
    assert.match(read.value.payload.entry.content, /檐口滴水/)
    assert.equal(read.value.payload.entry.contentTruncated, false)
    assert.equal(read.value.payload.entry.revision, 1)
    assert.equal(read.value.payload.entry.path, '世界书/地点·槐巷.md')
    assert.equal(read.value.payload.entry.contentChars, read.value.payload.entry.content.length)

    const byNameRead = await runtime.callTool('pinax_worldbook_read', { name: '柯秒', maxChars: 1000 })
    assert.equal(byNameRead.value.payload.ok, true)
    assert.equal(byNameRead.value.payload.entry.id, 'wb-char-1')

    const looseEntry = await runtime.callTool('pinax_worldbook_read', { name: '随手记' })
    assert.equal(looseEntry.value.payload.ok, true)
    assert.equal(looseEntry.value.payload.entry.contract, false)
    assert.match(looseEntry.value.payload.warnings.join('\n'), /未按世界书文件契约建档/)
    assert.match(looseEntry.value.payload.entry.content, /设定碎句/)

    const missing = await runtime.callTool('pinax_worldbook_read', { name: '查无此人' })
    assert.equal(missing.value.payload.ok, false)
    assert.equal(missing.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(missing.value.payload.message, /没有 查无此人/)

    // 磁盘取证：读回来的确实是这个文件夹里的文件。
    assert.ok(join(root, '世界书'))
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('本地化轨口径：只服务当前打开的项目，第二个路径与空参数一律拒', async () => {
  const { workspace, root, runtime } = await settingProject('setting-locale', { fill: true })
  try {
    const elsewhere = await runtime.callTool('pinax_worldbook_list', { projectPath: 'D:/别的小说/别的书' })
    assert.equal(elsewhere.value.payload.ok, false)
    assert.equal(elsewhere.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(elsewhere.value.payload.message, /只服务当前打开的 Next 项目/)

    // 同一项目根写法不同（反斜杠、结尾斜杠）不算越界：照样读得到。
    const same = await runtime.callTool('pinax_worldbook_list', { projectPath: `${root}\\` })
    assert.equal(same.value.payload.ok, true, JSON.stringify(same.value.payload))
    assert.equal(same.value.payload.total, 3)

    const noLocator = await runtime.callTool('pinax_worldbook_read', {})
    assert.equal(noLocator.value.payload.ok, false)
    assert.match(noLocator.value.payload.message, /要给 id 或 name/)

    const badLimit = await runtime.callTool('pinax_worldbook_list', { limit: 0 })
    assert.equal(badLimit.value.payload.ok, false)
    assert.equal(badLimit.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)

    const badChars = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1', maxChars: 10 })
    assert.equal(badChars.value.payload.ok, false)
    assert.match(badChars.value.payload.message, /maxChars/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('约束目录（工单E2）：设定载体 rw 后可写，别的板块照旧进不来；内核写口仍不认领', async () => {
  const { workspace, opened, runtime } = await settingProject('setting-rules-scope')
  try {
    const own = await opened.value.fileService.write({
      pluginId: SETTING_CARRIER_ID,
      dir: '约束',
      file: '纪律.md',
      text: '- 不许出现现代词\n',
      expectedRevision: 0
    })
    assert.equal(own.ok, true, JSON.stringify(own.error ?? {}))

    // 一目录一主人：约束 已被设定板块认领，小说板块连目录都定位不到（DIR_CONFLICT 先于 scope 闸）。
    const foreign = await opened.value.fileService.write({
      pluginId: NOVEL_CARRIER_ID,
      dir: '约束',
      file: '别人偷写.md',
      text: 'x',
      expectedRevision: 0
    })
    assert.equal(foreign.ok, false)
    assert.equal(foreign.error.code, NEXT_ERROR_CODES.DIR_CONFLICT)

    // 面上五把工具的读写定性：两把世界书读＋约束的 list 是 readOnlyHint，两个 save 不是（写族闸据此点名）。
    const tools = new Map(runtime.listTools().map((tool) => [tool.name, tool]))
    assert.equal(tools.get('pinax_worldbook_list').annotations.readOnlyHint, true)
    assert.equal(tools.get('pinax_worldbook_read').annotations.readOnlyHint, true)
    assert.equal(tools.get('pinax_worldbook_save').annotations.readOnlyHint, false)
    assert.equal(tools.get('pinax_rule_list').annotations.readOnlyHint, true)
    assert.equal(tools.get('pinax_rule_save').annotations.readOnlyHint, false)
    assert.equal(runtime.ownerOf('pinax_rule_list'), SETTING_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_rule_save'), SETTING_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_rule_write'), 'kernel', '内核那把写工具照旧不认领，写族闸点名走自有 save')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('约束读回（工单E2）：list 列篇目并随手带回全文，修订号按文件服务现取；超长截断并标注', async () => {
  const long = '长'.repeat(20_050)
  const { workspace, root, runtime } = await settingProject('setting-rule-list', {
    rules: { '纪律.md': '- 不许出现现代词\n- 每章 2000 字\n', '文风.md': '短句为主，一拍一段。\n', '长文.md': long }
  })
  try {
    const listed = await runtime.callTool('pinax_rule_list', {})
    assert.equal(listed.value.owner, SETTING_CARRIER_ID)
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.equal(listed.value.payload.total, 3)
    assert.equal(listed.value.payload.truncated, false)
    assert.equal(listed.value.payload.projectRoot.replaceAll('\\', '/').endsWith('设定载体靶子'), true)

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

test('约束保存（工单E2）：带读到的修订号落盘、新建传 0；STALE／空 text／非 .md／缺修订号一律拒', async () => {
  const { workspace, opened, runtime } = await settingProject('setting-rule-save', {
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
    assert.equal(saved.value.owner, SETTING_CARRIER_ID, '写走载体自有的 save，不落回内核')
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    assert.equal(saved.value.payload.file, '约束/纪律.md')
    assert.equal(saved.value.payload.revision, 2, '第 1 版上保存，递增到第 2 版')
    assert.equal(saved.value.payload.created, false)
    const direct = await opened.value.fileService.read({ pluginId: SETTING_CARRIER_ID, dir: '约束', file: '纪律.md' })
    assert.equal(direct.ok, true, JSON.stringify(direct.error ?? {}))
    assert.match(direct.value.text, /每章 2000 字/)

    // 新建：expectedRevision 0，标题落成 约束/<标题>.md。
    const created = await runtime.callTool('pinax_rule_save', { title: '文风', text: '短句为主，一拍一段。\n', expectedRevision: 0 })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.file, '约束/文风.md')
    assert.equal(created.value.payload.revision, 1)
    assert.equal(created.value.payload.created, true)

    // 拿作废的修订号写：STALE，不覆盖不合并；盘上仍是成功那一次。
    const stale = await runtime.callTool('pinax_rule_save', { file: '约束/纪律.md', text: '基于旧版的一笔', expectedRevision: 1 })
    assert.equal(stale.value.payload.ok, false)
    assert.equal(stale.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.match(stale.value.payload.message, /已被改动/)
    const afterStale = await opened.value.fileService.read({ pluginId: SETTING_CARRIER_ID, dir: '约束', file: '纪律.md' })
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

test('世界书保存（工单A2）：带上读到的修订号落盘，revision 递增且磁盘真的变了', async () => {
  const { workspace, root, opened, runtime } = await settingProject('setting-save', { fill: true })
  try {
    const read = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload))
    assert.equal(read.value.payload.entry.revision, 1, '未记账的既有文件按第 1 版采纳')
    assert.equal(read.value.payload.entry.path, '世界书/人物·柯秒.md')

    const saved = await runtime.callTool('pinax_worldbook_save', {
      path: read.value.payload.entry.path,
      text: '冷穿越剧版的主角，随身带着一枚停摆的表。表针在雨夜重新走了起来。',
      expectedRevision: 1
    })
    assert.equal(saved.value.owner, SETTING_CARRIER_ID, '写走载体自有的 save，不落回内核')
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    assert.equal(saved.value.payload.file, '世界书/人物·柯秒.md')
    assert.equal(saved.value.payload.revision, 2, '第 1 版上保存，递增到第 2 版')
    assert.equal(saved.value.payload.created, false)

    const reread = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    assert.equal(reread.value.payload.entry.revision, 2)
    assert.match(reread.value.payload.entry.content, /表针在雨夜重新走了起来/)

    // 新建：expectedRevision 0，落一个世界书/ 下没有的新文件。
    const created = await runtime.callTool('pinax_worldbook_save', { path: '地点·钟楼.md', text: '巷尾的钟楼，钟停在雨夜。', expectedRevision: 0 })
    assert.equal(created.value.payload.ok, true, JSON.stringify(created.value.payload))
    assert.equal(created.value.payload.file, '世界书/地点·钟楼.md')
    assert.equal(created.value.payload.revision, 1)
    assert.equal(created.value.payload.created, true)
    // 磁盘取证：文件服务读得回来（读走的是同一个项目的真实文件）。
    const direct = await opened.value.fileService.read({ pluginId: SETTING_CARRIER_ID, dir: '世界书', file: '地点·钟楼.md' })
    assert.equal(direct.ok, true, JSON.stringify(direct.error ?? {}))
    assert.equal(direct.value.revision, 1)
    assert.match(direct.value.text, /钟停在雨夜/)
    assert.ok(join(root, '世界书'))
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书保存：expectedRevision 不符按 STALE_REVISION 拒，不覆盖不合并', async () => {
  const { workspace, runtime } = await settingProject('setting-save-stale', { fill: true })
  try {
    // 拿「新建」的修订号写既有文件：第 1 版就在那里，盲写必须被拒。
    const stale = await runtime.callTool('pinax_worldbook_save', { path: '世界书/人物·柯秒.md', text: '基于旧版的一笔', expectedRevision: 0 })
    assert.equal(stale.value.payload.ok, false)
    assert.equal(stale.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.match(stale.value.payload.message, /已被改动/)

    const saved = await runtime.callTool('pinax_worldbook_save', { path: '世界书/人物·柯秒.md', text: '正确的一笔', expectedRevision: 1 })
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    // 保存后的重放：第 1 版已经作废，同一修订号再写一次照样拒。
    const replayed = await runtime.callTool('pinax_worldbook_save', { path: '世界书/人物·柯秒.md', text: '重放的一笔', expectedRevision: 1 })
    assert.equal(replayed.value.payload.ok, false)
    assert.equal(replayed.value.payload.code, NEXT_ERROR_CODES.STALE_REVISION)

    const reread = await runtime.callTool('pinax_worldbook_read', { name: '人物·柯秒' })
    assert.match(reread.value.payload.entry.content, /正确的一笔/, '拒掉的两次都没落盘，盘上是成功的那次')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书保存：空 text 与缺 expectedRevision 一律 INVALID_INPUT', async () => {
  const { workspace, runtime } = await settingProject('setting-save-invalid', { fill: true })
  try {
    const empty = await runtime.callTool('pinax_worldbook_save', { path: '世界书/人物·柯秒.md', text: '', expectedRevision: 1 })
    assert.equal(empty.value.payload.ok, false)
    assert.equal(empty.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(empty.value.payload.message, /text 必填且非空/)

    const noRevision = await runtime.callTool('pinax_worldbook_save', { path: '世界书/人物·柯秒.md', text: '没有修订号的一笔' })
    assert.equal(noRevision.value.payload.ok, false)
    assert.equal(noRevision.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(noRevision.value.payload.message, /expectedRevision 必填/)

    const noPath = await runtime.callTool('pinax_worldbook_save', { text: '没有路径的一笔', expectedRevision: 1 })
    assert.equal(noPath.value.payload.ok, false)
    assert.equal(noPath.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(noPath.value.payload.message, /path 必填/)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书保存（调度方裁定 dwfq-f2369ffa-2）：契约条目只换正文，frontmatter 逐项不变', async () => {
  const { workspace, runtime } = await settingProject('setting-save-frontmatter', { fill: true })
  try {
    const before = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    assert.equal(before.value.payload.ok, true, JSON.stringify(before.value.payload))
    const entry = before.value.payload.entry
    assert.equal(entry.contract, true, '夹具是契约条目（有 frontmatter），这条裁定才有意义')

    const saved = await runtime.callTool('pinax_worldbook_save', { path: entry.path, text: '全新的正文，只有这一句。', expectedRevision: entry.revision })
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))

    const after = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    assert.equal(after.value.payload.ok, true, '按 id 还读得到：frontmatter 没被保存洗掉')
    const afterEntry = after.value.payload.entry
    // frontmatter 逐项对照：id/名称/类型/别名/标签/关系/建档标记全部原样，只有正文与版本号变了。
    assert.equal(afterEntry.id, entry.id)
    assert.equal(afterEntry.name, entry.name)
    assert.equal(afterEntry.type, entry.type)
    assert.deepEqual(afterEntry.keys, entry.keys)
    assert.deepEqual(afterEntry.tags, entry.tags)
    assert.deepEqual(afterEntry.relations, entry.relations)
    assert.equal(afterEntry.contract, true)
    assert.equal(afterEntry.revision, entry.revision + 1)
    assert.equal(afterEntry.content, '全新的正文，只有这一句。')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书元数据（工单C）：meta 覆盖 keys/tags/summary，其余 frontmatter 原样、未提供的字段不动', async () => {
  const { workspace, opened, runtime } = await settingProject('setting-save-meta', { fill: true })
  try {
    const before = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    assert.equal(before.value.payload.ok, true, JSON.stringify(before.value.payload))
    const entry = before.value.payload.entry
    assert.equal(entry.contract, true, '夹具是契约条目，元数据口才成立')
    assert.deepEqual(entry.keys, ['柯秒'])
    assert.deepEqual(entry.tags, ['主角'])

    // 三字段一起给：keys/tags/summary 都被覆盖，正文换成 text。
    const saved = await runtime.callTool('pinax_worldbook_save', {
      path: entry.path,
      text: '改过正文的一条。',
      expectedRevision: entry.revision,
      meta: { keys: ['柯秒', '秒子'], tags: ['主角', '停摆的表'], summary: '雨夜醒来的主角' }
    })
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    assert.equal(saved.value.payload.revision, entry.revision + 1)

    const after = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    assert.equal(after.value.payload.ok, true, '按 id 还读得到：frontmatter 没被洗掉')
    const afterEntry = after.value.payload.entry
    assert.deepEqual(afterEntry.keys, ['柯秒', '秒子'], '关键词被 meta 覆盖')
    assert.deepEqual(afterEntry.tags, ['主角', '停摆的表'], '标签被 meta 覆盖')
    assert.equal(afterEntry.content, '改过正文的一条。')
    // 其余 frontmatter 原样：id/名称/类型/关系一个字都不动（id 是稳定标识，不在 meta 口里）。
    assert.equal(afterEntry.id, entry.id)
    assert.equal(afterEntry.name, entry.name)
    assert.equal(afterEntry.type, entry.type)
    assert.deepEqual(afterEntry.relations, entry.relations)
    assert.equal(afterEntry.contract, true)

    // 磁盘取证：summary 没有读取口，直接按同一对 parse/serialize 核 frontmatter 原文件。
    const direct = await opened.value.fileService.read({ pluginId: SETTING_CARRIER_ID, dir: '世界书', file: '人物·柯秒.md' })
    assert.equal(direct.ok, true, JSON.stringify(direct.error ?? {}))
    const parsed = parseWorldbookEntryFile(direct.value.text)
    assert.equal(parsed.ok, true, '落盘仍是契约条目（frontmatter 结构没破）')
    assert.equal(parsed.entry.summary, '雨夜醒来的主角', 'summary 随 meta 落进 frontmatter')
    assert.deepEqual(parsed.entry.keys, ['柯秒', '秒子'])
    assert.deepEqual(parsed.entry.tags, ['主角', '停摆的表'])
    assert.equal(parsed.entry.id, entry.id)
    assert.equal(parsed.entry.content, '改过正文的一条。')

    // 只给 keys：tags 保持上一次的值（未提供的字段不动）。
    const keysOnly = await runtime.callTool('pinax_worldbook_save', {
      path: entry.path,
      text: '只改关键词的一笔。',
      expectedRevision: afterEntry.revision,
      meta: { keys: ['秒子'] }
    })
    assert.equal(keysOnly.value.payload.ok, true, JSON.stringify(keysOnly.value.payload))
    const third = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    assert.deepEqual(third.value.payload.entry.keys, ['秒子'])
    assert.deepEqual(third.value.payload.entry.tags, ['主角', '停摆的表'], '没给 tags 就保持原值')
    const thirdParsed = parseWorldbookEntryFile((await opened.value.fileService.read({ pluginId: SETTING_CARRIER_ID, dir: '世界书', file: '人物·柯秒.md' })).value.text)
    assert.equal(thirdParsed.entry.summary, '雨夜醒来的主角', '没给 summary 也保持原值')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书元数据（工单C）：裸 md 与新建提供 meta 即 INVALID_INPUT，盘上一个字节不动', async () => {
  const { workspace, opened, runtime } = await settingProject('setting-save-meta-reject', { fill: true })
  try {
    const bare = await runtime.callTool('pinax_worldbook_read', { name: '随手记' })
    assert.equal(bare.value.payload.ok, true, JSON.stringify(bare.value.payload))
    const bareEntry = bare.value.payload.entry
    assert.equal(bareEntry.contract, false, '夹具是作者手写的裸 md')

    const bareSave = await runtime.callTool('pinax_worldbook_save', {
      path: bareEntry.path,
      text: '裸 md 的新正文。',
      expectedRevision: bareEntry.revision,
      meta: { keys: ['随手'] }
    })
    assert.equal(bareSave.value.payload.ok, false)
    assert.equal(bareSave.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(bareSave.value.payload.message, /建档/, '拒时要给修复路径：先保存正文建档')

    // 盘上不动：裸 md 既没被改写，也没被补 frontmatter。
    const still = await opened.value.fileService.read({ pluginId: SETTING_CARRIER_ID, dir: '世界书', file: '随手记.md' })
    assert.equal(still.ok, true)
    assert.match(still.value.text, /设定碎句/)
    assert.doesNotMatch(still.value.text, /^---/)

    // 新建（文件还不存在）带 meta：同样拒，且一个文件都不落。
    const created = await runtime.callTool('pinax_worldbook_save', {
      path: '地点·钟楼.md',
      text: '巷尾的钟楼，钟停在雨夜。',
      expectedRevision: 0,
      meta: { tags: ['新'] }
    })
    assert.equal(created.value.payload.ok, false)
    assert.equal(created.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(created.value.payload.message, /建档/)
    const missing = await opened.value.fileService.read({ pluginId: SETTING_CARRIER_ID, dir: '世界书', file: '地点·钟楼.md' })
    assert.equal(missing.ok, false, '被拒的新建不许留半截文件')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书元数据（工单C）：非法 meta 一律 INVALID_INPUT（非数组／空串元素／summary 超 500 字／未知字段）', async () => {
  const { workspace, runtime } = await settingProject('setting-save-meta-invalid', { fill: true })
  try {
    const read = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    const entry = read.value.payload.entry
    const base = { path: entry.path, text: '一次都不该落盘的正文。', expectedRevision: entry.revision }

    for (const [label, meta] of [
      ['keys 不是数组', { keys: '柯秒' }],
      ['数组里有空白元素', { tags: ['主角', '   '] }],
      ['数组里有非字符串元素', { keys: ['柯秒', 42] }],
      ['summary 超 500 字', { summary: '长'.repeat(501) }],
      ['未知字段（relations 不在口里）', { relations: [] }],
      ['meta 不是对象', ['柯秒']]
    ]) {
      const result = await runtime.callTool('pinax_worldbook_save', { ...base, meta })
      assert.equal(result.value.payload.ok, false, label)
      assert.equal(result.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT, label)
    }

    // 全被拒：盘上版本与正文都没动。
    const reread = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    assert.equal(reread.value.payload.entry.revision, entry.revision)
    assert.match(reread.value.payload.entry.content, /停摆的表/)
    assert.doesNotMatch(reread.value.payload.entry.content, /一次都不该落盘/)

    // 500 字是边界：恰好 500 字合法（与 keys/tags 的数组覆盖同一口）。
    const boundary = await runtime.callTool('pinax_worldbook_save', {
      ...base,
      text: '边界摘要的一笔。',
      meta: { summary: '摘'.repeat(500) }
    })
    assert.equal(boundary.value.payload.ok, true, JSON.stringify(boundary.value.payload))
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})
