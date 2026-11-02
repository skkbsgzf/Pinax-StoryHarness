import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
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
 * 协议 v3 的两面同样是运行时读的文件：面板页 ui/（少拷＝装机后一块白板）与
 * AGENT.md 作者须知（少拷＝那栏须知静默消失，不报错，只是模型突然不守那栏的规矩）。
 *
 * 批次48：清单 services／mcp 牌声明的 .mjs 运行期脚本随载体进包（宿主以插件目录为 cwd 起子进程，
 * 脚本不在产物里就是「声明在、进程永远起不来」）。批次65b 起这条退化成一句「整份载体目录进包」，
 * 不再按清单挑文件名——挑文件的规则一旦漂，缺件是静默的；整份目录没有这个问题。
 *
 * 批次65b（框架计划 J2「一切从磁盘装载，内置只是随包已安装」）——拷贝规则换成**镜像仓库相对路径**：
 *   next/carriers/<名字>/（整份目录：manifest.mjs／tools.mjs／context.mjs 等运行时件 ＋ ui/ ＋ AGENT.md）
 *     → next/.build/next/carriers/<名字>/
 *   这些运行时件的相对导入闭包（kernel／fs／runtime／project／jsonRecords／shared／server／src／electron）
 *     → next/.build/<仓库相对路径>
 * 为什么带一层 `next/`（工单字面写的是 `.build/carriers/<id>/`）：载体件里的相对导入按仓库深度写死
 * ——tools.mjs 引 `../../kernel/errors.mjs`，worldbook 的 context 引 `../../../shared/worldbookFileContract.js`。
 * 拷到 `.build/carriers/<id>/` 会让每一层 `../` 少爬一级：内核落进 `.build/` 根下（还得另铺一份），
 * 而 `shared/` 会解析到 `next/shared/`——那在产物目录**外面**，等于往源码树里凭空造一个目录。
 * 把 `.build/` 当仓库根做镜像，相对深度与开发轨逐字相同，闭包因此整份落在产物目录内；
 * 装载器 resolveBuiltInCarriersDir 的两条候选（装机轨 `.build/next/carriers`、开发轨 `next/carriers`）也由此同时成立。
 * 不打包器转译（工单边界）：进包的就是盘上那一份 .mjs，运行期由装载器动态 import。
 */
const configDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(configDir, '..')
const SKILLS_SOURCE = join(configDir, 'skills')
const SKILLS_TARGET = join(configDir, '.build', 'skills')
const CARRIERS_SOURCE = join(configDir, 'carriers')
const BUILD_DIR = join(configDir, '.build')
const RUNTIME_FILE_PATTERN = /\.(?:mjs|js|cjs|json)$/u

/** 仓库相对路径（产物镜像按它落位；Windows 的分隔符归一成 `/`，跨机可复现）。 */
function repoRelative(absolutePath) {
  return relative(repoRoot, absolutePath).split('\\').join('/')
}

function packedPath(repoRel) {
  return join(BUILD_DIR, ...repoRel.split('/'))
}

