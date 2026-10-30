import { randomUUID } from 'node:crypto'
import { fail, ok } from '../kernel/errors.mjs'

/**
 * 记录型载体的共用底座（M4／M5：素材／漫画／视频／体验／联机）。
 *
 * 为什么先做「一份 JSON 文档 ＋ 四条工具」：
 *   - 老前端这五块的数据都在 localStorage／IndexedDB（narrative_assets_v1、media_assets_v1、
 *     comic_pages_v1、体验会话、联机房间），Next 的文件服务只认项目内的文本文件；
 *   - 搬家第一步是给它们一个**文件真源**：`<目录>/<载体>.json`，一条记录一行 JSON，
 *     作者看得见、能备份、能进历史；二进制（图／片）暂不落这里（文件服务仍是文本口），
 *     记录里的 refs 只存相对路径或外链，等 R3 的资产迁移裁定再补。
 *
 * 四条工具的形状与既有载体同一套：
 *   list    读整份文档，回记录摘要＋文档修订号；
 *   read    按 id 回一条全文；
 *   save    覆盖式写整份文档：新建传 expectedRevision 0；改稿必须带回 list／read 给的修订号；
 *   remove  删一条记录（文档修订号同样必填）。
 * 所有写入都走 fileService.write 的三道闸（归属／作用域／并发），本模块绝不自己开文件句柄。
 *
 * 一条记录的字段：
 *   { id, title, type, status, order, body, tags[], refs[], meta{}, createdAt, updatedAt }
 *   - type／status 由各载体在描述里给出建议值，但不在这里做枚举硬闸：
 *     老数据里本来就有混用，先收进来再逐步收紧（宁可不丢，不假装丢了的没发生）；
 *   - meta 是载体私有字段的原样承载体（漫画的 panels、视频的时长等），界面不拆它，
 *     保存时原样带回——未知字段不许因为「界面上没有」就被洗掉。
 */
export const RECORD_SCHEMA_VERSION = 1
export const RECORD_MAX_BODY_CHARS = 200_000
const MAX_TITLE_CHARS = 160
const MAX_RECORDS = 2_000
const MAX_LIST_LIMIT = 500
const LIST_EXCERPT_CHARS = 200

/**
 * @param {object} context 运行时给的项目上下文（含 fileService／pluginId）
 * @param {object} config  { prefix, dir, file, label, typeHint, statusHint }
 *   prefix  工具名前缀，如 pinax_material
 *   dir     载体认领的物理目录，如 素材
 *   file    目录内的记录文件名，如 素材.json
 */
