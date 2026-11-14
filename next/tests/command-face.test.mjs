import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import {
  loadBuiltInCarrierPlugins
} from '../carriers/index.mjs'

// 批次65b（框架计划 J2）：随包载体不再静态 import，装载走 pluginLoader 从盘上取——
// 本文件其余断言一字未动，只是拿到同一份 { manifest, impl, meta } 的方式换了。
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
import { createServiceLogPool } from '../runtime/serviceLogPool.mjs'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'
import { MENU_TEMPLATE, flattenMenuEntries, flattenMenuIds, RECENT_CLEAR_ID, RECENT_MENU_ID, recentProjectLabel, withRecentProjects } from '../shell/menus.mjs'
import {
  HOTKEYS_DIR,
  HOTKEYS_FILE,
  HOTKEYS_FILENAME,
  HOTKEYS_VERSION,
  CHAT_HOTKEY_IDS,
  HOTKEY_CHAT_MODE,
  HOTKEY_CHAT_OPEN,
  HOTKEY_CHAT_SEND,
  HOTKEY_CHAT_STOP,
  HOTKEY_COLLAPSE_TOP,
  HOTKEY_PALETTE_OPEN,
  HOTKEY_SKILL_MENU,
  STANDALONE_KEYS,
  acceleratorFromEvent,
  acceleratorLabel,
  applyBinding,
  bindableIds,
  createHotkeysFileStore,
  defaultBindings,
  findHotkeyConflicts,
  hotkeysFilePath,
  matchHotkey,
  nativeAcceleratedIds,
  normalizeAccelerator,
  parseStoredHotkeys,
  serializeHotkeys
} from '../shell/hotkeys.mjs'
import { GESTURE_ACTIONS, GESTURE_FORMS, OPEN_ACTIONS, resolveOpenTarget } from '../shell/openTarget.mjs'

/**
 * 批次62（命令面＋手势）合同测试。
 * 四条线各自钉死一件事：
 *   ① 清单里的命令**只镜像既有动作**（落点词表是闭集，越界即红）；
 *   ② command:list 的枚举数＝MENU_TEMPLATE ∪ registry.commands()，menu:invoke 认的是同一个集合；
 *   ③ hotkeys 表持久化跨实例、冲突即拒并记账、坏档回默认；
 *   ④ 手势只有两条词汇（floating／close），且界面侧确有入口把值传进 openTarget。
 */

const shellDir = new URL('../shell/', import.meta.url)

function sessionWith(registry) {
  return { kernel: { kinds: Object.keys(PROJECT_KINDS) }, registry, project: null, runtime: null, view: null, lastFailure: null }
}

function builtInRegistry() {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) registry.install(plugin.manifest, plugin.impl, plugin.meta)
  return registry
}

/** 落点词表（闭集）：命令串的动词只能是这七个，每一个都对应 AppNext.resolveCommandRun 里一个既有函数。 */
const RUN_VERBS = ['menu', 'section', 'board', 'overlay', 'pane', 'page', 'data']

test('批次62 清单命令面：11 份载体全声明、总量落在 40–55、每块 3–6 条、id 带载体命名空间、run 是字符串', () => {
  const registry = builtInRegistry()
  const commands = registry.commands()
  const perCarrier = new Map()
  for (const command of commands) perCarrier.set(command.pluginId, (perCarrier.get(command.pluginId) ?? 0) + 1)

  assert.equal(registry.list().length, 11, '十一块内置载体都该装进注册表')
  assert.equal(perCarrier.size, 11, '每块载体都得有自己的命令，一块不许漏')
  assert.ok(commands.length >= 40 && commands.length <= 55, `命令总量 ${commands.length} 不在 40–55 区间（太多＝面板读不动，太少＝没镜像全）`)
  for (const [pluginId, count] of perCarrier) {
    assert.ok(count >= 3 && count <= 6, `${pluginId} 声明了 ${count} 条，越出每块 3–6 条的口径`)
  }

  const ids = commands.map((command) => command.id)
  assert.equal(new Set(ids).size, ids.length, '命令 id 全局唯一（重复＝面板里两条同名条目分不清归属）')
  for (const command of commands) {
    const namespace = String(command.pluginId).replace(/^pinax\.carrier\./u, '')
    assert.ok(command.id.startsWith(`${namespace}.`), `${command.id} 没带载体命名空间 ${namespace}.`)
    assert.ok(command.title.length >= 1 && command.title.length <= 60, `${command.id} 的标题长度越界`)
    assert.match(command.title, /[\u4e00-\u9fa5]/u, `${command.id} 的标题须是中文（面板给作者看的）`)
    assert.equal(typeof command.run, 'string', `${command.id} 的 run 必须是字符串：函数过不了 ipcMain 的结构化克隆`)
    const verb = command.run.split(':')[0]
    assert.ok(RUN_VERBS.includes(verb), `${command.id} 的落点动词「${verb}」不在闭集 ${RUN_VERBS.join('/')} 里`)
    assert.ok(command.run.length > verb.length + 1, `${command.id} 的 run「${command.run}」只有动词没有目标`)
  }
})

test('批次62 命令 id 命名空间与形态／手势词表不撞名（撞了以后 page.floating 这类 id 说不清是命令还是状态）', async () => {
  const { PANE_FORMS } = await import('../shell/paneForms.mjs')
  const { PAGE_FORMS } = await import('../shell/workspace.mjs')
  const words = new Set([...PANE_FORMS, ...PAGE_FORMS, ...GESTURE_FORMS, ...GESTURE_ACTIONS])
  const registry = builtInRegistry()
  for (const command of registry.commands()) {
    for (const segment of command.id.split('.')) {
      assert.equal(words.has(segment), false, `${command.id} 的命名空间段「${segment}」与形态词表撞名`)
    }
    assert.equal(words.has(command.id), false, `${command.id} 整条与形态词表撞名`)
  }
})

test('批次62 command:list：枚举数＝应用菜单动作 ∪ registry.commands()，每条都带归属与可执行 run', async () => {
  const registry = builtInRegistry()
  const dispatcher = createIpcDispatcher({ session: sessionWith(registry) })
  const listed = await dispatcher.dispatch(IPC_CHANNELS.commandList, {})
  assert.equal(listed.ok, true)
  const menuIds = flattenMenuIds(MENU_TEMPLATE).map((item) => item.id)
  const carrierIds = registry.commands().map((command) => command.id)

  const table = listed.value.commands
  assert.equal(listed.value.total, table.length, 'total 与数组长度必须一致')
  assert.equal(table.length, menuIds.length + carrierIds.length, '命令表＝两块数据源的和，既不多一份也不少一份')
  assert.deepEqual([...new Set(table.map((entry) => entry.id))].sort(), [...menuIds, ...carrierIds].sort())
  for (const entry of table) {
    assert.equal(typeof entry.title, 'string')
    assert.ok(entry.title.length > 0, `${entry.id} 没有标题`)
    assert.equal(typeof entry.run, 'string')
    assert.ok(entry.run.length > 0, `${entry.id} 的 run 是空串：面板按下去不会有任何事`)
    assert.ok(['menu', 'carrier'].includes(entry.group), `${entry.id} 分组异常`)
    if (entry.group === 'menu') assert.equal(entry.owner, 'app.menu')
    else assert.equal(registry.commandOwner(entry.id), entry.owner, `${entry.id} 的归属解析不出来`)
  }
  const menuEntry = table.find((entry) => entry.id === 'project.proposals')
  assert.equal(menuEntry.run, 'menu:project.proposals', '菜单动作的 run 必须回到同一条 menuInvoke 分发')
})

