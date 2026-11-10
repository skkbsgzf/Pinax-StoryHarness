import test from 'node:test'
import assert from 'node:assert/strict'
import { OPEN_ACTIONS, pageIdOf, resolveOpenTarget } from '../shell/openTarget.mjs'

/**
 * 开窗落点的唯一决策口径单测（批次61 任务三）。
 * 这里测的是「点一下之后去哪」这一件事的七条路径共用的那一个答案：
 * 竖条、左树、看板卡、蓝链、检索命中、图谱节点、命令——v2 时代各抄了一套「没窗就弹一扇浮窗」，
 * 从批次61 起只问这里一次。断言即规格：改期望值之前先改作者裁定。
 */

function page(instance, { pane, form = 'page', group = 'main', resource = null, order = 0 } = {}) {
  return { instance, pane, form, group, resource, order, geometry: null, z: 0, maximized: false }
}

test('页身份只有一处算法：同 pane 同文档＝回到那一页，绝不新建', () => {
  const pages = [
    page('novel.editor#1', { pane: 'novel.editor', resource: '章节/第一章.md' }),
    page('novel.editor#2', { pane: 'novel.editor', resource: '章节/第二章.md', order: 1 })
  ]
  assert.equal(pageIdOf('novel.editor', '章节/第二章.md', { pages, multiplicity: 'keyed' }), 'novel.editor#2')
  assert.equal(pageIdOf('novel.editor', ' 章节/第一章.md ', { pages, multiplicity: 'keyed' }), 'novel.editor#1', '入库前收空白，身份比对不能用脏值')
  assert.equal(pageIdOf('novel.editor', null, { pages, multiplicity: 'keyed' }), 'novel.editor#3', '没装文档的那一页还没开过，就分配下一个空位')
  assert.equal(pageIdOf('outline.tree', null, { pages, multiplicity: 'keyed' }), 'outline.tree#1', '别的 pane 的序号不串号')
  assert.equal(pageIdOf('正文#1', null, { pages }), '', '非法 pane id 回空串，让调用方自己拒绝')
})

test('〔裁定④〕single／list 的声明真生效：这块 pane 永远只有一条记录，换文档＝换内容', () => {
  const pages = [page('novel.editor#1', { pane: 'novel.editor', resource: '章节/第一章.md' })]
  for (const multiplicity of ['single', 'list', undefined, 'nonsense']) {
    assert.equal(pageIdOf('novel.editor', '章节/第二章.md', { pages, multiplicity }), 'novel.editor#1',
      `multiplicity=${String(multiplicity)} 不许分配第二页`)
  }
  assert.equal(pageIdOf('novel.editor', '章节/第二章.md', { pages: [], multiplicity: 'single' }), 'novel.editor#1', '一条都没有时才用 #1')
})

test('已开着的那一页：reveal 回它自己，收起的侧缘标签走 raise-tab', () => {
  const pages = [
    page('novel.editor#1', { pane: 'novel.editor', resource: '章节/第一章.md' }),
    page('notes.editor#1', { pane: 'notes.editor', group: 'side', form: 'tab' }),
    page('outline.widget#1', { pane: 'outline.widget', form: 'floating' })
  ]
  const revealed = resolveOpenTarget({ pane: 'novel.editor', resource: '章节/第一章.md', pages, groups: { focus: 'main' } })
  assert.equal(revealed.action, 'reveal')
  assert.equal(revealed.instance, 'novel.editor#1')
  assert.equal(revealed.group, 'main')

  const raised = resolveOpenTarget({ pane: 'notes.editor', pages, groups: { focus: 'main' } })
  assert.equal(raised.action, 'raise-tab')
  assert.equal(raised.instance, 'notes.editor#1')
  assert.equal(raised.group, 'side', '展开回它自己的那一侧，不抢焦点组')

  const floating = resolveOpenTarget({ pane: 'outline.widget', pages, groups: { focus: 'main' } })
  assert.equal(floating.action, 'reveal')
  assert.equal(floating.form, 'floating', '已经浮着的一页被再点一次，还是那一扇窗，不重复开窗也不悄悄改成页')
})

