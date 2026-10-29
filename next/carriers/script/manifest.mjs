/**
 * 剧本载体（M6 提前 · 批次26）：剧本/ 目录的最小认领面。
 *
 * 存在的理由：骨架里 screenplay 这一种 kind 早在（剧本/人物/场景/大纲/世界书/资料/日志/约束），
 * 但没有任何载体认领 剧本/ ——作者看得到目录，却打不开一场、也改不了一行台词。
 * 这一栏认领 剧本/ 一棵内容树，三把工具（列／读／写），中栏是剧本阅读/编辑面。
 *
 * 工具形状照小说那对章节工具与资料那对（同一套：列表随手带回全文、读单篇、写带修订号）：
 *   pinax_script_list  列 剧本/ 下的 .md（剧本是 md 原生，正文里带场次标题与台词）
 *   pinax_script_read  单篇全文，maxChars 可截断
 *   pinax_script_save  覆盖式写入口，必须带读到的修订号（新建传 0）
 * 三把都是载体自有名字：内核 19 工具里没有 pinax_script_*，所以不构成「认领＝同名接管」，
 * 也不动内核那 19 个名字的面（写族闸把 剧本/ 的写入点名到自有 save）。
 *
 * primary.projectKind 写 screenplay：剧本/ 只在 screenplay 骨架里，
 * 与「这块载体天生是剧本项目的正主」一致；也可以在小说项目里当伴生栏被启用。
 * contextProfile 取 authoring-knowledge：它在只读任务表里，且档案块表含 references
 * （剧本目录作为素材块进信封；shared 的档案表没有 script 种类，这一点写在 context.mjs 的注释里）。
 */
export const SCRIPT_CARRIER_ID = 'pinax.carrier.script'

export const SCRIPT_CARRIER = Object.freeze({
  spec: 'pinax-carrier@2',
  manifestVersion: 2,
  id: SCRIPT_CARRIER_ID,
  title: '剧本',
  version: '1.1.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'screenplay',
    defaultPane: 'script.editor',
    contextProfile: 'authoring-knowledge'
  },

  dataDirs: Object.freeze({
    script: '剧本'
  }),

  contributes: Object.freeze({
    panes: [
      // 竖条图标用 film（老前端图标表里的片子那一枚）；中栏是剧本正文。
      { slot: 'left-dock', id: 'script.board', title: '剧本板', icon: 'film', view: 'pinax.view.list' },
      { slot: 'center', id: 'script.editor', title: '剧本', icon: 'document', view: 'pinax.view.editor' }
    ],
    // 协议 P14：本载体暂无设置项——空数组＝设置页不出这一格（不按载体标题伪造占位节）。
    settings: []
  }),

  provides: ['script.scenes'],
  requires: [],

  tools: ['pinax_script_list', 'pinax_script_read', 'pinax_script_save'],

  context: {
    // 剧本篇目作为素材进信封（照资料载体的 references 惯例）：档案块表里有 references 的
    // 只读任务才认这一块。script 是本载体的原生块种类名，留给档案表将来收这一种时直接用。
    providers: ['script', 'references'],
    budgetChars: 12000
  },

  // agent:ask 是运行时调用载体工具的前置授权（next/kernel/scopeGrant.mjs）：缺了它，这一栏的
  // 三把工具在运行时面上会被整组拒掉。与小说/资料同一口径。
  permissions: [{ type: 'file', dir: '剧本', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed']
})

export default SCRIPT_CARRIER
