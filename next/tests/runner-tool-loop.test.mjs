import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdvisorRunner } from '../runtime/runnerAdvisor.mjs'

/**
 * 运行器的工具循环接线（M2.5-A · 任务六）。
 *
 * 这一层只证「接上之后谁说话、接不上时谁不变」：
 *   1) 注入 toolLoop 后，runAgent 一次都不许被调，回答只来自循环的 text；
 *   2) 循环的 steps/calls/dropped 如实进 meta，roundsUsed 与 steps 同口径；
 *   3) 步数用尽（step-budget）时给作者的是那句截断说明，不拿空串冒充回答，也不送结构化解析；
 *   4) 不注入 toolLoop 时老路径一字不差（runAgent 收到原样的 taskMeta，含 roundGuard）；
 *   5) 循环自己抛错时按失败上报，错误码取自上游，不吞成成功；
 *   6) 工具面来自 runtime.listTools()，用户消息由 buildUserMessage 真产出（带问题原文）。
 */

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

const SECTIONED_ADVICE = ['摘要', '节奏整体偏慢', '问题', '第三句太长', '动作', '断成两拍'].join('\n')

test('注入 toolLoop：runAgent 不参与，回答与 meta 全部来自循环', async () => {
  const seen = {}
  const loop = {
    async run(input) {
      seen.tools = input.tools
      seen.userMessage = input.buildUserMessage({ question: input.question, envelope: input.envelope })
      input.onEvent?.({ stage: 'step', step: 1 })
      return {
        kind: 'final',
        text: SECTIONED_ADVICE,
        steps: [{ index: 1 }],
        calls: [{ name: 'pinax_chapter_read', result: {} }],
        dropped: []
      }
    }
  }
  const events = []
  let runAgentCalls = 0
  const runner = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    runAgent: async () => {
      runAgentCalls += 1
      throw new Error('注入工具循环后 runAgent 不该被调用')
    },
    toolLoop: loop
  })
  const answer = await runner({
    question: '这一章的开场能再狠一点吗？',
    runtime: fakeRuntime([{ name: 'pinax_chapter_read' }]),
    onEvent: (event) => events.push(event)
  })

  assert.equal(answer.ok, true, JSON.stringify(answer.error ?? {}))
  assert.equal(runAgentCalls, 0, '循环接管这一问，老的单次 runAgent 不应再跑')
  assert.equal(answer.text, '节奏整体偏慢', '结构化解析照常作用于循环产出的那段字')
  assert.deepEqual(seen.tools, [{ name: 'pinax_chapter_read' }], '工具面从 runtime.listTools() 现取')
  assert.ok(seen.userMessage.includes('这一章的开场能再狠一点吗？'), '用户消息里必须带问题原文')
  assert.deepEqual(answer.meta.toolLoop, { kind: 'final', steps: 1, calls: 1, dropped: 0 })
  assert.equal(answer.meta.roundsUsed, 1, 'roundsUsed 与循环步数同口径')
  assert.equal(events.at(-1).roundsUsed, 1)
  assert.equal(events.at(-1).structured, true)
  assert.deepEqual(events.map((event) => event.stage), ['start', 'envelope', 'step', 'answer'], '循环事件与运行器事件走同一条旁路')
})

test('步数用尽：给的是截断说明，不送结构化解析，也不冒充模型回答', async () => {
  const events = []
  const runner = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    runAgent: async () => assert.fail('循环接管时不该调 runAgent'),
    toolLoop: {
      async run() {
        return { kind: 'step-budget', text: '', steps: [{}, {}, {}, {}, {}, {}, {}, {}], calls: [{}, {}], dropped: ['pinax_outline_save'] }
      }
    }
  })
  const answer = await runner({ question: '整本重写一遍', runtime: fakeRuntime(), onEvent: (event) => events.push(event) })

  assert.equal(answer.ok, true, '截断不是失败：这一问确实跑过')
  assert.equal(answer.result, null, '没收敛就没有结构化结果')
  assert.equal(answer.meta.toolLoop.kind, 'step-budget')
  assert.equal(answer.meta.toolLoop.steps, 8)
  assert.equal(answer.meta.toolLoop.dropped, 1)
  assert.equal(answer.meta.roundsUsed, 8)
  assert.match(answer.text, /工具调用已达本轮上限（8 步）/, '截断说明要带真实步数')
  assert.match(answer.meta.resultParsing, /步数用尽/)
  assert.equal(events.at(-1).structured, false)
})

test('不注入 toolLoop：老路径原样（runAgent 收到含 roundGuard 的 taskMeta，轮次照记）', async () => {
  const events = []
  let received = null
  const runner = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    runAgent: async (input) => {
      received = input
      input.taskMeta.roundGuard.acquire('text-model')
      return { advice: SECTIONED_ADVICE, provider: { id: 'text-model' } }
    }
  })
  const answer = await runner({ question: '这一章如何？', runtime: fakeRuntime(), onEvent: (event) => events.push(event) })

  assert.equal(answer.ok, true)
  assert.equal(received.providerId, 'text-model')
  assert.equal(typeof received.taskMeta.roundGuard.acquire, 'function', 'roundGuard 仍由运行器创建并下发')
  assert.equal(answer.meta.roundsUsed, 1)
  assert.equal(answer.meta.toolLoop, undefined, '没注入就不该有 toolLoop 记账')
  assert.deepEqual(events.map((event) => event.stage), ['start', 'envelope', 'model-round', 'answer'])
})

test('循环抛错按失败上报：上游错误码进 failed 事件，不吞成成功', async () => {
  const events = []
  const runner = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    runAgent: async () => assert.fail('循环接管时不该调 runAgent'),
    toolLoop: {
      async run() {
        throw Object.assign(new Error('任务面连接被拒'), { code: 'AGENT_PROVIDER_UNREACHABLE', retryable: true })
      }
    }
  })
  const answer = await runner({ question: '这章行不行？', runtime: fakeRuntime(), onEvent: (event) => events.push(event) })

  assert.equal(answer.ok, false)
  assert.equal(answer.error.message, '任务面连接被拒')
  const failed = events.at(-1)
  assert.equal(failed.stage, 'failed')
  assert.equal(failed.code, 'AGENT_PROVIDER_UNREACHABLE')
  assert.equal(failed.atStage, 'envelope', '循环不占 roundGuard，断点不冒充模型轮')
})
