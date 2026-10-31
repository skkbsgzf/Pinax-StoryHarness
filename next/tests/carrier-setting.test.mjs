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
import {
  BUILT_IN_CARRIER_PLUGINS,
  NOVEL_CARRIER_ID,
  SETTING_CARRIER,
  SETTING_CARRIER_ID,
  SETTING_TOOL_NAMES
} from '../carriers/index.mjs'
import { createSettingBlocks } from '../carriers/setting/context.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 协议 v1.1-A：设定载体瘦身为只管 约束/（世界书拆去 pinax.carrier.worldbook，自带 carrier-worldbook 测试）。
 * 证四件事：清单只认 约束/ 一块目录、两把工具都是载体自有名字；
 * 约束 rw 后可写、别的板块进不来；列表把全文随手带回；保存带修订号且盲写／非 .md／空 text 都拒。
 */

async function settingProject(label, { rules = null, startRuntime = true } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '设定载体靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '设定载体靶子', primaryCarrier: SETTING_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  if (rules) {
    // 约束（工单E2）：种子是 raw writeFile——未记账的既有文件按第 1 版采纳，读得到、改要带修订号。
    const dir = join(root, '约束')
    await mkdir(dir, { recursive: true })
    for (const [name, text] of Object.entries(rules)) await writeFile(join(dir, name), text, 'utf-8')
  }
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const runtime = startRuntime
    ? createAgentRuntime({ registry, fileService: opened.value.fileService, view: opened.value.view })
    : null
  if (runtime) await runtime.start()
  return { workspace, root, registry, opened, runtime }
}

test('设定真清单过校验：只剩 约束/ 一块目录，两把工具都是载体自有名字', () => {
  const validated = validateCarrierManifest(SETTING_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const kernel = new Set(kernelToolNames())
  assert.deepEqual(SETTING_CARRIER.tools, ['pinax_rule_list', 'pinax_rule_save'])
  assert.equal(SETTING_CARRIER.tools.every((name) => !kernel.has(name)), true, '两把都是载体自有（内核只有 pinax_rule_write，不认领）')
  assert.deepEqual({ ...SETTING_CARRIER.dataDirs }, { constraints: '约束' }, '协议 v1.1-A：世界书拆出后设定栏只剩约束一棵内容树')
  assert.deepEqual(SETTING_CARRIER.permissions, [{ type: 'file', dir: '约束', mode: 'rw' }, 'agent:ask'], 'v2：只申请 约束/ 一块目录的 rw；agent:ask 是运行时调用载体工具的前置授权')
  assert.deepEqual(validated.value.context.providers, ['rules', 'style'], 'providers 是上下文块种类名；worldbook 块随世界书载体迁出')
  assert.deepEqual(SETTING_CARRIER.provides, ['constraint.rules'])
  assert.deepEqual(SETTING_CARRIER.contributes.panes.map((pane) => pane.id), ['setting.board', 'setting.rules'])
  assert.equal(SETTING_CARRIER.primary.defaultPane, 'setting.rules')
  assert.equal(SETTING_CARRIER.title, '设定', '作者裁定：这一栏仍叫「设定」')
  for (const dir of Object.values(SETTING_CARRIER.dataDirs)) {
    assert.ok(PROJECT_KINDS.novel.includes(dir), `载体目录「${dir}」必须落在固化小说骨架里`)
  }
  assert.deepEqual(SETTING_TOOL_NAMES, ['pinax_rule_list', 'pinax_rule_save'])
})

test('工具面：设定载体启用后两把工具进面、归属它，内核 pinax_rule_write 仍回落内核', async () => {
  const { workspace, runtime } = await settingProject('setting-surface')
  try {
    assert.deepEqual([...runtime.surfaceInfo().carrierToolNames].sort(), [...SETTING_TOOL_NAMES].sort())
    assert.equal(runtime.listTools().length, 23, '19 内核 ＋ 技能读取 1 ＋ 服务日志读取 1 ＋ 设定自有 2')
    assert.equal(runtime.ownerOf('pinax_rule_list'), SETTING_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_rule_save'), SETTING_CARRIER_ID)
    assert.equal(runtime.ownerOf('pinax_rule_write'), 'kernel', '内核那把写工具照旧不认领，写族闸点名走自有 save')
    const tools = new Map(runtime.listTools().map((tool) => [tool.name, tool]))
    assert.equal(tools.get('pinax_rule_list').annotations.readOnlyHint, true)
    assert.equal(tools.get('pinax_rule_save').annotations.readOnlyHint, false)
  } finally {
    await runtime.stop()
    await workspace.cleanup()
  }
})

test('约束目录（工单E2）：设定载体 rw 后可写，别的板块照旧进不来', async () => {
  const { workspace, opened } = await settingProject('setting-rules-scope', { startRuntime: false })
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
  } finally {
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

test('约束上下文块：带文风字样的进 style 块、其余进 rules 块；世界书块已迁出本载体', async () => {
  const { workspace, opened } = await settingProject('setting-blocks', {
    rules: { '纪律.md': '- 不许出现现代词\n', '文风.md': '短句为主，一拍一段。\n' },
    startRuntime: false
  })
  try {
    const blocks = createSettingBlocks({ pluginId: SETTING_CARRIER_ID, fileService: opened.value.fileService })
    assert.deepEqual(Object.keys(blocks).sort(), ['rules', 'style'], '设定载体只提供 rules/style 两块')
    const rules = await blocks.rules()
    const style = await blocks.style()
    assert.deepEqual(rules.blocks.map((block) => block.kind), ['rules'])
    assert.match(rules.blocks[0].content, /纪律/)
    assert.doesNotMatch(rules.blocks[0].content, /文风/)
    assert.deepEqual(style.blocks.map((block) => block.kind), ['style'])
    assert.match(style.blocks[0].content, /短句为主/)

    // 没有文件服务：两块都只记 warning，不抛、不把整次提问翻成失败。
    const absent = createSettingBlocks({ pluginId: SETTING_CARRIER_ID, fileService: null })
    for (const kind of ['rules', 'style']) {
      const material = await absent[kind]()
      assert.deepEqual(material.blocks, [], kind)
      assert.match(material.warnings.join('\n'), /未绑定项目文件服务/, kind)
    }
  } finally {
    await workspace.cleanup()
  }
})
