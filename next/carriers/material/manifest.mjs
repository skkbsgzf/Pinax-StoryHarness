/**
 * 素材载体（M4）：素材/ 一棵记录树，四条工具（列／读／写／删）。
 *
 * 搬的是老前端 `narrative_assets_v1` 那一层（草稿、事件、人物事实、世界书草稿、灵感、分镜种子、
 * 参考图）：老数据住 localStorage，Next 的第一落点是一份文件真源 `素材/素材.json`，
 * 一条记录一行 JSON，作者看得见、能备份、能进历史。参考图的二进制不在本批（文件服务仍是文本口），
 * 记录里只存 refs（相对路径或外链），等 R3 的资产迁移裁定再补真实拷贝。
 *
 * primary 写 generic：素材库可以是一个泛型项目的主载体；也可以在小说／剧本项目里当伴生板块。
 * contextProfile 取 writing-selection：它在只读任务表里；本批不提供上下文块（providers 空数组），
 * 不谎报一块不存在的素材。
 *
 * 协议 v3（这一块是随框架发布的**自带面板样板**）：
 *   entry   { kind:'iframe', path:'ui/index.html' } —— 面板页住在 next/carriers/material/ui/，
 *           宿主用 pinax-plugin:// 协议把它装进沙箱 iframe，页面只能用只读工具桥。
 *   pane    material.panel（overlay 槽位）用 view=pinax.view.custom ＋ kind=custom-panel 挂它。
 *   agentMd AGENT.md —— 这一栏的作者须知，运行时组上下文时并入。
 * 素材这块本身的能力面没变：树照旧在左竖条、记录详情照旧在中栏；面板是第三块，只读、不写盘。
 */
export const MATERIAL_CARRIER_ID = 'pinax.carrier.material'

export const MATERIAL_CARRIER = Object.freeze({
  // 协议 v4（批次53）：manifestVersion 显式 4；pane 在 v3 的 view／kind 之上补槽语义与资源认领。
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: MATERIAL_CARRIER_ID,
  title: '素材',
  version: '1.1.0',
  minKernel: '1',
  tier: 'carrier',
  license: Object.freeze({ mode: 'free' }),

  primary: {
    projectKind: 'generic',
    defaultPane: 'material.editor',
    contextProfile: 'writing-selection'
  },

  dataDirs: Object.freeze({
    material: '素材'
  }),

  contributes: Object.freeze({
    panes: [
      // 槽语义（批次53）：记录板是整栏一份的记录树（single＋project），兜底认领 素材/**。
      { slot: 'left-dock', id: 'material.board', title: '素材库', icon: 'image', view: 'pinax.view.list', kind: 'records-editor', multiplicity: 'single', scope: 'project', claims: ['素材/**'], priority: 30, takes: 'fallback', forms: ['dock', 'split', 'overlay'] },
      // 槽语义（批次53）：编辑位绑一条记录（single＋entry）；记录真源是 素材/素材.json，
      // 认领 素材/**/*.json 并以 extension 档接管。
      { slot: 'center', id: 'material.editor', title: '素材', icon: 'image', view: 'pinax.view.editor', kind: 'records-editor', multiplicity: 'single', scope: 'entry', claims: ['素材/**/*.json'], priority: 70, canOpen: { field: 'kind', equals: 'material-record' }, takes: 'extension', forms: ['dock', 'split', 'overlay'] },
      // 自带面板（协议 v3）：内容面是插件自己的页面，宿主只给一块沙箱 iframe 与一条只读工具桥。
      // 槽语义（批次53）：面板是只读的第二看法，允许多开（list）且随会话存续（session）；不认领文件。
      { slot: 'overlay', id: 'material.panel', title: '素材面板', icon: 'image', view: 'pinax.view.custom', kind: 'custom-panel', width: 320, multiplicity: 'list', scope: 'session', forms: ['overlay'] }
    ],
    // 批次62 任务一：命令面（既有动作的另一个入口）。
    // 这个板块的 centerPanes 只有一块（material.editor），所以「打开这一页」与「点竖条这一格」是同一条路，
    // 只留一条 open-board——多写一条就是第二条入口的假象，评审会问「这条落到哪个既有动作」。
    //   material.open-board     board:pinax.carrier.material   ← 竖条点「素材」这一格（AppNext.selectBoard）
    //   material.reload-records data:loadRecords:material      ← 索引窗／画廊的「刷新」（IndexWindow.vue:504、MaterialGallery.vue:38）
    //   material.edit-record    data:editRecord                ← 「编辑」钮（CarrierPaneHost.vue:1645）
    //   material.save-record    data:saveRecord                ← 「保存」钮（CarrierPaneHost.vue:1641）
    commands: [
      { id: 'material.open-board', title: '打开素材栏', run: 'board:pinax.carrier.material' },
      { id: 'material.reload-records', title: '重新载入素材清单', run: 'data:loadRecords:material' },
      { id: 'material.edit-record', title: '编辑当前素材', run: 'data:editRecord' },
      { id: 'material.save-record', title: '保存当前素材', run: 'data:saveRecord' }
    ],
    settings: []
  }),

  provides: ['media.assets'],
  requires: [],

  tools: ['pinax_material_list', 'pinax_material_read', 'pinax_material_save', 'pinax_material_remove'],

  context: {
    providers: [],
    budgetChars: 12000
  },

  permissions: [{ type: 'file', dir: '素材', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed'],

  // 协议 v3 的四张牌：这一栏只声明面板与作者须知，不起服务、不挂外部 MCP。
  entry: Object.freeze({ kind: 'iframe', path: 'ui/index.html' }),
  services: Object.freeze([]),
  mcp: Object.freeze([]),
  agentMd: 'AGENT.md'
})

export default MATERIAL_CARRIER
