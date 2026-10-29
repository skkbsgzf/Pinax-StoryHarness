import { runAdvisorAgent } from '../../server/services/advisorAgentRunner.js'
import { createAdvisorTaskResponse } from '../../server/services/advisorTaskService.js'
import { collectAgentEnvelopeSourceRefs } from '../../shared/agentContextContract.js'
import { createModelRoundGuard } from '../../shared/modelLoopGuard.js'
import { buildOpenClawUserMessage } from '../../server/services/openclawService.js'
import { fail, NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { buildRuntimeEnvelope } from './contextProfiles.mjs'
import { skillCatalogLines } from '../skills/loadSkills.mjs'
import { normalizeWriteMode } from './writePolicy.mjs'

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

/**
 * 运行过程事件（批次29）：这一层的真实节点，纯数据 JSON。
 *   start       ── 提问进了运行器（questionChars 是原文长度）
 *   envelope    ── 上下文信封组装完（块数／字数／缺了哪几类素材）
 *   model-round ── roundGuard 的每一次真实轮（round 是第几轮）
 *   answer      ── 回答成形（字数、是否解析成结构化、用了几轮）
 *   failed      ── 断在哪一步（code 是上游错误码，atStage 是断点所在阶段）
 * 边界（诚实）：这条 in-process 链上没有子代理、没有 hook、也没有流式 token，
 * 所以这里不造那三类事件——事件粒度到「轮」为止。
 *
 * 事件回调是旁路：回调抛错只记 warning，绝不打断提问本身（见 createEventEmitter）。
 * 事件全部在这一层发，老线（server/services/advisorAgentRunner.js）一个字节都不动。
 */
export function createAdvisorRunner({
  runAgent = runAdvisorAgent,
  buildEnvelope = buildRuntimeEnvelope,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onEvent = null,
  // M2.5-A：工具循环默认关。注入 { run } 后由它接管模型往返；不注入时这一层与今天一字不差。
  toolLoop = null
} = {}) {
  return async function advisorRunner({ question, context = {}, runtime, onEvent: perAskEvent = null, writeMode = null, skill = null } = {}) {
    // 单次提问的事件口优先：外壳每一问都要带自己的 askId，不能靠 runner 创建时绑死的那一个。
    const emit = createEventEmitter(typeof perAskEvent === 'function' ? perAskEvent : onEvent)
    emit({ stage: 'start', questionChars: String(question ?? '').length })

    const sources = runtime?.contextSources?.() ?? {}
    if (!sources.registry || !sources.view || !sources.fileService) {
      const missingProject = '运行时当前没有打开项目：没有板块提供的素材块，上下文信封无从组装。请先到「打开项目」选一个含 .pinax 的文件夹。'
      emit({ stage: 'failed', code: NEXT_ERROR_CODES.INVALID_INPUT, atStage: 'start' })
      return fail('INVALID_INPUT', missingProject)
    }
    const built = await buildEnvelope({
      registry: sources.registry,
      view: sources.view,
      fileService: sources.fileService,
      question,
      context
    })
    if (!built.ok) {
      // 信封没组装出来：断点在「组装上下文」，code 用内核那条真实错误码。
      emit({ stage: 'failed', code: String(built.error?.code ?? 'PINAX_DEPENDENCY_UNMET'), atStage: 'envelope' })
      return built
    }
    const payload = built.value
    emit({
      stage: 'envelope',
      taskType: payload.taskType,
      profile: payload.profile ?? null,
      blocks: Array.isArray(payload.envelope?.blocks) ? payload.envelope.blocks.length : 0,
      chars: Number(payload.envelope?.budget?.usedChars) || 0,
      missingKinds: Array.isArray(payload.missingKinds) ? [...payload.missingKinds] : []
    })

    // 一次提问＝一个轮数闸：内核里的思考回合、语义修复重跑都计在同一条链上（与 advisor 路由同口径）。
    // 只包一层 acquire：每一次真实轮都发一条 model-round（超限那一次会抛，不算成功轮）。
    const roundGuard = withRoundEvents(createModelRoundGuard(), (round) => emit({ stage: 'model-round', round }))
    let run
    let loopResult = null
    try {
      if (toolLoop && typeof toolLoop.run === 'function') {
        // M2.5-A：注入的工具循环接管这一问。工具面从运行时现取（项目/载体在 start() 时已定形）；
        // 循环自己发 step / tool-* 事件，roundGuard 不参与——它计的是单次 runAgent 的回合。
        const tools = typeof runtime?.listTools === 'function' ? runtime.listTools() : []
        // 渐进披露：系统提示只给「名字 + 一句话」，正文要模型自己调 pinax_skill_read。
        const catalog = typeof runtime?.skills === 'function' ? (runtime.skills().catalog ?? []) : []
        loopResult = await withTimeout(toolLoop.run({
          question,
          envelope: payload.envelope,
          tools,
          skill,
          writeMode,
          onEvent: emit,
          buildUserMessage: ({ question: asked, envelope }) => {
            const base = buildOpenClawUserMessage(envelope, asked, {
              taskType: payload.taskType,
              target: payload.envelope.target
            })
            if (!catalog.length) return base
            return `${base}\n\n可用技能（要用哪个先调 pinax_skill_read 读正文，别凭名字猜步骤）：\n${skillCatalogLines(catalog).join('\n')}`
          }
        }), timeoutMs)
        run = { advice: String(loopResult?.text ?? '') }
      } else {
        run = await withTimeout(runAgent({
          providerId: 'text-model',
          capability: payload.capability,
          envelope: payload.envelope,
          question,
          taskMeta: { taskType: payload.taskType, target: payload.envelope.target, options: {}, roundGuard }
        }), timeoutMs)
      }
    } catch (error) {
      const mapped = mapRunnerFailure(error, payload)
      emit({
        stage: 'failed',
        code: String(error?.code || mapped.error?.code || 'PINAX_RUNNER_FAILED'),
        atStage: roundGuard.used > 0 ? 'model-round' : 'envelope'
      })
      return mapped
    }

    const meta = {
      provider: run?.provider ?? null,
      taskType: payload.taskType,
      targetRevision: payload.envelope.target.revision,
      sourceRefs: collectAgentEnvelopeSourceRefs(payload.envelope),
      budget: payload.envelope.budget,
      roundsUsed: loopResult ? (Array.isArray(loopResult.steps) ? loopResult.steps.length : 0) : roundGuard.used,
      contextWarnings: payload.warnings
    }
    if (loopResult) {
      meta.toolLoop = {
        kind: String(loopResult.kind ?? 'final'),
        steps: Array.isArray(loopResult.steps) ? loopResult.steps.length : 0,
        calls: Array.isArray(loopResult.calls) ? loopResult.calls.length : 0,
        dropped: Array.isArray(loopResult.dropped) ? loopResult.dropped.length : 0
      }
      meta.writeMode = normalizeWriteMode(writeMode)
      if (skill?.name) meta.skill = String(skill.name)
    }
    let advice = String(run?.advice ?? '')
    if (loopResult && loopResult.kind === 'step-budget') {
      // 循环没有收敛时不能把空串当回答：如实说清是运行时截断的，不是模型没说话。
      advice = `工具调用已达本轮上限（${meta.toolLoop.steps} 步），没有形成最终回答；请缩小这次请求的范围后重试。`
    }
    const rawAdvice = advice
    let result = null
    let structured = false
    if (loopResult?.kind === 'step-budget') {
      // 运行时截断的话不送结构化解析：这段不是模型的产出，别让它冒充审稿意见。
      meta.resultParsing = '未形成回答（步数用尽），不做结构化解析'
    } else {
      try {
        const response = createAdvisorTaskResponse({ taskType: payload.taskType, advice, target: payload.envelope.target, meta })
        advice = response.advice
        result = response.result
        // structured＝这一层真的把模型原话解析成了结构化审稿：解析成功时 advice 已被换成 result.summary，
        // 解析不出来时 formatAdvice 原样回吐那段字（两者逐字相同）。不拿「没抛错」冒充「解析成功」。
        structured = Boolean(result) && String(advice).trim() !== rawAdvice.trim()
      } catch {
        // 解析不了就原样给作者看模型返回的那段字，同时把「没解析成结构化结果」记在 meta 里，不假装成功。
        meta.resultParsing = 'advice 未能转成结构化结果，已按原文返回'
      }
    }
    emit({ stage: 'answer', chars: String(advice).length, structured, roundsUsed: meta.roundsUsed })
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

/**
 * 事件回调的旁路包装：回调同步抛错、返回 rejected Promise，都只留一条 warning。
 * 事件是给人看的过程，不是提问的一部分——它坏了，回答还得照常出来。
 */
function createEventEmitter(onEvent) {
  if (typeof onEvent !== 'function') return () => {}
  const warn = (error) => {
    // eslint-disable-next-line no-console -- 主进程/运行时没有渲染层可报，事件回调失败必须留痕
    console.warn('[pinax-next] 运行器事件回调失败：', error?.message ?? error)
  }
  return (event) => {
    try {
      const returned = onEvent({ ...event })
      if (returned && typeof returned.then === 'function') returned.then(null, warn)
    } catch (error) {
      warn(error)
    }
  }
}

/**
 * 轮数闸的事件壳：接口（used／limit／acquire）与 createModelRoundGuard 逐字一致，
 * 只是每次 acquire 成功后把「第几轮」报出去——超限那一次会抛 MODEL_ROUND_LIMIT_EXCEEDED，
 * 它不算一次真实轮，所以不发事件。
 */
function withRoundEvents(guard, onRound) {
  return {
    get used() { return guard.used },
    get limit() { return guard.limit },
    acquire(scope = 'model') {
      const round = guard.acquire(scope)
      onRound(round)
      return round
    }
  }
}
