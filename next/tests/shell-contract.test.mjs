import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'
import { FIXTURE_NOVEL, FIXTURE_WORLDBOOK, withMutation } from '../testing/fixtures.mjs'
import { createNextSession } from '../index.mjs'
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  createIpcDispatcher
} from '../shell/ipcContract.mjs'
import { MENU_TEMPLATE, canCarrierInjectMenu, flattenMenuIds } from '../shell/menus.mjs'
import { OPEN_SLOTS, RESERVED_SLOTS, isReservedSlot, orderActivityItems, slotReason } from '../shell/slots.mjs'

/**
 * WP4 外壳合同测试：菜单／槽位／IPC 三条线都在纯数据层判定，
 * 判据来自 M1 方案第 3 节 WP4：不装插件时外壳可进入、可打开项目、可在运行时栏问一句话，且运行时栏无法被插件占用。
 */

test('槽位合同：右栏与顶层菜单是保留字，开放槽位只有两个', () => {
  assert.deepEqual(OPEN_SLOTS, ['left-dock', 'center'])
  assert.equal(isReservedSlot('right'), true)
  assert.equal(isReservedSlot('top-menu'), true)
  assert.equal(isReservedSlot('center'), false)
  assert.match(slotReason('right'), /一级公民/)
  assert.match(slotReason('top-menu'), /顶层菜单/)
})

test('载体声明 slot:"right" 在装载这一步就被拒（外壳不必自己防抢地盘）', () => {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const grabbed = registry.install(withMutation(FIXTURE_NOVEL, (manifest) => {
    manifest.panes = [{ slot: 'right', id: 'takeover', title: '抢右栏' }]
  }))
  assert.equal(grabbed.ok, false)
  assert.equal(grabbed.error.code, NEXT_ERROR_CODES.RESERVED_SLOT)
  assert.equal(registry.rejected.at(-1).pluginId, 'fixture.novel')
  assert.equal(registry.list().length, 0, '被拒的插件不得进注册表')
})

