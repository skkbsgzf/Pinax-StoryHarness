import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planImport, runImport } from '../runtime/projectImportAdapter.mjs'
import { serializeWorldbookEntryFile } from '../../server/services/localMirrorService.js'

/**
 * E1 导入适配器（next/runtime/projectImportAdapter.mjs）真跑：临时目录造一份 kit 形态的假稿，
 * 断言「分类落位 / dryRun 不落盘 / 源目录只读 / 重跑幂等 / 冲突不覆盖」。
 * 这些是工单承诺，不是实现细节——改了分类规则而这里不红，说明测试没跟上。
 */

function makeWorkspace() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pinax-next-import-'))
  const source = path.join(base, '大梦原稿')
  const target = path.join(base, '大梦项目')
  fs.mkdirSync(source, { recursive: true })
  fs.mkdirSync(path.join(target, '.pinax'), { recursive: true })
  // 目标就是向导里 session.create 建出来的 @2 项目：适配器不解析 spec，只认这个标记文件。
  fs.writeFileSync(path.join(target, '.pinax', 'project.json'), JSON.stringify({ spec: 'pinax-project@2', projectId: 'proj_fixture', name: '大梦', kind: 'novel' }, null, 2))
  return { base, source, target }
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf-8')
}

function seedSource(source) {
  writeFile(path.join(source, '正文', '001-雨夜.md'), '雨夜。\n')
  writeFile(path.join(source, '故事主体', '卷一', '第002章-归途', '小说.md'), '归途正文。\n')
  writeFile(path.join(source, '故事主体', '卷一', '第002章-归途', '剧本.md'), '分镜稿。\n')
  writeFile(path.join(source, '世界书', '人物', '沈青.md'), serializeWorldbookEntryFile({
    id: 'wb_shen_qing',
    name: '沈青',
    kind: 'character',
    content: '沈青的条目正文。'
  }))
  writeFile(path.join(source, '大纲', '梗概.md'), '全书梗概。\n')
  writeFile(path.join(source, '资料', '设定集.md'), '设定资料。\n')
  writeFile(path.join(source, '约束', '文风.md'), '文风约束。\n')
  writeFile(path.join(source, '杂件', '笔记.md'), '认不出类别的笔记。\n')
  writeFile(path.join(source, '图片.png'), 'not-an-image-but-binary-extension')
}

/** 源目录指纹：相对路径 → 内容（字节级），用来证明导入前后源目录一个字节都没变。 */
function snapshotTree(root) {
  const out = {}
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(file); continue }
      out[path.relative(root, file).split(path.sep).join('/')] = fs.readFileSync(file, 'utf-8')
    }
  }
  walk(root)
  return out
}

