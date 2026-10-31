import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { CARRIER_SPEC_V3, PANE_KIND_WORDS, validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import { diagnoseCarrier, loadHostDescriptor } from '../doctor.mjs'
import { BUILT_IN_CARRIER_PLUGINS } from '../carriers/index.mjs'
import { LEGACY_VIEW_BINDINGS, legacyBindingForPane } from '../shell/viewRegistry.mjs'
import { collectAgentMdBlocks } from '../runtime/contextProfiles.mjs'

/**
 * 十二块载体按协议 v3 改造后的整体验收。
 *
 * 改造口径（作者裁定的 v3 全套）：
 *   - 清单升 pinax-carrier@3，显式写 manifestVersion: 3；
 *   - 每个 pane 自声明 view 与 kind（不再按 id 前缀猜内容面）；
 *   - 四张牌齐：entry（自带面板）／services（本地服务）／mcp（外部 MCP）／agentMd（作者须知）。
 *
 * 本文件钉三件事：
 *   1) 十二块全部是 @3，且每块 pane 的 kind 与迁移期那张前缀对照表**逐项一致**——
 *      改造不许顺手改渲染语义，kind 对不上就是行为变了
 *      （唯一例外：世界书那两块 pane，批次44 由作者点名改过，例外登记在
 *        KIND_OVERRIDES_BY_PANE_ID 里并照样逐项断言新值）；
 *   2) 每块载体在盘上真有一份 AGENT.md，清单声明的路径与内容对得上（须知不许声明了却不生效）；
 *   3) 十二块对着真宿主描述符全部诊断为 ok。
 */

const CARRIERS_ROOT = fileURLToPath(new URL('../carriers/', import.meta.url))

/** 每块载体该声明的内容面：与迁移期的前缀对照表同源（改造不许改语义）。 */
const EXPECTED_KIND_BY_PREFIX = Object.freeze(
  Object.fromEntries(LEGACY_VIEW_BINDINGS.map((binding) => [binding.prefix, binding.kind]))
)

/**
 * 批次44 的**唯一一处**kind 例外（作者 2026-10-31 点名改的，理由写在这里，不做静默放行）：
 * 「图表列的切换全都挤在左侧小区域里进行，右侧大面积留空，非常别扭，
 *   更合理的一个情况是，上面放图表列，下面放详情信息」
 * 于是世界书这一栏的两块 pane 都不再是文档面：
 *   窄栏那块退成类别导航树（entries-categories），核心区那块做成看板区（entries-workspace）。
 * 迁移期那张前缀对照表本身不改（它还是「v1 → v3 改造不许顺手改语义」的凭据）；
 * 这里只登记这一处被作者点名改掉的例外，并且照样逐项断言新值——放行不等于不查。
 */
const KIND_OVERRIDES_BY_PANE_ID = Object.freeze({
  'worldbook.board': 'entries-categories',
  'worldbook.entries': 'entries-workspace'
})

test('十二块载体全部升到 @3：spec／manifestVersion／四张牌齐，pane 自声明 view 与 kind', () => {
  assert.equal(BUILT_IN_CARRIER_PLUGINS.length, 12, '十二块内置载体（v1.1-A 七块 ＋ M4／M5 五块）')
  const customPanes = []

  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const manifest = plugin.manifest
    const id = manifest.id
    assert.equal(manifest.spec, CARRIER_SPEC_V3, `${id}：清单没升到 ${CARRIER_SPEC_V3}`)
    assert.equal(manifest.manifestVersion, 3, `${id}：manifestVersion 必须显式写 3`)

    // 四张牌必须显式在场（不许靠「不写＝没有」蒙混）：清单里要能一眼看见这四行。
    for (const field of ['entry', 'services', 'mcp', 'agentMd']) {
      assert.ok(field in manifest, `${id}：清单里没有 ${field} 这一行（v3 要求显式声明）`)
    }
    assert.ok(Array.isArray(manifest.services), `${id}：services 必须是数组`)
    assert.ok(Array.isArray(manifest.mcp), `${id}：mcp 必须是数组`)

    const validated = validateCarrierManifest(manifest, { kinds: Object.keys(PROJECT_KINDS) })
    assert.equal(validated.ok, true, `${id}：${JSON.stringify(validated.error ?? {})}`)

    for (const pane of manifest.contributes.panes) {
      assert.ok(typeof pane.view === 'string' && pane.view.startsWith('pinax.view.'), `${id}/${pane.id}：view 必须显式声明`)
      assert.ok(PANE_KIND_WORDS.includes(pane.kind), `${id}/${pane.id}：kind「${String(pane.kind)}」不在词表里`)
      // 自带面板（kind=custom-panel）是 v3 新增的一块内容面，前缀对照表里本来就没有它——
      // 它不受「kind 不许变」的约束，但必须是全十二块里唯一的一块。
      if (pane.kind === 'custom-panel') {
        customPanes.push(`${id}/${pane.id}`)
        assert.equal(pane.view, 'pinax.view.custom', `${id}/${pane.id}：自带面板必须挂在 custom 视图上`)
        continue
      }
      const binding = legacyBindingForPane(pane.id)
      assert.ok(binding, `${id}/${pane.id}：迁移期的前缀对照表里没有这一块 pane`)
      const override = KIND_OVERRIDES_BY_PANE_ID[pane.id]
      const expectedKind = override ?? EXPECTED_KIND_BY_PREFIX[binding.prefix]
      assert.equal(pane.kind, expectedKind,
        override
          ? `${id}/${pane.id}：批次44 把这块的 kind 定成「${override}」（作者点名：上图表列下详情），收到「${pane.kind}」`
          : `${id}/${pane.id}：kind 从「${expectedKind}」变成「${pane.kind}」，改造不许顺手改渲染语义`)
    }
  }

  assert.deepEqual(customPanes, ['pinax.carrier.material/material.panel'],
    '十二块里只有素材那一栏带自带面板（v3 的样板），别的一栏不许悄悄多出面板')
})

