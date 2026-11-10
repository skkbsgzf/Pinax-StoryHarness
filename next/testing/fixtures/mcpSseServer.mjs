import http from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'

/**
 * 夹具：SSE 方式的 MCP 服务端（协议 v3 `mcp` 声明面里 transport:'sse' 那条路）。
 *
 * 协议形状：GET /sse 开一条事件流，服务端先发一条 endpoint 事件告诉客户端「往哪儿 POST」，
 * 之后客户端把请求 POST 到 /messages?sessionId=…，回应从事件流里回来。
 *
 * 两把工具：sse_echo（原样回显）与 sse_who（报自己的 pid）。
 * 端口从 PORT 环境变量取；启动后打印 LISTENING:<port>，测试据此知道连的是哪一台。
 */
const port = Number.parseInt(process.env.PORT ?? '0', 10)
const transports = new Map()

function buildServer() {
  const server = new Server({ name: 'pinax-fixture-sse', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'sse_echo',
        description: '原样回显 text',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
      },
      {
        name: 'sse_who',
        description: '报出自己的 pid',
        inputSchema: { type: 'object', properties: {} }
      }
    ]
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params?.name
    const args = request.params?.arguments ?? {}
    if (name === 'sse_echo') {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, text: String(args.text ?? '') }) }] }
    }
    if (name === 'sse_who') {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, pid: process.pid }) }] }
    }
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ ok: false, message: `未知工具：${String(name)}` }) }]
    }
  })
  return server
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)

  if (req.method === 'GET' && url.pathname === '/sse') {
    const transport = new SSEServerTransport('/messages', res)
    transports.set(transport.sessionId, transport)
    res.on('close', () => transports.delete(transport.sessionId))
    // connect() 内部会调 transport.start()：写 SSE 头 + 发 endpoint 事件。
    await buildServer().connect(transport)
    return
  }

  if (req.method === 'POST' && url.pathname === '/messages') {
    const sessionId = url.searchParams.get('sessionId') ?? ''
    const transport = transports.get(sessionId)
    if (!transport) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('no such session')
      return
    }
    await transport.handlePostMessage(req, res)
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
})

httpServer.listen(port, '127.0.0.1', () => {
  console.log(`LISTENING:${httpServer.address().port}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
