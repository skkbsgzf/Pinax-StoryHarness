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
 * 载体形态词表单测（批次61 改口径）。
 * 批次59 时这份词表「只作兼容读」；作者裁定③「形态切换多用右键，不必做成死按钮」之后，
 * 它是页签右键／窗头右键那一份形态菜单的单一来源——所以测的是「菜单列得出项、且每项落得下去」。
 */

test('旧词表仍可导出：五档顺序不变（供 host descriptor 与清单核对用）', () => {
  assert.deepEqual(PANE_FORMS, ['dock', 'split', 'overlay', 'fullscreen', 'immersive'])
  assert.equal(DEFAULT_PANE_FORM, 'dock')
  assert.deepEqual(Object.keys(PANE_FORM_LABELS), [...PANE_FORMS])
  assert.equal(PANE_FORM_STORAGE_PREFIX, 'paneForm.')
  assert.equal(paneFormStorageKey('novel.editor'), 'paneForm.novel.editor')

  for (const form of PANE_FORMS) assert.equal(isPaneForm(form), true)
  for (const bad of ['window', '', null, undefined, 'DOCK', 'split-left', 'bubble']) {
    assert.equal(isPaneForm(bad), false, `词表外形态不应通过：${String(bad)}`)
  }
})

test('清单里的 forms 只留旧词表认得的形态：去重 + 按词表顺序', () => {
  assert.deepEqual(sanitizePaneForms(['split', 'window', 'dock', 'split']), ['dock', 'split'])
  assert.deepEqual(sanitizePaneForms(null), [])
  assert.deepEqual(sanitizePaneForms('split'), [])
  assert.deepEqual(sanitizePaneForms(['fullscreen', 'overlay']), ['overlay', 'fullscreen'])
})

test('右键菜单项＝声明的形态 ∩ v3 装得下的落点：每项都有动作与文案', () => {
  const items = formMenuItems(['dock', 'split', 'overlay', 'fullscreen', 'immersive'])
  assert.deepEqual(items.map((item) => item.form), ['dock', 'split', 'overlay'])
  assert.deepEqual(items.map((item) => item.action), ['dock', 'side', 'float'])
  for (const item of items) {
    assert.ok(item.label, `菜单项缺文案：${item.form}`)
    assert.equal(FORM_ACTIONS[item.form].label, item.label, '菜单文案只从 FORM_ACTIONS 取一份')
  }
})

test('fullscreen／immersive 不进菜单：v3 没有独立落点，进了就是骗人入口', () => {
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
    assert.equal(PANE_FORMS.includes(item.action), false, '页操作不混进旧位置词表')
    assert.ok(item.label)
  }
})

test('菜单落点都必须是 v3 状态轴认得的形态：不让菜单发出状态机拒绝的动作', () => {
  // 右键菜单发的是 dock／side／float／tab／close 这套动作名，宿主按 MENU_TARGET_FORM 映射到 v3 形态；
  // 这张表只有一份（paneForms.mjs），菜单与 AppNext 共用，改了任一边都会红。
  const actions = [...Object.values(FORM_ACTIONS).map((item) => item.action), ...PAGE_ACTIONS.map((item) => item.action)]
  assert.deepEqual(actions, ['dock', 'side', 'float', 'tab', 'close'])
  for (const action of actions.filter((item) => item !== 'close')) {
    assert.equal(isPageForm(MENU_TARGET_FORM[action]), true, `菜单动作 ${action} 的落点不在 v3 形态词表里`)
  }
  assert.equal(MENU_TARGET_FORM.close, undefined, '关闭是删记录，不是第四种形态')
  assert.deepEqual([...PAGE_FORMS], ['page', 'floating', 'tab'])
})
