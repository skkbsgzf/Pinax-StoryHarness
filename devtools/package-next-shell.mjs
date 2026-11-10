/* Next 壳打包（把 next/.build 覆盖进一份 Electron 运行时，产出可双击的 dist 目录）。
 *
 * 为什么需要这个脚本：桌面快捷方式指向的是一份**打包产物**（Electron 运行时 ＋ resources/app），
 * 不是仓库目录。前端/主进程改了以后必须重新覆盖 resources/app，否则双击启动的还是旧渲染层。
 * 以前这一步是手工拷的，容易漏（尤其 skills/ 与 renderer-next/ 有增量消失的情况），所以落成脚本。
 *
 * 用法：
 *   node devtools/package-next-shell.mjs                  # 就地更新已有 dist
 *   node devtools/package-next-shell.mjs --fresh          # 先删 dist/app 再全量覆盖
 *   node devtools/package-next-shell.mjs --dist=<目录>    # 换输出目录
 *
 * 纪律：
 *   - 只覆盖 resources/app；运行时（exe/dll/pak）不动——版本没变时换 exe 等于换个应用，不是更新。
 *   - 覆盖前把 app 目录整体清掉：增量覆盖会让「已删除的产物」留在包里（旧 bundle 被加载＝改了没生效）。
 *   - 不碰用户数据：项目根（PINAX_NEXT_ROOT）与 %LOCALAPPDATA%\PinaxNext 都不在这里，脚本只写 dist。
 */
import { cp, mkdir, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_DIST = 'D:/Pinax-e2e/dist/Pinax Next-win32-x64'
const SOURCE = join(REPO, 'next', '.build')
const APP_PACKAGE_JSON = {
  name: 'pinax-next',
  productName: 'Pinax Next',
  version: '0.3.0',
  type: 'module',
  main: 'pinax-next-shell-main.mjs'
}

function argOf(prefix, fallback) {
  const hit = process.argv.slice(2).find((item) => item.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1) : fallback
}

const distDir = resolve(argOf('--dist', DEFAULT_DIST))
const appDir = join(distDir, 'resources', 'app')
const fresh = process.argv.includes('--fresh')

function say(message) {
  process.stdout.write(`${message}\n`)
}

async function ensureExists(path, label) {
  if (!existsSync(path)) {
    say(`MISSING ${label}: ${path}`)
    process.exit(1)
  }
}

async function topLevel(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  // node_modules 单独报（它是跟包的运行期依赖，不是产物结构的一部分）。
  return entries
    .filter((entry) => entry.name !== 'node_modules')
    .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
    .sort()
}

/** 关键产物清单：缺一个启动就白屏或走旧路径，所以验在打包前。 */
const REQUIRED = [
  'pinax-next-shell-main.mjs',
  'pinax-next-main.mjs',
  'preload.mjs',
  'renderer-next/index.html',
  // 载体 tools.mjs 是运行时动态 import 的源码（不是 bundle），它 import '@pinax/core'——
  // 包里没有这条依赖，启动时会「随包载体装载不完整」整排跳过，等于开一个空壳。
  'next/carriers/novel/tools.mjs'
]

/**
 * 运行期要能解析的外部包：载体源码直接 import 它们，不能在打包时被 bundle 掉，只能原样跟包。
 * `@pinax/core` 用 tarball 分发（vendor/core/*.tgz → node_modules/@pinax/core），3MB 左右，
 * 比把它 bundle 进每个工具文件更省也更接近开发态。
 *
 * 2026-11-10 教训：漏掉这条依赖时，启动会「随包载体装载不完整」把 11 个载体整排跳过，
 * 界面看着能开、实际是个空壳——所以打包后用 verifyRuntimeImports 逐条验证解析。
 */
const RUNTIME_PACKAGES = ['@pinax/core']

/**
 * 打包后验收：把 app 里「运行时动态 import 的源码」的裸模块引用逐条解析一遍。
 * 少一条就是启动时整排载体被跳过（空壳），且界面不会报错——所以必须在打包这一步拦住。
 * 只读，不改任何文件。
 */
async function verifyRuntimeImports(appDir) {
  const { createRequire } = await import('node:module')
  const requireFromApp = createRequire(join(appDir, 'noop.mjs'))
  const roots = ['next', 'shared', 'server']
  const found = new Map()
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '.build' || entry.name === 'node_modules') continue
        await walk(full)
      } else if (/\.(mjs|js)$/u.test(entry.name)) {
        const source = await readFile(full, 'utf8')
        for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
          const spec = match[1]
          if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue
          if (!found.has(spec)) found.set(spec, join(appDir, '..', 'app'))
        }
      }
    }
  }
  for (const root of roots) await walk(join(appDir, root))
  const missing = []
  for (const spec of found.keys()) {
    try { requireFromApp.resolve(spec) } catch { missing.push(spec) }
  }
  return { total: found.size, missing }
}

