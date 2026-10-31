import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { connectInProcess } from '../runtime/transportInProcess.mjs'
import { connectMcpServer, connectMcpServers } from '../runtime/mcpClient.mjs'
import { createRuntimeSurface } from '../runtime/mcpSurface.mjs'

/**
 * 外部 MCP（协议 v3）单测：真起一个 stdio 夹具服务端，走完「连上 → 列举 → 调用 → 收尸」。
 * 不接真 ComfyUI／真远端：只验传输与命名空间这条链本身。
 */
const FIXTURE = fileURLToPath(new URL('../testing/fixtures/mcpEchoServer.mjs', import.meta.url))

function stdioSpec(overrides = {}) {
  return {
    id: 'fixture-echo',
    pluginId: 'demo.v3',
    transport: 'stdio',
    prefix: 'fixture',
    command: process.execPath,
    args: [FIXTURE],
    ...overrides
  }
}

test('stdio：连上夹具、列举四把、调 echo 回显、close 后状态为 closed', async () => {
  const client = await connectMcpServer(stdioSpec(), { timeoutMs: 10_000 })
  try {
    assert.equal(client.status(), 'ready', JSON.stringify(client.info()))
    const names = client.listTools().map((tool) => tool.name).sort()
    // 批次45：夹具新增 echo_save（写口命名靶子），列举面从三把变四把。
    assert.deepEqual(names, ['add', 'echo', 'echo_save', 'ignored_tool'])

    const echoed = await client.callTool('echo', { text: '柯秒' })
    assert.equal(echoed.ok, true)
    assert.deepEqual(echoed.payload, { ok: true, text: '柯秒' })

    const added = await client.callTool('add', { a: 2, b: 3 })
    assert.equal(added.payload.sum, 5)
  } finally {
    await client.close()
  }
  assert.equal(client.status(), 'closed')
})

test('allow：清单只放行指定远端工具，其余留在 skipped 记账里', async () => {
  const client = await connectMcpServer(stdioSpec({ allow: ['echo'] }), { timeoutMs: 10_000 })
  try {
    assert.deepEqual(client.listTools().map((tool) => tool.name), ['echo'])
    const added = await client.callTool('add', { a: 1, b: 1 })
    // allow 只是「不挂进面」；直接调用仍由服务端回答——面外的名字在聚合层已经不可达。
    assert.equal(added.ok, true)
  } finally {
    await client.close()
  }
})

test('连不上不抛错：失败的 sse 客户端带状态返回，批量连接只记账', async () => {
  const dead = await connectMcpServer({ id: 'dead-sse', transport: 'sse', prefix: 'dead', url: 'http://127.0.0.1:9/sse' }, { timeoutMs: 500, reconnect: false })
  assert.equal(dead.status(), 'failed')
  assert.ok(dead.info().error)

  // 批连接的 timeout 给足 5s：这一批里混着要真起一个 node 子进程的 stdio 夹具，
  // 整机负载高时 500ms 够不到握手，夹具会被误判成失败（failures 变成 2）。
  // 这条用例要验的是「哪台失败只记账、其余照常连上」，不是 timeout 有多短。
  const { clients, failures } = await connectMcpServers([stdioSpec(), { id: 'dead-sse', transport: 'sse', prefix: 'dead', url: 'http://127.0.0.1:9/sse' }], { timeoutMs: 5000, reconnect: false })
  try {
    assert.equal(clients.length, 2)
    assert.equal(failures.length, 1)
    assert.equal(failures[0].id, 'dead-sse')
  } finally {
    for (const client of clients) await client.close()
  }
})

test('聚合面：外部工具以 <prefix>.<name> 进面，调用经 MCP 链路原样返回', async () => {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const view = { enabled: [], mcp: [stdioSpec()] }
  const surface = await createRuntimeSurface({ registry, view, fileService: null, mcpOptions: { timeoutMs: 10_000 } })
  const link = await connectInProcess(surface.server, { clientName: 'mcp-client-test' })
  try {
    assert.equal(surface.external.count, 1)
    assert.deepEqual(surface.external.failures, [])
    const names = (await link.listTools()).map((tool) => tool.name)
    assert.ok(names.includes('fixture.echo'), '外部工具要进聚合面')
    assert.ok(names.includes('fixture.add'))
    assert.ok(names.includes('fixture.echo_save'), '写口命名的远端工具同样进面（策略层才拦）')
    const called = await link.callTool('fixture.echo', { text: '大梦' })
    assert.equal(called.ok, true)
    assert.deepEqual(called.payload, { ok: true, text: '大梦' })
  } finally {
    await link.close()
    await surface.external.close()
  }
})
