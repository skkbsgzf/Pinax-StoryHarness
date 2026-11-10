/**
 * 整本书稿的纯文本口径（批次46B · 任务③）：不碰文件系统，渲染层与主进程都能引。
 *
 * 单独成档的原因：IPC 契约（渲染层也加载）只需要 BOOK_DIR／BOOK_MAX_CHARS 与
 * 章节命名、标题解析这几个纯函数；若直接从 exportService.mjs 引，node:fs／node:path
 * 会跟着进渲染层 bundle。IO 部分仍留在 exportService.mjs。
 */

/** 整本导出的正文字符上限：比单篇宽一档，挡的是误把库里其它大目录当正文。 */
export const BOOK_MAX_CHARS = 2_000_000
export const BOOK_DIR = '正文'
export const CHAPTER_FILE = /\.md$/iu
export const CHAPTER_ORDER = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

/** 「003-倒带.md」→「倒带」：与章节树同一口径（只剥 .md 与 NNN- 前缀）。 */
export function chapterTitleOf(name) {
  return String(name ?? '').replace(/\.md$/iu, '').replace(/^\d{1,3}-/u, '')
}

/** 章节分隔行（txt）：一行清楚的标题，正文原样跟在后面。 */
export function chapterSeparator(title) {
  return `\n\n========== ${String(title ?? '').trim()} ==========\n\n`
}

/** 整本 txt：逐章原文，章与章之间夹一行章节分隔线；不加工正文本身。 */
export function composeBookText(chapters = []) {
  return chapters.map((chapter) => `${chapterSeparator(chapter.title)}${chapter.text}`).join('').replace(/^\n+/u, '')
}

/** 文件名里不许出现的字符（Windows 最严一档）＋控制字符；空白折叠。 */
function sanitizeTitle(value) {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|]/gu, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '')
    .slice(0, 80)
}

/**
 * 导入文档的标题：第一个一级标题（`# 标题`）优先；没有就用文件名（去扩展名）。
 * 清洗掉文件名禁用字符；全空时退回「未导入的稿子」，绝不让空标题落成 `.md`。
 */
export function parseDocumentTitle({ text = '', fileName = '' } = {}) {
  const fromBody = String(text ?? '').match(/^\s*#\s+(.+?)\s*$/mu)?.[1] ?? ''
  const fallback = String(fileName ?? '').replace(/\.(?:txt|md)$/iu, '')
  const title = sanitizeTitle(fromBody || fallback)
  return title || '未导入的稿子'
}

/**
 * 下一个章节文件名：NNN-标题.md。
 * 序号取正文目录里已有的最大三位前缀 +1（不足三位补零）；标题撞名时加 -2／-3，不覆盖任何既有章。
 */
export function nextChapterName({ title, existing = [] } = {}) {
  const names = (Array.isArray(existing) ? existing : []).map((entry) => String(entry ?? '').replaceAll('\\', '/').split('/').pop())
  let max = 0
  for (const name of names) {
    const matched = name.match(/^(\d{1,3})(?=[-－_.\s])/u)
    if (matched) max = Math.max(max, Number(matched[1]))
  }
  const prefix = String(max + 1).padStart(3, '0')
  const base = sanitizeTitle(title) || '未命名'
  const taken = new Set(names.map((name) => name.toLowerCase()))
  let candidate = `${prefix}-${base}.md`
  let suffix = 2
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${prefix}-${base}-${suffix}.md`
    suffix += 1
  }
  return { name: candidate, sequence: max + 1, title: base }
}
