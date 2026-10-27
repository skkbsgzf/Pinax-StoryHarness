import test from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import {
  FIXTURE_NOVEL,
  FIXTURE_SCRIPT,
  FIXTURE_WORLDBOOK,
  withMutation
} from '../testing/fixtures.mjs'

function buildRegistry(...manifests) {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const manifest of manifests) registry.install(manifest)
  return registry
}

test('装载后的启用集给出目录、槽位与工具归属', () => {
  const registry = buildRegistry(FIXTURE_NOVEL, FIXTURE_WORLDBOOK)
  const activation = registry.activate({ primary: 'fixture.novel', enabled: ['fixture.novel', 'fixture.worldbook'], revision: 1 })
  assert.equal(activation.ok, true, JSON.stringify(activation.error ?? {}))
  const view = activation.value
  assert.deepEqual(view.dirs.owned.sort(), ['世界书', '大纲', '正文', '构思'].sort())
  assert.deepEqual(view.dirs.skeleton, [...PROJECT_KINDS.novel])
  assert.equal(view.panes['left-dock'][0].pluginId, 'fixture.novel', '主载体的板块必须置顶')
  assert.equal(view.panes.center.length, 2)
  assert.deepEqual(view.tools.map((tool) => tool.name).sort(), ['chapter.read', 'chapter.write', 'outline.read', 'worldbook.list', 'worldbook.write'].sort())
  assert.equal(view.revision, 1)
})

test('D1/D2：没有主载体就拒绝，而不是猜一个 novel', () => {
  const registry = buildRegistry(FIXTURE_NOVEL)
  const activation = registry.activate({ primary: null, enabled: ['fixture.novel'] })
  assert.equal(activation.ok, false)
  assert.equal(activation.error.code, 'PINAX_PRIMARY_CARRIER_MISSING')
  assert.match(activation.error.message, /不猜、不回落|请先选择/)
})

test('作者口径：一个板块一块文件夹，两个板块抢同一目录即拒', () => {
  const squatter = withMutation(FIXTURE_WORLDBOOK, (m) => {
    m.id = 'fixture.squatter'
    m.title = '抢地盘的（夹具）'
    m.dataDirs = { entries: '正文' }
    m.scopes = ['file:正文:rw']
    m.capabilities = ['lexicon.rules']
    m.tools = ['lexicon.read']
  })
  const registry = buildRegistry(FIXTURE_NOVEL, squatter)
  const activation = registry.activate({ primary: 'fixture.novel', enabled: ['fixture.novel', 'fixture.squatter'] })
  assert.equal(activation.ok, false)
  assert.equal(activation.error.code, 'PINAX_DIR_CONFLICT')
  assert.match(activation.error.details.dirConflicts[0].message, /被 .* 同时认领/)
})

test('故障隔离：坏清单只把自己挡在门外，外壳照样能启用别的板块', () => {
  const broken = withMutation(FIXTURE_WORLDBOOK, (m) => { m.panes = [{ slot: 'right', id: 'x', title: '抢右栏' }] })
  const registry = buildRegistry(broken, FIXTURE_NOVEL)
  assert.equal(registry.rejected.length, 1)
  assert.equal(registry.rejected[0].pluginId, 'fixture.worldbook')
  assert.equal(registry.rejected[0].error.code, 'PINAX_RESERVED_SLOT')
  const activation = registry.activate({ primary: 'fixture.novel', enabled: ['fixture.novel', 'fixture.worldbook'] })
  assert.equal(activation.ok, true)
  assert.deepEqual(activation.value.enabled, ['fixture.novel'], '未装载成功的插件不得混进启用集')
  assert.deepEqual(activation.value.missingInstalled, ['fixture.worldbook'])
})

test('C8：第三方不得伪装别人的工具命名空间', () => {
  const fake = withMutation(FIXTURE_NOVEL, (m) => {
    m.id = 'third.manju'
    m.title = '漫剧（第三方夹具）'
    m.tools = ['chapter.read']
    m.capabilities = ['storyboard.shots']
    m.dataDirs = { shots: '分镜' }
    m.scopes = ['file:分镜:rw']
  })
  const registry = buildRegistry(FIXTURE_NOVEL, fake)
  assert.equal(registry.get('third.manju'), null)
  assert.equal(registry.rejected.at(-1).stage, 'tools')
  assert.equal(registry.rejected.at(-1).error.code, 'PINAX_TOOL_CONFLICT')
})

test('重复 id 只留第一个', () => {
  const registry = buildRegistry(FIXTURE_NOVEL, FIXTURE_NOVEL)
  assert.equal(registry.list().length, 1)
  assert.equal(registry.rejected.at(-1).error.code, 'PINAX_DUPLICATE_PLUGIN')
})

test('C7：主载体即使漏在 enabled 外也会被强制计入，且 projectKind 由它决定', () => {
  const registry = buildRegistry(FIXTURE_NOVEL, FIXTURE_SCRIPT)
  const activation = registry.activate({ primary: 'fixture.script', enabled: ['fixture.script'] })
  assert.equal(activation.ok, true, JSON.stringify(activation.error ?? {}))
  assert.equal(activation.value.projectKind, 'screenplay')
  assert.equal(activation.value.contextProfile, 'screenplay')
  assert.equal(activation.value.defaultPane, 'scenes')
})
