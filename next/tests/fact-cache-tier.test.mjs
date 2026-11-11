import test from 'node:test'
import assert from 'node:assert/strict'
import {
  workingLevel,
  planFlush,
  buildKnowledgeMap,
  retrieveWindow,
  retireEntries,
  normalizeFlushPolicy,
  DEFAULT_FLUSH_POLICY,
  CACHE_TIER_VERSION
} from '../fact/usecases/pipeline/cacheTier.js'

/**
 * P-TRIM Track 4 合同测试：缓存池分层存储（作者 2026-11-11 架构裁定）。
 *
 * 作者原话：RAG＝硬储存(SSD)、data＝快储存(DDR)；data 每存 N 条（3–5 章体量）触发一次 RAG 更新，
 * flush 时同时给 data 基于 rag 的知识映射、剪枝、清理后归档，然后开新的 data 继续闯。
 * 「最大程度规避注意力涣散」「及时清理掉上下文」「充分利用 rag」。
 *
 * 钉四件事：
 *   ① 水位按条数/字数/章跨度三条独立判定，谁先到谁触发；
 *   ② flush 计划确定性（保留谓词可注入），且默认保留最新一章接续；
 *   ③ 知识映射是 archive 的词法索引（名字/别名 → id），不依赖向量；
 *   ④ 检索窗口有硬上限（条数+字数双闸），绝不因为 archive 大就灌满 prompt。
 */

const DOMAIN = '停摆之城'

function entry(name, { chapter = 1, layer = 'character', chars = 100, aliases = [] } = {}) {
  return {
    id: `id-${name}-${chapter}`,
    layer,
    name,
    aliases,
    domain: DOMAIN,
    status: 'proposed',
    definition: '字'.repeat(layer === 'character' ? 0 : chars),
    identity: layer === 'character' ? '字'.repeat(chars) : undefined,
    validity: { from: chapter, to: chapter },
    provenance: { chapters: [chapter] }
  }
}

test('版本与默认水位（3–5 章体量对应 flushChapters=4）', () => {
  assert.equal(CACHE_TIER_VERSION, 'fact-cache-tier@1')
  assert.equal(DEFAULT_FLUSH_POLICY.flushChapters, 4)
  assert.equal(DEFAULT_FLUSH_POLICY.flushEntries, 120)
  assert.equal(DEFAULT_FLUSH_POLICY.retrieveLimit, 12)
})

test('水位三条独立判定：条数/字数/章跨度谁先到谁触发', () => {
  const byEntries = workingLevel(Array.from({ length: 5 }, (_, index) => entry(`甲${index}`)), { flushEntries: 5 })
  assert.equal(byEntries.shouldFlush, true)
  assert.match(byEntries.reason, /条数/u)

  const byChars = workingLevel([entry('乙', { chars: 3000 })], { flushChars: 2000 })
  assert.equal(byChars.shouldFlush, true)
  assert.match(byChars.reason, /字数/u)

  const byChapters = workingLevel([entry('丙', { chapter: 1 }), entry('丁', { chapter: 2 }), entry('戊', { chapter: 3 })], { flushChapters: 3 })
  assert.equal(byChapters.shouldFlush, true)
  assert.match(byChapters.reason, /章跨度/u)
  assert.deepEqual(byChapters.chapters, [1, 2, 3])

  const calm = workingLevel([entry('己')], DEFAULT_FLUSH_POLICY)
  assert.equal(calm.shouldFlush, false)
  assert.equal(calm.reason, null)
})

test('flush 计划：默认保留最新一章接续，其余下沉；未到水位时不动', () => {
  const working = [entry('甲', { chapter: 1 }), entry('乙', { chapter: 2 }), entry('丙', { chapter: 3 })]
  const below = planFlush({ working, policy: { flushChapters: 9 } })
  assert.deepEqual(below.move, [])
  assert.equal(below.stay.length, 3)
  assert.equal(below.reason, null)

  const plan = planFlush({ working, policy: { flushChapters: 3 } })
  assert.equal(plan.move.length, 2, '第 1、2 章下沉')
  assert.equal(plan.stay.length, 1, '第 3 章留作接续')
  assert.equal(plan.stay[0].validity.from, 3)
  assert.match(plan.reason, /章跨度/u)
})