test('〔铁律一〕single 载体的第二份文档＝replace-page：换这一页装哪份稿子，并如实报被换掉的那份', () => {
  const pages = [page('novel.editor#1', { pane: 'novel.editor', resource: '章节/第一章.md' })]
  const decision = resolveOpenTarget({
    pane: 'novel.editor',
    multiplicity: 'single',
    resource: '章节/第二章.md',
    pages,
    groups: { focus: 'main' }
  })
  assert.equal(decision.action, 'replace-page')
  assert.equal(decision.instance, 'novel.editor#1')
  assert.equal(decision.resource, '章节/第二章.md')
  assert.equal(decision.replaced, '章节/第一章.md', '换掉的文档要能被调用方记账（脏草稿提示／历史回落都靠它）')
})

test('keyed 载体的第二份文档＝新开一页，进焦点组', () => {
  const pages = [page('worldbook.entries#1', { pane: 'worldbook.entries', resource: '设定集.md#沈砚' })]
  const decision = resolveOpenTarget({
    pane: 'worldbook.entries',
    multiplicity: 'keyed',
    resource: '设定集.md#阿辽',
    pages,
    groups: { focus: 'side' }
  })
  assert.equal(decision.action, 'open-page')
  assert.equal(decision.instance, 'worldbook.entries#2')
  assert.equal(decision.group, 'side', '焦点组是 side 就开在 side，不再挤到主组')
  assert.equal(decision.resource, '设定集.md#阿辽')
})

test('一块都没开过的 pane：开一页进焦点组；focus 是脏值时按主组办事', () => {
  const intoSide = resolveOpenTarget({ pane: 'outline.tree', pages: [], groups: { focus: 'side' } })
  assert.equal(intoSide.action, 'open-page')
  assert.equal(intoSide.instance, 'outline.tree#1')
  assert.equal(intoSide.group, 'side')

  assert.equal(resolveOpenTarget({ pane: 'outline.tree', pages: [], groups: { focus: 'middle' } }).group, 'main')
  assert.equal(resolveOpenTarget({ pane: 'outline.tree', pages: [], groups: {} }).group, 'main')
  assert.equal(resolveOpenTarget({ pane: 'outline.tree', pages: [] }).group, 'main')
})

test('非法 pane 一律 block，不把空实例交给状态机', () => {
  for (const pane of ['', '   ', '正文', null, undefined]) {
    const decision = resolveOpenTarget({ pane, pages: [], groups: { focus: 'main' } })
    assert.equal(decision.action, 'block')
    assert.equal(decision.reason, 'INVALID_PANE')
    assert.equal(decision.instance, '')
  }
})

test('〔裁定①〕七条路径的缺省答案里没有「新建浮窗」', () => {
  assert.deepEqual([...OPEN_ACTIONS], ['reveal', 'replace-page', 'open-page', 'raise-tab', 'block', 'close-page'])
  const cases = [
    { pane: 'novel.editor', pages: [] },
    { pane: 'novel.editor', pages: [page('novel.editor#1', { pane: 'novel.editor' })], resource: '章节/第二章.md' },
    { pane: 'novel.editor', multiplicity: 'keyed', pages: [page('novel.editor#1', { pane: 'novel.editor' })], resource: '章节/第二章.md' },
    { pane: 'notes.editor', pages: [page('notes.editor#1', { pane: 'notes.editor', form: 'tab' })] }
  ]
  for (const input of cases) {
    const decision = resolveOpenTarget({ multiplicity: 'single', groups: { focus: 'main' }, ...input })
    assert.equal(OPEN_ACTIONS.includes(decision.action), true, `落点动作不在词汇里：${decision.action}`)
    assert.equal(decision.action === 'open-page' && decision.form === 'floating', false, '新开的一页必须是页态')
  }
})

/* —— 批次62 任务五：gesture 从「预留形参」变成「真吃值」————————————————————
 * 两条入口（界面侧的传值断言在 next/tests/command-face.test.mjs 与 carrier-pane.spec）：
 *   Alt＋点击 → gesture:{ form:'floating' } ；中键点击页签 → gesture:{ action:'close', instance }。
 * 这里钉的是口径本身：手势不改「去哪一页」的判定，只改那一页此刻以什么形态出现。
 */

