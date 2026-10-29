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
import { kernelToolNames } from '../runtime/mcpSurface.mjs'
import { readOnlyTaskForProfile } from '../runtime/contextProfiles.mjs'
import { AGENT_CONTEXT_PROFILES } from '../../shared/agentContextProfiles.js'
import { parseWorldbookEntryFile, serializeWorldbookEntryFile } from '../../shared/worldbookFileContract.js'
import {
  BUILT_IN_CARRIER_IDS,
  BUILT_IN_CARRIER_PLUGINS,
  SETTING_CARRIER_ID,
  WORLDBOOK_CARRIER,
  WORLDBOOK_CARRIER_ID,
  WORLDBOOK_TOOL_NAMES,
  readWorldbookEntries
} from '../carriers/index.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 协议 v1.1-A：世界书载体（世界书/）——从设定载体整块拆出来的独立一栏。
 * 工单A2 的自有写入口与批次21 C 的 meta 元数据口原样迁来；这里证五件事：
 * 清单过内核校验且读工具认领的都是内核已有的名字；读回形状与内核同名工具兼容；
 * 写世界书走带修订号的 save（契约条目只换正文、meta 只覆盖 keys/tags/summary）；
 * 世界书/ 与约束/ 分属两个主人；上下文块的取数口与工具同源。
 * 夹具目录在 os.tmpdir() 下，素材是工装种子文件（openProject 之前 raw writeFile），不碰作者原稿。
 */

async function worldbookProject(label, { fill = false, startRuntime = true } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '世界书载体靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '世界书载体靶子', primaryCarrier: WORLDBOOK_CARRIER_ID, registry })
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
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = startRuntime
    ? createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
    : null
  if (runtime) await runtime.start()
  return { workspace, root, registry, opened, runtime }
}