test('flush 计划：keep 谓词可注入（被推演引用的条目留热窗）', () => {
  const working = [entry('甲', { chapter: 1 }), entry('乙', { chapter: 2 }), entry('丙', { chapter: 3 })]
  const plan = planFlush({
    working,
    policy: { flushChapters: 3 },
    keep: (item) => item.name === '甲' // 甲被当前推演引用
  })
  assert.deepEqual(plan.stay.map((item) => item.name), ['甲'])
  assert.deepEqual(plan.move.map((item) => item.name), ['乙', '丙'])
})

test('keepReferenced=false 时全量下沉（working 彻底换新）', () => {
  const plan = planFlush({ working: [entry('甲', { chapter: 1 }), entry('乙', { chapter: 2 })], policy: { flushChapters: 2, keepReferenced: false } })
  assert.equal(plan.move.length, 2)
  assert.equal(plan.stay.length, 0)
})

test('知识映射：名字/别名 → id，是 archive 的词法索引（不依赖向量）', () => {
  const map = buildKnowledgeMap([
    entry('克莱恩', { aliases: ['周明瑞', '愚者'] }),
    entry('奥黛丽', { aliases: ['正义'] })
  ])
  assert.equal(map.size, 2)
  assert.equal(map.byName.get('克莱恩'), 'id-克莱恩-1')
  assert.deepEqual(map.byAlias.get('周明瑞'), ['id-克莱恩-1'])
  assert.deepEqual(map.byAlias.get('正义'), ['id-奥黛丽-1'])
})

test('检索窗口：字面命中优先，条数/字数双闸——archive 再大也不灌满', () => {
  const archive = [
    entry('克莱恩', { aliases: ['周明瑞'] }),
    entry('奥黛丽'),
    entry('无关甲'),
    entry('无关乙')
  ]
  const hit = retrieveWindow({ entries: archive, query: '克莱恩在钟楼听见脚步' })
  assert.equal(hit.hits.length, 1)
  assert.equal(hit.hits[0].name, '克莱恩')
  assert.match(hit.note, /字面命中/u)

  const byName = retrieveWindow({ entries: archive, query: '', names: ['周明瑞'] })
  assert.equal(byName.hits.length, 1)
  assert.equal(byName.hits[0].name, '克莱恩')

  const none = retrieveWindow({ entries: archive, query: '完全不相干的话' })
  assert.equal(none.hits.length, 0)
  assert.match(none.note, /无字面命中/u)

  // 条数闸
  const limited = retrieveWindow({ entries: Array.from({ length: 20 }, (_, i) => entry(`命中${i}`, { chars: 10 })), query: '命中', policy: { retrieveLimit: 3 } })
  assert.equal(limited.hits.length, 3)
  assert.ok(limited.dropped > 0)

  // 字数闸（单条太大直接跳过，宁缺不灌）
  const tooBig = retrieveWindow({ entries: [entry('巨型', { chars: 50_000 })], query: '巨型', policy: { retrieveChars: 1000 } })
  assert.equal(tooBig.hits.length, 0)
  assert.match(tooBig.note, /超出检索预算/u)
})

test('归档：剪枝/重复/失效条目只留指纹（不占上下文也不占 archive）', () => {
  const retired = retireEntries([entry('经理', { chars: 5 })], 'pruned')
  assert.equal(retired.length, 1)
  assert.equal(retired[0].name, '经理')
  assert.equal(retired[0].reason, 'pruned')
  assert.equal(retired[0].identity, undefined, '正文不带出')
  assert.equal(retired[0].archivedAt, null, '时间戳由调用方填（域内不取系统时钟）')
})

test('阈值全可配：normalizeFlushPolicy 逐项覆盖，非法值回落默认', () => {
  const custom = normalizeFlushPolicy({ flushChapters: 2, retrieveLimit: 5, flushEntries: 0 })
  assert.equal(custom.flushChapters, 2)
  assert.equal(custom.retrieveLimit, 5)
  assert.equal(custom.flushEntries, DEFAULT_FLUSH_POLICY.flushEntries, '0 非法→回落默认')
  const fallback = normalizeFlushPolicy(null)
  assert.deepEqual(fallback, { ...DEFAULT_FLUSH_POLICY })
})
