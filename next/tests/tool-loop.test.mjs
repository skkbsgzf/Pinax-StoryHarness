import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolLoop } from '../runtime/toolLoop.mjs'
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
