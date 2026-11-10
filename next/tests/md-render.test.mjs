import test from 'node:test'
import assert from 'node:assert/strict'
import {
  renderMarkdown,
  sanitizeHtml
} from '../shell/mdRender.mjs'
import { fallbackSanitize } from '../shell/sanitizeFallback.mjs'

/**
 * 批次32 · 任务三（node 轨）：mdRender 换成 marked 之后的输出口径。
 *
 * node --test 里没有 window，所以 renderMarkdown 走的是 fallbackSanitize 那一档
 * （主进程里的 exportService 也是这一档）。这里钉两件事：
 *   1) 新内核真的把 marked 认识的东西吐成了真标签（标题／粗体／行内代码／表格）；
 *   2) 没有 DOM 的那一档照样剥 <script>、on* 与 javascript: ——安全不靠「有没有浏览器」。
 * 渲染层那一档（DOMPurify）在 next/tests/md-render.spec.mjs（jsdom）里跑。
 */

test('node 轨输出口径：标题 <h1>、粗体 <strong>、行内代码 <code>、表格 <table>', () => {
  const html = renderMarkdown([
    '# 第002章',
    '',
    '这是**粗体**与`行内代码`。',
    '',
    '| 列一 | 列二 |',
    '| --- | --- |',
    '| 甲 | 乙 |'
  ].join('\n'))

  assert.match(html, /<h1>第002章<\/h1>/u)
  assert.match(html, /<strong>粗体<\/strong>/u)
  assert.match(html, /<code>行内代码<\/code>/u)
  assert.match(html, /<table>/u, '表格是批次32 新能力：手写版认不出，marked 认得出')
  assert.match(html, /<th>列一<\/th>/u)
  assert.match(html, /<td>甲<\/td>/u)
})

test('node 轨新能力：任务列表、自动链接、h4–h6 都进真标签', () => {
  const html = renderMarkdown([
    '#### 场1｜创世讲古',
    '',
    '- [ ] 未做',
    '- [x] 已做',
    '',
    '自动链接 https://example.com/a'
  ].join('\n'))

  assert.match(html, /<h4>场1｜创世讲古<\/h4>/u)
  assert.match(html, /<input[^>]*type="checkbox"/u, '任务列表的 checkbox 要留着（引擎是原生的）')
  assert.match(html, /<a href="https:\/\/example\.com\/a">/u)
})

test('fallbackSanitize（无 DOM 档）剥 script／事件属性／javascript: 协议', () => {
  assert.equal(fallbackSanitize('<p>好</p><script>alert(1)</script>'), '<p>好</p>')
  assert.equal(fallbackSanitize('<p onclick="alert(1)">好</p>'), '<p>好</p>')
  assert.equal(fallbackSanitize('<a href="javascript:alert(1)">点</a>'), '<a href="#">点</a>')
  assert.equal(fallbackSanitize('<img src="data:text/html;base64,xx" alt="图">'), '<img src="#" alt="图">')
  // 浏览器解析 URL 时会忽略空白：`java\nscript:` 就是 javascript:，不能只在字面上躲。
  assert.equal(fallbackSanitize('<a href="java\nscript:alert(1)">点</a>'), '<a href="#">点</a>')
  assert.equal(fallbackSanitize('<a href=javascript:alert(1)>点</a>'), '<a href="#">点</a>')
  // 文字里的 onerror= 是普通文字，不许被当成属性摘掉。
  assert.equal(fallbackSanitize('<p>原文写了 onerror=alert(1)</p>'), '<p>原文写了 onerror=alert(1)</p>')
})

test('node 轨 renderMarkdown 也要挡住 executable 内容（无 DOM 不等于不设防）', () => {
  const html = renderMarkdown([
    '<script>alert(1)</script>',
    '',
    '<p onclick="alert(2)">点我</p>',
    '',
    '[恶意](javascript:alert(3))'
  ].join('\n'))

  assert.doesNotMatch(html, /<script/iu)
  assert.doesNotMatch(html, /alert\(1\)/u)
  assert.doesNotMatch(html, /onclick/iu)
  assert.doesNotMatch(html, /javascript:/iu)
  assert.match(html, /点我/u, '剥的是可执行内容，不是作者的文字')
})

test('空文本返回空串；sanitizeHtml 在无 DOM 时落到 fallback 档', () => {
  assert.equal(renderMarkdown(''), '')
  assert.equal(renderMarkdown('   \n\t'), '')
  assert.equal(renderMarkdown(null), '')
  assert.equal(sanitizeHtml(''), '')
  assert.equal(sanitizeHtml('<script>x</script><p>留</p>'), '<p>留</p>')
})
