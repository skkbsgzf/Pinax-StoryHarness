/**
 * 多形态打开（协议 v1.2 P18–P21）：宿主形态词表 ＋ 每 pane 一个形态状态。
 *
 * 作者原话（2026-10-28）：「一些载体既可以分屏，也可以当做浮窗或者插件，用户可以右键选择
 * 以什么方式打开，浮窗可以吸附侧边也可以扩至全屏」。这份模块是那句话的宿主侧落地：
 *   - P18 注册制：载体在 manifest.panes 里给每个 pane 声明 forms；宿主只提供声明过的形态。
 *   - P21 状态机：每 pane 一个形态状态（v1 词表四档：dock／split／overlay／fullscreen，
 *     P21 里的 split-left／split-right 在本批合并为 split——副栏由宿主统一摆位；
 *     浮窗吸附的左/右是 overlay 的子状态，记在 overlay.<paneId> 的 snap 字段，不另立第五种形态）；
 *     切换只走 setPaneForm(paneId, form)，载体 SFC 不感知形态（P12：内容渲染不变）。
 *
 * 状态持久化是 localStorage 的第二条例外（第一条是 FloatingWidget 的 overlay.<paneId> 位置记忆）：
 * 键 `paneForm.<paneId>` 由这里按 pane id 拼出，渲染层不另写键。
 * 读写一律 try/catch：隐私模式／配额失败不拦切换，这次会话里状态照样生效。
 *
 * 纯数据模块，不 import Vue——node:test 能直接测状态机与持久化；
 * 渲染层用 subscribe() 把快照接进 ref（React 式订阅，宿主一份真相）。
 */

/** 宿主支持的打开形态（P18 词表）。顺序即右键菜单的展示顺序。 */
export const PANE_FORMS = Object.freeze(['dock', 'split', 'overlay', 'fullscreen'])

/** 缺省形态：左键点竖条格＝回到停靠栏（P19「左键默认行为＝defaultForm，缺省 dock」）。 */
export const DEFAULT_PANE_FORM = 'dock'

/** 右键「打开方式」菜单的文案（宿主词汇，载体不自带文案）。 */
export const PANE_FORM_LABELS = Object.freeze({
  dock: '停靠栏',
  split: '在分屏中打开',
  overlay: '在浮窗中打开',
  fullscreen: '全屏'
})

/** 持久化键前缀：`paneForm.<paneId>`（键名带 paneId，由宿主拼）。 */
export const PANE_FORM_STORAGE_PREFIX = 'paneForm.'

export function isPaneForm(value) {
  return PANE_FORMS.includes(value)
}

/**
 * 把清单里的 forms 数组收成宿主词表内的形态（去重、按词表顺序）。
 * 词表外的形态不报错、也不出现在菜单里——P18「未声明的形态不出现」。
 * 清单层的「拒装」归内核校验器；渲染层只做最后一道过滤，不让陌生值漏进状态机。
 */
export function sanitizePaneForms(value) {
  if (!Array.isArray(value)) return []
  const declared = new Set(value.filter((item) => typeof item === 'string'))
  return PANE_FORMS.filter((form) => declared.has(form))
}

export function paneFormStorageKey(paneId) {
  return `${PANE_FORM_STORAGE_PREFIX}${String(paneId ?? '')}`
}

function readStoredForm(storage, key) {
  try {
    const raw = storage?.getItem?.(key)
    return typeof raw === 'string' && raw ? raw : null
  } catch {
    return null
  }
}

function writeStoredForm(storage, key, form) {
  try {
    storage?.setItem?.(key, form)
  } catch {
    // 持久化失败（隐私模式/配额）不拦切换：本次会话里状态仍然生效。
  }
}