test('批次62 menu:invoke 的接受集＝MENU_TEMPLATE ∪ registry.commands()：未知 id 照旧拒，集合随注册表现算', async () => {
  const registry = builtInRegistry()
  const session = sessionWith(registry)
  const invoked = []
  const dispatcher = createIpcDispatcher({ session, onMenuInvoke: async (id) => { invoked.push(id) } })

  const menuCall = await dispatcher.dispatch(IPC_CHANNELS.menuInvoke, { id: 'project.proposals' })
  assert.equal(menuCall.ok, true)
  const carrierCall = await dispatcher.dispatch(IPC_CHANNELS.menuInvoke, { id: 'novel.export-book' })
  assert.equal(carrierCall.ok, true, '载体命令要走同一条分发通道')
  const unknown = await dispatcher.dispatch(IPC_CHANNELS.menuInvoke, { id: 'novel.self-destruct' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  assert.match(unknown.error.message, /应用菜单|命令表/u, '拒绝理由要说清认的是哪两个来源')
  assert.deepEqual(invoked, ['project.proposals', 'novel.export-book'], '只有被接受的 id 才交给宿主')

  // 活的口径：载体停用 → 它的命令立刻从接受集里掉出去（创建时拍平一份就旧了）。
  const before = dispatcher.menuIds.length
  registry.uninstall?.('pinax.carrier.comic')
  const after = dispatcher.menuIds
  if (after.length === before) {
    // 注册表没有 uninstall 口时，至少声明命令的载体全在集内这条不变式要成立。
    for (const command of registry.commands()) assert.ok(after.includes(command.id), `${command.id} 不在接受集里`)
  } else {
    assert.ok(after.length < before, '停用载体后它的命令不该还留在接受集里')
    assert.equal(after.includes('comic.preview-book'), false)
  }
})

test('批次62 默认键位：面板 Ctrl+P、提案审阅 Ctrl+Shift+R（Q3 让位）、Esc 收窗；词汇表只有点名的高频项', () => {
  const bindings = defaultBindings()
  assert.equal(bindings[HOTKEY_PALETTE_OPEN], 'CmdOrCtrl+P')
  assert.equal(bindings[HOTKEY_COLLAPSE_TOP], 'Esc')
  assert.equal(bindings['project.reviewProposals'], 'CmdOrCtrl+Shift+R')
  // 〔批次77 任务3 判据反转，理由在此〕原来这条钉的是「只有三条」——那是批次62 的收编进度，
  // 不是永久合同。工单任务3 第 5 条明写「快捷键白名单扩到 6 条并走既有 hotkeys.mjs 持久化」，
  // 对话面五条键位必须有 id 才能落盘与改键，所以白名单按工单点名扩到 8 条（3 老 + 5 新）。
  // 判据从「条数不许变」换成「只许是这批点名的这八条」：多一条仍然红，少一条也红。
  assert.deepEqual(bindableIds().sort(), [
    'project.reviewProposals',
    HOTKEY_COLLAPSE_TOP,
    HOTKEY_PALETTE_OPEN,
    HOTKEY_CHAT_OPEN,
    HOTKEY_CHAT_SEND,
    HOTKEY_CHAT_STOP,
    HOTKEY_CHAT_MODE,
    HOTKEY_SKILL_MENU
  ].sort(), '白名单＝批次62 三条 ∪ 批次77 对话面五条：没点名的命令仍然进不来')

  // Q3 裁定的另一半：Ctrl+Shift+P 让给面板，菜单里不许再挂着那把旧键。
  const accelerators = flattenMenuEntries(MENU_TEMPLATE).map((entry) => entry.accelerator ?? '')
  assert.equal(accelerators.includes('CmdOrCtrl+Shift+P'), false, '提案审阅的旧键 Ctrl+Shift+P 必须让位')
  assert.equal(accelerators.includes('CmdOrCtrl+Shift+R'), true)

  assert.equal(acceleratorLabel('CmdOrCtrl+Shift+R'), 'Ctrl+Shift+R')
  assert.equal(acceleratorLabel('CmdOrCtrl+Shift+R', { mac: true }), '⌘⇧R')
  assert.equal(acceleratorLabel('垃圾写法'), '')
})

test('〔批次77 任务3〕对话面五条键位：默认表自洽、不与原生菜单撞键、且都归总线（菜单里没有它们）', () => {
  const bindings = defaultBindings()
  assert.equal(bindings[HOTKEY_CHAT_OPEN], 'CmdOrCtrl+Shift+A')
  assert.equal(bindings[HOTKEY_CHAT_SEND], 'CmdOrCtrl+Enter')
  assert.equal(bindings[HOTKEY_CHAT_STOP], 'CmdOrCtrl+Shift+Enter')
  assert.equal(bindings[HOTKEY_CHAT_MODE], 'CmdOrCtrl+Shift+M')
  assert.equal(bindings[HOTKEY_SKILL_MENU], 'CmdOrCtrl+/')
  assert.equal(findHotkeyConflicts(bindings).length, 0, '默认表自己不许冲突（发送与停止只差一个 Shift，等价类判定要认得它们是两下按键）')
  assert.equal(findHotkeyConflicts({ [HOTKEY_CHAT_SEND]: 'CmdOrCtrl+Enter', [HOTKEY_CHAT_STOP]: 'Ctrl+Enter' }).length, 1,
    'CmdOrCtrl+Enter 与 Ctrl+Enter 在非 mac 上是同一下按键：跨档撞车必须被抓出来')

  // 新键位不许踩原生菜单已经占着的那把键（菜单 accelerator 不在可绑定表里，冲突判定看不见它们）。
  const menuAccelerators = new Set(flattenMenuEntries(MENU_TEMPLATE).map((entry) => entry.accelerator ?? '').filter(Boolean))
  for (const id of CHAT_HOTKEY_IDS) {
    const canonical = normalizeAccelerator(bindings[id])
    assert.ok(canonical, `${id} 的默认键位「${bindings[id]}」不是合法写法`)
    assert.equal(menuAccelerators.has(canonical), false, `${id} 的 ${canonical} 与某条菜单项撞键`)
    assert.equal(menuAccelerators.has(canonical.replace('CmdOrCtrl', 'Ctrl')), false, `${id} 在 Windows 上按出去的那一下与菜单撞键`)
  }

  // 五条都不在菜单模板里 → 不是 nativeAccelerated：总线是唯一生效点（对话框那个监听读的就是这张表）。
  const native = new Set(nativeAcceleratedIds())
  for (const id of CHAT_HOTKEY_IDS) assert.equal(native.has(id), false, `${id} 不该被原生菜单直办`)
  assert.equal(matchHotkey({ key: 'a', ctrlKey: true, shiftKey: true }, bindings), HOTKEY_CHAT_OPEN, 'Ctrl+Shift+A 命中唤起对话')
  assert.equal(matchHotkey({ key: 'Enter', ctrlKey: true }, bindings), HOTKEY_CHAT_SEND, '不带 Shift 的 Ctrl+Enter 是发送')
  assert.equal(matchHotkey({ key: 'Enter', ctrlKey: true, shiftKey: true }, bindings), HOTKEY_CHAT_STOP, '带 Shift 才是停止：两下按键不许混成一条')
  assert.equal(matchHotkey({ key: '/', ctrlKey: true }, bindings), HOTKEY_SKILL_MENU)
  assert.equal(matchHotkey({ key: 'm', ctrlKey: true, shiftKey: true }, bindings), HOTKEY_CHAT_MODE, 'mac 那一侧 CmdOrCtrl 摊成 Cmd 也要按得响')
})

test('批次62 键位串规范化：作者手写的档收成同一套 Electron 词汇，认不懂的回 null 不猜', () => {
  assert.equal(normalizeAccelerator('ctrl+shift+p'), 'Ctrl+Shift+P')
  assert.equal(normalizeAccelerator('CmdOrCtrl+shift+p'), 'CmdOrCtrl+Shift+P')
  assert.equal(normalizeAccelerator('Command+R'), 'Cmd+R')
  assert.equal(normalizeAccelerator('option+shift+k'), 'Alt+Shift+K')
  assert.equal(normalizeAccelerator('esc'), 'Esc')
  assert.equal(normalizeAccelerator('Ctrl+Esc'), 'Ctrl+Esc')
  assert.equal(normalizeAccelerator('arrowup'), 'Up')
  assert.equal(normalizeAccelerator('f12'), 'F12')
  for (const bad of ['', '   ', 'Ctrl+', 'Ctrl+Shift', 'Fiddle', 'nope', 'Ctrl+A+B', 'Ctrl+Alt+Shift+Meta+P', 'Ctrl+F99']) {
    assert.equal(normalizeAccelerator(bad), null, `「${bad}」不该被判成合法键位`)
  }
  assert.equal(acceleratorFromEvent({ key: 'p', ctrlKey: true }), 'Ctrl+P')
  assert.equal(acceleratorFromEvent({ key: 'P', metaKey: true, shiftKey: true }), 'Cmd+Shift+P')
  // 批次63 收编c 改了这三条的期望值：带原生 accelerator 的那条不再由总线命中（见下面那条单点化测试）。
  assert.equal(matchHotkey({ key: 'r', ctrlKey: true, shiftKey: true }, defaultBindings()), '',
    'Ctrl+Shift+R 归原生菜单直办，总线认一次就两次触发')
  assert.equal(matchHotkey({ key: 'p', ctrlKey: true }, defaultBindings()), HOTKEY_PALETTE_OPEN)
  assert.equal(matchHotkey({ key: 'Escape' }, defaultBindings()), HOTKEY_COLLAPSE_TOP)
  assert.equal(matchHotkey({ key: 'a', ctrlKey: true }, defaultBindings()), '', '没收编的键位回空串，不许落到任何一条命令上')
})

test('批次62 改键闸：白名单外拒、非法串拒、冲突整份拒且原表不动（不替作者选谁赢）', () => {
  const base = defaultBindings()
  const moved = applyBinding(base, HOTKEY_PALETTE_OPEN, 'Ctrl+K')
  assert.equal(moved.ok, true)
  assert.equal(moved.bindings[HOTKEY_PALETTE_OPEN], 'Ctrl+K')
  assert.equal(moved.bindings[HOTKEY_COLLAPSE_TOP], 'Esc', '改一条不许把另外几条弄没')

  const foreign = applyBinding(base, 'app.quit', 'Ctrl+K')
  assert.equal(foreign.ok, false)
  assert.equal(foreign.code, 'HOTKEY_NOT_BINDABLE')
  const illegal = applyBinding(base, HOTKEY_PALETTE_OPEN, 'Ctrl+')
  assert.equal(illegal.ok, false)
  assert.equal(illegal.code, 'HOTKEY_BAD_ACCELERATOR')
  const clash = applyBinding(base, HOTKEY_PALETTE_OPEN, 'Esc')
  assert.equal(clash.ok, false)
  assert.equal(clash.code, 'HOTKEY_CONFLICT')
  assert.deepEqual(clash.details.ids.sort(), [HOTKEY_COLLAPSE_TOP, HOTKEY_PALETTE_OPEN].sort())
  assert.equal(clash.details.accelerator, 'Esc')
  assert.equal(findHotkeyConflicts(base).length, 0, '默认表自己不许冲突')

  // 等价类判定：`CmdOrCtrl+K` 与 `Ctrl+K` 写起来不同，在非 mac 上是同一下按键。
  const crossPlatform = applyBinding({ ...base, [HOTKEY_COLLAPSE_TOP]: 'CmdOrCtrl+K' }, HOTKEY_PALETTE_OPEN, 'Ctrl+K')
  assert.equal(crossPlatform.ok, false, '跨档撞车也算冲突：放过去就等于留下一条永远按不响的命令')
  assert.equal(crossPlatform.code, 'HOTKEY_CONFLICT')
  assert.equal(crossPlatform.details.accelerator, 'Ctrl+K')
  assert.equal(findHotkeyConflicts({ [HOTKEY_PALETTE_OPEN]: 'Cmd+K', [HOTKEY_COLLAPSE_TOP]: 'Ctrl+K' }).length, 0,
    'Cmd 与 Ctrl 是两下按键（mac 与 Win 各按各的），不算冲突')
})

test('批次62 hotkeys 存档：形状是 {version,bindings}，坏档回默认并记账，表外 id 丢弃', () => {
  assert.equal(HOTKEYS_FILE, '.pinax/hotkeys.json')

  const round = parseStoredHotkeys(serializeHotkeys({ ...defaultBindings(), [HOTKEY_PALETTE_OPEN]: 'Ctrl+K' }))
  assert.equal(round.exists, true)
  assert.equal(round.bindings[HOTKEY_PALETTE_OPEN], 'Ctrl+K')
  assert.deepEqual(round.warnings, [])

  const missing = parseStoredHotkeys(null)
  assert.equal(missing.exists, false, '没有文件是常态，不是错误')
  assert.deepEqual(missing.bindings, defaultBindings())

  const broken = parseStoredHotkeys('{ 这不是 JSON')
  assert.deepEqual(broken.bindings, defaultBindings(), '坏文件回默认表，不许崩也不许拿默认去覆盖作者的原档')
  assert.ok(broken.warnings.includes('HOTKEYS_BAD_JSON'))

  const polluted = parseStoredHotkeys(JSON.stringify({
    version: HOTKEYS_VERSION,
    bindings: { 'app.quit': 'Ctrl+Q', [HOTKEY_PALETTE_OPEN]: 'nope', [HOTKEY_COLLAPSE_TOP]: 'Esc' }
  }))
  assert.ok(polluted.warnings.includes('HOTKEYS_DROPPED_2'), `该丢两条表外／非法条目，实得 ${polluted.warnings.join(',')}`)
  assert.equal(polluted.bindings['app.quit'], undefined)

  const conflicted = parseStoredHotkeys(JSON.stringify({
    version: HOTKEYS_VERSION,
    bindings: { [HOTKEY_PALETTE_OPEN]: 'Esc', [HOTKEY_COLLAPSE_TOP]: 'Esc' }
  }))
  assert.equal(conflicted.conflicts.length, 1)
  assert.deepEqual(conflicted.bindings, defaultBindings(), '读侧遇到冲突同样回默认：两条命令抢一个键，界面按键时谁也说不准跑哪条')

  const stale = parseStoredHotkeys(JSON.stringify({ version: 99, bindings: { [HOTKEY_PALETTE_OPEN]: 'Ctrl+K' } }))
  assert.ok(stale.warnings.some((item) => item.startsWith('HOTKEYS_VERSION_')), '版本不符要留话，下次保存整份重写')
  assert.equal(stale.bindings[HOTKEY_PALETTE_OPEN], 'Ctrl+K')
})

test('批次62 hotkeys 通道：未注入存储如实报缺；跨实例读回同一份；冲突写入被拒且进服务与通知池', async () => {
  const registry = builtInRegistry()
  const bare = await createIpcDispatcher({ session: sessionWith(registry) }).dispatch(IPC_CHANNELS.hotkeysLoad, {})
  assert.equal(bare.ok, false)
  assert.match(bare.error.message, /未接入/u, '没有主进程存储时如实报缺，不回一份看起来像真数据的默认表糊过去')

  const pool = createServiceLogPool()
  const store = new Map()
  const makeSession = () => ({
    ...sessionWith(registry),
    projectRoot: 'D:/books/hotkeys-target',
    async loadHotkeys() {
      const raw = store.get(HOTKEYS_FILE)
      return { ok: true, value: raw === undefined ? { exists: false, ...parseStoredHotkeys(null) } : parseStoredHotkeys(raw) }
    },
    async saveHotkeys(bindings) {
      store.set(HOTKEYS_FILE, serializeHotkeys(bindings))
      return { ok: true, value: { path: HOTKEYS_FILE } }
    }
  })

  const first = createIpcDispatcher({ session: makeSession(), serviceLogPool: pool })
  const saved = await first.dispatch(IPC_CHANNELS.hotkeysSave, { bindings: { ...defaultBindings(), [HOTKEY_PALETTE_OPEN]: 'Ctrl+K' } })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.bindings[HOTKEY_PALETTE_OPEN], 'Ctrl+K')

  // 跨实例：换一个分发器（＝重启一次外壳）读同一份档，改过的键位必须在。
  const second = createIpcDispatcher({ session: makeSession(), serviceLogPool: pool })
  const loaded = await second.dispatch(IPC_CHANNELS.hotkeysLoad, {})
  assert.equal(loaded.ok, true)
  assert.equal(loaded.value.bindings[HOTKEY_PALETTE_OPEN], 'Ctrl+K')
  assert.equal(loaded.value.bindings[HOTKEY_COLLAPSE_TOP], 'Esc')
  assert.equal(loaded.value.version, HOTKEYS_VERSION)

  const rejected = await second.dispatch(IPC_CHANNELS.hotkeysSave, { bindings: { [HOTKEY_PALETTE_OPEN]: 'Esc', [HOTKEY_COLLAPSE_TOP]: 'Esc' } })
  assert.equal(rejected.ok, false)
  assert.match(rejected.error.message, /冲突/u)
  assert.equal(rejected.error.details.conflicts[0].accelerator, 'Esc')
  assert.equal(store.get(HOTKEYS_FILE).includes('Ctrl+K'), true, '被拒的写入一个字节都不许落盘')
  const notes = pool.list({ limit: 20 })
  assert.ok(notes.some((note) => note.source?.id === 'hotkeys' && note.level === 'warn' && /冲突/u.test(note.message)),
    '冲突即拒必须同时留下一条 warn，不能只回一句错误就忘掉')
})

test('批次62 面板组件：数据全从宿主拿，只做子串过滤与选中，执行一律 emit 回宿主', async () => {
  const source = await readFile(new URL('CommandPalette.vue', shellDir), 'utf-8')
  for (const needle of [
    'defineProps', 'open: { type: Boolean', 'entries: { type: Array',
    "defineEmits(['close', 'run'])",
    'data-test="command-palette"', 'data-test="palette-input"', 'data-test="palette-list"', 'data-test="palette-count"',
    'data-palette-id', 'role="dialog"', 'aria-modal="true"', 'aria-controls="nx-palette-list"',
    "from './focusTrap.mjs'", 'trapFocus(',
    "event.key === 'ArrowDown'", "event.key === 'ArrowUp'", "event.key === 'Enter'", "event.key === 'Escape'",
    "emit('close')", 'class="control-quiet nx-palette-item"'
  ]) {
    assert.ok(source.includes(needle), `CommandPalette 缺落点：${needle}`)
  }
  // 面板不许自己做事：不认识 fs／IPC／载体，也不做拼音分档（本批只做子串包含）。
  for (const gone of ['node:fs', 'ipcContract', 'windowStore', 'pinyin', 'matchScore']) {
    assert.equal(source.includes(gone), false, `CommandPalette 越界碰了「${gone}」：过滤与选中之外一律归宿主`)
  }
  assert.match(source, /haystack\.indexOf\(needle\)/u, '搜索＝子串包含（命中位置靠前优先）')
  assert.match(source, /event\.stopPropagation\(\)[\s\S]{0,120}emit\('close'\)/u, 'Esc 归面板：关掉并且不再往下走（同一次按键不许既收面板又收窗）')

  const css = await readFile(new URL('styles/next-shell.css', shellDir), 'utf-8')
  for (const needle of ['.nx-palette', '.nx-palette-panel', '.nx-palette-item', '.nx-palette-empty']) {
    assert.ok(css.includes(needle), `面板缺样式落点：${needle}`)
  }
})

test('批次62 手势路由：gesture 只加形态／close 两条词汇，落点判定一条不改（非 block 路径）', () => {
  assert.deepEqual([...GESTURE_FORMS], ['floating'])
  assert.deepEqual([...GESTURE_ACTIONS], ['close'])
  const pages = [{ instance: 'novel.editor#1', pane: 'novel.editor', form: 'page', resource: null }]

  // 已开着那一页 ＋ Alt：还是 reveal，只是答案多带一个形态。
  const revealed = resolveOpenTarget({ pane: 'novel.editor', multiplicity: 'keyed', resource: null, pages, gesture: { form: 'floating' } })
  assert.equal(revealed.action, 'reveal')
  assert.equal(revealed.instance, 'novel.editor#1')
  assert.equal(revealed.form, 'floating')

  // 没开着 ＋ Alt：open-page 的形态由手势给，缺省那一档仍是页。
  const opened = resolveOpenTarget({ pane: 'outline.editor', multiplicity: 'single', resource: null, pages, gesture: { form: 'floating' } })
  assert.equal(opened.action, 'open-page')
  assert.equal(opened.form, 'floating')
  const plain = resolveOpenTarget({ pane: 'outline.editor', multiplicity: 'single', resource: null, pages, gesture: {} })
  assert.equal(plain.form, undefined, '不给手势就不该凭空带形态')
  assert.ok(OPEN_ACTIONS.includes(plain.action))

  // 中键：关的就是被点那一页，实例不在页列表里就 block，绝不猜第二页。
  const closed = resolveOpenTarget({ pane: 'novel.editor', multiplicity: 'keyed', pages, gesture: { action: 'close', instance: 'novel.editor#1' } })
  assert.equal(closed.action, 'close-page')
  assert.equal(closed.instance, 'novel.editor#1')
  const stray = resolveOpenTarget({ pane: 'novel.editor', multiplicity: 'keyed', pages, gesture: { action: 'close', instance: 'novel.editor#7' } })
  assert.equal(stray.action, 'block')
  assert.equal(stray.reason, 'GESTURE_NO_TARGET')
  const wrongPane = resolveOpenTarget({ pane: 'outline.editor', multiplicity: 'single', pages, gesture: { action: 'close', instance: 'novel.editor#1' } })
  assert.equal(wrongPane.action, 'block')
  assert.equal(wrongPane.reason, 'GESTURE_NO_TARGET')

  // 认不出的手势一律明说，不静默忽略。
  assert.equal(resolveOpenTarget({ pane: 'novel.editor', pages, gesture: { form: 'fullscreen' } }).reason, 'GESTURE_FORM_UNSUPPORTED')
  assert.equal(resolveOpenTarget({ pane: 'novel.editor', pages, gesture: { action: 'split' } }).reason, 'GESTURE_UNSUPPORTED')
  assert.equal(resolveOpenTarget({ pane: 'novel.editor', pages, gesture: { instance: 'novel.editor#1' } }).reason, 'GESTURE_UNSUPPORTED')
})

test('批次62 手势界面入口：Alt／中键两条都在壳层接上，值真的传给 routeOpen→openTarget', async () => {
  const app = await readFile(new URL('AppNext.vue', shellDir), 'utf-8')
  assert.match(app, /shellRoot\.value\?\.addEventListener\?\.\('click',\s*onGestureKeyClick,\s*true\)/u, 'Alt＋点必须挂在壳层捕获阶段（那两个组件不在允许文件里）')
  assert.match(app, /shellRoot\.value\?\.addEventListener\?\.\('mousedown',\s*onGestureMiddleDown,\s*true\)/u, '中键走 mousedown：Chrome 的中键不触发 click，也不与揭示双触发')
  assert.match(app, /routeOpen\(\{ pane: entry\.pane, resource: entry\.resource \?\? null, gesture: \{ form: 'floating' \} \}\)/u, 'Alt＋点页签＝以浮窗态执行同一个动作')
  assert.match(app, /routeOpen\(\{ pane: pane\.id, gesture: \{ form: 'floating' \} \}\)/u, 'Alt＋点竖条＝同一个手势、同一个入口')
  assert.match(app, /routeOpen\(\{ pane: entry\.pane, gesture: \{ action: 'close', instance \} \}\)/u, '中键点页签＝关被点那一页，实例随值交进去')
  assert.match(app, /function onGestureKeyClick\(event\) \{[\s\S]{0,240}event\.altKey/u, 'Alt 没按下就整体让位：普通点击一次都不拦')
  assert.match(app, /function onGestureMiddleDown\(event\) \{[\s\S]{0,120}event\.button !== 1/u, '只认中键那一下')
  assert.match(app, /closest\?\.\('\.nx-page-tab\[data-page-instance\]'\)/u, '认页签靠组件已有的稳定钩子，不给那两个组件加新契约')
  // 落点侧：close-page 落到宿主那句既有的 close，开页形态跟着 decision.form。
  assert.match(app, /if \(decision\.action === 'close-page'\) \{[\s\S]{0,120}hostWorkspace\.close\(decision\.instance\)/u, '中键的落点＝hostWorkspace.close，不新造第二条关窗路')
  assert.match(app, /form: decision\.form \?\? 'page'/u, '缺省形态仍是页：floating 只从手势进来')
  assert.match(app, /hostWorkspace\.setForm\(instance, decision\.form\)/u, '已开着那一页（reveal）也跟着手势换形态')

  // 面板挂在壳层，数据源是那张表。
  assert.match(app, /import CommandPalette from '\.\/CommandPalette\.vue'/u, 'AppNext 必须真的挂载面板')
  assert.match(app, /<CommandPalette[\s\S]{0,400}:entries="commandEntries"/u, '面板的数据来自 commandEntries（＝command:list ∪ 当前页动作）')
  assert.match(app, /@run="runPaletteCommand"/u, '执行一律回宿主经 command 通路')
  assert.match(app, /const id = matchHotkey\(event, hotkeyBindings\.value\)/u, '键盘总线读的是 hotkeys 那张表，不是散在各处的硬编码键')
  // 〔工单 P10〕页内菜单行退役（openMenuLabel 随之下线）：上层只剩面板与设置二级页。
  assert.match(app, /if \(paletteOpen\.value \|\| settingsOpen\.value\) return/u, '上层开着时整体让位：同一次 Esc 不许既关面板又收窗')
})

test('批次62 命令落点词表与 AppNext 的解释一一对应（清单那半张表在这里有另一半）', async () => {
  const app = await readFile(new URL('AppNext.vue', shellDir), 'utf-8')
  for (const verb of RUN_VERBS) {
    assert.match(app, new RegExp(`case '${verb}':`, 'u'), `resolveCommandRun 少了「${verb}:」这一档——清单里写着，这里落不下去就是假命令`)
  }
  const registry = builtInRegistry()
  const verbs = new Set(registry.commands().map((command) => command.run.split(':')[0]))
  for (const verb of verbs) assert.ok(RUN_VERBS.includes(verb), `清单里出现了词表外的落点动词「${verb}」`)
  // 只镜像既有动作：这七个动词各自指向一个早就存在的函数，没有一个 new。
  for (const target of ['invokeMenu(', 'openSection(', 'selectBoard(', 'toggleBoardOverlay(', 'routeOpen(', 'applyFormAction(', 'activeData()']) {
    assert.ok(app.includes(target), `AppNext 少了动词指向的既有落点：${target}`)
  }
})

test('批次62 不新增行为：载体清单没有因为命令面多出别的贡献（panes／tools／settings 计数原样）', () => {
  const registry = builtInRegistry()
  for (const manifest of registry.list()) {
    const raw = BUILT_IN_CARRIER_PLUGINS.find((plugin) => plugin.manifest.id === manifest.id).manifest
    const contributes = raw.contributes ?? {}
    // 协议 @4 的形状：panes／commands／settings 在 contributes 里，tools 在顶层。
    assert.equal(manifest.panes.length, (contributes.panes ?? []).length, `${manifest.id} 的 pane 数变了`)
    assert.equal(manifest.tools.length, (raw.tools ?? []).length, `${manifest.id} 的工具数变了`)
    assert.equal((manifest.settings ?? []).length, (contributes.settings ?? []).length, `${manifest.id} 的设置项变了`)
    assert.equal(manifest.commands.length, (contributes.commands ?? []).length, `${manifest.id} 的命令条数与清单原话不符`)
    assert.ok(manifest.commands.length > 0, `${manifest.id} 没带命令`)
  }
})

/* —— 批次63：白名单收窄＋真盘落盘＋单点化＋收编b 的落点 ————————————————
 * 四件事各自钉死一条：
 *   ① 裸单字符（字母／数字）进不了表，独立键与组合键不受影响；
 *   ② `.pinax/hotkeys.json` 在磁盘上真往返（写→读→重启再读），坏档不覆盖作者的原档；
 *   ③ Ctrl+Shift+R 只有一个生效点（原生菜单），对照表来源仍是 MENU_TEMPLATE 一处；
 *   ④ 载体命令 id 从 menu:invoke 回到渲染层后有真落点（不再假成功）。
 */

const HOTKEYS_FS = { readFile, writeFile, mkdir, rename }

test('批次63 白名单收窄：不带修饰键的字母与数字一律不认，独立键与组合键照旧合法', () => {
  for (const bare of ['P', 'p', 'a', 'R', 'Q', '1', '9']) {
    assert.equal(normalizeAccelerator(bare), null, `裸键「${bare}」不该判成合法键位：它会顶掉一条能用的默认绑定，而作者敲下去的是输入框里的一个字符`)
  }
  for (const standalone of ['Esc', 'Enter', 'Tab', 'Space', 'space', 'Up', 'PageDown', 'Insert', 'F5', 'f12']) {
    assert.notEqual(normalizeAccelerator(standalone), null, `独立键「${standalone}」必须仍然允许裸写：Esc 收窗就是这一档`)
  }
  assert.equal(normalizeAccelerator('Ctrl+A'), 'Ctrl+A', '带修饰的单字符照常合法：收窄只管裸写')
  assert.equal(normalizeAccelerator('Alt+G'), 'Alt+G')
  assert.equal(STANDALONE_KEYS.includes('Q'), false)
  assert.equal(STANDALONE_KEYS.includes('F24'), true, '功能键到 F24 为止：Electron 词汇表的边界，不替作者猜一枚不存在的键')

  // 存档里出现裸字母：逐条丢弃并记账，那条命令回默认键位（留空＝那条命令从此没有键）。
  const polluted = parseStoredHotkeys(JSON.stringify({
    version: HOTKEYS_VERSION,
    bindings: { [HOTKEY_PALETTE_OPEN]: 'Q', [HOTKEY_COLLAPSE_TOP]: 'Esc' }
  }))
  assert.ok(polluted.warnings.includes('HOTKEYS_DROPPED_1'), `该丢一条裸字母，实得 ${polluted.warnings.join(',')}`)
  assert.equal(polluted.bindings[HOTKEY_PALETTE_OPEN], 'CmdOrCtrl+P')
  assert.equal(polluted.bindings[HOTKEY_COLLAPSE_TOP], 'Esc')

  // 改键闸同一套口径：裸字母被拒，原因要说得出口。
  const rejected = applyBinding(defaultBindings(), HOTKEY_COLLAPSE_TOP, 'Q')
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'HOTKEY_BAD_ACCELERATOR')
  // 序列化侧也挡一次：非法串根本进不了文件（补默认是读侧那条 merged 的活，见下一句）。
  const cleaned = JSON.parse(serializeHotkeys({ ...defaultBindings(), [HOTKEY_PALETTE_OPEN]: 'Q' }))
  assert.equal(cleaned.bindings[HOTKEY_PALETTE_OPEN], undefined, '坏键位不许写进档：写侧丢下它，读侧再按默认补回来')
  assert.equal(parseStoredHotkeys(JSON.stringify(cleaned)).bindings[HOTKEY_PALETTE_OPEN], 'CmdOrCtrl+P',
    '作者那条命令不能因为一次坏输入就没有键了：读侧永远补回默认')
})

test('批次63 hotkeys.json 真盘往返：写→读→重启再读、内容没变不重写、坏档不覆盖、rename 后不留 .tmp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-hotkeys-'))
  const store = createHotkeysFileStore({ root: dir, fs: HOTKEYS_FS })
  const target = hotkeysFilePath(dir)
  const forward = (path) => String(path).replace(/\\/gu, '/')
  assert.equal(forward(store.path), forward(target), '路径取 HOTKEYS_DIR＋HOTKEYS_FILENAME 两段拼，只有一处字面量')
  // 落点本身也是合同的一部分：`.pinax/hotkeys.json`（工程档，跟着项目走，不进应用数据目录）。
  assert.equal(forward(target), forward(join(dir, HOTKEYS_DIR, HOTKEYS_FILENAME)), '真盘落点必须是 <项目根>/.pinax/hotkeys.json')
  assert.equal(`${HOTKEYS_DIR}/${HOTKEYS_FILENAME}`, HOTKEYS_FILE, '常量表与两段拼出来的路径同源')

  // 没有文件是常态：exists:false，一条 warning 都不记（否则通道会把「第一次读」当成坏档记一条 warn）。
  const fresh = await store.load()
  assert.equal(fresh.ok, true)
  assert.equal(fresh.value.exists, false)
  assert.deepEqual(fresh.value.warnings, [])
  assert.deepEqual(fresh.value.bindings, defaultBindings())

  const saved = await store.save({ ...defaultBindings(), [HOTKEY_PALETTE_OPEN]: 'Ctrl+K' })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.skipped, false)
  const onDisk = JSON.parse(await readFile(target, 'utf-8'))
  assert.equal(onDisk.version, HOTKEYS_VERSION)
  assert.equal(onDisk.bindings[HOTKEY_PALETTE_OPEN], 'Ctrl+K')
  assert.equal(await readFile(`${target}.tmp`, 'utf-8').catch(() => null), null, 'rename 之后磁盘上不许留 .tmp')

  const again = await store.save({ ...defaultBindings(), [HOTKEY_PALETTE_OPEN]: 'Ctrl+K' })
  assert.equal(again.ok, true)
  assert.equal(again.value.skipped, true, '内容没变就不写：省掉每帧一次的磁盘写入与历史快照噪音')

  // 跨实例＝重启一次外壳：新 store 读同一份档，改过的键位必须在。
  const reopened = createHotkeysFileStore({ root: dir, fs: HOTKEYS_FS })
  const loaded = await reopened.load()
  assert.equal(loaded.value.exists, true)
  assert.equal(loaded.value.bindings[HOTKEY_PALETTE_OPEN], 'Ctrl+K')
  assert.equal(loaded.value.bindings[HOTKEY_COLLAPSE_TOP], 'Esc', '作者没改过的那条回默认，不许消失')
  assert.deepEqual(loaded.value.warnings, [])

  // 坏档：读侧回默认＋记账，但不许顺手把默认表写回磁盘（那是拿默认覆盖作者的档）。
  await writeFile(target, '{ 这不是 JSON', 'utf-8')
  const broken = await reopened.load()
  assert.equal(broken.value.exists, true)
  assert.ok(broken.value.warnings.includes('HOTKEYS_BAD_JSON'))
  assert.equal(await readFile(target, 'utf-8'), '{ 这不是 JSON', 'load 不落盘')
  const rewritten = await reopened.save(defaultBindings())
  assert.equal(rewritten.value.skipped, false, '坏档之后第一次保存必须真的落盘，不能被「内容没变」判掉')

  // 裸字母进不了盘：那一条整个不在文件里（丢下它是写侧的活），读回来仍是默认键位。
  await reopened.save({ ...defaultBindings(), [HOTKEY_PALETTE_OPEN]: 'Q' })
  assert.equal(JSON.parse(await readFile(target, 'utf-8')).bindings[HOTKEY_PALETTE_OPEN], undefined)
  assert.equal((await reopened.load()).value.bindings[HOTKEY_PALETTE_OPEN], 'CmdOrCtrl+P')
  await rm(dir, { recursive: true, force: true })
})

