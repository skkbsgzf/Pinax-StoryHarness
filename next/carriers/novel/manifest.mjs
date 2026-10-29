/**
 * 第一个真实载体（M2 · WP5）：小说。
 * 这份清单是「载体＝一块新文件夹注册」这句话的落地样本——板块只认领 正文/ 一块目录，
 * 权限＝只对这块目录申请 rw，工具＝认领内核里本就存在的那两个只读名（pinax_chapter_list /
 * pinax_chapter_read），外加载体自己的写入口 pinax_chapter_save。
 * 认领而非新增内核名，所以 19 工具的面在启用小说后不虚增；接管后读盘一律过内核文件服务的三道闸，
 * 内核那份「按服务端注册表找项目」的实现只在没装载体的场合回落使用。
 * 工单A 起再添三把载体自有工具（pinax_proposal_list / read / discard）：提案审阅面读的是
 * .pinax/proposals/ 这份内核元数据，内核没有同名工具，所以由载体声明并实现（聚合面记在 declaredOutsideKernel）。
 *
 * 协议 v1.1-A（作者 2026-10-28 裁定）：一个载体＝竖条一格＝一棵纯粹的本域内容树。
 * 小说栏只留 正文/——大纲拆去 pinax.carrier.outline、构思拆去 pinax.carrier.notes、
 * 世界书拆去 pinax.carrier.worldbook（设定栏只剩 约束/）。提案仍随小说：它的目标是正文，
 * 工具归属与审阅面都在这一栏（协议 v1.1-B 的「文档」组新节留待后续批）。
 */
export const NOVEL_CARRIER_ID = 'pinax.carrier.novel'

export const NOVEL_CARRIER = Object.freeze({
  spec: 'pinax-carrier@1',
  id: NOVEL_CARRIER_ID,
  title: '小说',
  version: '0.3.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'novel',
    defaultPane: 'novel.editor',
    // 与 shared/agentContextProfiles.js 的 writing-chapter 同名：运行时组上下文时按这个档案取块。
    contextProfile: 'writing-chapter'
  },

  dataDirs: Object.freeze({
    manuscript: '正文'
  }),

  panes: [
    // 竖条图标对齐老版「书稿」那一格用的就是 outline（WorkspaceContentGroups.vue:23），
    // 见 next-shell-alignment-inventory-20261028.md 差异表 #3（B 类）。
    { slot: 'left-dock', id: 'novel.shelf', title: '书稿', icon: 'outline' },
    { slot: 'center', id: 'novel.editor', title: '正文', icon: 'writing' }
  ],

  capabilities: ['text.chapters'],
  requires: [],

  // 协议 P14 载体设置注册（工单A 第二步）：声明格式 [{ id, title }]——id 在本载体命名空间内唯一，
  // title 是统一设置二级页「载体」组里的目录项文案（1–40 字）。分组由设置页固定，不在这里声明。
  // 「写作偏好」目前只有声明与空态（右栏「该载体的设置项还没有内容」），具体设置项后续批再填。
  settings: [{ id: 'novel.writing', title: '写作偏好' }],

  tools: ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_chapter_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard'],

  context: {
    // providers 写的是「上下文块的种类名」（与 shared/agentContextProfiles.js 的 blocks 对齐），
    // 运行时按这个名字找提供者；大纲块随大纲载体迁出，小说栏只留正文 selection 块。
    providers: ['selection'],
    budgetChars: 24000
  },

  scopes: ['file:正文:rw', 'agent:ask']
})

export default NOVEL_CARRIER
