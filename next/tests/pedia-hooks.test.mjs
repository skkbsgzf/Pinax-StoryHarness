import test from 'node:test'
import assert from 'node:assert/strict'
import { FACT_SCHEMA, stableEntryId } from '../fact/domain/pediaSchema.js'
import { buildFactPack } from '../fact/usecases/factPack.js'
import { backflowHypothesis } from '../fact/usecases/hypothesis.js'
import { precheckDraft, extractRefs, knowledgeLedgerFrom } from '../fact/usecases/precheck.js'
import {
  HOOK_ENGINE_ROUTES,
  HOOK_ENGINE_VERSION,
  createHookEngine,
  diffValidate,
  readOnlyQuery,
  suggestCompletion
} from '../fact/usecases/hookEngine.js'
import { createMemoryFactStore } from '../fact/adapters/memoryPediaStore.mjs'
import { assertFactStore, isFactStore } from '../fact/ports/pediaStore.js'
import { assertVectorPort, isVectorPort } from '../fact/ports/vectorPort.js'
import { assertLlmPort, isLlmPort } from '../fact/ports/llmPort.js'

/**
 * P1 usecases/ports/adapters 合同测试：
 *   1) 事实包投影（世界规则 / 事件双轨 / 角色知情 / 生效区间）；
 *   2) 假设回灌必须是 proposed 事件且带证据链；
 *   3) 预检拦视角穿越与时间轴越界；
 *   4) S3 三 hook：只给建议/只出 issue/只读查询——**任何路径都不写 store**；
 *   5) 内存 store 的事务口径（operationId 幂等 + expectedRevision）。
 */

const DOMAIN = '停摆之城'

function entryId(layer, name, slot = '') {
  return stableEntryId({ layer, domain: DOMAIN, slot, name })
}

function worldEntry({ name, slot, definition, ...rest }) {
  return {
    schema: FACT_SCHEMA,
    id: entryId('worldview', name, slot),
    layer: 'worldview',
    name,
    domain: DOMAIN,
    slot,
    status: 'draft',
    definition,
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    ...rest
  }
}

function characterEntry({ name, ...rest }) {
  return {
    schema: FACT_SCHEMA,
    id: entryId('character', name),
    layer: 'character',
    name,
    domain: DOMAIN,
    status: 'draft',
    provenance: { mode: 'author', book: DOMAIN, chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: { appearance_count: 2 } },
    ...rest
  }
}

function plotEntry({ name, ...rest }) {
  return {
    schema: FACT_SCHEMA,
    id: entryId('plot', name),
    layer: 'plot',
    name,
    domain: DOMAIN,
    status: 'draft',
    provenance: { mode: 'author', book: DOMAIN, chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} },
    ...rest
  }
}

const rule = worldEntry({
  name: '钟表法则',
  slot: 'rules',
  definition: '表针停摆时，所有人的记忆停止。',
  readerCognition: { firstMention: true, supplementNeeded: true }
})
const tower = worldEntry({
  name: '旧钟楼',
  slot: 'locations',
  definition: '城南的钟楼，表针停在十二点差三分。',
  validity: { from: 1, to: 3 }
})
const realmLow = worldEntry({ name: '钟表境', slot: 'power_levels', definition: '时间之力。', rank: 1 })
const realmHigh = worldEntry({ name: '停摆境', slot: 'power_levels', definition: '时间静止。', rank: 2 })
const kemiao = characterEntry({
  name: '柯秒',
  castRole: { tier: 'supporting' },
  memoryPoints: [],
  knowledge: [
    { fromEntry: '旧钟楼', kind: 'setting', atSpan: { from: 1, to: 1 } },
    { fromEntry: '钟表法则', kind: 'setting', atSpan: { from: 1, to: 1 } }
  ]
})
const plot = plotEntry({
  name: '停摆之夜',
  events: [{ index: 1, track: 'fact', refs: ['旧钟楼'], segments: [{ index: 1, chars: 120 }], novelty: ['燃'] }]
})
const ENTRIES = [rule, tower, realmLow, realmHigh, kemiao, plot]

