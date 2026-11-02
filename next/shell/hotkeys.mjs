/**
 * 快捷键注册表（批次62 · 任务4）。
 *
 * 一句话：把「哪个键跑哪条命令」从散在各处的 keydown 里抽出来，落成一张可持久化的小表。
 * 本批**只收编三个高频项**（面板唤起／提案审阅／Esc 收窗），其余 36 处 keydown 原地不动——
 * 全量重构键盘处理不是这一批的事，改了也没有断言可核对。
 *
 * 存档：项目级 `.pinax/hotkeys.json`，形状 `{ version:1, bindings:{ <命令id>: <accelerator> } }`。
 * 读盘三条硬规矩照 next/settingsStore.mjs 的模式：
 *   1) 坏文件不崩、不覆盖：解析不懂就回默认表并留一条 warning（作者下次保存整份重写）；
 *   2) 只认白名单里的命令 id：表外的一律丢掉并记账，不给陌生键位开后门；
 *   3) 同一个 accelerator 被两条命令占用＝冲突，整份写入被拒（调用方不落盘）。
 *
 * accelerator 用 Electron 那套写法（`CmdOrCtrl+Shift+R`），与应用菜单模板同一词表；
 * 默认键位直接从 MENU_TEMPLATE 取（menus.mjs 是唯一来源），这里不抄第二份数字。
 *
 * 本模块只碰纯数据：不 import node:fs（渲染层与主进程共用这一份），落盘走注入的 store。
 */

import { MENU_TEMPLATE, flattenMenuEntries } from './menus.mjs'

export const HOTKEYS_VERSION = 1
export const HOTKEYS_FILE = '.pinax/hotkeys.json'

/** 面板唤起是本批新登记的宿主命令 id——它不在应用菜单里，所以键位只能在这张表里有个家。 */
export const HOTKEY_PALETTE_OPEN = 'palette.open'
/** Esc 收窗：落点就是批次61 那条「叠序最高的窗收成侧缘标签」，不新造行为。 */
export const HOTKEY_COLLAPSE_TOP = 'workspace.collapse-top'

