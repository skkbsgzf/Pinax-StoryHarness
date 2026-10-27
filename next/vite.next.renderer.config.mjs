import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * Next 渲染层构建（WP4）。
 * 与老 web 轨彻底分开：root 指 next/shell，不配 @→src 别名，也不代理 3001 的 API
 * ——外壳唯一的对外面是 next/shell/ipcContract 里那几条 pinax:agent:* 通道。
 * 端口 5273 是 Next 专用，避开作者正在跑的 5173/3001。
 */
export default defineConfig({
  plugins: [vue()],
  root: resolve(process.cwd(), 'next/shell'),
  base: './',
  build: {
    outDir: resolve(process.cwd(), 'next/.build/renderer-next'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: resolve(process.cwd(), 'next/shell/index.html')
    }
  },
  server: {
    port: 5273,
    strictPort: true
  }
})
