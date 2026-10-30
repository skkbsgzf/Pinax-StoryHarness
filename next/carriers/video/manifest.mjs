/**
 * 视频载体（M4）：视频/ 一棵记录树，四条工具（列／读／写／删）。
 *
 * 搬的是出片前的编排层：镜头、分镜、成片段、音轨、备注。老前端这一块依赖本地图像／ComfyUI，
 * 本批只把**编排数据**落成文件真源 `视频/视频.json`；渲染管线（ComfyUI／medius）不在本批，
 * 也不假装已经接通——记录的 refs 存成片路径或外链，status 里保留 rendering 这一档。
 *
 * provides video.render：这是「出片与渲染」的能力口径，给将来的渲染插件认领同一块地盘。
 */
export const VIDEO_CARRIER_ID = 'pinax.carrier.video'

export const VIDEO_CARRIER = Object.freeze({
  spec: 'pinax-carrier@2',
  manifestVersion: 2,
  id: VIDEO_CARRIER_ID,
  title: '视频',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'video.editor',
    contextProfile: 'writing-selection'
  },

  dataDirs: Object.freeze({
    video: '视频'
  }),

  contributes: Object.freeze({
    panes: [
      { slot: 'left-dock', id: 'video.board', title: '镜头与成片', icon: 'film', view: 'pinax.view.list', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      { slot: 'center', id: 'video.editor', title: '视频', icon: 'film', view: 'pinax.view.editor', forms: ['dock', 'split', 'overlay', 'fullscreen'] }
    ],
    settings: []
  }),

  provides: ['video.render'],
  requires: [],

  tools: ['pinax_video_list', 'pinax_video_read', 'pinax_video_save', 'pinax_video_remove'],

  context: {
    providers: [],
    budgetChars: 12000
  },

  permissions: [{ type: 'file', dir: '视频', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed']
})

export default VIDEO_CARRIER
