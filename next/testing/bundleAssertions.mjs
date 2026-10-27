#!/usr/bin/env node
/* eslint-disable no-console */
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'

/**
 * 打包侧门禁（M1 · WP6 断言 a/b/c/d）。依据 2026-10-27 的四个桩，改动前先跑 npm run verify:next。
 *   a 构建参数：build.ssr ＋ ssr.noExternal:true（缺一条就坏，一条炸在 node:crypto，一条装机即断）
 *   b 裸导入白名单：用 rollup 自己的 generateBundle 结果判定，不用正则扫文本
 *     —— 正则会把 ajv 代码生成里的 `require("ajv/dist/runtime/uri")` 字符串和 SDK 的 JSDoc 误判成裸导入。
 *   c Express 不进桌包。
 *   d 产物自足可执行：直接 import 产物跑一次 in-process 往返，"编译通过"不算数。
 *   e 外壳 bundle 同规则（a4/b2），并且应用菜单是真的打进产物里（今天 electron/ 里 grep 不到 Menu）。
 *   f 渲染层依赖薄：renderer 产物不得带内核工具面或旧轨代码。
 */
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const CONFIG_PATH = join(repoRoot, 'next', 'vite.next.main.config.mjs')
const BUNDLE_PATH = join(repoRoot, 'next', '.build', 'pinax-next-main.mjs')
const ALLOWED_BARE = new Set(['electron', 'better-sqlite3', 'bindings', 'file-uri-to-path'])

const failures = []
function check(name, passed, note = '') {
  console.log(`${passed ? '✔' : '✘'} ${name}${note ? ` — ${note}` : ''}`)
  if (!passed) failures.push(name)
}

