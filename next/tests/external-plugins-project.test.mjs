import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { NOVEL_CARRIER } from '../carriers/novel/manifest.mjs'
import { openProject } from '../project/openProject.mjs'
import { buildProjectDocument, nextCarriers, readProjectDocument, writeProjectDocument } from '../project/projectManifest.mjs'
import { externalPluginsDir, registerExternalPluginsOnOpen, uninstallExternalPlugin } from '../project/externalPlugins.mjs'
import { collectSettingDeclarations, createFileSettingsStore } from '../settingsStore.mjs'

/**
 * 批次65a · 外部声明型插件的项目层测试：打开路径装载 → ledger → 自动启用落盘 →
 * 停用保持 → 卸载进 .trash → 设置白名单吃到外部声明。
 * 全程 os.tmpdir() 隔离目录，不碰真项目。
 */

const FIXTURE_DIR = fileURLToPath(new URL('../testing/fixtures/external-plugins', import.meta.url))
const PLUGINS = ['ext.fieldnotes', 'ext.quotes', 'ext.clasha', 'ext.clashb']

async function makeProject({ enabled = ['ext.fieldnotes'], primary = 'ext.fieldnotes', plugins = PLUGINS } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pinax-65a-proj-'))
  const pluginsDir = externalPluginsDir(root)
  await mkdir(pluginsDir, { recursive: true })
  for (const name of plugins) {
    await cp(join(FIXTURE_DIR, name), join(pluginsDir, name), { recursive: true })
  }
  const document = buildProjectDocument({ projectId: 'p-65a', name: '装载试验', kind: 'generic', primaryCarrier: primary, enabled })
  assert.equal(document.ok, true, JSON.stringify(document.error))
  const written = await writeProjectDocument(root, document.value)
  assert.equal(written.ok, true, JSON.stringify(written.error))
  return { root, document: written.value }
}

test('① openProject 全流程：外部插件随第一次 activate 进竖条；新插件自动启用并落盘；地盘冲突只记账不自动启用', async () => {
  const { root, document } = await makeProject({ enabled: ['ext.fieldnotes'], plugins: ['ext.fieldnotes', 'ext.quotes'] })
  const registry = createRegistry()
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error))
  const railIds = opened.value.view.panes['left-dock'].map((pane) => pane.id)
  assert.ok(railIds.includes('fieldnotes.nav') && railIds.includes('quotes.wall'), railIds.join(','))
  assert.deepEqual(opened.value.external.addedToEnabled, ['ext.quotes'])
  assert.deepEqual(opened.value.external.skipped, [])

  const persisted = await readProjectDocument(root)
  assert.deepEqual(persisted.value.carriers.enabled, ['ext.fieldnotes', 'ext.quotes'])
  assert.equal(persisted.value.carriers.revision, document.carriers.revision + 1, '自动登记也走乐观并发，revision 照加')
  const ledger = JSON.parse(await readFile(join(externalPluginsDir(root), 'ledger.json'), 'utf-8'))
  assert.deepEqual(ledger.ids.sort(), ['ext.fieldnotes', 'ext.quotes'])

  // 外部 dataDirs 走 fileService 同一套闸：自己的目录能写，越界的拒。
  const noteFile = await opened.value.fileService.write({ pluginId: 'ext.fieldnotes', dir: '采访笔记', file: '样例.md', text: '第一段素材', expectedRevision: 0 })
  assert.equal(noteFile.ok, true, JSON.stringify(noteFile.error))
  const outside = await opened.value.fileService.write({ pluginId: 'ext.fieldnotes', dir: '正文', file: '越界.md', text: 'x', expectedRevision: 0 })
  assert.equal(outside.ok, false, '外部插件不得写非自己 dataDirs 的目录')

  // 同 session 重开（注册表还在）：幂等，不重复 install、不再改 enabled。
  const reopened = await openProject({ root, registry })
  assert.equal(reopened.ok, true, JSON.stringify(reopened.error))
  assert.deepEqual(reopened.value.external.addedToEnabled, [])
  assert.equal(registry.rejected.length, 0, '重开不许在 registry.rejected 里留 DUPLICATE 脏账')
})

