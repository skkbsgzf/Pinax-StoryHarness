import { forwardComplete } from '../../server/services/kitModelGateway.js'

/**
 * 模型回合适配（M2.5-A 任务五）。
 *
 * 复用的是**传输层**，不是 generation 回合的校验层：
 *   - `runKitFunnelProviderTurn`（kitModelGateway.js:159）本身已经把 tools 透传给
 *     `/v1/pinax/complete`、把 toolCalls 翻译回来，但它前面的
 *     `validateGenerationAgentTurnRequest` 只认 `GENERATION_TOOL_NAMES`（叙事只读工具 +
 *     节拍规划 + web_search）——`GENERATION_TOOL_NAMES` 是闭集，pinax_* 一把都进不去
 *     （shared/generationToolContract.js:9-15,160-173）。
 *   - 所以这里直接调 `forwardComplete(payload)`：与浏览器端 agent-step 发给任务面的是
 *     **同一个请求体形状**（messages / tools / toolChoice），只是校验归我们自己
 *     ——工具名取自运行时面、schema 取自 MCP inputSchema、数量由 selectTools 封在 6 把。
 *
 * 这是本批唯一一处旧线 import（只读调用，不改 server/**）。将来内化时把这一段搬进本文件，
 * 形状不变。
 */
export const TOOL_TURN_MAX_TOOLS = 6

function toGatewayMessage(message = {}) {
  const role = String(message.role ?? '')
  if (role === 'tool') {
    const part = Array.isArray(message.parts)
      ? message.parts.find((item) => item?.type === 'tool-result')
      : null
    return {
      role: 'tool',
      toolCallId: String(message.toolCallId ?? part?.toolCallId ?? ''),
      toolName: String(message.name ?? part?.toolName ?? ''),
      output: String(message.content ?? part?.output ?? ''),
      isError: Boolean(part?.isError)
    }
  }
  if (role === 'assistant') {
    const calls = (Array.isArray(message.parts) ? message.parts : [])
      .filter((part) => part?.type === 'tool-call')
      .map((part) => ({
        id: String(part.toolCallId ?? ''),
        name: String(part.toolName ?? ''),
        arguments: part.input && typeof part.input === 'object' ? part.input : {}
      }))
    return {
      role: 'assistant',
      content: String(message.content ?? ''),
      ...(calls.length ? { toolCalls: calls } : {})
    }
  }
  return { role: role || 'user', content: String(message.content ?? '') }
}

function toGatewayTool(tool) {
  const name = String(tool?.name ?? '')
  const schema = tool?.inputSchema && typeof tool.inputSchema === 'object'
    ? tool.inputSchema
    : { type: 'object', properties: {} }
  return {
    name,
    description: String(tool?.description ?? tool?.title ?? name),
    parameters: schema
  }
}

/**
 * @param {object} [input]
 * @param {Function} [input.complete] 默认 forwardComplete；测试注假函数
 * @param {number} [input.timeoutMs]
 * @param {number} [input.maxTools]
 */
export function createKitToolTurn({ complete = forwardComplete, timeoutMs = 100_000, maxTools = TOOL_TURN_MAX_TOOLS } = {}) {
  return async function kitToolTurn({ messages = [], tools = [], options = {} } = {}) {
    if (!Array.isArray(tools) || !tools.length) {
      throw Object.assign(new Error('工具回合至少要带一把工具'), { code: 'PINAX_TOOL_TURN_NO_TOOLS' })
    }
    const payload = {
      messages: messages.map(toGatewayMessage),
      tools: tools.slice(0, maxTools).map(toGatewayTool),
      toolChoice: options.toolChoice ?? 'auto',
      ...(Number.isFinite(Number(options.maxTokens)) ? { maxTokens: Number(options.maxTokens) } : {})
    }
    const result = await complete(payload, { timeoutMs })
    const calls = (Array.isArray(result?.toolCalls) ? result.toolCalls : []).map((call, index) => ({
      id: String(call?.id ?? `call_${index + 1}`),
      name: String(call?.name ?? ''),
      arguments: call?.arguments && typeof call.arguments === 'object' ? call.arguments : {}
    })).filter((call) => call.name)
    return {
      kind: calls.length ? 'tool_calls' : 'final_ready',
      calls,
      text: calls.length ? '' : String(result?.content ?? ''),
      finishReason: result?.finishReason ?? null
    }
  }
}
