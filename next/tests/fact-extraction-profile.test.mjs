import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_EXTRACTION_PROFILE,
  EXTRACTION_PROFILE_PRESETS,
  EXTRACTION_PROFILE_VERSION,
  PROFILE_PARAM_NOTES,
  normalizeExtractionProfile,
  saliencePolicyOf,
  flushPolicyOf,
  profileDigest
} from '../fact/usecases/pipeline/extractionProfile.js'
import { segmentBlocks, BLOCK_MIN_CHARS, BLOCK_MAX_CHARS } from '../fact/usecases/pipeline/blocks.js'
import { segmentText } from '../fact/domain/segment.js'
import { bindSegment } from '../fact/usecases/pipeline/bindRows.js'

/**
 * 抽取档位（作者 2026-11-11：「这里面很多东西都要参数化，不同的体裁、不同的内容形式，
 * 它的采集节奏是不一样的……我们先把默认这一套做好。」）。
 *
 * 本文件钉四件事：
 *   1) 默认档是完整、合法、自洽的一套（不是一个半成品）；
 *   2) 局部覆写只动目标项，其余沿用默认（换体裁最常用的姿势）；
 *   3) 坏值必须**报错**而不是静默回落——静默默认值是调参时最难发现的坑；
 *   4) 档位真的会被切块/分段/显著度/水位读取（不是写完就没人用）。
 */

const SAMPLE = '周明瑞推开门，低声说：“谁在那儿？”他握紧左轮手枪，慢慢走进房间。门后一片漆黑，什么也没有。他皱了皱眉，又退了出来。'

test('〔F1〕默认档完整且合法：五组参数齐全，校验通过', () => {
  const result = normalizeExtractionProfile()
  assert.equal(result.ok, true, JSON.stringify(result.error))
  const profile = result.value
  assert.equal(profile.version, EXTRACTION_PROFILE_VERSION)
  for (const group of ['segment', 'blocks', 'bind', 'salience', 'cache']) {
    assert.ok(profile[group], `${group} 组必须在默认档里`)
  }
  assert.deepEqual(profile.segment, { min: 100, max: 300 }, '段落粒度沿用 100–300 口径')
  assert.equal(profile.blocks.min, BLOCK_MIN_CHARS)
  assert.equal(profile.blocks.max, BLOCK_MAX_CHARS)
  assert.equal(profile.bind.batchChars, 3600)
  assert.ok(Array.isArray(profile.bind.channels) && profile.bind.channels.length >= 7)
})

test('〔F2〕每个可调参数都有说明：作者调参不用翻代码', () => {
  const profile = DEFAULT_EXTRACTION_PROFILE
  const expected = []
  for (const group of ['segment', 'blocks', 'bind', 'salience', 'cache']) {
    for (const key of Object.keys(profile[group])) expected.push(`${group}.${key}`)
  }
  const documented = Object.keys(PROFILE_PARAM_NOTES)
  for (const key of expected) {
    assert.ok(documented.includes(key), `${key} 缺少说明（PROFILE_PARAM_NOTES）`)
  }
})

test('〔F3〕局部覆写只动目标项，其余继承默认', () => {
  const result = normalizeExtractionProfile({ bind: { batchChars: 6000 } })
  assert.equal(result.ok, true)
  assert.equal(result.value.bind.batchChars, 6000, '覆写生效')
  assert.equal(result.value.bind.maxIncrementsPerSegment.settings, 6, '同组其他项不受影响')
  assert.equal(result.value.segment.min, 100, '其他组不受影响')
})

