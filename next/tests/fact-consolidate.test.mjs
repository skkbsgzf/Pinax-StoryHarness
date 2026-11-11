import test from 'node:test'
import assert from 'node:assert/strict'
import { matchExisting, consolidateEntries, consolidatePair, CONSOLIDATE_VERSION } from '../fact/usecases/pipeline/consolidate.js'
import { FACT_SCHEMA } from '../fact/domain/vocabulary.js'
import { stableEntryId } from '../fact/domain/stableId.js'

/**
 * P-TRIM T-1.5 合同测试：确定性折叠（IG 巩固的纯函数核心，ADR §4.3）。
 *
 * 钉住 fold 语义的每一条：
 *   - existing 赢身份（id/name/slot/status 不动，adopted 永不降级）；
 *   - 增量不拼接（unique/joined，同一句话不滚三次——v1 knowledge.py 的拼接教训）；
 *   - 冲突不静默（constraint 同 key 异值保先到值＋告警；castRole 跨 tier 保 castRoles）；
 *   - 三级匹配：id → L0 别名 → L1 词法包含（唯一才并，歧义记账不猜）；plot 永不 L0/L1；
 *   - 出处并集：sources 按 segmentId 去重、chapters 并集排序、validity 取跨度、fingerprint 重算；
 *   - 确定性：同一输入两次折叠逐字节一致。
 */

const DOMAIN = '停摆之城'

function character(name, overrides = {}) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name }),
    layer: 'character', name, domain: DOMAIN, status: 'adopted',
    identity: `${name}的档案。`,
    aliases: [], traits: [], anchors: { speech: [], behavior: [] },
    provenance: { mode: 'analyze', book: DOMAIN, book_id: 'abcd1234', chapters: [1], scenes: [], extractor: 'fact-chain/v1', quote_hash: 'a'.repeat(40) },
    fingerprint: { vec: null, metrics: { sources: 1, chars: 100 } },
    sources: [{ sourceId: '正文/001-第一章.md', segmentId: 's001:1:aaaa1111', quote_hash: 'a'.repeat(40) }],
    ...overrides
  }
}

function worldview(name, slot, overrides = {}) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain: DOMAIN, slot, name }),
    layer: 'worldview', name, domain: DOMAIN, slot, status: 'proposed',
    definition: `${name}的设定。`,
    aliases: [],
    provenance: { mode: 'analyze', book: DOMAIN, book_id: 'abcd1234', chapters: [1], scenes: [], extractor: 'fact-chain/v1', quote_hash: 'b'.repeat(40) },
    fingerprint: { vec: null, metrics: { sources: 1, chars: 80 } },
    sources: [{ sourceId: '正文/001-第一章.md', segmentId: 's001:1:aaaa1111', quote_hash: 'b'.repeat(40) }],
    ...overrides
  }
}

const CHARS = new Map([['s001:1:aaaa1111', 100], ['s002:1:bbbb2222', 120]])

test('版本常量', () => {
  assert.equal(CONSOLIDATE_VERSION, 'fact-consolidate@1')
})

test('三级匹配：id → L0 别名 → L1 词法；plot 永不 L0/L1', () => {
  const existing = [
    character('克莱恩', { aliases: ['周明瑞'] }),
    worldview('旧钟楼', 'locations')
  ]
  // id 匹配：同名同层
  assert.equal(matchExisting(character('克莱恩'), existing).matchedBy, 'id')
  // L0 别名：incoming.name 是 existing 的别名
  assert.equal(matchExisting(character('周明瑞'), existing).matchedBy, 'L0-alias')
  assert.equal(matchExisting(character('周明瑞'), existing).target.name, '克莱恩')
  // L1 词法：包含关系且唯一（非 plot）
  const hit = matchExisting(worldview('钟楼', 'locations'), existing)
  assert.equal(hit.matchedBy, 'L1-lexical')
  assert.equal(hit.target.name, '旧钟楼')
  // plot 未命中 id 就是不命中（plot id 由段哈希决定）；名字若与 existing 相同走的是 L0（别名组含名字）
  const plot = { schema: FACT_SCHEMA, id: 'p1', layer: 'plot', name: '第2章·段3', domain: DOMAIN, status: 'draft', provenance: { chapters: [2] } }
  assert.equal(matchExisting(plot, existing).target, null)
  // 名字与 existing 相同但 id 不同（外来 id）→ L0 命中（别名组含名字本身）
  const plotLike = { ...plot, id: 'p2', layer: 'character', name: '钟楼守卫' }
  const guard = matchExisting(plotLike, [...existing, character('钟楼守卫')])
  assert.equal(guard.matchedBy, 'L0-alias', '同名同层外来 id 走 L0（aliasIndex 含名字）')
})

