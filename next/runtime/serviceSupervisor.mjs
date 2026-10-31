import { spawn } from 'node:child_process'
import http from 'node:http'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'

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
    pid: entry.pid,
    port: entry.port,
    restarts: entry.restarts,
    exitCode: entry.exitCode,
    error: entry.error,
    health: entry.health ? { ...entry.health } : null,
    startedAt: entry.startedAt,
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
    case 'service-starting': return `${name}启动中`
    case 'service-ready': return entry.port ? `${name}就绪（端口 ${entry.port}）` : `${name}就绪`
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
      if (!entry.child) return false
      const answer = await probe({ port: entry.port, path: entry.healthPath ?? '/', timeoutMs: 2_000 })
      if (answer?.ok) {
        entry.health = { ok: true, statusCode: answer.statusCode ?? null, checkedAt: new Date().toISOString() }
        return true
      }
      await delay(healthIntervalMs)
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
    entries.set(id, {
      id,
      pluginId: String(spec?.pluginId ?? ''),
      command: String(spec?.command ?? ''),
      args: Array.isArray(spec?.args) ? spec.args.map(String) : [],
      env: spec?.env && typeof spec.env === 'object' ? { ...spec.env } : {},
      cwd: spec?.cwd ? String(spec.cwd) : null,
      dir: spec?.dir ? String(spec.dir) : null,
      port: Number.isSafeInteger(spec?.port) ? spec.port : null,
      healthPath: spec?.healthPath ? String(spec.healthPath) : null,
      restart: spec?.restart === 'never' ? 'never' : 'on-failure',
      autostart: spec?.autostart !== false,
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
    })
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

function delay(ms) {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, ms)
    timer.unref?.()
  })
}
