import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeFactFile,
  readFactWiki,
  createFactFileStore,
  FACT_DIR_NAME,
  OPERATIONS_LOG_NAME,
  WIKI_DERIVED_SCHEMA
} from '../kernel/factFileStore.mjs'
import { stableEntryId } from '../fact/domain/pediaSchema.js'

/**
 * writeFactFile（S2 · WO-S2-01/02/03）用例：原子写、revision 自增、expectedRevision 冲突、
 * operationId 幂等、并发双写、残留 .tmp、upsert/删除、wiki 分离与读侧两代兼容、派生可删。
 * 全部在 os.tmpdir() 里造目录，不碰作者真实拆解库。
 */

function entry({ name = '停摆的表', domain = '停摆之城', bookId = 'book-tower', definition } = {}) {
  const layer = 'worldview'
  const slot = 'items'
  return {
    schema: 'fact.data/v3',
    id: stableEntryId({ layer, domain, slot, name }),
    layer,
    name,
    domain,
    slot,
    status: 'draft',
    definition: definition ?? `${name}的说明。`,
    fingerprint: { vec: null, metrics: { chars: 12 } },
    provenance: { mode: 'analyze', book: '停摆之城', book_id: bookId, chapters: [1], scenes: [], extractor: 'test' }
  }
}

async function makeRoot() {
  return mkdtemp(join(tmpdir(), 'pinax-fact-write-'))
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf-8'))
}

