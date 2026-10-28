import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES, fail, ok } from '../kernel/errors.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'
import { FIXTURE_NOVEL, FIXTURE_WORLDBOOK, withMutation } from '../testing/fixtures.mjs'
import { createNextSession } from '../index.mjs'
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  createIpcDispatcher,
  slimForIpc
} from '../shell/ipcContract.mjs'
import { MENU_TEMPLATE, canCarrierInjectMenu, flattenMenuIds } from '../shell/menus.mjs'
import { OPEN_SLOTS, RESERVED_SLOTS, isReservedSlot, orderActivityItems, slotReason } from '../shell/slots.mjs'
import { PREFS_DEFAULTS, normalizePrefs } from '../runtime/appPreferences.mjs'

/** D1 历史五通道：名字与顺序都钉在门禁里，UI 与主进程共用同一份常量。 */
const HISTORY_CHANNELS = [
  [IPC_CHANNELS.historyList, 'list'],
  [IPC_CHANNELS.historyShow, 'show'],
  [IPC_CHANNELS.historyDiff, 'diff'],
  [IPC_CHANNELS.historyCommitNow, 'commit-now'],
  [IPC_CHANNELS.historyProbe, 'probe']
]

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
  for (const required of ['project.create', 'project.open', 'project.import', 'project.history', 'runtime.ask', 'runtime.tools', 'view.focusRuntime', 'settings.theme', 'settings.carriers']) {
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

  // D1：五条历史通道按工单命名，缺一条 UI 就调不到。
  for (const [channel, suffix] of HISTORY_CHANNELS) {
    assert.ok(channels.includes(channel), `缺历史通道 ${channel}`)
    assert.equal(channel, `pinax:agent:history:${suffix}`)
  }

  const { dispatcher } = harness()
  const rogue = await dispatcher.dispatch('pinax:agent:fs:write-anywhere', { file: '正文/第一章.md' })
  assert.equal(rogue.ok, false)
  assert.equal(rogue.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  const badPayload = await dispatcher.dispatch(IPC_CHANNELS.kernelInfo, 'not-an-object')
  assert.equal(badPayload.ok, false)
  const noProject = await dispatcher.dispatch(IPC_CHANNELS.carrierSetPrimary, { pluginId: 'fixture.novel' })
  assert.equal(noProject.ok, false, '没有已打开的项目时不得改 carriers')
})

test('历史五通道（D1）：未注入时如实报缺，不静默假装可用', async () => {
  const { dispatcher } = harness()
  for (const [channel] of HISTORY_CHANNELS) {
    const result = await dispatcher.dispatch(channel, {})
    assert.equal(result.ok, false, `${channel} 未注入时必须失败`)
    assert.equal(result.error.code, NEXT_ERROR_CODES.INVALID_INPUT, channel)
    assert.match(result.error.message, /历史/, channel)
  }
})

