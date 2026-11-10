import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEntryTokenMap, computeBacklinks, entryLinkTokensOf, mergeTokenMaps, ownEntryTokens, wikiLinkRanges } from '../shell/wikiLinks.mjs'

test('wikiLinkRanges：最长优先、互不重叠、按出现顺序', () => {
  const names = ['真相层·十二维、阶数与主角', '真相层·十二维', '十二时辰']
  const ranges = wikiLinkRanges('参见真相层·十二维、阶数与主角与设定·界与十二时辰。', names)
  // 长名赢短名；「十二时辰」嵌在「界与十二时辰」里也要命中
  assert.equal(ranges.length, 2)
  assert.equal(ranges[0].name, '真相层·十二维、阶数与主角')
  assert.equal(ranges[1].name, '十二时辰')
  assert.ok(ranges[0].end < ranges[1].start)
})

test('wikiLinkRanges：短于 2 字的名字不参与；空输入空输出', () => {
  assert.deepEqual(wikiLinkRanges('柯秒与白灼', ['柯', '']), [])
  assert.deepEqual(wikiLinkRanges('', ['柯秒']), [])
})

test('computeBacklinks：relations 提到与正文包含都算，排除自己', () => {
  const entries = [
    { name: '人物·白灼', path: '世界书/人物/白灼.md', relations: [{ to: '人物·柯秒' }], content: '守边者。' },
    { name: '物品·怀表', path: '世界书/物品/怀表.md', relations: [], content: '柯秒袖口的表——人物·柯秒随身带着它。' },
    { name: '人物·柯秒', path: '世界书/人物/柯秒.md', relations: [], content: '我自己。' }
  ]
  const backlinks = computeBacklinks(entries, '人物·柯秒', '世界书/人物/柯秒.md')
  assert.deepEqual(backlinks.map((b) => b.name).sort(), ['人物·白灼', '物品·怀表'])
})

test('computeBacklinks：空名与空清单一律空', () => {
  assert.deepEqual(computeBacklinks([{ name: 'a', content: 'x' }], '', ''), [])
  assert.deepEqual(computeBacklinks([], '柯秒', 'p'), [])
})

/**
 * 批次44 · 蓝色标签那件事（作者 2026-10-31：「你在前端设计了一些蓝色的标签，
 * 看上去能跳转，但是其实不行，非常矛盾」）。
 *
 * 纪律只有一句：**看着能点就必须点得动**。所以词表只收「恰好指向一条条目」的词——
 * 落在两条以上条目上的通用词（标签「记忆」「结构」就是这种）根本不入表，
 * 正文里就当普通文字，不染蓝。染了蓝还点不动，比不染更坏。
 */

test('entryLinkTokensOf：全名、短名、别名、关键词、标签都算候选词；短于 2 字与重复的不算', () => {
  const tokens = entryLinkTokensOf({
    name: '人物·柯秒',
    aliases: ['柯秒', '阿秒'],
    keys: ['主角'],
    tags: ['主角', '雪夜']
  })
  assert.deepEqual(tokens, ['人物·柯秒', '柯秒', '阿秒', '主角', '雪夜'])
  // 一个字与空串不进词表（正文里一个字染蓝太吵）。
  assert.deepEqual(entryLinkTokensOf({ name: '柯' }), [])
  assert.deepEqual(entryLinkTokensOf({ name: '' }), [])
  assert.deepEqual(entryLinkTokensOf(null), [])
})

test('buildEntryTokenMap：恰好指向一条条目的词才进表；两条以上共有的词不进表', () => {
  const entries = [
    { name: '人物·柯秒', aliases: ['柯秒'], tags: ['主角'] },
    { name: '编年·雨夜', aliases: [], tags: ['主角'] },
    { name: '设定·钟楼', aliases: ['钟楼'], tags: [] }
  ]
  const map = buildEntryTokenMap(entries)
  // 唯一归属的词进表。
  assert.equal(map.get('编年·雨夜')?.name, '编年·雨夜')
  assert.equal(map.get('雨夜')?.name, '编年·雨夜', '短名（· 后缀）也是一条入口')
  assert.equal(map.get('钟楼')?.name, '设定·钟楼')
  // 两条共有的标签不进表——它指向谁都不成立，染蓝就是骗人。
  assert.equal(map.has('主角'), false, '「主角」是两条共用的标签，不该染蓝')
  // 柯秒的名字自己归自己。
  assert.equal(map.get('柯秒')?.name, '人物·柯秒')
})

test('buildEntryTokenMap：空清单与畸形清单不崩', () => {
  assert.equal(buildEntryTokenMap([]).size, 0)
  assert.equal(buildEntryTokenMap(null).size, 0)
  assert.equal(buildEntryTokenMap([null, {}, { name: '' }]).size, 0)
})

test('ownEntryTokens：当前条目自己的词不进链（链到自己等于没跳）', () => {
  const own = ownEntryTokens({ name: '人物·柯秒', aliases: ['柯秒'], tags: ['主角'] })
  assert.deepEqual([...own].sort(), ['人物·柯秒', '柯秒', '主角'].sort())
  assert.equal(own.has('编年·雨夜'), false)
})

/**
 * 批次 W3：三栏工作区的正文蓝链改走 hub 链接表，资料／约束词表并回同一张表。
 * 合并纪律与单表一致：一个词只有**恰好指向同一个目标**时才留下；同名不同物整词剔除并记账。
 */
test('mergeTokenMaps：同词同目标两份表合一；同词不同目标整词剔除并进冲突', () => {
  const entry = { kind: 'entry', name: '人物·柯秒', path: '世界书/人物·柯秒.md' }
  const document = { kind: 'document', name: '柯秒', path: '资料/柯秒.md' }
  const hub = new Map([['柯秒', entry]])
  const docs = new Map([['柯秒', document], ['文风', { kind: 'rule', name: '文风', path: '约束/文风.md' }]])

  const merged = mergeTokenMaps(hub, docs)
  assert.equal(merged.map.has('柯秒'), false, '条目与资料同名：这个词指向谁都不成立')
  assert.deepEqual(merged.conflicts.map((conflict) => conflict.token), ['柯秒'])
  assert.equal(merged.map.get('文风').kind, 'rule', '不冲突的词照常进表')

  const same = mergeTokenMaps(hub, new Map([['柯秒', { ...entry }]]))
  assert.equal(same.map.get('柯秒').path, '世界书/人物·柯秒.md', '同一目标出现两次仍只留一条')
  assert.deepEqual(same.conflicts, [])
})

test('mergeTokenMaps：非 Map 入参与空表一律跳过，不崩也不错表', () => {
  const hub = new Map([['柯秒', { kind: 'entry', name: '人物·柯秒', path: 'a.md' }]])
  const merged = mergeTokenMaps(hub, null, undefined, 'nope', [])
  assert.deepEqual([...merged.map.keys()], ['柯秒'])
  assert.deepEqual(mergeTokenMaps().map.size, 0)
})
