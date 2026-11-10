import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_RHYTHM_SPEC,
  ENTRY_STATUSES,
  FACT_SCHEMA,
  STATUS_TRANSITIONS,
  canTransitionStatus,
  checkPerspective,
  createRhythmSpec,
  instantiateStructureTemplate,
  stableEntryId,
  transitionEntryStatus,
  validateFactEntry,
  validateStatusTransition
} from '../wikihub/pediaSchema.mjs'
import {
  NOVEL_STYLE_PACK_ID,
  createNovelStylePack,
  isStyleWorldbookEntry,
  resolveStylePack,
  styleEntryFromWorldbook
} from '../wikihub/packs/novel-style.mjs'
import { migrateV1Entry, migrateV1Hub } from '../wikihub/migrate.mjs'
import { novelToHubAnchors, scriptToHubAnchors, worldbookToHub } from '../wikihub/convert.mjs'
import {
  HOOK_IDS,
  HOOK_TARGETS,
  createHookRegistry,
  getHookContract,
  isReadOnlyHook,
  planHook
} from '../wikihub/hooks.mjs'

/**
 * fact.data/v2 定稿字段的合同测试（S1/S2-1/S2-2/S2-3/S4 与信封、迁移、hook 契约）。
 *
 * 只钉「纯函数口径」：状态机、validity、角色知情、节奏规格、视角校验、文风能力包、
 * v1→v2 迁移与 hook 接口；不接引擎、不碰磁盘。
 */

const BOOK = '停摆之城'

