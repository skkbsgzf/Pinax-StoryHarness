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
 */
export const MATERIAL_CARRIER_ID = 'pinax.carrier.material'

export const MATERIAL_CARRIER = Object.freeze({
  spec: 'pinax-carrier@2',
  manifestVersion: 2,
  id: MATERIAL_CARRIER_ID,
  title: '素材',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',

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
      { slot: 'left-dock', id: 'material.board', title: '素材库', icon: 'image', view: 'pinax.view.list', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      { slot: 'center', id: 'material.editor', title: '素材', icon: 'image', view: 'pinax.view.editor', forms: ['dock', 'split', 'overlay', 'fullscreen'] }
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

  subscriptions: ['project.changed']
})

export default MATERIAL_CARRIER
