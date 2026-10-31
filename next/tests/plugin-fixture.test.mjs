import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { validateCarrierManifest } from '../kernel/carrierManifest.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { createRuntimeSurface } from '../runtime/mcpSurface.mjs'
import { connectInProcess } from '../runtime/transportInProcess.mjs'
import { resolveMcpSpec } from '../runtime/mcpClient.mjs'
import { collectPluginDirs } from '../runtime/pluginDirs.mjs'
import { collectAgentMdBlocks } from '../runtime/contextProfiles.mjs'
import { createPluginFileHandler, PLUGIN_FILE_STATUS } from '../shell/pluginFileServer.mjs'
import { PLUGIN_PROTOCOL } from '../shell/pluginProtocol.mjs'
import {
  DEMO_PLUGIN,
  DEMO_PLUGIN_DIR,
  DEMO_PLUGIN_ID,
  DEMO_PLUGIN_IMPL,
  DEMO_PLUGIN_META
} from '../testing/fixtures/plugin-demo/manifest.mjs'

/**
 * 协议 v3 的整链验收：一份真清单，四张牌逐张跑通。
 *
 * 夹具插件住在 next/testing/fixtures/plugin-demo/，它不是产品的一部分——
 * 但它必须是一份**真清单**：过同一份校验器、走同一份注册表、由宿主真起子进程、
 * 真连外部 MCP、真从插件目录供面板页、真把作者须知并进上下文。
 * 验的是链路，不是这个插件本身。
 *
 * 五段：
 *   1) 清单与注册：同一份校验器 + 注册表登记插件目录；
 *   2) 激活：四张牌都进 view（面板与 entry 成对）；
 *   3) 相对路径解析：基准是插件目录，裸命令名留给 PATH，目录外的一律不改；
 *   4) 运行面：宿主真起服务（端口探针）+ 真连 stdio MCP（相对路径）+ 真连 sse MCP；
 *   5) 资产：面板页从插件目录供出、AGENT.md 进上下文块。
 */

const SSE_FIXTURE = fileURLToPath(new URL('../testing/fixtures/mcpSseServer.mjs', import.meta.url))

function installDemo() {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const installed = registry.install(DEMO_PLUGIN, DEMO_PLUGIN_IMPL, DEMO_PLUGIN_META)
  assert.equal(installed.ok, true, `夹具插件装不进注册表：${JSON.stringify(installed.error ?? {})}`)
  return registry
}

function activateDemo(registry) {
  const activation = registry.activate({ primary: DEMO_PLUGIN_ID, enabled: [DEMO_PLUGIN_ID] })
  assert.equal(activation.ok, true, `激活不过：${JSON.stringify(activation.error ?? {})}`)
  return activation.value
}

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

function httpGet(port, path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 3_000 }, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          resolvePromise(JSON.parse(body))
        } catch (error) {
          rejectPromise(error)
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('超时')))
    req.on('error', rejectPromise)
  })
}

/** 起夹具 SSE 服务端，等它自己报出 LISTENING:<port> 再算起来。 */
function startSseFixture(port) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SSE_FIXTURE], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let buffer = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectPromise(new Error(`SSE 夹具 5 秒内没报出监听端口：${buffer.slice(0, 400)}`))
    }, 5_000)
    timer.unref?.()
    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const match = /LISTENING:(\d+)/u.exec(buffer)
      if (!match) return
      clearTimeout(timer)
      resolvePromise({ child, port: Number.parseInt(match[1], 10) })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      rejectPromise(error)
    })
  })
}

test('清单与注册：同一份校验器过、注册表装得下、插件目录登记在册', () => {
  const validation = validateCarrierManifest(DEMO_PLUGIN, { kinds: Object.keys(PROJECT_KINDS) })
  assert.equal(validation.ok, true, `清单不过校验：${JSON.stringify(validation.error ?? {})}`)
  assert.equal(validation.value.spec, 'pinax-carrier@3')
  assert.equal(validation.value.manifestVersion, 3)

  const registry = installDemo()
  assert.equal(registry.dirOf(DEMO_PLUGIN_ID), DEMO_PLUGIN_DIR, '宿主得知道这个插件的目录在哪（相对路径的基准）')
  assert.equal(registry.ownerOfTool('demo_list'), DEMO_PLUGIN_ID)
})

