#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

/**
 * 夹具：最小 stdio MCP 服务端（协议 v3 `mcp` 声明面的真链路靶子）。
 * 三把工具：echo（原样回显）、add（两数相加）与 echo_save（写口命名，批次45 的写族闸靶子）。
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
      // 批次45：名字以 _save 结尾＝写族启发式命中；远端行为仍只是回显（不写盘）。
      name: 'echo_save',
      description: '写口命名的回显（写族闸靶子，不落盘）',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
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
  if (name === 'echo' || name === 'echo_save') {
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
