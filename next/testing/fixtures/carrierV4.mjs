/**
 * 协议 v4 全字段夹具（批次52）。
 *
 * 它不是随框架发布的载体——只给 next/tests 用。四组借鉴字段＋两个调度方增项都在这份清单里
 * 各有一处真实声明，让「校验器认不认」与「宿主读不读」都能被同一份样例钉住：
 *
 *   pane.multiplicity / scope / keyField   三块 pane 分别走 single／keyed／list
 *   pane.claims / priority / canOpen / takes   keyed 那块认领文档与资料两类资源
 *   preview.register                       两个扩展名族，两种 loading 档
 *   maxKernel                              与 minKernel 成对
 *   license                                subscription ＋ 协议文件 ＋ 版本
 *   services[].adopt                       外部进程自管，宿主只探活
 *
 * 12 份真载体清单本批不动（批次53 迁移），所以宿主对 @4 的读取点只能先由夹具兑现。
 */
export const FIXTURE_V4 = Object.freeze({
  spec: 'pinax-carrier@4',
  manifestVersion: 4,
  id: 'fixture.v4',
  title: '协议 v4（夹具）',
  version: '1.0.0',
  minKernel: '1',
  maxKernel: '2',
  tier: 'carrier',

  primary: {
    projectKind: 'generic',
    defaultPane: 'v4.editor',
    contextProfile: 'authoring-knowledge'
  },

  dataDirs: Object.freeze({
    docs: '文档',
    reference: '资料'
  }),

  panes: Object.freeze([
    {
      slot: 'center',
      id: 'v4.editor',
      title: '编辑器',
      icon: 'book',
      view: 'pinax.view.editor',
      kind: 'document-detail',
      multiplicity: 'single',
      scope: 'project'
    },
    {
      slot: 'left-dock',
      id: 'v4.tabs',
      title: '文档页签',
      icon: 'list',
      view: 'pinax.view.list',
      kind: 'records-editor',
      multiplicity: 'keyed',
      scope: 'entry',
      keyField: 'docId',
      claims: Object.freeze(['文档/**/*.md', '资料/*.txt']),
      priority: 60,
      canOpen: Object.freeze({ field: 'kind', in: Object.freeze(['chapter', 'note']) }),
      takes: 'extension'
    },
    {
      slot: 'overlay',
      id: 'v4.panel',
      title: '面板',
      icon: 'plugin',
      view: 'pinax.view.custom',
      kind: 'custom-panel',
      width: 320,
      forms: Object.freeze(['overlay']),
      multiplicity: 'list',
      scope: 'session'
    }
  ]),

  entry: Object.freeze({ kind: 'iframe', path: 'ui/index.html' }),

  provides: Object.freeze(['text.chapters', 'reference.documents']),
  requires: Object.freeze([]),
  tools: Object.freeze(['v4.read', 'v4.write']),
  context: Object.freeze({ providers: Object.freeze(['doc']), budgetChars: 20_000 }),
  scopes: Object.freeze(['file:文档:rw', 'file:资料:rw', 'agent:ask']),

  preview: Object.freeze({
    register: Object.freeze([
      Object.freeze({ id: 'markdown', extensions: Object.freeze(['.md', '.txt']), priority: 50, loading: 'text-pages', maxBytes: 2 * 1024 * 1024 }),
      Object.freeze({ id: 'images', extensions: Object.freeze(['.png']), priority: 20, loading: 'bytes-complete', maxBytes: 8 * 1024 * 1024 })
    ])
  }),

  license: Object.freeze({ mode: 'subscription', agreement: 'LICENSE.md', version: '1.2.0' }),

  services: Object.freeze([
    Object.freeze({ id: 'v4-external', adopt: true, port: 9101, healthPath: '/health' })
  ])
})

export default FIXTURE_V4
