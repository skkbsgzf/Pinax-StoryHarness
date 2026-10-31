#!/usr/bin/env node
/* eslint-disable no-console */
import { cp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { loadSkills } from '../skills/loadSkills.mjs'
import { SKILL_READ_TOOL } from '../runtime/skillTools.mjs'
import { BUILT_IN_CARRIER_PLUGINS } from '../carriers/index.mjs'

/**
 * 打包侧门禁（M1 · WP6 断言 a/b/c/d）。依据 2026-10-27 的四个桩，改动前先跑 npm run verify:next。
 *   a 构建参数：build.ssr ＋ ssr.noExternal:true（缺一条就坏，一条炸在 node:crypto，一条装机即断）
 *   b 裸导入白名单：用 rollup 自己的 generateBundle 结果判定，不用正则扫文本
 *     —— 正则会把 ajv 代码生成里的 `require("ajv/dist/runtime/uri")` 字符串和 SDK 的 JSDoc 误判成裸导入。
 *     Node 内建按 isBuiltin 放行（isomorphic-git 的 CJS 产物会以 `crypto`／`buffer` 裸名出现）。
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
const SKILLS_SOURCE = join(repoRoot, 'next', 'skills')
const SKILLS_TARGET = join(repoRoot, 'next', '.build', 'skills')

/**
 * 批次37：技能目录随产物走（SKILL.md 是运行时读的文件，不是 vite 资产）。
 * 这里先拷一份，下面的 d2（主进程 bundle 里的运行时面）与本文件末尾的 needle 都按产物路径读；
 * 真正的构建期拷贝在 vite.next.shell.config.mjs 的 closeBundle 里（打包走那条）。
 */
async function copySkillsToBuild() {
  await rm(SKILLS_TARGET, { recursive: true, force: true })
  await cp(SKILLS_SOURCE, SKILLS_TARGET, {
    recursive: true,
    filter: (source) => !source.endsWith('loadSkills.mjs')
  })
}

/**
 * 外部说明符是否可接受：相对路径、Node 内建（含不带 node: 前缀的写法）、白名单里的运行时依赖。
 * isomorphic-git（R3 内置 git 库）的 CJS 产物 require('crypto')/require('buffer') 不带 node: 前缀，
 * Vite SSR 会原样外部化；它们是 Node 内建而不是「没打进包的 npm 依赖」，所以按 isBuiltin 放行。
 * 白名单本身没动：新增 npm 依赖仍必须经 ssr.noExternal 内联进 bundle。
 */
function isAllowedExternal(specifier) {
  return specifier.startsWith('.')
    || specifier.startsWith('/')
    || specifier.startsWith('node:')
    || isBuiltin(specifier)
    || ALLOWED_BARE.has(specifier)
}

const failures = []
function check(name, passed, note = '') {
  console.log(`${passed ? '✔' : '✘'} ${name}${note ? ` — ${note}` : ''}`)
  if (!passed) failures.push(name)
}

const configSource = await readFile(CONFIG_PATH, 'utf-8')
check('a1 构建参数：build.ssr 指向 next/mainEntry.mjs', /build:\s*\{[\s\S]*?ssr:\s*'next\/mainEntry\.mjs'/.test(configSource))
check('a2 构建参数：ssr.noExternal:true', /ssr:\s*\{\s*noExternal:\s*true/.test(configSource))
check('a3 构建参数：external 保住 electron 与原生模块', /external:\s*\[[^\]]*'electron'/.test(configSource))

// 先拷技能，再建主进程 bundle：d2 会真起一次运行时面，它按产物路径读技能清单。
await copySkillsToBuild()

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
  .filter((specifier) => !isAllowedExternal(specifier))
check('b 裸导入白名单：产物只剩 electron／Node 内建／原生模块', offenders.length === 0, offenders.join(', ') || `外部说明符 ${captured.imports.length + captured.dynamicImports.length} 条`)

const bundle = await readFile(BUNDLE_PATH, 'utf-8')
check('c Express 不进桌包：产物内 express 命中 0', (bundle.match(/\bexpress\b/g) ?? []).length === 0)

// R3 裁定（2026-10-28，作者原话「忽略这个门禁，可以把它打到包里面」）：内置 git 库随包发布，
// 体积上限 1.6 MB → 6 MB。实际值继续打印，涨到哪儿一眼看得见（isomorphic-git 约 +1 MB 级，
// 设计见 docs/plan/next-git-history-design-20261028.md §3）。
const info = await stat(BUNDLE_PATH)
check('体积记账：主进程 bundle 未压缩 < 6 MB（按 R3 裁定：内置 git 库随包发布）', info.size < 6 * 1024 * 1024, `${(info.size / 1024).toFixed(1)} kB`)

// d：把产物当真装机的模块跑一遍（桩 2d 的做法——只"编译通过"不算自足）。
/** 末尾 m2 复用：bundle 产物的纯内核工具名。 */
let kernelSurfaceNames = []
try {
  const mod = await import(pathToFileURL(BUNDLE_PATH).href)
  const surface = mod.createMcpSurface()
  const link = await mod.connectInProcess(surface)
  const listed = await link.listTools()
  kernelSurfaceNames = listed.map((tool) => tool.name)
  await link.close()
  // createMcpSurface 是「纯内核那一份」，19 把内核工具；技能读取是运行时自有工具，由 d2 核。
  check('d 产物自足可执行：import 产物后 in-process 列出内核 19 工具', listed.length === 19, `toolCount=${listed.length}`)

  // d2：真实运行时面（内核 19 ＋ pinax_skill_read ＋ pinax_service_log_list）。批次37 起技能目录随产物走；
  // 批次49 起服务日志读取也是原生工具（没有服务时如实回空数组）。空框架（没有载体）时，
  // 声明了载体写工具的技能会如实拒装 SKILL_TOOLS_NOT_ON_SURFACE——这不是失败，工具本身必须在面上；
  // 「技能能装载」由末尾 m2 按完整面核。
  const runtime = mod.createAgentRuntime({})
  await runtime.start()
  const names = runtime.listTools().map((tool) => tool.name)
  const skillRejected = runtime.surfaceInfo().skills?.rejected?.map((item) => item.code) ?? []
  await runtime.stop()
  check('d2 运行时面：内核 19 ＋ pinax_skill_read ＋ pinax_service_log_list（21）', names.length === 21 && names.includes('pinax_skill_read') && names.includes('pinax_service_log_list'), `toolCount=${names.length}${skillRejected.length ? `；技能装载记账=${skillRejected.join(',')}` : ''}`)
  check('内核版本对外可见：KERNEL_INFO.contractVersion=1', mod.KERNEL_INFO?.contractVersion === '1', mod.NEXT_VERSION ?? '')
} catch (error) {
  check('d 产物自足可执行：import 产物后 in-process 列出 21 工具（内核 19 ＋ 技能读取＋服务日志读取）', false, String(error?.message || error).slice(0, 120))
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
  .filter((specifier) => !isAllowedExternal(specifier))
check('b2 外壳 bundle 裸导入白名单：只剩 electron／Node 内建／原生模块', shellOffenders.length === 0, shellOffenders.join(', ') || `外部说明符 ${shellCaptured.imports.length} 条`)

const shellBundle = await readFile(SHELL_BUNDLE_PATH, 'utf-8')
// 今天整个 electron/ 目录 grep 不到 Menu——这条断言保证 Next 的应用菜单是真的进了产物。
check('e 应用菜单落地：外壳产物里有 buildFromTemplate／setApplicationMenu 与通道注册',
  /buildFromTemplate/.test(shellBundle) && /setApplicationMenu/.test(shellBundle) && /ipcMain/.test(shellBundle))

// 批次14 记账（收口包④）：外壳 bundle 也纳入体积断言。它与内核 bundle 是两个入口，
// 但把内置 git 库与知识服务一起打进产物，是同一类风险；上限 2.5 MB 给足余量（当时约 1.5 MB），
// 实际值照常打印——涨到哪儿一眼看得见，超了就先停下来问「这次新增的东西值不值这个价」。
const shellInfo = await stat(SHELL_BUNDLE_PATH)
check('e2 体积记账：外壳 bundle 未压缩 < 2.5 MB（含 git 库＋知识服务）',
  shellInfo.size < 2.5 * 1024 * 1024,
  `${(shellInfo.size / 1024).toFixed(1)} kB`)

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

// R3-3 运行时不变量：内置 git 库只在主进程用，渲染层产物不得含 git 历史引擎的任何标记。
// 误引一次就等于把 Node 专用代码与 ~1 MB 包体拖进渲染层，还会在 jsdom/窗口里直接炸。
const GIT_LIBRARY_MARKERS = ['isomorphic-git', 'gitdir', 'commitSnapshot', 'HISTORY_UNAVAILABLE', 'next/history']
const rendererGitHits = []
for (const name of rendererJs) {
  const text = await readFile(join(rendererDir, name), 'utf-8')
  for (const marker of GIT_LIBRARY_MARKERS) {
    if (text.includes(marker)) rendererGitHits.push(`${name}:${marker}`)
  }
}
check('f2 渲染层产物不含 isomorphic-git：git 历史只归主进程',
  rendererGitHits.length === 0,
  rendererGitHits.join(', ') || `扫了 ${rendererJs.length} 个 js`)

// 渲染层是从 next/shell 根构建的：源码里出现 history 导入就是越界的早期信号（产物断言 f2 是最后一道）。
// main.mjs 是 Electron 主进程入口（D1 起它要建历史仓库、起定时器），不是渲染层源码；
// 它没有进入渲染层产物（入口是 index.html），渲染层可达性由 f2 的产物断言兜底。
const shellSourceFiles = (await collectSourceFiles(join(repoRoot, 'next', 'shell')))
  .filter((rel) => rel !== 'main.mjs')
const historyImportHits = []
for (const rel of shellSourceFiles) {
  const text = await readFile(join(repoRoot, 'next', 'shell', rel), 'utf-8')
  const specifiers = [...text.matchAll(/(?:import|from)\s*(?:\(\s*)?['"]([^'"]+)['"]/g)].map((match) => match[1])
  for (const specifier of specifiers) {
    if (/(?:^|\/)history\//.test(specifier)) historyImportHits.push(`${rel} → ${specifier}`)
  }
}
check('l 渲染层外壳源码不 import next/history/：git 历史引擎不得进渲染层',
  historyImportHits.length === 0,
  historyImportHits.join(', ') || `扫了 ${shellSourceFiles.length} 个渲染层源文件`)

// 批次37：技能目录进产物（M2.5-B 记账的欠账）。
// SKILL.md 是运行时读的文件，不是 vite 资产——构建期 copy 到 .build/skills/，loadSkills 按模块目录
// 双落点解析（源码轨 next/skills/、装机轨 .build/skills/）。三条 needle 各管一段：
//   m  文件真的在产物路径上（与源码目录逐一对应）；
//   m2 在这个目录上真能装载出 5 个技能（按「项目打开、七块载体都在」的完整工具面校验）；
//   m3 外壳 bundle 带着目录覆盖口与目录名，装机后不会退回「找不到技能目录」。
const sourceSkillDirs = (await readdir(SKILLS_SOURCE, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
const missingSkillFiles = []
for (const name of sourceSkillDirs) {
  const exists = await stat(join(SKILLS_TARGET, name, 'SKILL.md')).then(() => true, () => false)
  if (!exists) missingSkillFiles.push(name)
}
check('m 技能目录进产物：.build/skills/<技能>/SKILL.md 与源码逐一对应',
  sourceSkillDirs.length > 0 && missingSkillFiles.length === 0,
  missingSkillFiles.length ? `缺 ${missingSkillFiles.join(', ')}` : `${sourceSkillDirs.length} 个：${sourceSkillDirs.join(' / ')}`)

// 工具面按「项目已打开、七块内置载体都在」取：技能声明的 savers 是载体自有工具，
// 只有内核 19 把时四份技能本就该被如实拒装（空框架面），不能拿那个面来判装机轨。
const carrierDeclaredTools = BUILT_IN_CARRIER_PLUGINS
  .flatMap((plugin) => plugin?.manifest?.tools ?? [])
const fullSurface = [...new Set([...kernelSurfaceNames, ...carrierDeclaredTools, SKILL_READ_TOOL])]
const loadedFromBuild = await loadSkills({ dir: SKILLS_TARGET, availableTools: fullSurface })
check('m2 装机轨技能可装载：loadSkills 在 .build/skills 按源码目录数装载且零拒装',
  loadedFromBuild.skills.length === sourceSkillDirs.length && loadedFromBuild.rejected.length === 0,
  loadedFromBuild.rejected.length
    ? `拒装 ${loadedFromBuild.rejected.map((item) => `${item.dir}:${item.code}`).join(', ')}`
    : `${loadedFromBuild.skills.length}/${sourceSkillDirs.length}：${loadedFromBuild.skills.map((skill) => skill.name).join(' / ')}`)

// 只认覆盖口这一个标识符：目录名 "skills" 在压缩产物里可能被改写成单引号或拼接片段，
// 按字面 needle 守会误伤构建器，守「双落点解析的入口存在」才是真正想守的东西。
check('m3 外壳 bundle 的双落点解析在产物里：保留 PINAX_NEXT_SKILLS_DIR 覆盖口',
  shellBundle.includes('PINAX_NEXT_SKILLS_DIR'),
  shellBundle.includes('PINAX_NEXT_SKILLS_DIR') ? '覆盖口在' : '缺 PINAX_NEXT_SKILLS_DIR')

// 协议 v3 的 entry 面（插件自带面板）在产物里得有两件东西：
//   n  面板页与它的脚本随产物走（next/carriers/<名字>/ui → next/.build/<名字>/ui）；
//      面板页是运行时从盘上读的静态文件，不进 vite 资产图——漏拷一次装机就是一块白板。
//   n2 外壳 bundle 带着面板协议本身（pinax-plugin:// 与它的处理器）；
//      协议没进包，面板页连都取不到。
const CARRIERS_SOURCE = join(repoRoot, 'next', 'carriers')
const BUILD_DIR = join(repoRoot, 'next', '.build')
const sourceCarrierUiDirs = []
for (const entry of await readdir(CARRIERS_SOURCE, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const hasUi = await stat(join(CARRIERS_SOURCE, entry.name, 'ui')).then((info) => info.isDirectory(), () => false)
  if (hasUi) sourceCarrierUiDirs.push(entry.name)
}
const missingCarrierAssets = []
for (const name of sourceCarrierUiDirs) {
  const exists = await stat(join(BUILD_DIR, name, 'ui', 'index.html')).then(() => true, () => false)
  if (!exists) missingCarrierAssets.push(name)
}
check('n 载体面板资产进产物：.build/<载体>/ui/index.html 与源码逐一对应',
  sourceCarrierUiDirs.length > 0 && missingCarrierAssets.length === 0,
  missingCarrierAssets.length ? `缺 ${missingCarrierAssets.join(', ')}` : `${sourceCarrierUiDirs.join(' / ')}`)

const panelProtocolMarkers = ['pinax-plugin', 'registerSchemesAsPrivileged', 'content-security-policy']
const missingPanelProtocol = panelProtocolMarkers.filter((marker) => !shellBundle.includes(marker))
check('n2 面板协议在产物里：外壳 bundle 带 pinax-plugin 协议与它的 CSP 响应头',
  missingPanelProtocol.length === 0,
  missingPanelProtocol.length ? `缺 ${missingPanelProtocol.join(' ')}` : `${panelProtocolMarkers.length} 个标记齐`)

// 协议 v3 的 agentMd 面：每栏的作者须知是运行时从插件目录读的文件（不进 vite 资产图）。
// 漏拷一次，装机后十二栏的须知会静默消失——不报错，只是模型突然不守那栏的规矩。
const carrierDirsInSource = []
for (const entry of await readdir(CARRIERS_SOURCE, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const hasAgentMd = await stat(join(CARRIERS_SOURCE, entry.name, 'AGENT.md')).then((info) => info.isFile(), () => false)
  if (hasAgentMd) carrierDirsInSource.push(entry.name)
}
const missingAgentMd = []
for (const name of carrierDirsInSource) {
  const exists = await stat(join(BUILD_DIR, name, 'AGENT.md')).then(() => true, () => false)
  if (!exists) missingAgentMd.push(name)
}
check('n3 载体作者须知进产物：.build/<载体>/AGENT.md 与源码逐一对应',
  carrierDirsInSource.length > 0 && missingAgentMd.length === 0,
  missingAgentMd.length ? `缺 ${missingAgentMd.join(', ')}` : `${carrierDirsInSource.length} 份`)

// 批次48（门禁 o）：services／mcp 牌声明的 .mjs 运行期脚本必须随载体进产物。
// 理由：宿主按清单以插件目录为 cwd 起这些脚本（node preview-server.mjs／comfy-mcp-bridge.mjs）；
// 脚本没拷进 .build，装机后就是「声明在、进程永远起不来」——预览白页、桥连不上，
// 而且失败只落在服务日志里，不会让构建报错。所以从清单取文件名逐一对照产物，不硬编码。
const runtimeScripts = []
for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
  const name = String(plugin?.meta?.source ?? '').split('/').pop()
  const declared = [...(plugin.manifest?.services ?? []), ...(plugin.manifest?.mcp ?? [])]
  for (const item of declared) {
    for (const arg of Array.isArray(item?.args) ? item.args : []) {
      const raw = String(arg ?? '')
      if (/\.mjs$/u.test(raw) && !raw.includes('/') && !raw.includes('\\')) runtimeScripts.push({ name, script: raw })
    }
  }
}
const missingRuntimeScripts = []
for (const { name, script } of runtimeScripts) {
  const exists = await stat(join(BUILD_DIR, name, script)).then((info) => info.isFile(), () => false)
  if (!exists) missingRuntimeScripts.push(`${name}/${script}`)
}
check('o 载体 services／mcp 脚本进产物：清单声明的 .mjs 运行期脚本在 .build/<载体>/ 下逐一存在',
  runtimeScripts.length > 0 && missingRuntimeScripts.length === 0,
  missingRuntimeScripts.length
    ? `缺 ${missingRuntimeScripts.join(', ')}`
    : runtimeScripts.map((item) => `${item.name}/${item.script}`).join(' / '))

// 批次58（门禁 p）：三独立体接入底座的纪律面。计数变化要写理由，所以两句都把「为什么」放在名字里：
//   p1 提交闸收口——comic 的 mcp[comfy].allow 恰为只读两把；聚合工具面因此从 47 降到 46（外部 MCP −1）。
//      桥里仍保留 comfy_submit 的实现（comic-bridge.test 照旧验协议），只是不进宿主工具面；
//      恢复条件是底座自己的单提交点 gate 落地，不是谁顺手把 allow 加回来。
//   p2 画布接入面——comic.canvas 是十二块里唯一一块 app 档 pane（+1 块 pane），地址只给本机回环 :3010；
//      toonflow 由作者的 dev 流程起，Pinax 只给内嵌浏览器承载，不 spawn、不手搓编辑器。
const comicPlugin = BUILT_IN_CARRIER_PLUGINS.find((plugin) => plugin?.manifest?.id === 'pinax.carrier.comic')
const comfySpec = comicPlugin?.manifest?.mcp?.find((spec) => spec?.id === 'comfy')
const comfyAllow = Array.isArray(comfySpec?.allow) ? comfySpec.allow : []
const comfySubmitOnSurface = BUILT_IN_CARRIER_PLUGINS.some((plugin) => (
  (plugin?.manifest?.tools ?? []).includes('comfy_submit')
  || (plugin?.manifest?.mcp ?? []).some((spec) => (spec?.allow ?? []).includes('comfy_submit'))
))
check('p1 提交闸收口：comic mcp[comfy].allow 恰为 comfy_status／comfy_result，comfy_submit 不在任何载体工具面',
  comfyAllow.join() === 'comfy_status,comfy_result' && !comfySubmitOnSurface,
  `allow=${comfyAllow.join(',') || '(缺)'} submitOnSurface=${comfySubmitOnSurface}`)

const comicCanvas = comicPlugin?.manifest?.contributes?.panes?.find((pane) => pane?.id === 'comic.canvas')
check('p2 画布接入面：comic.canvas 是 app 档 pane（pinax.view.app／external-app，回环 :3010）',
  comicCanvas?.view === 'pinax.view.app'
    && comicCanvas?.kind === 'external-app'
    && comicCanvas?.app?.url === 'http://127.0.0.1:3010',
  comicCanvas ? `${comicCanvas.view}/${comicCanvas.kind} ${comicCanvas.app?.url ?? '(无地址)'}` : '(缺 comic.canvas)')

// 批次52（门禁 q）：@4 合同与 adopt 分支真的进了产物——字段不是死声明。
//   主进程 bundle 里必须找得到 @4 词表、maxKernel、预览 loading 两档（批次55 直接消费），
//   以及 adopt 分支的失败文案（supervisor 随运行时进包；装机后外部服务探不通要能说清楚）。
const v4Markers = ['pinax-carrier@4', 'maxKernel', 'text-pages', 'bytes-complete']
const adoptMarkers = ['外部服务端口', 'adopt 服务必须声明 port']
const missingV4Markers = [...v4Markers, ...adoptMarkers].filter((marker) => !bundle.includes(marker))
check('q @4 合同与 adopt 分支进产物：清单词表（@4／maxKernel／预览两档）与「adopt 只探活」的失败文案都在主进程 bundle',
  missingV4Markers.length === 0,
  missingV4Markers.length ? `缺 ${missingV4Markers.join(' ')}` : `${v4Markers.length + adoptMarkers.length} 个标记齐`)

// prod 那条加载路径是窗口有没有内容的唯一入口：曾经写成 bundle 的上一级，装机起来是白屏而门禁全绿。
// 只认「join 的实参」不认函数名：D1 起多个模块都 import node:path，rollup 会把 join 重命名成 join$1，
// 旧正则 join\\(currentDir… 会被标识符改名误伤（门禁该守路径，不该守压缩后的变量名）。
const rendererHtml = join(repoRoot, 'next', '.build', 'renderer-next', 'index.html')
const htmlExists = await stat(rendererHtml).then(() => true, () => false)
check('g 外壳 prod 加载路径指得到渲染层产物：bundle 同级 renderer-next/index.html 存在，且产物调用了该路径',
  htmlExists && /currentDir,\s*"renderer-next",\s*"index\.html"/.test(shellBundle),
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

/** 递归收集源码清单（外壳源码断言用；与 shell-contract 的 collectShellSources 同一口径）。 */
async function collectSourceFiles(directory, prefix = '') {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...await collectSourceFiles(join(directory, entry.name), rel))
    else if (/\.(mjs|vue|html|js)$/.test(entry.name)) found.push(rel)
  }
  return found
}

// 批次49：服务与通知公共池必须真的接进两条写口，且状态点样式与原生工具都在产物里。
const serviceLogPoolSource = await readFile(join(repoRoot, 'next', 'runtime', 'serviceLogPool.mjs'), 'utf-8').catch(() => '')
check('l 公共池存在：next/runtime/serviceLogPool.mjs 导出 createServiceLogPool 且写清四色语义',
  serviceLogPoolSource.includes('export function createServiceLogPool')
    && ['green', 'orange', 'red', 'gray'].every((color) => serviceLogPoolSource.includes(`'${color}'`)),
  serviceLogPoolSource ? `${(serviceLogPoolSource.length / 1024).toFixed(1)} kB` : '(文件缺失)')

const supervisorSource = await readFile(join(repoRoot, 'next', 'runtime', 'serviceSupervisor.mjs'), 'utf-8')
const mcpClientSource = await readFile(join(repoRoot, 'next', 'runtime', 'mcpClient.mjs'), 'utf-8')
check('l2 池接两条写口：监督器与外部 MCP 客户端都往 logPool.append 记账（原有 onEvent／状态快照保留）',
  supervisorSource.includes('logPool.append') && mcpClientSource.includes('logPool.append'),
  `supervisor=${supervisorSource.includes('logPool.append')} mcpClient=${mcpClientSource.includes('logPool.append')}`)

check('l3 竖条状态点进产物：渲染层 CSS 带 .nx-rail-status-dot 与四色修饰类',
  rendererCss.includes('.nx-rail-status-dot')
    && ['is-green', 'is-orange', 'is-red', 'is-gray'].every((name) => rendererCss.includes(`.nx-rail-status-dot.${name}`)),
  rendererCss.includes('.nx-rail-status-dot') ? '四色齐' : '缺 .nx-rail-status-dot')

const serviceLogToolsSource = await readFile(join(repoRoot, 'next', 'runtime', 'serviceLogTools.mjs'), 'utf-8').catch(() => '')
check('l4 原生工具在册：pinax_service_log_list 由 serviceLogTools 登记，归属 kernel.runtime.services',
  serviceLogToolsSource.includes("'pinax_service_log_list'") && serviceLogToolsSource.includes("'kernel.runtime.services'"),
  serviceLogToolsSource ? 'registry ok' : '(文件缺失)')

if (failures.length) {
  console.log(`\n打包门禁：${failures.length} 项不合格 → ${failures.join(' / ')}`)
  process.exitCode = 1
} else {
  console.log('\n打包门禁：全部通过（构建参数／裸导入白名单／无 Express／产物可执行）')
}
