import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ENTRY_GROUP_ORDER,
  entrySegmentCount,
  entrySegmentLabel,
  entryTypeLabel,
  groupEntriesByType,
  groupedEntryList
} from '../shell/entriesGroupedList.mjs'

/**
 * 世界书板左栏分组列表（工单 P3）的纯函数用例。
 *
 * 钉住四件事：type → 人话组名、组序（表内序／未知按出现序／「其他」垫底）、
 * 搜索（name／keys／summary）与「关系图谱 N 节点」的口径、段数三种来源
 * （segs 数组／segs 数字／正文空行切分）以及「都没有就不摆数字」。
 */

const ENTRIES = [
  { name: '林砚', type: 'character', summary: '守夜人', aliases: ['阿砚'], path: '世界书/人物/林砚.md', content: '第一段\n\n第二段\n\n第三段' },
  { name: '沈鹤', type: 'person', keys: ['鹤'], path: '世界书/人物/沈鹤.md', segs: ['甲', '乙'] },
  { name: '雾港', type: 'location', path: '世界书/地理/雾港.md', content: '甲\r\n\r\n乙' },
  { name: '灯船', type: 'place', path: '世界书/地理/灯船.md', segs: 6 },
  { name: '旧钟楼', type: 'item', path: '世界书/设定/旧钟楼.md' },
  { name: '旧木箱', type: '物件', path: '世界书/设定/旧木箱.md', content: '' },
  { name: '断剑', type: 'weapon', path: '世界书/设定/断剑.md', content: '只有一段' },
  { name: '无类', type: '', path: '世界书/无类.md', chars: 999 }
]

test('type → 人话组名：同义 type 合并，未知保留原样，缺失归「其他」', () => {
  assert.equal(entryTypeLabel('character'), '人物')
  assert.equal(entryTypeLabel('person'), '人物')
  assert.equal(entryTypeLabel('location'), '地点')
  assert.equal(entryTypeLabel('place'), '地点')
  assert.equal(entryTypeLabel('地理'), '地点')
  assert.equal(entryTypeLabel('item'), '物件')
  assert.equal(entryTypeLabel('event'), '编年')
  assert.equal(entryTypeLabel('organization'), '势力')
  assert.equal(entryTypeLabel('faction'), '势力')
  assert.equal(entryTypeLabel('setting'), '设定')
  assert.equal(entryTypeLabel('weapon'), 'weapon', '认不出来的 type 不硬猜，原样当组名')
  assert.equal(entryTypeLabel('  CHARACTER  '), '人物', '大小写与首尾空白不影响映射')
  assert.equal(entryTypeLabel(''), '其他')
  assert.equal(entryTypeLabel(null), '其他')
  assert.ok(ENTRY_GROUP_ORDER.includes('人物') && ENTRY_GROUP_ORDER.includes('其他'))
})

test('分组：先按固定组序，表外的组按出现序接在后面，「其他」永远垫底', () => {
  const groups = groupEntriesByType(ENTRIES)
  assert.deepEqual(groups.map((group) => group.label), ['人物', '地点', '物件', 'weapon', '其他'])
  assert.deepEqual(groups.map((group) => group.count), [2, 2, 2, 1, 1])
  assert.deepEqual(groups[0].entries.map((entry) => entry.name), ['林砚', '沈鹤'], '组内顺序沿用清单序')
  assert.equal(groups[4].entries[0].name, '无类')
})

test('搜索命中 name／keys／aliases／summary；没命中时分组为空但图谱节点数不缩水', () => {
  const byName = groupedEntryList(ENTRIES, { text: '林砚' })
  assert.equal(byName.matched, 1)
  assert.deepEqual(byName.groups.map((group) => [group.label, group.count]), [['人物', 1]])

  const byAlias = groupedEntryList(ENTRIES, { text: '阿砚' })
  assert.equal(byAlias.matched, 1, '列表工具的 aliases 与读工具的 keys 都算关键词')

  const byKey = groupedEntryList(ENTRIES, { text: '鹤' })
  assert.equal(byKey.matched, 1)

  const bySummary = groupedEntryList(ENTRIES, { text: '守夜' })
  assert.equal(bySummary.matched, 1)

  const missing = groupedEntryList(ENTRIES, { text: '查无此条' })
  assert.equal(missing.matched, 0)
  assert.deepEqual(missing.groups, [])
  assert.equal(missing.total, ENTRIES.length)
  assert.equal(missing.graph.count, ENTRIES.length, '图谱是整书图谱，节点数不跟搜索缩水')
  assert.equal(missing.graph.label, '关系图谱')
})

test('段数三种来源：segs 数组／segs 数字／正文空行切分（含 CRLF）', () => {
  assert.equal(entrySegmentCount(ENTRIES[0]), 3, '正文按空行切段')
  assert.equal(entrySegmentLabel(ENTRIES[0]), '3 段')
  assert.equal(entrySegmentCount(ENTRIES[1]), 2, 'segs 数组取长度')
  assert.equal(entrySegmentCount(ENTRIES[2]), 2, '\\r\\n\\r\\n 也是空行')
  assert.equal(entrySegmentCount(ENTRIES[3]), 6, '上游算好的 segs 数字原样取整')
})

test('段数缺字段时是 null：不摆数字，也不拿 chars 冒充段数', () => {
  assert.equal(entrySegmentCount(ENTRIES[4]), null)
  assert.equal(entrySegmentLabel(ENTRIES[4]), '')
  assert.equal(entrySegmentCount(ENTRIES[7]), null, '只有 chars 的条目不许估算段数')
  assert.equal(entrySegmentLabel(ENTRIES[7]), '')
  assert.equal(entrySegmentCount({ segs: -1 }), null)
  assert.equal(entrySegmentCount({ segs: '3' }), null, '字符串数字不是已算好的 segs')
})

test('空正文是「0 段」：字段在场且为空，与「不知道」区分开', () => {
  assert.equal(entrySegmentCount(ENTRIES[5]), 0)
  assert.equal(entrySegmentLabel(ENTRIES[5]), '0 段')
  assert.equal(entrySegmentCount({ content: '  \n\n \t \n\n  ' }), 0, '只有空白的段不算段')
})

test('折叠标记只读入参里的组名：不落盘、不猜别的组', () => {
  const list = groupedEntryList(ENTRIES, { collapsed: ['人物'] })
  const collapsedLabels = list.groups.filter((group) => group.collapsed).map((group) => group.label)
  assert.deepEqual(collapsedLabels, ['人物'])
  const none = groupedEntryList(ENTRIES)
  assert.equal(none.groups.some((group) => group.collapsed), false, '默认全部展开')
})

test('坏输入不崩、不改入参：非数组按空清单处理，条目对象原样引用', () => {
  const empty = groupedEntryList(null)
  assert.deepEqual(empty, { graph: { label: '关系图谱', count: 0 }, groups: [], matched: 0, total: 0 })
  assert.deepEqual(groupEntriesByType('bad'), [])

  const before = ENTRIES.map((entry) => entry.name)
  const groups = groupEntriesByType(ENTRIES)
  assert.deepEqual(ENTRIES.map((entry) => entry.name), before, '分组不重排入参')
  assert.equal(groups[0].entries[0], ENTRIES[0], '组内保留原条目引用')
  assert.notEqual(groups[0].entries, ENTRIES, '组内数组是新数组')
})
