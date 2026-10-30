import test from 'node:test'
import assert from 'node:assert/strict'
import { PROJECT_EVENT_TARGETS, refreshTargetsFor } from '../shell/projectEventRefresh.mjs'

/**
 * 批次39：项目事件 → 板块树的映射。
 * 口径：只认五类事件；entries-changed 一次变更可能落在五棵「条目型」树上；
 * proposals／sessions 分别由提案审阅节与（暂无）界面消费者管，这里不接。
 */

test('映射是闭集：五类事件各就各位，未知 kind 不刷任何树', () => {
  assert.deepEqual(Object.keys(PROJECT_EVENT_TARGETS).sort(),
    ['entries-changed', 'manuscript-changed', 'outline-changed', 'proposals-changed', 'sessions-changed'])
  assert.deepEqual(refreshTargetsFor('manuscript-changed'), ['chapters'])
  assert.deepEqual(refreshTargetsFor('outline-changed'), ['outline'])
  assert.deepEqual(refreshTargetsFor('entries-changed'), ['entries', 'notes', 'rules', 'documents', 'scripts', 'records:material', 'records:comic', 'records:video', 'records:experience', 'records:online'])
  assert.deepEqual(refreshTargetsFor('proposals-changed'), [])
  assert.deepEqual(refreshTargetsFor('sessions-changed'), [])
  assert.deepEqual(refreshTargetsFor('unknown'), [])
  assert.deepEqual(refreshTargetsFor(undefined), [])
})

test('只刷已经载入过的树：loadedTrees 里的 false／缺项都不算', () => {
  const loaded = { entries: true, notes: false, rules: true, documents: true, scripts: true, chapters: true, outline: false, 'records:material': true, 'records:comic': false }
  assert.deepEqual(refreshTargetsFor('entries-changed', loaded), ['entries', 'rules', 'documents', 'scripts', 'records:material'])
  assert.deepEqual(refreshTargetsFor('manuscript-changed', loaded), ['chapters'])
  assert.deepEqual(refreshTargetsFor('outline-changed', loaded), [])
  assert.deepEqual(refreshTargetsFor('entries-changed', {}), [])
})

test('返回的是副本：调用方改结果不会污染常量表', () => {
  const targets = refreshTargetsFor('entries-changed')
  targets.push('hacked')
  assert.deepEqual(refreshTargetsFor('entries-changed'), ['entries', 'notes', 'rules', 'documents', 'scripts', 'records:material', 'records:comic', 'records:video', 'records:experience', 'records:online'])
  assert.ok(Object.isFrozen(PROJECT_EVENT_TARGETS['entries-changed']))
})
