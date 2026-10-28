/**
 * 焦点陷阱（工单B · 差异表 #10）：老版的 trapFocusWithin（src/composables/useTransientLayer.js:28-44）
 * 是 src/ 的 composable，薄渲染层门禁（next/tests/shell-contract.test.mjs「外壳引旧轨叶子件只引这三个」）
 * 不许外壳去引；这里在 next/ 内重写一份纯 DOM 实现——只做「Tab 在容器里循环 + 关闭归还焦点」这一件事，
 * 约 40 行，不抄老版的层级栈与 Esc 语义（Esc 仍归 WorkbenchModal 自己）。
 *
 * 用法：
 *   const trap = trapFocus(panelElement)   // 打开弹窗、面板已挂到 DOM 之后调用
 *   trap.release()                         // 关闭/卸载时调，摘监听并归还焦点
 *
 * 行为：
 *   1) 打开时若焦点不在容器内，先把焦点收进第一个可聚焦元素（焦点不能留在弹窗背后）；
 *   2) 容器上监听 keydown 的 Tab：最后一个 Tab 回第一个，第一个 Shift+Tab 回最后一个；
 *      单个可聚焦元素时停在它自己身上（不把焦点放出去）；
 *   3) release() 幂等：摘监听，把焦点还给打开前持有焦点的元素（它还在文档里时）。
 *
 * 可聚焦元素：button/input/textarea/select/a[href]/[tabindex]（禁用、hidden、aria-hidden="true"
 * 与 tabindex="-1" 除外）。jsdom 无布局，所以不做「是否真的可见」的几何判断。
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function trapFocus(container) {
  if (!container || typeof container.addEventListener !== 'function') return { release() {} }
  const doc = container.ownerDocument ?? (typeof document === 'undefined' ? null : document)
  /** 打开前的焦点持有者：release 时还给它（弹窗把人送到别处再关掉，焦点不该落在 body 上）。 */
  const holder = doc?.activeElement ?? null

  function focusables() {
    return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => {
      if (!element || typeof element.focus !== 'function') return false
      if (element.disabled) return false
      if (element.hidden) return false
      if (element.getAttribute?.('aria-hidden') === 'true') return false
      return true
    })
  }

  function onKeydown(event) {
    if (event?.key !== 'Tab' || typeof event.preventDefault !== 'function') return
    const list = focusables()
    if (!list.length) return
    const first = list[0]
    const last = list[list.length - 1]
    const active = doc?.activeElement ?? null
    const inside = Boolean(active && container.contains(active))
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if (!inside || active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  container.addEventListener('keydown', onKeydown)
  const initial = focusables()[0]
  if (initial && !(doc?.activeElement && container.contains(doc.activeElement))) initial.focus()

  let released = false
  return {
    release() {
      if (released) return
      released = true
      container.removeEventListener('keydown', onKeydown)
      if (holder && holder !== doc?.body && holder.isConnected !== false && typeof holder.focus === 'function') {
        holder.focus()
      }
    }
  }
}
