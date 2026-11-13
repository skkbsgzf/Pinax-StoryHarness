import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worldbookToHub } from '../wikihub/convert.mjs'
import { factEntriesToHub, factEntriesToBoardEntries } from '../shell/factEntriesToHub.mjs'
import { stableEntryId } from '../fact/domain/pediaSchema.js'

/**
 * factEntriesToHub（S1 · WO-S1-03）用例：
 *   1) 同一个条目走「手写 md → hub」与「fact v3 → hub」两条路，核心字段 deepEqual；
 *      差异只允许出现在 v3 新增字段（status/provenance.chapters/next.fact）。
 *   2) 条目数与映射一致（同一本书两条路径条数相同）。
 *   3) 看板投影（factEntriesToBoardEntries）是 EntriesBoard 认的运行时形状，且不丢 v3 真值。
 */

const BOOK = '停摆之城'
const DOMAIN = '停摆之城'
const SLOT = 'items'
const NAME = '停摆的表'
const DEFINITION = '一只停在雪夜十一点的表，表匠说它从没走过。'
const CONTENT = '一只停在雪夜十一点的表。'
const ID = stableEntryId({ layer: 'worldview', domain: DOMAIN, slot: SLOT, name: NAME })

/** 手写世界书条目（运行时读回形状 + 建档字段；世界书那条路径的输入）。 */
function worldbookInput() {
  return {
    id: 'wb-1',
    name: NAME,
    title: NAME,
    kind: 'item',
    type: 'item',
    cat: ['资料'],
    catDir: '资料',
    tags: [],
    keys: ['表'],
    summary: DEFINITION,
    content: CONTENT,
    relations: [{ to: '柯秒', type: 'related', stance: '旧主' }],
    chars: CONTENT.length,
    path: '世界书/资料/停摆的表.md',
    revision: 1,
    contract: true
  }
}

/** 同一条目的 fact v3 形状（拆解器的产出；id 与 stableEntryId 一致）。 */
function factInput() {
  return {
    schema: 'fact.data/v3',
    id: ID,
    layer: 'worldview',
    name: NAME,
    domain: DOMAIN,
    slot: SLOT,
    status: 'draft',
    definition: DEFINITION,
    aliases: ['表'],
    relations: [{ to: '柯秒', type: 'related', stance: '旧主' }],
    fingerprint: { vec: null, metrics: { chars: CONTENT.length } },
    provenance: {
      mode: 'analyze',
      book: BOOK,
      book_id: 'book-tower',
      chapters: [2],
      scenes: [],
      extractor: 'fact-chain/v1'
    },
    bookId: 'book-tower',
    bookName: BOOK,
    sourceFile: 'tower.json',
    revision: 4
  }
}

function relationCore(relations) {
  return (Array.isArray(relations) ? relations : []).map((relation) => ({
    to: relation.to,
    type: relation.type ?? '',
    how: relation.how ?? ''
  }))
}

/** 两条路径的「同一件事」：id/layer/slot/域/名/别名/定义/状态/统计/关系核心。 */
function coreOf(entry) {
  return {
    id: entry.id,
    layer: entry.layer,
    slot: entry.slot ?? '',
    domain: entry.domain,
    name: entry.name,
    aliases: [...(entry.aliases ?? [])].sort(),
    definition: entry.definition,
    status: entry.status,
    rank: entry.rank ?? null,
    stats: {
      chars: entry.stats?.chars ?? 0,
      keys: entry.stats?.keys ?? 0,
      relations: entry.stats?.relations ?? 0
    },
    relations: relationCore(entry.relations)
  }
}

test('适配器：同一章节条目，md→hub 与 fact→hub 核心字段 deepEqual（差异只在 v3 新增字段）', () => {
  const mdHub = worldbookToHub([worldbookInput()], { book: BOOK, domain: DOMAIN })
  const factHub = factEntriesToHub([factInput()], { book: BOOK })
  assert.equal(mdHub.ok, true)
  assert.equal(factHub.ok, true)
  assert.equal(mdHub.entries.length, 1)
  assert.equal(factHub.entries.length, 1)
  assert.deepEqual(coreOf(factHub.entries[0]), coreOf(mdHub.entries[0]))
})

test('适配器：输出与 worldbookToHub 同形（信封键逐一对齐）', () => {
  const mdHub = worldbookToHub([worldbookInput()], { book: BOOK, domain: DOMAIN })
  const factHub = factEntriesToHub([factInput()], { book: BOOK })
  const mdKeys = Object.keys(mdHub).sort()
  const factKeys = Object.keys(factHub).sort()
  for (const key of mdKeys) assert.ok(factKeys.includes(key), `适配器缺 worldbookToHub 的 ${key}`)
  assert.deepEqual(factHub.index.nameToId, { [NAME]: ID })
  assert.equal(factHub.mappings[0].via, 'fact-entry')
  assert.equal(factHub.mappings[0].chapters[0], 2)
})

