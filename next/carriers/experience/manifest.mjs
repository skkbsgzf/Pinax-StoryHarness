/**
 * 体验载体（M5）：体验/ 一棵记录树，四条工具（列／读／写／删）。
 *
 * 搬的是老前端 Experience.vue 那一层（跑团／互动叙事：一个本子、一次会话、一次跑团的记录）。
 * 老数据住老页面的本地状态，Next 的第一落点是一份文件真源 `体验/体验.json`。
 * 本批只落**会话记录与编排**：不接模型自动跑团、不做骰子／状态机的实时演算，
 * 这些留在「运行层」将来接；记录里的 meta 原样承载状态快照。
 *
 * requires script.scenes（D3/D4）：体验的「本子」就是剧本——启用体验时，依赖闭包会把剧本载体
 * 一起装齐；若项目里连剧本载体都没装，清单校验／启用闸会给出下面这句修复路径，而不是静默少一块。
 * primary.projectKind 写 screenplay：体验项目天生带 剧本/人物/场景 的骨架。
 */
export const EXPERIENCE_CARRIER_ID = 'pinax.carrier.experience'

export const EXPERIENCE_CARRIER = Object.freeze({
  // 协议 v4（批次53）：manifestVersion 显式 4；pane 在 v3 的 view／kind 之上补槽语义与资源认领。
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: EXPERIENCE_CARRIER_ID,
  title: '体验',
  version: '1.1.0',
  minKernel: '1',
  tier: 'carrier',
  license: Object.freeze({ mode: 'free' }),

  primary: {
    projectKind: 'screenplay',
    defaultPane: 'experience.editor',
    contextProfile: 'authoring-knowledge'
  },

  dataDirs: Object.freeze({
    experience: '体验'
  }),

  contributes: Object.freeze({
    panes: [
      // 槽语义（批次53）：体验会话板是整栏一份的记录树（single＋project），兜底认领 体验/**。
      { slot: 'left-dock', id: 'experience.board', title: '体验会话', icon: 'adventure', view: 'pinax.view.list', kind: 'records-editor', multiplicity: 'single', scope: 'project', claims: ['体验/**'], priority: 30, takes: 'fallback', forms: ['dock', 'split', 'overlay', 'fullscreen'] },
      // 槽语义（批次53）：编辑位绑一条会话记录（single＋entry），认领 体验/**/*.json 并以 extension 档接管。
      { slot: 'center', id: 'experience.editor', title: '体验', icon: 'adventure', view: 'pinax.view.editor', kind: 'records-editor', multiplicity: 'single', scope: 'entry', claims: ['体验/**/*.json'], priority: 70, canOpen: { field: 'kind', equals: 'experience-record' }, takes: 'extension', forms: ['dock', 'split', 'overlay', 'fullscreen'] }
    ],
    settings: []
  }),

  provides: ['session.runs'],
  requires: [
    {
      capability: 'script.scenes',
      fix: '启用「剧本」载体（pinax.carrier.script）以提供剧本场景；或在新建项目时选剧本类型，依赖闭包会自动把它装齐。'
    }
  ],

  tools: ['pinax_experience_list', 'pinax_experience_read', 'pinax_experience_save', 'pinax_experience_remove'],

  context: {
    providers: [],
    budgetChars: 16000
  },

  permissions: [{ type: 'file', dir: '体验', mode: 'rw' }, 'agent:ask'],

  subscriptions: ['project.changed'],

  // 协议 v3 的四张牌：这一栏用宿主视图（没有自带面板），不起本地服务、不挂外部 MCP；
  // 只声明作者须知——运行时组上下文时把 AGENT.md 并进信封。
  entry: null,
  services: Object.freeze([]),
  mcp: Object.freeze([]),
  agentMd: 'AGENT.md'
})

export default EXPERIENCE_CARRIER
