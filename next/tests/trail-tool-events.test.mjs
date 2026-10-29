import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TRAIL_EVENTS,
  sanitizeTrail,
  sanitizeTrailEvent,
  describeTrailEvent,
  describeRuntimeProgress,
  trailStageLabel
} from '../shell/agentSessions.mjs'

/**
 * 工具循环的轨迹事件（M2.5-A · 任务六）。
 *
 * 白名单扩了七段，但只扩「循环真会发、且字段确定」的那七段：
 *   step / tool-start / tool-end / tool-denied / tool-dropped / tool-unknown / proposal-created。
 * 这一组测试盯三件事：
 *   1) 每段只留确定字段，计数收整数、文本截断、未知键不进存储；
 *   2) 断点（failed.atStage）仍只认链上五段，工具事件不能冒充断点；
 *   3) 折叠层与 busy 期进度语认识新段——否则扩了白名单等于扩了沉默。
 */

test('工具事件：每段按确定字段清洗，多余键与错类型一律丢掉', () => {
  assert.deepEqual(
    sanitizeTrailEvent({ stage: 'step', step: '2', tools: ['pinax_outline_read', 42, ''], runId: 'r1' }),
    { stage: 'step', step: 2, tools: ['pinax_outline_read'] }
  )
  assert.deepEqual(
    sanitizeTrailEvent({ stage: 'tool-start', name: 'pinax_chapter_read', callId: 'c1', runId: 'r1' }),
    { stage: 'tool-start', name: 'pinax_chapter_read', callId: 'c1' }
  )
  assert.deepEqual(
    sanitizeTrailEvent({ stage: 'tool-end', name: 'pinax_chapter_read', callId: 'c1', ok: 'yes', ms: '12' }),
    { stage: 'tool-end', name: 'pinax_chapter_read', callId: 'c1', ok: false, ms: 12 },
    'ok 只认布尔真值（字符串 truthy 不算）'
  )
  assert.deepEqual(
    sanitizeTrailEvent({ stage: 'tool-denied', name: 'pinax_chapter_save', callId: 'c2', code: 'WRITE_BLOCKED' }),
    { stage: 'tool-denied', name: 'pinax_chapter_save', callId: 'c2', code: 'WRITE_BLOCKED' }
  )
  assert.deepEqual(
    sanitizeTrailEvent({ stage: 'proposal-created', name: 'pinax_chapter_save', callId: 'c3', proposalId: '20261029-120000-abcd-save.json' }),
    { stage: 'proposal-created', name: 'pinax_chapter_save', callId: 'c3', proposalId: '20261029-120000-abcd-save.json' }
  )
  assert.deepEqual(
    sanitizeTrailEvent({
      stage: 'tool-dropped',
      dropped: [{ name: 'pinax_chapter_save', reason: 'limit' }, { name: '' }, 'garbage', { reason: 'x' }]
    }),
    { stage: 'tool-dropped', dropped: [{ name: 'pinax_chapter_save', reason: 'limit' }] },
    'dropped 只留 {name,reason}，无名项与自由形状不进存储'
  )
  assert.deepEqual(
    sanitizeTrailEvent({ stage: 'tool-unknown', name: 'rm_rf', callId: 'c4' }),
    { stage: 'tool-unknown', name: 'rm_rf', callId: 'c4' }
  )
})

test('断点仍只认链上五段：工具事件不能当 failed.atStage', () => {
  for (const stage of ['step', 'tool-start', 'tool-end', 'tool-denied', 'proposal-created', 'failed']) {
    assert.equal(
      sanitizeTrailEvent({ stage: 'failed', code: 'X', atStage: stage }).atStage,
      'start',
      `${stage} 不是断点`
    )
  }
  assert.equal(sanitizeTrailEvent({ stage: 'failed', atStage: 'model-round' }).atStage, 'model-round')
})

test('轨迹封顶不变：工具事件也走 32 条上限，丢最旧', () => {
  const events = Array.from({ length: MAX_TRAIL_EVENTS + 5 }, (_item, index) => ({ stage: 'tool-start', name: `t${index}` }))
  const capped = sanitizeTrail(events)
  assert.equal(capped.length, MAX_TRAIL_EVENTS)
  assert.equal(capped[0].name, 't5')
  assert.equal(capped.at(-1).name, `t${MAX_TRAIL_EVENTS + 4}`)
})

test('折叠层与进度语认识新段：扩白名单不是扩沉默', () => {
  assert.equal(trailStageLabel('tool-denied'), '写入被拒')
  assert.deepEqual(
    describeTrailEvent({ stage: 'tool-end', name: 'pinax_chapter_read', callId: 'c1', ok: true, ms: 9 }),
    { stage: 'tool-end', label: '工具返回', detail: 'pinax_chapter_read · 9ms' }
  )
  assert.deepEqual(
    describeTrailEvent({ stage: 'tool-dropped', dropped: [{ name: 'a', reason: 'limit' }, { name: 'b', reason: 'limit' }] }),
    { stage: 'tool-dropped', label: '工具未披露', detail: 'a、b' }
  )
  assert.equal(describeTrailEvent({ stage: 'tool-unknown', name: 'rm_rf', callId: 'c4' }).detail, 'rm_rf（未执行）')
  assert.equal(describeRuntimeProgress({ stage: 'tool-start', name: 'pinax_outline_read' }), '正在调用 pinax_outline_read')
  assert.equal(describeRuntimeProgress({ stage: 'proposal-created' }), '已生成提案，等你采纳')
  assert.equal(describeTrailEvent({ stage: 'subagent' }), null, '链上不存在的段仍然不认')
})
