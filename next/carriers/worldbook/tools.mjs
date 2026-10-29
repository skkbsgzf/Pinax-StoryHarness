import { fail, ok } from '../../kernel/errors.mjs'
import { isSameProjectRoot, normalizeProjectRoot } from '../../fs/projectPath.mjs'
import { parseWorldbookEntryFile, serializeWorldbookEntryFile } from '../../../shared/worldbookFileContract.js'
import { WORLDBOOK_CARRIER, WORLDBOOK_CARRIER_ID } from './manifest.mjs'

/**
 * 世界书载体的工具实现（协议 v1.1-A：从设定载体整块迁出；工单A2 的写入口与批次21 C 的 meta 口腔原样保留）。
 * 两把从内核认领的只读名字：pinax_worldbook_list / pinax_worldbook_read。
 * 认领的理由很具体——内核那份实现是「按服务端注册表找项目根、再自己递归读盘」，
 * 而 Next 的项目根就是当前打开的这个文件夹，世界书的权限由本板块的 file:世界书:rw 逐条申请；
 * 装载体后走内核文件服务的三道闸，装载体前内核兜底，工具面不因开关少一个名字。
 * 输出形状与内核同名工具保持一致（total/truncated/warnings/entries、entry/contentChars/contentTruncated），
 * 只额外给出 path 与 revision：面板要按文件定位，作者要能看到这条是从哪个文件、第几版读来的。
 * 写入口 pinax_worldbook_save 是载体自有工具（工单A2，作者批准的合同变更）：
 * 写 世界书/ 必须带 expectedRevision（先例与返回形状照 novel 的 pinax_chapter_save），
 * 与运行时（一级公民）的提案轨彻底分开。
 * text 的语义（调度方裁定 dwfq-f2369ffa-2）：保存的是正文；现有文件能解析出 frontmatter 的
 * （契约条目），id/type/keys/tags/relations 原样保留、只把正文换成 text——否则面板一保存
 * 就把条目建档信息洗掉，openEntry 按 id 重读的链路也会断；裸 md 与新建文件按原样整份写。
 * 元数据口（工单C／批次28 · 工单2a）：pinax_worldbook_save 的可选 meta＝
 * { keys?, tags?, summary?, relations? }，在契约条目上覆盖解析出的对应字段（未提供的字段保持原值，
 * id/type 一律不给改）；裸 md 与新建提供 meta 即 INVALID_INPUT——新建条目请先保存正文建档，
 * 再改关键词／标签／关系。relations 整份覆盖（最多 32 条）：每项只收 to ／ type ／ stance ／ covert ／ weight，
 * src 是来源证明而不是作者编辑的东西，递进来直接拒；落盘仍走 shared/worldbookFileContract.js 的
 * serializeWorldbookEntryFile（它与 links 的 ∪ 去重是同一份实现，这里不写第二套 YAML 子集）。
 *
 * 类别层（批次34 · 真实数据适配第一档）：大梦的 13 条世界书全在 世界书/人物|编年|设定/ 里，
 * 而这一栏原先只列一层 → 面板全盲（文件合法、工具瞎）。现在：
 *   - 列：世界书/ 顶层文件 ＋ 每个一级子目录里的文件（一层封顶；更深的不猜，如实记 warning 与 skippedDirs）；
 *   - 每条带 cat（相对 世界书/ 的一级子目录名，顶层文件为空串）与带子路径的 path（世界书/人物/xxx.md）；
 *   - 排序：类别（顶层在先）→ 文件名；另回 categories: [名称…] 供索引窗分组与新建下拉；
 *   - 读：除 id／name 外接受 path（子路径原样）；
 *   - 写：path 接受子路径（新建落类别目录；改稿把读回来的 path 原样带回），三道闸的语义不变
 *     （子路径的归属仍按一级目录「世界书」判，工单B 的文件服务语义）。
 */
const MAX_CONTENT_CHARS = 200_000
/** 元数据口的一句话摘要上限（工单C）：超过就不落盘，不静默截断。 */
const MAX_SUMMARY_CHARS = 500
/** 关系口（批次28 · 工单2a）：一条关系的目标／类型／立场长度上限与条数上限。 */
const MAX_RELATIONS = 32
const MAX_RELATION_TARGET_CHARS = 80
const MAX_RELATION_LABEL_CHARS = 32
/** meta 开四个字段：keys／tags／summary 是元数据，relations 是作者手编的关系边（批次28 起）。
 *  id 是稳定标识、type 走建档，两者都不在这个口里；src 是来源证明，不收。 */
