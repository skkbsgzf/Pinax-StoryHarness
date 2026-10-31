import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARRIER_SPEC,
  CARRIER_SPEC_V1,
  CARRIER_SPEC_V2,
  CARRIER_SPEC_V3,
  CARRIER_SPEC_V4,
  SUPPORTED_CARRIER_SPECS,
  V3_ONLY_FIELDS,
  V4_ONLY_FIELDS,
  V4_ONLY_SERVICE_FIELDS,
  V4_ONLY_TOP_FIELDS,
  validateCarrierManifest
} from '../kernel/carrierManifest.mjs'
import {
  LICENSE_MODES,
  compareKernelVersions,
  kernelRangeAllows
} from '../kernel/carrierManifest.contract.mjs'
import { PANE_MULTIPLICITIES, PANE_SCOPES, UNSUPPORTED_PANE_MULTIPLICITIES } from '../kernel/carrierManifest.paneSemantics.mjs'
import { PANE_TAKES, RESERVED_PANE_TAKES } from '../kernel/carrierManifest.claims.mjs'
import { PREVIEW_LOADING_MODES, PREVIEW_MAX_BYTES_MAX } from '../kernel/carrierManifest.previews.mjs'
import { diagnoseCarrier, loadHostDescriptor } from '../doctor.mjs'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { BUILT_IN_CARRIER_PLUGINS } from '../carriers/index.mjs'
import { NOVEL_CARRIER } from '../carriers/novel/manifest.mjs'
import { FIXTURE_NOVEL, withMutation } from '../testing/fixtures.mjs'
import { FIXTURE_V4 } from '../testing/fixtures/carrierV4.mjs'

/**
 * 协议 @4（批次52）的合同面：
 *   四组借鉴字段（槽语义／资源认领／渲染器注册／合同上界）＋ license ＋ services.adopt。
 *
 * 三条纪律在这里逐条落成断言：
 *   · 新增字段只对 @4 生效；老清单写新字段必须拒（V4_ONLY_FIELDS／V4_ONLY_TOP_FIELDS／V4_ONLY_SERVICE_FIELDS）。
 *   · 12 份现有清单零误拒——收紧 major.minor 与新增必填项不许回头咬老载体。
 *   · 每个新字段都要有宿主读取点：诊断把槽语义、认领、preview、license、adopt 摊开，读不到就是死字段。
 */

function rejects(manifest, code = 'INVALID_MANIFEST') {
  const result = validateCarrierManifest(manifest)
  assert.equal(result.ok, false, '应当拒绝')
  assert.equal(result.error.code, code.startsWith('PINAX_') ? code : `PINAX_${code}`, result.error.message)
  return result.error
}

function v4With(mutate) {
  return withMutation(FIXTURE_V4, mutate)
}

function paneWith(index, fields) {
  return v4With((manifest) => Object.assign(manifest.panes[index], fields))
}

// ── 验收：spec 常量与读侧兼容 ────────────────────────────────────────────────

test('@4 进 SUPPORTED_CARRIER_SPECS，CARRIER_SPEC 指向 @4，@1/@2/@3 仍可读', () => {
  assert.equal(CARRIER_SPEC_V4, 'pinax-carrier@4')
  assert.equal(CARRIER_SPEC, CARRIER_SPEC_V4)
  assert.deepEqual(SUPPORTED_CARRIER_SPECS, [CARRIER_SPEC_V1, CARRIER_SPEC_V2, CARRIER_SPEC_V3, CARRIER_SPEC_V4])

  const v1 = validateCarrierManifest(FIXTURE_NOVEL)
  assert.equal(v1.ok, true, JSON.stringify(v1.error ?? {}))

  const v2 = validateCarrierManifest(withMutation(FIXTURE_NOVEL, (manifest) => {
    manifest.spec = CARRIER_SPEC_V2
    manifest.manifestVersion = 2
  }))
  assert.equal(v2.ok, true, JSON.stringify(v2.error ?? {}))

  const v3 = validateCarrierManifest(NOVEL_CARRIER)
  assert.equal(v3.ok, true, JSON.stringify(v3.error ?? {}))
})

