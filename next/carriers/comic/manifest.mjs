/**
 * 漫画载体（M4）：漫画/ 一棵记录树，四条工具（列／读／写／删）。
 *
 * 搬的是老前端 `comic_pages_v1` 那一层（一页一条，panels 放在 meta 里原样保存）。
 * 老数据住 IndexedDB，Next 的第一落点是一份文件真源 `漫画/漫画.json`。
 * 画格图片本身不在本批（文件服务仍是文本口）：记录里存 refs（图相对路径／外链）与
 * meta.panels（每格的构图与台词），等 R3 的资产迁移裁定再补真实图片。
 *
 * provides storyboard.shots：漫画页与分镜共用「一格一格讲故事」的能力口径；
 * 将来视频载体要引用漫画分镜时，闭包按能力找得到它。
 */
export const COMIC_CARRIER_ID = 'pinax.carrier.comic'

export const COMIC_CARRIER = Object.freeze({
  spec: 'pinax-carrier@2',
  manifestVersion: 2,
  id: COMIC_CARRIER_ID,
  title: '漫画',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'comic.editor',
    contextProfile: 'writing-selection'
  },

  dataDirs: Object.freeze({
    comic: '漫画'
  }),

  contributes: Object.freeze({
    panes: [
      { slot: 'left-dock', id: 'comic.board', title: '漫画页', icon: 'comics', view: 'pinax.view.list', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      { slot: 'center', id: 'comic.editor', title: '漫画', icon: 'comics', view: 'pinax.view.editor', forms: ['dock', 'split', 'overlay', 'fullscreen'] }
    ],
    settings: []
  }),

  provides: ['storyboard.shots'],
  requires: [],

  tools: ['pinax_comic_list', 'pinax_comic_read', 'pinax_comic_save', 'pinax_comic_remove'],

  context: {
    providers: [],
    budgetChars: 12000
  },

  permissions: [{ type: 'file', dir: '漫画', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed']
})

export default COMIC_CARRIER