/** 键位词汇表（修饰键名沿用 Electron；`CmdOrCtrl` 在 mac 上是 Cmd，其它平台是 Ctrl）。 */
const MODIFIER_KEYS = Object.freeze(['CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'Shift'])
const SPECIAL_KEYS = Object.freeze({
  escape: 'Esc',
  esc: 'Esc',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  space: 'Space',
  spacebar: 'Space',
  plus: 'Plus',
  minus: 'Minus',
  equal: 'Equal',
  up: 'Up',
  arrowup: 'Up',
  down: 'Down',
  arrowdown: 'Down',
  left: 'Left',
  arrowleft: 'Left',
  right: 'Right',
  arrowright: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
  delete: 'Delete',
  backspace: 'Backspace'
})
/** 功能键：F1–F24（Electron 词汇表的边界，超出就认不懂，不替作者猜一枚不存在的键）。 */
const FUNCTION_KEY = /^f([1-9]|1[0-9]|2[0-4])$/u

/**
 * 白名单＝本批点名收编的高频项。
 * `default` 里除面板那一条外都来自 MENU_TEMPLATE 的 accelerator：改键位只改菜单模板一处。
 */
export function defaultBindings() {
  const fromMenu = Object.fromEntries(flattenMenuEntries(MENU_TEMPLATE)
    .filter((entry) => entry.accelerator)
    .map((entry) => [entry.id, entry.accelerator]))
  return {
    [HOTKEY_PALETTE_OPEN]: 'CmdOrCtrl+P',
    [HOTKEY_COLLAPSE_TOP]: 'Esc',
    // 只保留收编进这条总线的那一条菜单键位（提案审阅，批次62 改 Ctrl+Shift+R）；
    // 其余菜单 accelerator 仍由原生菜单自己生效，不在这里重复注册——重复注册＝两处各写一遍。
    'project.reviewProposals': fromMenu['project.reviewProposals'] ?? 'CmdOrCtrl+Shift+R'
  }
}

/** 可绑定的命令 id（越界的键在 normalize 里被丢弃并记账，与 settingsStore 的声明白名单同口径）。 */
export function bindableIds() {
  return Object.keys(defaultBindings())
}

/** 修饰键别名：作者手写的档（Ctrl／Command／⌘）一律收成 Electron 词表。 */
const MODIFIER_ALIASES = Object.freeze({
  cmdorctrl: 'CmdOrCtrl',
  cmd: 'Cmd',
  command: 'Cmd',
  meta: 'Cmd',
  super: 'Cmd',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift'
})

function canonicalKey(token) {
  const raw = String(token ?? '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (SPECIAL_KEYS[lower]) return SPECIAL_KEYS[lower]
  if (FUNCTION_KEY.test(lower)) return lower.toUpperCase()
  if (raw.length === 1) return raw.toUpperCase()
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

/**
 * 主键名是否认得：单字符、功能键 F1–F24、或 SPECIAL_KEYS 里那批独立键。
 * 认不懂的多字符名字（`conrol+p` 里那种拼错的 `conrol`）必须回 null——
 * 它在表里会**顶掉**那条默认键位，而任何 KeyboardEvent 都按不出这个串，
 * 于是那条命令（面板唤起）就此静默失效，界面上一句解释都没有。宁可不写，也不要一把按不响的键。
 */
function isKnownKey(name) {
  if (!name) return false
  if (name.length === 1) return true
  if (FUNCTION_KEY.test(name.toLowerCase())) return true
  return Object.values(SPECIAL_KEYS).includes(name)
}

/**
 * accelerator 净化：`ctrl+shift+p` → `CmdOrCtrl+Shift+P`。
 * 只认「修饰键 + 恰好一枚主键」的形状，别的（空串、两枚主键、未知修饰键）返回 null 由调用方记账。
 * 独立键（Esc／Enter／Tab／Space）没有修饰键也合法——那是收编项里 Esc 的形状。
 */
export function normalizeAccelerator(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parts = raw.split('+').map((item) => item.trim()).filter(Boolean)
  if (!parts.length || parts.length > 4) return null
  const mods = []
  let key = ''
  for (const part of parts) {
    const alias = MODIFIER_ALIASES[part.toLowerCase()]
    if (alias) {
      if (!MODIFIER_KEYS.includes(alias)) return null
      if (!mods.includes(alias)) mods.push(alias)
      continue
    }
    if (key) return null
    key = canonicalKey(part)
  }
  // 光有修饰键不成一个键位；独立键不许再挂修饰键（Esc＋Ctrl 是两条不同的东西，不替他猜）。
  if (key && !isKnownKey(key)) return null
  if (!mods.length && !key) return null
  if (mods.length && !key) return null
  if (!mods.length && key) return key
  if (mods.includes('Cmd') && mods.includes('Ctrl')) mods[mods.indexOf('Cmd')] = 'CmdOrCtrl'
  const ordered = ['CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'Shift'].filter((mod) => mods.includes(mod))
  return [...ordered, key].join('+')
}

/** 把 KeyboardEvent 收成同一套规范化串，好跟表里的值比对（不比对 event.code，跨布局会飘）。 */
export function acceleratorFromEvent(event) {
  if (!event || typeof event.key !== 'string' || !event.key) return ''
  const key = canonicalKey(event.key)
  if (!key) return ''
  const mods = []
  if (event.metaKey && event.ctrlKey) mods.push('CmdOrCtrl')
  else if (event.metaKey) mods.push('Cmd')
  else if (event.ctrlKey) mods.push('Ctrl')
  if (event.altKey) mods.push('Alt')
  if (event.shiftKey) mods.push('Shift')
  if (!mods.length) return key
  return [...mods, key].join('+')
}

/** 反查：给定事件，命中哪条命令（没命中回空串）。表里一个 accelerator 只归一条命令（冲突在写入时就拒了）。 */
export function matchHotkey(event, bindings = {}) {
  const pressed = acceleratorFromEvent(event)
  if (!pressed) return ''
  for (const [id, accelerator] of Object.entries(bindings)) {
    const canonical = normalizeAccelerator(accelerator)
    if (!canonical) continue
    if (equivalentsOf(canonical).includes(pressed)) return id
  }
  return ''
}

/**
 * `CmdOrCtrl` 是「跨平台那一档」，按下的是哪一档由系统决定：
 * Windows／Linux 给 Ctrl，mac 给 Cmd。所以比对时把它摊成三档等价写法——
 * 不摊的话默认表里那三条（Ctrl+P／Ctrl+Shift+R）在非 mac 上永远按不响，
 * 而界面上一句解释都没有（键位表写着 Ctrl+P，按下去什么也没有）。
 */
function equivalentsOf(canonical) {
  if (!canonical.startsWith('CmdOrCtrl+')) return [canonical]
  const rest = canonical.slice('CmdOrCtrl+'.length)
  return [`Ctrl+${rest}`, `Cmd+${rest}`, canonical]
}

/** 界面上显示的键位：mac 用符号，其它平台用 Ctrl——与标题栏菜单那行的口径保持一致。 */
export function acceleratorLabel(accelerator, { mac = false } = {}) {
  const canonical = normalizeAccelerator(accelerator)
  if (!canonical) return ''
  return canonical
    .split('+')
    .map((part) => {
      if (part === 'CmdOrCtrl') return mac ? '⌘' : 'Ctrl'
      if (part === 'Cmd') return mac ? '⌘' : 'Super'
      if (part === 'Ctrl') return 'Ctrl'
      if (part === 'Alt') return mac ? '⌥' : 'Alt'
      if (part === 'Shift') return mac ? '⇧' : 'Shift'
      return part
    })
    .join(mac ? '' : '+')
}

/**
 * 同一个 accelerator 被两条命令占住＝冲突。
 * 返回 [ { accelerator, ids } ]；空数组＝这张表能装下。
 * 冲突不许「后写的赢」：那等于把作者的键位悄悄改了，界面上一句解释都没有。
 *
 * 判定按**等价类**做，不按字符串相等做：`CmdOrCtrl+P` 与 `Ctrl+P` 写起来不同，
 * 但在 Windows 上是同一下按键——只比字符串就会放过这种撞车，第二条命令从此按不响（matchHotkey 先命中谁算谁）。
 */
export function findHotkeyConflicts(bindings = {}) {
  const entries = []
  for (const [id, accelerator] of Object.entries(bindings)) {
    const canonical = normalizeAccelerator(accelerator)
    if (!canonical) continue
    const forms = canonical.startsWith('CmdOrCtrl+')
      ? new Set([`Ctrl+${canonical.slice('CmdOrCtrl+'.length)}`, `Cmd+${canonical.slice('CmdOrCtrl+'.length)}`])
      : new Set([canonical])
    entries.push({ id, canonical, forms })
  }
  const groups = new Map()
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const shared = [...entries[i].forms].filter((form) => entries[j].forms.has(form))
      if (!shared.length) continue
      // 同一个 canonical 撞车就报它自己；跨档（CmdOrCtrl 撞 Ctrl）报真正相撞的那一档。
      const accelerator = entries[i].canonical === entries[j].canonical
        ? entries[i].canonical
        : shared.sort()[0]
      const group = groups.get(accelerator) ?? { accelerator, ids: new Set() }
      group.ids.add(entries[i].id).add(entries[j].id)
      groups.set(accelerator, group)
    }
  }
  return [...groups.values()].map((group) => ({ accelerator: group.accelerator, ids: [...group.ids] }))
}

/** 空表＝默认表；坏档回落也走这一句，保证调用方永远拿得到一张能用的表。 */
export function emptyBindings() {
  return defaultBindings()
}

/**
 * 读盘结果的净化（照 settingsStore.parseStored 的三条路）：
 *   · 不是合法 JSON／根不是对象 → 默认表 + warning，不覆盖原文件；
 *   · version 不符 → 记一条 warning 继续读（下次保存整份重写）；
 *   · 表外的命令 id／非法 accelerator → 逐条丢弃并计数；
 *   · 冲突 → 整份判为不可用（回默认表 + warning），因为「谁赢」没有正确答案。
 */
export function normalizeHotkeys(value) {
  const warnings = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: HOTKEYS_VERSION, bindings: defaultBindings(), warnings: ['HOTKEYS_NOT_OBJECT'] }
  }
  if (Number(value.version) !== HOTKEYS_VERSION) warnings.push(`HOTKEYS_VERSION_${String(value.version)}`)
  const rawBindings = value.bindings && typeof value.bindings === 'object' && !Array.isArray(value.bindings)
    ? value.bindings
    : {}
  if (!value.bindings) warnings.push('HOTKEYS_BINDINGS_MISSING')
  const allowed = new Set(bindableIds())
  const bindings = {}
  let dropped = 0
  for (const [id, accelerator] of Object.entries(rawBindings)) {
    if (!allowed.has(id)) {
      dropped += 1
      continue
    }
    const canonical = normalizeAccelerator(accelerator)
    if (!canonical) {
      dropped += 1
      continue
    }
    bindings[id] = canonical
  }
  if (dropped) warnings.push(`HOTKEYS_DROPPED_${dropped}`)
  const conflicts = findHotkeyConflicts(bindings)
  if (conflicts.length) {
    return {
      version: HOTKEYS_VERSION,
      bindings: defaultBindings(),
      warnings: [...warnings, `HOTKEYS_CONFLICT_${conflicts.map((item) => item.accelerator).join('|')}`],
      conflicts
    }
  }
  // 缺项补默认：作者只改一条键位时不该把另外两条弄没。
  const merged = { ...defaultBindings(), ...bindings }
  return { version: HOTKEYS_VERSION, bindings: merged, warnings }
}

/** 文本 → 结构：坏 JSON 回默认表并记账（读侧唯一入口，调用方不必自己 try/catch）。 */
export function parseStoredHotkeys(raw) {
  if (raw === null || raw === undefined) return { ...normalizeHotkeys(null), exists: false }
  const text = String(raw)
  if (!text.trim()) return { version: HOTKEYS_VERSION, bindings: defaultBindings(), warnings: [], exists: true }
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    return { version: HOTKEYS_VERSION, bindings: defaultBindings(), warnings: ['HOTKEYS_BAD_JSON'], exists: true }
  }
  return { ...normalizeHotkeys(parsed), exists: true }
}

