import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'
import { createFactFileStore, FACT_DIR_NAME } from '../kernel/factFileStore.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { stableEntryId } from '../fact/domain/pediaSchema.js'

/**
 * fact 四通道（S1 · WO-S1-02 ＋ S2 写协议）：名字钉死、未注入如实报缺、注入后按冻结签名转发；
 * fact:save 自 S2 起真落盘（writeFactFile：upsert＋revision 自增＋operationId 幂等）。
 */

function validEntry() {
  const layer = 'worldview'
  const domain = '停摆之城'
  const slot = 'items'
  const name = '停摆的表'
  return {
    schema: 'fact.data/v3',
    id: stableEntryId({ layer, domain, slot, name }),
    layer,
    name,
    domain,
    slot,
    status: 'draft',
    definition: '一只停在雪夜十一点的表。',
    fingerprint: { vec: null, metrics: { chars: 12 } },
    provenance: { mode: 'analyze', book: '停摆之城', book_id: 'book-tower', chapters: [2], scenes: [], extractor: 'test' }
  }
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

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'pinax-fact-ipc-'))
  const dir = join(root, FACT_DIR_NAME)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'book-tower.json'), JSON.stringify({
    book: { id: 'book-tower', title: '停摆之城' },
    revision: 4,
    entries: [validEntry()]
  }), 'utf-8')
  return root
}

test('fact 四通道：名字按既有一族钉死，都在 pinax:agent: 命名空间', () => {
  assert.equal(IPC_CHANNELS.factList, 'pinax:agent:fact:list')
  assert.equal(IPC_CHANNELS.factGet, 'pinax:agent:fact:get')
  assert.equal(IPC_CHANNELS.factSave, 'pinax:agent:fact:save')
  assert.equal(IPC_CHANNELS.factSearch, 'pinax:agent:fact:search')
  for (const channel of [IPC_CHANNELS.factList, IPC_CHANNELS.factGet, IPC_CHANNELS.factSave, IPC_CHANNELS.factSearch]) {
    assert.ok(channel.startsWith('pinax:agent:'), channel)
  }
})

test('fact 四通道：未注入 factStoreFor 时四条都如实报缺', async () => {
  const dispatcher = harness()
  for (const channel of [IPC_CHANNELS.factList, IPC_CHANNELS.factGet, IPC_CHANNELS.factSave, IPC_CHANNELS.factSearch]) {
    const result = await dispatcher.dispatch(channel, { root: 'D:/books/拆解书' })
    assert.equal(result.ok, false, channel)
    assert.equal(result.error.code, NEXT_ERROR_CODES.INVALID_INPUT, channel)
    assert.match(result.error.message, /未接入/, channel)
  }
})

test('fact 四通道：root 必填；给了 root 才去取 store', async () => {
  const seen = []
  const dispatcher = harness({ factStoreFor: (root) => { seen.push(root); return createFactFileStore({ root }) } })
  const missing = await dispatcher.dispatch(IPC_CHANNELS.factList, {})
  assert.equal(missing.ok, false)
  assert.match(missing.error.message, /root/)
  assert.deepEqual(seen, [])
})

