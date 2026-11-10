import { fail as coreFail, ok as coreOk } from '@pinax/core/contracts/result'
import { CORE_ERROR_CODES } from '@pinax/core/contracts/errors'
import { normalizeNote, updateNote } from '@pinax/core/domain/note'
import { buildNoteUpdatePatch } from '@pinax/core/usecases/noteService'
import { NEXT_ERROR_CODES, fail } from '../../kernel/errors.mjs'
import { NOTES_CARRIER_ID } from './manifest.mjs'

/**
 * T6：fileService → Core NoteStore 的薄适配器。
 *
 * 语义分工（这一层不发明规则）：
 *   - 笔记的标题回退、正文裁剪、字数口径由 Core 的 domain/note 决定；更新输入的清洗
 *     （至少给 title/content、空正文拒绝）由 Core 的 buildNoteUpdatePatch 决定；
 *   - 归属闸／作用域闸／修订号账／快照仍在 fileService，一个字节没搬；
 *   - Core 的 NoteStore 端口本身没有乐观并发（笔记无 revision）；宿主仍要求 expectedRevision，
 *     所以修订号闸留在适配器的 `save` 上（多带一个 options，端口签名不变），
 *     写盘交给 fileService.write 判 STALE——与工具面向作者承诺的语义一致。
 *
 * 错误码只在 toHostResult 一处翻译：fileService 的 PINAX_* 原样放行，Core 裸码按表翻译，
 * 未登记的一律 INVALID_INPUT，绝不把 CORE_ERROR_CODES 漏出载体边界。
 *
 * 落盘标识：noteId 就是「相对构思/ 的路径」（如 雨夜的表.md、正文/偷写.md）。
 * 返回记录带 `fileReceipt`（fileService 原始回执），供工具层取 sha256／bytes／relativePath，
 * 不另开第二次读盘。标题取文件名去 .md（作者在资源管理器里看到的就是这篇的名字）。
 */
const HOST_ERROR_KEY_BY_CORE = Object.freeze({
  [CORE_ERROR_CODES.STALE_REVISION]: 'STALE_REVISION',
  [CORE_ERROR_CODES.IO_FAILED]: 'IO_FAILED',
  [CORE_ERROR_CODES.INVALID_INPUT]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.NOTE_NOT_FOUND]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.DUPLICATE_NOTE]: 'INVALID_INPUT'
})

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

/** 文件名排序（宿主投影：构思目录按资源管理器看到的顺序列）。 */
export function compareNoteNames(left, right) {
  return collator.compare(String(left), String(right))
}

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
  return fail(key, typeof error.message === 'string' && error.message ? error.message : '构思操作失败', error.details)
}

function dirRelativePath(file) {
  return String(file ?? '').replaceAll('\\', '/')
}

function noteTitle(id) {
  return dirRelativePath(id).split('/').pop().replace(/\.md$/iu, '')
}

export function createNotesStore({ pluginId = NOTES_CARRIER_ID, fileService, dir } = {}) {
  if (!fileService || typeof fileService.read !== 'function' || typeof fileService.write !== 'function' || typeof fileService.deleteFile !== 'function') {
    throw new TypeError('createNotesStore 需要已打开项目的文件服务（read/write/deleteFile）')
  }
  if (typeof dir !== 'string' || !dir) throw new TypeError('createNotesStore 需要板块目录（如 构思）')

  const projectPath = (id) => `${dir}/${id}`

  function record(id, value) {
    return normalizeNote({
      id,
      title: noteTitle(id),
      content: typeof value?.text === 'string' ? value.text : '',
      revision: value?.revision,
      fileReceipt: value ?? null
    })
  }

  async function read(noteId) {
    const id = dirRelativePath(noteId)
    const result = await fileService.read({ pluginId, dir, file: id })
    if (result.ok) return coreOk(record(id, result.value))
    const missing = result.error?.code === NEXT_ERROR_CODES.INVALID_INPUT && result.error?.details?.path === projectPath(id)
    return missing ? coreOk(null) : toHostResult(result)
  }

  return {
    async list() {
      const listed = await fileService.list({ pluginId, dir })
      if (!listed.ok) return toHostResult(listed)
      const names = listed.value.entries
        .filter((entry) => entry.kind === 'file' && /\.md$/iu.test(entry.name))
        .map((entry) => entry.name)
        .sort(compareNoteNames)
      const rows = []
      for (const name of names) {
        const row = await read(name)
        if (!row.ok) return row
        if (row.value) rows.push(row.value)
      }
      return coreOk(rows)
    },

    read,

    async create(note) {
      const id = dirRelativePath(note?.id)
      const content = typeof note?.content === 'string' ? note.content : ''
      const written = await fileService.write({ pluginId, dir, file: id, text: content, expectedRevision: 0 })
      return written.ok ? coreOk(record(id, { ...written.value, text: content })) : toHostResult(written)
    },

    /** NoteStore 端口的 update 没有 options：修订号取记录自带的（先读后改的那一版）。 */
    async update(noteId, note) {
      const id = dirRelativePath(noteId)
      const content = typeof note?.content === 'string' ? note.content : ''
      const expectedRevision = note?.revision
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return coreFail(CORE_ERROR_CODES.INVALID_INPUT, '笔记记录缺少修订号，无法判定并发', { noteId: id })
      }
      const written = await fileService.write({ pluginId, dir, file: id, text: content, expectedRevision })
      return written.ok ? coreOk(record(id, { ...written.value, text: content })) : toHostResult(written)
    },

    async remove(noteId) {
      const id = dirRelativePath(noteId)
      const current = await read(id)
      if (!current.ok) return current
      if (!current.value) return coreFail(CORE_ERROR_CODES.NOTE_NOT_FOUND, '笔记不存在', { noteId: id })
      const deleted = await fileService.deleteFile({ pluginId, dir, file: id })
      return deleted.ok ? current : toHostResult(deleted)
    },

    /**
     * 宿主的保存口（端口之上的一个薄层）：Core 的更新清洗与 updateNote 规则照跑，
     * 修订并发交给 fileService.write。盘上没有这篇时按第 0 版判断——与文件服务的
     * STALE 口径一致（否则本来该报 STALE 的保存会被读前置改报 INVALID_INPUT）。
     */
    async save(noteId, input, { expectedRevision } = {}) {
      const id = dirRelativePath(noteId)
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return coreFail(CORE_ERROR_CODES.INVALID_INPUT, 'expectedRevision 必须是 ≥0 的整数', { expectedRevision })
      }
      const patch = buildNoteUpdatePatch(input)
      if (!patch.ok) return patch
      const current = await read(id)
      if (!current.ok) return current
      const base = current.value ?? record(id, { text: '', revision: 0 })
      const next = updateNote(base, patch.value)
      const written = await fileService.write({ pluginId, dir, file: id, text: next.content, expectedRevision })
      return written.ok ? coreOk(record(id, { ...written.value, text: next.content })) : toHostResult(written)
    }
  }
}
