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
  // 协议 v4（批次53）：manifestVersion 显式 4；pane 在 v3 的 view／kind 之上补槽语义与资源认领。
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: WORLDBOOK_CARRIER_ID,
  title: '世界书',
  version: '1.2.0',
  minKernel: '1',
  tier: 'carrier',
  license: Object.freeze({ mode: 'free' }),

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
      // 槽语义（批次53）：窄栏类别树是整栏一份的导航面（single＋project），兜底认领 世界书/**。
      // 批次44 的「按 pane id 改 kind」例外表由此转正：两块 pane 的分工改由 claims／takes 正面表达。
      { slot: 'left-dock', id: 'worldbook.board', title: '世界书板', icon: 'worldbook', view: 'pinax.view.tree', kind: 'entries-categories', multiplicity: 'single', scope: 'project', claims: ['世界书/**'], priority: 30, takes: 'fallback', forms: ['dock', 'split', 'overlay'] },
      // 槽语义（批次53）：看板区按**条目路径**各开各的（keyed＋entry，keyField='path'）；
      // 它认领 世界书/**/*.md 并以 extension 档接管：同一份条目同时命中类别树时，看板区赢。
      { slot: 'center', id: 'worldbook.entries', title: '条目', icon: 'list', view: 'pinax.view.board', kind: 'entries-workspace', multiplicity: 'keyed', scope: 'entry', keyField: 'path', claims: ['世界书/**/*.md'], priority: 70, canOpen: { field: 'kind', in: ['entry', 'proposal'] }, takes: 'extension', forms: ['dock', 'split', 'overlay'] }
    ],
    // 批次62 任务一：命令面（既有动作的另一个入口）：
    //   worldbook.open-board    board:pinax.carrier.worldbook ← 竖条点「世界书」这一格（AppNext.selectBoard）
    //   worldbook.open-entries  pane:worldbook.entries        ← 点条目页签／左树开一条（routeOpen 唯一通路）
    //   worldbook.reload        data:loadEntries              ← 索引窗的「刷新」（IndexWindow.vue:494）
    //   worldbook.edit-entry    data:editEntry                ← 条目详情头的「编辑」（EntryDetailPanel.vue:170）
    //   worldbook.save-entry    data:saveEntry                ← 条目编辑位的「保存」（CarrierPaneHost.vue:887）
    //   worldbook.filter-all    data:setEntriesFilterCat:     ← 分类树点「全部」那一行（EntriesCategoryTree.vue:29；
    //                                                           结尾那个空串就是「不设分类筛选」这条既有动作的入参）
    commands: [
      { id: 'worldbook.open-board', title: '打开世界书栏', run: 'board:pinax.carrier.worldbook' },
      { id: 'worldbook.open-entries', title: '打开条目这一页', run: 'pane:worldbook.entries' },
      { id: 'worldbook.reload', title: '重新载入条目清单', run: 'data:loadEntries' },
      { id: 'worldbook.edit-entry', title: '编辑当前条目', run: 'data:editEntry' },
      { id: 'worldbook.save-entry', title: '保存当前条目', run: 'data:saveEntry' },
      { id: 'worldbook.filter-all', title: '按全部分类列出条目', run: 'data:setEntriesFilterCat:' }
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
