import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseOutlineProse } from '../runtime/outlineProse.mjs'
import { importOutlineChapters } from '../runtime/outlineImportService.mjs'
import { fail } from '../kernel/errors.mjs'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { BUILT_IN_CARRIER_PLUGINS, OUTLINE_CARRIER_ID } from '../carriers/index.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 批次30：散文章节稿 → 大纲/outline.json。
 *
 * 钉的是工单承诺，不是实现细节：
 *   • 解析只在标题两级上工作（# 文件题／## 章节），### 小节进 note、不立节点；
 *   • 没有 ## 的文件不猜（0 章 + warning）；
 *   • 导入只追加、现有节点不动、重跑幂等、源 md 一个字节不动；
 *   • 修订冲突原样上抛（STALE_REVISION），不重试不覆盖。
 */

/** 大梦真稿形态：文件题 + 两章 + ### 小节 + 加粗/编号清单。 */
const CHAPTER_FIXTURE = `# 卷一开篇 · 小说大纲（第一章至首战）

## 第一章《牛肉汤》

### 章功能
开场立人设，给主角一个具体的念想。

### 简纲
1. 柯秒在雨夜进城，钱不够。
2. **第一碗牛肉汤** 让主角记住这座城。

### STAR
- 情境：雨夜、陌生的城
- 动作：喝汤

### 登记
第一章 · 约 3000 字

## 第二章《延迟》

### 简纲
${'延迟的代价被反复提及，主角每次都晚半步。'.repeat(40)}
`

async function setupProject(label, fill = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '大纲转换靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, `${plugin.manifest.id}：${JSON.stringify(installed.error ?? {})}`)
  }
  const created = await createProject({ root, name: '大纲转换靶子', primaryCarrier: OUTLINE_CARRIER_ID, registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  const dir = join(root, '大纲')
  await mkdir(dir, { recursive: true })
  for (const [name, text] of Object.entries(fill)) await writeFile(join(dir, name), text, 'utf-8')
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  return { workspace, root, fileService: opened.value.fileService }
}

async function readOutline(root) {
  return JSON.parse(await readFile(join(root, '大纲', 'outline.json'), 'utf-8'))
}

function exists(file) {
  return readFile(file, 'utf-8').then(() => true, () => false)
}

test('解析：大梦格式 → 两章、note ≤200、source 指回原文位置', () => {
  const parsed = parseOutlineProse(CHAPTER_FIXTURE, '大纲/001-004.md')
  assert.equal(parsed.docTitle, '卷一开篇 · 小说大纲（第一章至首战）')
  assert.equal(parsed.chapters.length, 2)
  assert.deepEqual(parsed.chapters.map((chapter) => chapter.title), ['第一章《牛肉汤》', '第二章《延迟》'])
  assert.equal(parsed.chapters[0].source, '大纲/001-004.md#第一章《牛肉汤》')
  assert.equal(parsed.chapters[1].source, '大纲/001-004.md#第二章《延迟》')

  for (const chapter of parsed.chapters) {
    assert.ok(chapter.note.length <= 200, `note 超长：${chapter.note.length}`)
    assert.ok(!chapter.note.includes('#'), 'note 里不该留标题井号')
    assert.ok(!chapter.note.includes('**'), 'note 里不该留加粗星号')
  }
  // 小节标题行被去掉，内容留下（简纲的编号清单就是章内容的一部分）。
  assert.match(parsed.chapters[0].note, /柯秒在雨夜进城/u)
  assert.match(parsed.chapters[0].note, /第一碗牛肉汤/u)
  assert.ok(!parsed.chapters[0].note.includes('简纲'), '### 小节标题不进备注')
  // 超长章节截断成 200 字并带省略号。
  assert.equal(parsed.chapters[1].note.length, 200)
  assert.ok(parsed.chapters[1].note.endsWith('…'))
  assert.deepEqual(parsed.warnings, [])
})

test('解析：没有 ## 的整篇散文 → 0 章 + 警告，不猜章节', () => {
  const parsed = parseOutlineProse('# 某篇随笔\n\n这是一整篇散文，没有章节标题。\n', '大纲/散文.md')
  assert.equal(parsed.docTitle, '某篇随笔')
  assert.deepEqual(parsed.chapters, [])
  assert.equal(parsed.warnings.length, 1)
  assert.match(parsed.warnings[0], /该文件没有章节标题/u)
})

test('解析：空「## 」标题跳过并记警告', () => {
  const parsed = parseOutlineProse('## \n正文\n## 有名字的一章\n内容\n', '大纲/x.md')
  assert.equal(parsed.chapters.length, 1)
  assert.equal(parsed.chapters[0].title, '有名字的一章')
  assert.ok(parsed.warnings.some((warning) => /空的「## 」章节标题/u.test(warning)))
})

test('导入：大纲/ 没有 md → 如实报缺，不写任何文件', async () => {
  const { workspace, root, fileService } = await setupProject('outline-empty')
  try {
    const result = await importOutlineChapters({ root, fileService, dryRun: false })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'PINAX_INVALID_INPUT')
    assert.match(result.error.message, /没有可转换的 md/u)
    assert.equal(await exists(join(root, '大纲', 'outline.json')), false)
  } finally {
    await workspace.cleanup()
  }
})

test('导入：dryRun 只扫描不落盘；首次导入全量追加；重跑幂等；源 md 字节不变', async () => {
  const fixture = CHAPTER_FIXTURE
  const { workspace, root, fileService } = await setupProject('outline-import', { '001-004.md': fixture })
  try {
    const sourcePath = join(root, '大纲', '001-004.md')
    const before = await readFile(sourcePath, 'utf-8')

    const scanned = await importOutlineChapters({ root, fileService, dryRun: true })
    assert.equal(scanned.ok, true, JSON.stringify(scanned.error ?? {}))
    assert.equal(scanned.value.files, 1)
    assert.equal(scanned.value.chapters, 2)
    assert.equal(scanned.value.imported, 2)
    assert.equal(scanned.value.reused, 0)
    assert.equal(await exists(join(root, '大纲', 'outline.json')), false, 'dryRun 不许写盘')

    const applied = await importOutlineChapters({ root, fileService, dryRun: false })
    assert.equal(applied.ok, true, JSON.stringify(applied.error ?? {}))
    assert.equal(applied.value.imported, 2)
    assert.equal(applied.value.reused, 0)
    assert.deepEqual(applied.value.items.map((item) => item.status), ['imported', 'imported'])
    assert.equal(applied.value.revision, 1)

    const document = await readOutline(root)
    assert.deepEqual(document.nodes.map((node) => node.id), ['imp-1', 'imp-2'])
    assert.deepEqual(document.nodes.map((node) => node.source), [
      '大纲/001-004.md#第一章《牛肉汤》',
      '大纲/001-004.md#第二章《延迟》'
    ])
    assert.deepEqual(document.edges, [], '章节顺序是 nodes 数组序，不造连线')

    const firstBytes = await readFile(join(root, '大纲', 'outline.json'), 'utf-8')
    const rerun = await importOutlineChapters({ root, fileService, dryRun: false })
    assert.equal(rerun.ok, true)
    assert.equal(rerun.value.imported, 0)
    assert.equal(rerun.value.reused, 2)
    assert.equal(await readFile(join(root, '大纲', 'outline.json'), 'utf-8'), firstBytes, '幂等重跑不改一个字')
    assert.equal(await readFile(sourcePath, 'utf-8'), before, '源 md 一个字节不动')
  } finally {
    await workspace.cleanup()
  }
})

test('导入：作者改过的标题/备注不被覆盖，新章节照常追加', async () => {
  const { workspace, root, fileService } = await setupProject('outline-author-edit', { '001-004.md': CHAPTER_FIXTURE })
  try {
    const first = await importOutlineChapters({ root, fileService, dryRun: false })
    assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))

    // 作者在编辑器里改了第一个节点的标题与备注（这里直接改盘上的同一份 JSON）。
    const outlinePath = join(root, '大纲', 'outline.json')
    const edited = JSON.parse(await readFile(outlinePath, 'utf-8'))
    edited.nodes[0].title = '第一章《牛肉汤》（作者改名）'
    edited.nodes[0].note = '作者自己的备注'
    await writeFile(outlinePath, JSON.stringify(edited, null, 2), 'utf-8')

    // 新的一批章节稿进来（另一个文件名 + 新章节标题）。
    const extra = '# 续稿\n\n## 第三章《归途》\n\n### 简纲\n1. 归途遇雨。\n'
    await writeFile(join(root, '大纲', '005.md'), extra, 'utf-8')

    const second = await importOutlineChapters({ root, fileService, dryRun: false })
    assert.equal(second.ok, true, JSON.stringify(second.error ?? {}))
    assert.equal(second.value.imported, 1)
    assert.equal(second.value.reused, 2)

    const document = await readOutline(root)
    assert.equal(document.nodes.length, 3)
    assert.equal(document.nodes[0].title, '第一章《牛肉汤》（作者改名）')
    assert.equal(document.nodes[0].note, '作者自己的备注')
    assert.equal(document.nodes[2].id, 'imp-3', '追加 id 不与现有 imp-1/imp-2 冲突')
    assert.equal(document.nodes[2].source, '大纲/005.md#第三章《归途》')
    assert.deepEqual(document.edges, [])
  } finally {
    await workspace.cleanup()
  }
})

