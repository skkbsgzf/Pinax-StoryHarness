import { spawn } from 'node:child_process'
import http from 'node:http'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'
import { applyServiceOverride, readCarrierOverridesSync, serviceOverrideFor } from '../carrierOverridesStore.mjs'

/**
 * 服务监督器（协议 v3 的 `services` 声明面）。
 * 一个载体可以声明自己的常驻服务（本地 HTTP 服务、MCP 宿主、渲染器……）。宿主负责：
 *   起子进程 → 探端口／健康路径 → 崩溃按策略重启 → 关项目／退出时收尸。
 * 四条边界：
 *   1) 服务归声明它的插件（pluginId），状态里永远带着它——右栏与日志都能追责到人；
 *   2) 起不来不拖垮运行时：每个服务独立成败，失败进 failed 记账，其余照常；
 *   3) 端口与健康路径只做「这台真的在听」的判断，不猜语义（任何 HTTP 应答都算在听）；
 *   4) 日志留环形尾巴（最近 200 行），不全量塞进内存——服务话多也不能把主进程吃撑。
 * 状态变更一律走 onEvent 推给外壳，界面不必轮询。
 */
export const SERVICE_STATUS = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  READY: 'ready',
  UNHEALTHY: 'unhealthy',
  CRASHED: 'crashed',
  FAILED: 'failed',
  STOPPING: 'stopping'
})

const DEFAULT_HEALTH_TIMEOUT_MS = 15_000
const DEFAULT_HEALTH_INTERVAL_MS = 300
const DEFAULT_LOG_LIMIT = 200
const MAX_RESTARTS = 5
const MAX_BACKOFF_MS = 30_000
const KILL_GRACE_MS = 3_000

/** 服务状态的对外形状（界面、IPC、测试读的都是这一份）。 */
function publicStatus(entry) {
  return {
    id: entry.id,
    pluginId: entry.pluginId,
    status: entry.status,
    // adopt（批次52）：外部进程自管，宿主只探活／状态灯／池记账，不 spawn。界面据这面区分两种服务。
    adopt: entry.adopt === true,
    pid: entry.pid,
    port: entry.port,
    restarts: entry.restarts,
    exitCode: entry.exitCode,
    error: entry.error,
    health: entry.health ? { ...entry.health } : null,
    startedAt: entry.startedAt,
    // 批次54：端口来自清单还是工程覆盖，状态行要能说清（竖条与诊断都读这一份）。
    portSource: entry.portSource ?? 'manifest',
    overrideFields: [...(entry.overrideFields ?? [])],
    logs: entry.logs.slice(-20)
  }
}

const SERVICE_EVENT_LEVEL = Object.freeze({
  'service-starting': 'info',
  'service-ready': 'info',
  'service-unhealthy': 'warn',
  'service-crashed': 'warn',
  'service-failed': 'error',
  'service-error': 'error',
  'service-stopping': 'info',
  'service-stopped': 'info'
})

function serviceEventMessage(type, entry) {
  const name = `服务「${entry.id}」`
  switch (type) {
    case 'service-starting': return entry.adopt ? `${name}探活中（外部进程，宿主不启动）` : `${name}启动中`
    case 'service-ready': return entry.port ? `${name}就绪（${entry.adopt ? '外部进程，' : ''}端口 ${entry.port}）` : `${name}就绪`
    case 'service-unhealthy': return `${name}健康检查未通过：${entry.error ?? '未知原因'}`
    case 'service-crashed': return `${name}进程崩溃：${entry.error ?? '未知原因'}`
    case 'service-failed': return `${name}失败：${entry.error ?? '未知原因'}`
    case 'service-error': return `${name}错误：${entry.error ?? '未知原因'}`
    case 'service-stopping': return `${name}停止中`
    case 'service-stopped': return `${name}已停止`
    default: return `${name}${type}`
  }
}

