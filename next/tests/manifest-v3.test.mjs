import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARRIER_SPEC_V2,
  CARRIER_SPEC_V3,
  PANE_KIND_WORDS,
  validateCarrierManifest
} from '../kernel/carrierManifest.mjs'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { diagnoseCarrier } from '../doctor.mjs'
import { withMutation } from '../testing/fixtures.mjs'

/**
 * 清单 v3（AgentCore 口径）单测。
 * 四张新牌：entry（自带面板）／services（本地服务）／mcp（外部 MCP）／agentMd；
 * 外加一条收紧：pane 必须显式声明 kind，不再按 id 前缀猜内容面。
 * 老版本（@2／@1）写了 v3 字段必须拒装——「声明了却不生效」比缺席更糟。
 */
const V3_MINIMAL = {
  spec: CARRIER_SPEC_V3,
  manifestVersion: 3,
  id: 'demo.v3',
  title: 'v3 演示',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',
  primary: { projectKind: 'generic', defaultPane: 'demo.panel', contextProfile: 'authoring-knowledge' },
  dataDirs: { notes: '构思' },
  contributes: {
    panes: [
      { slot: 'left-dock', id: 'demo.tree', title: '树', view: 'pinax.view.tree', kind: 'records-editor' },
      { slot: 'center', id: 'demo.panel', title: '面板', view: 'pinax.view.custom', kind: 'custom-panel' }
    ],
    renderers: ['pinax.view.custom']
  },
  entry: { kind: 'iframe', path: 'ui/index.html' },
  services: [{
    id: 'demo-svc',
    command: 'node',
    args: ['server.mjs'],
    env: { DEMO_MODE: '1' },
    port: 8971,
    healthPath: '/health',
    restart: 'on-failure',
    autostart: true
  }],
  mcp: [{ id: 'demo-mcp', transport: 'stdio', prefix: 'demo', command: 'node', args: ['mcp.mjs'], env: {} }],
  agentMd: 'AGENT.md',
  provides: ['notes.ideas'],
  requires: [],
  tools: ['pinax_notes_list'],
  context: { providers: [], budgetChars: 8000 },
  permissions: [{ type: 'file', dir: '构思', mode: 'rw' }, 'agent:ask'],
  subscriptions: ['project.changed']
}

test('v3 合规清单：四张牌原样归一，pane.kind 显式保留', () => {
  const result = validateCarrierManifest(V3_MINIMAL)
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  const manifest = result.value
  assert.equal(manifest.spec, CARRIER_SPEC_V3)
  assert.equal(manifest.manifestVersion, 3)
  assert.deepEqual(manifest.entry, { kind: 'iframe', path: 'ui/index.html' })
  assert.deepEqual(manifest.services, [{
    id: 'demo-svc',
    command: 'node',
    args: ['server.mjs'],
    env: { DEMO_MODE: '1' },
    cwd: null,
    port: 8971,
    healthPath: '/health',
    restart: 'on-failure',
    autostart: true
  }])
  assert.deepEqual(manifest.mcp, [{
    id: 'demo-mcp',
    transport: 'stdio',
    prefix: 'demo',
    command: 'node',
    args: ['mcp.mjs'],
    env: {},
    url: null,
    allow: []
  }])
  assert.equal(manifest.agentMd, 'AGENT.md')
  assert.deepEqual(manifest.panes.map((pane) => pane.kind), ['records-editor', 'custom-panel'])
})

test('v2 清单写了 v3 字段：拒装，并指出去升级清单', () => {
  for (const field of ['entry', 'services', 'mcp', 'agentMd']) {
    const target = withMutation(V3_MINIMAL, (m) => {
      m.spec = CARRIER_SPEC_V2
      m.manifestVersion = 2
      for (const other of ['entry', 'services', 'mcp', 'agentMd']) if (other !== field) delete m[other]
    })
    const result = validateCarrierManifest(target)
    assert.equal(result.ok, false, field)
    assert.equal(result.error.code, 'PINAX_INVALID_MANIFEST', field)
    assert.match(result.error.message, new RegExp(field, 'u'))
  }
})