function worldviewEntry(overrides = {}) {
  const base = {
    layer: 'worldview',
    name: '旧钟楼',
    domain: BOOK,
    slot: 'locations',
    status: 'draft',
    definition: '城南的钟楼。',
    provenance: { mode: 'author', book: BOOK, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/2', confidence: 1 }
  }
  const merged = { ...base, ...overrides }
  return { schema: FACT_SCHEMA, id: stableEntryId({ layer: merged.layer, domain: merged.domain, slot: merged.slot ?? '', name: merged.name }), ...merged }
}

function characterEntry(overrides = {}) {
  const base = {
    layer: 'character',
    name: '柯秒',
    domain: BOOK,
    status: 'draft',
    provenance: { mode: 'author', book: BOOK, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/2', confidence: 1 },
    fingerprint: { vec: null, metrics: {} }
  }
  const merged = { ...base, ...overrides }
  return { schema: FACT_SCHEMA, id: stableEntryId({ layer: merged.layer, domain: merged.domain, slot: merged.slot ?? '', name: merged.name }), ...merged }
}

function plotEntry(overrides = {}) {
  const base = {
    layer: 'plot',
    name: '章纲',
    domain: BOOK,
    status: 'draft',
    provenance: { mode: 'analyze', book: BOOK, book_id: 'abcd1234', chapters: [1], scenes: [], extractor: 'test/2', confidence: 1 },
    fingerprint: { vec: null, metrics: {} }
  }
  const merged = { ...base, ...overrides }
  return { schema: FACT_SCHEMA, id: stableEntryId({ layer: merged.layer, domain: merged.domain, slot: merged.slot ?? '', name: merged.name }), ...merged }
}

/* ---------- 信封：状态机 ---------- */

test('状态机：合法转移表完整，非法转移被拒，同态幂等', () => {
  const legal = [
    ['draft', 'proposed'], ['draft', 'superseded'],
    ['proposed', 'adopted'], ['proposed', 'draft'], ['proposed', 'superseded'],
    ['adopted', 'superseded']
  ]
  for (const [from, to] of legal) {
    assert.equal(canTransitionStatus(from, to), true, `${from} → ${to} 应合法`)
    assert.equal(validateStatusTransition(from, to).ok, true)
  }
  for (const status of ENTRY_STATUSES) {
    assert.equal(canTransitionStatus(status, status), true, '同状态按幂等放行')
  }
  assert.equal(canTransitionStatus('draft', 'adopted'), false, '不能跳级')
  assert.equal(canTransitionStatus('adopted', 'draft'), false, '采纳后不能回草稿')
  assert.equal(canTransitionStatus('superseded', 'draft'), false, '终态不可复活')
  assert.deepEqual(STATUS_TRANSITIONS.superseded, [])

  const illegal = validateStatusTransition('draft', 'adopted')
  assert.equal(illegal.ok, false)
  assert.equal(illegal.code, 'ILLEGAL_STATUS_TRANSITION')
  assert.deepEqual(illegal.allowed, ['proposed', 'superseded'])
  assert.equal(validateStatusTransition('draft', 'gone').code, 'UNKNOWN_STATUS')

  const entry = worldviewEntry()
  const promoted = transitionEntryStatus(entry, 'proposed')
  assert.equal(promoted.ok, true)
  assert.equal(promoted.entry.status, 'proposed')
  assert.equal(entry.status, 'draft', '不改原对象')
  const rejected = transitionEntryStatus(entry, 'adopted')
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'ILLEGAL_STATUS_TRANSITION')
})

test('信封：status 必填、provenance.mode 必填，analyze 不许留 quote 原文', () => {
  const missingStatus = worldviewEntry({ status: undefined })
  assert.ok(validateFactEntry(missingStatus).errors.some((error) => error.code === 'MISSING_REQUIRED' && error.field === 'status'))

  const badMode = worldviewEntry({ provenance: { ...worldviewEntry().provenance, mode: 'guess' } })
  assert.ok(validateFactEntry(badMode).errors.some((error) => error.code === 'PROVENANCE_MODE'))

  const quoted = worldviewEntry({ provenance: { ...worldviewEntry().provenance, mode: 'analyze', quote: '原文摘录' } })
  assert.ok(validateFactEntry(quoted).errors.some((error) => error.code === 'PROVENANCE_QUOTE_NOT_HASHED'))
  const hashed = worldviewEntry({ provenance: { ...worldviewEntry().provenance, mode: 'analyze', quote_hash: 'abc123' } })
  assert.equal(validateFactEntry(hashed).ok, true)
  const authorQuote = worldviewEntry({ provenance: { ...worldviewEntry().provenance, mode: 'author', quote: '作者自写原文' } })
  assert.equal(validateFactEntry(authorQuote).ok, true, 'author 模式可以留原文')
})

test('validity 双时间轴：整数或 null，from 不得大于 to', () => {
  assert.equal(validateFactEntry(worldviewEntry({ validity: { from: null, to: null } })).ok, true)
  assert.equal(validateFactEntry(worldviewEntry({ validity: { from: 3, to: 9 } })).ok, true)
  const shape = validateFactEntry(worldviewEntry({ validity: { from: '3', to: 9 } }))
  assert.ok(shape.errors.some((error) => error.code === 'VALIDITY_VALUE'))
  const range = validateFactEntry(worldviewEntry({ validity: { from: 9, to: 3 } }))
  assert.ok(range.errors.some((error) => error.code === 'VALIDITY_RANGE'))
})

/* ---------- S2-1 人物塑造字段 ---------- */

test('S2-1：anchors/memoryPoints 形状；supporting/minor 必须 goal+plotFunction（analyze 拒、author 警）', () => {
  const anchored = characterEntry({
    anchors: { speech: ['说话带方言'], behavior: ['总在擦表'], catchphrase: ['时间会回答'] },
    memoryPoints: ['袖口停摆的表']
  })
  assert.equal(validateFactEntry(anchored).ok, true)

  const badChannel = validateFactEntry(characterEntry({ anchors: { humor: ['x'] } }))
  assert.ok(badChannel.errors.some((error) => error.code === 'ANCHORS_CHANNEL'))

  const incompleteAuthor = validateFactEntry(characterEntry({ castRole: { tier: 'supporting', goal: '守住钟楼' } }))
  assert.equal(incompleteAuthor.ok, true, 'author 模式先警告')
  assert.ok(incompleteAuthor.warnings.some((warning) => warning.code === 'CAST_ROLE_INCOMPLETE' && warning.field === 'castRole.plotFunction'))

  const incompleteAnalyze = validateFactEntry(characterEntry({
    provenance: { ...characterEntry().provenance, mode: 'analyze' },
    castRole: { tier: 'minor' }
  }))
  assert.equal(incompleteAnalyze.ok, false, 'analyze 模式直接拒')
  assert.ok(incompleteAnalyze.errors.some((error) => error.code === 'CAST_ROLE_INCOMPLETE'))

  const complete = validateFactEntry(characterEntry({
    castRole: { tier: 'supporting', goal: '守住钟楼', plotFunction: '在第二幕递出停摆的表' }
  }))
  assert.equal(complete.ok, true)
})

/* ---------- S2-2 节奏与结构模板 ---------- */

test('S2-2：节奏规格默认值可覆盖；窗口必须严格递增；新意标签与结构模板可校验可实例化', () => {
  assert.deepEqual(createRhythmSpec(), DEFAULT_RHYTHM_SPEC)
  const custom = createRhythmSpec({ windowChars: [300, 900], noveltyTags: ['笑'] })
  assert.deepEqual(custom, { windowChars: [300, 900], noveltyTags: ['笑'] })

  const ok = plotEntry({
    rhythmSpec: createRhythmSpec(),
    events: [{ index: 1, track: 'fact', novelty: ['燃'], segments: [{ index: 1, chars: 120 }] }],
    structureTemplates: [{ id: 'three-act', kind: 'beat-sheet', beats: ['起', '承', '转', '合'] }]
  })
  assert.equal(validateFactEntry(ok).ok, true)

  const badWindow = plotEntry({ rhythmSpec: { windowChars: [1500, 500], noveltyTags: ['笑'] } })
  assert.ok(validateFactEntry(badWindow).errors.some((error) => error.code === 'RHYTHM_WINDOW_ORDER'))
  const badTrack = plotEntry({ events: [{ index: 1, track: 'gossip' }] })
  assert.ok(validateFactEntry(badTrack).errors.some((error) => error.code === 'PLOT_EVENT_TRACK'))
  const badSegment = plotEntry({ events: [{ index: 1, track: 'fact', segments: [{ index: 0, chars: 12 }] }] })
  assert.ok(validateFactEntry(badSegment).errors.some((error) => error.code === 'PLOT_EVENT_SEGMENT_INDEX'))
  const badTemplate = plotEntry({ structureTemplates: [{ kind: 'beat-sheet' }] })
  assert.ok(validateFactEntry(badTemplate).errors.some((error) => error.code === 'STRUCTURE_TEMPLATE_NAME'))

  const instance = instantiateStructureTemplate({ id: 'three-act', kind: 'beat-sheet', beats: ['起', '承', '转', '合'] })
  assert.equal(instance.instanceOf, 'three-act')
  assert.equal(instance.id.startsWith('three-act-inst-'), true)
  assert.equal(instance.beats.length, 4, '模板本身原样带过去')
})

/* ---------- S2-3 知情矩阵与视角校验 ---------- */

test('S2-3：knowledge 记录形状；checkPerspective 拦住「未知信息」与「未来才知道」', () => {
  const known = characterEntry({
    knowledge: [{ fromEntry: '停摆的表', atSpan: { from: 2, to: 2 }, kind: 'event' }]
  })
  assert.equal(validateFactEntry(known).ok, true)
  const badKind = characterEntry({ knowledge: [{ fromEntry: '停摆的表', atSpan: { from: 2, to: 2 }, kind: 'rumor' }] })
  assert.ok(validateFactEntry(badKind).errors.some((error) => error.code === 'KNOWLEDGE_KIND'))

  const perspectiveEntry = {
    name: '柯秒的独白',
    relations: [{ to: '停摆的表' }],
    perspective: { character: '柯秒', atSpan: { from: 3, to: 3 } }
  }
  const knownLater = checkPerspective(perspectiveEntry, {
    柯秒: [{ fromEntry: '停摆的表', atSpan: { from: 5, to: 5 }, kind: 'event' }]
  })
  assert.equal(knownLater.ok, false)
  assert.deepEqual(knownLater.violations.map((item) => [item.code, item.reason, item.atChapter, item.knownAt]), [
    ['PERSPECTIVE_UNKNOWN_INFO', 'known-later', 3, 5]
  ])

  const unknown = checkPerspective(perspectiveEntry, {})
  assert.deepEqual(unknown.violations.map((item) => item.reason), ['not-in-ledger'])

  const knownNow = checkPerspective(perspectiveEntry, {
    柯秒: [{ fromEntry: '停摆的表', atSpan: { from: 1, to: 1 }, kind: 'event' }]
  })
  assert.equal(knownNow.ok, true)
  assert.equal(knownNow.checked, 1)

  const noPerspective = checkPerspective({ name: '旁白' }, {})
  assert.equal(noPerspective.ok, true)
  assert.equal(noPerspective.skipped, 'NO_PERSPECTIVE')
})

/* ---------- S1 文风能力包 ---------- */

test('S1：文风能力包只在小说体裁生效，v1 style 条目可转成包内条目', () => {
  const v1Style = {
    schema: 'pedia/v1',
    id: 'style0000001',
    layer: 'style',
    name: '冷叙事',
    slot: 'creative_rules',
    definition: '短句、少形容词。',
    next: { worldbook: { content: '短句。少形容词。', path: '世界书/剧作/冷叙事.md', keys: ['冷硬'] } }
  }
  assert.equal(isStyleWorldbookEntry({ type: 'style' }), true)
  const packEntry = styleEntryFromWorldbook(v1Style, { slot: 'creative_rules' })
  assert.equal(packEntry.kind, 'creative-rule')
  assert.equal(packEntry.slot, 'creative_rules')
  assert.equal(packEntry.text, '短句。少形容词。')
  assert.deepEqual(packEntry.keys, ['冷硬'])
  assert.equal(packEntry.id.startsWith('style-'), true)

  const pack = createNovelStylePack({ entries: [v1Style], targets: { sentenceChars: [8, 24] } })
  assert.equal(pack.pack, NOVEL_STYLE_PACK_ID)
  assert.equal(pack.active, true)
  assert.deepEqual(pack.appliesTo, ['novel'])
  assert.deepEqual(pack.targets.sentenceChars, [8, 24])
  assert.equal(pack.entries.length, 1)
  assert.deepEqual(pack.sourceEntryIds, ['style0000001'])

  assert.deepEqual(
    [resolveStylePack(pack, { genre: 'novel' }).active, resolveStylePack(pack, { genre: 'script' }).active, resolveStylePack(null).reason],
    [true, false, 'NO_PACK']
  )
  assert.equal(resolveStylePack(pack, { genre: 'script' }).reason, 'GENRE_NOT_SUPPORTED')
})

/* ---------- 转换器 v2 ---------- */

test('转换器：世界书文风条目改投能力包；mode/status 显式落值；未命中能力包时为 null', () => {
  const styleEntry = {
    id: 'wb-style',
    name: '冷叙事',
    type: 'style',
    cat: '',
    tags: [],
    keys: [],
    summary: '短句。',
    content: '短句。少形容词。',
    path: '世界书/剧作/冷叙事.md',
    revision: 1,
    contract: true
  }
  const town = {
    id: 'wb-town',
    name: '旧钟楼',
    type: 'location',
    cat: '地点',
    tags: [],
    keys: [],
    summary: '城南的钟楼。',
    content: '钟楼在城南。',
    path: '世界书/地点/旧钟楼.md',
    revision: 1,
    contract: true
  }
  const result = worldbookToHub([styleEntry, town], { book: BOOK, status: 'proposed', mode: 'author' })
  assert.equal(result.ok, true)
  assert.equal(result.valid, true, JSON.stringify(result.issues))
  assert.equal(result.entries.length, 1, '文风条目不入 hub 主条目集')
  assert.equal(result.entries[0].status, 'proposed')
  assert.equal(result.entries[0].provenance.mode, 'author')
  assert.deepEqual(result.entries[0].validity, { from: null, to: null })
  assert.equal(result.stylePack.pack, NOVEL_STYLE_PACK_ID)
  assert.equal(result.stylePack.entries[0].name, '冷叙事')
  assert.ok(result.warnings.some((warning) => warning.code === 'STYLE_ENTRY_TO_PACK'))
  assert.equal(result.mappings.find((item) => item.name === '冷叙事').pack, NOVEL_STYLE_PACK_ID)

  const plain = worldbookToHub([town], { book: BOOK })
  assert.equal(plain.stylePack, null, '没有文风条目就不摆空包')
  assert.equal(plain.warnings.some((warning) => warning.code === 'MODE_INVALID'), false)
  const badOptions = worldbookToHub([town], { book: BOOK, status: 'published', mode: 'auto' })
  assert.ok(badOptions.warnings.some((warning) => warning.code === 'STATUS_INVALID'))
  assert.ok(badOptions.warnings.some((warning) => warning.code === 'MODE_INVALID'))
  assert.equal(badOptions.entries[0].status, 'draft')
  assert.equal(badOptions.entries[0].provenance.mode, 'author')
})

test('转换器：小说/剧本锚点带 v2 信封与分段元数据（正文不进 hub）', () => {
  const novel = novelToHubAnchors({
    bookName: BOOK,
    chapters: [
      { index: 0, title: '雨夜', file: '正文/第001章.md', text: '甲'.repeat(301) }
    ]
  })
  assert.equal(novel.valid, true, JSON.stringify(novel.issues))
  assert.equal(novel.plotEntry.status, 'draft')
  assert.equal(novel.plotEntry.provenance.mode, 'analyze')
  assert.deepEqual(novel.plotEntry.events[0].segments, [{ index: 1, chars: 151 }, { index: 2, chars: 150 }])
  assert.equal(novel.plotEntry.events[0].text, undefined, '事件只留段元数据，不搬正文')
  assert.deepEqual(novel.plotEntry.validity, { from: 1, to: 1 })

  const script = scriptToHubAnchors({ book: '表匠', scripts: [{ index: 0, title: '第一幕', text: '短句。' }] })
  assert.equal(script.valid, true, JSON.stringify(script.issues))
  assert.equal(script.plotEntry.provenance.mode, 'analyze')
  assert.deepEqual(script.plotEntry.events[0].segments, [{ index: 1, chars: 3 }])
})

/* ---------- 迁移器 ---------- */

test('迁移器：v1 世界观补信封、analyze quote 只留哈希；plot/character 补默认；style 进能力包', () => {
  const townId = stableEntryId({ layer: 'worldview', domain: BOOK, slot: 'locations', name: '旧钟楼' })
  const v1Town = {
    schema: 'pedia/v1',
    id: townId,
    layer: 'worldview',
    name: '旧钟楼',
    domain: BOOK,
    slot: 'locations',
    definition: '城南的钟楼。',
    provenance: { book: BOOK, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'novelfact/1', confidence: 1, quote: '原文摘录' }
  }
  const migrated = migrateV1Entry(v1Town)
  assert.equal(migrated.ok, true, JSON.stringify(migrated.checks.errors))
  assert.equal(migrated.entry.schema, FACT_SCHEMA)
  assert.equal(migrated.entry.status, 'draft')
  assert.equal(migrated.entry.provenance.mode, 'analyze', '没有世界书载体的 v1 条目按分析来源')
  assert.deepEqual(migrated.entry.validity, { from: null, to: null })
  assert.equal(migrated.entry.provenance.quote, undefined)
  assert.match(migrated.entry.provenance.quote_hash, /^[0-9a-f]{40}$/u)
  assert.ok(migrated.losses.some((loss) => loss.code === 'quote-hashed'))

  const worldbookV1 = migrateV1Entry({ ...v1Town, next: { medium: 'worldbook' } })
  assert.equal(worldbookV1.entry.provenance.mode, 'author', '世界书载体＝作者自写')

  const plotId = stableEntryId({ layer: 'plot', domain: BOOK, name: '章纲' })
  const v1Plot = {
    schema: 'pedia/v1',
    id: plotId,
    layer: 'plot',
    name: '章纲',
    domain: BOOK,
    events: [{ index: 1, title: '雨夜', text: '短句。'.repeat(40) }],
    provenance: { book: BOOK, book_id: 'abcd1234', chapters: [1], scenes: [], extractor: 'novelfact/1' },
    fingerprint: { vec: null, metrics: {} }
  }
  const plot = migrateV1Entry(v1Plot)
  assert.equal(plot.ok, true, JSON.stringify(plot.checks.errors))
  assert.deepEqual(plot.entry.rhythmSpec, DEFAULT_RHYTHM_SPEC)
  assert.deepEqual(plot.entry.structureTemplates, [])
  assert.equal(plot.entry.events[0].track, 'fact')
  assert.ok(plot.entry.events[0].segments.length >= 1)
  assert.ok(plot.warnings.some((warning) => warning.code === 'PLOT_TRACK_DEFAULTED'))

  const characterId = stableEntryId({ layer: 'character', domain: BOOK, name: '柯秒' })
  const v1Character = {
    schema: 'pedia/v1',
    id: characterId,
    layer: 'character',
    name: '柯秒',
    domain: BOOK,
    provenance: { book: BOOK, book_id: 'abcd1234', chapters: [1], scenes: [], extractor: 'novelfact/1' },
    fingerprint: { vec: null, metrics: {} }
  }
  const character = migrateV1Entry(v1Character)
  assert.deepEqual(character.entry.anchors, { speech: [], behavior: [], catchphrase: [] })
  assert.deepEqual(character.entry.memoryPoints, [])
  assert.deepEqual(character.entry.knowledge, [])

  const hub = migrateV1Hub([v1Town, v1Plot, v1Character, {
    schema: 'pedia/v1',
    id: 'style0000001',
    layer: 'style',
    name: '冷叙事',
    slot: 'creative_rules',
    definition: '短句。'
  }])
  assert.equal(hub.ok, true, JSON.stringify(hub.issues))
  assert.equal(hub.entries.length, 3)
  assert.equal(hub.stylePack.pack, NOVEL_STYLE_PACK_ID)
  assert.deepEqual(hub.stylePack.entries.map((entry) => entry.name), ['冷叙事'])
})

/* ---------- hook 契约 ---------- */

test('hook 契约：四个 hook 指向三个目标，全部 writesData=false；planHook 标注只读语义', () => {
  assert.deepEqual(HOOK_IDS, ['onOutlineWrite', 'onContinueWrite', 'onDataChange', 'onPolish'])
  assert.deepEqual(HOOK_TARGETS.suggestCompletion, { id: 'suggestCompletion', semantics: 'suggest', writesData: false })
  assert.equal(getHookContract('onOutlineWrite').target, 'suggestCompletion')
  assert.equal(getHookContract('onContinueWrite').target, 'suggestCompletion')
  assert.equal(getHookContract('onDataChange').target, 'diffValidate')
  assert.equal(getHookContract('onPolish').target, 'readOnlyQuery')
  assert.equal(isReadOnlyHook('onDataChange'), true)
  assert.equal(isReadOnlyHook('onPolish'), true)
  assert.equal(isReadOnlyHook('onOutlineWrite'), false, 'suggest 是建议语义，不算只读查询')

  const plan = planHook('onPolish', { entryId: 'abc' })
  assert.equal(plan.ok, true)
  assert.deepEqual([plan.plan.semantics, plan.plan.writesData, plan.plan.readOnly], ['read-only', false, true])
  assert.deepEqual(plan.plan.payload, { entryId: 'abc' })
  assert.equal(planHook('nope').error.code, 'UNKNOWN_HOOK')
  assert.equal(planHook('onPolish', 'bad').error.code, 'HOOK_PAYLOAD')
})

test('hook 契约：registry 拒绝未知 hook、非函数 handler 与只读语义上的写 handler', () => {
  const suggest = () => ({ suggestions: [] })
  const ok = createHookRegistry({ onOutlineWrite: suggest, onPolish: () => ({}) })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.list(), ['onOutlineWrite', 'onPolish'])
  assert.equal(ok.handlerOf('onOutlineWrite'), suggest)
  assert.equal(ok.contractOf('onPolish').semantics, 'read-only')

  assert.equal(createHookRegistry({ nope: suggest }).error.code, 'UNKNOWN_HOOK')
  assert.equal(createHookRegistry({ onPolish: 'not-a-function' }).error.code, 'HOOK_HANDLER')

  const writer = Object.assign(() => ({}), { writesData: true })
  assert.equal(createHookRegistry({ onDataChange: writer }).error.code, 'HOOK_WRITE_CONFLICT')
})
