import test from 'node:test'
import assert from 'node:assert/strict'
import { createInterceptorChain, createWriteAuditInterceptor, createWriteGuardInterceptor } from '../runtime/toolInterceptors.mjs'
import { classifyExternalTool, createWritePolicy } from '../runtime/writePolicy.mjs'
import { createToolLoop } from '../runtime/toolLoop.mjs'
import { createKitToolTurn } from '../runtime/toolTurn.mjs'
import { createServiceLogPool } from '../runtime/serviceLogPool.mjs'
import { connectMcpServer } from '../runtime/mcpClient.mjs'

/**
 * 工具执行拦截点（批次50）。
 *
 * 四条要钉死的事：
 *   1) 链的语义——顺序执行、否决短路、after 只记账不改结果；
 *   2) 写族判定以 annotations 为准，后缀只在「两者全无声明」时兜底并记账；
 *   3) 两个内置消费者真接上：写族闸进 runBefore，提交类审计进 runAfter；
 *   4) 两个执行处（toolLoop / toolTurn）都走同一条链，不新建第二条执行路。
 */

function tool(name, annotations) {
  return { name, description: name, inputSchema: { type: 'object', properties: {} }, ...(annotations ? { annotations } : {}) }
}

test('链语义：before 顺序执行，否决后后面拿不到调用；after 不改结果', async () => {
  const seen = []
  const chain = createInterceptorChain({
    interceptors: [
      {
        name: 'first',
        before: ({ name, args }) => {
          seen.push(`first:${name}`)
          return { args: { ...args, injected: true } }
        }
      },
      {
        name: 'second',
        before: ({ name, args }) => {
          seen.push(`second:${name}:${args.injected === true}`)
          return { veto: true, reason: '到此为止', code: 'STOP_HERE' }
        }
      },
      {
        name: 'third',
        before: ({ name }) => { seen.push(`third:${name}`) },
        after: ({ name }) => { seen.push(`after:${name}`) }
      }
    ]
  })

  const before = await chain.runBefore('fixture.tool', { a: 1 }, {})
  assert.equal(before.veto, true)
  assert.equal(before.code, 'STOP_HERE')
  assert.equal(before.reason, '到此为止')
  assert.deepEqual(before.args, { a: 1, injected: true }, '被否决时也要能看到前面拦截器改写后的参数')
  assert.deepEqual(seen, ['first:fixture.tool', 'second:fixture.tool:true'], '被否决的调用不交给后面的 before，也不触发 after')
  assert.deepEqual(before.ran, ['first', 'second'])

  const result = { ok: true, value: { x: 1 } }
  const after = await chain.runAfter('fixture.tool', result, {})
  assert.equal(after, result, 'runAfter 返回原对象')
  assert.deepEqual(after, { ok: true, value: { x: 1 } }, '审计不改变执行结果')
  assert.deepEqual(seen.slice(2), ['after:fixture.tool'])
})

test('annotations 优先于后缀：只声明 readOnlyHint:true 的 fake_save 在只读档被判读放行', async () => {
  const LANDING = {}
  const policy = createWritePolicy({ mode: 'blocked', landing: LANDING })
  const chain = createInterceptorChain({ interceptors: [createWriteGuardInterceptor({ policy })] })
  const ctx = { tools: [tool('fixture.fake_save', { readOnlyHint: true })] }

  const decided = await chain.runBefore('fixture.fake_save', { text: '读' }, ctx)
  assert.equal(decided.veto, false, '名字带 _save 只是后缀；annotations 说只读就必须判读')
  assert.equal(decided.guardDecision.write, false)
  assert.equal(decided.guardDecision.source, 'annotations')
  assert.equal(decided.guardDecision.fallback, undefined, 'guardDecision 不复制内部 fallback 字段')

  const classified = classifyExternalTool('fixture.fake_save', { readOnlyHint: true })
  assert.equal(classified.write, false)
  assert.equal(classified.source, 'annotations')
  assert.equal(classified.fallback, false)
})