export function createRecordTools(context = {}, config = {}) {
  const pluginId = context.pluginId ?? config.pluginId
  const fileService = context.fileService ?? null
  const { prefix, dir, file, label } = config
  if (!prefix || !dir || !file) throw new TypeError('createRecordTools 需要 prefix／dir／file')

  const relativePath = `${dir}/${file}`

  function needService() {
    return fileService
      ? null
      : fail('INVALID_INPUT', `载体 ${pluginId} 的工具需要已打开项目的文件服务；空框架下请回落内核工具`, { pluginId })
  }

  /** 读整份文档：账上修订号 0 ＝ 还没有这份文件（不是坏文件），按空记录集起步。 */
  async function loadDocument() {
    const missing = needService()
    if (missing) return missing
    const revision = await fileService.revisionOf(relativePath)
    if (revision === 0) {
      return ok({ doc: { schemaVersion: RECORD_SCHEMA_VERSION, records: [] }, revision: 0, exists: false })
    }
    const read = await fileService.read({ pluginId, dir, file })
    if (!read.ok) return read
    let parsed
    try {
      parsed = JSON.parse(read.value.text)
    } catch {
      return fail('INVALID_INPUT', `「${relativePath}」不是合法 JSON，拒绝按记录集读取；请先修好这份文件或另起文件名`, {
        file: relativePath
      })
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('INVALID_INPUT', `「${relativePath}」的顶层必须是对象（{ schemaVersion, records }）`, { file: relativePath })
    }
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== RECORD_SCHEMA_VERSION) {
      return fail('INVALID_INPUT', `「${relativePath}」的 schemaVersion=${String(parsed.schemaVersion)}，本版只认 ${RECORD_SCHEMA_VERSION}：不自作主张升级／降级`, {
        file: relativePath, schemaVersion: parsed.schemaVersion
      })
    }
    const records = Array.isArray(parsed.records) ? parsed.records.filter((item) => item && typeof item === 'object') : []
    if (records.length > MAX_RECORDS) {
      return fail('INVALID_INPUT', `「${relativePath}」有 ${records.length} 条记录，超过单文件上限 ${MAX_RECORDS}`, { file: relativePath })
    }
    return ok({ doc: { ...parsed, schemaVersion: RECORD_SCHEMA_VERSION, records }, revision: read.value.revision, exists: true })
  }

  /** 写整份文档：记录集按 order 升序落盘（没有 order 的按写入顺序），作者手改也读得懂。 */
  async function saveDocument(doc, expectedRevision) {
    const text = `${JSON.stringify({ schemaVersion: RECORD_SCHEMA_VERSION, records: doc.records }, null, 2)}\n`
    const written = await fileService.write({ pluginId, dir, file, text, expectedRevision })
    if (!written.ok) return written
    return ok({ file: written.value.relativePath, revision: written.value.revision, sha256: written.value.sha256, bytes: written.value.bytes })
  }

  function orderedRecords(records) {
    return records
      .map((record, index) => ({ record, index }))
      .sort((a, b) => orderOf(a.record, a.index) - orderOf(b.record, b.index) || a.index - b.index)
      .map((item) => item.record)
  }

  function summarize(record, index) {
    return {
      index,
      id: record.id,
      title: typeof record.title === 'string' ? record.title : '',
      type: typeof record.type === 'string' ? record.type : '',
      status: typeof record.status === 'string' ? record.status : '',
      order: Number.isFinite(record.order) ? record.order : null,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
      excerpt: excerptOf(record.body)
    }
  }

  return [
    {
      name: `${prefix}_list`,
      title: `列出${label}记录（${label}载体）`,
      description: `读出「${relativePath}」里的${label}记录（id、标题、类型、状态、顺序、更新时间与正文前 ${LIST_EXCERPT_CHARS} 字），并带回文档修订号——保存与删除都要原样带回它。可按 status／type 过滤、按标题与正文检索；只读，不改任何文件。`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_LIMIT, description: `最多返回多少条，默认 200，上限 ${MAX_LIST_LIMIT}。` },
          status: { type: 'string', minLength: 1, maxLength: 40, description: '只看某个状态（如 inbox／accepted／archived）。' },
          type: { type: 'string', minLength: 1, maxLength: 40, description: '只看某个类型（如 reference-image／comic-page／video）。' },
          query: { type: 'string', minLength: 1, maxLength: 120, description: '在标题与正文里做包含检索（不区分大小写）。' }
        }
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const loaded = await loadDocument()
        if (!loaded.ok) return loaded
        const limit = args.limit === undefined ? 200 : args.limit
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
          return fail('INVALID_INPUT', `limit 须是 1–${MAX_LIST_LIMIT} 的整数`, { got: args.limit })
        }
        const needle = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
        const ordered = orderedRecords(loaded.value.doc.records)
        const filtered = ordered.filter((record) => {
          if (args.status && record.status !== args.status) return false
          if (args.type && record.type !== args.type) return false
          if (!needle) return true
          const haystack = `${String(record.title ?? '')}\n${String(record.body ?? '')}`.toLowerCase()
          return haystack.includes(needle)
        })
        return ok({
          file: relativePath,
          revision: loaded.value.revision,
          total: filtered.length,
          records: filtered.slice(0, limit).map((record, index) => summarize(record, index)),
          truncated: filtered.length > limit
        })
      }
    },
    {
      name: `${prefix}_read`,
      title: `读取一条${label}记录（${label}载体）`,
      description: `按 id 读「${relativePath}」里的一条${label}记录全文（含 tags／refs／meta），并带回文档修订号。读不到就说读不到，不拼一条相近的冒充。`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 80, description: '记录 id（list 返回的那个）。' }
        }
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const loaded = await loadDocument()
        if (!loaded.ok) return loaded
        const record = loaded.value.doc.records.find((item) => item.id === args.id)
        if (!record) {
          return fail('INVALID_INPUT', `「${relativePath}」里没有 id=${String(args.id)} 的记录`, {
            file: relativePath, total: loaded.value.doc.records.length
          })
        }
        return ok({ file: relativePath, revision: loaded.value.revision, record })
      }
    },
    {
      name: `${prefix}_save`,
      title: `保存${label}记录（${label}载体）`,
      description: `作者确认后的${label}落盘口：新建不传 id（传 title），改稿传 id。expectedRevision 一律必填——新建时若文件已存在按第 1 版处理，必须带回 list／read 给的修订号；不符即 PINAX_STALE_REVISION，不覆盖、不合并。只改传进来的字段，未传字段原样保留（meta 里的载体私有字段不会因为界面没显示就被洗掉）。写「${relativePath}」走文件服务三道闸（归属＋file:${dir}:rw＋并发）。`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 80, description: '改稿时传记录 id；新建不传。' },
          title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_CHARS, description: '记录标题；新建必填。' },
          type: { type: 'string', minLength: 1, maxLength: 40, description: `记录类型。${config.typeHint ?? ''}`.trim() },
          status: { type: 'string', minLength: 1, maxLength: 40, description: `记录状态。${config.statusHint ?? ''}`.trim() },
          order: { type: 'integer', minimum: 0, maximum: 1_000_000, description: '排序位（漫画页／分镜序用）；不传则新建时排到末尾、改稿时保留原值。' },
          body: { type: 'string', maxLength: RECORD_MAX_BODY_CHARS, description: `正文／说明（上限 ${RECORD_MAX_BODY_CHARS} 字符）。` },
          tags: { type: 'array', maxItems: 80, items: { type: 'string', minLength: 1, maxLength: 60 }, description: '标签表（整表覆盖；不传则保留原值）。' },
          refs: { type: 'array', maxItems: 200, items: { type: 'string', minLength: 1, maxLength: 400 }, description: '引用表（相对路径或外链；整表覆盖；不传则保留原值）。' },
          meta: { type: 'object', description: '载体私有字段（整份覆盖；不传则保留原值）。' },
          expectedRevision: { type: 'integer', minimum: 0, description: 'list／read 给的文档修订号；新建传 0。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          return fail('INVALID_INPUT', 'expectedRevision 必填（新建传 0），改稿请带回 list／read 给的修订号')
        }
        const loaded = await loadDocument()
        if (!loaded.ok) return loaded
        const records = loaded.value.doc.records.map((item) => ({ ...item }))
        const now = new Date().toISOString()
        let record
        let created = false

        if (args.id !== undefined) {
          const index = records.findIndex((item) => item.id === args.id)
          if (index < 0) {
            return fail('INVALID_INPUT', `「${relativePath}」里没有 id=${String(args.id)} 的记录；新建请不传 id、传 title`, {
              file: relativePath, total: records.length
            })
          }
          record = { ...records[index] }
          applyPatch(record, args)
          record.updatedAt = now
          records[index] = record
        } else {
          const title = typeof args.title === 'string' ? args.title.trim() : ''
          if (!title) return fail('INVALID_INPUT', '新建记录必须给 title（改稿请传 id）')
          if (records.length >= MAX_RECORDS) {
            return fail('INVALID_INPUT', `「${relativePath}」已到单文件上限 ${MAX_RECORDS} 条，请先归档或另起载体`, { file: relativePath })
          }
          const id = newRecordId(prefix)
          if (records.some((item) => item.id === id)) {
            return fail('INVALID_INPUT', `记录 id 已存在：${id}`, { id })
          }
          record = {
            id,
            title,
            type: typeof args.type === 'string' ? args.type : '',
            status: typeof args.status === 'string' ? args.status : '',
            order: Number.isSafeInteger(args.order) ? args.order : records.length,
            body: typeof args.body === 'string' ? args.body : '',
            tags: stringList(args.tags),
            refs: stringList(args.refs),
            meta: plainObject(args.meta),
            createdAt: now,
            updatedAt: now
          }
          records.push(record)
          created = true
        }

        const written = await saveDocument({ records }, args.expectedRevision)
        if (!written.ok) return written
        return ok({ file: written.value.file, revision: written.value.revision, created, record })
      }
    },
    {
      name: `${prefix}_remove`,
      title: `删除一条${label}记录（${label}载体）`,
      description: `从「${relativePath}」里删掉一条${label}记录（只删记录，不删文件；记录空了文件仍在，便于作者回看与恢复）。expectedRevision 必填，不符即 PINAX_STALE_REVISION。`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'expectedRevision'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 80, description: '要删除的记录 id。' },
          expectedRevision: { type: 'integer', minimum: 0, description: 'list／read 给的文档修订号。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          return fail('INVALID_INPUT', 'expectedRevision 必填（带回 list／read 给的修订号）')
        }
        const loaded = await loadDocument()
        if (!loaded.ok) return loaded
        const index = loaded.value.doc.records.findIndex((item) => item.id === args.id)
        if (index < 0) {
          return fail('INVALID_INPUT', `「${relativePath}」里没有 id=${String(args.id)} 的记录`, {
            file: relativePath, total: loaded.value.doc.records.length
          })
        }
        const records = loaded.value.doc.records.map((item) => ({ ...item }))
        const [removed] = records.splice(index, 1)
        const written = await saveDocument({ records }, args.expectedRevision)
        if (!written.ok) return written
        return ok({ file: written.value.file, revision: written.value.revision, removed })
      }
    }
  ]
}