test('② ledger 分得开「新装」与「停用过」：停用过的外部插件重开不再自动启用，手动启用走原链', async () => {
  const { root, document } = await makeProject()
  const registry = createRegistry()
  const sync1 = await registerExternalPluginsOnOpen(root, registry, document)
  assert.equal(sync1.ok, true, JSON.stringify(sync1.error))
  assert.deepEqual(sync1.value.external.addedToEnabled, ['ext.clasha', 'ext.quotes'], 'fieldnotes 本来就在启用集里：只补账本，不算自动启用；clashb 撞地盘：只进 ledger，不自动启用')
  assert.deepEqual(sync1.value.external.notes.map((note) => `${note.pluginId}:${note.code}`), ['ext.clashb:DIR_CONFLICT_NOT_ENABLED'])

  // 作者停用 ext.quotes 并落盘（carrierSetEnabled 的持久化就是这两步）。
  const current = await readProjectDocument(root)
  const gate = registry.setEnabled('ext.quotes', current.value.carriers, false)
  assert.equal(gate.ok, true)
  const next = nextCarriers(current.value.carriers, { enabled: gate.value.enabled })
  const persisted = await writeProjectDocument(root, { ...current.value, carriers: next.value })
  assert.equal(persisted.ok, true, JSON.stringify(persisted.error))

  // 重开（新 session 的注册表）：ledger 里认识 quotes，不再自动塞回 enabled；clashb 同理。
  const registry2 = createRegistry()
  const sync2 = await registerExternalPluginsOnOpen(root, registry2, persisted.value)
  assert.equal(sync2.ok, true, JSON.stringify(sync2.error))
  assert.deepEqual(sync2.value.external.addedToEnabled, [])
  assert.equal(sync2.value.carriers.enabled.includes('ext.quotes'), false)
  assert.ok(registry2.get('ext.quotes') && registry2.get('ext.clashb'), '装载照装，启用与否另说')

  // 冲突处理完（手动启用链）：setEnabled 只查能力闭包，地盘冲突由 activate 兜底——
  // 启用 clashb 后整体 activate 必须响亮地拒，不静默二主。
  const withClashb = registry2.setEnabled('ext.clashb', { ...persisted.value.carriers, revision: persisted.value.carriers.revision }, true)
  assert.equal(withClashb.ok, true, '能力面上 clashb 可以启用')
  const activated = registry2.activate({ ...persisted.value.carriers, enabled: [...persisted.value.carriers.enabled, 'ext.clashb'] })
  assert.equal(activated.ok, false)
  assert.equal(activated.error.code, 'PINAX_DIR_CONFLICT')
})

test('⑥ 坏清单再修好：拒装不剪账（目录还在），修好后重开仍不自动启用（停用态保持，批次65a 评审补刀）', async () => {
  const { root, document } = await makeProject({ enabled: ['ext.fieldnotes'], plugins: ['ext.fieldnotes', 'ext.quotes'] })
  const registry1 = createRegistry()
  const sync1 = await registerExternalPluginsOnOpen(root, registry1, document)
  assert.equal(sync1.ok, true, JSON.stringify(sync1.error))

  // 作者停用 ext.quotes 并落盘（同②）。
  const current = await readProjectDocument(root)
  const gate = registry1.setEnabled('ext.quotes', current.value.carriers, false)
  assert.equal(gate.ok, true)
  const next = nextCarriers(current.value.carriers, { enabled: gate.value.enabled })
  const persisted = await writeProjectDocument(root, { ...current.value, carriers: next.value })

  // 清单写坏 → 重开：quotes 进 skipped（拒装），但目录还在 → ledger 不剪它。
  const manifestPath = join(externalPluginsDir(root), 'ext.quotes', 'manifest.json')
  const goodManifest = await readFile(manifestPath, 'utf-8')
  await writeFile(manifestPath, '{ 坏 JSON', 'utf-8')
  const registry2 = createRegistry()
  const sync2 = await registerExternalPluginsOnOpen(root, registry2, persisted.value)
  assert.equal(sync2.ok, true, JSON.stringify(sync2.error))
  assert.ok(JSON.stringify(sync2.value.external.skipped).includes('ext.quotes'), '坏清单进 skipped')
  const ledgerRaw = await readFile(join(externalPluginsDir(root), 'ledger.json'), 'utf-8')
  assert.ok(ledgerRaw.includes('ext.quotes'), '拒装不剪账：目录还在就得留着')

  // 修好清单 → 再开：仍不自动启用（停用过的保持停用——本用例钉的就是这条不破）。
  await writeFile(manifestPath, goodManifest, 'utf-8')
  const registry3 = createRegistry()
  const sync3 = await registerExternalPluginsOnOpen(root, registry3, persisted.value)
  assert.equal(sync3.ok, true, JSON.stringify(sync3.error))
  assert.deepEqual(sync3.value.external.addedToEnabled, [], '修好也不自动塞回 enabled（ledger 认识它）')
  assert.equal(sync3.value.carriers.enabled.includes('ext.quotes'), false)
})