test('12 份现有载体清单零误拒：校验器与注册表都照旧收下（major.minor 收紧不咬老清单）', () => {
  assert.equal(BUILT_IN_CARRIER_PLUGINS.length, 12)
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const validated = validateCarrierManifest(plugin.manifest)
    assert.equal(validated.ok, true, `${plugin.manifest.id}: ${validated.error?.message}`)
    const installed = registry.install(plugin.manifest, plugin.impl, plugin.meta)
    assert.equal(installed.ok, true, `${plugin.manifest.id}: ${installed.error?.message}`)
  }
  assert.equal(registry.rejected.length, 0, JSON.stringify(registry.rejected))
  assert.equal(registry.manifests().size, 12)

  // 老清单的归一结果不多出新字段（读侧字节不变）：@3 的 pane 没有 multiplicity／claims 的默认键。
  const novel = validateCarrierManifest(NOVEL_CARRIER)
  assert.equal('multiplicity' in novel.value.panes[0], false)
  assert.equal('claims' in novel.value.panes[0], false)
  assert.equal(novel.value.maxKernel, null)
  assert.equal(novel.value.preview, null)
  assert.equal(novel.value.license, null)
})

test('夹具全字段通过并归一：槽语义／认领／preview／license／maxKernel／adopt 各自就位', () => {
  const result = validateCarrierManifest(FIXTURE_V4)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  const manifest = result.value

  const editor = manifest.panes.find((pane) => pane.id === 'v4.editor')
  assert.equal(editor.multiplicity, 'single')
  assert.equal(editor.scope, 'project')
  assert.equal(editor.keyField, null)
  assert.deepEqual(editor.claims, [])
  assert.equal(editor.priority, 0)
  assert.equal(editor.canOpen, null)
  assert.equal(editor.takes, null)

  const tabs = manifest.panes.find((pane) => pane.id === 'v4.tabs')
  assert.equal(tabs.multiplicity, 'keyed')
  assert.equal(tabs.scope, 'entry')
  assert.equal(tabs.keyField, 'docId')
  assert.deepEqual(tabs.claims, ['文档/**/*.md', '资料/*.txt'])
  assert.equal(tabs.priority, 60)
  assert.deepEqual(tabs.canOpen, { field: 'kind', in: ['chapter', 'note'] })
  assert.equal(tabs.takes, 'extension')

  assert.deepEqual(manifest.preview.register.map((item) => [item.id, item.loading]), [
    ['markdown', 'text-pages'],
    ['images', 'bytes-complete']
  ])
  assert.deepEqual(manifest.license, { mode: 'subscription', agreement: 'LICENSE.md', version: '1.2.0' })
  assert.equal(manifest.maxKernel, '2')
  assert.equal(manifest.services[0].adopt, true)
  assert.equal(manifest.services[0].command, null)
  assert.equal(manifest.services[0].restart, 'never')
  assert.equal(manifest.services[0].port, 9101)
  assert.equal(manifest.services[0].healthPath, '/health')
})

// ── 第一组：槽语义 ─────────────────────────────────────────────────────────

test('槽语义：multiplicity／scope 词表；chain 登记未采用；keyed 必须给 keyField', () => {
  assert.deepEqual(PANE_MULTIPLICITIES, ['single', 'list', 'keyed'])
  assert.deepEqual(PANE_SCOPES, ['project', 'entry', 'session'])
  assert.deepEqual(UNSUPPORTED_PANE_MULTIPLICITIES, ['chain'])

  rejects(paneWith(0, { multiplicity: 'chain' }))
  rejects(paneWith(0, { multiplicity: 'many' }))
  rejects(paneWith(0, { scope: 'workspace' }))
  rejects(paneWith(1, { keyField: undefined }))
  rejects(paneWith(0, { keyField: 'docId' }))
})

// ── 第二组：资源认领与接管 ──────────────────────────────────────────────────

