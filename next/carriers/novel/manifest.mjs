/**
 * 第一个真实载体（M2 · WP5）：小说。
 * 这份清单是「载体＝一块新文件夹注册」这句话的落地样本——板块＝正文/大纲/构思三块目录，
 * 权限＝只对这三块申请 rw，工具＝认领内核里本就存在的那三个只读名（pinax_chapter_list /
 * pinax_chapter_read / pinax_outline_read），外加载体自己的写入口：正文的 pinax_chapter_save、
 * 大纲的 pinax_outline_save（工单B2，整份覆盖）与构思速记的 pinax_notes_list / pinax_notes_save（工单B1）。
 * 认领而非新增内核名，所以 19 工具的面在启用小说后不虚增；接管后读盘一律过内核文件服务的三道闸，
 * 内核那份「按服务端注册表找项目」的实现只在没装载体的场合回落使用。
 */
export const NOVEL_CARRIER_ID = 'pinax.carrier.novel'

export const NOVEL_CARRIER = Object.freeze({
  spec: 'pinax-carrier@1',
  id: NOVEL_CARRIER_ID,
  title: '小说',
  version: '0.2.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'novel',
    defaultPane: 'novel.editor',
    // 与 shared/agentContextProfiles.js 的 writing-chapter 同名：运行时组上下文时按这个档案取块。
    contextProfile: 'writing-chapter'
  },

  dataDirs: Object.freeze({
    manuscript: '正文',
    outline: '大纲',
    notes: '构思'
  }),

  panes: [
    { slot: 'left-dock', id: 'novel.shelf', title: '书稿', icon: 'book' },
    { slot: 'center', id: 'novel.editor', title: '正文', icon: 'writing' }
  ],

  capabilities: ['text.chapters', 'outline.tree', 'notes.ideas'],
  requires: [],

  tools: ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_outline_read', 'pinax_chapter_save', 'pinax_outline_save', 'pinax_notes_list', 'pinax_notes_save'],

  context: {
    // providers 写的是「上下文块的种类名」（与 shared/agentContextProfiles.js 的 blocks 对齐），
    // 运行时按这个名字找提供者；构思/ 目前不进任何只读档案的块表，所以这里不谎报。
    providers: ['selection', 'outline'],
    budgetChars: 24000
  },

  scopes: ['file:正文:rw', 'file:大纲:rw', 'file:构思:rw', 'agent:ask']
})

export default NOVEL_CARRIER
