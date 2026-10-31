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
 *   mcp       stdio 起 comfy-mcp-bridge.mjs，只读两把 comfy_* 工具以 comfy. 前缀进聚合面；
 *   services  autostart 起 preview-server.mjs（只读预览，127.0.0.1:8191）；
 *   context   references 块交漫画页清单（页名＋格数＋首句台词）；
 *   agentMd   AGENT.md 写清数据形状与两族工具的关系。
 *
 * 批次58（三独立体接入底座）：漫画这一栏同时是「画布」与「引擎」两个独立体的接入面——
 *   画布  toonflow 由作者自己的 dev 流程起（:3010），Pinax 只给一块 app 档 pane 用内嵌浏览器承载，
 *         不 spawn、不替它画编辑器；
 *   引擎  ComfyUI 常驻 :8188，桥只做探活与收结果。提交通路的纪律归底座（CF2TF SPEC §1.1
 *         单提交点 queue gate 的教训：多提交方抢串行队列＝雪崩）；底座提交闸未建之前，
 *         comfy_submit 不进聚合工具面（桥里仍保留实现，只是 allow 不放行）。
 * 档案从 writing-selection 换成 authoring-knowledge：只有后者（含 storyboard-*）的块表里有
 * references，且它映射到只读任务 authoring.knowledge.query；writing-selection 的块表没有
 * references，声明了也只会被如实忽略。
 */
export const COMIC_CARRIER_ID = 'pinax.carrier.comic'

export const COMIC_CARRIER = Object.freeze({
  // 协议 v4（批次53）：manifestVersion 显式 4；pane 在 v3 的 view／kind 之上补槽语义与资源认领。
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: COMIC_CARRIER_ID,
  title: '漫画',
  version: '1.3.0',
  minKernel: '1',
  tier: 'carrier',
  license: Object.freeze({ mode: 'free' }),

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
      // 槽语义（批次53）：漫画页板是整栏一份的记录树（single＋project），兜底认领 漫画/**。
      { slot: 'left-dock', id: 'comic.board', title: '漫画页', icon: 'comics', view: 'pinax.view.list', kind: 'records-editor', multiplicity: 'single', scope: 'project', claims: ['漫画/**'], priority: 30, takes: 'fallback', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      // 槽语义（批次53）：编辑位绑一条漫画页记录（single＋entry），认领 漫画/**/*.json 并以 extension 档接管。
      { slot: 'center', id: 'comic.editor', title: '漫画', icon: 'comics', view: 'pinax.view.editor', kind: 'records-editor', multiplicity: 'single', scope: 'entry', claims: ['漫画/**/*.json'], priority: 70, canOpen: { field: 'kind', equals: 'comic-record' }, takes: 'extension', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      // 画布是独立体①：toonflow（:3010）自己长什么样就什么样，宿主只给一块内嵌浏览器，不手搓组件。
      // 槽语义（批次53）：画布是**项目级唯一**的一块外部应用面（single＋project）——它不认领项目内文件
      // （内容住在 toonflow 自己的数据里），与 comic.editor 同属 center 槽、按 pane id 各自成实例：
      // 外壳的中栏切换条据此在两块中间切换（批次58 实拍的「双中栏无入口」由这里收口）。
      { slot: 'center', id: 'comic.canvas', title: 'Toonflow 画布', icon: 'comics', view: 'pinax.view.app', kind: 'external-app', multiplicity: 'single', scope: 'project', app: { url: 'http://127.0.0.1:3010' }, forms: ['dock', 'split', 'fullscreen', 'immersive'] }
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
  //   mcp      ComfyUI 桥——只读两把 comfy_* 以 comfy. 前缀进聚合工具面（探活与收结果）；
  //            comfy_submit 被 allow 挡在聚合面外：提交通路纪律归底座，底座提交闸未建前不开第二个口；
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
      // 提交闸归底座：底座自己的单提交点 gate（吸收 CF2TF SPEC §1.1）未建之前，
      // Pinax 侧不开第二个直连 ComfyUI 的提交口。恢复条件＝底座提交闸落地。
      allow: ['comfy_status', 'comfy_result']
    }
  ]),
  agentMd: 'AGENT.md'
})

export default COMIC_CARRIER
