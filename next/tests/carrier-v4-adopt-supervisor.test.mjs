import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { createServiceSupervisor } from '../runtime/serviceSupervisor.mjs'
import { validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import { FIXTURE_V4 } from '../testing/fixtures/carrierV4.mjs'

/**
 * services.adopt（批次52）：外部进程自管，宿主只探活／状态灯／池记账。
 * 这里钉住三件事：不 spawn、端口不通如实 unhealthy、adopt 声明仍须过清单校验
 * （无 command 合法，无 port 拒）。外部进程本身用测试里的 http server 扮演。
 */
function startHealthServer() {
  return new Promise((resolvePromise) => {
    const server = http.createServer((request, response) => {
      response.writeHead(request.url === '/health' ? 200 : 404)
      response.end('ok')
    })
    server.listen(0, '127.0.0.1', () => resolvePromise({ server, port: server.address().port }))
  })
}

function freePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer()
    server.on('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePromise(port))
    })
  })
}

function neverSpawn(counter) {
  return () => {
    counter.calls += 1
    throw new Error('adopt 条目不得 spawn')
  }
}

test('adopt 就绪：只探活、不 spawn；restart 仍是探活；stop 不碰外部进程', async () => {
  const { server, port } = await startHealthServer()
  const counter = { calls: 0 }
  const supervisor = createServiceSupervisor({
    services: [{ id: 'external', pluginId: 'fixture.v4', adopt: true, port, healthPath: '/health' }],
    spawnImpl: neverSpawn(counter),
    healthTimeoutMs: 2_000,
    healthIntervalMs: 100
  })
  try {
    const started = await supervisor.start()
    assert.equal(started.ok, true)
    assert.deepEqual(started.value.started, ['external'])
    assert.equal(counter.calls, 0, 'adopt 条目从 start 起就不得进 spawnService')

    const status = supervisor.status()[0]
    assert.equal(status.adopt, true, '状态面要能区分 adopt 与宿主托管')
    assert.equal(status.status, 'ready')
    assert.equal(status.pid, null, '外部进程不归宿主，pid 必须为空')
    assert.equal(status.health?.ok, true)

    const restarted = await supervisor.restart('external')
    assert.equal(restarted.ok, true)
    assert.equal(supervisor.status()[0].status, 'ready')
    assert.equal(counter.calls, 0, 'restart 也只探活，不拉起进程')
  } finally {
    await supervisor.stop()
  }
  assert.equal(server.listening, true, 'supervisor.stop 不得关闭外部进程')
  assert.equal(supervisor.status()[0].status, 'stopped')
  await new Promise((resolvePromise) => server.close(resolvePromise))
})

test('adopt 端口不通：如实 unhealthy，不重试拉起、不 spawn', async () => {
  const port = await freePort()
  const counter = { calls: 0 }
  const supervisor = createServiceSupervisor({
    services: [{ id: 'missing-external', pluginId: 'fixture.v4', adopt: true, port, healthPath: '/health' }],
    spawnImpl: neverSpawn(counter),
    healthTimeoutMs: 400,
    healthIntervalMs: 100
  })
  try {
    const started = await supervisor.start()
    assert.deepEqual(started.value.started, [])
    assert.equal(started.value.failed.length, 1)
    assert.equal(started.value.failed[0].id, 'missing-external')
    const status = supervisor.status()[0]
    assert.equal(status.status, 'unhealthy')
    assert.match(status.error, /外部服务端口/u)
    assert.equal(counter.calls, 0)
  } finally {
    await supervisor.stop()
  }
})

test('adopt 缺 port：直接失败并说明原因，绝不退回 spawn', async () => {
  const counter = { calls: 0 }
  const supervisor = createServiceSupervisor({
    services: [{ id: 'no-port', pluginId: 'fixture.v4', adopt: true, healthPath: '/health' }],
    spawnImpl: neverSpawn(counter)
  })
  try {
    const started = await supervisor.start()
    assert.deepEqual(started.value.started, [])
    assert.match(started.value.failed[0].error, /port/u)
    assert.equal(supervisor.status()[0].status, 'failed')
    assert.equal(counter.calls, 0)
  } finally {
    await supervisor.stop()
  }
})

test('adopt 声明仍过清单校验：无 command 合法，无 port 拒', () => {
  const accepted = validateCarrierManifest(FIXTURE_V4)
  assert.equal(accepted.ok, true, JSON.stringify(accepted.error ?? {}))
  const service = accepted.value.services[0]
  assert.equal(service.adopt, true)
  assert.equal(service.command, null)
  assert.deepEqual(service.args, [])
  assert.deepEqual(service.env, {})

  const missingPort = JSON.parse(JSON.stringify(FIXTURE_V4))
  delete missingPort.services[0].port
  const rejected = validateCarrierManifest(missingPort)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'PINAX_INVALID_SERVICE')
  assert.match(rejected.error.message, /port/u)
})
