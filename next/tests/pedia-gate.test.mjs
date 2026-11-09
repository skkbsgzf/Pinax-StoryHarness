import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORY_MAP,
  OTHER_SLOT,
  PEDIA_SCHEMA,
  WORLDVIEW_SLOTS,
  slotForCategory,
  stableEntryId
} from '../pedia/domain/pediaSchema.js'
import { createAliasIndex } from '../pedia/domain/aliases.js'
import { segmentText } from '../pedia/domain/segment.js'
import {
  buildRoundTripReport,
  checkCharacterAnchors,
  checkKnowledge,
  checkTimeline,
  checkWorldRules,
  runPediaGate
} from '../pedia/usecases/gate.js'
import { extractRefs } from '../pedia/usecases/precheck.js'
import { extractChapter } from '../pedia/usecases/pipeline/extract.js'
import { mineCharacters } from '../pedia/usecases/pipeline/mine.js'
import { hubToNovelRefs, hubToWorldbook, worldbookToHub } from '../wikihub/convert.mjs'

/**
 * P5 作品化质量门禁合同测试（零网络、零宿主写盘）：
 *   1) 四类确定性断言：角色言行锚点 / 世界规则结构化约束 / 双时间轴全库扫描 / 知情一致性；
 *   2) 「可判定 vs 不可判定」分列：没有结构化约束的规则必须进 undecidable，不猜；
 *   3) round-trip 保真：原文→分段→抽取→hub 条目→convert 反向导出→语义要素比对，损失记账；
 *   4) 归一化回归：克莱恩＝周明瑞别名合并；category_map 全表（34 类归并＋同义，48 键）逐条断言。
 *
 * 门禁本体只读：所有断言只产清单，不改条目、不写 store。
 */

const DOMAIN = '停摆之城'

function worldviewEntry(overrides = {}) {
  const name = overrides.name ?? '旧钟楼'
  const domain = overrides.domain ?? DOMAIN
  const slot = overrides.slot ?? 'locations'
  return {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain, slot, name }),
    layer: 'worldview',
    name,
    domain,
    slot,
    status: 'draft',
    definition: '城南的钟楼。',
    provenance: { mode: 'author', book: domain, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    ...overrides
  }
}

function characterEntry(overrides = {}) {
  const name = overrides.name ?? '柯秒'
  const domain = overrides.domain ?? DOMAIN
  return {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'character', domain, slot: '', name }),
    layer: 'character',
    name,
    domain,
    status: 'draft',
    provenance: { mode: 'author', book: domain, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} },
    ...overrides
  }
}

function plotEntry(overrides = {}) {
  const name = overrides.name ?? '停摆'
  const domain = overrides.domain ?? DOMAIN
  return {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain, slot: '', name }),
    layer: 'plot',
    name,
    domain,
    status: 'draft',
    provenance: { mode: 'author', book: domain, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} },
    ...overrides
  }
}

test('U2 角色言行：锚点重复／通道冲突／口头禅未落地／被引用无锚点／主角全空（warning 可判定）', () => {
  const kemiao = characterEntry({
    name: '柯秒',
    anchors: {
      speech: ['钟又响了。', '钟又响了。'],
      behavior: ['钟又响了。', '推开钟楼的门'],
      catchphrase: ['别上去。']
    },
    castRole: { tier: 'supporting', goal: '追查钟声', plotFunction: '推动主线' }
  })
  const keeper = characterEntry({
    name: '守夜人',
    anchors: { speech: [], behavior: [], catchphrase: [] },
    castRole: { tier: 'supporting', goal: '守夜', plotFunction: '旁观' }
  })
  const lead = characterEntry({
    name: '程实',
    anchors: { speech: [], behavior: [] },
    castRole: { tier: 'protagonist', goal: '找钟声', plotFunction: '主线' }
  })
  const plot = plotEntry({
    name: '章纲',
    validity: { from: 1, to: 3 },
    events: [{ index: 1, track: 'fact', title: '钟声', refs: ['柯秒', '守夜人', '程实'] }]
  })

  const assertions = checkCharacterAnchors([kemiao, keeper, lead, plot])
  const rules = assertions.map((item) => item.rule)

  assert.equal(assertions.filter((item) => item.rule === 'ANCHOR_DUPLICATE').length, 1)
  assert.equal(assertions.filter((item) => item.rule === 'ANCHOR_CHANNEL_CONFLICT').length, 1)
  assert.equal(assertions.filter((item) => item.rule === 'CATCHPHRASE_UNANCHORED').length, 1)
  assert.ok(rules.includes('CHARACTER_REFERENCED_WITHOUT_ANCHORS'))
  assert.ok(rules.includes('PROTAGONIST_WITHOUT_ANCHORS'))
  assert.ok(assertions.every((item) => item.decidable === true && item.severity === 'warning'))

  const referenced = assertions.filter((item) => item.rule === 'CHARACTER_REFERENCED_WITHOUT_ANCHORS')
  assert.deepEqual(referenced.map((item) => item.entryId).sort(), [keeper.id, lead.id].sort())
  assert.equal(assertions.find((item) => item.rule === 'PROTAGONIST_WITHOUT_ANCHORS').entryId, lead.id)
  assert.equal(assertions.find((item) => item.rule === 'CATCHPHRASE_UNANCHORED').details.character, '柯秒')
})

