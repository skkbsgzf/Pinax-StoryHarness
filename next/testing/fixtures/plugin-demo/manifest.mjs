import { fileURLToPath } from 'node:url'

/**
 * 夹具插件（协议 v3 的四张牌一次全验）。
 *
 * 它不是随框架发布的载体——它住在 next/testing/fixtures/ 下，只给测试与验收用：
 * 真作者不该在产品目录里看见一个叫「演示」的东西。但它必须是一份**真清单**：
 * 过同一份校验器、走同一份注册表、由宿主真起子进程、真连 MCP。
 * 验的是链路，不是这个插件本身。
 *
 * 四张牌各有一个靶子：
 *   entry    ui/index.html —— 自带面板页（沙箱 iframe 里的那份）
 *   services server.mjs   —— 本地 HTTP 服务（端口探针＋健康检查）
 *   mcp      mcp.mjs      —— stdio 外部 MCP 服务端（另有一份 sse 服务端测 sse 那条路）
 *   agentMd  AGENT.md     —— 作者须知（进上下文信封）
 */
export const DEMO_PLUGIN_ID = 'demo.v3'

export const DEMO_PLUGIN = Object.freeze({
  spec: 'pinax-carrier@3',
  manifestVersion: 3,
  id: DEMO_PLUGIN_ID,
  title: '演示载体',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'demo.editor',
    contextProfile: 'authoring-knowledge'
  },

  dataDirs: Object.freeze({
    demo: '演示'
  }),

  contributes: Object.freeze({
    panes: [
      { slot: 'left-dock', id: 'demo.board', title: '演示板', icon: 'plugin', view: 'pinax.view.list', kind: 'records-editor' },
      { slot: 'center', id: 'demo.editor', title: '演示', icon: 'plugin', view: 'pinax.view.editor', kind: 'document-detail' },
      { slot: 'overlay', id: 'demo.panel', title: '演示面板', icon: 'plugin', view: 'pinax.view.custom', kind: 'custom-panel', width: 300, forms: ['overlay'] }
    ],
    settings: []
  }),

  provides: ['media.assets'],
  requires: [],

  tools: ['demo_list'],

  context: {
    providers: [],
    budgetChars: 8000
  },

  permissions: [{ type: 'file', dir: '演示', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed'],

  entry: Object.freeze({ kind: 'iframe', path: 'ui/index.html' }),
  services: Object.freeze([
    {
      id: 'demo-http',
      command: process.execPath,
      args: ['server.mjs'],
      env: {},
      cwd: null,
      port: 8971,
      healthPath: '/health',
      restart: 'on-failure',
      autostart: true
    }
  ]),
  mcp: Object.freeze([
    {
      id: 'demo-mcp',
      transport: 'stdio',
      prefix: 'demo',
      command: process.execPath,
      args: ['mcp.mjs'],
      env: {},
      allow: []
    }
  ]),
  agentMd: 'AGENT.md'
})

/** 夹具插件自己的目录（协议 v3 的相对路径解析基准）。 */
export const DEMO_PLUGIN_DIR = fileURLToPath(new URL('./', import.meta.url))

/** 装进注册表时给的那份 meta：trust、来源与目录。 */
export const DEMO_PLUGIN_META = Object.freeze({
  trust: 't1',
  source: 'next/testing/fixtures/plugin-demo',
  dir: DEMO_PLUGIN_DIR
})

/** 一把只读工具：让夹具有「自有工具」这一面可验（面里叫什么、由谁拥有）。 */
export function createDemoTools(context = {}) {
  const pluginId = context.pluginId ?? DEMO_PLUGIN_ID
  return [
    {
      name: 'demo_list',
      title: '列出演示记录',
      description: '演示载体的只读工具：回一份固定清单，验「自有工具进面且归属正确」。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async () => ({
        ok: true,
        payload: { ok: true, pluginId, items: ['演示一', '演示二'] }
      })
    }
  ]
}

/** 装进注册表时给的那份 impl（工具工厂；面板与服务不由进程内 impl 提供）。 */
export const DEMO_PLUGIN_IMPL = Object.freeze({
  source: 'next/testing/fixtures/plugin-demo',
  tools: (context = {}) => createDemoTools(context)
})

export default DEMO_PLUGIN
