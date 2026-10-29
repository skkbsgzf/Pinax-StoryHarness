// rename 起别名：本模块有一个同名的会话改名方法，函数声明提升会把它遮住，别让磁盘重命名悄悄走错函数。
import { readdir, readFile, appendFile, mkdir, writeFile, rename as renameFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fail, ok } from './kernel/errors.mjs'
import {
  DEFAULT_SESSION_TITLE,
  MAX_SESSION_EVENTS,
  MAX_SESSION_MESSAGES,
  MAX_SESSIONS,
  WRITE_MODES,
  sanitizeSessionEvent,
  sanitizeSessionMessage
} from './shell/agentSessions.mjs'

/**
 * 会话落盘（M2.5-B · 任务三）：`.pinax/sessions/<id>.jsonl`，一行一个条目。
 *
 * 为什么不用一个 sessions.json：
 *   1) 追加写不会因为一次崩溃把整份会话写坏——坏行只丢那一行，其余照读；
 *   2) 将来做子代理时，一个子会话就是一份文件，父子关系用 `parent` 字段，不用换存储；
 *   3) 删除留墓碑（tombstone），正文不进 git（`.pinax/` 的既有口径）。
 *
 * 行类型（type）：
 *   session   会话元数据（标题／时间／写模式／parent）。后写的覆盖先写的，消息不因元数据覆盖而丢。
 *   message   一条消息（形状与 agentSessions.sanitizeSessionMessage 同源，不另造 schema）。
 *   event     会话级事实（目前只有模式切换），形状同 sanitizeSessionEvent。
 *   proposal  提案的登记（只记 id/kind/at，正文仍在 .pinax/proposals/）。
 *   tombstone 删除标记：列表不再显示；子会话不跟着死——父删了，子会话 re-parent 成根会话。
 *
 * 边界（诚实）：
 *   - 这里只做磁盘存取，不管渲染层的忙态与订阅；状态机的唯一真相仍在 agentSessions。
 *   - 读取时坏行逐条跳过并记账（warnings／badLines），不因为一行坏字让整份会话打不开。
 *   - 没有文件锁：同一进程内按文件串行排队；跨进程（两个窗口同时开同一项目）不在本批范围内。
 */

export const SESSIONS_DIR = '.pinax/sessions'
export const SESSION_FILE_SUFFIX = '.jsonl'
export const SESSION_LINE_TYPES = Object.freeze(['session', 'message', 'event', 'proposal', 'tombstone'])
export const MAX_SESSION_PROPOSALS = 100

/** 会话 id 直接进文件名：只认安全字符，挡掉 `../` 这类路径串。 */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u

export function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

export function sessionFilePath(root, sessionId) {
  if (!isSessionId(sessionId)) return null
  return join(String(root), SESSIONS_DIR, `${sessionId}${SESSION_FILE_SUFFIX}`)
}

