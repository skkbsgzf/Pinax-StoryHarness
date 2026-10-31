import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

/**
 * 夹具插件自带的 stdio MCP 服务端（协议 v3 `mcp` 声明面的真靶子）。
 *
 * 清单里写的是相对路径（args: ['mcp.mjs']）：解析基准是插件目录，
 * 宿主据此把脚本路径落到插件目录里再起进程——这一份就是验这条规则的那张牌。
 *
 * 两把工具：
 *   demo_ping  回一句"通"，用来验「连上 → 列举 → 调用」
 *   demo_who   报出自己的 pid 与所在目录，用来验「起来的确实是插件目录里那一份」
 */
const server = new Server({ name: 'pinax-demo-mcp', version: '1.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'demo_ping',
      description: '回一句通',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
    },
    {
      name: 'demo_who',
      description: '报出自己的 pid 与工作目录',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params?.name
  const args = request.params?.arguments ?? {}
  if (name === 'demo_ping') {
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, pong: String(args.text ?? 'pong') }) }] }
  }
  if (name === 'demo_who') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(1) })
      }]
    }
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ ok: false, message: `未知工具：${String(name)}` }) }]
  }
})

await server.connect(new StdioServerTransport())
