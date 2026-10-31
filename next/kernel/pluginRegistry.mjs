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
  /** 每插件的安装目录（协议 v3 的相对路径要靠它解析：服务的 command／cwd、面板的 entry）。 */
  const pluginDirs = new Map()
  const rejected = []
  const toolOwners = new Map()
  const namespaceOwners = new Map()
  /** 每插件的清理钩子（视图实例、订阅、定时器）；uninstall 时统一跑，跑完即弃。 */
  const disposers = new Map()
  const uninstallListeners = new Set()

  function releaseClaims(pluginId) {
    for (const [tool, owner] of [...toolOwners]) if (owner === pluginId) toolOwners.delete(tool)
    for (const [namespace, owner] of [...namespaceOwners]) if (owner === pluginId) namespaceOwners.delete(namespace)
  }

  /** 先跑 impl.dispose()，再跑注册期挂上的钩子；单个抛错不阻断其余，但要记下来。 */
  function disposePlugin(pluginId) {
    const disposed = []
    const impl = impls.get(pluginId)
    if (impl && typeof impl.dispose === 'function') {
      try {
        impl.dispose()
        disposed.push({ source: 'impl' })
      } catch (error) {
        disposed.push({ source: 'impl', error: String(error?.message ?? error) })
      }
    }
    for (const [index, fn] of [...(disposers.get(pluginId) ?? new Map()).values()].entries()) {
      try {
        fn()
        disposed.push({ source: 'hook', index })
      } catch (error) {
        disposed.push({ source: 'hook', index, error: String(error?.message ?? error) })
      }
    }
    disposers.delete(pluginId)
    return disposed
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
      // 外部 MCP 的工具名在连接后才出现：装的时候就先把命名空间占住，
      // 两个载体抢同一个前缀＝装的时候就拒，而不是等到聚合工具面撞名才发现。
      for (const server of manifest.mcp ?? []) namespaceOwners.set(server.prefix, manifest.id)

      manifests.set(manifest.id, manifest)
      impls.set(manifest.id, { ...impl, trust: meta.trust ?? 't1' })
      if (meta.dir) pluginDirs.set(manifest.id, String(meta.dir))
      return ok({ manifest, trust: meta.trust ?? 't1', scopeSummary: summarizeScopes(manifest) })
    },

    uninstall(pluginId) {
      if (!manifests.has(pluginId)) return fail('INVALID_INPUT', `未安装的插件：${pluginId}`)
      // 顺序：先跑清理（视图实例、订阅、定时器），再释放工具/目录名claims，最后除名——
      // 清理钩子里若还读得到清单，不算是「卸载后再动已消失的插件」。
      const disposed = disposePlugin(pluginId)
      releaseClaims(pluginId)
      manifests.delete(pluginId)
      impls.delete(pluginId)
      pluginDirs.delete(pluginId)
      for (const listener of [...uninstallListeners]) {
        try {
          listener({ pluginId })
        } catch {
          // 监听方自己出错不影响卸载结果；下次装载仍可重新订阅。
        }
      }
      return ok({ pluginId, removed: true, disposed })
    },

    /** 注册期清理钩子：返回释放句柄；插件卸载时统一调用（幂等，重复调用只跑一次）。 */
    onDispose(pluginId, fn) {
      if (typeof pluginId !== 'string' || !pluginId) return fail('INVALID_INPUT', 'onDispose 需要插件 id')
      if (typeof fn !== 'function') return fail('INVALID_INPUT', 'onDispose 需要函数')
      if (!disposers.has(pluginId)) disposers.set(pluginId, new Map())
      const bucket = disposers.get(pluginId)
      const key = Symbol('dispose')
      bucket.set(key, fn)
      return ok({
        off() {
          bucket.delete(key)
        }
      })
    },

    /** 卸载广播（运行时/view 注册表据此 disposeOwner）；返回退订函数。 */
    onUninstalled(listener) {
      if (typeof listener !== 'function') return fail('INVALID_INPUT', 'onUninstalled 需要函数')
      uninstallListeners.add(listener)
      return ok({ off: () => uninstallListeners.delete(listener) })
    },

    /** 插件的安装目录（协议 v3 的相对路径解析基准；没登记就是 null）。 */
    dirOf(pluginId) {
      return pluginDirs.get(String(pluginId)) ?? null
    },

    /** 已安装清单里声明过的命令（v2 contributes.commands）。 */
    commands() {
      const out = []
      for (const [pluginId, manifest] of manifests) {
        for (const command of manifest.commands ?? []) out.push({ pluginId, ...command })
      }
      return out
    },

    commandOwner(commandId) {
      for (const [pluginId, manifest] of manifests) {
        if ((manifest.commands ?? []).some((command) => command.id === commandId)) return pluginId
      }
      return null
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
        // 协议 v3 的四个运行面（只有 @3 清单才会有内容；@1/@2 归一后是 null／空数组）：
        // 自带面板按 pane 走（pane.entry），服务与外部 MCP 是项目级的——运行时据此起子进程／连端点。
        services: [...enabledIds].flatMap((id) => manifests.get(id).services.map((service) => ({
          pluginId: id,
          dir: pluginDirs.get(id) ?? null,
          ...service
        }))),
        mcp: [...enabledIds].flatMap((id) => manifests.get(id).mcp.map((server) => ({ pluginId: id, ...server }))),
        agents: [...enabledIds]
          .filter((id) => manifests.get(id).agentMd)
          .map((id) => ({ pluginId: id, path: manifests.get(id).agentMd })),
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
        // entry 随 pane 一起出去：宿主解析到 pinax.view.custom 时不必再回注册表找一遍入口。
        out.push({ ...pane, pluginId: id, pluginTitle: manifest.title, primary: id === primaryId, entry: manifest.entry ?? null })
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
    for (const server of manifest.mcp ?? []) {
      const owner = namespaceOwners.get(server.prefix)
      if (owner && owner !== manifest.id) return { namespace: server.prefix, owner, kind: 'mcp-prefix' }
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
