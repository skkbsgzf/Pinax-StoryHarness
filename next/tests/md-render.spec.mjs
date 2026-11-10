import { describe, expect, it } from 'vitest'
import { renderMarkdown, sanitizeHtml } from '../shell/mdRender.mjs'
import { fallbackSanitize } from '../shell/sanitizeFallback.mjs'

/**
 * 批次32 · 任务三（jsdom 轨）：渲染层那一档清洗（DOMPurify ＋ allow-list）。
 *
 * 与 node 轨（next/tests/md-render.test.mjs）共用同一个 mdRender，但环境不同：
 * 这里 globalThis.window 在，sanitizeHtml 走 DOMPurify；主进程与 node --test 走 fallbackSanitize。
 * 上限不同（DOMPurify 是 allow-list，fallback 是 deny 危险面），但下限必须一样：
 * 两条输入、两档各跑一遍，executable 内容一条都不许穿透。
 */

const HOSTILE = [
  '<script>alert(1)</script>',
  '',
  '<p onclick="alert(2)">点我</p>',
  '',
  '<img src="x" onerror="alert(3)">',
  '',
  '[恶意](javascript:alert(4))'
].join('\n')

describe('DOMPurify 档（渲染层真环境）', () => {
  it('剥 <script>、on* 事件属性与 javascript: 链接', () => {
    const html = renderMarkdown(HOSTILE)
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/alert\(1\)/u)
    expect(html).not.toMatch(/onclick|onerror/u)
    expect(html).not.toMatch(/javascript:/iu)
    // 文字按文字留着：剥的是可执行内容，不是作者写的东西。
    expect(html).toContain('点我')
  })

  it('表格与任务列表进 allow-list：<table> 渲染，checkbox 是原生控件', () => {
    const html = renderMarkdown([
      '| 列一 | 列二 |',
      '| --- | --- |',
      '| 甲 | 乙 |',
      '',
      '- [x] 已完成'
    ].join('\n'))
    expect(html).toContain('<table>')
    expect(html).toContain('<th>列一</th>')
    expect(html).toContain('<td>甲</td>')
    expect(html).toMatch(/<input[^>]*type="checkbox"/u)
    expect(html).toContain('checked')
  })
})

describe('两档安全口径一致性（允许实现差异，禁 executable 内容穿透）', () => {
  // 这一组直接喂 HTML（不是 md 源文）：两档的入口都是「清洗一段 html」，
  // 差的是上限（allow-list vs 只剥危险面），下限必须一样。
  const inputs = [
    '<script>alert(1)</script><p onclick="alert(2)">点我</p><img src="x" onerror="alert(3)"><a href="javascript:alert(4)">恶意</a>',
    '<a href="java\nscript:alert(5)">换行绕协议</a><iframe src="https://x"></iframe>'
  ]

  it('同一输入：DOMPurify 档与 fallback 档都不留可执行内容', () => {
    for (const html of inputs) {
      for (const [name, output] of [
        ['DOMPurify', sanitizeHtml(html)],
        ['fallback', fallbackSanitize(html)]
      ]) {
        expect(output, `${name} 档漏了 <script>`).not.toContain('<script')
        expect(output, `${name} 档漏了事件属性`).not.toMatch(/\son[a-z]+\s*=/iu)
        expect(output, `${name} 档漏了 javascript:`).not.toMatch(/javascript:/iu)
        expect(output, `${name} 档漏了 iframe`).not.toContain('<iframe')
      }
    }
  })
})
