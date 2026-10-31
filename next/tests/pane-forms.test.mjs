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
  MINIMIZED_MODES
} from '../shell/workspace.mjs'

/**
 * 旧位置词表的兼容读单测（批次59）。
 * 界面不再有位置菜单：这五档只留给宿主描述导出（12 份清单的 manifest.panes[].forms），
 * 状态机（workspace.mjs v2）只认 geometry／z／minimized／maximized／tiledWith／tileSide。
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

test('窗态只剩两档：none／tab；气泡与侧缘标签旧词都不再是窗口状态', () => {
  assert.deepEqual([...MINIMIZED_MODES], ['none', 'tab'])
  assert.equal(DEFAULT_MINIMIZED, 'none')
  for (const mode of MINIMIZED_MODES) {
    assert.equal(PANE_FORMS.includes(mode), false, '窗态不混进旧位置词表')
  }
})

test('清单里的 forms 只留旧词表认得的形态：去重 + 按词表顺序', () => {
  assert.deepEqual(sanitizePaneForms(['split', 'window', 'dock', 'split']), ['dock', 'split'])
  assert.deepEqual(sanitizePaneForms(null), [])
  assert.deepEqual(sanitizePaneForms('split'), [])
  assert.deepEqual(sanitizePaneForms(['fullscreen', 'overlay']), ['overlay', 'fullscreen'])
})
