/**
 * 漫画载体（M4）：漫画/ 一棵记录树，四条工具（列／读／写／删）。
 *
 * 搬的是老前端 `comic_pages_v1` 那一层（一页一条，panels 放在 meta 里原样保存）。
 * 老数据住 IndexedDB，Next 的第一落点是一份文件真源 `漫画/漫画.json`。
 * 画格图片本身不在本批（文件服务仍是文本口）：记录里存 refs（图相对路径／外链）与
 * meta.panels（每格的构图与台词），等 R3 的资产迁移裁定再补真实图片。
 *
 * provides storyboard.shots：漫画页与分镜共用「一格一格讲故事」的能力口径；
 * 将来视频载体要引用漫画分镜时，闭包按能力找得到它。
 *
 * 批次48：这块载体是 v3 四张牌的第一个真实内置消费者——
 *   mcp       stdio 起 comfy-mcp-bridge.mjs，三把 comfy_* 工具以 comfy. 前缀进聚合面；
 *   services  autostart 起 preview-server.mjs（只读预览，127.0.0.1:8191）；
 *   context   references 块交漫画页清单（页名＋格数＋首句台词）；
 *   agentMd   AGENT.md 写清数据形状与两族工具的关系。
 * 档案从 writing-selection 换成 authoring-knowledge：只有后者（含 storyboard-*）的块表里有
 * references，且它映射到只读任务 authoring.knowledge.query；writing-selection 的块表没有
 * references，声明了也只会被如实忽略。
 */
export const COMIC_CARRIER_ID = 'pinax.carrier.comic'

export const COMIC_CARRIER = Object.freeze({
  // 协议 v3：manifestVersion 显式 3；pane 自声明 view 与 kind（不再按 id 前缀猜内容面）。
  spec: 'pinax-carrier@3',
  manifestVersion: 3,
  id: COMIC_CARRIER_ID,
  title: '漫画',
  version: '1.2.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'comic.editor',
    contextProfile: 'authoring-knowledge'
  },

  dataDirs: Object.freeze({
    comic: '漫画'
  }),

  contributes: Object.freeze({
    panes: [
      { slot: 'left-dock', id: 'comic.board', title: '漫画页', icon: 'comics', view: 'pinax.view.list', kind: 'records-editor', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      { slot: 'center', id: 'comic.editor', title: '漫画', icon: 'comics', view: 'pinax.view.editor', kind: 'records-editor', forms: ['dock', 'split', 'overlay', 'fullscreen'] }
    ],
    settings: []
  }),

  provides: ['storyboard.shots'],
  requires: [],

  tools: ['pinax_comic_list', 'pinax_comic_read', 'pinax_comic_save', 'pinax_comic_remove'],

  context: {
    providers: ['references'],
    budgetChars: 12000
  },

  permissions: [{ type: 'file', dir: '漫画', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed'],

  // 协议 v3 的四张牌：
  //   entry    仍用宿主视图（漫画壳由 records-editor 渲染，不自带面板）；
  //   services 预览服务——零依赖 node:http，只读 漫画/漫画.json，端口只给本机回环；
  //   mcp      ComfyUI 桥——三把 comfy_* 以 comfy. 前缀进聚合工具面（出图不是写盘，
  //            不落图片、只回 prompt_id 与产物元数据）；
  //   agentMd  作者须知——运行时把它并进上下文信封。
  entry: null,
  services: Object.freeze([
    {
      id: 'comic-preview',
      command: 'node',
      args: ['preview-server.mjs'],
      port: 8191,
      healthPath: '/health',
      restart: 'on-failure',
      autostart: true
    }
  ]),
  mcp: Object.freeze([
    {
      id: 'comfy',
      transport: 'stdio',
      command: 'node',
      args: ['comfy-mcp-bridge.mjs'],
      prefix: 'comfy',
      allow: ['comfy_status', 'comfy_submit', 'comfy_result']
    }
  ]),
  agentMd: 'AGENT.md'
})

export default COMIC_CARRIER
