import test from 'node:test'
import assert from 'node:assert/strict'
import { FACT_SCHEMA, validateFactEntry } from '../fact/domain/pediaSchema.js'
import { createMemoryFactStore } from '../fact/adapters/memoryPediaStore.mjs'
import {
  MIGRATED_STATUS,
  migrateChapters,
  migrateLegacy,
  migrateLedger,
  migrateOutline,
  migrateWorldStore
} from '../fact/usecases/migrateLegacy.js'

/**
 * P2b 存量迁移器合同测试：
 *   1) 四条路径各自 fixture 与映射口径（worldStore/outline/ledger/chapters）；
 *   2) 迁入条目一律 proposed + provenance.mode=author，且过 fact.data/v2 信封校验；
 *   3) operationId 幂等：同一 fixture 重跑 saved 全 duplicate、库内 diff=0；
 *   4) dryRun=true 出完整报告但一次写都不发生；
 *   5) 语义有损的地方进 losses[]（不是静默降级）。
 */

const DOMAIN = '停摆之城'
const BOOK = '停摆之城'
const OPTIONS = { domain: DOMAIN, book: BOOK }

function worldStoreFixture() {
  return {
    entries: [
      {
        id: 'w1',
        name: '柯秒',
        category: '人物',
        summary: '主线主角，能听见钟声里的低语。',
        keys: ['秒子', '柯'],
        keysSecondary: ['小秒'],
        injection: { mode: 'always', group: '人物' },
        profile: { rank: 2 },
        relations: { characters: ['守夜人'], tags: ['主线'] },
        content: '柯秒从小在钟楼脚下长大。'
      },
      {
        id: 'w2',
        name: '守夜人',
        type: 'character',
        group: '角色',
        content: '守夜人每天三更巡查钟楼。',
        relations: [{ to: '柯秒', type: 'rival', how: '互相提防' }]
      },
      {
        id: 'w3',
        name: '停摆规则',
        category: '规则',
        content: '钟停时全城不得说谎。'
      },
      {
        id: 'w4',
        name: '旧钟楼',
        category: '地点',
        summary: '城南的钟楼。'
      },
      {
        id: 'w5',
        name: '轶事',
        category: '街谈巷议',
        content: '关于钟声的传闻。'
      }
    ]
  }
}

function outlineFixture() {
  return {
    nodes: [
      {
        id: 'n1',
        title: '开端',
        intent: '柯秒发现钟停了',
        status: 'drafted',
        chapterRefs: [1, 2],
        explorationRefs: [{ documentId: 'doc-9' }]
      },
      { id: 'n2', title: '转折', intent: '守夜人隐瞒钟声真相', status: 'planned', chapterRefs: [3] },
      { id: 'n3', title: '悬念', intent: '钟声在无人时再响', status: 'exploring' }
    ],
    edges: [
      { id: 'e1', kind: 'causes', fromNodeId: 'n1', toNodeId: 'n2', note: '钟停引出隐瞒' },
      { id: 'e2', kind: 'foreshadows', fromNodeId: 'n1', toNodeId: 'n3', note: '开篇停摆是伏笔' },
      { id: 'e3', kind: 'alternative', fromNodeId: 'n2', toNodeId: 'n3' },
      { id: 'e4', kind: 'parallel', fromNodeId: 'n2', toNodeId: 'n1' },
      { id: 'e5', kind: 'causes', fromNodeId: 'n1', toNodeId: 'n1' }
    ]
  }
}

function ledgerFixture() {
  return {
    facts: [
      {
        id: 'f1',
        subjectKey: '旧钟楼',
        subjectLabel: '旧钟楼',
        predicate: '停摆',
        object: '每天三更停摆一刻',
        validity: { from: 2, to: 5 }
      },
      {
        id: 'f2',
        subjectKey: '守夜人',
        predicate: '隐瞒',
        object: '钟声真相',
        validInterval: {
          timelineId: 't1',
          start: { eraId: 'e1', ordinal: 1 },
          end: { eraId: 'e1', ordinal: 3 },
          endSemantic: 'closed'
        }
      }
    ],
    knowledge: [
      { character: '柯秒', fromEntry: '旧钟楼', kind: 'event', atSpan: { from: 2, to: 5 } },
      { who: '守夜人', fromEntry: '旧钟楼', kind: 'setting' },
      { fromEntry: '旧钟楼', kind: 'event' }
    ]
  }
}

