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
    /* 〔批次76-R3 补刀·A2 根治〕emptyOutDir 改 false：整目录抹掉会把门禁刚拷的 skills/ 与
       renderer 产物一起带走（症状＝「首跑红、原地重跑即绿」）。陈旧产物由 next:bundle 的
       断言把关（入口 bundle 文件名固定，门禁前先定向清），这里不再整目录清场。 */
    emptyOutDir: false,
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
