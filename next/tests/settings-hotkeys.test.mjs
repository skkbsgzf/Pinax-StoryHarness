import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOTKEY_CHAT_MODE,
  HOTKEY_CHAT_OPEN,
  HOTKEY_CHAT_SEND,
  HOTKEY_CHAT_STOP,
  HOTKEY_COLLAPSE_TOP,
  HOTKEY_PALETTE_OPEN,
  HOTKEY_SKILL_MENU,
  acceleratorFromEvent,
  applyBinding,
  bindableIds,
  defaultBindings,
  findHotkeyConflicts,
  normalizeAccelerator
} from '../shell/hotkeys.mjs'

/**
 * 快捷键节的纯函数契约（工单 P8 · B-8，作者 2026-11-13 设置图谱裁定）。
 *
 * 钉的是设置页改键所依赖的那几件事：白名单恰好八条、录入事件能归一成表里的写法、
 * 撞键按等价类判（CmdOrCtrl+ 与 Ctrl+ 在非 mac 上就是同一下按键）、
 * 恢复默认的那张表自身无冲突。界面层（点击录入／行内报错／二次确认）见 shell-ui.spec。
 */

test('白名单恰好八条：批次62 三条＋批次77 五条，与默认表同一份键', () => {
  const ids = bindableIds()
  assert.equal(ids.length, 8)
  assert.deepEqual(ids, Object.keys(defaultBindings()))
  for (const id of [
    HOTKEY_PALETTE_OPEN,
    HOTKEY_COLLAPSE_TOP,
    HOTKEY_CHAT_OPEN,
    HOTKEY_CHAT_SEND,
    HOTKEY_CHAT_STOP,
    HOTKEY_CHAT_MODE,
    HOTKEY_SKILL_MENU
  ]) {
    assert.ok(ids.includes(id), `白名单缺 ${id}`)
  }
  // 默认表必须全是合法写法：恢复默认的整表写入不该被自己的净化器拒掉。
  for (const [id, accelerator] of Object.entries(defaultBindings())) {
    assert.equal(normalizeAccelerator(accelerator), accelerator, `${id} 的默认键位不是规范写法：${accelerator}`)
  }
})

test('录入事件归一：修饰键顺序固定、CmdOrCtrl 合并、独立键不带修饰键', () => {
  assert.equal(normalizeAccelerator('ctrl+k'), 'Ctrl+K')
  assert.equal(normalizeAccelerator('Shift+Ctrl+k'), 'Ctrl+Shift+K')
  assert.equal(normalizeAccelerator('meta+alt+p'), 'Cmd+Alt+P')
  assert.equal(normalizeAccelerator('escape'), 'Esc')
  assert.equal(normalizeAccelerator('F5'), 'F5')
  // 裸字母/裸数字与拼错的修饰键不认——宁可拒，也不写一把按不响的键。
  assert.equal(normalizeAccelerator('a'), null)
  assert.equal(normalizeAccelerator('Ctrl+Shift'), null)
  assert.equal(normalizeAccelerator('conrol+p'), null)
})

test('KeyboardEvent 收成同一套写法：mac 的 ⌘ 与 Windows 的 Ctrl 各自归一', () => {
  assert.equal(acceleratorFromEvent({ key: 'k', ctrlKey: true }), 'Ctrl+K')
  assert.equal(acceleratorFromEvent({ key: 'k', metaKey: true }), 'Cmd+K')
  assert.equal(acceleratorFromEvent({ key: 'k', metaKey: true, ctrlKey: true }), 'CmdOrCtrl+K')
  assert.equal(acceleratorFromEvent({ key: 'Escape' }), 'Esc')
  assert.equal(acceleratorFromEvent({ key: 'Enter', ctrlKey: true }), 'Ctrl+Enter')
  // 纯修饰键不是一个可落表的键位。
  assert.equal(normalizeAccelerator(acceleratorFromEvent({ key: 'Shift', shiftKey: true })), null)
})

test('撞键按等价类判：CmdOrCtrl+P 与 Ctrl+P 是同一枚键，默认表整表无冲突', () => {
  assert.deepEqual(findHotkeyConflicts(defaultBindings()), [])

  const same = findHotkeyConflicts({ 'palette.open': 'Ctrl+K', 'chat.send': 'Ctrl+K' })
  assert.equal(same.length, 1)
  assert.equal(same[0].accelerator, 'Ctrl+K')
  assert.deepEqual([...same[0].ids].sort(), ['chat.send', 'palette.open'])

  const cross = findHotkeyConflicts({ 'palette.open': 'CmdOrCtrl+P', 'chat.mode': 'Ctrl+P' })
  assert.equal(cross.length, 1)
  assert.equal(cross[0].accelerator, 'Ctrl+P')
})

test('改键闸：合法即回新表、撞键整份拒、表外 id 与非法写法分别报码', () => {
  const bindings = defaultBindings()
  const next = applyBinding(bindings, HOTKEY_CHAT_MODE, 'ctrl+shift+k')
  assert.equal(next.ok, true)
  assert.equal(next.bindings[HOTKEY_CHAT_MODE], 'Ctrl+Shift+K')
  assert.equal(bindings[HOTKEY_CHAT_MODE], 'CmdOrCtrl+Shift+M', '原表不能被就地改写')

  const clash = applyBinding(bindings, HOTKEY_CHAT_MODE, 'ctrl+p')
  assert.equal(clash.ok, false)
  assert.equal(clash.code, 'HOTKEY_CONFLICT')
  assert.deepEqual(clash.details.ids.sort(), [HOTKEY_CHAT_MODE, HOTKEY_PALETTE_OPEN].sort())

  assert.equal(applyBinding(bindings, 'unknown.command', 'Ctrl+K').code, 'HOTKEY_NOT_BINDABLE')
  assert.equal(applyBinding(bindings, HOTKEY_CHAT_MODE, 'a').code, 'HOTKEY_BAD_ACCELERATOR')
})
