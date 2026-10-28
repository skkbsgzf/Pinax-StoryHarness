import { fail, ok } from '../../kernel/errors.mjs'
import { NOVEL_CARRIER_ID } from './manifest.mjs'

/**
 * 小说载体的工具实现（M2 · WP5）。
 * 读盘一律走内核文件服务（next/fs/fileService.mjs）——归属闸、作用域闸、修订并发都在那边，
 * 载体只负责「按小说的语义把目录讲成人话」，绝不自己 open 文件句柄。
 * 三个只读工具名是从内核手里认领过来的（pinax_chapter_list / pinax_chapter_read / pinax_outline_read），
 * pinax_chapter_save 是载体自己的正文写入口：写 正文/ 必须带 expectedRevision，
 * 与运行时（一级公民）的提案轨彻底分开——提案进 .pinax/proposals/，作者按下去的保存才进正文。
 * 构思/速记（工单B1）同一套规矩长在 构思/ 上：pinax_notes_list 列篇目（正文随手带回，速记都短），
 * pinax_notes_save 是它的写入口——没有单独的 notes 读工具，列与读合在一把里。
 * 大纲的写半边（工单B2）：pinax_outline_save 整份覆盖 大纲/outline.json——改名/新增都改完整 nodes 后回传，
 * 不收增量、不做合并；大纲的层级语义住在 edges（from→to）里，保存原样落盘。
 */
export const NOVEL_DIRS = Object.freeze({ manuscript: '正文', outline: '大纲', notes: '构思' })

