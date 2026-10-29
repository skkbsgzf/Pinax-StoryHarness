import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import {
  EXPORT_FORMATS,
  buildDocumentHtml,
  exportDocument,
  resolveExportTarget
} from '../shell/exportService.mjs'
import { renderMarkdown } from '../shell/mdRender.mjs'

/**
 * 批次26 · 任务三：导出为 txt／doc。
 * 证四件事：txt 与作者手上的文本逐字节一致；doc 是 HTML 包裹（Word 认这一层）；
 * 路径校验在写盘之前做完（相对路径／错扩展名／.. 段／.pinax 一律拒，不落半份文件）；
 * 写盘失败如实报 IO_FAILED，不假装导出过。
 * 落盘都在 os.tmpdir() 下，导出目标与项目目录无关（导出是「另存一份」，不动项目结构）。
 */

async function tempDir(label) {
  return mkdtemp(join(tmpdir(), `pinax-next-export-${label}-`))
}

test('txt 导出：与源文本逐字节一致（不加工、不改行尾）', async () => {
  const dir = await tempDir('txt')
  try {
    const content = '# 第002章\n\n雨从檐口滴下来，巷子里没人。\n'
    const target = join(dir, '第002章.txt')
    const result = await exportDocument({ content, format: 'txt', targetPath: target })
    assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
    assert.equal(result.value.format, 'txt')
    assert.equal(result.value.path, target)
    assert.equal(await readFile(target, 'utf-8'), content, 'txt 就是作者手上那份文本')
    assert.ok(result.value.bytes > 0)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  }
})

test('doc 导出：HTML 包裹（<html>…<body>）＋纯文本兜底转义；给了渲染好的 html 就用它', async () => {
  const dir = await tempDir('doc')
  try {
    const content = '雨从檐口滴下来，巷子里没人。'
    const plain = join(dir, '章节.doc')
    const result = await exportDocument({ content, format: 'doc', targetPath: plain, title: '第002章' })
    assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
    const written = await readFile(plain, 'utf-8')
    assert.match(written, /<html>/u, 'doc 必须是 HTML 包裹（Word 靠这一层认格式）')
    assert.match(written, /<body>/u)
    assert.match(written, /<\/body>\s*<\/html>/u)
    assert.match(written, /charset="utf-8"/u)
    assert.match(written, /<title>第002章<\/title>/u)
    assert.match(written, /雨从檐口滴下来/u)
    assert.doesNotMatch(written, /<script/u)

    // 作者正文里带尖括号：兜底路径必须转义，不许把未转义文本塞进 HTML。
    const risky = join(dir, '尖括号.doc')
    await exportDocument({ content: '<script>alert(1)</script>', format: 'doc', targetPath: risky })
    const riskyText = await readFile(risky, 'utf-8')
    assert.doesNotMatch(riskyText, /<script>alert/u)
    assert.match(riskyText, /&lt;script&gt;/u)

    // 渲染层已经渲染好 md（mdRender.mjs）时，doc 里看到的是真标签而不是星号。
    const rendered = join(dir, '排版.doc')
    await exportDocument({
      content: '**粗体**',
      format: 'doc',
      targetPath: rendered,
      html: '<h1>标题</h1><p><strong>粗体</strong></p>'
    })
    const renderedText = await readFile(rendered, 'utf-8')
    assert.match(renderedText, /<h1>标题<\/h1>/u)
    assert.match(renderedText, /<strong>粗体<\/strong>/u)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  }
})

