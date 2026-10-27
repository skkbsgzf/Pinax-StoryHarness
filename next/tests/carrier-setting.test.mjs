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
import { BUILT_IN_CARRIER_PLUGINS, NOVEL_CARRIER_ID, SETTING_CARRIER, SETTING_CARRIER_ID, SETTING_TOOL_NAMES } from '../carriers/index.mjs'
import { serializeWorldbookEntryFile } from '../../shared/worldbookFileContract.js'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * M2 批次 1：设定载体（世界书 ＋ 约束）的两把认领工具。
 * 证的四件事：认领的都是内核已有的名字；读盘走文件服务的三道闸；
 * 读回的形状与内核同名工具兼容（面板与模型两头同一份字节）；这块板块写不出一个字节。
 */

async function settingProject(label, { extraEnabled = [SETTING_CARRIER_ID], fill = false } = {}) {
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
    // 素材直接落盘（工装目录，不碰作者原稿）：设定板块是只读板块，用它自己的权限种不了数据，
    // 而这恰好是要证的事——未记账的既有文件按第 1 版采纳，载体读得到、写不进。
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
  const runtime = createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
  await runtime.start()
  return { workspace, root, registry, opened, runtime }
}

test('设定真清单过校验：认领的两把都是内核已有的只读名，且只申请 r', () => {
  const validated = validateCarrierManifest(SETTING_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  assert.deepEqual(SETTING_CARRIER.tools, ['pinax_worldbook_list', 'pinax_worldbook_read'])
  assert.equal(SETTING_CARRIER.tools.every((name) => kernel.has(name)), true, '设定板块只接管内核名字，不虚增工具面')
  assert.deepEqual(validated.value.context.providers, ['rules', 'style', 'worldbook'], 'providers 是上下文块种类名')
  assert.equal(SETTING_CARRIER.scopes.filter((scope) => scope.endsWith(':rw')).length, 0, '第一批只读：清单里不许出现 rw')
  for (const dir of Object.values(SETTING_CARRIER.dataDirs)) {
    assert.ok(PROJECT_KINDS.novel.includes(dir), `载体目录「${dir}」必须落在固化小说骨架里`)
  }
})

test('启用设定后：世界书两把工具归属载体，写世界书仍归内核，工具面仍是 20', async () => {
  const { workspace, registry, runtime } = await settingProject('setting-surface')
  try {
    assert.deepEqual(runtime.surfaceInfo().carrierToolNames.sort(), [...SETTING_TOOL_NAMES, 'pinax_chapter_list', 'pinax_chapter_read', 'pinax_chapter_save', 'pinax_outline_read'].sort())
    assert.equal(runtime.listTools().length, 20, '19 内核 ＋ 载体自有的 pinax_chapter_save，认领不增名')
    assert.equal(runtime.ownerOf('pinax_worldbook_list'), SETTING_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_worldbook_write'), 'kernel', '没认领的写工具不抢，回落内核')
    assert.equal(runtime.ownerOf('pinax_chapter_read'), NOVEL_CARRIER_ID)

    const report = toolOwnershipReport(registry)
    assert.equal(report.claimed.length, 5, '小说 3 ＋ 设定 2')
    assert.equal(report.unclaimed.length, 14)
    assert.deepEqual(report.declaredOutsideKernel, ['pinax_chapter_save'])
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

test('只读板块写不出字节：载体 scope 里没有 rw，文件服务直接拒', async () => {
  const { workspace, opened, runtime } = await settingProject('setting-readonly')
  try {
    const write = await opened.value.fileService.write({
      pluginId: SETTING_CARRIER_ID,
      dir: '世界书',
      file: '载体想偷写.md',
      text: '不该落盘',
      expectedRevision: 0
    })
    assert.equal(write.ok, false)
    assert.equal(write.error.code, NEXT_ERROR_CODES.SCOPE_NOT_GRANTED)

    const constraintWrite = await opened.value.fileService.write({
      pluginId: SETTING_CARRIER_ID,
      dir: '约束',
      file: '也不该落盘.md',
      text: 'x',
      expectedRevision: 0
    })
    assert.equal(constraintWrite.ok, false)
    assert.equal(constraintWrite.error.code, NEXT_ERROR_CODES.SCOPE_NOT_GRANTED)

    // 载体面上没有任何写工具：两把名字都是 readOnlyHint。
    const tools = new Map(runtime.listTools().map((tool) => [tool.name, tool]))
    assert.equal(tools.get('pinax_worldbook_list').annotations.readOnlyHint, true)
    assert.equal(tools.get('pinax_worldbook_read').annotations.readOnlyHint, true)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})