test('适配器：v3 新增字段只在 fact 路径出现（status 真值／来源章节／关系数）', () => {
  const factHub = factEntriesToHub([factInput()], { book: BOOK })
  const entry = factHub.entries[0]
  assert.equal(entry.status, 'draft')
  assert.deepEqual(entry.provenance.chapters, [2])
  assert.equal(entry.next.medium, 'fact')
  assert.equal(entry.next.fact.relationsCount, 1)
  assert.equal(entry.next.fact.status, 'draft')
  assert.equal(entry.next.fact.chapters[0], 2)
  assert.equal(entry.next.fact.sourceFile, 'tower.json')
  assert.equal(entry.next.fact.bookId, 'book-tower')
})

test('适配器：条目数一致（多条目同书，两条路径条数相同）', () => {
  const second = {
    ...factInput(),
    id: stableEntryId({ layer: 'worldview', domain: DOMAIN, slot: SLOT, name: '雨夜的巷子' }),
    name: '雨夜的巷子',
    definition: '一条只在下雨时存在的巷子。',
    aliases: [],
    relations: []
  }
  const mdSecond = {
    ...worldbookInput(),
    id: 'wb-2',
    name: '雨夜的巷子',
    title: '雨夜的巷子',
    keys: [],
    summary: '一条只在下雨时存在的巷子。',
    content: '一条只在下雨时存在的巷子。',
    relations: [],
    chars: 12
  }
  const mdHub = worldbookToHub([worldbookInput(), mdSecond], { book: BOOK, domain: DOMAIN })
  const factHub = factEntriesToHub([factInput(), second], { book: BOOK })
  assert.equal(factHub.entries.length, mdHub.entries.length)
})

test('适配器：空名／未知 layer 进 issues，不伪造条目', () => {
  const hub = factEntriesToHub([
    { ...factInput(), name: '' },
    { ...factInput(), id: 'aaaaaaaaaaaa', layer: 'style' }
  ], { book: BOOK })
  assert.equal(hub.entries.length, 0)
  assert.ok(hub.issues.some((item) => item.code === 'ENTRY_WITHOUT_NAME'))
  assert.ok(hub.issues.some((item) => item.code === 'UNKNOWN_LAYER'))
})

test('看板投影：产出 EntriesBoard 认的世界书运行时形状，并保留 v3 真值', () => {
  const entries = factEntriesToBoardEntries([factInput()], { book: BOOK })
  assert.equal(entries.length, 1)
  const entry = entries[0]
  // EntriesBoard 会拿它再走一次 worldbookToHub：name/content/summary/keys/type/cat 都必须在顶层。
  assert.equal(entry.name, NAME)
  assert.equal(entry.content, DEFINITION)
  assert.equal(entry.summary, DEFINITION)
  assert.deepEqual(entry.keys, ['表'])
  assert.equal(entry.type, 'item')
  assert.equal(entry.catDir, '资料')
  assert.equal(entry.contract, true)
  assert.equal(entry.extra.pediaSlot, SLOT)
  // v3 真值随投影走，S3 换版式时不再取一次数
  assert.equal(entry.layer, 'worldview')
  assert.equal(entry.status, 'draft')
  assert.equal(entry.extra.fact.chapters[0], 2)
  assert.equal(entry.extra.fact.relationsCount, 1)

  // 真的能进既有看板转换链：槽位钉子生效，不是全落「其他」
  const hub = worldbookToHub(entries, { book: BOOK })
  assert.equal(hub.entries[0].slot, SLOT)
})

test('看板投影：plot/character 软层按层落组，不冒充 worldview 槽位', () => {
  const character = {
    ...factInput(),
    id: stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name: '柯秒' }),
    layer: 'character',
    name: '柯秒',
    slot: undefined,
    identity: '雪夜醒来的主角',
    aliases: ['秒子'],
    relations: []
  }
  const entries = factEntriesToBoardEntries([character], { book: BOOK })
  const hub = worldbookToHub(entries, { book: BOOK })
  assert.equal(hub.entries.length, 1)
  assert.equal(hub.entries[0].name, '柯秒')
  // 人物组：展示用槽位钉子 roles
  assert.equal(entries[0].extra.pediaSlot, 'roles')
  assert.equal(hub.entries[0].slot, 'roles')
  assert.equal(entries[0].layer, 'character')
})
