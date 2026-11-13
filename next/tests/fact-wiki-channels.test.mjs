import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'
import {
  createFactFileStore,
  FACT_DIR_NAME,
  OPERATIONS_LOG_NAME,
  WIKI_DERIVED_SCHEMA
} from '../kernel/factFileStore.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'

/**
 * wiki 两通道（S4 · WO-S4-01）：fact:wiki:get 只读、fact:wiki:derive 零模型派生并落
 * `拆解/<id>.wiki.json`（derivedFrom 记写前 revision，主 JSON 永远不带 wiki）。
 * 全部在 os.tmpdir() 里造目录，不碰作者真实拆解库。
 */

const BOOK_ID = 'book-tower'

function plot(name, seg, who = ['柯秒']) {
  return {
    schema: 'fact.data/v3',
    id: `plot-${name}`,
    layer: 'plot',
    name,
    domain: '停摆之城',
    validity: { from: 1, to: 1 },
    who,
    events: [{ who: who[0], channel: 'say', content: '雪夜里钟停了。', segments: [{ index: seg }] }],
    relations: []
  }
}

function entries() {
  return [
    plot('雪夜', 1, ['柯秒', '钟楼']),
    plot('修表', 100, ['柯秒', '钟楼']),
    plot('停摆', 200, ['柯秒', '钟楼']),
    plot('归来', 300, ['柯秒', '钟楼']),
    { schema: 'fact.data/v3', id: 'char-ke', layer: 'character', name: '柯秒', domain: '停摆之城', identity: '钟表匠' },
    { schema: 'fact.data/v3', id: 'char-tower', layer: 'character', name: '钟楼', domain: '停摆之城' }
  ]
}