export function createServiceSupervisor(options = {}) {
  const specs = Array.isArray(options.services) ? options.services : []
  const pluginDirs = options.pluginDirs ?? {}
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
  /** 公共池（批次49）：事件照旧推 onEvent，同时记一份进池——池是读数的唯一权威视图。 */
  const logPool = options.logPool && typeof options.logPool.append === 'function' ? options.logPool : null
  const spawnImpl = typeof options.spawnImpl === 'function' ? options.spawnImpl : spawn
  const healthTimeoutMs = Number.isSafeInteger(options.healthTimeoutMs) ? options.healthTimeoutMs : DEFAULT_HEALTH_TIMEOUT_MS
  const healthIntervalMs = Number.isSafeInteger(options.healthIntervalMs) ? options.healthIntervalMs : DEFAULT_HEALTH_INTERVAL_MS
  const logLimit = Number.isSafeInteger(options.logLimit) ? options.logLimit : DEFAULT_LOG_LIMIT
  const baseEnv = options.baseEnv ?? process.env
  const probe = typeof options.probeHealth === 'function' ? options.probeHealth : defaultProbeHealth
  /**
   * 工程覆盖（批次54）：合并序＝清单默认→覆盖（只有两级）。
   * 测试可直接注入 overrides；主进程不注入，按项目根读 `.pinax/` 下那份覆盖文件。
   * 只 merger port／healthPath／args——adopt／command／env／restart 永远由清单说了算。
   */
  const overrideState = options.overrides !== undefined
    ? { overrides: options.overrides ?? {}, warnings: [] }
    : readCarrierOverridesSync(options.projectRoot ?? baseEnv?.PINAX_PROJECT_ROOT ?? null)

  const entries = new Map()
  let stopping = false

  function emit(type, entry) {
    if (logPool) {
      try {
        logPool.append({
          source: { kind: 'service', id: entry.id, carrierId: entry.pluginId },
          level: SERVICE_EVENT_LEVEL[type] ?? 'info',
          message: serviceEventMessage(type, entry),
          data: { port: entry.port ?? null, restarts: entry.restarts ?? 0 },
          // 失败与健康检查反复失败需要作者确认（设置页「知道了」）。
          confirm: type === 'service-failed' || type === 'service-unhealthy'
        })
      } catch {
        // 记账坏掉不影响被监督的服务本身。
      }
    }
    if (!onEvent) return
    try {
      onEvent({ type, service: publicStatus(entry) })
    } catch {
      // 状态订阅方坏掉不影响被监督的服务本身。
    }
  }

  /**
   * 覆盖命中的记账（批次54）：每命中一个字段记一条 info，来源层写明「工程覆盖」。
   * 手改覆盖文件写坏了字段也留一条 warn——不静默吞掉作者以为生效了的改动。
   */
  function appendOverrideNote(entry, applied) {
    if (!logPool) return
    const source = { kind: 'service', id: entry.id, carrierId: entry.pluginId }
    for (const hit of applied.hits) {
      const message = hit.field === 'port'
        ? `端口 ${hit.from ?? '(未声明)'} 被工程覆盖改成了 ${hit.to}`
        : hit.field === 'healthPath'
          ? `健康路径 ${hit.from ?? '(未声明)'} 被工程覆盖改成了 ${hit.to}`
          : `启动参数被工程覆盖改成了 ${JSON.stringify(hit.to)}`
      try {
        logPool.append({
          source,
          level: 'info',
          message,
          data: { field: hit.field, from: hit.from, to: hit.to, layer: 'override' }
        })
      } catch {
        // 记账坏掉不影响服务本身。
      }
    }
    for (const warning of applied.warnings) {
      try {
        logPool.append({
          source,
          level: 'warn',
          message: `工程覆盖未生效：${warning}`,
          data: { layer: 'override', warning }
        })
      } catch {
        // 同上。
      }
    }
  }

  function pushLog(entry, stream, chunk) {
    for (const line of String(chunk).split(/\r?\n/u)) {
      if (!line.trim()) continue
      entry.logs.push(`[${stream}] ${line.slice(0, 500)}`)
    }
    while (entry.logs.length > logLimit) entry.logs.shift()
  }

  function resolveAgainstPlugin(entry, value) {
    const raw = String(value ?? '')
    if (!raw) return null
    if (isAbsolute(raw)) return raw
    const base = pluginDirs[entry.pluginId] ?? entry.dir ?? null
    return base ? resolvePath(base, raw) : raw
  }

  /**
   * 可执行入口的解析：裸命令名（node、python…）走 PATH 由系统找，
   * 带路径分隔符的才按插件目录解析——否则 `command:'node'` 会被解析成
   * `<插件目录>/node`，服务永远起不来（批次48 漫画预览服务踩出来的）。
   */
  function resolveCommand(entry, value) {
    const raw = String(value ?? '')
    if (!raw || (!raw.includes('/') && !raw.includes('\\'))) return raw || null
    return resolveAgainstPlugin(entry, raw)
  }

  function spawnService(entry) {
    return new Promise((resolvePromise) => {
      const command = resolveCommand(entry, entry.command)
      const cwd = resolveAgainstPlugin(entry, entry.cwd) ?? resolveAgainstPlugin(entry, '.') ?? process.cwd()
      const env = { ...baseEnv, ...(entry.env ?? {}) }
      if (entry.port && !env.PORT) env.PORT = String(entry.port)
      if (entry.port && !env.PINAX_SERVICE_PORT) env.PINAX_SERVICE_PORT = String(entry.port)
      if (entry.pluginId && !env.PINAX_PLUGIN_ID) env.PINAX_PLUGIN_ID = String(entry.pluginId)
      const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/iu.test(command)

      let child
      try {
        child = spawnImpl(command, entry.args ?? [], {
          cwd,
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          ...(needsShell ? { shell: true } : {})
        })
      } catch (error) {
        entry.status = SERVICE_STATUS.FAILED
        entry.error = `起不来：${String(error?.message || error)}`
        emit('service-failed', entry)
        resolvePromise(false)
        return
      }

      entry.child = child
      entry.pid = typeof child.pid === 'number' ? child.pid : null
      child.stdout?.setEncoding?.('utf8')
      child.stderr?.setEncoding?.('utf8')
      child.stdout?.on('data', (chunk) => pushLog(entry, 'out', chunk))
      child.stderr?.on('data', (chunk) => pushLog(entry, 'err', chunk))
      child.on('error', (error) => {
        entry.error = String(error?.message || error)
        emit('service-error', entry)
      })
      child.on('exit', (code, signal) => {
        entry.exitCode = typeof code === 'number' ? code : null
        entry.signal = signal ?? null
        entry.child = null
        entry.pid = null
        if (stopping || entry.status === SERVICE_STATUS.STOPPING) {
          entry.status = SERVICE_STATUS.STOPPED
          emit('service-stopped', entry)
          return
        }
        entry.status = SERVICE_STATUS.CRASHED
        entry.error = `进程退出（code=${code} signal=${signal ?? 'null'}）`
        emit('service-crashed', entry)
        if (entry.restart === 'on-failure' && entry.restarts < MAX_RESTARTS) {
          entry.restarts += 1
          const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** (entry.restarts - 1))
          entry.timer = setTimeout(() => {
            entry.timer = null
            if (!stopping) void launch(entry)
          }, delay)
          entry.timer.unref?.()
        } else {
          entry.status = SERVICE_STATUS.FAILED
          entry.error = entry.restart === 'on-failure'
            ? `反复崩溃，重启 ${entry.restarts} 次后放弃：${entry.error ?? ''}`
            : entry.error
          emit('service-failed', entry)
        }
      })
      resolvePromise(true)
    })
  }

  async function launch(entry) {
    if (stopping) return false
    // adopt（批次52）：外部进程已经不归宿主，这里只探活与记账——绝不 spawn，也绝不重试拉起。
    if (entry.adopt) {
      entry.status = SERVICE_STATUS.STARTING
      entry.error = null
      entry.startedAt = new Date().toISOString()
      emit('service-starting', entry)
      if (!entry.port) {
        entry.status = SERVICE_STATUS.FAILED
        entry.error = 'adopt 服务必须声明 port：宿主只有端口可探，没有进程可看'
        emit('service-failed', entry)
        return false
      }
      const external = await waitHealthy(entry)
      if (external) {
        entry.status = SERVICE_STATUS.READY
        emit('service-ready', entry)
        return true
      }
      entry.status = SERVICE_STATUS.UNHEALTHY
      entry.error = `外部服务端口 ${entry.port} 在 ${healthTimeoutMs}ms 内没有应答（进程不归宿主，无法重启）`
      emit('service-unhealthy', entry)
      return false
    }
    entry.status = SERVICE_STATUS.STARTING
    entry.error = null
    entry.startedAt = new Date().toISOString()
    emit('service-starting', entry)
    const spawned = await spawnService(entry)
    if (!spawned) return false
    if (!entry.port) {
      // 没有端口＝没有健康探针：进程活着就算就绪（不猜它内部准备好了没有）。
      entry.status = SERVICE_STATUS.READY
      entry.health = null
      emit('service-ready', entry)
      return true
    }
    const healthy = await waitHealthy(entry)
    if (healthy) {
      entry.status = SERVICE_STATUS.READY
      emit('service-ready', entry)
      return true
    }
    // 探不通不等于进程该死：服务可能只是慢热。留着进程、如实标 unhealthy，
    // 让作者看得见 pid 与日志；真要收它由 stop()／手动重启走同一条路。
    entry.status = SERVICE_STATUS.UNHEALTHY
    entry.error = `端口 ${entry.port} 在 ${healthTimeoutMs}ms 内没有应答`
    emit('service-unhealthy', entry)
    return false
  }

  async function waitHealthy(entry) {
    const deadline = Date.now() + healthTimeoutMs
    while (Date.now() < deadline) {
      if (stopping) return false
      // adopt 没有子进程可盯：判据只有端口应答，不能因为 entry.child 为空就提前判死。
      if (!entry.adopt && !entry.child) return false
      const answer = await probe({ port: entry.port, path: entry.healthPath ?? '/', timeoutMs: 2_000 })
      if (answer?.ok) {
        entry.health = { ok: true, statusCode: answer.statusCode ?? null, checkedAt: new Date().toISOString() }
        return true
      }
      // 批次51 后的跨平台教训：这里的等待必须是 ref'd 且可被 stopping 打断的——
      // unref 定时器不撑事件循环，Node 22 的 test runner 会在 drain 时把「Promise 未落定」
      // 记成测试取消（win32 上 refused 快所以看不出来，CI 的 ubuntu/Node22 上必现）。
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, healthIntervalMs)
      })
      if (stopping) return false
    }
    entry.health = { ok: false, statusCode: null, checkedAt: new Date().toISOString(), error: '超时' }
    return false
  }

  async function killChild(entry) {
    const child = entry.child
    if (!child) return
    entry.status = SERVICE_STATUS.STOPPING
    emit('service-stopping', entry)
    try {
      child.kill('SIGTERM')
    } catch {
      // 已经死了就没得杀。
    }
    const exited = await waitExit(child, KILL_GRACE_MS)
    if (!exited) {
      try {
        child.kill('SIGKILL')
      } catch {
        // 同上。
      }
      await waitExit(child, 1_000)
    }
  }

  for (const spec of specs) {
    const id = String(spec?.id ?? spec?.pluginId ?? 'service')
    if (entries.has(id)) continue
    // 合并序＝清单默认→覆盖；只改值，不碰 adopt／command／env／restart 这些结构字段。
    const applied = applyServiceOverride(spec, serviceOverrideFor(overrideState.overrides, String(spec?.pluginId ?? ''), id))
    const resolved = applied.spec
    const adopt = resolved?.adopt === true
    const entry = {
      id,
      pluginId: String(resolved?.pluginId ?? ''),
      adopt,
      command: adopt ? null : String(resolved?.command ?? ''),
      args: adopt || !Array.isArray(resolved?.args) ? [] : resolved.args.map(String),
      env: adopt || !resolved?.env || typeof resolved.env !== 'object' ? {} : { ...resolved.env },
      cwd: adopt || !resolved?.cwd ? null : String(resolved.cwd),
      dir: resolved?.dir ? String(resolved.dir) : null,
      port: Number.isSafeInteger(resolved?.port) ? resolved.port : null,
      healthPath: resolved?.healthPath ? String(resolved.healthPath) : null,
      portSource: applied.hits.some((hit) => hit.field === 'port') ? 'override' : 'manifest',
      overrideFields: applied.hits.map((hit) => hit.field),
      // adopt 的进程不在宿主手里：没有可重启的东西，重试只会白白探一个外部端口。
      restart: adopt || resolved?.restart === 'never' ? 'never' : 'on-failure',
      autostart: resolved?.autostart !== false,
      status: SERVICE_STATUS.STOPPED,
      pid: null,
      restarts: 0,
      exitCode: null,
      signal: null,
      error: null,
      health: null,
      startedAt: null,
      logs: [],
      child: null,
      timer: null
    }
    entries.set(id, entry)
    appendOverrideNote(entry, applied)
  }

  return {
    /** 起服务：只起 autostart 的；每个独立成败，失败不牵连别的。 */
    async start() {
      const started = []
      const failed = []
      for (const entry of entries.values()) {
        if (!entry.autostart) continue
        const okLaunch = await launch(entry)
        if (okLaunch) started.push(entry.id)
        else failed.push({ id: entry.id, pluginId: entry.pluginId, error: entry.error })
      }
      return ok({ started, failed })
    },

    /** 收尸：清掉重启定时器、杀掉全部子进程。关项目与退出都走这一条。 */
    async stop() {
      stopping = true
      for (const entry of entries.values()) {
        if (entry.timer) {
          clearTimeout(entry.timer)
          entry.timer = null
        }
      }
      await Promise.all([...entries.values()].map((entry) => killChild(entry)))
      for (const entry of entries.values()) {
        entry.status = SERVICE_STATUS.STOPPED
        entry.child = null
        entry.pid = null
        emit('service-stopped', entry)
      }
      stopping = false
      return ok({ stopped: true })
    },

    /** 手动重启一颗（界面上的「重启服务」按钮走这里）。 */
    async restart(id) {
      const entry = entries.get(String(id))
      if (!entry) return fail('INVALID_INPUT', `没有这个服务：${id}`)
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
      }
      await killChild(entry)
      entry.restarts = 0
      const launched = await launch(entry)
      return launched ? ok({ id: entry.id, status: entry.status }) : fail('IO_FAILED', `服务 ${entry.id} 重启失败：${entry.error ?? '未知原因'}`)
    },

    /** 全量状态（右栏与 IPC 读这一份）。 */
    status() {
      return [...entries.values()].map(publicStatus)
    },

    /** 带日志尾巴的完整状态（排障用；IPC 的「看日志」通道读它）。 */
    detail(id) {
      const entry = entries.get(String(id))
      if (!entry) return null
      return { ...publicStatus(entry), logs: entry.logs.slice() }
    },

    list() {
      return [...entries.values()].map(publicStatus)
    }
  }
}

/** 默认健康探针：任何 HTTP 应答都算「在听」（只判端口通不通，不猜业务语义）。 */
export function defaultProbeHealth({ port, path = '/', timeoutMs = 2_000 } = {}) {
  return new Promise((resolvePromise) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', timeout: timeoutMs },
      (res) => {
        res.resume()
        resolvePromise({ ok: true, statusCode: res.statusCode })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolvePromise({ ok: false, error: '超时' })
    })
    req.on('error', (error) => resolvePromise({ ok: false, error: String(error?.message || error) }))
    req.end()
  })
}

function waitExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs)
    timer.unref?.()
    child.once('exit', () => {
      clearTimeout(timer)
      resolvePromise(true)
    })
  })
}
