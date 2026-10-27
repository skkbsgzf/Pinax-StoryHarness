import { fail, ok, NEXT_ERROR_CODES } from './errors.mjs'
import { validateCarrierManifest, KERNEL_CONTRACT_VERSION } from './carrierManifest.mjs'
import { buildGrantTable } from './scopeGrant.mjs'
import { assertDisable, assertEnable, assertPrimarySwitch, collectGaps } from './capabilityGraph.mjs'
import { skeletonDirs } from './projectSkeleton.mjs'

/**
 * 唯一注册入口（三同原则第一条：不存在「内置插件」这个类别）。
 * 装载失败不抛异常、不进启用集，只记进 rejected —— 外壳照样能进、运行时照样能用（M1 验收第 6 条的故障隔离）。
 */
export function createRegistry(options = {}) {
  const contractVersion = options.contractVersion ?? KERNEL_CONTRACT_VERSION
  const kinds = options.kinds ?? null
  const manifests = new Map()
  const impls = new Map()
  const rejected = []
  const toolOwners = new Map()
  const namespaceOwners = new Map()

  function releaseClaims(pluginId) {
    for (const [tool, owner] of [...toolOwners]) if (owner === pluginId) toolOwners.delete(tool)
    for (const [namespace, owner] of [...namespaceOwners]) if (owner === pluginId) namespaceOwners.delete(namespace)
  }

  const registry = {
    contractVersion,
    rejected,

    /** 已安装清单（capabilityGraph 的传递闭包按这份算）。 */
    manifests() {
      return manifests
    },

    /** 装载：清单校验 → 工具命名空间查重 → 存实现句柄与 scope 摘要。 */
    install(manifestInput, impl = {}, meta = {}) {
      const validation = validateCarrierManifest(manifestInput, { kinds })
      if (!validation.ok) {
        const pluginId = String(manifestInput?.id ?? manifestInput?.title ?? '(未命名)')
        rejected.push({ pluginId, stage: 'manifest', error: validation.error })
        return validation
      }
      const manifest = validation.value
      if (manifests.has(manifest.id)) {
        const duplicate = fail('DUPLICATE_PLUGIN', `插件 id 已注册：${manifest.id}`, { pluginId: manifest.id })
        rejected.push({ pluginId: manifest.id, stage: 'duplicate', error: duplicate.error })
        return duplicate
      }
      const conflict = firstToolConflict(manifest)
      if (conflict) {
        const rejection = fail('TOOL_CONFLICT', `工具命名空间 "${conflict.namespace}" 已由 ${conflict.owner} 声明，${manifest.id} 不得伪装（C8）`, conflict)
        rejected.push({ pluginId: manifest.id, stage: 'tools', error: rejection.error })
        return rejection
      }
      for (const tool of manifest.tools) {
        toolOwners.set(tool, manifest.id)
        namespaceOwners.set(tool.split('.')[0], manifest.id)
      }

      manifests.set(manifest.id, manifest)
      impls.set(manifest.id, { ...impl, trust: meta.trust ?? 't1' })
      return ok({ manifest, trust: meta.trust ?? 't1', scopeSummary: summarizeScopes(manifest) })
    },

    uninstall(pluginId) {
      if (!manifests.has(pluginId)) return fail('INVALID_INPUT', `未安装的插件：${pluginId}`)
      releaseClaims(pluginId)
      manifests.delete(pluginId)
      impls.delete(pluginId)
      return ok({ pluginId, removed: true })
    },

    get(pluginId) {
      return manifests.get(pluginId) ?? null
    },

    list() {
      return [...manifests.values()]
    },

    impl(pluginId) {
      return impls.get(pluginId) ?? null
    },

    /** 本项目启停状态的落地校验：返回可用视图，或整份失败载荷（缺口＋修复路径）。 */
    activate(carriers = {}) {
      const declared = Array.isArray(carriers.enabled) ? carriers.enabled : []
      const missingInstalled = declared.filter((id) => !manifests.has(id))
      const enabledIds = new Set(declared.filter((id) => manifests.has(id)))
      const primary = String(carriers.primary || '')

      if (!primary) {
        return fail('PRIMARY_CARRIER_MISSING', '本项目还没有主载体——请先选择「创作小说还是剧本」（D1/D2：不猜、不回落）', { enabled: [...enabledIds], missingInstalled })
      }
      if (!manifests.has(primary)) {
        return fail('PRIMARY_CARRIER_MISSING', `主载体 ${primary} 未安装，无法打开项目`, { primary, installed: [...manifests.keys()] })
      }
      enabledIds.add(primary)

      const dirConflicts = []
      const ownedDirs = new Map()
      for (const id of enabledIds) {
        for (const dir of Object.values(manifests.get(id).dataDirs)) {
          if (!ownedDirs.has(dir)) ownedDirs.set(dir, [])
          ownedDirs.get(dir).push(id)
        }
      }
      for (const [dir, holders] of ownedDirs) {
        if (holders.length > 1) {
          dirConflicts.push({ dir, holders, message: `目录「${dir}」被 ${holders.join(' / ')} 同时认领；插件板块必须各占一块（C3）` })
        }
      }
      if (dirConflicts.length) return fail('DIR_CONFLICT', dirConflicts[0].message, { dirConflicts })

      const gaps = collectGaps(manifests, enabledIds)
      if (gaps.length) {
        return fail('DEPENDENCY_UNMET', `启用集合留下 ${gaps.length} 个能力缺口`, {
          gaps,
          repairs: [...new Set(gaps.map((gap) => gap.fix).filter(Boolean))]
        })
      }

      const primaryManifest = manifests.get(primary)
      const skeleton = skeletonDirs(primaryManifest.primary.projectKind) ?? []
      const archive = []
      for (const [dir, owners] of registry.dirClaims()) {
        if ([...owners].some((id) => enabledIds.has(id))) continue
        archive.push({ dir, candidates: [...owners] })
      }

      return ok({
        primary,
        projectKind: primaryManifest.primary.projectKind,
        defaultPane: primaryManifest.primary.defaultPane,
        contextProfile: primaryManifest.primary.contextProfile,
        revision: Number.isSafeInteger(carriers.revision) ? carriers.revision : 0,
        enabled: [...enabledIds],
        enabledManifests: [...enabledIds].map((id) => manifests.get(id)),
        dirs: { skeleton, owned: [...ownedDirs.keys()] },
        panes: {
          'left-dock': panesOf(enabledIds, 'left-dock', primary),
          center: panesOf(enabledIds, 'center', primary)
        },
        tools: [...enabledIds].flatMap((id) => manifests.get(id).tools.map((tool) => ({
          name: tool, pluginId: id, title: `${manifests.get(id).title} · ${tool}`
        }))),
        context: [...enabledIds].map((id) => ({
          pluginId: id,
          ...manifests.get(id).context,
          providers: manifests.get(id).context.providers
        })),
        archive,
        missingInstalled,
        rejected: [...rejected]
      })
    },

    /** 启停变更的唯一通道：先过闭包闸门，再返回新的 enabled（不落盘，落盘归 project 层）。 */
    setEnabled(pluginId, carriers = {}, wantEnabled) {
      const enabledIds = new Set((Array.isArray(carriers.enabled) ? carriers.enabled : []).filter((id) => manifests.has(id)))
      const currently = enabledIds.has(pluginId)
      const next = wantEnabled === undefined ? !currently : Boolean(wantEnabled)
      if (next === currently) return ok({ enabled: [...enabledIds], changed: false })
      return next ? assertEnable(manifests, enabledIds, pluginId) : assertDisable(manifests, enabledIds, pluginId)
    },

    setPrimary(nextPrimaryId, carriers = {}) {
      const enabledIds = new Set((Array.isArray(carriers.enabled) ? carriers.enabled : []).filter((id) => manifests.has(id)))
      enabledIds.add(nextPrimaryId)
      return assertPrimarySwitch(manifests, enabledIds, nextPrimaryId)
    },

    grantFor(pluginId) {
      const manifest = manifests.get(pluginId)
      return manifest ? buildGrantTable(manifest.scopes) : null
    },

    ownerOfTool(toolName) {
      return toolOwners.get(toolName) ?? null
    },

    /** 物理目录 → 认领它的插件集合（供项目层建目录、归档视图判定）。 */
    dirClaims() {
      const claims = new Map()
      for (const [id, manifest] of manifests) {
        for (const dir of Object.values(manifest.dataDirs)) {
          if (!claims.has(dir)) claims.set(dir, new Set())
          claims.get(dir).add(id)
        }
      }
      return claims
    }
  }

  function panesOf(enabledIds, slot, primaryId) {
    const out = []
    for (const id of enabledIds) {
      const manifest = manifests.get(id)
      for (const pane of manifest.panes) {
        if (pane.slot !== slot) continue
        out.push({ ...pane, pluginId: id, pluginTitle: manifest.title, primary: id === primaryId })
      }
    }
    return slot === 'left-dock' ? out.sort((a, b) => Number(b.primary) - Number(a.primary)) : out
  }

  function firstToolConflict(manifest) {
    for (const tool of manifest.tools) {
      const exactOwner = toolOwners.get(tool)
      if (exactOwner && exactOwner !== manifest.id) return { namespace: tool, owner: exactOwner, kind: 'exact' }
      const namespace = tool.split('.')[0]
      const owner = namespaceOwners.get(namespace)
      if (owner && owner !== manifest.id) return { namespace, owner, kind: 'namespace' }
    }
    return null
  }

  return registry
}

function summarizeScopes(manifest) {
  return {
    files: manifest.scopes.filter((scope) => scope.startsWith('file:')),
    agent: manifest.scopes.some((scope) => scope === 'agent:ask'),
    state: manifest.scopes.filter((scope) => scope.startsWith('state:')),
    net: manifest.scopes.filter((scope) => scope.startsWith('net:'))
  }
}

export { NEXT_ERROR_CODES }
