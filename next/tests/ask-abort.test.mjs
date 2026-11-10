import test from 'node:test'
import assert from 'node:assert/strict'

import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'
import { TRAIL_STAGES, describeRuntimeProgress, describeTrailEvent, sanitizeTrailEvent } from '../shell/agentSessions.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { createAdvisorRunner } from '../runtime/runnerAdvisor.mjs'
import { createToolLoop } from '../runtime/toolLoop.mjs'

/**
 * 停止链路（批次77 任务3）。一条链四层，每层只证自己那一段，合起来是「按下钮 → 不再续轮 → 落进会话」：
 *   IPC  ── 按 askId 标记取消；问已经结束就如实说「没东西可停」；
 *   运行器 ── stopped 的回执正文要说清是收手不是模型没话说，且不送结构化解析；
 *   循环 ── 只在轮次边界收手：正在跑的那一轮照常跑完，下一轮一次都不多发；
 *   轨迹 ── stopped 段进白名单、只留 step、有中文；词表外的段型照旧落 null。
 * 边界（诚实）：进程内 advisor 直答链没有轮次边界，它永远不产出 stopped——不假装能停。
 */

const TOOLS = [{ name: 'pinax_outline_read', description: '读大纲', inputSchema: { type: 'object', properties: {} } }]

function scriptedTurn(responses) {
  const seen = []
  let index = 0
  return {
    seen,
    async turn({ messages }) {
      seen.push({ roles: messages.map((message) => message.role) })
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      return typeof response === 'function' ? response(index) : response
    }
  }
}

const callRound = (n) => ({ kind: 'tool_calls', calls: [{ id: `c${n}`, name: 'pinax_outline_read', arguments: {} }] })

test('〔批次77 任务3〕循环：取消位在第二轮之前读到，就不发起第二轮——正在跑的那轮跑完', async () => {
  let cancelled = false
  // 每轮都要求调工具（模型不收手），只有取消位能结束它。
  const turn = scriptedTurn([(_index) => callRound(1)])
  const events = []
  const loop = createToolLoop({
    turn: turn.turn,
    callTool: async () => {
      // 第一轮的工具跑完后作者才按下停止：这一轮必须完整结束，不能被劈断。
      cancelled = true
      return { ok: true, value: { payload: { nodes: 1 } } }
    },
    maxSteps: 8
  })
  const result = await loop.run({ question: '整本重写', tools: TOOLS, abort: () => cancelled, onEvent: (event) => events.push(event) })

  assert.equal(result.kind, 'stopped')
  assert.equal(result.stoppedAt, 1, '已经跑完一轮：停的是第二轮')
  assert.equal(result.text, '', '停止不给总结：模型没说的话不许替它编')
  assert.equal(turn.seen.length, 1, '第二轮的请求一次都没发出去')
  assert.equal(result.steps.length, 1)
  const stopped = events.at(-1)
  assert.deepEqual({ stage: stopped.stage, step: stopped.step }, { stage: 'stopped', step: 1 }, 'stopped 段带的是「跑完几轮」')
})

test('〔批次77 任务3〕循环：第一轮就带着取消位进来 → 一次模型请求都不发，stoppedAt 归 0', async () => {
  const turn = scriptedTurn([callRound(1)])
  const loop = createToolLoop({ turn: turn.turn, callTool: async () => ({ ok: true }) })
  const result = await loop.run({ question: '算了', tools: TOOLS, abort: () => true })

  assert.equal(result.kind, 'stopped')
  assert.equal(result.stoppedAt, 0)
  assert.equal(turn.seen.length, 0, '一轮都没跑就是没跑，不许发出去再装作停了')
})

test('〔批次77 任务3〕循环：不传 abort 时调用面一字不变（老测试与验收同口径）', async () => {
  const turn = scriptedTurn([{ kind: 'final_ready', text: '大纲一共三卷。' }])
  const loop = createToolLoop({ turn: turn.turn, callTool: async () => ({ ok: true }) })
  const result = await loop.run({ question: '大纲什么样', tools: TOOLS })

  assert.equal(result.kind, 'final')
  assert.equal(result.text, '大纲一共三卷。')
})

