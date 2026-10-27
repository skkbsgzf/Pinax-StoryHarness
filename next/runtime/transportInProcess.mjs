import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

/**
 * in-process 出口（三出口的第一条：渲染进程 ← IPC → 主进程内这套链路，全程不开端口）。
 * 桩 1 实测：SDK 1.32.2 的 InMemoryTransport.createLinkedPair() 可用，19 工具全列出。
 */
export async function connectInProcess(server, { clientName = 'pinax-next-shell', clientVersion = '1.0.0' } = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: clientName, version: clientVersion }, { capabilities: {} })
  await client.connect(clientTransport)

  return {
    client,
    async listTools() {
      const response = await client.listTools()
      return response?.tools ?? []
    },
    async callTool(name, args = {}) {
      const response = await client.callTool({ name, arguments: args })
      return normalizeToolResult(response)
    },
    async close() {
      await client.close().catch(() => {})
      await server.close().catch(() => {})
    }
  }
}

/** MCP 的返回体是 content[]；工具层统一把 JSON 文本还原成对象，方便外壳直接渲染。 */
export function normalizeToolResult(response) {
  const text = (response?.content ?? [])
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  return {
    ok: !response?.isError,
    payload: payload ?? { text },
    structured: response?.structuredContent ?? null,
    raw: response
  }
}
