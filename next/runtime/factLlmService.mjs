import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'

/**
 * fact 引擎 LlmPort 的主进程实现（M 系接线批 · 作者裁定：无 API token，开子 Agent 走既有模型通道）。
 *
 * 为什么是子 Agent 而不是任务面 HTTP：任务面（storyflow-kit /v1/pinax/complete）需要单独起服务
 * 并注入凭据；作者裁定走既有模型通道——CodeBuddy CLI 已登录、几小时前刚跑完 M2/M3，零 token 零端口。
 * 这条实现与任务面实现是可替换的：消费侧只认 LlmPort（next/fact/ports/llmPort.js）的
 * complete({prompt, system?, maxTokens?, signal?}) → {text, usage?}，换通道不动 fact 代码。
 *
 * 纪律（与 writingComplete 同一口径）：
 *   - 模型面只在内核侧：渲染层不 spawn 进程、不持凭据，只经 IPC 递请求收 {text, usage}；
 *   - 上游失败如实报 IO_FAILED，绝不编一段文字冒充模型——戏剧✦层缺席不阻塞必然▮/命运⚙；
 *   - next/fact 保持 Core-shape 可移植：本文件在 next/runtime，宿主依赖（child_process）不进 fact。
 *
 * CLI 形态（活体探针验证过，2026-11-10）：
 *   codebuddy -p --model hy4 --output-format json --tools "" --no-session-persistence
 *   · --tools "" 禁全部工具＝纯补全，子 Agent 不读不写任何文件；
 *   · --no-session-persistence 会话不落盘；
 *   · cwd 用中性临时目录——不注入任何仓库的 AGENTS.md／项目记忆，提示词只有 fact 层那一份；
 *   · system 折进用户轮（kitModelGateway.foldSystemIntoPrompt 同款口径，对所有网关安全）；
 *   · maxTokens 在这条通道只是建议值：CLI 未暴露 token 上限参数，消费侧自己的截断兜底照旧。
 */

/** 既有模型通道验证过的模型名（M2/M3 派发日志 181 处 "model":"hy4"）。 */
export const FACT_LLM_DEFAULT_MODEL = 'hy4'

/** system 折进 prompt 头部：与 kitModelGateway 同一口径；空 system 原样给 prompt。
 *  消费侧形状不齐（candidates.js 的戏剧层把全文放 system、不带 prompt）——只有 system 时它就是正文。 */
export function foldFactLlmPrompt(request = {}) {
  const system = String(request?.system ?? '').trim()
  const prompt = String(request?.prompt ?? '')
  if (!system) return prompt
  return prompt.trim() ? `${system}\n\n${prompt}` : system
}

/**
 * 从 CLI stdout 取最后一个 type:"result" 事件。三种 observed 形态都认：
 *   1) 整体是一个 JSON（对象或事件数组——--output-format json 的探针形态是 pretty-print 数组）；
 *   2) NDJSON 逐行（stream-json 落盘形态）；
 *   3) 混着其它输出的 pretty-print（dispatch-codebuddy-wf.mjs 的配对括号兜底）。
 * 取不到返回 null——调用方据此如实报「没有 result 事件」，不猜。
 */
export function parseCliResult(stdout) {
  const raw = String(stdout ?? '')
  let events = []
  try {
    const whole = JSON.parse(raw)
    if (Array.isArray(whole)) events = whole
    else if (whole && typeof whole === 'object') events = [whole]
  } catch {
    for (const line of raw.split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) continue
      try { events.push(JSON.parse(trimmed)) } catch { /* 非 JSON 行跳过 */ }
    }
  }
  if (!events.length) {
    const marker = /"type":\s*"result"/u.exec(raw)
    if (marker) {
      const start = raw.lastIndexOf('{', marker.index)
      let depth = 0
      let inStr = false
      let esc = false
      let end = -1
      for (let i = start; i < raw.length; i += 1) {
        const ch = raw[i]
        if (esc) { esc = false; continue }
        if (ch === '\\') { esc = true; continue }
        if (ch === '"') { inStr = !inStr; continue }
        if (inStr) continue
        if (ch === '{') depth += 1
        else if (ch === '}') { depth -= 1; if (depth === 0) { end = i + 1; break } }
      }
      if (end > start) {
        try { events = [JSON.parse(raw.slice(start, end))] } catch { /* 配对失败＝没有 result */ }
      }
    }
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i] && events[i].type === 'result') return events[i]
  }
  return null
}

