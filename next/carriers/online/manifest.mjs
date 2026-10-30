/**
 * 联机载体（M5）：联机/ 一棵记录树，四条工具（列／读／写／删）。
 *
 * 搬的是老前端 OnlineExperience.vue 那一层（房间、成员、邀请）。
 * 这里必须说清一条边界：**联机本身是外部服务**，不在内核里，也不在本批里。
 * 本载体只做**本地记录面**——房间名、成员、邀请码、备注落成 `联机/联机.json`，
 * 供作者与运行时读写；它不申请 net 作用域、不发网络请求、不假装能连上任何服务器。
 * 真正的联机客户端将来做外部服务插件，按 manifest 的能力口径 `collaboration.rooms` 接入。
 *
 * provides collaboration.rooms：这个能力今天只有这一块载体声明；将来外部联机插件要接管时，
 * 换的是提供者，不是内核。
 */
export const ONLINE_CARRIER_ID = 'pinax.carrier.online'

export const ONLINE_CARRIER = Object.freeze({
  spec: 'pinax-carrier@2',
  manifestVersion: 2,
  id: ONLINE_CARRIER_ID,
  title: '联机',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'online.editor',
    contextProfile: 'writing-selection'
  },

  dataDirs: Object.freeze({
    online: '联机'
  }),

  contributes: Object.freeze({
    panes: [
      { slot: 'left-dock', id: 'online.board', title: '联机房间', icon: 'collaboration', view: 'pinax.view.list', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      { slot: 'center', id: 'online.editor', title: '联机', icon: 'collaboration', view: 'pinax.view.editor', forms: ['dock', 'split', 'overlay', 'fullscreen'] }
    ],
    settings: []
  }),

  provides: ['collaboration.rooms'],
  requires: [],

  tools: ['pinax_online_list', 'pinax_online_read', 'pinax_online_save', 'pinax_online_remove'],

  context: {
    providers: [],
    budgetChars: 12000
  },

  // 有意不申请 net：本批没有任何网络行为，声明了就是谎报权限。
  permissions: [{ type: 'file', dir: '联机', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed']
})

export default ONLINE_CARRIER
