import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fail } from './errors.mjs'
import { validateFactEntry } from '../fact/domain/pediaSchema.js'

/**
 * 拆解文件只读存储（S1 · WO-S1-01）。
 *
 * 真源：`<root>/拆解/*.json`，每个文件是拆解器的一次产物（顶层 book/source/entries/index/wiki/quality…）。
 * 本模块只做四件事：把多文件的 `entries[]` 合并、按 layer/slot/status 过滤、分页、按 id 取一条。
 * **不写盘**：`save` / `remove` 在 S1 只做到 `validateFactEntry` 校验，过后返回 typed fail
 * `WRITE_PROTOCOL_NOT_STARTED`——真落盘（tmp + os.replace、revision 自增、operationId 旁路日志）
 * 是 S2 的 writeFactFile，本模块不为它将来的形状提前埋半套实现。
 *
 * 三条硬口径：
 *   1) **坏档不整体失败**（作者偏好）：单个文件 JSON.parse 失败／顶层不是对象／entries 不是数组，
 *      只跳过这个文件并往 warnings[] 记一条，其余文件照常合并。
 *   2) **只读**：读文件不触发任何镜像／索引写，也不改 `wiki.*`（本模块从不读 wiki 段）。
 *   3) **溯源字段**：合并后的每条 entry 追加 `bookId` / `bookName`（来自文件顶层 book，缺省退回文件名），
 *      `get` 的 revision 取来源文件顶层 `revision`（缺省 1）——条目自己不带版本号，版本属于文件。
 *
 * 失败载荷走内核统一的 `{ ok:false, code|error }` 形状（fail()），成功载荷是扁平对象
 * `{ ok:true, entries, total, warnings }`，与 S0 冻结的四通道契约一致（不再套一层 value）。
 */

export const FACT_DIR_NAME = '拆解'
const DEFAULT_REVISION = 1
const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200
const SNIPPET_RADIUS = 40

function str(value) {
  return String(value ?? '')
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

/** 空串／空白视为「没给」，过滤与分页只认真正给了的值。 */
function present(value) {
  if (value === undefined || value === null) return false
  return str(value).trim() !== ''
}

function normalizeOffset(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) return null
  return number
}

/** 文件顶层 book 是对象时取 id/title；拿不到就退回文件名（不带 .json）。 */
function bookTraceFor(fileName, document) {
  const book = isPlainObject(document?.book) ? document.book : {}
  const fallback = basename(fileName, '.json')
  const id = present(book.id) ? str(book.id).trim() : fallback
  const name = present(book.title) ? str(book.title).trim() : fallback
  // sourceFile 只给文件名（不是绝对路径）：适配器把它写进 provenance.source.file 供溯源显示。
  return { bookId: id, bookName: name, sourceFile: fileName }
}

function revisionOf(document) {
  const revision = Number(document?.revision)
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : DEFAULT_REVISION
}

/** 一条 entry 的别名键（v3 叫 aliases；兼容旧档里的 keys）。只用于搜索打分。 */
function keysOf(entry) {
  const list = []
  for (const value of [entry?.aliases, entry?.keys]) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      const text = str(item).trim()
      if (text) list.push(text)
    }
  }
  return [...new Set(list)]
}

/**
 * 摘要口径：v3 条目没有统一 summary 字段——worldview 有 definition，剧情层有 notes，
 * 人物层有 identity.traits 之类。搜索与看板投影都走这一处，不在两个地方各猜一套。
 */
function summaryOf(entry) {
  for (const value of [entry?.summary, entry?.definition, entry?.notes]) {
    const text = str(value).trim()
    if (text) return text
  }
  return ''
}

/**
 * 条目内容（看板阅读列用）：优先 definition，其次 events 的拼接，再次 notes。
 * 这是「只读展示」的派生，不写回任何文件；原文不在这里改写（events 的 content 原样按序拼）。
 */
function contentOf(entry) {
  const definition = str(entry?.definition).trim()
  if (definition) return definition
  const events = Array.isArray(entry?.events) ? entry.events : []
  const joined = events
    .map((event) => str(event?.content).trim())
    .filter(Boolean)
    .join('\n\n')
  if (joined) return joined
  return str(entry?.notes).trim()
}

function charsOf(entry) {
  const metrics = entry?.fingerprint?.metrics
  const chars = Number(metrics?.chars)
  if (Number.isSafeInteger(chars) && chars >= 0) return chars
  return contentOf(entry).length
}

