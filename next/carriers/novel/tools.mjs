import { fail, ok } from '../../kernel/errors.mjs'
import { NOVEL_CARRIER_ID } from './manifest.mjs'

/**
 * 小说载体的工具实现（M2 · WP5；协议 v1.1-A 起只管 正文/）。
 * 读盘一律走内核文件服务（next/fs/fileService.mjs）——归属闸、作用域闸、修订并发都在那边，
 * 载体只负责「按小说的语义把目录讲成人话」，绝不自己 open 文件句柄。
 * 两个只读工具名是从内核手里认领过来的（pinax_chapter_list / pinax_chapter_read），
 * pinax_chapter_save 是载体自己的正文写入口：写 正文/ 必须带 expectedRevision，
 * 与运行时（一级公民）的提案轨彻底分开——提案进 .pinax/proposals/，作者按下去的保存才进正文。
 *
 * 协议 v1.1-A（作者裁定）：大纲拆去 pinax.carrier.outline（pinax_outline_read / save 随迁）、
 * 构思拆去 pinax.carrier.notes（pinax_notes_list / save 随迁）；小说栏只留正文这一棵内容树。
 *
 * 提案审阅（工单A）：模型改稿落 .pinax/proposals/（pinax-proposal@1 JSON，或运行时轨的纯文本散件），
 * 由 pinax_proposal_list / pinax_proposal_read / pinax_proposal_discard 三把读/读/弃承接（内核没有同名工具）。
 * 采纳不另开写口：作者按下的那一下仍走 pinax_chapter_save——带上当前修订号，成功后把这份提案的
 * status 写成 adopted（pinax_chapter_save 的可选 proposal 参数，元数据由文件服务原子写回）。
 */
export const NOVEL_DIRS = Object.freeze({ manuscript: '正文' })

const MAX_TEXT_CHARS = 200_000
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function createNovelTools(context = {}) {
  const pluginId = context.pluginId ?? NOVEL_CARRIER_ID
  const fileService = context.fileService ?? null

  function needService() {
    return fileService
      ? null
      : fail('INVALID_INPUT', `载体 ${pluginId} 的工具需要已打开项目的文件服务；空框架下请回落内核工具`, { pluginId })
  }

  /**
   * 正文目录＝章节序列（工单B：卷→章两级）。
   * 正文/ 下的一级子目录＝卷：卷按目录名排序，卷内的章按文件名排序，每条带 volume＝目录名；
   * 顶层章（平铺）排在卷后，volume＝null。序号 index 是扁平顺序（读/改都靠 file 定位）。
   * 只认一级卷（更深的目录不再展开——层级两级封顶，与索引窗的口径一致）。
   */
  async function listManuscript() {
    const missing = needService()
    if (missing) return missing
    const listed = await fileService.list({ pluginId, dir: NOVEL_DIRS.manuscript })
    if (!listed.ok) return listed
    const entries = listed.value.entries ?? []
    const volumes = entries
      .filter((entry) => entry.kind === 'dir')
      .map((entry) => entry.name)
      .sort(compareVolumeNames)
    const chapters = []
    for (const volume of volumes) {
      // 子目录的列举走同一份文件服务：file:正文:rw 覆盖 正文/ 及其子目录（工单B 的递归口径）。
      const nested = await fileService.list({ pluginId, dir: `${NOVEL_DIRS.manuscript}/${volume}` })
      if (!nested.ok) return nested
      const names = nested.value.entries
        .filter((entry) => entry.kind === 'file' && /\.md$/iu.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => collator.compare(a, b))
      for (const name of names) {
        const relativePath = `${NOVEL_DIRS.manuscript}/${volume}/${name}`
        chapters.push({
          index: chapters.length,
          title: name.replace(/\.md$/iu, ''),
          file: relativePath,
          name,
          volume,
          revision: await fileService.revisionOf(relativePath)
        })
      }
    }
    const loose = entries
      .filter((entry) => entry.kind === 'file' && /\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => collator.compare(a, b))
    for (const name of loose) {
      const relativePath = `${NOVEL_DIRS.manuscript}/${name}`
      chapters.push({
        index: chapters.length,
        title: name.replace(/\.md$/iu, ''),
        file: relativePath,
        name,
        volume: null,
        revision: await fileService.revisionOf(relativePath)
      })
    }
    return ok({ chapters, total: chapters.length })
  }

  return [
    {
      name: 'pinax_chapter_list',
      title: '列出章节（小说载体）',
      description: '按「正文/」列章节序号、标题、相对路径、卷名（顶层章为 null）与当前修订号：一级子目录＝卷，卷按目录名、卷内按文件名排序，平铺章排在卷后；不返回正文，也不谎报没读过的字节数。',
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
        // 卷下的章在磁盘上是 正文/<卷>/<章>.md：读的 file 必须是相对 正文/ 的整段路径，
        // 不能拿基名（工单B 之前只列顶层，基名与相对路径恰好相同，所以没暴露）。
        const read = await fileService.read({ pluginId, dir: NOVEL_DIRS.manuscript, file: toDirRelative(NOVEL_DIRS.manuscript, located.value.file) })
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
      name: 'pinax_chapter_save',
      title: '保存章节正文（小说载体）',
      description: '作者确认后的正文落盘口：新建传 expectedRevision 0；改稿必须先读到修订号，不符即 PINAX_STALE_REVISION，不覆盖、不合并。写 正文/ 走文件服务三道闸（归属＋file:正文:rw＋并发）。可选 proposal 指认这次写入来自哪份提案：落盘成功后把该提案的 status 标成 adopted（提案文件保留）。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'expectedRevision'],
        properties: {
          file: { type: 'string', minLength: 1, maxLength: 240, description: '目标相对路径（正文/ 下），与 title 二选一。' },
          title: { type: 'string', minLength: 1, maxLength: 120, description: '新建章节用标题，落成「正文/<标题>.md」。' },
          text: { type: 'string', minLength: 1, maxLength: MAX_TEXT_CHARS, description: '整章正文内容（覆盖式保存，故必须带修订号）。' },
          expectedRevision: { type: 'integer', minimum: 0, description: '读取时拿到的修订号；新建传 0。' },
          proposal: { type: 'string', minLength: 1, maxLength: 240, description: '可选：这次写入来自哪份提案（.pinax/proposals/ 里的 JSON 文件名）。落盘成功后把该提案的 status 写成 adopted；写不进去只回 proposalWarning，不推翻已经落盘的正文。' }
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
        if (args.proposal !== undefined && (typeof args.proposal !== 'string' || !args.proposal.trim())) {
          return fail('INVALID_INPUT', 'proposal 须是 .pinax/proposals/ 里的提案文件名')
        }
        const target = args.file ?? chapterFileNameFromTitle(args.title)
        if (!target) return fail('INVALID_INPUT', '要给 file（正文/ 下的相对路径）或 title（新建章节标题）')
        const relative = toDirRelative(NOVEL_DIRS.manuscript, target)
        if (!/\.md$/iu.test(relative)) return fail('INVALID_INPUT', '正文章节文件名必须以 .md 结尾', { file: target })

        const written = await fileService.write({ pluginId, dir: NOVEL_DIRS.manuscript, file: relative, text: args.text, expectedRevision: args.expectedRevision })
        if (!written.ok) return written
        const result = {
          file: written.value.relativePath,
          revision: written.value.revision,
          created: args.expectedRevision === 0,
          sha256: written.value.sha256,
          bytes: written.value.bytes
        }
        // 采纳留痕：正文已经落盘才算数；状态没记上只如实带回一句警告，不把写作翻成失败。
        if (args.proposal) {
          const marked = await fileService.markProposalStatus({ name: args.proposal, status: 'adopted' })
          if (marked.ok) result.proposal = { name: marked.value.name, status: marked.value.status }
          else result.proposalWarning = `正文已写入，但提案状态没记上：${marked.error.message}`
        }
        return ok(result)
      }
    },
    {
      name: 'pinax_proposal_list',
      title: '列出提案（小说载体）',
      description: '列出 .pinax/proposals/ 里的审阅提案：JSON 提案给出 id／status／目标章／字数／createdAt／note，按 createdAt 降序；坏 JSON 跳过并记进 warnings；运行时轨写下的纯文本散件以 kind:"raw" 只列名字与大小。只读，不改正文。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {}
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async () => {
        const missing = needService()
        if (missing) return missing
        return fileService.listProposals()
      }
    },
    {
      name: 'pinax_proposal_read',
      title: '读取提案（小说载体）',
      description: '按文件名读一份 .pinax/proposals/ 下的 JSON 提案，整份原样返回（target／content／note／status 都在里面）。只接受目录内的一层文件名，带路径分隔符或「..」一律拒。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 240, description: '提案文件名（如 20261028T140000-ch1-abcdef12.json）。' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        return fileService.readProposal({ name: args.name })
      }
    },
    {
      name: 'pinax_proposal_discard',
      title: '弃用提案（小说载体）',
      description: '弃用一份提案：删掉 .pinax/proposals/ 里对应的文件，正文与修订号一个字都不动。只接受目录内的一层文件名，带路径分隔符或「..」一律拒。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 240, description: '提案文件名（如 20261028T140000-ch1-abcdef12.json）。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        return fileService.discardProposal({ name: args.name })
      }
    }
  ]
}

