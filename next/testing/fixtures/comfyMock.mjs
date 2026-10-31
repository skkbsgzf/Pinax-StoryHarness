#!/usr/bin/env node
/**
 * mock ComfyUI（测试夹具，零依赖）：只实现漫画载体 ComfyUI 桥用到的三条路由。
 *   1) GET  /system_stats      —— 固定形状的探活应答；
 *   2) POST /prompt            —— 收下工作流，回固定 prompt_id；
 *   3) GET  /history/<id>      —— 回「已完成」与一张图片的元数据。
 * 端口取 PORT（缺省 0＝系统分配），起好后在 stdout 打一行 `LISTENING:<port>`，
 * 测试据此拿到真实端口，绝不假设 8188（本机可能真有 ComfyUI 或端口被占）。
 */
import http from 'node:http'

const PROMPT_ID = 'mock-prompt-1'
const submissions = []

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0]
  if (req.method === 'GET' && path === '/system_stats') {
    return send(res, 200, {
      system: { os: 'posix', comfyui_version: 'mock-0.0.1', python_version: '3.mock' },
      devices: [{ name: 'mock-gpu', type: 'cuda', vram_total: 1024, vram_free: 1024 }]
    })
  }
  if (req.method === 'POST' && path === '/prompt') {
    let raw = ''
    req.setEncoding('utf-8')
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      let parsed = null
      try { parsed = JSON.parse(raw) } catch { parsed = null }
      if (!parsed || typeof parsed !== 'object' || !parsed.prompt || typeof parsed.prompt !== 'object') {
        return send(res, 400, { error: 'mock：POST /prompt 需要 { prompt: {...} }' })
      }
      submissions.push(parsed)
      return send(res, 200, { prompt_id: PROMPT_ID, number: submissions.length, node_errors: {} })
    })
    return undefined
  }
  if (req.method === 'GET' && path === `/history/${PROMPT_ID}`) {
    return send(res, 200, {
      [PROMPT_ID]: {
        prompt: submissions.at(-1)?.prompt ?? {},
        status: { status_str: 'success', completed: true },
        outputs: {
          9: { images: [{ filename: 'mock.png', subfolder: '', type: 'output' }] }
        }
      }
    })
  }
  if (req.method === 'GET' && path.startsWith('/history/')) return send(res, 200, {})
  return send(res, 404, { error: `mock ComfyUI 没有这条路由：${req.method} ${path}` })
})

server.on('error', (error) => {
  console.error(`[comfy-mock] 起不来：${error?.message || error}`)
  process.exitCode = 1
})
server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => {
  console.log(`LISTENING:${server.address().port}`)
})
