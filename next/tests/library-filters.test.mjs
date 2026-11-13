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
 * 库管理器筛选与卡片读数（工单 P1）的纯函数用例。
 * 口径：kind 映射 novel/script/comic/worldbook/reference|dossier；其余/缺失＝未分类；
 * tab 只渲染有内容的类别（计数为 0 不渲染）；卡片第三行没有 count 就只显示时间。
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

test('筛选 tab：全部恒在，其余只出计数 > 0 的类别，顺序固定', () => {
  const tabs = buildLibraryFilterTabs(ENTRIES)
  assert.deepEqual(tabs.map((tab) => tab.id), ['all', 'novel', 'script', 'comic', 'worldbook', 'reference', 'uncategorized'])
  assert.deepEqual(tabs.map((tab) => tab.count), [8, 2, 1, 1, 1, 2, 1])
  assert.equal(tabs[0].label, '全部')
  // 空清单只留「全部 0」；有内容的类别才出现。
  assert.deepEqual(buildLibraryFilterTabs([]), [{ id: 'all', label: '全部', count: 0 }])
  assert.deepEqual(buildLibraryFilterTabs([{ kind: 'novel' }]).map((tab) => tab.id), ['all', 'novel'])
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
