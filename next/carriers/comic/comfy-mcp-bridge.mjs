#!/usr/bin/env node
/**
 * comic 载体的 ComfyUI MCP 桥（零依赖，单文件）。
 *
 * Next 里第一份**真用 mcp 牌**的内置载体脚本：宿主按清单声明 `command:'node',
 * args:['comfy-mcp-bridge.mjs']` 起它，走换行分隔的 JSON-RPC（stdio）。三条边界：
 *   1) 零 npm 依赖（只 import node:http／node:https），能脱离运行时／内核单独执行；
 *   2) 不落任何文件：submit 只回 prompt_id，result 只回图片元数据，真图片按 refs 由作者搬；
 *   3) ComfyUI 没起也要秒回人话错误：每把工具 4 秒超时，不挂起宿主。
 * 默认地址 http://127.0.0.1:8188（ComfyUI 的本机默认口），PINAX_COMFY_URL 可覆写。
 */
import http from 'node:http'
import https from 'node:https'

const SERVER_INFO = Object.freeze({ name: 'pinax-comfy-bridge', version: '1.0.0' })
const DEFAULT_BASE_URL = 'http://127.0.0.1:8188'
const PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'])
const REQUEST_TIMEOUT_MS = 4_000
const UNREACHABLE = 'ComfyUI 没起或不在 8188'

const TOOLS = Object.freeze([
  {
    name: 'comfy_status',
    title: '探测 ComfyUI',
    description: `读 ComfyUI 的 /system_stats，确认本机 8188 上的 ComfyUI 起没起。只读，不改任何文件；没起时回「${UNREACHABLE}」而不是挂起。`,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'comfy_submit',
    title: '提交工作流',
    description: '把 ComfyUI API 格式的工作流 JSON 提交到 /prompt，回 prompt_id。出图不是写盘：本工具不下载图片、不落任何文件，只把任务交给 ComfyUI。',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['workflow'],
      properties: {
        workflow: { type: 'object', description: 'ComfyUI 的 API 格式工作流（节点 id → 节点定义）。' },
        client_id: { type: 'string', description: '可选：ComfyUI 用来分组事件的 client_id。' }
      }
    },
    annotations: { readOnlyHint: false, openWorldHint: false }
  },
  {
    name: 'comfy_result',
    title: '读取产物元数据',
    description: '按 prompt_id 读 /history/<id>，回任务状态与图片的 filename／subfolder／type。只读元数据，不下载图片、不落文件。',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['prompt_id'],
      properties: { prompt_id: { type: 'string', minLength: 1, description: 'comfy_submit 返回的 prompt_id。' } }
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }
])

const baseUrl = () => String(process.env.PINAX_COMFY_URL || DEFAULT_BASE_URL).replace(/\/+$/u, '')

/** 工具回执的形状：内容一律 JSON 文本；出错时带 isError（宿主把它映成 ok:false）。 */
function textResult(payload, isError = false) {
  const result = { content: [{ type: 'text', text: JSON.stringify(payload) }] }
  if (isError) result.isError = true
  return result
}

/** 下游不可达时三把工具共用的那句人话（宿主／模型都能直接转述给作者）。 */
function failure(error) {
  const detail = error?.code || error?.message || error || '未知错误'
  return textResult({ ok: false, error: `${UNREACHABLE}：${baseUrl()} 连不上（${detail}）` }, true)
}

function requestJson(method, path, body) {
  return new Promise((resolvePromise, rejectPromise) => {
    const url = new URL(`${baseUrl()}${path}`)
    const text = body === undefined ? null : JSON.stringify(body)
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { accept: 'application/json', ...(text ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } : {}) }
    }, (res) => {
      let raw = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        let json = null
        try { json = raw ? JSON.parse(raw) : null } catch { json = null }
        resolvePromise({ status: res.statusCode ?? 0, json, raw })
      })
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('请求超时'), { code: 'ETIMEDOUT' })))
    req.on('error', rejectPromise)
    if (text) req.write(text)
    req.end()
  })
}

