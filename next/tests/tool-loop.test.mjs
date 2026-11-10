import test from 'node:test'
import assert from 'node:assert/strict'
import { absorbUsage, createToolLoop, createUsageTally, usageOf } from '../runtime/toolLoop.mjs'
import { createWritePolicy } from '../runtime/writePolicy.mjs'
import { CARRIER_WRITE_CLASS, KERNEL_WRITE_CLASS } from '../runtime/kernelWriteGuard.mjs'

/**
 * 工具循环（M2.5-A · 任务四）。
 * 六条：收工、执行后再收工、拒绝可被模型看到、提案按成功回、步数耗尽不编总结、坏调用不炸整轮。
 */

const TOOLS = [{ name: 'pinax_outline_read', description: '读大纲', inputSchema: { type: 'object', properties: {} } }]

function scriptedTurn(responses) {
  const seen = []
  let index = 0
  return {
    seen,
    async turn({ messages, tools }) {
      seen.push({ messages: JSON.parse(JSON.stringify(messages)), tools })
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      return response
    }
  }
}

test('模型直接收工：不执行任何工具', async () => {
  const turn = scriptedTurn([{ kind: 'final_ready', text: '大纲一共三卷。' }])
  let called = 0
  const loop = createToolLoop({ turn: turn.turn, callTool: async () => { called += 1; return { ok: true } } })
  const result = await loop.run({ question: '大纲什么样', tools: TOOLS })
  assert.equal(result.kind, 'final')
  assert.equal(result.text, '大纲一共三卷。')
  assert.equal(called, 0)
})

test('一次工具调用后再收工：工具结果进了下一轮消息', async () => {
  const turn = scriptedTurn([
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'pinax_outline_read', arguments: { file: 'outline.json' } }] },
    { kind: 'final_ready', text: '读完发现两处重复支线。' }
  ])
  const seenCalls = []
  const loop = createToolLoop({
    turn: turn.turn,
    callTool: async (name, args) => {
      seenCalls.push({ name, args })
      return { ok: true, value: { payload: { nodes: 3 }, tool: name } }
    }
  })
  const result = await loop.run({ question: '大纲什么样', tools: TOOLS })
  assert.equal(result.text, '读完发现两处重复支线。')
  assert.deepEqual(seenCalls, [{ name: 'pinax_outline_read', args: { file: 'outline.json' } }])
  const second = turn.seen[1].messages
  assert.deepEqual(second.map((message) => message.role), ['user', 'assistant', 'tool'])
  assert.match(second[2].content, /"nodes":3/u)
})

test('策略拒绝：按 isError 工具结果回给模型，循环继续', async () => {
  const turn = scriptedTurn([
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'pinax_outline_read', arguments: {} }] },
    { kind: 'final_ready', text: '好的，那我不改了。' }
  ])
  const loop = createToolLoop({
    turn: turn.turn,
    callTool: async () => ({ ok: true }),
    policy: { beforeTool: async () => ({ kind: 'deny', code: 'WRITE_BLOCKED', message: '「正文/」当前为只读' }) }
  })
  const result = await loop.run({ question: '改大纲', tools: TOOLS })
  assert.equal(result.kind, 'final')
  const toolMessage = turn.seen[1].messages[2]
  assert.equal(toolMessage.parts[0].isError, true)
  assert.match(toolMessage.content, /WRITE_BLOCKED/u)
})

test('提案按成功回给模型：ok:true + proposalId，不执行 callTool', async () => {
  const turn = scriptedTurn([
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'pinax_outline_read', arguments: { nodes: [] } }] },
    { kind: 'final_ready', text: '已提交提案，等你确认。' }
  ])
  let called = 0
  const events = []
  const loop = createToolLoop({
    turn: turn.turn,
    callTool: async () => { called += 1; return { ok: true } },
    policy: { beforeTool: async () => ({ kind: 'proposal', proposal: { id: 'p-9', name: 'p-9.json' } }) },
    onEvent: (event) => events.push(event)
  })
  const result = await loop.run({ question: '改大纲', tools: TOOLS })
  assert.equal(called, 0)
  const toolMessage = turn.seen[1].messages[2]
  assert.equal(toolMessage.parts[0].isError, false)
  assert.match(toolMessage.content, /"ok":true/u)
  assert.match(toolMessage.content, /p-9/u)
  assert.ok(events.some((event) => event.stage === 'proposal-created' && event.proposalId === 'p-9'))
  assert.equal(result.kind, 'final')
})

