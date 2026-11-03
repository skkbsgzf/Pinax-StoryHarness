import { createRegistry } from './kernel/pluginRegistry.mjs'
import { PROJECT_KINDS, PROJECT_SPEC } from './kernel/projectSkeleton.mjs'
import { KERNEL_CONTRACT_VERSION } from './kernel/carrierManifest.mjs'
import { fail, ok } from './kernel/errors.mjs'
import { createProject, initBareProject } from './project/createProject.mjs'
import { openProject } from './project/openProject.mjs'
import { setCarrierEnabled, setPrimaryCarrier } from './project/carriers.mjs'
import { createAgentRuntime } from './runtime/agentRuntime.mjs'
import { createFileSessionStore } from './sessionStore.mjs'
import { createFileWorkspaceStore } from './workspaceStore.mjs'
import { loadBuiltInCarrierPlugins } from './carriers/index.mjs'

/**
 * Pinax-Electron-Next 内核总入口。
 * 主进程只 import 这一个文件；渲染进程通过 shell/ipcContract 的通道名调用，不碰内核实现。
 */
export const NEXT_VERSION = '0.2.0-m2'
export const KERNEL_INFO = Object.freeze({
  name: 'pinax-next-kernel',
  contractVersion: KERNEL_CONTRACT_VERSION,
  projectSpec: PROJECT_SPEC,
  runtimeTier: 'runtime',
  carrierTier: 'carrier',
  openSlots: Object.freeze(['left-dock', 'center']),
  reservedSlots: Object.freeze(['right', 'top-menu']),
  kinds: Object.freeze(Object.keys(PROJECT_KINDS))
})

export { createRegistry, createProject, initBareProject, openProject, fail, ok }
// 批次65b（框架计划 J2）：内核入口不再转发明细清单/工厂——随包发布的东西只剩一份 id 清单，
// 实现由装载器从盘上取（下面 createNextSession 的缺省装载就是那条路）。
// 旧转发的 BUILT_IN_CARRIER_PLUGINS／NOVEL_*／DOSSIER_*／readSettingEntries 全撤：
// 逐个 grep 过，本仓库除本文件外没有消费者（要清单的人直接 import 对应载体的 manifest.mjs）。
export {
  BUILT_IN_CARRIER_IDS,
  loadBuiltInCarriers,
  loadBuiltInCarrierPlugins
} from './carriers/index.mjs'
// 批次65b 调度方修正：这两个 id 常量有 createRequire 消费者（carrier-pane-real.spec 的 jsdom
// 规避路径），require(esm) 对缺失命名导出不抛错只给 undefined——静默断链，Primary 缺失报错的真因。
// 字面常量，不引载体本体（零静态 import 纪律不破）。
export const NOVEL_CARRIER_ID = 'pinax.carrier.novel'
export const DOSSIER_CARRIER_ID = 'pinax.carrier.dossier'
export { createAdvisorRunner, ADVISOR_RUNNER_SOURCE } from './runtime/runnerAdvisor.mjs'
export { buildRuntimeEnvelope, readOnlyTaskForProfile } from './runtime/contextProfiles.mjs'

/**
 * 起一个会话：注册表 → 装载载体（M2 起默认随框架发布小说＋设定；批次65b 起经装载器从盘上取，
 * 内置只是「随包已安装」，与外部插件同一扇「从盘上发现」的门）→ 打开项目 → 拉起运行时。
 * 任一步失败都返回可渲染的失败载荷（外壳据此停在失败界面，不白屏、不崩）。
 * `plugins: []` 是空框架轨道（M1 验收仍走它）；不传 plugins 时按随包 id 清单从货架装载。
 */