async function copyRuntimePackages(appDir) {
  const copied = []
  for (const name of RUNTIME_PACKAGES) {
    const from = join(REPO, 'node_modules', ...name.split('/'))
    if (!existsSync(from)) {
      say(`MISSING runtime package ${name}（先 npm ci / npm install）`)
      process.exit(1)
    }
    const to = join(appDir, 'node_modules', ...name.split('/'))
    await mkdir(dirname(to), { recursive: true })
    await cp(from, to, { recursive: true })
    copied.push(name)
  }
  return copied
}

async function main() {
  await ensureExists(SOURCE, 'next/.build（先跑 npm run build:next）')
  await ensureExists(distDir, 'dist 目录（先确认桌面快捷方式指向的位置）')
  await ensureExists(join(distDir, 'Pinax Next.exe'), 'Electron 运行时 exe')

  for (const relative of REQUIRED) {
    await ensureExists(join(SOURCE, relative), `.build 缺关键产物 ${relative}`)
  }

  const before = existsSync(appDir) ? await topLevel(appDir) : []

  if (existsSync(appDir)) {
    if (fresh) {
      await rm(appDir, { recursive: true, force: true })
      say(`cleared ${appDir}`)
    } else {
      // 非 fresh 也整体清掉：增量覆盖留下旧 bundle 会被优先加载，等于「改了没生效」。
      // 区别只在有没有先整目录删（fresh 是连 app 目录本身一起重建）。
      await rm(appDir, { recursive: true, force: true })
    }
  }
  await mkdir(appDir, { recursive: true })

  await cp(SOURCE, appDir, { recursive: true })
  await writeFile(join(appDir, 'package.json'), `${JSON.stringify(APP_PACKAGE_JSON, null, 2)}\n`, 'utf8')
  const packages = await copyRuntimePackages(appDir)

  const after = await topLevel(appDir)
  const removed = before.filter((name) => !after.includes(name))
  const added = after.filter((name) => !before.includes(name))

  // 逐项核对：包里每个顶层项都要有文件（空目录＝拷漏）。
  let empty = []
  for (const name of after) {
    if (!name.endsWith('/')) continue
    const target = join(appDir, name.slice(0, -1))
    const children = await readdir(target).catch(() => [])
    if (!children.length) empty.push(name)
  }

  const rendererHtml = join(appDir, 'renderer-next', 'index.html')
  const html = await readFile(rendererHtml, 'utf8').catch(() => '')
  const assets = html.match(/assets\/[A-Za-z0-9._-]+/gu) ?? []

  say(`dist      = ${distDir}`)
  say(`app       = ${appDir}`)
  say(`source    = ${SOURCE}`)
  say(`items     = ${after.length}（新增 ${added.length}／消失 ${removed.length}）`)
  if (added.length) say(`  added   = ${added.join(', ')}`)
  if (removed.length) say(`  removed = ${removed.join(', ')}`)
  say(`runtime   = ${packages.join(', ')}`)
  say(`renderer  = ${assets.length} 个资源引用（${assets.slice(0, 3).join(', ')}${assets.length > 3 ? '…' : ''}）`)
  // 依赖面验收：漏一条运行期依赖，界面照样能开、载体整排被跳过（空壳），必须在这里拦住。
  const imports = await verifyRuntimeImports(appDir)
  if (imports.missing.length) {
    say(`MISSING runtime imports = ${imports.missing.join(', ')}（加进 RUNTIME_PACKAGES 并 npm ci）`)
    process.exit(1)
  }
  say(`imports   = ${imports.total} 种裸模块引用全部可解析`)
  if (empty.length) {
    say(`EMPTY dirs = ${empty.join(', ')}`)
    process.exit(1)
  }
  const missingAssets = []
  for (const asset of assets) {
    if (!existsSync(join(appDir, 'renderer-next', asset))) missingAssets.push(asset)
  }
  if (missingAssets.length) {
    say(`MISSING assets = ${missingAssets.join(', ')}`)
    process.exit(1)
  }
  say('package ok')
}

main().catch((error) => {
  say(`FAILED: ${String(error?.stack || error)}`)
  process.exit(1)
})
