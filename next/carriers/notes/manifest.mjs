/**
 * 构思载体（协议 v1.1-A：作者 2026-10-28 裁定把构思从小说栏拆成独立一栏）。
 * 它认领 构思/ 这一块目录、两把工具：pinax_notes_list（列篇目，正文随手带回）与
 * pinax_notes_save（覆盖式写入口，带 expectedRevision）。两把都是载体自有名字——
 * 内核没有同名工具可认领，所以认领面（claimed）不因此增长，聚合面记在 declaredOutsideKernel。
 *
 * primary 写 generic：构思可以是泛型项目的主载体（一个纯想法库），
 * 也可以在小说/剧本项目里当伴生板块被启用。contextProfile 取 writing-selection：
 * 它在只读任务表里（authoring.review.selection 是 review-only）；构思目前不提供上下文块，
 * 所以 context.providers 是空数组——不谎报一块不存在的素材。
 */
export const NOTES_CARRIER_ID = 'pinax.carrier.notes'

export const NOTES_CARRIER = Object.freeze({
  // 协议 v4（批次53）：manifestVersion 显式 4；pane 在 v3 的 view／kind 之上补槽语义与资源认领。
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: NOTES_CARRIER_ID,
  title: '构思',
  version: '1.2.0',
  minKernel: '1',
  tier: 'carrier',
  license: Object.freeze({ mode: 'free' }),

  primary: {
    projectKind: 'generic',
    defaultPane: 'notes.editor',
    contextProfile: 'writing-selection'
  },

  dataDirs: Object.freeze({
    notes: '构思'
  }),

  contributes: Object.freeze({
    panes: [
      // 槽语义（批次53）：清单是整栏一份的导航面（single＋project），兜底认领 构思/**。
      { slot: 'left-dock', id: 'notes.list', title: '构思清单', icon: 'idea', view: 'pinax.view.list', kind: 'notes-editor', multiplicity: 'single', scope: 'project', claims: ['构思/**'], priority: 30, takes: 'fallback', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] },
      // 槽语义（批次53）：编辑位绑一篇构思（single＋entry），认领 构思/**/*.md 并以 extension 档接管。
      { slot: 'center', id: 'notes.editor', title: '构思编辑', icon: 'writing', view: 'pinax.view.editor', kind: 'notes-editor', multiplicity: 'single', scope: 'entry', claims: ['构思/**/*.md'], priority: 70, canOpen: { field: 'kind', equals: 'note' }, takes: 'extension', forms: ['dock', 'split', 'overlay', 'fullscreen', 'immersive'] }
    ],
    // 协议 P14：本载体暂无设置项——空数组＝设置页不出这一格（不按载体标题伪造占位节）。
    settings: []
  }),

  provides: ['notes.ideas'],
  requires: [],

  tools: ['pinax_notes_list', 'pinax_notes_save'],

  context: {
    providers: [],
    budgetChars: 20000
  },

  // agent:ask 是运行时调用载体工具的前置授权（next/kernel/scopeGrant.mjs:59）：缺了它，这一栏的
  // 读写工具在运行时面上会被整组拒掉。与小说/资料同一口径。
  permissions: [{ type: 'file', dir: '构思', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed'],

  // 协议 v3 的四张牌：这一栏用宿主视图（没有自带面板），不起本地服务、不挂外部 MCP；
  // 只声明作者须知——运行时组上下文时把 AGENT.md 并进信封。
  entry: null,
  services: Object.freeze([]),
  mcp: Object.freeze([]),
  agentMd: 'AGENT.md'
})

export default NOTES_CARRIER
