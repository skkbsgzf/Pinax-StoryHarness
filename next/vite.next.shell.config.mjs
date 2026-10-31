import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
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
 *
 * 协议 v3：载体自己的**面板页**（entry 面）也是运行时读的文件——宿主用 pinax-plugin:// 协议
 * 把 next/carriers/<名字>/ui/ 供成沙箱 iframe。载体清单里的 meta.dir 是按 import.meta.url 解析的，
 * 装机构里它指向 next/.build/<名字>/，所以构建末尾把每块载体的 ui/ 原样拷过去（与技能同一套路）。
 *
 * 同一套路也管着 **AGENT.md**（协议 v3 的 agentMd 面）：它是运行时从插件目录读的文件，
 * 不是 vite 资产。只拷 ui/ 而漏了它，装机后每栏的作者须知会静默消失——
 * 须知缺席不报错，只是模型突然不守那栏的规矩。
 */
const configDir = dirname(fileURLToPath(import.meta.url))
const SKILLS_SOURCE = join(configDir, 'skills')
const SKILLS_TARGET = join(configDir, '.build', 'skills')
const CARRIERS_SOURCE = join(configDir, 'carriers')
const BUILD_TARGET = join(configDir, '.build')

/** 载体目录里有没有 ui/ 子目录（没有就不拷，不留空目录当证据）。 */
async function hasUiDir(dir) {
  try {
    const info = await stat(join(dir, 'ui'))
    return info.isDirectory()
  } catch {
    return false
  }
}

/**
 * 拷一份载体资产到产物：ui/ 目录（面板页）＋ AGENT.md（作者须知）。
 * 两者都是运行时从盘上读的文件，不进 vite 资产图；少了哪一个都是静默失效：
 * 少 ui/ 面板是白板，少 AGENT.md 那栏的须知就没了（模型突然不守那栏的规矩，没人报错）。
 */
async function copyCarrierAssets() {
  let entries = []
  try {
    entries = await readdir(CARRIERS_SOURCE, { withFileTypes: true })
  } catch {
    return []
  }
  const copied = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const source = join(CARRIERS_SOURCE, entry.name)
    const target = join(BUILD_TARGET, entry.name)
    let hasAsset = false
    if (await hasUiDir(source)) {
      await rm(target, { recursive: true, force: true })
      await cp(join(source, 'ui'), join(target, 'ui'), { recursive: true })
      hasAsset = true
    }
    const agentMd = join(source, 'AGENT.md')
    if (await stat(agentMd).then((info) => info.isFile(), () => false)) {
      await mkdir(target, { recursive: true })
      await cp(agentMd, join(target, 'AGENT.md'))
      hasAsset = true
    }
    if (hasAsset) copied.push(entry.name)
  }
  return copied
}

function copyAssetsPlugin() {
  return {
    name: 'pinax-next-copy-assets',
    apply: 'build',
    async closeBundle() {
      // 先删后拷：源里删掉的技能／面板不该在产物里留尸（.build 是产物目录，不是作者数据）。
      await rm(SKILLS_TARGET, { recursive: true, force: true })
      await cp(SKILLS_SOURCE, SKILLS_TARGET, {
        recursive: true,
        filter: (source) => !source.endsWith('loadSkills.mjs')
      })
      await copyCarrierAssets()
    }
  }
}

export default defineConfig({
  plugins: [copyAssetsPlugin()],
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
