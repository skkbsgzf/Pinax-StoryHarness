import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { connectMcpServer } from '../runtime/mcpClient.mjs'

/**
 * 批次48 · 任务③1：ComfyUI 桥端到端（夹具在临时端口，绝不碰真 8188）。
 * 证三件事：三把工具在面、status／submit／result 打到 mock、下游不可达时三把都秒回人话错误。
 */
const BRIDGE = fileURLToPath(new URL('../carriers/comic/comfy-mcp-bridge.mjs', import.meta.url))
const MOCK = fileURLToPath(new URL('../testing/fixtures/comfyMock.mjs', import.meta.url))

function startMock() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [MOCK], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let buffer = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectPromise(new Error('mock ComfyUI 没在 10s 内报出端口'))
    }, 10_000)
    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const match = buffer.match(/LISTENING:(\d+)/u)
      if (!match) return
      clearTimeout(timer)
      resolvePromise({ child, port: Number(match[1]) })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      rejectPromise(error)
    })
  })
}

function bridgeSpec(baseUrl) {
  return {
    id: 'comfy',
    pluginId: 'pinax.carrier.comic',
    transport: 'stdio',
    prefix: 'comfy',
    command: process.execPath,
    args: [BRIDGE],
    env: { PINAX_COMFY_URL: baseUrl }
  }
}

/** 一个确定没人听的端口（先占住再放掉），用来验「ComfyUI 没起」。 */
function closedPort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer()
    server.on('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePromise(port))
    })
  })
}

test('桥端到端：列三把工具 → status 打到 mock → submit 回 prompt_id → result 回图片元数据', async () => {
  const mock = await startMock()
  const client = await connectMcpServer(bridgeSpec(`http://127.0.0.1:${mock.port}`), { timeoutMs: 10_000 })
  try {
    assert.equal(client.status(), 'ready', JSON.stringify(client.info()))
    assert.deepEqual(client.listTools().map((tool) => tool.name).sort(), ['comfy_result', 'comfy_status', 'comfy_submit'])

    const status = await client.callTool('comfy_status', {})
    assert.equal(status.ok, true, JSON.stringify(status))
    assert.equal(status.payload.ok, true)
    assert.equal(status.payload.stats.system.comfyui_version, 'mock-0.0.1')

    const submitted = await client.callTool('comfy_submit', { workflow: { 3: { class_type: 'KSampler', inputs: {} } }, client_id: 'pinax-test' })
    assert.equal(submitted.ok, true, JSON.stringify(submitted))
    assert.equal(submitted.payload.prompt_id, 'mock-prompt-1')

    const result = await client.callTool('comfy_result', { prompt_id: 'mock-prompt-1' })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.payload.history.status.completed, true)
    assert.deepEqual(result.payload.images, [{ filename: 'mock.png', subfolder: '', type: 'output' }])
  } finally {
    await client.close()
    mock.child.kill()
  }
})

test('下游不可达：三把工具都回 isError 与人话「ComfyUI 没起或不在 8188」，不挂起', async () => {
  const port = await closedPort()
  const client = await connectMcpServer(bridgeSpec(`http://127.0.0.1:${port}`), { timeoutMs: 10_000 })
  try {
    assert.equal(client.status(), 'ready', 'ComfyUI 没起也不影响桥本身连上：listTools 是静态面')
    const calls = [
      ['comfy_status', {}],
      ['comfy_submit', { workflow: { 1: { class_type: 'Empty' } } }],
      ['comfy_result', { prompt_id: 'nope' }]
    ]
    for (const [name, args] of calls) {
      const answer = await client.callTool(name, args)
      assert.equal(answer.ok, false, `${name} 应回 isError（normalizeToolResult 把 isError 映成 ok:false）`)
      assert.equal(answer.raw.isError, true, `${name} 应标 isError`)
      assert.match(JSON.stringify(answer.payload), /ComfyUI 没起或不在 8188/u, `${name} 应回人话错误`)
    }
  } finally {
    await client.close()
  }
})

test('submitted 工作流在 mock 侧被原样收下（POST /prompt 的 prompt 字段）', async () => {
  const mock = await startMock()
  const client = await connectMcpServer(bridgeSpec(`http://127.0.0.1:${mock.port}`), { timeoutMs: 10_000 })
  try {
    const workflow = { 7: { class_type: 'SaveImage', inputs: { filename_prefix: 'pinax' } } }
    await client.callTool('comfy_submit', { workflow })
    const history = await client.callTool('comfy_result', { prompt_id: 'mock-prompt-1' })
    assert.deepEqual(history.payload.history.prompt, workflow, 'mock 的 /history 回报的 prompt 就是提交的那份')
  } finally {
    await client.close()
    mock.child.kill()
  }
})