test('激活：四张牌都进 view，面板与 entry 成对', () => {
  const registry = installDemo()
  const view = activateDemo(registry)
  const manifest = registry.get(DEMO_PLUGIN_ID)

  assert.equal(view.services.length, 1)
  assert.equal(view.services[0].pluginId, DEMO_PLUGIN_ID)
  assert.equal(view.services[0].port, 8971)
  assert.deepEqual(view.services[0].args, ['server.mjs'], '服务脚本写的是相对路径（基准＝插件目录）')

  assert.equal(view.mcp.length, 1)
  assert.equal(view.mcp[0].prefix, 'demo')
  assert.equal(view.mcp[0].transport, 'stdio')

  assert.equal(view.agents.length, 1)
  assert.equal(view.agents[0].path, 'AGENT.md')

  assert.deepEqual(manifest.entry, { kind: 'iframe', path: 'ui/index.html' })
  const custom = manifest.panes.find((pane) => pane.view === 'pinax.view.custom')
  assert.ok(custom, '带自定义视图的 pane 必须在清单里')
  assert.equal(custom.kind, 'custom-panel')
  assert.equal(custom.slot, 'overlay')
})

test('相对路径解析：基准是插件目录；裸命令名留给 PATH；解析出目录外的一律不改', () => {
  const registry = installDemo()
  // 插件目录表必须真的查到目录——查不到的话，相对路径就没有基准（这一条曾经整个是空的）。
  const dirs = collectPluginDirs({ registry })
  assert.equal(dirs[DEMO_PLUGIN_ID], DEMO_PLUGIN_DIR)

  const resolved = resolveMcpSpec({ command: process.execPath, args: ['mcp.mjs'] }, DEMO_PLUGIN_DIR)
  assert.equal(resolved.args[0], join(DEMO_PLUGIN_DIR, 'mcp.mjs'), '插件目录里的脚本要解析到插件目录里')
  assert.equal(resolved.cwdResolved, DEMO_PLUGIN_DIR, '子进程的工作目录就是插件目录')

  const bare = resolveMcpSpec({ command: 'node', args: ['--version'] }, DEMO_PLUGIN_DIR)
  assert.equal(bare.command, 'node', '裸命令名交给 PATH 去找，不当成路径拼')
  assert.deepEqual(bare.args, ['--version'])

  const outside = resolveMcpSpec({ command: process.execPath, args: ['../../secret.mjs'] }, DEMO_PLUGIN_DIR)
  assert.equal(outside.args[0], '../../secret.mjs', '解析得出插件目录之外的相对路径原样留着，不替作者改语义')

  const noDir = resolveMcpSpec({ command: 'node', args: ['mcp.mjs'] }, null)
  assert.equal(noDir.args[0], 'mcp.mjs', '没有插件目录就原样返回——不猜基准')
  assert.equal(noDir.cwdResolved, undefined)
})

test('运行面：宿主真起服务（端口探针）、真连 stdio MCP，工具进面且调得动', async () => {
  const registry = installDemo()
  const view = activateDemo(registry)
  const port = await freePort()
  // 清单里的端口写死是为了「清单本身可读」；测试期换一个空闲端口，免得撞上别的进程。
  // 其余字段（命令、相对脚本路径、健康路径）原样不动。
  view.services = view.services.map((service) => ({ ...service, port }))
  // 监督器把端口写进 PORT 环境变量；环境里若已有 PORT 会盖掉它，这里先摘干净。
  const savedPort = process.env.PORT
  delete process.env.PORT

  const runtime = createAgentRuntime({ registry, fileService: null, view })
  const started = await runtime.start()
  try {
    assert.equal(started.ok, true, JSON.stringify(started.error ?? {}))
    assert.equal(started.value.services, 1)
    assert.equal(started.value.serviceFailures, 0)

    const status = runtime.serviceStatus()[0]
    assert.equal(status.status, 'ready', `服务没就绪：${status.error ?? ''}`)
    assert.equal(status.port, port)
    assert.equal(status.health.ok, true)
    assert.ok(status.pid > 0, '要拿到子进程 pid')

    // 服务真的在监听（不是「状态说就绪」）：直接问它一句。
    const who = await httpGet(port, '/whoami')
    assert.equal(who.ok, true)
    assert.equal(who.pluginId, DEMO_PLUGIN_ID)
    assert.equal(who.port, port)

    // 外部 MCP（stdio）：清单写的是相对脚本路径，落地到插件目录里那一份。
    assert.equal(started.value.externalServers, 1)
    assert.equal(started.value.externalFailures, 0, JSON.stringify(runtime.surfaceInfo().external.failures))
    const names = runtime.listTools().map((tool) => tool.name)
    assert.ok(names.includes('demo.demo_ping'), '外部工具要按 prefix 进面')
    assert.ok(names.includes('demo_list'), '载体自己的工具也在面上')

    const called = await runtime.callTool('demo.demo_ping', { text: '柯秒' })
    assert.equal(called.ok, true, JSON.stringify(called.error ?? {}))
    assert.equal(called.value.owner, DEMO_PLUGIN_ID)
    assert.equal(called.value.payload.pong, '柯秒')

    // 起来的那份确实是插件目录里的 mcp.mjs（工作目录＝插件目录）。
    const whoMcp = await runtime.callTool('demo.demo_who', {})
    assert.equal(whoMcp.ok, true)
    assert.match(whoMcp.value.payload.cwd, /plugin-demo/u)
  } finally {
    await runtime.stop()
    if (savedPort === undefined) delete process.env.PORT
    else process.env.PORT = savedPort
  }
})