/** 取浏览器存储：属性访问本身也可能抛（沙箱 iframe 的 SecurityError），拿不到就按「不持久化」跑。 */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * 一个形态状态机实例。默认值走全局单例（下面的 hostPaneForms）；测试可注入假的 storage
 * 造独立实例，不共享模块级状态。
 *
 * API：
 *   set(paneId, form) → { ok, changed, paneId, form, previous } | { ok:false, error }
 *   get(paneId) → 当前形态（缺省 dock）
 *   snapshot() → { [paneId]: form } 的普通对象（订阅者拿到的就是它）
 *   hydrate(paneIds) → 首次见到的 pane 从 localStorage 读回；已在内存里的不再被旧值覆盖
 *   subscribe(listener) → 取消订阅函数
 *   reset() → 只清内存（测试用；不动已落盘的值）
 */
export function createPaneFormStore({ storage = defaultStorage(), keyPrefix = PANE_FORM_STORAGE_PREFIX } = {}) {
  const formMap = new Map()
  /** 已经尝试过从 localStorage 读回的 pane：之后的 hydrate 不再用旧值覆盖内存里的当前状态。 */
  const hydrated = new Set()
  const listeners = new Set()

  const keyOf = (paneId) => `${keyPrefix}${paneId}`

  function snapshot() {
    return Object.fromEntries(formMap)
  }

  function get(paneId) {
    const id = String(paneId ?? '').trim()
    return formMap.get(id) ?? DEFAULT_PANE_FORM
  }

  function emit() {
    const value = snapshot()
    for (const listener of [...listeners]) {
      try {
        listener(value)
      } catch {
        // 订阅者自己的异常不拦其它订阅者与状态机。
      }
    }
  }

  function set(paneId, form) {
    const id = String(paneId ?? '').trim()
    if (!id) {
      return { ok: false, error: { code: 'INVALID_PANE_ID', message: 'setPaneForm 需要非空的 pane id' } }
    }
    if (!isPaneForm(form)) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN_PANE_FORM',
          message: `宿主不支持的打开形态：${String(form)}；可用：${PANE_FORMS.join(' / ')}`
        }
      }
    }
    const previous = get(id)
    hydrated.add(id)
    if (previous === form) return { ok: true, changed: false, paneId: id, form, previous }
    formMap.set(id, form)
    writeStoredForm(storage, keyOf(id), form)
    emit()
    return { ok: true, changed: true, paneId: id, form, previous }
  }

  function hydrate(paneIds = []) {
    let changed = false
    for (const raw of Array.isArray(paneIds) ? paneIds : []) {
      const id = String(raw ?? '').trim()
      if (!id || hydrated.has(id)) continue
      hydrated.add(id)
      const stored = readStoredForm(storage, keyOf(id))
      if (!isPaneForm(stored)) continue
      if (formMap.get(id) === stored) continue
      formMap.set(id, stored)
      changed = true
    }
    if (changed) emit()
    return snapshot()
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function reset() {
    formMap.clear()
    hydrated.clear()
    emit()
  }

  return { set, get, snapshot, hydrate, subscribe, reset, storageKey: keyOf }
}

/**
 * 宿主唯一实例：外壳 AppNext 订阅它，右键菜单／悬浮窗按钮都经这里的 setPaneForm 改状态。
 * 模块级单例是有意的——P21 要求「切换走宿主统一 API」，不允许每个组件各持一份 map。
 */
export const hostPaneForms = createPaneFormStore()

/** P21 的宿主统一入口（外壳与后续的命令面都调这一个）。 */
export function setPaneForm(paneId, form) {
  return hostPaneForms.set(paneId, form)
}

export function getPaneForm(paneId) {
  return hostPaneForms.get(paneId)
}

/** 渲染层拿到新载体清单时调一次：把 paneForm.<paneId> 的已存形态读回来。 */
export function hydratePaneForms(paneIds) {
  return hostPaneForms.hydrate(paneIds)
}

export function subscribePaneForms(listener) {
  return hostPaneForms.subscribe(listener)
}

/** 测试／重新挂载用：只清内存，不改 localStorage（持久化语义留给真实的读写用例）。 */
export function resetPaneForms() {
  hostPaneForms.reset()
}
