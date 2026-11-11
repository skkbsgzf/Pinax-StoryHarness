import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FACT_LLM_DEFAULT_MODEL,
  createFactLlmService,
  foldFactLlmPrompt,
  parseCliResult
} from '../runtime/factLlmService.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { isLlmPort } from '../fact/ports/llmPort.js'

/**
 * M 系接线批：fact LlmPort 主进程服务的零网络单测。
 * 真实 CLI 派发不在这里跑（门禁必须离线可过）——dispatch 注入假派发，
 * 活体验证走验收 harness（D:/Pinax-e2e，真模型真语料）。
 */

test('foldFactLlmPrompt：system 折进用户轮头部（kitModelGateway 同款口径），空 system 原样', () => {
  assert.equal(foldFactLlmPrompt({ system: '你是提议器', prompt: '给出候选' }), '你是提议器\n\n给出候选')
  assert.equal(foldFactLlmPrompt({ system: '  ', prompt: '给出候选' }), '给出候选')
  assert.equal(foldFactLlmPrompt({ prompt: '给出候选' }), '给出候选')
  // 戏剧层消费形状：全文在 system、不带 prompt——system 自己就是正文，不拖空尾巴。
  assert.equal(foldFactLlmPrompt({ system: '你是提议器。事实包简报：…' }), '你是提议器。事实包简报：…')
  assert.equal(foldFactLlmPrompt({}), '')
})

test('parseCliResult：pretty-print 事件数组（探针形态）取最后一个 result', () => {
  const stdout = JSON.stringify([
    { type: 'message', role: 'user', content: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '中间文本' }] },
    { type: 'result', subtype: 'success', is_error: false, result: '{"ok":true}', usage: { input_tokens: 10, output_tokens: 5 }, duration_ms: 3300, num_turns: 3 }
  ], null, 2)
  const result = parseCliResult(stdout)
  assert.equal(result.result, '{"ok":true}')
  assert.equal(result.usage.input_tokens, 10)
  assert.equal(result.num_turns, 3)
})

test('parseCliResult：单对象／NDJSON／混输出配对括号三种形态都认', () => {
  const single = { type: 'result', is_error: false, result: '单对象' }
  assert.equal(parseCliResult(JSON.stringify(single)).result, '单对象')
  const ndjson = [
    JSON.stringify({ type: 'message', role: 'user' }),
    JSON.stringify({ type: 'result', is_error: false, result: '第一份' }),
    JSON.stringify({ type: 'result', is_error: false, result: '最后一份' })
  ].join('\n')
  assert.equal(parseCliResult(ndjson).result, '最后一份')
  const mixed = `一些进度输出\n{\n  "type": "result",\n  "is_error": false,\n  "result": "括号配对取出来的"\n}\n尾巴`
  assert.equal(parseCliResult(mixed).result, '括号配对取出来的')
})

test('parseCliResult：没有 result 事件返回 null，不猜不编', () => {
  assert.equal(parseCliResult(''), null)
  assert.equal(parseCliResult('没有任何 JSON'), null)
  assert.equal(parseCliResult(JSON.stringify([{ type: 'message', role: 'assistant' }])), null)
  assert.equal(parseCliResult('{坏掉的 JSON'), null)
})

test('服务回执形状满足 LlmPort 消费侧：complete 是函数，成功回 {text, usage}', async () => {
  const seen = []
  const service = createFactLlmService({
    model: 'test-model',
    timeoutMs: 5000,
    dispatch: async (request) => {
      seen.push(request)
      return { text: '候选文本', usage: { promptTokens: 1, completionTokens: 2 }, model: 'test-model', durationMs: 9 }
    }
  })
  // 渲染层适配器把回执转成 {text} 后即是一枚合法 LlmPort（fact 层只认 complete）。
  assert.equal(typeof service.complete, 'function')
  const port = { complete: async (request) => {
    const result = await service.complete(request)
    assert.equal(result.ok, true)
    return result.value
  } }
  assert.equal(isLlmPort(port), true)
  const answer = await port.complete({ system: '提议器', prompt: '给出候选', maxTokens: 400 })
  assert.equal(answer.text, '候选文本')
  assert.deepEqual(answer.usage, { promptTokens: 1, completionTokens: 2 })
  // system 已折进 prompt；model/timeout 来自主进程配置，不是渲染层载荷。
  assert.equal(seen[0].prompt, '提议器\n\n给出候选')
  assert.equal(seen[0].model, 'test-model')
  assert.equal(seen[0].timeoutMs, 5000)
})

test('空 prompt 直接拒（空提示词护栏），不发起派发', async () => {
  let called = 0
  const service = createFactLlmService({ dispatch: async () => { called += 1; return { text: 'x' } } })
  for (const request of [{}, { prompt: '' }, { prompt: '   ' }, { prompt: null }, { prompt: '', system: '  ' }]) {
    const result = await service.complete(request)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  }
  assert.equal(called, 0)
})