test('世界规则：结构化约束同 key 不同值 → error；自由文本进 undecidable，不拿文本猜冲突', () => {
  const ruleA = worldviewEntry({
    name: '钟表法则',
    slot: 'rules',
    validity: { from: 1, to: 5 },
    constraint: { key: 'memory', value: 'stopped' }
  })
  const ruleB = worldviewEntry({
    name: '记忆恢复',
    slot: 'rules',
    validity: { from: 3, to: 9 },
    constraint: { key: 'memory', value: 'running' }
  })
  const eventC = worldviewEntry({
    name: '钟声事件',
    slot: 'events',
    validity: { from: 2, to: 4 },
    constraint: { key: 'memory', value: 'running' }
  })
  const ruleD = worldviewEntry({
    name: '城中无夜',
    slot: 'rules',
    validity: { from: 6, to: 9 },
    constraint: { key: 'memory', value: 'running' }
  })
  const freeText = worldviewEntry({ name: '无人能离开钟楼', slot: 'rules' })

  const { assertions, undecidable } = checkWorldRules([ruleA, ruleB, eventC, ruleD, freeText])

  const ruleConflicts = assertions.filter((item) => item.rule === 'RULE_RULE_CONFLICT')
  assert.equal(ruleConflicts.length, 1, 'A(1..5) 与 B(3..9) 重叠且取值不同')
  assert.equal(ruleConflicts[0].severity, 'error')
  assert.deepEqual(ruleConflicts[0].details.overlap, { from: 3, to: 5 })

  const eventConflicts = assertions.filter((item) => item.rule === 'RULE_EVENT_CONFLICT')
  assert.equal(eventConflicts.length, 1, '事件 C(2..4) 与规则 A 重叠且取值不同')
  assert.equal(eventConflicts[0].severity, 'error')

  assert.equal(assertions.filter((item) => item.rule === 'EVENT_CONSTRAINT_CONFLICT').length, 0, '同值不算冲突')
  assert.equal(assertions.filter((item) => item.rule === 'RULE_RULE_CONFLICT' && item.details.right.name === '城中无夜').length, 0, '不相交时段不冲突')

  assert.equal(undecidable.length, 1)
  assert.equal(undecidable[0].entryId, freeText.id)
  assert.equal(undecidable[0].reason, 'NO_STRUCTURED_CONSTRAINT')
  assert.equal(undecidable[0].decidable, false)
})

test('世界规则：同别名词被两条规则声明 → RULE_TERM_CONFLICT（并组但仍留痕）', () => {
  const first = worldviewEntry({ name: '停摆律', slot: 'rules' })
  const second = worldviewEntry({ name: '钟摆律', slot: 'rules', aliases: ['停摆律'] })
  const { assertions } = checkWorldRules([first, second])
  const term = assertions.find((item) => item.rule === 'RULE_TERM_CONFLICT')
  assert.ok(term)
  assert.equal(term.details.term, '停摆律')
  assert.equal(term.severity, 'warning')
  assert.deepEqual(term.details.claimants.sort(), ['停摆律', '钟摆律'].sort())
})