const SENTENCE = `${'甲'.repeat(95)}钟声一响。`

function chaptersFixture() {
  return {
    chapters: [
      {
        no: 1,
        title: '钟停',
        path: 'chapters/001.md',
        text: Array.from({ length: 4 }, () => SENTENCE).join('\n\n')
      },
      {
        no: 2,
        title: '守夜',
        path: 'chapters/002.md',
        text: Array.from({ length: 3 }, () => SENTENCE).join('\n\n')
      },
      { no: 3, title: '空白', path: 'chapters/003.md', text: '   ' }
    ]
  }
}

function fullInput() {
  return {
    worldStore: worldStoreFixture(),
    outline: outlineFixture(),
    ledger: ledgerFixture(),
    chapters: chaptersFixture()
  }
}

function byName(entries) {
  return new Map(entries.map((entry) => [entry.name, entry]))
}

test('路径 1：worldStore 条目 → worldview（分类归槽、keys→aliases、Host 字段留 next 快照）', () => {
  const report = migrateWorldStore(worldStoreFixture(), OPTIONS)
  assert.equal(report.ok, true)
  assert.equal(report.issues.length, 0)
  assert.equal(report.entries.length, 5)

  const entries = byName(report.entries)
  const keMiao = entries.get('柯秒')
  assert.equal(keMiao.layer, 'worldview')
  assert.equal(keMiao.slot, 'roles')
  assert.equal(keMiao.status, MIGRATED_STATUS)
  assert.equal(keMiao.provenance.mode, 'author')
  assert.deepEqual(keMiao.aliases, ['秒子', '柯', '小秒'])
  assert.equal(keMiao.definition, '主线主角，能听见钟声里的低语。')
  assert.equal(keMiao.next.worldbook.injection.group, '人物')
  assert.equal(keMiao.next.worldbook.content, '柯秒从小在钟楼脚下长大。')
  assert.equal(keMiao.rank, undefined)

  const characterRelation = keMiao.relations.find((relation) => relation.to === '守夜人')
  assert.equal(characterRelation.type, 'related')
  assert.equal(characterRelation.how, '世界书关系·characters')

  assert.equal(entries.get('守夜人').slot, 'roles')
  const rival = entries.get('守夜人').relations[0]
  assert.deepEqual({ to: rival.to, type: rival.type, how: rival.how }, { to: '柯秒', type: 'rival', how: '互相提防' })
  assert.equal(entries.get('停摆规则').slot, 'rules')
  assert.equal(entries.get('旧钟楼').slot, 'locations')

  const anecdote = entries.get('轶事')
  assert.equal(anecdote.slot, 'other')
  assert.ok(report.losses.some((loss) => loss.code === 'worldStore-category-unmapped' && loss.entry === '轶事'))
  assert.ok(report.warnings.some((warning) => warning.code === 'RANK_ON_UNORDERED_SLOT'))

  for (const entry of report.entries) {
    assert.equal(entry.schema, FACT_SCHEMA)
    assert.equal(entry.status, MIGRATED_STATUS)
    assert.equal(validateFactEntry(entry).ok, true)
  }
})