async function makeRoot({ wiki = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pinax-fact-wiki-'))
  await mkdir(join(root, FACT_DIR_NAME), { recursive: true })
  await mkdir(join(root, '正文'), { recursive: true })
  const document = {
    book: { id: BOOK_ID, title: '停摆之城' },
    source: { file: '停摆之城.txt', chars: 6600 },
    revision: 2,
    entries: entries()
  }
  if (wiki) document.wiki = wiki
  await writeFile(join(root, FACT_DIR_NAME, `${BOOK_ID}.json`), `${JSON.stringify(document, null, 2)}\n`, 'utf-8')
  await writeFile(join(root, '正文', '停摆之城.txt'), '第1章 相亲\n雪夜里钟停了。\n', 'utf-8')
  return root
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf-8'))
}

function harness({ factStoreFor = null } = {}) {
  const session = {
    kernel: {},
    registry: null,
    project: null,
    runtime: null,
    view: null,
    lastFailure: null,
    projectRoot: null
  }
  return createIpcDispatcher({ session, factStoreFor })
}

test('wiki 两通道：名字按既有族钉死，都在 pinax:agent: 命名空间', () => {
  assert.equal(IPC_CHANNELS.factWikiGet, 'pinax:agent:fact:wiki:get')
  assert.equal(IPC_CHANNELS.factWikiDerive, 'pinax:agent:fact:wiki:derive')
})

test('store.wikiGet：没有 wiki 回 ok＋wiki:null；存量信封里的 wiki 照常读出（两代兼容）', async () => {
  const plain = await makeRoot()
  try {
    const store = createFactFileStore({ root: plain })
    const empty = store.wikiGet({ bookId: BOOK_ID })
    assert.equal(empty.ok, true)
    assert.equal(empty.wiki, null)
    assert.equal(empty.derivedFrom, null)
  } finally {
    await rm(plain, { recursive: true, force: true })
  }

  const legacy = await makeRoot({ wiki: { storySummary: '旧信封里的梗概', slots: { gimmick: '停摆' } } })
  try {
    const store = createFactFileStore({ root: legacy })
    const read = store.wikiGet({ bookId: BOOK_ID })
    assert.equal(read.ok, true)
    assert.equal(read.wiki.storySummary, '旧信封里的梗概')
    assert.equal(read.derivedFrom, null, '信封没有 derivedFrom')
  } finally {
    await rm(legacy, { recursive: true, force: true })
  }
})

test('store.wikiDerive：零模型派生落兄弟 wiki.json——derivedFrom 记写前 revision，主 JSON 不带 wiki', async () => {
  const root = await makeRoot()
  try {
    const store = createFactFileStore({ root })
    const derived = await store.wikiDerive({ bookId: BOOK_ID })
    assert.equal(derived.ok, true, JSON.stringify(derived))
    assert.equal(derived.revision, 3, '写前 revision=2，写后自增到 3')
    assert.equal(derived.derivedFrom.factRevision, 2)
    assert.equal(derived.derivedFrom.schema, WIKI_DERIVED_SCHEMA)
    assert.equal(derived.wiki.pseudoChapters, true)
    assert.equal(derived.wiki.chapters.length, 4)
    assert.deepEqual(derived.wiki.chapters.map((chapter) => chapter.title).slice(0, 1), ['第1章 相亲'])

    const sibling = join(root, FACT_DIR_NAME, `${BOOK_ID}.wiki.json`)
    assert.ok(existsSync(sibling), '兄弟 wiki.json 必须落盘')
    const sidecar = await readJson(sibling)
    assert.equal(sidecar.derivedFrom.factRevision, 2)
    assert.equal(sidecar.derivedFrom.schema, WIKI_DERIVED_SCHEMA)
    assert.ok(Array.isArray(sidecar.characters))

    const main = await readJson(join(root, FACT_DIR_NAME, `${BOOK_ID}.json`))
    assert.equal(main.revision, 3)
    assert.equal(Object.prototype.hasOwnProperty.call(main, 'wiki'), false, '主 JSON 永远不带 wiki')

    const readBack = store.wikiGet({ bookId: BOOK_ID })
    assert.equal(readBack.ok, true)
    assert.deepEqual(readBack.wiki, derived.wiki, 'get 回读与 derive 返回逐字一致')
    assert.deepEqual(readBack.derivedFrom, derived.derivedFrom)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store.wikiDerive：连跑两次 revision 单调递增，operations 日志每次一条', async () => {
  const root = await makeRoot()
  try {
    const store = createFactFileStore({ root })
    const first = await store.wikiDerive({ bookId: BOOK_ID })
    const second = await store.wikiDerive({ bookId: BOOK_ID })
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(second.revision, first.revision + 1)
    assert.equal(second.derivedFrom.factRevision, first.revision)
    assert.deepEqual(second.wiki, first.wiki, '再派生不漂：输入未变，输出逐字一致')

    const log = await readFile(join(root, FACT_DIR_NAME, OPERATIONS_LOG_NAME), 'utf-8')
    const records = log.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line))
    assert.equal(records.length, 2)
    for (const record of records) {
      assert.equal(record.outcome, 'applied')
      assert.match(record.operationId, /^wiki-derive-/u)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store.wikiDerive：没有拆解文件回 FACT_NOT_FOUND，不凭空造档', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pinax-fact-wiki-missing-'))
  try {
    const store = createFactFileStore({ root })
    const result = await store.wikiDerive({ bookId: 'nope' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, NEXT_ERROR_CODES.FACT_NOT_FOUND)
    assert.equal(existsSync(join(root, FACT_DIR_NAME, 'nope.wiki.json')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fact:wiki:get / fact:wiki:derive 通道级：显式收 root，注入 store 后调通', async () => {
  const root = await makeRoot()
  try {
    const dispatcher = harness({ factStoreFor: (value) => createFactFileStore({ root: value }) })

    const before = await dispatcher.dispatch(IPC_CHANNELS.factWikiGet, { root, bookId: BOOK_ID })
    assert.equal(before.ok, true)
    assert.equal(before.wiki, null)

    const derived = await dispatcher.dispatch(IPC_CHANNELS.factWikiDerive, { root, bookId: BOOK_ID })
    assert.equal(derived.ok, true)
    assert.equal(derived.derivedFrom.schema, WIKI_DERIVED_SCHEMA)
    assert.ok(Array.isArray(derived.wiki.chapters))

    const after = await dispatcher.dispatch(IPC_CHANNELS.factWikiGet, { root, bookId: BOOK_ID })
    assert.equal(after.ok, true)
    assert.deepEqual(after.wiki, derived.wiki)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fact:wiki:*：未注入 factStoreFor／缺 root／缺 bookId 都如实报缺', async () => {
  const noStore = harness()
  for (const channel of [IPC_CHANNELS.factWikiGet, IPC_CHANNELS.factWikiDerive]) {
    const unwired = await noStore.dispatch(channel, { root: 'D:/books/拆解书', bookId: BOOK_ID })
    assert.equal(unwired.ok, false)
    assert.equal(unwired.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  }

  const root = await makeRoot()
  try {
    const dispatcher = harness({ factStoreFor: (value) => createFactFileStore({ root: value }) })
    const missingRoot = await dispatcher.dispatch(IPC_CHANNELS.factWikiGet, { bookId: BOOK_ID })
    assert.equal(missingRoot.ok, false)
    assert.match(missingRoot.error.message, /root/u)
    const missingBook = await dispatcher.dispatch(IPC_CHANNELS.factWikiGet, { root })
    assert.equal(missingBook.ok, false)
    assert.match(missingBook.error.message, /bookId/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
