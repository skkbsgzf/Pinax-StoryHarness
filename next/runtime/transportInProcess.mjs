import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

/**
 * in-process 出口（三出口的第一条：渲染进程 ← IPC → 主进程内这套链路，全程不开端口）。
 * 桩 1 实测：SDK 1.32.2 的 InMemoryTransport.createLinkedPair() 可用，19 工具全列出。
 *
 * 批次69（竞态根治）加的两件事，都在这一层做，因为它同时看得见「在途」与「关闭」：
 *   1. **drain**：close() 先等在途请求落定（带上限超时），落定了才关链路。SDK 的 `Protocol._onclose()`
 *      会给每个在途请求打回 `MCP error -32000: Connection closed`，那条拒绝沿着 await 链一路上抛，
 *      只要链顶有一个「没人 await 的 promise」就变成 Unhandled Rejection（并行全量跑时偶发红）。
 *   2. **拒绝必须有落点**：关闭期（closing/closed）落回来的拒绝一律转成失败信封 `{ok:false, payload:{ok:false, code, message}}`
 *      ——这不是吞：原文进 `payload.message`、码进 `payload.code`、每一笔都记进 `stats().converted`，
 *      并由 `agentRuntime.stop()` → `session.close()` 逐级带回，外壳把它写进「服务与通知」池。
 *      非关闭期的错误照旧抛出（协议语义一字未改）。
 */

/**
 * drain 缺省上限（工单的记账指标，选择依据）：
 *   · 这条链上的在途请求全是**本地**调用（载体工具＝读盘/写盘，内核兜底＝同一进程函数），
 *     实测单工具在毫秒级；给 2 秒足够覆盖「满载机器上的一次真磁盘往返」（carrier-pane-real 的 settle 轮询同量级）。
 *   · 上限不能大：close() 在换项目与关窗两条路上都会被 await，2 秒已经是「关一个项目最多卡两拍」的量级，
 *     再长就是把作者等窗口的时间花在一条注定失败的请求上。
 *   · 超时不是失败而是**记账**：`forced>0` 会进报告，运行时与外壳都能读到，不静默放行。
 */
export const DEFAULT_DRAIN_TIMEOUT_MS = 2000
/** drain 轮询粒度：太小会让空转吃 CPU，太大则在请求早已落定时多等（25ms ≈ 一帧）。 */
export const DRAIN_POLL_MS = 25

export const TRANSPORT_CLOSED_CODE = 'PINAX_MCP_TRANSPORT_CLOSED'
export const TRANSPORT_CLOSING_CODE = 'PINAX_MCP_TRANSPORT_CLOSING'

function messageOf(error) {
  return String(error?.message ?? error ?? '(未知错误)')
}

/** SDK 关闭时打回的那一支：`McpError` 的 code 是 -32000，消息是 "MCP error -32000: Connection closed"。 */
export function isConnectionClosedError(error) {
  if (Number(error?.code) === -32000) return true
  return /connection\s+closed/iu.test(messageOf(error))
}

/** 失败信封：形状与 `normalizeToolResult` 给 `isError` 的那一份同构，消费端（useBoardData.tool）本来就读 payload.ok===false。 */
function failureEnvelope(code, message) {
  return {
    ok: false,
    payload: { ok: false, code, message },
    structured: null,
    raw: null,
    transport: { code, message }
  }
}

function delay(ms) {
  return new Promise((resolveTick) => {
    const timer = setTimeout(resolveTick, ms)
    // 浏览器/jsdom 形态的 setTimeout 返回数字，没有 unref；node 形态别把事件循环钉住。
    timer?.unref?.()
  })
}

