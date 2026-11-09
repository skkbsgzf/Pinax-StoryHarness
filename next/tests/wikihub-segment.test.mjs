import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEGMENT_MAX_CHARS,
  SEGMENT_MIN_CHARS,
  charCount,
  segmentStats,
  segmentText,
  splitParagraphs,
  splitSentences
} from '../wikihub/segment.mjs'

/**
 * S4 分段门禁：边界（99/100/300/301）与中英混排的确定性口径。
 *
 * 口径：数据单元＝段；每段 100–300 字（码点计），>300 均衡拆、<100 并邻段或从邻段补字；
 * 规则做不到的（整篇不足 100、尾段无处可并）保留原样并在 segmentStats 里如实记 underMin。
 */

const charsOf = (segments) => segments.map((segment) => segment.chars)
const lens = (text) => Array.from(text).length

test('边界：99 / 100 / 300 / 301 / 600 / 601', () => {
  assert.deepEqual(charsOf(segmentText('甲'.repeat(99))), [99], '不足 100 且无邻段：保持原样')
  assert.equal(segmentStats(segmentText('甲'.repeat(99))).underMin, 1, '做不到的要记账')

  assert.deepEqual(charsOf(segmentText('乙'.repeat(100))), [100], '100 整不拆不并')
  assert.deepEqual(charsOf(segmentText('丙'.repeat(300))), [300], '300 整不拆')
  assert.deepEqual(charsOf(segmentText('丁'.repeat(301))), [151, 150], '301 均衡拆成 151+150，不是 300+1')
  assert.deepEqual(charsOf(segmentText('戊'.repeat(600))), [300, 300])
  assert.deepEqual(charsOf(segmentText('己'.repeat(601))), [201, 201, 199], '601 均分三份，尾段仍 ≥100')

  for (const text of ['乙'.repeat(100), '丙'.repeat(300), '丁'.repeat(301), '戊'.repeat(600), '己'.repeat(601)]) {
    const stats = segmentStats(segmentText(text))
    assert.equal(stats.underMin, 0, `${lens(text)} 字的段不应有 <100 的单元`)
    assert.equal(stats.overMax, 0, `${lens(text)} 字的段不应有 >300 的单元`)
    assert.deepEqual(stats.limits, { min: SEGMENT_MIN_CHARS, max: SEGMENT_MAX_CHARS })
    assert.equal(stats.totalChars, lens(text), '分段不丢字')
  }
})

test('短段：能并邻段就并（≤300），并不得就从邻段补字到 100', () => {
  const merged = segmentText(`${'庚'.repeat(6)}\n\n${'辛'.repeat(200)}`)
  assert.deepEqual(charsOf(merged), [206], '6 字 + 200 字并成一段（6+200 ≤ 300）')
  assert.equal(merged[0].text, `${'庚'.repeat(6)}${'辛'.repeat(200)}`, '合并后顺序不变')

  const topped = segmentText(`${'壬'.repeat(80)}\n\n${'癸'.repeat(280)}`)
  assert.deepEqual(charsOf(topped), [100, 260], '80+280 合并会超 300：从邻段补 20 字')
  assert.equal(topped[0].text, `${'壬'.repeat(80)}${'癸'.repeat(20)}`)

  const oneChar = segmentText(`${'子'.repeat(99)}\n\n${'丑'.repeat(250)}`)
  assert.deepEqual(charsOf(oneChar), [100, 249], '只差 1 字也补足')
})

test('中英混排：不切断英文单词，段落间按空行分，段内多句打包', () => {
  const words = Array.from({ length: 70 }, (_, index) => `word${String(index).padStart(2, '0')}`)
  const text = words.join(' ')
  assert.equal(lens(text), 489)
  const segments = segmentText(text)
  assert.equal(segments.length, 2, '489 字按均衡拆两段')
  for (const segment of segments) {
    assert.ok(segment.chars >= 100 && segment.chars <= 300, `单元 ${segment.chars} 越界`)
    assert.equal(segment.chars, lens(segment.text), 'chars 按码点计')
  }
  assert.deepEqual(segments.flatMap((segment) => segment.text.split(/\s+/u)), words, '切点只落在空格，单词完整且顺序不变')

  const punctuated = segmentText('柯秒在雨里走。@《旧钟楼》他抬头。\n\nThe clock stopped at 12:03.\n\n甲'.repeat(1))
  assert.ok(punctuated.length >= 1)

  const englishPara = segmentText(`${'alpha beta gamma delta '.repeat(10)}\n\n${'epsilon zeta '.repeat(10)}`)
  assert.deepEqual(englishPara.flatMap((segment) => segment.text.split(/\s+/u)), `${'alpha beta gamma delta '.repeat(10)} ${'epsilon zeta '.repeat(10)}`.trim().split(/\s+/u), '跨段合并加空格，但词序与词形不变')
})

test('码点计字：emoji 按 1 字算，不按 UTF-16 单元', () => {
  const emoji = '😀'.repeat(120)
  const segments = segmentText(emoji)
  assert.equal(segments.length, 1)
  assert.equal(segments[0].chars, 120)
  assert.equal(segments[0].text.length, 240, 'UTF-16 长度翻倍，但 chars 是码点数')
  assert.equal(charCount(emoji), 120)
})

test('切分骨架：段落按空行、句子按句末标点（标点留在句尾）', () => {
  assert.deepEqual(splitParagraphs('第一段。\n\n第二段。\n \n第三段。'), ['第一段。', '第二段。', '第三段。'])
  assert.deepEqual(splitSentences('甲。乙！丙？丁'), ['甲。', '乙！', '丙？', '丁'])
  assert.deepEqual(splitSentences('没有句末标点'), ['没有句末标点'])
})

test('段元数据：index 从 1 连续，chars 与 text 一致；min/max 可覆盖', () => {
  const segments = segmentText(`${'甲'.repeat(150)}\n\n${'乙'.repeat(150)}`)
  assert.deepEqual(segments.map((segment) => segment.index), [1, 2])
  for (const segment of segments) assert.equal(segment.chars, lens(segment.text))

  const custom = segmentText('a'.repeat(50), { min: 20, max: 40 })
  assert.deepEqual(charsOf(custom), [25, 25], '自定义窗口：50 字拆成 25+25')
  assert.deepEqual(segmentStats(custom, { min: 20, max: 40 }).limits, { min: 20, max: 40 })

  assert.deepEqual(segmentText(''), [], '空文本返回空序列')
  assert.deepEqual(segmentText('   \n\n  '), [], '纯空白不产生空段')
})
