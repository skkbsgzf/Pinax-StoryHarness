import { SERVICE_LOG_LEVELS, SERVICE_LOG_LIST_MAX } from './serviceLogPool.mjs'

/**
 * 服务日志读取工具（批次49）。
 *
 * 与 pinax_skill_read 同一条原生登记路线（skillTools.mjs）：不经 server/mcp 的内核清单，
 * 由运行时自己的 nativeMap 挂进聚合面，归属写 `kernel.runtime.services`。
 * 数据源是 serviceLogPool——监督器事件与外部 MCP 连接事件都记在那一份里；
 * 这把工具只读，不提供写／重启：重启是作者在设置页「服务与通知」里的手动动作。
 */
export const SERVICE_LOG_LIST_TOOL = 'pinax_service_log_list'

export const SERVICE_LOG_LIST_DESCRIPTOR = Object.freeze({
  name: SERVICE_LOG_LIST_TOOL,
  title: '查看服务日志',
  description: '查服务与外部 MCP 的运行日志、告警与待确认通知',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: { type: 'string', maxLength: 120, description: '按来源过滤：服务或外部 MCP 的 id（如 comic-preview、comfy）' },
      level: { type: 'string', enum: [...SERVICE_LOG_LEVELS], description: '按级别过滤：info／warn／error／confirm' },
      limit: { type: 'integer', minimum: 1, maximum: SERVICE_LOG_LIST_MAX, description: '最多返回多少条（默认 50，上限 200）' }
    }
  },
  annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true })
})

/**
 * @param {{ pool?: object|null }} [input] 公共池（可为 null：没有服务时如实回空数组，不编日志）
 * @returns {Map<string, { pluginId: string, tool: object }>} 与载体工具同形的 map，交给聚合面
 */
export function createServiceLogTools({ pool = null } = {}) {
  const map = new Map()
  map.set(SERVICE_LOG_LIST_TOOL, {
    pluginId: 'kernel.runtime.services',
    tool: {
      ...SERVICE_LOG_LIST_DESCRIPTOR,
      run(args = {}) {
        const filter = {}
        if (typeof args?.source === 'string' && args.source.trim()) filter.source = args.source.trim()
        if (typeof args?.level === 'string' && SERVICE_LOG_LEVELS.includes(args.level)) filter.level = args.level
        if (Number.isSafeInteger(args?.limit)) filter.limit = args.limit
        const entries = pool && typeof pool.list === 'function' ? pool.list(filter) : []
        return { ok: true, value: { entries } }
      }
    }
  })
  return map
}