test('步数耗尽：返回 step-budget，text 为空，不编总结', async () => {
  const turn = scriptedTurn([
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'pinax_outline_read', arguments: {} }] }
  ])
  const loop = createToolLoop({ turn: turn.turn, callTool: async () => ({ ok: true }), maxSteps: 2 })
  const result = await loop.run({ question: '一直读', tools: TOOLS })
  assert.equal(result.kind, 'step-budget')
  assert.equal(result.text, '')
  assert.equal(result.steps.length, 2)
})

test('坏调用不炸整轮：callTool 抛错转成 isError 结果', async () => {
  const turn = scriptedTurn([
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'pinax_outline_read', arguments: {} }] },
    { kind: 'final_ready', text: '工具坏了，先看别的。' }
  ])
  const loop = createToolLoop({
    turn: turn.turn,
    callTool: async () => { throw Object.assign(new Error('读盘失败'), { code: 'PINAX_IO_FAILED' }) }
  })
  const result = await loop.run({ question: '读大纲', tools: TOOLS })
  assert.equal(result.kind, 'final')
  const toolMessage = turn.seen[1].messages[2]
  assert.equal(toolMessage.parts[0].isError, true)
  assert.match(toolMessage.content, /PINAX_IO_FAILED/u)
})

test('工具结果超过 7200 字：截断后再进消息', async () => {
  const turn = scriptedTurn([
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'pinax_outline_read', arguments: {} }] },
    { kind: 'final_ready', text: '好' }
  ])
  const loop = createToolLoop({
    turn: turn.turn,
    callTool: async () => ({ ok: true, value: { payload: { text: 'x'.repeat(20_000) } } })
  })
  await loop.run({ question: '读大纲', tools: TOOLS })
  const toolMessage = turn.seen[1].messages[2]
  assert.ok(toolMessage.content.length <= 7200)
  assert.match(toolMessage.content, /已截断/u)
})

test('turn 抛错：上抛（这是模型面故障，不是某次工具调用）', async () => {
  const loop = createToolLoop({
    turn: async () => { throw Object.assign(new Error('模型面不可达'), { code: 'AGENT_PROVIDER_UNREACHABLE' }) },
    callTool: async () => ({ ok: true })
  })
  await assert.rejects(() => loop.run({ question: '问一句', tools: TOOLS }), /模型面不可达/u)
})

/**
 * 批次37 接线级：循环 ＋ 真写策略（不是桩策略）＋ 落点表。
 * 同一把 pinax_chapter_save，会话写模式换一档就该换一种结果；模型在三种档位下都看得到结果，
 * 且 review 档的提案会发 proposal-created（主进程据此推 proposals-changed）。
 */
test('接线级：review 转提案、auto 直写、blocked 被拒，模型都收到结果', async () => {
  const PAUSE = [
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'pinax_chapter_save', arguments: { file: '正文/雨夜.md', text: '新文', expectedRevision: 2 } }] },
    { kind: 'final_ready', text: '收到。' }
  ]
  const LANDING = { ...KERNEL_WRITE_CLASS, ...CARRIER_WRITE_CLASS }
  async function runMode(mode) {
    const turn = scriptedTurn(PAUSE)
    const writes = []
    const proposals = []
    const events = []
    const loop = createToolLoop({
      turn: turn.turn,
      callTool: async (name, args) => {
        writes.push({ name, args })
        return { ok: true, value: { payload: { ok: true, revision: 3 } } }
      },
      policy: ({ writeMode }) => createWritePolicy({
        mode: writeMode,
        landing: LANDING,
        createProposal: async (request) => {
          proposals.push(request)
          return { ok: true, value: { id: 'p-37', name: 'p-37.json' } }
        }
      }),
      onEvent: (event) => events.push(event)
    })
    const result = await loop.run({
      question: '把雨提前',
      tools: [...TOOLS, { name: 'pinax_chapter_save', description: '保存章节', inputSchema: { type: 'object', properties: {} } }],
      writeMode: mode
    })
    return { result, turn, writes, proposals, events }
  }

  const review = await runMode('review')
  assert.equal(review.writes.length, 0, 'review 档不许直写盘')
  assert.equal(review.proposals.length, 1)
  assert.deepEqual(review.proposals[0].args, { file: '正文/雨夜.md', text: '新文', expectedRevision: 2 })
  assert.equal(review.proposals[0].dir, '正文')
  const reviewToolMessage = review.turn.seen[1].messages[2]
  assert.equal(reviewToolMessage.parts[0].isError, false, '提案按成功回给模型，避免它原地重试')
  assert.match(reviewToolMessage.content, /p-37/u)
  assert.ok(review.events.some((event) => event.stage === 'proposal-created' && event.proposalId === 'p-37'))

  const auto = await runMode('auto')
  assert.equal(auto.writes.length, 1, 'auto 档直接写')
  assert.equal(auto.proposals.length, 0)
  assert.equal(auto.turn.seen[1].messages[2].content.includes('"revision":3'), true)

  const blocked = await runMode('blocked')
  assert.equal(blocked.writes.length, 0)
  assert.equal(blocked.proposals.length, 0)
  const blockedToolMessage = blocked.turn.seen[1].messages[2]
  assert.equal(blockedToolMessage.parts[0].isError, true)
  assert.match(blockedToolMessage.content, /WRITE_BLOCKED/u)
  assert.equal(blocked.result.kind, 'final', '被拒也要让循环收尾，不挂死')
})