test('路径安全校验：相对路径／错扩展名／.. 段／.pinax／目录一律拒，且一个字节都不写', async () => {
  assert.deepEqual([...EXPORT_FORMATS], ['txt', 'doc'])

  const relative = resolveExportTarget({ format: 'txt', targetPath: '稿件.txt' })
  assert.equal(relative.ok, false)
  assert.equal(relative.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
  assert.match(relative.error.message, /绝对路径/)

  const wrongExt = resolveExportTarget({ format: 'txt', targetPath: join(tmpdir(), '稿件.doc') })
  assert.equal(wrongExt.ok, false)
  assert.match(wrongExt.error.message, /必须以 \.txt 结尾/)

  // 字面量拼 ..（path.join 会把它规范化掉，这里要测的正是「原样带 .. 的输入」）。
  const traversal = resolveExportTarget({ format: 'txt', targetPath: `${tmpdir().replaceAll('\\', '/')}/../逃逸.txt` })
  assert.equal(traversal.ok, false)
  assert.match(traversal.error.message, /\.\./)

  const metadata = resolveExportTarget({ format: 'doc', targetPath: join(tmpdir(), '.pinax', 'proposals', 'x.doc') })
  assert.equal(metadata.ok, false)
  assert.match(metadata.error.message, /\.pinax/)

  const directory = resolveExportTarget({ format: 'txt', targetPath: `${join(tmpdir(), '目录')}/` })
  assert.equal(directory.ok, false)

  const badFormat = resolveExportTarget({ format: 'pdf', targetPath: join(tmpdir(), '稿件.pdf') })
  assert.equal(badFormat.ok, false)
  assert.match(badFormat.error.message, /导出格式只支持/)

  const emptyContent = await exportDocument({ content: '', format: 'txt', targetPath: join(tmpdir(), '空.txt') })
  assert.equal(emptyContent.ok, false)
  assert.match(emptyContent.error.message, /没有可导出/)

  const notString = await exportDocument({ content: null, format: 'txt', targetPath: join(tmpdir(), '坏.txt') })
  assert.equal(notString.ok, false)

  // 硬闸在写之前：被拒的目标路径连写都没发生（写函数一次都不该被调到）。
  let writes = 0
  const rejected = await exportDocument({
    content: '正文',
    format: 'txt',
    targetPath: '相对路径.txt',
    write: async () => { writes += 1 }
  })
  assert.equal(rejected.ok, false)
  assert.equal(writes, 0, '校验不过就不许调用写盘')
})

test('写盘失败如实报 IO_FAILED（不假装导出过），成功时返回字节数', async () => {
  const failure = await exportDocument({
    content: '正文',
    format: 'txt',
    targetPath: join(tmpdir(), '写不进去.txt'),
    write: async () => { throw new Error('EACCES: permission denied') }
  })
  assert.equal(failure.ok, false)
  assert.equal(failure.error.code, NEXT_ERROR_CODES.IO_FAILED)
  assert.match(failure.error.message, /permission denied/)

  const dir = await tempDir('bytes')
  try {
    const okResult = await exportDocument({ content: '一二三', format: 'txt', targetPath: join(dir, '字数.txt') })
    assert.equal(okResult.ok, true, JSON.stringify(okResult.error ?? {}))
    assert.equal(okResult.value.bytes, Buffer.byteLength('一二三', 'utf-8'), '字节数按 UTF-8 算（中文 3 字节）')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  }
})

test('buildDocumentHtml：标题转义、空标题回落、换行进 <br>', () => {
  const html = buildDocumentHtml({ content: '第一行\n第二行', title: '<b>带尖括号</b>' })
  assert.match(html, /<title>&lt;b&gt;带尖括号&lt;\/b&gt;<\/title>/u)
  assert.match(html, /第一行<br>第二行/u)
  const untitled = buildDocumentHtml({ content: 'x' })
  assert.match(untitled, /<title>导出文档<\/title>/u)
})

test('doc 走 mdRender（批次32 换 marked 内核）：表格／标题进 .doc，危险内容仍被剥', async () => {
  const dir = await tempDir('md')
  try {
    const content = [
      '# 第002章',
      '',
      '| 列一 | 列二 |',
      '| --- | --- |',
      '| 甲 | 乙 |',
      '',
      '<script>alert(1)</script>'
    ].join('\n')
    const target = join(dir, '富渲染.doc')
    const result = await exportDocument({
      content,
      format: 'doc',
      targetPath: target,
      html: renderMarkdown(content)
    })
    assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
    const written = await readFile(target, 'utf-8')
    // 表格是批次32 才有的能力：导出面与阅读态同一份 mdRender，doc 里也该是真表格。
    assert.match(written, /<table>/u)
    assert.match(written, /<th>列一<\/th>/u)
    assert.match(written, /<h1>第002章<\/h1>/u)
    assert.doesNotMatch(written, /<script/iu)
    assert.doesNotMatch(written, /alert\(1\)/u)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  }
})