const META_FIELDS = Object.freeze(['keys', 'tags', 'summary', 'relations'])
/** 关系边里作者能改的字段；src（来源证明）与未知字段一律拒。 */
const RELATION_FIELDS = Object.freeze(['to', 'type', 'stance', 'covert', 'weight'])
const WORLDBOOK_DIR = WORLDBOOK_CARRIER.dataDirs.entries
/** 一次最多碰多少个世界书文件：与内核 pinax_worldbook_list 的 limit 上限（1000）同档。 */
const ENTRY_READ_LIMIT = 1000
/** 与 context.mjs 同一条文本口径（.md 是契约形态；.txt 是历史遗留的裸稿）。 */
const TEXT_FILE_PATTERN = /\.(?:md|txt)$/iu
/** 文件名排序：中文按拼音、数字按数值（003-倒带 排在 010-xxx 之前，不按字符序）。 */
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export function createWorldbookTools(context = {}) {
  const pluginId = context.pluginId ?? WORLDBOOK_CARRIER_ID
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
      return fail('INVALID_INPUT', `世界书载体 ${pluginId} 没有项目根：请先打开一个含 .pinax/project.json 的本地文件夹`, { projectPath: given })
    }
    // 归一与比较用 next/fs 的同一份实现：载体与运行时写族闸判「是不是当前这个项目」必须同一条规矩。
    if (!isSameProjectRoot(given, current)) {
      return fail('INVALID_INPUT', `世界书载体只服务当前打开的 Next 项目（${current}），不读别的项目路径`, {
        projectPath: given,
        currentRoot: current
      })
    }
    return null
  }

  /**
   * 世界书全量读取（批次34）：顶层文件 ＋ 一级类别子目录里的文件。
   * 只有一层是刻意的——真实结构就是「世界书/类别/条目.md」；第二层子目录不猜，记进
   * warnings 与 skippedDirs（面板要能把「没读」如实讲出来，而不是装作这一栏空了）。
   * 每条的 cat 是类别名（顶层为空串），path 是带子路径的相对路径（世界书/人物/xxx.md）。
   * 排序：类别（顶层在先）→ 文件名；列表与 read 吃同一份顺序，不存在两套排名。
   */
  async function readAll(limit) {
    const listed = await fileService.list({ pluginId, dir: WORLDBOOK_DIR })
    if (!listed.ok) {
      return { failure: fail(listed.error.code, `「${WORLDBOOK_DIR}/」未取得：${listed.error.message}`, listed.error.details ?? null) }
    }
    const warnings = []
    const skippedDirs = []
    const topEntries = listed.value.entries ?? []
    const categories = topEntries
      .filter((entry) => entry.kind === 'dir')
      .map((entry) => entry.name)
      .sort((a, b) => collator.compare(a, b))
    const targets = topEntries
      .filter((entry) => entry.kind === 'file' && TEXT_FILE_PATTERN.test(entry.name))
      .map((entry) => ({ file: entry.name, cat: '' }))
    for (const category of categories) {
      const nested = await fileService.list({ pluginId, dir: `${WORLDBOOK_DIR}/${category}` })
      if (!nested.ok) {
        warnings.push(`「${WORLDBOOK_DIR}/${category}/」列不出来：${nested.error.message}`)
        continue
      }
      for (const entry of nested.value.entries ?? []) {
        if (entry.kind === 'dir') {
          skippedDirs.push(`${WORLDBOOK_DIR}/${category}/${entry.name}`)
          continue
        }
        if (TEXT_FILE_PATTERN.test(entry.name)) targets.push({ file: `${category}/${entry.name}`, cat: category })
      }
    }
    if (skippedDirs.length) {
      warnings.push(`「${WORLDBOOK_DIR}/」下有 ${skippedDirs.length} 个第二层子目录（${skippedDirs.slice(0, 6).join(' / ')}）未读取：类别只认一层。`)
    }
    targets.sort(compareByCategoryThenName)

    const cap = Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, ENTRY_READ_LIMIT) : ENTRY_READ_LIMIT
    const entries = []
    for (const target of targets.slice(0, cap)) {
      const read = await fileService.read({ pluginId, dir: WORLDBOOK_DIR, file: target.file })
      if (!read.ok) {
        warnings.push(`世界书「${target.file}」读失败：${read.error.message}`)
        continue
      }
      entries.push(toEntry(read, target.cat))
    }
    if (targets.length > cap) {
      warnings.push(`「${WORLDBOOK_DIR}/」有 ${targets.length} 个文件，本次只读了前 ${cap} 个（上限 ${ENTRY_READ_LIMIT}）。`)
    }
    if (entries.some((entry) => entry.unparsed)) {
      warnings.push(`${entries.filter((entry) => entry.unparsed).length} 个世界书文件不符合文件契约（无 frontmatter 或缺 id），按整篇正文收录。`)
    }
    return { entries, warnings, skippedDirs, categories }
  }

  /** 单条文件 → 条目（契约条目给全字段；裸 md 按整篇收录并标记未建档）。 */
  function toEntry(read, category) {
    const parsed = parseWorldbookEntryFile(read.value.text)
    const fallbackName = baseName(read.value.relativePath).replace(TEXT_FILE_PATTERN, '')
    if (parsed.ok) {
      const content = String(parsed.entry.content ?? '').replace(/\r\n?/g, '\n').trim()
      return {
        id: parsed.entry.id || null,
        name: parsed.entry.name || fallbackName,
        type: parsed.entry.type || 'general',
        keys: [...(parsed.entry.keys ?? [])],
        tags: Array.isArray(parsed.entry.tags) ? parsed.entry.tags : [],
        summary: typeof parsed.entry.summary === 'string' ? parsed.entry.summary : '',
        relations: Array.isArray(parsed.entry.relations) ? parsed.entry.relations : [],
        cat: category,
        content,
        path: read.value.relativePath,
        revision: read.value.revision,
        chars: content.length,
        contract: true
      }
    }
    const content = String(read.value.text).replace(/\r\n?/g, '\n').trim()
    return {
      id: null,
      name: fallbackName,
      type: 'general',
      keys: [],
      tags: [],
      relations: [],
      cat: category,
      content,
      path: read.value.relativePath,
      revision: read.value.revision,
      chars: content.length,
      contract: false,
      contractError: parsed.error.message,
      unparsed: true
    }
  }

  /** 按 path / id / name 找一条（read 与「按路径确认这份文件在不在世界书里」共用）。 */
  function locate(entries, { id = '', name = '', path = '' }) {
    if (path) {
      const wanted = toDirRelative(WORLDBOOK_DIR, path).replace(/^\.\//u, '')
      return entries.find((entry) => toDirRelative(WORLDBOOK_DIR, entry.path) === wanted) ?? null
    }
    if (id) return entries.find((entry) => entry.id === id) ?? null
    if (name) return entries.find((entry) => entry.name === name) ?? null
    return null
  }

  return [
    {
      name: 'pinax_worldbook_list',
      title: '列出世界书条目（世界书载体）',
      description: '列出当前项目「世界书/」里的条目（id/名称/类型/类别/标签/别名/字数/所在文件与修订号），含一级类别子目录（人物/编年/设定…）里的条目，可按 type 过滤；不返回正文，也不谎报没读过的字节数。第二层子目录未被递归时如实记账。',
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
          // 类别清单（批次34）：索引窗按它分组、新建下拉按它出选项；顶层不属于任何类别，故不在里面。
          categories: loaded.categories ?? [],
          projectRoot: root,
          entries: all.slice(0, limit).map((entry) => ({
            id: entry.id,
            name: entry.name,
            type: entry.type,
            // 类别（批次34）：一级子目录名；顶层文件为空串（不是 undefined——界面不必再猜）。
            cat: entry.cat ?? '',
            tags: entry.tags,
            aliases: entry.keys,
            chars: entry.chars,
            // 摘要随列表带回（批次28 · 工单3）：索引窗的表格视图要一列摘要，不为它多发一次 read。
            summary: typeof entry.summary === 'string' ? entry.summary : '',
            path: entry.path,
            revision: entry.revision,
            contract: entry.contract
          }))
        })
      }
    },
    {
      name: 'pinax_worldbook_read',
      title: '读取世界书条目（世界书载体）',
      description: '按 path（世界书/ 下的相对路径，可带一级类别子目录）或 id 或 name 读单条世界书正文与关系字段，支持 maxChars 截断；返回该文件的相对路径、类别与修订号，读不到就说读不到，不拼一条相近的冒充。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectPath: { type: 'string', maxLength: 240, description: '当前项目根路径；与打开的项目不一致时直接拒绝。' },
          path: { type: 'string', minLength: 1, maxLength: 240, description: '条目相对路径，与 pinax_worldbook_list 给的 path 同一形状（如「世界书/人物/人物·柯秒.md」，也接受「人物·柯秒.md」）。' },
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
        const wantedPath = typeof args.path === 'string' ? args.path.trim() : ''
        if (!wantedId && !wantedName && !wantedPath) return fail('INVALID_INPUT', 'pinax_worldbook_read 要给 path / id / name 其一')
        const maxChars = args.maxChars === undefined ? 50_000 : args.maxChars
        if (!Number.isSafeInteger(maxChars) || maxChars < 1000 || maxChars > MAX_CONTENT_CHARS) {
          return fail('INVALID_INPUT', `maxChars 须是 1000–${MAX_CONTENT_CHARS} 的整数`, { got: args.maxChars })
        }
        const loaded = await readAll(ENTRY_READ_LIMIT)
        if (loaded.failure) return loaded.failure
        const warnings = [...loaded.warnings]
        const entries = loaded.entries
        let hit = wantedPath ? locate(entries, { path: wantedPath }) : null
        // path 读不到就给一句准确的话：这份文件不在世界书/ 里（也不猜一条相近的顶上）。
        if (!hit && wantedPath) {
          return fail('INVALID_INPUT', `「${WORLDBOOK_DIR}/」里没有 ${wantedPath}`, {
            total: entries.length,
            candidates: entries.slice(0, 10).map((entry) => entry.path)
          })
        }
        if (!hit && wantedId) hit = locate(entries, { id: wantedId })
        if (!hit && wantedName) {
          hit = locate(entries, { name: wantedName })
          if (!hit) {
            const loose = entries.filter((entry) => String(entry.name).includes(wantedName))
            if (loose.length > 1) {
              warnings.push(`名称「${wantedName}」按包含匹配命中 ${loose.length} 条，取第一条「${loose[0].name}」；请改用 id 精确定位。`)
            }
            hit = loose[0] ?? null
          }
        }
        if (!hit) {
          return fail('INVALID_INPUT', `「${WORLDBOOK_DIR}/」里没有 ${wantedId || wantedName}`, {
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
            // 收口包②（调度方裁定 dwfq-5c79bf4a-1）：摘要随读返回，阅读态 meta 行才有东西可显示。
            // 裸 md 没有 frontmatter，按空串返回（不是「没读到」）。
            summary: typeof hit.summary === 'string' ? hit.summary : '',
            // 类别（批次34）：一级子目录名；顶层文件是空串。
            cat: hit.cat ?? '',
            // 关系（批次28 · 工单2a）：阅读态要按「目标 · 类型 · 立场」显示，所以归一成作者能编辑的那几栏；
            // frontmatter 里没有 relations 就是空数组（不是「没读到」）。src 不进返回值——它是来源证明。
            relations: relationsForRead(hit.relations),
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
      title: '保存世界书条目（世界书载体）',
      description: '作者确认后的设定落盘口：新建传 expectedRevision 0；改稿必须先读到修订号，不符即 PINAX_STALE_REVISION，不覆盖、不合并。保存的是条目正文：契约条目保留既有 frontmatter（id/type/keys 保持不变），裸 md 与新建文件按原样整份写。path 支持一级类别子目录（如「设定/设定·钟楼.md」，新建落进那个目录；只认一层）。可选 meta 只改已建档条目的元数据（keys 关键词／tags 标签／summary 摘要／relations 关系边），未提供的字段保持原值；裸 md 与新建带 meta 即拒（先保存正文建档再改）。写 世界书/ 走文件服务三道闸（归属＋file:世界书:rw＋并发）。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'text', 'expectedRevision'],
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 240, description: '目标相对路径（世界书/ 下，类别只认一层），与读取工具给回的 path 同一形状，如「世界书/人物/人物·柯秒.md」「人物/人物·柯秒.md」或顶层的「人物·柯秒.md」。' },
          text: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_CHARS, description: '条目正文（契约条目只换正文、frontmatter 原样保留；裸 md 与新建按原样整份写），故必须带修订号。' },
          expectedRevision: { type: 'integer', minimum: 0, description: '读取时拿到的修订号；新建传 0。' },
          meta: {
            type: 'object',
            additionalProperties: false,
            description: '可选：改条目元数据。只对已按世界书文件契约建档（有 frontmatter）的条目生效——未提供的字段保持原值；传空数组／空串表示清空该字段。裸 md 与新建文件提供 meta 即拒（新建请先保存正文建档，再改关键词／标签／关系）；id 是稳定标识、type 走建档，两者都不在这个口里。',
            properties: {
              keys: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
                description: '关键词（别名）：覆盖 frontmatter 的 keys，元素必须是非空字符串，如 ["柯秒", "秒子"]；传 [] 清空。'
              },
              tags: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
                description: '标签：覆盖 frontmatter 的 tags，元素必须是非空字符串，如 ["主角", "停摆的表"]；传 [] 清空。'
              },
              summary: {
                type: 'string',
                maxLength: MAX_SUMMARY_CHARS,
                description: `一句话摘要（≤${MAX_SUMMARY_CHARS} 字）：覆盖 frontmatter 的 summary；传空串清空。`
              },
              relations: {
                type: 'array',
                maxItems: MAX_RELATIONS,
                description: `关系边（整份覆盖，最多 ${MAX_RELATIONS} 条）：每项 { to, type?, stance?, covert?, weight? }；to 是目标条目的 id 或名称（非空，≤${MAX_RELATION_TARGET_CHARS} 字），type／stance 各 ≤${MAX_RELATION_LABEL_CHARS} 字，covert 是暗线标记，weight 是数字。src 是来源证明，不收。传 [] 清空全部关系。`,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['to'],
                  properties: {
                    to: { type: 'string', minLength: 1, maxLength: MAX_RELATION_TARGET_CHARS },
                    type: { type: 'string', maxLength: MAX_RELATION_LABEL_CHARS },
                    stance: { type: 'string', maxLength: MAX_RELATION_LABEL_CHARS },
                    covert: { type: 'boolean' },
                    weight: { type: 'number' }
                  }
                }
              }
            }
          }
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
        // 类别只认一层（批次34 边界）：世界书/类别/条目.md 可以，更深的嵌套布局本批不开。
        const segments = relative.split('/')
        if (segments.length > 2) {
          return fail('INVALID_INPUT', `世界书条目的类别只认一层：${args.path} 多了一层目录`, { path: args.path, maxDepth: 2 })
        }
        if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
          return fail('INVALID_INPUT', `世界书路径不合法：${args.path}`, { path: args.path })
        }

        // 元数据口（工单C）：形状先判（与落盘与否无关），契约与否等读到现文件再判。
        const metaProvided = args.meta !== undefined
        let meta = null
        if (metaProvided) {
          const normalized = normalizeEntryMeta(args.meta)
          if (!normalized.ok) return normalized
          meta = normalized.value
        }

        // 契约条目只换正文（调度方裁定 dwfq-f2369ffa-2）：写前读现文件，能解析出 frontmatter 就
        // 用同一对 parse/serialize 原样带回（不许自造第二套 frontmatter 格式）；裸 md 与新建原样写。
        const current = await fileService.read({ pluginId, dir: WORLDBOOK_DIR, file: relative })
        const parsed = current.ok ? parseWorldbookEntryFile(current.value.text) : null
        if (metaProvided && !parsed?.ok) {
          return fail('INVALID_INPUT', `「${relative}」不存在或没有可解析的 frontmatter（${parsed?.error?.message ?? current.error?.message ?? '未建档'}）：meta 只能改已按世界书文件契约建档的条目；新建条目请先保存正文建档，再改关键词／标签`, {
            path: relative,
            contract: false
          })
        }
        const entry = parsed?.ok ? { ...parsed.entry, content: args.text } : null
        if (entry && meta) {
          // 未提供的字段保持原值；id/type 不在 meta 里，天然动不到（工单C 边界）。
          if (meta.keys !== undefined) entry.keys = meta.keys
          if (meta.tags !== undefined) entry.tags = meta.tags
          if (meta.summary !== undefined) entry.summary = meta.summary
          // relations 整份覆盖（批次28 · 工单2a）：序列化时 links = entry.links ∪ relations[].to 去重合成，
          // 解析时再减回去——纯 id 层那一批 links 不会因为换了关系而丢。
          if (meta.relations !== undefined) entry.relations = meta.relations
        }
        const body = entry ? serializeWorldbookEntryFile(entry) : args.text

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
    }
  ]
}

