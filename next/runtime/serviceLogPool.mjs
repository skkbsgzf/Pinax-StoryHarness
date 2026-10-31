/**
 * 服务与外部 MCP 的公共日志池（批次49）。
 *
 * 为什么要有这一份：监督器只留自己的环形尾巴（每服务最近 200 行 stdout/stderr），外部 MCP 客户端
 * 只在自己状态快照里留 stderrTail；两处都只活在各自实例里，竖条状态点、设置页「服务与通知」、
 * agent 的 pinax_service_log_list 都没有一个共同的读数面。这一池就是那个唯一权威视图——
 * 监督器事件与 MCP 连接事件都往这里记，读的人只读这里，不各扫各的实例。
 *
 * 形状（与工单一致）：
 *   - 按来源记账的环形池：每来源 200 条封顶，总 1000 条封顶；
 *   - 条目 { at, source: { kind: 'service' | 'mcp', id, carrierId }, level: 'info' | 'warn' | 'error' | 'confirm', message, data?, confirm? }
 *     `confirm:true` 表示这条需要作者「知道了」——监督器的「重试用尽」「健康检查反复失败」与
 *     外部 MCP 的「连接失败」会带它；确认状态只存应用级偏好（serviceNoticesAckedAt），不进项目 .pinax/。
 *
 * 四色语义（竖条状态点与设置页共用，别在界面里另写一套）：
 *   green  = 载体声明的服务／MCP 全部在跑，且最新健康检查 ok；
 *   orange = 该载体还有未确认的 confirm／warn 通知，或监督器正在退避重试（starting／crashed／reconnecting）；
 *   red    = 任一服务重试用尽／健康检查失败／起不来（failed／unhealthy），或外部 MCP 处于失败记账态（failed）；
 *   gray   = 声明了但没在跑（autostart:false 未启动／stopped／stopping／端口没开／closed）。
 *   没声明任何服务与外部 MCP 的载体不出行、不出点——novel／outline 这些创作者不需要灰点噪音。
 *
 * 读出口：list({ source?, level?, limit? })（按时间正序给最近 limit 条）、statusByCarrier()（每载体一行）、
 * snapshot()（一次给全，IPC／推送用）；写出口：append(entry)、acknowledge(upToAt)、
 * setDeclarations／setServiceStatuses／setMcpStatuses（运行时同步声明与实时状态）。
 * 每次变化都走 onChange 回调；界面不轮询。
 */
export const SERVICE_LOG_LEVELS = Object.freeze(['info', 'warn', 'error', 'confirm'])
export const SERVICE_LOG_SOURCE_KINDS = Object.freeze(['service', 'mcp'])
export const SERVICE_LOG_COLORS = Object.freeze(['green', 'orange', 'red', 'gray'])

export const SERVICE_LOG_SOURCE_LIMIT = 200
export const SERVICE_LOG_TOTAL_LIMIT = 1000
export const SERVICE_LOG_LIST_DEFAULT = 50
export const SERVICE_LOG_LIST_MAX = 200

const NOTICE_LEVELS = new Set(['warn', 'confirm'])

function normalizeTimestamp(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

function normalizeSource(source) {
  const raw = source && typeof source === 'object' ? source : {}
  const kind = SERVICE_LOG_SOURCE_KINDS.includes(raw.kind) ? raw.kind : 'service'
  return {
    kind,
    id: String(raw.id ?? raw.service ?? ''),
    carrierId: String(raw.carrierId ?? raw.pluginId ?? '')
  }
}

/** 条目规范化：未知级别按 info 收，不在池里留半截形状。 */
function normalizeEntry(entry, at) {
  const raw = entry && typeof entry === 'object' ? entry : {}
  const source = normalizeSource(raw.source)
  const level = SERVICE_LOG_LEVELS.includes(raw.level) ? raw.level : 'info'
  const record = {
    at: normalizeTimestamp(raw.at, at) ?? at,
    source,
    level,
    message: String(raw.message ?? '')
  }
  if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) record.data = { ...raw.data }
  if (raw.confirm === true) record.confirm = true
  return record
}

function sourceKey(source) {
  return `${source.kind}:${source.carrierId}:${source.id}`
}

function isNotice(record) {
  return record.confirm === true || NOTICE_LEVELS.has(record.level)
}

const SERVICE_COLOR_BY_STATUS = Object.freeze({
  ready: 'green',
  starting: 'orange',
  crashed: 'orange',
  unhealthy: 'red',
  failed: 'red',
  stopping: 'gray',
  stopped: 'gray'
})

const MCP_COLOR_BY_STATUS = Object.freeze({
  ready: 'green',
  connecting: 'orange',
  reconnecting: 'orange',
  failed: 'red',
  closed: 'gray'
})

