/**
 * Next 外壳的明暗主题。
 *
 * 权威来源（D2 · R3-1）：偏好 JSON 的 theme 字段（next-preferences.json，经 prefs:get／prefs:set 通道）。
 * 本模块只做三件事：把 scheme 落到 html class（theme-legacy theme-light／theme-dark）、
 * 提供合法性判断、以及**只写不读地**维护老前端那枚 localStorage 键。
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
  return next
}
