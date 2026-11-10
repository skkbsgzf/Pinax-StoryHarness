import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { validateCarrierManifest } from './carrierManifest.mjs'
import { DECLARATIVE_REFUSED_CODE, createDeclarativeImpl, gateDeclarativeManifest } from './declarativeImpl.mjs'
/**
 * 批次64 · 装载原型（桩2 前置的可行性打桩）：外部载体目录的发现装载器。
 * 扫 <dir>/<载体id>/manifest.json → JSON.parse → 走同一个 normalizeCarrierManifest(@4)（validateCarrierManifest）
 * → 通过的调 registry.install（registry 可不注入，只返回装载结果）。任一清单坏＝该载体跳过并记进 skipped，不拖垮整批。
 * 只消费既有 install/registerEffect/onDispose：不改 registry，不动内置载体。
 *
 * 批次65a 起本文件有两个装载器，形态不同、不许混用：
 *   loadCarriersFromDir      桩2 原型：带 impl.mjs 的外部目录（会 import 第三方 JS）。
 *   loadDeclarativeFromDir   正式第一波：声明型外部插件，只有 manifest.json，绝不执行第三方 JS。
 * 项目打开路径（next/project/openProject.mjs）只走后者；前者留在 acceptance/tests 里继续验可行性结论。
 *
 * 批次65b 起第三个装载器（框架计划 J2「一切从磁盘装载，内置只是随包已安装」）：
 *   loadBuiltInCarriersFromDir  随框架发布的载体——读的是**源码形态的 .mjs**（manifest/tools/context），
 *   与上面两个读 manifest.json 的外部装载器是三种形态，不许互相靠拢：外部目录里出现 impl.mjs 一律拒装
 *   （宿主不执行第三方 JS），内置这块反过来**必须**是 .mjs（工单钉死：不打包器转译，装进包的与读到的同一份）。
 *   内置装载器只由宿主自己的 boot 调用——它 import 的是随包发布的第一方代码，信任前提与外部插件不同；
 *   这条差别是设计的一部分，不是漏的闸：批次65a 那两条红线（form 拒装、声明型工厂）一条没动。
 */
export async function loadCarriersFromDir(dir, { registry = null } = {}) {
  const loaded = []
  const skipped = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const carrierDir = join(dir, entry.name)
    let manifest = null
    try {
      manifest = JSON.parse(await readFile(join(carrierDir, 'manifest.json'), 'utf-8'))
    } catch (error) {
      skipped.push({ carrierId: entry.name, stage: 'manifest', reason: `清单 JSON 解析失败：${String(error?.message ?? error)}` })
      continue
    }
    const normalized = validateCarrierManifest(manifest)
    if (!normalized.ok) {
      skipped.push({ carrierId: entry.name, stage: 'manifest', code: normalized.error.code, reason: normalized.error.message })
      continue
    }
    let impl = {}
    const implPath = join(carrierDir, 'impl.mjs')
    if (await stat(implPath).then(() => true, () => false)) {
      try {
        impl = (await import(pathToFileURL(implPath).href)).default ?? {}
      } catch (error) {
        skipped.push({ carrierId: entry.name, stage: 'impl', reason: String(error?.message ?? error) })
        continue
      }
    }
    if (!registry) {
      loaded.push({ carrierId: normalized.value.id, dir: carrierDir, manifest: normalized.value, impl })
      continue
    }
    const installed = registry.install(manifest, impl, { dir: carrierDir })
    if (!installed.ok) {
      skipped.push({ carrierId: entry.name, stage: 'install', code: installed.error.code, reason: installed.error.message })
      continue
    }
    const pluginId = installed.value.manifest.id
    if (typeof impl.setup === 'function') {
      const effect = registry.registerEffect(pluginId, impl.setup, `carrier-load:${pluginId}`)
      if (!effect.ok) {
        skipped.push({ carrierId: pluginId, stage: 'effect', code: effect.error.code, reason: effect.error.message })
        continue
      }
    }
    if (typeof impl.onDispose === 'function') registry.onDispose(pluginId, impl.onDispose)
    loaded.push({ carrierId: pluginId, dir: carrierDir, manifest: installed.value.manifest })
  }
  return { loaded, skipped }
}