test('应用菜单由主进程建立：载体注入顶层菜单一律拒绝，模板 id 可展平分发', async () => {
  const injection = canCarrierInjectMenu({ title: '小说（夹具）' })
  assert.equal(injection.allowed, false)
  assert.match(injection.reason, /顶层菜单/)

  const ids = flattenMenuIds(MENU_TEMPLATE).map((item) => item.id)
  for (const required of ['project.create', 'project.open', 'runtime.ask', 'runtime.tools', 'view.focusRuntime', 'settings.theme']) {
    assert.ok(ids.includes(required), `菜单模板缺 ${required}`)
  }
  assert.equal(new Set(ids).size, ids.length, '菜单 id 不得重复')

  // 顶部那排功能选项（作者口径①）：文件／编辑／视图／运行时／窗口／设置／帮助，一个都不能少。
  assert.deepEqual(MENU_TEMPLATE.map((item) => item.label), ['文件', '编辑', '视图', '运行时', '窗口', '设置', '帮助'])

  const { dispatcher } = harness()
  const foreign = await dispatcher.dispatch(IPC_CHANNELS.menuInvoke, { id: 'carrier.inject-my-menu' })
  assert.equal(foreign.ok, false)
  assert.equal(foreign.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  const known = await dispatcher.dispatch(IPC_CHANNELS.menuInvoke, { id: 'runtime.tools' })
  assert.equal(known.ok, true)
  assert.deepEqual(dispatcher.menuIds.sort(), ids.sort())
})

test('IPC 通道全在 pinax:agent: 命名空间内，未注册通道直接拒', async () => {
  const channels = Object.values(IPC_CHANNELS)
  assert.ok(channels.length >= 10)
  for (const channel of channels) assert.ok(channel.startsWith('pinax:agent:'), channel)
  for (const event of IPC_EVENTS) assert.ok(event.startsWith('pinax:agent:event:'), event)

  const { dispatcher } = harness()
  const rogue = await dispatcher.dispatch('pinax:agent:fs:write-anywhere', { file: '正文/第一章.md' })
  assert.equal(rogue.ok, false)
  assert.equal(rogue.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  const badPayload = await dispatcher.dispatch(IPC_CHANNELS.kernelInfo, 'not-an-object')
  assert.equal(badPayload.ok, false)
  const noProject = await dispatcher.dispatch(IPC_CHANNELS.carrierSetPrimary, { pluginId: 'fixture.novel' })
  assert.equal(noProject.ok, false, '没有已打开的项目时不得改 carriers')
})

test('空框架：不装任何插件，外壳可进入、可打开项目、可在运行时栏问一句话', async () => {
  const workspace = await createTempWorkspace('shell-empty')
  try {
    const root = join(workspace.projects, '空框架项目')
    const session = await createNextSession({ root, autoOpen: false })
    const dispatcher = createIpcDispatcher({ session })

    const bare = await dispatcher.dispatch(IPC_CHANNELS.projectCreateBare, { name: '空框架项目' })
    assert.equal(bare.ok, true, JSON.stringify(bare.error ?? {}))

    const opened = await dispatcher.dispatch(IPC_CHANNELS.projectOpen, { root: bare.value.root })
    assert.equal(opened.ok, false, '裸项目没有主载体，打开必须停在闸门而不是猜类型')
    assert.equal(opened.error.code, NEXT_ERROR_CODES.PRIMARY_CARRIER_MISSING)

    const view = await dispatcher.dispatch(IPC_CHANNELS.view, {})
    assert.equal(view.ok, true)
    assert.equal(view.value.needsPrimary, true)
    assert.equal(view.value.openError.code, NEXT_ERROR_CODES.PRIMARY_CARRIER_MISSING)
    assert.deepEqual(view.value.left, [], '空框架左竖条没有载体条目')
    assert.deepEqual(view.value.center, [])
    assert.equal(view.value.runtime.builtIn, true)
    assert.equal(view.value.runtime.disableable, false)
    assert.equal(view.value.runtime.ownsSlot, 'right')
    assert.equal(view.value.runtime.tools.length, 19, '运行时工具面不依附于任何插件')
    assert.equal(view.value.runtime.started, true, '项目没打开成功时运行时也必须活着')

    // 「问一句话」在 M1 的如实形态：通道通、预算通，但没有模型运行器 → 明确报缺，不编回答。
    const ask = await dispatcher.dispatch(IPC_CHANNELS.runtimeAsk, { question: '这本书现在是什么状态？' })
    assert.equal(ask.ok, false)
    assert.equal(ask.error.code, NEXT_ERROR_CODES.DEPENDENCY_UNMET)
    assert.match(ask.error.message, /runner/)

    const propose = await dispatcher.dispatch(IPC_CHANNELS.runtimePropose, { name: '试写提案', text: '提案正文' })
    assert.equal(propose.ok, false, '未绑定项目文件服务时提案必须拒绝')
    await session.close()
  } finally {
    await workspace.cleanup()
  }
})

test('装了载体：建项目 → 三栏视图有条目 → 提案只落 .pinax/proposals/，正文一个字节不动', async () => {
  const workspace = await createTempWorkspace('shell-carrier')
  try {
    const root = join(workspace.projects, '有载体的书')
    const session = await createNextSession({
      root,
      plugins: [{ manifest: FIXTURE_NOVEL }, { manifest: FIXTURE_WORLDBOOK }],
      autoOpen: false
    })
    const dispatcher = createIpcDispatcher({ session })

    const created = await dispatcher.dispatch(IPC_CHANNELS.projectCreate, { name: '有载体的书', primaryCarrier: 'fixture.novel', extraEnabled: ['fixture.worldbook'] })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))

    const view = await dispatcher.dispatch(IPC_CHANNELS.view, {})
    assert.equal(view.value.needsPrimary, false)
    assert.equal(view.value.project.kind, 'novel')
    assert.equal(view.value.left[0].pluginId, 'fixture.novel', '主载体板块必须置顶')
    assert.ok(view.value.center.some((pane) => pane.id === 'editor'))
    assert.equal(view.value.primary.title, '小说（夹具）')
    assert.deepEqual(view.value.skeletonDirs, [...PROJECT_KINDS.novel])
    assert.equal(view.value.carriers.length, 2)

    const ask = await dispatcher.dispatch(IPC_CHANNELS.runtimeAsk, { question: '第一章现在多少字？' })
    assert.equal(ask.ok, false, '仍未接运行器，这里要的是如实报缺')
    assert.equal(ask.error.code, NEXT_ERROR_CODES.DEPENDENCY_UNMET)

    const proposal = await dispatcher.dispatch(IPC_CHANNELS.runtimePropose, { name: '开篇改稿', text: '运行时提案正文' })
    assert.equal(proposal.ok, true, JSON.stringify(proposal.error ?? {}))
    const proposalText = await readFile(join(created.value.root, '.pinax', 'proposals', '开篇改稿'), 'utf-8')
    assert.match(proposalText, /运行时提案正文/)
    const listed = await readdir(join(created.value.root, '正文'))
    assert.deepEqual(listed, [], '写回只进提案目录，正文目录必须还是空的')

    const revision = view.value.project.revision
    const disabled = await dispatcher.dispatch(IPC_CHANNELS.carrierSetEnabled, { pluginId: 'fixture.worldbook', enabled: false, expectedRevision: revision })
    assert.equal(disabled.ok, true, JSON.stringify(disabled.error ?? {}))
    const afterDisable = await dispatcher.dispatch(IPC_CHANNELS.view, {})
    assert.equal(afterDisable.value.carriers.find((item) => item.id === 'fixture.worldbook').isEnabled, false)
    assert.ok(afterDisable.value.archive.some((item) => item.dir === '世界书'), '停用后目录转只读归档，不删除')

    const staleWrite = await dispatcher.dispatch(IPC_CHANNELS.carrierSetEnabled, { pluginId: 'fixture.worldbook', enabled: true, expectedRevision: revision })
    assert.equal(staleWrite.ok, false, 'revision 已被上一次变更推进，旧版本写入必须拒')
    assert.equal(staleWrite.error.code, NEXT_ERROR_CODES.STALE_REVISION)

    const dropPrimary = await dispatcher.dispatch(IPC_CHANNELS.carrierSetEnabled, { pluginId: 'fixture.novel', enabled: false, expectedRevision: afterDisable.value.project.revision })
    assert.equal(dropPrimary.ok, false, '主载体不允许被停用')
    await session.close()
  } finally {
    await workspace.cleanup()
  }
})