test('两者全无声明：后缀兜底判写，并经公共池记一条 warn（重复调用只记一次）', async () => {
  const pool = createServiceLogPool()
  const policy = createWritePolicy({ mode: 'blocked', landing: {}, serviceLogPool: pool })
  const chain = createInterceptorChain({ interceptors: [createWriteGuardInterceptor({ policy })] })
  const ctx = { tools: [tool('fixture.echo_save')] }

  const first = await chain.runBefore('fixture.echo_save', { text: '写' }, ctx)
  assert.equal(first.veto, true)
  assert.equal(first.code, 'WRITE_BLOCKED')
  assert.equal(first.guardDecision.source, 'suffix')
  assert.equal(first.guardDecision.write, true)

  await chain.runBefore('fixture.echo_save', { text: '再写' }, ctx)
  const warns = pool.list({ level: 'warn' }).filter((entry) => entry.data?.tool === 'fixture.echo_save')
  assert.equal(warns.length, 1, '同一把工具的兜底 warn 只记一次')
  assert.match(warns[0].message, /无写声明/u)
  assert.match(warns[0].message, /后缀兜底/u)
  assert.equal(warns[0].data.fallback, 'write')

  // 无后缀的未声明工具：照样兜底（判读），也照样记账——「没声明」本身就是要作者知道的事实。
  const read = await chain.runBefore('fixture.echo', { text: '读' }, { tools: [tool('fixture.echo')] })
  assert.equal(read.veto, false)
  assert.equal(read.guardDecision.source, 'suffix')
  assert.equal(read.guardDecision.write, false)
  const readWarn = pool.list({ level: 'warn' }).find((entry) => entry.data?.tool === 'fixture.echo')
  assert.equal(readWarn?.data?.fallback, 'read')
})

test('destructiveHint:true → 判写；只读档拦下并带 guardDecision', async () => {
  const policy = createWritePolicy({ mode: 'blocked', landing: {} })
  const chain = createInterceptorChain({ interceptors: [createWriteGuardInterceptor({ policy })] })
  const ctx = { tools: [tool('danger.anything', { readOnlyHint: false, destructiveHint: true })] }

  const decided = await chain.runBefore('danger.anything', {}, ctx)
  assert.equal(decided.veto, true)
  assert.equal(decided.guardDecision.write, true)
  assert.equal(decided.guardDecision.destructive, true)
  assert.equal(decided.guardDecision.source, 'annotations')
})

test('toolLoop 接线：否决变成 isError 工具结果，callTool 一次都不打', async () => {
  const calls = []
  const events = []
  const trace = []
  const policy = createWritePolicy({ mode: 'blocked', landing: {} })
  let round = 0
  const loop = createToolLoop({
    turn: async ({ messages }) => {
      trace.push(messages)
      round += 1
      return round === 1
        ? { kind: 'tool_calls', calls: [{ id: 'c1', name: 'fixture.echo_save', arguments: { text: '写' } }] }
        : { kind: 'final_ready', text: '收到' }
    },
    callTool: async (name, args) => { calls.push({ name, args }); return { ok: true } },
    interceptors: createInterceptorChain({ interceptors: [createWriteGuardInterceptor({ policy })] }),
    onEvent: (event) => events.push(event)
  })

  const result = await loop.run({ question: '写一句', tools: [tool('fixture.echo_save')], writeMode: 'blocked' })
  assert.equal(result.kind, 'final')
  assert.deepEqual(calls, [], '被写族闸否决的调用不许打到执行层')
  const toolMessage = trace[1].find((message) => message.role === 'tool')
  assert.equal(toolMessage.parts[0].isError, true)
  assert.match(toolMessage.content, /WRITE_BLOCKED/u)
  assert.ok(events.some((event) => event.stage === 'tool-denied' && event.code === 'WRITE_BLOCKED'))
})