test('路径 2：大纲 nodes/edges → plot 事件图（causal/setup/alternative/parallel 四类边）', () => {
  const report = migrateOutline(outlineFixture(), OPTIONS)
  assert.equal(report.ok, true)
  assert.equal(report.entries.length, 3)

  const entries = byName(report.entries)
  const start = entries.get('开端')
  assert.equal(start.layer, 'plot')
  assert.equal(start.status, MIGRATED_STATUS)
  assert.deepEqual(start.validity, { from: 1, to: 2 })
  assert.equal(start.span.chapter_count, 2)
  assert.equal(start.next.outline.explorationRefs[0], 'doc-9')

  const relationTypes = start.relations.map((relation) => `${relation.type}->${relation.to}`).sort()
  assert.deepEqual(relationTypes, ['causal->转折', 'setup->悬念'])

  const hypothesis = start.events.find((event) => event.track === 'hypothesis')
  assert.ok(hypothesis)
  assert.equal(hypothesis.payoffSuggestion.to, '悬念')
  assert.equal(hypothesis.setup.edgeId, 'e2')
  assert.deepEqual(hypothesis.refs, ['悬念'])
  assert.equal(start.events.filter((event) => event.track === 'fact').length, 1)

  const turn = entries.get('转折')
  const turnRelations = turn.relations.map((relation) => `${relation.type}->${relation.to}`).sort()
  assert.deepEqual(turnRelations, ['alternative->悬念', 'parallel->开端'])

  const lossCodes = report.losses.map((loss) => loss.code)
  assert.ok(lossCodes.includes('outline-edge-dropped'))
  assert.ok(lossCodes.includes('outline-payoff-suggestion-only'))
  assert.ok(lossCodes.includes('outline-alternative-degraded'))
  assert.equal(report.losses.filter((loss) => loss.code === 'outline-edge-dropped').length, 1)

  for (const entry of report.entries) assert.equal(validateFactEntry(entry).ok, true)
})

test('路径 3：账本 v4 → 双时间轴 + 知情矩阵（character.knowledge[]）', () => {
  const report = migrateLedger(ledgerFixture(), OPTIONS)
  assert.equal(report.ok, true)
  assert.equal(report.entries.length, 4)

  const entries = byName(report.entries)
  assert.deepEqual(entries.get('旧钟楼·停摆').validity, { from: 2, to: 5 })
  assert.deepEqual(entries.get('守夜人·隐瞒').validity, { from: 1, to: 3 })
  assert.equal(entries.get('旧钟楼·停摆').provenance.mode, 'author')

  const lossCodes = report.losses.map((loss) => loss.code)
  assert.ok(lossCodes.includes('ledger-story-interval-ordinal-approx'))
  assert.ok(lossCodes.includes('ledger-knowledge-orphan'))

  const keMiao = entries.get('柯秒')
  assert.equal(keMiao.layer, 'character')
  assert.deepEqual(keMiao.knowledge, [
    { fromEntry: '旧钟楼', kind: 'event', atSpan: { from: 2, to: 5 } }
  ])

  const watcher = entries.get('守夜人')
  assert.equal(watcher.layer, 'character')
  assert.deepEqual(watcher.knowledge, [
    { fromEntry: '旧钟楼', kind: 'setting', atSpan: { from: null, to: null } }
  ])

  for (const entry of report.entries) {
    assert.equal(entry.status, MIGRATED_STATUS)
    assert.equal(validateFactEntry(entry).ok, true)
  }
})

test('路径 4：章节正文 → 100–300 字场景骨架（pipelinePending，不迁原文）', () => {
  const report = migrateChapters(chaptersFixture(), OPTIONS)
  assert.equal(report.ok, true)
  assert.equal(report.entries.length, 2)

  const entries = byName(report.entries)
  const firstChapter = entries.get('第1章·场景骨架')
  assert.equal(firstChapter.pipelinePending, true)
  assert.equal(firstChapter.events.length, 4)
  assert.equal(firstChapter.span.scene_count, 4)
  assert.deepEqual(firstChapter.validity, { from: 1, to: 1 })
  assert.match(firstChapter.provenance.quote_hash, /^[0-9a-f]{40}$/u)
  for (const event of firstChapter.events) {
    assert.equal(event.segments.length, 1)
    assert.equal(event.segments[0].chars, 100)
  }
  assert.equal(entries.get('第2章·场景骨架').events.length, 3)

  assert.ok(report.warnings.some((warning) => warning.code === 'CHAPTER_EMPTY' && warning.chapterNo === 3))
  assert.ok(report.warnings.some((warning) => warning.code === 'PIPELINE_PENDING'))
  assert.equal(report.losses.filter((loss) => loss.code === 'chapter-prose-outside-fact').length, 2)

  for (const entry of report.entries) assert.equal(validateFactEntry(entry).ok, true)
})

