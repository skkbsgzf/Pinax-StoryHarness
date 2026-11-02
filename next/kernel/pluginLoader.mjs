import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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
