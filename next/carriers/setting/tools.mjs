import { fail, ok } from '../../kernel/errors.mjs'
import { isSameProjectRoot, normalizeProjectRoot } from '../../fs/projectPath.mjs'
import { parseWorldbookEntryFile, serializeWorldbookEntryFile } from '../../../shared/worldbookFileContract.js'
import { readSettingEntries } from './context.mjs'
import { SETTING_CARRIER, SETTING_CARRIER_ID } from './manifest.mjs'

/**
 * 设定载体的工具实现（M2 批次 1 的第二块板块；工单A2 起带自有写入口）。
 * 两把从内核认领的只读名字：pinax_worldbook_list / pinax_worldbook_read。
 * 认领的理由很具体——内核那份实现是「按服务端注册表找项目根、再自己递归读盘」，
 * 而 Next 的项目根就是当前打开的这个文件夹，世界书的权限由本板块的 file:世界书:rw 逐条申请；
 * 装载体后走内核文件服务的三道闸，装载体前内核兜底，工具面不因开关少一个名字。
 * 输出形状与内核同名工具保持一致（total/truncated/warnings/entries、entry/contentChars/contentTruncated），
 * 只额外给出 path 与 revision：面板要按文件定位，作者要能看到这条是从哪个文件、第几版读来的。
 * 写入口 pinax_worldbook_save 是载体自有工具（工单A2，作者批准的合同变更）：
 * 写 世界书/ 必须带 expectedRevision（先例与返回形状照 novel 的 pinax_chapter_save），
 * 与运行时（一级公民）的提案轨彻底分开。
 * 约束（工单E2）：约束/ 自本工单起申请 rw，按构思速记的同一套模式补最小编辑面——
 * pinax_rule_list 列篇目并把全文随手带回（单篇超 20000 字截断并标注），
 * pinax_rule_save 是它的写入口（expectedRevision 乐观并发，空 text 与非 .md 拒）。
 * 两把都是载体自有名字（内核只有 pinax_rule_write，不认领）；返回形状与构思那对一致。
 * text 的语义（调度方裁定 dwfq-f2369ffa-2）：保存的是正文；现有文件能解析出 frontmatter 的
 * （契约条目），id/type/keys/tags/relations 原样保留、只把正文换成 text——否则面板一保存
 * 就把条目建档信息洗掉，openEntry 按 id 重读的链路也会断；裸 md 与新建文件按原样整份写。
 */