/**
 * 批次65a · 装载正式第一波：外部声明型插件（`.pinax/plugins/<id>/manifest.json`）。
 * 与上面原型装载器三条不同，都是工单钉死的边界：
 *   1) 不执行第三方 JS——目录里出现 impl.mjs 直接按形态拒装（不是静默忽略：作者显然想装代码形态，
 *      一句拒装理由比一块永远不生效的疑案值钱）；impl 一律由 declarativeImpl 工厂生成；
 *   2) 声明型闸（gateDeclarativeManifest）跑在 @4 校验之后：tools/services/mcp/entry/非空 commands 拒装并给逐字段理由；
 *   3) 幂等：同 id 且同目录已在册 → 记 loaded（alreadyInstalled），不重复 install——
 *      重复 install 会进 registry.rejected（DUPLICATE_PLUGIN），而 rejected 是随每次 activate 复读的长期账，
 *      刷新一次脏一条，竖条的故障隔离记账会被装载器自己的重入污染。
 * 隐藏目录（.trash 等）不参与扫描：卸载只许移进 `.pinax/plugins/.trash/<时间戳>/`，那是回收站不是货架。
 */
export async function loadDeclarativeFromDir(dir, { registry = null } = {}) {
  const loaded = []
  const skipped = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith('.'))) {
    const carrierDir = join(dir, entry.name)
    let manifest = null
    try {
      manifest = JSON.parse(await readFile(join(carrierDir, 'manifest.json'), 'utf-8'))
    } catch (error) {
      skipped.push({ carrierId: entry.name, stage: 'manifest', reason: `清单 JSON 解析失败：${String(error?.message ?? error)}` })
      continue
    }
    const normalized = validateCarrierManifest(manifest)
    if (!normalized.ok) {
      skipped.push({ carrierId: entry.name, stage: 'manifest', code: normalized.error.code, reason: normalized.error.message })
      continue
    }
    const gated = gateDeclarativeManifest(normalized.value)
    if (!gated.ok) {
      skipped.push({
        carrierId: normalized.value.id,
        stage: 'declarative',
        code: gated.error.code,
        reason: gated.error.message,
        refused: gated.error.details.refused
      })
      continue
    }
    if (await stat(join(carrierDir, 'impl.mjs')).then(() => true, () => false)) {
      skipped.push({
        carrierId: normalized.value.id,
        stage: 'form',
        code: DECLARATIVE_REFUSED_CODE,
        reason: '目录里有 impl.mjs：本批只收声明型（只有 manifest.json），宿主不执行第三方 JS——impl 一律由内核声明式工厂生成'
      })
      continue
    }
    if (registry?.get(normalized.value.id)) {
      if (registry.dirOf(normalized.value.id) !== carrierDir) {
        skipped.push({ carrierId: normalized.value.id, stage: 'install', code: 'PINAX_DUPLICATE_PLUGIN', reason: `id 已由另一目录装载：${String(registry.dirOf(normalized.value.id))}` })
        continue
      }
      loaded.push({ carrierId: normalized.value.id, dir: carrierDir, manifest: registry.get(normalized.value.id), alreadyInstalled: true })
      continue
    }
    const impl = createDeclarativeImpl(normalized.value)
    if (!registry) {
      loaded.push({ carrierId: normalized.value.id, dir: carrierDir, manifest: normalized.value, impl })
      continue
    }
    const installed = registry.install(manifest, impl, { dir: carrierDir })
    if (!installed.ok) {
      skipped.push({ carrierId: normalized.value.id, stage: 'install', code: installed.error.code, reason: installed.error.message })
      continue
    }
    const pluginId = installed.value.manifest.id
    const effect = registry.registerEffect(pluginId, impl.setup, `declarative-load:${pluginId}`)
    if (!effect.ok) {
      skipped.push({ carrierId: pluginId, stage: 'effect', code: effect.error.code, reason: effect.error.message })
      continue
    }
    loaded.push({ carrierId: pluginId, dir: carrierDir, manifest: installed.value.manifest, declarative: true })
  }
  return { loaded, skipped }
}

/**
 * 批次65b · 随框架发布载体的装载路径（框架计划 J2：内置只是「随包已安装」，和外部插件走同一扇「从盘上发现」的门）。
 *
 * 与前两个装载器三点不同，都是刻意的：
 *   1) 读的是**源码形态的 .mjs**（manifest.mjs／tools.mjs／context.mjs），不是 manifest.json——
 *      十一块的清单与实现不许为了迁就装载器改写（工单边界：不改清单本体与实现语义），
 *      所以这里按**约定取件**而不是发明新合同：默认导出优先，没有默认导出时取唯一那个
 *      `create*Tools`／`create*Blocks`；取不到唯一答案＝如实拒装并说清是哪一块，不猜。
 *   2) 不打包器转译：动态 import 的就是盘上那一份，装进包的与读到的同一个字节（工单钉死）。
 *   3) 可以 import 盘上代码——因为这一条路只由宿主 boot 走，读的是随包发布的第一方文件。
 *      外部那两条红线一条没动：外部目录出现 impl.mjs 仍按形态整份拒装（stage:'form'），
 *      声明型外部插件的 impl 仍由内核工厂生成。别把这块当成外部装载的先例。
 *
 * 注册顺序＝竖条顺序（协议 v1.1-A），readdir 不保证顺序，所以排序按调用方给的 `order`
 * （随包 id 清单）；清单里没有的名字排在最后且由门禁的「清单与盘上目录一致」断言发现漂移。
 */