async function readOps(root) {
  const path = join(root, FACT_DIR_NAME, OPERATIONS_LOG_NAME)
  const text = await readFile(path, 'utf-8')
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

test('writeFactFile：原子写（tmp＋rename）——首写第 1 版，目录里不留 .tmp', async () => {
  const root = await makeRoot()
  try {
    const written = await writeFactFile({ root, entry: entry(), operationId: 'op-1' })
    assert.equal(written.ok, true, JSON.stringify(written))
    assert.equal(written.duplicate, false)
    assert.equal(written.revision, 1)
    assert.equal(written.bookId, 'book-tower')
    assert.equal(written.file, `${FACT_DIR_NAME}/book-tower.json`)

    const document = await readJson(join(root, FACT_DIR_NAME, 'book-tower.json'))
    assert.equal(document.revision, 1)
    assert.equal(document.entries.length, 1)
    assert.ok(document.updatedAt, '写后刷新 updatedAt')

    const names = await readdir(join(root, FACT_DIR_NAME))
    assert.ok(!names.some((name) => name.endsWith('.tmp')), `不该留临时文件：${names.join(',')}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeFactFile：operationId 必填，缺了不落盘', async () => {
  const root = await makeRoot()
  try {
    const refused = await writeFactFile({ root, entry: entry() })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'OPERATION_ID_REQUIRED')
    assert.ok(refused.error.details?.hint, '给调用方生成键的提示')
    assert.equal(existsSync(join(root, FACT_DIR_NAME, 'book-tower.json')), false, '没有 operationId 就不写')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeFactFile：revision 单调自增 1→2→3，旁路日志一行一次 applied', async () => {
  const root = await makeRoot()
  try {
    const first = await writeFactFile({ root, entry: entry(), operationId: 'op-1' })
    const second = await writeFactFile({ root, entry: entry({ name: '第二只表' }), operationId: 'op-2' })
    const third = await writeFactFile({ root, entry: entry({ name: '第三只表' }), operationId: 'op-3' })
    assert.deepEqual([first.revision, second.revision, third.revision], [1, 2, 3])

    const document = await readJson(join(root, FACT_DIR_NAME, 'book-tower.json'))
    assert.equal(document.revision, 3)
    assert.equal(document.entries.length, 3, '不同 id 逐条追加')

    const operations = await readOps(root)
    assert.equal(operations.length, 3)
    assert.deepEqual(operations.map((record) => record.revision), [1, 2, 3])
    assert.deepEqual(operations.map((record) => record.outcome), ['applied', 'applied', 'applied'])
    assert.ok(operations.every((record) => record.operationId && record.bookId === 'book-tower' && record.at))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeFactFile：expectedRevision 不符 → REVISION_MISMATCH（不覆盖），日志留 revision_mismatch', async () => {
  const root = await makeRoot()
  try {
    await writeFactFile({ root, entry: entry(), operationId: 'op-1' })
    const target = join(root, FACT_DIR_NAME, 'book-tower.json')
    const before = await readFile(target, 'utf-8')

    const stale = await writeFactFile({
      root,
      entry: entry({ name: '第二只表' }),
      operationId: 'op-stale',
      expectedRevision: 0
    })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'REVISION_MISMATCH')
    assert.equal(stale.error.details.currentRevision, 1)
    assert.equal(stale.error.details.expectedRevision, 0)

    const after = await readFile(target, 'utf-8')
    assert.equal(after, before, '版本不符一个字节都不写')

    const operations = await readOps(root)
    assert.equal(operations.at(-1).outcome, 'revision_mismatch')
    assert.equal(operations.at(-1).operationId, 'op-stale')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeFactFile：operationId 幂等——重放不重写；失败记录不构成已应用', async () => {
  const root = await makeRoot()
  try {
    const first = await writeFactFile({ root, entry: entry(), operationId: 'op-1' })
    assert.equal(first.ok, true)

    const target = join(root, FACT_DIR_NAME, 'book-tower.json')
    const snapshot = await readFile(target, 'utf-8')
    const replay = await writeFactFile({
      root,
      entry: entry({ definition: '重放带的新内容也不该写进去。' }),
      operationId: 'op-1'
    })
    assert.equal(replay.ok, true)
    assert.equal(replay.duplicate, true)
    assert.equal(replay.revision, 1)
    assert.equal(await readFile(target, 'utf-8'), snapshot, '重放不重写文件')

    const appliedOnce = (await readOps(root)).filter((record) => record.operationId === 'op-1')
    assert.equal(appliedOnce.length, 1)

    // 同一 operationId 先失败（revision_mismatch）再成功：失败行不占幂等位
    const failed = await writeFactFile({
      root,
      entry: entry({ name: '第二只表' }),
      operationId: 'op-retry',
      expectedRevision: 99
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.error.code, 'REVISION_MISMATCH')

    const retried = await writeFactFile({
      root,
      entry: entry({ name: '第二只表' }),
      operationId: 'op-retry',
      expectedRevision: 1
    })
    assert.equal(retried.ok, true)
    assert.equal(retried.duplicate, false, '失败过的 operationId 允许重试')
    assert.equal(retried.revision, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeFactFile：同进程并发双写同一 expectedRevision——后者 REVISION_MISMATCH，主档不丢数据', async () => {
  const root = await makeRoot()
  try {
    const [left, right] = await Promise.all([
      writeFactFile({ root, entry: entry(), operationId: 'op-a', expectedRevision: 0 }),
      writeFactFile({ root, entry: entry({ name: '第二只表' }), operationId: 'op-b', expectedRevision: 0 })
    ])
    const succeeded = [left, right].filter((result) => result.ok)
    const refused = [left, right].filter((result) => !result.ok)
    assert.equal(succeeded.length, 1, `只该有一个写成功：${JSON.stringify([left, right])}`)
    assert.equal(succeeded[0].revision, 1)
    assert.equal(refused.length, 1)
    assert.equal(refused[0].error.code, 'REVISION_MISMATCH')

    const document = await readJson(join(root, FACT_DIR_NAME, 'book-tower.json'))
    assert.equal(document.revision, 1)
    assert.equal(document.entries.length, 1, '成功那一笔完整落盘，没被覆盖成半份')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeFactFile：崩溃残留 .tmp 不影响主档，下次写顺手覆盖', async () => {
  const root = await makeRoot()
  try {
    const dir = join(root, FACT_DIR_NAME)
    await mkdir(dir, { recursive: true })
    const target = join(dir, 'book-tower.json')
    await writeFile(target, JSON.stringify({
      book: { id: 'book-tower', title: '停摆之城' },
      revision: 2,
      entries: [entry()]
    }), 'utf-8')
    await writeFile(`${target}.tmp`, '{ 上次写到一半就崩了', 'utf-8')

    const written = await writeFactFile({ root, entry: entry({ name: '第二只表' }), operationId: 'op-1' })
    assert.equal(written.ok, true)
    assert.equal(written.revision, 3, '残留 .tmp 不是真源，版本从主档 2 起算')

    const document = await readJson(target)
    assert.equal(document.revision, 3)
    assert.equal(document.entries.length, 2)
    const names = await readdir(dir)
    assert.ok(!names.some((name) => name.endsWith('.tmp')), '本次写完残留被覆盖')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeFactFile：坏主档拒绝覆盖（IO_FAILED），原文件一字不动', async () => {
  const root = await makeRoot()
  try {
    const dir = join(root, FACT_DIR_NAME)
    await mkdir(dir, { recursive: true })
    const target = join(dir, 'book-tower.json')
    await writeFile(target, '{ 这不是 JSON', 'utf-8')

    const refused = await writeFactFile({ root, entry: entry(), operationId: 'op-1' })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'PINAX_IO_FAILED')
    assert.equal(await readFile(target, 'utf-8'), '{ 这不是 JSON')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeFactFile：entry 按 id upsert（替换/追加），removeEntryIds 删除；删不到回 NOT_FOUND', async () => {
  const root = await makeRoot()
  try {
    const dir = join(root, FACT_DIR_NAME)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'book-tower.json'), JSON.stringify({
      book: { id: 'book-tower', title: '停摆之城' },
      revision: 1,
      entries: [entry(), entry({ name: '第二只表' })]
    }), 'utf-8')

    const replaced = await writeFactFile({
      root,
      entry: entry({ definition: '改过的说明。' }),
      operationId: 'op-replace'
    })
    assert.equal(replaced.ok, true)
    assert.equal(replaced.revision, 2)
    let document = await readJson(join(dir, 'book-tower.json'))
    assert.equal(document.entries.length, 2, '同 id 替换不追加')
    assert.equal(document.entries.find((item) => item.name === '停摆的表').definition, '改过的说明。')

    const appended = await writeFactFile({
      root,
      entry: entry({ name: '第三只表' }),
      operationId: 'op-append'
    })
    assert.equal(appended.revision, 3)
    document = await readJson(join(dir, 'book-tower.json'))
    assert.equal(document.entries.length, 3)

    const removed = await writeFactFile({
      root,
      bookId: 'book-tower',
      patch: { removeEntryIds: [entry().id] },
      operationId: 'op-remove'
    })
    assert.equal(removed.ok, true)
    assert.equal(removed.revision, 4)
    document = await readJson(join(dir, 'book-tower.json'))
    assert.equal(document.entries.length, 2)
    assert.equal(document.entries.some((item) => item.id === entry().id), false)

    const missing = await writeFactFile({
      root,
      bookId: 'book-tower',
      patch: { removeEntryIds: ['ffffffffffff'] },
      operationId: 'op-remove-missing'
    })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'NOT_FOUND')
    assert.equal((await readJson(join(dir, 'book-tower.json'))).revision, 4, '删不到不推进版本')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeFactFile：文件 id 不允许把写入带出 拆解/（路径分隔符拒收）', async () => {
  const root = await makeRoot()
  try {
    const refused = await writeFactFile({ root, bookId: '../逃逸', entry: entry(), operationId: 'op-1' })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'PINAX_INVALID_INPUT')
    assert.equal(existsSync(join(root, '逃逸.json')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeFactFile：wiki 分离——主档永不落 wiki，兄弟 wiki.json 带 derivedFrom（写前 revision）', async () => {
  const root = await makeRoot()
  try {
    const written = await writeFactFile({
      root,
      bookId: 'book-tower',
      patch: { entries: [entry()], wiki: { overview: '一只停在雪夜的钟表。' } },
      operationId: 'op-1'
    })
    assert.equal(written.ok, true)

    const mainPath = join(root, FACT_DIR_NAME, 'book-tower.json')
    const main = await readJson(mainPath)
    assert.equal(Object.prototype.hasOwnProperty.call(main, 'wiki'), false, '主档不落 wiki')

    const sidecar = await readJson(join(root, FACT_DIR_NAME, 'book-tower.wiki.json'))
    assert.equal(sidecar.overview, '一只停在雪夜的钟表。')
    assert.equal(sidecar.derivedFrom.schema, WIKI_DERIVED_SCHEMA)
    assert.equal(sidecar.derivedFrom.factRevision, 0, '首写前是第 0 版')

    // 存量旧信封（wiki 在主档里）在重写时顺手迁去兄弟文件，主档剥离
    await writeFile(join(root, FACT_DIR_NAME, 'book-old.json'), JSON.stringify({
      book: { id: 'book-old', title: '旧档' },
      revision: 2,
      wiki: { overview: '旧信封里的梗概。' },
      entries: []
    }), 'utf-8')

    const migrated = await writeFactFile({
      root,
      bookId: 'book-old',
      patch: { source: { chapters: 3 } },
      operationId: 'op-old'
    })
    assert.equal(migrated.ok, true)
    assert.equal(migrated.revision, 3)

    const oldMain = await readJson(join(root, FACT_DIR_NAME, 'book-old.json'))
    assert.equal(Object.prototype.hasOwnProperty.call(oldMain, 'wiki'), false)
    assert.deepEqual(oldMain.source, { chapters: 3 }, 'patch 里其余顶层键浅合并')
    const oldSidecar = await readJson(join(root, FACT_DIR_NAME, 'book-old.wiki.json'))
    assert.equal(oldSidecar.overview, '旧信封里的梗概。')
    assert.equal(oldSidecar.derivedFrom.factRevision, 2, 'derivedFrom 记写前版本，不是写后')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('readFactWiki：兄弟文件优先、旧信封回落、坏档按没有处理（两代兼容）', async () => {
  const root = await makeRoot()
  try {
    const dir = join(root, FACT_DIR_NAME)
    await mkdir(dir, { recursive: true })
    const legacyDocument = {
      book: { id: 'legacy', title: '旧档' },
      revision: 2,
      entries: [],
      wiki: { overview: '旧信封里的梗概。' }
    }
    await writeFile(join(dir, 'legacy.json'), JSON.stringify(legacyDocument), 'utf-8')

    const envelope = readFactWiki({ root, id: 'legacy', document: legacyDocument })
    assert.equal(envelope.source, 'envelope')
    assert.deepEqual(envelope.wiki, { overview: '旧信封里的梗概。' })
    assert.equal(envelope.derivedFrom, null)

    await writeFile(join(dir, 'legacy.wiki.json'), JSON.stringify({
      derivedFrom: { factRevision: 2, schema: WIKI_DERIVED_SCHEMA },
      overview: '兄弟文件的梗概。'
    }), 'utf-8')
    const sibling = readFactWiki({ root, id: 'legacy', document: legacyDocument })
    assert.equal(sibling.source, 'sibling')
    assert.equal(sibling.wiki.overview, '兄弟文件的梗概。')
    assert.equal(sibling.wiki.derivedFrom, undefined, 'derivedFrom 是头，不进 wiki 内容')
    assert.equal(sibling.derivedFrom.factRevision, 2)

    await writeFile(join(dir, 'legacy.wiki.json'), '{ 兄弟文件坏了', 'utf-8')
    const fallback = readFactWiki({ root, id: 'legacy', document: legacyDocument })
    assert.equal(fallback.source, 'envelope', '派生档坏了不拦旧信封')

    const none = readFactWiki({ root, id: 'legacy', document: { revision: 2, entries: [] } })
    assert.equal(none.source, 'none')
    assert.equal(none.wiki, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('派生可删：删掉 wiki.json 后主档照常解析，store 的 list/get 不受影响', async () => {
  const root = await makeRoot()
  try {
    const written = await writeFactFile({
      root,
      bookId: 'book-tower',
      patch: { entries: [entry()], wiki: { overview: '梗概。' } },
      operationId: 'op-1'
    })
    assert.equal(written.ok, true)

    await rm(join(root, FACT_DIR_NAME, 'book-tower.wiki.json'))
    const document = await readJson(join(root, FACT_DIR_NAME, 'book-tower.json'))
    assert.equal(document.revision, 1)

    const store = createFactFileStore({ root })
    const listed = store.list()
    assert.equal(listed.ok, true)
    assert.equal(listed.total, 1)
    assert.equal(listed.warnings.length, 0)
    assert.equal(Object.prototype.hasOwnProperty.call(listed.entries[0], 'wiki'), false, 'list 不吐 wiki')

    const got = store.get({ id: entry().id })
    assert.equal(got.ok, true)
    assert.equal(got.revision, 1)

    const wiki = readFactWiki({ root, id: 'book-tower', document })
    assert.equal(wiki.source, 'none')
    assert.equal(wiki.wiki, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('devtools 形态：抽取整份替换连跑 3 次 → revision 单调、3 行 applied；enrich 只补 wiki 不碰 entries', async () => {
  const root = await makeRoot()
  try {
    const extraction = () => ({
      book: { id: 'book-tower', title: '停摆之城' },
      source: { path: 'book-tower.json', segments: 12, blocks: 4 },
      entries: [entry(), entry({ name: '第二只表' })],
      accepted: 2,
      rejected: []
    })

    // run-extract-library 形态：patch=result（entries 整份替换）＋ 每次新 operationId
    const revisions = []
    for (let run = 0; run < 3; run += 1) {
      const written = await writeFactFile({
        root,
        bookId: 'book-tower',
        patch: extraction(),
        operationId: `extract-book-tower-run-${run}`
      })
      assert.equal(written.ok, true, JSON.stringify(written))
      revisions.push(written.revision)
      const document = await readJson(join(root, FACT_DIR_NAME, 'book-tower.json'))
      assert.equal(document.entries.length, 2, '整份替换不会越跑越多')
    }
    assert.deepEqual(revisions, [1, 2, 3])

    // wiki-enrich-run 形态：读到的 revision 当 expectedRevision，只写 wiki 侧车
    const written = await writeFactFile({
      root,
      bookId: 'book-tower',
      patch: { wiki: { overview: 'enrich 补的梗概。' } },
      operationId: 'wiki-enrich-book-tower-run-0',
      expectedRevision: revisions.at(-1)
    })
    assert.equal(written.ok, true)
    assert.equal(written.revision, 4)

    const document = await readJson(join(root, FACT_DIR_NAME, 'book-tower.json'))
    assert.equal(document.entries.length, 2, 'enrich 不动 entries')
    assert.equal(document.source.blocks, 4)
    assert.equal(Object.prototype.hasOwnProperty.call(document, 'wiki'), false)

    const operations = await readOps(root)
    assert.equal(operations.length, 4, '三跑抽取＋一跑 enrich 各一行')
    assert.deepEqual(operations.map((record) => record.revision), [1, 2, 3, 4])
    assert.ok(operations.every((record) => record.outcome === 'applied'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
