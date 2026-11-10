import test from 'node:test'
import assert from 'node:assert/strict'
import {
  foldSegmentsToBeats,
  verifyAlignment,
  ALIGN_VERSION,
  BEAT_TARGET_CHARS,
  BEAT_MIN_CHARS
} from '../fact/usecases/render/alignGranularity.js'
import { chapterize, DEFAULT_MAX_BEATS_PER_CHAPTER } from '../fact/usecases/render/chapterize.js'
import { FACT_SCHEMA } from '../fact/domain/vocabulary.js'
import { stableEntryId } from '../fact/domain/stableId.js'

/**
 * P-ALIGN 合同测试：抽取段（100–300 字）→ 成书拍。
 *
 * 钉住的五条合并规则：
 *   1) 不跨章（validity.from 变了即收拍）；
 *   2) 不跨视角（pov 变了即断）；
 *   3) 按信息量累积到目标拍长（默认 600），未到下限继续吃；
 *   4) 悬置伏笔跟着拍走；
 *   5) 单条超长自成拍。
 * 外加：覆盖完整性（一条段不丢不重）与「段级直喂会把一章切成几章」这个真问题的读数对比。
 */

const DOMAIN = '停摆之城'

/** 一条抽取段形状的 plot 条目（与 extractionChain.compilePlot 产物同形）。 */
function segmentEntry({ name, chars = 150, chapter = 1, pov = null, hooks = [], definition, events }) {
  const body = definition ?? '字'.repeat(chars)
  const entry = {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain: DOMAIN, slot: '', name }),
    layer: 'plot',
    name,
    domain: DOMAIN,
    status: 'adopted',
    definition: body,
    events: events ?? [{ index: 1, track: 'fact', title: body.slice(0, 10), refs: [], segments: [], novelty: [] }],
    validity: { from: chapter, to: chapter },
    provenance: { mode: 'analyze', book: DOMAIN, book_id: 'abcd1234', chapters: [chapter], scenes: [], extractor: 'test/1', ...(pov ? { pov } : {}) },
    fingerprint: { vec: null, metrics: {} }
  }
  if (hooks.length) entry.hooks = hooks
  return entry
}

test('版本与常量：目标 600 / 下限 300（与抽取段 100–300 对齐）', () => {
  assert.equal(ALIGN_VERSION, 'plot-align@1')
  assert.equal(BEAT_TARGET_CHARS, 600)
  assert.equal(BEAT_MIN_CHARS, 300)
})

test('规则 3：相邻段累加到目标拍长才收拍', () => {
  const entries = [
    segmentEntry({ name: '段1', chars: 150 }),
    segmentEntry({ name: '段2', chars: 150 }),
    segmentEntry({ name: '段3', chars: 150 }),
    segmentEntry({ name: '段4', chars: 150 })
  ]
  const result = foldSegmentsToBeats(entries)
  // 150×4=600：前三段 450 < 600，第四段到 600 → 一拍
  assert.equal(result.nodes.length, 1)
  assert.equal(result.counts.avgBeatChars, 600)
  assert.deepEqual(result.spans[0].entryIds, entries.map((entry) => entry.id))
})

test('规则 1：不跨章——validity.from 变了立刻收拍（章的边界是作者意图）', () => {
  const entries = [
    segmentEntry({ name: '一章段1', chars: 200, chapter: 1 }),
    segmentEntry({ name: '一章段2', chars: 200, chapter: 1 }),
    segmentEntry({ name: '二章段1', chars: 200, chapter: 2 }),
    segmentEntry({ name: '二章段2', chars: 200, chapter: 2 })
  ]
  const result = foldSegmentsToBeats(entries)
  assert.equal(result.nodes.length, 2, '两章各一拍，不跨章合并')
  assert.deepEqual(result.spans.map((span) => span.chapter), [1, 2])
  assert.equal(result.counts.chapters, 2)
})

