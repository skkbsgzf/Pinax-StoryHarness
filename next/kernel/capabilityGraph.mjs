import { fail, ok } from './errors.mjs'
import { capabilityTitle } from './capabilities.vocab.mjs'

/**
 * 依赖闭包（规范 v1 第 4 节 D3）：传递闭包双向计算。
 * 输入一律是「已安装清单」＋「本项目的启用集合」，内核不认插件 id 的硬连线（C6）。
 */

/** provider 索引：能力 → 由哪些启用中的插件提供。 */
export function buildProviderIndex(manifests, enabledIds) {
  const index = new Map()
  for (const id of enabledIds) {
    const manifest = manifests.get(id)
    if (!manifest) continue
    for (const capability of manifest.capabilities) {
      if (!index.has(capability)) index.set(capability, [])
      index.get(capability).push(id)
    }
  }
  return index
}

/** 启用集合是否满足彼此的 requires；返回缺口清单（含修复路径文案）。 */
export function collectGaps(manifests, enabledIds) {
  const providers = buildProviderIndex(manifests, enabledIds)
  const gaps = []
  for (const id of enabledIds) {
    const manifest = manifests.get(id)
    if (!manifest) continue
    for (const requirement of manifest.requires) {
      const holders = providers.get(requirement.capability) ?? []
      const count = new Set(holders.filter((holder) => holder !== id)).size
      if (count >= requirement.min) continue
      gaps.push({
        capability: requirement.capability,
        capabilityTitle: capabilityTitle(requirement.capability),
        requiredBy: id,
        requiredByTitle: manifest.title,
        needed: requirement.min,
        provided: count,
        providers: holders,
        fix: requirement.fix
      })
    }
  }
  return gaps
}

/** 正向：启用某插件前的校验（D4 的闸）。 */
export function assertEnable(manifests, enabledIds, pluginId) {
  const manifest = manifests.get(pluginId)
  if (!manifest) return fail('INVALID_INPUT', `未安装的插件无法启用：${pluginId}`)
  const gaps = collectGaps(manifests, new Set([...enabledIds, pluginId]))
  if (gaps.length) {
    return fail('DEPENDENCY_UNMET', `启用「${manifest.title}」会留下 ${gaps.length} 个能力缺口`, {
      pluginId,
      gaps,
      repairs: uniqueRepairs(gaps)
    })
  }
  return ok({ enabled: [...enabledIds, pluginId] })
}

/** 反向：停用某插件前的校验（D3 的另一半——今天没人查，所以老代码能静默坏）。 */
export function assertDisable(manifests, enabledIds, pluginId) {
  const remaining = new Set([...enabledIds].filter((id) => id !== pluginId))
  const gaps = collectGaps(manifests, remaining)
  const caused = gaps.filter((gap) => !gap.providers.length || gap.provided < gap.needed)
  if (caused.length) {
    const manifest = manifests.get(pluginId)
    return fail('DEPENDENCY_UNMET', `停用「${manifest?.title ?? pluginId}」会让 ${caused.length} 个启用中的插件缺能力`, {
      pluginId,
      gaps: caused,
      repairs: uniqueRepairs(caused)
    })
  }
  return ok({ enabled: [...remaining] })
}

/** 切主载体（C7/D3）：主载体必须在启用集合里，且切换后整体闭包仍成立。 */
export function assertPrimarySwitch(manifests, enabledIds, nextPrimaryId) {
  if (!manifests.has(nextPrimaryId)) {
    return fail('PRIMARY_CARRIER_MISSING', `主载体候选未安装：${nextPrimaryId}`, { nextPrimaryId })
  }
  if (!enabledIds.has(nextPrimaryId)) {
    return fail('PRIMARY_CARRIER_NOT_ENABLED', `主载体必须先启用：${nextPrimaryId}`, { nextPrimaryId })
  }
  const gaps = collectGaps(manifests, enabledIds)
  if (gaps.length) {
    return fail('DEPENDENCY_UNMET', `切主载体后仍有能力缺口，拒绝切换`, { nextPrimaryId, gaps, repairs: uniqueRepairs(gaps) })
  }
  return ok({ primary: nextPrimaryId, kind: manifests.get(nextPrimaryId).primary.projectKind })
}

/** 建项目「装齐」用（R4）：从主载体出发把 requires 闭包展开成需要一起启用的插件。 */
export function resolveClosure(manifests, seedIds) {
  const resolved = new Set()
  const unresolvable = []
  const visit = (id, requiredBy) => {
    if (resolved.has(id)) return
    const manifest = manifests.get(id)
    if (!manifest) {
      unresolvable.push({ id, requiredBy, reason: '未安装' })
      return
    }
    resolved.add(id)
    for (const requirement of manifest.requires) {
      const provider = findProvider(manifests, requirement.capability, id)
      if (!provider) {
        unresolvable.push({
          requiredBy: id,
          requiredByTitle: manifest.title,
          capability: requirement.capability,
          capabilityTitle: capabilityTitle(requirement.capability),
          fix: requirement.fix
        })
        continue
      }
      visit(provider, id)
    }
  }
  for (const seed of seedIds) visit(seed, null)
  return { enabled: [...resolved], unresolvable }
}

/** 找一个能提供该能力的已安装插件；排除请求者自己，避免自供自话。 */
function findProvider(manifests, capability, requesterId) {
  for (const [id, manifest] of manifests) {
    if (id === requesterId) continue
    if (manifest.capabilities.includes(capability)) return id
  }
  return null
}

function uniqueRepairs(gaps) {
  return [...new Set(gaps.map((gap) => gap.fix).filter(Boolean))]
}