/** 载体已认领（读）与自有（写/审阅）的工具名，供门禁核「认领面只增不减」；提案三把是自有名字。 */
export const NOVEL_TOOL_NAMES = Object.freeze(['pinax_chapter_list', 'pinax_chapter_read', 'pinax_chapter_save', 'pinax_proposal_list', 'pinax_proposal_read', 'pinax_proposal_discard'])

/**
 * 卷名排序（工单B）：中文数字（第一卷／第二卷…）按数值排，阿拉伯数字同理，
 * 其余按中文 collator。缺了这一步，'第一卷' 与 '第二卷' 会按拼音（di-er < di-yi）倒过来——
 * 作者看到的第一卷排在第二卷后面就是错的。
 */
const CHINESE_DIGITS = Object.freeze({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 })

function compareVolumeNames(left, right) {
  const a = volumeNumber(left)
  const b = volumeNumber(right)
  if (a !== null && b !== null && a !== b) return a - b
  return collator.compare(left, right)
}

/** 目录名里的第一个数字（中文数字或阿拉伯数字）→ 数值；没有就 null（退回 collator）。
 *  允许前面带一个非数字前缀（「第一卷」「卷1」「Part 2」都认）。 */
function volumeNumber(name) {
  const match = /^[^\d一二两三四五六七八九十百千]*([一二两三四五六七八九十百千]+|\d+)/u.exec(String(name ?? '').trim())
  if (!match) return null
  if (/^\d+$/u.test(match[1])) return Number(match[1])
  let total = 0
  let current = 0
  for (const char of match[1]) {
    if (char === '百') { total += (current || 1) * 100; current = 0 }
    else if (char === '十') { total += (current || 1) * 10; current = 0 }
    else if (char === '千') { total += (current || 1) * 1000; current = 0 }
    else {
      const value = CHINESE_DIGITS[char]
      if (!value) return null
      current = value
    }
  }
  return total + current
}

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
