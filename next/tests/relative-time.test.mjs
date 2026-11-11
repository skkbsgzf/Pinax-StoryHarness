import test from 'node:test'
import assert from 'node:assert/strict'
import { relativeTime } from '../shell/library/relativeTime.mjs'

/** 库管理器工单 A-3：相对时间分档（今天/昨天/N 天前/上周/具体日期），无效输入空串。 */
const NOW = new Date('2026-11-11T12:00:00')

test('相对时间：同日/昨天/2–6 天/上周/≥14 天各档', () => {
  assert.equal(relativeTime('2026-11-11T08:00:00', NOW), '今天')
  assert.equal(relativeTime('2026-11-10T23:59:00', NOW), '昨天')
  assert.equal(relativeTime('2026-11-08T12:00:00', NOW), '3 天前')
  assert.equal(relativeTime('2026-11-05T12:00:00', NOW), '6 天前')
  assert.equal(relativeTime('2026-11-04T12:00:00', NOW), '上周', '7 天前归「上周」档')
  assert.equal(relativeTime('2026-10-29T12:00:00', NOW), '上周', '13 天内仍归「上周」档')
  assert.equal(relativeTime('2026-10-28T12:00:00', NOW), '10月28日', '14 天起给具体日期（同年）')
  assert.equal(relativeTime('2025-03-02T12:00:00', NOW), '2025年3月2日', '跨年带年份')
})

test('相对时间：未来时间不编档（给具体日期）；无效输入空串', () => {
  assert.equal(relativeTime('2026-11-12T12:00:00', NOW), '11月12日', '未来日期不冒充「今天」')
  assert.equal(relativeTime('', NOW), '')
  assert.equal(relativeTime(null, NOW), '')
  assert.equal(relativeTime('不是时间', NOW), '')
})
