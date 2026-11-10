/**
 * Markdown → 安全 HTML（批次26 建、批次32 换内核）。
 *
 * 内核换成旧线同款：`marked` 解析 ＋ `dompurify` 清洗（两者本来就在 package.json，属复用不是新增）。
 * 批次26 那份手写解析器认不出的东西（表格／图片／任务列表／自动链接／h4–h6／行内 HTML），
 * 换 marked 之后全都认——「中心区域支持 Web 和 MD 的这部分尽可能迁移」的第一档。
 *
 * 安全边界（v-html 的唯一入口就在本模块）：
 *   marked@18 是**故意宽松**的：它不剥 <script>、不剥 onclick、不管 javascript: 协议。
 *   所以解析出来的 HTML 一律要过清洗，两档（按运行环境选，口径一致：都不许可执行内容穿透）：
 *     · 有 DOM（渲染层真环境 / vitest+jsdom）→ DOMPurify＋allow-list（与 src/utils/sanitize.js 同源表）；
 *     · 无 DOM（node --test 轨）→ fallbackSanitize（独立模块 next/shell/sanitizeFallback.mjs，
 *       零第三方依赖——主进程的 exportService 直接认那个模块，本模块的 marked/dompurify
 *       不得进主进程 bundle，批次32 调度方补刀）。正则剥容器标签／事件属性／危险协议，
 *       比 DOMPurify 松（不做 allow-list），但危险面同样封死。
 *   两档都剥 <script>、都摘 on*、都把 javascript:／vbscript:／data: 的 href/src 打成 #。
 *
 * 对外只有 renderMarkdown(text) → html 字符串（签名自批次26 起不变）：
 * 调用方是 CarrierPaneHost 三处阅读面与提案两段、设置里「文档 → 导出」的 doc 导出。
 */

import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { fallbackSanitize } from './sanitizeFallback.mjs'

/**
 * allow-list：与 `src/utils/sanitize.js` 的 HTML_CONFIG **同源**（旧线口径，单一事实源在那边）。
 * 这里复制而不 import，是因为 next/ 是独立重写线：渲染层产物不许把旧轨（src/）拖进来
 * （打包门禁 f「渲染层依赖薄」就是这么规定的）。表更新时两边一起改。
 *
 * 唯一差异（批次32 记明）：多收 `input` 标签与 `checked`／`disabled` 两个属性——
 * GFM 任务列表由 marked 输出 `<input type="checkbox" disabled>`，不允许它就只剩空条目。
 * 这三项都是惰性标记，没有事件、没有协议、不能执行任何东西。
 */
const HTML_CONFIG = Object.freeze({
  ALLOWED_TAGS: [
    'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'figcaption',
    'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins',
    'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strong', 'sub',
    'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul'
  ],
  ALLOWED_ATTR: [
    'href', 'title', 'alt', 'src', 'class', 'id', 'lang', 'dir',
    'colspan', 'rowspan', 'start', 'type', 'rel', 'target', 'checked', 'disabled'
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
})

/** GFM 起手：表格／任务列表／自动链接要；单换行不折 <br>（breaks:false，与旧线一致）。 */
marked.setOptions({ gfm: true, breaks: false })

/** 渲染层真环境才有 DOM；DOMPurify 在没有 document 时会退化成「原样返回」，所以两个条件都要判。 */
function hasDom() {
  return typeof globalThis.window !== 'undefined'
    && typeof globalThis.window?.document !== 'undefined'
    && DOMPurify.isSupported === true
}


/**
 * 双档清洗：有 DOM 走 DOMPurify（allow-list），没有就走 fallbackSanitize（独立模块）。
 * 主进程不经本模块拿清洗——exportService 直接 import sanitizeFallback.mjs，
 * 免得 marked/dompurify 的模块图拖进主进程 bundle（批次32 评审发现，调度方切断）。
 */
export function sanitizeHtml(html) {
  if (html == null || html === '') return ''
  return hasDom()
    ? DOMPurify.sanitize(String(html), HTML_CONFIG)
    : fallbackSanitize(html)
}

/**
 * Markdown 源文本 → 安全的 HTML 片段。空文本返回空串（调用方据此决定要不要画容器）。
 * 解析交给 marked（gfm 表格／任务列表／自动链接／行内 HTML 都认），清洗交给 sanitizeHtml。
 */
export function renderMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/gu, '\n')
  if (!text.trim()) return ''
  // async:false 是 marked 的默认值，这里写死是为了拿到的永远是字符串而不是 Promise。
  const parsed = marked.parse(text, { async: false, gfm: true, breaks: false })
  return sanitizeHtml(typeof parsed === 'string' ? parsed : '')
}

export default renderMarkdown
