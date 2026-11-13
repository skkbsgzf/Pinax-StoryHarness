import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { NEXT_ERROR_CODES, fail } from './errors.mjs'
import { validateFactEntry } from '../fact/domain/pediaSchema.js'

/**
 * 拆解文件仓储（S1 只读 ＋ S2 写协议 · WO-S1-01 / WO-S2-01/03）。
 *
 * 真源：`<root>/拆解/<id>.json`，顶层 book/source/entries/index/quality…；`entries[]` 是 fact.data/v3 条目。
 * 本模块两件事：
 *   1) **读**：多文件合并、按 layer/slot/status 过滤、分页、按 id 取一条（S1）。
 *   2) **写**：`writeFactFile()` 是唯一写入口（S2）——atomic tmp＋rename、顶层 revision 自增、
 *      operationId 旁路日志（幂等）、同进程按文件路径排队。`store.save/remove` 都只转调它。
 *
 * 三条硬口径：
 *   1) **坏档不整体失败**（作者偏好）：单个文件 JSON.parse 失败／顶层不是对象／entries 不是数组，
 *      只跳过这个文件并往 warnings[] 记一条，其余文件照常合并。**写**则相反：真源档坏了拒绝覆盖。
 *   2) **读不写**：list/get/search 不触发任何镜像／索引写，也不吐 `wiki`（wiki 是派生，见下）。
 *   3) **溯源字段**：合并后的每条 entry 追加 `bookId` / `bookName`（来自文件顶层 book，缺省退回文件名），
 *      `get` 的 revision 取来源文件顶层 `revision`（缺省 1）——条目自己不带版本号，版本属于文件。
 *
 * wiki 分离（S2 · WO-S2-03）：写主 JSON 时始终剥离顶层 `wiki`，另写兄弟 `<id>.wiki.json`
 * （`{ derivedFrom:{ factRevision, schema }, ...wiki }`）。读侧两代兼容走 `readFactWiki()`：
 * 优先兄弟文件，没有才回落旧信封里的 `wiki`——存量文件照常可读，迁移器另开工单。
 *
 * 失败载荷走内核统一的 `{ ok:false, error:{ code, message, details } }` 形状；写协议的三枚码
 * （OPERATION_ID_REQUIRED／VALIDATION_FAILED／REVISION_MISMATCH）沿用 FactStore 端口
 * （next/fact/ports/pediaStore.js 的 FACT_STORE_WRITE_CODES）——S0 契约钉死，不另造 PINAX_ 码。
 * 成功载荷是扁平对象（不套 value），与 S0 冻结的四通道契约一致。
 */

export const FACT_DIR_NAME = '拆解'
const DEFAULT_REVISION = 1
const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200
const SNIPPET_RADIUS = 40
export const OPERATIONS_LOG_NAME = '.operations.jsonl'
export const WIKI_DERIVED_SCHEMA = 'pinax-wiki-derived@1'

/** 写协议失败码（FactStore 端口同一套；S0 契约 §三）。 */
export const FACT_WRITE_CODES = Object.freeze({
  OPERATION_ID_REQUIRED: 'OPERATION_ID_REQUIRED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  REVISION_MISMATCH: 'REVISION_MISMATCH',
  NOT_FOUND: 'NOT_FOUND'
})

/** 写失败：内核码表里的走 NEXT_ERROR_CODES，端口码原样透传；顶层 code 与 error.code 同值。 */
function writeFail(code, message, details) {
  const resolved = NEXT_ERROR_CODES[code] ?? code
  const error = { code: resolved, message }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, code: resolved, error }
}

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
    // `.wiki.json` 是 S2 起的兄弟派生文件（可删可重建）：入口形状与主档相似但没有 entries，
    // 明确排除而不是靠「没有 entries 就跳过」——派生档里万一出现 entries 字段也不该混进真源清单。
    names = readdirSync(dir)
      .filter((name) => {
        const lower = name.toLowerCase()
        return lower.endsWith('.json') && !lower.endsWith('.wiki.json')
      })
      .sort()
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

/* ---------- S2 写协议 ---------- */

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function nowIso() {
  return new Date().toISOString()
}

/**
 * 写队列：同进程内按目标文件绝对路径排队（Promise 串行闸）。
 * 跨进程不做文件锁——靠 rename 的原子替换＋写前重读 revision 复核：两个写者都能写文件，
 * 但后进队列／后通过复核的那个看见新 revision，拿 REVISION_MISMATCH，不丢数据。
 */
const writeQueues = new Map()

