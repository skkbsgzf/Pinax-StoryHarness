/**
 * 大纲载体（协议 v1.1-A：作者 2026-10-28 裁定把大纲从小说栏拆成独立一栏）。
 * 它认领 大纲/ 这一块目录、两把工具：pinax_outline_read（从内核同名工具认领）与
 * pinax_outline_save（载体自有写入口，工单B2 起在小说载体里，本批随目录整块迁出）。
 * 一个载体＝竖条一格＝一棵纯粹的本域内容树：这一栏只出现大纲节点，不出现章节/构思/世界书。
 *
 * primary 写 generic：大纲可以是泛型项目的主载体（先搭骨架后写正文），
 * 也可以在小说/剧本项目里当伴生板块被启用——两条路都走得通，不绑死在某一种项目类型上。
 * contextProfile 取 authoring-knowledge：它在只读任务表里（review-only），且档案块表含 outline
 * ——若借 setting-field，档案不认 outline 块，载体声明的提供者会在信封里被静默忽略（批次18 的教训）。
 */
export const OUTLINE_CARRIER_ID = 'pinax.carrier.outline'

export const OUTLINE_CARRIER = Object.freeze({
  // 协议 v4（批次53）：manifestVersion 显式 4；pane 在 v3 的 view／kind 之上补槽语义与资源认领。
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: OUTLINE_CARRIER_ID,
  title: '大纲',
  version: '1.2.0',
  minKernel: '1',
  tier: 'carrier',
  license: Object.freeze({ mode: 'free' }),

  primary: {
    projectKind: 'generic',
    defaultPane: 'outline.editor',
    contextProfile: 'authoring-knowledge'
  },

  dataDirs: Object.freeze({
    outline: '大纲'
  }),

  // 工单 C2：pane 自声明 view（大纲树／编辑器），宿主不再按 id 前缀猜。
  contributes: Object.freeze({
    panes: [
      // 槽语义（批次53）：大纲树是全项目一份的导航面（single＋project），兜底认领 大纲/**。
      { slot: 'left-dock', id: 'outline.tree', title: '大纲树', icon: 'outline', view: 'pinax.view.tree', kind: 'outline-editor', multiplicity: 'single', scope: 'project', claims: ['大纲/**'], priority: 30, takes: 'fallback', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] },
      // 槽语义（批次53）：编辑位绑的是整份 outline.json（不是单个节点），所以 scope 是 project 而不是 entry；
      // 认领同目录、以 extension 档接管大纲资源，canOpen 只放行 kind=outline（其它文件仍留给兜底面）。
      { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list', view: 'pinax.view.editor', kind: 'outline-editor', multiplicity: 'single', scope: 'project', claims: ['大纲/**'], priority: 70, canOpen: { field: 'kind', equals: 'outline' }, takes: 'extension', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] },
      // 协议 v1.1-C：悬浮小工具窗（作者点名「大纲变成微型悬浮窗，悬浮在小说正文的某个位置」）。
      // 载体只声明意图与宽度；定位、拖动、收起/展开、位置记忆全归宿主 next/shell/FloatingWidget.vue。
      // 槽语义（批次53）：悬浮窗是同一份大纲的第二种看法，允许开多份（list），生命周期跟会话（session）；
      // 它不是资源的所有者（不认领文件），所以不带 claims／priority。
      { slot: 'overlay', id: 'outline.widget', title: '大纲', width: 300, view: 'pinax.view.tree', kind: 'outline-editor', multiplicity: 'list', scope: 'session' }
    ],
    // 协议 P14：本载体暂无设置项——空数组＝设置页不出这一格（不按载体标题伪造占位节）。
    settings: []
  }),

  provides: ['outline.tree'],
  requires: [],

  tools: ['pinax_outline_read', 'pinax_outline_save'],

  context: {
    providers: ['outline'],
    budgetChars: 20000
  },

  // agent:ask 是运行时调用载体工具的前置授权（next/kernel/scopeGrant.mjs:59）：缺了它，这一栏的
  // 读/写工具在运行时面上会被整组拒掉，作者点什么都调不动。与小说/资料同一口径。
  permissions: [{ type: 'file', dir: '大纲', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed'],

  // 协议 v3 的四张牌：这一栏用宿主视图（没有自带面板），不起本地服务、不挂外部 MCP；
  // 只声明作者须知——运行时组上下文时把 AGENT.md 并进信封。
  entry: null,
  services: Object.freeze([]),
  mcp: Object.freeze([]),
  agentMd: 'AGENT.md'
})

export default OUTLINE_CARRIER
