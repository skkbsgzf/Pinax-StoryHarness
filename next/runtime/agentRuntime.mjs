import { fail, ok, NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { buildGrantTable, canPerform } from '../kernel/scopeGrant.mjs'
import { createRuntimeSurface } from './mcpSurface.mjs'
import { collectPluginDirs } from './pluginDirs.mjs'
import { connectInProcess } from './transportInProcess.mjs'
import { normalizeWriteMode } from './writePolicy.mjs'
import { subscribeProjectEvents } from './eventBus.mjs'
import { createServiceSupervisor } from './serviceSupervisor.mjs'
import { RUNTIME_CONTRACT, RUNTIME_ID } from './runtimeContract.mjs'

/**
 * 一级公民：Pi-Agent 运行时（规范 v1 第 5 节）。
 * 与二级插件的区别只有四条，且都写成可断言的数据（见 runtimeContract.mjs）：
 *   builtIn 不可停用 / 独占右栏 / 上下文预算优先 / 写回只进 .pinax/proposals/。
 * 其余一切（注册、scope、工具面）走同一份合同——运行时也照样自缚申请权限。
 */
export { RUNTIME_CONTRACT, RUNTIME_ID }

export function createAgentRuntime(options = {}) {
  const registry = options.registry
  const fileService = options.fileService ?? null
  const runner = options.runner ?? null
  const grants = buildGrantTable(RUNTIME_CONTRACT.scopes)
  let link = null
  let toolCache = null
  let surfaceState = null
  /** 项目事件的宿主投递（批次37）：一份订阅覆盖所有声明了 project.changed 的启用载体。 */
  let detachProjectEvents = null
  /** 载体声明的服务（协议 v3 的 services 面）：运行时起它、探它、收它。 */
  let supervisor = null
  let serviceFailures = []

  /**
   * 把一次项目变更交给每个订阅载体的 impl.onProjectEvent（批次37，M2.5-C 承诺的兑现）。
   * 今天没有载体实现这个钩子——投递路径是真实的、空的；未来某块载体要做「盘变了就重算缓存」，
   * 在自己 impl 上加一个 onProjectEvent 即可，清单不用改（订阅声明已经在 manifest 里）。
   */
  function deliverProjectEvent(event, subscriberIds) {
    for (const pluginId of subscriberIds) {
      const handler = registry?.impl?.(pluginId)?.onProjectEvent
      if (typeof handler !== 'function') continue
      try {
        const returned = handler({ ...event }, { pluginId })
        if (returned && typeof returned.then === 'function') returned.then(null, () => {})
      } catch {
        // 事件是旁路：一个载体的处理器坏掉不影响别的载体，更不影响写入本身。
      }
    }
  }

  /**
   * 插件目录表（协议 v3 的相对路径解析基准）。
   * 注册表登记的 dir 优先；宿主也可以用 pluginDirs 覆盖（外置插件不在安装目录里）。
   */
  function buildPluginDirs() {
    return collectPluginDirs({ registry, overrides: options.pluginDirs })
  }

  /**
   * 当前项目根：文件服务知道最准，视图是兜底。
   * 载体声明的服务常要靠它定位项目里的数据（如漫画预览服务读 漫画/漫画.json）——
   * 宿主把它摆在环境里（PINAX_PROJECT_ROOT），服务自己决定用不用，不替它猜路径。
   */
  function projectRootOf() {
    return fileService?.root ?? options.view?.root ?? null
  }

  const runtime = {
    contract: RUNTIME_CONTRACT,
    grantTable: grants,

    /** 工具面在 start() 里现取：项目打开与否、启用了哪些载体，都只在这一刻决定面的形状。 */
    async start() {
      if (link) return ok({ already: true, toolCount: toolCache?.length ?? 0 })
      // 服务先起：载体的外部 MCP／面板可能指着自己起的本地服务，顺序反了就是连不上。
      const serviceSpecs = Array.isArray(options.view?.services) ? options.view.services : []
      if (serviceSpecs.length) {
        supervisor = createServiceSupervisor({
          services: serviceSpecs,
          pluginDirs: buildPluginDirs(),
          // 项目根摆进环境：服务不猜路径，用不用它自己决定。
          baseEnv: { ...process.env, ...(projectRootOf() ? { PINAX_PROJECT_ROOT: String(projectRootOf()) } : {}) },
          onEvent: typeof options.onServiceEvent === 'function' ? options.onServiceEvent : null
        })
        const startedServices = await supervisor.start()
        serviceFailures = startedServices.value?.failed ?? []
      }
      const surface = options.surface
        ? { server: options.surface, carrierCount: 0, carrierToolNames: [], missingImplementations: [], aggregated: false, subscribedCarriers: [] }
        : await createRuntimeSurface({ registry, view: options.view, fileService, advisorBaseUrl: options.advisorBaseUrl, skillsDir: options.skillsDir, pluginDirs: buildPluginDirs() })
      surfaceState = surface
      link = await connectInProcess(surface.server, { clientName: options.clientName ?? 'pinax-next-shell' })
      toolCache = await link.listTools()
      // 宿主替声明了 project.changed 的启用载体挂投递：只认当前项目根，换项目＝换运行时＝新订阅。
      const projectRoot = projectRootOf()
      const subscribers = surface.subscribedCarriers ?? []
      if (projectRoot && subscribers.length) {
        detachProjectEvents = subscribeProjectEvents(projectRoot, (event) => deliverProjectEvent(event, subscribers))
      }
      return ok({
        toolCount: toolCache.length,
        carrierTools: surface.carrierCount,
        aggregatedSurface: surface.aggregated,
        subscribedCarriers: subscribers.length,
        externalServers: surface.external?.count ?? 0,
        externalFailures: surface.external?.failures?.length ?? 0,
        services: supervisor ? supervisor.status().length : 0,
        serviceFailures: serviceFailures.length,
        transports: ['in-process'],
        // 外部 MCP 可能自己开端口（sse 连远端），但内核这一侧仍然不起 HTTP 服务。
        portsOpened: 0
      })
    },

    /**
     * 运行器的取数面：注册表＋项目视图＋文件服务。
     * 单列一个方法而不是把三者塞进 runner 的入参，是为了让 runner（含测试里的假运行器）
     * 只依赖这一处约定；载体块构建器拿到的仍是各板块自己的 pluginId 与 scope，运行时不替谁越权。
     */
    contextSources() {
      return { registry, view: options.view ?? null, fileService, runner: typeof runner === 'function' ? runner : null }
    },

    async stop() {
      // 订阅先退：换项目／关运行时之后，旧根的事件不该再投给这块载体。
      if (detachProjectEvents) {
        detachProjectEvents()
        detachProjectEvents = null
      }
      if (supervisor) {
        await supervisor.stop().catch(() => {})
        supervisor = null
        serviceFailures = []
      }
      if (!link) return ok({ stopped: false })
      await link.close()
      // 外部 MCP 的子进程／长连接不归聚合面收：它由这里逐一关闭。
      if (typeof surfaceState?.external?.close === 'function') await surfaceState.external.close().catch(() => {})
      link = null
      toolCache = null
      return ok({ stopped: true })
    },

    /** 服务状态（右栏与 IPC 读这一份；没有服务时是空数组，不是一个 null）。 */
    serviceStatus() {
      return supervisor ? supervisor.status() : []
    },

    /** 手动重启一颗服务（界面上的「重启」按钮走这里）。 */
    async restartService(id) {
      if (!supervisor) return fail('INVALID_INPUT', '当前没有在跑的服务')
      return supervisor.restart(id)
    },

    listTools() {
      return toolCache ?? []
    },

    /** 聚合状态的记账（门禁与右栏都用它，不靠猜）。 */
    surfaceInfo() {
      return {
        carrierTools: surfaceState?.carrierCount ?? 0,
        carrierToolNames: surfaceState?.carrierToolNames ?? [],
        aggregated: surfaceState?.aggregated ?? false,
        missingImplementations: surfaceState?.missingImplementations ?? [],
        subscribedCarriers: surfaceState?.subscribedCarriers ?? [],
        external: {
          count: surfaceState?.external?.count ?? 0,
          failures: surfaceState?.external?.failures ?? [],
          servers: surfaceState?.external?.servers ?? [],
          toolNames: link ? (surfaceState?.external?.toolNames ?? []) : []
        },
        writeGuard: surfaceState?.writeGuard ?? null,
        services: runtime.serviceStatus(),
        serviceFailures: [...serviceFailures],
        skills: surfaceState?.skills ?? { names: [], rejected: [], catalog: [] }
      }
    },

    /** 技能清单（渐进披露的那一行描述）：装载失败的那几条也在 rejected 里，不静默吞。 */
    skills() {
      return runtime.surfaceInfo().skills
    },

    /**
     * 工具归属＝「这一刻是谁在服务这个调用」，不是「谁登记过这个名字」。
     * 载体被停用后它的工具不在面上，调用回落内核实现——这时拿停用者的 scope 去卡人就是错的。
     */
    ownerOf(name) {
      // 外部 MCP 的工具名是 `<prefix>.<remote>`：归属是声明这台服务端的插件（安装期已仲裁 prefix）。
      const external = surfaceState?.external?.servers?.find((server) => String(name).startsWith(`${server.prefix}.`))
      if (external) return external.pluginId ?? 'kernel'
      const owner = registry?.ownerOfTool?.(name) ?? null
      if (!owner) return 'kernel'
      return runtime.surfaceInfo().carrierToolNames.includes(name) ? owner : 'kernel'
    },

    /** 工具调用：载体在服务面上的工具先过它的 agent:ask 授权；其余一律走内核实现。 */
    async callTool(name, args = {}) {
      if (!link) return fail('INVALID_INPUT', '运行时尚未启动（先 start()）')
      const owner = runtime.ownerOf(name)
      if (owner !== 'kernel') {
        const grant = canPerform(registry.grantFor(owner), { type: 'agent', action: 'ask' })
        if (!grant.ok) return grant
      }
      const result = await link.callTool(name, args)
      return ok({ tool: name, owner, ...result })
    },

    /**
     * 问一句话。M2 的真实口径：
     *   有注入的 runner（外壳主进程装 createAdvisorRunner，测试装假运行器）→ 由它组信封、调上游、原样回报；
     *   没有 runner 但显式给了 advisorBaseUrl → 走既有 pinax_agent_ask（HTTP 自调用，后续要拆）；
     *   两者都没有 → 如实报 DEPENDENCY_UNMET，绝不编一段回答冒充模型。
     * runner 返回 {ok:false, error} 的失败信封一律原样透传（内核那句「未检测到可用模型…」必须能被作者看到）。
     *
     * 第三个参数是运行过程事件口（批次29）：`ask(question, context, { onEvent })`。
     * 单列第三参而不是塞进 context，是为了不弄脏上下文契约——context 会进信封组装（omit／chapterIndex…），
     * 而 onEvent 是回调，不该被当成上下文块的选择依据。前两参的调用面一字未动。
     */
    async ask(question, context = {}, options = {}) {
      const text = String(question || '').trim()
      if (!text) return fail('INVALID_INPUT', '提问内容不能为空')
      const grant = canPerform(grants, { type: 'agent', action: 'ask' })
      if (!grant.ok) return grant
      if (typeof runner === 'function') {
        const onEvent = typeof options?.onEvent === 'function' ? options.onEvent : null
        // 写模式（M2.5-B）：未知值一律回落 review，不猜作者意图。只有策略值，不在这里落盘。
        const writeMode = normalizeWriteMode(options?.writeMode)
        const skillName = String(options?.skill ?? '').trim()
        let skill = null
        if (skillName) {
          skill = runtime.skills().catalog.find((entry) => entry.name === skillName) ?? null
          if (!skill) {
            return fail('INVALID_INPUT', `没有这个技能：${skillName}（技能未装载或名字不对；看右栏工具清单里的 rejected 记账）`, {
              skill: skillName,
              rejected: runtime.skills().rejected
            })
          }
        }
        let answered = null
        try {
          answered = await runner({ question: text, context, runtime, onEvent, writeMode, skill })
        } catch (error) {
          return fail('IO_FAILED', `运行时执行失败：${String(error?.message || error)}`, { code: error?.code ?? NEXT_ERROR_CODES.IO_FAILED })
        }
        if (answered && typeof answered === 'object' && answered.ok === false) return answered
        if (answered && typeof answered === 'object' && answered.ok === true) {
          const payload = { ...answered }
          delete payload.ok
          return ok({ source: 'in-process-runner', ...payload })
        }
        return ok({ source: 'in-process-runner', ...normalizeAnswer(answered) })
      }
      if (options.advisorBaseUrl) {
        const result = await runtime.callTool('pinax_agent_ask', { question: text, ...context })
        return result.ok ? ok({ source: 'advisor-http', ...result.value }) : result
      }
      return fail('DEPENDENCY_UNMET', 'Next 运行时未接模型运行器（runner）：工具面能列、项目能读，但回答不了自然语言问题。接法是在 createNextSession({ runtimeOptions: { runner: createAdvisorRunner() } }) 注入进程内运行器；外壳已按此装配，测试与验收刻意不注入以保留这条如实的失败路径', {
        toolCount: runtime.listTools().length
      })
    },

    /** 提案写回：只进 .pinax/proposals/，正文一个字节都不动。 */
    async propose({ name, text }) {
      if (!fileService) return fail('INVALID_INPUT', '运行时未绑定项目文件服务，无法落提案')
      const grant = canPerform(grants, { type: 'state', action: 'write' })
      if (!grant.ok) return grant
      return fileService.writeProposal({ name, text })
    },

    /** 外壳读的右栏数据：工具清单＋归属，供 RuntimeDock 直接渲染。 */
    dockViewModel() {
      return {
        title: RUNTIME_CONTRACT.title,
        builtIn: true,
        disableable: false,
        surface: runtime.surfaceInfo(),
        services: runtime.serviceStatus(),
        tools: runtime.listTools().map((tool) => ({
          name: tool.name,
          title: tool.title ?? tool.name,
          owner: runtime.ownerOf(tool.name)
        })),
        started: Boolean(link)
      }
    }
  }

  return runtime
}

function normalizeAnswer(answer) {
  if (typeof answer === 'string') return { text: answer }
  if (answer && typeof answer === 'object') {
    return { text: String(answer.text ?? answer.answer ?? answer.message ?? JSON.stringify(answer)).slice(0, 4000), payload: answer }
  }
  return { text: String(answer ?? '') }
}
