/**
 * Next 外壳的明暗主题。
 *
 * 权威来源（D2 · R3-1）：偏好 JSON 的 theme 字段（next-preferences.json，经 prefs:get／prefs:set 通道）。
 * 本模块只做四件事：把 scheme 落到 html class（theme-legacy theme-light／theme-dark）、
 * 提供合法性判断、**只写不读地**维护老前端那枚 localStorage 键、以及把主题变更通知主进程。
 * 最后一件是收口包⑤（调度方裁定 dwfq-5c79bf4a-1）：原生窗控浮层（titleBarOverlay）只吃真实颜色值，
 * 取不到 CSS token，所以每次 writeScheme 都发一次 prefs:theme 通知（fire-and-forget，不 await）。
 *
 * legacy-localstorage-bridge：老前端（src/stores/themeStore.js）还认 app_theme。
 * 在它退役前，Next 每次切主题都双写一次这个键——**但不从它读**：
 * 读它会形成「浏览器缓存与偏好两个真相源」，两者不一致时启动结果取决于异步时序
 * （批次14 验收实测踩中：偏好写 light、界面起成 dark）。浏览器缓存不是权威，这是 R3-1 的机器版。
 * 老前端退役后删：删掉本文件里所有 localStorage 访问，以及 AppNext 里 syncThemeFromPrefs 的迁移段。
 * 视觉门禁（next/tests/visual-contract.test.mjs）只允许这一处过渡例外，其它文件出现 localStorage 即红。
 *
 * 这里不引 pinia：Next 渲染层不引老前端的 store（薄渲染层门禁）。
 */
import { IPC_CHANNELS } from './ipcContract.mjs'

const LS_COLOR = 'app_theme'
const VALID_SCHEMES = ['light', 'dark']
const DEFAULT_SCHEME = 'light'

export function isValidScheme(value) {
  return VALID_SCHEMES.includes(value)
}

/** 首帧：偏好是异步读的，先用应用默认值把页面画出来（浏览器缓存不是权威，R3-1）。 */
export function readScheme() {
  return DEFAULT_SCHEME
}

export function applyScheme(scheme) {
  const html = globalThis.document?.documentElement
  if (!html) return
  html.classList.add('theme-legacy')
  html.classList.remove('theme-light', 'theme-dark')
  html.classList.add(`theme-${isValidScheme(scheme) ? scheme : DEFAULT_SCHEME}`)
}

export function writeScheme(scheme) {
  const next = isValidScheme(scheme) ? scheme : DEFAULT_SCHEME
  try {
    // legacy-localstorage-bridge：过渡期双写（老前端退役后删，见文件头注）。
    globalThis.localStorage?.setItem(LS_COLOR, next)
  } catch {
    // 存储不可用时内存里的主题照样生效（跟老前端 themeStore 同一口径）。
  }
  applyScheme(next)
  notifyThemeChanged(next)
  return next
}

/**
 * 通知主进程「主题已经变了」（收口包⑤）：主进程据此重设原生窗控浮层的 symbolColor。
 * 这是通知不是请求——不 await、失败静默：主题已经落在 documentElement 上，桥不在（纯浏览器预览、
 * jsdom 单测、prefs 写失败）都不影响主题本身生效。
 */
function notifyThemeChanged(scheme) {
  try {
    const sent = globalThis.pinaxNext?.request?.(IPC_CHANNELS.prefsTheme, { theme: scheme })
    sent?.catch?.(() => {})
  } catch {
    // 桥不可用时静默：下一条同主题的通知由下一次 writeScheme 再发。
  }
}