export async function createNextSession({ root, plugins, builtInCarriers = true, runtimeOptions = {}, autoOpen = true } = {}) {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const pluginList = plugins === undefined ? (builtInCarriers ? await loadBuiltInCarrierPlugins() : []) : plugins
  const installed = []
  for (const plugin of pluginList) {
    const result = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    installed.push({ pluginId: plugin.manifest?.id ?? '(未命名)', ...result })
  }

  function recordFailure(result) {
    if (!result.ok) session.lastFailure = result
    return result
  }

  /**
   * 退役一份运行时（批次69：close 链的唯一收口）。
   * 换项目／刷新／关会话三条路都从这里走，把 stop() 的关闭报告（drain 等了多久、有没有硬关、
   * 哪些在途拒绝被转成信封）留在 session.lastRuntimeStop 上——失败要看得见，不许就地丢掉。
   */
  async function retireRuntime() {
    if (!session.runtime) return null
    const runtime = session.runtime
    session.runtime = null
    const stopped = await runtime.stop()
    session.lastRuntimeStop = stopped.ok ? stopped.value : { stopped: false, errors: [`${stopped.error?.code ?? 'STOP_FAILED'}：${stopped.error?.message ?? '运行时停止失败'}`] }
    return session.lastRuntimeStop
  }

  const session = {
    kernel: KERNEL_INFO,
    registry,
    installed,
    project: null,
    /** 最近一次触碰过的项目根：裸项目（还没主载体）也必须有，否则主载体向导无从落盘。 */
    projectRoot: root ? String(root) : null,
    runtime: null,
    view: null,
    lastFailure: null,
    /** 会话落盘（M2.5-B）：跟着当前项目根走；换项目就换一份（`.pinax/sessions/` 在那个项目下）。 */
    sessions: null,

    /** 当前项目的会话存储；没有项目根时返回 null（渲染层只在打开项目后才读盘）。 */
    sessionStore() {
      if (!session.projectRoot) return null
      if (!session.sessions || session.sessions.root !== session.projectRoot) {
        session.sessions = createFileSessionStore({ root: session.projectRoot })
      }
      return session.sessions
    },

    async loadSessions() {
      const store = session.sessionStore()
      if (!store) return ok({ sessions: [], warnings: [], badLines: 0, dir: null })
      return store.loadAll()
    },

    async saveSessions(snapshot) {
      const store = session.sessionStore()
      if (!store) return fail('INVALID_INPUT', '会话落盘需要先打开一个项目')
      return store.saveSnapshot(snapshot)
    },

    async importSessions(legacy) {
      const store = session.sessionStore()
      if (!store) return fail('INVALID_INPUT', '会话迁移需要先打开一个项目')
      return store.importLegacy(legacy)
    },

    /** 工作区状态（M2.5-C）：同样跟着当前项目根走，换项目就换一份。 */
    workspaces: null,

    workspaceStore() {
      if (!session.projectRoot) return null
      if (!session.workspaces || session.workspaces.root !== session.projectRoot) {
        session.workspaces = createFileWorkspaceStore({ root: session.projectRoot })
      }
      return session.workspaces
    },

    async loadWorkspace() {
      const store = session.workspaceStore()
      if (!store) return ok({ version: 1, entries: {}, warnings: [], exists: false })
      return store.read()
    },

    async saveWorkspace(snapshot) {
      const store = session.workspaceStore()
      if (!store) return fail('INVALID_INPUT', '工作区落盘需要先打开一个项目')
      return store.write(snapshot)
    },

    async create({ name, primaryCarrier, extraEnabled = [], root: projectRootOverride } = {}) {
      // root 覆写（批次9）：渲染层经系统对话框选定的空目录优先于会话根——
      // 会话根（Documents）几乎必然非空，createProject 的「目标目录必须为空」闸会永远拦住。
      const created = await createProject({ root: projectRootOverride ?? root, name, primaryCarrier, registry, extraEnabled })
      if (!created.ok) return recordFailure(created)
      return session.open(created.value.root)
    },

    async createBare({ name }) {
      const made = await initBareProject({ root, name })
      if (made.ok) session.projectRoot = made.value.root
      return recordFailure(made)
    },

    /**
     * 运行时是内置一级公民：项目没打开成功（例如裸项目还没主载体）它也必须在，
     * 否则右栏在空框架里就是死的。fileService 与 view 只在项目打开后绑定——
     * 载体工具面依附项目（没有文件服务就没有载体工具），这一条与「运行时不依附项目」并不冲突。
     */
    async ensureRuntime() {
      if (!session.runtime) {
        session.runtime = createAgentRuntime({
          registry,
          fileService: session.project?.value?.fileService ?? null,
          view: session.project?.value?.view ?? null,
          ...runtimeOptions
        })
      }
      return session.runtime.start()
    },

    async open(projectRoot = session.projectRoot) {
      const opened = await openProject({ root: projectRoot, registry })
      if (!opened.ok) {
        session.projectRoot = String(projectRoot)
        return recordFailure(opened)
      }
      session.lastFailure = null
      session.projectRoot = opened.value.root
      session.project = opened
      session.view = opened.value.view
      // 换项目＝换运行时：上一份的进程内 MCP 链路必须先关掉（与 refresh() 同一条规矩），
      // 否则「新建后再打开」这种顺序会在主进程里攒出多余的运行时段。
      await retireRuntime()
      session.runtime = createAgentRuntime({
        registry,
        fileService: opened.value.fileService,
        view: opened.value.view,
        ...runtimeOptions
      })
      const started = await session.runtime.start()
      return ok({ ...opened.value, runtime: started.value })
    },

    async setEnabled(pluginId, enabled, expectedRevision) {
      if (!session.projectRoot) return fail('INVALID_INPUT', '还没有任何项目：请先新建或打开一个项目文件夹')
      const result = await setCarrierEnabled({ root: session.projectRoot, registry, pluginId, enabled, expectedRevision })
      if (!result.ok) return recordFailure(result)
      return session.refresh(result.value?.document)
    },

    async setPrimary(pluginId, expectedRevision) {
      if (!session.projectRoot) return fail('INVALID_INPUT', '还没有任何项目：请先新建或打开一个项目文件夹')
      const result = await setPrimaryCarrier({ root: session.projectRoot, registry, pluginId, expectedRevision })
      if (!result.ok) return recordFailure(result)
      return session.refresh(result.value?.document)
    },

    async refresh(document) {
      const reopened = await openProject({ root: session.projectRoot, registry })
      if (!reopened.ok) return recordFailure(reopened)
      session.lastFailure = null
      session.project = reopened
      session.view = reopened.value.view
      await retireRuntime()
      session.runtime = createAgentRuntime({ registry, fileService: reopened.value.fileService, view: reopened.value.view, ...runtimeOptions })
      const started = await session.runtime.start()
      return ok({ ...reopened.value, document: document ?? reopened.value.document, runtime: started.value })
    },

    async close() {
      const stopReport = await retireRuntime()
      return ok({ closed: true, runtime: stopReport })
    },

    /** 最近一次运行时退役的关闭报告（drain／硬关／被转成信封的拒绝）——外壳与门禁读这一格，不靠猜。 */
    lastRuntimeStop: null,
  }

  if (root && autoOpen) {
    const opened = await session.open(root)
    session.openResult = opened
    // 打开失败（如裸项目还没主载体）时，运行时要独立起来——右栏一级公民不依附于任何一个项目。
    if (!opened.ok) await session.ensureRuntime()
  } else {
    await session.ensureRuntime()
  }
  return session
}