const configSource = await readFile(CONFIG_PATH, 'utf-8')
check('a1 构建参数：build.ssr 指向 next/mainEntry.mjs', /build:\s*\{[\s\S]*?ssr:\s*'next\/mainEntry\.mjs'/.test(configSource))
check('a2 构建参数：ssr.noExternal:true', /ssr:\s*\{\s*noExternal:\s*true/.test(configSource))
check('a3 构建参数：external 保住 electron 与原生模块', /external:\s*\[[^\]]*'electron'/.test(configSource))

let captured = { imports: [], dynamicImports: [], modules: 0 }
await build({
  logLevel: 'warn',
  configFile: CONFIG_PATH,
  plugins: [{
    name: 'pinax-next-capture-externals',
    generateBundle(_options, bundle) {
      const imports = new Set()
      const dynamicImports = new Set()
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue
        for (const specifier of item.imports ?? []) imports.add(specifier)
        for (const specifier of item.dynamicImports ?? []) dynamicImports.add(specifier)
      }
      captured = { imports: [...imports], dynamicImports: [...dynamicImports], modules: Object.keys(bundle).length }
    }
  }]
})

const offenders = [...captured.imports, ...captured.dynamicImports]
  .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:') && !ALLOWED_BARE.has(specifier))
check('b 裸导入白名单：产物只剩 electron／node:*／原生模块', offenders.length === 0, offenders.join(', ') || `外部说明符 ${captured.imports.length + captured.dynamicImports.length} 条`)

const bundle = await readFile(BUNDLE_PATH, 'utf-8')
check('c Express 不进桌包：产物内 express 命中 0', (bundle.match(/\bexpress\b/g) ?? []).length === 0)

const info = await stat(BUNDLE_PATH)
check('体积记账：主进程 bundle 未压缩 < 1.6 MB', info.size < 1.6 * 1024 * 1024, `${(info.size / 1024).toFixed(1)} kB`)

// d：把产物当真装机的模块跑一遍（桩 2d 的做法——只"编译通过"不算自足）。
try {
  const mod = await import(pathToFileURL(BUNDLE_PATH).href)
  const surface = mod.createMcpSurface()
  const link = await mod.connectInProcess(surface)
  const listed = await link.listTools()
  await link.close()
  check('d 产物自足可执行：import 产物后 in-process 列出 19 工具', listed.length === 19, `toolCount=${listed.length}`)
  check('内核版本对外可见：KERNEL_INFO.contractVersion=1', mod.KERNEL_INFO?.contractVersion === '1', mod.NEXT_VERSION ?? '')
} catch (error) {
  check('d 产物自足可执行：import 产物后 in-process 列出 19 工具', false, String(error?.message || error).slice(0, 120))
}

console.log(`ℹ 原生模块：bundle 文本引用 better-sqlite3 ＝ ${/better-sqlite3/.test(bundle) ? '是' : '否'}；换档脚本在 win32 直接 return，Electron ABI 档要在出包后单独核`)

// 外壳主进程入口（next/shell/main.mjs）与内核入口分两个 bundle，但过同一套断言：
// 少一条参数就是同一类装机故障，两个入口都得守。
const SHELL_CONFIG_PATH = join(repoRoot, 'next', 'vite.next.shell.config.mjs')
const SHELL_BUNDLE_PATH = join(repoRoot, 'next', '.build', 'pinax-next-shell-main.mjs')
const shellConfigSource = await readFile(SHELL_CONFIG_PATH, 'utf-8')
check('a4 外壳构建参数：build.ssr 指向 next/shell/main.mjs ＋ noExternal:true',
  /ssr:\s*'next\/shell\/main\.mjs'/.test(shellConfigSource) && /ssr:\s*\{\s*noExternal:\s*true/.test(shellConfigSource))

let shellCaptured = { imports: [], dynamicImports: [] }
await build({
  logLevel: 'warn',
  configFile: SHELL_CONFIG_PATH,
  plugins: [{
    name: 'pinax-next-capture-shell-externals',
    generateBundle(_options, bundleOutput) {
      const imports = new Set()
      for (const item of Object.values(bundleOutput)) {
        if (item.type !== 'chunk') continue
        for (const specifier of item.imports ?? []) imports.add(specifier)
        for (const specifier of item.dynamicImports ?? []) imports.add(specifier)
      }
      shellCaptured = { imports: [...imports], dynamicImports: [] }
    }
  }]
})
const shellOffenders = shellCaptured.imports
  .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:') && !ALLOWED_BARE.has(specifier))
check('b2 外壳 bundle 裸导入白名单：只剩 electron／node:*／原生模块', shellOffenders.length === 0, shellOffenders.join(', ') || `外部说明符 ${shellCaptured.imports.length} 条`)

const shellBundle = await readFile(SHELL_BUNDLE_PATH, 'utf-8')
// 今天整个 electron/ 目录 grep 不到 Menu——这条断言保证 Next 的应用菜单是真的进了产物。
check('e 应用菜单落地：外壳产物里有 buildFromTemplate／setApplicationMenu 与通道注册',
  /buildFromTemplate/.test(shellBundle) && /setApplicationMenu/.test(shellBundle) && /ipcMain/.test(shellBundle))

// 渲染层必须薄：只带 Vue 与外壳组件，不带内核、不带 MCP 工具面、不碰旧轨页面。
await build({ logLevel: 'warn', configFile: join(repoRoot, 'next', 'vite.next.renderer.config.mjs') })
const rendererDir = join(repoRoot, 'next', '.build', 'renderer-next', 'assets')
const rendererFiles = await readdir(rendererDir)
const rendererJs = rendererFiles.filter((name) => name.endsWith('.js'))
let rendererBytes = 0
for (const name of rendererJs) rendererBytes += (await stat(join(rendererDir, name))).size
const rendererSource = (await readFile(join(rendererDir, rendererJs[0]), 'utf-8')).slice(0, 400_000)
check('f 渲染层依赖薄：不含内核工具面与旧轨代码',
  !/pinax_project_open/.test(rendererSource) && !/createPinaxMcpServer/.test(rendererSource) && !/__vite-browser-external/.test(rendererSource),
  `renderer js ${(rendererBytes / 1024).toFixed(1)} kB`)

// prod 那条加载路径是窗口有没有内容的唯一入口：曾经写成 bundle 的上一级，装机起来是白屏而门禁全绿。
const rendererHtml = join(repoRoot, 'next', '.build', 'renderer-next', 'index.html')
const htmlExists = await stat(rendererHtml).then(() => true, () => false)
check('g 外壳 prod 加载路径指得到渲染层产物：bundle 同级 renderer-next/index.html 存在，且产物里就是这个写法',
  htmlExists && /join\(currentDir, "renderer-next", "index\.html"\)/.test(shellBundle),
  htmlExists ? 'next/.build/renderer-next/index.html' : '产物缺失')

// 风格复用要真的进到产物里：渲染层 CSS 必须带着老前端那套控件词汇与 token（明暗两套），
// 否则「我们复用了原版风格」只是源码里的一句 imports，装机出来又是另一个样子。
const rendererCssName = rendererFiles.find((name) => name.endsWith('.css'))
const rendererCss = rendererCssName ? await readFile(join(rendererDir, rendererCssName), 'utf-8') : ''
const legacyMarkers = [
  '--control-accent-bg',
  '.control-primary',
  '--radius-control',
  '--workbench-action',
  '--archive-ink',
  '--font-writing',
  'theme-legacy.theme-dark'
]
const missingMarkers = legacyMarkers.filter((marker) => !rendererCss.includes(marker))
check('h 风格复用进产物：渲染层 CSS 带着老前端的控件词汇与 token（明暗两套）',
  Boolean(rendererCssName) && missingMarkers.length === 0,
  missingMarkers.length ? `缺 ${missingMarkers.join(' ')}` : `${rendererCssName} ${(rendererCss.length / 1024).toFixed(1)} kB`)

const fontAssets = rendererFiles.filter((name) => name.endsWith('.woff2'))
check('i 自托管字体进产物：霞鹜文楷 woff2 跟着走（不然标题会落回系统默认字体）',
  fontAssets.length > 0,
  fontAssets.join(' ') || '没找到 .woff2 资源')

// 「运行时能问」这条链必须真的在产物里：主进程装了进程内 advisor 运行器，
// 且模型面端点可被 env 覆写（不覆写就只会连默认 8451，装机到别的机器必然是那句「未检测到可用模型」）。
// 这条只证明「链路在产物里」，不证明「此刻有可用模型」——后者要凭据才能验；
// 没有模型时的如实失败路径另有测试钉着（shell-contract：未注入 runner 时必须报缺，不编回答）。
const modelPlaneMarkers = ['createAdvisorRunner', 'PINAX_ADAPTER_ENDPOINT', 'KIT_TASK_PLANE_ENDPOINT']
const missingModelPlane = modelPlaneMarkers.filter((marker) => !shellBundle.includes(marker))
check('j 模型面在产物里：外壳 bundle 带着进程内 advisor 运行器与模型面端点（env 可覆写）',
  missingModelPlane.length === 0,
  missingModelPlane.length ? `缺 ${missingModelPlane.join(' ')}` : `${modelPlaneMarkers.length} 个标记齐`)

// preload 是「渲染层接得上主进程」的唯一桥：批次 7 前它是一次性手工产物，没有构建步骤也没有门禁，
// 一次重建渲染层就让桥静默消失（实测踩中：界面报「渲染层未接主进程桥」而门禁全绿）。
// 现在它在打包断言里就地构建（本文件上方与 a4/b2 同一套 vite 约束），并断言产物存在、桥面完整。
const PRELOAD_CONFIG_PATH = join(repoRoot, 'next', 'vite.next.preload.config.mjs')
const PRELOAD_BUNDLE_PATH = join(repoRoot, 'next', '.build', 'preload.mjs')
await build({ logLevel: 'warn', configFile: PRELOAD_CONFIG_PATH })
const preloadExists = await stat(PRELOAD_BUNDLE_PATH).then(() => true, () => false)
const preloadSource = preloadExists ? await readFile(PRELOAD_BUNDLE_PATH, 'utf-8') : ''
const preloadMarkers = ['contextBridge', 'pinaxNext', 'pinax:agent:']
const missingPreload = preloadExists ? preloadMarkers.filter((marker) => !preloadSource.includes(marker)) : ['(文件缺失)']
check('k preload 在产物里：bundle 同级 preload.mjs 存在且带 contextBridge 桥面与通道白名单',
  preloadExists && missingPreload.length === 0,
  missingPreload.length ? `缺 ${missingPreload.join(' ')}` : `${(preloadSource.length / 1024).toFixed(1)} kB`)

if (failures.length) {
  console.log(`\n打包门禁：${failures.length} 项不合格 → ${failures.join(' / ')}`)
  process.exitCode = 1
} else {
  console.log('\n打包门禁：全部通过（构建参数／裸导入白名单／无 Express／产物可执行）')
}
