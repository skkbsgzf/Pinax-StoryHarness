/**
 * 设定载体（M2 第一批的第二块板块；协议 v1.1-A 起只剩 约束/）。
 * 它存在的理由很具体——运行时要给模型装「约束」这块上下文，而文件服务只让插件读自己认领的目录；
 * 没有这块板块，运行时就只能空着手问模型「这本书的规矩是什么」。
 * 协议 v1.1-A（作者 2026-10-28 裁定）：世界书拆去 pinax.carrier.worldbook（那条内容树独立成栏），
 * 设定栏只留 约束/——一个载体＝竖条一格＝一棵纯粹的本域内容树。
 * 约束目录自工单E2 起申请 rw：约束/ 直接进上下文信封的 rules/style 块，作者却只能去外部编辑器改——
 * 面板按构思速记的同一套模式（列表随手带回全文＋自有 save 带修订号）补上最小编辑面；
 * 两把工具 pinax_rule_list / pinax_rule_save 是载体自有名字（内核只有 pinax_rule_write，不认领）。
 * 内核的 pinax_rule_write 照旧不认领：写族闸把这个目录的写入点名到自有工具上。
 */
export const SETTING_CARRIER_ID = 'pinax.carrier.setting'

export const SETTING_CARRIER = Object.freeze({
  // 协议 v3：manifestVersion 显式 3；pane 自声明 view 与 kind（不再按 id 前缀猜内容面）。
  spec: 'pinax-carrier@3',
  manifestVersion: 3,
  id: SETTING_CARRIER_ID,
  title: '设定',
  version: '0.7.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'setting.rules',
    contextProfile: 'setting-field'
  },

  dataDirs: Object.freeze({
    constraints: '约束'
  }),

  contributes: Object.freeze({
    panes: [
      { slot: 'left-dock', id: 'setting.board', title: '设定板', icon: 'library', view: 'pinax.view.tree', kind: 'rule-editor', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] },
      { slot: 'center', id: 'setting.rules', title: '约束', icon: 'list', view: 'pinax.view.editor', kind: 'rule-editor', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] }
    ],
    // 协议 P14 载体设置注册：本载体暂无设置项——空数组＝设置页不出这一格（不按载体标题伪造占位节）。
    settings: []
  }),

  provides: ['constraint.rules'],
  requires: [],

  tools: ['pinax_rule_list', 'pinax_rule_save'],

  context: {
    providers: ['rules', 'style'],
    budgetChars: 20000
  },

  // agent:ask 是运行时调用载体工具的前置授权（next/kernel/scopeGrant.mjs:59）：缺了它，约束这一对
  // 工具在运行时面上会被整组拒掉（原设定载体一直带着它）。与小说/资料同一口径。
  permissions: [{ type: 'file', dir: '约束', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed'],

  // 协议 v3 的四张牌：这一栏用宿主视图（没有自带面板），不起本地服务、不挂外部 MCP；
  // 只声明作者须知——运行时组上下文时把 AGENT.md 并进信封。
  entry: null,
  services: Object.freeze([]),
  mcp: Object.freeze([]),
  agentMd: 'AGENT.md'
})

export default SETTING_CARRIER
