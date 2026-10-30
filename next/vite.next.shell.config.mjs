import { cp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Next 外壳主进程构建（WP4）。与 next/vite.next.main.config.mjs 同两条硬规矩：
 * build.ssr（node 平台）＋ ssr.noExternal:true（依赖内联，packager 不放行 node_modules）。
 * 与内核 bundle 分入口，是为了让「外壳起来但内核坏了」这类故障能被分开定位；两者都必须过同一份门禁断言。
 *
 * 批次37：技能目录随产物走。SKILL.md 是**运行时读的文件**，不是 vite 资产（不会被 import 进 bundle），
 * 所以构建末尾把 next/skills/ 原样拷到 next/.build/skills/；loadSkills 按模块目录解析
 * （源码轨 next/skills/，装机轨 .build/skills/），门禁里有一条 needle 盯着这份拷贝。
 */
const configDir = dirname(fileURLToPath(import.meta.url))
const SKILLS_SOURCE = join(configDir, 'skills')
const SKILLS_TARGET = join(configDir, '.build', 'skills')

function copySkillsPlugin() {
  return {
    name: 'pinax-next-copy-skills',
    apply: 'build',
    async closeBundle() {
      // 先删后拷：源里删掉的技能不该在产物里留尸（.build 是产物目录，不是作者数据）。
      await rm(SKILLS_TARGET, { recursive: true, force: true })
      await cp(SKILLS_SOURCE, SKILLS_TARGET, {
        recursive: true,
        filter: (source) => !source.endsWith('loadSkills.mjs')
      })
    }
  }
}

export default defineConfig({
  plugins: [copySkillsPlugin()],
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
