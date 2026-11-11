import test from 'node:test'
import assert from 'node:assert/strict'
import {
  segmentBlocks,
  blocksOfSegments,
  extractQuoteSpans,
  speakerHintOf,
  channelHintOfSentence,
  BLOCKS_VERSION,
  BLOCK_MIN_CHARS
} from '../fact/usecases/pipeline/blocks.js'

/**
 * 确定性切块器（P-TRIM 三段式第一段）。
 *
 * 作者 2026-11-11 口径：「文字信息在塞给模型前就已经可以用一些分词器去分拆清理，
 * LLM 只用处理机械的流水线工作，无需思考。」
 *
 * 真跑读数（guimi 10 章 / 116 份回包）是本文件的判据来源：
 *   · events 只有 29% 能在原文定位 → 模型在改写，所以要先把「块」切出来，事件正文=块原文；
 *   · say 只有 33% 落在引号内 → 引号跨度必须先切准；
 *   · 按句切会得到 8.7 块/段 → 块必须打包到 25–70 字（块是标注单元不是句子）。
 *
 * 本文件钉五件事：
 *   1) 引号跨度切得准（含未闭合、同形开闭）；
 *   2) 强调引号（单词语）不单独成块，并回叙述；
 *   3) 说话人线索的可靠度分级（cue > known > pronoun > candidate > none）与「不猜」纪律；
 *   4) 块长在区间内、章名行不进块；
 *   5) 通道提示按优先级取主导，且 quote 默认为 say、心理动词上下文改 think。
 */

test('〔A1〕引号跨度：中文成对引号切准，未闭合不产半块', () => {
  const { spans } = extractQuoteSpans('他皱眉。“别动。”她说。“好。”')
  assert.equal(spans.length, 2)
  assert.equal(spans[0].text, '别动。')
  assert.equal(spans[1].text, '好。')

  const broken = extractQuoteSpans('他说：“没有闭合的句子')
  assert.equal(broken.spans.length, 0, '未闭合引号不产块——宁可少切一刀，不产半块')
})

test('〔A2〕引号跨度：半角同形引号按配对计数', () => {
  const { spans } = extractQuoteSpans('He said "go now" and left.')
  assert.equal(spans.length, 1)
  assert.equal(spans[0].text, 'go now')
})

test('〔A3〕强调引号不单独成块：单词语并回叙述', () => {
  const { blocks } = segmentBlocks('书桌上蒙着一层“轻纱”般的灰尘，他伸手抹了一把。')
  assert.ok(blocks.every((block) => block.kind === 'narration'), '单词语引号不该产出 quote 块')
  assert.ok(blocks[0].text.includes('“轻纱”'), '强调引号的内容要保留在叙述块里，不能丢')
})

test('〔A4〕疑问/感叹短引号仍是台词', () => {
  const { blocks } = segmentBlocks('周明瑞低声说：“怎么回事？”')
  const quote = blocks.find((block) => block.kind === 'quote')
  assert.ok(quote, '带问号的短引号是台词')
  assert.equal(quote.channelHint, 'say')
})

test('〔A5〕说话人线索分级：cue 最可靠', () => {
  const hint = speakerHintOf('周明瑞皱起眉头，低声说：')
  assert.equal(hint.name, '周明瑞')
  assert.equal(hint.basis, 'cue')
  assert.equal(hint.thought, false)
})

test('〔A6〕说话人线索：心理动词标记 thought，通道改 think', () => {
  const hint = speakerHintOf('周明瑞心想：')
  assert.equal(hint.thought, true)
  const { blocks } = segmentBlocks('周明瑞心想：“我是不是已经死了？”')
  const quote = blocks.find((block) => block.kind === 'quote')
  assert.equal(quote.channelHint, 'think', '心想后的引号是心里话，不是台词')
})