test('主载体置顶由 slots.orderActivityItems 决定，与注册顺序无关', () => {
  const panes = [
    { slot: 'left-dock', id: 'a', pluginId: 'other', order: 0 },
    { slot: 'left-dock', id: 'b', pluginId: 'fixture.novel', order: 5 },
    { slot: 'center', id: 'c', pluginId: 'fixture.novel' }
  ]
  const ordered = orderActivityItems(panes, { primaryPluginId: 'fixture.novel' })
  assert.deepEqual(ordered.map((pane) => pane.id), ['b', 'a'])
  assert.deepEqual(orderActivityItems([], { primaryPluginId: null }), [])
  assert.match(RESERVED_SLOTS.right, /右栏/)
})

/** 外壳源码清单（递归）：样式子目录里的 .mjs 也要被薄依赖门禁扫到。 */
async function collectShellSources(shellDir) {
  const found = []
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(new URL(`${entry.name}/`, dir), rel)
      else if (/\.(mjs|vue|html)$/.test(entry.name)) found.push(rel)
    }
  }
  await walk(shellDir, '')
  return found
}

/**
 * 允许渲染层引用的旧轨叶子件——就这三个。
 * 它们是纯展示/纯指令的叶子模块，引进来不会把老前端那套运行时拖进渲染层；
 * 这一点由下面的「叶子性」断言守住：它们自己只准引 vue / lucide-vue-next / 自己的邻居。
 */
const LEGACY_LEAF_ALLOWED = [
  'src/components/workbench/WorkbenchIcon.vue',
  'src/components/workbench/workbenchTooltip.js',
  'src/components/workbench/WorkbenchTooltip.vue'
]

/** 渲染层不许碰的老轨代码：server/ 与 src/ 的任何引用。 */
const forbiddenPatterns = [/\.\.\/\.\.\/server/, /\.\.\/\.\.\/src/, /from 'server/, /from 'src/]

/**
 * 把允许的旧轨引用（CSS 本体与三个叶子件）从源码里抹掉，剩下的才是「不该有的依赖」。
 * 允许的旧轨依赖只有两类：老前端 CSS 的本体（作者要的「风格复用」），
 * 与三个叶子展示件（图标／提示／提示宿主——纯展示，不牵 store/router/service）。
 */
