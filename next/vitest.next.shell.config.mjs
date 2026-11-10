import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

/**
 * Next 外壳的界面测试专用配置（WP4）。
 * 单独一份是为了不与仓库既有 vitest.config.js 的 include 范围打架：
 * Next 的纯逻辑用例走 node:test（next/tests/*.test.mjs），只有渲染组件需要 jsdom ＋ vue 插件。
 *
 * 注意 jsdom 这条链上被 vite 转换的模块，import.meta.url 是 http://localhost:3000/…，
 * 所以凡是要把旧内核（server/mcp/*，顶层用 fileURLToPath 定仓库根）拉进界面的用例，
 * 都得按绝对路径 require 原生加载——见 next/tests/carrier-pane-real.spec.mjs 的说明。
 * （试过 test.server.deps.external 把它排除在转换之外，jsdom 环境不吃这一套，故不留死配置。）
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['next/tests/*.spec.mjs']
  }
})
