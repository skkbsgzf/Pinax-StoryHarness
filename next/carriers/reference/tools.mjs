import { fail, ok } from '../../kernel/errors.mjs'
import { REFERENCE_CARRIER_ID } from './manifest.mjs'

/**
 * 资料载体的工具实现（工单G1）。
 * 读盘一律走内核文件服务（next/fs/fileService.mjs）——归属闸、作用域闸、修订并发都在那边，
 * 载体只负责「按资料的语义把 资料/ 讲成人话」，绝不自己 open 文件句柄。
 * 三把工具都是载体自有名字（内核 19 里没有同名工具），所以不存在「认领＝同名接管」这件事；
 * 形状照已有先例：
 *   pinax_document_list  照 pinax_notes_list：列篇目并把正文随手带回（前 20000 字，超出标注），
 *                        省一次单独的读取；保存是覆盖式，截断时别整篇回写；
 *   pinax_document_read  单篇全文，maxChars 可选（1000–200000），照 pinax_chapter_read 的截断口径；
 *   pinax_document_save  照 pinax_chapter_save／pinax_notes_save：新建传 expectedRevision 0，
 *                        改稿必须带回读到的修订号，不符即 PINAX_STALE_REVISION，不覆盖、不合并。
 * 本批只认 .md 与 .txt（工单边界：不做 PDF/图片，也不做拖拽导入）。
 */