/** 作者给的是「世界书/xxx.md」还是「xxx.md」都接得住：文件服务那侧的入参是板块目录内的相对路径。 */
function toDirRelative(dir, path) {
  const normalized = String(path).replaceAll('\\', '/')
  return normalized.startsWith(`${dir}/`) ? normalized.slice(dir.length + 1) : normalized
}

/** 相对路径的最后一段（类别子路径下的文件名）。 */
function baseName(relativePath) {
  const parts = String(relativePath ?? '').replaceAll('\\', '/').split('/')
  return parts[parts.length - 1] ?? ''
}

/**
 * 类别层排序（批次34）：顶层条目（cat === ''）排在最前，其后按类别名、类别内按文件名。
 * 顶层在先是有意的——老项目（没有子目录）看上去与批次33 之前完全一样。
 */
function compareByCategoryThenName(left, right) {
  if (left.cat !== right.cat) {
    if (!left.cat) return -1
    if (!right.cat) return 1
    return collator.compare(left.cat, right.cat)
  }
  return collator.compare(baseName(left.file), baseName(right.file))
}

/**
 * meta 形状校验（工单C／批次28 · 工单2a）：只认 keys / tags / summary / relations。
 * 数组元素必须是非空字符串（trim 后落盘）；summary 是字符串且 ≤500 字（传空串＝清空），
 * 超长不静默截断。多写的字段直接拒——声明了却不生效正是作者最怕的那种「保存了但没变」。
 */