test('v3 的 pane 必须声明 kind；词表外的 kind 拒装', () => {
  const missing = withMutation(V3_MINIMAL, (m) => { delete m.contributes.panes[0].kind })
  const result = validateCarrierManifest(missing)
  assert.equal(result.ok, false)
  assert.match(result.error.message, /必须声明 kind/u)

  const bogus = withMutation(V3_MINIMAL, (m) => { m.contributes.panes[0].kind = 'fancy-editor' })
  assert.equal(validateCarrierManifest(bogus).ok, false)

  // v2 仍可省略（兼容期走前缀对照表）；但写了就必须在词表里。
  const v2 = withMutation(V3_MINIMAL, (m) => {
    m.spec = CARRIER_SPEC_V2
    m.manifestVersion = 2
    for (const field of ['entry', 'services', 'mcp', 'agentMd']) delete m[field]
    delete m.contributes.panes[0].kind
    m.contributes.panes[1].view = 'pinax.view.editor'
    m.contributes.panes[1].kind = 'document-detail'
  })
  assert.equal(validateCarrierManifest(v2).ok, true, JSON.stringify(validateCarrierManifest(v2).error ?? {}))
  assert.ok(PANE_KIND_WORDS.includes('chapter-editor'))
})

test('entry 与 pinax.view.custom 必须成对：只写一边都拒', () => {
  const noPane = withMutation(V3_MINIMAL, (m) => {
    m.contributes.panes[1].view = 'pinax.view.editor'
    m.contributes.panes[1].kind = 'document-detail'
    m.contributes.renderers = []
  })
  assert.equal(validateCarrierManifest(noPane).error.code, 'PINAX_INVALID_ENTRY')

  const noEntry = withMutation(V3_MINIMAL, (m) => { delete m.entry })
  assert.equal(validateCarrierManifest(noEntry).error.code, 'PINAX_INVALID_ENTRY')
})

test('自带面板的视图类型与内容面必须成对：custom 视图只能是 custom-panel，反之亦然', () => {
  const wrongKind = withMutation(V3_MINIMAL, (m) => { m.contributes.panes[1].kind = 'document-detail' })
  const kindResult = validateCarrierManifest(wrongKind)
  assert.equal(kindResult.ok, false)
  assert.match(kindResult.error.message, /kind 必须是 custom-panel/u)

  const wrongView = withMutation(V3_MINIMAL, (m) => { m.contributes.panes[1].view = 'pinax.view.editor' })
  const viewResult = validateCarrierManifest(wrongView)
  assert.equal(viewResult.ok, false)
  assert.match(viewResult.error.message, /view 必须是 pinax\.view\.custom/u)
})

test('entry 路径：相对插件目录，必须 .html，不许绝对路径／反斜杠／越界／隐藏目录', () => {
  const cases = [
    (m) => { m.entry.path = '/ui/index.html' },
    (m) => { m.entry.path = 'C:/ui/index.html' },
    (m) => { m.entry.path = 'ui\\index.html' },
    (m) => { m.entry.path = '../index.html' },
    (m) => { m.entry.path = 'ui/./index.html' },
    (m) => { m.entry.path = 'ui/.hidden/index.html' },
    (m) => { m.entry.path = 'ui/index.js' },
    (m) => { m.entry.path = '' }
  ]
  for (const mutate of cases) {
    const result = validateCarrierManifest(withMutation(V3_MINIMAL, mutate))
    assert.equal(result.ok, false, JSON.stringify(mutate))
    assert.equal(result.error.code, 'PINAX_INVALID_ENTRY')
  }
  const unknown = withMutation(V3_MINIMAL, (m) => { m.entry.title = '面板' })
  assert.equal(validateCarrierManifest(unknown).error.code, 'PINAX_INVALID_ENTRY')
})