test('批次63 主进程接线：main.mjs 建 hotkeysStore 注入 session，通道与真盘之间没有内存假货', async () => {
  const mainSource = await readFile(new URL('../shell/main.mjs', shellDir), 'utf-8')
  assert.match(mainSource, /createHotkeysFileStore\(\{/, '主进程必须真的建 store（批次62 那条通道一直只报缺）')
  assert.match(mainSource, /session\.loadHotkeys = async/u, 'hotkeysLoad 读的是 session.loadHotkeys')
  assert.match(mainSource, /session\.saveHotkeys = async/u, 'hotkeysSave 写的是 session.saveHotkeys')
  assert.match(mainSource, /fs: \{ readFile, writeFile, mkdir, rename \}/u, 'fs 由主进程注入：渲染层共用的那份模块碰不到文件系统')
  assert.match(mainSource, /join\(String\(projectRoot\), HOTKEYS_DIR, HOTKEYS_FILENAME\)/u, '路径取 hotkeys.mjs 那两段常量，不重打一遍字面量')
  assert.match(mainSource, /if \(!hotkeysStore \|\| hotkeysStore\.root !== String\(projectRoot\)\)/u, '换项目就换一份：lastWritten 是本项目的内容指纹')

  const hotkeysSource = await readFile(new URL('hotkeys.mjs', shellDir), 'utf-8')
  assert.equal(/from ['"]node:fs/u.test(hotkeysSource), false, 'hotkeys.mjs 被渲染层共用：一处 import node:fs 就把整个模块变成主进程专属')

  // 真盘走一遍通道：分发器拿到的 session 与 main.mjs 注入的是同一形状（load→store.load，save→store.save）。
  const dir = await mkdtemp(join(tmpdir(), 'pinax-hotkeys-channel-'))
  const makeDispatcher = (pool) => {
    const store = createHotkeysFileStore({ root: dir, fs: HOTKEYS_FS })
    const session = {
      ...sessionWith(builtInRegistry()),
      projectRoot: dir,
      loadHotkeys: () => store.load(),
      saveHotkeys: (bindings) => store.save(bindings)
    }
    return createIpcDispatcher({ session, serviceLogPool: pool })
  }
  const pool = createServiceLogPool()
  const target = hotkeysFilePath(dir)
  const first = makeDispatcher(pool)
  const saved = await first.dispatch(IPC_CHANNELS.hotkeysSave, { bindings: { ...defaultBindings(), [HOTKEY_COLLAPSE_TOP]: 'F8' } })
  assert.equal(saved.ok, true)
  assert.equal(JSON.parse(await readFile(target, 'utf-8')).bindings[HOTKEY_COLLAPSE_TOP], 'F8', '独立功能键允许裸写，且真的在文件里')

  // 换一个分发器＋新 store（＝重启一次外壳）：读回的是磁盘上那一份。
  const loaded = await makeDispatcher(pool).dispatch(IPC_CHANNELS.hotkeysLoad, {})
  assert.equal(loaded.ok, true)
  assert.equal(loaded.value.exists, true)
  assert.equal(loaded.value.bindings[HOTKEY_COLLAPSE_TOP], 'F8')
  assert.equal(loaded.value.bindings[HOTKEY_PALETTE_OPEN], 'CmdOrCtrl+P')
  assert.deepEqual(loaded.value.warnings, [], '正常档不该顺带记一条 warn：服务与通知池那一条要留给真出事的时候')

  // 冲突照旧整份拒，且拒了就不落盘（批次62 用内存假 store 证的口径，现在在真盘上再核一次）。
  const before = await readFile(target, 'utf-8')
  const rejected = await makeDispatcher(pool).dispatch(IPC_CHANNELS.hotkeysSave, { bindings: { [HOTKEY_PALETTE_OPEN]: 'Esc', [HOTKEY_COLLAPSE_TOP]: 'Esc' } })
  assert.equal(rejected.ok, false)
  assert.equal(await readFile(target, 'utf-8'), before, '被拒的写入一个字节都不许落盘')
  assert.ok(pool.list({ limit: 50 }).some((note) => note.source?.id === 'hotkeys' && note.level === 'warn'), '拒完还要在池里留一条 warn')
  await rm(dir, { recursive: true, force: true })
})

test('批次63 单点化：带原生 accelerator 的菜单项不再被总线命中，对照表只有 MENU_TEMPLATE 一处', () => {
  const native = nativeAcceleratedIds()
  assert.deepEqual([...native], ['project.reviewProposals'], '收编进总线的菜单项只有提案审阅这一条：其余键位仍只由总线负责')
  for (const id of native) {
    assert.ok(bindableIds().includes(id), `${id} 不在可绑定白名单里，不该出现在对照表中`)
    assert.ok(flattenMenuEntries(MENU_TEMPLATE).some((entry) => entry.id === id && entry.accelerator), `${id} 对照表说有原生 accelerator，菜单模板里没有`)
  }
  const bindings = defaultBindings()
  assert.equal(bindings['project.reviewProposals'], 'CmdOrCtrl+Shift+R', '表里仍留着那条：作者看得见键位、面板显示它，只是不在这儿命中')
  assert.equal(matchHotkey({ key: 'r', ctrlKey: true, shiftKey: true }, bindings), '', '一次按键只走一条路：Electron 菜单吃掉这一下并回一条 menuInvoked')
  assert.equal(matchHotkey({ key: 'r', metaKey: true, shiftKey: true }, bindings), '', 'mac 那一侧同理')
  assert.equal(matchHotkey({ key: 'p', ctrlKey: true }, bindings), HOTKEY_PALETTE_OPEN, '面板唤起不在菜单里，照旧归总线')
  assert.equal(matchHotkey({ key: 'Escape' }, bindings), HOTKEY_COLLAPSE_TOP, 'Esc 收窗不在菜单里，照旧归总线')
  assert.equal(nativeAcceleratedIds(), native, '对照表算一次就够：matchHotkey 每一次按键都要跑')
})

test('批次63 收编b：载体命令 id 回到渲染层后有真落点（menu:invoke 不再只是假成功）', async () => {
  const app = await readFile(new URL('AppNext.vue', shellDir), 'utf-8')
  // runMenuAction 的 carrier 回落：数据源是那张命令表，执行通路是面板同一条 resolveCommandRun。
  // （第二参 root 是「最近打开」条目的落点参数——作者 2026-11-10 点单，carrier 回落不吃它。）
  assert.match(app, /async function runMenuAction\(id, root = null\) \{[\s\S]{0,900}item\.group === 'carrier'[\s\S]{0,200}await resolveCommandRun\(entry\.run, entry\)/u,
    '载体命令 id 必须按命令表里的 run 走面板那条执行通路')
  assert.match(app, /命令「\$\{entry\.title \?\? entry\.id\}」未接线/u, '落点认不出要说得出为什么，与 runPaletteCommand 同一句话')
  // 递归闸：菜单项的 run 是 `menu:<自己的 id>`，回落只认 carrier 分组才不会有死循环。
  assert.match(app, /case 'menu':\s*\n\s*await invokeMenu\(\{ id: arg \}\)/u, 'menu 动词仍指向 invokeMenu（回落不许吃自己）')

  // 主进程侧维持接受集（工单：不改协议、不缩集合）。
  const registry = builtInRegistry()
  const invoked = []
  const dispatcher = createIpcDispatcher({ session: sessionWith(registry), onMenuInvoke: async (id) => { invoked.push(id) } })
  const carrierCall = await dispatcher.dispatch(IPC_CHANNELS.menuInvoke, { id: 'novel.export-book' })
  assert.equal(carrierCall.ok, true, '接受集不动：载体命令仍走同一条分发通道')
  assert.deepEqual(invoked, ['novel.export-book'])
  const unknown = await dispatcher.dispatch(IPC_CHANNELS.menuInvoke, { id: 'novel.self-destruct' })
  assert.equal(unknown.ok, false, '未知 id 照旧拒')
})

/* —— 最近打开的项目（作者 2026-11-10 点单）———————————————————————————————————— */

test('最近项目 withRecentProjects：空清单原样返回；非空在 project.open 后拼「组头＋条目＋清空」块且不改冻结模板', () => {
  // 空清单（或没有可用条目）＝模板原样，项目菜单不多一块噪音。
  assert.equal(withRecentProjects(MENU_TEMPLATE, []), MENU_TEMPLATE)
  assert.equal(withRecentProjects(MENU_TEMPLATE, [{ name: '没路径的不要' }]), MENU_TEMPLATE)

  const recents = [
    { path: 'D:/Projects/大梦', name: '大梦', at: '2026-11-10T09:00:00.000Z' },
    { path: 'D:/books/旧稿', name: null, at: null }
  ]
  const spliced = withRecentProjects(MENU_TEMPLATE, recents)
  assert.notEqual(spliced, MENU_TEMPLATE, '非空清单要返回新数组（MENU_TEMPLATE 冻结，不许原地改）')
  assert.deepEqual(MENU_TEMPLATE[0].submenu.filter((item) => !item.type).map((item) => item.id), [
    'project.open', 'project.backup', 'project.history', 'project.reviewProposals', 'project.proposals', 'project.library', 'app.quit'
  ], '拼装不得污染冻结模板（「我的库…」随前端工单 A-1 收在项目组末尾）')

  const projectMenu = spliced.find((top) => top.label === '项目')
  const afterOpen = projectMenu.submenu.slice(projectMenu.submenu.findIndex((item) => item.id === 'project.open') + 1, projectMenu.submenu.findIndex((item) => item.id === 'project.backup'))
  assert.deepEqual(afterOpen.map((item) => item.type ?? item.label), [
    'separator', '最近打开', 'D:/Projects/大梦', 'D:/books/旧稿', '清除最近打开', 'separator'
  ], '块的位置＝project.open 之后、导入既有稿之前；名与目录同名（或没名）只摆路径')
  const recentItems = afterOpen.filter((item) => item.id === RECENT_MENU_ID)
  assert.equal(recentItems.length, 2)
  assert.deepEqual(recentItems.map((item) => item.root), ['D:/Projects/大梦', 'D:/books/旧稿'], '每条都带着自己的目录，渲染层打开就吃这一格')
  assert.deepEqual(recentItems.map((item) => item.title), ['D:/Projects/大梦', 'D:/books/旧稿'], 'title＝完整路径（页内 hover 提示）')
  const clear = afterOpen.find((item) => item.id === RECENT_CLEAR_ID)
  assert.equal(clear.label, '清除最近打开')

  // 组头与条目的分工：组头无 id（页内＝禁用行、原生＝灰行），条目有 id 有 root。
  assert.equal(afterOpen[1].id, undefined)
  assert.equal(afterOpen[1].enabled, false)

  // 其他组一字不动；recentProjectLabel 的分岔单独钉住。
  assert.deepEqual(spliced.filter((top) => top.label !== '项目'), MENU_TEMPLATE.filter((top) => top.label !== '项目'))
  assert.equal(recentProjectLabel({ path: 'D:/Projects/大梦', name: '大梦' }), 'D:/Projects/大梦')
  assert.equal(recentProjectLabel({ path: 'D:/Projects/大梦', name: '我的大梦' }), '我的大梦 — D:/Projects/大梦')
  assert.equal(recentProjectLabel(null), '')
})

test('最近项目 menu:invoke 与 recent-list：recentClear 进接受集、recent-list 未注入回空清单、注入了回真值', async () => {
  const registry = builtInRegistry()
  const invoked = []
  const dispatcher = createIpcDispatcher({ session: sessionWith(registry), onMenuInvoke: async (id) => { invoked.push(id) } })

  const bare = await dispatcher.dispatch(IPC_CHANNELS.projectRecentList, {})
  assert.equal(bare.ok, true, '没接最近项目服务的会话，「没有记录」是合法答案，不该报缺')
  assert.deepEqual(bare.value.recents, [])

  const clear = await dispatcher.dispatch(IPC_CHANNELS.menuInvoke, { id: RECENT_CLEAR_ID })
  assert.equal(clear.ok, true, '「清除最近打开」是应用菜单动作：接受集按常量放行（模板里没有静态项）')
  assert.deepEqual(invoked, [RECENT_CLEAR_ID], '被接受的 id 交给宿主落主进程的清空')

  const wired = createIpcDispatcher({ session: sessionWith(registry), recentProjects: () => [{ path: 'D:/Projects/大梦', name: '大梦', at: null }] })
  const listed = await wired.dispatch(IPC_CHANNELS.projectRecentList, {})
  assert.equal(listed.ok, true)
  assert.equal(listed.value.recents[0].path, 'D:/Projects/大梦')
})