function sourceRevisionOf(entry) {
  const revision = Number(entry?.revision)
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : DEFAULT_REVISION
}

function matchesFilters(entry, { layer, slot, status }) {
  if (present(layer) && str(entry?.layer) !== str(layer).trim()) return false
  if (present(slot) && str(entry?.slot) !== str(slot).trim()) return false
  if (present(status) && str(entry?.status) !== str(status).trim()) return false
  return true
}

/** 命中窗口：命中的那一段前后各 SNIPPET_RADIUS 字；两端截断处补省略号。 */
function snippetAround(text, needle) {
  const body = str(text)
  const target = str(needle)
  if (!body || !target) return ''
  const index = body.toLowerCase().indexOf(target.toLowerCase())
  if (index < 0) return ''
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(body.length, index + target.length + SNIPPET_RADIUS)
  const excerpt = body.slice(start, end).replace(/\s+/gu, ' ').trim()
  return `${start > 0 ? '…' : ''}${excerpt}${end < body.length ? '…' : ''}`
}

function scoreAndSnippet(entry, q) {
  const needle = str(q).trim().toLowerCase()
  if (!needle) return null
  const name = str(entry?.name)
  const summary = summaryOf(entry)
  const keys = keysOf(entry)
  let score = 0
  let snippet = ''
  if (name.toLowerCase().includes(needle)) {
    score += 3
    snippet = snippet || snippetAround(name, q)
  }
  for (const key of keys) {
    if (!key.toLowerCase().includes(needle)) continue
    score += 2
    // keys 只给「命中」这一档分：多条别名同时命中按一条算，避免把条目顶到 name 命中之上。
    snippet = snippet || snippetAround(key, q)
    break
  }
  if (summary.toLowerCase().includes(needle)) {
    score += 1
    snippet = snippet || snippetAround(summary, q)
  }
  if (!score) return null
  return { score, snippet: snippet || snippetAround(name, q) }
}

/**
 * 读一个拆解目录：返回 { entries, warnings }；目录不存在不是错误（普通项目没有 拆解/）。
 * 每个 entry 追加 `bookId` / `bookName` / `revision`（文件级版本，展示用；get 的 revision 同源）。
 */
function readFactDir(root) {
  const dir = join(root, FACT_DIR_NAME)
  const warnings = []
  if (!existsSync(dir)) return { entries: [], warnings }
  let names = []
  try {
    names = readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.json')).sort()
  } catch (error) {
    warnings.push({ code: 'FACT_DIR_UNREADABLE', file: FACT_DIR_NAME, message: `拆解目录读不了：${String(error?.message || error)}` })
    return { entries: [], warnings }
  }

  const entries = []
  for (const name of names) {
    const file = `${FACT_DIR_NAME}/${name}`
    let document
    try {
      const path = join(dir, name)
      if (!statSync(path).isFile()) continue
      document = JSON.parse(readFileSync(path, 'utf-8'))
    } catch (error) {
      warnings.push({ code: 'FACT_FILE_UNREADABLE', file, message: `拆解文件不是有效 JSON，整份跳过：${String(error?.message || error)}` })
      continue
    }
    if (!isPlainObject(document) || !Array.isArray(document.entries)) {
      // 拆解汇总／索引这类旁路 JSON 也落在这个目录：没有 entries[] 是合法旁路文件，静默跳过；
      // 只有「自称 entries 却不是数组」才是形状坏了，记一条警告。
      if (isPlainObject(document) && document.entries !== undefined) {
        warnings.push({ code: 'FACT_ENTRIES_NOT_ARRAY', file, message: '拆解文件的 entries 不是数组，整份跳过' })
      }
      continue
    }
    const trace = bookTraceFor(name, document)
    const revision = revisionOf(document)
    for (const entry of document.entries) {
      if (!isPlainObject(entry)) {
        warnings.push({ code: 'FACT_ENTRY_NOT_OBJECT', file, message: 'entries 里有一条不是对象，已跳过' })
        continue
      }
      entries.push({ ...entry, ...trace, revision })
    }
  }
  return { entries, warnings }
}

/**
 * @param {{ root: string }} options
 */