/** 中性工作目录：进程内共享一份，mkdir recursive 幂等。放 tmpdir 下，不进任何仓库。 */
let neutralDir = null
async function neutralCwd() {
  if (!neutralDir) {
    neutralDir = join(tmpdir(), 'pinax-fact-llm')
    await mkdir(neutralDir, { recursive: true })
  }
  return neutralDir
}

/**
 * 默认派发：spawn CodeBuddy CLI 纯补全。超时／中止都杀子进程并抛带 code 的错，
 * 由 createFactLlmService 收敛成 IO_FAILED 回执——这一层不吞错也不编字。
 * @param {{prompt:string, model?:string, timeoutMs?:number, signal?:AbortSignal, command?:string, cwd?:string, effort?:string}} request
 * @returns {Promise<{text:string, usage:{promptTokens:number|null, completionTokens:number|null}, model:string, durationMs:number|null, numTurns:number|null}>}
 */
/**
 * Pi 任务面通道（P-LLM 作者裁定：本地有 Pi 真实环境，走库上代码，不起 CLI 子进程）。
 *
 * 契约与 CLI 通道完全一致（{prompt, model, timeoutMs, signal} → {text, usage, model, durationMs}），
 * 所以 createFactLlmService 的 dispatch 注入点不用改：换通道＝换一个函数。
 *
 * 为什么单独放这一层而不是直接 import forwardComplete：
 *   · forwardComplete 在 server/**（旧轨），fact 通道必须能在 next/ 侧独立测试（注入假 fetch）；
 *   · 这里只依赖一个 fetchImpl（默认真 fetch），于是单测零网络；
 *   · 端点从 env PINAX_ADAPTER_ENDPOINT 或 shared/kitTaskPlane 的默认值取，与既有网关同一口径。
 *
 * Pi 任务面端点（storyflow-kit/storyharness，npm run serve:pinax）：
 *   GET  /healthz  探活
 *   POST /v1/pinax/complete  { systemPrompt?, messages|prompt, maxTokens? } → { ok, content, usage, model }
 */
