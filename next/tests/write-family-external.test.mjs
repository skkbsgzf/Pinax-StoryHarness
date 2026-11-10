import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createPinaxMcpServer } from '../../server/mcp/createMcpServer.js'
import { createAggregatedMcpServer, recentWriteCalls } from '../runtime/surfaceAggregate.mjs'
import { connectMcpServer } from '../runtime/mcpClient.mjs'
import { connectInProcess } from '../runtime/transportInProcess.mjs'
import { createWritePolicy } from '../runtime/writePolicy.mjs'
import { CARRIER_WRITE_CLASS, KERNEL_WRITE_CLASS } from '../runtime/kernelWriteGuard.mjs'

/**
 * 写族闸收口（批次45 · 任务②）：外部 MCP 的写口不再绕过 review 策略。
 *
 * 真起 stdio 夹具（含 echo_save），走聚合面的 `prefix.` 命名空间：
 *   review 档 → 策略出 tool-call 提案，远端调用计数器保持 0；
 *   auto 档   → 直执行，远端计数器 +1，审计缓冲留下该调用；
 *   载体分支  → annotations.readOnlyHint === false 的调用进审计，读工具不进；
 * 审计环只记账：不拦调用、不改返回。
 */
const FIXTURE = fileURLToPath(new URL('../testing/fixtures/mcpEchoServer.mjs', import.meta.url))
const LANDING = { ...KERNEL_WRITE_CLASS, ...CARRIER_WRITE_CLASS }
const EXTERNAL_PLUGIN = 'pinax.fixture.external'

async function startFixtureSurface() {
  const client = await connectMcpServer({
    id: 'write-family-fixture',
    pluginId: EXTERNAL_PLUGIN,
    transport: 'stdio',
    prefix: 'fixture',
    command: process.execPath,
    args: [FIXTURE]
  }, { timeoutMs: 10_000, reconnect: false })
  assert.equal(client.status(), 'ready', JSON.stringify(client.info()))

  // 远端执行计数器：包在真实 callTool 外面，只为回答「这次调用到底有没有打出去」。
  let remoteCalls = 0
  const call = client.callTool.bind(client)
  client.callTool = async (name, args) => {
    remoteCalls += 1
    return call(name, args)
  }

  const kernelServer = createPinaxMcpServer({ name: 'pinax-write-family-test' })
  const aggregated = await createAggregatedMcpServer({
    kernelServer,
    externalClients: [client],
    name: 'pinax-write-family-test'
  })
  const link = await connectInProcess(aggregated.server, { clientName: 'write-family-test' })
  return { client, link, remoteCalls: () => remoteCalls }
}

function auditFor(tool) {
  return recentWriteCalls().filter((entry) => entry.tool === tool)
}

test('review 档：外部 _save 工具出 tool-call 提案，远端未执行、审计不记', async () => {
  const { client, link, remoteCalls } = await startFixtureSurface()
  try {
    const proposals = []
    const policy = createWritePolicy({
      mode: 'review',
      landing: LANDING,
      createProposal: async (request) => {
        proposals.push(request)
        return { ok: true, value: { id: 'p-ext', name: 'p-ext.json' } }
      }
    })

    const decided = await policy.beforeTool({ name: 'fixture.echo_save', arguments: { text: '提案' } })
    assert.equal(decided.kind, 'proposal', '外部写口必须转提案')
    assert.equal(decided.proposal.id, 'p-ext')
    assert.deepEqual(proposals, [{ tool: 'fixture.echo_save', args: { text: '提案' }, dir: null }])

    assert.equal(remoteCalls(), 0, '审阅档下远端一次都不许打出去')
    assert.deepEqual(auditFor('fixture.echo_save'), [], '没执行就没有审计记录')
  } finally {
    await link.close()
    await client.close()
  }
})

test('auto 档：外部 _save 工具直执行，返回原样，审计缓冲记下归属与参数摘要', async () => {
  const { client, link, remoteCalls } = await startFixtureSurface()
  try {
    const policy = createWritePolicy({ mode: 'auto', landing: LANDING })
    const decided = await policy.beforeTool({ name: 'fixture.echo_save', arguments: { text: '落盘' } })
    assert.equal(decided.kind, 'allow')

    const called = await link.callTool('fixture.echo_save', { text: '落盘' })
    assert.equal(called.ok, true)
    assert.deepEqual(called.payload, { ok: true, text: '落盘' })
    assert.equal(remoteCalls(), 1, '自动档直执行一次')

    const recorded = auditFor('fixture.echo_save')
    assert.equal(recorded.length, 1)
    assert.equal(recorded[0].owner, EXTERNAL_PLUGIN, 'owner 取声明它的插件（与 agentRuntime.ownerOf 同源）')
    assert.match(recorded[0].argsSummary, /落盘/u)
    assert.equal(typeof recorded[0].at, 'number')
  } finally {
    await link.close()
    await client.close()
  }
})

test('审计只记写族：外部读口不进缓冲', async () => {
  const { client, link } = await startFixtureSurface()
  try {
    const called = await link.callTool('fixture.echo', { text: '读' })
    assert.equal(called.ok, true)
    assert.deepEqual(auditFor('fixture.echo'), [], '读口不该进写族审计')
  } finally {
    await link.close()
    await client.close()
  }
})

test('载体分支：annotations 声明写盘的调用进审计，读工具不进，返回不变', async () => {
  const carrierMap = new Map([
    ['pinax_audit_fixture_save', {
      pluginId: 'pinax.carrier.audit',
      tool: {
        name: 'pinax_audit_fixture_save',
        description: '审计靶子（写）',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        annotations: { readOnlyHint: false },
        run: async (args) => ({ ok: true, value: { echoed: args.text } })
      }
    }],
    ['pinax_audit_fixture_read', {
      pluginId: 'pinax.carrier.audit',
      tool: {
        name: 'pinax_audit_fixture_read',
        description: '审计靶子（读）',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        run: async () => ({ ok: true, value: { read: true } })
      }
    }]
  ])
  const kernelServer = createPinaxMcpServer({ name: 'pinax-carrier-audit-test' })
  const aggregated = await createAggregatedMcpServer({
    kernelServer,
    carrierMap,
    name: 'pinax-carrier-audit-test'
  })
  const link = await connectInProcess(aggregated.server, { clientName: 'carrier-audit-test' })
  try {
    const written = await link.callTool('pinax_audit_fixture_save', { text: '载体写' })
    assert.equal(written.ok, true)
    assert.deepEqual(written.payload, { ok: true, echoed: '载体写' }, '审计不改变返回值')

    const read = await link.callTool('pinax_audit_fixture_read', {})
    assert.equal(read.ok, true)

    const recorded = auditFor('pinax_audit_fixture_save')
    assert.equal(recorded.length, 1)
    assert.equal(recorded[0].owner, 'pinax.carrier.audit')
    assert.match(recorded[0].argsSummary, /载体写/u)
    assert.deepEqual(auditFor('pinax_audit_fixture_read'), [], '读工具不进写族审计')
  } finally {
    await link.close()
  }
})
