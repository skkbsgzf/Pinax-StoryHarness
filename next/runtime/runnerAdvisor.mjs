import { runAdvisorAgent } from '../../server/services/advisorAgentRunner.js'
import { createAdvisorTaskResponse } from '../../server/services/advisorTaskService.js'
import { collectAgentEnvelopeSourceRefs } from '../../shared/agentContextContract.js'
import { createModelRoundGuard } from '../../shared/modelLoopGuard.js'
import { fail } from '../kernel/errors.mjs'
import { buildRuntimeEnvelope } from './contextProfiles.mjs'

/**
 * 进程内 advisor 运行器（M2 · WP3 收口项）。
 * 与既有 MCP 轨的区别只有一条，但这条是结构性的：它不再 POST 回本机 3001 的 /api/advisor/task，
 * 而是在主进程里直接调用同一条链的最后两环（advisorAgentRunner → textModelAgentProvider → 内核任务面漏斗）。
 * 于是端口、Express、浏览器配置快照这些外壳都不参与，模型面不可达时作者看到的是那句真话：
 * 「未检测到可用模型。请先启动 pi-agent 任务面（serve:pinax）…」——运行时绝不自己编一段回答冒充模型。
 * 上下文信封由载体块构建器供给（见 contextProfiles.buildRuntimeEnvelope），任务号只认只读档。
 */
export const ADVISOR_RUNNER_SOURCE = 'in-process-advisor'
const DEFAULT_TIMEOUT_MS = 60_000

export function createAdvisorRunner({
  runAgent = runAdvisorAgent,
  buildEnvelope = buildRuntimeEnvelope,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  return async function advisorRunner({ question, context = {}, runtime } = {}) {
    const sources = runtime?.contextSources?.() ?? {}
    if (!sources.registry || !sources.view || !sources.fileService) {
      return fail('INVALID_INPUT', '运行时当前没有打开项目：没有板块提供的素材块，上下文信封无从组装。请先到「打开项目」选一个含 .pinax 的文件夹。')
    }
    const built = await buildEnvelope({
      registry: sources.registry,
      view: sources.view,
      fileService: sources.fileService,
      question,
      context
    })
    if (!built.ok) return built
    const payload = built.value

    // 一次提问＝一个轮数闸：内核里的思考回合、语义修复重跑都计在同一条链上（与 advisor 路由同口径）。
    const roundGuard = createModelRoundGuard()
    let run
    try {
      run = await withTimeout(runAgent({
        providerId: 'text-model',
        capability: payload.capability,
        envelope: payload.envelope,
        question,
        taskMeta: { taskType: payload.taskType, target: payload.envelope.target, options: {}, roundGuard }
      }), timeoutMs)
    } catch (error) {
      return mapRunnerFailure(error, payload)
    }

    const meta = {
      provider: run?.provider ?? null,
      taskType: payload.taskType,
      targetRevision: payload.envelope.target.revision,
      sourceRefs: collectAgentEnvelopeSourceRefs(payload.envelope),
      budget: payload.envelope.budget,
      roundsUsed: roundGuard.used,
      contextWarnings: payload.warnings
    }
    let advice = String(run?.advice ?? '')
    let result = null
    try {
      const response = createAdvisorTaskResponse({ taskType: payload.taskType, advice, target: payload.envelope.target, meta })
      advice = response.advice
      result = response.result
    } catch {
      // 解析不了就原样给作者看模型返回的那段字，同时把「没解析成结构化结果」记在 meta 里，不假装成功。
      meta.resultParsing = 'advice 未能转成结构化结果，已按原文返回'
    }
    return {
      ok: true,
      source: ADVISOR_RUNNER_SOURCE,
      text: advice,
      answer: advice,
      result,
      meta,
      context: { profile: payload.profile, providerKinds: payload.providerKinds, missingKinds: payload.missingKinds }
    }
  }
}

function mapRunnerFailure(error, payload) {
  const code = String(error?.code || '')
  const message = String(error?.message || error || 'advisor 运行失败')
  if (code === 'MODEL_ROUND_LIMIT_EXCEEDED') {
    return fail('DEPENDENCY_UNMET', `本次提问的模型调用轮数已达上限（${error.message}）`, { code, taskType: payload.taskType })
  }
  if (code.startsWith('AGENT_PROVIDER_')) {
    // 模型面不可达 / 配置无效 / 拒绝 / 截断：一律如实转述上游那句话，不加工、不补内容。
    return fail('DEPENDENCY_UNMET', message, { code, taskType: payload.taskType, retryable: error?.retryable !== false })
  }
  if (error?.name === 'AbortError' || /timeout/iu.test(code)) {
    return fail('IO_FAILED', `模型在限定时间内没有返回，本次提问已取消（${message}）`, { code: code || 'PINAX_RUNNER_TIMEOUT' })
  }
  return fail('IO_FAILED', `运行时执行失败：${message}`, { code: code || 'PINAX_RUNNER_FAILED' })
}

function withTimeout(promise, ms) {
  const limit = Number(ms)
  if (!Number.isSafeInteger(limit) || limit <= 0) return promise
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`advisor 在 ${limit}ms 内没有返回`)
      error.code = 'PINAX_RUNNER_TIMEOUT'
      reject(error)
    }, limit)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })
}