function scrubAllowedLegacy(text) {
  return text
    .replace(/(?:import|from)\s+['"][^'"]*src\/styles\/[^'"]+\.css['"]/g, '')
    .replace(/(?:import|from)\s+['"][^'"]*src\/components\/workbench\/(?:WorkbenchIcon\.vue|workbenchTooltip\.js|WorkbenchTooltip\.vue)['"]/g, '')
}

test('渲染侧依赖必须薄：外壳源码不引 server/、不引 src/ 的 JS、通道层不碰 electron', async () => {
  const shellDir = new URL('../shell/', import.meta.url)
  const sources = await collectShellSources(shellDir)
  assert.ok(sources.length >= 8, `外壳源码太少：${sources.join(' ')}`)

  for (const name of sources) {
    const text = await readFile(new URL(name, shellDir), 'utf-8')
    const scrubbed = scrubAllowedLegacy(text)
    for (const pattern of forbiddenPatterns) {
      assert.equal(pattern.test(scrubbed), false, `next/shell/${name} 引用了渲染层不该依赖的旧轨代码：${pattern}`)
    }
  }
  // ipcContract／slots／menus 是渲染层与主进程共用的纯数据模块：它们一旦 import electron，jsdom 侧就起不来。
  for (const name of ['ipcContract.mjs', 'slots.mjs', 'menus.mjs']) {
    const text = await readFile(new URL(name, shellDir), 'utf-8')
    assert.equal(/from 'electron'/.test(text), false, `next/shell/${name} 不得直接依赖 electron`)
  }
  // 合同常量必须是叶子模块，否则渲染层会顺着 agentRuntime 拖进整张 MCP 工具面。
  const ipcText = await readFile(new URL('ipcContract.mjs', shellDir), 'utf-8')
  assert.equal(/agentRuntime/.test(ipcText), false, 'ipcContract 只能引 runtimeContract 叶子，不能引运行时实现')
})

test('旧轨只许引那三个叶子件：图标／提示／提示宿主，且它们自己不带老前端运行时', async () => {
  const repoRoot = new URL('../../', import.meta.url)
  for (const rel of LEGACY_LEAF_ALLOWED) {
    const text = await readFile(new URL(rel, repoRoot), 'utf-8')
    const imports = [...text.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
    for (const specifier of imports) {
      assert.ok(
        specifier === 'vue' || specifier === 'lucide-vue-next' || specifier.startsWith('./'),
        `${rel} 引了不该有的依赖：${specifier}（叶子件只能引 vue／lucide-vue-next／自己的邻居）`
      )
    }
  }
})

test('外壳引旧轨叶子件只引这三个：一个都不许多', async () => {
  const shellDir = new URL('../shell/', import.meta.url)
  const sources = await collectShellSources(shellDir)
  const used = new Set()
  for (const name of sources) {
    const text = await readFile(new URL(name, shellDir), 'utf-8')
    for (const match of text.matchAll(/(?:import|from)\s+['"]([^'"]*src\/[^'"]+)['"]/g)) {
      const specifier = match[1].replace(/^.*?src\//, 'src/')
      if (specifier.startsWith('src/styles/')) continue
      used.add(specifier)
    }
  }
  assert.deepEqual([...used].sort(), [...LEGACY_LEAF_ALLOWED].sort(), `外壳引了白名单之外的旧轨模块：${[...used].join(' ')}`)
})

test('真模型这条链在主进程里接线：外壳必须注入进程内 advisor 运行器（否则「运行时能问」永远答不了）', async () => {
  const mainSource = await readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8')
  assert.match(mainSource, /createAdvisorRunner\(\)/, '外壳主进程必须装进程内 advisor 运行器')
  assert.match(mainSource, /runtimeOptions:\s*\{\s*runner:/, '运行器必须经 runtimeOptions 注入（测试与验收刻意不注入，好留住那条如实失败路径）')

  // 模型面端点必须可被 env 覆写：默认端点写死在 8451，装机到别的机器就只能得到那句「未检测到可用模型」。
  const gateway = await readFile(new URL('../../server/services/kitModelGateway.js', import.meta.url), 'utf-8')
  assert.match(gateway, /process\.env\.PINAX_ADAPTER_ENDPOINT\s*\|\|\s*KIT_TASK_PLANE_ENDPOINT/, '模型面端点必须允许 env 覆写')
})

test('界面缩放是产品参数不是巧合：默认 0.85（作者口径）且 env 可覆写，菜单里有缩放入口', async () => {
  const mainSource = await readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8')
  assert.match(mainSource, /PINAX_NEXT_ZOOM/, '缩放必须可用 PINAX_NEXT_ZOOM 覆写')
  assert.match(mainSource, /zoomFactor:\s*uiZoom/, '窗口 webPreferences 必须落 zoomFactor')
  assert.match(mainSource, /0\.85/, '默认缩放＝作者口径 0.85')
  const menuSource = await readFile(new URL('../shell/menus.mjs', import.meta.url), 'utf-8')
  assert.match(menuSource, /role:\s*'resetZoom'/, '视图菜单要有重置缩放')
  assert.match(menuSource, /role:\s*'zoomIn'/, '视图菜单要有放大')
  assert.match(menuSource, /role:\s*'zoomOut'/, '视图菜单要有缩小')
})

test('偏好通道（批次8①）：读/写/探测三分，写后生效钩子必须被调，存储未注入时如实报缺', async () => {
  const applied = []
  const store = {
    read: async () => ({ ok: true, value: { modelPlaneEndpoint: null, uiZoom: 0.85 } }),
    write: async (patch) => ({ ok: true, value: { modelPlaneEndpoint: patch.modelPlaneEndpoint ?? null, uiZoom: patch.uiZoom ?? null } })
  }
  const probe = async () => ({ ok: true, value: { state: 'unreachable', endpoint: 'http://127.0.0.1:8451', detail: '拒绝连接' } })
  const { session } = harness()
  const dispatcher = createIpcDispatcher({ session, prefs: store, probeModelPlane: probe, onPrefsApplied: async (value) => applied.push(value) })

  const got = await dispatcher.dispatch(IPC_CHANNELS.prefsGet, {})
  assert.equal(got.ok, true)
  assert.deepEqual(got.value, { modelPlaneEndpoint: null, uiZoom: 0.85 })

  const set = await dispatcher.dispatch(IPC_CHANNELS.prefsSet, { modelPlaneEndpoint: 'http://127.0.0.1:8461', uiZoom: 0.9 })
  assert.equal(set.ok, true)
  assert.equal(set.value.modelPlaneEndpoint, 'http://127.0.0.1:8461')
  assert.equal(applied.length, 1, '写成功后必须调 onPrefsApplied（端点/缩放在此生效）')
  assert.deepEqual(applied[0], { modelPlaneEndpoint: 'http://127.0.0.1:8461', uiZoom: 0.9 })

  const probed = await dispatcher.dispatch(IPC_CHANNELS.prefsProbeModelPlane, {})
  assert.equal(probed.ok, true)
  assert.equal(probed.value.state, 'unreachable')

  const bare = createIpcDispatcher({ session: harness().session })
  const denied = await bare.dispatch(IPC_CHANNELS.prefsSet, { modelPlaneEndpoint: 'http://127.0.0.1:8461' })
  assert.equal(denied.ok, false)
  assert.match(String(denied.error?.message), /偏好存储未接入/)
  const deniedProbe = await bare.dispatch(IPC_CHANNELS.prefsProbeModelPlane, {})
  assert.match(String(deniedProbe.error?.message), /探测未接入/)
})

test('主进程把偏好真正接到网关与窗口：端点 setter、启动即应用、保存即生效都写在 main.mjs', async () => {
  const mainSource = await readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8')
  assert.match(mainSource, /createAppPreferences\(/, '主进程必须创建偏好存储')
  assert.match(mainSource, /applyModelPlaneEndpoint\(stored\.modelPlaneEndpoint\)/, '启动时必须应用已存端点')
  assert.match(mainSource, /prefs,\s*\n\s*probeModelPlane/, '分发器必须注入偏好与探测')
  assert.match(mainSource, /onPrefsApplied/, '保存后的生效钩子必须接上')
  assert.doesNotMatch(mainSource, /\.\.\/\.\.\/server\//, '外壳不得直接 import server/——端点收在 runtime 层（modelPlaneProbe）')
  const probeSource = await readFile(new URL('../runtime/modelPlaneProbe.mjs', import.meta.url), 'utf-8')
  assert.match(probeSource, /setTaskPlaneEndpoint/, 'runtime 层必须包住网关端点 setter')
  const gatewaySource = await readFile(new URL('../../server/services/kitModelGateway.js', import.meta.url), 'utf-8')
  assert.match(gatewaySource, /export function setTaskPlaneEndpoint/, '网关必须暴露运行时端点 setter')
  assert.match(gatewaySource, /export function getTaskPlaneEndpoint/, '网关必须暴露当前端点 getter（探测与偏好面显示用）')
})

function harness() {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const session = {
    kernel: { kinds: Object.keys(PROJECT_KINDS) },
    registry,
    project: null,
    runtime: null,
    view: null,
    lastFailure: null
  }
  return { session, dispatcher: createIpcDispatcher({ session }) }
}
