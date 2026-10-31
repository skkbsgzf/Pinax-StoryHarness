import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OVERRIDES_VERSION,
  applyPaneOverride,
  applyServiceOverride,
  applyServiceOverrides,
  buildEffectiveSettings,
  buildSettingsSchema,
  carrierOverridesPath,
  createFileCarrierOverridesStore,
  readCarrierOverridesSync,
  resolveSettingValue,
  serviceOverrideFor,
  validateDeclaredValue
} from '../carrierOverridesStore.mjs'
import {
  CARRIER_SPEC_V3,
  V4_ONLY_FIELDS,
  validateCarrierManifest
} from '../kernel/carrierManifest.mjs'
import { createServiceSupervisor } from '../runtime/serviceSupervisor.mjs'
import { FIXTURE_V4 } from '../testing/fixtures/carrierV4.mjs'
import { withMutation } from '../testing/fixtures.mjs'

/**
 * 工程级覆盖（批次54）：`.pinax/` 覆盖文件的读写纪律、合并序（默认→覆盖）、
 * 运行时的三个消费点（服务端口／应用面 url／设置默认值）与来源层记账。
 *
 * 边界一遍遍钉：覆盖只改值，adopt／command／env／restart 这些结构性字段永远由清单说了算；
 * 坏档不崩不覆盖；设置写闸与覆盖合并用同一套值域校验（含 min/max/step）。
 */

async function makeRoot() {
  return mkdtemp(join(tmpdir(), 'pinax-overrides-'))
}

function v4With(mutate) {
  return withMutation(FIXTURE_V4, mutate)
}

function accepts(manifest) {
  const result = validateCarrierManifest(manifest)
  assert.equal(result.ok, true, result.ok ? '' : result.error.message)
  return result.value
}

function rejects(manifest, code) {
  const result = validateCarrierManifest(manifest)
  assert.equal(result.ok, false, '应当拒绝')
  if (code) assert.equal(result.error.code, code, result.error.message)
  return result.error
}

// ── 存储：原子写／坏档／内容不变不写 ─────────────────────────────────────────

