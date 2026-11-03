import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PANE_FORM,
  FORM_ACTIONS,
  MENU_TARGET_FORM,
  PAGE_ACTIONS,
  PANE_FORMS,
  PANE_FORM_LABELS,
  PANE_FORM_STORAGE_PREFIX,
  formMenuItems,
  isPaneForm,
  paneFormStorageKey,
  sanitizePaneForms
} from '../shell/paneForms.mjs'
import { PAGE_FORMS, isPageForm } from '../shell/workspace.mjs'

/**
 * 载体形态词表单测（批次66 · 前置裁定 Q2 收敛后的口径）。
 * 批次61 时词表还留着两个「在 v3 状态轴没有独立落点」的旧词，菜单靠交集把它们闸掉；
 * 本批直接从词表删除——于是这份测试测的是两件事：
 *   一、词表只有三档，且每一档都有落点（「词表与状态机落点同构」这条断言在最后一个用例里）；
 *   二、旧词不再被认得：清单若还写着它，渲染层过滤掉、内核层拒装（见 manifest-v2/v3 用例）。
 */

test('词表三档：dock／split／overlay（批次66 删掉两个无落点的旧词）', () => {
  assert.deepEqual(PANE_FORMS, ['dock', 'split', 'overlay'])
  assert.equal(DEFAULT_PANE_FORM, 'dock')
  assert.deepEqual(Object.keys(PANE_FORM_LABELS), [...PANE_FORMS])
  assert.equal(PANE_FORM_STORAGE_PREFIX, 'paneForm.')
  assert.equal(paneFormStorageKey('novel.editor'), 'paneForm.novel.editor')

  for (const form of PANE_FORMS) assert.equal(isPaneForm(form), true)
  // 旧词从「认得」变「不认得」：它们现在是词表外的陌生值。
  for (const bad of ['fullscreen', 'immersive', 'window', '', null, undefined, 'DOCK', 'split-left', 'bubble']) {
    assert.equal(isPaneForm(bad), false, `词表外形态不应通过：${String(bad)}`)
  }
})

test('清单里的 forms 只留词表认得的形态：去重 + 按词表顺序 + 旧词滤掉', () => {
  assert.deepEqual(sanitizePaneForms(['split', 'window', 'dock', 'split']), ['dock', 'split'])
  assert.deepEqual(sanitizePaneForms(null), [])
  assert.deepEqual(sanitizePaneForms('split'), [])
  assert.deepEqual(sanitizePaneForms(['fullscreen', 'overlay']), ['overlay'])
  assert.deepEqual(sanitizePaneForms(['immersive']), [])
})

test('右键菜单项＝声明的形态 ∩ 落点表：每项都有动作与文案', () => {
  const items = formMenuItems(['dock', 'split', 'overlay'])
  assert.deepEqual(items.map((item) => item.form), ['dock', 'split', 'overlay'])
  assert.deepEqual(items.map((item) => item.action), ['dock', 'side', 'float'])
  for (const item of items) {
    assert.ok(item.label, `菜单项缺文案：${item.form}`)
    assert.equal(FORM_ACTIONS[item.form].label, item.label, '菜单文案只从 FORM_ACTIONS 取一份')
  }
})

test('旧词不进菜单：词表外值连交集都进不去（菜单里也不会有第二份文案）', () => {
  for (const forms of [['fullscreen'], ['immersive'], ['dock', 'fullscreen', 'immersive']]) {
    const actions = formMenuItems(forms).map((item) => item.action)
    assert.equal(actions.some((action) => action === 'fullscreen' || action === 'immersive'), false)
  }
  assert.deepEqual(formMenuItems(['fullscreen', 'immersive']), [])
  assert.deepEqual(formMenuItems(undefined), [])
})

test('页操作那一组与形态词表无关，恒在：收成侧缘标签／关闭', () => {
  assert.deepEqual(PAGE_ACTIONS.map((item) => item.action), ['tab', 'close'])
  for (const item of PAGE_ACTIONS) {
    assert.equal(PANE_FORMS.includes(item.action), false, '页操作不混进位置词表')
    assert.ok(item.label)
  }
})

test('词表与状态机落点同构（批次66 断言）：三档词 ↔ 三组动作 ↔ v3 形态，一一对得上', () => {
  // 同构的定义：词表里每个词都在落点表里有动作，落点表里不多出词表外的键，
  // 每个动作的落点都是 v3 状态轴认得的形态。「声明了形态却没有落点」在这三张表之间不存在。
  assert.deepEqual(Object.keys(FORM_ACTIONS), [...PANE_FORMS], '落点表的键必须与词表同集合同顺序')
  for (const form of PANE_FORMS) {
    assert.ok(FORM_ACTIONS[form].action, `词表形态 ${form} 没有对应动作`)
    assert.equal(isPageForm(MENU_TARGET_FORM[FORM_ACTIONS[form].action]), true, `${form} 的落点不在 v3 形态词表里`)
  }
  // 菜单发的动作名全集：三档形态 + 收成标签 + 关闭。
  const actions = [...Object.values(FORM_ACTIONS).map((item) => item.action), ...PAGE_ACTIONS.map((item) => item.action)]
  assert.deepEqual(actions, ['dock', 'side', 'float', 'tab', 'close'])
  for (const action of actions.filter((item) => item !== 'close')) {
    assert.equal(isPageForm(MENU_TARGET_FORM[action]), true, `菜单动作 ${action} 的落点不在 v3 形态词表里`)
  }
  assert.equal(MENU_TARGET_FORM.close, undefined, '关闭是删记录，不是第四种形态')
  assert.deepEqual([...PAGE_FORMS], ['page', 'floating', 'tab'])
})
