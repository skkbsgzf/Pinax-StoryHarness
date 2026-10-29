import { fail, ok } from '../../kernel/errors.mjs'
import { NOTES_CARRIER, NOTES_CARRIER_ID } from './manifest.mjs'

/**
 * 构思载体的工具实现（协议 v1.1-A：从小说载体整块迁出，语义一字不改）。
 * 构思/ 是作者随手记的短文件序列：列篇目时把正文随手带回（省一次单独的读取），
 * 单篇超长按 NOTE_LIST_TEXT_CHARS 截断并在条目上标注（保存是覆盖式，截断时别整篇回写）。
 * pinax_notes_save 是它的写入口：新建传 expectedRevision 0，改稿必须带回 list 给的修订号，
 * 不符即 PINAX_STALE_REVISION，不覆盖、不合并；写 构思/ 走文件服务三道闸（归属＋file:构思:rw＋并发）。
 */
const NOTES_DIR = NOTES_CARRIER.dataDirs.notes
const MAX_TEXT_CHARS = 200_000
/** 列表随篇带回正文的上限（与 pinax_chapter_read 的默认 maxChars 同一档）；超出截断并在条目上标注。 */
const NOTE_LIST_TEXT_CHARS = 20_000
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function createNotesTools(context = {}) {
  const pluginId = context.pluginId ?? NOTES_CARRIER_ID
  const fileService = context.fileService ?? null

  function needService() {
    return fileService
      ? null
      : fail('INVALID_INPUT', `载体 ${pluginId} 的工具需要已打开项目的文件服务；空框架下请回落内核工具`, { pluginId })
  }

  /** 构思目录＝速记序列：与章节同一个列法。速记是随手记的短文件，正文随条目一起带回，
   *  省一次单独的读取；单篇超长按 NOTE_LIST_TEXT_CHARS 截断并在条目上标注。 */
  async function listNotes() {
    const missing = needService()
    if (missing) return missing
    const listed = await fileService.list({ pluginId, dir: NOTES_DIR })
    if (!listed.ok) return listed
    const names = listed.value.entries
      .filter((entry) => entry.kind === 'file' && /\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => collator.compare(a, b))
    const notes = []
    for (const name of names) {
      const relativePath = `${NOTES_DIR}/${name}`
      const read = await fileService.read({ pluginId, dir: NOTES_DIR, file: name })
      notes.push({
        index: notes.length,
        title: name.replace(/\.md$/iu, ''),
        file: relativePath,
        name,
        revision: read.ok ? read.value.revision : await fileService.revisionOf(relativePath),
        text: read.ok ? read.value.text.slice(0, NOTE_LIST_TEXT_CHARS) : '',
        totalChars: read.ok ? read.value.text.length : 0,
        truncated: read.ok ? read.value.text.length > NOTE_LIST_TEXT_CHARS : false
      })
    }
    return ok({ notes, total: notes.length })
  }

  return [
    {
      name: 'pinax_notes_list',
      title: '列出构思速记（构思载体）',
      description: '按「构思/」文件名排序列出速记篇目（序号、标题、相对路径、修订号），并把全文一并带回——速记是随手记的短文件，省一次单独的读取；单篇超过 20000 字时截断并在条目上标注，不谎报读全了。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 500, description: '最多返回多少篇，默认 200。' }
        }
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const all = await listNotes()
        if (!all.ok) return all
        const limit = args.limit === undefined ? 200 : args.limit
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
          return fail('INVALID_INPUT', 'limit 须是 1–500 的整数', { got: args.limit })
        }
        return ok({ total: all.value.total, truncated: all.value.total > limit, notes: all.value.notes.slice(0, limit) })
      }
    },
    {
      name: 'pinax_notes_save',
      title: '保存构思速记（构思载体）',
      description: '作者确认后的构思落盘口：新建传 expectedRevision 0；改稿必须带回 pinax_notes_list 给的修订号，不符即 PINAX_STALE_REVISION，不覆盖、不合并。写 构思/ 走文件服务三道闸（归属＋file:构思:rw＋并发）。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'expectedRevision'],
        properties: {
          file: { type: 'string', minLength: 1, maxLength: 240, description: '目标相对路径（构思/ 下），与 title 二选一。' },
          title: { type: 'string', minLength: 1, maxLength: 120, description: '新建速记用标题，落成「构思/<标题>.md」。' },
          text: { type: 'string', minLength: 1, maxLength: MAX_TEXT_CHARS, description: '整篇内容（覆盖式保存，故必须带修订号）。' },
          expectedRevision: { type: 'integer', minimum: 0, description: 'pinax_notes_list 给的修订号；新建传 0。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        if (typeof args.text !== 'string' || !args.text.length) return fail('INVALID_INPUT', 'text 必填且非空')
        if (args.text.length > MAX_TEXT_CHARS) return fail('INVALID_INPUT', `text 超出单篇上限 ${MAX_TEXT_CHARS} 字符`, { got: args.text.length })
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          return fail('INVALID_INPUT', 'expectedRevision 必填（新建传 0），改稿请带回 pinax_notes_list 给的修订号')
        }
        const target = args.file ?? noteFileNameFromTitle(args.title)
        if (!target) return fail('INVALID_INPUT', '要给 file（构思/ 下的相对路径）或 title（新建速记标题）')
        const relative = toDirRelative(NOTES_DIR, target)
        if (!/\.md$/iu.test(relative)) return fail('INVALID_INPUT', '构思速记文件名必须以 .md 结尾', { file: target })

        const written = await fileService.write({ pluginId, dir: NOTES_DIR, file: relative, text: args.text, expectedRevision: args.expectedRevision })
        if (!written.ok) return written
        return ok({
          file: written.value.relativePath,
          revision: written.value.revision,
          created: args.expectedRevision === 0,
          sha256: written.value.sha256,
          bytes: written.value.bytes
        })
      }
    }
  ]
}

/** 构思板块的工具名（两把都是载体自有名字：列与读合在一把里，内核没有同名工具）；供门禁核对。 */
export const NOTES_TOOL_NAMES = Object.freeze(['pinax_notes_list', 'pinax_notes_save'])

/** 作者给的是「构思/xxx.md」还是「xxx.md」都接得住：文件服务那侧的入参是板块目录内的相对路径。 */
function toDirRelative(dir, path) {
  const normalized = String(path).replaceAll('\\', '/')
  return normalized.startsWith(`${dir}/`) ? normalized.slice(dir.length + 1) : normalized
}

/** 标题→文件名：与小说载体的 chapterFileNameFromTitle 同一套规则（非法字符与控制字符换空格）。 */
function noteFileNameFromTitle(title) {
  const cleaned = String(title ?? '')
    .replace(/[\\/:*?"<>|]/gu, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '')
    .slice(0, 120)
  if (!cleaned) return null
  return /\.md$/iu.test(cleaned) ? cleaned : `${cleaned}.md`
}

export default createNotesTools