function serializedByPath(key, task) {
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const run = previous.then(task)
  const tail = run.then(() => {}, () => {})
  writeQueues.set(key, tail)
  tail.then(() => {
    if (writeQueues.get(key) === tail) writeQueues.delete(key)
  })
  return run
}

/** 原子替换：先写 `.tmp` 再 rename（Node 的 rename 在 Windows 上即 os.replace 语义，同名覆盖不撕裂）。 */
async function writeJsonAtomic(path, document) {
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(document, null, 2)}\n`, 'utf-8')
  await rename(tmp, path)
}

async function readOperationRecord(logPath, operationId) {
  let text
  try {
    text = await readFile(logPath, 'utf-8')
  } catch {
    return null
  }
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let record
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue // 旁路日志坏行不能拦住写
    }
    if (record?.operationId === operationId && record?.outcome === 'applied') return record
  }
  return null
}

async function appendOperation(logPath, record) {
  await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf-8')
}

/** 条目 → 该进哪个 `拆解/<id>.json`：显式 bookId/id 优先，其次条目溯源里的 book_id（read 投影的 bookId 也认）。 */
function fileIdFor({ bookId, id, entry } = {}) {
  return str(bookId).trim()
    || str(id).trim()
    || str(entry?.bookId).trim()
    || str(entry?.provenance?.book_id).trim()
    || str(entry?.provenance?.book).trim()
}

/** 文件 id 就是文件名：路径分隔符与 dot 段一律拒，不把写入带出 `拆解/`。 */
function safeFileId(value) {
  const id = str(value).trim()
  if (!id) return ''
  if (id === '.' || id === '..') return ''
  if (id.includes('/') || id.includes('\\')) return ''
  return id
}

function normalizeExpectedRevision(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) return { ok: false, value: null }
  return { ok: true, value: number }
}

/**
 * S2 · WO-S2-01：拆解文件唯一写入口。
 *
 * `entry`   —— 按 `entry.id` 在 `entries[]` 里定位：命中就替换，没有就追加（upsert）。
 * `patch`   —— 顶层字段浅合并（book/source/index/quality…）；四个受管键特殊处理：
 *              · `entries`（数组）＝整份替换（抽取管线重跑用；按 id 逐条 upsert 会产生 N 版 revision）；
 *              · `removeEntryIds`（字符串数组）＝按 id 删除条目（一条都没删到 → NOT_FOUND，不假装成功）；
 *              · `wiki` ＝搬进兄弟 `<id>.wiki.json`（主 JSON 永远不落 wiki）；
 *              · `revision` / `updatedAt` ＝受管字段，传了也忽略（版本只能由本函数自增）。
 *
 * 写前重读磁盘当前档：`expectedRevision` 与磁盘 revision 不符 → REVISION_MISMATCH（不覆盖不合并）。
 * 成功后顶层 `revision + 1`、`updatedAt` 刷新。同一 `operationId` 重放不再写盘，回 `{ ok, duplicate:true }`。
 */
export async function writeFactFile({ root, bookId, id, entry, patch, operationId, expectedRevision } = {}) {
  const projectRoot = str(root).trim()
  if (!projectRoot) return writeFail('INVALID_INPUT', '拆解文件写入需要一个项目根（root）：这条通道不接受隐式当前项目')

  const opId = str(operationId).trim()
  if (!opId) {
    return writeFail('OPERATION_ID_REQUIRED', '写入必须带 operationId（幂等键）：同一 operationId 重放不会重复落盘', {
      hint: '由调用方生成（例如 `${来源}-${bookId}-${randomUUID()}`），宿主不复用、不代填'
    })
  }

  if (entry !== undefined && entry !== null && !isPlainObject(entry)) {
    return writeFail('VALIDATION_FAILED', '要写入的条目必须是对象')
  }
  if (patch !== undefined && patch !== null && !isPlainObject(patch)) {
    return writeFail('INVALID_INPUT', 'patch 必须是对象（顶层字段浅合并）')
  }
  if (!isPlainObject(entry) && !isPlainObject(patch)) {
    return writeFail('INVALID_INPUT', 'writeFactFile 至少需要 entry（单条 upsert）或 patch（顶层字段／entries／删除清单）之一')
  }

  const targetId = safeFileId(fileIdFor({ bookId, id, entry }))
  if (!targetId) {
    return writeFail('INVALID_INPUT', '写不出该进哪个拆解文件：需要 bookId（或 id／条目溯源 book_id），且不能含路径分隔符', {
      bookId: str(bookId), id: str(id)
    })
  }

  let checked = null
  if (isPlainObject(entry)) {
    checked = validateFactEntry(entry)
    if (!checked.ok) {
      return writeFail('VALIDATION_FAILED', '条目信封校验没过，未进入写协议', { errors: checked.errors, warnings: checked.warnings })
    }
    if (!str(entry.id).trim()) {
      return writeFail('VALIDATION_FAILED', '条目缺少 id：写协议按 id 定位替换／追加', { errors: [{ field: 'id', message: 'id 不能为空' }] })
    }
  }

  const expected = normalizeExpectedRevision(expectedRevision)
  if (!expected.ok) {
    return writeFail('INVALID_INPUT', 'expectedRevision 必须是非负整数（新建给 0 或缺省）', { expectedRevision: str(expectedRevision) })
  }

  const dir = join(projectRoot, FACT_DIR_NAME)
  const target = join(dir, `${targetId}.json`)
  const wikiTarget = join(dir, `${targetId}.wiki.json`)
  const logPath = join(dir, OPERATIONS_LOG_NAME)
  const file = `${FACT_DIR_NAME}/${targetId}.json`

  return serializedByPath(resolve(target), async () => {
    try {
      await mkdir(dir, { recursive: true })

      const duplicate = await readOperationRecord(logPath, opId)
      if (duplicate) {
        return {
          ok: true,
          duplicate: true,
          operationId: opId,
          bookId: targetId,
          revision: Number.isSafeInteger(duplicate.revision) ? duplicate.revision : null,
          file
        }
      }

      let raw = null
      try {
        raw = await readFile(target, 'utf-8')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      let document = null
      if (raw !== null) {
        try {
          document = JSON.parse(raw)
        } catch (error) {
          // 真源坏档拒绝覆盖：静默重写会把作者的原始产物抹掉，比报错更糟。
          return writeFail('IO_FAILED', `拆解文件不是有效 JSON，拒绝覆盖（先修好再写）：${String(error?.message || error)}`, { file })
        }
        if (!isPlainObject(document)) {
          return writeFail('IO_FAILED', '拆解文件顶层不是对象，拒绝覆盖', { file })
        }
        if (document.entries !== undefined && !Array.isArray(document.entries)) {
          return writeFail('IO_FAILED', '拆解文件的 entries 不是数组，拒绝覆盖', { file })
        }
      }

      const baseRevision = document ? revisionOf(document) : 0
      if (expected.value !== null && expected.value !== baseRevision) {
        await appendOperation(logPath, { at: nowIso(), operationId: opId, bookId: targetId, revision: baseRevision, outcome: 'revision_mismatch' })
        return writeFail(
          'REVISION_MISMATCH',
          `revision 不符：磁盘是第 ${baseRevision} 版，本次期望第 ${expected.value} 版——不覆盖不合并，请重读后再写`,
          { currentRevision: baseRevision, expectedRevision: expected.value, file }
        )
      }

      const nextDocument = document ? { ...document } : {
        book: {
          id: str(entry?.provenance?.book_id).trim() || targetId,
          title: str(entry?.provenance?.book).trim() || targetId
        },
        entries: []
      }
      let nextEntries = document ? [...nextDocument.entries] : []
      const removeIds = new Set()

      if (isPlainObject(patch)) {
        for (const [key, value] of Object.entries(patch)) {
          if (key === 'revision' || key === 'updatedAt' || key === 'wiki') continue
          if (key === 'entries') {
            if (!Array.isArray(value)) return writeFail('INVALID_INPUT', 'patch.entries 必须是数组（整份替换）')
            if (value.some((item) => !isPlainObject(item))) return writeFail('INVALID_INPUT', 'patch.entries 里每一条都必须是对象')
            nextEntries = jsonClone(value)
            continue
          }
          if (key === 'removeEntryIds') {
            if (!Array.isArray(value)) return writeFail('INVALID_INPUT', 'patch.removeEntryIds 必须是 id 数组')
            for (const item of value) {
              const wanted = str(item).trim()
              if (wanted) removeIds.add(wanted)
            }
            continue
          }
          nextDocument[key] = value
        }
      }

      if (removeIds.size) {
        let removed = 0
        nextEntries = nextEntries.filter((item) => {
          if (!removeIds.has(str(item?.id))) return true
          removed += 1
          return false
        })
        if (!removed) {
          return writeFail('NOT_FOUND', `拆解数据里没有 id=${[...removeIds].join(',')} 的条目`, { ids: [...removeIds], file })
        }
      }

      if (isPlainObject(entry)) {
        const entryId = str(entry.id)
        const at = nextEntries.findIndex((item) => str(item?.id) === entryId)
        if (at >= 0) nextEntries[at] = jsonClone(entry)
        else nextEntries.push(jsonClone(entry))
      }

      // wiki 来源：patch 里给的优先；没给就沿用旧信封里的（存量文件重写时顺手搬去兄弟文件＝写时迁移）。
      let wiki = null
      let hasWiki = false
      if (isPlainObject(patch) && Object.prototype.hasOwnProperty.call(patch, 'wiki')) {
        hasWiki = true
        wiki = patch.wiki
      } else if (document && Object.prototype.hasOwnProperty.call(document, 'wiki')) {
        hasWiki = true
        wiki = document.wiki
      }
      delete nextDocument.wiki

      nextDocument.entries = nextEntries
      nextDocument.revision = baseRevision + 1
      nextDocument.updatedAt = nowIso()

      // wiki 先落、主档后落：主档是唯一真源，wiki 可删可重建；中途崩溃最多留下
      // 「兄弟文件比主档新一版」，重建即可，不会反向污染真源。
      if (hasWiki) {
        await writeJsonAtomic(wikiTarget, {
          derivedFrom: { factRevision: baseRevision, schema: WIKI_DERIVED_SCHEMA },
          ...(isPlainObject(wiki) ? wiki : {})
        })
      }
      await writeJsonAtomic(target, nextDocument)
      await appendOperation(logPath, {
        at: nowIso(),
        operationId: opId,
        bookId: targetId,
        revision: nextDocument.revision,
        outcome: 'applied'
      })

      const result = {
        ok: true,
        duplicate: false,
        operationId: opId,
        bookId: targetId,
        revision: nextDocument.revision,
        file
      }
      if (checked?.warnings?.length) result.warnings = checked.warnings
      if (isPlainObject(entry)) result.entry = jsonClone(entry)
      return result
    } catch (error) {
      return writeFail('IO_FAILED', `拆解文件写入失败：${String(error?.message || error)}`, { file, operationId: opId })
    }
  })
}

/**
 * S2 · WO-S2-03 读侧两代兼容：优先兄弟 `<id>.wiki.json`（S2 起的派生文件），
 * 没有才回落旧信封里的 `document.wiki`。派生档坏了按「没有」处理，不拦主档读。
 * 返回 `{ wiki, derivedFrom, source }`——source 只用于诊断（sibling／envelope／none）。
 */
export function readFactWiki({ root, id, document } = {}) {
  const projectRoot = str(root).trim()
  const fileId = safeFileId(id)
  if (projectRoot && fileId) {
    const sibling = join(projectRoot, FACT_DIR_NAME, `${fileId}.wiki.json`)
    try {
      const derived = JSON.parse(readFileSync(sibling, 'utf-8'))
      if (isPlainObject(derived)) {
        const { derivedFrom, ...wiki } = derived
        return {
          wiki,
          derivedFrom: isPlainObject(derivedFrom) ? derivedFrom : null,
          source: 'sibling'
        }
      }
    } catch {
      // 派生档缺失或坏：回落信封（存量文件照常工作）。
    }
  }
  const envelope = isPlainObject(document?.wiki) ? document.wiki : null
  return { wiki: envelope, derivedFrom: null, source: envelope ? 'envelope' : 'none' }
}

/**
 * 仓储实例：读四方法（list/get/search）＋写两方法（save/remove，转调 writeFactFile）。
 * 写失败载荷见 writeFail()：`{ ok:false, code, error }`，写协议三枚码按 FactStore 端口原样透传。
 *
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
     * S2 起真落盘：单条 upsert 走 writeFactFile（按 entry.id 定位替换／追加）。
     * `expectedRevision` 是**文件级**版本（fact:get 回的 revision）；不符即 REVISION_MISMATCH。
     * `operationId` 必填（幂等键）——重放同一 operationId 不再写盘，回 duplicate=true。
     */
    async save({ entry, bookId, operationId, expectedRevision } = {}) {
      if (!projectRoot) return fail('INVALID_INPUT', '事实条目保存需要一个项目根（root）：这条通道不接受隐式当前项目')
      return writeFactFile({ root: projectRoot, bookId, entry, operationId, expectedRevision })
    },

    /** 按 id 删除条目（写协议开闸后的真删除）：同样走 writeFactFile，revision 自增、operationId 幂等。 */
    async remove({ id, bookId, operationId, expectedRevision } = {}) {
      if (!projectRoot) return fail('INVALID_INPUT', '事实条目删除需要一个项目根（root）：这条通道不接受隐式当前项目')
      const wanted = str(id).trim()
      if (!wanted) return fail('INVALID_INPUT', '请带上要删除的条目 id')
      return writeFactFile({ root: projectRoot, bookId, patch: { removeEntryIds: [wanted] }, operationId, expectedRevision })
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
