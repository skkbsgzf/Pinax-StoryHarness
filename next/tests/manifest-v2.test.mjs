import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARRIER_SPEC_V1,
  CARRIER_SPEC_V2,
  validateCarrierManifest
} from '../kernel/carrierManifest.mjs'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { FIXTURE_NOVEL, withMutation } from '../testing/fixtures.mjs'

/**
 * 清单 v2（M2.5-C 任务三）单测。
 * 五类声明：provides / requires / permissions / contributes / subscriptions。
 * v1 字段保留可读一个版本周期；归一出参同时带新旧两套名字，依赖闭包与设置页不用改。
 */

/** 一份最小的 v2 清单：只声明本批要验的字段。 */
const V2_MINIMAL = {
  spec: CARRIER_SPEC_V2,
  manifestVersion: 2,
  id: 'demo.v2',
  title: 'v2 演示',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',
  primary: { projectKind: 'generic', defaultPane: 'demo.editor', contextProfile: 'authoring-knowledge' },
  dataDirs: { notes: '构思', outline: '大纲' },
  contributes: {
    panes: [
      { slot: 'left-dock', id: 'demo.tree', title: '树', view: 'pinax.view.tree' },
      { slot: 'center', id: 'demo.editor', title: '编辑', view: 'pinax.view.editor', forms: ['dock', 'overlay', 'fullscreen'] }
    ],
    settings: [
      { id: 'demo.section', title: '外观' },
      { id: 'demo.font', title: '字号', type: 'number', default: 15 },
      { id: 'demo.auto', title: '自动保存', type: 'boolean', default: true },
      { id: 'demo.theme', title: '配色', type: 'enum', options: ['paper', 'ink'], default: 'paper' }
    ],
    commands: [{ id: 'demo.say', title: '打个招呼', run: 'sayHello' }],
    renderers: ['pinax.view.custom']
  },
  provides: ['notes.ideas'],
  requires: [],
  tools: [],
  context: { providers: [], budgetChars: 8000 },
  permissions: [{ type: 'file', dir: '构思', mode: 'rw' }, 'agent:ask'],
  subscriptions: ['project.changed']
}

test('v1 可读：归一后写 v2，permissions 从 scopes 映射，settings 读成 section', () => {
  const result = validateCarrierManifest(FIXTURE_NOVEL)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  const manifest = result.value
  assert.equal(manifest.spec, CARRIER_SPEC_V2, '读 v1、写 v2：归一结果里只有新合同名')
  assert.equal(manifest.manifestVersion, 2)
  assert.deepEqual(manifest.scopes, ['file:正文:rw', 'file:大纲:rw', 'file:构思:rw', 'agent:ask'])
  assert.deepEqual(manifest.permissions, [
    { type: 'file', dir: '正文', mode: 'rw' },
    { type: 'file', dir: '大纲', mode: 'rw' },
    { type: 'file', dir: '构思', mode: 'rw' }
  ], 'permissions 是文件作用域的结构化视图（agent:ask 不是文件权限，留在 scopes）')
  assert.deepEqual(manifest.provides, manifest.capabilities, '新旧名字同一份值')
  assert.deepEqual(manifest.subscriptions, [])
  assert.deepEqual(manifest.commands, [])
})

test('v2 合规清单：五类声明都过，pane.view／forms、命令、枚举设置原样归一', () => {
  const result = validateCarrierManifest(V2_MINIMAL)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  const manifest = result.value
  assert.deepEqual(manifest.panes.map((pane) => pane.id), ['demo.tree', 'demo.editor'])
  assert.equal(manifest.panes[0].view, 'pinax.view.tree')
  assert.deepEqual(manifest.panes[1].forms, ['dock', 'overlay', 'fullscreen'])
  assert.deepEqual(manifest.commands, [{ id: 'demo.say', title: '打个招呼', run: 'sayHello' }])
  assert.deepEqual(manifest.renderers, ['pinax.view.custom'])
  assert.deepEqual(manifest.subscriptions, ['project.changed'])
  assert.deepEqual(manifest.settings[0], { id: 'demo.section', title: '外观', type: 'section' })
  assert.deepEqual(manifest.settings[1], { id: 'demo.font', title: '字号', type: 'number', default: 15 })
  assert.deepEqual(manifest.settings[3], { id: 'demo.theme', title: '配色', type: 'enum', options: ['paper', 'ink'], default: 'paper' })
})