const MAX_CONTENT_CHARS = 200_000
const WORLDBOOK_DIR = SETTING_CARRIER.dataDirs.entries
const RULES_DIR = SETTING_CARRIER.dataDirs.constraints
/** 约束列表随篇带回正文的上限（与构思速记的 pinax_notes_list 同一档）；超出截断并在条目上标注。 */
const RULE_LIST_TEXT_CHARS = 20_000
/** 单篇约束的保存上限（与构思速记同一档）。 */
const MAX_TEXT_CHARS = 200_000
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function createSettingTools(context = {}) {
  const pluginId = context.pluginId ?? SETTING_CARRIER_ID
  const fileService = context.fileService ?? null
  const root = context.root ?? fileService?.root ?? null

  function needService() {
    return fileService
      ? null
      : fail('INVALID_INPUT', `载体 ${pluginId} 的工具需要已打开项目的文件服务；空框架下请回落内核工具`, { pluginId })
  }

  /** 本地化轨的硬口径：这块板块只服务当前打开的 Next 项目，不接受第二个项目路径。 */
  function checkProjectRef(args) {
    const given = typeof args?.projectPath === 'string' ? args.projectPath.trim() : ''
    if (!given) return null
    const current = normalizeProjectRoot(root)
    if (!current) {
      return fail('INVALID_INPUT', `设定载体 ${pluginId} 没有项目根：请先打开一个含 .pinax/project.json 的本地文件夹`, { projectPath: given })
    }
    // 归一与比较用 next/fs 的同一份实现：载体与运行时写族闸判「是不是当前这个项目」必须同一条规矩。
    if (!isSameProjectRoot(given, current)) {
      return fail('INVALID_INPUT', `设定载体只服务当前打开的 Next 项目（${current}），不读别的项目路径`, {
        projectPath: given,
        currentRoot: current
      })
    }
    return null
  }

  async function readAll(limit) {
    const read = await readSettingEntries({ pluginId, fileService, limit })
    if (read.error) {
      return { failure: fail(read.error.code, `「世界书/」未取得：${read.error.message}`, read.error.details ?? null) }
    }
    return { entries: read.entries, warnings: read.warnings, skippedDirs: read.skippedDirs }
  }

  /** 约束目录＝规则序列：与构思速记的 listNotes 同一个列法（文件名排序，正文随条目带回，
   *  单篇超长截断并标注；保存是覆盖式，截断时别整篇回写）。 */
  async function listRules() {
    const missing = needService()
    if (missing) return missing
    const listed = await fileService.list({ pluginId, dir: RULES_DIR })
    if (!listed.ok) return listed
    const names = listed.value.entries
      .filter((entry) => entry.kind === 'file' && /\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => collator.compare(a, b))
    const rules = []
    for (const name of names) {
      const relativePath = `${RULES_DIR}/${name}`
      const read = await fileService.read({ pluginId, dir: RULES_DIR, file: name })
      rules.push({
        index: rules.length,
        title: name.replace(/\.md$/iu, ''),
        file: relativePath,
        name,
        revision: read.ok ? read.value.revision : await fileService.revisionOf(relativePath),
        text: read.ok ? read.value.text.slice(0, RULE_LIST_TEXT_CHARS) : '',
        totalChars: read.ok ? read.value.text.length : 0,
        truncated: read.ok ? read.value.text.length > RULE_LIST_TEXT_CHARS : false
      })
    }
    return ok({ rules, total: rules.length })
  }

  return [
    {
      name: 'pinax_worldbook_list',
      title: '列出世界书条目（设定载体）',
      description: '列出当前项目「世界书/」里的条目（id/名称/类型/标签/别名/字数/所在文件与修订号），可按 type 过滤；不返回正文，也不谎报没读过的字节数。子目录未被递归时会如实记账。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectPath: { type: 'string', maxLength: 240, description: '当前项目根路径；与打开的项目不一致时直接拒绝，绝不换目录读。' },
          type: { type: 'string', maxLength: 40, description: '按条目类型过滤，例如 character / location / event。' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, description: '最多返回多少条，默认 300。' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        const rejected = checkProjectRef(args)
        if (rejected) return rejected
        const limit = args.limit === undefined ? 300 : args.limit
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
          return fail('INVALID_INPUT', 'limit 须是 1–1000 的整数', { got: args.limit })
        }
        const wanted = typeof args.type === 'string' ? args.type.trim() : ''
        const loaded = await readAll(1000)
        if (loaded.failure) return loaded.failure
        const all = loaded.entries.filter((entry) => !wanted || String(entry.type || 'general') === wanted)
        return ok({
          total: all.length,
          truncated: all.length > limit,
          warnings: loaded.warnings,
          skippedDirs: loaded.skippedDirs,
          projectRoot: root,
          entries: all.slice(0, limit).map((entry) => ({
            id: entry.id,
            name: entry.name,
            type: entry.type,
            tags: entry.tags,
            aliases: entry.keys,
            chars: entry.chars,
            path: entry.path,
            revision: entry.revision,
            contract: entry.contract
          }))
        })
      }
    },
    {
      name: 'pinax_worldbook_read',
      title: '读取世界书条目（设定载体）',
      description: '按 id 或 name 读单条世界书正文与关系字段，支持 maxChars 截断；返回该文件的相对路径与修订号，读不到就说读不到，不拼一条相近的冒充。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectPath: { type: 'string', maxLength: 240, description: '当前项目根路径；与打开的项目不一致时直接拒绝。' },
          id: { type: 'string', minLength: 1, maxLength: 120, description: '条目 id（frontmatter 的 id）。' },
          name: { type: 'string', minLength: 1, maxLength: 120, description: '条目名称，先精确后包含匹配。' },
          maxChars: { type: 'integer', minimum: 1000, maximum: MAX_CONTENT_CHARS, description: `正文最多返回字符数，默认 50000，上限 ${MAX_CONTENT_CHARS}。` }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        const rejected = checkProjectRef(args)
        if (rejected) return rejected
        const wantedId = typeof args.id === 'string' ? args.id.trim() : ''
        const wantedName = typeof args.name === 'string' ? args.name.trim() : ''
        if (!wantedId && !wantedName) return fail('INVALID_INPUT', 'pinax_worldbook_read 要给 id 或 name 其一')
        const maxChars = args.maxChars === undefined ? 50_000 : args.maxChars
        if (!Number.isSafeInteger(maxChars) || maxChars < 1000 || maxChars > MAX_CONTENT_CHARS) {
          return fail('INVALID_INPUT', `maxChars 须是 1000–${MAX_CONTENT_CHARS} 的整数`, { got: args.maxChars })
        }
        const loaded = await readAll(1000)
        if (loaded.failure) return loaded.failure
        const warnings = [...loaded.warnings]
        const entries = loaded.entries
        let hit = wantedId ? entries.find((entry) => entry.id === wantedId) : null
        if (!hit && wantedName) {
          hit = entries.find((entry) => entry.name === wantedName) || null
          if (!hit) {
            const loose = entries.filter((entry) => String(entry.name).includes(wantedName))
            if (loose.length > 1) {
              warnings.push(`名称「${wantedName}」按包含匹配命中 ${loose.length} 条，取第一条「${loose[0].name}」；请改用 id 精确定位。`)
            }
            hit = loose[0] ?? null
          }
        }
        if (!hit) {
          return fail('INVALID_INPUT', `「世界书/」里没有 ${wantedId || wantedName}`, {
            total: entries.length,
            candidates: entries.slice(0, 10).map((entry) => entry.name)
          })
        }
        if (!hit.contract) warnings.push(`条目「${hit.name}」未按世界书文件契约建档（${hit.contractError}），返回的是整篇正文。`)
        const content = hit.content
        return ok({
          entry: {
            id: hit.id,
            name: hit.name,
            type: hit.type,
            tags: hit.tags,
            keys: hit.keys,
            relations: hit.relations,
            path: hit.path,
            revision: hit.revision,
            contract: hit.contract,
            content: content.slice(0, maxChars),
            contentChars: content.length,
            contentTruncated: content.length > maxChars
          },
          warnings
        })
      }
    },
    {
      name: 'pinax_worldbook_save',
      title: '保存世界书条目（设定载体）',
      description: '作者确认后的设定落盘口：新建传 expectedRevision 0；改稿必须先读到修订号，不符即 PINAX_STALE_REVISION，不覆盖、不合并。保存的是条目正文：契约条目保留既有 frontmatter（id/type/keys/relations 不变），裸 md 与新建文件按原样整份写。写 世界书/ 走文件服务三道闸（归属＋file:世界书:rw＋并发），约束目录不在其列。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'text', 'expectedRevision'],
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 240, description: '目标相对路径（世界书/ 下），与读取工具给回的 path 同一形状，如「世界书/人物·柯秒.md」或「人物·柯秒.md」。' },
          text: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_CHARS, description: '条目正文（契约条目只换正文、frontmatter 原样保留；裸 md 与新建按原样整份写），故必须带修订号。' },
          expectedRevision: { type: 'integer', minimum: 0, description: '读取时拿到的修订号；新建传 0。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        if (typeof args.path !== 'string' || !args.path.trim()) return fail('INVALID_INPUT', 'path 必填（世界书/ 下的相对路径）')
        if (typeof args.text !== 'string' || !args.text.length) return fail('INVALID_INPUT', 'text 必填且非空')
        if (args.text.length > MAX_CONTENT_CHARS) return fail('INVALID_INPUT', `text 超出单条上限 ${MAX_CONTENT_CHARS} 字符`, { got: args.text.length })
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          return fail('INVALID_INPUT', 'expectedRevision 必填（新建传 0），改稿请带回 pinax_worldbook_read 给的修订号')
        }
        const relative = toDirRelative(WORLDBOOK_DIR, args.path)
        if (!/\.md$/iu.test(relative)) return fail('INVALID_INPUT', '世界书条目文件名必须以 .md 结尾', { path: args.path })

        // 契约条目只换正文（调度方裁定 dwfq-f2369ffa-2）：写前读现文件，能解析出 frontmatter 就
        // 用同一对 parse/serialize 原样带回（不许自造第二套 frontmatter 格式）；裸 md 与新建原样写。
        const current = await fileService.read({ pluginId, dir: WORLDBOOK_DIR, file: relative })
        const parsed = current.ok ? parseWorldbookEntryFile(current.value.text) : null
        const body = parsed?.ok ? serializeWorldbookEntryFile({ ...parsed.entry, content: args.text }) : args.text

        const written = await fileService.write({ pluginId, dir: WORLDBOOK_DIR, file: relative, text: body, expectedRevision: args.expectedRevision })
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
      name: 'pinax_rule_list',
      title: '列出约束（设定载体）',
      description: '按「约束/」文件名排序列出约束文件（序号、标题、相对路径、修订号），并把全文一并带回——约束是短文本，省一次单独的读取；单篇超过 20000 字时截断并在条目上标注，不谎报读全了。只读，不改任何文件。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectPath: { type: 'string', maxLength: 240, description: '当前项目根路径；与打开的项目不一致时直接拒绝，绝不换目录读。' },
          limit: { type: 'integer', minimum: 1, maximum: 500, description: '最多返回多少篇，默认 200。' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        const rejected = checkProjectRef(args)
        if (rejected) return rejected
        const limit = args.limit === undefined ? 200 : args.limit
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
          return fail('INVALID_INPUT', 'limit 须是 1–500 的整数', { got: args.limit })
        }
        const all = await listRules()
        if (!all.ok) return all
        return ok({
          total: all.value.total,
          truncated: all.value.total > limit,
          projectRoot: root,
          rules: all.value.rules.slice(0, limit)
        })
      }
    },
    {
      name: 'pinax_rule_save',
      title: '保存约束（设定载体）',
      description: '作者确认后的约束落盘口：新建传 expectedRevision 0；改稿必须带回 pinax_rule_list 给的修订号，不符即 PINAX_STALE_REVISION，不覆盖、不合并。写 约束/ 走文件服务三道闸（归属＋file:约束:rw＋并发）；文件名必须是 .md。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'expectedRevision'],
        properties: {
          file: { type: 'string', minLength: 1, maxLength: 240, description: '目标相对路径（约束/ 下），与 title 二选一。' },
          title: { type: 'string', minLength: 1, maxLength: 120, description: '新建约束用标题，落成「约束/<标题>.md」。' },
          text: { type: 'string', minLength: 1, maxLength: MAX_TEXT_CHARS, description: '整篇内容（覆盖式保存，故必须带修订号）。' },
          expectedRevision: { type: 'integer', minimum: 0, description: 'pinax_rule_list 给的修订号；新建传 0。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        const rejected = checkProjectRef(args)
        if (rejected) return rejected
        if (typeof args.text !== 'string' || !args.text.length) return fail('INVALID_INPUT', 'text 必填且非空')
        if (args.text.length > MAX_TEXT_CHARS) return fail('INVALID_INPUT', `text 超出单篇上限 ${MAX_TEXT_CHARS} 字符`, { got: args.text.length })
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          return fail('INVALID_INPUT', 'expectedRevision 必填（新建传 0），改稿请带回 pinax_rule_list 给的修订号')
        }
        const target = args.file ?? ruleFileNameFromTitle(args.title)
        if (!target) return fail('INVALID_INPUT', '要给 file（约束/ 下的相对路径）或 title（新建约束标题）')
        const relative = toDirRelative(RULES_DIR, target)
        if (!/\.md$/iu.test(relative)) return fail('INVALID_INPUT', '约束文件名必须以 .md 结尾', { file: target })

        const written = await fileService.write({ pluginId, dir: RULES_DIR, file: relative, text: args.text, expectedRevision: args.expectedRevision })
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

/** 作者给的是「世界书/xxx.md」还是「xxx.md」都接得住：文件服务那侧的入参是板块目录内的相对路径。 */
function toDirRelative(dir, path) {
  const normalized = String(path).replaceAll('\\', '/')
  return normalized.startsWith(`${dir}/`) ? normalized.slice(dir.length + 1) : normalized
}

/** 标题→文件名：与小说载体的 chapterFileNameFromTitle 同一套规则（非法字符与控制字符换空格）。 */
function ruleFileNameFromTitle(title) {
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

/** 设定板块已认领的工具名（两把内核只读名＋一把自有写入口＋工单E2 的约束这对），供门禁核「认领面只增不减」。 */
export const SETTING_TOOL_NAMES = Object.freeze(['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save', 'pinax_rule_list', 'pinax_rule_save'])

export default createSettingTools
