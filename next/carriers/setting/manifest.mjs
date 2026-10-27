/**
 * 设定载体（M2 第一批的第二块板块）：世界书 ＋ 约束。
 * 它存在的理由很具体——运行时要给模型装「约束」「世界书」两块上下文，而文件服务只让插件读自己认领的目录；
 * 没有这块板块，运行时就只能空着手问模型「这本书的规矩是什么」。
 * 第一批只申请只读（file:<目录>:r）：它贡献上下文块，并从内核手里认领世界书的两把只读工具
 * （pinax_worldbook_list / pinax_worldbook_read）供设定面板取数；写世界书仍是内核的 pinax_worldbook_write，
 * 权限不提前占坑——清单里没有 rw，文件服务就不会让这块板块写出一个字节。
 */
export const SETTING_CARRIER_ID = 'pinax.carrier.setting'

export const SETTING_CARRIER = Object.freeze({
  spec: 'pinax-carrier@1',
  id: SETTING_CARRIER_ID,
  title: '设定',
  version: '0.2.0',
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
  tools: ['pinax_worldbook_list', 'pinax_worldbook_read'],

  context: {
    providers: ['rules', 'style', 'worldbook'],
    budgetChars: 20000
  },

  scopes: ['file:世界书:r', 'file:约束:r', 'agent:ask']
})

export default SETTING_CARRIER