function listTree(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(file); continue }
      out.push(path.relative(root, file).split(path.sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

test('导入既有稿：计划只读、分类落位、源目录只读、重跑幂等', () => {
  const { base, source, target } = makeWorkspace()
  try {
    seedSource(source)
    const before = snapshotTree(source)

    // —— dryRun：只出计划，目标项目一个文件都不多。
    const planned = planImport({ sourcePath: source, targetPath: target })
    assert.equal(planned.ok, true, planned.error?.message)
    assert.equal(planned.value.mode, 'plan')
    assert.equal(planned.value.importable, 7)
    assert.deepEqual(planned.value.decisions, { chapter: 2, material: 1, worldbook: 1, outline: 1, source: 1, rule: 1 })
    const targets = planned.value.items.map((item) => item.target).sort()
    assert.deepEqual(targets, [
      '世界书/人物/沈青.md',
      '大纲/梗概.md',
      '正文/001-雨夜.md',
      '正文/002-归途.md',
      '资料/章节衍生/第002章-归途/剧本.md',
      '资料/设定集.md',
      '约束/文风.md'
    ].sort())
    const skipped = Object.fromEntries(planned.value.skipped.map((item) => [item.file, item.reason]))
    assert.equal(skipped['杂件/笔记.md'], 'unmapped')
    assert.equal(skipped['图片.png'], 'binary-not-importable')
    assert.deepEqual(listTree(target), ['.pinax/project.json'], 'dryRun 不得往目标项目写任何文件')

    // —— apply：按计划落盘。
    const applied = runImport({ sourcePath: source, targetPath: target })
    assert.equal(applied.ok, true, applied.error?.message)
    assert.equal(applied.value.mode, 'apply')
    assert.equal(applied.value.createdCount, 7)
    assert.equal(applied.value.failedCount, 0)
    assert.equal(fs.readFileSync(path.join(target, '正文', '001-雨夜.md'), 'utf-8'), '雨夜。\n')
    assert.equal(fs.readFileSync(path.join(target, '正文', '002-归途.md'), 'utf-8'), '归途正文。\n')
    assert.ok(fs.existsSync(path.join(target, '世界书', '人物', '沈青.md')))
    assert.ok(fs.existsSync(path.join(target, '资料', '章节衍生', '第002章-归途', '剧本.md')))
    assert.equal(fs.existsSync(path.join(target, '杂件')), false, '认不出类别的文件不得被搬进项目')

    // —— 源目录只读：前后指纹逐字节一致。
    assert.deepEqual(snapshotTree(source), before, '导入不得改/删/增源目录里的任何文件')

    // —— 重跑幂等：同内容复用，不重写、不覆盖。
    const again = runImport({ sourcePath: source, targetPath: target })
    assert.equal(again.ok, true)
    assert.equal(again.value.createdCount, 0)
    assert.equal(again.value.reusedCount, 7)
    assert.equal(again.value.failedCount, 0)
    assert.deepEqual(snapshotTree(source), before)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('导入既有稿：目标已有不同内容时只新增不覆盖（记 write-failed，不吞）', () => {
  const { base, source, target } = makeWorkspace()
  try {
    seedSource(source)
    writeFile(path.join(target, '正文', '001-雨夜.md'), '作者后来改过的另一版。\n')
    const applied = runImport({ sourcePath: source, targetPath: target })
    assert.equal(applied.ok, true)
    assert.equal(applied.value.failedCount, 1)
    assert.equal(applied.value.writeFailures[0].code, 'ERR_FILE_EXISTS')
    assert.equal(applied.value.writeFailures[0].target, '正文/001-雨夜.md')
    assert.equal(fs.readFileSync(path.join(target, '正文', '001-雨夜.md'), 'utf-8'), '作者后来改过的另一版。\n', '既有文件不得被覆盖')
    assert.equal(fs.readFileSync(path.join(source, '正文', '001-雨夜.md'), 'utf-8'), '雨夜。\n')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('导入既有稿：源＝目标、源是/曾是 Pinax 项目、目标不是项目，三种都如实拒', () => {
  const { base, source, target } = makeWorkspace()
  try {
    seedSource(source)

    const same = planImport({ sourcePath: source, targetPath: source })
    assert.equal(same.ok, false)
    assert.equal(same.error.code, 'PINAX_INVALID_INPUT')
    assert.match(same.error.message, /不能就是项目根/)

    // 源目录里已经有 .pinax/project.json：计划阶段如实报「已是或曾是 Pinax 项目」并停。
    writeFile(path.join(source, '.pinax', 'project.json'), '{"spec":"pinax-project@1"}')
    const wasProject = planImport({ sourcePath: source, targetPath: target })
    assert.equal(wasProject.ok, false)
    assert.match(wasProject.error.message, /已是或曾是 Pinax 项目/)
    fs.rmSync(path.join(source, '.pinax'), { recursive: true, force: true })

    const notProject = path.join(base, '不是项目')
    fs.mkdirSync(notProject, { recursive: true })
    const noMarker = planImport({ sourcePath: source, targetPath: notProject })
    assert.equal(noMarker.ok, false)
    assert.match(noMarker.error.message, /还不是 Pinax 项目/)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