test('toolLoop + 审计环：review 档直执行的提交类工具进池，读工具不进', async () => {
  const pool = createServiceLogPool()
  const policy = createWritePolicy({ mode: 'review', landing: {}, serviceLogPool: pool })
  const calls = []
  let round = 0
  const loop = createToolLoop({
    turn: async () => {
      round += 1
      if (round === 1) {
        return {
          kind: 'tool_calls',
          calls: [
            { id: 'c1', name: 'comfy.comfy_submit', arguments: { prompt_id: 'p1' } },
            { id: 'c2', name: 'comfy.comfy_status', arguments: {} }
          ]
        }
      }
      return { kind: 'final_ready', text: '已提交' }
    },
    callTool: async (name, args) => {
      calls.push({ name, args })
      return { ok: true, value: { payload: { ok: true } } }
    },
    interceptors: createInterceptorChain({
      interceptors: [createWriteGuardInterceptor({ policy }), createWriteAuditInterceptor({ pool })]
    })
  })

  await loop.run({
    question: '出一张图',
    tools: [tool('comfy.comfy_submit', { readOnlyHint: false }), tool('comfy.comfy_status', { readOnlyHint: true })],
    writeMode: 'review'
  })

  assert.deepEqual(calls.map((call) => call.name), ['comfy.comfy_submit', 'comfy.comfy_status'], '提交类直执行，读工具直执行')
  const audits = pool.list({ kind: 'mcp' }).filter((entry) => entry.data?.tool === 'comfy.comfy_submit')
  assert.equal(audits.length, 1)
  assert.equal(audits[0].level, 'info')
  assert.equal(audits[0].data.mode, 'review')
  assert.match(audits[0].message, /提交类外部工具/u)
  assert.equal(pool.list({ kind: 'mcp' }).some((entry) => entry.data?.tool === 'comfy.comfy_status'), false, '读工具不进提交审计')

  // auto 档直执行是预期行为，不再往池里刷；review 档才是「直执行很反常」的那一档。
  await createInterceptorChain({ interceptors: [createWriteAuditInterceptor({ pool })] })
    .runAfter('comfy.comfy_submit', { ok: true }, { tools: [tool('comfy.comfy_submit', { readOnlyHint: false })], writeMode: 'auto' })
  assert.equal(pool.list({ kind: 'mcp' }).filter((entry) => entry.data?.tool === 'comfy.comfy_submit').length, 1)
})

test('toolTurn 接线：模型回合也过同一条链，否决按错误码上抛', async () => {
  const seen = []
  const turn = createKitToolTurn({
    complete: async () => ({ content: '好', toolCalls: [] }),
    interceptors: createInterceptorChain({
      interceptors: [
        {
          name: 'recorder',
          before: ({ name, ctx }) => { seen.push(`before:${name}:${ctx?.kind}`) },
          after: ({ name, ctx }) => { seen.push(`after:${name}:${ctx?.kind}`) }
        }
      ]
    })
  })
  const result = await turn({ messages: [{ role: 'user', content: '问' }], tools: [tool('pinax_project_context', { readOnlyHint: true })] })
  assert.equal(result.kind, 'final_ready')
  assert.deepEqual(seen, ['before:model.turn:model-turn', 'after:model.turn:model-turn'])

  const blocked = createKitToolTurn({
    complete: async () => ({ content: '不该跑' }),
    interceptors: createInterceptorChain({
      interceptors: [{ name: 'gate', before: () => ({ veto: true, reason: '回合被拦', code: 'TURN_VETOED' }) }]
    })
  })
  await assert.rejects(
    () => blocked({ messages: [{ role: 'user', content: '问' }], tools: [tool('pinax_project_context', { readOnlyHint: true })] }),
    (error) => error.code === 'TURN_VETOED' && /回合被拦/u.test(error.message)
  )
})

test('mcpClient：连上后把工具 annotations 归一挂进元数据', async () => {
  const serverCode = [
    "import { Server } from '@modelcontextprotocol/sdk/server/index.js'",
    "import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'",
    "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
    "const server = new Server({ name: 'ann-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })",
    "server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [",
    "  { name: 'fake_save', description: '只读却叫 save', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, destructiveHint: false, title: '只读靶子' } },",
    "  { name: 'plain_write', description: '没有声明', inputSchema: { type: 'object', properties: {} } }",
    "] }))",
    "server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }))",
    "await server.connect(new StdioServerTransport())"
  ].join('\n')

  const client = await connectMcpServer({
    id: 'annotations-fixture',
    pluginId: 'pinax.fixture.annotations',
    transport: 'stdio',
    prefix: 'ann',
    command: process.execPath,
    args: ['--input-type=module', '-e', serverCode],
    cwdResolved: process.cwd()
  }, { timeoutMs: 10_000, reconnect: false })

  try {
    assert.equal(client.status(), 'ready', JSON.stringify(client.info()))
    const tools = client.listTools()
    const fake = tools.find((item) => item.name === 'fake_save')
    assert.deepEqual(fake.annotations, { readOnlyHint: true, destructiveHint: false, title: '只读靶子' })
    const plain = tools.find((item) => item.name === 'plain_write')
    assert.equal('annotations' in plain, false, '没有任何布尔声明就不挂 annotations（别拿空对象冒充有声明）')

    const snapshotTool = client.info().tools.find((item) => item.name === 'fake_save')
    assert.equal(snapshotTool.annotations.readOnlyHint, true, '状态快照也带 annotations')
  } finally {
    await client.close()
  }
})