test('导入：修订冲突原样上抛 STALE_REVISION，不重试不覆盖', async () => {
  const { workspace, root, fileService } = await setupProject('outline-stale', { '001-004.md': CHAPTER_FIXTURE })
  try {
    const first = await importOutlineChapters({ root, fileService, dryRun: false })
    assert.equal(first.ok, true)
    const outlinePath = join(root, '大纲', 'outline.json')
    const before = await readFile(outlinePath, 'utf-8')

    let askedRevision = null
    const conflictedWriter = {
      list: fileService.list.bind(fileService),
      read: fileService.read.bind(fileService),
      write: async (args) => {
        askedRevision = args.expectedRevision
        return fail('STALE_REVISION', '「大纲/outline.json」已被改动（第 2 版），本次基于第 1 版的写入被拒绝', { expected: 1, actual: 2 })
      }
    }
    // 新章节让本次确实有东西要写（否则服务根本不会走到 write）。
    await writeFile(join(root, '大纲', '005.md'), '## 第三章《归途》\n内容\n', 'utf-8')

    const conflicted = await importOutlineChapters({ root, fileService: conflictedWriter, dryRun: false })
    assert.equal(conflicted.ok, false)
    assert.equal(conflicted.error.code, 'PINAX_STALE_REVISION')
    assert.equal(askedRevision, 1, '写盘必须带 read 到的修订号')
    assert.equal(await readFile(outlinePath, 'utf-8'), before, '冲突时一个字节都不许写')
  } finally {
    await workspace.cleanup()
  }
})
