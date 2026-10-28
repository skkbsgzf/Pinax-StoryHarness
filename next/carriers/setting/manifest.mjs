/**
 * 设定载体（M2 第一批的第二块板块）：世界书 ＋ 约束。
 * 它存在的理由很具体——运行时要给模型装「约束」「世界书」两块上下文，而文件服务只让插件读自己认领的目录；
 * 没有这块板块，运行时就只能空着手问模型「这本书的规矩是什么」。
 * 世界书这一个目录申请 rw（工单A2，作者批准的合同变更）：面板与模型从内核手里认领的两把只读工具
 * （pinax_worldbook_list / pinax_worldbook_read）取数，写走载体自有的 pinax_worldbook_save
 * （与小说的 pinax_chapter_save 同一条规矩：expectedRevision 乐观并发，先例在 next/carriers/novel/tools.mjs）。
 * 约束目录自工单E2 起也申请 rw：约束/ 直接进上下文信封的 rules 块，作者却只能去外部编辑器改——
 * 面板按构思速记的同一套模式（列表随手带回全文＋自有 save 带修订号）补上最小编辑面；
 * 两把新工具 pinax_rule_list / pinax_rule_save 是载体自有名字（内核只有 pinax_rule_write，不认领）。
 * 内核的 pinax_worldbook_write / pinax_rule_write 照旧不认领：写族闸把这两个目录的写入点名到自有工具上。
 */
export const SETTING_CARRIER_ID = 'pinax.carrier.setting'

export const SETTING_CARRIER = Object.freeze({
  spec: 'pinax-carrier@1',
  id: SETTING_CARRIER_ID,
  title: '设定',
  version: '0.4.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'setting.entries',
    contextProfile: 'setting-field'
  },

  dataDirs: Object.freeze({
    entries: '世界书',
    constraints: '约束'
  }),

  panes: [
    { slot: 'left-dock', id: 'setting.board', title: '设定板', icon: 'library' },
    { slot: 'center', id: 'setting.entries', title: '条目', icon: 'list' }
  ],

  capabilities: ['setting.entries', 'constraint.rules'],
  requires: [],
  tools: ['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save'],

  context: {
    providers: ['rules', 'style', 'worldbook'],
    budgetChars: 20000
  },

  scopes: ['file:世界书:rw', 'file:约束:rw', 'agent:ask']
})

export default SETTING_CARRIER
