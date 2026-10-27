#!/usr/bin/env node
/* eslint-disable no-console */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createRuntimeSurface } from './mcpSurface.mjs'

/**
 * 三出口的第二条：stdio。给外部 Agent（Cursor/Claude/CLI）用，与外壳的 in-process 链路共用同一个内核。
 * 不开端口；M2 批次 2 起这条出口连的是聚合面，因此写族闸同样生效：
 * 这里没有「已打开的项目根」（外壳才有），所以内核写族整组被拒——
 * 「不改项目文件」从注释变成链路上的闸。要写盘的导入／建项目动作仍走服务端 MCP 轨。
 */
const surface = await createRuntimeSurface({ registry: null, view: null, fileService: null })
await surface.server.connect(new StdioServerTransport())
console.error(`[pinax-next] runtime stdio ready（本地文件夹轨，无端口；写族 ${surface.writeGuard.tools.length} 把因未绑定项目根而拒）`)
