import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFactFileStore, FACT_DIR_NAME } from '../kernel/factFileStore.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { stableEntryId } from '../fact/domain/pediaSchema.js'

/**
 * factFileStore（S1 · WO-S1-01 ＋ S2 写协议）用例：多文件合并、过滤、分页、坏档不整体失败、
 * get/搜索、save/remove 真落盘（writeFactFile：upsert／删除／revision／幂等）。全部在 os.tmpdir()
 * 里造假档，不碰作者真实拆解库。
 */

function worldbookEntry({ name = '停摆的表', id, status = 'draft', aliases = ['表'], relations = [{ to: '柯秒', type: 'related' }] } = {}) {
  const layer = 'worldview'
  const domain = '停摆之城'
  const slot = 'items'
  return {
    schema: 'fact.data/v3',
    id: id ?? stableEntryId({ layer, domain, slot, name }),
    layer,
    name,
    domain,
    slot,
    status,
    definition: '一只停在雪夜十一点的表，表匠说它从没走过。',
    aliases,
    relations,
    fingerprint: { vec: null, metrics: { chars: 22 } },
    provenance: { mode: 'analyze', book: '停摆之城', book_id: 'book-tower', chapters: [2], scenes: [], extractor: 'test-extractor' }
  }
}

function characterEntry({ name = '柯秒', id } = {}) {
  const layer = 'character'
  const domain = '停摆之城'
  return {
    schema: 'fact.data/v3',
    id: id ?? stableEntryId({ layer, domain, slot: '', name }),
    layer,
    name,
    domain,
    status: 'proposed',
    identity: '雪夜醒来的主角',
    aliases: ['秒子'],
    fingerprint: { vec: null, metrics: { chars: 6 } },
    provenance: { mode: 'analyze', book: '停摆之城', book_id: 'book-tower', chapters: [1], scenes: [], extractor: 'test-extractor' }
  }
}

function plotEntry({ name = '第1章·雨夜', id } = {}) {
  const layer = 'plot'
  const domain = '停摆之城'
  return {
    schema: 'fact.data/v3',
    id: id ?? stableEntryId({ layer, domain, slot: '', name }),
    layer,
    name,
    domain,
    status: 'draft',
    notes: '雨夜，表停了。',
    events: [{ who: '柯秒', channel: 'state', content: '雨落进巷子，表停在十一点。', index: 1 }],
    fingerprint: { vec: null, metrics: { chars: 13 } },
    provenance: { mode: 'analyze', book: '停摆之城', book_id: 'book-tower', chapters: [1], scenes: [], extractor: 'test-extractor' }
  }
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'pinax-fact-store-'))
  const dir = join(root, FACT_DIR_NAME)
  await mkdir(dir, { recursive: true })
  const tower = { book: { id: 'book-tower', title: '停摆之城' }, revision: 7, entries: [worldbookEntry(), characterEntry()] }
  const other = { book: { id: 'book-rain', title: '雨夜短篇' }, revision: 3, entries: [plotEntry()] }
  await writeFile(join(dir, 'a.json'), JSON.stringify(tower), 'utf-8')
  await writeFile(join(dir, 'b.json'), JSON.stringify(other), 'utf-8')
  await writeFile(join(dir, 'c-broken.json'), '{ 这不是 JSON', 'utf-8')
  return { root, dir }
}