test('时间轴全库扫描：区间倒置／事件序号重复／结构事件越界／同域结构 plot 相撞', () => {
  const inverted = worldviewEntry({ name: '倒置条目', validity: { from: 5, to: 2 } })
  const character = characterEntry({
    name: '柯秒',
    knowledge: [{ fromEntry: '钟声事件', kind: 'event', atSpan: { from: 9, to: 3 } }]
  })
  const plot = plotEntry({
    name: '章纲',
    validity: { from: 1, to: 3 },
    next: { structure: 'outline' },
    events: [
      { index: 2, track: 'fact', title: '甲', refs: [], anchor: { kind: 'novel-chapter' } },
      { index: 2, track: 'hypothesis', title: '乙', refs: [], anchor: { kind: 'novel-chapter' } },
      { index: 5, track: 'fact', title: '丙', refs: [], anchor: { kind: 'novel-chapter' } }
    ]
  })
  const plotB = plotEntry({
    name: '章纲B',
    validity: { from: 2, to: 4 },
    next: { structure: 'outline' },
    events: [{ index: 2, track: 'fact', title: '丁', refs: [], anchor: { kind: 'novel-chapter' } }]
  })

  const assertions = checkTimeline([inverted, character, plot, plotB])

  const invertedItems = assertions.filter((item) => item.rule === 'VALIDITY_RANGE_INVERTED')
  assert.equal(invertedItems.length, 1)
  assert.equal(invertedItems[0].entryId, inverted.id)
  assert.equal(invertedItems[0].severity, 'error')

  assert.equal(assertions.filter((item) => item.rule === 'KNOWLEDGE_RANGE_INVERTED').length, 1)

  const duplicates = assertions.filter((item) => item.rule === 'EVENT_INDEX_DUPLICATE')
  assert.equal(duplicates.length, 1)
  assert.equal(duplicates[0].details.index, 2)

  const outside = assertions.filter((item) => item.rule === 'EVENT_OUTSIDE_PLOT_VALIDITY')
  assert.equal(outside.length, 1)
  assert.equal(outside[0].details.index, 5)

  const collision = assertions.filter((item) => item.rule === 'PLOT_EVENT_INDEX_COLLISION')
  assert.equal(collision.length, 1)
  assert.deepEqual(collision[0].details.indices, [2])
  assert.equal(collision[0].severity, 'warning')
})

test('知情一致性：来源未解析／知情早于来源／重复记录 + 逐事件 precheck 的引用校验', () => {
  const source = worldviewEntry({ name: '钟声事件', slot: 'events', validity: { from: 3, to: 3 } })
  const rule = worldviewEntry({ name: '钟表法则', slot: 'rules', validity: { from: 1, to: 2 } })
  const character = characterEntry({
    name: '柯秒',
    knowledge: [
      { fromEntry: '钟声事件', kind: 'event', atSpan: { from: 1, to: null } },
      { fromEntry: '钟声事件', kind: 'event', atSpan: { from: 1, to: null } },
      { fromEntry: '不存在的事', kind: 'event', atSpan: { from: 2, to: 2 } }
    ]
  })
  const plot = plotEntry({
    name: '章纲',
    validity: { from: 1, to: 3 },
    events: [{ index: 3, track: 'fact', title: '钟声', refs: ['钟表法则', '没登记的设定'] }]
  })

  const assertions = checkKnowledge([source, rule, character, plot])

  const predates = assertions.filter((item) => item.rule === 'KNOWLEDGE_PREDATES_SOURCE')
  assert.equal(predates.length, 2, '两条相同知情记录都早于来源')
  assert.equal(predates[0].severity, 'error')
  assert.deepEqual([predates[0].details.knownFrom, predates[0].details.sourceFrom], [1, 3])

  assert.equal(assertions.filter((item) => item.rule === 'KNOWLEDGE_DUPLICATE').length, 1)
  assert.equal(assertions.filter((item) => item.rule === 'KNOWLEDGE_FROM_UNRESOLVED').length, 1)

  const unresolved = assertions.find((item) => item.rule === 'REFERENCE_UNRESOLVED')
  assert.ok(unresolved)
  assert.match(unresolved.message, /没登记的设定/u)

  const outside = assertions.find((item) => item.rule === 'REFERENCE_OUTSIDE_VALIDITY')
  assert.ok(outside)
  assert.equal(outside.severity, 'error')
  assert.equal(outside.details.eventIndex, 3)
  assert.equal(outside.details.ref, '钟表法则')
})

