import { defineConfig } from 'vite'

/**
 * Next 外壳 preload 构建（批次 7 补上）。
 *
 * 为什么必须有这一步：preload 源（next/shell/preload.mjs）相对引入 ipcContract.mjs，
 * 直接拷进 next/.build/ 会 ERR_MODULE_NOT_FOUND；而 .build/ 里的 preload.mjs 此前是
 * 批次 5 时代的一次性手工产物——没有构建步骤、没有门禁管它，重建渲染层后桥就静默消失
 * （批次 7 实测踩中：「渲染层未接主进程桥」而打包门禁全绿）。
 *
 * 与 main/shell 同两条硬规矩：build.ssr（相对导入内联）＋ ssr.noExternal:true，
 * electron 保持 external（preload 运行在渲染进程，electron 内置可用）。
 */
export default defineConfig({
  build: {
    ssr: 'next/shell/preload.mjs',
    outDir: 'next/.build',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: 'node22',
    rollupOptions: {
      external: ['electron'],
      output: {
        format: 'es',
        entryFileNames: 'preload.mjs'
      }
    }
  },
  ssr: {
    noExternal: true
  }
})
