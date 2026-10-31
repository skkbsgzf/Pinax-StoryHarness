import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { CARRIER_SPEC_V4, PANE_KIND_WORDS, validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import { diagnoseCarrier, loadHostDescriptor } from '../doctor.mjs'
import { BUILT_IN_CARRIER_PLUGINS } from '../carriers/index.mjs'
import { WORLDBOOK_CARRIER } from '../carriers/worldbook/manifest.mjs'
import { LEGACY_VIEW_BINDINGS, legacyBindingForPane } from '../shell/viewRegistry.mjs'
import { collectAgentMdBlocks } from '../runtime/contextProfiles.mjs'

/**
 * 十二块载体按协议 v3 改造后的整体验收（批次53 起全部升 @4）。
 *
 * 改造口径（作者裁定的 v3 全套，批次53 再升 @4）：
 *   - 清单升 pinax-carrier@4，显式写 manifestVersion: 4；
 *   - 每个 pane 自声明 view 与 kind（不再按 id 前缀猜内容面）；
 *   - 四张牌齐：entry（自带面板）／services（本地服务）／mcp（外部 MCP）／agentMd（作者须知）；
 *   - 批次53 起每块 pane 再带 multiplicity／scope／claims（认领语义正面表达形态）。
 *
 * 本文件钉三件事：
 *   1) 十二块全部是 @4，且每块 pane 的 kind 与迁移期那张前缀对照表**逐项一致**——
 *      改造不许顺手改渲染语义，kind 对不上就是行为变了；
 *      世界书那两块 pane 的形态（批次44 作者点名的上图表列下详情）在批次53 改由 @4 认领语义
 *      正面表达（同资源、不同角色），这里直接钉它们的值，不再靠例外表放行；
 *   2) 每块载体在盘上真有一份 AGENT.md，清单声明的路径与内容对得上（须知不许声明了却不生效）；
 *   3) 十二块对着真宿主描述符全部诊断为 ok。
 */

const CARRIERS_ROOT = fileURLToPath(new URL('../carriers/', import.meta.url))

/** 每块载体该声明的内容面：与迁移期的前缀对照表同源（改造不许改语义）。 */
const EXPECTED_KIND_BY_PREFIX = Object.freeze(
  Object.fromEntries(LEGACY_VIEW_BINDINGS.map((binding) => [binding.prefix, binding.kind]))
)

/**
 * 批次44 作者点名的世界书形态（2026-10-31）：
 * 「图表列的切换全都挤在左侧小区域里进行，右侧大面积留空……上面放图表列，下面放详情信息」
 * 窄栏退成类别导航树（entries-categories）、核心区做成看板区（entries-workspace）。
 * 批次53 起这两块 pane 在清单里以 multiplicity／scope／claims 正面表达「同一份世界书资源，
 * 一块 fallback 导航、一块 extension 看板」，例外表随之删除；这里改为逐块直接断言新值——
 * 放行不等于不查，形态一旦回退，这条断言先红。
 */
function assertWorldBookKind(pane) {
  if (pane.id === 'worldbook.board') {
    assert.equal(pane.kind, 'entries-categories', 'worldbook.board：批次44 起窄栏是类别导航树（上图表列、下详情）')
    return true
  }
  if (pane.id === 'worldbook.entries') {
    assert.equal(pane.kind, 'entries-workspace', 'worldbook.entries：批次44 起核心区是看板区（上图表列、下详情）')
    return true
  }
  return false
}

test('十二块载体全部升到 @4：spec／manifestVersion／四张牌齐，pane 自声明 view 与 kind', () => {
  assert.equal(BUILT_IN_CARRIER_PLUGINS.length, 12, '十二块内置载体（v1.1-A 七块 ＋ M4／M5 五块）')
  const customPanes = []
  const appPanes = []

  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const manifest = plugin.manifest
    const id = manifest.id
    assert.equal(manifest.spec, CARRIER_SPEC_V4, `${id}：清单没升到 ${CARRIER_SPEC_V4}`)
    assert.equal(manifest.manifestVersion, 4, `${id}：manifestVersion 必须显式写 4`)

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
      // 应用面（kind=external-app，批次44 新增的内容面）同样不在前缀对照表里：
      // 它是「内嵌浏览器承载外部端口」，不是宿主视图，所以不受「kind 不许变」的约束。
      // 但地址必须显式声明且是回环——这正是 validateAppPane 已经验过的那一道，这里只登记身份。
      if (pane.kind === 'external-app') {
        appPanes.push(`${id}/${pane.id}`)
        assert.equal(pane.view, 'pinax.view.app', `${id}/${pane.id}：应用面必须挂在 app 视图上`)
        assert.ok(String(pane.app?.url ?? '').startsWith('http://127.0.0.1:'), `${id}/${pane.id}：应用面只接本机回环地址`)
        continue
      }
      const binding = legacyBindingForPane(pane.id)
      assert.ok(binding, `${id}/${pane.id}：迁移期的前缀对照表里没有这一块 pane`)
      // 世界书两块是批次44 作者点名的形态，直接钉值；其余按迁移期对照表逐项对齐。
      if (assertWorldBookKind(pane)) continue
      const expectedKind = EXPECTED_KIND_BY_PREFIX[binding.prefix]
      assert.equal(pane.kind, expectedKind,
        `${id}/${pane.id}：kind 从「${expectedKind}」变成「${pane.kind}」，改造不许顺手改渲染语义`)
    }
  }

  assert.deepEqual(customPanes, ['pinax.carrier.material/material.panel'],
    '十二块里只有素材那一栏带自带面板（v3 的样板），别的一栏不许悄悄多出面板')

  // 批次58：画布（toonflow :3010）是十二块里唯一一块应用面——宿主只给内嵌浏览器，不手搓组件。
  assert.deepEqual(appPanes, ['pinax.carrier.comic/comic.canvas'],
    '十二块里只有漫画那一栏带应用面（独立体①的接入面），别的一栏不许悄悄多出应用面')
})

test('世界书两块 pane 的形态由 @4 认领语义正面表达：例外表删除后等价断言仍在', () => {
  const validated = validateCarrierManifest(WORLDBOOK_CARRIER, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validated.ok, true, JSON.stringify(validated.error ?? {}))
  const panes = Object.fromEntries(validated.value.panes.map((pane) => [pane.id, pane]))

  // 形态不回退：窄栏仍是类别导航树、核心区仍是看板区；两块都还挂在原来的槽位上。
  assert.equal(panes['worldbook.board'].slot, 'left-dock')
  assert.equal(panes['worldbook.board'].kind, 'entries-categories')
  assert.equal(panes['worldbook.entries'].slot, 'center')
  assert.equal(panes['worldbook.entries'].kind, 'entries-workspace')

  // 分工改由认领字段正面表达：同一份世界书资源，导航兜底、看板按条目路径扩展接管。
  assert.equal(panes['worldbook.board'].multiplicity, 'single')
  assert.equal(panes['worldbook.board'].scope, 'project')
  assert.deepEqual(panes['worldbook.board'].claims, ['世界书/**'])
  assert.equal(panes['worldbook.board'].takes, 'fallback')

  assert.equal(panes['worldbook.entries'].multiplicity, 'keyed')
  assert.equal(panes['worldbook.entries'].scope, 'entry')
  assert.equal(panes['worldbook.entries'].keyField, 'path')
  assert.deepEqual(panes['worldbook.entries'].claims, ['世界书/**/*.md'])
  assert.equal(panes['worldbook.entries'].takes, 'extension')
  assert.deepEqual(panes['worldbook.entries'].canOpen, { field: 'kind', in: ['entry', 'proposal'] })
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