test('汇总出口：conflicts 只收可判定 error，undecidable 单列，空集与脏输入如实记账', () => {
  const ruleA = worldviewEntry({ name: '钟表法则', slot: 'rules', constraint: { key: 'memory', value: 'stopped' } })
  const ruleB = worldviewEntry({ name: '记忆恢复', slot: 'rules', constraint: { key: 'memory', value: 'running' } })
  const freeText = worldviewEntry({ name: '无人能离开钟楼', slot: 'rules' })

  const gate = runPediaGate([ruleA, ruleB, freeText, null, 'not-an-entry'])
  assert.equal(gate.ok, false)
  assert.equal(gate.version, 'pedia-gate/v1')
  assert.ok(gate.conflicts.some((item) => item.rule === 'RULE_RULE_CONFLICT'))
  assert.ok(gate.conflicts.every((item) => item.severity === 'error' && item.decidable === true))
  assert.equal(gate.assertions.length, gate.conflicts.length + gate.counts.warnings)
  assert.equal(gate.undecidable.length, 1)
  assert.equal(gate.undecidable[0].entryId, freeText.id)
  assert.ok(gate.warnings.some((item) => item.code === 'ENTRY_DROPPED'))
  assert.equal(gate.counts.entries, 3)
  assert.equal(gate.roundTrip.skipped, true, '未注入端口时如实跳过，不假装测过')
  assert.match(gate.roundTrip.reason, /roundTrip/u)
  assert.deepEqual(gate.normalization.alias.conflicts, [])

  const empty = runPediaGate([])
  assert.equal(empty.ok, true)
  assert.ok(empty.warnings.some((item) => item.code === 'EMPTY_ENTRY_SET'))
})

test('归一化基线（克莱恩＝周明瑞）：同条目别名并组；跨条目同词声明并组但冲突留痕', () => {
  const klein = characterEntry({ name: '克莱恩', aliases: ['周明瑞'] })

  const single = runPediaGate([klein])
  assert.equal(single.normalization.ok, true)
  assert.equal(single.normalization.alias.mergedGroups, 1)
  const group = single.normalization.alias.groups.find((item) => item.canonical === '克莱恩')
  assert.ok(group)
  assert.deepEqual(group.aliases, ['周明瑞'])
  assert.equal(createAliasIndex([klein]).resolve('周明瑞'), '克莱恩')

  const fool = characterEntry({ name: '愚者', aliases: ['克莱恩'] })
  const conflicted = runPediaGate([klein, fool])
  assert.equal(conflicted.normalization.ok, false)
  const conflict = conflicted.normalization.alias.conflicts.find((item) => item.term === '克莱恩')
  assert.ok(conflict, '同名被两类条目声明时必须报出来')
  assert.deepEqual(conflict.claimants.sort(), ['愚者', '克莱恩'].sort())
  assert.equal(conflicted.normalization.alias.mergedGroups, 1, '并组仍发生，但冲突留痕（不静默）')
})

test('归一化回归：category_map 全表逐条断言（34 类归并＋同义，48 键）', () => {
  const expected = {
    力量体系: 'power_levels',
    等级: 'power_levels',
    境界: 'power_levels',
    技能: 'abilities',
    法术: 'abilities',
    仪式: 'abilities',
    能力: 'abilities',
    行为体系: 'abilities',
    规则: 'rules',
    试炼: 'rules',
    特殊试炼: 'rules',
    特殊试练: 'rules',
    评分体系: 'rules',
    游戏系统: 'rules',
    策略: 'rules',
    地点: 'locations',
    场所: 'locations',
    物品: 'items',
    道具: 'items',
    装备: 'items',
    材料: 'items',
    物品来源: 'items',
    组织: 'orgs',
    势力: 'orgs',
    角色: 'roles',
    职业: 'roles',
    人物: 'roles',
    人物群体: 'roles',
    角色类型: 'roles',
    历史人物: 'roles',
    人际关系: 'roles',
    专业: 'roles',
    生物: 'creatures',
    种族: 'creatures',
    怪物: 'creatures',
    世界观: 'concepts',
    概念: 'concepts',
    现象: 'concepts',
    信息: 'concepts',
    状态: 'concepts',
    情绪: 'concepts',
    情感: 'concepts',
    命途: 'concepts',
    事件: 'events',
    历史: 'events',
    活动: 'events',
    行为: 'other',
    其他: 'other'
  }

  assert.equal(Object.keys(expected).length, 48)
  assert.deepEqual(Object.keys(CATEGORY_MAP).sort(), Object.keys(expected).sort())
  for (const [category, slot] of Object.entries(expected)) {
    assert.equal(CATEGORY_MAP[category], slot, `「${category}」应归 ${slot}`)
    assert.equal(slotForCategory(category), slot, `slotForCategory(「${category}」)`)
  }
  assert.deepEqual([...new Set(Object.values(expected))].sort(), Object.keys(WORLDVIEW_SLOTS).sort(), '11 个槽位全被分类表覆盖')
  assert.equal(slotForCategory('不存在的分类'), OTHER_SLOT)
  assert.equal(slotForCategory(''), OTHER_SLOT)

  const report = runPediaGate([
    worldviewEntry({ name: '钟表法则', slot: 'rules' }),
    worldviewEntry({ name: '旧钟楼', slot: 'locations' }),
    worldviewEntry({ name: '无主之物', slot: 'other' })
  ]).normalization
  assert.equal(report.categories.tableSize, 48)
  assert.equal(report.categories.otherCount, 1)
  assert.equal(report.categories.used.rules, 1)
  assert.equal(report.categories.used.locations, 1)
})