test('〔A7〕说话人线索：已知名唯一命中才认领，多命中不猜', () => {
  const unique = speakerHintOf('他转过身，目光落在窗边', ['周明瑞', '梅丽莎'])
  assert.equal(unique.basis, 'none', '窗口里没人名时不能凭猜测认领')

  const one = speakerHintOf('梅丽莎抬起头，语气迟疑', ['周明瑞', '梅丽莎'])
  assert.equal(one.name, '梅丽莎')
  assert.equal(one.basis, 'known')

  const ambiguous = speakerHintOf('周明瑞看着梅丽莎', ['周明瑞', '梅丽莎'])
  assert.equal(ambiguous.name, null, '两个已知名同现＝指代不明，不猜')
  assert.equal(ambiguous.basis, 'candidate')
})

test('〔A8〕块长与碎块纪律：不产「…」「嘶…」伪块，章名不进块', () => {
  const text = '第一章 绯红\n\n……好痛！光怪陆离的梦境迅速支离破碎，熟睡中的周明瑞只觉脑袋抽痛异常，仿佛被人用棒子狠狠抡了一下，更像是遭尖锐的物品刺入太阳穴并伴随有搅动。'
  const { blocks, stats } = segmentBlocks(text)
  assert.ok(!blocks.some((block) => block.text.trim().length <= 2), '没有 ≤2 字的伪块')
  assert.ok(blocks.every((block) => !block.text.startsWith('第一章')), '章名是版式不是叙事，不进块')
  assert.ok(stats.droppedFragments >= 0)
})

test('〔A9〕块长区间：叙述块打包到 ≥ 最小长度（除非段本身很短）', () => {
  const text = '他推开门。屋里很暗。桌上放着一盏煤油灯，灯芯烧得焦黑，显然是许久没有添过油了。'
  const { blocks } = segmentBlocks(text)
  const narration = blocks.filter((block) => block.kind === 'narration')
  assert.ok(narration.length >= 1)
  // 打包后的块不应碎成一句一块
  assert.ok(narration.length <= 2, `打包后不该碎成 ${narration.length} 块`)
  assert.ok(narration[0].text.length >= Math.min(BLOCK_MIN_CHARS, text.length))
})

test('〔A10〕通道提示：优先级 perceive > think > feel > do > state', () => {
  assert.equal(channelHintOfSentence('他看见桌上有一封信'), 'perceive')
  assert.equal(channelHintOfSentence('他心想这事不对'), 'think')
  assert.equal(channelHintOfSentence('他只觉得浑身发冷'), 'feel')
  assert.equal(channelHintOfSentence('他推开门走了出去'), 'do')
  assert.equal(channelHintOfSentence('屋里很暗'), 'state')
})

test('〔A11〕块序与 id：原文序、id 连续、每块有通道提示', () => {
  const text = '周明瑞推开门。“谁？”屋内传来声音。“是我。”周明瑞答道。'
  const { blocks, stats } = segmentBlocks(text)
  assert.equal(stats.version, BLOCKS_VERSION)
  blocks.forEach((block, index) => {
    assert.equal(block.id, `b${index + 1}`)
    assert.equal(block.index, index + 1)
    assert.ok(block.channelHint)
  })
  const quoteTexts = blocks.filter((block) => block.kind === 'quote').map((block) => block.text)
  assert.deepEqual(quoteTexts, ['谁？', '是我。'], '引号块按原文序')
})

test('〔A12〕blocksOfSegments：批式输入保持段序，空段不炸', () => {
  const result = blocksOfSegments([
    { id: 's1', index: 1, chars: 20, text: '他推开门。“谁？”' },
    { id: 's2', index: 2, chars: 0, text: '' }
  ])
  assert.equal(result.length, 2)
  assert.equal(result[0].id, 's1')
  assert.ok(result[0].blocks.length >= 1)
  assert.deepEqual(result[1].blocks, [])
})

test('〔A13〕不猜纪律：无任何线索时 speakerHint 为 null，basis 如实标注', () => {
  const { blocks } = segmentBlocks('“谁在那里？”')
  const quote = blocks.find((block) => block.kind === 'quote')
  assert.equal(quote.speakerHint, null, '没有线索就是没有，不能编一个人名')
  assert.equal(quote.hintBasis, 'none')
})