test('〔F4〕预置档：按名取档，且各自参数合规', () => {
  for (const name of Object.keys(EXTRACTION_PROFILE_PRESETS)) {
    const result = normalizeExtractionProfile(name)
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.error)}`)
    assert.equal(result.value.name, name)
  }
  const script = normalizeExtractionProfile('script').value
  assert.ok(script.blocks.max < DEFAULT_EXTRACTION_PROFILE.blocks.max, '剧本的块更小（场景短）')
  assert.ok(!script.bind.channels.includes('think'), '剧本没有内心描写通道')
  const nonfiction = normalizeExtractionProfile('nonfiction').value
  assert.ok(nonfiction.segment.max > DEFAULT_EXTRACTION_PROFILE.segment.max, '非虚构要长段')
})

test('〔F5〕坏值必须报错，不静默回落默认', () => {
  assert.equal(normalizeExtractionProfile({ segment: { min: 500, max: 300 } }).ok, false, 'min ≥ max 要拒')
  assert.equal(normalizeExtractionProfile({ bind: { batchChars: 100 } }).ok, false, '低于 300 要拒')
  assert.equal(normalizeExtractionProfile({ bind: { channels: [] } }).ok, false, '空通道集要拒')
  assert.equal(normalizeExtractionProfile({ cache: { flushEntries: 0 } }).ok, false, '0 条水位要拒')
  assert.equal(normalizeExtractionProfile({ unknownGroup: {} }).ok, true, '未知组被忽略（向前兼容）')
  const unknown = normalizeExtractionProfile('no-such-preset')
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'UNKNOWN_PROFILE_PRESET')
})

test('〔F6〕档位真的被读取：切块粒度随 blocks 档位变化', () => {
  const tight = segmentBlocks(SAMPLE, { min: 10, max: 30 })
  const loose = segmentBlocks(SAMPLE, { min: 60, max: 120 })
  assert.ok(tight.blocks.length > loose.blocks.length, '块上限越小，块数越多')
  for (const block of tight.blocks.filter((item) => item.kind === 'narration')) {
    assert.ok(block.text.length <= 30 + 20, `叙述块不该远超上限（实际 ${block.text.length}）`)
  }
})

test('〔F7〕档位真的被读取：分段粒度随 segment 档位变化', () => {
  const long = SAMPLE.repeat(8)
  const tight = segmentText(long, { min: 60, max: 120 })
  const loose = segmentText(long, { min: 200, max: 600 })
  assert.ok(tight.length > loose.length, '段上限越小，段数越多')
  assert.ok(tight.every((segment) => segment.chars <= 120), '不超上限')
})

test('〔F8〕显著度与水位 policy 从档位派生（只覆写门槛，权重表沿用 salience 默认）', () => {
  const profile = normalizeExtractionProfile({
    salience: { characterEntryFloor: 5.0, worldviewEntryFloor: 2.0 },
    cache: { flushEntries: 200, flushChapters: 6 }
  }).value
  const salience = saliencePolicyOf(profile)
  assert.equal(salience.characterEntryFloor, 5.0)
  assert.equal(salience.worldviewEntryFloor, 2.0)
  assert.equal(salience.weights, undefined, '不覆盖权重表（那是 salience 模块的默认）')

  const flush = flushPolicyOf(profile)
  assert.equal(flush.flushEntries, 200)
  assert.equal(flush.flushChapters, 6)
  assert.equal(flush.retrieveLimit, DEFAULT_EXTRACTION_PROFILE.cache.retrieveLimit, '没覆写的沿用默认')
})

test('〔F9〕profileDigest 只列与默认不同的项（让作者看到自己的覆写生效了）', () => {
  const profile = normalizeExtractionProfile({ bind: { batchChars: 6000 }, cache: { flushEntries: 200 } }).value
  const digest = profileDigest(profile)
  assert.equal(digest.overrides['bind.batchChars'], 6000)
  assert.equal(digest.overrides['cache.flushEntries'], 200)
  assert.equal(Object.keys(digest.overrides).length, 2, '只报变了的两项')
  assert.equal(profileDigest(DEFAULT_EXTRACTION_PROFILE).overrides['bind.batchChars'], undefined)
})

test('〔F10〕增量条数上限随档位：关系/设定/知情都被截断', () => {
  const segment = {
    id: 'seg:1', index: 1, chars: SAMPLE.length, text: SAMPLE,
    blocks: [{ id: 'b1', index: 1, kind: 'narration', text: '周明瑞推开门', channelHint: 'do', speakerHint: null }]
  }
  const binding = {
    blocks: [{ id: 'b1', who: '周明瑞', ch: 'do' }],
    settings: Array.from({ length: 12 }, (_, index) => ({ name: `设定${index}`, slot: 'items', definition: '定义' })),
    knowledge: Array.from({ length: 10 }, (_, index) => ({ character: '周明瑞', source: '', learned: `学到${index}` })),
    hooks: ['一', '二', '三', '四'],
    relations: [
      { from: '周明瑞', to: '左轮手枪', type: '持有', how: '' },
      { from: '周明瑞', to: '完全不存在的人', type: '敌对', how: '' }
    ]
  }
  const { row, stats } = bindSegment(segment, binding, { limits: { settings: 3, knowledge: 2, hooks: 1, relations: 5 } })
  assert.equal(row.settings.length, 3, '设定按档位截断')
  assert.equal(row.knowledge.length, 2)
  assert.equal(row.hooks.length, 1)
  assert.equal(stats.relations, 1, '真实关系保留')
  assert.equal(stats.relationDropped.hallucinated, 1, '两端不在本段正文里的关系被丢弃并计数')
})
