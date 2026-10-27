import { defineConfig } from 'vite'

/**
 * Pinax-Electron-Next · 主进程构建配置（M1 · WP3/WP6）。
 * 两条参数都是踩出来的，缺一条就坏，改动前请先跑 npm run verify:next：
 *   - build.ssr：走 node 平台，`node:crypto` 等内建不会被换成浏览器 stub
 *     （普通 vite build 会在 server/services/localMirrorTransaction.js:3 的 createHash 上直接中止）。
 *   - ssr.noExternal:true：把 npm 依赖全量内联。forge.config.cjs 的忽略规则只放行
 *     better-sqlite3/bindings/file-uri-to-path，外置依赖装进包里就是死链接。
 * external 保留 electron 与原生模块：它们由运行时提供，不能进 bundle。
 */
export default defineConfig({
  build: {
    ssr: 'next/mainEntry.mjs',
    outDir: 'next/.build',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'node22',
    rollupOptions: {
      external: ['electron', 'better-sqlite3', 'bindings', 'file-uri-to-path'],
      output: {
        format: 'es',
        entryFileNames: 'pinax-next-main.mjs'
      }
    }
  },
  ssr: {
    noExternal: true
  }
})
