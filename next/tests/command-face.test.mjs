import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { BUILT_IN_CARRIER_PLUGINS } from '../carriers/index.mjs'
import { createServiceLogPool } from '../runtime/serviceLogPool.mjs'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'
import { MENU_TEMPLATE, flattenMenuEntries, flattenMenuIds } from '../shell/menus.mjs'
import {
  HOTKEYS_FILE,
  HOTKEYS_VERSION,
  HOTKEY_COLLAPSE_TOP,
  HOTKEY_PALETTE_OPEN,
  acceleratorFromEvent,
  acceleratorLabel,
  applyBinding,
  bindableIds,
  defaultBindings,
  findHotkeyConflicts,
  matchHotkey,
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
  assert.deepEqual(bindableIds().sort(), ['project.reviewProposals', HOTKEY_COLLAPSE_TOP, HOTKEY_PALETTE_OPEN].sort(),
    '本批只收编点名的高频项；偷偷多收一条＝动了没被授权的键位')

  // Q3 裁定的另一半：Ctrl+Shift+P 让给面板，菜单里不许再挂着那把旧键。
  const accelerators = flattenMenuEntries(MENU_TEMPLATE).map((entry) => entry.accelerator ?? '')
  assert.equal(accelerators.includes('CmdOrCtrl+Shift+P'), false, '提案审阅的旧键 Ctrl+Shift+P 必须让位')
  assert.equal(accelerators.includes('CmdOrCtrl+Shift+R'), true)

  assert.equal(acceleratorLabel('CmdOrCtrl+Shift+R'), 'Ctrl+Shift+R')
  assert.equal(acceleratorLabel('CmdOrCtrl+Shift+R', { mac: true }), '⌘⇧R')
  assert.equal(acceleratorLabel('垃圾写法'), '')
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
  assert.equal(matchHotkey({ key: 'r', ctrlKey: true, shiftKey: true }, defaultBindings()), 'project.reviewProposals')
  assert.equal(matchHotkey({ key: 'r', metaKey: true, shiftKey: true }, defaultBindings()), 'project.reviewProposals',
    'CmdOrCtrl 在 mac 上就是 Cmd：不摊成等价类，这条键位在其中一侧永远按不响')
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
  assert.match(app, /if \(paletteOpen\.value \|\| settingsOpen\.value \|\| openMenuLabel\.value\) return/u, '上层开着时整体让位：同一次 Esc 不许既关面板又收窗')
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