test('覆盖文件：write 后形状是 { version:1, overrides:{...} }，不留 .tmp', async () => {
  const root = await makeRoot()
  try {
    const store = createFileCarrierOverridesStore({ root })
    assert.equal(store.file, carrierOverridesPath(root))

    const written = await store.write({ 'pinax.carrier.comic': { 'comic.canvas': 'http://127.0.0.1:8199/' } })
    assert.equal(written.ok, true)

    const raw = JSON.parse(await readFile(carrierOverridesPath(root), 'utf-8'))
    assert.deepEqual(raw, {
      version: OVERRIDES_VERSION,
      overrides: { 'pinax.carrier.comic': { 'comic.canvas': 'http://127.0.0.1:8199/' } }
    })

    const files = await readdir(join(root, '.pinax'))
    assert.deepEqual(files, ['carrier-overrides.json'], 'tmp 必须被 rename 掉')

    const reread = await store.read()
    assert.equal(reread.ok, true)
    assert.deepEqual(reread.value.overrides['pinax.carrier.comic'], { 'comic.canvas': 'http://127.0.0.1:8199/' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('覆盖文件：内容没变就不写盘（set 同一值第二次 skipped）', async () => {
  const root = await makeRoot()
  try {
    const store = createFileCarrierOverridesStore({ root })
    const first = await store.set('pinax.carrier.comic', 'comic.canvas', 'http://127.0.0.1:8199/')
    assert.equal(first.value.skipped, false)
    const second = await store.set('pinax.carrier.comic', 'comic.canvas', 'http://127.0.0.1:8199/')
    assert.equal(second.ok, true)
    assert.equal(second.value.skipped, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('覆盖文件：坏 JSON／根不是对象都回空覆盖并记账，不抛', async () => {
  const root = await makeRoot()
  // eslint-disable-next-line no-console
  const originalError = console.error
  // eslint-disable-next-line no-console
  console.error = () => {}
  try {
    await mkdir(join(root, '.pinax'), { recursive: true })
    await writeFile(carrierOverridesPath(root), '{ not json', 'utf-8')
    const badJson = readCarrierOverridesSync(root)
    assert.deepEqual(badJson.overrides, {})
    assert.deepEqual(badJson.warnings, ['OVERRIDES_BAD_JSON'])

    await writeFile(carrierOverridesPath(root), '[]', 'utf-8')
    const badRoot = readCarrierOverridesSync(root)
    assert.deepEqual(badRoot.overrides, {})
    assert.deepEqual(badRoot.warnings, ['OVERRIDES_NOT_OBJECT'])

    assert.deepEqual(readCarrierOverridesSync(join(root, 'missing')).overrides, {}, '不存在的文件＝空覆盖')
  } finally {
    // eslint-disable-next-line no-console
    console.error = originalError
    await rm(root, { recursive: true, force: true })
  }
})

test('覆盖写入：结构性字段（adopt／command／env／secret）一律拒写', async () => {
  const root = await makeRoot()
  try {
    const store = createFileCarrierOverridesStore({ root })
    const denied = await store.set('pinax.carrier.comic', 'comfy', { adopt: true })
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'PINAX_OVERRIDE_FORBIDDEN_KEY')

    const envDenied = await store.write({ 'pinax.carrier.comic': { comfy: { env: { TOKEN: 'x' } } } })
    assert.equal(envDenied.ok, false)
    assert.equal(envDenied.error.code, 'PINAX_OVERRIDE_FORBIDDEN_KEY')

    const files = await readdir(join(root, '.pinax')).catch(() => [])
    assert.deepEqual(files, [], '拒的时候一个字节都不写')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('覆盖读取：单值 set／remove 只动目标键，别的载体原样保留', async () => {
  const root = await makeRoot()
  try {
    const store = createFileCarrierOverridesStore({ root })
    await store.set('pinax.carrier.comic', 'comic.canvas', 'http://127.0.0.1:8199/')
    await store.set('pinax.carrier.comic', 'comfy', { port: 8200 })
    await store.set('pinax.carrier.video', 'video.canvas', 'http://127.0.0.1:3100/')

    await store.remove('pinax.carrier.comic', 'comic.canvas')
    const read = await store.read()
    assert.deepEqual(read.value.overrides, {
      'pinax.carrier.comic': { comfy: { port: 8200 } },
      'pinax.carrier.video': { 'video.canvas': 'http://127.0.0.1:3100/' }
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// ── 服务合并：只改值，结构字段不生效 ─────────────────────────────────────────

test('服务覆盖：port／healthPath／args 生效并记账，结构性字段忽略，非法值不生效', () => {
  const spec = { id: 'comfy', pluginId: 'pinax.carrier.comic', adopt: false, command: 'node', port: 8188, healthPath: '/', args: ['a'] }
  const applied = applyServiceOverride(spec, {
    port: 8200,
    healthPath: '/ready',
    args: ['b'],
    adopt: true,
    command: 'evil',
    env: { TOKEN: 'x' }
  })
  assert.equal(applied.spec.port, 8200)
  assert.equal(applied.spec.healthPath, '/ready')
  assert.deepEqual(applied.spec.args, ['b'])
  assert.equal(applied.spec.adopt, false, 'adopt 是结构字段：覆盖不能把外部服务变成宿主托管')
  assert.equal(applied.spec.command, 'node')
  assert.deepEqual(applied.warnings.sort(), [
    'OVERRIDE_STRUCTURAL_FIELD_IGNORED:adopt',
    'OVERRIDE_STRUCTURAL_FIELD_IGNORED:command',
    'OVERRIDE_STRUCTURAL_FIELD_IGNORED:env'
  ])
  assert.deepEqual(applied.hits, [
    { field: 'port', from: 8188, to: 8200 },
    { field: 'healthPath', from: '/', to: '/ready' },
    { field: 'args', from: ['a'], to: ['b'] }
  ])

  const invalid = applyServiceOverride(spec, { port: 0, healthPath: 'ready', args: 'nope' })
  assert.equal(invalid.spec.port, 8188)
  assert.deepEqual(invalid.warnings.sort(), ['OVERRIDE_INVALID_ARGS', 'OVERRIDE_INVALID_HEALTH_PATH', 'OVERRIDE_INVALID_PORT'])
  assert.deepEqual(invalid.hits, [])
})

test('服务覆盖：applyServiceOverrides 按 pluginId 取条目，无覆盖时 overrideFields 为空', () => {
  const { services, warnings } = applyServiceOverrides([
    { id: 'a', pluginId: 'p.one', port: 1 },
    { id: 'b', pluginId: 'p.two', port: 2 }
  ], { 'p.one': { a: { port: 9 } } })
  assert.deepEqual(services, [
    { id: 'a', pluginId: 'p.one', port: 9, overrideFields: ['port'] },
    { id: 'b', pluginId: 'p.two', port: 2, overrideFields: [] }
  ])
  assert.deepEqual(warnings, [])
  assert.equal(serviceOverrideFor({ 'p.one': { a: { port: 9 } } }, 'p.one', 'a').port, 9)
  assert.equal(serviceOverrideFor({ 'p.one': { a: { port: 9 } } }, 'p.one', 'zzz'), undefined)
})

test('监督器消费覆盖：状态给覆盖后的端口与来源层，公共池记一条 info', async () => {
  const appended = []
  const logPool = { append: (entry) => appended.push(entry) }
  const supervisor = createServiceSupervisor({
    services: [{
      id: 'comfy',
      pluginId: 'pinax.carrier.comic',
      adopt: true,
      port: 8188,
      healthPath: '/',
      restart: 'never'
    }],
    overrides: { 'pinax.carrier.comic': { comfy: { port: 8200, healthPath: '/ready' } } },
    probeHealth: async () => ({ ok: true }),
    healthIntervalMs: 1,
    logPool
  })
  try {
    const started = await supervisor.start()
    assert.equal(started.ok, true)
    const status = supervisor.status()[0]
    assert.equal(status.status, 'ready')
    assert.equal(status.port, 8200, '状态面给覆盖后的端口')
    assert.equal(status.portSource, 'override')
    assert.deepEqual([...status.overrideFields].sort(), ['healthPath', 'port'])

    const note = appended.find((entry) => entry.message.includes('端口 8188 被工程覆盖改成了 8200'))
    assert.ok(note, '覆盖命中要进公共池留痕')
    assert.equal(note.level, 'info')
    assert.equal(note.data.layer, 'override')
    assert.equal(note.source.carrierId, 'pinax.carrier.comic')
  } finally {
    await supervisor.stop()
  }
})

// ── 应用面 url 覆盖 ─────────────────────────────────────────────────────────

const APP_PANE = { id: 'comic.canvas', kind: 'external-app', view: 'pinax.view.app', app: { url: 'http://127.0.0.1:3010' } }

test('应用面覆盖：字符串与 { url } 两种写法都收，来源标 override', () => {
  assert.deepEqual(applyPaneOverride(APP_PANE, 'http://127.0.0.1:8199/'), {
    url: 'http://127.0.0.1:8199/', source: 'override', warnings: []
  })
  assert.deepEqual(applyPaneOverride(APP_PANE, { url: 'http://localhost:8199/' }), {
    url: 'http://localhost:8199/', source: 'override', warnings: []
  })
  assert.deepEqual(applyPaneOverride(APP_PANE, undefined), {
    url: 'http://127.0.0.1:3010', source: 'manifest', warnings: []
  })
})

test('应用面覆盖：外网地址／非应用面 pane 不生效，按清单声明走', () => {
  const external = applyPaneOverride(APP_PANE, 'https://example.com/')
  assert.equal(external.source, 'manifest')
  assert.deepEqual(external.warnings, ['OVERRIDE_INVALID_PANE_URL'])

  const notApp = applyPaneOverride({ id: 'novel.editor', kind: 'chapter-editor' }, 'http://127.0.0.1:8199/')
  assert.equal(notApp.url, '')
  assert.equal(notApp.source, 'manifest')
  assert.deepEqual(notApp.warnings, ['OVERRIDE_PANE_NOT_APP'])
})

// ── 设置：有效值与来源层 ────────────────────────────────────────────────────

const SETTINGS = [{
  id: 'font-size',
  title: '字号',
  type: 'number',
  default: 17,
  min: 12,
  max: 24,
  step: 1,
  volatile: true
}]

test('设置有效值：stored > override > manifest，非法覆盖回默认并记账', () => {
  const stored = buildEffectiveSettings({ p: SETTINGS }, { p: { 'font-size': 18 } }, { p: { 'font-size': 14 } })
  assert.deepEqual(stored.effective.p['font-size'], { value: 18, source: 'stored', label: '项目设置', volatile: true })

  const overridden = buildEffectiveSettings({ p: SETTINGS }, {}, { p: { 'font-size': 14 } })
  assert.deepEqual(overridden.effective.p['font-size'], { value: 14, source: 'override', label: '工程覆盖', volatile: true })

  const fallback = buildEffectiveSettings({ p: SETTINGS }, {}, { p: { 'font-size': 99 } })
  assert.equal(fallback.effective.p['font-size'].value, 17)
  assert.equal(fallback.effective.p['font-size'].source, 'manifest')
  assert.deepEqual(fallback.warnings, ['SETTING_OUT_OF_RANGE:font-size:p/font-size'])

  // 项目设置里的坏值也不吞：回落到覆盖／默认并记账。
  const badStored = buildEffectiveSettings({ p: SETTINGS }, { p: { 'font-size': 'big' } }, { p: { 'font-size': 14 } })
  assert.equal(badStored.effective.p['font-size'].value, 14)
  assert.equal(badStored.effective.p['font-size'].source, 'override')
  assert.deepEqual(badStored.warnings, ['SETTING_TYPE_MISMATCH:p/font-size'])
})

test('设置有效值：section 不存值，resolveSettingValue 直接给 section 来源', () => {
  assert.deepEqual(resolveSettingValue({ id: 'group', type: 'section' }, 'x'), { value: null, source: 'section', warnings: [] })
  const built = buildEffectiveSettings({ p: [{ id: 'group', type: 'section' }] }, {}, {})
  assert.deepEqual(built.effective.p, {})
})

test('声明值域：min/max/step 与 enum/types 共用同一套判据', () => {
  assert.equal(validateDeclaredValue({ type: 'number', min: 12, max: 24, step: 2 }, 14), null)
  assert.equal(validateDeclaredValue({ type: 'number', min: 12, max: 24, step: 2 }, 15), 'SETTING_STEP_MISMATCH')
  assert.equal(validateDeclaredValue({ type: 'number', min: 12 }, 11), 'SETTING_OUT_OF_RANGE')
  assert.equal(validateDeclaredValue({ type: 'number' }, Number.NaN), 'SETTING_TYPE_MISMATCH')
  assert.equal(validateDeclaredValue({ type: 'string' }, 'ok'), null)
  assert.equal(validateDeclaredValue({ type: 'string' }, 1), 'SETTING_TYPE_MISMATCH')
  assert.equal(validateDeclaredValue({ type: 'boolean' }, true), null)
  assert.equal(validateDeclaredValue({ type: 'enum', options: ['a'] }, 'b'), 'SETTING_TYPE_MISMATCH')
  assert.equal(validateDeclaredValue({ type: 'section' }, 1), 'SETTING_SECTION_NO_VALUE')
  assert.equal(validateDeclaredValue({ type: 'unknown' }, 1), 'SETTING_TYPE_UNSUPPORTED')
})

// ── @4 清单：volatile／min／max／step 只在 @4 生效 ───────────────────────────

function withSettings(settings) {
  return v4With((manifest) => { manifest.settings = settings })
}

test('@4 清单：settings 收 volatile/min/max/step，归一化保留', () => {
  const normalized = accepts(withSettings(SETTINGS))
  assert.deepEqual(normalized.settings, SETTINGS)
})

test('@3 清单写 volatile/min/max/step 即拒（新字段只对 @4 生效）', () => {
  const v3 = withMutation(FIXTURE_V4, (manifest) => {
    manifest.spec = CARRIER_SPEC_V3
    manifest.manifestVersion = 3
    manifest.settings = SETTINGS
    // @4 的其它字段在 @3 也非法，先剥掉，单测只打设置字段这一枪。
    delete manifest.maxKernel
    delete manifest.license
    delete manifest.preview
    for (const pane of manifest.panes) for (const field of V4_ONLY_FIELDS) delete pane[field]
    for (const service of manifest.services ?? []) delete service.adopt
  })
  const error = rejects(v3, 'PINAX_INVALID_MANIFEST')
  assert.match(error.message, /pinax-carrier@4/u)
  assert.match(error.message, /volatile|min|max|step/u)
})

test('@4 清单：number 的 min/max/step 与默认值自洽才收', () => {
  rejects(withSettings([{ id: 'n', title: '数', type: 'number', default: 10, min: 20 }]), 'PINAX_INVALID_INPUT')
  rejects(withSettings([{ id: 'n', title: '数', type: 'number', default: 30, min: 12, max: 24 }]), 'PINAX_INVALID_INPUT')
  rejects(withSettings([{ id: 'n', title: '数', type: 'number', default: 13, min: 12, max: 24, step: 2 }]), 'PINAX_INVALID_INPUT')
  rejects(withSettings([{ id: 'n', title: '数', type: 'number', default: 12, min: 12, max: 24, step: 0 }]), 'PINAX_INVALID_INPUT')
  rejects(withSettings([{ id: 's', title: '串', type: 'string', min: 1 }]), 'PINAX_INVALID_INPUT')
  rejects(withSettings([{ id: 'g', title: '组', type: 'section', volatile: true }]), 'PINAX_INVALID_INPUT')
})

// ── 离线 schema：默认＋覆盖合并 ─────────────────────────────────────────────

test('buildSettingsSchema：有效默认值带来源层，number 约束进 JSON Schema', () => {
  const manifests = [{
    id: 'fixture.v4',
    title: '夹具',
    settings: [SETTINGS[0], { id: 'accent', title: '强调色', type: 'string', default: 'olive' }]
  }]
  const schema = buildSettingsSchema(manifests, { 'fixture.v4': { 'font-size': 14, accent: 'rose' } })
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.deepEqual(schema['x-pinax-layers'], ['manifest', 'override'])

  const carrier = schema.properties['fixture.v4']
  const size = carrier.properties['font-size']
  assert.equal(size.type, 'number')
  assert.equal(size.default, 14)
  assert.equal(size.minimum, 12)
  assert.equal(size.maximum, 24)
  assert.equal(size.multipleOf, 1)
  assert.equal(size['x-pinax-source'], 'override')
  assert.equal(size['x-pinax-source-label'], '工程覆盖')
  assert.equal(size['x-pinax-volatile'], true)

  const accent = carrier.properties.accent
  assert.equal(accent.default, 'rose')
  assert.equal(accent['x-pinax-source'], 'override')
  assert.equal(accent['x-pinax-volatile'], false)

  const bad = buildSettingsSchema(manifests, { 'fixture.v4': { 'font-size': 99 } })
  assert.equal(bad.properties['fixture.v4'].properties['font-size'].default, 17)
  assert.equal(bad.properties['fixture.v4'].properties['font-size']['x-pinax-source'], 'manifest')
  assert.ok(bad.warnings.includes('fixture.v4/font-size:SETTING_OUT_OF_RANGE:font-size'))
})
