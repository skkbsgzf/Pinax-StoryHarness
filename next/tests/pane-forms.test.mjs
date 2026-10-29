import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PANE_FORM,
  PANE_FORMS,
  PANE_FORM_LABELS,
  PANE_FORM_STORAGE_PREFIX,
  isPaneForm,
  paneFormStorageKey,
  sanitizePaneForms
} from '../shell/paneForms.mjs'
import {
  DEFAULT_MINIMIZED,
  DEFAULT_PLACEMENT,
  MINIMIZED_MODES,
  PLACEMENTS
} from '../shell/workspace.mjs'

/**
 * 宿主形态词表单测（协议 v1.2 P18–P21 → M2.5-C 拆轴）。
 * M2.5-C 起 paneForms.mjs 只剩「词」：状态机与持久化搬去 workspace.mjs（四轴），
 * 这里核的是两句合同——词表与打开的落点一致、词表外形态不出现。
 */

test('P18 形态词表：四档固定，与 workspace 的 PLACEMENTS 逐项相等', () => {
  assert.deepEqual(PANE_FORMS, ['dock', 'split', 'overlay', 'fullscreen'])
  assert.deepEqual([...PLACEMENTS], [...PANE_FORMS], '词表与状态机的打开位置必须同一份（改一边就是两套真相）')
  assert.equal(DEFAULT_PANE_FORM, DEFAULT_PLACEMENT)
  assert.equal(DEFAULT_PANE_FORM, 'dock')
  assert.equal(DEFAULT_MINIMIZED, 'none')
  assert.deepEqual(Object.keys(PANE_FORM_LABELS), [...PANE_FORMS])
  assert.equal(PANE_FORM_STORAGE_PREFIX, 'paneForm.')
  assert.equal(paneFormStorageKey('novel.editor'), 'paneForm.novel.editor')

  for (const form of PANE_FORMS) assert.equal(isPaneForm(form), true)
  for (const bad of ['window', '', null, undefined, 'DOCK', 'split-left', 'bubble']) {
    assert.equal(isPaneForm(bad), false, `词表外形态不应通过：${String(bad)}`)
  }
})

test('P18：气泡不是第五种形态（最小化是独立的轴）', () => {
  for (const mode of MINIMIZED_MODES) {
    assert.equal(PANE_FORMS.includes(mode), false, `最小化状态 ${mode} 不该混进打开位置词表`)
  }
  assert.deepEqual([...MINIMIZED_MODES], ['none', 'bubble', 'collapsed'])
})

test('清单里的 forms 只留宿主认得的形态：去重 + 按词表顺序', () => {
  assert.deepEqual(sanitizePaneForms(['split', 'window', 'dock', 'split']), ['dock', 'split'])
  assert.deepEqual(sanitizePaneForms(null), [])
  assert.deepEqual(sanitizePaneForms('split'), [])
  // 载体声明顺序不影响菜单顺序：菜单按宿主词表走（P18）。
  assert.deepEqual(sanitizePaneForms(['fullscreen', 'overlay']), ['overlay', 'fullscreen'])
})
