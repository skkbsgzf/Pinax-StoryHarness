import { applyChapterPatch } from '@pinax/core/domain/chapterPatch'
import { chapterRevision, normalizeChapterRecord } from '@pinax/core/domain/chapter'
import { CORE_ERROR_CODES } from '@pinax/core/contracts/errors'
import { fail, ok } from '../../kernel/errors.mjs'
import { NOVEL_CARRIER_ID } from './manifest.mjs'

/**
 * T4：fileService → Core ChapterStore 的薄适配器。
 *
 * 语义分工（这一层不发明规则）：
 *   - 章节保存的「revision 递增、content-only 清结构化侧车、STALE 判定」全部由
 *     `@pinax/core/domain/chapterPatch` 的 applyChapterPatch 决定，这里只把它要的
 *     current 记录读出来、把落盘交给 fileService；
 *   - 归属闸／作用域闸／修订号账／快照／提案保护仍在 fileService，一个字节没搬；
 *   - Core 的错误码在 `toHostResult` 一处翻译成宿主 PINAX_* 码，不外泄 CORE_ERROR_CODES。
 *
 * 落盘标识：ChapterStore 的 chapterId 就是「相对正文/ 的路径」（如 第001章-入场.md、
 * 第一卷/第001章-雨夜.md）。返回记录带 `fileReceipt`（fileService 原始回执），
 * 供工具层取 sha256／bytes／relativePath，不另开第二次读盘。
 */
const HOST_ERROR_KEY_BY_CORE = Object.freeze({
  [CORE_ERROR_CODES.STALE_REVISION]: 'STALE_REVISION',
  [CORE_ERROR_CODES.IO_FAILED]: 'IO_FAILED',
  [CORE_ERROR_CODES.INVALID_INPUT]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.CHAPTER_NOT_FOUND]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.BOOK_NOT_FOUND]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.DUPLICATE_CHAPTER]: 'INVALID_INPUT'
})

/**
 * Core 结果 → 宿主结果。fileService 自己回来的 PINAX_* 错误原样放行（已是宿主信封），
 * Core 的裸码按上表翻译；没登记的一律落到 INVALID_INPUT，绝不把 CORE_ERROR_CODES 漏出去。
 */
export function toHostResult(result) {
  if (!result || result.ok) return result
  const error = result.error ?? {}
  const code = String(error.code ?? '')
  if (code.startsWith('PINAX_')) return result
  const key = HOST_ERROR_KEY_BY_CORE[code] ?? 'INVALID_INPUT'
  return fail(key, typeof error.message === 'string' && error.message ? error.message : '章节操作失败', error.details)
}

function dirRelativePath(file) {
  return String(file ?? '').replaceAll('\\', '/')
}

export function createNovelChapterStore({ pluginId = NOVEL_CARRIER_ID, fileService, dir, listFiles } = {}) {
  if (!fileService || typeof fileService.read !== 'function' || typeof fileService.write !== 'function' || typeof fileService.deleteFile !== 'function') {
    throw new TypeError('createNovelChapterStore 需要已打开项目的文件服务（read/write/deleteFile）')
  }
  if (typeof dir !== 'string' || !dir) throw new TypeError('createNovelChapterStore 需要板块目录（如 正文）')
  // 章节枚举（卷序、标题、序号）是载体自己的语义，Core 不重造一份；list 只按它给的清单逐章读。
  if (typeof listFiles !== 'function') throw new TypeError('createNovelChapterStore 需要 listFiles 提供章节清单')

  const projectPath = (id) => `${dir}/${id}`

  function record(id, value) {
    return normalizeChapterRecord({
      id,
      title: id.replace(/\.md$/iu, ''),
      content: typeof value?.text === 'string' ? value.text : '',
      revision: value?.revision,
      fileReceipt: value ?? null
    })
  }

  function read(_bookId, file) {
    const id = dirRelativePath(file)
    return fileService.read({ pluginId, dir, file: id })
      .then((result) => (result.ok ? ok(record(id, result.value)) : toHostResult(result)))
  }

  /**
   * 改稿前的当前记录。盘上没有这个文件时按「第 0 版」建档再交给 applyChapterPatch：
   * 与 fileService.write 的同名口径一致（否则本来该报 STALE_REVISION 的保存会被读前置改报 INVALID_INPUT）。
   */
  async function currentForPatch(bookId, id) {
    const current = await read(bookId, id)
    if (current.ok) return current
    const missing = current.error?.code === 'PINAX_INVALID_INPUT' && current.error?.details?.path === projectPath(id)
    return missing ? ok(record(id, { text: '', revision: 0 })) : current
  }

  function staleFailure(id, expectedRevision, actual, verb) {
    return fail('STALE_REVISION', `「${projectPath(id)}」已被改动（第 ${actual} 版），本次基于第 ${expectedRevision} 版的${verb}被拒绝`, {
      path: projectPath(id), expected: expectedRevision, actual
    })
  }

  return {
    async list(bookId) {
      const listed = await listFiles()
      if (!listed.ok) return toHostResult(listed)
      const rows = []
      for (const item of listed.value?.chapters ?? []) {
        const file = dirRelativePath(item.file)
        const row = await read(bookId, file.startsWith(`${dir}/`) ? file.slice(dir.length + 1) : file)
        if (!row.ok) return row
        rows.push(row.value)
      }
      return ok(rows)
    },

    read,

    async create(_bookId, chapter) {
      const id = dirRelativePath(chapter?.id)
      const content = typeof chapter?.content === 'string' ? chapter.content : ''
      const written = await fileService.write({ pluginId, dir, file: id, text: content, expectedRevision: 0 })
      return written.ok ? ok(record(id, { ...written.value, text: content })) : toHostResult(written)
    },

    async update(bookId, file, patch, { expectedRevision } = {}) {
      const id = dirRelativePath(file)
      const current = await currentForPatch(bookId, id)
      if (!current.ok) return current
      const next = applyChapterPatch(current.value, patch ?? {}, { expectedRevision })
      if (!next.ok) {
        if (next.error?.code !== CORE_ERROR_CODES.STALE_REVISION) return toHostResult(next)
        const actual = Number.isSafeInteger(next.error.details?.actual) ? next.error.details.actual : chapterRevision(current.value)
        return staleFailure(id, expectedRevision, actual, '写入')
      }
      const written = await fileService.write({ pluginId, dir, file: id, text: next.value.content, expectedRevision })
      return written.ok ? ok(record(id, { ...written.value, text: next.value.content })) : toHostResult(written)
    },

    async remove(bookId, file, { expectedRevision } = {}) {
      const id = dirRelativePath(file)
      const current = await read(bookId, id)
      if (!current.ok) return current
      const actual = chapterRevision(current.value)
      if (actual !== expectedRevision) return staleFailure(id, expectedRevision, actual, '删除')
      const deleted = await fileService.deleteFile({ pluginId, dir, file: id })
      return deleted.ok ? current : toHostResult(deleted)
    }
  }
}
