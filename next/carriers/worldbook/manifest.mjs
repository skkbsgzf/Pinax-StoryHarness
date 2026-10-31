/**
 * 世界书载体（协议 v1.1-A：作者 2026-10-28 裁定把世界书从设定栏拆成独立一栏）。
 * 它认领 世界书/ 这一块目录、三把工具：pinax_worldbook_list / pinax_worldbook_read
 * （从内核同名工具认领）与 pinax_worldbook_save（载体自有写入口，工单A2 起在设定载体里，
 * 批次21 C 落定 meta 元数据口，本批随目录整块迁出）。
 * 一个载体＝竖条一格＝一棵纯粹的本域内容树：这一栏只出现世界书条目，不出现约束/正文/大纲。
 *
 * primary 写 generic 并在小说/剧本项目里当伴生板块——两条路都走得通。
 * contextProfile 取 setting-research：它在只读任务表里（settings.research.plan 是 ephemeral），
 * 且档案块表含 worldbook；若借 setting-field，档案里没有只读任务，本板块当主载体时提问会报缺
 * （批次18 对资料载体踩过的同一个坑）。
 */
export const WORLDBOOK_CARRIER_ID = 'pinax.carrier.worldbook'

export const WORLDBOOK_CARRIER = Object.freeze({
  // 协议 v3：manifestVersion 显式 3；pane 自声明 view 与 kind（不再按 id 前缀猜内容面）。
  spec: 'pinax-carrier@3',
  manifestVersion: 3,
  id: WORLDBOOK_CARRIER_ID,
  title: '世界书',
  version: '1.2.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'worldbook.entries',
    contextProfile: 'setting-research'
  },

  dataDirs: Object.freeze({
    entries: '世界书'
  }),

  contributes: Object.freeze({
    panes: [
      // 批次44（作者 2026-10-31：「图表列的切换全都挤在左侧小区域里进行，右侧大面积留空，
      // 非常别扭，更合理的一个情况是，上面放图表列，下面放详情信息」）：
      // 窄栏退成**类别导航树**（只管按类别找条目），核心区做成**看板区**（上图表列、下详情）。
      // 两块 pane 的形态因此不再是「文档面」：窄栏是树、核心区是看板——形态三分类见 formTaxonomy.mjs。
      { slot: 'left-dock', id: 'worldbook.board', title: '世界书板', icon: 'worldbook', view: 'pinax.view.tree', kind: 'entries-categories', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      { slot: 'center', id: 'worldbook.entries', title: '条目', icon: 'list', view: 'pinax.view.board', kind: 'entries-workspace', forms: ['dock', 'split', 'overlay', 'fullscreen'] }
    ],
    // 协议 P14：本载体暂无设置项——空数组＝设置页不出这一格（不按载体标题伪造占位节）。
    settings: []
  }),

  provides: ['setting.entries'],
  requires: [],

  tools: ['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save'],

  context: {
    providers: ['worldbook'],
    budgetChars: 20000
  },

  // agent:ask 是运行时调用载体工具的前置授权（next/kernel/scopeGrant.mjs:59）：缺了它，这一栏的
  // 读写工具在运行时面上会被整组拒掉。与小说/资料同一口径。
  permissions: [{ type: 'file', dir: '世界书', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed'],

  // 协议 v3 的四张牌：这一栏用宿主视图（没有自带面板），不起本地服务、不挂外部 MCP；
  // 只声明作者须知——运行时组上下文时把 AGENT.md 并进信封。
  entry: null,
  services: Object.freeze([]),
  mcp: Object.freeze([]),
  agentMd: 'AGENT.md'
})

export default WORLDBOOK_CARRIER
