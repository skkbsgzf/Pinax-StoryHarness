import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateCarrierManifest } from './carrierManifest.mjs'
/**
 * 批次64 · 装载原型（桩2 前置的可行性打桩）：外部载体目录的发现装载器。
 * 扫 <dir>/<载体id>/manifest.json → JSON.parse → 走同一个 normalizeCarrierManifest(@4)（validateCarrierManifest）
 * → 通过的调 registry.install（registry 可不注入，只返回装载结果）。任一清单坏＝该载体跳过并记进 skipped，不拖垮整批。
 * 只消费既有 install/registerEffect/onDispose：不改 registry，不动内置载体。
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