/** 落盘形状：只留 version＋bindings（warnings 是读盘现场的账，不进文件）。 */
export function serializeHotkeys(bindings) {
  const cleaned = {}
  for (const [id, accelerator] of Object.entries(bindings ?? {})) {
    if (!new Set(bindableIds()).has(id)) continue
    const canonical = normalizeAccelerator(accelerator)
    if (canonical) cleaned[id] = canonical
  }
  return JSON.stringify({ version: HOTKEYS_VERSION, bindings: cleaned }, null, 2)
}

/**
 * 写入闸：命令 id 必须在白名单里、accelerator 必须合法、且与表内别的键位不冲突。
 * 返回 { ok:true, bindings } 或 { ok:false, code, message }——拒的时候调用方一个字节都不该落盘。
 */
export function applyBinding(bindings, id, accelerator) {
  const commandId = String(id ?? '').trim()
  if (!new Set(bindableIds()).has(commandId)) {
    return { ok: false, code: 'HOTKEY_NOT_BINDABLE', message: `命令「${commandId}」不在本批收编的键位白名单里：不写盘` }
  }
  const canonical = normalizeAccelerator(accelerator)
  if (!canonical) {
    return { ok: false, code: 'HOTKEY_BAD_ACCELERATOR', message: `键位「${String(accelerator ?? '')}」不是合法写法（形如 Ctrl+Shift+P 或 Esc）` }
  }
  const next = { ...(bindings ?? {}), [commandId]: canonical }
  const conflicts = findHotkeyConflicts(next)
  if (conflicts.length) {
    const clash = conflicts[0]
    return {
      ok: false,
      code: 'HOTKEY_CONFLICT',
      message: `键位「${clash.accelerator}」已被 ${clash.ids.join(' 与 ')} 占用：改键被拒，原表不动`,
      details: { accelerator: clash.accelerator, ids: clash.ids }
    }
  }
  return { ok: true, bindings: next, accelerator: canonical }
}