/** 目录下的直接子目录名（读不到给空表——空货架不是错误，构建末尾的计数会把它顶出来）。 */
async function subDirectories(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

/**
 * 相对说明符的取法（与 ESM 解析同序的常用形状：原样 → 补扩展名 → 目录 index）。
 * 取不到就如实报「铺不齐」，这里不猜第二套解析规则，也绝不静默少拷一个文件。
 */
async function resolveRelativeSpecifier(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}.json`, join(base, 'index.mjs'), join(base, 'index.js')]
  for (const candidate of candidates) {
    const isFile = await stat(candidate).then((info) => info.isFile(), () => false)
    if (isFile) return candidate
  }
  return null
}

/**
 * 抽出一个文件里的**相对**说明符（静态 import／re-export／裸 import／动态 import 四种写法）。
 * 只认相对路径：node: 由运行时给，包名本该由 bundle 内联——真出现在随包运行时件里，
 * 说明这份文件不该随包发布，闭包报错会把它顶出来，不在这儿放行。
 */
function relativeSpecifiers(source) {
  const found = []
  for (const match of source.matchAll(/(?:\bfrom|\bimport)\s*(?:\(\s*)?['"]([^'"]+)['"]/g)) {
    if (match[1].startsWith('.')) found.push(match[1])
  }
  return found
}

async function mirrorFile(absoluteSource) {
  const repoRel = repoRelative(absoluteSource)
  const target = packedPath(repoRel)
  await mkdir(dirname(target), { recursive: true })
  await cp(absoluteSource, target)
  return repoRel
}

/**
 * 闭包铺拷：从随包载体的运行时件（仓库绝对路径）出发，逐份抽相对导入 → 按仓库相对路径镜像落位 → 再扫新那份（不动点）。
 * 全程在**仓库空间**解析说明符（相对深度与装机轨逐字相同，所以镜像出来的路径直接可用），
 * 产物里已存在的（载体整份目录刚拷过）不重复拷，但照样继续扫它的导入。
 * 返回 { mirrored, unresolved }。unresolved 非空＝装机后必然 ERR_MODULE_NOT_FOUND，构建直接失败：
 * 「先打上，装机后再看」是这类静默失效最贵的样子，宁可现在红。
 */
async function mirrorImportClosure(seeds) {
  const queue = [...seeds]
  const seen = new Set()
  const mirrored = []
  const unresolved = []
  while (queue.length) {
    const absoluteSource = queue.shift()
    if (seen.has(absoluteSource)) continue
    seen.add(absoluteSource)
    let text = ''
    try {
      text = await readFile(absoluteSource, 'utf-8')
    } catch (error) {
      unresolved.push(`${repoRelative(absoluteSource)}（读不进：${String(error?.message ?? error)}）`)
      continue
    }
    for (const specifier of relativeSpecifiers(text)) {
      const absoluteTarget = await resolveRelativeSpecifier(absoluteSource, specifier)
      if (!absoluteTarget) {
        unresolved.push(`${repoRelative(absoluteSource)} → ${specifier}`)
        continue
      }
      const targetRel = repoRelative(absoluteTarget)
      if (targetRel.startsWith('..')) {
        unresolved.push(`${repoRelative(absoluteSource)} → ${specifier}（跳出仓库根，不随包发布）`)
        continue
      }
      if (!(await stat(packedPath(targetRel)).then(() => true, () => false))) {
        mirrored.push(await mirrorFile(absoluteTarget))
      }
      queue.push(absoluteTarget)
    }
  }
  return { mirrored, unresolved }
}

/**
 * 随包载体进包：每块载体的**整份目录**镜像到 `.build/next/carriers/<名字>/`，再把运行时件的相对导入闭包铺开。
 * 三种静默失效一次防死：少运行时件＝装载器整块拒装（开机就报）；少 ui/＝面板白板；少 AGENT.md＝那栏须知缺席且不报错。
 */
async function copyBuiltInCarriers() {
  const names = await subDirectories(CARRIERS_SOURCE)
  const copied = []
  const seeds = []
  for (const name of names) {
    const source = join(CARRIERS_SOURCE, name)
    const targetRel = `next/carriers/${name}`
    await rm(packedPath(targetRel), { recursive: true, force: true })
    await cp(source, packedPath(targetRel), { recursive: true })
    copied.push(name)
    for (const file of await readdir(source)) {
      if (RUNTIME_FILE_PATTERN.test(file)) seeds.push(join(source, file))
    }
  }
  const { mirrored, unresolved } = await mirrorImportClosure(seeds)
  return { copied, mirrored, unresolved }
}

function copyAssetsPlugin() {
  return {
    name: 'pinax-next-copy-assets',
    apply: 'build',
    async closeBundle() {
      // 先删后拷：源里删掉的技能／面板／载体都不该在产物里留尸（.build 是产物目录，不是作者数据）。
      await rm(SKILLS_TARGET, { recursive: true, force: true })
      await cp(SKILLS_SOURCE, SKILLS_TARGET, {
        recursive: true,
        filter: (source) => !source.endsWith('loadSkills.mjs')
      })
      // 批次65b 之前载体的落点是 `.build/<名字>/`（只有 ui/ 与 AGENT.md）。改镜像后必须清掉老落点：
      // 留着就是同一块载体在产物里有两份目录，装机后「读哪一份」不可判定。
      for (const name of await subDirectories(CARRIERS_SOURCE)) {
        await rm(join(BUILD_DIR, name), { recursive: true, force: true })
      }
      const { copied, mirrored, unresolved } = await copyBuiltInCarriers()
      if (unresolved.length) {
        this.error(`随包载体的相对导入闭包铺不齐（装机后必然 ERR_MODULE_NOT_FOUND）：${unresolved.join('；')}`)
      }
      // eslint-disable-next-line no-console -- 构建期记账：进包的运行时件数量要看得见，涨到哪儿一眼清楚
      console.log(`[pinax-next] 随包载体 ${copied.length} 块 → next/.build/next/carriers/；导入闭包另铺 ${mirrored.length} 份`)
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