test('③ 卸载＝目录进 .pinax/plugins/.trash/<时间戳>/，不是真删；ledger 与 enabled 一起收干净', async () => {
  const { root, document } = await makeProject({ plugins: ['ext.fieldnotes', 'ext.quotes'] })
  const registry = createRegistry()
  const sync = await registerExternalPluginsOnOpen(root, registry, document)
  assert.equal(sync.ok, true, JSON.stringify(sync.error))

  const removed = await uninstallExternalPlugin(root, registry, 'ext.quotes')
  assert.equal(removed.ok, true, JSON.stringify(removed.error))
  assert.equal(await stat(join(externalPluginsDir(root), 'ext.quotes')).then(() => true, () => false), false, '原目录必须离开货架')
  const moved = await readFile(join(removed.value.trashPath, 'manifest.json'), 'utf-8')
  assert.ok(JSON.parse(moved).id === 'ext.quotes', '文件原样躺在回收站里，一个字都不少')
  assert.equal(registry.get('ext.quotes'), null)
  assert.equal(registry.effectCount('ext.quotes'), 0, 'dispose 链拆干净')
  assert.ok(removed.value.disposed.some((entry) => entry.source === 'effect'), JSON.stringify(removed.value.disposed))

  const after = await readProjectDocument(root)
  assert.equal(after.value.carriers.enabled.includes('ext.quotes'), false, '启用集里的它也被摘掉')
  const ledger = JSON.parse(await readFile(join(externalPluginsDir(root), 'ledger.json'), 'utf-8'))
  assert.deepEqual(ledger.ids.sort(), ['ext.fieldnotes'])
  const trashDirs = await readdir(join(externalPluginsDir(root), '.trash'))
  assert.equal(trashDirs.length, 1, '回收站按时间戳一档，卸载两次不互踩')

  // .trash 不参与下次扫描：重开不装载回收站里的插件。
  const registry2 = createRegistry()
  const sync2 = await registerExternalPluginsOnOpen(root, registry2, after.value)
  assert.equal(sync2.ok, true, JSON.stringify(sync2.error))
  assert.equal(registry2.get('ext.quotes'), null)
})

test('④ 卸载闸只认 .pinax/plugins 直下：内置载体与主载体都不许走这条通道', async () => {
  const { root, document } = await makeProject({ plugins: ['ext.fieldnotes'] })
  const registry = createRegistry()
  const sync = await registerExternalPluginsOnOpen(root, registry, document)
  assert.equal(sync.ok, true)
  registry.install(NOVEL_CARRIER, {}, { dir: join(root, '..', 'builtin-somewhere') })

  const builtin = await uninstallExternalPlugin(root, registry, NOVEL_CARRIER.id)
  assert.equal(builtin.ok, false)
  assert.equal(builtin.error.code, 'PINAX_INVALID_INPUT')
  assert.ok(registry.get(NOVEL_CARRIER.id), '拒了就必须一根汗毛没动')

  const primary = await uninstallExternalPlugin(root, registry, 'ext.fieldnotes')
  assert.equal(primary.ok, false)
  assert.equal(primary.error.code, 'PINAX_PRIMARY_CARRIER_MISSING', '主载体先切走再卸')
  assert.ok(registry.get('ext.fieldnotes'), '没挪目录，注册表也还在')

  const ghost = await uninstallExternalPlugin(root, registry, 'ext.never.heard')
  assert.equal(ghost.ok, false)
})

test('⑤ 设置白名单吃到外部声明：volatile 项可写、进 .pinax/settings.json；未声明即拒', async () => {
  const { root, document } = await makeProject({ plugins: ['ext.fieldnotes'] })
  const registry = createRegistry()
  const sync = await registerExternalPluginsOnOpen(root, registry, document)
  assert.equal(sync.ok, true)

  const store = createFileSettingsStore({ root, declarations: collectSettingDeclarations(registry) })
  const written = await store.set('ext.fieldnotes', 'show_archived', true)
  assert.equal(written.ok, true, JSON.stringify(written.error))
  const back = await store.read()
  assert.equal(back.value.carriers['ext.fieldnotes'].show_archived, true)
  assert.equal(back.value.effective['ext.fieldnotes'].show_archived.value, true, '有效值解析也认外部声明')

  const undeclared = await store.set('ext.fieldnotes', 'not_declared', 1)
  assert.equal(undeclared.ok, false)
  assert.equal(undeclared.error.code, 'PINAX_SETTING_NOT_DECLARED')

  // 目录里没放正文也不炸：dataDirs 已由 openProject 的 owned mkdir 兜底（本测试没走 openProject，手验一次落盘文件形状）。
  const raw = JSON.parse(await readFile(join(root, '.pinax', 'settings.json'), 'utf-8'))
  assert.equal(raw.carriers['ext.fieldnotes'].show_archived, true)
  await writeFile(join(root, '.pinax', 'README-65a.txt'), '外部声明型装载测试的隔离目录标记')
})