test('〔批次77 任务3〕循环：abort 自己抛错不许炸掉这一问——读不出来就当没取消', async () => {
  const turn = scriptedTurn([{ kind: 'final_ready', text: '照常收工。' }])
  const loop = createToolLoop({ turn: turn.turn, callTool: async () => ({ ok: true }) })
  const result = await loop.run({
    question: '取消位坏了',
    tools: TOOLS,
    abort: () => { throw new Error('令牌读不动') }
  })

  assert.equal(result.kind, 'final')
  assert.equal(result.text, '照常收工。')
})

function fakeBuilt() {
  return {
    ok: true,
    value: {
      taskType: 'authoring.review.chapter',
      capability: 'text',
      profile: 'writing-chapter',
      providerKinds: ['selection'],
      missingKinds: [],
      warnings: [],
      dropped: [],
      envelope: {
        surface: 'authoring',
        target: { type: 'chapter', revision: 'novel-chapter:正文/第001章-入场.md:1' },
        blocks: [{ kind: 'selection', priority: 1000, sourceRefs: ['novel-chapter:正文/第001章-入场.md'], content: '雪'.repeat(10) }],
        budget: { usedChars: 200, maxChars: 24_000, truncated: false }
      }
    }
  }
}

const fakeRuntime = (tools = []) => ({
  contextSources: () => ({ registry: {}, view: {}, fileService: {} }),
  listTools: () => tools
})

test('〔批次77 任务3〕运行器：stopped 那句话带真实轮数，且不送结构化解析', async () => {
  const events = []
  const runner = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    runAgent: async () => assert.fail('循环接管时不该调 runAgent'),
    toolLoop: {
      async run(input) {
        input.onEvent?.({ stage: 'stopped', step: 2 })
        return { kind: 'stopped', stoppedAt: 2, text: '', steps: [{}, {}], calls: [{}], dropped: [], usage: null }
      }
    }
  })
  const answer = await runner({ question: '停一下', runtime: fakeRuntime(), onEvent: (event) => events.push(event) })

  assert.equal(answer.ok, true, '停止不是失败：这一问真的跑过、真的收了手')
  assert.equal(answer.stopped, true, '回值带 stopped，界面不用靠正文文案猜状态')
  assert.match(answer.text, /已按作者要求停止（第 2 轮后不再续轮）/u)
  assert.equal(answer.result, null, '收手的回执不是模型产出，不许冒充结构化审稿')
  assert.equal(answer.meta.toolLoop.kind, 'stopped')
  assert.match(answer.meta.resultParsing, /停止/u)
  assert.equal(events.at(-1).structured, false)
})

test('〔批次77 任务3〕运行器：第一轮都没跑完的停止，句子要说清「模型一个字都没说」', async () => {
  const runner = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    toolLoop: { async run() { return { kind: 'stopped', stoppedAt: 0, text: '', steps: [], calls: [], dropped: [] } } }
  })
  const answer = await runner({ question: '不问了', runtime: fakeRuntime() })

  assert.match(answer.text, /第一轮还没发起就收了手/u)
})

test('〔批次77 任务3〕运行器：直答链（无工具循环）不假装能停——给了 abort 也不产出 stopped', async () => {
  const seen = []
  const runner = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    runAgent: async (input) => {
      seen.push(input)
      input.taskMeta.roundGuard.acquire('text-model')
      return { advice: '这一章开场够狠，但第三句在解释自己。' }
    }
  })
  const answer = await runner({ question: '这章如何？', runtime: fakeRuntime(), abort: () => true })

  assert.equal(answer.stopped, undefined, '单次往返没有轮次边界可停，回值里不许冒出 stopped')
  assert.equal(seen.length, 1, '直答链照旧一次往返')
  assert.equal(answer.meta.roundsUsed, 1)
})

test('〔批次77 任务3〕运行时 ask() 把 abort 原样交给运行器（不加工、不吞、不自己判停）', async () => {
  let received = null
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const runtime = createAgentRuntime({
    registry,
    runner: async (input) => {
      received = input
      return { ok: true, text: '收到', meta: {} }
    }
  })
  const predicate = () => true
  const answered = await runtime.ask('随便问一句', {}, { abort: predicate })

  assert.equal(answered.ok, true, JSON.stringify(answered.error ?? {}))
  assert.equal(typeof received.abort, 'function', 'abort 必须是函数形态传到运行器')
  assert.equal(received.abort(), true, '传的是同一个谓词，不是复制出来的常量')
})