test('资源认领：claims 只收项目内相对 glob；priority／canOpen／takes 离开 claims 即死声明', () => {
  rejects(v4With((manifest) => { manifest.panes[1].claims = ['/世界书/a.md'] }))
  rejects(v4With((manifest) => { manifest.panes[1].claims = ['../逃逸.md'] }))
  rejects(v4With((manifest) => { manifest.panes[1].claims = ['世界书\\a.md'] }))
  rejects(v4With((manifest) => { manifest.panes[1].claims = ['世界书/a**b.md'] }))
  rejects(v4With((manifest) => { manifest.panes[1].claims = [] }))
  rejects(v4With((manifest) => { manifest.panes[1].claims = ['.pinax/项目.json'] }))

  rejects(v4With((manifest) => { manifest.panes[1].priority = 101 }))
  rejects(v4With((manifest) => { manifest.panes[0].priority = 10 }))

  rejects(v4With((manifest) => { manifest.panes[1].canOpen = { field: 'kind', equals: 'chapter', in: ['note'] } }))
  rejects(v4With((manifest) => { manifest.panes[1].canOpen = { field: 'kind', equals: () => true } }))
  rejects(v4With((manifest) => { manifest.panes[1].canOpen = { field: 'kind', in: 'chapter' } }))

  assert.deepEqual(PANE_TAKES, ['extension', 'fallback'])
  assert.deepEqual(RESERVED_PANE_TAKES, ['builtin'])
  rejects(v4With((manifest) => { manifest.panes[1].takes = 'builtin' }))
  rejects(v4With((manifest) => { manifest.panes[1].takes = 'primary' }))
})

// ── 第三组：渲染器注册 ─────────────────────────────────────────────────────

test('preview.register：扩展名小写带点、loading 两档、maxBytes 有上限且不许重复认领', () => {
  assert.deepEqual(PREVIEW_LOADING_MODES, ['text-pages', 'bytes-complete'])
  assert.equal(PREVIEW_MAX_BYTES_MAX, 64 * 1024 * 1024)

  rejects(v4With((manifest) => { manifest.preview.register[0].loading = 'whole-file' }))
  rejects(v4With((manifest) => { manifest.preview.register[0].extensions = ['MD'] }))
  rejects(v4With((manifest) => { manifest.preview.register[0].maxBytes = PREVIEW_MAX_BYTES_MAX + 1 }))
  rejects(v4With((manifest) => { manifest.preview.register[0].maxBytes = 0 }))
  rejects(v4With((manifest) => { manifest.preview.register[1].extensions = ['.md'] }))
  rejects(v4With((manifest) => { manifest.preview.register[0].extra = true }))
  rejects(v4With((manifest) => { manifest.preview = { register: [] } }))
  rejects(v4With((manifest) => { manifest.preview = { register: [], extra: 1 } }))
})

// ── 第四组：合同上界 ───────────────────────────────────────────────────────

test('maxKernel：与 minKernel 成对；缺省＝不设上界；粒度 major.minor（patch 不参与）', () => {
  const noUpper = v4With((manifest) => { delete manifest.maxKernel })
  const passed = validateCarrierManifest(noUpper)
  assert.equal(passed.ok, true, JSON.stringify(passed.error ?? {}))
  assert.equal(passed.value.maxKernel, null)

  rejects(v4With((manifest) => { manifest.maxKernel = 'two' }))
  rejects(v4With((manifest) => { manifest.maxKernel = '0.5' }))

  // 上界低于宿主合同：合法格式，但装不上——KERNEL_INCOMPATIBLE，不是清单格式错。
  const belowHost = v4With((manifest) => { manifest.minKernel = '0'; manifest.maxKernel = '0' })
  rejects(belowHost, 'KERNEL_INCOMPATIBLE')

  // major.minor 粒度：'1.0' 等于宿主 '1'；'1.1' 高于宿主；'1.0.9' 的 patch 不参与。
  const minorEqual = v4With((manifest) => { manifest.minKernel = '1.0' })
  assert.equal(validateCarrierManifest(minorEqual).ok, true)
  rejects(v4With((manifest) => { manifest.minKernel = '1.1' }), 'KERNEL_INCOMPATIBLE')
  const patchIgnored = v4With((manifest) => { manifest.minKernel = '1.0.9'; manifest.maxKernel = '1.0.9' })
  assert.equal(validateCarrierManifest(patchIgnored).ok, true)
  assert.equal(compareKernelVersions('1.0.9', '1'), 0)
  assert.equal(kernelRangeAllows('1.0', '1.0', '1'), true)
  assert.equal(kernelRangeAllows('1', '0.9', '1'), false)
})

