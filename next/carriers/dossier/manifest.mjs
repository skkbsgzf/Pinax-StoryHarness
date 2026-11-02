/**
 * 设定与资料载体（批次60）：`约束/` 与 `资料/` 合并成一栏。
 *
 * 合并的理由写在工单里：两块板块做的是同一件事——「写的时候要查、要守的东西」——
 * 却各占竖条一格、各开一棵树。作者裁定收成一栏：一个载体＝竖条一格＝一棵本域树，
 * 树分两段（资料／约束），编辑面沿用各自原有的面孔（资料=文档面，约束=规则面）。
 *
 * 工具面原样合并：`pinax_rule_*` 与 `pinax_document_*` 的名字与语义一字不改——
 * Agent 已经披露过的工具名不能因为载体形体重排而消失。`pinax_reference_search` 同理。
 *
 * 迁移：旧载体 `pinax.carrier.setting`／`pinax.carrier.reference` 从随框架发布清单退役；
 * 已存项目的 project.json 里若还写着旧 id，由打开路径（next/project/openProject.mjs）
 * 在内存里映射到本载体——C 盘与《大梦》目录结构零改动，磁盘上的资料与约束文件一个字节不改。
 *
 * primary 写 generic：设定与资料可以是一个纯资料项目的主载体，也可以在小说/剧本项目里当伴生板块。
 * contextProfile 取 setting-research：档案块表同时含 rules／references，且只读任务表里有 research。
 */
export const DOSSIER_CARRIER_ID = 'pinax.carrier.dossier'
/** 旧 id → 新 id 的打开期映射表（openProject 用它消化已存项目；表只在内存里生效）。 */
export const DOSSIER_LEGACY_IDS = Object.freeze({
  'pinax.carrier.setting': DOSSIER_CARRIER_ID,
  'pinax.carrier.reference': DOSSIER_CARRIER_ID
})

export const DOSSIER_CARRIER = Object.freeze({
  // 协议 v4（批次53）：manifestVersion 显式 4；pane 在 v3 的 view／kind 之上补槽语义与资源认领。
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: DOSSIER_CARRIER_ID,
  title: '设定与资料',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',
  license: Object.freeze({ mode: 'free' }),

  primary: {
    projectKind: 'generic',
    defaultPane: 'dossier.editor',
    contextProfile: 'setting-research'
  },

  // 两个逻辑名、两个物理目录（@4 合法）：资料在前——folder 树的第一段、数据目录顺位的缺省。
  dataDirs: Object.freeze({
    documents: '资料',
    constraints: '约束'
  }),

  contributes: Object.freeze({
    panes: [
      // 槽语义（批次53）：整栏一份的双段树（single＋project），兜底认领 资料/** 与 约束/**。
      // kind 取 document-detail：这棵树的主要面孔是文档；约束文件由编辑面按 selection 切规则面孔。
      { slot: 'left-dock', id: 'dossier.board', title: '设定与资料', icon: 'library', view: 'pinax.view.tree', kind: 'document-detail', multiplicity: 'single', scope: 'project', claims: ['资料/**', '约束/**'], priority: 30, takes: 'fallback', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] },
      // 槽语义（批次53）：编辑位绑一份文档或一条约束（single＋entry），两类都认。
      // canOpen 用 in：资料与约束在同一块编辑面里按 selection 换面孔，裁决不因半边不匹配而落空。
      { slot: 'center', id: 'dossier.editor', title: '资料与约束', icon: 'document', view: 'pinax.view.reader', kind: 'document-detail', multiplicity: 'single', scope: 'entry', claims: ['资料/**/*.md', '资料/**/*.txt', '约束/**/*.md'], priority: 70, canOpen: { field: 'kind', in: ['document', 'rule'] }, takes: 'extension', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] }
    ],
    // 批次62 任务一：命令面（既有动作的另一个入口）：
    //   dossier.open-board       board:pinax.carrier.dossier ← 竖条点「设定与资料」这一格（AppNext.selectBoard）
    //   dossier.open-editor      pane:dossier.editor         ← 点资料页签／左树开一份（routeOpen 唯一通路）
    //   dossier.reload-documents data:loadDocuments          ← 索引窗的「刷新」（IndexWindow.vue:497）
    //   dossier.reload-rules     data:loadRules              ← 索引窗的「刷新」（IndexWindow.vue:498）
    //   dossier.edit-document    data:editDocument           ← 文档头的「编辑」（CarrierPaneHost.vue:1553）
    //   dossier.save-rule        data:saveRule               ← 约束编辑位的「保存」（CarrierPaneHost 的动作表）
    commands: [
      { id: 'dossier.open-board', title: '打开设定与资料栏', run: 'board:pinax.carrier.dossier' },
      { id: 'dossier.open-editor', title: '打开资料与约束这一页', run: 'pane:dossier.editor' },
      { id: 'dossier.reload-documents', title: '重新载入资料清单', run: 'data:loadDocuments' },
      { id: 'dossier.reload-rules', title: '重新载入约束清单', run: 'data:loadRules' },
      { id: 'dossier.edit-document', title: '编辑当前资料', run: 'data:editDocument' },
      { id: 'dossier.save-rule', title: '保存当前约束', run: 'data:saveRule' }
    ],
    // 协议 P14：本载体暂无设置项——空数组＝设置页不出这一格。
    settings: []
  }),

  // 能力面取两块旧载体的并集：依赖闭包按能力算，合并不能让任一供给消失。
  provides: ['constraint.rules', 'reference.documents'],
  requires: [],

  // 六把工具名与语义一字不改（Agent 面零破坏）：约束对 ＋ 资料三把 ＋ 资料检索。
  tools: [
    'pinax_rule_list',
    'pinax_rule_save',
    'pinax_document_list',
    'pinax_document_read',
    'pinax_document_save',
    'pinax_reference_search'
  ],

  // 上下文块取两块旧载体的并集；预算沿用设定那块的上限（约束整篇会进信封，资料只列篇目）。
  context: {
    providers: ['rules', 'style', 'references'],
    budgetChars: 20000
  },

  // 两个目录各申请 rw；agent:ask 是运行时调用载体工具的前置授权，缺了整组被拒。
  permissions: [
    { type: 'file', dir: '资料', mode: 'rw' },
    { type: 'file', dir: '约束', mode: 'rw' },
    'agent:ask'
  ],

  subscriptions: ['project.changed'],

  // 协议 v3 的四张牌：用宿主视图（没有自带面板），不起本地服务、不挂外部 MCP；
  // 只声明作者须知——运行时组上下文时把 AGENT.md 并进信封。
  entry: null,
  services: Object.freeze([]),
  mcp: Object.freeze([]),
  agentMd: 'AGENT.md'
})

export default DOSSIER_CARRIER
