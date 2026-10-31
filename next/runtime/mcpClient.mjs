import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve as resolvePath } from 'node:path'
import { fail } from '../kernel/errors.mjs'
import { normalizeToolResult } from './transportInProcess.mjs'

/**
 * 外部 MCP 客户端（协议 v3 的 `mcp` 声明面）。
 * 一个插件可以带自己的 MCP 服务端：stdio 由这条链路起子进程，sse 连已有 HTTP 端点。
 * 三条边界：
 *   1) 连不上不拖垮运行时——每次连接都返回带状态的客户端对象，失败只进 failures 记账；
 *   2) 工具名按 `prefix.` 命名空间挂进聚合面，prefix 在安装期已由注册表仲裁，跨插件不会撞；
 *   3) 断线重连只重连、不改清单：重连成功后重新 listTools，聚合面下次列举自然看到新面。
 * 不在这里做权限判断：外部工具归声明它的插件，调用前由运行时用该插件的 scope 卡 agent:ask。
 */
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_TOOLS = 200
const REMOTE_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u
const MAX_BACKOFF_MS = 30_000

/** 暴露给聚合面的名字：`<prefix>.<remote>`，与本地工具的命名家族同一张表。 */
export function exposedToolName(prefix, remoteName) {
  return `${String(prefix ?? '')}.${String(remoteName ?? '')}`
}

export function prefixOfExposedName(exposed) {
  const name = String(exposed ?? '')
  const dot = name.indexOf('.')
  return dot > 0 ? name.slice(0, dot) : null
}

/**
 * 外部 MCP 声明的相对路径解析（协议 v3：解析基准＝插件自己的目录，与 services 同一口径）。
 * 三条规则：
 *   1) command 绝对路径原样；带分隔符的相对路径按插件目录解析；裸名（node／python）留给 PATH 去找；
 *   2) args 里指向插件目录内文件的相对路径解析成绝对路径（'mcp.mjs' → '<插件目录>/mcp.mjs'）；
 *   3) cwdResolved 落到插件目录：子进程的工作目录就是插件目录。
 * 没有插件目录（外置插件没登记）就原样返回——不猜基准，也不静默改写声明。
 */
export function resolveMcpSpec(spec = {}, pluginDir = null) {
  const dir = pluginDir ? String(pluginDir) : null
  if (!dir) return spec
  const resolved = { ...spec }
  const command = String(spec.command ?? '')
  if (command && !isAbsolute(command) && /[\\/]/u.test(command)) {
    resolved.command = resolvePath(dir, command)
  }
  if (Array.isArray(spec.args)) {
    resolved.args = spec.args.map((arg) => resolveArgAgainst(dir, String(arg)))
  }
  resolved.cwdResolved = dir
  return resolved
}

/** 参数里的相对路径：解析不出、或解析出插件目录之外，就原样留着（不替作者改语义）。 */
function resolveArgAgainst(dir, raw) {
  if (!raw || isAbsolute(raw) || raw.startsWith('-')) return raw
  const candidate = resolvePath(dir, raw)
  const inside = relative(dir, candidate)
  if (inside.startsWith('..') || isAbsolute(inside)) return raw
  return existsSync(candidate) ? candidate : raw
}

/**
 * 连一个外部 MCP 服务端。永不抛异常：失败时返回 status='failed' 的客户端对象，
 * 调用方（运行时）照常起面，只把这台服务记进 failures。
 */