function applyPatch(record, args) {
  if (typeof args.title === 'string' && args.title.trim()) record.title = args.title.trim()
  if (typeof args.type === 'string') record.type = args.type
  if (typeof args.status === 'string') record.status = args.status
  if (Number.isSafeInteger(args.order)) record.order = args.order
  if (typeof args.body === 'string') record.body = args.body
  if (Array.isArray(args.tags)) record.tags = stringList(args.tags)
  if (Array.isArray(args.refs)) record.refs = stringList(args.refs)
  if (args.meta !== undefined) record.meta = plainObject(args.meta)
}

function stringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function orderOf(record, index) {
  return Number.isSafeInteger(record?.order) ? record.order : Number.MAX_SAFE_INTEGER - 1_000_000 + index
}

function excerptOf(body) {
  const text = String(body ?? '').replace(/\s+/gu, ' ').trim()
  return text.length > LIST_EXCERPT_CHARS ? `${text.slice(0, LIST_EXCERPT_CHARS)}…` : text
}

/** 记录 id：前缀＋时间＋随机段；够短、可读、不依赖项目 id（老数据搬家时可直接换成旧 id）。 */
function newRecordId(prefix) {
  const kind = String(prefix).replace(/^pinax_/u, '').slice(0, 12) || 'record'
  return `${kind}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}