// ── 增项：license ─────────────────────────────────────────────────────────

test('license：mode 枚举、agreement 走插件相对路径且只认 .md/.txt、version 须 x.y.z', () => {
  assert.deepEqual(LICENSE_MODES, ['free', 'subscription', 'buyout'])
  rejects(v4With((manifest) => { manifest.license.mode = 'perpetual' }))
  rejects(v4With((manifest) => { manifest.license.agreement = 'LICENSE.pdf' }))
  rejects(v4With((manifest) => { manifest.license.agreement = '../LICENSE.md' }))
  rejects(v4With((manifest) => { manifest.license.version = '1.2' }))
  rejects(v4With((manifest) => { manifest.license.extra = true }))
  rejects(v4With((manifest) => { manifest.license = 'free' }))

  const optional = v4With((manifest) => { manifest.license = { mode: 'free' } })
  const result = validateCarrierManifest(optional)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  assert.deepEqual(result.value.license, { mode: 'free', agreement: null, version: null })
})

// ── 增项：services.adopt ───────────────────────────────────────────────────

test('adopt：无 command 合法；port 与 healthPath 必填；不许再带启动参数；restart 只能是 never', () => {
  rejects(v4With((manifest) => { delete manifest.services[0].port }), 'INVALID_SERVICE')
  rejects(v4With((manifest) => { delete manifest.services[0].healthPath }), 'INVALID_SERVICE')
  rejects(v4With((manifest) => { manifest.services[0].command = process.execPath }), 'INVALID_SERVICE')
  rejects(v4With((manifest) => { manifest.services[0].args = ['server.mjs'] }), 'INVALID_SERVICE')
  rejects(v4With((manifest) => { manifest.services[0].env = { PORT: '9101' } }), 'INVALID_SERVICE')
  rejects(v4With((manifest) => { manifest.services[0].cwd = 'ui' }), 'INVALID_SERVICE')
  rejects(v4With((manifest) => { manifest.services[0].restart = 'on-failure' }), 'INVALID_SERVICE')
  rejects(v4With((manifest) => { manifest.services[0].adopt = 'yes' }), 'INVALID_SERVICE')

  // 不带 adopt 的服务仍按老规矩要求 command（adopt 不是「省掉 command」的通用后门）。
  rejects(v4With((manifest) => {
    const service = manifest.services[0]
    delete service.adopt
    delete service.command
  }), 'INVALID_SERVICE')
})

// ── 老清单写新字段：逐字段拒装（V4_ONLY_* 纪律）────────────────────────────

test('V4_ONLY_FIELDS：七个 pane 字段、三个顶层字段、一个 service 字段在 @3 清单里都拒', () => {
  assert.deepEqual([...V4_ONLY_FIELDS].sort(), ['canOpen', 'claims', 'keyField', 'multiplicity', 'priority', 'scope', 'takes'])
  assert.deepEqual([...V4_ONLY_TOP_FIELDS].sort(), ['license', 'maxKernel', 'preview'])
  assert.deepEqual(V4_ONLY_SERVICE_FIELDS, ['adopt'])

  for (const field of V4_ONLY_FIELDS) {
    const manifest = withMutation(NOVEL_CARRIER, (copy) => {
      copy.contributes.panes[0][field] = field === 'claims' ? ['正文/*.md'] : field === 'priority' ? 10 : 'x'
    })
    const error = rejects(manifest)
    assert.match(error.message, /pinax-carrier@4/u, `字段 ${field} 应指向 @4`)
  }
  for (const field of V4_ONLY_TOP_FIELDS) {
    const manifest = withMutation(NOVEL_CARRIER, (copy) => {
      copy[field] = field === 'preview'
        ? { register: [{ id: 'md', extensions: ['.md'], loading: 'text-pages', maxBytes: 1024 }] }
        : field === 'license' ? { mode: 'free' } : '2'
    })
    rejects(manifest)
  }
  rejects(withMutation(NOVEL_CARRIER, (copy) => {
    copy.services = [{ id: 'external', adopt: true, port: 9101, healthPath: '/health' }]
  }))

  // @1／@2 同样不认 @4 字段（不因为版本更老就放行）。
  rejects(withMutation(FIXTURE_NOVEL, (copy) => { copy.maxKernel = '2' }))
  rejects(withMutation(FIXTURE_NOVEL, (copy) => {
    copy.spec = CARRIER_SPEC_V2
    copy.manifestVersion = 2
    copy.panes[0].claims = ['正文/*.md']
  }))
})