test('services：字段白名单、id 规则、healthPath 必须配 port、restart 枚举', () => {
  const cases = [
    (m) => { m.services[0].timeout = 1000 },
    (m) => { m.services[0].id = 'Demo_Svc' },
    (m) => { m.services.push({ ...m.services[0] }) },
    (m) => { m.services[0].healthPath = '/health'; delete m.services[0].port },
    (m) => { m.services[0].port = 70000 },
    (m) => { m.services[0].restart = 'always' },
    (m) => { m.services[0].autostart = 'yes' },
    (m) => { m.services[0].env = { 'BAD-KEY': 'x' } },
    (m) => { m.services[0].env = { MODE: 1 } },
    (m) => { m.services[0].args = [1] },
    (m) => { m.services[0].command = '   ' },
    (m) => { m.services[0].cwd = '../outside' }
  ]
  for (const mutate of cases) {
    const result = validateCarrierManifest(withMutation(V3_MINIMAL, mutate))
    assert.equal(result.ok, false, JSON.stringify(mutate))
    assert.equal(result.error.code, 'PINAX_INVALID_SERVICE', JSON.stringify(mutate))
  }
  // 端口可以单独存在（只做 TCP 探活）；cwd 可省。
  const tcpOnly = withMutation(V3_MINIMAL, (m) => { delete m.services[0].healthPath })
  assert.equal(validateCarrierManifest(tcpOnly).ok, true, JSON.stringify(validateCarrierManifest(tcpOnly).error ?? {}))
})

test('mcp：stdio 与 sse 的必填项互斥，prefix 规则与重复都拒', () => {
  const stdioUrl = withMutation(V3_MINIMAL, (m) => { m.mcp[0].url = 'https://example.com/sse' })
  assert.equal(validateCarrierManifest(stdioUrl).error.code, 'PINAX_INVALID_MCP')

  const stdioNoCommand = withMutation(V3_MINIMAL, (m) => { delete m.mcp[0].command })
  assert.equal(validateCarrierManifest(stdioNoCommand).error.code, 'PINAX_INVALID_MCP')

  const sse = withMutation(V3_MINIMAL, (m) => { m.mcp[0] = { id: 'demo-mcp', transport: 'sse', prefix: 'demo', url: 'https://127.0.0.1:9000/sse' } })
  const sseResult = validateCarrierManifest(sse)
  assert.equal(sseResult.ok, true, JSON.stringify(sseResult.error ?? {}))
  assert.equal(sseResult.value.mcp[0].url, 'https://127.0.0.1:9000/sse')

  const sseWithCommand = withMutation(V3_MINIMAL, (m) => {
    m.mcp[0] = { id: 'demo-mcp', transport: 'sse', prefix: 'demo', url: 'http://127.0.0.1:9000/sse', command: 'node' }
  })
  assert.equal(validateCarrierManifest(sseWithCommand).error.code, 'PINAX_INVALID_MCP')

  const sseBadProtocol = withMutation(V3_MINIMAL, (m) => {
    m.mcp[0] = { id: 'demo-mcp', transport: 'sse', prefix: 'demo', url: 'ws://127.0.0.1:9000/sse' }
  })
  assert.equal(validateCarrierManifest(sseBadProtocol).error.code, 'PINAX_INVALID_MCP')

  const badPrefix = withMutation(V3_MINIMAL, (m) => { m.mcp[0].prefix = 'Demo-Tools' })
  assert.equal(validateCarrierManifest(badPrefix).error.code, 'PINAX_INVALID_MCP')

  const duplicatePrefix = withMutation(V3_MINIMAL, (m) => { m.mcp.push({ ...m.mcp[0], id: 'demo-mcp-2' }) })
  assert.equal(validateCarrierManifest(duplicatePrefix).error.code, 'PINAX_INVALID_MCP')

  const allow = withMutation(V3_MINIMAL, (m) => { m.mcp[0].allow = ['render_image', 'bad name'] })
  assert.equal(validateCarrierManifest(allow).error.code, 'PINAX_INVALID_MCP')
})

