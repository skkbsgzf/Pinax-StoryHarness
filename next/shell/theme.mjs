/**
 * Next 外壳的明暗主题。
 *
 * 契约跟老前端 src/stores/themeStore.js 一致：同一个 localStorage 键（app_theme）、
 * 同一套 html class（theme-legacy theme-light / theme-dark）。老前端把键换成深色，
 * Next 外壳下次起来就是深色——两边认同一份偏好。
 *
 * 这里不引 pinia：Next 渲染层不引老前端的 store（薄渲染层门禁）。
 */
const LS_COLOR = 'app_theme'
const VALID_SCHEMES = ['light', 'dark']
const DEFAULT_SCHEME = 'light'

export function readScheme() {
  try {
    const stored = globalThis.localStorage?.getItem(LS_COLOR)
    return VALID_SCHEMES.includes(stored) ? stored : DEFAULT_SCHEME
  } catch {
    return DEFAULT_SCHEME
  }
}

export function applyScheme(scheme) {
  const html = globalThis.document?.documentElement
  if (!html) return
  html.classList.add('theme-legacy')
  html.classList.remove('theme-light', 'theme-dark')
  html.classList.add(`theme-${VALID_SCHEMES.includes(scheme) ? scheme : DEFAULT_SCHEME}`)
}

export function writeScheme(scheme) {
  const next = VALID_SCHEMES.includes(scheme) ? scheme : DEFAULT_SCHEME
  try {
    globalThis.localStorage?.setItem(LS_COLOR, next)
  } catch {
    // 存储不可用时内存里的主题照样生效（跟老前端 themeStore 同一口径）。
  }
  applyScheme(next)
  return next
}