/* ---------- round-trip 保真 ---------- */

const SENTENCE = `${'甲'.repeat(95)}钟声一响。`

function longText(count = 5) {
  return Array.from({ length: count }, () => SENTENCE).join('\n')
}

function fakeLlm(responses) {
  const calls = []
  let index = 0
  return {
    calls,
    async complete(request) {
      calls.push(request)
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      return { text: typeof response === 'function' ? response(request) : response }
    }
  }
}

function extractionOutput() {
  return JSON.stringify({
    who: [
      { name: '柯秒', role: '主事' },
      { name: '守夜人', role: '参与' }
    ],
    when: { story_time: '入夜三更', timeline: '顺叙' },
    where: '旧钟楼',
    actinfo: [
      { type: 'act', channel: 'do', who: '柯秒', content: '推开钟楼的门' },
      { type: 'act', channel: 'say', who: '柯秒', content: '钟又响了。' },
      { type: 'act', channel: 'do', who: '陌生客', content: '从阴影里走出' },
      { type: 'act', channel: 'say', who: '守夜人', content: '别上去。' }
    ],
    notes: '钟声异常，守夜人没有察觉。'
  })
}

function characterProfileLlm() {
  return {
    calls: [],
    async complete(request) {
      this.calls.push(request)
      const matched = /小说人物「([^」]+)」/u.exec(request.prompt)
      const name = matched?.[1] ?? '未知'
      return {
        text: JSON.stringify({
          identity: `${name}的身份`,
          personality: '冷静',
          trajectory: `${name}在钟楼里行动。`,
          relations: [{ name: '守夜人', relation: '对头' }],
          anchors: { catchphrase: ['钟又响了。'] },
          memoryPoints: ['钟声第三次响起'],
          castRole: { tier: 'supporting', goal: '追查钟声', plotFunction: '推动主线' }
        })
      }
    }
  }
}

/**
 * round-trip 端口（宿主侧适配器；pedia 层自己不 import wikihub）：
 *   worldview → hubToWorldbook → worldbookToHub（世界书载体，字段全量）；
 *   plot      → hubToNovelRefs（小说骨架，@《…》引用行）→ extractRefs 回读；
 *   人物      → convert 没有人物载体，按 JSON 往返校验锚点，并如实记一条损失。
 */
function convertRoundTrip(entries) {
  const after = []
  const losses = []
  for (const entry of entries) {
    if (entry.layer === 'worldview') {
      const exported = hubToWorldbook(entry)
      if (!exported.ok) {
        losses.push({ code: 'EXPORT_FAILED', field: 'entry', message: exported.error?.message ?? '导出失败' })
        continue
      }
      const back = worldbookToHub([exported.entry], { book: DOMAIN, domain: DOMAIN })
      after.push(...back.entries)
      losses.push(...exported.losses, ...back.losses)
      continue
    }
    if (entry.layer === 'plot') {
      const exported = hubToNovelRefs({ plot: entry })
      const refs = exported.chapters.flatMap((row) => extractRefs(row.skeleton))
      const events = (Array.isArray(entry.events) ? entry.events : []).map((event) => ({ ...event, refs: [...refs] }))
      after.push({ ...entry, events })
      losses.push(...exported.losses)
      continue
    }
    after.push(JSON.parse(JSON.stringify(entry)))
    losses.push({
      code: 'character-carrier-unavailable',
      field: 'anchors',
      message: 'convert 无人物载体（角色不从正文抽取），锚点按 JSON 往返校验'
    })
  }
  return { after, losses, notes: ['round-trip：世界书全字段／小说引用骨架／人物 JSON'] }
}

