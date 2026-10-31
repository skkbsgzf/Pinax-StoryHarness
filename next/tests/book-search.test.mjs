import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { createFileService } from '../fs/fileService.mjs'
import { FIXTURE_NOVEL, FIXTURE_WORLDBOOK } from '../testing/fixtures.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 批次46B · 任务①：全书查找与当前章替换。
 *
 * 证四件事：
 *   1) 查找顺序与章节树一致（卷按目录名、卷内按文件名，平铺章在卷后），每处带行号与 ±40 字上下文；
 *   2) 命中上限如实标 truncated，不静默截断；空查询／超长查询打回；
 *   3) 替换只作用在一章上，且必须过 expectedRevision 闸（冲突 STALE，磁盘不动）；
 *   4) 章节树给的「正文/…」前缀文件路径能直接交给替换（接线不拼成 正文/正文/…）。
 */

async function setup() {
  const workspace = await createTempWorkspace('book-search')
  const root = await workspace.projectPath('大梦-查找测试')
  for (const dir of PROJECT_KINDS.novel) await mkdir(join(root, dir), { recursive: true })
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  registry.install(FIXTURE_NOVEL)
  registry.install(FIXTURE_WORLDBOOK)
  const service = createFileService({ root, registry })
  await service.init()
  return { workspace, root, service }
}

async function seedBook(root) {
  await writeFile(join(root, '正文', '第001章-雨夜.md'), '第一章第一行。\n雨从檐口滴下来。\n巷子里没人，雨声更密。\n', 'utf-8')
  await writeFile(join(root, '正文', '第002章-雪夜.md'), '雪停了。\nRain 落了整夜，rain 又停。\n', 'utf-8')
  await writeFile(join(root, '正文', '说明.txt'), '雨雨雨（不是章节）\n', 'utf-8')
  await mkdir(join(root, '正文', '第一卷'))
  await writeFile(join(root, '正文', '第一卷', '第001章-归来.md'), '归来。\n没有天气。\n', 'utf-8')
  await writeFile(join(root, '正文', '第一卷', '第003章-入场.md'), '入场。\n雨。雨。\n', 'utf-8')
}

test('查找按章节树顺序扫全书：卷在前、平铺在后，命中带行号与上下文', async () => {
  const { workspace, root, service } = await setup()
  try {
    await seedBook(root)
    const result = await service.searchChapters('雨')
    assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
    const { hits, total, truncated, chaptersScanned } = result.value
    assert.equal(truncated, false)
    assert.equal(chaptersScanned, 4, '.txt 不是章节，不参与查找')

    // 顺序：第一卷/第001章（无命中）→ 第一卷/第003章（两处）→ 平铺 第001章（两处）→ 第002章（无中文雨）。
    assert.deepEqual(hits.map((hit) => [hit.file, hit.line]), [
      ['正文/第一卷/第003章-入场.md', 2],
      ['正文/第一卷/第003章-入场.md', 2],
      ['正文/第001章-雨夜.md', 2],
      ['正文/第001章-雨夜.md', 3]
    ])
    assert.equal(total, 4)
    // 标题与章节树同一口径（剥 .md）。
    assert.equal(hits[0].chapterTitle, '第003章-入场')
    // 上下文包含本行左右各 40 字；同章内 matchIndex 从 0 递增。
    assert.ok(hits[0].snippet.includes('雨'))
    assert.equal(hits[0].matchIndex, 0)
    assert.equal(hits[1].matchIndex, 1)
    // 跨行的片段把换行折叠成空格，不让结果行断成两行。
    assert.doesNotMatch(hits[2].snippet, /\n/u)
  } finally {
    await workspace.cleanup()
  }
})

test('查找区分大小写开关；命中上限如实标 truncated', async () => {
  const { workspace, root, service } = await setup()
  try {
    await seedBook(root)
    const insensitive = await service.searchChapters('rain')
    assert.equal(insensitive.ok, true, JSON.stringify(insensitive.error ?? {}))
    assert.equal(insensitive.value.hits.length, 2, '默认不区分大小写，Rain／rain 都命中')
    assert.equal(insensitive.value.hits[0].file, '正文/第002章-雪夜.md')

    const sensitive = await service.searchChapters('Rain', { caseSensitive: true })
    assert.equal(sensitive.value.hits.length, 1, '区分大小写时只命中首字母大写的那个')

    const capped = await service.searchChapters('雨', { maxHits: 2 })
    assert.equal(capped.ok, true)
    assert.equal(capped.value.hits.length, 2)
    assert.equal(capped.value.truncated, true, '到了上限要如实标出，不静默截断')
  } finally {
    await workspace.cleanup()
  }
})