function spyStore(inner) {
  const calls = { get: 0, list: 0, save: 0, remove: 0 }
  const api = {
    get: (...args) => { calls.get += 1; return inner.get(...args) },
    list: (...args) => { calls.list += 1; return inner.list(...args) },
    save: (...args) => { calls.save += 1; return inner.save(...args) },
    remove: (...args) => { calls.remove += 1; return inner.remove(...args) }
  }
  return { api, calls }
}

test('事实包：世界规则/有序槽位/事件双轨/角色知情/生效区间各就各位', () => {
  const pack = buildFactPack(ENTRIES, { span: { from: 2, to: 2 }, character: '柯秒' })
  assert.equal(pack.ok, true)
  assert.deepEqual(pack.query.span, { from: 2, to: 2 })

  assert.deepEqual(pack.world.rules.map((item) => item.name), ['钟表法则'])
  assert.equal(pack.world.slots.locations.length, 1)
  assert.deepEqual(pack.world.ordered, [{
    slot: 'power_levels',
    items: [
      { id: realmLow.id, name: '钟表境', rank: 1 },
      { id: realmHigh.id, name: '停摆境', rank: 2 }
    ]
  }])

  assert.equal(pack.events.facts.length, 1)
  assert.equal(pack.events.facts[0].entryName, '停摆之夜')
  assert.deepEqual(pack.events.facts[0].refs, ['旧钟楼'])
  assert.deepEqual(pack.events.hypotheses, [])

  const character = pack.characters['柯秒']
  assert.equal(character.castRole.tier, 'supporting')
  assert.deepEqual(character.knowledge.map((item) => item.fromEntry).sort(), ['旧钟楼', '钟表法则'], '第 2 章时第 1 章知道的事仍然记得')

  const towerEffective = pack.effective.find((item) => item.name === '旧钟楼')
  assert.deepEqual(towerEffective.effective, { from: 2, to: 2 }, '生效区间＝条目 validity 与查询区间的交集')
  assert.deepEqual(pack.supplements.map((item) => item.name), ['钟表法则'])
  assert.equal(pack.counts.entries, 6)
  assert.equal(pack.counts.hypotheses, 0)
})

test('事实包：查询区间之外的世界观条目不进包，角色在后续时点仍知道早先信息', () => {
  const later = buildFactPack(ENTRIES, { span: 5, character: '柯秒' })
  assert.equal(later.world.slots.locations, undefined, '旧钟楼 validity 1..3，第 5 章不生效')
  assert.deepEqual(later.characters['柯秒'].knowledge.map((item) => item.fromEntry).sort(), ['旧钟楼', '钟表法则'], '知道过就一直知道')

  const earlier = buildFactPack(ENTRIES, { span: 0, character: '柯秒' })
  assert.deepEqual(earlier.characters['柯秒'].knowledge, [], '第 0 章还没获得任何信息')

  const unknown = buildFactPack(ENTRIES, { character: '不存在' })
  assert.ok(unknown.warnings.some((warning) => warning.code === 'QUERY_CHARACTER_UNKNOWN'))
})

test('预检：视角穿越、时间轴越界、草稿自身 validity 不相交都能拦下', () => {
  assert.deepEqual(extractRefs('他抬头看@《旧钟楼》，又想起@《钟表境》。'), ['旧钟楼', '钟表境'])
  const ledger = knowledgeLedgerFrom(ENTRIES)
  assert.equal(ledger['柯秒'].length, 2)

  const leak = precheckDraft({
    draft: { name: '雨夜', character: '柯秒', atSpan: { from: 2, to: 2 }, text: '@《旧钟楼》 @《钟表境》' },
    entries: ENTRIES
  })
  assert.equal(leak.ok, false)
  assert.deepEqual(leak.issues.map((issue) => issue.code), ['PERSPECTIVE_LEAK'])
  assert.equal(leak.issues[0].referenced, '钟表境')

  const outside = precheckDraft({
    draft: { name: '多年后', character: '柯秒', atSpan: { from: 5, to: 5 }, text: '@《旧钟楼》' },
    entries: ENTRIES
  })
  assert.equal(outside.ok, false)
  assert.deepEqual(outside.issues.map((issue) => issue.code), ['REFERENCE_OUTSIDE_VALIDITY'])
  assert.deepEqual(outside.issues[0].entryValidity, { from: 1, to: 3 })

  const selfStale = precheckDraft({
    draft: { name: '旧稿', atSpan: { from: 2, to: 2 }, validity: { from: 9, to: 9 } },
    entries: ENTRIES
  })
  assert.equal(selfStale.ok, false)
  assert.deepEqual(selfStale.issues.map((issue) => issue.code), ['DRAFT_OUTSIDE_VALIDITY'])

  const clean = precheckDraft({
    draft: { name: '雨夜', character: '柯秒', atSpan: { from: 1, to: 1 }, text: '@《旧钟楼》' },
    entries: ENTRIES
  })
  assert.equal(clean.ok, true)
  assert.equal(clean.checked.resolvedRefs, 1)
})

