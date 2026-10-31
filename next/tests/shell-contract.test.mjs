import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
import { PREFS_DEFAULTS, createAppPreferences, normalizePrefs } from '../runtime/appPreferences.mjs'

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

test('槽位合同：右栏与顶层菜单是保留字，开放槽位是左右竖条/中栏/悬浮窗三个', () => {
  // 协议 v1.1-C：overlay（悬浮小工具窗）是第三个开放槽位；载体只声明意图与宽度，定位归宿主。
  assert.deepEqual(OPEN_SLOTS, ['left-dock', 'center', 'overlay'])
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
  for (const required of [
    // 项目组（工单A：文件组改名；提案目录从运行时组并入）
    'project.create', 'project.open', 'project.import', 'project.backup', 'project.history', 'project.proposals', 'app.quit',
    // 编辑组：全部带 id，页内菜单行点得动（主进程落到 webContents 的编辑命令）
    'edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.selectAll',
    // 设置组与帮助组
    'settings.preferences', 'settings.carriers', 'settings.theme', 'help.spec', 'help.gate'
  ]) {
    assert.ok(ids.includes(required), `菜单模板缺 ${required}`)
  }
  // 被裁掉的组：最近项目（未实现）、视图（焦点×3/缩放）、运行时（提问/工具面/提案目录改名）——id 一个都不许留下。
  for (const removed of ['project.recent', 'view.focusLeft', 'view.focusCenter', 'view.focusRuntime', 'runtime.ask', 'runtime.tools', 'runtime.proposals']) {
    assert.equal(ids.includes(removed), false, `菜单精简后不应再有 ${removed}`)
  }
  assert.equal(new Set(ids).size, ids.length, '菜单 id 不得重复')

  // 作者裁定（工单A）：顶部只剩四组——项目／编辑／设置／帮助。
  assert.deepEqual(MENU_TEMPLATE.map((item) => item.label), ['项目', '编辑', '设置', '帮助'])

  const { dispatcher } = harness()
  const foreign = await dispatcher.dispatch(IPC_CHANNELS.menuInvoke, { id: 'carrier.inject-my-menu' })
  assert.equal(foreign.ok, false)
  assert.equal(foreign.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  const known = await dispatcher.dispatch(IPC_CHANNELS.menuInvoke, { id: 'project.proposals' })
  assert.equal(known.ok, true)
  assert.deepEqual(dispatcher.menuIds.sort(), ids.sort())
})

test('标题栏与页内菜单行（工单F）：overlay 留给原生窗控，可见菜单仍是同一份 MENU_TEMPLATE', async () => {
  // 主进程：自绘标题栏＋原生窗控浮层；原生应用菜单保留（accelerator 那一半靠它）。
  const mainSource = await readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8')
  assert.match(mainSource, /titleBarStyle:\s*'hidden'/, '窗口必须走隐藏标题栏（渲染层自绘 .nx-titlebar）')
  assert.match(mainSource, /titleBarOverlay/, '原生窗控必须以浮层形式保留（titleBarOverlay）')
  assert.match(mainSource, /Menu\.setApplicationMenu/, '原生应用菜单不得删除：accelerator 仍由它提供')

  // 工单A：编辑组的 id 要真的落到窗口的编辑命令（页内菜单行点得动；原生菜单那一半是 role）。
  assert.match(mainSource, /EDIT_MENU_COMMANDS/, '编辑组必须有 id→webContents 命令表')
  for (const command of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
    assert.match(mainSource, new RegExp(`'edit\\.${command}':\\s*'${command}'`), `编辑命令表缺 edit.${command}`)
  }
  assert.match(mainSource, /contents\?\.\[editCommand\]\?\.\(\)/, '编辑命令必须落到窗口 webContents（窗口已关时判空）')

  // 渲染层：页内菜单行用同一份模板渲染，点击走 menuInvoke 通道（与原生菜单同一条分发）。
  const appSource = await readFile(new URL('../shell/AppNext.vue', import.meta.url), 'utf-8')
  assert.match(appSource, /import \{ MENU_TEMPLATE \} from '\.\/menus\.mjs'/, '页内菜单行必须用同一份 MENU_TEMPLATE 数据渲染')
  assert.match(appSource, /IPC_CHANNELS\.menuInvoke/, '页内菜单点击必须经 menuInvoke 通道分发')
  assert.match(appSource, /IPC_CHANNELS\.projectPickDir/, '打开项目必须先经系统目录对话框（project:pick-dir）')
  assert.match(appSource, /IPC_CHANNELS\.projectOpen/, '选中的目录必须经 project:open 打开')
  // 作者反馈②的整条链：pickDir 取消即返回，成功才 projectOpen，最后 refresh。
  assert.match(appSource, /picked\.value\?\.picked/, '取消选择时不得继续打开项目')
  assert.match(appSource, /projectOpen, \{ root: picked\.value\.path \}\)/, 'project:open 的载荷必须带选中的 root')

  // 无项目形态（反馈③）：竖条数据来自 registry.list() 的 carriers，而不是已打开项目的 view。
  const railSource = await readFile(new URL('../shell/ActivityRail.vue', import.meta.url), 'utf-8')
  assert.match(railSource, /carriers: \{ type: Array/, '竖条必须能收到 registry.list() 的载体清单')
  assert.match(railSource, /aria-disabled="true"/, '无项目时的载体格必须是禁用态')
  assert.match(railSource, /打开项目后可用/, '无项目时的载体格必须说明原因')
  assert.match(appSource, /:carriers="carriers"/, 'AppNext 必须把 carriers 传给竖条')
})

test('主题通知与原生窗控浮层（收口包⑤）：prefs:theme 通道存在且只做副作用，浮层随主题与缩放重设', async () => {
  // 通道在合同表里（渲染层经同一张表拿到白名单），命名与其它通道同一命名空间。
  assert.equal(IPC_CHANNELS.prefsTheme, 'pinax:agent:prefs:theme')

  const applied = []
  const dispatcher = createIpcDispatcher({ session: harness().session, onThemeChanged: async (theme) => applied.push(theme) })
  const notified = await dispatcher.dispatch(IPC_CHANNELS.prefsTheme, { theme: 'dark' })
  assert.equal(notified.ok, true, JSON.stringify(notified.error ?? {}))
  assert.deepEqual(applied, ['dark'], 'prefs:theme 必须把主题交给主进程的副作用钩子')
  assert.equal(notified.value.applied, true)
  assert.equal(notified.value.theme, 'dark')

  // 通知不是请求：不是 light／dark 的载荷按参数错误拒（不让一条坏消息把浮层设成非法色）。
  const bad = await dispatcher.dispatch(IPC_CHANNELS.prefsTheme, { theme: 'blue' })
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  // 未注入钩子：通知语义下不当作数据请求失败，如实返回 applied:false。
  const bare = await createIpcDispatcher({ session: harness().session }).dispatch(IPC_CHANNELS.prefsTheme, { theme: 'light' })
  assert.equal(bare.ok, true)
  assert.equal(bare.value.applied, false)

  // 主进程：浮层常量的两档 --text-muted、height 按缩放折算、三个触发点都在 main.mjs。
  const mainSource = await readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8')
  assert.match(mainSource, /setTitleBarOverlay\(/, '必须调用 window.setTitleBarOverlay 重设浮层')
  assert.match(mainSource, /light:\s*'#6b6b6b'/, 'light 档 symbolColor 要落常量表')
  assert.match(mainSource, /dark:\s*'#9b9b9b'/, 'dark 档 symbolColor 要落常量表')
  assert.match(mainSource, /Math\.round\(TITLEBAR_OVERLAY\.height \* scale\)/, 'height 必须按 Math.round(36 * zoom) 折算（DIP）')
  const triggers = mainSource.match(/updateTitleBarOverlay\(\{ theme: currentScheme, zoom: currentUiZoom \}\)/g) ?? []
  assert.ok(triggers.length >= 2, '启动与 onPrefsApplied 两处都必须重设浮层')
  assert.match(mainSource, /onThemeChanged:\s*async \(theme\)/, 'prefs:theme 通知必须接到同一个重设函数')
  assert.match(mainSource, /titleBarOverlay:\s*titleBarOverlayOptions\(\{ theme, zoom: uiZoom \}\)/, '建窗首帧就按主题/缩放给浮层')

  // 渲染层：writeScheme 落完主题就发通知（fire-and-forget，不是请求-应答）。
  const themeSource = await readFile(new URL('../shell/theme.mjs', import.meta.url), 'utf-8')
  assert.match(themeSource, /import \{ IPC_CHANNELS \} from '\.\/ipcContract\.mjs'/, '主题模块从通道合同取名字，不自造字符串')
  assert.match(themeSource, /applyScheme\(next\)\s*\n\s*notifyThemeChanged\(next\)/, 'writeScheme 落完主题必须通知主进程')
  assert.match(themeSource, /globalThis\.pinaxNext\?\.request\?\.\(IPC_CHANNELS\.prefsTheme, \{ theme: scheme \}\)/, '通知走现有 request 桥（preload 白名单随通道表自动放行）')
  assert.match(themeSource, /sent\?\.catch\?\.\(\(\) => \{\}\)/, '通知失败必须静默：主题已落地，不因桥不在而回滚')

  // 行为侧：writeScheme 真调一次桥（node 里没有 document/localStorage，applyScheme/双写各自走自己的空路径）。
  const { writeScheme } = await import('../shell/theme.mjs')
  const sent = []
  globalThis.pinaxNext = { request: (channel, payload) => { sent.push([channel, payload]); return Promise.resolve({ ok: true }) } }
  try {
    assert.equal(writeScheme('dark'), 'dark')
    assert.deepEqual(sent, [[IPC_CHANNELS.prefsTheme, { theme: 'dark' }]], 'writeScheme 必须把主题经 prefs:theme 发给主进程')
    sent.length = 0
    // 非法主题回默认 light，通知里也必须是落地的那个值（不是原始输入）。
    assert.equal(writeScheme('blue'), 'light')
    assert.deepEqual(sent, [[IPC_CHANNELS.prefsTheme, { theme: 'light' }]])
  } finally {
    delete globalThis.pinaxNext
  }
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
    // 批次45：运行时自身仍不可停用（disableable=false）；载体停用走重建＋pane 关闭＋工作区清理。
    // 这条断言守的是「运行时与载体启停是两回事」，不是「载体不能禁用」。
    assert.equal(view.value.runtime.disableable, false)
    assert.equal(view.value.runtime.ownsSlot, 'right')
    assert.equal(view.value.runtime.tools.length, 21, '运行时工具面不依附于任何插件（内核 19 ＋ 技能读取 1 ＋ 服务日志读取 1）')
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
      // 小说夹具声明一条设置节：它必须穿过内核白名单与 shellView 两处透到渲染层（P14 第二步）。
      plugins: [{ manifest: withMutation(FIXTURE_NOVEL, (m) => { m.settings = [{ id: 'novel.writing', title: '写作偏好' }] }) }, { manifest: FIXTURE_WORLDBOOK }],
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
    assert.deepEqual(
      view.value.carriers.find((item) => item.id === 'fixture.novel').settings,
      [{ id: 'novel.writing', title: '写作偏好', type: 'section' }],
      '载体声明的 settings 必须穿过内核白名单与 shellView，原样到渲染层（P14 第二步；v1 的 {id,title} 归一成 section）'
    )
    assert.deepEqual(
      view.value.carriers.find((item) => item.id === 'fixture.worldbook').settings,
      [],
      '没声明 settings 的载体按空数组透出：设置页据此不出目录项'
    )

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
  // 批次37：运行器不再裸装——工具循环是它的可选接线，缺了这一句等于「有模型、不会用工具」。
  // 批次50：工具循环工厂多收一份公共池（后缀兜底 warn／提交审计要落进 serviceLogPool）。
  assert.match(mainSource, /createAdvisorRunner\(\{\s*toolLoop:\s*createProjectToolLoop\(\{ serviceLogPool \}\)\s*\}\)/, '外壳主进程必须装进程内 advisor 运行器并接上工具循环')
  assert.match(mainSource, /runtimeOptions:\s*\{\s*runner:/, '运行器必须经 runtimeOptions 注入（测试与验收刻意不注入，好留住那条如实失败路径）')

  // 模型面端点必须可被 env 覆写：默认端点写死在 8451，装机到别的机器就只能得到那句「未检测到可用模型」。
  const gateway = await readFile(new URL('../../server/services/kitModelGateway.js', import.meta.url), 'utf-8')
  assert.match(gateway, /process\.env\.PINAX_ADAPTER_ENDPOINT\s*\|\|\s*KIT_TASK_PLANE_ENDPOINT/, '模型面端点必须允许 env 覆写')
})

test('批次37 主进程三件接线：单实例锁闸住装配、项目事件转 IPC 推送、工具循环带写策略与提案店', async () => {
  const mainSource = await readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8')

  // 单实例锁（附条）：抢不到锁直接退出，且装配入口必须认这把锁——否则「退出」只关了个空壳。
  assert.match(mainSource, /const singleInstanceLock = typeof app\.requestSingleInstanceLock === 'function'/, '锁的申请要有非 Electron 环境的兜底')
  assert.match(mainSource, /if \(!singleInstanceLock\) app\.quit\(\)/, '抢不到锁必须 quit')
  assert.match(mainSource, /app\.on\('second-instance'/, '第二实例要把已有窗口提到前台')
  assert.match(mainSource, /if \(invokedDirectly && singleInstanceLock\)/, '装配/建窗必须被锁闸住')

  // 项目事件：唯一的写盘钩子先发总线事件，再由历史是否就绪决定标脏；推送走 IPC_EVENT.projectEvent。
  assert.match(mainSource, /fileService\.setOnWrite\(async \(\{ relativePath \}\) => \{\s*const kind = projectEventKindForPath\(relativePath\)/s, '写盘钩子必须先做路径→事件映射')
  assert.match(mainSource, /if \(kind\) emitProjectEvent\(projectRoot, \{ kind \}\)/, '认得出的路径必须发事件')
  // 批次51：订阅不再靠手工 detach 变量，而是走 registerEffect 托管的效应栈（带 owner 可观测计数）。
  assert.match(mainSource, /subscribeProjectEventsEffect\([\s\S]*?sendToRenderer\(IPC_EVENT\.projectEvent/, '当前项目根要有一份经 registerEffect 的订阅并转成渲染层推送')
  assert.match(mainSource, /onProjectClosed[\s\S]*?disposeHostEffects\(HOST_EFFECT_OWNERS\.projectEvents\)/, '关项目必须回卷项目事件效应栈，旧根事件不得再推')
  // 服务事件（supervisor push）同样是可逆效应，不许裸绑一个永不退订的推送。
  assert.match(mainSource, /registerEffect\(HOST_EFFECT_OWNERS\.serviceEvents/, '服务事件推送要经 registerEffect 托管')

  // 工具循环：模型面、工具面、策略、提案店四件都要真接上，缺一件就是「循环空转」。
  assert.match(mainSource, /createToolLoop\(\{/, '主进程要真有工具循环工厂')
  // 批次50：模型回合与工具循环共用一条拦截点链（写族闸／提交审计），模型回合不再是裸调。
  assert.match(mainSource, /createKitToolTurn\(\{ interceptors: toolInterceptors \}\)/, '模型回合走 kit 任务面，并过同一条拦截点链')
  assert.match(mainSource, /createInterceptorChain\(\{[\s\S]*?createWriteGuardInterceptor[\s\S]*?createWriteAuditInterceptor/, '写族闸与审计环要接进同一条链')
  assert.match(mainSource, /selectTools\(/, '工具面按意图/技能/写模式筛选')
  assert.match(mainSource, /createWritePolicy\(\{\s*mode: writeMode,/, '写模式来自会话真值，不写死')
  assert.match(mainSource, /landing: \{ \.\.\.KERNEL_WRITE_CLASS, \.\.\.CARRIER_WRITE_CLASS \}/, '落点表必须是内核＋载体两份写类')
  assert.match(mainSource, /createProposalStore\(\{\s*fileService:/, 'review 档的提案要落到当前项目的文件服务')
  assert.match(mainSource, /stage === 'proposal-created'[\s\S]*?emitProjectEvent\([^)]*proposals-changed/, '生成提案也要推动提案列表刷新')
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

test('写作偏好通道（工单B）：prefs:set 把 writingFontSize／writingLineHeight 透传到真偏好存储，patch 语义不重置其它字段', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-prefs-ipc-'))
  try {
    // 真 appPreferences 实例（不是 mock store）：证明 IPC 层的白名单真的把两个字段抄进去了。
    const prefs = createAppPreferences({ file: join(dir, 'next-preferences.json') })
    const dispatcher = createIpcDispatcher({ session: harness().session, prefs })
    const written = await dispatcher.dispatch(IPC_CHANNELS.prefsSet, { writingFontSize: 20, writingLineHeight: 2 })
    assert.equal(written.ok, true, JSON.stringify(written.error ?? {}))
    assert.equal(written.value.writingFontSize, 20)
    assert.equal(written.value.writingLineHeight, 2, '2 是 0.05 的整步进，落盘应归一为 2')

    const reread = await prefs.read()
    assert.equal(reread.value.writingFontSize, 20)
    assert.equal(reread.value.writingLineHeight, 2)
    const onDisk = JSON.parse(await readFile(join(dir, 'next-preferences.json'), 'utf-8'))
    assert.equal(onDisk.writingFontSize, 20, '偏好文件里必须真的有这个字段')
    assert.equal(onDisk.writingLineHeight, 2)

    // 「载荷带哪个字段才写哪个」：只改缩放不得把写作偏好重置回默认（批次21 修的关键行为）。
    const zoomed = await dispatcher.dispatch(IPC_CHANNELS.prefsSet, { uiZoom: 0.95 })
    assert.equal(zoomed.ok, true, JSON.stringify(zoomed.error ?? {}))
    assert.equal(zoomed.value.writingFontSize, 20)
    assert.equal(zoomed.value.writingLineHeight, 2)

    // 白名单不绕过值域：越界在真存储层被拒，已存值不被污染。
    const bad = await dispatcher.dispatch(IPC_CHANNELS.prefsSet, { writingFontSize: 99 })
    assert.equal(bad.ok, false)
    assert.match(String(bad.error?.message), /14–22/)
    assert.equal((await prefs.read()).value.writingFontSize, 20)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
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

test('界面缩放是产品参数不是巧合：默认 0.85（作者口径）且 env 可覆写，唯一入口在偏好节', async () => {
  const mainSource = await readFile(new URL('../shell/main.mjs', import.meta.url), 'utf-8')
  assert.match(mainSource, /PINAX_NEXT_ZOOM/, '缩放必须可用 PINAX_NEXT_ZOOM 覆写')
  assert.match(mainSource, /zoomFactor:\s*uiZoom/, '窗口 webPreferences 必须落 zoomFactor')
  assert.match(mainSource, /0\.85/, '默认缩放＝作者口径 0.85')
  // 断言同步（工单A · 作者裁定）：视图组整组删掉，菜单不再提供 native zoom
  // （它与 zoomFactor 双轨冲突，见协议 §0）；缩放入口只剩偏好节的 uiZoom（保存即经 onPrefsApplied 落窗口）。
  const menuSource = await readFile(new URL('../shell/menus.mjs', import.meta.url), 'utf-8')
  assert.doesNotMatch(menuSource, /resetZoom|zoomIn|zoomOut/, '菜单不得再提供 native zoom（缩放只在偏好节）')
  const prefsSource = await readFile(new URL('../shell/settings/PrefsSection.vue', import.meta.url), 'utf-8')
  assert.match(prefsSource, /prefs-zoom/, '偏好节必须有缩放入口（唯一入口）')
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
  // 批次49：服务日志池也在这里注入（分发器读快照／确认都靠它）。
  assert.match(mainSource, /prefs,\s*\n\s*serviceLogPool,\s*\n\s*probeModelPlane/, '分发器必须注入偏好、服务日志池与探测')
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

test('备份两通道（G2）：未注入如实报缺；注入后导出用当前项目根、恢复缺 targetRoot 时按预检返回 manifest', async () => {
  const { session, dispatcher } = harness()
  for (const channel of [IPC_CHANNELS.backupExport, IPC_CHANNELS.backupRestore]) {
    const missing = await dispatcher.dispatch(channel, {})
    assert.equal(missing.ok, false, channel)
    assert.equal(missing.error.code, NEXT_ERROR_CODES.INVALID_INPUT, channel)
    assert.match(missing.error.message, /备份服务未接入/, channel)
  }

  const calls = []
  const backupService = {
    exportProject: async (args) => { calls.push(['export', args]); return ok({ path: 'D:/备份/大梦-backup-20261028-150405', fileCount: 2, bytes: 10 }) },
    restoreProject: async (args) => { calls.push(['restore', args]); return ok({ root: args.targetRoot }) },
    readBackupManifest: async (args) => { calls.push(['inspect', args]); return ok({ manifest: { schema: 'pinax-backup@1' } }) }
  }
  const wired = createIpcDispatcher({ session, backupService })

  // 没有打开项目：导出无从谈起（备份的是当前项目），也不去碰备份服务。
  const noProject = await wired.dispatch(IPC_CHANNELS.backupExport, { targetParent: 'D:/备份' })
  assert.equal(noProject.ok, false)
  assert.match(noProject.error.message, /先打开一个项目/)
  assert.equal(calls.length, 0)

  session.projectRoot = 'D:/books/大梦'
  const exported = await wired.dispatch(IPC_CHANNELS.backupExport, { targetParent: 'D:/备份', includeHistory: true })
  assert.equal(exported.ok, true)
  assert.deepEqual(calls.at(-1), ['export', { root: 'D:/books/大梦', targetParent: 'D:/备份', includeHistory: true }], '备份根由通道从会话取，渲染层给不了第二个项目路径')

  const preview = await wired.dispatch(IPC_CHANNELS.backupRestore, { backupDir: 'D:/备份/大梦-backup-20261028-150405' })
  assert.equal(preview.ok, true)
  assert.deepEqual(calls.at(-1), ['inspect', { backupDir: 'D:/备份/大梦-backup-20261028-150405' }], '只有 backupDir＝预检（恢复区显示摘要），不写盘')

  const restored = await wired.dispatch(IPC_CHANNELS.backupRestore, {
    backupDir: 'D:/备份/大梦-backup-20261028-150405',
    targetRoot: 'D:/books/恢复出来的大梦'
  })
  assert.equal(restored.ok, true)
  assert.deepEqual(calls.at(-1), ['restore', { backupDir: 'D:/备份/大梦-backup-20261028-150405', targetRoot: 'D:/books/恢复出来的大梦' }])
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