test('十二块载体的 AGENT.md 真在盘上：清单声明的路径对得上，文件有内容', async () => {
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const manifest = plugin.manifest
    assert.equal(manifest.agentMd, 'AGENT.md', `${manifest.id}：agentMd 应指向插件目录根下的 AGENT.md`)

    const name = manifest.id.replace(/^pinax\.carrier\./u, '')
    const file = join(CARRIERS_ROOT, name, 'AGENT.md')
    const text = await readFile(file, 'utf-8')
    assert.ok(text.trim().length > 100, `${manifest.id}：AGENT.md 内容太短（${text.trim().length} 字），须知写不下去`)
    // 须知要写清三件事：数据落在哪、有哪些工具、有哪些规矩。
    assert.match(text, /数据/u, `${manifest.id}：AGENT.md 没说数据落在哪`)
    assert.match(text, /工具/u, `${manifest.id}：AGENT.md 没列工具`)
    assert.match(text, /规矩/u, `${manifest.id}：AGENT.md 没写规矩`)
  }
})

test('须知随载体一起装进注册表：启用集里每块都有自己那份 AGENT.md 入口', async () => {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const enabled = BUILT_IN_CARRIER_PLUGINS.map((plugin) => plugin.manifest.id)
  const activation = registry.activate({ primary: 'pinax.carrier.novel', enabled, revision: 1 })
  assert.equal(activation.ok, true, JSON.stringify(activation.error ?? {}))

  const agents = activation.value.agents
  assert.equal(agents.length, 12, '十二块载体各带一份作者须知入口')
  for (const agent of agents) {
    assert.equal(agent.path, 'AGENT.md')
    assert.ok(registry.dirOf(agent.pluginId), `${agent.pluginId}：宿主没登记它的插件目录，须知读不出来`)
  }
})

test('须知真的会进上下文信封：block 的来源指得到那份文件', async () => {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
  }
  const enabled = BUILT_IN_CARRIER_PLUGINS.map((plugin) => plugin.manifest.id)
  const activation = registry.activate({ primary: 'pinax.carrier.novel', enabled, revision: 1 })
  const view = activation.value

  const collected = await collectAgentMdBlocks({ registry, view })
  assert.equal(collected.warnings.length, 0, `须知读取有记账：${collected.warnings.join(' / ')}`)
  assert.equal(collected.blocks.length, 12, '十二块载体的须知都读到了')
  for (const block of collected.blocks) {
    assert.equal(block.kind, 'agent-md')
    assert.equal(block.priority, 1100, '须知排在内容块前面（它是「怎么读这块内容」）')
    assert.match(block.sourceRefs[0], /^agentmd:pinax\.carrier\.[a-z]+\/AGENT\.md$/u)
  }
})

test('十二块载体对着真宿主描述符全部诊断为 ok', () => {
  const loaded = loadHostDescriptor()
  assert.equal(loaded.ok, true)
  const installed = BUILT_IN_CARRIER_PLUGINS.map((plugin) => plugin.manifest)
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    // installed ＝ 十二块都在场：体验那一栏要剧本载体，闭包装不齐时如实报缺口。
    const report = diagnoseCarrier(plugin.manifest, { descriptor: loaded.value, installed })
    assert.equal(report.state, 'ok', `${report.manifestId}：${report.message} → ${report.fix}`)
  }
})