function normalizeEntryMeta(meta) {
  if (!isPlainObject(meta)) return fail('INVALID_INPUT', 'meta 必须是对象：{ keys?, tags?, summary?, relations? }')
  for (const key of Object.keys(meta)) {
    if (!META_FIELDS.includes(key)) {
      return fail('INVALID_INPUT', `meta 含未知字段 "${key}"：可改的元数据只有 keys / tags / summary / relations（id 是稳定标识、type 走建档，都不在这个口里）`, { key })
    }
  }
  const out = {}
  for (const field of ['keys', 'tags']) {
    if (meta[field] === undefined) continue
    if (!Array.isArray(meta[field])) return fail('INVALID_INPUT', `meta.${field} 必须是字符串数组`, { got: typeof meta[field] })
    const values = []
    for (const item of meta[field]) {
      if (typeof item !== 'string' || !item.trim()) {
        return fail('INVALID_INPUT', `meta.${field} 的元素必须是非空字符串`, { value: item === undefined ? null : item })
      }
      values.push(item.trim())
    }
    out[field] = values
  }
  if (meta.summary !== undefined) {
    if (typeof meta.summary !== 'string') return fail('INVALID_INPUT', 'meta.summary 必须是字符串')
    if (meta.summary.length > MAX_SUMMARY_CHARS) {
      return fail('INVALID_INPUT', `meta.summary 超出上限 ${MAX_SUMMARY_CHARS} 字`, { got: meta.summary.length })
    }
    out.summary = meta.summary
  }
  if (meta.relations !== undefined) {
    const relations = normalizeRelationsMeta(meta.relations)
    if (!relations.ok) return relations
    out.relations = relations.value
  }
  return ok(out)
}

