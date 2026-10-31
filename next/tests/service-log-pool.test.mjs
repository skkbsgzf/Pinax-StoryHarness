import test from 'node:test'
import assert from 'node:assert/strict'
import { createServiceLogPool } from '../runtime/serviceLogPool.mjs'
import { createServiceLogTools, SERVICE_LOG_LIST_TOOL } from '../runtime/serviceLogTools.mjs'
import { selectTools } from '../runtime/toolSelect.mjs'

function serviceEntry(overrides = {}) {
  return {
    source: { kind: 'service', id: 'comic-preview', carrierId: 'pinax.carrier.comic' },
    level: 'info',
    message: '服务「comic-preview」就绪（端口 8191）',
    ...overrides
  }
}

test('环形池：每来源 200 条封顶，总 1000 条封顶', () => {
  const pool = createServiceLogPool({ sourceLimit: 3, totalLimit: 5 })
  for (let index = 0; index < 6; index += 1) pool.append(serviceEntry({ message: `第 ${index} 条` }))
  const sameSource = pool.list({ source: 'comic-preview', limit: 200 })
  assert.equal(sameSource.length, 3, '每来源只留最近 3 条')
  assert.equal(sameSource.at(-1).message, '第 5 条', '留下的是最新的，旧条目从头部丢')
  pool.append(serviceEntry({ source: { kind: 'mcp', id: 'comfy', carrierId: 'pinax.carrier.comic' }, message: 'comfy 1' }))
  pool.append(serviceEntry({ source: { kind: 'mcp', id: 'comfy', carrierId: 'pinax.carrier.comic' }, message: 'comfy 2' }))
  const all = pool.list({ limit: 200 })
  assert.equal(all.length, 5, '总池封顶 5 条')
  assert.deepEqual(all.map((entry) => entry.message), ['第 3 条', '第 4 条', '第 5 条', 'comfy 1', 'comfy 2'], '总池只留最近 5 条，按时间正序')
})

test('list：按来源与级别过滤，limit 只取最近 N 条', () => {
  const pool = createServiceLogPool()
  pool.append(serviceEntry({ message: 'a' }))
  pool.append(serviceEntry({ level: 'error', message: 'b' }))
  pool.append(serviceEntry({ source: { kind: 'mcp', id: 'comfy', carrierId: 'pinax.carrier.comic' }, level: 'warn', message: 'c' }))
  assert.deepEqual(pool.list({ source: 'comic-preview' }).map((entry) => entry.message), ['a', 'b'])
  assert.deepEqual(pool.list({ level: 'error' }).map((entry) => entry.message), ['b'])
  assert.deepEqual(pool.list({ source: { kind: 'mcp', id: 'comfy' } }).map((entry) => entry.message), ['c'])
  assert.deepEqual(pool.list({ limit: 1 }).map((entry) => entry.message), ['c'])
  assert.equal(pool.list({ limit: 999 })[0].message, 'a', 'limit 超上限按 200 截，不报错')
})

test('statusByCarrier：四色语义与「没声明不出行」', () => {
  const pool = createServiceLogPool()
  pool.setDeclarations([
    { carrierId: 'pinax.carrier.comic', carrierTitle: '漫画', kind: 'service', id: 'comic-preview', port: 8191 },
    { carrierId: 'pinax.carrier.comic', carrierTitle: '漫画', kind: 'mcp', id: 'comfy', transport: 'stdio' }
  ])
  pool.setServiceStatuses([{ id: 'comic-preview', status: 'ready', health: { ok: true } }])
  pool.setMcpStatuses([{ id: 'comfy', status: 'ready' }])
  let row = pool.statusByCarrier()[0]
  assert.equal(row.color, 'green', '全部就绪＝绿')
  assert.equal(row.items.length, 2)
  assert.equal(row.items[0].port, 8191)
  assert.equal(row.items[1].transport, 'stdio')

  pool.setServiceStatuses([{ id: 'comic-preview', status: 'ready', health: { ok: false } }])
  assert.equal(pool.statusByCarrier()[0].color, 'red', '健康检查失败＝红')

  pool.setServiceStatuses([{ id: 'comic-preview', status: 'stopped' }])
  assert.equal(pool.statusByCarrier()[0].color, 'gray', '声明了但没在跑＝灰')

  pool.setServiceStatuses([{ id: 'comic-preview', status: 'ready', health: { ok: true } }])
  pool.append(serviceEntry({ level: 'warn', message: '健康检查未通过', confirm: true }))
  row = pool.statusByCarrier()[0]
  assert.equal(row.color, 'orange', '未确认通知＝橙')
  assert.equal(row.unackedNotices, 1)

  // 没有声明服务／MCP 的载体不出行（novel／outline 不画灰点）：池里有它的日志也不出。
  pool.append(serviceEntry({
    source: { kind: 'service', id: 'outline-index', carrierId: 'pinax.carrier.outline' },
    message: '别人的日志'
  }))
  assert.equal(pool.statusByCarrier().length, 1)
  assert.equal(pool.statusByCarrier()[0].carrierId, 'pinax.carrier.comic')
})

