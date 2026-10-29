import test from 'node:test'
import assert from 'node:assert/strict'
import { createKitToolTurn } from '../runtime/toolTurn.mjs'

/**
 * 模型回合适配（M2.5-A · 任务五）。
 * 只证「形状对得上」：MCP 工具 → 任务面 tools、parts 消息 → 任务面 messages、
 * 任务面 toolCalls → 循环的 calls。真模型链路不在单测里跑。
 */

const TOOLS = Array.from({ length: 8 }, (_, index) => ({
  name: `pinax_tool_${index}`,
  description: `工具 ${index}`,
  inputSchema: { type: 'object', properties: { x: { type: 'string' } } }
}))

test('工具映射：inputSchema → parameters，数量封在 6 把', async () => {
  let seen = null
  const turn = createKitToolTurn({
    complete: async (payload) => {
      seen = payload
      return { content: '好', toolCalls: [] }
    }
  })
  const result = await turn({ messages: [{ role: 'user', content: '问题' }], tools: TOOLS })
  assert.equal(seen.tools.length, 6)
  assert.equal(seen.tools[0].name, 'pinax_tool_0')
  assert.deepEqual(seen.tools[0].parameters, { type: 'object', properties: { x: { type: 'string' } } })
  assert.equal(seen.toolChoice, 'auto')
  assert.equal(result.kind, 'final_ready')
  assert.equal(result.text, '好')
})

test('消息映射：assistant 带 toolCalls、tool 带 toolCallId/toolName/output', async () => {
  let seen = null
  const turn = createKitToolTurn({
    complete: async (payload) => {
      seen = payload
      return { toolCalls: [{ id: 'c1', name: 'pinax_tool_0', arguments: { x: 'a' } }] }
    }
  })
  const result = await turn({
    messages: [
      { role: 'user', content: '问题' },
      {
        role: 'assistant',
        content: '',
        parts: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'pinax_tool_0', input: { x: 'a' } }]
      },
      {
        role: 'tool',
        content: '{"ok":true}',
        toolCallId: 'c1',
        name: 'pinax_tool_0',
        parts: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'pinax_tool_0', output: '{"ok":true}', isError: false }]
      }
    ],
    tools: TOOLS
  })
  assert.deepEqual(seen.messages[1].toolCalls, [{ id: 'c1', name: 'pinax_tool_0', arguments: { x: 'a' } }])
  assert.deepEqual(seen.messages[2], { role: 'tool', toolCallId: 'c1', toolName: 'pinax_tool_0', output: '{"ok":true}', isError: false })
  assert.equal(result.kind, 'tool_calls')
  assert.deepEqual(result.calls, [{ id: 'c1', name: 'pinax_tool_0', arguments: { x: 'a' } }])
  assert.equal(result.text, '')
})

test('没有工具直接抛：循环不该在没有工具面时启动', async () => {
  const turn = createKitToolTurn({ complete: async () => ({ content: '' }) })
  await assert.rejects(() => turn({ messages: [{ role: 'user', content: '问' }], tools: [] }), /至少要带一把工具/u)
})
