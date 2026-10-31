/**
 * 工具循环（M2.5-A 任务四）。
 *
 * 这是「模型会连续做错、需要被纠正」的最小实现：一轮提问可以有多步，每步模型要么给最终回答，
 * 要么给一组工具调用；调用结果作为下一轮的输入喂回去，直到收工或用完步数。
 *
 * 与旧链的区别只有一条：旧链一次提问＝一次模型往返（server/services/advisorAgentRunner.js:43），
 * 这一层自己持有循环与工具执行；模型回合本身是现成的（toolTurn.mjs 薄包
 * runKitFunnelProviderTurn），不在这里造协议。
 *
 * 四条边界（都写进测试）：
 *   1) 依赖全部注入：turn / callTool / selectTools / policy。本模块不 import server/**，能脱离模型面单测。
 *   2) 策略决定「落不落」：deny 与 proposal 都按**工具结果**回给模型。拒绝按失败回会让模型换参数重试，
 *      产出好几份重复提案；提案按成功回，模型才知道「已经交出去了，等作者」。
 *   3) 一次坏调用不炸整轮：策略或执行抛错都转成 isError 工具结果继续；只有 turn 抛错才上抛。
 *   4) 步数用尽返回 step-budget 且 text 为空——不编一段总结冒充模型没说过的话。
 *
 * 批次50：执行前的策略判定与执行后的审计记账统一走拦截点链（toolInterceptors.mjs），
 * 本模块仍是唯一执行处。只给 policy 的老调用方自动包成一条写族闸链，行为与之前一致。
 */
import { createInterceptorChain, createWriteGuardInterceptor } from './toolInterceptors.mjs'

export const DEFAULT_MAX_STEPS = 8
export const DEFAULT_MAX_MESSAGES = 26

/** 事件是旁路：回调抛错只记一条 warning，绝不打断提问。 */
function safeEmitter(onEvent) {
  if (typeof onEvent !== 'function') return () => {}
  return (event) => {
    try {
      const returned = onEvent({ ...event })
      if (returned && typeof returned.then === 'function') returned.then(null, () => {})
    } catch {
      // 事件失败不改变提问结果；运行时的主 onEvent 自己会留痕。
    }
  }
}

function nameOf(tool) {
  if (typeof tool === 'string') return tool
  return typeof tool?.name === 'string' ? tool.name : ''
}

/** 工具结果转一段文本：优先 payload（MCP 归一后的对象），其次 value，最后整份结果。 */
export function serializeToolOutput(result) {
  const value = result && typeof result === 'object' && 'ok' in result && 'value' in result
    ? result.value
    : result
  let text
  if (typeof value === 'string') text = value
  else if (value && typeof value === 'object' && value.payload !== undefined) text = JSON.stringify(value.payload)
  else {
    try {
      text = JSON.stringify(value ?? null)
    } catch {
      text = String(value)
    }
  }
  return String(text ?? '')
}

function clampOutput(text, limit) {
  const cap = Number.isSafeInteger(limit) && limit > 0 ? limit : 7200
  if (text.length <= cap) return text
  const marker = '…（已截断）'
  return text.slice(0, Math.max(0, cap - marker.length)) + marker
}

function toolMessage(call, output, isError) {
  return {
    role: 'tool',
    content: output,
    toolCallId: call.id,
    name: call.name,
    parts: [{ type: 'tool-result', toolCallId: call.id, toolName: call.name, output, isError: Boolean(isError) }]
  }
}

/**
 * 消息预算：契约上限 28 条（shared/generationToolContract.js:21-30）。按「整轮」由新到旧保留，
 * 保住第一句提问；被丢轮次留下的孤儿 tool 消息一并去掉。
 */
function buildMessages(base, rounds, limit) {
  const kept = []
  let count = 1
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index]
    if (count + round.length > limit) break
    kept.unshift(round)
    count += round.length
  }
  const flat = [base, ...kept.flat()]
  while (flat.length > 1 && flat[1]?.role === 'tool') flat.splice(1, 1)
  return flat
}

