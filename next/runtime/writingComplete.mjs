import { fail, ok } from '../kernel/errors.mjs'
import { buildWritingRequest, cleanWritingResult, validateWritingRequest } from '../shell/writingActions.mjs'
import { forwardComplete } from '../../server/services/kitModelGateway.js'

/**
 * 正文写作动作的主进程实现（批次41）。
 *
 * 为什么放在主进程而不是渲染层直接调模型：模型面只在内核侧（任务面端点、凭据、超时），
 * 渲染层拿不到也不该拿到。渲染层递上来的是「动作＋正文＋选区＋额外要求」，
 * 提示词只在这里由 writingActions 拼——所以这个通道不是一条通用模型管道。
 *
 * 与老前端的分工一致：老版写作页也是「界面收集选区 → 服务组提示词 → 模型面」，
 * 只是当年走的是浏览器内的 fetch。这里换成进程内注入的 complete，接口更窄。
 *
 * 旧轨依赖只出现在这一层（与 toolTurn 同一口径）：`server/services/kitModelGateway` 不进外壳源码，
 * next/shell 的「渲染侧依赖必须薄」门禁因此仍然成立。
 */
export function createWritingComplete({ complete = forwardComplete, timeoutMs = 90_000 } = {}) {
  if (typeof complete !== 'function') throw new TypeError('createWritingComplete 的 complete 必须是函数（默认 forwardComplete）')

  /**
   * @param {object} input { action, text, selection:{start,end}, instruction }
   * @returns {Promise<{ok:true, value:{action,text,model,usage}}|{ok:false,...}>}
   */
  async function run(input = {}) {
    const validated = validateWritingRequest(input)
    if (!validated.ok) return fail('INVALID_INPUT', validated.message, { action: input.action ?? null })
    const { action } = validated.value
    const payload = buildWritingRequest(validated.value)

    let answered
    try {
      answered = await complete(payload, { timeoutMs })
    } catch (error) {
      // 上游不可达／超时：如实摊开，不编一段文字冒充模型。
      return fail('IO_FAILED', `写作动作没有拿到模型回应：${String(error?.message || error)}`, {
        action: action.id,
        code: error?.code ?? null
      })
    }
    if (answered && typeof answered === 'object' && answered.ok === false) {
      return fail('IO_FAILED', `写作动作没有拿到模型回应：${String(answered.error?.message ?? answered.message ?? '上游失败')}`, {
        action: action.id,
        code: answered.error?.code ?? null
      })
    }
    const raw = typeof answered === 'string'
      ? answered
      : String(answered?.content ?? answered?.text ?? '')
    const text = cleanWritingResult(raw)
    if (!text) {
      return fail('IO_FAILED', '模型没有返回正文（可能是上下文被截断或上游空补全），这次不往稿子里写任何字', {
        action: action.id,
        finishReason: answered?.finishReason ?? null
      })
    }
    return ok({
      action: action.id,
      target: action.target,
      text,
      model: answered?.model ?? null,
      usage: answered?.usage ?? null
    })
  }

  return { run }
}