test('空查询／超长查询／没有任何正文时如实报出', async () => {
  const { workspace, root, service } = await setup()
  try {
    await seedBook(root)
    const blank = await service.searchChapters('   ')
    assert.equal(blank.ok, false)
    assert.match(blank.error.message, /关键词/)

    const long = await service.searchChapters('雨'.repeat(201))
    assert.equal(long.ok, false)
    assert.match(long.error.message, /过长/)

    const empty = await service.searchChapters('不存在的词')
    assert.equal(empty.ok, true)
    assert.equal(empty.value.total, 0)
    assert.equal(empty.value.hits.length, 0)
  } finally {
    await workspace.cleanup()
  }
})

test('当前章替换走修订号闸：对修订则换、并发冲突 STALE 且磁盘不动', async () => {
  const { workspace, root, service } = await setup()
  try {
    await seedBook(root)
    // 盘上已有这一章（seedBook 直接写入、没有账本）：首次读到即为第 1 版。

    // 章节树给的 file 带「正文/」前缀：接线不能拼成 正文/正文/…。
    const stale = await service.replaceInChapter({
      file: '正文/第001章-雨夜.md',
      find: '雨',
      replace: '雪',
      expectedRevision: 0
    })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, 'PINAX_STALE_REVISION')
    assert.match(stale.error.message, /已被改动/)
    assert.equal(
      await readFile(join(root, '正文', '第001章-雨夜.md'), 'utf-8'),
      '第一章第一行。\n雨从檐口滴下来。\n巷子里没人，雨声更密。\n',
      '冲突拒绝后磁盘上必须还是原内容'
    )

    const replaced = await service.replaceInChapter({
      file: '正文/第001章-雨夜.md',
      find: '雨',
      replace: '雪',
      expectedRevision: 1
    })
    assert.equal(replaced.ok, true, JSON.stringify(replaced.error ?? {}))
    assert.equal(replaced.value.replaced, 2)
    assert.equal(replaced.value.changed, true)
    assert.equal(replaced.value.revision, 2)
    assert.equal(
      await readFile(join(root, '正文', '第001章-雨夜.md'), 'utf-8'),
      '第一章第一行。\n雪从檐口滴下来。\n巷子里没人，雪声更密。\n'
    )
  } finally {
    await workspace.cleanup()
  }
})

test('替换细节：all=false 只换第一处；没命中不写盘；空替换词／空查找词打回', async () => {
  const { workspace, root, service } = await setup()
  try {
    await writeFile(join(root, '正文', '第005章-替换.md'), '雨。雨。雨。', 'utf-8')
    const file = '第005章-替换.md'

    const first = await service.replaceInChapter({ file, find: '雨', replace: '雪', expectedRevision: 1, all: false })
    assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
    assert.equal(first.value.replaced, 1)
    assert.equal(await readFile(join(root, '正文', file), 'utf-8'), '雪。雨。雨。')

    const none = await service.replaceInChapter({ file, find: '晴', replace: '阴', expectedRevision: 2 })
    assert.equal(none.ok, true)
    assert.equal(none.value.changed, false)
    assert.equal(none.value.revision, 2, '没命中的替换不动修订号')
    assert.equal(await readFile(join(root, '正文', file), 'utf-8'), '雪。雨。雨。')

    const emptyReplace = await service.replaceInChapter({ file, find: '雨', replace: '', expectedRevision: 2 })
    assert.equal(emptyReplace.ok, false)
    assert.match(emptyReplace.error.message, /不能为空/u)

    const emptyFind = await service.replaceInChapter({ file, find: '', replace: '雪', expectedRevision: 2 })
    assert.equal(emptyFind.ok, false)
    assert.match(emptyFind.error.message, /查找词/u)

    const noRevision = await service.replaceInChapter({ file, find: '雨', replace: '雪' })
    assert.equal(noRevision.ok, false)
    assert.match(noRevision.error.message, /expectedRevision/u)
  } finally {
    await workspace.cleanup()
  }
})
