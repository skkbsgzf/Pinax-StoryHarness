import test from 'node:test'
import assert from 'node:assert/strict'
import { segmentBlocks } from '../fact/usecases/pipeline/blocks.js'
import { buildBindPrompt, buildBatchBindPrompt, BIND_SYSTEM_PROMPT, BIND_CHANNELS } from '../fact/usecases/pipeline/bindPrompt.mjs'
import { bindSegment, bindSegments, normalizeBindReply, resolveSegmentId, DEFAULT_WHEN, DEFAULT_WHERE } from '../fact/usecases/pipeline/bindRows.js'

/**
 * 三段式的 B（窄绑定提示词）与 C（零模型回组装）。
 *
 * 作者 2026-11-11：「LLM 只用处理机械的流水线工作，无需思考。」
 * 所以这里的测试全部围绕「模型能少做就少做」，而不是「模型做得对不对」：
 *   · 提示词必须要求模型**不要复述原文**（省配额、也杜绝改写）；
 *   · 块 id 必须能双向对上（提示词给 id，回包按 id 绑定）；
 *   · 事件正文必须**恒等于块原文**（模型说什么都不影响正文）；
 *   · 幻觉 who（不在原文里）必须丢弃而不是采信；
 *   · 模板字段（when/where）必须由代码默认值给出。
 */

const SEGMENT_TEXT = '周明瑞皱起眉头，低声说：“谁在那儿？”他握紧左轮手枪，慢慢推开门。门后一片漆黑。'

function fixtureSegment() {
  const { blocks, stats } = segmentBlocks(SEGMENT_TEXT, { knownNames: ['周明瑞'] })
  return { id: 'seg:1', index: 1, chars: SEGMENT_TEXT.length, text: SEGMENT_TEXT, blocks, stats }
}

test('〔B1〕提示词要求复述原文＝错，并给出输出形状', () => {
  assert.ok(BIND_SYSTEM_PROMPT.includes('不要输出任何原文'))
  assert.ok(BIND_SYSTEM_PROMPT.includes('"blocks"'))
  assert.ok(BIND_SYSTEM_PROMPT.includes('绝不编造'))
})

test('〔B2〕单段提示词：块清单带 id 与通道提示，变量在后、固定前缀在前', () => {
  const segment = fixtureSegment()
  const prompt = buildBindPrompt({ segment, knownNames: ['周明瑞'], priorNames: [] })
  assert.ok(prompt.includes(segment.id), '段 id 必须回填')
  for (const block of segment.blocks) {
    assert.ok(prompt.includes(`[${block.id}]`), `块 ${block.id} 必须在清单里`)
  }
  assert.ok(prompt.indexOf('【本段已切好的块】') < prompt.indexOf('【段内原文'), '块清单在前、原文在后')
  assert.ok(prompt.includes('【本段新信息】'), '增量请求必须显式分段')
  // 实测：带「段 」前缀时模型会把前缀抄进回包 id；id 行必须是裸 id，前后只有分隔符。
  assert.ok(/(^|\n)=== seg:1 \|/u.test(prompt), 'id 行不得带会被误抄的前缀')
})

test('〔B3〕批式提示词：多段同批，一次请求拿到全部段', () => {
  const a = fixtureSegment()
  const b = { ...fixtureSegment(), id: 'seg:2', index: 2 }
  const prompt = buildBatchBindPrompt({ segments: [a, b], knownNames: ['周明瑞'] })
  assert.ok(prompt.includes('=== seg:1 |'), '第一段在批里')
  assert.ok(prompt.includes('=== seg:2 |'), '第二段在批里')
  assert.ok(prompt.includes('共 2 段'))
  // 批式提示词的固定前缀（含输出形状）只出现一次——这是 B3 前缀缓存的前提
  assert.equal(prompt.split('{"segments":[').length - 1, 1)
})

test('〔B4〕段 id 容错对齐：剥前缀、唯一前缀截断、序号形态都能认领，对不上返回 null', () => {
  const ids = ['358df3d893:1:d2e750ce', '3b133e6c97:4:abcd1234']
  assert.equal(resolveSegmentId('358df3d893:1:d2e750ce', ids), ids[0], '精确相等')
  assert.equal(resolveSegmentId('段 358df3d893:1:d2e750ce', ids), ids[0], '剥掉提示词排版前缀')
  assert.equal(resolveSegmentId('【358df3d893:1:d2e750ce】', ids), ids[0], '剥掉括号装饰')
  assert.equal(resolveSegmentId('3b133e6c97', ids), ids[1], '唯一前缀截断认领')
  assert.equal(resolveSegmentId('', ids), null, '空 id 不认领')
  assert.equal(resolveSegmentId('完全不存在', ids), null, '对不上就是 null，绝不猜')

  // 序号形态（真跑第 10 批：模型把 id 全改成「第6段」）：按段序号对齐
  const units = [{ id: 'abc:6:111', index: 6 }, { id: 'abc:7:222', index: 7 }]
  assert.equal(resolveSegmentId('第6段', units), 'abc:6:111')
  assert.equal(resolveSegmentId('7', units), 'abc:7:222')
  assert.equal(resolveSegmentId('seg:7', units), 'abc:7:222')
  assert.equal(resolveSegmentId('第9段', units), null, '序号不在候选里不认领')
})

test('〔C1〕事件正文恒等于块原文——模型无法影响正文', () => {
  const segment = fixtureSegment()
  const binding = {
    blocks: segment.blocks.map((block) => ({ id: block.id, who: '周明瑞', ch: 'say' }))
  }
  const { row } = bindSegment(segment, binding, { knownNames: ['周明瑞'] })
  assert.equal(row.events.length, segment.blocks.length)
  row.events.forEach((event, index) => {
    assert.equal(event.content, segment.blocks[index].text, '正文必须逐字等于块原文')
  })
})

