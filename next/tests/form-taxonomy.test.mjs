import test from 'node:test'
import assert from 'node:assert/strict'
import {
  APP_PANE_URL_MAX,
  CARRIER_SPEC_V3,
  PANE_KIND_WORDS,
  validateCarrierManifest
} from '../kernel/carrierManifest.mjs'
import {
  FORM_VIEW_TYPES,
  KIND_FORMS,
  PANE_FORM,
  PANE_FORMS,
  formOfKind,
  formOfView,
  isAppKind,
  isBoardKind,
  isDocumentKind
} from '../shell/formTaxonomy.mjs'
import { HOST_VIEW_TYPES } from '../shell/viewRegistry.mjs'

/**
 * 形态三分类（批次44 · 作者 2026-10-31）：
 * 「我希望你在**一开始**就想明白，每个类型的组件到底是用文档还是用 HTML 去实现。
 *   … 后续假如我们真的要把 ComfyUI 挪进来，那一定是要通过浏览器去把这个端口承载起来，
 *   而不可能说我们自己手搓一个组件」
 *
 * 这里的机器钉子：
 *   1) 三档形态（document／board／app）不重叠，每个内容面 kind 都得归到其中一档——
 *      漏网就等于「这块东西没想清楚用什么形态实现」；
 *   2) 视图类型反查回形态，与 kind 那张表不许互相矛盾；
 *   3) 应用面的清单口径：地址必填、只认 http/https、只认本机回环、view 与 kind 必须成对。
 */

/** 拿一个最小可用的 v3 清单当底，测试只改 panes。 */
function manifestWith(pane) {
  return {
    spec: CARRIER_SPEC_V3,
    manifestVersion: 3,
    id: 'demo.form',
    title: '形态演示',
    version: '1.0.0',
    minKernel: '1',
    tier: 'carrier',
    primary: { projectKind: 'generic', defaultPane: 'demo.panel', contextProfile: 'authoring-knowledge' },
    dataDirs: { notes: '构思' },
    contributes: {
      panes: [pane],
      renderers: []
    },
    entry: null,
    services: [],
    mcp: [],
    agentMd: 'AGENT.md',
    provides: ['notes.ideas'],
    requires: [],
    tools: [],
    context: { providers: [], budgetChars: 8000 },
    permissions: [{ type: 'file', dir: '构思', mode: 'rw' }, 'agent:ask'],
    subscriptions: []
  }
}

test('形态三分类：词表就是三档，不多不少', () => {
  assert.deepEqual([...PANE_FORMS], ['document', 'board', 'app'])
})

test('每个内容面 kind 都归到恰好一档形态（词表无漏网）', () => {
  for (const kind of PANE_KIND_WORDS) {
    const form = formOfKind(kind)
    assert.ok(form, `内容面「${kind}」没归形态：三种形态（文档／看板／应用）里它该归哪一档？`)
    assert.ok(PANE_FORMS.includes(form), `内容面「${kind}」归到了不存在的形态「${form}」`)
  }
  // 三个词表外的东西一律不认（formOfKind 返回 null，不猜）。
  assert.equal(formOfKind('say-nothing'), null)
  assert.equal(formOfKind(undefined), null)
})

test('三种形态各自的判定函数互斥：文档／看板／应用三档不重叠', () => {
  assert.equal(isDocumentKind('entry-detail'), true)
  assert.equal(isBoardKind('entry-detail'), false)
  assert.equal(isAppKind('entry-detail'), false)

  assert.equal(isBoardKind('entries-workspace'), true)
  assert.equal(isDocumentKind('entries-workspace'), false)
  assert.equal(isAppKind('entries-workspace'), false)

  assert.equal(isAppKind('external-app'), true)
  assert.equal(isDocumentKind('external-app'), false)
  assert.equal(isBoardKind('external-app'), false)
})

test('视图类型反查形态：宿主那八个视图每个都有归属，与 kind 那张表不打架', () => {
  for (const view of HOST_VIEW_TYPES) {
    const form = formOfView(view)
    assert.ok(PANE_FORMS.includes(form), `视图「${view}」反查不到形态`)
  }
  assert.equal(formOfView('pinax.view.reader'), PANE_FORM.DOCUMENT)
  assert.equal(formOfView('pinax.view.editor'), PANE_FORM.DOCUMENT)
  assert.equal(formOfView('pinax.view.board'), PANE_FORM.BOARD)
  assert.equal(formOfView('pinax.view.graph'), PANE_FORM.BOARD)
  assert.equal(formOfView('pinax.view.app'), PANE_FORM.APP)
  assert.equal(formOfView('pinax.view.custom'), PANE_FORM.APP, '自带面板也是「别人的页面，宿主只给一块地」')
  // 词表外的视图类型按最保守的一档来（文档面），不猜。
  assert.equal(formOfView('pinax.view.unknown'), PANE_FORM.DOCUMENT)
})