/**
 * 关系边数组校验（批次28 · 工单2a）：最多 32 条；每项 { to, type?, stance?, covert?, weight? }。
 * 只收作者能改的五栏：src 是来源证明（读回来的边带 src），递进来就明说拒，不悄悄吞掉。
 * 空串的 type／stance 当作「没填」（不落一个空字段），而不是落一个空字符串。
 */
function normalizeRelationsMeta(relations) {
  if (!Array.isArray(relations)) return fail('INVALID_INPUT', 'meta.relations 必须是数组（一条一项）', { got: typeof relations })
  if (relations.length > MAX_RELATIONS) {
    return fail('INVALID_INPUT', `meta.relations 最多 ${MAX_RELATIONS} 条`, { got: relations.length })
  }
  const out = []
  for (const [index, relation] of relations.entries()) {
    if (!isPlainObject(relation)) {
      return fail('INVALID_INPUT', `meta.relations[${index}] 必须是对象：{ to, type?, stance?, covert?, weight? }`, { got: relation === null ? 'null' : typeof relation })
    }
    for (const key of Object.keys(relation)) {
      if (!RELATION_FIELDS.includes(key)) {
        return fail('INVALID_INPUT', `meta.relations[${index}] 含不可编辑字段 "${key}"：只收 to / type / stance / covert / weight（src 是来源证明，不是作者编辑的东西）`, { index, key })
      }
    }
    if (typeof relation.to !== 'string' || !relation.to.trim()) {
      return fail('INVALID_INPUT', `meta.relations[${index}].to 必须是非空字符串（目标条目）`, { index })
    }
    const to = relation.to.trim()
    if (to.length > MAX_RELATION_TARGET_CHARS) {
      return fail('INVALID_INPUT', `meta.relations[${index}].to 超出上限 ${MAX_RELATION_TARGET_CHARS} 字`, { index, got: to.length })
    }
    const edge = { to }
    for (const field of ['type', 'stance']) {
      if (relation[field] === undefined) continue
      if (typeof relation[field] !== 'string') {
        return fail('INVALID_INPUT', `meta.relations[${index}].${field} 必须是字符串`, { index, field })
      }
      const value = relation[field].trim()
      if (value.length > MAX_RELATION_LABEL_CHARS) {
        return fail('INVALID_INPUT', `meta.relations[${index}].${field} 超出上限 ${MAX_RELATION_LABEL_CHARS} 字`, { index, field, got: value.length })
      }
      if (value) edge[field] = value
    }
    if (relation.covert !== undefined) {
      if (typeof relation.covert !== 'boolean') {
        return fail('INVALID_INPUT', `meta.relations[${index}].covert 必须是布尔值（暗线关系）`, { index, got: typeof relation.covert })
      }
      if (relation.covert) edge.covert = true
    }
    if (relation.weight !== undefined) {
      if (typeof relation.weight !== 'number' || !Number.isFinite(relation.weight)) {
        return fail('INVALID_INPUT', `meta.relations[${index}].weight 必须是数字`, { index, got: typeof relation.weight })
      }
      edge.weight = relation.weight
    }
    out.push(edge)
  }
  return ok(out)
}

/**
 * 读回来的 relations 归一（批次28 · 工单2a）：只剩 to ／ type ／ stance ／ covert ／ weight 五栏，
 * src 与陌生字段不带出（那是来源证明与别的工具写的账，不是作者在面板上编辑的东西）。
 * 没有目标的行不算一条关系，直接丢——空 to 在界面上也没有可显示的内容。
 */
function relationsForRead(relations) {
  if (!Array.isArray(relations)) return []
  const out = []
  for (const relation of relations) {
    if (!isPlainObject(relation)) continue
    const to = typeof relation.to === 'string' ? relation.to.trim() : ''
    if (!to) continue
    const edge = { to }
    for (const field of ['type', 'stance']) {
      if (typeof relation[field] === 'string' && relation[field].trim()) edge[field] = relation[field].trim()
    }
    if (relation.covert === true) edge.covert = true
    if (typeof relation.weight === 'number' && Number.isFinite(relation.weight)) edge.weight = relation.weight
    out.push(edge)
  }
  return out
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 世界书板块的工具名（两把内核只读名＋一把自有写入口）；供门禁核「认领面只增不减」。 */
export const WORLDBOOK_TOOL_NAMES = Object.freeze(['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save'])

export default createWorldbookTools