test('世界书真清单过校验：读工具是内核已有的只读名，世界书/ 申请 rw，档案认得 worldbook 块', () => {
  const validated = validateCarrierManifest(WORLDBOOK_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  assert.deepEqual(WORLDBOOK_CARRIER.tools, ['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save'])
  assert.deepEqual(WORLDBOOK_CARRIER.tools.filter((name) => kernel.has(name)), ['pinax_worldbook_list', 'pinax_worldbook_read'], '读工具只接管内核名字，不虚增工具面')
  assert.equal(kernel.has('pinax_worldbook_save'), false, 'save 是载体自有写入口（先例：小说的 pinax_chapter_save）')
  assert.deepEqual({ ...WORLDBOOK_CARRIER.dataDirs }, { entries: '世界书' })
  assert.deepEqual(WORLDBOOK_CARRIER.permissions, [{ type: 'file', dir: '世界书', mode: 'rw' }, 'agent:ask'], 'v2：只申请 世界书/ 一块目录的 rw；agent:ask 是运行时调用载体工具的前置授权')
  assert.deepEqual(WORLDBOOK_CARRIER.provides, ['setting.entries'])
  assert.deepEqual(WORLDBOOK_CARRIER.context, { providers: ['worldbook'], budgetChars: 20000 })
  assert.deepEqual(WORLDBOOK_CARRIER.contributes.panes.map((pane) => pane.id), ['worldbook.board', 'worldbook.entries'])
  assert.equal(WORLDBOOK_CARRIER.primary.projectKind, 'generic')
  assert.equal(WORLDBOOK_CARRIER.primary.defaultPane, 'worldbook.entries')
  const definition = readOnlyTaskForProfile(WORLDBOOK_CARRIER.primary.contextProfile)
  assert.ok(definition, `档案「${WORLDBOOK_CARRIER.primary.contextProfile}」在只读任务表里查不到，本板块当主载体时提问会报缺`)
  assert.ok(AGENT_CONTEXT_PROFILES[definition.contextProfile].blocks.includes('worldbook'), '档案不认 worldbook 块')
  assert.equal(BUILT_IN_CARRIER_IDS.includes(WORLDBOOK_CARRIER_ID), true, '随框架发布：注册表默认装得上这块板块')
  assert.deepEqual(WORLDBOOK_TOOL_NAMES, ['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save'])
})

test('工具面：世界书载体启用后三把工具进面、归属它；内核 pinax_worldbook_write 仍回落内核', async () => {
  const { workspace, runtime } = await worldbookProject('worldbook-surface')
  try {
    assert.deepEqual([...runtime.surfaceInfo().carrierToolNames].sort(), [...WORLDBOOK_TOOL_NAMES].sort())
    assert.equal(runtime.listTools().length, 21, '19 内核 ＋ 技能读取 1 ＋ 世界书自有 1 个新名字（worldbook_save）；list/read 是认领名不虚增')
    assert.equal(runtime.ownerOf('pinax_worldbook_list'), WORLDBOOK_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_worldbook_save'), WORLDBOOK_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_worldbook_write'), 'kernel', '内核那份写工具照旧不认领，写族闸点名走自有 save')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书读回：契约条目与裸 md 都读得到，list 给形状、read 给全文与修订号', async () => {
  const { workspace, runtime } = await worldbookProject('worldbook-read', { fill: true })
  try {
    const listed = await runtime.callTool('pinax_worldbook_list', {})
    assert.equal(listed.value.owner, WORLDBOOK_CARRIER_ID)
    assert.equal(listed.value.payload.ok, true, JSON.stringify(listed.value.payload))
    assert.equal(listed.value.payload.total, 3)
    assert.equal(listed.value.payload.projectRoot.replaceAll('\\', '/').endsWith('世界书载体靶子'), true)
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
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('本地化轨口径：只服务当前打开的项目，第二个路径与空参数一律拒', async () => {
  const { workspace, root, runtime } = await worldbookProject('worldbook-locale', { fill: true })
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

test('世界书保存（工单A2）：带上读到的修订号落盘，revision 递增且磁盘真的变了', async () => {
  const { workspace, root, opened, runtime } = await worldbookProject('worldbook-save', { fill: true })
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
    assert.equal(saved.value.owner, WORLDBOOK_CARRIER_ID, '写走载体自有的 save，不落回内核')
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
    const direct = await opened.value.fileService.read({ pluginId: WORLDBOOK_CARRIER_ID, dir: '世界书', file: '地点·钟楼.md' })
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
  const { workspace, runtime } = await worldbookProject('worldbook-stale', { fill: true })
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
  const { workspace, runtime } = await worldbookProject('worldbook-save-invalid', { fill: true })
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
  const { workspace, runtime } = await worldbookProject('worldbook-frontmatter', { fill: true })
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
  const { workspace, opened, runtime } = await worldbookProject('worldbook-meta', { fill: true })
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
    assert.equal(afterEntry.id, entry.id)
    assert.equal(afterEntry.name, entry.name)
    assert.equal(afterEntry.type, entry.type)
    assert.deepEqual(afterEntry.relations, entry.relations)
    assert.equal(afterEntry.contract, true)

    // 磁盘取证：summary 没有读取口，直接按同一对 parse/serialize 核 frontmatter 原文件。
    const direct = await opened.value.fileService.read({ pluginId: WORLDBOOK_CARRIER_ID, dir: '世界书', file: '人物·柯秒.md' })
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
    const thirdParsed = parseWorldbookEntryFile((await opened.value.fileService.read({ pluginId: WORLDBOOK_CARRIER_ID, dir: '世界书', file: '人物·柯秒.md' })).value.text)
    assert.equal(thirdParsed.entry.summary, '雨夜醒来的主角', '没给 summary 也保持原值')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书元数据（工单C）：裸 md 与新建提供 meta 即 INVALID_INPUT，盘上一个字节不动', async () => {
  const { workspace, opened, runtime } = await worldbookProject('worldbook-meta-reject', { fill: true })
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
    const still = await opened.value.fileService.read({ pluginId: WORLDBOOK_CARRIER_ID, dir: '世界书', file: '随手记.md' })
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
    const missing = await opened.value.fileService.read({ pluginId: WORLDBOOK_CARRIER_ID, dir: '世界书', file: '地点·钟楼.md' })
    assert.equal(missing.ok, false, '被拒的新建不许留半截文件')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书元数据（工单C）：非法 meta 一律 INVALID_INPUT（非数组／空串元素／summary 超 500 字／未知字段）', async () => {
  const { workspace, runtime } = await worldbookProject('worldbook-meta-invalid', { fill: true })
  try {
    const read = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    const entry = read.value.payload.entry
    const base = { path: entry.path, text: '一次都不该落盘的正文。', expectedRevision: entry.revision }

    for (const [label, meta] of [
      ['keys 不是数组', { keys: '柯秒' }],
      ['数组里有空白元素', { tags: ['主角', '   '] }],
      ['数组里有非字符串元素', { keys: ['柯秒', 42] }],
      ['summary 超 500 字', { summary: '长'.repeat(501) }],
      ['未知字段（id 不在口里）', { id: 'x' }],
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

test('一目录一主人：世界书/ 归世界书载体，设定载体写不进来；约束也不归世界书', async () => {
  const { workspace, opened } = await worldbookProject('worldbook-fence', { startRuntime: false })
  try {
    const own = await opened.value.fileService.write({ pluginId: WORLDBOOK_CARRIER_ID, dir: '世界书', file: '自己.md', text: 'x', expectedRevision: 0 })
    assert.equal(own.ok, true, JSON.stringify(own.error ?? {}))
    const foreign = await opened.value.fileService.write({ pluginId: SETTING_CARRIER_ID, dir: '世界书', file: '别人偷写.md', text: 'x', expectedRevision: 0 })
    assert.equal(foreign.ok, false)
    assert.equal(foreign.error.code, NEXT_ERROR_CODES.DIR_CONFLICT)
    const ruleDir = await opened.value.fileService.write({ pluginId: WORLDBOOK_CARRIER_ID, dir: '约束', file: '偷写.md', text: 'x', expectedRevision: 0 })
    assert.equal(ruleDir.ok, false, '约束归设定载体，世界书写不进')
    assert.equal(ruleDir.error.code, NEXT_ERROR_CODES.DIR_CONFLICT)
  } finally {
    await workspace.cleanup()
  }
})

test('世界书上下文块：取数口与工具同源；按提问命中排序；没绑定文件服务只记账', async () => {
  const { workspace, opened, registry } = await worldbookProject('worldbook-block', { fill: true })
  try {
    const impl = registry.impl(WORLDBOOK_CARRIER_ID)
    assert.equal(typeof impl?.blocks, 'function', '注册表里这块板块要有上下文块工厂')
    const material = await impl.blocks({ pluginId: WORLDBOOK_CARRIER_ID, fileService: opened.value.fileService }).worldbook({ question: '柯秒在雨夜进城' })
    assert.ok(material.blocks.length >= 1)
    assert.equal(material.blocks[0].kind, 'worldbook')
    assert.match(material.blocks[0].content, /人物·柯秒/, '提问点名的主角条目排在前面')
    assert.match(material.blocks[0].sourceRefs[0], /^worldbook:世界书\//)

    const sameSource = await readWorldbookEntries({ pluginId: WORLDBOOK_CARRIER_ID, fileService: opened.value.fileService })
    assert.equal(sameSource.entries.length, 3, '取数口与工具同源：三条都在')

    const absent = await impl.blocks({ pluginId: WORLDBOOK_CARRIER_ID, fileService: null }).worldbook({ question: '随便' })
    assert.deepEqual(absent.blocks, [])
    assert.match(absent.warnings.join('\n'), /取不到/)
  } finally {
    await workspace.cleanup()
  }
})

/**
 * 探针：把一条带 links ＋ relations 的契约条目直接落盘（工装目录，不碰作者原稿）。
 * 关系边故意带 src（旧数据里的来源证明），用来证「读回来归一掉 src、保存时它也不收」。
 */
async function seedRelationEntry(opened) {
  const written = await opened.value.fileService.write({
    pluginId: WORLDBOOK_CARRIER_ID,
    dir: '世界书',
    file: '地点·钟楼.md',
    text: serializeWorldbookEntryFile({
      id: 'wb-hub-3',
      name: '地点·钟楼',
      type: 'location',
      keys: ['钟楼'],
      tags: ['地标'],
      links: ['wb-char-1', 'wb-place-2', 'wb-extra'],
      relations: [{ to: 'wb-char-1', type: 'event', stance: '目击', covert: true, weight: 2, src: 'declared' }],
      content: '巷尾的钟楼，钟停在雨夜。'
    }),
    expectedRevision: 0
  })
  assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))
  return written.value.relativePath
}

test('世界书关系边（批次28 · 工单2a）：read 把 relations 归一成作者能编辑的五栏，没有就是空数组', async () => {
  const { workspace, opened, runtime } = await worldbookProject('worldbook-relations-read', { fill: true })
  try {
    await seedRelationEntry(opened)

    const read = await runtime.callTool('pinax_worldbook_read', { id: 'wb-hub-3' })
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload))
    assert.deepEqual(read.value.payload.entry.relations, [
      { to: 'wb-char-1', type: 'event', stance: '目击', covert: true, weight: 2 }
    ], 'src 是来源证明：读回来不带；其余五栏按原值给出')

    // frontmatter 里没有 relations：空数组，而不是「没读到」。
    const plain = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    assert.deepEqual(plain.value.payload.entry.relations, [])

    // 裸 md 也一样是空数组。
    const bare = await runtime.callTool('pinax_worldbook_read', { name: '随手记' })
    assert.equal(bare.value.payload.entry.contract, false)
    assert.deepEqual(bare.value.payload.entry.relations, [])

    // 列表把摘要也带回（表格视图那一列），但列表不背关系边（详情面才需要）。
    const listed = await runtime.callTool('pinax_worldbook_list', {})
    assert.equal(listed.value.payload.entries.some((entry) => entry.summary === undefined), false, '每条都要带 summary 字段')
    assert.equal('relations' in listed.value.payload.entries[0], false, '列表不带关系边：那是详情面的事')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书关系边（批次28 · 工单2a）：meta.relations 校验——合法上限放行，坏形状与 src 一律 INVALID_INPUT', async () => {
  const { workspace, runtime } = await worldbookProject('worldbook-relations-validate', { fill: true })
  try {
    const read = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    const entry = read.value.payload.entry
    const base = { path: entry.path, text: '一次都不该落盘的正文。', expectedRevision: entry.revision }

    for (const [label, relations] of [
      ['不是数组', { to: 'wb-place-2' }],
      ['超过 32 条', Array.from({ length: 33 }, (_item, index) => ({ to: `wb-${index}` }))],
      ['条目不是对象', ['wb-place-2']],
      ['缺 to', { type: '师徒' }],
      ['to 是空白串', { to: '   ' }],
      ['to 超 80 字', { to: '长'.repeat(81) }],
      ['type 超 32 字', { to: 'wb-place-2', type: '型'.repeat(33) }],
      ['stance 不是字符串', { to: 'wb-place-2', stance: 5 }],
      ['covert 不是布尔', { to: 'wb-place-2', covert: 'yes' }],
      ['weight 不是数字', { to: 'wb-place-2', weight: '2' }],
      ['src 是来源证明，不收', { to: 'wb-place-2', src: 'declared' }],
      ['陌生字段', { to: 'wb-place-2', note: '随手写的' }]
    ]) {
      const rejected = await runtime.callTool('pinax_worldbook_save', { ...base, meta: { relations } })
      assert.equal(rejected.value.payload.ok, false, label)
      assert.equal(rejected.value.payload.code, NEXT_ERROR_CODES.INVALID_INPUT, label)
    }
    // 拒的原因要说人话（不是一句「参数不对」）：src 那条要点名它为什么不在口里。
    const srcRejected = await runtime.callTool('pinax_worldbook_save', { ...base, meta: { relations: [{ to: 'wb-place-2', src: 'declared' }] } })
    assert.match(srcRejected.value.payload.message, /src/)

    // 全被拒：盘上版本与正文都没动。
    const reread = await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })
    assert.equal(reread.value.payload.entry.revision, entry.revision)
    assert.match(reread.value.payload.entry.content, /停摆的表/)
    assert.doesNotMatch(reread.value.payload.entry.content, /一次都不该落盘/)

    // 边界合法：32 条、to 恰 80 字、type 恰 32 字、空串 type 当作没填。
    const boundary = await runtime.callTool('pinax_worldbook_save', {
      ...base,
      text: '关系边界的一笔。',
      meta: {
        relations: [
          { to: '长'.repeat(80), type: '型'.repeat(32), stance: '中立', covert: false, weight: 1 },
          ...Array.from({ length: 30 }, (_item, index) => ({ to: `wb-edge-${index}` })),
          { to: 'wb-place-2', type: '  ' }
        ]
      }
    })
    assert.equal(boundary.value.payload.ok, true, JSON.stringify(boundary.value.payload))
    const boundaryEntry = (await runtime.callTool('pinax_worldbook_read', { id: 'wb-char-1' })).value.payload.entry
    assert.equal(boundaryEntry.relations.length, 32)
    assert.equal(boundaryEntry.relations[0].to.length, 80)
    assert.equal('type' in boundaryEntry.relations[0], true)
    assert.equal(boundaryEntry.relations[0].covert, undefined, 'covert:false 不落空字段（省略即不是暗线）')
    assert.equal('type' in boundaryEntry.relations[31], false, '空串 type 当作没填，不落一个空字段')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('世界书关系边（批次28 · 工单2a）：保存后 frontmatter 往返无损——relations 进、再读出一致、links 去重不被破坏', async () => {
  const { workspace, opened, runtime } = await worldbookProject('worldbook-relations-roundtrip', { fill: true })
  try {
    const path = await seedRelationEntry(opened)
    const before = await runtime.callTool('pinax_worldbook_read', { name: '地点·钟楼' })
    assert.equal(before.value.payload.entry.path, path)

    const nextRelations = [
      { to: 'wb-place-2', type: '师徒', stance: '护着', covert: true, weight: 3 },
      { to: 'wb-hub-3', type: '敌对' }
    ]
    const saved = await runtime.callTool('pinax_worldbook_save', {
      path,
      text: '钟楼在雨夜里响了一声。',
      expectedRevision: before.value.payload.entry.revision,
      meta: { relations: nextRelations }
    })
    assert.equal(saved.value.payload.ok, true, JSON.stringify(saved.value.payload))
    assert.equal(saved.value.payload.revision, before.value.payload.entry.revision + 1)

    // 再读：关系整份换成新的，五栏原样带回。
    const after = await runtime.callTool('pinax_worldbook_read', { name: '地点·钟楼' })
    assert.deepEqual(after.value.payload.entry.relations, nextRelations)
    assert.equal(after.value.payload.entry.content, '钟楼在雨夜里响了一声。')

    // 磁盘取证：frontmatter 仍是契约条目，relations 是富关系层，links 是「纯 id 层 ∪ 关系目标」去重合成。
    const direct = await opened.value.fileService.read({ pluginId: WORLDBOOK_CARRIER_ID, dir: '世界书', file: '地点·钟楼.md' })
    assert.equal(direct.ok, true, JSON.stringify(direct.error ?? {}))
    const parsed = parseWorldbookEntryFile(direct.value.text)
    assert.equal(parsed.ok, true, '落盘仍是契约条目')
    assert.deepEqual(parsed.entry.relations, nextRelations, 'relations 进 frontmatter 再解析回来一字不差')
    assert.deepEqual(parsed.entry.links, ['wb-extra'], '纯 id 层只剩不重复于关系目标的那几条（wb-place-2 已并入关系层）')
    assert.equal(parsed.entry.id, 'wb-hub-3', 'id 没被 meta 洗掉')

    // 合成后的 links 行里每个目标只出现一次（∪ 去重）。
    const linksLine = direct.value.text.split('\n').find((line) => line.startsWith('links:'))
    assert.ok(linksLine, 'frontmatter 里要有 links 行')
    const targets = linksLine
      .replace(/^links:\s*/u, '')
      .split(',')
      .map((token) => token.trim().replace(/^['[]+|['\]]+$/gu, ''))
      .filter(Boolean)
    assert.equal(new Set(targets).size, targets.length, `links 有重复项：${linksLine}`)
    for (const id of ['wb-place-2', 'wb-extra', 'wb-hub-3']) {
      assert.equal(targets.filter((token) => token === id).length, 1, `${id} 在 links 里应恰好出现一次`)
    }
    // 原来只活在关系层里的 wb-char-1：那条关系被整份换掉后，它既不回 links 也不在 relations 里。
    assert.equal(targets.includes('wb-char-1'), false, '被换掉的那条关系不会残留成一条没有类型的关系')

    // 清空关系：传 [] 就是把富关系层清掉；纯 id 层只剩真正独立于关系的那些（wb-extra）。
    const cleared = await runtime.callTool('pinax_worldbook_save', {
      path,
      text: '钟楼不响了。',
      expectedRevision: after.value.payload.entry.revision,
      meta: { relations: [] }
    })
    assert.equal(cleared.value.payload.ok, true, JSON.stringify(cleared.value.payload))
    const clearedEntry = await runtime.callTool('pinax_worldbook_read', { name: '地点·钟楼' })
    assert.deepEqual(clearedEntry.value.payload.entry.relations, [])
    const clearedParsed = parseWorldbookEntryFile((await opened.value.fileService.read({ pluginId: WORLDBOOK_CARRIER_ID, dir: '世界书', file: '地点·钟楼.md' })).value.text)
    assert.deepEqual(clearedParsed.entry.links, ['wb-extra'], '关系整份清空后，只有关系层之外那条独立 links 留了下来')
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})