test('〔批次77 任务3〕IPC：提问在途时按 askId 能标记取消，运行器侧那个谓词当场读到 true', async () => {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const seen = { abort: null, release: null }
  const session = {
    kernel: { kinds: Object.keys(PROJECT_KINDS) },
    registry,
    project: null,
    runtime: {
      ask: async (_question, _context, options) => {
        seen.abort = options.abort
        await new Promise((resolve) => { seen.release = resolve })
        return { ok: true, value: { text: '答完了' } }
      }
    },
    projectRoot: null
  }
  const dispatcher = createIpcDispatcher({ session })
  const pending = dispatcher.dispatch(IPC_CHANNELS.runtimeAsk, { question: '写长一点', askId: 'ask-keep-1' })

  // 还没答完，停止此刻有意义。
  const stoppedBy = await dispatcher.dispatch(IPC_CHANNELS.runtimeAskAbort, { askId: 'ask-keep-1' })
  assert.equal(stoppedBy.ok, true)
  assert.equal(stoppedBy.value.cancelled, true)
  assert.equal(typeof seen.abort, 'function')
  assert.equal(seen.abort(), true, '令牌要能被运行器当场读到——中间隔一层信封也算接上了')

  seen.release()
  const answered = await pending
  assert.equal(answered.value.askId, 'ask-keep-1', 'askId 随回执回去，事件与回答串在同一条上')

  // 问已经结束：登记表必须摘干净，再停就是「没东西可停」，不许假装有作用。
  const late = await dispatcher.dispatch(IPC_CHANNELS.runtimeAskAbort, { askId: 'ask-keep-1' })
  assert.equal(late.ok, true, '停晚了不是错误，不该给作者一条红')
  assert.equal(late.value.cancelled, false)
  assert.match(late.value.reason, /不在途/u)
})

test('〔批次77 任务3〕IPC：没带 askId 拒；提问失败也要从在途表里摘掉（不留幽灵可停）', async () => {
  const missing = await createIpcDispatcher({ session: { kernel: {}, registry: null, runtime: null } })
    .dispatch(IPC_CHANNELS.runtimeAskAbort, {})
  assert.equal(missing.ok, false)
  assert.match(missing.error.message, /askId/u)

  const session = {
    kernel: {},
    registry: null,
    project: null,
    projectRoot: null,
    runtime: { ask: async () => ({ ok: false, error: { code: 'PINAX_DEPENDENCY_UNMET', message: '未检测到可用模型' } }) }
  }
  const dispatcher = createIpcDispatcher({ session })
  const failed = await dispatcher.dispatch(IPC_CHANNELS.runtimeAsk, { question: '问一句', askId: 'ask-bad-1' })
  assert.equal(failed.ok, false, '运行器的失败信封原样透传，不因为「跑过了」就装成功')

  const after = await dispatcher.dispatch(IPC_CHANNELS.runtimeAskAbort, { askId: 'ask-bad-1' })
  assert.equal(after.value.cancelled, false, '失败的问早就出表了')
})

test('〔批次77 任务3〕轨迹：stopped 进白名单、只留 step、有中文；词表外段型照旧落 null', () => {
  assert.equal(TRAIL_STAGES.includes('stopped'), true, '白名单不扩这条，轨迹里就永远看不见收手在哪一轮')

  const kept = sanitizeTrailEvent({ stage: 'stopped', step: 3, code: '不该留', name: '不该留', runId: 'ask-1' })
  assert.deepEqual(kept, { stage: 'stopped', step: 3 }, 'stopped 只留 step：多余字段不进存储')

  const line = describeTrailEvent(kept)
  assert.equal(line.label, '已停止')
  assert.match(line.detail, /第 3 轮后不再续轮/u)
  assert.match(describeRuntimeProgress(kept), /已停止/u)

  // 一条都没有的停止（第一轮没发起）不许说成「第 0 轮」。
  assert.match(describeTrailEvent({ stage: 'stopped', step: 0 }).detail, /第一轮还没发起/u)

  // 负断言（批次77 任务4 立的那条不动）：词表外的段型既进不了轨迹，也描不出一行。
  assert.equal(sanitizeTrailEvent({ stage: 'model-thinking', step: 1 }), null)
  assert.equal(describeTrailEvent({ stage: 'model-thinking', step: 1 }), null)
})