export const BUILT_IN_CARRIER_TRUST = 't1'
export const BUILT_IN_CARRIER_SOURCE_PREFIX = 'next/carriers/'
const BUILT_IN_MANIFEST_FILE = 'manifest.mjs'
const BUILT_IN_TOOLS_FILE = 'tools.mjs'
const BUILT_IN_CONTEXT_FILE = 'context.mjs'
/** 本模块的目录：开发轨是 next/kernel/，打包后 bundle 落在 next/.build/，双态定位以此为基准。 */
const LOADER_MODULE_DIR = fileURLToPath(new URL('./', import.meta.url))

/** 目录里至少有一个子目录带 manifest.mjs，才算「随包载体的货架」（空目录／别的东西不算）。 */
async function hasBuiltInCarrierDirs(dir) {
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const found = await readFile(join(dir, entry.name, BUILT_IN_MANIFEST_FILE), 'utf-8').then(() => true, () => false)
    if (found) return true
  }
  return false
}

/**
 * 双态定位的唯一函数（与 resolveSkillsDir 同一套路，四条候选按序）：
 *   1) PINAX_NEXT_CARRIERS_DIR —— 显式覆盖优先（验收／自定安装位）。
 *      工单原文写「按 PINAX_NEXT_ROOT／bundle 相对定位」，但 PINAX_NEXT_ROOT 在这套代码里是
 *      「要自动打开的**项目根**」（next/shell/main.mjs:54），语义已被占用；拿它当仓库根会让
 *      同一个变量在项目层与包层各说各话，所以这里另开一枚专用覆盖口，理由落批次记录。
 *   2) <模块目录>/next/carriers —— 装机轨：构建把 `next/carriers/` 原样拷到 `next/.build/next/carriers/`
 *      （相对深度与仓库一致，见下）。
 *   3) <模块目录>/../carriers —— 开发轨：本模块在 next/kernel/，往上就是 next/carriers/。
 *   4) <模块目录>/carriers —— 模块被再嵌一层时的回退。
 * 四条都不像货架时返回第 2 条，让 readdir 的失败如实进 skipped（不静默造一个空答案）。
 *
 * 为什么装机轨是 `.build/next/carriers/` 而不是工单字面的 `.build/carriers/`：
 * 载体运行时件里的相对导入按仓库深度写死（tools.mjs 引 `../../kernel/errors.mjs`，
 * worldbook 的 context 引 `../../../shared/worldbookFileContract.js`）。拷到 `.build/carriers/<块>/`
 * 会让每一层 `../` 都少爬一级——内核解析进 `.build/`（还得额外铺一份），而 `shared/` 会解析到
 * `next/shared/`，那是在 `.build` 产物目录**外面**、源码树里凭空造一个目录。
 * 镜像一层 `next/`（把 `.build/` 当仓库根）让相对深度与开发轨逐字相同，闭包因此能整份落在产物目录内。
 */
export async function resolveBuiltInCarriersDir({ env = process.env, moduleDir = LOADER_MODULE_DIR } = {}) {
  const candidates = [
    typeof env?.PINAX_NEXT_CARRIERS_DIR === 'string' && env.PINAX_NEXT_CARRIERS_DIR.trim()
      ? env.PINAX_NEXT_CARRIERS_DIR.trim()
      : null,
    join(moduleDir, 'next', 'carriers'),
    join(moduleDir, '..', 'carriers'),
    join(moduleDir, 'carriers')
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (await hasBuiltInCarrierDirs(candidate)) return candidate
  }
  return candidates[0]
}

/** 取「一份清单」：默认导出优先，否则取唯一那份带 spec＋id 的对象导出。多个或零个都不是答案。 */
function pickCarrierManifest(namespace, name) {
  const shapes = []
  if (namespace.default && typeof namespace.default === 'object' && typeof namespace.default.id === 'string') {
    shapes.push(namespace.default)
  }
  const named = Object.values(namespace).filter((value) => (
    value && typeof value === 'object' && typeof value.id === 'string' && typeof value.spec === 'string'
  ))
  if (shapes.length === 1) return { ok: true, manifest: shapes[0] }
  if (named.length === 1) return { ok: true, manifest: named[0] }
  return {
    ok: false,
    reason: `${name}/${BUILT_IN_MANIFEST_FILE} 取不到唯一清单：默认导出 ${shapes.length} 份、具名清单形状 ${named.length} 份（约定＝默认导出优先，或恰好一份带 spec＋id 的对象）`
  }
}