/**
 * 〔批次77 任务2〕token 用量的累计口径：只加真回报，一条都没回报时交出去的是 null。
 * 这不是洁癖——上游（server/services/kitModelGateway.js:225 那条归一）有的网关整块不回 usage，
 * 有的回全 0。落一个 0 到屏上，就等于告诉作者这一轮白跑。字数与 token 不同源，也不许换算。
 */
test('用量累计：两轮各报一次就相加（缺 totalTokens 用 in+out 补），一条都没报时是 null 不是 0', async () => {
  const call = { kind: 'tool_calls', calls: [{ id: 'c1', name: 'pinax_outline_read', arguments: {} }] }
  const turn = scriptedTurn([
    { ...call, usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 } },
    // 第二轮只报 in/out：total 由两者相加补齐（归一口缺 total 时的既有约定）。
    { kind: 'final_ready', text: '大纲一共三卷。', usage: { inputTokens: 300, outputTokens: 80 } }
  ])
  const loop = createToolLoop({ turn: turn.turn, callTool: async () => ({ ok: true }) })
  const result = await loop.run({ question: '大纲什么样', tools: TOOLS })
  assert.equal(result.kind, 'final')
  assert.deepEqual(result.usage, { input: 1200, output: 200, total: 1400, rounds: 2 })

  // 一次回报都没有：usage 必须是 null（chip 据此说「本轮未回报用量」）。
  const silent = scriptedTurn([
    call,
    { kind: 'final_ready', text: '三卷。' }
  ])
  const silentResult = await createToolLoop({ turn: silent.turn, callTool: async () => ({ ok: true }) })
    .run({ question: '大纲什么样', tools: TOOLS })
  assert.equal(silentResult.usage, null, '没回报就交 null，不许落 0 冒充测过')
})

test('用量累计：步数耗尽也要把已发生的那几轮报出来，坏数字与全 0 不进累计', () => {
  // 全 0（网关回了但没数）：算一轮，但不算「有回报」——三条一起看才是真相。
  const tally = createUsageTally()
  absorbUsage(tally, { inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  assert.equal(usageOf(tally), null, '全 0 那一轮不算回报')
  assert.equal(tally.rounds, 1, '轮次照记：这是跑过的一轮，只是没报数')

  // 坏数字（NaN／负数／字符串里的鬼话）：整块忽略，一个字节都不加。
  absorbUsage(tally, { inputTokens: Number.NaN, outputTokens: 5 })
  absorbUsage(tally, { inputTokens: -100, outputTokens: 5 })
  assert.deepEqual({ ...tally }, { input: 0, output: 0, total: 0, rounds: 1, reported: 0 })

  // 真回报进来才开口：之后 usageOf 给出累计值。
  absorbUsage(tally, { inputTokens: 10, outputTokens: 4 })
  assert.deepEqual(usageOf(tally), { input: 10, output: 4, total: 14, rounds: 2 })

  // 步数耗尽那一档：已经报过的轮次不能因为没收尾就丢掉（花了就是花了）。
  // 两轮各报一次不同数额，累计才是这两轮的真相。
  const looping = scriptedTurn([
    { kind: 'tool_calls', calls: [{ id: 'c1', name: 'pinax_outline_read', arguments: {} }], usage: { inputTokens: 500, outputTokens: 60, totalTokens: 560 } },
    { kind: 'tool_calls', calls: [{ id: 'c2', name: 'pinax_outline_read', arguments: {} }], usage: { inputTokens: 300, outputTokens: 40, totalTokens: 340 } }
  ])
  return createToolLoop({ turn: looping.turn, callTool: async () => ({ ok: true }), maxSteps: 2 })
    .run({ question: '一直读', tools: TOOLS })
    .then((result) => {
      assert.equal(result.kind, 'step-budget')
      assert.deepEqual(result.usage, { input: 800, output: 100, total: 900, rounds: 2 })
    })
})
