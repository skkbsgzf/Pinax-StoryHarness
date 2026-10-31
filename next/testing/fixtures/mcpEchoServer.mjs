#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

/**
 * 夹具：最小 stdio MCP 服务端（协议 v3 `mcp` 声明面的真链路靶子）。
 * 只有两把工具：echo（原样回显）与 add（两数相加）。
 * 不读盘、不联网、不碰作者项目——测试与验收用它验证「连上 → 列举 → 调用 → 收尸」整条链。
 */
const server = new Server({ name: 'pinax-fixture-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: '原样回显 text',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
    },
    {
      name: 'add',
      description: '两数相加',
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'number' }, b: { type: 'number' } },
        required: ['a', 'b']
      }
    },
    {
      name: 'ignored_tool',
      description: '默认不在 allow 里，用来验过滤器',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params?.name
  const args = request.params?.arguments ?? {}
  if (name === 'echo') {
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, text: String(args.text ?? '') }) }] }
  }
  if (name === 'add') {
    const sum = Number(args.a ?? 0) + Number(args.b ?? 0)
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, sum }) }] }
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ ok: false, message: `未知工具：${String(name)}` }) }]
  }
})

await server.connect(new StdioServerTransport())