test('假设回灌：proposed 事件 + 证据链；无证据拒收，解析不到的证据如实警告', () => {
  const result = backflowHypothesis({
    hypothesis: {
      statement: '钟楼停摆与柯秒的旧表有关。',
      basedOn: ['旧钟楼', { id: rule.id }],
      confidence: 0.6,
      validity: { from: 2, to: 4 }
    },
    facts: ENTRIES,
    domain: DOMAIN,
    book: DOMAIN
  })
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.entry.status, 'proposed')
  assert.equal(result.entry.layer, 'plot')
  assert.equal(result.entry.events[0].track, 'hypothesis')
  assert.equal(result.entry.hypothesis[0].statement, '钟楼停摆与柯秒的旧表有关。')
  assert.deepEqual(result.evidence.map((item) => [item.name, item.resolved]), [['旧钟楼', true], ['钟表法则', true]])
  assert.equal(result.entry.provenance.mode, 'analyze')
  assert.equal(result.entry.provenance.quote, undefined, '分析来源不存 quote 原文')
  assert.deepEqual(result.entry.validity, { from: 2, to: 4 })
  assert.equal(result.entry.id, stableEntryId({ layer: 'plot', domain: DOMAIN, slot: '', name: result.entry.name }))
  assert.equal(result.validation.ok, true)

  const partial = backflowHypothesis({
    hypothesis: { statement: '另一条线索。', basedOn: ['不存在的条目', '旧钟楼'] },
    facts: ENTRIES,
    domain: DOMAIN
  })
  assert.equal(partial.ok, true)
  assert.ok(partial.warnings.some((warning) => warning.code === 'HYPOTHESIS_EVIDENCE_UNRESOLVED'))
  assert.deepEqual(partial.evidence.map((item) => item.resolved), [false, true])

  const bare = backflowHypothesis({ hypothesis: { statement: '没有依据的猜测。', basedOn: [] }, facts: ENTRIES })
  assert.equal(bare.ok, false)
  assert.ok(bare.errors.some((error) => error.code === 'HYPOTHESIS_WITHOUT_EVIDENCE'))

  const allMissing = backflowHypothesis({ hypothesis: { statement: '全是幻觉。', basedOn: ['幽灵'] }, facts: ENTRIES })
  assert.equal(allMissing.ok, false)
  assert.ok(allMissing.errors.some((error) => error.code === 'HYPOTHESIS_EVIDENCE_ALL_UNRESOLVED'))
})