/** ComfyUI 的产物散在各节点的 outputs.images 里：只取元数据，不碰图片本身。 */
function imagesOf(history) {
  const images = []
  const outputs = history?.outputs && typeof history.outputs === 'object' ? history.outputs : {}
  for (const node of Object.values(outputs)) {
    for (const image of Array.isArray(node?.images) ? node.images : []) {
      if (!image || typeof image !== 'object') continue
      images.push({ filename: image.filename ?? null, subfolder: image.subfolder ?? '', type: image.type ?? '' })
    }
  }
  return images
}
async function runTool(name, args = {}) {
  if (name === 'comfy_status') {
    const answer = await requestJson('GET', '/system_stats')
    if (answer.status >= 400 || !answer.json) {
      return textResult({ ok: false, error: `ComfyUI 应了但 /system_stats 返回 HTTP ${answer.status}：${String(answer.raw).slice(0, 300)}` }, true)
    }
    return textResult({ ok: true, baseUrl: baseUrl(), stats: answer.json })
  }

  if (name === 'comfy_submit') {
    const workflow = args?.workflow
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
      return textResult({ ok: false, error: 'comfy_submit 需要 workflow 对象（ComfyUI 的 API 格式工作流）' }, true)
    }
    const payload = { prompt: workflow }
    if (typeof args.client_id === 'string' && args.client_id.trim()) payload.client_id = args.client_id.trim()
    const answer = await requestJson('POST', '/prompt', payload)
    if (answer.status >= 400 || !answer.json) {
      return textResult({ ok: false, error: `ComfyUI 拒了这次提交（HTTP ${answer.status}）：${String(answer.raw).slice(0, 500)}` }, true)
    }
    const promptId = answer.json.prompt_id
    if (typeof promptId !== 'string' || !promptId) {
      return textResult({ ok: false, error: 'ComfyUI 没回 prompt_id，这次提交不算成功' }, true)
    }
    return textResult({ ok: true, prompt_id: promptId, number: answer.json.number ?? null, node_errors: answer.json.node_errors ?? null })
  }

  if (name === 'comfy_result') {
    const promptId = typeof args?.prompt_id === 'string' ? args.prompt_id.trim() : ''
    if (!promptId) return textResult({ ok: false, error: 'comfy_result 需要 prompt_id（comfy_submit 的返回值）' }, true)
    const answer = await requestJson('GET', `/history/${encodeURIComponent(promptId)}`)
    if (answer.status >= 400 || !answer.json) {
      return textResult({ ok: false, error: `/history 返回 HTTP ${answer.status}：${String(answer.raw).slice(0, 300)}` }, true)
    }
    const history = answer.json[promptId] ?? null
    if (!history) return textResult({ ok: false, error: `/history 里还没有 ${promptId}（任务可能仍在跑，稍后再取）` }, true)
    return textResult({ ok: true, prompt_id: promptId, history, images: imagesOf(history) })
  }

  return textResult({ ok: false, error: `未知工具：${String(name)}` }, true)
}

async function handleMessage(message) {
  const { id, method, params } = message
  if (method === 'initialize') {
    const requested = params?.protocolVersion
    const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0]
    return { jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO } }
  }
  if (method === 'notifications/initialized' || method === 'initialized') return null
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
  if (method === 'tools/call') {
    try {
      return { jsonrpc: '2.0', id, result: await runTool(params?.name, params?.arguments ?? {}) }
    } catch (error) {
      return { jsonrpc: '2.0', id, result: failure(error) }
    }
  }
  if (id === undefined || id === null) return null
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `未实现的方法：${String(method)}` } }
}

async function dispatchLine(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '不是合法 JSON' } })}\n`)
    return
  }
  try {
    const response = await handleMessage(message)
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
  } catch (error) {
    if (message?.id !== undefined && message?.id !== null) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(error?.message || error) } })}\n`)
    }
  }
}

let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) void dispatchLine(line)
  }
})
process.stdin.on('end', () => { process.exitCode = 0 })
process.stdin.resume()