test('只带 system 不带 prompt 是合法消费形状（戏剧✦层 candidates.js 就这么调）', async () => {
  let seen = null
  const service = createFactLlmService({ dispatch: async (request) => { seen = request; return { text: '{"proposals":[]}' } } })
  const result = await service.complete({ system: '你是剧情推演提议器。事实包简报：…', maxTokens: 400 })
  assert.equal(result.ok, true)
  assert.equal(seen.prompt, '你是剧情推演提议器。事实包简报：…')
})

test('上游抛错收敛成 IO_FAILED：如实摊开原因，绝不编文字冒充模型', async () => {
  const service = createFactLlmService({
    dispatch: async () => { throw Object.assign(new Error('CLI 不在 PATH'), { code: 'FACT_LLM_SPAWN_FAILED' }) }
  })
  const result = await service.complete({ prompt: '给出候选' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, NEXT_ERROR_CODES.IO_FAILED)
  assert.match(result.error.message, /CLI 不在 PATH/)
  assert.equal(result.error.details.code, 'FACT_LLM_SPAWN_FAILED')
  assert.equal(result.value, undefined)
})

test('空补全与上游 ok:false 都不算成功', async () => {
  const empty = createFactLlmService({ dispatch: async () => ({ text: '  ' }) })
  const result = await empty.complete({ prompt: '给出候选' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, NEXT_ERROR_CODES.IO_FAILED)
})

test('signal 透传给派发层；dispatch 非函数构造即拒', async () => {
  const controller = new AbortController()
  let seenSignal = null
  const service = createFactLlmService({ dispatch: async (request) => { seenSignal = request.signal; return { text: 'x' } } })
  await service.complete({ prompt: 'p', signal: controller.signal })
  assert.equal(seenSignal, controller.signal)
  assert.throws(() => createFactLlmService({ dispatch: 'not-a-function' }), TypeError)
})

test('effort 只从主进程配置透传（渲染层载荷里没有这个字段）', async () => {
  let seen = null
  const service = createFactLlmService({ effort: 'low', dispatch: async (request) => { seen = request; return { text: 'x' } } })
  await service.complete({ prompt: 'p' })
  assert.equal(seen.effort, 'low')
  const unset = createFactLlmService({ dispatch: async (request) => { seen = request; return { text: 'x' } } })
  await unset.complete({ prompt: 'p' })
  assert.equal(seen.effort, null)
})

test('默认模型名钉在 hy4（既有模型通道验证过的名字）', () => {
  assert.equal(FACT_LLM_DEFAULT_MODEL, 'hy4')
})
/* ---------- P-LLM：Pi 任务面通道（本地 Pi 真实环境，作者 2026-11-11 裁定） ---------- */

test('Pi 通道：成功回包归一成 {text, usage, model, durationMs}（与 CLI 通道同形状）', async () => {
  const { dispatchPiCompletion } = await import('../runtime/factLlmService.mjs')
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, content: '收到', usage: { inputTokens: 10, outputTokens: 2 }, model: 'zai.glm-5.3', finishReason: 'stop' })
    }
  }
  const result = await dispatchPiCompletion({ prompt: '回复两个字：收到', fetchImpl })
  assert.equal(result.text, '收到')
  assert.equal(result.model, 'zai.glm-5.3')
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 2 })
  assert.ok(String(calls[0].url).endsWith('/v1/pinax/complete'))
  assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: '回复两个字：收到' }])
})

test('Pi 通道：finishReason=error 的空补全要如实报「缺凭据」，不能只报「空」', async () => {
  const { dispatchPiCompletion } = await import('../runtime/factLlmService.mjs')
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, content: '', toolCalls: [], finishReason: 'error', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } })
  })
  await assert.rejects(
    () => dispatchPiCompletion({ prompt: '测试', fetchImpl }),
    (error) => error.code === 'FACT_LLM_UPSTREAM_ERROR' && /凭据|鉴权/.test(error.message) && /finishReason=error/.test(error.message)
  )
})

test('Pi 通道：任务面 4xx/5xx 或 ok:false 时抛上游失败，带状态码', async () => {
  const { dispatchPiCompletion } = await import('../runtime/factLlmService.mjs')
  await assert.rejects(
    () => dispatchPiCompletion({ prompt: 'x', fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ ok: false, message: '模型不可用' }) }) }),
    (error) => error.code === 'FACT_LLM_UPSTREAM_FAILED' && error.status === 503 && /模型不可用/.test(error.message)
  )
})

test('Pi 通道：发起前已中止 → FACT_LLM_ABORTED，不发请求', async () => {
  const { dispatchPiCompletion } = await import('../runtime/factLlmService.mjs')
  const controller = new AbortController()
  controller.abort()
  let called = false
  await assert.rejects(
    () => dispatchPiCompletion({ prompt: 'x', signal: controller.signal, fetchImpl: async () => { called = true } }),
    (error) => error.code === 'FACT_LLM_ABORTED'
  )
  assert.equal(called, false)
})
