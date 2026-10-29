import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'
import { sanitizeHtml } from './sanitizeFallback.mjs'

/**
 * 导出当前文档（批次26 · 任务三）。
 *
 * 两种格式，零新依赖：
 *   txt —— 原样写作者手上的文本（与阅读态同源；不加工、不改行尾）；
 *   doc —— HTML 包裹后存成 .doc 后缀：Word / WPS 都认这份 MIME 嗅探，打开就是带样式的文档，
 *          不需要任何转换库。渲染层已经把 md 渲染成 HTML（mdRender.mjs），这里只负责套一层
 *          <html><head>…<body>，所以 doc 里看到的是标题、粗体、列表，而不是一堆星号。
 *
 * 三条边界：
 *   1) 只写作者在系统对话框里显式选定的那一个路径——路径校验在 write 之前做完，半路失败不留残稿；
 *   2) 不碰项目目录结构（导出是「另存一份」，不是搬文件）；.pinax/ 元数据一律不许当导出目标；
 *   3) 不含 md 渲染器的兜底：没给 html 时按纯文本转义＋换行成 <br>，绝不把未转义文本塞进 HTML。
 */

export const EXPORT_FORMATS = Object.freeze(['txt', 'doc'])
export const EXPORT_EXTENSIONS = Object.freeze({ txt: '.txt', doc: '.doc' })
/** 单篇导出的上限：与载体工具的单篇上限同档（200000 字符），挡的是误传整库而不是正常稿子。 */
export const EXPORT_MAX_CHARS = 200_000

/** 路径校验（纯函数，可单测）：返回规范化后的 { path, format, extension } 或 INVALID_INPUT。 */
export function resolveExportTarget({ format, targetPath } = {}) {
  const kind = String(format ?? 'txt').trim().toLowerCase()
  if (!EXPORT_FORMATS.includes(kind)) {
    return fail('INVALID_INPUT', `导出格式只支持 ${EXPORT_FORMATS.join(' / ')}`, { format })
  }
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return fail('INVALID_INPUT', '导出需要一个目标路径（由系统「另存为」对话框给出）')
  }
  const path = targetPath.trim().replaceAll('\\', '/')
  if (path.includes('\u0000')) return fail('INVALID_INPUT', '目标路径含非法字符', { path: targetPath })
  if (!isAbsolute(targetPath.trim())) {
    return fail('INVALID_INPUT', '导出目标必须是绝对路径：相对路径会落到进程的当前目录，作者看不到', { path })
  }
  const segments = path.split('/')
  if (segments.some((part) => part === '..' || part === '.')) {
    return fail('INVALID_INPUT', '导出目标里不许出现 . 或 .. 段', { path })
  }
  if (segments.includes('.pinax')) {
    return fail('INVALID_INPUT', '.pinax/ 是内核元数据目录，不能当导出目标', { path })
  }
  if (/\/$/u.test(path)) return fail('INVALID_INPUT', '导出目标是文件名，不是目录', { path })

  const expected = EXPORT_EXTENSIONS[kind]
  if (!path.toLowerCase().endsWith(expected)) {
    return fail('INVALID_INPUT', `${kind} 导出的文件名必须以 ${expected} 结尾`, { path, format: kind })
  }
  return ok({ path: targetPath.trim(), format: kind, extension: expected })
}

/** HTML 转义（doc 的纯文本兜底用；渲染层给的 html 已经是可信片段，不再转）。 */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * doc 的完整 HTML：Word 只认「有 <html> 包裹」这一点，其余是中文排版的最小配套。
 * body 优先用渲染层给的 html（md 渲染产物），没有就按纯文本转义、换行成 <br>。
 */
export function buildDocumentHtml({ content = '', html = null, title = '' } = {}) {
  const safeTitle = escapeHtml(String(title ?? '').trim() || '导出文档')
  // 渲染层给的 html 也过一遍清洗（IPC 载荷按不可信处理）。清洗来自 sanitizeFallback——
  // 主进程不引 mdRender（那会连带 marked/dompurify 进主进程 bundle，批次32 边界）。
  const body = typeof html === 'string' && html.trim()
    ? sanitizeHtml(html)
    : escapeHtml(content).replace(/\r\n?/gu, '\n').replaceAll('\n', '<br>')
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${safeTitle}</title>`,
    '<style>body{font-family:"PingFang SC","Microsoft YaHei",serif;font-size:15px;line-height:1.85;color:#1a1a1a;}h1,h2,h3{color:#1a1a1a;}</style>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>'
  ].join('\n')
}

/**
 * 落盘。txt 与源文本逐字节一致（只按 UTF-8 写）；doc 写上面那份 HTML 包裹。
 * 成功返回 { path, format, extension, bytes }；任何失败原样报出，不假装导出过。
 */
export async function exportDocument({ content, format = 'txt', targetPath, title = '', html = null, write = writeFile } = {}) {
  if (typeof content !== 'string') return fail('INVALID_INPUT', '导出内容必须是字符串')
  if (!content.length) return fail('INVALID_INPUT', '这篇文档是空的，没有可导出的内容')
  if (content.length > EXPORT_MAX_CHARS) {
    return fail('INVALID_INPUT', `导出内容超出单篇上限 ${EXPORT_MAX_CHARS} 字符`, { chars: content.length })
  }
  const target = resolveExportTarget({ format, targetPath })
  if (!target.ok) return target

  const payload = target.value.format === 'doc'
    ? buildDocumentHtml({ content, html, title })
    : content

  try {
    await write(target.value.path, payload, 'utf-8')
  } catch (error) {
    return fail('IO_FAILED', `导出失败：${String(error?.message || error)}`, { path: target.value.path })
  }
  return ok({
    path: target.value.path,
    format: target.value.format,
    extension: target.value.extension,
    bytes: Buffer.byteLength(payload, 'utf-8')
  })
}

export default exportDocument
