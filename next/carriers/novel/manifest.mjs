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
 *
 * 批次46A：正文的章节管理（删除／重命名）也归小说——两把写工具走文件服务的受控破坏性出口，
 * 删／改之前强制历史快照；上移／下移是界面层对相邻两章前缀的两次 rename，不另开工具。
 */
export const NOVEL_CARRIER_ID = 'pinax.carrier.novel'

export const NOVEL_CARRIER = Object.freeze({
  // 协议 v4（批次53）：manifestVersion 显式 4；pane 在 v3 的 view／kind 之上补槽语义与资源认领。
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: NOVEL_CARRIER_ID,
  title: '小说',
  version: '0.5.0',
  minKernel: '1',
  tier: 'carrier',
  // 随框架发布的内置载体没有议价面：免费。外部订阅／买断由第三方清单自己声明（v4 起）。
  license: Object.freeze({ mode: 'free' }),

  primary: {
    projectKind: 'novel',
    defaultPane: 'novel.editor',
    // 与 shared/agentContextProfiles.js 的 writing-chapter 同名：运行时组上下文时按这个档案取块。
    contextProfile: 'writing-chapter'
  },

  dataDirs: Object.freeze({
    manuscript: '正文'
  }),

  contributes: Object.freeze({
    panes: [
      // 竖条图标对齐老版「书稿」那一格用的就是 outline（WorkspaceContentGroups.vue:23），
      // 见 next-shell-alignment-inventory-20261028.md 差异表 #3（B 类）。
      // view（工单 C2）：pane 自己声明视图类型，宿主不再按 id 前缀猜。
      // 槽语义（批次53）：书稿是整本书的章节索引，整份项目只有一份（single＋project）；
      // 它是正文/** 的兜底面——精确到某一章 .md 的打开由 novel.editor 接管（fallback，优先级低）。
      { slot: 'left-dock', id: 'novel.shelf', title: '书稿', icon: 'outline', view: 'pinax.view.editor', kind: 'chapter-editor', multiplicity: 'single', scope: 'project', claims: ['正文/**'], priority: 30, takes: 'fallback', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] },
      // 槽语义（批次53）：正文编辑位绑「一条正文资源」（scope:entry，一章一编辑位）；
      // 它认领 正文/**/*.md 并以 extension 档接管——同一章同时命中书稿时，编辑面赢。
      { slot: 'center', id: 'novel.editor', title: '正文', icon: 'writing', view: 'pinax.view.editor', kind: 'chapter-editor', multiplicity: 'single', scope: 'entry', claims: ['正文/**/*.md'], priority: 70, canOpen: { field: 'kind', in: ['chapter', 'proposal'] }, takes: 'extension', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] }
    ],
    // 协议 P14 → v2：v1 的 { id, title } 读成 section；「写作偏好」仍是目录项＋空态。
    settings: [{ id: 'novel.writing', title: '写作偏好', type: 'section' }]
  }),

  provides: ['text.chapters'],
  requires: [],

  tools: ['pinax_chapter_list', 'pinax_chapter_read', 'pinax_chapter_save', 'pinax_chapter_delete', 'pinax_chapter_rename', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard'],

  context: {
    // providers 写的是「上下文块的种类名」（与 shared/agentContextProfiles.js 的 blocks 对齐），
    // 运行时按这个名字找提供者；大纲块随大纲载体迁出，小说栏只留正文 selection 块。
    providers: ['selection'],
    budgetChars: 24000
  },

  // permissions 是 scopes 的新名字：文件类走对象，agent:ask 这类非文件作用域仍按串写。
  permissions: [{ type: 'file', dir: '正文', mode: 'rw' }, 'agent:ask'],

  // 工单 C3：订阅 project.changed（载体重载后由运行时广播）。
  subscriptions: ['project.changed'],

  // 协议 v3 的四张牌：这一栏用宿主视图（没有自带面板），不起本地服务、不挂外部 MCP；
  // 只声明作者须知——运行时组上下文时把 AGENT.md 并进信封。
  entry: null,
  services: Object.freeze([]),
  mcp: Object.freeze([]),
  agentMd: 'AGENT.md'
})

export default NOVEL_CARRIER