test('L1 歧义不合并：多候选如实记账（不猜）', () => {
  const existing = [worldview('钟楼东', 'locations'), worldview('钟楼西', 'locations')]
  const match = matchExisting(worldview('钟楼', 'locations'), existing)
  assert.equal(match.target, null)
  assert.equal(match.ambiguous.length, 2)
  const result = consolidateEntries(existing, [worldview('钟楼', 'locations')])
  assert.equal(result.stats.ambiguous, 1)
  assert.ok(result.warnings.some((warning) => warning.code === 'L1_AMBIGUOUS'))
  assert.equal(result.entries.length, 3, '歧义时 incoming 照样新增，不猜归属')
})

test('fold：character 跨 run 合并——aliases/anchors/knowledge 并集去重，身份字段 existing 赢', () => {
  const existing = character('克莱恩', {
    aliases: ['周明瑞'],
    identity: '穿越者。',
    traits: ['冷静'],
    anchors: { speech: ['「一个尝试。」'], behavior: ['收起信件'] },
    knowledge: [{ fromEntry: '赫密斯文笔记', kind: 'event', atSpan: { from: 1, to: 1 }, note: '认出文字' }]
  })
  const incoming = character('克莱恩', {
    status: 'proposed', // incoming 拟议，existing 已 adopted——身份与状态 existing 赢
    identity: '穿越者。值夜者候选。',
    traits: ['冷静', '惜命'],
    anchors: { speech: ['「一个尝试。」', '欢迎仪式。'], behavior: ['收起信件', '推断未真醒'] },
    knowledge: [
      { fromEntry: '赫密斯文笔记', kind: 'event', atSpan: { from: 1, to: 1 }, note: '认出文字' }, // 重复
      { fromEntry: '值夜者', kind: 'event', atSpan: { from: 2, to: 2 }, note: '听闻组织名' }
    ],
    sources: [{ sourceId: '正文/002-第二章.md', segmentId: 's002:1:bbbb2222', quote_hash: 'b'.repeat(40) }],
    provenance: { mode: 'analyze', book: DOMAIN, book_id: 'abcd1234', chapters: [2], scenes: [], extractor: 'fact-chain/v1', quote_hash: 'b'.repeat(40) },
    fingerprint: { vec: null, metrics: { sources: 1, chars: 120 } }
  })
  const { entries, stats, warnings } = consolidateEntries([existing], [incoming], { segmentChars: CHARS })
  assert.equal(entries.length, 1, '命中即合并，不新增')
  const merged = entries[0]
  assert.equal(merged.id, existing.id)
  assert.equal(merged.status, 'adopted', 'existing 已 adopted 永不降级')
  assert.deepEqual(merged.aliases, ['周明瑞'])
  assert.equal(merged.identity, '穿越者。值夜者候选。', '超集行吸收子串行（逐字重复与被覆盖旧句不滚存）')
  assert.deepEqual(merged.traits, ['冷静', '惜命'])
  assert.deepEqual(merged.anchors.speech, ['「一个尝试。」', '欢迎仪式。'])
  assert.deepEqual(merged.anchors.behavior, ['收起信件', '推断未真醒'])
  assert.equal(merged.knowledge.length, 2, 'knowledge 去重：重复的 fromEntry+note 不滚第二次')
  assert.equal(merged.provenance.chapters.join(','), '1,2', 'chapters 并集排序')
  assert.equal(merged.sources.length, 2, 'sources 按 segmentId 并集')
  assert.equal(merged.fingerprint.metrics.sources, 2)
  assert.equal(merged.fingerprint.metrics.chars, 220, 'chars 逐段求和（100+120）')
  assert.equal(stats.matched.id, 1)
  assert.equal(stats.changed, 1)
  assert.equal(warnings.filter((warning) => warning.code === 'CAST_ROLE_CONFLICT_FOLDED').length, 0)
})

