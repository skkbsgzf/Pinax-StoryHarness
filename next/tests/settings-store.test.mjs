import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createFileSettingsStore,
  collectSettingDeclarations,
  settingsPath,
  SETTINGS_VERSION
} from '../settingsStore.mjs'
import { createIpcDispatcher, IPC_CHANNELS } from '../shell/ipcContract.mjs'

/**
 * 每插件配置命名空间（批次45 · 任务③）：`.pinax/settings.json` 的读、写闸与 IPC 接线。
 * 只证五件事：原子写往返、坏档回空、白名单拒、类型／enum 校验、内容不变不写盘。
 */

const DECLARATIONS = {
  'pinax.carrier.novel': [
    { id: 'group', title: '排版', type: 'section' },
    { id: 'fontFamily', title: '字体', type: 'string', default: '霞鹜文楷' },
    { id: 'fontSize', title: '字号', type: 'number', default: 17 },
    { id: 'spellcheck', title: '拼写检查', type: 'boolean', default: true },
    { id: 'density', title: '密度', type: 'enum', options: ['compact', 'comfortable'], default: 'comfortable' }
  ],
  'pinax.carrier.outline': []
}

async function makeRoot() {
  return mkdtemp(join(tmpdir(), 'pinax-settings-'))
}

test('原子写往返：set 后文件形状是 { version:1, carriers:{...} }，读回值一致，不留 .tmp', async () => {
  const root = await makeRoot()
  try {
    const store = createFileSettingsStore({ root, declarations: DECLARATIONS })
    assert.equal(store.file, settingsPath(root))

    assert.equal((await store.set('pinax.carrier.novel', 'fontSize', 18)).ok, true)
    assert.equal((await store.set('pinax.carrier.novel', 'spellcheck', false)).ok, true)
    assert.equal((await store.set('pinax.carrier.novel', 'density', 'compact')).ok, true)

    const raw = JSON.parse(await readFile(settingsPath(root), 'utf-8'))
    assert.equal(raw.version, SETTINGS_VERSION)
    assert.deepEqual(raw.carriers['pinax.carrier.novel'], { fontSize: 18, spellcheck: false, density: 'compact' })

    const read = await store.read()
    assert.equal(read.ok, true)
    assert.equal(read.value.exists, true)
    assert.deepEqual(read.value.carriers['pinax.carrier.novel'], { fontSize: 18, spellcheck: false, density: 'compact' })
    assert.deepEqual(read.value.warnings, [])

    const files = await readdir(join(root, '.pinax'))
    assert.deepEqual(files, ['settings.json'], 'tmp 必须被 rename 掉')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('坏档回空并记账：JSON 坏掉按空配置继续，下一次保存整份重写', async () => {
  const root = await makeRoot()
  // 坏档的记账走 console.error：测试要断言它确实只记了一次，必须临时接管这个函数。
  // eslint-disable-next-line no-console
  const originalError = console.error
  const logged = []
  // eslint-disable-next-line no-console
  console.error = (...args) => { logged.push(args.join(' ')) }
  try {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(root, '.pinax'), { recursive: true })
    await writeFile(settingsPath(root), '{ not json', 'utf-8')

    const store = createFileSettingsStore({ root, declarations: DECLARATIONS })
    const read = await store.read()
    assert.equal(read.ok, true)
    assert.deepEqual(read.value.carriers, {})
    assert.deepEqual(read.value.warnings, ['SETTINGS_BAD_JSON'])
    assert.equal(logged.length, 1, '坏档必须有 console 记账')
    assert.match(logged[0], /设置文件不是合法 JSON/u)

    assert.equal((await store.set('pinax.carrier.novel', 'fontSize', 19)).ok, true)
    const rewritten = JSON.parse(await readFile(settingsPath(root), 'utf-8'))
    assert.deepEqual(rewritten.carriers['pinax.carrier.novel'], { fontSize: 19 })
  } finally {
    // eslint-disable-next-line no-console
    console.error = originalError
    await rm(root, { recursive: true, force: true })
  }
})

test('白名单拒：未声明的载体／设置都拒，且一个字节都不写盘', async () => {
  const root = await makeRoot()
  try {
    const store = createFileSettingsStore({ root, declarations: DECLARATIONS })
    const unknownCarrier = await store.set('pinax.carrier.unknown', 'fontSize', 18)
    assert.equal(unknownCarrier.ok, false)
    assert.equal(unknownCarrier.error.code, 'PINAX_SETTING_NOT_DECLARED')

    const unknownSetting = await store.set('pinax.carrier.novel', 'lineHeight', 1.9)
    assert.equal(unknownSetting.ok, false)
    assert.equal(unknownSetting.error.code, 'PINAX_SETTING_NOT_DECLARED')

    const files = await readdir(join(root, '.pinax')).catch(() => [])
    assert.deepEqual(files, [], '拒的时候连 .pinax 目录都不该出现')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('类型与 enum 校验：同型才收，enum 必须在 options 里，section 不存值', async () => {
  const root = await makeRoot()
  try {
    const store = createFileSettingsStore({ root, declarations: DECLARATIONS })

    const badNumber = await store.set('pinax.carrier.novel', 'fontSize', '18')
    assert.equal(badNumber.ok, false)
    assert.equal(badNumber.error.code, 'PINAX_SETTING_TYPE_MISMATCH')
    const nanNumber = await store.set('pinax.carrier.novel', 'fontSize', Number.NaN)
    assert.equal(nanNumber.ok, false)
    assert.equal(nanNumber.error.code, 'PINAX_SETTING_TYPE_MISMATCH')

    const badBoolean = await store.set('pinax.carrier.novel', 'spellcheck', 'yes')
    assert.equal(badBoolean.ok, false)
    const badString = await store.set('pinax.carrier.novel', 'fontFamily', 42)
    assert.equal(badString.ok, false)

    const badEnum = await store.set('pinax.carrier.novel', 'density', 'tiny')
    assert.equal(badEnum.ok, false)
    assert.equal(badEnum.error.code, 'PINAX_SETTING_TYPE_MISMATCH')

    const section = await store.set('pinax.carrier.novel', 'group', 'anything')
    assert.equal(section.ok, false)
    assert.equal(section.error.code, 'PINAX_SETTING_SECTION_NO_VALUE')

    const read = await store.read()
    assert.deepEqual(read.value.carriers, {}, '所有被拒的写入都没有落盘')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('内容不变不写盘：同一值连写两次，第二次 skipped', async () => {
  const root = await makeRoot()
  try {
    const store = createFileSettingsStore({ root, declarations: DECLARATIONS })
    const first = await store.set('pinax.carrier.novel', 'fontSize', 18)
    assert.equal(first.value.skipped, false)
    const second = await store.set('pinax.carrier.novel', 'fontSize', 18)
    assert.equal(second.ok, true)
    assert.equal(second.value.skipped, true, '相同内容不该再写盘')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('声明白名单可从注册表现取（main.mjs 用 getter）：未安装插件即未声明', async () => {
  const root = await makeRoot()
  try {
    const registry = {
      list: () => [{ id: 'pinax.carrier.novel', settings: DECLARATIONS['pinax.carrier.novel'] }]
    }
    const declarations = collectSettingDeclarations(registry)
    assert.deepEqual(declarations, { 'pinax.carrier.novel': DECLARATIONS['pinax.carrier.novel'] })

    const store = createFileSettingsStore({ root, declarations: () => collectSettingDeclarations(registry) })
    assert.equal((await store.set('pinax.carrier.novel', 'fontSize', 20)).ok, true)
    assert.equal((await store.set('pinax.carrier.outline', 'anything', 1)).error.code, 'PINAX_SETTING_NOT_DECLARED')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('IPC：settings:load 返全量 carriers，settings:save 经白名单闸落盘；未注入／无项目如实报缺', async () => {
  const root = await makeRoot()
  try {
    const store = createFileSettingsStore({ root, declarations: DECLARATIONS })
    const session = { projectRoot: root }
    const dispatcher = createIpcDispatcher({ session, settingsStoreFor: () => store })

    const loaded = await dispatcher.dispatch(IPC_CHANNELS.settingsLoad, {})
    assert.equal(loaded.ok, true)
    assert.deepEqual(loaded.value.carriers, {})
    assert.equal(loaded.value.exists, false)

    const saved = await dispatcher.dispatch(IPC_CHANNELS.settingsSave, {
      carrierId: 'pinax.carrier.novel',
      settingId: 'fontSize',
      value: 21
    })
    assert.equal(saved.ok, true)
    assert.equal(saved.value.value, 21)

    const reread = await dispatcher.dispatch(IPC_CHANNELS.settingsLoad, {})
    assert.deepEqual(reread.value.carriers['pinax.carrier.novel'], { fontSize: 21 })

    const denied = await dispatcher.dispatch(IPC_CHANNELS.settingsSave, {
      carrierId: 'pinax.carrier.novel',
      settingId: 'notDeclared',
      value: true
    })
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'PINAX_SETTING_NOT_DECLARED')

    const missing = createIpcDispatcher({ session })
    const missingLoad = await missing.dispatch(IPC_CHANNELS.settingsLoad, {})
    assert.equal(missingLoad.ok, false)
    assert.match(missingLoad.error.message, /配置服务未接入/u)

    const noProject = createIpcDispatcher({ session: { projectRoot: null }, settingsStoreFor: () => store })
    const noProjectSave = await noProject.dispatch(IPC_CHANNELS.settingsSave, {})
    assert.equal(noProjectSave.ok, false)
    assert.match(noProjectSave.error.message, /项目/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