test('编排器：四路径全迁、proposed 落位、条目过信封校验并写入注入 store', async () => {
  const store = createMemoryFactStore()
  const report = await migrateLegacy(fullInput(), { ...OPTIONS, store })

  assert.equal(report.ok, true)
  assert.equal(report.dryRun, false)
  assert.deepEqual(report.paths.map((path) => path.path), ['worldStore', 'outline', 'ledger', 'chapters'])
  assert.equal(report.wouldMigrate, 14)
  assert.equal(report.entries.length, 14)
  assert.equal(report.saved.length, 14)
  assert.ok(report.saved.every((item) => item.ok === true))
  assert.ok(report.warnings.every((warning) => warning.code !== 'DUPLICATE_ENTRY_ID'))

  for (const entry of report.entries) {
    assert.equal(entry.status, MIGRATED_STATUS)
    assert.equal(entry.schema, FACT_SCHEMA)
    assert.equal(validateFactEntry(entry).ok, true)
  }

  const stored = await store.list()
  assert.equal(stored.total, 14)
  for (const item of stored.entries) {
    assert.equal(item.entry.status, MIGRATED_STATUS)
    assert.equal(item.entry.provenance.mode, 'author')
  }
})

test('dryRun=true：完整报告但不发生任何写入（store 一次都没被调用）', async () => {
  const calls = []
  const spyStore = {
    version: 'spy',
    async get(...args) {
      calls.push(['get', ...args])
      return null
    },
    async list(...args) {
      calls.push(['list', ...args])
      return { entries: [], total: 0 }
    },
    async save(...args) {
      calls.push(['save', ...args])
      throw new Error('dryRun 不应写库')
    },
    async remove(...args) {
      calls.push(['remove', ...args])
      throw new Error('dryRun 不应写库')
    }
  }

  const report = await migrateLegacy(fullInput(), { ...OPTIONS, store: spyStore, dryRun: true })
  assert.equal(report.dryRun, true)
  assert.equal(report.wouldMigrate, 14)
  assert.equal(report.entries.length, 14)
  assert.deepEqual(report.saved, [])
  assert.equal(calls.length, 0)
  assert.equal(report.paths.length, 4)
  assert.ok(report.losses.length > 0)
})

test('幂等重跑：同一 fixture 第二次 saved 全 duplicate，库内 diff=0', async () => {
  const store = createMemoryFactStore()
  const first = await migrateLegacy(fullInput(), { ...OPTIONS, store })
  const statsAfterFirst = store.stats()
  const listingAfterFirst = await store.list()

  const second = await migrateLegacy(fullInput(), { ...OPTIONS, store })

  assert.deepEqual(second.entries, first.entries)
  assert.equal(second.wouldMigrate, first.wouldMigrate)
  assert.equal(second.saved.length, first.saved.length)
  assert.ok(second.saved.every((item) => item.duplicate === true))
  assert.ok(second.warnings.every((warning) => warning.code !== 'STATUS_TRANSITION_BLOCKED'))

  const statsAfterSecond = store.stats()
  assert.equal(statsAfterSecond.entries, statsAfterFirst.entries)
  assert.equal(statsAfterSecond.writes, statsAfterFirst.writes)
  assert.deepEqual(await store.list(), listingAfterFirst)

  const third = await migrateLegacy(fullInput(), { ...OPTIONS, store, dryRun: true })
  assert.deepEqual(third.entries, first.entries)
  assert.deepEqual(third.saved, [])
})
