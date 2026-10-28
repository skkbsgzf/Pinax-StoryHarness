/**
 * 资料载体（工单G1）：资料/ 目录的最小认领面。
 * 它存在的理由很直接：资料/ 在固化骨架里一直有（novel/screenplay/generic 三种 kind 都含它），
 * 但此前没有任何载体认领它，于是它只出现在索引窗的「只读归档」里——
 * 作者看得到目录，却打不开一篇、也改不了一行。
 *
 * 这块板块做四件事（本批边界写在 limitations 里）：
 *   - pinax_document_list  列 资料/ 下的 .md 与 .txt，篇目随手带回前 20000 字（先例：构思速记那对）；
 *   - pinax_document_read  单篇全文（maxChars 1000–200000）；
 *   - pinax_document_save  带 expectedRevision 的覆盖式写入口（先例：pinax_chapter_save）；
 *   - pinax_reference_search 资料板检索（工单H2）：走主进程内的 knowledgeService（createKnowledgeRuntime，
 *                           worker 线程、零 HTTP），verb 固定 kb_search，q 必填，dir 恒限定 资料。
 * 四把都是载体自有名字：内核没有同名工具可认领。内核的 pinax_knowledge_search 是 HTTP 包装的 RAG 轨
 * （强依赖本机 Express 服务），这里不认领它、也不冒充它；H2 的检索是另一条进程内底座，名字独立。
 * primary.projectKind 写 generic：资料可以是泛型项目的主载体（一个纯资料库），
 * 也可以在小说/剧本项目里当伴生板块被启用——两条路都走得通，不绑死在某一种项目类型上。
 */
export const REFERENCE_CARRIER_ID = 'pinax.carrier.reference'

export const REFERENCE_CARRIER = Object.freeze({
  spec: 'pinax-carrier@1',
  id: REFERENCE_CARRIER_ID,
  title: '资料',
  version: '1.0.0',
  minKernel: '1',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'reference.documents',
    contextProfile: 'setting-research'
  },

  dataDirs: Object.freeze({
    documents: '资料'
  }),

  panes: [
    { slot: 'left-dock', id: 'reference.board', title: '资料板', icon: 'sources' },
    { slot: 'center', id: 'reference.documents', title: '资料', icon: 'document' }
  ],

  capabilities: ['reference.documents'],
  requires: [],

  // 协议 P14 载体设置注册（工单B 第一步）：声明格式 [{ id, title, group }]，
  // 由统一设置二级页收进「载体」组。本批先空数组——具体设置项后续批再填。
  settings: [],
  tools: ['pinax_document_list', 'pinax_document_read', 'pinax_document_save', 'pinax_reference_search'],

  context: {
    providers: ['references'],
    budgetChars: 12000
  },

  scopes: ['file:资料:rw', 'agent:ask']
})

export default REFERENCE_CARRIER
