import { RUNTIME_SCOPES } from '../kernel/scopeGrant.mjs'

/**
 * 一级公民运行时的合同常量（规范 v1 第 5 节）。
 * 单独成模块的原因不是风格：渲染层要用这些常量画右栏，而 agentRuntime.mjs 会拖进整张 MCP 工具面
 * （server/mcp/*）。外壳的渲染依赖必须保持"薄"，所以合同是叶子，实现不是。
 */
export const RUNTIME_ID = 'pinax.runtime'

export const RUNTIME_CONTRACT = Object.freeze({
  id: RUNTIME_ID,
  tier: 'runtime',
  // 面上只给名字。「运行时」是内核内部的一级层级称呼，作者口径是不把它摆到界面上。
  title: 'Pi-Agent',
  builtIn: true,
  disableable: false,
  ownsSlot: 'right',
  budgetPriority: 100,
  scopes: RUNTIME_SCOPES,
  writeSurface: '.pinax/proposals/'
})
