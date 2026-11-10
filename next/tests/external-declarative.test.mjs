import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { loadDeclarativeFromDir } from '../kernel/pluginLoader.mjs'
import { DECLARATIVE_REFUSED_CODE, createDeclarativeImpl, gateDeclarativeManifest, isDeclarativeImpl } from '../kernel/declarativeImpl.mjs'
import { validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import { diagnoseExternalLoads, DOCTOR_STATES, EXTERNAL_PLUGIN_STATES } from '../doctor.mjs'

/**
 * 批次65a · 装载正式第一波（外部声明型插件）的内核面测试：
 * 声明型闸逐字段拒装、impl 工厂、幂等重入、activate 枚举、doctor 判例。
 * 项目层（ledger／启停落盘／卸载 .trash）在 external-plugins-project.test.mjs。
 */

const FIXTURE_DIR = fileURLToPath(new URL('../testing/fixtures/external-plugins', import.meta.url))

async function loadAll(registry) {
  return loadDeclarativeFromDir(FIXTURE_DIR, { registry })
}

test('① 声明型闸逐字段拒装：tools/services/mcp/entry/commands 各一条 skipped 账，带理由；坏 JSON 与 impl 目录也各归其段', async () => {
  const registry = createRegistry()
  const run = await loadAll(registry)
  const byStage = (stage) => run.skipped.filter((entry) => entry.stage === stage)

  const declarativeRejected = byStage('declarative')
  assert.deepEqual(declarativeRejected.map((entry) => entry.carrierId).sort(),
    ['ext.bad.commands', 'ext.bad.entry', 'ext.bad.mcp', 'ext.bad.services', 'ext.bad.tools'],
    JSON.stringify(run.skipped))
  for (const entry of declarativeRejected) {
    assert.equal(entry.code, DECLARATIVE_REFUSED_CODE)
    const field = entry.carrierId.split('.').pop()
    assert.ok(entry.refused.some((item) => item.field === field), `${field} 必须出现在 refused 里：${JSON.stringify(entry.refused)}`)
    assert.ok(entry.refused.every((item) => typeof item.reason === 'string' && item.reason.length > 0), '每条拒装必须带人话理由')
    assert.equal(registry.get(entry.carrierId), null, '拒装的插件不许进注册表')
  }
  assert.equal(byStage('form').length, 1, '带 impl.mjs 的目录按形态拒装')
  assert.equal(byStage('form')[0].carrierId, 'ext.implprobe')
  assert.equal(byStage('manifest').length, 1, '坏 JSON 停在 manifest 段')
  assert.equal(globalThis.__pinaxImplProbe ?? 0, 0, '红线：第三方 impl 一次都没被执行')

  const loadedIds = run.loaded.map((entry) => entry.carrierId).sort()
  assert.deepEqual(loadedIds, ['ext.clasha', 'ext.clashb', 'ext.fieldnotes', 'ext.quotes'])
  assert.equal(registry.rejected.length, 0, '闸在 loader 前置：坏清单根本不该走到 install')
})

test('② impl 由内核声明式工厂生成：effectCount=1、isDeclarativeImpl 认形、uninstall 拆得干净', async () => {
  const registry = createRegistry()
  await loadAll(registry)
  const impl = registry.impl('ext.fieldnotes')
  assert.ok(isDeclarativeImpl(impl))
  assert.equal(impl.form, 'external-declarative')
  assert.equal(registry.effectCount('ext.fieldnotes'), 1, '声明型也照效应合同注册——卸载链才有东西可拆')
  const removed = registry.uninstall('ext.fieldnotes')
  assert.equal(removed.ok, true)
  assert.ok(removed.value.disposed.some((entry) => entry.source === 'effect' && !entry.error), JSON.stringify(removed.value.disposed))
  assert.equal(registry.effectCount('ext.fieldnotes'), 0)

  const factory = createDeclarativeImpl({ id: 'x.unit' })
  const disposer = factory.setup()
  assert.equal(typeof disposer, 'function', 'registerEffect 合同：setup 必须交回 disposer')
})

test('③ 幂等重入：同 id 同目录不重复 install（registry.rejected 不被 DUPLICATE 污染）；换目录抢同名 id 才拒', async () => {
  const registry = createRegistry()
  await loadAll(registry)
  const rerun = await loadAll(registry)
  assert.equal(rerun.loaded.length, 4)
  assert.ok(rerun.loaded.every((entry) => entry.alreadyInstalled === true))
  assert.equal(rerun.skipped.length, 7, '拒装账原样重放，装载段零噪音')
  assert.equal(registry.rejected.length, 0)

  const workdir = await mkdtemp(join(tmpdir(), 'pinax-65a-idem-'))
  const otherDir = join(workdir, 'ext.quotes')
  await cp(join(FIXTURE_DIR, 'ext.quotes'), otherDir, { recursive: true })
  const clash = await loadDeclarativeFromDir(workdir, { registry })
  assert.equal(clash.loaded.length, 0)
  assert.equal(clash.skipped[0].stage, 'install')
  assert.equal(clash.skipped[0].code, 'PINAX_DUPLICATE_PLUGIN')
  assert.equal(registry.rejected.length, 0, '换目录抢同名 id：loader 自己拒，不去 install 里留 rejected 脏账')
})

test('④ activate 枚举：外部 pane 随启用集进竖条，声明的图标随清单走', async () => {
  const registry = createRegistry()
  await loadAll(registry)
  const activation = registry.activate({ primary: 'ext.fieldnotes', enabled: ['ext.fieldnotes', 'ext.quotes'], revision: 0 })
  assert.equal(activation.ok, true, JSON.stringify(activation.error))
  const rail = activation.value.panes['left-dock']
  assert.deepEqual(rail.map((pane) => pane.id).sort(), ['fieldnotes.nav', 'quotes.wall'])
  // 夹具显式声明 icon:'extensions'（宿主 WorkbenchIcon 在册字形）；不声明时 @4 缺省仍是 'plugin'，
  // 但那枚字形不在老前端图标表里，会回退成问号——外部插件作者要显式挑在册图标，这条写进批次记录 limitations。
  assert.ok(rail.every((pane) => pane.icon === 'extensions' && pane.pluginId.startsWith('ext.')))
})

test('⑤ 声明型闸单测：空数组与 null 是合法声明，只有「有内容」才拒', async () => {
  const base = JSON.parse(await readFile(join(FIXTURE_DIR, 'ext.quotes', 'manifest.json'), 'utf-8'))
  const normalized = validateCarrierManifest(base)
  assert.equal(normalized.ok, true)
  assert.equal(gateDeclarativeManifest(normalized.value).ok, true)
  const withEmptyCommands = validateCarrierManifest({ ...base, contributes: { ...base.contributes, commands: [] } })
  assert.equal(withEmptyCommands.ok, true)
  assert.equal(gateDeclarativeManifest(withEmptyCommands.value).ok, true, 'commands 显式空数组照装')
  const withTools = validateCarrierManifest({ ...base, tools: ['quotes.read'] })
  assert.equal(withTools.ok, true)
  const gated = gateDeclarativeManifest(withTools.value)
  assert.equal(gated.ok, false)
  assert.deepEqual(gated.error.details.refused.map((item) => item.field), ['tools'])
})

test('⑥ doctor 判例：external-declarative／external-rejected 两态，fix 摊出逐字段理由；内置六态原样不动', async () => {
  assert.deepEqual(DOCTOR_STATES, ['ok', 'adopted-external', 'needs-host-upgrade', 'missing-capability', 'permission-denied', 'incompatible-form'])
  assert.deepEqual(EXTERNAL_PLUGIN_STATES, ['external-declarative', 'external-rejected'])
  const registry = createRegistry()
  const run = await loadAll(registry)
  const reports = diagnoseExternalLoads(run)
  const good = reports.find((report) => report.manifestId === 'ext.fieldnotes')
  assert.equal(good.state, 'external-declarative')
  const refused = reports.find((report) => report.manifestId === 'ext.bad.tools')
  assert.equal(refused.state, 'external-rejected')
  assert.match(refused.fix, /工具需要 JS 实现/)
  assert.match(refused.fix, /沙箱未裁|本批暂空|\btools\b/u)
  const form = reports.find((report) => report.manifestId === 'ext.implprobe')
  assert.equal(form.state, 'external-rejected')
  assert.match(form.fix, /删掉 impl\.mjs/)
  const rerun = await loadAll(registry)
  const idempotent = diagnoseExternalLoads(rerun)
  assert.equal(idempotent.filter((report) => report.state === 'external-declarative').length, 4, '幂等重入四条都读作已装载，不是故障')
  assert.equal(idempotent.filter((report) => report.state === 'external-rejected').length, 7, '拒装账原样重放')
  assert.ok(rerun.loaded.every((entry) => entry.alreadyInstalled))
})
