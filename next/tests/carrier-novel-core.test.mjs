import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { createChapterService } from '@pinax/core/usecases/chapterService'
import { createMemoryChapterStore } from '@pinax/core/adapters/memoryChapterStore'
import { CORE_ERROR_CODES } from '@pinax/core/contracts/errors'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { ensureHistoryRepo } from '../history/gitHistory.mjs'
import { loadBuiltInCarrierPlugins } from '../carriers/index.mjs'
import { NOVEL_CARRIER_ID } from '../carriers/novel/manifest.mjs'
import { createNovelChapterStore } from '../carriers/novel/chapterStore.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * T4 的行为对照：小说载体的 fileService→ChapterStore 适配器与 Core 自己的
 * createMemoryChapterStore 跑同一段剧本，修订号递进、STALE 判定与 details 必须同形。
 * 保存语义（含 content-only 清侧车）只在 Core 的 applyChapterPatch 一处，本文件不另立标准。
 */
const BUILT_IN_CARRIER_PLUGINS = await loadBuiltInCarrierPlugins()
const BOOK = 'book-1'
const CHAPTER_ID = '第001章-入场.md'
const CHAPTER_PATH = `正文/${CHAPTER_ID}`

async function novelService(label) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '小说核心对照')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '小说核心对照', primaryCarrier: NOVEL_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  const store = createNovelChapterStore({
    pluginId: NOVEL_CARRIER_ID,
    fileService: opened.value.fileService,
    dir: '正文',
    // 章节枚举归载体（卷序／标题），这里只给本章清单，专测端口行为。
    listFiles: async () => ({ ok: true, value: { chapters: [{ file: CHAPTER_PATH }] } })
  })
  return { workspace, root, fileService: opened.value.fileService, service: createChapterService({ store }) }
}

test('保存语义对齐 Core 参照实现：create→save 修订号一致，STALE 的 expected/actual 同形', async () => {
  const memoryService = createChapterService({ store: createMemoryChapterStore() })
  const { workspace, root, service } = await novelService('novel-core-parity')
  try {
    const memoryCreated = await memoryService.create(BOOK, { id: CHAPTER_ID, title: '第001章-入场', content: '雨从檐口滴下来。' })
    const fileCreated = await service.create(BOOK, { id: CHAPTER_ID, title: '第001章-入场', content: '雨从檐口滴下来。' })
    assert.equal(memoryCreated.value.revision, 1)
    assert.equal(fileCreated.value.revision, 1)
    assert.equal(await readFile(join(root, CHAPTER_PATH), 'utf-8'), '雨从檐口滴下来。')

    const memorySaved = await memoryService.save(BOOK, CHAPTER_ID, { content: '雨从檐口滴下来，巷子里没人。', expectedRevision: 1 })
    const fileSaved = await service.save(BOOK, CHAPTER_ID, { content: '雨从檐口滴下来，巷子里没人。', expectedRevision: 1 })
    assert.equal(memorySaved.value.revision, 2)
    assert.equal(fileSaved.value.revision, 2)
    assert.equal(await readFile(join(root, CHAPTER_PATH), 'utf-8'), '雨从檐口滴下来，巷子里没人。')

    const memoryStale = await memoryService.save(BOOK, CHAPTER_ID, { content: '基于旧版的一笔', expectedRevision: 1 })
    const fileStale = await service.save(BOOK, CHAPTER_ID, { content: '基于旧版的一笔', expectedRevision: 1 })
    assert.equal(memoryStale.ok, false)
    assert.equal(memoryStale.error.code, CORE_ERROR_CODES.STALE_REVISION)
    assert.deepEqual(memoryStale.error.details, { expected: 1, actual: 2 })
    assert.equal(fileStale.ok, false)
    assert.equal(fileStale.error.code, NEXT_ERROR_CODES.STALE_REVISION, 'Core 的裸码在适配器边界翻译成宿主 PINAX_* 码')
    assert.equal(fileStale.error.details.expected, 1)
    assert.equal(fileStale.error.details.actual, 2)
    assert.equal(fileStale.error.details.path, CHAPTER_PATH, '宿主回执仍点名是哪个文件')
    assert.equal(await readFile(join(root, CHAPTER_PATH), 'utf-8'), '雨从檐口滴下来，巷子里没人。', 'STALE 拒绝后磁盘不动')
  } finally {
    await workspace.cleanup()
  }
})

test('删除语义对齐 Core 参照实现：修订号不符拒删；相符才删，两边的判词逐个对上', async () => {
  const memoryService = createChapterService({ store: createMemoryChapterStore() })
  const { workspace, root, service } = await novelService('novel-core-remove')
  try {
    await ensureHistoryRepo({ root })
    for (const target of [memoryService, service]) {
      assert.equal((await target.create(BOOK, { id: CHAPTER_ID, title: '第001章-入场', content: '入场。' })).ok, true)
    }
    const memoryStale = await memoryService.remove(BOOK, CHAPTER_ID, { expectedRevision: 7 })
    const fileStale = await service.remove(BOOK, CHAPTER_ID, { expectedRevision: 7 })
    assert.equal(memoryStale.ok, false)
    assert.equal(memoryStale.error.code, CORE_ERROR_CODES.STALE_REVISION)
    assert.equal(fileStale.ok, false)
    assert.equal(fileStale.error.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.deepEqual([fileStale.error.details.expected, fileStale.error.details.actual], [7, 1])
    assert.equal(await stat(join(root, CHAPTER_PATH)).then(() => true, () => false), true, '拒删后文件还在')

    assert.equal((await memoryService.remove(BOOK, CHAPTER_ID, { expectedRevision: 1 })).ok, true)
    assert.equal((await service.remove(BOOK, CHAPTER_ID, { expectedRevision: 1 })).ok, true)
    assert.equal(await stat(join(root, CHAPTER_PATH)).then(() => true, () => false), false)
  } finally {
    await workspace.cleanup()
  }
})

test('盘上没有的章改稿仍按第 0 版判 STALE：错误码与文件服务同口径，不因「先读」改报 INVALID_INPUT', async () => {
  const { workspace, root, service } = await novelService('novel-core-missing')
  try {
    const missing = await service.save(BOOK, '第404章-没有.md', { content: 'x', expectedRevision: 3 })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, NEXT_ERROR_CODES.STALE_REVISION)
    assert.deepEqual([missing.error.details.expected, missing.error.details.actual], [3, 0])
    assert.equal(await stat(join(root, '正文', '第404章-没有.md')).then(() => true, () => false), false, 'STALE 不落盘')
  } finally {
    await workspace.cleanup()
  }
})