test('历史五通道（D1）：注入后按当前项目根分发；没有项目时如实拒绝', async () => {
  const calls = []
  const gitHistory = {
    listFileHistory: async (args) => { calls.push(['list', args]); return { ok: true, value: [] } },
    readVersion: async (args) => { calls.push(['show', args]); return { ok: true, value: '第一版正文' } },
    diffVersions: async (args) => { calls.push(['diff', args]); return { ok: true, value: { hunks: [] } } }
  }
  const scheduler = {
    requestCommit: async (message) => { calls.push(['commit', message]); return { ok: true, value: { committed: false } } },
    probe: async () => { calls.push(['probe']); return { ok: true, value: { available: true } } }
  }
  const { session } = harness()
  session.projectRoot = 'D:/books/历史书'
  const dispatcher = createIpcDispatcher({ session, history: { gitHistory, scheduler } })
  const oidA = 'a'.repeat(40)
  const oidB = 'b'.repeat(40)

  const listed = await dispatcher.dispatch(IPC_CHANNELS.historyList, { path: '正文/001.md', limit: 10 })
  assert.equal(listed.ok, true)
  assert.deepEqual(calls.at(-1), ['list', { root: 'D:/books/历史书', path: '正文/001.md', limit: 10 }])

  const shown = await dispatcher.dispatch(IPC_CHANNELS.historyShow, { oid: oidA, path: '正文/001.md' })
  assert.equal(shown.value, '第一版正文')
  assert.deepEqual(calls.at(-1), ['show', { root: 'D:/books/历史书', oid: oidA, path: '正文/001.md' }])

  const diffed = await dispatcher.dispatch(IPC_CHANNELS.historyDiff, { a: oidA, b: oidB, path: '正文/001.md' })
  assert.equal(diffed.ok, true)
  assert.deepEqual(calls.at(-1), ['diff', { root: 'D:/books/历史书', a: oidA, b: oidB, path: '正文/001.md' }])

  const committed = await dispatcher.dispatch(IPC_CHANNELS.historyCommitNow, { message: '手动快照' })
  assert.equal(committed.ok, true)
  assert.deepEqual(calls.at(-1), ['commit', '手动快照'])

  const probed = await dispatcher.dispatch(IPC_CHANNELS.historyProbe, {})
  assert.equal(probed.value.available, true)
  assert.deepEqual(calls.at(-1), ['probe'], '探测走调度器（仓库可用性 + 定时器状态）')

  const noProject = createIpcDispatcher({ session: harness().session, history: { gitHistory, scheduler } })
  for (const channel of [IPC_CHANNELS.historyList, IPC_CHANNELS.historyShow, IPC_CHANNELS.historyDiff]) {
    const denied = await noProject.dispatch(channel, { path: '正文/001.md' })
    assert.equal(denied.ok, false, channel)
    assert.match(denied.error.message, /项目/, channel)
  }
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

test('主题偏好字段（D2）：只认 light／dark／null；prefs:set 单写 theme 不重置其它偏好', async () => {
  assert.equal(normalizePrefs({ theme: 'dark' }).value.theme, 'dark')
  assert.equal(normalizePrefs({ theme: 'light' }).value.theme, 'light')
  assert.equal(normalizePrefs({ theme: null }).value.theme, null)
  for (const bad of ['blue', 42, true]) {
    assert.equal(normalizePrefs({ theme: bad }).ok, false, `应拒绝 theme=${JSON.stringify(bad)}`)
  }
  assert.equal('theme' in PREFS_DEFAULTS, false, 'theme 是可选迁移字段：缺省表示还没迁过，由渲染层用老键兜底')

  let captured = null
  const store = {
    read: async () => ({ ok: true, value: { ...PREFS_DEFAULTS } }),
    write: async (patch) => { captured = patch; return { ok: true, value: { ...PREFS_DEFAULTS, ...patch } } }
  }
  const dispatcher = createIpcDispatcher({ session: harness().session, prefs: store })
  const written = await dispatcher.dispatch(IPC_CHANNELS.prefsSet, { theme: 'dark' })
  assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))
  assert.deepEqual(captured, { theme: 'dark' }, '只写 theme：端点/缩放/历史间隔不得被 undefined 顺手重置')
})

