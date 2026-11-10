/**
 * 无 DOM 环境的兜底清洗（批次26 建、批次32 拆出独立模块）。
 *
 * 为什么独立成档：`mdRender.mjs` 换 marked/dompurify 内核后，主进程的 exportService
 * 若再从 mdRender 拿清洗，模块图会把 marked/dompurify 一并拖进主进程 bundle
 * （+112.8 kB，且违反「主进程不许 import marked」的批次32 边界）。本模块零第三方
 * import——主进程只认这里，渲染层的 DOMPurify 档留在 mdRender 里。
 *
 * 只在标签内部动手：文字里的「onerror=」是被转义过的普通文字，不该被摘掉。
 * 它不做 allow-list（不删白名单外的普通标签），但危险容器／事件属性／危险协议一律不留。
 * 协议那一项先把值里的空白与控制字符抹掉再判——浏览器解析 URL 时会忽略它们，
 * `java\nscript:` 与 `javascript:` 是同一个协议，不抹就等于留了个洞（批次32 补）。
 */
export function fallbackSanitize(html) {
  return String(html ?? '')
    // 成对的危险容器整段去掉（连内容一起——它们本来就不该出现在稿子里）。
    .replace(/<\s*(script|style|iframe|object|embed|form|noscript)\b[\s\S]*?<\s*\/\s*\1\s*>/giu, '')
    // 落单的开标签（没有闭合的）也去掉。
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|noscript|link|meta|base)\b[^>]*>/giu, '')
    .replace(/<[^>]*>/gu, (tag) => tag
      // 事件属性一律摘掉（onclick / onerror / onload …）。
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '')
      // javascript:/vbscript:/data: 的 href/src 打成 #，不留可点的危险协议。
      .replace(/\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu, (match, name, quoted, single, bare) => {
        const normalized = String(quoted ?? single ?? bare ?? '')
          .replace(/\s/gu, '')
          .toLowerCase()
        return /^(?:javascript|vbscript|data):/u.test(normalized) ? `${name}="#"` : match
      }))
}

/**
 * 主进程/无 DOM 环境的清洗入口：恒走 fallback 档（那边没有 window，DOMPurify 也无从工作）。
 * 与 mdRender 的双档 sanitizeHtml 在「禁可执行内容穿透」上同一口径。
 */
export function sanitizeHtml(html) {
  if (html == null || html === '') return ''
  return fallbackSanitize(html)
}
