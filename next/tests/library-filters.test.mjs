import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIBRARY_FILTERS,
  buildLibraryFilterTabs,
  filterLibraryEntries,
  formatLibraryCardMeta,
  libraryFilterId,
  libraryKindLabel
} from '../shell/library/libraryFilters.mjs'

/**
 * 库管理器筛选与卡片读数（工单 P1／P6）的纯函数用例。
 * 口径：kind 映射 novel/script/comic/worldbook/reference|dossier；其余/缺失＝未分类；
 * 〔P6 · 作者 2026-11-13 按 demo 裁定〕7 个类别 tab 恒渲染（含零计数），
 * P1 的「零计数不渲染」沉默层口径被推翻；卡片第三行没有 count 就只显示时间。
 */

const NOW = new Date('2026-11-11T12:00:00')
const ENTRIES = [
  { path: 'D:/books/大梦', kind: 'novel', at: '2026-11-11T08:00:00', count: 12 },
  { path: 'D:/books/长夜', kind: 'novel', at: '2026-11-10T08:00:00', count: 0 },
  { path: 'D:/stage/夜航', kind: 'script', at: '2026-11-04T08:00:00' },
  { path: 'D:/comic/山海', kind: 'comic', at: null },
  { path: 'D:/world/北境', kind: 'worldbook', at: null },
  { path: 'D:/ref/资料夹', kind: 'dossier', at: null },
  { path: 'D:/ref/旧资料', kind: 'reference', at: null },
  { path: 'D:/misc/碎片', kind: null, at: null }
]

test('kind 映射：novel/script/comic/worldbook/reference|dossier＋未分类兜底', () => {
  assert.equal(libraryFilterId('novel'), 'novel')
  assert.equal(libraryFilterId('script'), 'script')
  assert.equal(libraryFilterId('comic'), 'comic')
  assert.equal(libraryFilterId('worldbook'), 'worldbook')
  assert.equal(libraryFilterId('reference'), 'reference')
  assert.equal(libraryFilterId('dossier'), 'reference')
  assert.equal(libraryFilterId(' N O V E L '), 'uncategorized', '未知 kind 不猜')
  assert.equal(libraryFilterId(null), 'uncategorized')
  assert.equal(libraryFilterId(undefined), 'uncategorized')
  assert.equal(libraryFilterId(42), 'uncategorized')
  // 胶囊文案与筛选条共用同一张表；未分类不出胶囊。
  assert.equal(libraryKindLabel('comic'), '漫剧')
  assert.equal(libraryKindLabel('dossier'), '资料')
  assert.equal(libraryKindLabel(null), '')
})

// 〔P6 · 作者 2026-11-13 按 demo 裁定〕翻案 P1 的「零计数不渲染」：7 个类别 tab 恒在。
test('筛选 tab：全部＋6 个类别恒渲染（零计数照显），顺序固定', () => {
  const allIds = ['all', 'novel', 'script', 'comic', 'worldbook', 'reference', 'uncategorized']
  const tabs = buildLibraryFilterTabs(ENTRIES)
  assert.deepEqual(tabs.map((tab) => tab.id), allIds)
  assert.deepEqual(tabs.map((tab) => tab.count), [8, 2, 1, 1, 1, 2, 1])
  assert.equal(tabs[0].label, '全部')
  // 空清单也摆全 7 个 tab，计数全 0（不随数据消失）。
  const empty = buildLibraryFilterTabs([])
  assert.deepEqual(empty.map((tab) => tab.id), allIds)
  assert.deepEqual(empty.map((tab) => tab.count), [0, 0, 0, 0, 0, 0, 0])
  const onlyNovel = buildLibraryFilterTabs([{ kind: 'novel' }])
  assert.deepEqual(onlyNovel.map((tab) => tab.id), allIds, '只有一类有内容时，其余 5 个空类仍在')
  assert.deepEqual(onlyNovel.map((tab) => tab.count), [1, 1, 0, 0, 0, 0, 0])
  // 声明的类别全集保持工单字面顺序。
  assert.deepEqual(LIBRARY_FILTERS.map((item) => item.label), ['小说', '剧本', '漫剧', '世界书', '资料', '未分类'])
})

test('按类筛选：只留该类，「全部」返回浅拷贝且不改传入数组', () => {
  assert.deepEqual(filterLibraryEntries(ENTRIES, 'script').map((entry) => entry.path), ['D:/stage/夜航'])
  assert.deepEqual(filterLibraryEntries(ENTRIES, 'reference').map((entry) => entry.path), ['D:/ref/资料夹', 'D:/ref/旧资料'])
  assert.deepEqual(filterLibraryEntries(ENTRIES, 'uncategorized').map((entry) => entry.path), ['D:/misc/碎片'])
  assert.equal(filterLibraryEntries(ENTRIES, 'all').length, ENTRIES.length)
  const all = filterLibraryEntries(ENTRIES, 'all')
  assert.notEqual(all, ENTRIES, '返回拷贝，组件层不会意外改 props')
  assert.equal(filterLibraryEntries(ENTRIES, 'comic').length, 1)
  assert.deepEqual(filterLibraryEntries(null, 'novel'), [])
})

test('卡片第三行：有 count 显示「N 篇 · 时间编辑」，旧记录/坏值只显示时间', () => {
  assert.equal(formatLibraryCardMeta({ at: '2026-11-10T08:00:00', count: 12 }, NOW), '12 篇 · 昨天编辑')
  assert.equal(formatLibraryCardMeta({ at: '2026-11-11T08:00:00', count: 0 }, NOW), '0 篇 · 今天编辑', '0 篇是合法读数')
  assert.equal(formatLibraryCardMeta({ at: '2026-11-10T08:00:00' }, NOW), '昨天', '旧记录只显示时间')
  assert.equal(formatLibraryCardMeta({ at: '2026-11-10T08:00:00', count: -1 }, NOW), '昨天')
  assert.equal(formatLibraryCardMeta({ at: '2026-11-10T08:00:00', count: '12' }, NOW), '昨天', '字符串不冒充计数')
  assert.equal(formatLibraryCardMeta({ at: null, count: 7 }, NOW), '7 篇')
  assert.equal(formatLibraryCardMeta({ at: null }, NOW), '')
})
