/**
 * 资料载体（工单G1）：资料/ 目录的最小认领面。
 * 它存在的理由很直接：资料/ 在固化骨架里一直有（novel/screenplay/generic 三种 kind 都含它），
 * 但此前没有任何载体认领它，于是它只出现在索引窗的「只读归档」里——
 * 作者看得到目录，却打不开一篇、也改不了一行。
 *
 * 这块板块只做三件事（本批边界写在 limitations 里）：
 *   - pinax_document_list  列 资料/ 下的 .md 与 .txt，篇目随手带回前 20000 字（先例：构思速记那对）；
 *   - pinax_document_read  单篇全文（maxChars 1000–200000）；
 *   - pinax_document_save  带 expectedRevision 的覆盖式写入口（先例：pinax_chapter_save）。
 * 三把都是载体自有名字：内核没有同名工具可认领（内核的 pinax_knowledge_search 是 RAG 检索轨，
 * 强依赖本机 Express 服务，Next 桌面没有，本批不做，也不在这里冒充认领）。
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
  tools: ['pinax_document_list', 'pinax_document_read', 'pinax_document_save'],

  context: {
    providers: ['references'],
    budgetChars: 12000
  },

  scopes: ['file:资料:rw', 'agent:ask']
})

export default REFERENCE_CARRIER