test('suggestCompletion：只给建议（writesData=false），从 store 读也不写', async () => {
  const inner = createMemoryFactStore({ entries: ENTRIES })
  const { api, calls } = spyStore(inner)
  const result = await createHookEngine({ store: api }).suggestCompletion({ query: { span: 2, character: '柯秒' } })
  assert.equal(result.kind, 'suggestCompletion')
  assert.equal(result.writesData, false)
  assert.equal(result.readOnly, true)
  const types = new Set(result.suggestions.map((item) => item.type))
  for (const type of ['world-rule', 'ordered-slot', 'character-gap', 'reader-supplement']) {
    assert.ok(types.has(type), `建议里应有 ${type}`)
  }
  assert.equal(types.has('rhythm-gap'), false, '事件已有新意标记，不该报节奏空窗')
  assert.equal(result.factPack.world.rules.length, 1)
  assert.equal(calls.list, 1, '读了一次 store.list')
  assert.equal(calls.save, 0, 'hook 永不写 store')
  assert.equal(calls.remove, 0, 'hook 永不删 store')

  const plain = await suggestCompletion({ entries: ENTRIES, query: { span: 2 } })
  assert.equal(plain.writesData, false)
  assert.ok(plain.notes.some((note) => note.includes('未接 llm')))

  const noNovelty = await suggestCompletion({
    entries: ENTRIES.map((entry) => (entry.id === plot.id ? { ...entry, events: [{ index: 1, track: 'fact', refs: [] }] } : entry))
  })
  assert.ok(noNovelty.suggestions.some((item) => item.type === 'rhythm-gap'), '没有新意标记要提醒节奏')
})

test('diffValidate：非法状态转移/新增不合 schema 算 error，删除与关系变化算 warning', async () => {
  const illegal = await diffValidate({
    before: [rule],
    after: [{ ...rule, status: 'adopted' }]
  })
  assert.equal(illegal.ok, false)
  assert.ok(illegal.issues.some((issue) => issue.code === 'ILLEGAL_STATUS_TRANSITION' && issue.severity === 'error'))
  assert.ok(illegal.issues.some((issue) => issue.code === 'ENTRY_CHANGED' && issue.fields.includes('status')))

  const brokenNew = { ...characterEntry({ name: '新人物' }), schema: 'pedia/v1' }
  const addedBroken = await diffValidate({ before: [rule], after: [rule, brokenNew] })
  assert.equal(addedBroken.ok, false)
  assert.ok(addedBroken.issues.some((issue) => issue.code === 'INVALID_ENTRY' && issue.entryId === brokenNew.id))

  const removed = await diffValidate({ before: [rule, tower], after: [rule] })
  assert.equal(removed.ok, true, '删除只是 warning')
  assert.deepEqual(removed.summary, { added: 0, removed: 1, changed: 0, unchanged: 1 })
  assert.ok(removed.issues.some((issue) => issue.code === 'ENTRY_REMOVED' && issue.severity === 'warning'))

  const relationChanged = await diffValidate({
    before: [{ ...kemiao, relations: [{ to: '旧钟楼' }] }],
    after: [{ ...kemiao, relations: [{ to: '钟表境' }] }]
  })
  const relationIssue = relationChanged.issues.find((issue) => issue.code === 'RELATION_CHANGED')
  assert.deepEqual([relationIssue.added, relationIssue.removed], [['钟表境'], ['旧钟楼']])

  const unchanged = await diffValidate({ before: [rule], after: [{ ...rule }] })
  assert.equal(unchanged.summary.unchanged, 1)
  assert.deepEqual(unchanged.issues, [])

  const withDraft = await diffValidate({
    before: ENTRIES,
    after: ENTRIES,
    draft: { name: '雨夜', character: '柯秒', atSpan: { from: 2, to: 2 }, text: '@《钟表境》' }
  })
  assert.equal(withDraft.ok, false, 'draft 预检的 error 会并入 diff')
  assert.ok(withDraft.issues.some((issue) => issue.code === 'PERSPECTIVE_LEAK'))
})

test('readOnlyQuery：只出事实包；store 只被 list 读一次', async () => {
  const inner = createMemoryFactStore({ entries: ENTRIES })
  const { api, calls } = spyStore(inner)
  const result = await createHookEngine({ store: api }).readOnlyQuery({ query: { span: 1, character: '柯秒' } })
  assert.equal(result.kind, 'readOnlyQuery')
  assert.equal(result.writesData, false)
  assert.equal(result.factPack.world.slots.locations.length, 1)
  assert.equal(calls.list, 1)
  assert.equal(calls.save + calls.remove, 0)
  assert.equal(inner.stats().writes, 0, '底层 store 的写计数保持 0')

  const direct = await readOnlyQuery({ entries: ENTRIES, query: { span: 1 } })
  assert.equal(direct.factPack.counts.entries, 6)
})