export async function dispatchPiCompletion({
  prompt,
  model = null,
  timeoutMs = 180_000,
  signal,
  maxTokens = 8000,
  endpoint = process.env.PINAX_ADAPTER_ENDPOINT || 'http://127.0.0.1:8451',
  fetchImpl = fetch
} = {}) {
  if (signal?.aborted) {
    throw Object.assign(new Error('推演补全在发起前已被取消'), { code: 'FACT_LLM_ABORTED' })
  }
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const response = await fetchImpl(new URL('/v1/pinax/complete', endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: String(prompt ?? '') }],
        // 任务面接受 200–8000；推理模型思维链与正文共享预算，4096 默认会让单段抽取大量 finishReason=length
        maxTokens,
        ...(model ? { model } : {})
      }),
      signal: controller.signal
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.ok !== true) {
      throw Object.assign(
        new Error(`Pi 任务面拒绝补全（${response.status}）：${String(body?.message ?? '').slice(0, 300)}`),
        { code: 'FACT_LLM_UPSTREAM_FAILED', status: response.status }
      )
    }
    const text = String(body?.content ?? '')
    // 静默失败显式化：任务面在模型层失败时会回 ok:true + 空 content + finishReason:"error"，
    // 若只看空串就报「空补全」，根因（缺 API key / 鉴权失败 / 上游 5xx）会被埋掉。
    // 这里按 finishReason 分级如实报，缺什么说什么。
    if (!text.trim()) {
      const reason = String(body?.finishReason ?? '')
      const hint = reason === 'error'
        ? '任务面自报 finishReason=error——通常是模型凭据缺失或上游鉴权失败（检查 Pi 任务面的 ZAI_API_KEY / .external/pinax-adapter.json）'
        : reason === 'empty'
          ? '模型返回了空内容'
          : '任务面没有说明原因'
      throw Object.assign(
        new Error(`Pi 任务面交回了空补全（finishReason=${reason || '未给'}）：${hint}。这次不编任何文字`),
        { code: reason === 'error' ? 'FACT_LLM_UPSTREAM_ERROR' : 'FACT_LLM_EMPTY', finishReason: reason || null }
      )
    }
    return {
      text,
      usage: body?.usage ?? null,
      model: String(body?.model ?? model ?? 'pi'),
      durationMs: Number.isFinite(body?.durationMs) ? body.durationMs : (Date.now() - startedAt),
      numTurns: null
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error(`推演补全超时（${timeoutMs}ms）：Pi 任务面没有在时限内交回结果`), { code: 'FACT_LLM_TIMEOUT' })
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * dots.ai（小红书）通道（P-LLM 实跑通道，作者 2026-11-11 提供凭据）。
 *
 * 端点与鉴权口径来自 NovelPedia 的实测预设（ref-Novelpedia/src/cli.py:61-63）：
 *   base https://note3-prev-api.askdiandian.com  →  {base}/v1/chat/completions（OpenAI 兼容）
 *   model dots3-note-prev
 * 鉴权**只认 `Authorization: Bearer <key>`**——实测 `apikey:` 头会被忽略并回 401
 *   （Missing API key / governance.missing_api_key），所以这里不提供第二套方案。
 *
 * ⚠ 这是**推理模型**：回包同时带 `reasoning_content`（思维链）与 `content`（正文），
 *   推理与正文**共享 max_tokens**。预算给小了会得到 finish_reason:"length" 且 content 缺失——
 *   表现为「模型没说话」，实际是推理把预算吃光了。所以：
 *     · 默认 maxTokens 给 2000（抽取单段实测够用）；
 *     · 命中 length 且无 content 时**如实报 FACT_LLM_TRUNCATED**，不伪装成空补全；
 *     · reasoning_content 不丢——记进 usage.reasoningChars，便于复盘成本。
 */
export const DOTS_ENDPOINT = 'https://note3-prev-api.askdiandian.com'
export const DOTS_MODEL = 'dots3-note-prev'

/**
 * 关闭思考链的载荷（作者 2026-11-11 提醒「推理的参数是可以关闭的，我的老项目强调过」）。
 * 双保险口径与 ref-Novelpedia/src/llm_client.py:375-377 一致：
 *   · `thinking: { type: 'disabled' }` —— Anthropic 风格开关；
 *   · `chat_template_kwargs: { enable_thinking: false }` —— Qwen/vLLM 风格模板变量。
 * 实测（guimi 10 章）：105 秒/段 → 4.5 秒/段（23 倍），outputTokens 2629 → 161。
 * 关不掉的时候推理与正文共享 max_tokens，会把正文挤成空——所以宁可多带两个无害字段。
 */
export function disableThinkingPayload() {
  return { thinking: { type: 'disabled' }, chat_template_kwargs: { enable_thinking: false } }
}

