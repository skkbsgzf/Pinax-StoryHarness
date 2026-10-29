import { fail, ok } from '../../kernel/errors.mjs'
import { isSameProjectRoot, normalizeProjectRoot } from '../../fs/projectPath.mjs'
import { parseWorldbookEntryFile, serializeWorldbookEntryFile } from '../../../shared/worldbookFileContract.js'
import { readWorldbookEntries } from './context.mjs'
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
 * 元数据口（工单C）：pinax_worldbook_save 的可选 meta＝{ keys?, tags?, summary? }，在契约条目上
 * 覆盖解析出的对应字段（未提供的字段保持原值，id/type/relations 一律不给改）；裸 md 与新建
 * 提供 meta 即 INVALID_INPUT——新建条目请先保存正文建档，再改关键词／标签。
 */
const MAX_CONTENT_CHARS = 200_000
/** 元数据口的一句话摘要上限（工单C）：超过就不落盘，不静默截断。 */
const MAX_SUMMARY_CHARS = 500
/** meta 只开这三个字段：relations 归关系图域、id 是稳定标识、type 走建档（工单C 边界）。 */
const META_FIELDS = Object.freeze(['keys', 'tags', 'summary'])
const WORLDBOOK_DIR = WORLDBOOK_CARRIER.dataDirs.entries

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

  async function readAll(limit) {
    const read = await readWorldbookEntries({ pluginId, fileService, limit })
    if (read.error) {
      return { failure: fail(read.error.code, `「${WORLDBOOK_DIR}/」未取得：${read.error.message}`, read.error.details ?? null) }
    }
    return { entries: read.entries, warnings: read.warnings, skippedDirs: read.skippedDirs }
  }

  return [
    {
      name: 'pinax_worldbook_list',
      title: '列出世界书条目（世界书载体）',
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
      title: '读取世界书条目（世界书载体）',
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
      title: '保存世界书条目（世界书载体）',
      description: '作者确认后的设定落盘口：新建传 expectedRevision 0；改稿必须先读到修订号，不符即 PINAX_STALE_REVISION，不覆盖、不合并。保存的是条目正文：契约条目保留既有 frontmatter（id/type/keys/relations 不变），裸 md 与新建文件按原样整份写。可选 meta 只改已建档条目的元数据（keys 关键词／tags 标签／summary 摘要），未提供的字段保持原值；裸 md 与新建带 meta 即拒（先保存正文建档再改）。写 世界书/ 走文件服务三道闸（归属＋file:世界书:rw＋并发）。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'text', 'expectedRevision'],
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 240, description: '目标相对路径（世界书/ 下），与读取工具给回的 path 同一形状，如「世界书/人物·柯秒.md」或「人物·柯秒.md」。' },
          text: { type: 'string', minLength: 1, maxLength: MAX_CONTENT_CHARS, description: '条目正文（契约条目只换正文、frontmatter 原样保留；裸 md 与新建按原样整份写），故必须带修订号。' },
          expectedRevision: { type: 'integer', minimum: 0, description: '读取时拿到的修订号；新建传 0。' },
          meta: {
            type: 'object',
            additionalProperties: false,
            description: '可选：改条目元数据。只对已按世界书文件契约建档（有 frontmatter）的条目生效——未提供的字段保持原值；传空数组／空串表示清空该字段。裸 md 与新建文件提供 meta 即拒（新建请先保存正文建档，再改关键词／标签）；id 是稳定标识、relations 归关系图域，两者都不在这个口里。',
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
          // 未提供的字段保持原值；id/type/relations 不在 meta 里，天然动不到（工单C 边界）。
          if (meta.keys !== undefined) entry.keys = meta.keys
          if (meta.tags !== undefined) entry.tags = meta.tags
          if (meta.summary !== undefined) entry.summary = meta.summary
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

/**
 * meta 形状校验（工单C）：只认 keys / tags / summary。
 * 数组元素必须是非空字符串（trim 后落盘）；summary 是字符串且 ≤500 字（传空串＝清空），
 * 超长不静默截断。多写的字段直接拒——声明了却不生效正是作者最怕的那种「保存了但没变」。
 */
function normalizeEntryMeta(meta) {
  if (!isPlainObject(meta)) return fail('INVALID_INPUT', 'meta 必须是对象：{ keys?, tags?, summary? }')
  for (const key of Object.keys(meta)) {
    if (!META_FIELDS.includes(key)) {
      return fail('INVALID_INPUT', `meta 含未知字段 "${key}"：可改的元数据只有 keys / tags / summary（id 是稳定标识、relations 归关系图域，都不在这个口里）`, { key })
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
  return ok(out)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 世界书板块的工具名（两把内核只读名＋一把自有写入口）；供门禁核「认领面只增不减」。 */
export const WORLDBOOK_TOOL_NAMES = Object.freeze(['pinax_worldbook_list', 'pinax_worldbook_read', 'pinax_worldbook_save'])

export default createWorldbookTools
