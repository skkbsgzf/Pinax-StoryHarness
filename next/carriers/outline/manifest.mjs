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
  spec: 'pinax-carrier@1',
  id: OUTLINE_CARRIER_ID,
  title: '大纲',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'outline.editor',
    contextProfile: 'authoring-knowledge'
  },

  dataDirs: Object.freeze({
    outline: '大纲'
  }),

  panes: [
    { slot: 'left-dock', id: 'outline.tree', title: '大纲树', icon: 'outline' },
    { slot: 'center', id: 'outline.editor', title: '大纲编辑', icon: 'list' },
    // 协议 v1.1-C：悬浮小工具窗（作者点名「大纲变成微型悬浮窗，悬浮在小说正文的某个位置」）。
    // 载体只声明意图与宽度；定位、拖动、收起/展开、位置记忆全归宿主 next/shell/FloatingWidget.vue。
    { slot: 'overlay', id: 'outline.widget', title: '大纲', width: 300 }
  ],

  capabilities: ['outline.tree'],
  requires: [],

  // 协议 P14：本载体暂无设置项——空数组＝设置页不出这一格（不按载体标题伪造占位节）。
  settings: [],
  tools: ['pinax_outline_read', 'pinax_outline_save'],

  context: {
    providers: ['outline'],
    budgetChars: 20000
  },

  // agent:ask 是运行时调用载体工具的前置授权（next/kernel/scopeGrant.mjs:59）：缺了它，这一栏的
  // 读/写工具在运行时面上会被整组拒掉，作者点什么都调不动。与小说/资料同一口径。
  scopes: ['file:大纲:rw', 'agent:ask']
})

export default OUTLINE_CARRIER