test('acknowledge：确认水位只前进；之后未确认通知清零，橙回落', () => {
  const persisted = []
  const pool = createServiceLogPool({ onAckPersist: (at) => persisted.push(at) })
  pool.setDeclarations([{ carrierId: 'pinax.carrier.comic', carrierTitle: '漫画', kind: 'service', id: 'comic-preview', port: 8191 }])
  pool.setServiceStatuses([{ id: 'comic-preview', status: 'ready', health: { ok: true } }])
  // 固定为早于确认水位的时刻：池的 append 默认取系统时钟，跨过 10:00Z 后这条用例会按时间
  // 先后误判成「未确认」，与确认语义无关（批次50 跑门禁时踩到，顺手钉成确定值）。
  pool.append(serviceEntry({ level: 'error', message: '起不来：无 node', confirm: true, at: '2026-10-31T09:00:00.000Z' }))
  assert.equal(pool.statusByCarrier()[0].color, 'orange')

  const acked = pool.acknowledge('2026-10-31T10:00:00.000Z')
  assert.equal(acked.ok, true)
  assert.equal(pool.ackedAt(), '2026-10-31T10:00:00.000Z')
  assert.equal(pool.statusByCarrier()[0].unackedNotices, 0)
  assert.equal(pool.statusByCarrier()[0].color, 'green', '通知确认后回到运行状态本身的颜色')
  assert.deepEqual(persisted, ['2026-10-31T10:00:00.000Z'], '确认水位交给应用级偏好落盘')

  // 后退不生效（防晚到的旧时间把已读又翻回未读）。
  pool.acknowledge('2026-10-30T00:00:00.000Z')
  assert.equal(pool.ackedAt(), '2026-10-31T10:00:00.000Z')
})

test('onChange：追加／确认／状态同步都会通知，且快照形状完整', () => {
  const snapshots = []
  const pool = createServiceLogPool({ onChange: (snapshot) => snapshots.push(snapshot) })
  pool.setDeclarations([{ carrierId: 'pinax.carrier.comic', carrierTitle: '漫画', kind: 'service', id: 'comic-preview', port: 8191 }])
  pool.setServiceStatuses([{ id: 'comic-preview', status: 'ready', health: { ok: true } }])
  pool.append(serviceEntry())
  assert.ok(snapshots.length >= 3)
  const last = snapshots.at(-1)
  assert.equal(last.carriers[0].carrierId, 'pinax.carrier.comic')
  assert.equal(last.carriers[0].color, 'green')
  assert.equal(last.entries.length, 1)
  assert.ok('ackedAt' in last)
})

test('pinax_service_log_list：只读工具按池读数返回，没有池时如实回空', async () => {
  const pool = createServiceLogPool()
  pool.append(serviceEntry({ message: '可读的一条' }))
  const tools = createServiceLogTools({ pool })
  const tool = tools.get(SERVICE_LOG_LIST_TOOL)
  assert.ok(tool, '原生工具已登记')
  assert.equal(tool.pluginId, 'kernel.runtime.services')
  assert.equal(tool.tool.annotations.readOnlyHint, true)
  const result = tool.tool.run({ source: 'comic-preview', limit: 5 })
  assert.equal(result.ok, true)
  assert.equal(result.value.entries.length, 1)
  assert.equal(result.value.entries[0].message, '可读的一条')

  const empty = createServiceLogTools({ pool: null }).get(SERVICE_LOG_LIST_TOOL).tool.run({})
  assert.deepEqual(empty.value.entries, [])
})

test('工具披露：服务面意图把 pinax_service_log_list 选进读槽', () => {
  // 名额紧张时才看得出「意图先拿」：8 把读工具、上限 6，服务工具排在面末尾。
  const tools = [
    'pinax_project_context',
    'pinax_chapter_read',
    'pinax_outline_read',
    'pinax_worldbook_read',
    'pinax_notes_list',
    'pinax_rule_list',
    'pinax_reference_list',
    'pinax_service_log_list'
  ]
  const picked = selectTools({ tools, intent: '漫画预览服务现在是什么状态？端口开了吗' })
  assert.ok(picked.names.includes('pinax_service_log_list'), '服务意图把它带进读槽')
  const unrelated = selectTools({ tools, intent: '把这一章开头改狠一点' })
  assert.equal(unrelated.names.includes('pinax_service_log_list'), false, '无关意图不占读槽名额')
})