test('factFileStore：多文件合并＋坏档只进 warnings，不整体失败', async () => {
  const { root } = await makeFixture()
  try {
    const store = createFactFileStore({ root })
    const result = store.list()
    assert.equal(result.ok, true)
    assert.equal(result.total, 3, '两个可读文件 2+1 条')
    assert.equal(result.entries.length, 3)
    // 溯源字段来自各文件顶层 book
    const tower = result.entries.find((entry) => entry.name === '停摆的表')
    const rain = result.entries.find((entry) => entry.name === '第1章·雨夜')
    assert.equal(tower.bookId, 'book-tower')
    assert.equal(tower.bookName, '停摆之城')
    assert.equal(tower.sourceFile, 'a.json', '溯源只给文件名，不给绝对路径')
    assert.equal(rain.bookId, 'book-rain')
    assert.equal(rain.bookName, '雨夜短篇')
    // 坏档只记一条 warning（code＋file），不让整次 list 失败
    assert.equal(result.warnings.length, 1)
    assert.equal(result.warnings[0].code, 'FACT_FILE_UNREADABLE')
    assert.match(result.warnings[0].file, /c-broken\.json/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('factFileStore：过滤在分页前，分页在合并后；total＝过滤后条数', async () => {
  const { root } = await makeFixture()
  try {
    const store = createFactFileStore({ root })
    const byLayer = store.list({ layer: 'worldview' })
    assert.equal(byLayer.total, 1)
    assert.equal(byLayer.entries[0].name, '停摆的表')

    const byStatus = store.list({ status: 'proposed' })
    assert.equal(byStatus.total, 1)
    assert.equal(byStatus.entries[0].name, '柯秒')

    const page = store.list({ offset: 1, limit: 1 })
    assert.equal(page.total, 3, 'total 是过滤后的总数，不是当前页长度')
    assert.equal(page.entries.length, 1)

    const beyond = store.list({ offset: 10, limit: 5 })
    assert.equal(beyond.total, 3)
    assert.equal(beyond.entries.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('factFileStore：get 带来源文件 revision；查无条目是 FACT_NOT_FOUND', async () => {
  const { root } = await makeFixture()
  try {
    const store = createFactFileStore({ root })
    const entry = worldbookEntry()
    const got = store.get({ id: entry.id })
    assert.equal(got.ok, true)
    assert.equal(got.entry.name, '停摆的表')
    assert.equal(got.revision, 7, 'a.json 顶层 revision')

    const missing = store.get({ id: 'ffffffffffff' })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, NEXT_ERROR_CODES.FACT_NOT_FOUND)
    assert.ok(missing.error.message.includes('ffffffffffff'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('factFileStore：目录不存在＝空清单＋warning（普通项目回落用），不是错误', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pinax-fact-empty-'))
  try {
    const store = createFactFileStore({ root })
    const result = store.list()
    assert.equal(result.ok, true)
    assert.equal(result.total, 0)
    assert.deepEqual(result.entries, [])
    assert.equal(result.warnings.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('factFileStore：save 真落盘（按 id upsert）；坏信封回 VALIDATION_FAILED 且不写盘', async () => {
  const { root, dir } = await makeFixture()
  try {
    const store = createFactFileStore({ root })
    const entry = worldbookEntry()
    const saved = await store.save({ entry, bookId: 'a', operationId: 'save-1' })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal(saved.duplicate, false)
    assert.equal(saved.revision, 8, 'a.json 原第 7 版 → 写后第 8 版')
    assert.equal(saved.bookId, 'a', '文件 id 由调用方显式给出（拆解/<id>.json）')

    const got = store.get({ id: entry.id })
    assert.equal(got.ok, true)
    assert.equal(got.revision, 8, 'get 回的 revision 随写协议成立（就是最新版）')
    assert.equal(got.entry.definition, entry.definition)

    // 原文件其余字段照旧（不整份重建），只多了 revision／updatedAt 的刷新
    const after = JSON.parse(await readFile(join(dir, 'a.json'), 'utf-8'))
    assert.equal(after.book.title, '停摆之城')
    assert.equal(after.entries.length, 2, 'upsert 命中同 id：替换不追加')

    const invalid = await store.save({ bookId: 'a', entry: { schema: 'fact.data/v3', layer: 'worldview', name: '' }, operationId: 'save-2' })
    assert.equal(invalid.ok, false)
    // S2 起写协议失败码按 FactStore 端口：VALIDATION_FAILED（S1 的 INVALID_ENTRY／
    // WRITE_PROTOCOL_NOT_STARTED 随写协议开闸退役——写不进去就走端口码）。
    assert.equal(invalid.error.code, 'VALIDATION_FAILED')
    assert.ok(Array.isArray(invalid.error.details.errors) && invalid.error.details.errors.length > 0)

    // 坏信封不写盘：a.json 的 revision 仍是 8
    const untouched = JSON.parse(await readFile(join(dir, 'a.json'), 'utf-8'))
    assert.equal(untouched.revision, 8)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('factFileStore：remove 真删除（按 id），一条都没删到回 NOT_FOUND', async () => {
  const { root } = await makeFixture()
  try {
    const store = createFactFileStore({ root })
    const removed = await store.remove({ id: worldbookEntry().id, bookId: 'a', operationId: 'remove-1' })
    assert.equal(removed.ok, true, JSON.stringify(removed))
    assert.equal(store.get({ id: worldbookEntry().id }).ok, false)
    assert.equal(store.list().total, 2)

    const missing = await store.remove({ id: 'ffffffffffff', bookId: 'a', operationId: 'remove-2' })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'NOT_FOUND')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('factFileStore：list/get 不吐 wiki（兄弟 wiki.json 与旧信封两种来源都隔离）', async () => {
  const { root, dir } = await makeFixture()
  try {
    // 存量形态：wiki 在信封里
    const legacy = { book: { id: 'book-wiki', title: '旧信封' }, revision: 2, entries: [plotEntry({ name: '第9章·旧' })], wiki: { version: 'wiki-enrich@3' } }
    await writeFile(join(dir, 'legacy.json'), JSON.stringify(legacy), 'utf-8')
    // S2 形态：兄弟文件（list 必须把它当派生档跳过，不混进清单）
    await writeFile(join(dir, 'legacy.wiki.json'), JSON.stringify({ derivedFrom: { factRevision: 1, schema: 'pinax-wiki-derived@1' }, version: 'wiki-enrich@3' }), 'utf-8')

    const store = createFactFileStore({ root })
    const listed = store.list()
    assert.equal(listed.ok, true)
    assert.equal(listed.total, 4, '2(a)＋1(b)＋1(legacy)；wiki.json 不算一份拆解')
    assert.ok(listed.entries.every((entry) => !('wiki' in entry)), 'list 的条目里没有 wiki 段')
    const got = store.get({ id: plotEntry({ name: '第9章·旧' }).id })
    assert.equal(got.ok, true)
    assert.ok(!('wiki' in got.entry))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('factFileStore：search 打分 name 3／keys 2／summary 1，snippet 取首命中前后', async () => {
  const { root } = await makeFixture()
  try {
    const store = createFactFileStore({ root })
    const byName = store.search({ q: '停摆' })
    assert.equal(byName.ok, true)
    assert.equal(byName.hits[0].name, '停摆的表')
    assert.ok(byName.hits[0].score >= 3)
    assert.match(byName.hits[0].snippet, /停摆/)

    // 只命中别名（秒子）：2 分一档
    const byKey = store.search({ q: '秒子' })
    assert.equal(byKey.ok, true)
    assert.equal(byKey.hits[0].name, '柯秒')
    assert.equal(byKey.hits[0].score, 2)

    // 只命中 summary（definition）：1 分一档
    const bySummary = store.search({ q: '表匠' })
    assert.equal(bySummary.ok, true)
    assert.equal(bySummary.hits[0].name, '停摆的表')
    assert.equal(bySummary.hits[0].score, 1)

    const empty = store.search({ q: '   ' })
    assert.equal(empty.ok, false)
    assert.equal(empty.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/**
 * 真实拆解文件抽检（env 夹具制）：PINAX_FACT_FIXTURE=/path/to/拆解 才跑，没设就 skip。
 * 判据：list 的总数＝目录里所有可读拆解文件 entries.length 之和（坏档／无 entries 的旁路文件不计）。
 */
test('factFileStore：真实拆解目录只读抽检（PINAX_FACT_FIXTURE）', async (t) => {
  const fixture = String(process.env.PINAX_FACT_FIXTURE ?? '').trim()
  if (!fixture) {
    t.skip('没有 PINAX_FACT_FIXTURE：真实拆解库抽检跳过（不把绝对路径写死进测试）')
    return
  }
  const dir = fixture.endsWith(FACT_DIR_NAME) || existsSync(join(fixture, FACT_DIR_NAME)) === false
    ? fixture
    : join(fixture, FACT_DIR_NAME)
  if (!existsSync(dir)) {
    t.skip(`PINAX_FACT_FIXTURE 指向的目录不存在：${dir}`)
    return
  }
  let expected = 0
  for (const name of await readdir(dir)) {
    if (!name.toLowerCase().endsWith('.json')) continue
    try {
      const document = JSON.parse(await readFile(join(dir, name), 'utf-8'))
      if (Array.isArray(document?.entries)) expected += document.entries.length
    } catch {
      // 坏档不计——与 store 的警告口径一致
    }
  }
  const store = createFactFileStore({ root: join(dir, '..') })
  const result = store.list()
  assert.equal(result.ok, true)
  assert.equal(result.total, expected, '总数＝各文件 entries.length 之和')
})
