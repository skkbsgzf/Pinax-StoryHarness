import test from 'node:test'
import assert from 'node:assert/strict'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { connectInProcess, DEFAULT_DRAIN_TIMEOUT_MS, TRANSPORT_CLOSING_CODE, TRANSPORT_CLOSED_CODE, isConnectionClosedError } from '../runtime/transportInProcess.mjs'

/**
 * 批次69：进程内 MCP 链路的关闭语义（drain／拒绝必须有落点／并行压力形态不产未接住的 promise）。
 * 这里故意用一个「慢工具」把在途窗口拉宽——真机上的竞态就是这么来的，只是宽度是毫秒级。
 */

function slowServer({ onHold = null, releaseAfterMs = null } = {}) {
  const server = new Server({ name: 'drain-target', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'fast', description: '立刻回', inputSchema: { type: 'object', properties: {} } },
      { name: 'slow', description: '等人放行', inputSchema: { type: 'object', properties: {} } }
    ]
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = String(request.params?.name ?? '')
    if (name === 'slow') {
      // 缺省＝不放行：这条请求会一直在途，正好用来撞 drain 的上限。
      await new Promise((resolveRelease) => {
        if (typeof onHold === 'function') onHold(resolveRelease)
        else if (Number.isFinite(releaseAfterMs)) setTimeout(resolveRelease, releaseAfterMs)
      })
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, tool: 'slow' }) }] }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, tool: name }) }] }
  })
  return server
}

function deferred() {
  let release = null
  const promise = new Promise((resolveRelease) => {
    release = resolveRelease
  })
  return { promise, release: () => release?.() }
}

function trackUnhandled() {
  const seen = []
  const listener = (reason) => seen.push(String(reason?.message ?? reason))
  process.on('unhandledRejection', listener)
  return { seen, stop: () => process.off('unhandledRejection', listener) }
}

test('drain：在途请求先落定再关链路，报告如实带出等待与计数', async () => {
  const gate = deferred()
  const server = slowServer({ onHold: (resolveRelease) => { gate.promise.then(resolveRelease) } })
  const link = await connectInProcess(server)
  const inflight = link.callTool('slow', {})
  // 等一次微任务，让请求真的进到 SDK 的在途表里。
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  assert.equal(link.inFlightCount(), 1, '慢工具没留在途表里，drain 就无从可等')

  let closed = false
  const closing = link.close().then((report) => {
    closed = true
    return report
  })
  await new Promise((resolveTick) => setTimeout(resolveTick, 20))
  assert.equal(closed, false, '还有在途请求时 close() 不该已经完成（drain 必须在等）')

  gate.release()
  const result = await inflight
  assert.equal(result.ok, true, '在途请求应当正常落定，而不是被关链路打回')
  const report = await closing
  assert.equal(report.closed, true)
  assert.equal(report.pendingAtClose, 1, '报告要如实记着关闭时有多少在途')
  assert.equal(report.forced, 0, 'drain 成功落定＝没有硬关')
  assert.equal(report.errors.length, 0, `关闭链不该有失败：${report.errors.join('；')}`)
  assert.equal(link.inFlightCount(), 0)
})

test('drain 超时：硬关之后调用方拿到失败信封，且全程没有未接住的 promise', async () => {
  const handle = trackUnhandled()
  try {
    const server = slowServer()
    const link = await connectInProcess(server, { drainTimeoutMs: 60 })
    const inflight = link.callTool('slow', {})
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    assert.equal(link.inFlightCount(), 1)

    const report = await link.close()
    assert.equal(report.forced, 1, '超时后必须如实记着「硬关了几条」')
    assert.deepEqual(report.forcedLabels, ['callTool(slow)'])
    assert.ok(report.errors.some((line) => line.includes('drain 超时')), '超时不记账就是掩盖')

    const result = await inflight
    assert.equal(result.ok, false, '被硬关的请求只能以失败落点，不能假装成功')
    assert.equal(result.payload.code, TRANSPORT_CLOSED_CODE)
    assert.match(result.payload.message, /Connection closed|关闭/iu, '原话要留在 message 里，不许糊成一句「失败了」')
    assert.equal(isConnectionClosedError(new Error('MCP error -32000: Connection closed')), true)

    const stats = link.stats()
    assert.equal(stats.converted.length, 1, '每一笔转成信封的拒绝都要留账')
    assert.equal(stats.closed, true)
    // 关掉之后再打：仍然给信封，不抛——这是「拒绝必须有落点」的另一半。
    const after = await link.callTool('fast', {})
    assert.equal(after.ok, false)
    assert.equal(after.payload.code, TRANSPORT_CLOSING_CODE)
    assert.equal(link.stats().rejectedWhileClosing, 1)
    await new Promise((resolveTick) => setTimeout(resolveTick, 20))
    assert.deepEqual(handle.seen, [], `关闭链上冒出了未接住的拒绝：${handle.seen.join('；')}`)
  } finally {
    handle.stop()
  }
})

test('并行压力形态：连发不 await 的调用后再关会话，一条未接住的拒绝都不许浮出', async () => {
  // 这条就是批次61 记的那次偶发的复现形状：外壳 fire-and-forget 的 IPC 在会话关闭后才落地。
  // 区别只在于现在链路的拒绝有落点（信封），所以同一形状不再产 Unhandled Rejection。
  const handle = trackUnhandled()
  try {
    const holds = []
    const server = new Server({ name: 'storm', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'storm', inputSchema: { type: 'object', properties: {} } }] }))
    server.setRequestHandler(CallToolRequestSchema, async () => {
      const gate = deferred()
      holds.push(gate)
      await gate.promise
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }
    })
    const link = await connectInProcess(server, { drainTimeoutMs: 80 })
    const floating = []
    for (let i = 0; i < 24; i += 1) floating.push(link.callTool('storm', {}))
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    assert.ok(link.inFlightCount() > 0, '风暴没打在在途窗口上，这条回归就白测')
    // 一条都不 await，直接关会话——旧形态在这里必然冒 -32000。
    const report = await link.close()
    assert.ok(report.forced > 0, `风暴下 drain 应当超时记账（pendingAtClose=${report.pendingAtClose}）`)
    const settled = await Promise.allSettled(floating)
    assert.equal(settled.filter((item) => item.status === 'rejected').length, 0, '链路对外的 promise 不该有拒绝')
    holds.forEach((gate) => gate.release())
    await new Promise((resolveTick) => setTimeout(resolveTick, 40))
    assert.deepEqual(handle.seen, [], `并行压力形态下冒出未接住的拒绝：${handle.seen.join('；')}`)
  } finally {
    handle.stop()
  }
})

test('缺省预算与非数字预算：缺省 2000ms，脏值回落缺省而不是 0 或 NaN', async () => {
  assert.equal(DEFAULT_DRAIN_TIMEOUT_MS, 2000)
  const server = slowServer()
  const link = await connectInProcess(server, { drainTimeoutMs: '不是数字' })
  const report = await link.close({ drainTimeoutMs: null })
  assert.equal(report.closed, true, '脏预算不该把关闭流程卡死')
  assert.equal(report.forced, 0)
})
