import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { FOCUSABLE_SELECTOR, trapFocus } from '../shell/focusTrap.mjs'

/**
 * 焦点陷阱（工单B · 差异表 #10）。老版的 trapFocusWithin 是 src/ 的 composable，Next 不引旧轨；
 * 这里测的是 next/shell/focusTrap.mjs 这份纯 DOM 重写：Tab 在容器内循环、release 摘监听并归还焦点。
 *
 * 环境：node:test ＋ jsdom 直挂（不是 vitest 的 jsdom 环境）——用例走 `node --test next/tests/*.test.mjs`
 * 这条门禁，和 carrier-*.test.mjs 同一轨；jsdom 是仓库 devDependency（vitest 的界面环境同款）。
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

function makeDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="outside" type="button">打开弹窗的按钮</button>
    <div id="panel" role="dialog">
      <button id="first" type="button">第一</button>
      <input id="middle">
      <button id="last" type="button">最后</button>
      <button id="disabled" type="button" disabled>禁用</button>
      <span id="hidden-tab" tabindex="-1">不可 Tab</span>
    </div>
  </body></html>`)
  const { document } = dom.window
  return { window: dom.window, document, panel: document.getElementById('panel') }
}

test('Tab 在容器内循环：末尾回第一、开头 Shift+Tab 回末尾，焦点不出容器', () => {
  const { window, document, panel } = makeDom()
  const outside = document.getElementById('outside')
  outside.focus()
  const trap = trapFocus(panel)
  try {
    assert.equal(document.activeElement.id, 'first', '打开时把焦点收进容器（不留在弹窗背后）')

    const last = document.getElementById('last')
    last.focus()
    const forward = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last.dispatchEvent(forward)
    assert.equal(document.activeElement.id, 'first', '最后一个 Tab 回到第一个')
    assert.equal(forward.defaultPrevented, true)

    const first = document.getElementById('first')
    first.focus()
    const backward = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    first.dispatchEvent(backward)
    assert.equal(document.activeElement.id, 'last', '第一个 Shift+Tab 回到最后一个')
    assert.equal(backward.defaultPrevented, true)

    // 中间位置交给浏览器默认顺序：陷阱不拦（只守首尾两个口子）。
    const middle = document.getElementById('middle')
    middle.focus()
    const passThrough = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    middle.dispatchEvent(passThrough)
    assert.equal(passThrough.defaultPrevented, false)
    assert.equal(document.activeElement.id, 'middle', '唯一焦点仍在容器内')
  } finally {
    trap.release()
  }
})

test('可聚焦集合排除禁用钮与 tabindex="-1"：首尾回环绕过它们', () => {
  const { window, document, panel } = makeDom()
  const trap = trapFocus(panel)
  try {
    // DOM 里 first→middle→last 之后还有 disabled 与 tabindex="-1" 的 span：
    // 若它们进了集合，回绕的落点会是 span 而不是 last。
    document.getElementById('first').focus()
    const backward = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.activeElement.dispatchEvent(backward)
    assert.equal(document.activeElement.id, 'last', '末尾是 last，不是禁用钮或 tabindex="-1" 的 span')

    const forward = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.activeElement.dispatchEvent(forward)
    assert.equal(document.activeElement.id, 'first', '末尾 Tab 回第一个')
  } finally {
    trap.release()
  }
})

test('release 摘监听并把焦点还给打开前的持有者；重复 release 幂等', () => {
  const { window, document, panel } = makeDom()
  const outside = document.getElementById('outside')
  outside.focus()
  const trap = trapFocus(panel)
  assert.equal(document.activeElement.id, 'first')

  trap.release()
  assert.equal(document.activeElement.id, 'outside', '关闭后焦点回到打开前的位置')

  // 监听确实摘掉了：事件照样冒泡到面板，但陷阱不再处理（不 preventDefault、不搬焦点）。
  const last = document.getElementById('last')
  last.focus()
  const event = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  last.dispatchEvent(event)
  assert.equal(event.defaultPrevented, false)
  assert.equal(document.activeElement.id, 'last')

  trap.release()
  assert.equal(document.activeElement.id, 'last', '重复 release 不再动焦点')
})

test('没有可聚焦元素（或容器不合法）时如实放行：不 preventDefault、不抛错', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="empty" role="dialog"><p>只有文字</p></div></body></html>')
  const { document, KeyboardEvent } = dom.window
  const panel = document.getElementById('empty')
  const trap = trapFocus(panel)
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  panel.dispatchEvent(event)
  assert.equal(event.defaultPrevented, false)
  trap.release()

  // 不传容器／传假对象：给一个空壳 release，绝不让弹窗因为陷阱起不来。
  for (const broken of [null, undefined, {}]) {
    const noop = trapFocus(broken)
    assert.equal(typeof noop.release, 'function')
    noop.release()
  }
})

test('右栏宽度钳制对齐老版 320–680（差异表 #6）；索引窗仍是 200–360', async () => {
  const source = await readFile(join(repoRoot, 'next', 'shell', 'AppNext.vue'), 'utf-8')
  const startDrag = /function startDrag\(target, event\) \{([\s\S]*?)const up = /.exec(source)
  assert.ok(startDrag, 'AppNext.vue 里找不到 startDrag')
  const body = startDrag[1]
  assert.match(body, /target === 'index'[^\n]*Math\.min\(360, Math\.max\(200, next\)\)/, '索引窗的 200–360 不动')
  assert.match(body, /dockWidth\.value = Math\.min\(680, Math\.max\(320, next\)\)/, '右栏下限对齐老版 320、上限 680')
  assert.doesNotMatch(body, /Math\.min\(640/, '老版对齐前的上限 640 必须已经换掉')
  assert.doesNotMatch(body, /Math\.max\(260/, '老版对齐前的下限 260 必须已经换掉')
})

test('可聚焦选择器本身覆盖工单点名的六类元素', () => {
  for (const needle of ['button', 'input', 'textarea', 'select', 'a[href]', '[tabindex]']) {
    assert.ok(FOCUSABLE_SELECTOR.includes(needle), `选择器缺 ${needle}：${FOCUSABLE_SELECTOR}`)
  }
})
