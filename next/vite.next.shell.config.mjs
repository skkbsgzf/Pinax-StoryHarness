import { defineConfig } from 'vite'

/**
 * Next 外壳主进程构建（WP4）。与 next/vite.next.main.config.mjs 同两条硬规矩：
 * build.ssr（node 平台）＋ ssr.noExternal:true（依赖内联，packager 不放行 node_modules）。
 * 与内核 bundle 分入口，是为了让「外壳起来但内核坏了」这类故障能被分开定位；两者都必须过同一份门禁断言。
 */
export default defineConfig({
  build: {
    ssr: 'next/shell/main.mjs',
    outDir: 'next/.build',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: 'node22',
    rollupOptions: {
      external: ['electron', 'better-sqlite3', 'bindings', 'file-uri-to-path'],
      output: {
        format: 'es',
        entryFileNames: 'pinax-next-shell-main.mjs'
      }
    }
  },
  ssr: {
    noExternal: true
  }
})