test('manifestVersion 与 spec 必须配对：v2 缺版本号、v1 写 2 都拒', () => {
  const missing = validateCarrierManifest({ ...V2_MINIMAL, manifestVersion: undefined })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'PINAX_INVALID_MANIFEST')
  const wrong = validateCarrierManifest({ ...V2_MINIMAL, spec: CARRIER_SPEC_V1, manifestVersion: 2 })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.error.code, 'PINAX_INVALID_MANIFEST')
})

test('panes 只能有一个来源：顶层 panes 与 contributes.panes 同时出现即拒', () => {
  const dual = withMutation(V2_MINIMAL, (m) => { m.panes = [{ slot: 'center', id: 'demo.editor', title: '编辑' }] })
  const result = validateCarrierManifest(dual)
  assert.equal(result.ok, false)
  assert.match(result.error.message, /只能有一个来源/u)
})

test('permissions：对象形状校验 type／dir／mode，并且只能碰自己的 dataDirs', () => {
  const badType = withMutation(V2_MINIMAL, (m) => { m.permissions = [{ type: 'net', dir: 'x', mode: 'r' }] })
  assert.equal(validateCarrierManifest(badType).error.code, 'PINAX_INVALID_MANIFEST')

  const badMode = withMutation(V2_MINIMAL, (m) => { m.permissions = [{ type: 'file', dir: '构思', mode: 'write' }] })
  assert.equal(validateCarrierManifest(badMode).error.code, 'PINAX_INVALID_MANIFEST')

  const foreign = withMutation(V2_MINIMAL, (m) => { m.permissions = [{ type: 'file', dir: '正文', mode: 'rw' }] })
  assert.equal(validateCarrierManifest(foreign).error.code, 'PINAX_SCOPE_OUTSIDE_OWNER')

  const unknownField = withMutation(V2_MINIMAL, (m) => { m.permissions = [{ type: 'file', dir: '构思', mode: 'r', reason: '想读' }] })
  assert.equal(validateCarrierManifest(unknownField).error.code, 'PINAX_INVALID_MANIFEST')
})

test('provides 与 capabilities 同写必须一致；只写 v1 名也读得出来', () => {
  const conflict = withMutation(V2_MINIMAL, (m) => { m.capabilities = ['outline.tree'] })
  assert.equal(validateCarrierManifest(conflict).error.code, 'PINAX_INVALID_MANIFEST')

  const legacyNameOnly = withMutation(V2_MINIMAL, (m) => {
    delete m.provides
    m.capabilities = ['notes.ideas']
  })
  const result = validateCarrierManifest(legacyNameOnly)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.deepEqual(result.value.provides, ['notes.ideas'])
})

test('contributes.commands：id 规则、title 上限、run 形态、重复一律拒', () => {
  const cases = [
    [(m) => { m.contributes.commands = [{ id: 'Bad Id', title: 'x', run: 'x' }] }, 'INVALID_MANIFEST'],
    [(m) => { m.contributes.commands = [{ id: 'demo.say', title: '  ', run: 'x' }] }, 'INVALID_MANIFEST'],
    [(m) => { m.contributes.commands = [{ id: 'demo.say', title: 'x' }] }, 'INVALID_MANIFEST'],
    [(m) => { m.contributes.commands = [{ id: 'demo.say', title: 'x', run: 'x', icon: 'y' }] }, 'INVALID_MANIFEST'],
    [(m) => { m.contributes.commands = [{ id: 'demo.say', title: 'a', run: 'x' }, { id: 'demo.say', title: 'b', run: 'y' }] }, 'INVALID_MANIFEST']
  ]
  for (const [mutate, code] of cases) {
    const result = validateCarrierManifest(withMutation(V2_MINIMAL, mutate))
    assert.equal(result.ok, false)
    assert.equal(result.error.code, `PINAX_${code}`)
  }
})

