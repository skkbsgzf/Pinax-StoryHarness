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
  // 协议 v4（批次53）：manifestVersion 显式 4；pane 在 v3 的 view／kind 之上补槽语义与资源认领。
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: VIDEO_CARRIER_ID,
  title: '视频',
  version: '1.1.0',
  minKernel: '1',
  tier: 'carrier',
  license: Object.freeze({ mode: 'free' }),

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
      // 槽语义（批次53）：镜头与成片板是整栏一份的记录树（single＋project），兜底认领 视频/**。
      { slot: 'left-dock', id: 'video.board', title: '镜头与成片', icon: 'film', view: 'pinax.view.list', kind: 'records-editor', multiplicity: 'single', scope: 'project', claims: ['视频/**'], priority: 30, takes: 'fallback', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      // 槽语义（批次53）：编辑位绑一条镜头／成片记录（single＋entry），认领 视频/**/*.json 并以 extension 档接管。
      { slot: 'center', id: 'video.editor', title: '视频', icon: 'film', view: 'pinax.view.editor', kind: 'records-editor', multiplicity: 'single', scope: 'entry', claims: ['视频/**/*.json'], priority: 70, canOpen: { field: 'kind', equals: 'video-record' }, takes: 'extension', forms: ['dock', 'split', 'overlay', 'fullscreen'] }
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

  subscriptions: ['project.changed'],

  // 协议 v3 的四张牌：这一栏用宿主视图（没有自带面板），不起本地服务、不挂外部 MCP；
  // 只声明作者须知——运行时组上下文时把 AGENT.md 并进信封。
  entry: null,
  services: Object.freeze([]),
  mcp: Object.freeze([]),
  agentMd: 'AGENT.md'
})

export default VIDEO_CARRIER