test('形态与视图的对照表自洽：每档形态列出的视图类型都能反查回自己', () => {
  for (const [form, types] of Object.entries(FORM_VIEW_TYPES)) {
    for (const view of types) {
      assert.equal(formOfView(view), form, `视图「${view}」在对照表里挂在「${form}」名下，反查却回不去`)
    }
  }
})

test('kind 表与视图表不许互相矛盾：同一个 kind 只归一档', () => {
  // KIND_FORMS 是权威表（kind 是协议 v3 的权威来源），这里核它没有把一个 kind 写两遍。
  const seen = new Map()
  for (const [kind, form] of Object.entries(KIND_FORMS)) {
    assert.ok(!seen.has(kind), `内容面「${kind}」在形态表里出现了两次`)
    seen.set(kind, form)
  }
  assert.equal(Object.keys(KIND_FORMS).length, PANE_KIND_WORDS.length, '形态表与内容面词表得一一对应')
})

test('应用面清单：回环地址过关，view 与 kind 成对', () => {
  const ok = validateCarrierManifest(manifestWith({
    slot: 'center',
    id: 'demo.app',
    title: 'ComfyUI',
    view: 'pinax.view.app',
    kind: 'external-app',
    app: { url: 'http://127.0.0.1:8188/' }
  }))
  assert.equal(ok.ok, true, JSON.stringify(ok.error ?? {}))
  assert.deepEqual(ok.value.panes[0].app, { url: 'http://127.0.0.1:8188/' })

  // view 与 kind 必须成对：写一半会让宿主不知道该挂 iframe 还是给宿主视图。
  const mismatched = validateCarrierManifest(manifestWith({
    slot: 'center',
    id: 'demo.app',
    title: 'ComfyUI',
    view: 'pinax.view.app',
    kind: 'records-editor',
    app: { url: 'http://127.0.0.1:8188/' }
  }))
  assert.equal(mismatched.ok, false)
  assert.equal(mismatched.error.code, 'PINAX_INVALID_MANIFEST')

  const halfDeclared = validateCarrierManifest(manifestWith({
    slot: 'center',
    id: 'demo.app',
    title: 'ComfyUI',
    view: 'pinax.view.reader',
    kind: 'external-app',
    app: { url: 'http://127.0.0.1:8188/' }
  }))
  assert.equal(halfDeclared.ok, false)
  assert.match(halfDeclared.error.message, /pinax\.view\.app/u)
})

test('应用面清单：地址必填、只认 http/https、只认本机回环、过长的地址拒', () => {
  const bad = [
    { pane: { slot: 'center', id: 'demo.app', title: 'x', view: 'pinax.view.app', kind: 'external-app' }, why: '没声明 app' },
    { pane: { slot: 'center', id: 'demo.app', title: 'x', view: 'pinax.view.app', kind: 'external-app', app: { url: '' } }, why: '地址是空串' },
    { pane: { slot: 'center', id: 'demo.app', title: 'x', view: 'pinax.view.app', kind: 'external-app', app: { url: 'not a url' } }, why: '不是合法地址' },
    { pane: { slot: 'center', id: 'demo.app', title: 'x', view: 'pinax.view.app', kind: 'external-app', app: { url: 'file:///etc/passwd' } }, why: '不是 http/https' },
    { pane: { slot: 'center', id: 'demo.app', title: 'x', view: 'pinax.view.app', kind: 'external-app', app: { url: 'https://example.com/' } }, why: '远端地址本批不接' },
    { pane: { slot: 'center', id: 'demo.app', title: 'x', view: 'pinax.view.app', kind: 'external-app', app: { url: `http://127.0.0.1:8188/${'x'.repeat(APP_PANE_URL_MAX)}` } }, why: '地址过长' }
  ]
  for (const { pane, why } of bad) {
    const result = validateCarrierManifest(manifestWith(pane))
    assert.equal(result.ok, false, `${why}：这份清单本该被拒，却过了`)
    assert.equal(result.error.code, 'PINAX_INVALID_MANIFEST', `${why}：拒的时候要给出 INVALID_MANIFEST`)
  }
})