function cleanText(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

function cleanTs(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback
}

function normalizeMeta(raw, fallbackId) {
  const id = isSessionId(raw?.id) ? raw.id : fallbackId
  if (!isSessionId(id)) return null
  const createdAt = cleanTs(raw?.createdAt, 0)
  const updatedAt = cleanTs(raw?.updatedAt, createdAt)
  const title = cleanText(raw?.title, 120).replace(/\s+/gu, ' ').trim() || DEFAULT_SESSION_TITLE
  const renamed = raw?.renamed === true
  return {
    id,
    title,
    createdAt,
    updatedAt,
    renamed,
    // 名字不是缺省名又没被手动改过 → 只可能是自动标题（与 agentSessions.normalizeSession 同一条推导）。
    autoTitled: raw?.autoTitled === true || (!renamed && title !== DEFAULT_SESSION_TITLE),
    writeMode: WRITE_MODES.includes(raw?.writeMode) ? raw.writeMode : 'review',
    parent: isSessionId(raw?.parent) ? raw.parent : null
  }
}

/** 元数据 → 一行（落盘形状）。 */
export function sessionLine(meta, ts) {
  return {
    type: 'session',
    v: 1,
    id: meta.id,
    title: meta.title,
    createdAt: cleanTs(meta.createdAt, ts),
    updatedAt: cleanTs(meta.updatedAt, ts),
    renamed: meta.renamed === true,
    autoTitled: meta.autoTitled === true,
    writeMode: WRITE_MODES.includes(meta.writeMode) ? meta.writeMode : 'review',
    parent: isSessionId(meta.parent) ? meta.parent : null,
    ts: cleanTs(ts, 0)
  }
}

/** 把一份文件的原始行折成会话；坏行逐条记进 bad。 */
export function foldSessionLines(rawLines, { file = '', fallbackId = '' } = {}) {
  let meta = null
  const messages = []
  const events = []
  const proposals = []
  let tombstone = null
  const warnings = []
  let badLines = 0
  let lastTs = 0

  rawLines.forEach((line, index) => {
    const text = typeof line === 'string' ? line.trim() : ''
    if (!text) return
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      badLines += 1
      if (warnings.length < 5) warnings.push({ file, line: index + 1, reason: 'BAD_JSON' })
      return
    }
    const ts = cleanTs(parsed?.ts, 0)
    if (ts > lastTs) lastTs = ts
    const type = parsed?.type
    if (type === 'session') {
      const normalized = normalizeMeta(parsed, fallbackId)
      if (!normalized) {
        badLines += 1
        if (warnings.length < 5) warnings.push({ file, line: index + 1, reason: 'BAD_SESSION' })
        return
      }
      meta = normalized
      return
    }
    if (type === 'message') {
      const message = sanitizeSessionMessage(parsed)
      if (!message) {
        badLines += 1
        if (warnings.length < 5) warnings.push({ file, line: index + 1, reason: 'BAD_MESSAGE' })
        return
      }
      messages.push(message)
      return
    }
    if (type === 'event') {
      const event = sanitizeSessionEvent(parsed)
      if (!event) {
        badLines += 1
        if (warnings.length < 5) warnings.push({ file, line: index + 1, reason: 'BAD_EVENT' })
        return
      }
      events.push(event)
      return
    }
    if (type === 'proposal') {
      if (!parsed?.id || typeof parsed.id !== 'string') {
        badLines += 1
        if (warnings.length < 5) warnings.push({ file, line: index + 1, reason: 'BAD_PROPOSAL' })
        return
      }
      proposals.push({
        id: cleanText(parsed.id, 120),
        kind: cleanText(parsed.kind, 40),
        at: cleanText(parsed.at, 40)
      })
      return
    }
    if (type === 'tombstone') {
      tombstone = { at: cleanText(parsed.at, 40), ts }
      return
    }
    badLines += 1
    if (warnings.length < 5) warnings.push({ file, line: index + 1, reason: 'UNKNOWN_TYPE' })
  })

  if (!meta) {
    if (!isSessionId(fallbackId)) {
      return { session: null, badLines, warnings, tombstone }
    }
    // 文件在、元数据行没了（手工删了一行/写到一半）：用文件名兜一个最小会话，消息照读。
    meta = normalizeMeta({ id: fallbackId, createdAt: lastTs, updatedAt: lastTs }, fallbackId)
    warnings.push({ file, line: 0, reason: 'META_SYNTHESIZED' })
  }

  const session = {
    ...meta,
    updatedAt: Math.max(meta.updatedAt, lastTs),
    deletedAt: tombstone ? tombstone.ts || null : null,
    messages: messages.slice(-MAX_SESSION_MESSAGES),
    events: events.slice(-MAX_SESSION_EVENTS),
    proposals: proposals.slice(-MAX_SESSION_PROPOSALS)
  }
  return { session, badLines, warnings, tombstone }
}

function summaryOf(session) {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    writeMode: session.writeMode,
    parent: session.parent
  }
}

/**
 * 磁盘会话存储。
 * root 是项目根（`.pinax/sessions/` 挂在它下面）；`fs` 可注入，测试用临时目录以外的替身时不动真盘。
 */