test('hook 引擎：四动作路由到三入口，版本号稳定', () => {
  const engine = createHookEngine()
  assert.equal(engine.version, HOOK_ENGINE_VERSION)
  assert.deepEqual(engine.routes, HOOK_ENGINE_ROUTES)
  assert.deepEqual(HOOK_ENGINE_ROUTES, {
    onOutlineWrite: 'suggestCompletion',
    onContinueWrite: 'suggestCompletion',
    onDataChange: 'diffValidate',
    onPolish: 'readOnlyQuery'
  })
  for (const method of ['suggestCompletion', 'diffValidate', 'readOnlyQuery']) {
    assert.equal(typeof engine[method], 'function')
  }
})

test('内存 store：operationId 幂等、expectedRevision 乐观并发、校验拒写、删除同口径', async () => {
  const store = createMemoryFactStore()
  assert.equal(await store.get(rule.id), null)

  const first = await store.save(rule, { operationId: 'op-create' })
  assert.equal(first.ok, true)
  assert.equal(first.revision, 1)
  assert.equal(first.duplicate, false)

  const replay = await store.save({ ...rule, definition: '改过的正文' }, { operationId: 'op-create' })
  assert.equal(replay.duplicate, true, '同一 operationId 重放返回首次结果')
  assert.equal((await store.get(rule.id)).entry.definition, rule.definition, '重放不落第二次')

  const missingOperation = await store.save(rule)
  assert.equal(missingOperation.code, 'OPERATION_ID_REQUIRED')

  const stale = await store.save({ ...rule, definition: '新正文' }, { operationId: 'op-update', expectedRevision: 2 })
  assert.equal(stale.code, 'REVISION_MISMATCH')
  assert.equal(stale.error.currentRevision, 1)

  const updated = await store.save({ ...rule, definition: '新正文' }, { operationId: 'op-update', expectedRevision: 1 })
  assert.equal(updated.ok, true)
  assert.equal(updated.revision, 2)
  assert.equal((await store.get(rule.id)).entry.definition, '新正文')

  const invalid = await store.save({ ...tower, definition: '' }, { operationId: 'op-invalid' })
  assert.equal(invalid.code, 'VALIDATION_FAILED')
  assert.ok(invalid.error.errors.some((error) => error.code === 'MISSING_REQUIRED'))

  const listed = await store.list({ layer: 'worldview' })
  assert.equal(listed.total, 1)

  const removeStale = await store.remove(rule.id, { operationId: 'op-remove', expectedRevision: 1 })
  assert.equal(removeStale.code, 'REVISION_MISMATCH')
  const removed = await store.remove(rule.id, { operationId: 'op-remove', expectedRevision: 2 })
  assert.equal(removed.ok, true)
  assert.equal(await store.get(rule.id), null)
  const removeReplay = await store.remove(rule.id, { operationId: 'op-remove', expectedRevision: 2 })
  assert.equal(removeReplay.duplicate, true)
  assert.deepEqual(store.stats(), { entries: 0, operations: 3, writes: 3, duplicates: 2, rejected: 4 })
})

test('端口形状校验：缺方法直接 TypeError；齐备则原样返回', () => {
  const store = createMemoryFactStore()
  assert.equal(isFactStore(store), true)
  assert.equal(assertFactStore(store), store)
  assert.equal(isFactStore({ get() {} }), false)
  assert.throws(() => assertFactStore({ get() {}, list() {} }), /FactStore 端口缺方法/u)

  const vector = { embed: async () => [], search: async () => [] }
  assert.equal(isVectorPort(vector), true)
  assert.equal(assertVectorPort(vector), vector)
  assert.throws(() => assertVectorPort({ embed() {} }), /VectorPort 端口缺方法/u)

  const llm = { complete: async () => ({ text: '' }) }
  assert.equal(isLlmPort(llm), true)
  assert.equal(assertLlmPort(llm), llm)
  assert.throws(() => assertLlmPort({}), /LlmPort 端口缺方法/u)
})