test('规则 2：不跨视角——pov 变了立刻断（多视角混拍＝上帝视角）', () => {
  const entries = [
    segmentEntry({ name: '克莱恩段1', chars: 200, pov: '克莱恩' }),
    segmentEntry({ name: '克莱恩段2', chars: 200, pov: '克莱恩' }),
    segmentEntry({ name: '奥黛丽段1', chars: 200, pov: '奥黛丽' }),
    segmentEntry({ name: '奥黛丽段2', chars: 200, pov: '奥黛丽' })
  ]
  const result = foldSegmentsToBeats(entries)
  assert.equal(result.nodes.length, 2)
  assert.deepEqual(result.nodes.map((node) => node.pov), ['克莱恩', '奥黛丽'])
})

test('规则 4：段上钩子并进拍节点 openHooks，合并时去重不丢', () => {
  const entries = [
    segmentEntry({ name: '段1', chars: 200, hooks: ['钟楼的脚步声', '门口的陌生人'] }),
    segmentEntry({ name: '段2', chars: 200, hooks: ['钟楼的脚步声'] }),
    segmentEntry({ name: '段3', chars: 200, hooks: ['旧信'] })
  ]
  const result = foldSegmentsToBeats(entries)
  assert.equal(result.nodes.length, 1)
  assert.deepEqual(result.nodes[0].openHooks.sort(), ['门口的陌生人', '旧信', '钟楼的脚步声'].sort(), '三段的钩子都在，重复的只留一份')
})

test('规则 5：单条超长自成拍，不切不丢', () => {
  const entries = [
    segmentEntry({ name: '短段', chars: 120 }),
    segmentEntry({ name: '超长段', chars: 900 }),
    segmentEntry({ name: '尾段', chars: 120 })
  ]
  const result = foldSegmentsToBeats(entries)
  const sizes = result.nodes.map((node) => node.chars)
  assert.equal(result.nodes.length, 3, '超长段自己一拍，前后各自成拍')
  assert.deepEqual(sizes, [120, 900, 120])
  assert.ok(result.counts.maxBeatCharsActual === 900, '不切超长段')
})

test('悬置假设不混进拍序（没发生的事不能写成正文）', () => {
  const hypothesis = { ...segmentEntry({ name: '悬而未决' }), hypothesis: true, open: true }
  const entries = [segmentEntry({ name: '段1', chars: 200 }), hypothesis]
  const result = foldSegmentsToBeats(entries)
  assert.equal(result.counts.entries, 1, '只对齐 fact 轨')
  assert.equal(result.counts.skipped, 1, '假设条目如实计数为跳过')
  assert.ok(!result.nodes.some((node) => node.definition.includes('悬而未决')))
})

test('定义取段内事件（who：content 连接），段没有事件才退回 definition', () => {
  const withEvents = segmentEntry({
    name: '有事件',
    events: [
      { who: '柯秒', channel: 'do', content: '推开门' },
      { who: '奥黛丽', channel: 'say', content: '别进去' }
    ]
  })
  const noEvents = segmentEntry({ name: '无事件', definition: '只有一段描写。' })
  noEvents.events = []
  const result = foldSegmentsToBeats([withEvents, noEvents])
  assert.equal(result.nodes.length, 1)
  assert.match(result.nodes[0].definition, /柯秒：推开门；奥黛丽：别进去；只有一段描写。|柯秒：推开门；奥黛丽：别进去/)
})

test('覆盖完整性：一条段不丢、不重、不多', () => {
  const entries = [
    segmentEntry({ name: '段1', chars: 200 }),
    segmentEntry({ name: '段2', chars: 200 }),
    segmentEntry({ name: '段3', chars: 200 }),
    segmentEntry({ name: '段4', chars: 200, chapter: 2 })
  ]
  const result = foldSegmentsToBeats(entries)
  const check = verifyAlignment(entries, result)
  assert.equal(check.ok, true, JSON.stringify(check))
  assert.equal(check.counts.source, 4)
  assert.equal(check.counts.covered, 4)
  assert.deepEqual(check.missing, [])
  assert.deepEqual(check.duplicated, [])

  // 人为造缺漏：覆盖检查必须报出来，不能静默
  const broken = verifyAlignment(entries, { nodes: result.nodes, spans: result.spans.slice(0, 1) })
  assert.equal(broken.ok, false)
  assert.ok(broken.missing.length > 0)
})

