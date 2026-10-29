/**
 * 轻量 Markdown → HTML（批次26 · MD 原生渲染）。
 *
 * 为什么手写而不引第三方：npm install 要网络、打包体积也要守住（bundle 门禁钉着上限），
 * 而阅读态只需要「够用」的一档——标题／粗体／斜体／行内代码／代码块／引用／列表／分隔线／链接。
 * 不认表格、脚注、HTML 内联块、数学公式：认不出的就按段落原样显示（不吞内容、不假装渲染了）。
 *
 * 安全边界（v-html 的唯一入口就在这三行）：
 *   1) 先把整段源文本做 HTML 转义——**作者文档里的原始 HTML 一律当文字**，所以 `<script>` 这类
 *      标签根本没有机会变成元素；渲染出来的标签全部由本模块自己拼。
 *   2) 再拼我们自己的标签（p/h/ul/li/blockquote/pre/code/strong/em/a/br/hr/del）。
 *   3) 出线前过 sanitizeHtml：去掉 script/iframe/style 一类容器与 on* 事件属性、
 *      把 javascript: 协议的链接打成 #。哪怕将来某处忘了转义，这一道也还站着。
 * 链接只认 http(s)、mailto 与相对路径；别的协议（javascript:/data:）只留文字，不留可点的 href。
 */

const BLOCK_START = /^(?:\s*#{1,6}\s|\s*```|\s*>|\s*[-*+]\s|\s*\d+[.)]\s|\s*(?:---|\*\*\*|___)\s*$)/u

/** HTML 转义：文本节点的唯一出口。 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** 出线前的兜底清洗（输入的转义已经挡住绝大部分，这一道是纵深防御）。
 *  只在标签内部动手：文字里的「onerror=」是被转义过的普通文字，不该被摘掉。 */
export function sanitizeHtml(html) {
  return String(html ?? '')
    // 成对的危险容器整段去掉（连内容一起——它们本来就不该出现在稿子里）。
    .replace(/<\s*(script|style|iframe|object|embed|form|noscript)\b[\s\S]*?<\s*\/\s*\1\s*>/giu, '')
    // 落单的开标签（没有闭合的）也去掉。
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|noscript|link|meta|base)\b[^>]*>/giu, '')
    .replace(/<[^>]*>/gu, (tag) => tag
      // 事件属性一律摘掉（onclick / onerror / onload …）。
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '')
      // javascript:/vbscript:/data: 的 href/src 打成 #，不留可点的危险协议。
      .replace(/\b(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data):[^"']*\2/giu, '$1="#"'))
}

/** 链接白名单：http(s)、mailto、站内相对路径；其余只留文字。 */
function safeHref(rawUrl) {
  const url = String(rawUrl ?? '').trim()
  if (!url) return null
  if (/^(?:https?:\/\/|mailto:)/iu.test(url)) return url
  if (/^[a-z][a-z0-9+.-]*:/iu.test(url)) return null
  return url
}

/** 行内标记：先转义，再按「代码 → 粗体 → 斜体 → 删除线 → 链接」的顺序套标签。 */
export function renderInline(raw) {
  let text = escapeHtml(raw)
  // 行内代码最先：里面的星号/下划线不该被当成强调。
  const codes = []
  text = text.replace(/`([^`\n]+)`/gu, (_match, code) => {
    codes.push(`<code>${code}</code>`)
    return `\uE000${codes.length - 1}\uE000`
  })
  text = text.replace(/\*\*([^*\n]+)\*\*/gu, '<strong>$1</strong>')
  text = text.replace(/__([^_\n]+)__/gu, '<strong>$1</strong>')
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/gu, '$1<em>$2</em>')
  text = text.replace(/(^|[^_\w])_([^_\n]+)_/gu, '$1<em>$2</em>')
  text = text.replace(/~~([^~\n]+)~~/gu, '<del>$1</del>')
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/gu, (_match, label, url) => {
    const href = safeHref(url)
    if (!href) return label
    return `<a href="${href}" rel="noreferrer noopener" target="_blank">${label}</a>`
  })
  // 代码片段回填（占位符里只有序号，不会被上面的强调规则伤到）。
  return text.replace(/\uE000(\d+)\uE000/gu, (_match, index) => codes[Number(index)] ?? '')
}

/**
 * Markdown 源文本 → 安全的 HTML 片段。空文本返回空串（调用方据此决定要不要画容器）。
 * 块级：标题／围栏代码块／引用／无序列表／有序列表／分隔线／段落；段落内换行保留成 <br>。
 */
export function renderMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/gu, '\n')
  if (!text.trim()) return ''
  const lines = text.split('\n')
  const html = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    // 围栏代码块（```lang）——里面原样保留，不做行内标记。
    const fence = /^\s*```([A-Za-z0-9_+-]*)\s*$/u.exec(line)
    if (fence) {
      const body = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      index += 1 // 跳过闭合围栏（没有闭合就吃到文末，不丢内容）
      html.push(`<pre class="md-code"><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (heading) {
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`)
      index += 1
      continue
    }

    if (/^\s*(?:---|\*\*\*|___)\s*$/u.test(line)) {
      html.push('<hr>')
      index += 1
      continue
    }

    // 引用：连续的 > 行收成一块，块内按段落（空 > 行分段）。
    if (/^\s*>/u.test(line)) {
      const inner = []
      while (index < lines.length && /^\s*>/u.test(lines[index])) {
        inner.push(lines[index].replace(/^\s*>\s?/u, ''))
        index += 1
      }
      html.push(`<blockquote>${paragraphsOf(inner)}</blockquote>`)
      continue
    }

    // 无序列表：连续的 -/*/+ 行。
    if (/^\s*[-*+]\s+/u.test(line)) {
      const items = []
      while (index < lines.length && /^\s*[-*+]\s+/u.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/u, ''))
        index += 1
      }
      html.push(`<ul>${items.map((item) => `<li>${renderInline(item.trim())}</li>`).join('')}</ul>`)
      continue
    }

    // 有序列表：连续的 1. / 1) 行。
    if (/^\s*\d+[.)]\s+/u.test(line)) {
      const items = []
      while (index < lines.length && /^\s*\d+[.)]\s+/u.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/u, ''))
        index += 1
      }
      html.push(`<ol>${items.map((item) => `<li>${renderInline(item.trim())}</li>`).join('')}</ol>`)
      continue
    }

    // 段落：一直吃到空行或另一个块的开头。
    const paragraph = []
    while (index < lines.length && lines[index].trim() && !BLOCK_START.test(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    if (!paragraph.length) {
      // 兜底：认得出是「块的开头」却没有分支接住的行，按段落原样显示，绝不空转。
      html.push(`<p>${renderInline(lines[index].trim())}</p>`)
      index += 1
      continue
    }
    html.push(`<p>${paragraph.map((item) => renderInline(item.trim())).join('<br>')}</p>`)
  }

  return sanitizeHtml(html.join('\n'))
}

/** 引用块内部：空行分段，段落内换行成 <br>。 */
function paragraphsOf(lines) {
  const out = []
  let current = []
  const flush = () => {
    if (!current.length) return
    out.push(`<p>${current.map((item) => renderInline(item.trim())).join('<br>')}</p>`)
    current = []
  }
  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return out.join('')
}

export default renderMarkdown