export async function connectMcpServer(spec = {}, options = {}) {
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const emit = typeof options.onEvent === 'function' ? options.onEvent : null
  const reconnect = options.reconnect !== false
  const baseEnv = options.env ?? process.env

  const prefix = String(spec.prefix ?? spec.id ?? '')
  const state = {
    id: String(spec.id ?? prefix),
    pluginId: spec.pluginId ? String(spec.pluginId) : null,
    transport: String(spec.transport ?? ''),
    prefix,
    status: 'connecting',
    tools: [],
    skipped: [],
    error: null,
    reconnects: 0,
    stderrTail: [],
    pid: null,
    connectedAt: null,
    closed: false
  }
  let client = null
  let transport = null
  let closing = false
  let reconnectTimer = null
  let generation = 0

  function snapshot() {
    return {
      ...state,
      tools: state.tools.map((tool) => ({ name: tool.name, description: tool.description })),
      skipped: [...state.skipped],
      stderrTail: [...stderrTail]
    }
  }

  function publish() {
    if (!emit) return
    try {
      emit(snapshot())
    } catch {
      // 状态订阅方的错误不能把连接链路带坏。
    }
  }

  const stderrTail = []

  function attachStderr(instance) {
    const stream = instance?.stderr
    if (!stream || typeof stream.on !== 'function') return
    stream.setEncoding?.('utf8')
    stream.on('data', (chunk) => {
      // MCP 子进程的 stderr 是诊断输出：留最近 20 行进状态，不往主进程日志刷屏。
      for (const line of String(chunk).split(/\r?\n/u)) {
        if (!line.trim()) continue
        stderrTail.push(line.slice(0, 400))
      }
      while (stderrTail.length > 20) stderrTail.shift()
    })
  }

  function buildTransport() {
    if (state.transport === 'stdio') {
      const env = spec.env && Object.keys(spec.env).length ? { ...baseEnv, ...spec.env } : undefined
      const instance = new StdioClientTransport({
        command: spec.command,
        args: Array.isArray(spec.args) ? spec.args : [],
        ...(env ? { env } : {}),
        ...(spec.cwdResolved ? { cwd: spec.cwdResolved } : {}),
        stderr: 'pipe'
      })
      attachStderr(instance)
      return instance
    }
    if (state.transport === 'sse') return new SSEClientTransport(new URL(spec.url))
    throw new Error(`不支持的 MCP 传输方式：${state.transport}`)
  }

  function scheduleReconnect() {
    if (closing || !reconnect || reconnectTimer) return
    const attempt = state.reconnects
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 5))
    state.reconnects += 1
    state.status = 'reconnecting'
    publish()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void open().catch(() => {})
    }, delay)
    reconnectTimer.unref?.()
  }

  async function open() {
    generation += 1
    const mine = generation
    state.status = 'connecting'
    state.error = null
    publish()
    const nextClient = new Client({ name: `pinax-ext-${prefix}`, version: '1.0.0' }, { capabilities: {} })
    const nextTransport = buildTransport()
    nextTransport.onclose = () => {
      if (closing || mine !== generation) return
      state.status = 'closed'
      publish()
      scheduleReconnect()
    }
    nextTransport.onerror = (error) => {
      if (closing || mine !== generation) return
      state.error = String(error?.message ?? error)
      publish()
    }
    try {
      await nextClient.connect(nextTransport, { timeout: timeoutMs })
      const listed = await nextClient.listTools(undefined, { timeout: timeoutMs })
      const tools = []
      const skipped = []
      for (const tool of listed?.tools ?? []) {
        const name = String(tool?.name ?? '')
        if (!REMOTE_NAME_PATTERN.test(name)) {
          skipped.push({ name, reason: 'name-not-exposed' })
          continue
        }
        if (Array.isArray(spec.allow) && spec.allow.length && !spec.allow.includes(name)) continue
        if (tools.length >= MAX_TOOLS) {
          skipped.push({ name, reason: 'over-limit' })
          continue
        }
        tools.push({
          name,
          description: String(tool.description ?? tool.title ?? name),
          inputSchema: tool.inputSchema ?? { type: 'object', properties: {} }
        })
      }
      client = nextClient
      transport = nextTransport
      state.tools = tools
      state.skipped = skipped
      state.status = 'ready'
      state.connectedAt = new Date().toISOString()
      state.pid = typeof nextTransport.pid === 'number' ? nextTransport.pid : null
      publish()
    } catch (error) {
      // 连不上的传输自己也要收尸：SSE 的 EventSource 自带重试，放着不管会一直攥着定时器与套接字，
      // 让整个测试进程退不出去（也会在真机上留下幽灵连接）。
      await nextTransport.close().catch(() => {})
      state.status = 'failed'
      state.error = String(error?.message ?? error)
      publish()
      scheduleReconnect()
      throw error
    }
  }

  await open().catch(() => {})

  return {
    id: state.id,
    prefix,
    pluginId: state.pluginId,
    status: () => state.status,
    info: snapshot,
    /** 动态列举：重连后工具面会变，聚合面的 ListTools 每次现取，不缓存过期快照。 */
    listTools() {
      return state.tools.map((tool) => ({ ...tool }))
    },
    async callTool(remoteName, args = {}) {
      if (state.status !== 'ready' || !client) {
        return fail('IO_FAILED', `外部 MCP「${state.id}」当前不可用（${state.status}）`, {
          service: state.id, status: state.status, error: state.error
        })
      }
      try {
        const response = await client.callTool({ name: String(remoteName), arguments: args }, undefined, { timeout: timeoutMs })
        return normalizeToolResult(response)
      } catch (error) {
        return fail('IO_FAILED', `外部 MCP「${state.id}」调用 ${remoteName} 失败：${String(error?.message ?? error)}`, {
          service: state.id, tool: remoteName
        })
      }
    },
    async close() {
      closing = true
      generation += 1
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      state.status = 'closed'
      state.closed = true
      publish()
      const target = client
      const staleTransport = transport
      client = null
      transport = null
      if (target) await target.close().catch(() => {})
      else if (staleTransport) await staleTransport.close().catch(() => {})
    }
  }
}

/** 批量连接：每台独立成败，失败只记账，不影响其余。 */
export async function connectMcpServers(specs = [], options = {}) {
  const clients = []
  const failures = []
  for (const spec of Array.isArray(specs) ? specs : []) {
    const client = await connectMcpServer(spec, options)
    clients.push(client)
    if (client.status() !== 'ready') {
      failures.push({ id: client.id, prefix: client.prefix, status: client.status(), error: client.info().error })
    }
  }
  return { clients, failures }
}