test('contributes.renderers：只开 pinax.view.custom；宿主视图名即拒', () => {
  const reserved = withMutation(V2_MINIMAL, (m) => { m.contributes.renderers = ['pinax.view.tree'] })
  assert.equal(validateCarrierManifest(reserved).error.code, 'PINAX_RESERVED_VIEW_TYPE')
  const bogus = withMutation(V2_MINIMAL, (m) => { m.contributes.renderers = ['pinax.look'] })
  assert.equal(validateCarrierManifest(bogus).error.code, 'PINAX_INVALID_MANIFEST')
})

test('subscriptions：只认 project.changed', () => {
  const bad = withMutation(V2_MINIMAL, (m) => { m.subscriptions = ['project.deleted'] })
  assert.equal(validateCarrierManifest(bad).error.code, 'PINAX_UNKNOWN_SUBSCRIPTION')
})

test('pane.view／forms：view 须是 pinax.view.*，forms 只认宿主位置词表', () => {
  const badView = withMutation(V2_MINIMAL, (m) => { m.contributes.panes[0].view = 'tree' })
  assert.equal(validateCarrierManifest(badView).error.code, 'PINAX_INVALID_MANIFEST')

  const badForm = withMutation(V2_MINIMAL, (m) => { m.contributes.panes[1].forms = ['dock', 'popout'] })
  assert.equal(validateCarrierManifest(badForm).error.code, 'PINAX_INVALID_MANIFEST')

  const emptyForms = withMutation(V2_MINIMAL, (m) => { m.contributes.panes[1].forms = [] })
  assert.equal(validateCarrierManifest(emptyForms).error.code, 'PINAX_INVALID_MANIFEST')
})

test('contributes.settings：类型与默认值配对；section 不带 default/options', () => {
  const cases = [
    [(m) => { m.contributes.settings = [{ id: 'a.b', title: 'x', type: 'date' }] }, 'INVALID_INPUT'],
    [(m) => { m.contributes.settings = [{ id: 'a.b', title: 'x', type: 'number', default: 'wide' }] }, 'INVALID_INPUT'],
    [(m) => { m.contributes.settings = [{ id: 'a.b', title: 'x', type: 'enum', options: [] }] }, 'INVALID_INPUT'],
    [(m) => { m.contributes.settings = [{ id: 'a.b', title: 'x', type: 'enum', options: ['p'], default: 'q' }] }, 'INVALID_INPUT'],
    [(m) => { m.contributes.settings = [{ id: 'a.b', title: 'x', default: 'y' }] }, 'INVALID_INPUT']
  ]
  for (const [mutate, code] of cases) {
    const result = validateCarrierManifest(withMutation(V2_MINIMAL, mutate))
    assert.equal(result.ok, false, JSON.stringify(result.error ?? {}))
    assert.equal(result.error.code, `PINAX_${code}`)
  }
})

test('注册表 dispose：卸载跑 impl.dispose 与注册期钩子，重复 install 幂等拒绝', () => {
  const registry = createRegistry({ kinds: ['novel', 'screenplay', 'generic'] })
  const calls = []
  const impl = { dispose: () => calls.push('impl') }
  const installed = registry.install(V2_MINIMAL, impl)
  assert.equal(installed.ok, true, JSON.stringify(installed.error ?? {}))
  assert.equal(registry.commands().length, 1, '命令表能读出 contributes.commands')
  assert.equal(registry.commandOwner('demo.say'), 'demo.v2')

  registry.onDispose('demo.v2', () => calls.push('view'))
  registry.onDispose('demo.v2', () => calls.push('timer'))

  const duplicate = registry.install(V2_MINIMAL, impl)
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, 'PINAX_DUPLICATE_PLUGIN')

  const removed = registry.uninstall('demo.v2')
  assert.equal(removed.ok, true)
  assert.deepEqual(calls, ['impl', 'view', 'timer'], '卸载要把视图／订阅／定时器一并释放')
  assert.equal(registry.get('demo.v2'), null)
  assert.equal(registry.commands().length, 0)

  // 关掉的句柄不会再跑第二次（幂等）。
  assert.equal(registry.uninstall('demo.v2').ok, false)
  assert.deepEqual(calls, ['impl', 'view', 'timer'])
})