// ── 反向断言：每个新字段都有宿主读取点 ────────────────────────────────────

test('反向断言：诊断读出每一个新字段（清单合法但 adopt 服务给独立态 adopted-external）', () => {
  const loaded = loadHostDescriptor()
  assert.equal(loaded.ok, true)
  const report = diagnoseCarrier(FIXTURE_V4, { descriptor: loaded.value })
  assert.equal(report.state, 'adopted-external', report.message)
  assert.equal(report.fix.length > 0, true, '每种非 ok 态都要给修复路径')

  const byName = Object.fromEntries(report.checks.map((check) => [check.name, check]))
  // multiplicity／scope／keyField
  assert.deepEqual(byName['pane-multiplicity'].panes, [
    { id: 'v4.editor', multiplicity: 'single', scope: 'project', keyField: null },
    { id: 'v4.tabs', multiplicity: 'keyed', scope: 'entry', keyField: 'docId' },
    { id: 'v4.panel', multiplicity: 'list', scope: 'session', keyField: null }
  ])
  // claims／priority／canOpen／takes
  assert.deepEqual(byName.claims.panes, [{
    id: 'v4.tabs',
    claims: ['文档/**/*.md', '资料/*.txt'],
    priority: 60,
    canOpen: { field: 'kind', in: ['chapter', 'note'] },
    takes: 'extension'
  }])
  // preview.register（loading 与 maxBytes 都要读出来，批次55 直接消费这一档）
  assert.deepEqual(byName.preview.registrations, [
    { id: 'markdown', extensions: ['.md', '.txt'], loading: 'text-pages', maxBytes: 2 * 1024 * 1024 },
    { id: 'images', extensions: ['.png'], loading: 'bytes-complete', maxBytes: 8 * 1024 * 1024 }
  ])
  // license
  assert.equal(byName.license.mode, 'subscription')
  assert.equal(byName.license.agreement, 'LICENSE.md')
  // adopt
  assert.deepEqual(byName.adopt.services, ['v4-external'])
})

test('反向断言：maxKernel 被诊断读取——上界低于宿主时报升级，文案点到 maxKernel', () => {
  const loaded = loadHostDescriptor()
  const upperBound = withMutation(FIXTURE_V4, (manifest) => {
    manifest.minKernel = '0'
    manifest.maxKernel = '0'
  })
  const report = diagnoseCarrier(upperBound, { descriptor: loaded.value })
  assert.equal(report.state, 'needs-host-upgrade')
  assert.match(report.message, /0–0/u)
  assert.match(report.fix, /maxKernel/u)
})

test('反向断言：single pane 在工作区被开成多份 → incompatible-form，不静默复用', () => {
  const loaded = loadHostDescriptor()
  const single = diagnoseCarrier(FIXTURE_V4, { descriptor: loaded.value, workspace: ['v4.editor#1'] })
  assert.equal(single.state, 'adopted-external', single.message)

  const duplicated = diagnoseCarrier(FIXTURE_V4, {
    descriptor: loaded.value,
    workspace: ['v4.editor#1', 'v4.editor#2']
  })
  assert.equal(duplicated.state, 'incompatible-form')
  assert.match(duplicated.message, /single/u)
  assert.match(duplicated.fix, /multiplicity/u)

  // keyed／list 多开是合法的：同样的实例数换成 v4.tabs 不会触发。
  const keyed = diagnoseCarrier(FIXTURE_V4, {
    descriptor: loaded.value,
    workspace: ['v4.tabs#1', 'v4.tabs#2']
  })
  assert.equal(keyed.state, 'adopted-external', keyed.message)
})

test('宿主描述符登记 @4：doctor 不把合法 @4 清单判成「外壳不认这个合同」', () => {
  const loaded = loadHostDescriptor()
  assert.equal(loaded.value.carrierSpecs.includes(CARRIER_SPEC_V4), true)
  assert.ok(V3_ONLY_FIELDS.length > 0)
})
