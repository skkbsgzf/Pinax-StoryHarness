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
  /** 公共池（批次49）：应用级一份，随运行时装配同步声明与实时状态；读写都归这一处。 */
  const serviceLogPool = options.serviceLogPool ?? null
  let link = null
  let toolCache = null
  let surfaceState = null
  /** 项目事件的宿主投递（批次37）：一份订阅覆盖所有声明了 project.changed 的启用载体。 */
  let detachProjectEvents = null
  /** 载体声明的服务（协议 v3 的 services 面）：运行时起它、探它、收它。 */
  let supervisor = null
  let serviceFailures = []
  /** 外部 MCP 的实时状态（按 id 收）；池的每载体行用它判断红／橙／灰。 */
  let mcpLive = new Map()
  /** 批次69：关闭链与工具面的故障账（环形，最近 50 条）——被转成信封的拒绝必须在这里留名。 */
  const runtimeFaults = []

  function noteFault(line) {
    runtimeFaults.push(String(line))
    while (runtimeFaults.length > 50) runtimeFaults.shift()
    if (serviceLogPool?.append) {
      try {
        serviceLogPool.append({ source: { kind: 'service', id: 'runtime', carrierId: null }, level: 'warn', message: String(line) })
      } catch {
        // 记账失败不改变这条故障本身——它已经在 runtimeFaults() 里了。
      }
    }
  }

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

  /**
   * 池的声明面：载体清单里声明的 services／mcp 逐条摊出来（载体标题从注册表现取）。
   * 没声明的载体不进池——竖条据此不给 novel／outline 画灰点。
   */
  function buildServiceDeclarations() {
    const view = options.view ?? {}
    const titleOf = (pluginId) => registry?.get?.(pluginId)?.title ?? pluginId
    const declarations = []
    for (const spec of Array.isArray(view.services) ? view.services : []) {
      const carrierId = String(spec?.pluginId ?? '')
      const id = String(spec?.id ?? carrierId)
      if (!carrierId || !id) continue
      declarations.push({
        carrierId,
        carrierTitle: titleOf(carrierId),
        kind: 'service',
        id,
        port: Number.isSafeInteger(spec?.port) ? spec.port : null,
        title: id
      })
    }
    for (const spec of Array.isArray(view.mcp) ? view.mcp : []) {
      const carrierId = String(spec?.pluginId ?? '')
      const id = String(spec?.id ?? spec?.prefix ?? carrierId)
      if (!carrierId || !id) continue
      declarations.push({
        carrierId,
        carrierTitle: titleOf(carrierId),
        kind: 'mcp',
        id,
        transport: spec?.transport ? String(spec.transport) : null,
        title: id
      })
    }
    return declarations
  }

  /**
   * 关闭链的记账（批次69）：drain 硬关、SDK 打回后转成信封的在途拒绝、client/server 关闭失败，
   * 三样都写进「服务与通知」池；一条都不落的时候不写（没发生的事不该占作者的通知面）。
   * 池不在（纯内核测试／无服务形态）就只留在 lastCloseReport 上——报告本身永远在，不静默。
   */
  function accountRuntimeStop(drain, stopErrors) {
    const converted = link?.stats?.()?.converted ?? []
    const forced = drain?.forced ?? 0
    const closedErrors = drain?.errors ?? []
    const lines = [...stopErrors, ...closedErrors]
    if (!forced && !converted.length && !lines.length) return false
    const message = forced
      ? `运行时关闭时 drain 超时，硬关 ${forced} 条在途 MCP 请求（${(drain?.forcedLabels ?? []).join('、') || '未记名'}）`
      : `运行时关闭链上有 ${converted.length} 条在途请求被 SDK 打回并转成失败信封（drain 等了 ${drain?.waitedMs ?? 0}ms）`
    if (serviceLogPool?.append) {
      try {
        serviceLogPool.append({
          source: { kind: 'service', id: 'runtime-close', carrierId: null },
          level: 'warn',
          message: lines.length ? `${message}；另有 ${lines.length} 条关闭失败：${lines.slice(0, 2).join('；')}` : message,
          data: { waitedMs: drain?.waitedMs ?? 0, pendingAtClose: drain?.pendingAtClose ?? 0, forced, converted: converted.slice(0, 8), errors: lines.slice(0, 8) }
        })
      } catch {
        // 记账失败不该挡住关闭本身——这条已经留在 lastCloseReport 里，门禁读得到。
      }
    }
    return true
  }

  const runtime = {
    contract: RUNTIME_CONTRACT,
    grantTable: grants,

    /** 工具面在 start() 里现取：项目打开与否、启用了哪些载体，都只在这一刻决定面的形状。 */
    async start() {
      if (link) return ok({ already: true, toolCount: toolCache?.length ?? 0 })
      // 池先认声明：状态点／设置页在服务起来之前也知道「这个载体声明了什么」，只是先灰着。
      if (serviceLogPool?.setDeclarations) serviceLogPool.setDeclarations(buildServiceDeclarations())
      // 服务先起：载体的外部 MCP／面板可能指着自己起的本地服务，顺序反了就是连不上。
      const serviceSpecs = Array.isArray(options.view?.services) ? options.view.services : []
      const eventSink = typeof options.onServiceEvent === 'function' ? options.onServiceEvent : null
      if (serviceSpecs.length) {
        supervisor = createServiceSupervisor({
          services: serviceSpecs,
          pluginDirs: buildPluginDirs(),
          // 项目根摆进环境：服务不猜路径，用不用它自己决定。
          baseEnv: { ...process.env, ...(projectRootOf() ? { PINAX_PROJECT_ROOT: String(projectRootOf()) } : {}) },
          logPool: serviceLogPool,
          // 每次状态变化都把全量状态同步进池（池行色的数据源），再照旧推给外壳。
          onEvent: (payload) => {
            if (serviceLogPool?.setServiceStatuses && supervisor) serviceLogPool.setServiceStatuses(supervisor.status())
            if (eventSink) eventSink(payload)
          }
        })
        const startedServices = await supervisor.start()
        serviceFailures = startedServices.value?.failed ?? []
        if (serviceLogPool?.setServiceStatuses) serviceLogPool.setServiceStatuses(supervisor.status())
      }
      mcpLive = new Map()
      const surface = options.surface
        ? { server: options.surface, carrierCount: 0, carrierToolNames: [], missingImplementations: [], aggregated: false, subscribedCarriers: [] }
        : await createRuntimeSurface({
          registry,
          view: options.view,
          fileService,
          advisorBaseUrl: options.advisorBaseUrl,
          skillsDir: options.skillsDir,
          pluginDirs: buildPluginDirs(),
          serviceLogPool,
          // 外部 MCP：连接事件同时进池，并把每台的最新快照合进池的全量状态。
          mcpOptions: {
            logPool: serviceLogPool,
            onEvent: (snapshot) => {
              if (!snapshot?.id) return
              mcpLive.set(String(snapshot.id), snapshot)
              if (serviceLogPool?.setMcpStatuses) serviceLogPool.setMcpStatuses([...mcpLive.values()])
            }
          }
        })
      surfaceState = surface
      for (const server of surface.external?.servers ?? []) mcpLive.set(String(server.id), server)
      if (serviceLogPool?.setMcpStatuses) serviceLogPool.setMcpStatuses([...mcpLive.values()])
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
      // 批次69：这一路是「换项目／关窗」的清理链，每一段失败都必须带回报告而不是就地吞掉——
      // 吞掉的错误没人看得见，就等于没发生过（工单的「不许掩盖」）。
      const stopErrors = []
      // 订阅先退：换项目／关运行时之后，旧根的事件不该再投给别的载体。
      if (detachProjectEvents) {
        try {
          detachProjectEvents()
        } catch (error) {
          stopErrors.push(`项目事件退订失败：${String(error?.message ?? error)}`)
        }
        detachProjectEvents = null
      }
      if (supervisor) {
        try {
          await supervisor.stop()
        } catch (error) {
          stopErrors.push(`服务监督器停止失败：${String(error?.message ?? error)}`)
        }
        supervisor = null
        serviceFailures = []
      }
      // 关项目／换项目：状态与声明一起清（没项目就没有点），确认时间归应用级偏好，不动。
      if (serviceLogPool?.setServiceStatuses) serviceLogPool.setServiceStatuses([])
      mcpLive = new Map()
      if (serviceLogPool?.setMcpStatuses) serviceLogPool.setMcpStatuses([])
      if (serviceLogPool?.setDeclarations) serviceLogPool.setDeclarations([])
      if (!link) return ok({ stopped: false, errors: stopErrors, drain: null })
      // drain 在这一层发生：等在途工具调用落定（带上限超时）才关进程内 MCP 链路。
      let drain = null
      try {
        drain = await link.close({ drainTimeoutMs: options.drainTimeoutMs })
      } catch (error) {
        // link.close() 自己不抛（它把失败写进 report.errors）；留这一道是防止实现换人后静默炸在清理链上。
        stopErrors.push(`进程内 MCP 链路关闭异常：${String(error?.message ?? error)}`)
      }
      if (drain?.errors?.length) stopErrors.push(...drain.errors)
      runtime.lastCloseReport = drain ?? null
      // 关闭链上的任何硬关／打回／关闭失败都进「服务与通知」池：作者看得见，门禁也读得到——
      // 只往报告里塞数字不算记账，那等于只在测试眼里存在。
      accountRuntimeStop(drain, stopErrors)
      // 外部 MCP 的子进程／长连接不归聚合面收：它由这里逐一关闭。
      if (typeof surfaceState?.external?.close === 'function') {
        try {
          await surfaceState.external.close()
        } catch (error) {
          stopErrors.push(`外部 MCP 关闭失败：${String(error?.message ?? error)}`)
        }
      }
      link = null
      toolCache = null
      return ok({ stopped: true, errors: stopErrors, drain })
    },

    /** 上一次 stop() 的关闭报告（drain 等了多久、有没有硬关、哪些拒绝被转成信封）。门禁与外壳读这一格。 */
    lastCloseReport: null,

    /** 链路的实时读数：在途请求数／累计调用／被 drain 兜住的拒绝记账。没有链路时是空表，不是 null。 */
    transportStats() {
      if (!link) return { attached: false, lastCloseReport: runtime.lastCloseReport ?? null }
      return { attached: true, ...link.stats(), closeReports: link.closeReports() }
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

    /**
     * 工具调用：载体在服务面上的工具先过它的 agent:ask 授权；其余一律走内核实现。
     * 批次69 的第二道闸：这一层的 promise **只落信封、不落拒绝**。
     * 原因不是怕报错，是形态问题——`pinax:agent:tool-call` 的消费端有相当一部分是「点了就翻页」的旁路调用
     * （正文分页／双链词表／事件刷新），Vue 的 watch 回调与事件处理器不会 await 返回的 promise，
     * 一条协议层拒绝（-32000 这类）从这儿冒出去就是 Unhandled Rejection，界面上什么都看不见。
     * 拒绝转成 `{ok:false, code, message}` 后：原话进 message、码进 code、每一笔记进 runtimeFaults，
     * 消费端本来就读 `payload.ok === false`（useBoardData 的那句注释「不吞错」），界面照常出话——账也在。
     */
    async callTool(name, args = {}) {
      if (!link) return fail('INVALID_INPUT', '运行时尚未启动（先 start()）')
      const owner = runtime.ownerOf(name)
      if (owner !== 'kernel') {
        const grant = canPerform(registry.grantFor(owner), { type: 'agent', action: 'ask' })
        if (!grant.ok) return grant
      }
      let result = null
      try {
        result = await link.callTool(name, args)
      } catch (error) {
        noteFault(`callTool(${name}) 抛到运行时外面：${String(error?.message ?? error)}`)
        return fail('PINAX_MCP_CALL_FAILED', `工具 ${name} 的进程内调用失败：${String(error?.message ?? error)}`, { tool: name, owner })
      }
      return ok({ tool: name, owner, ...result })
    },

    /** 关闭链与工具面的故障账（最近 50 条）：不弹窗、不改语义，只给「看得见」留一个读数面。 */
    runtimeFaults() {
      return [...runtimeFaults]
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
          answered = await runner({ question: text, context, runtime, onEvent, writeMode, skill, abort: options?.abort ?? null })
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