const MAX_TEXT_CHARS = 200_000
/** 列表随篇带回正文的上限（与 pinax_chapter_read 的默认 maxChars 同一档）；超出截断并在条目上标注。 */
const NOTE_LIST_TEXT_CHARS = 20_000
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function createNovelTools(context = {}) {
  const pluginId = context.pluginId ?? NOVEL_CARRIER_ID
  const fileService = context.fileService ?? null

  function needService() {
    return fileService
      ? null
      : fail('INVALID_INPUT', `载体 ${pluginId} 的工具需要已打开项目的文件服务；空框架下请回落内核工具`, { pluginId })
  }

  /** 正文目录＝章节序列：文件名排序，标题取掉扩展名，修订号向文件服务现取。 */
  async function listManuscript() {
    const missing = needService()
    if (missing) return missing
    const listed = await fileService.list({ pluginId, dir: NOVEL_DIRS.manuscript })
    if (!listed.ok) return listed
    const names = listed.value.entries
      .filter((entry) => entry.kind === 'file' && /\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => collator.compare(a, b))
    const chapters = []
    for (const name of names) {
      const relativePath = `${NOVEL_DIRS.manuscript}/${name}`
      chapters.push({
        index: chapters.length,
        title: name.replace(/\.md$/iu, ''),
        file: relativePath,
        name,
        revision: await fileService.revisionOf(relativePath)
      })
    }
    return ok({ chapters, total: chapters.length })
  }

  /** 构思目录＝速记序列：与章节同一个列法。速记是随手记的短文件，正文随条目一起带回，
   *  省一次单独的读取；单篇超长按 NOTE_LIST_TEXT_CHARS 截断并在条目上标注（保存是覆盖式，截断时别整篇回写）。 */
  async function listNotes() {
    const missing = needService()
    if (missing) return missing
    const listed = await fileService.list({ pluginId, dir: NOVEL_DIRS.notes })
    if (!listed.ok) return listed
    const names = listed.value.entries
      .filter((entry) => entry.kind === 'file' && /\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => collator.compare(a, b))
    const notes = []
    for (const name of names) {
      const relativePath = `${NOVEL_DIRS.notes}/${name}`
      const read = await fileService.read({ pluginId, dir: NOVEL_DIRS.notes, file: name })
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
      name: 'pinax_chapter_list',
      title: '列出章节（小说载体）',
      description: '按「正文/」文件名排序列出章节序号、标题、相对路径与当前修订号；不返回正文，也不谎报没读过的字节数。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 500, description: '最多返回多少章，默认 200。' }
        }
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const all = await listManuscript()
        if (!all.ok) return all
        const limit = args.limit === undefined ? 200 : args.limit
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
          return fail('INVALID_INPUT', 'limit 须是 1–500 的整数', { got: args.limit })
        }
        return ok({ total: all.value.total, truncated: all.value.total > limit, chapters: all.value.chapters.slice(0, limit) })
      }
    },
    {
      name: 'pinax_chapter_read',
      title: '读取章节正文（小说载体）',
      description: '按 index／title／file 任一定位读一章正文，支持 offset+maxChars 分页；返回修订号，供保存时原样带回做并发校验。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer', minimum: 0, description: '章节序号（从 0 开始），与 title/file 三选一。' },
          title: { type: 'string', minLength: 1, maxLength: 120, description: '章节标题，先精确后包含匹配。' },
          file: { type: 'string', minLength: 1, maxLength: 240, description: '相对路径，如「正文/第001章-入场.md」。' },
          offset: { type: 'integer', minimum: 0, description: '正文字符偏移，默认 0。' },
          maxChars: { type: 'integer', minimum: 1000, maximum: MAX_TEXT_CHARS, description: `本次最多返回字符数，默认 20000，上限 ${MAX_TEXT_CHARS}。` }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        const located = await resolveChapter(args, listManuscript)
        if (!located.ok) return located
        const offset = args.offset ?? 0
        const maxChars = args.maxChars ?? 20_000
        if (!Number.isSafeInteger(offset) || offset < 0) return fail('INVALID_INPUT', 'offset 须是 ≥0 的整数', { got: args.offset })
        if (!Number.isSafeInteger(maxChars) || maxChars < 1000 || maxChars > MAX_TEXT_CHARS) {
          return fail('INVALID_INPUT', `maxChars 须是 1000–${MAX_TEXT_CHARS} 的整数`, { got: args.maxChars })
        }
        const read = await fileService.read({ pluginId, dir: NOVEL_DIRS.manuscript, file: located.value.name })
        if (!read.ok) return read
        const text = read.value.text.slice(offset, offset + maxChars)
        return ok({
          chapter: { index: located.value.index, title: located.value.title, file: read.value.relativePath },
          matchedBy: located.value.matchedBy,
          text,
          offset,
          maxChars,
          totalChars: read.value.text.length,
          truncated: offset + text.length < read.value.text.length,
          nextOffset: offset + text.length,
          revision: read.value.revision,
          sha256: read.value.sha256
        })
      }
    },
    {
      name: 'pinax_outline_read',
      title: '读取大纲（小说载体）',
      description: '优先读「大纲/outline.json」的节点与连线；只有 大纲.md 时返回原文与警告，绝不把散文编成节点树。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          maxNodes: { type: 'integer', minimum: 1, maximum: 1000, description: '最多返回多少节点，默认 300。' }
        }
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        const maxNodes = args.maxNodes ?? 300
        if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 1000) {
          return fail('INVALID_INPUT', 'maxNodes 须是 1–1000 的整数', { got: args.maxNodes })
        }
        const structured = await fileService.read({ pluginId, dir: NOVEL_DIRS.outline, file: 'outline.json' })
        if (structured.ok) {
          let parsed
          try {
            parsed = JSON.parse(structured.value.text)
          } catch (error) {
            return fail('IO_FAILED', `「大纲/outline.json」不是合法 JSON：${String(error?.message || error)}`, { path: structured.value.relativePath })
          }
          const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : []
          const edges = Array.isArray(parsed?.edges) ? parsed.edges : []
          return ok({
            source: structured.value.relativePath,
            nodes: nodes.slice(0, maxNodes),
            edges,
            nodeTotal: nodes.length,
            truncated: nodes.length > maxNodes,
            revision: structured.value.revision,
            warning: Array.isArray(parsed?.nodes) ? null : 'outline.json 里没有 nodes 数组，按空大纲返回'
          })
        }
        const asText = await fileService.read({ pluginId, dir: NOVEL_DIRS.outline, file: '大纲.md' })
        if (asText.ok) {
          return ok({
            source: asText.value.relativePath,
            nodes: [],
            edges: [],
            nodeTotal: 0,
            truncated: false,
            text: asText.value.text.slice(0, maxNodes * 200),
            revision: asText.value.revision,
            warning: '大纲只有散文稿（大纲.md），没有结构化节点；未凭空生成节点树'
          })
        }
        const listed = await fileService.list({ pluginId, dir: NOVEL_DIRS.outline })
        return fail('INVALID_INPUT', '「大纲/」下既没有 outline.json 也没有 大纲.md', {
          outlineError: asText.error.code,
          entries: listed.ok ? listed.value.entries.map((entry) => entry.name) : null
        })
      }
    },
    {
      name: 'pinax_chapter_save',
      title: '保存章节正文（小说载体）',
      description: '作者确认后的正文落盘口：新建传 expectedRevision 0；改稿必须先读到修订号，不符即 PINAX_STALE_REVISION，不覆盖、不合并。写 正文/ 走文件服务三道闸（归属＋file:正文:rw＋并发）。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'expectedRevision'],
        properties: {
          file: { type: 'string', minLength: 1, maxLength: 240, description: '目标相对路径（正文/ 下），与 title 二选一。' },
          title: { type: 'string', minLength: 1, maxLength: 120, description: '新建章节用标题，落成「正文/<标题>.md」。' },
          text: { type: 'string', minLength: 1, maxLength: MAX_TEXT_CHARS, description: '整章正文内容（覆盖式保存，故必须带修订号）。' },
          expectedRevision: { type: 'integer', minimum: 0, description: '读取时拿到的修订号；新建传 0。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        if (typeof args.text !== 'string' || !args.text.length) return fail('INVALID_INPUT', 'text 必填且非空')
        if (args.text.length > MAX_TEXT_CHARS) return fail('INVALID_INPUT', `text 超出单章上限 ${MAX_TEXT_CHARS} 字符`, { got: args.text.length })
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          return fail('INVALID_INPUT', 'expectedRevision 必填（新建传 0），改稿请带回 pinax_chapter_read 给的修订号')
        }
        const target = args.file ?? chapterFileNameFromTitle(args.title)
        if (!target) return fail('INVALID_INPUT', '要给 file（正文/ 下的相对路径）或 title（新建章节标题）')
        const relative = toDirRelative(NOVEL_DIRS.manuscript, target)
        if (!/\.md$/iu.test(relative)) return fail('INVALID_INPUT', '正文章节文件名必须以 .md 结尾', { file: target })

        const written = await fileService.write({ pluginId, dir: NOVEL_DIRS.manuscript, file: relative, text: args.text, expectedRevision: args.expectedRevision })
        if (!written.ok) return written
        return ok({
          file: written.value.relativePath,
          revision: written.value.revision,
          created: args.expectedRevision === 0,
          sha256: written.value.sha256,
          bytes: written.value.bytes
        })
      }
    },
    {
      name: 'pinax_outline_save',
      title: '保存大纲（小说载体）',
      description: '作者确认后的大纲落盘口：整份覆盖「大纲/outline.json」——nodes 是全量（pinax_outline_read 的原样回传，改名/增删后整份写回），不收增量、不做合并；首次建档传 expectedRevision 0，改稿必须带回 read 给的修订号，不符即 PINAX_STALE_REVISION。写 大纲/ 走文件服务三道闸（归属＋file:大纲:rw＋并发）。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['nodes', 'expectedRevision'],
        properties: {
          nodes: {
            type: 'array',
            minItems: 1,
            description: '全量节点，每条至少要有非空 id 与 title（其余字段如 type/summary 原样保留）；空数组与缺 nodes 都拒。'
          },
          edges: {
            type: 'array',
            description: '连线（from/to），可选；缺省按空数组落盘。'
          },
          expectedRevision: { type: 'integer', minimum: 0, description: 'pinax_outline_read 给的修订号；首次建档传 0。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        if (!Array.isArray(args.nodes)) return fail('INVALID_INPUT', 'nodes 必须是数组（整份覆盖，不收增量）', { got: typeof args.nodes })
        if (!args.nodes.length) return fail('INVALID_INPUT', 'nodes 不能为空：要清空大纲请删文件，不在保存口留空文档')
        for (const [index, node] of args.nodes.entries()) {
          if (!node || typeof node !== 'object' || Array.isArray(node)) {
            return fail('INVALID_INPUT', `nodes[${index}] 不是对象`, { got: node === null ? 'null' : typeof node })
          }
          if (typeof node.id !== 'string' || !node.id.trim()) return fail('INVALID_INPUT', `nodes[${index}] 缺非空 id`, { title: node.title ?? null })
          if (typeof node.title !== 'string' || !node.title.trim()) return fail('INVALID_INPUT', `nodes[${index}] 缺非空 title`, { id: node.id })
        }
        if (args.edges !== undefined && !Array.isArray(args.edges)) {
          return fail('INVALID_INPUT', 'edges 须是数组（每条含 from/to）', { got: typeof args.edges })
        }
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          return fail('INVALID_INPUT', 'expectedRevision 必填：改稿带回 pinax_outline_read 给的修订号，首次建档传 0')
        }
        const document = { nodes: args.nodes, edges: args.edges ?? [] }
        const written = await fileService.write({ pluginId, dir: NOVEL_DIRS.outline, file: 'outline.json', text: JSON.stringify(document, null, 2), expectedRevision: args.expectedRevision })
        if (!written.ok) return written
        return ok({
          file: written.value.relativePath,
          revision: written.value.revision,
          nodeTotal: args.nodes.length,
          sha256: written.value.sha256,
          bytes: written.value.bytes
        })
      }
    },
    {
      name: 'pinax_notes_list',
      title: '列出构思速记（小说载体）',
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
      title: '保存构思速记（小说载体）',
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
        const target = args.file ?? chapterFileNameFromTitle(args.title)
        if (!target) return fail('INVALID_INPUT', '要给 file（构思/ 下的相对路径）或 title（新建速记标题）')
        const relative = toDirRelative(NOVEL_DIRS.notes, target)
        if (!/\.md$/iu.test(relative)) return fail('INVALID_INPUT', '构思速记文件名必须以 .md 结尾', { file: target })

        const written = await fileService.write({ pluginId, dir: NOVEL_DIRS.notes, file: relative, text: args.text, expectedRevision: args.expectedRevision })
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

/** 载体已认领（读）与自有（写）的工具名，供门禁核「认领面只增不减」；大纲写半边与构思这对也是自有名字。 */
export const NOVEL_TOOL_NAMES = Object.freeze(['pinax_chapter_list', 'pinax_chapter_read', 'pinax_outline_read', 'pinax_chapter_save', 'pinax_outline_save', 'pinax_notes_list', 'pinax_notes_save'])

async function resolveChapter(args, listManuscript) {
  const all = await listManuscript()
  if (!all.ok) return all
  const chapters = all.value.chapters
  if (args.file) {
    const wanted = String(args.file).replaceAll('\\', '/')
    const hit = chapters.find((item) => item.file === wanted || item.file.endsWith(`/${wanted}`))
    if (hit) return ok({ ...hit, matchedBy: 'file' })
    if (!/\.md$/iu.test(wanted)) return fail('INVALID_INPUT', 'file 指向的必须是 .md 章节', { file: args.file })
    return ok({ index: null, title: wanted.replace(/\.md$/iu, '').split('/').pop(), file: wanted, name: toDirRelative(NOVEL_DIRS.manuscript, wanted), matchedBy: 'file' })
  }
  if (!chapters.length) return fail('INVALID_INPUT', '「正文/」还没有任何章节，可先用 pinax_chapter_save 新建')
  if (args.index !== undefined) {
    if (!Number.isSafeInteger(args.index) || args.index < 0) return fail('INVALID_INPUT', 'index 须是 ≥0 的整数', { got: args.index })
    const hit = chapters[args.index]
    return hit ? ok({ ...hit, matchedBy: 'index' }) : fail('INVALID_INPUT', `章节序号 ${args.index} 超出范围（共 ${chapters.length} 章）`)
  }
  if (args.title) {
    const exact = chapters.find((item) => item.title === args.title)
    if (exact) return ok({ ...exact, matchedBy: 'title-exact' })
    const loose = chapters.filter((item) => item.title.includes(String(args.title)))
    if (loose.length === 1) return ok({ ...loose[0], matchedBy: 'title-contains' })
    if (loose.length > 1) {
      return fail('INVALID_INPUT', `标题「${args.title}」匹配到 ${loose.length} 章，请改用 index 或 file`, {
        candidates: loose.slice(0, 10).map((item) => item.title)
      })
    }
    return fail('INVALID_INPUT', `找不到标题含「${args.title}」的章节`, { total: chapters.length })
  }
  return fail('INVALID_INPUT', 'pinax_chapter_read 需要 index / title / file 任一定位方式')
}

/** 作者给的是「正文/xxx.md」还是「xxx.md」都接得住：文件服务那侧的入参是板块目录内的相对路径。 */
function toDirRelative(dir, path) {
  const normalized = String(path).replaceAll('\\', '/')
  return normalized.startsWith(`${dir}/`) ? normalized.slice(dir.length + 1) : normalized
}

/** 标题→文件名：Windows 非法字符与控制字符都换成空格（用 \p{Cc} 而不是 \u0000-\u001F，规则允许前者）。 */
function chapterFileNameFromTitle(title) {
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
