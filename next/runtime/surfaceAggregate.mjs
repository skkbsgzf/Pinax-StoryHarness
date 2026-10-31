import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { tools as kernelTools } from '../../server/mcp/createMcpServer.js'
import { connectInProcess } from './transportInProcess.mjs'

/**
 * 工具面聚合（M2 · WP6）。
 * 规则只有三条，全部可断言：
 *   1) 面＝内核 19 工具 ∪ 启用载体声明的工具，同名去重（载体接管，描述以载体清单为准）；
 *   2) 载体声明但没给实现的内核同名工具 → 原样回落内核实现，工具面不因载体开关而少一个名字；
 *      声明了、内核里也没有、载体又不实现的 → 不进面，只进 missingImplementations 记账；
 *   3) 内核那一份的入参校验与 typed error 一个字都不复制：聚合面通过一条进程内链路把未知于载体的
 *      调用原样转给内核 MCP 服务，因此 validateToolArguments / ERR_* 语义与今天完全一致；
 *   4) 但对「内核自己声明会写盘」的那几把（annotations.readOnlyHint === false），转出去之前先过
 *      kernelWriteGuard（M2 批次 2）：只认当前项目根、认领过的目录写只走认领者、结构动作与 sync 不放行。
 *      拒的载荷用载体同款失败信封，界面与测试两侧读法不变。
 * 全程 in-process，不开端口。
 */
const KERNEL_TOOL_NAMES = new Set(kernelTools.map((tool) => tool.name))

/** 从启用集合里收载体工具。view 为空（项目没打开）→ 空面，只剩内核 19 工具。 */
export function collectCarrierTools({ registry, view, fileService } = {}) {
  const map = new Map()
  const missing = []
  const enabled = view && Array.isArray(view.enabled) ? view.enabled : []
  for (const pluginId of enabled) {
    const manifest = registry?.get?.(pluginId)
    if (!manifest) continue
    const impl = registry?.impl?.(pluginId)
    const provided = typeof impl?.tools === 'function'
      ? impl.tools({ pluginId, manifest, fileService, root: fileService?.root ?? null, view, registry })
      : []
    const byName = new Map((provided ?? []).filter((tool) => tool && typeof tool.name === 'string').map((tool) => [tool.name, tool]))
    for (const name of manifest.tools) {
      const tool = byName.get(name)
      if (tool) {
        map.set(name, { pluginId, tool })
        continue
      }
      const fallsBack = KERNEL_TOOL_NAMES.has(name)
      if (!fallsBack) missing.push({ pluginId, name, fallbackToKernel: false })
      else missing.push({ pluginId, name, fallbackToKernel: true })
    }
  }
  return { map, missing }
}

/**
 * 起一个聚合 MCP 服务。返回的 server 就是 connectInProcess 的入参；
 * 内部那条到内核的进程内链路随 server.close() 一起收。
 *
 * 协议 v3 的外部 MCP（`externalClients`）：每台客户端自带 prefix，工具以 `<prefix>.<name>` 进面；
 * 列举每次现取（重连后工具面会变），调用按前缀路由，远端返回的 content[] 原样透传。
 */
export async function createAggregatedMcpServer({
  kernelServer,
  carrierMap = new Map(),
  nativeMap = new Map(),
  externalClients = [],
  name = 'pinax-runtime',
  version = '0.2.0',
  instructions = '',
  advisorBaseUrl,
  guard = null
} = {}) {
  const inner = await connectInProcess(kernelServer, { clientName: `${name}-internal` })
  const server = new Server({ name, version }, { capabilities: { tools: {} }, ...(instructions ? { instructions } : {}) })

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const kernel = await inner.listTools()
    const merged = new Map(kernel.map((tool) => [tool.name, tool]))
    for (const [toolName, { tool }] of carrierMap) {
      merged.set(toolName, publicDescriptor(toolName, tool))
    }
    // 运行时原生工具（M2.5-B：技能读取）：与载体工具同一个出口，但归运行时自己。
    for (const [toolName, { tool }] of nativeMap) {
      merged.set(toolName, publicDescriptor(toolName, tool))
    }
    // 外部 MCP：每次现取（重连会换面），连不上的那台只贡献零个名字，不阻断整面。
    for (const client of externalClients) {
      for (const tool of client.listTools()) {
        const exposed = `${client.prefix}.${tool.name}`
        merged.set(exposed, publicDescriptor(exposed, tool))
      }
    }
    return { tools: [...merged.values()] }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = String(request.params?.name ?? '')
    // 外部工具先按前缀路由：prefix 前缀在安装期已仲裁，不会与本地工具名混淆。
    const external = externalClients.find((client) => toolName.startsWith(`${client.prefix}.`))
    if (external) {
      const remote = toolName.slice(external.prefix.length + 1)
      const result = await external.callTool(remote, request.params?.arguments ?? {})
      if (result?.raw) return result.raw
      return textResult(result?.payload ?? { ok: false, message: '外部 MCP 无返回' }, result?.ok === false)
    }
    const entry = carrierMap.get(toolName) ?? nativeMap.get(toolName)
    if (entry) {
      const result = await entry.tool.run(request.params?.arguments ?? {}, { pluginId: entry.pluginId, advisorBaseUrl })
      return toMcpResult(result)
    }
    if (!KERNEL_TOOL_NAMES.has(toolName)) {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${toolName || '(空)'} not found`)
    }
    // 内核兜底的那一支先过写族闸：闸给的是新 args（可能注入了当前项目根），拒的原样变成失败信封。
    let forwarded = request.params?.arguments ?? {}
    if (typeof guard === 'function') {
      const checked = guard(toolName, forwarded)
      if (!checked?.ok) return toMcpResult(checked ?? { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `写族闸对 ${toolName} 的判定不是结果对象` } })
      forwarded = checked.value?.args ?? forwarded
    }
    try {
      const passed = await inner.callTool(toolName, forwarded)
      return passed.raw ?? textResult(passed.payload ?? {}, !passed.ok)
    } catch (error) {
      if (error instanceof McpError) throw error
      throw new McpError(ErrorCode.InternalError, String(error?.message || error))
    }
  })

  const closeInner = async () => {
    await inner.close().catch(() => {})
  }
  server.onclose = () => { void closeInner() }

  return { server, inner, carrierCount: carrierMap.size, closeInner }
}

function publicDescriptor(name, tool) {
  return {
    name,
    ...(tool.title ? { title: tool.title } : {}),
    description: String(tool.description ?? tool.title ?? name),
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    ...(tool.annotations ? { annotations: tool.annotations } : {})
  }
}

/** 载体工具的返回统一成内核同款的 MCP 文本结果，外壳与测试两侧读法一致。 */
function toMcpResult(result) {
  if (result && typeof result === 'object' && result.ok === true) {
    const value = result.value
    const payload = value && typeof value === 'object' && !Array.isArray(value) ? { ok: true, ...value } : { ok: true, result: value }
    return textResult(payload, false)
  }
  if (result && typeof result === 'object' && result.ok === false) {
    return textResult({
      ok: false,
      code: result.error?.code ?? 'PINAX_INVALID_INPUT',
      message: result.error?.message ?? '载体工具执行失败',
      details: result.error?.details ?? null
    }, true)
  }
  return textResult({ ok: true, result }, false)
}

function textResult(payload, isError) {
  const object = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
    ...(object ? { structuredContent: object } : {}),
    ...(isError ? { isError: true } : {})
  }
}