test('〔批次62〕Alt＋点击：落点判定一条不改，只在答案上多带 form——绝不新建第二页', () => {
  const pages = [page('novel.editor#1', { pane: 'novel.editor', resource: '章节/第一章.md' })]
  const altReveal = resolveOpenTarget({
    pane: 'novel.editor',
    resource: '章节/第一章.md',
    pages,
    groups: { focus: 'main' },
    gesture: { form: 'floating' }
  })
  assert.equal(altReveal.action, 'reveal', '已开着的那一页还是回到那一页')
  assert.equal(altReveal.instance, 'novel.editor#1')
  assert.equal(altReveal.form, 'floating', 'Alt 的语义＝以另一形态执行同一动作')

  const altOpen = resolveOpenTarget({ pane: 'outline.tree', pages: [], groups: { focus: 'side' }, gesture: { form: 'floating' } })
  assert.equal(altOpen.action, 'open-page')
  assert.equal(altOpen.instance, 'outline.tree#1', '没开过时分配的仍是 #1，不因为手势多占一个序号')
  assert.equal(altOpen.form, 'floating')

  const altSingle = resolveOpenTarget({
    pane: 'novel.editor',
    multiplicity: 'single',
    resource: '章节/第二章.md',
    pages,
    groups: { focus: 'main' },
    gesture: { form: 'floating' }
  })
  assert.equal(altSingle.action, 'replace-page', 'single 硬闸不因为手势松掉')
  assert.equal(altSingle.replaced, '章节/第一章.md')
  assert.equal(altSingle.form, 'floating')
})

test('〔批次62〕中键点击页签＝关被点的那一页；那一页不在列表里就 block，不猜第二页', () => {
  const pages = [
    page('novel.editor#1', { pane: 'novel.editor', resource: '章节/第一章.md' }),
    page('novel.editor#2', { pane: 'novel.editor', resource: '章节/第二章.md', order: 1 })
  ]
  const closed = resolveOpenTarget({
    pane: 'novel.editor',
    multiplicity: 'keyed',
    pages,
    groups: { focus: 'main' },
    gesture: { action: 'close', instance: 'novel.editor#2' }
  })
  assert.equal(closed.action, 'close-page')
  assert.equal(closed.instance, 'novel.editor#2', '关的必须是被点的那一条签，不是焦点页')
  assert.equal(closed.resource, '章节/第二章.md')

  const ghost = resolveOpenTarget({
    pane: 'novel.editor',
    pages,
    groups: { focus: 'main' },
    gesture: { action: 'close', instance: 'novel.editor#7' }
  })
  assert.equal(ghost.action, 'block')
  assert.equal(ghost.reason, 'GESTURE_NO_TARGET')

  const wrongPane = resolveOpenTarget({
    pane: 'notes.editor',
    pages: [page('notes.editor#1', { pane: 'notes.editor' })],
    gesture: { action: 'close', instance: 'novel.editor#1' }
  })
  assert.equal(wrongPane.action, 'block', '签与 pane 对不上就是脏值，不顺手关别的板')
  assert.equal(wrongPane.reason, 'GESTURE_NO_TARGET')
})

test('〔批次62〕认不出的手势如实拒绝，不悄悄忽略；instance 单独传不构成一个手势', () => {
  const meta = resolveOpenTarget({ pane: 'novel.editor', pages: [], groups: { focus: 'main' }, gesture: { meta: true } })
  assert.equal(meta.action, 'block')
  assert.equal(meta.reason, 'GESTURE_UNSUPPORTED')
  assert.equal(
    resolveOpenTarget({ pane: 'novel.editor', pages: [], gesture: { form: 'docked' } }).reason,
    'GESTURE_FORM_UNSUPPORTED',
    '形态词汇表外的手势要指名道姓地拒'
  )
  assert.equal(
    resolveOpenTarget({ pane: 'novel.editor', pages: [], gesture: { instance: 'novel.editor#1' } }).action,
    'block',
    '只带 instance（「关哪一页」的搭档）没有动作，仍是没接住的手势'
  )
  assert.equal(resolveOpenTarget({ pane: 'novel.editor', pages: [], gesture: {} }).action, 'open-page', '空手势＝没有手势')
})