export async function dispatchDotsCompletion({
  prompt,
  model = DOTS_MODEL,
  maxTokens = 2000,
  timeoutMs = 180_000,
  signal,
  /** 默认关闭思考链：这是抽取/绑定这类机械任务，推理只会烧预算。要开推理显式传 true。 */
  disableThinking = true,
  endpoint = process.env.PINAX_FACT_LLM_ENDPOINT || DOTS_ENDPOINT,
  apiKey = process.env.PINAX_FACT_LLM_KEY || process.env.DOTSAI_API_KEY || process.env.LLM_API_KEY || null,
  fetchImpl = fetch
} = {}) {
  if (signal?.aborted) {
    throw Object.assign(new Error('推演补全在发起前已被取消'), { code: 'FACT_LLM_ABORTED' })
  }
  if (!apiKey) {
    throw Object.assign(
      new Error('dots.ai 通道缺少 API key：设 PINAX_FACT_LLM_KEY / DOTSAI_API_KEY / LLM_API_KEY 之一'),
      { code: 'FACT_LLM_NO_KEY' }
    )
  }
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const response = await fetchImpl(new URL('/v1/chat/completions', endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: String(prompt ?? '') }],
        max_tokens: maxTokens,
        stream: false,
        ...(disableThinking ? disableThinkingPayload() : {})
      }),
      signal: controller.signal
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = String(body?.detail ?? body?.message ?? body?.title ?? '').slice(0, 300)
      throw Object.assign(
        new Error(`dots.ai 拒绝补全（${response.status}）：${detail || '无详情'}`),
        { code: 'FACT_LLM_UPSTREAM_FAILED', status: response.status, errorType: body?.error_type ?? null }
      )
    }
    const choice = Array.isArray(body?.choices) ? body.choices[0] : null
    const message = choice?.message ?? {}
    const content = String(message.content ?? '')
    const reasoning = String(message.reasoning_content ?? '')
    const finishReason = String(choice?.finish_reason ?? '')
    const usage = body?.usage
      ? {
          promptTokens: Number.isFinite(body.usage.prompt_tokens) ? body.usage.prompt_tokens : null,
          completionTokens: Number.isFinite(body.usage.completion_tokens) ? body.usage.completion_tokens : null,
          totalTokens: Number.isFinite(body.usage.total_tokens) ? body.usage.total_tokens : null,
          reasoningChars: reasoning.length
        }
      : { reasoningChars: reasoning.length }
    if (!content.trim()) {
      // 推理把预算吃光是最常见的「假空回包」——必须与真正的空区分开报。
      const hint = finishReason === 'length'
        ? `max_tokens=${maxTokens} 被推理过程耗尽（reasoningChars=${reasoning.length}）：调大 maxTokens 或收窄任务`
        : '模型返回了空内容'
      throw Object.assign(
        new Error(`dots.ai 交回了空补全（finish_reason=${finishReason || '未给'}）：${hint}。这次不编任何文字`),
        { code: finishReason === 'length' ? 'FACT_LLM_TRUNCATED' : 'FACT_LLM_EMPTY', finishReason: finishReason || null, reasoningChars: reasoning.length }
      )
    }
    return {
      text: content,
      usage,
      model: String(body?.model ?? model),
      durationMs: Date.now() - startedAt,
      numTurns: null,
      finishReason: finishReason || null
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error(`推演补全超时（${timeoutMs}ms）：dots.ai 没有在时限内交回结果`), { code: 'FACT_LLM_TIMEOUT' })
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function dispatchCodebuddyCompletion({ prompt, model = FACT_LLM_DEFAULT_MODEL, timeoutMs = 180_000, signal, command = 'codebuddy', cwd = null, effort = null } = {}) {
  if (signal?.aborted) {
    throw Object.assign(new Error('推演补全在发起前已被取消'), { code: 'FACT_LLM_ABORTED' })
  }
  const workdir = cwd ?? await neutralCwd()
  const args = [
    '-p',
    '--model', model,
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence'
  ]
  // 推理预算（CLI --effort：minimal/low/medium/high/xhigh/max）：只从主进程配置来，渲染层指定不了。
  // 薄 JSON 抽取用低档省推理 token；成书渲染留默认保质量——档位选择是验收口径，不是隐形闸。
  if (typeof effort === 'string' && effort.trim()) args.push('--effort', effort.trim())
  const child = spawn(command, args, {
    cwd: workdir,
    stdio: ['pipe', 'pipe', 'pipe'],
    // Windows 上 codebuddy 是 npm 的 .cmd shim，必须经 shell；与 devtools/dispatch-codebuddy.mjs 同款。
    shell: true
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  // 子进程先退时 stdin 写入会 EPIPE：裁决走 close/error，这里不让它炸成未捕获异常。
  child.stdin.on('error', () => {})
  child.stdin.write(String(prompt ?? ''))
  child.stdin.end()

  const outcome = await new Promise((resolve) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const kill = () => { try { child.kill() } catch { /* 已退出的进程杀不动，close 会裁决 */ } }
    const timer = setTimeout(() => { kill(); finish({ kind: 'timeout' }) }, timeoutMs)
    const onAbort = () => { kill(); finish({ kind: 'aborted' }) }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    child.on('error', (error) => finish({ kind: 'spawn-error', error }))
    child.on('close', (code) => finish({ kind: 'closed', code }))
  })

  if (outcome.kind === 'timeout') {
    throw Object.assign(new Error(`推演补全超时（${timeoutMs}ms）：子 Agent 没有在时限内交回结果`), { code: 'FACT_LLM_TIMEOUT' })
  }
  if (outcome.kind === 'aborted') {
    throw Object.assign(new Error('推演补全已被取消：子 Agent 进程已终止'), { code: 'FACT_LLM_ABORTED' })
  }
  if (outcome.kind === 'spawn-error') {
    throw Object.assign(new Error(`codebuddy 子 Agent 启动失败：${String(outcome.error?.message || outcome.error)}（CLI 不在 PATH 或未安装？）`), { code: 'FACT_LLM_SPAWN_FAILED' })
  }
  const result = parseCliResult(stdout)
  if (!result) {
    throw Object.assign(new Error(`子 Agent 没有交回 result 事件（exit=${outcome.code}）：${String(stderr || stdout).slice(-300)}`), { code: 'FACT_LLM_NO_RESULT' })
  }
  if (result.is_error === true) {
    throw Object.assign(new Error(`子 Agent 报错：${String(result.result ?? '').slice(0, 300)}`), { code: 'FACT_LLM_UPSTREAM_FAILED' })
  }
  const text = String(result.result ?? '')
  if (!text.trim()) {
    throw Object.assign(new Error('子 Agent 交回了空补全：这次不编任何文字'), { code: 'FACT_LLM_EMPTY' })
  }
  return {
    text,
    usage: {
      promptTokens: Number.isFinite(result.usage?.input_tokens) ? result.usage.input_tokens : null,
      completionTokens: Number.isFinite(result.usage?.output_tokens) ? result.usage.output_tokens : null
    },
    model,
    durationMs: Number.isFinite(result.duration_ms) ? result.duration_ms : null,
    numTurns: Number.isFinite(result.num_turns) ? result.num_turns : null
  }
}

/**
 * 主进程服务：IPC 友好回执 {ok, value:{text, usage, model, durationMs}} | {ok:false, error}。
 * dispatch 可注入（单测用假派发，零网络零子进程）；默认走 CodeBuddy CLI 子 Agent。
 * 模型名与超时只从主进程 env 取——渲染层经 IPC 指定不了 model／cwd／command（通道层白名单载荷）。
 */
export function createFactLlmService({
  dispatch = dispatchCodebuddyCompletion,
  model = process.env.PINAX_FACT_LLM_MODEL || FACT_LLM_DEFAULT_MODEL,
  timeoutMs = Number(process.env.PINAX_FACT_LLM_TIMEOUT_MS) || 180_000,
  effort = process.env.PINAX_FACT_LLM_EFFORT || null
} = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('createFactLlmService 的 dispatch 必须是函数（默认 dispatchCodebuddyCompletion）')

  /**
   * @param {{prompt:string, system?:string, maxTokens?:number, signal?:AbortSignal}} request
   * @returns {Promise<{ok:true, value:{text:string, usage:object|null, model:string, durationMs:number|null}}|{ok:false, error:object}>}
   */
  async function complete(request = {}) {
    // 空提示词护栏：prompt 与 system 都空才拒——戏剧层（candidates.js）只带 system 不带 prompt，
    // 那是合法消费形状，不是空提示词；两个都没有才是「让模型自由发挥」的回归现象。
    if (!String(request?.prompt ?? '').trim() && !String(request?.system ?? '').trim()) {
      return fail('INVALID_INPUT', '推演补全必须给出 prompt 或 system：两者都空不发给模型（20261008 空提示词护栏同款口径）')
    }
    try {
      const answer = await dispatch({
        prompt: foldFactLlmPrompt(request),
        model,
        timeoutMs,
        signal: request.signal,
        effort
      })
      const text = String(answer?.text ?? '')
      if (!text.trim()) return fail('IO_FAILED', '模型通道交回了空补全：这次不编任何文字')
      return ok({
        text,
        usage: answer?.usage ?? null,
        model: answer?.model ?? model,
        durationMs: answer?.durationMs ?? null
      })
    } catch (error) {
      return fail('IO_FAILED', `推演模型通道没有交回可用结果：${String(error?.message || error)}`, { code: error?.code ?? null })
    }
  }

  return { complete }
}