export const REFERENCE_DIR = '资料'
const MAX_TEXT_CHARS = 200_000
/** 列表随篇带回正文的上限（与 pinax_notes_list 同一档）；超出截断并在条目上标注。 */
const DOCUMENT_LIST_TEXT_CHARS = 20_000
const TEXT_FILE_PATTERN = /\.(?:md|txt)$/iu
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function createReferenceTools(context = {}) {
  const pluginId = context.pluginId ?? REFERENCE_CARRIER_ID
  const fileService = context.fileService ?? null

  function needService() {
    return fileService
      ? null
      : fail('INVALID_INPUT', `载体 ${pluginId} 的工具需要已打开项目的文件服务；空框架下请回落内核工具`, { pluginId })
  }

  /** 资料目录＝篇目序列：与构思速记同一个列法（文件名排序，正文随条目带回，单篇超长截断并标注）。 */
  async function listDocuments() {
    const missing = needService()
    if (missing) return missing
    const listed = await fileService.list({ pluginId, dir: REFERENCE_DIR })
    if (!listed.ok) return listed
    const names = listed.value.entries
      .filter((entry) => entry.kind === 'file' && TEXT_FILE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => collator.compare(a, b))
    const documents = []
    for (const name of names) {
      const relativePath = `${REFERENCE_DIR}/${name}`
      const read = await fileService.read({ pluginId, dir: REFERENCE_DIR, file: name })
      documents.push({
        index: documents.length,
        title: name.replace(TEXT_FILE_PATTERN, ''),
        file: relativePath,
        name,
        revision: read.ok ? read.value.revision : await fileService.revisionOf(relativePath),
        text: read.ok ? read.value.text.slice(0, DOCUMENT_LIST_TEXT_CHARS) : '',
        totalChars: read.ok ? read.value.text.length : 0,
        truncated: read.ok ? read.value.text.length > DOCUMENT_LIST_TEXT_CHARS : false
      })
    }
    return ok({ documents, total: documents.length })
  }

  return [
    {
      name: 'pinax_document_list',
      title: '列出资料（资料载体）',
      description: '按「资料/」文件名排序列出 .md 与 .txt 资料（序号、标题、相对路径、修订号），并把正文一并带回——资料多为随手收的短篇，省一次单独的读取；单篇超过 20000 字时截断并在条目上标注，不谎报读全了。只读，不改任何文件。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 500, description: '最多返回多少篇，默认 200。' }
        }
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const all = await listDocuments()
        if (!all.ok) return all
        const limit = args.limit === undefined ? 200 : args.limit
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
          return fail('INVALID_INPUT', 'limit 须是 1–500 的整数', { got: args.limit })
        }
        return ok({
          total: all.value.total,
          truncated: all.value.total > limit,
          documents: all.value.documents.slice(0, limit)
        })
      }
    },
    {
      name: 'pinax_document_read',
      title: '读取资料（资料载体）',
      description: '按 index／title／file 任一定位读一篇资料的全文，支持 maxChars 截断；返回修订号，供保存时原样带回做并发校验。读不到就说读不到，不拼一篇相近的冒充。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer', minimum: 0, description: '篇目序号（从 0 开始），与 title/file 三选一。' },
          title: { type: 'string', minLength: 1, maxLength: 120, description: '资料标题，先精确后包含匹配。' },
          file: { type: 'string', minLength: 1, maxLength: 240, description: '相对路径，如「资料/设定集.md」。' },
          maxChars: { type: 'integer', minimum: 1000, maximum: MAX_TEXT_CHARS, description: `本次最多返回字符数，默认 50000，上限 ${MAX_TEXT_CHARS}。` }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        const located = await resolveDocument(args, listDocuments)
        if (!located.ok) return located
        const maxChars = args.maxChars === undefined ? 50_000 : args.maxChars
        if (!Number.isSafeInteger(maxChars) || maxChars < 1000 || maxChars > MAX_TEXT_CHARS) {
          return fail('INVALID_INPUT', `maxChars 须是 1000–${MAX_TEXT_CHARS} 的整数`, { got: args.maxChars })
        }
        const read = await fileService.read({ pluginId, dir: REFERENCE_DIR, file: located.value.name })
        if (!read.ok) return read
        const text = read.value.text.slice(0, maxChars)
        return ok({
          document: {
            index: located.value.index,
            title: located.value.title,
            file: read.value.relativePath,
            name: located.value.name,
            revision: read.value.revision
          },
          matchedBy: located.value.matchedBy,
          text,
          maxChars,
          totalChars: read.value.text.length,
          truncated: text.length < read.value.text.length,
          revision: read.value.revision,
          sha256: read.value.sha256
        })
      }
    },
    {
      name: 'pinax_document_save',
      title: '保存资料（资料载体）',
      description: '作者确认后的资料落盘口：新建传 expectedRevision 0；改稿必须带回 pinax_document_list（或 pinax_document_read）给的修订号，不符即 PINAX_STALE_REVISION，不覆盖、不合并。写 资料/ 走文件服务三道闸（归属＋file:资料:rw＋并发）；文件名必须是 .md 或 .txt（本批不认 PDF/图片）。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'expectedRevision'],
        properties: {
          file: { type: 'string', minLength: 1, maxLength: 240, description: '目标相对路径（资料/ 下），与 title 二选一。' },
          title: { type: 'string', minLength: 1, maxLength: 120, description: '新建资料用标题，落成「资料/<标题>.md」。' },
          text: { type: 'string', minLength: 1, maxLength: MAX_TEXT_CHARS, description: '整篇内容（覆盖式保存，故必须带修订号）。' },
          expectedRevision: { type: 'integer', minimum: 0, description: 'pinax_document_list／pinax_document_read 给的修订号；新建传 0。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        if (typeof args.text !== 'string' || !args.text.length) return fail('INVALID_INPUT', 'text 必填且非空')
        if (args.text.length > MAX_TEXT_CHARS) return fail('INVALID_INPUT', `text 超出单篇上限 ${MAX_TEXT_CHARS} 字符`, { got: args.text.length })
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          return fail('INVALID_INPUT', 'expectedRevision 必填（新建传 0），改稿请带回 pinax_document_list 给的修订号')
        }
        const target = args.file ?? documentFileNameFromTitle(args.title)
        if (!target) return fail('INVALID_INPUT', '要给 file（资料/ 下的相对路径）或 title（新建资料标题）')
        const relative = toDirRelative(REFERENCE_DIR, target)
        if (!TEXT_FILE_PATTERN.test(relative)) {
          return fail('INVALID_INPUT', '资料文件名必须以 .md 或 .txt 结尾（本批不认 PDF/图片）', { file: target })
        }

        const written = await fileService.write({ pluginId, dir: REFERENCE_DIR, file: relative, text: args.text, expectedRevision: args.expectedRevision })
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

/** 载体已认领（读）与自有（写）的工具名，供门禁核「认领面只增不减」；三把都是载体自有名字。 */
export const REFERENCE_TOOL_NAMES = Object.freeze(['pinax_document_list', 'pinax_document_read', 'pinax_document_save'])

async function resolveDocument(args, listDocuments) {
  const all = await listDocuments()
  if (!all.ok) return all
  const documents = all.value.documents
  if (args.file) {
    const wanted = String(args.file).replaceAll('\\', '/')
    const hit = documents.find((item) => item.file === wanted || item.file.endsWith(`/${wanted}`))
    if (hit) return ok({ ...hit, matchedBy: 'file' })
    if (!TEXT_FILE_PATTERN.test(wanted)) return fail('INVALID_INPUT', 'file 指向的必须是 .md 或 .txt 资料', { file: args.file })
    return ok({
      index: null,
      title: wanted.replace(TEXT_FILE_PATTERN, '').split('/').pop(),
      file: wanted,
      name: toDirRelative(REFERENCE_DIR, wanted),
      matchedBy: 'file'
    })
  }
  if (!documents.length) return fail('INVALID_INPUT', '「资料/」还没有任何资料，可先用 pinax_document_save 新建')
  if (args.index !== undefined) {
    if (!Number.isSafeInteger(args.index) || args.index < 0) return fail('INVALID_INPUT', 'index 须是 ≥0 的整数', { got: args.index })
    const hit = documents[args.index]
    return hit ? ok({ ...hit, matchedBy: 'index' }) : fail('INVALID_INPUT', `资料序号 ${args.index} 超出范围（共 ${documents.length} 篇）`)
  }
  if (args.title) {
    const exact = documents.find((item) => item.title === args.title)
    if (exact) return ok({ ...exact, matchedBy: 'title-exact' })
    const loose = documents.filter((item) => item.title.includes(String(args.title)))
    if (loose.length === 1) return ok({ ...loose[0], matchedBy: 'title-contains' })
    if (loose.length > 1) {
      return fail('INVALID_INPUT', `标题「${args.title}」匹配到 ${loose.length} 篇资料，请改用 index 或 file`, {
        candidates: loose.slice(0, 10).map((item) => item.title)
      })
    }
    return fail('INVALID_INPUT', `找不到标题含「${args.title}」的资料`, { total: documents.length })
  }
  return fail('INVALID_INPUT', 'pinax_document_read 需要 index / title / file 任一定位方式')
}

/** 作者给的是「资料/xxx.md」还是「xxx.md」都接得住：文件服务那侧的入参是板块目录内的相对路径。 */
function toDirRelative(dir, path) {
  const normalized = String(path).replaceAll('\\', '/')
  return normalized.startsWith(`${dir}/`) ? normalized.slice(dir.length + 1) : normalized
}

/** 标题→文件名：与小说／设定载体同一套规则（非法字符与控制字符换空格）；缺省扩展名是 .md。 */
function documentFileNameFromTitle(title) {
  const cleaned = String(title ?? '')
    .replace(/[\\/:*?"<>|]/gu, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '')
    .slice(0, 120)
  if (!cleaned) return null
  return TEXT_FILE_PATTERN.test(cleaned) ? cleaned : `${cleaned}.md`
}

export default createReferenceTools