test('round-trip 保真：原文→分段→抽取→hub 条目→convert 反向导出，实体／关系／锚点不丢且 losses 记账', async () => {
  const text = longText(5)
  const segments = segmentText(text)
  assert.equal(segments.length, 2)
  assert.ok(segments.every((segment) => segment.chars >= 100 && segment.chars <= 300))

  const extraction = await extractChapter({
    text,
    llm: fakeLlm([extractionOutput(), extractionOutput()]),
    domain: DOMAIN,
    chapterNo: 1,
    book: DOMAIN,
    bookId: 'book-1',
    knownNames: ['柯秒']
  })
  assert.equal(extraction.ok, true)
  assert.equal(extraction.segments.count, segments.length)
  assert.equal(extraction.drafts.length, 2)
  assert.deepEqual(extraction.drafts[0].events[0].refs, ['柯秒', '守夜人', '陌生客'])

  const mined = await mineCharacters({
    extractions: extraction.extractions,
    llm: characterProfileLlm(),
    domain: DOMAIN,
    book: DOMAIN,
    bookId: 'book-1'
  })
  assert.ok(mined.entries.length >= 3)
  const kemiao = mined.entries.find((entry) => entry.name === '柯秒')
  assert.ok(kemiao.anchors.speech.some((line) => line.includes('钟又响了')))
  assert.ok(kemiao.anchors.behavior.some((line) => line.includes('推开钟楼的门')))
  assert.ok(kemiao.anchors.catchphrase.length > 0)

  const worldbook = worldbookToHub([
    {
      name: '钟表法则',
      kind: 'rule',
      type: 'rule',
      summary: '表针停摆时，全城记忆停止。',
      content: '表针停摆时，全城记忆停止。',
      relations: [{ to: '旧钟楼', type: 'related' }]
    },
    { name: '旧钟楼', kind: 'location', type: 'location', summary: '城南的钟楼。', content: '城南的钟楼。' }
  ], { book: DOMAIN, domain: DOMAIN })
  assert.equal(worldbook.ok, true)
  assert.deepEqual(worldbook.losses, [])

  const hubEntries = [...extraction.drafts, ...mined.entries, ...worldbook.entries]
  const report = runPediaGate(hubEntries, { roundTrip: convertRoundTrip })

  assert.equal(report.conflicts.length, 0, '结构齐全时门禁无硬冲突')
  assert.equal(report.roundTrip.skipped, false)
  assert.equal(report.roundTrip.ok, true)
  assert.deepEqual(report.roundTrip.entities.missing, [])
  assert.deepEqual(report.roundTrip.relations.missing, [])
  assert.deepEqual(report.roundTrip.anchors.missing, [])
  assert.ok(report.roundTrip.anchors.checked >= 4)

  const entityNames = new Set(report.roundTrip.entities.expected)
  for (const name of ['柯秒', '守夜人', '陌生客', '钟表法则', '旧钟楼']) {
    assert.ok(entityNames.has(name), `实体集合应含「${name}」`)
    assert.ok(report.roundTrip.entities.actual.includes(name), `回读后仍应有「${name}」`)
  }
  assert.ok(report.roundTrip.relations.expected.includes('钟表法则→旧钟楼|related'))
  assert.ok(report.roundTrip.relations.actual.includes('钟表法则→旧钟楼|related'))

  const lossCodes = report.roundTrip.losses.map((item) => item.code)
  assert.ok(lossCodes.includes('character-carrier-unavailable'), '人物无 convert 载体必须记账')
  assert.ok(lossCodes.includes('chapter-body'), '小说骨架只出章纲不出正文必须记账')

  const broken = buildRoundTripReport({
    before: hubEntries,
    after: hubEntries.filter((entry) => entry.name !== '柯秒')
  })
  assert.equal(broken.ok, false)
  assert.ok(broken.anchors.missing.length > 0, '丢人物即丢锚点，比对必须发现')
  assert.ok(broken.relations.missing.some((pair) => pair.startsWith('柯秒→')))
})
