import { createApp } from 'vue'
import AppNext from './AppNext.vue'
import './styles/legacy.mjs'
import { applyScheme, readScheme } from './theme.mjs'

/**
 * 渲染层唯一入口：没有路由、没有 store、没有 src/ 的 JS 依赖。
 * 桥由 preload 注入 window.pinaxNext；拿不到桥时外壳仍能渲染（空视图），不白屏。
 * 唯一从老前端拿的是 CSS 本体（./styles/legacy.mjs）与主题契约（./theme.mjs）。
 */
applyScheme(readScheme())

const app = createApp(AppNext, { bridge: globalThis.pinaxNext ?? null })
app.mount('#pinax-next-root')