test('agentMd：必须是插件目录内的 .md 相对路径', () => {
  for (const value of ['/AGENT.md', '../AGENT.md', 'docs/agent.txt', '']) {
    const result = validateCarrierManifest(withMutation(V3_MINIMAL, (m) => { m.agentMd = value }))
    assert.equal(result.ok, false, value)
    assert.equal(result.error.code, 'PINAX_INVALID_MANIFEST', value)
  }
  const ok = validateCarrierManifest(withMutation(V3_MINIMAL, (m) => { m.agentMd = 'docs/AGENT.md' }))
  assert.equal(ok.ok, true)
  assert.equal(ok.value.agentMd, 'docs/AGENT.md')
})

test('注册表：外部 MCP 的 prefix 在安装期占命名空间，撞名直接拒装', () => {
  const registry = createRegistry({ kinds: ['novel', 'screenplay', 'generic'] })
  const first = registry.install(V3_MINIMAL)
  assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))

  const second = {
    ...structuredClone(V3_MINIMAL),
    id: 'demo.other',
    tools: [],
    mcp: [{ id: 'other-mcp', transport: 'stdio', prefix: 'demo', command: 'node' }]
  }
  const conflict = registry.install(second)
  assert.equal(conflict.ok, false)
  assert.equal(conflict.error.code, 'PINAX_TOOL_CONFLICT')

  // 本地工具的命名空间与别人的 mcp prefix 也走同一张仲裁表。
  const localClash = { ...structuredClone(second), mcp: [], tools: ['demo.something'] }
  assert.equal(registry.install(localClash).error.code, 'PINAX_TOOL_CONFLICT')
})

test('启用集视图：服务／外部 MCP／AGENT.md 摊到项目级，面板入口随 pane 出去', () => {
  const registry = createRegistry({ kinds: ['novel', 'screenplay', 'generic'] })
  assert.equal(registry.install(V3_MINIMAL).ok, true)
  const activation = registry.activate({ primary: 'demo.v3', enabled: ['demo.v3'], revision: 2 })
  assert.equal(activation.ok, true, JSON.stringify(activation.error ?? {}))
  const view = activation.value
  assert.equal(view.services.length, 1)
  assert.equal(view.services[0].pluginId, 'demo.v3')
  assert.equal(view.services[0].id, 'demo-svc')
  assert.equal(view.mcp.length, 1)
  assert.equal(view.mcp[0].prefix, 'demo')
  assert.deepEqual(view.agents, [{ pluginId: 'demo.v3', path: 'AGENT.md' }])
  const panel = view.panes.center.find((pane) => pane.id === 'demo.panel')
  assert.deepEqual(panel.entry, { kind: 'iframe', path: 'ui/index.html' })
  assert.equal(panel.kind, 'custom-panel')
})

test('doctor：描述符没登记 v3 就是 needs-host-upgrade，登记了才放行', () => {
  const base = {
    descriptorVersion: 1,
    host: 'pinax-next-shell',
    kernelContract: '1',
    trustMode: 'same-process',
    slots: ['left-dock', 'center', 'overlay'],
    reservedSlots: ['right', 'top-menu'],
    forms: ['dock', 'split', 'overlay', 'fullscreen'],
    views: ['pinax.view.tree', 'pinax.view.list', 'pinax.view.editor', 'pinax.view.reader', 'pinax.view.diff', 'pinax.view.graph', 'pinax.view.custom'],
    platforms: ['electron']
  }
  const oldHost = diagnoseCarrier(V3_MINIMAL, { descriptor: base })
  assert.equal(oldHost.state, 'needs-host-upgrade')

  const newHost = diagnoseCarrier(V3_MINIMAL, { descriptor: { ...base, carrierSpecs: ['pinax-carrier@1', 'pinax-carrier@2', 'pinax-carrier@3'] } })
  assert.equal(newHost.state, 'ok', newHost.message)
})