test('fold：X3 跨名——incoming 名（周明瑞）经 L0 折进 existing（克莱恩），incoming 名并进别名', () => {
  // run1 的 compile 已把 alsoKnownAsInSource 落进 aliases（X3），跨 run 的 L0 靠这份别名组
  const existing = character('克莱恩', { aliases: ['周明瑞'] })
  const incoming = character('周明瑞', { identity: '原身身份的档案。' })
  const { entries, assignments } = consolidateEntries([existing], [incoming])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].name, '克莱恩', 'existing 赢名字')
  assert.ok(entries[0].aliases.includes('周明瑞'), 'incoming 名让位为别名')
  assert.equal(assignments[0].incomingId, incoming.id)
  assert.equal(assignments[0].targetId, existing.id)
  assert.equal(assignments[0].matchedBy, 'L0-alias')
  // L1 变体：existing 名是超串（克莱恩·莫雷蒂 ⊃ 克莱恩）
  const long = character('克莱恩·莫雷蒂', { aliases: [] })
  const r2 = consolidateEntries([long], [character('克莱恩')])
  assert.equal(r2.entries.length, 1)
  assert.equal(r2.entries[0].name, '克莱恩·莫雷蒂')
  assert.equal(r2.stats.matched['L1-lexical'], 1)
  assert.ok(r2.warnings.some((warning) => warning.code === 'L1_LEXICAL_MERGE'))
})

test('fold：worldview definitions 多版走 DEFINITION_VARIANTS；constraint 同 key 异值保先到值＋告警', () => {
  const existing = worldview('钟楼', 'locations', {
    definition: '午夜后禁止进入的建筑。',
    constraint: [{ key: '禁入时段', value: '午夜后', scope: 'entry' }]
  })
  const incoming = worldview('钟楼', 'locations', {
    definition: '凌晨一点后禁止进入。',
    constraint: [{ key: '禁入时段', value: '凌晨一点后', scope: 'entry' }]
  })
  const { entries, warnings } = consolidateEntries([existing], [incoming], { segmentChars: CHARS })
  const merged = entries[0]
  assert.deepEqual(merged.definitions, ['午夜后禁止进入的建筑。', '凌晨一点后禁止进入。'])
  assert.match(merged.definition, /午夜后/)
  assert.match(merged.definition, /凌晨一点后/)
  assert.ok(warnings.some((warning) => warning.code === 'DEFINITION_VARIANTS'))
  assert.ok(warnings.some((warning) => warning.code === 'CONSTRAINT_VALUE_CONFLICT_FOLDED'))
  assert.deepEqual(merged.constraint, [{ key: '禁入时段', value: '午夜后', scope: 'entry' }], '同 key 保先到值')
})

test('fold：castRole 跨 tier 保 castRoles；同 tier 合并目标', () => {
  const existing = character('克莱恩', { castRole: { tier: 'supporting', goal: '活下来', plotFunction: '视角' } })
  const incomingMinor = character('克莱恩', { castRole: { tier: 'minor', goal: '背景', plotFunction: '路人' } })
  const cross = consolidateEntries([existing], [incomingMinor])
  assert.ok(cross.entries[0].castRoles.length === 2)
  assert.ok(cross.warnings.some((warning) => warning.code === 'CAST_ROLE_CONFLICT_FOLDED'))
  assert.equal(cross.entries[0].castRole, undefined)

  const sameTier = consolidateEntries(
    [character('克莱恩', { castRole: { tier: 'protagonist', goal: '活下来', plotFunction: '视角' } })],
    [character('克莱恩', { castRole: { tier: 'protagonist', goal: '查明真相', plotFunction: '主驱动' } })]
  )
  assert.equal(sameTier.entries[0].castRole.goal, '活下来\n查明真相')
  assert.equal(sameTier.entries[0].castRole.tier, 'protagonist')
})