test('〔C2〕幻觉 who（原文里没有的名字）被丢弃，不采信', () => {
  const segment = fixtureSegment()
  const binding = {
    blocks: segment.blocks.map((block) => ({ id: block.id, who: '不存在的人', ch: 'do' }))
  }
  const { row, stats } = bindSegment(segment, binding, { knownNames: [] })
  assert.equal(row.who.length, 0, '编出来的人名不进 who')
  assert.ok(stats.hallucinated > 0, '丢弃必须计数，不能静默')
  assert.ok(row.events.every((event) => event.who === ''))
})

test('〔C3〕非法通道回退到规则提示，且计数', () => {
  const segment = fixtureSegment()
  const binding = { blocks: [{ id: segment.blocks[0].id, who: '', ch: 'behavior' }] }
  const { row, stats } = bindSegment(segment, binding)
  assert.ok(BIND_CHANNELS.includes(row.events[0].channel), '通道必须落在闭集内')
  assert.equal(stats.unknownChannel, 1)
})

test('〔C4〕模型没绑定某块时，用规则提示兜底（不丢块）', () => {
  const segment = fixtureSegment()
  const { row, stats } = bindSegment(segment, { blocks: [] })
  assert.equal(row.events.length, segment.blocks.length, '块不能因为模型没答就消失')
  assert.ok(stats.ruleFallback > 0)
  assert.equal(row.events[0].channel, segment.blocks[0].channelHint)
})

test('〔C5〕模板字段由代码给默认值，不向模型索取', () => {
  const segment = fixtureSegment()
  const { row } = bindSegment(segment, { blocks: [] })
  assert.deepEqual(row.when, DEFAULT_WHEN)
  assert.equal(row.where, DEFAULT_WHERE)
  const custom = bindSegment(segment, { blocks: [] }, { when: { story_time: '第三天清晨' }, where: '廷根市公寓' })
  assert.equal(custom.row.when.story_time, '第三天清晨')
  assert.equal(custom.row.when.timeline, '顺叙', '没覆盖的字段仍取默认')
  assert.equal(custom.row.where, '廷根市公寓')
})

test('〔C6〕人物档案由块聚合：speech 收 say 块、behavior 收 do 块', () => {
  const segment = fixtureSegment()
  const sayBlock = segment.blocks.find((block) => block.kind === 'quote')
  const doBlock = segment.blocks.find((block) => block.channelHint === 'do')
  const binding = {
    blocks: [
      { id: sayBlock.id, who: '周明瑞', ch: 'say' },
      { id: doBlock.id, who: '周明瑞', ch: 'do' }
    ]
  }
  const { row } = bindSegment(segment, binding, { knownNames: ['周明瑞'] })
  const profile = row.characters.find((item) => item.name === '周明瑞')
  assert.ok(profile, '主体必须产出档案')
  assert.ok(profile.speech.includes(sayBlock.text))
  assert.ok(profile.behavior.includes(doBlock.text))
  assert.equal(row.characters.length, 1, '同段同人只一份档案，不是事件条数份')
})

test('〔C7〕增量字段：settings/knowledge/hooks 过滤空项，不编', () => {
  const segment = fixtureSegment()
  const binding = {
    blocks: [],
    settings: [{ name: '左轮手枪', slot: 'items', definition: '周明瑞的自卫武器' }, { name: '', definition: 'x' }],
    knowledge: [{ character: '周明瑞', source: '', learned: '门后没人' }, { character: '', learned: 'x' }],
    hooks: ['门后是否有人', '', '门后是否有人']
  }
  const { row } = bindSegment(segment, binding)
  assert.equal(row.settings.length, 1)
  assert.equal(row.knowledge.length, 1)
  assert.equal(row.hooks.length, 2, '重复钩子不去重是历史行为，这里只保证不编')
})

test('〔C8〕回包归一：只认 segments/blocks 两种形状，非法 item 丢弃', () => {
  const multi = normalizeBindReply({ segments: [{ id: 'a', blocks: [{ id: 'b1', who: '甲', ch: 'say' }] }, { blocks: [] }] })
  assert.equal(multi.ok, true)
  assert.equal(multi.segments.length, 1, '没有 id 的段丢弃')

  const single = normalizeBindReply({ segmentId: 'a', blocks: [{ id: 'b1', who: '甲', ch: 'say' }] })
  assert.equal(single.ok, true)
  assert.equal(single.segments[0].id, 'a')

  assert.equal(normalizeBindReply(null).ok, false)
  assert.equal(normalizeBindReply([]).ok, false)
  assert.equal(normalizeBindReply({ foo: 1 }).ok, false)
})

test('〔C9〕批式回组装：按段 id 对齐，缺绑定走兜底，统计累加', () => {
  const a = fixtureSegment()
  const b = { ...fixtureSegment(), id: 'seg:2', index: 2 }
  const bindings = [{ id: 'seg:1', blocks: a.blocks.map((block) => ({ id: block.id, who: '周明瑞', ch: 'state' })) }]
  const { rows, stats } = bindSegments([a, b], bindings, { knownNames: ['周明瑞'] })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].events[0].who, '周明瑞')
  assert.equal(rows[1].events.length, b.blocks.length)
  assert.equal(stats.segments, 2)
  assert.ok(stats.ruleFallback > 0, '第二段没有绑定，应走规则兜底')
})