test('主进程历史接线（D1）：建仓＋起表＋关窗兜底＋写入标脏钩子都落在 main.mjs', async () => {
  const mainSource = await readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8')
  assert.match(mainSource, /ensureHistoryRepo\(\{\s*root:\s*projectRoot\s*\}\)/, '项目打开后必须建独立历史仓库')
  assert.match(mainSource, /historyScheduler\.start\(\{\s*root:\s*projectRoot/, '建仓后必须起定时提交')
  assert.match(mainSource, /onProjectOpened:\s*beginHistory/, '打开/刷新项目必须触发历史接线')
  assert.match(mainSource, /history:\s*\{\s*gitHistory,\s*scheduler:\s*historyScheduler\s*\}/, 'gitHistory/scheduler 必须经 deps 注入分发器')
  assert.match(mainSource, /setOnWrite\(async \(\{ relativePath \}\)/, '标脏钩子必须读 fileService 的 relativePath')
  assert.match(mainSource, /markDirty\(\{\s*root:\s*projectRoot,\s*paths:\s*\[relativePath\]\s*\}\)/, '写成功后按相对路径标脏')
  assert.match(mainSource, /app\.on\('before-quit'/, '关窗必须兜底提交')
  assert.match(mainSource, /historyScheduler\.beforeQuit\(\)/, '兜底提交走调度器（与定时/手动同一队列）')
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

test('历史间隔（D1）：prefs:set 透传 historyIntervalMinutes，默认 5、0–120 值域', async () => {
  assert.equal(PREFS_DEFAULTS.historyIntervalMinutes, 5, '默认 5 分钟一存')
  let captured = null
  const store = {
    read: async () => ({ ok: true, value: { ...PREFS_DEFAULTS } }),
    write: async (patch) => {
      captured = patch
      return { ok: true, value: { ...PREFS_DEFAULTS, ...patch } }
    }
  }
  const dispatcher = createIpcDispatcher({ session: harness().session, prefs: store })
  const written = await dispatcher.dispatch(IPC_CHANNELS.prefsSet, { historyIntervalMinutes: 0 })
  assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))
  assert.equal(captured.historyIntervalMinutes, 0, '0（关闭定时快照）必须原样透传到偏好存储')

  // 载荷没带这一项时不能凭空写进去：否则每次改缩放/端点都会把间隔重置回默认。
  captured = null
  await dispatcher.dispatch(IPC_CHANNELS.prefsSet, { uiZoom: 0.9 })
  assert.equal('historyIntervalMinutes' in captured, false)

  for (const minutes of [0, 1, 120]) {
    assert.equal(normalizePrefs({ historyIntervalMinutes: minutes }).value.historyIntervalMinutes, minutes)
  }
  for (const bad of [-1, 121, 1.5, '大']) {
    assert.equal(normalizePrefs({ historyIntervalMinutes: bad }).ok, false, `应拒绝 ${JSON.stringify(bad)}`)
  }
})

test('主进程把偏好真正接到网关与窗口：端点 setter、启动即应用、保存即生效都写在 main.mjs', async () => {
  const mainSource = await readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8')
  assert.match(mainSource, /createAppPreferences\(/, '主进程必须创建偏好存储')
  assert.match(mainSource, /applyModelPlaneEndpoint\(stored\.modelPlaneEndpoint\)/, '启动时必须应用已存端点')
  assert.match(mainSource, /prefs,\s*\n\s*probeModelPlane/, '分发器必须注入偏好与探测')
  assert.match(mainSource, /onPrefsApplied/, '保存后的生效钩子必须接上')
  assert.match(mainSource, /showOpenDialog/, '选目录必须走系统对话框（批次9：新项目落点）')
  assert.doesNotMatch(mainSource, /\.\.\/\.\.\/server\//, '外壳不得直接 import server/——端点收在 runtime 层（modelPlaneProbe）')
  const probeSource = await readFile(new URL('../runtime/modelPlaneProbe.mjs', import.meta.url), 'utf-8')
  assert.match(probeSource, /setTaskPlaneEndpoint/, 'runtime 层必须包住网关端点 setter')
  const gatewaySource = await readFile(new URL('../../server/services/kitModelGateway.js', import.meta.url), 'utf-8')
  assert.match(gatewaySource, /export function setTaskPlaneEndpoint/, '网关必须暴露运行时端点 setter')
  assert.match(gatewaySource, /export function getTaskPlaneEndpoint/, '网关必须暴露当前端点 getter（探测与偏好面显示用）')
})

test('IPC 边界净值裁剪（批次11 真窗口克隆 bug）：成功结果的函数被剪掉、数据保留，失败载荷原样', () => {
  const fat = ok({
    root: 'x',
    fileService: { write: () => {}, root: 'x' },
    view: { panes: { center: [{ id: 'p', slots: ['center'] }] } },
    nested: { fn: function fat() {}, list: [1, 'a', () => {}, { deep: { ok: 1 } }] }
  })
  const slim = slimForIpc(fat)
  assert.equal(slim.ok, true)
  assert.equal(slim.value.root, 'x')
  assert.equal(slim.value.fileService, undefined, 'fileService 是内核内部对象，顶层显式剪掉')
  assert.deepEqual(slim.value.view.panes.center, [{ id: 'p', slots: ['center'] }])
  assert.deepEqual(slim.value.nested.list, [1, 'a', { deep: { ok: 1 } }], '数组里的函数剪掉、数据保留')

  const failure = fail('INVALID_INPUT', '失败载荷原样保留')
  assert.deepEqual(slimForIpc(failure), failure)
  assert.equal(slimForIpc('裸值原样'), '裸值原样')

  const mainSource = readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8').then((text) => {
    assert.match(text, /slimForIpc\(await dispatcher\.dispatch/, '主进程 ipcMain.handle 出线必须过净值裁剪')
  })
  return mainSource
})

test('选目录通道（批次9）：注入即通、未注入报缺；projectCreate 把 root 透传给会话', async () => {
  let captured = null
  const session = {
    ...harness().session,
    create: async (args) => { captured = args; return { ok: true, value: {} } }
  }
  const withPick = createIpcDispatcher({ session, pickProjectDir: async () => ({ ok: true, value: { picked: true, path: 'D:/books/new-book' } }) })
  const picked = await withPick.dispatch(IPC_CHANNELS.projectPickDir, {})
  assert.equal(picked.ok, true)
  assert.deepEqual(picked.value, { picked: true, path: 'D:/books/new-book' })

  const created = await withPick.dispatch(IPC_CHANNELS.projectCreate, { name: '新书', primaryCarrier: 'fixture.novel', root: 'D:/books/new-book' })
  assert.equal(created.ok, true)
  assert.equal(captured.root, 'D:/books/new-book', '渲染层选定的目录必须原样到 session.create')
  assert.equal(captured.name, '新书')

  const bare = createIpcDispatcher({ session: harness().session })
  const denied = await bare.dispatch(IPC_CHANNELS.projectPickDir, {})
  assert.equal(denied.ok, false)
  assert.match(String(denied.error?.message), /目录选择未接入/)

  const noRoot = createIpcDispatcher({ session: { ...harness().session, create: async (args) => { captured = args; return { ok: true, value: {} } } } })
  await noRoot.dispatch(IPC_CHANNELS.projectCreate, { name: '旧路径', primaryCarrier: 'fixture.novel' })
  assert.equal(captured.root, null, '不选目录时 root 以 null 透传（会话根兜底语义保持在 index.mjs）')
})

test('导入既有稿通道（E1）：适配器注入即通、dryRun 默认走计划；未注入如实报缺', async () => {
  const calls = []
  const adapter = async (input) => { calls.push(input); return { ok: true, value: { mode: input.dryRun ? 'plan' : 'apply' } } }
  const injected = createIpcDispatcher({ session: harness().session, importProject: adapter })

  const planned = await injected.dispatch(IPC_CHANNELS.projectImportRun, { sourcePath: 'D:/稿子', targetPath: 'D:/books' })
  assert.equal(planned.ok, true)
  assert.deepEqual(calls.at(-1), { sourcePath: 'D:/稿子', targetPath: 'D:/books', dryRun: true }, '缺省必须是计划模式（dryRun:true）')

  await injected.dispatch(IPC_CHANNELS.projectImportRun, { sourcePath: 'D:/稿子', targetPath: 'D:/books', dryRun: false })
  assert.equal(calls.at(-1).dryRun, false, '显式 false 才落盘')

  const bare = createIpcDispatcher({ session: harness().session })
  const missing = await bare.dispatch(IPC_CHANNELS.projectImportRun, { sourcePath: 'D:/稿子', targetPath: 'D:/books' })
  assert.equal(missing.ok, false)
  assert.match(String(missing.error?.message), /导入适配器未接入/)
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