test('fact:list / fact:get / fact:search 在 Node 侧调通，返回冻结的扁平形状', async () => {
  const root = await makeRoot()
  try {
    const dispatcher = harness({ factStoreFor: (value) => createFactFileStore({ root: value }) })
    const listed = await dispatcher.dispatch(IPC_CHANNELS.factList, { root, layer: 'worldview' })
    assert.equal(listed.ok, true)
    assert.equal(listed.total, 1)
    assert.ok(Array.isArray(listed.entries))
    assert.ok(Array.isArray(listed.warnings))
    assert.equal(listed.entries[0].bookName, '停摆之城')

    const got = await dispatcher.dispatch(IPC_CHANNELS.factGet, { root, id: validEntry().id })
    assert.equal(got.ok, true)
    assert.equal(got.entry.name, '停摆的表')
    assert.equal(got.revision, 4)

    const hits = await dispatcher.dispatch(IPC_CHANNELS.factSearch, { root, q: '停摆' })
    assert.equal(hits.ok, true)
    assert.equal(hits.hits[0].name, '停摆的表')
    assert.ok(hits.hits[0].score >= 3)
    assert.ok(hits.hits[0].snippet.includes('停摆'))

    const notFound = await dispatcher.dispatch(IPC_CHANNELS.factGet, { root, id: 'ffffffffffff' })
    assert.equal(notFound.ok, false)
    assert.equal(notFound.error.code, NEXT_ERROR_CODES.FACT_NOT_FOUND)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fact:save 真落盘：upsert 推进 revision，get 回最新版；同 operationId 重放回 duplicate', async () => {
  const root = await makeRoot()
  try {
    const dispatcher = harness({ factStoreFor: (value) => createFactFileStore({ root: value }) })
    const entry = validEntry()
    const saved = await dispatcher.dispatch(IPC_CHANNELS.factSave, {
      root,
      entry,
      operationId: 'op-1',
      expectedRevision: 4
    })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal(saved.duplicate, false)
    assert.equal(saved.revision, 5, 'tower.json 原第 4 版 → 写后第 5 版')
    assert.equal(saved.bookId, 'book-tower')

    // 通道每次现取 store：get 能读到写后的盘上版本，证明不是内存假成功
    const got = await dispatcher.dispatch(IPC_CHANNELS.factGet, { root, id: entry.id })
    assert.equal(got.ok, true)
    assert.equal(got.revision, 5)
    assert.equal(got.entry.definition, entry.definition)

    const replay = await dispatcher.dispatch(IPC_CHANNELS.factSave, {
      root,
      entry,
      operationId: 'op-1',
      expectedRevision: 4
    })
    assert.equal(replay.ok, true)
    assert.equal(replay.duplicate, true, '幂等键命中：不重写、不推进版本')
    assert.equal(replay.revision, 5)

    const listed = await dispatcher.dispatch(IPC_CHANNELS.factList, { root })
    assert.equal(listed.total, 1, 'upsert 命中同 id：替换不追加')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fact:save 版本冲突回 REVISION_MISMATCH；缺 operationId 回 OPERATION_ID_REQUIRED', async () => {
  const root = await makeRoot()
  try {
    const dispatcher = harness({ factStoreFor: (value) => createFactFileStore({ root: value }) })
    const entry = validEntry()

    const missingOp = await dispatcher.dispatch(IPC_CHANNELS.factSave, { root, entry })
    assert.equal(missingOp.ok, false)
    assert.equal(missingOp.error.code, 'OPERATION_ID_REQUIRED')
    assert.equal((await dispatcher.dispatch(IPC_CHANNELS.factGet, { root, id: entry.id })).revision, 4, '没写盘')

    const stale = await dispatcher.dispatch(IPC_CHANNELS.factSave, {
      root,
      entry: { ...entry, definition: '改过的说明。' },
      operationId: 'op-stale',
      expectedRevision: 3
    })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'REVISION_MISMATCH')
    assert.equal(stale.error.details.currentRevision, 4)
    assert.equal(stale.error.details.expectedRevision, 3)

    const unchanged = await dispatcher.dispatch(IPC_CHANNELS.factGet, { root, id: entry.id })
    assert.equal(unchanged.revision, 4, '冲突不覆盖')
    assert.equal(unchanged.entry.definition, entry.definition)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fact:save 新条目走通道追加（不带 expectedRevision 也按 id upsert）', async () => {
  const root = await makeRoot()
  try {
    const dispatcher = harness({ factStoreFor: (value) => createFactFileStore({ root: value }) })
    const added = await dispatcher.dispatch(IPC_CHANNELS.factSave, {
      root,
      entry: {
        ...validEntry(),
        id: stableEntryId({ layer: 'worldview', domain: '停摆之城', slot: 'items', name: '第二只表' }),
        name: '第二只表'
      },
      operationId: 'op-add'
    })
    assert.equal(added.ok, true)
    assert.equal(added.revision, 5)

    const listed = await dispatcher.dispatch(IPC_CHANNELS.factList, { root })
    assert.equal(listed.total, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fact 通道的 store 按 root 现取：同一分发器可以读两个库', async () => {
  const first = await makeRoot()
  const second = await makeRoot()
  try {
    const handles = []
    const dispatcher = harness({
      factStoreFor: (value) => {
        handles.push(value)
        return createFactFileStore({ root: value })
      }
    })
    await dispatcher.dispatch(IPC_CHANNELS.factList, { root: first })
    await dispatcher.dispatch(IPC_CHANNELS.factList, { root: second })
    assert.deepEqual(handles, [first, second])
  } finally {
    await rm(first, { recursive: true, force: true })
    await rm(second, { recursive: true, force: true })
  }
})
