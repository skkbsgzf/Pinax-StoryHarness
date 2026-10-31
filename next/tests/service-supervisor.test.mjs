import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { createServiceSupervisor } from '../runtime/serviceSupervisor.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'

/**
 * 服务监督器（协议 v3 的 services 面）单测：真起子进程、真探端口、真收尸。
 * 不接真 ComfyUI：只验「起 → 探 → 崩 → 重启 → 收」这条链本身。
 */
const HTTP_FIXTURE = fileURLToPath(new URL('../testing/fixtures/serviceHttp.mjs', import.meta.url))
const CRASH_FIXTURE = fileURLToPath(new URL('../testing/fixtures/serviceCrash.mjs', import.meta.url))
const IDLE_FIXTURE = fileURLToPath(new URL('../testing/fixtures/serviceIdle.mjs', import.meta.url))

function freePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const srv = net.createServer()
    srv.on('error', rejectPromise)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolvePromise(port))
    })
  })
}

test('起服务：探到端口才算就绪，stop 之后进程真的没了', async () => {
  const port = await freePort()
  const supervisor = createServiceSupervisor({
    services: [{
      id: 'http-fixture',
      pluginId: 'demo.v3',
      command: process.execPath,
      args: [HTTP_FIXTURE],
      port,
      healthPath: '/health',
      restart: 'never'
    }]
  })
  try {
    const started = await supervisor.start()
    assert.equal(started.ok, true)
    assert.deepEqual(started.value.started, ['http-fixture'])
    const status = supervisor.status()
    assert.equal(status.length, 1)
    assert.equal(status[0].status, 'ready')
    assert.equal(status[0].port, port)
    assert.ok(status[0].pid > 0, '要拿到子进程 pid')
    assert.equal(status[0].health.ok, true)
    assert.ok(status[0].logs.length >= 0)
  } finally {
    await supervisor.stop()
  }
  const after = supervisor.status()[0]
  assert.equal(after.status, 'stopped')
  assert.equal(after.pid, null)
})

test('端口不通：如实记 unhealthy，不抛、不假报就绪', async () => {
  const port = await freePort()
  const supervisor = createServiceSupervisor({
    services: [{
      id: 'dead-port',
      pluginId: 'demo.v3',
      command: process.execPath,
      args: [IDLE_FIXTURE],
      port,
      healthPath: '/health',
      restart: 'never'
    }],
    healthTimeoutMs: 1_200,
    healthIntervalMs: 200
  })
  const started = await supervisor.start()
  try {
    assert.deepEqual(started.value.started, [])
    assert.equal(started.value.failed.length, 1)
    assert.equal(started.value.failed[0].id, 'dead-port')
    const status = supervisor.status()[0]
    assert.equal(status.status, 'unhealthy')
    assert.ok(status.error.includes(String(port)))
  } finally {
    await supervisor.stop()
  }
})

test('崩溃重启：on-failure 拉起来，never 不拉', async () => {
  const supervisor = createServiceSupervisor({
    services: [{
      id: 'crash-on-failure',
      pluginId: 'demo.v3',
      command: process.execPath,
      args: [CRASH_FIXTURE, '150'],
      restart: 'on-failure'
    }]
  })
  try {
    await supervisor.start()
    await new Promise((r) => setTimeout(r, 1_200))
    const status = supervisor.status()[0]
    assert.ok(status.restarts >= 1, `崩溃后应重启过，实际 restarts=${status.restarts}`)
    assert.ok(['starting', 'ready', 'crashed'].includes(status.status), `状态应如实，实际 ${status.status}`)
  } finally {
    await supervisor.stop()
  }

  const never = createServiceSupervisor({
    services: [{
      id: 'crash-never',
      pluginId: 'demo.v3',
      command: process.execPath,
      args: [CRASH_FIXTURE, '100'],
      restart: 'never'
    }]
  })
  try {
    await never.start()
    await new Promise((r) => setTimeout(r, 800))
    const status = never.status()[0]
    assert.equal(status.restarts, 0)
    assert.ok(['crashed', 'failed'].includes(status.status), `实际 ${status.status}`)
  } finally {
    await never.stop()
  }
})

test('运行时接线：view.services 声明的服务随运行时起停', async () => {
  const port = await freePort()
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const runtime = createAgentRuntime({
    registry,
    fileService: null,
    view: {
      enabled: [],
      services: [{
        id: 'runtime-http',
        pluginId: 'demo.v3',
        command: process.execPath,
        args: [HTTP_FIXTURE],
        port,
        healthPath: '/health',
        restart: 'never'
      }]
    }
  })
  const started = await runtime.start()
  try {
    assert.equal(started.ok, true)
    assert.equal(started.value.services, 1)
    const status = runtime.serviceStatus()
    assert.equal(status.length, 1)
    assert.equal(status[0].id, 'runtime-http')
    assert.equal(status[0].status, 'ready')
  } finally {
    await runtime.stop()
  }
  assert.deepEqual(runtime.serviceStatus(), [])
})