test('fold：plot 同 id 幂等（同段同哈希）；不同段是新条目', () => {
  const plot = {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain: DOMAIN, slot: '', name: '第1章·段1' }),
    layer: 'plot', name: '第1章·段1', domain: DOMAIN, status: 'draft',
    fact: '事件A。', events: [{ index: 1, track: 'fact', title: '事件A。', refs: ['柯秒'], segments: [{ index: 1, chars: 100 }], novelty: [] }],
    who: ['柯秒'], when: { story_time: '夜', timeline: '顺叙' }, where: '旧钟楼', notes: '',
    validity: { from: 1, to: 1 },
    provenance: { mode: 'analyze', book: DOMAIN, book_id: 'abcd', chapters: [1], scenes: [], extractor: 'fact-chain/v1', quote_hash: 'c'.repeat(40), segmentIndex: 1 },
    fingerprint: { vec: null, metrics: { sources: 1, chars: 100 } },
    sources: [{ sourceId: '正文/001-第一章.md', segmentId: 's001:1:aaaa1111', quote_hash: 'c'.repeat(40) }]
  }
  const same = consolidateEntries([plot], [{ ...plot }], { segmentChars: CHARS })
  assert.equal(same.entries.length, 1)
  assert.equal(same.stats.unchanged, 1, '同段重抽幂等')
  const other = { ...plot, id: stableEntryId({ layer: 'plot', domain: DOMAIN, slot: '', name: '第1章·段2' }), name: '第1章·段2', validity: { from: 1, to: 1 } }
  const added = consolidateEntries([plot], [other])
  assert.equal(added.entries.length, 2)
  assert.equal(added.stats.added, 1, '不同段＝新拍')
})

test('fold：未命中的 existing 原样保留（移除是调用方的范围决定，模块不越权）', () => {
  const keep = character('克莱恩')
  const orphan = character('无关人')
  const result = consolidateEntries([keep, orphan], [character('克莱恩', { status: 'proposed' })])
  assert.equal(result.entries.length, 2, 'orphan 透传')
  assert.equal(result.unassigned.length, 1, '未命中的 existing 如实报 unassigned')
  assert.deepEqual(result.unassigned.map((entry) => entry.id), [orphan.id])
})

test('确定性：同一输入两次折叠逐字节一致', () => {
  const existing = [character('克莱恩', { aliases: ['周明瑞'] })]
  const incoming = [character('克莱恩', { identity: 'x' }), character('周明瑞', { identity: 'y' })]
  const a = consolidateEntries(existing, incoming, { segmentChars: CHARS })
  const b = consolidateEntries(existing, incoming, { segmentChars: CHARS })
  assert.equal(JSON.stringify(a.entries), JSON.stringify(b.entries))
  assert.equal(JSON.stringify(a.stats), JSON.stringify(b.stats))
})

test('空 existing：全部新增（首跑＝compile 产物直通）', () => {
  const incoming = [character('克莱恩'), worldview('旧钟楼', 'locations')]
  const result = consolidateEntries([], incoming)
  assert.equal(result.entries.length, 2)
  assert.equal(result.stats.added, 2)
})

test('consolidatePair：relations 无向去重（from/to 互换算同一条）', () => {
  const existing = character('克莱恩', { relations: [{ to: '奥黛丽', type: '同盟', how: 'a' }] })
  const incoming = character('克莱恩', { relations: [{ to: '奥黛丽', type: '同盟', how: 'b' }] })
  const merged = consolidatePair(existing, incoming, [])
  assert.equal(merged.relations.length, 1, '无向同 key 去重')
  assert.equal(merged.relations[0].how, 'a', '先到值保留')
})