const SERVICE_STATUS_TEXT = Object.freeze({
  ready: '运行中',
  starting: '启动中',
  crashed: '已崩溃（等待重试）',
  unhealthy: '健康检查未通过',
  failed: '失败',
  stopping: '停止中',
  stopped: '已停止'
})

const MCP_STATUS_TEXT = Object.freeze({
  ready: '已连接',
  connecting: '连接中',
  reconnecting: '重连中',
  failed: '连接失败',
  closed: '已断开'
})

function serviceColor(live) {
  if (!live) return 'gray'
  const status = String(live.status ?? 'stopped')
  const base = SERVICE_COLOR_BY_STATUS[status] ?? 'gray'
  // ready 还要看最新健康检查：探针明确报失败就是红，没探过（无端口）按就绪算。
  if (base === 'green' && live.health && live.health.ok === false) return 'red'
  return base
}

function mcpColor(live) {
  if (!live) return 'gray'
  return MCP_COLOR_BY_STATUS[String(live.status ?? 'closed')] ?? 'gray'
}

export function createServiceLogPool(options = {}) {
  const sourceLimit = Number.isSafeInteger(options.sourceLimit) && options.sourceLimit > 0 ? options.sourceLimit : SERVICE_LOG_SOURCE_LIMIT
  const totalLimit = Number.isSafeInteger(options.totalLimit) && options.totalLimit > 0 ? options.totalLimit : SERVICE_LOG_TOTAL_LIMIT
  const onChange = typeof options.onChange === 'function' ? options.onChange : null
  const onAckPersist = typeof options.onAckPersist === 'function' ? options.onAckPersist : null

  let ackedAt = normalizeTimestamp(options.ackAt, null)
  const entries = []
  const buckets = new Map()
  /** 声明：载体 → 它声明的服务／MCP 条目（由运行时在 start() 时同步）。 */
  const declarations = new Map()
  let serviceStatuses = new Map()
  let mcpStatuses = new Map()

  function notify() {
    if (!onChange) return
    try {
      onChange(snapshot())
    } catch {
      // 订阅方坏掉不影响记账本身。
    }
  }

  function append(entry) {
    const record = normalizeEntry(entry, new Date().toISOString())
    const key = sourceKey(record.source)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
    }
    bucket.push(record)
    entries.push(record)
    // 每来源封顶：被挤出桶的那条必须同时从总池里摘掉，否则 list() 会看到已出桶的旧条目。
    while (bucket.length > sourceLimit) {
      const evicted = bucket.shift()
      const index = entries.indexOf(evicted)
      if (index >= 0) entries.splice(index, 1)
    }
    while (entries.length > totalLimit) entries.shift()
    notify()
    return { ...record, source: { ...record.source } }
  }

  function matches(record, filter) {
    if (!filter || typeof filter !== 'object') return true
    if (filter.kind && record.source.kind !== String(filter.kind)) return false
    if (filter.carrierId && record.source.carrierId !== String(filter.carrierId)) return false
    // source 既接受来源 id 字符串，也接受 { kind?, id?, carrierId? }（面板页与工具都这么传）。
    const source = filter.source && typeof filter.source === 'object' ? filter.source : null
    if (source) {
      if (source.kind && record.source.kind !== String(source.kind)) return false
      if (source.carrierId && record.source.carrierId !== String(source.carrierId)) return false
      if (source.id && record.source.id !== String(source.id)) return false
    } else {
      const wanted = filter.source ?? filter.id
      if (wanted && record.source.id !== String(wanted)) return false
    }
    if (filter.level && record.level !== String(filter.level)) return false
    return true
  }

  /** 按时间正序返回最近的 limit 条（先过滤，再取尾部）。 */
  function list(filter = {}) {
    const rawLimit = Number.isSafeInteger(filter?.limit) ? filter.limit : SERVICE_LOG_LIST_DEFAULT
    const limit = Math.max(1, Math.min(rawLimit, SERVICE_LOG_LIST_MAX))
    const matched = entries.filter((record) => matches(record, filter))
    const tail = matched.slice(-limit)
    return tail.map((record) => ({
      ...record,
      source: { ...record.source },
      ...(record.data ? { data: { ...record.data } } : {})
    }))
  }

  function unackedNotices(carrierId) {
    return entries.filter((record) => record.source.carrierId === carrierId && isNotice(record) && (!ackedAt || record.at > ackedAt))
  }

  function liveFor(kind, id) {
    return kind === 'mcp' ? mcpStatuses.get(id) ?? null : serviceStatuses.get(id) ?? null
  }

  function logsFor(kind, carrierId, id) {
    return entries
      .filter((record) => record.source.kind === kind && record.source.carrierId === carrierId && record.source.id === id)
      .slice(-5)
      .map((record) => ({ at: record.at, level: record.level, message: record.message }))
  }

  /**
   * 每载体一行：声明的服务／MCP 逐条给状态、色、最近 5 条日志；行色取最高严重度。
   * 没声明的载体不出现（竖条据此不出点）。
   */
  function statusByCarrier() {
    const rows = []
    for (const [carrierId, declared] of declarations) {
      if (!declared.length) continue
      const items = declared.map((declaration) => {
        const live = liveFor(declaration.kind, declaration.id)
        const color = declaration.kind === 'mcp' ? mcpColor(live) : serviceColor(live)
        const statusText = declaration.kind === 'mcp'
          ? MCP_STATUS_TEXT[String(live?.status ?? 'closed')] ?? '未知'
          : SERVICE_STATUS_TEXT[String(live?.status ?? 'stopped')] ?? '未知'
        const logs = logsFor(declaration.kind, carrierId, declaration.id)
        return {
          kind: declaration.kind,
          id: declaration.id,
          title: declaration.title ?? declaration.id,
          port: Number.isSafeInteger(declaration.port) ? declaration.port : null,
          transport: declaration.transport ?? null,
          status: live?.status ?? null,
          statusText,
          color,
          message: live?.error ?? logs[logs.length - 1]?.message ?? '',
          logs
        }
      })
      const unacked = unackedNotices(carrierId)
      let color = 'green'
      if (items.some((item) => item.color === 'red')) color = 'red'
      else if (items.some((item) => item.color === 'orange') || unacked.length) color = 'orange'
      else if (items.some((item) => item.color !== 'green')) color = 'gray'
      rows.push({
        carrierId,
        carrierTitle: declared[0].carrierTitle ?? carrierId,
        color,
        unackedNotices: unacked.length,
        items
      })
    }
    return rows
  }

  function snapshot() {
    return {
      at: new Date().toISOString(),
      ackedAt,
      carriers: statusByCarrier(),
      entries: list({ limit: SERVICE_LOG_LIST_DEFAULT })
    }
  }

  /**
   * 确认：acknowledge(upToAt) 记一个时间戳＝「这一刻之前的通知都知道了」。
   * 只前进不后退；落盘归应用级偏好（onAckPersist），池里只留当前值。
   */
  function acknowledge(upToAt) {
    const at = normalizeTimestamp(upToAt, new Date().toISOString())
    if (!ackedAt || at > ackedAt) {
      ackedAt = at
      if (onAckPersist) {
        try {
          Promise.resolve(onAckPersist(at)).catch(() => {})
        } catch {
          // 偏好写盘失败不退回未确认状态：本次进程内已经按知道了算。
        }
      }
      notify()
    }
    return { ok: true, value: { ackedAt } }
  }

  function setDeclarations(list = []) {
    declarations.clear()
    for (const declaration of Array.isArray(list) ? list : []) {
      const carrierId = String(declaration?.carrierId ?? '')
      const id = String(declaration?.id ?? '')
      if (!carrierId || !id) continue
      const kind = SERVICE_LOG_SOURCE_KINDS.includes(declaration?.kind) ? declaration.kind : 'service'
      const bucket = declarations.get(carrierId) ?? []
      if (bucket.some((item) => item.kind === kind && item.id === id)) continue
      bucket.push({
        kind,
        id,
        carrierId,
        carrierTitle: String(declaration?.carrierTitle ?? carrierId),
        port: Number.isSafeInteger(declaration?.port) ? declaration.port : null,
        transport: declaration?.transport ? String(declaration.transport) : null,
        title: declaration?.title ? String(declaration.title) : id
      })
      declarations.set(carrierId, bucket)
    }
    notify()
  }

  function setServiceStatuses(statuses = []) {
    const next = new Map()
    for (const status of Array.isArray(statuses) ? statuses : []) {
      if (!status?.id) continue
      next.set(String(status.id), { ...status })
    }
    serviceStatuses = next
    notify()
  }

  function setMcpStatuses(statuses = []) {
    const next = new Map()
    for (const status of Array.isArray(statuses) ? statuses : []) {
      if (!status?.id) continue
      next.set(String(status.id), { ...status })
    }
    mcpStatuses = next
    notify()
  }

  function ackedAtValue() {
    return ackedAt
  }

  return {
    append,
    list,
    statusByCarrier,
    snapshot,
    acknowledge,
    setDeclarations,
    setServiceStatuses,
    setMcpStatuses,
    ackedAt: ackedAtValue,
    /** 测试／关项目用：清空条目与实时状态，但保留确认时间（确认是应用级的）。 */
    clear() {
      entries.length = 0
      buckets.clear()
      serviceStatuses = new Map()
      mcpStatuses = new Map()
      notify()
    }
  }
}