export function createToolLoop({
  turn,
  callTool,
  selectTools = null,
  policy = null,
  interceptors = null,
  buildUserMessage = null,
  onEvent = null,
  maxSteps = DEFAULT_MAX_STEPS,
  maxMessages = DEFAULT_MAX_MESSAGES,
  maxToolResultChars = 7200
} = {}) {
  if (typeof turn !== 'function') throw new TypeError('createToolLoop 需要 turn')
  if (typeof callTool !== 'function') throw new TypeError('createToolLoop 需要 callTool')

  /**
   * 拦截点链的三种来源：现成链 / 拦截器数组 / 只有 policy 时自动包一条写族闸。
   * 链是每问现造的（policy 可能是工厂，写模式随问而变），但自动包装只在没有链时发生。
   */
  function chainFor(activePolicy) {
    if (interceptors && typeof interceptors.runBefore === 'function' && typeof interceptors.runAfter === 'function') {
      return interceptors
    }
    if (Array.isArray(interceptors)) {
      return interceptors.length ? createInterceptorChain({ interceptors }) : null
    }
    if (activePolicy && typeof activePolicy.beforeTool === 'function') {
      return createInterceptorChain({ interceptors: [createWriteGuardInterceptor({ policy: activePolicy })] })
    }
    return null
  }

  return {
    /**
     * @param {object} input
     * @param {string} input.question
     * @param {object|null} [input.envelope] 只读信封，交给 buildUserMessage
     * @param {Array<object|string>} [input.tools] 面上全部工具
     * @param {object|null} [input.skill] 命中技能的声明
     * @param {string} [input.writeMode] 写模式（policy 是工厂时按这一问现造）
     * @param {string} [input.runId]
     * @param {Function} [input.onEvent] 单次提问的事件口，优先于创建时的 onEvent
     */
    async run({ question = '', envelope = null, tools = [], skill = null, writeMode = null, runId = null, onEvent: perRunEvent = null } = {}) {
      const emit = safeEmitter(typeof perRunEvent === 'function' ? perRunEvent : onEvent)
      // policy 既可以是现成对象（单测），也可以是工厂（真实链：每一问的写模式不同，不能共用一份）。
      const activePolicy = typeof policy === 'function' ? policy({ writeMode }) : policy
      const chain = chainFor(activePolicy)
      const selected = typeof selectTools === 'function'
        ? selectTools({ tools, intent: question, skill })
        : { names: (Array.isArray(tools) ? tools : []).map(nameOf).filter(Boolean), tools, dropped: [] }
      const toolDefs = Array.isArray(selected?.tools) ? selected.tools : []
      const declared = new Set(toolDefs.map(nameOf).filter(Boolean))
      const dropped = Array.isArray(selected?.dropped) ? selected.dropped : []
      if (dropped.length) emit({ stage: 'tool-dropped', dropped, runId })

      const userText = typeof buildUserMessage === 'function'
        ? String(buildUserMessage({ question, envelope }) ?? '')
        : String(question ?? '')
      const base = { role: 'user', content: userText }
      const rounds = []
      const steps = []
      const callsLog = []

      for (let step = 1; step <= maxSteps; step += 1) {
        emit({ stage: 'step', step, tools: [...declared], runId })
        const response = await turn({ messages: buildMessages(base, rounds, maxMessages), tools: toolDefs, options: {}, writeMode, runId })
        const rawCalls = Array.isArray(response?.calls) ? response.calls : []
        const kind = response?.kind ?? (rawCalls.length ? 'tool_calls' : 'final_ready')
        if (kind !== 'tool_calls' || !rawCalls.length) {
          return { kind: 'final', text: String(response?.text ?? ''), steps, calls: callsLog, dropped }
        }

        const calls = []
        for (let index = 0; index < rawCalls.length; index += 1) {
          const call = rawCalls[index] ?? {}
          const name = String(call.name ?? '')
          const id = String(call.id ?? `call_${step}_${index + 1}`)
          const args = call.arguments && typeof call.arguments === 'object' ? call.arguments : {}
          if (!declared.has(name)) {
            // 没披露的工具不能执行，也没法给契约一条「未声明工具」的工具结果——如实记账后跳过。
            emit({ stage: 'tool-unknown', callId: id, name, runId })
            continue
          }
          calls.push({ id, name, arguments: args })
        }
        if (!calls.length) {
          return { kind: 'final', text: '', steps, calls: callsLog, dropped }
        }

        const assistant = {
          role: 'assistant',
          content: String(response?.text ?? ''),
          parts: [
            ...(String(response?.text ?? '') ? [{ type: 'text', text: String(response?.text ?? '') }] : []),
            ...calls.map((call) => ({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.arguments }))
          ]
        }

        const round = [assistant]
        for (const call of calls) {
          const started = Date.now()
          emit({ stage: 'tool-start', callId: call.id, name: call.name, runId })
          callsLog.push({ id: call.id, name: call.name })
          let output = ''
          let isError = false
          const ctx = { call, step, tools: toolDefs, writeMode, runId }
          try {
            const decided = chain
              ? await chain.runBefore(call.name, call.arguments, ctx)
              : { veto: false, args: call.arguments, guardDecision: null }
            const afterCtx = { ...ctx, guardDecision: decided?.guardDecision ?? null }
            if (decided?.veto) {
              if (decided.decision === 'proposal') {
                const proposal = decided.proposal ?? {}
                output = clampOutput(JSON.stringify({
                  ok: true,
                  proposalId: String(proposal.id ?? proposal.name ?? ''),
                  message: `已生成提案 ${proposal.id ?? proposal.name ?? ''}，等待作者采纳；不要重复调用同一把工具`
                }), maxToolResultChars)
                emit({
                  stage: 'proposal-created',
                  callId: call.id,
                  name: call.name,
                  proposalId: String(proposal.id ?? proposal.name ?? ''),
                  runId
                })
              } else {
                isError = true
                output = clampOutput(JSON.stringify({
                  ok: false,
                  code: String(decided.code ?? 'TOOL_DENIED'),
                  message: String(decided.reason ?? '这次调用被策略拒绝')
                }), maxToolResultChars)
                emit({ stage: 'tool-denied', callId: call.id, name: call.name, code: String(decided.code ?? 'TOOL_DENIED'), runId })
              }
            } else {
              try {
                const result = await callTool(call.name, decided?.args ?? call.arguments)
                output = clampOutput(serializeToolOutput(result), maxToolResultChars)
                isError = Boolean(result && typeof result === 'object' && result.ok === false)
                if (chain) await chain.runAfter(call.name, result, afterCtx)
              } catch (error) {
                // 执行失败也要过审计环：提交类工具「已发出但失败」同样要留痕。
                if (chain) await chain.runAfter(call.name, { ok: false, error: String(error?.message ?? error) }, afterCtx)
                throw error
              }
            }
          } catch (error) {
            isError = true
            output = clampOutput(JSON.stringify({
              ok: false,
              code: String(error?.code ?? 'TOOL_FAILED'),
              message: String(error?.message ?? error ?? '工具执行失败')
            }), maxToolResultChars)
          }
          emit({ stage: 'tool-end', callId: call.id, name: call.name, ok: !isError, ms: Date.now() - started, runId })
          round.push(toolMessage(call, output, isError))
        }
        rounds.push(round)
        steps.push({ step, calls: calls.map((call) => call.name) })
      }

      // 步数用尽：不编总结。上层如实告诉作者「这一步还没收敛」。
      return { kind: 'step-budget', text: '', steps, calls: callsLog, dropped }
    }
  }
}
