import test from 'node:test'
import assert from 'node:assert/strict'
import { wikiLinkRanges, computeBacklinks } from '../shell/wikiLinks.mjs'

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