export function createFileSessionStore({ root, fs: fsImpl = null, now = Date.now } = {}) {
  const projectRoot = String(root ?? '').trim()
  const io = {
    readdir: fsImpl?.readdir ?? readdir,
    readFile: fsImpl?.readFile ?? readFile,
    appendFile: fsImpl?.appendFile ?? appendFile,
    mkdir: fsImpl?.mkdir ?? mkdir,
    writeFile: fsImpl?.writeFile ?? writeFile,
    rename: fsImpl?.rename ?? renameFile
  }
  const dir = projectRoot ? join(projectRoot, SESSIONS_DIR) : null
  const stamp = () => {
    const value = Number(now())
    return Number.isFinite(value) ? Math.trunc(value) : Date.now()
  }
  /** 同一份文件串行写：两次 append 的 Promise 不能各自先跑到磁盘前头。 */
  const queues = new Map()

  function withLock(sessionId, task) {
    const previous = queues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    queues.set(sessionId, next.catch(() => {}))
    return next
  }

  async function appendLine(sessionId, line) {
    const path = sessionFilePath(projectRoot, sessionId)
    if (!path) return fail('INVALID_INPUT', `会话 id 不合法：${String(sessionId)}`)
    await io.mkdir(dir, { recursive: true })
    await io.appendFile(path, `${JSON.stringify(line)}\n`, 'utf-8')
    return ok({ file: `${sessionId}${SESSION_FILE_SUFFIX}` })
  }

  async function readOne(sessionId) {
    if (!dir) return fail('INVALID_INPUT', '会话需要项目根：没有项目就没有 .pinax/sessions/')
    const path = sessionFilePath(projectRoot, sessionId)
    if (!path) return fail('INVALID_INPUT', `会话 id 不合法：${String(sessionId)}`)
    let text = ''
    try {
      text = await io.readFile(path, 'utf-8')
    } catch (error) {
      if (error?.code === 'ENOENT') return fail('INVALID_INPUT', `没有这个会话：${sessionId}`)
      return fail('IO_FAILED', `读取会话失败：${String(error?.message || error)}`)
    }
    const folded = foldSessionLines(text.split('\n'), { file: `${sessionId}${SESSION_FILE_SUFFIX}`, fallbackId: sessionId })
    if (!folded.session) return fail('IO_FAILED', `会话文件没有可读内容：${sessionId}`)
    return ok(folded.session)
  }

  async function loadAll({ includeDeleted = false } = {}) {
    if (!dir) return ok({ sessions: [], warnings: [], badLines: 0, dir: null })
    let names = []
    try {
      names = await io.readdir(dir)
    } catch (error) {
      if (error?.code === 'ENOENT') return ok({ sessions: [], warnings: [], badLines: 0, dir })
      return fail('IO_FAILED', `会话目录读不了：${String(error?.message || error)}`)
    }
    const sessions = []
    const warnings = []
    let badLines = 0
    for (const name of names.filter((item) => item.endsWith(SESSION_FILE_SUFFIX)).sort()) {
      const sessionId = name.slice(0, -SESSION_FILE_SUFFIX.length)
      let text = ''
      try {
        text = await io.readFile(join(dir, name), 'utf-8')
      } catch {
        warnings.push({ file: name, line: 0, reason: 'UNREADABLE' })
        continue
      }
      const folded = foldSessionLines(text.split('\n'), { file: name, fallbackId: sessionId })
      badLines += folded.badLines
      warnings.push(...folded.warnings)
      if (!folded.session) continue
      if (folded.session.deletedAt && !includeDeleted) continue
      sessions.push(folded.session)
    }
    sessions.sort((a, b) => (b.updatedAt - a.updatedAt) || (b.createdAt - a.createdAt))
    return ok({ sessions: sessions.slice(0, MAX_SESSIONS), warnings, badLines, dir })
  }

  async function ensureSession(meta) {
    const id = meta?.id
    if (!isSessionId(id)) return fail('INVALID_INPUT', `会话 id 不合法：${String(id)}`)
    const timestamp = stamp()
    const normalized = normalizeMeta({ ...meta, createdAt: meta.createdAt ?? timestamp, updatedAt: meta.updatedAt ?? timestamp }, id)
    if (!normalized) return fail('INVALID_INPUT', '会话元数据不完整')
    return withLock(id, async () => {
      await appendLine(id, sessionLine(normalized, timestamp))
      return ok(summaryOf({ ...normalized, messages: [], events: [], proposals: [] }))
    })
  }

  /** 元数据变了（标题/写模式/parent/updatedAt）就追加一行 session；消息行不受影响。 */
  async function updateMeta(sessionId, patch = {}) {
    const current = await readOne(sessionId)
    if (!current.ok) return current
    const merged = { ...current.value, ...patch, id: sessionId, updatedAt: patch.updatedAt ?? stamp() }
    return withLock(sessionId, async () => {
      await appendLine(sessionId, sessionLine(merged, stamp()))
      return ok(summaryOf({ ...merged, messages: current.value.messages }))
    })
  }

  async function appendMessage(sessionId, message) {
    const clean = sanitizeSessionMessage(message)
    if (!clean) return fail('INVALID_INPUT', '消息形状不合法（缺 role/text）')
    const current = await readOne(sessionId)
    if (!current.ok) return current
    const session = current.value
    const timestamp = stamp()
    if (!clean.id) clean.id = `m-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    if (!clean.at) {
      const date = new Date(timestamp)
      clean.at = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }
    const patch = { updatedAt: timestamp }
    if (!session.renamed && !session.autoTitled && clean.role === 'user' && clean.text.trim()) {
      patch.title = clean.text.replace(/\s+/gu, ' ').trim().slice(0, 24)
      patch.autoTitled = true
    }
    return withLock(sessionId, async () => {
      if (patch.title) await appendLine(sessionId, sessionLine({ ...session, ...patch }, timestamp))
      await appendLine(sessionId, { type: 'message', ...clean, ts: timestamp })
      return ok(clean)
    })
  }

  async function recordEvent(sessionId, event) {
    const current = await readOne(sessionId)
    if (!current.ok) return current
    const stamped = event && typeof event === 'object' && !event.at ? { ...event, at: formatClockOf(stamp()) } : event
    const clean = sanitizeSessionEvent(stamped)
    if (!clean) return fail('INVALID_INPUT', '会话事件形状不合法（目前只认 mode）')
    const timestamp = stamp()
    return withLock(sessionId, async () => {
      if (clean.kind === 'mode') await appendLine(sessionId, sessionLine({ ...current.value, writeMode: clean.to, updatedAt: timestamp }, timestamp))
      await appendLine(sessionId, { type: 'event', ...clean, ts: timestamp })
      return ok(clean)
    })
  }

  async function setWriteMode(sessionId, mode) {
    const current = await readOne(sessionId)
    if (!current.ok) return current
    const next = WRITE_MODES.includes(mode) ? mode : 'review'
    if (next === current.value.writeMode) return ok({ changed: false, writeMode: next })
    return withLock(sessionId, async () => {
      const timestamp = stamp()
      const event = { kind: 'mode', from: current.value.writeMode, to: next, by: 'author', at: formatClockOf(timestamp) }
      await appendLine(sessionId, sessionLine({ ...current.value, writeMode: next, updatedAt: timestamp }, timestamp))
      await appendLine(sessionId, { type: 'event', ...event, ts: timestamp })
      return ok({ changed: true, writeMode: next, event })
    })
  }

  async function rename(sessionId, title) {
    const text = cleanText(title, 120).replace(/\s+/gu, ' ').trim()
    if (!text) return fail('INVALID_INPUT', '标题不能为空')
    return updateMeta(sessionId, { title: text, renamed: true, autoTitled: false })
  }

  async function recordProposal(sessionId, proposal) {
    const id = cleanText(proposal?.id, 120)
    if (!id) return fail('INVALID_INPUT', '提案登记缺 id')
    const current = await readOne(sessionId)
    if (!current.ok) return current
    const timestamp = stamp()
    const line = { type: 'proposal', id, kind: cleanText(proposal?.kind, 40), at: cleanText(proposal?.at, 40), ts: timestamp }
    return withLock(sessionId, async () => {
      await appendLine(sessionId, line)
      return ok({ id: line.id, kind: line.kind, at: line.at })
    })
  }

  /**
   * 删除＝写墓碑，不删文件（诊断包与恢复都还要看得到它删过）。
   * 子会话不陪葬：父会话被删后，子会话的 parent 改回 null（它自己的对话还是作者的）。
   */
  async function tombstone(sessionId, { reason = '' } = {}) {
    if (!isSessionId(sessionId)) return fail('INVALID_INPUT', `会话 id 不合法：${String(sessionId)}`)
    const all = await loadAll({ includeDeleted: true })
    if (!all.ok) return all
    const self = all.value.sessions.find((session) => session.id === sessionId)
    if (!self) return fail('INVALID_INPUT', `没有这个会话：${sessionId}`)
    if (self.deletedAt) return ok({ deleted: false, alreadyDeleted: true, reparented: [] })
    const timestamp = stamp()
    const reparented = []
    await withLock(sessionId, async () => {
      await appendLine(sessionId, { type: 'tombstone', at: formatClockOf(timestamp), ts: timestamp, reason: cleanText(reason, 80) })
    })
    for (const session of all.value.sessions) {
      if (session.parent !== sessionId || session.deletedAt) continue
      await updateMeta(session.id, { parent: null, updatedAt: timestamp })
      reparented.push(session.id)
    }
    return ok({ deleted: true, alreadyDeleted: false, reparented })
  }

  /**
   * 渲染层状态机的整份回写（M2.5-B 的落盘路径）。
   *
   * 与 appendMessage 的逐条追加并存：显式调用 appendMessage 的消费方仍在用追加；
   * 渲染层的 agentSessions 是内存真源，每次变化交整份快照，这里按会话逐份原子重写
   * （tmp + rename，崩在写一半时旧文件完好）。快照里没有、磁盘上又没删过的会话＝作者删了：
   * 写墓碑（不删文件），子会话按同一条规则 re-parent。
   *
   * 内容与磁盘一致时不重写（ts 取会话自己的 updatedAt，不取此刻时钟），避免一次提问把 30 份文件全刷一遍。
   */
  let snapshotQueue = Promise.resolve()

  async function rewriteSession(raw, fallbackTs) {
    const normalized = normalizeMeta(raw, '')
    if (!normalized) return null
    const ts = cleanTs(normalized.updatedAt, fallbackTs)
    const lines = [JSON.stringify(sessionLine(normalized, ts))]
    for (const message of Array.isArray(raw.messages) ? raw.messages.slice(-MAX_SESSION_MESSAGES) : []) {
      const clean = sanitizeSessionMessage(message)
      if (clean) lines.push(JSON.stringify({ type: 'message', ...clean, ts }))
    }
    for (const event of Array.isArray(raw.events) ? raw.events.slice(-MAX_SESSION_EVENTS) : []) {
      const clean = sanitizeSessionEvent(event)
      if (clean) lines.push(JSON.stringify({ type: 'event', ...clean, ts }))
    }
    for (const proposal of Array.isArray(raw.proposals) ? raw.proposals.slice(-MAX_SESSION_PROPOSALS) : []) {
      if (!proposal?.id) continue
      lines.push(JSON.stringify({ type: 'proposal', id: cleanText(proposal.id, 120), kind: cleanText(proposal.kind, 40), at: cleanText(proposal.at, 40), ts }))
    }
    const text = `${lines.join('\n')}\n`
    const path = sessionFilePath(projectRoot, normalized.id)
    await io.mkdir(dir, { recursive: true })
    try {
      const current = await io.readFile(path, 'utf-8')
      if (current === text) return normalized.id
    } catch {
      // 文件不在（新会话）：继续写。
    }
    const tmp = `${path}.tmp`
    await io.writeFile(tmp, text, 'utf-8')
    await io.rename(tmp, path)
    return normalized.id
  }

  async function saveSnapshot(snapshot) {
    if (!dir) return fail('INVALID_INPUT', '会话落盘需要项目根')
    const task = async () => {
      const list = Array.isArray(snapshot?.sessions) ? snapshot.sessions.slice(-MAX_SESSIONS) : []
      const existing = await loadAll({ includeDeleted: true })
      if (!existing.ok) return existing
      const timestamp = stamp()
      const keep = new Set()
      for (const session of list) {
        const id = await rewriteSession(session, timestamp)
        if (id) keep.add(id)
      }
      let tombstoned = 0
      const reparented = []
      for (const session of existing.value.sessions) {
        if (keep.has(session.id) || session.deletedAt) continue
        const result = await tombstone(session.id, { reason: 'session-removed' })
        if (result.ok && result.value.deleted) {
          tombstoned += 1
          reparented.push(...result.value.reparented)
        }
      }
      return ok({ saved: keep.size, tombstoned, reparented, activeId: cleanText(snapshot?.activeId, 80) })
    }
    const run = snapshotQueue.then(task, task)
    snapshotQueue = run.catch(() => {})
    return run
  }

  /**
   * 老 localStorage 的一次性迁移：把 `{ sessions:[…], activeId }` 写成一堆 JSONL。
   * 幂等：文件已存在的会话跳过（不覆盖磁盘上的新消息）。返回 imported／skipped，调用方据此决定删不删老键。
   */
  async function importLegacy(legacy) {
    if (!dir) return fail('INVALID_INPUT', '会话迁移需要项目根')
    const list = Array.isArray(legacy?.sessions) ? legacy.sessions : []
    if (!list.length) return ok({ imported: 0, skipped: 0, warnings: [] })
    await io.mkdir(dir, { recursive: true })
    let imported = 0
    let skipped = 0
    const warnings = []
    const kept = list.slice(-MAX_SESSIONS)
    for (const raw of kept) {
      const normalized = normalizeMeta(raw, '')
      if (!normalized) {
        warnings.push({ sessionId: String(raw?.id ?? ''), reason: 'BAD_SESSION' })
        skipped += 1
        continue
      }
      const path = sessionFilePath(projectRoot, normalized.id)
      let exists = false
      try {
        await io.readFile(path, 'utf-8')
        exists = true
      } catch {
        exists = false
      }
      if (exists) {
        skipped += 1
        continue
      }
      const timestamp = cleanTs(normalized.updatedAt, stamp())
      const lines = [JSON.stringify(sessionLine(normalized, timestamp))]
      for (const message of Array.isArray(raw.messages) ? raw.messages.slice(-MAX_SESSION_MESSAGES) : []) {
        const clean = sanitizeSessionMessage(message)
        if (clean) lines.push(JSON.stringify({ type: 'message', ...clean, ts: cleanTs(message?.ts, timestamp) }))
      }
      for (const event of Array.isArray(raw.events) ? raw.events.slice(-MAX_SESSION_EVENTS) : []) {
        const clean = sanitizeSessionEvent(event)
        if (clean) lines.push(JSON.stringify({ type: 'event', ...clean, ts: timestamp }))
      }
      const tmp = `${path}.tmp`
      await io.writeFile(tmp, `${lines.join('\n')}\n`, 'utf-8')
      await io.rename(tmp, path)
      imported += 1
    }
    return ok({ imported, skipped, warnings })
  }

  return {
    root: projectRoot,
    dir,
    loadAll,
    read: readOne,
    ensureSession,
    updateMeta,
    appendMessage,
    setWriteMode,
    recordEvent,
    rename,
    recordProposal,
    tombstone,
    importLegacy,
    saveSnapshot
  }
}

function formatClockOf(timestamp) {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
