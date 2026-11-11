import test from 'node:test'
import assert from 'node:assert/strict'
import { FACT_SCHEMA, FACT_SCHEMA_LEGACY } from '../fact/domain/vocabulary.js'
import { validateFactEntry } from '../fact/domain/schema.js'
import { buildExtractionSource, compileExtractionEntries } from '../fact/usecases/pipeline/extractionChain.js'
import { normalizeExtractionProfile, EXTRACTION_PROFILE_PRESETS } from '../fact/usecases/pipeline/extractionProfile.js'

/**
 * v3 契约（作者 2026-11-11「首先，肯定是要升的」）与规模档预留。
 *
 * v3 的定位是**只做减法**：
 *   · 不再生成 `fact`（events 拼接副本，实测占 plot 字节 14%）；
 *   · 不再生成 `events[].title`（≡ content）。
 * 两者都能从 events 确定性重建，所以 v2 条目照常可读、不迁移存量。
 *
 * 规模档解决的是「短篇 2 万字 / 长篇很多万字」在数据结构行为上的差异：
 *   · 短篇：working 层不该 flush（整本书就是接续上下文）；
 *   · 长篇：compile 全量重算是 O(n²) 级的浪费，必须走增量。
 */

const TEXT = '周明瑞推开门，低声说：“谁在那儿？”他握紧左轮手枪，慢慢走进房间。门后一片漆黑。'

function fixture() {
  const source = buildExtractionSource({ id: '正文/001-测试.md', text: TEXT, chapterNo: 1 })
  const segment = source.segments[0]
  const rows = [{
    segmentId: segment.id,
    who: ['周明瑞'],
    when: { story_time: '未明示', timeline: '顺叙' },
    where: '房间',
    events: [{ who: '周明瑞', channel: 'do', content: '推开门' }],
    notes: '进门',
    characters: [{ name: '周明瑞', aliases: [], identity: '访客', traits: [], speech: [], behavior: ['推开门'] }],
    settings: []
  }]
  return { source, rows }
}

test('〔V3-1〕FACT_SCHEMA 升到 v3，v2 列为读兼容历史版本', () => {
  assert.equal(FACT_SCHEMA, 'fact.data/v3')
  assert.ok(FACT_SCHEMA_LEGACY.includes('fact.data/v2'), 'v2 必须仍在兼容名单里（存量不迁移）')
})

test('〔V3-2〕瘦编译不生成 fact 与 events[].title（两者都能从 events 重建）', () => {
  const { source, rows } = fixture()
  const out = compileExtractionEntries({ sources: [source], rows, domain: 'd', book: 'b', bookId: 'b', minimal: true })
  const plot = out.entries.find((entry) => entry.layer === 'plot')
  assert.ok(plot, 'plot 条目仍要产出')
  assert.equal(plot.fact, undefined, 'v3 不生成 fact')
  assert.equal(plot.events[0].title, undefined, 'v3 不生成 events[].title')
  assert.equal(plot.events[0].content, '推开门', '正文仍在 content 里，一个字不少')
})

test('〔V3-3〕非瘦编译仍生成 fact/title（默认行为不变，老路径不破）', () => {
  const { source, rows } = fixture()
  const out = compileExtractionEntries({ sources: [source], rows, domain: 'd', book: 'b', bookId: 'b' })
  const plot = out.entries.find((entry) => entry.layer === 'plot')
  assert.ok(typeof plot.fact === 'string' && plot.fact.length > 0, '默认仍生成 fact')
  assert.equal(plot.events[0].title, '推开门')
})

test('〔V3-4〕v2 与 v3 条目都通过校验（读兼容）', () => {
  const { source, rows } = fixture()
  const out = compileExtractionEntries({ sources: [source], rows, domain: 'd', book: 'b', bookId: 'b', minimal: true })
  const plot = out.entries.find((entry) => entry.layer === 'plot')
  assert.equal(validateFactEntry(plot).ok, true, 'v3 条目合法')

  const legacy = { ...plot, schema: 'fact.data/v2' }
  const result = validateFactEntry(legacy)
  assert.equal(result.ok, true, 'v2 条目照常通过（不迁移存量）')
  assert.equal(result.errors.some((error) => error.code === 'SCHEMA_MISMATCH'), false)
})

test('〔V3-5〕未知版本仍被拒（兼容名单不是放行一切）', () => {
  const { source, rows } = fixture()
  const out = compileExtractionEntries({ sources: [source], rows, domain: 'd', book: 'b', bookId: 'b', minimal: true })
  const plot = out.entries.find((entry) => entry.layer === 'plot')
  const result = validateFactEntry({ ...plot, schema: 'fact.data/v1' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.code === 'SCHEMA_MISMATCH'))
})

test('〔V3-6〕短篇档：绝不 flush（整本书就是接续上下文）', () => {
  const short = normalizeExtractionProfile('short')
  assert.equal(short.ok, true)
  assert.equal(short.value.scale.expectedChars, 20_000)
  assert.equal(short.value.scale.compileStrategy, 'full')
  // 水位高到 2 万字短篇根本触发不了
  assert.ok(short.value.cache.flushEntries >= 1000, '短篇不该因条数 flush')
  assert.ok(short.value.cache.flushChapters >= 100, '短篇不该因章数 flush')
  assert.ok(short.value.cache.flushChars >= 1_000_000, '短篇不该因字数 flush')
})

test('〔V3-7〕长篇档：增量编译 + 严格限流', () => {
  const long = normalizeExtractionProfile('long')
  assert.equal(long.ok, true)
  assert.equal(long.value.scale.compileStrategy, 'incremental')
  assert.ok(long.value.scale.fullRecompileEvery > 0, '必须有周期校正')
  assert.ok(long.value.cache.flushEntries <= 200, '长篇 working 层必须限流')
})

test('〔V3-8〕规模档可局部覆写：只改 expectedChars 不影响策略', () => {
  const result = normalizeExtractionProfile({ scale: { expectedChars: 50_000 } })
  assert.equal(result.ok, true)
  assert.equal(result.value.scale.expectedChars, 50_000)
  assert.equal(result.value.scale.compileStrategy, 'full', '没覆写的沿用默认')
})

test('〔V3-9〕非法规模值报错，不静默回落', () => {
  assert.equal(normalizeExtractionProfile({ scale: { compileStrategy: 'magic' } }).ok, false)
  assert.equal(normalizeExtractionProfile({ scale: { expectedChars: -1 } }).ok, false)
  assert.equal(normalizeExtractionProfile({ scale: { fullRecompileEvery: 0 } }).ok, false)
})

test('〔V3-10〕所有预置档都带 scale 段（规模是必答项，不是可选装饰）', () => {
  for (const name of Object.keys(EXTRACTION_PROFILE_PRESETS)) {
    const result = normalizeExtractionProfile(name)
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.error)}`)
    assert.ok(result.value.scale, `${name} 缺 scale 段`)
    assert.ok(['full', 'incremental'].includes(result.value.scale.compileStrategy), `${name} 的 compileStrategy 非法`)
  }
})