export async function connectInProcess(server, { clientName = 'pinax-next-shell', clientVersion = '1.0.0', drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS } = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: clientName, version: clientVersion }, { capabilities: {} })
  await client.connect(clientTransport)

  const budgetMs = Number.isFinite(drainTimeoutMs) && drainTimeoutMs >= 0 ? drainTimeoutMs : DEFAULT_DRAIN_TIMEOUT_MS
  /** 在途请求表：每条是 { label, promise }，promise 落定即摘——drain 等的就是这张表。 */
  const inflight = new Set()
  const account = {
    calls: 0,
    converted: [],
    closeErrors: [],
    drainTimeouts: 0,
    rejectedWhileClosing: 0
  }
  const closeReports = []
  let closing = false
  let closed = false

  /**
   * 一次「可被 drain 看见」的调用。
   * 关键约束：这张表里必须存**调用方正在 await 的那条 promise 的同一落定周期**，否则 drain 会提前收工。
   */
  async function tracked(label, run) {
    if (closing || closed) {
      account.rejectedWhileClosing += 1
      account.converted.push({ label, code: TRANSPORT_CLOSING_CODE, message: `链路已在关闭（drain 之后不再接新调用）：${label}` })
      return failureEnvelope(TRANSPORT_CLOSING_CODE, `进程内 MCP 链路已在关闭中，${label} 没有进入调用（批次69 drain）。`)
    }
    account.calls += 1
    const entry = { label, promise: null }
    entry.promise = Promise.resolve().then(run).then(
      (value) => {
        inflight.delete(entry)
        return value
      },
      (error) => {
        inflight.delete(entry)
        throw error
      }
    )
    inflight.add(entry)
    try {
      return await entry.promise
    } catch (error) {
      const closedByTeardown = isConnectionClosedError(error) || closing || closed
      if (!closedByTeardown) throw error
      const code = isConnectionClosedError(error) ? TRANSPORT_CLOSED_CODE : TRANSPORT_CLOSING_CODE
      const message = `进程内 MCP 调用 ${label} 在链路关闭时被 SDK 打回：${messageOf(error)}`
      account.converted.push({ label, code, message })
      return failureEnvelope(code, message)
    }
  }

  /** 等在途请求落定，最多等 limitMs；返回实际等待毫秒数。表空了就立刻返回。 */
  async function drain(limitMs = budgetMs) {
    const startedAt = Date.now()
    while (inflight.size) {
      const remaining = limitMs - (Date.now() - startedAt)
      if (remaining <= 0) break
      // allSettled 自带两侧处理器，这里不需要再补 catch——补了就是把拒绝原因抹掉。
      const settled = Promise.allSettled([...inflight].map((entry) => entry.promise))
      await Promise.race([settled, delay(Math.min(remaining, DRAIN_POLL_MS))])
    }
    return Date.now() - startedAt
  }

  return {
    client,

    async listTools() {
      const tools = await tracked('listTools', async () => {
        const response = await client.listTools()
        return response?.tools ?? []
      })
      // 关闭期的失败信封在这一面退成空数组，但已经记进 account.converted（stats() 读得到）。
      return Array.isArray(tools) ? tools : []
    },

    async callTool(name, args = {}) {
      return tracked(`callTool(${name})`, async () => {
        const response = await client.callTool({ name, arguments: args })
        return normalizeToolResult(response)
      })
    },

    /** 在途请求数（门禁与回归测试读这一格，不靠猜）。 */
    inFlightCount() {
      return inflight.size
    },

    stats() {
      return {
        calls: account.calls,
        pending: inflight.size,
        converted: account.converted.map((item) => ({ ...item })),
        closeErrors: [...account.closeErrors],
        drainTimeouts: account.drainTimeouts,
        rejectedWhileClosing: account.rejectedWhileClosing,
        closing,
        closed
      }
    },

    /** 每次 close() 的报告（含 drain 实测等待与 forced 计数）——外壳与测试的唯一读数面。 */
    closeReports: () => closeReports.map((report) => ({ ...report })),

    /**
     * 关闭链路：先 drain（带上限超时）→ 标记 closing → 关 client → 关 server。
     * 本函数**不抛**：任何一段的失败都进 report.errors（并由 agentRuntime 写进公共池），
     * 因为调用方是换项目/关窗这两条清理路，在那里抛错只会制造新的没人接的 promise。
     */
    async close(options = {}) {
      const override = options?.drainTimeoutMs
      const budget = Number.isFinite(override) && override >= 0 ? override : budgetMs
      const report = {
        link: clientName,
        alreadyClosed: closed,
        pendingAtClose: inflight.size,
        waitedMs: 0,
        forced: 0,
        convertedDuringClose: 0,
        errors: []
      }
      if (closed) return report
      const convertedBefore = account.converted.length
      report.waitedMs = await drain(budget)
      closing = true
      if (inflight.size) {
        report.forced = inflight.size
        report.forcedLabels = [...inflight].map((entry) => entry.label)
        account.drainTimeouts += inflight.size
        report.errors.push(`drain 超时：仍有 ${inflight.size} 条在途请求被硬关（${report.forcedLabels.join('、')}）`)
      }
      try {
        await client.close()
      } catch (error) {
        const line = `client.close() 失败：${messageOf(error)}`
        report.errors.push(line)
        account.closeErrors.push(line)
      }
      try {
        await server.close()
      } catch (error) {
        const line = `server.close() 失败：${messageOf(error)}`
        report.errors.push(line)
        account.closeErrors.push(line)
      }
      report.convertedDuringClose = account.converted.length - convertedBefore
      report.closed = true
      closed = true
      closeReports.push(report)
      return report
    }
  }
}

/** MCP 的返回体是 content[]；工具层统一把 JSON 文本还原成对象，方便外壳直接渲染。 */
export function normalizeToolResult(response) {
  const text = (response?.content ?? [])
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  return {
    ok: !response?.isError,
    payload: payload ?? { text },
    structured: response?.structuredContent ?? null,
    raw: response
  }
}