export function createFactFileStore({ root } = {}) {
  const projectRoot = str(root).trim()

  function readAll() {
    if (!projectRoot) return null
    try {
      return readFactDir(projectRoot)
    } catch (error) {
      return { entries: [], warnings: [{ code: 'FACT_ROOT_UNREADABLE', file: '', message: `项目根读不了：${String(error?.message || error)}` }] }
    }
  }

  return {
    root: projectRoot,

    /** 合并清单：过滤在分页前，分页在合并后；total＝过滤后的条数（不是文件行数）。 */
    list({ layer, slot, status, offset, limit } = {}) {
      const read = readAll()
      if (!read) return fail('INVALID_INPUT', '事实清单需要一个项目根（root）：这条通道不接受隐式当前项目')
      const filtered = read.entries.filter((entry) => matchesFilters(entry, { layer, slot, status }))
      const start = normalizeOffset(offset)
      const size = normalizeLimit(limit)
      const page = size === null ? filtered.slice(start) : filtered.slice(start, start + size)
      return { ok: true, entries: page, total: filtered.length, warnings: read.warnings }
    },

    /** 按 id 取一条；revision 是来源文件的顶层版本，不是条目字段。 */
    get({ id } = {}) {
      const read = readAll()
      if (!read) return fail('INVALID_INPUT', '事实条目读取需要一个项目根（root）：这条通道不接受隐式当前项目')
      const wanted = str(id).trim()
      if (!wanted) return fail('INVALID_INPUT', '请带上要读取的条目 id')
      const entry = read.entries.find((item) => str(item.id) === wanted)
      if (!entry) {
        return fail('FACT_NOT_FOUND', `拆解数据里没有 id=${wanted} 的条目`, { id: wanted, root: projectRoot })
      }
      return { ok: true, entry, revision: sourceRevisionOf(entry) }
    },

    /**
     * S1 只校验、不落盘：校验过验才回 WRITE_PROTOCOL_NOT_STARTED；
     * 校验不过照旧给 INVALID_ENTRY＋逐条 errors，作者能看出是哪一栏不对。
     */
    save({ entry } = {}) {
      if (!isPlainObject(entry)) return fail('INVALID_INPUT', '要保存的条目必须是对象')
      const checked = validateFactEntry(entry)
      if (!checked.ok) {
        return fail('INVALID_ENTRY', '条目信封校验没过，未进入写协议', { errors: checked.errors, warnings: checked.warnings })
      }
      return fail(
        'WRITE_PROTOCOL_NOT_STARTED',
        '写协议未启动（S1 只读）：条目校验通过，但 factFileStore 现在不写任何文件——真落盘归 S2 的 writeFactFile',
        { id: str(entry.id), schema: str(entry.schema) }
      )
    },

    /** 删除同样只到「参数与存在性」这一层：不删、不写、不碰索引。 */
    remove({ id } = {}) {
      const wanted = str(id).trim()
      if (!wanted) return fail('INVALID_INPUT', '请带上要删除的条目 id')
      return fail(
        'WRITE_PROTOCOL_NOT_STARTED',
        '写协议未启动（S1 只读）：删除请求已收到，但 factFileStore 现在不写任何文件——真落盘归 S2 的 writeFactFile',
        { id: wanted }
      )
    },

    /**
     * 子串搜索（name 3 分 / keys 2 分 / summary 1 分），snippet 取首命中处前后 40 字。
     * 打分与裁剪都在 store 内——通道只透传，不在 IPC 层留第二套口径。
     */
    search({ q, layer, limit } = {}) {
      const read = readAll()
      if (!read) return fail('INVALID_INPUT', '事实检索需要一个项目根（root）：这条通道不接受隐式当前项目')
      const needle = str(q).trim()
      if (!needle) return fail('INVALID_INPUT', '检索词不能为空（q）')
      const wantedLimit = normalizeLimit(limit) ?? DEFAULT_SEARCH_LIMIT
      const hits = []
      for (const entry of read.entries) {
        if (present(layer) && str(entry?.layer) !== str(layer).trim()) continue
        const scored = scoreAndSnippet(entry, needle)
        if (!scored) continue
        hits.push({
          id: str(entry.id),
          name: str(entry.name),
          score: scored.score,
          snippet: scored.snippet,
          layer: str(entry.layer),
          bookId: str(entry.bookId),
          bookName: str(entry.bookName)
        })
      }
      hits.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'zh-Hans-CN'))
      return { ok: true, hits: hits.slice(0, Math.min(wantedLimit, MAX_SEARCH_LIMIT)), warnings: read.warnings }
    }
  }
}

/** 导出给前端适配器复用：只读投影需要的派生口径（不在两个模块各写一套）。 */
export const factEntryDerivations = Object.freeze({
  summaryOf,
  contentOf,
  charsOf,
  keysOf,
  bookTraceFor,
  revisionOf
})