/** 取工厂：默认导出（函数）优先，否则取唯一匹配 /pattern/ 的具名函数导出。 */
function pickFactory(namespace, pattern, label, file) {
  if (typeof namespace.default === 'function') return { ok: true, factory: namespace.default }
  const matches = Object.entries(namespace).filter(([name, value]) => pattern.test(name) && typeof value === 'function')
  if (matches.length === 1) return { ok: true, factory: matches[0][1] }
  return {
    ok: false,
    reason: `${file} 取不到唯一的${label}工厂：匹配 ${pattern.source} 的具名函数 ${matches.length} 个（约定＝默认导出优先，或恰好一个）`
  }
}

async function importRuntimeFile(carrierDir, fileName) {
  return import(pathToFileURL(join(carrierDir, fileName)).href)
}

/**
 * 从货架目录装载随包载体，返回 { loaded, skipped }。
 * `registry` 可不注入（构建期枚举清单、门禁对表都用得到纯装载）；注入时走 install，与 boot 同一条路。
 * 单块坏＝该块进 skipped 并给理由；调用方（loadBuiltInCarrierPlugins）据此判定「随包的东西装不上」＝整桌失败，
 * 因为内置缺一块不是局部故障，是竖条少一格、工具面少一把的装配事故——静默少一块比开机报错坏得多。
 */
export async function loadBuiltInCarriersFromDir(dir, { registry = null, order = [], trust = BUILT_IN_CARRIER_TRUST } = {}) {
  const loaded = []
  const skipped = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  for (const name of names) {
    const carrierDir = join(dir, name)
    const source = `${BUILT_IN_CARRIER_SOURCE_PREFIX}${name}`
    let manifestNamespace = null
    try {
      manifestNamespace = await importRuntimeFile(carrierDir, BUILT_IN_MANIFEST_FILE)
    } catch (error) {
      skipped.push({ carrierId: name, stage: 'manifest', reason: `${name}/${BUILT_IN_MANIFEST_FILE} 读不进来：${String(error?.message ?? error)}` })
      continue
    }
    const picked = pickCarrierManifest(manifestNamespace, name)
    if (!picked.ok) {
      skipped.push({ carrierId: name, stage: 'manifest', reason: picked.reason })
      continue
    }
    const manifest = picked.manifest
    let toolsNamespace = null
    try {
      toolsNamespace = await importRuntimeFile(carrierDir, BUILT_IN_TOOLS_FILE)
    } catch (error) {
      skipped.push({ carrierId: manifest.id, stage: 'tools', reason: `${name}/${BUILT_IN_TOOLS_FILE} 读不进来：${String(error?.message ?? error)}` })
      continue
    }
    const toolsPick = pickFactory(toolsNamespace, /^create\w*Tools$/u, '工具', `${name}/${BUILT_IN_TOOLS_FILE}`)
    if (!toolsPick.ok) {
      skipped.push({ carrierId: manifest.id, stage: 'tools', reason: toolsPick.reason })
      continue
    }
    // impl 的形状与批次65b 之前 carriers/index.mjs 里手写的工厂逐字等价：pluginId 缺省落在清单 id 上。
    const impl = { source, tools: (context = {}) => toolsPick.factory({ ...context, pluginId: context.pluginId ?? manifest.id }) }
    const contextPath = join(carrierDir, BUILT_IN_CONTEXT_FILE)
    if (await readFile(contextPath, 'utf-8').then(() => true, () => false)) {
      let blocksNamespace = null
      try {
        blocksNamespace = await importRuntimeFile(carrierDir, BUILT_IN_CONTEXT_FILE)
      } catch (error) {
        skipped.push({ carrierId: manifest.id, stage: 'context', reason: `${name}/${BUILT_IN_CONTEXT_FILE} 读不进来：${String(error?.message ?? error)}` })
        continue
      }
      const blocksPick = pickFactory(blocksNamespace, /^create\w*Blocks$/u, '素材块', `${name}/${BUILT_IN_CONTEXT_FILE}`)
      if (!blocksPick.ok) {
        skipped.push({ carrierId: manifest.id, stage: 'context', reason: blocksPick.reason })
        continue
      }
      impl.blocks = (context = {}) => blocksPick.factory({ ...context, pluginId: context.pluginId ?? manifest.id })
    }
    const meta = { trust, source, dir: carrierDir }
    if (registry) {
      const installed = registry.install(manifest, impl, meta)
      if (!installed.ok) {
        skipped.push({ carrierId: manifest.id, stage: 'install', code: installed.error.code, reason: installed.error.message })
        continue
      }
    }
    loaded.push({ carrierId: manifest.id, name, dir: carrierDir, manifest, impl, meta })
  }
  const rankOf = (id) => {
    const index = order.indexOf(id)
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  loaded.sort((left, right) => rankOf(left.carrierId) - rankOf(right.carrierId) || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  return { loaded, skipped }
}