test('运行面：外部 MCP 的 sse 那条路——连上、列举、调得动', async () => {
  const port = await freePort()
  const { child, port: listening } = await startSseFixture(port)
  let surface = null
  let link = null
  try {
    const registry = installDemo()
    const view = {
      enabled: [],
      mcp: [{
        id: 'sse-fixture',
        pluginId: DEMO_PLUGIN_ID,
        transport: 'sse',
        prefix: 'sse',
        url: `http://127.0.0.1:${listening}/sse`
      }]
    }
    assert.equal(listening, port)
    surface = await createRuntimeSurface({ registry, view, fileService: null, mcpOptions: { timeoutMs: 10_000 } })
    assert.equal(surface.external.count, 1)
    assert.deepEqual(surface.external.failures, [], 'sse 连上了就不该有失败记账')
    assert.deepEqual(surface.external.toolNames.sort(), ['sse.sse_echo', 'sse.sse_who'])

    link = await connectInProcess(surface.server, { clientName: 'plugin-fixture-test' })
    const names = (await link.listTools()).map((tool) => tool.name)
    assert.ok(names.includes('sse.sse_echo'))
    const called = await link.callTool('sse.sse_echo', { text: '大梦' })
    assert.equal(called.ok, true, JSON.stringify(called.error ?? {}))
    assert.deepEqual(called.payload, { ok: true, text: '大梦' })
  } finally {
    if (link) await link.close()
    if (surface) await surface.external.close()
    child.kill()
  }
})

test('资产：面板页从插件目录供出（协议 URL），AGENT.md 进上下文块', async () => {
  const handler = createPluginFileHandler({
    resolvePluginDir: (id) => (id === DEMO_PLUGIN_ID ? DEMO_PLUGIN_DIR : null)
  })
  const page = await handler(`${PLUGIN_PROTOCOL}://${DEMO_PLUGIN_ID}/ui/index.html`)
  assert.equal(page.status, PLUGIN_FILE_STATUS.ok)
  assert.match(String(page.body), /演示面板/)
  const script = await handler(`${PLUGIN_PROTOCOL}://${DEMO_PLUGIN_ID}/ui/panel.js`)
  assert.equal(script.status, PLUGIN_FILE_STATUS.ok)
  assert.equal(script.contentType, 'text/javascript; charset=utf-8')

  const registry = installDemo()
  const collected = await collectAgentMdBlocks({
    registry,
    view: { enabled: [DEMO_PLUGIN_ID], primary: DEMO_PLUGIN_ID }
  })
  assert.deepEqual(collected.warnings, [])
  assert.equal(collected.blocks.length, 1)
  assert.equal(collected.blocks[0].kind, 'agent-md')
  assert.equal(collected.blocks[0].priority, 1100)
  assert.deepEqual(collected.blocks[0].sourceRefs, [`agentmd:${DEMO_PLUGIN_ID}/AGENT.md`])
  assert.match(collected.blocks[0].content, /演示载体/)
})