test('真问题读数对比：段级直喂 vs 对齐后——同一章不被切成几章', () => {
  // 一章 12 段、每段 200 字：段级直喂＝12 拍；chapterize 上限 6 拍/章 → 切成 2 章。
  const entries = Array.from({ length: 12 }, (_, index) => segmentEntry({ name: `段${index + 1}`, chars: 200, chapter: 1 }))
  const naive = chapterize({ nodes: entries.map((entry, index) => ({ id: entry.id, order: index + 1, definition: entry.definition, domain: DOMAIN })) }, { maxBeatsPerChapter: DEFAULT_MAX_BEATS_PER_CHAPTER })
  assert.equal(naive.chapters.length, 2, '段级直喂确实把一章切开（这就是要对齐的理由）')

  const aligned = foldSegmentsToBeats(entries)
  assert.equal(aligned.nodes.length, 4, '2400 字按 600 字一拍＝4 拍')
  const grouped = chapterize({ nodes: aligned.nodes }, { maxBeatsPerChapter: DEFAULT_MAX_BEATS_PER_CHAPTER })
  assert.equal(grouped.chapters.length, 1, '对齐后同一章不再被切开')
  assert.equal(grouped.counts.beats, 4)
})

test('链式可串：抽取段 → 对齐 → chapterize 产出的章可以直接进渲染（拍上都带 definition）', () => {
  const entries = []
  for (let chapter = 1; chapter <= 2; chapter += 1) {
    for (let index = 0; index < 8; index += 1) {
      entries.push(segmentEntry({ name: `第${chapter}章段${index + 1}`, chars: 180, chapter, pov: chapter === 1 ? '柯秒' : '奥黛丽' }))
    }
  }
  const aligned = foldSegmentsToBeats(entries)
  const grouped = chapterize({ nodes: aligned.nodes }, { maxBeatsPerChapter: 6 })
  // 两章×1440 字，每章 3 拍（180×8/600≈2.4 → 3 拍），视角也换了 → 2 章
  assert.equal(grouped.chapters.length, 2, JSON.stringify(grouped.counts))
  assert.deepEqual(grouped.chapters.map((chapter) => chapter.pov), ['柯秒', '奥黛丽'])
  for (const chapter of grouped.chapters) {
    for (const beat of chapter.beats) {
      assert.ok(beat.definition.length > 0, '每拍都要有 definition，渲染器直接吃')
      assert.ok(beat.nodeId, '拍要能追回源节点')
    }
  }
})

test('与 M2 投影器同形：对齐产物可直接喂 projectOutline 的下游（chapterize）', () => {
  const entries = [segmentEntry({ name: '段1', chars: 300 }), segmentEntry({ name: '段2', chars: 300 })]
  const aligned = foldSegmentsToBeats(entries)
  const node = aligned.nodes[0]
  for (const key of ['id', 'title', 'definition', 'intent', 'summary', 'status', 'order', 'seq', 'domain']) {
    assert.ok(node[key] !== undefined, `节点缺字段 ${key}（chapterize 要用）`)
  }
  assert.ok(node.id.startsWith('beat-'), '拍 id 用 beat- 前缀，与投影器一致')
  // 幂等：同一批段重跑得到同一批 id（可重渲染的前提）
  const again = foldSegmentsToBeats(entries)
  assert.deepEqual(again.nodes.map((item) => item.id), aligned.nodes.map((item) => item.id))
})
