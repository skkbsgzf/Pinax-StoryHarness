/**
 * OpenStory Agent 存储（OS-4）——daemon 侧的凭据配置、会话 JSONL、待确认卡快照。
 *
 * 三块：
 *   1) agent-config.json（端点/模型/key）——key 只落本机这份文件，任何响应只给尾号掩码；
 *   2) 会话 <sha1(root)16>-<库名>/s-*.jsonl——照 DSH 口径按行追加：
 *      meta 行 / msg 行 / card 行；重命名与改卡状态＝整文件原子重写；
 *   3) 正文快照闸——卡创建时取 {exists, chars, sha256}，采纳时重读比对，
 *      不一致拒写（writeFactFile revision 门在正文文件上的轻量同款）。
 *
 * 全部用 Node 内置模块；被 daemon 与测试共同 import。
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function text(value) {
  return String(value ?? '')
}

/* ---------- 路径 ---------- */

export function defaultAgentHome(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory') : ''
}

export function defaultAgentConfigPath(env = process.env) {
  const home = defaultAgentHome(env)
  return home ? join(home, 'agent-config.json') : ''
}

export function defaultSessionsDir(env = process.env) {
  const home = defaultAgentHome(env)
  return home ? join(home, 'sessions') : ''
}

/** 会话 id 只允许 [\w-]，直接当文件名用，杜绝路径逃逸。 */
export function isValidSessionId(id) {
  return /^[\w-]{1,80}$/u.test(text(id))
}

/** 每个库一个会话目录：sha1(root) 前 16 位（Windows 分隔符与大小写归一）＋ 可读库名。 */
export function sessionDirFor(sessionsDir, root) {
  const raw = text(root).replaceAll('\\', '/')
  const key = process.platform === 'win32' ? raw.toLowerCase() : raw
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
  const name = raw.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() || 'lib'
  const safe = name.replace(/[^\w\u4e00-\u9fff-]+/gu, '_').slice(0, 24) || 'lib'
  return join(sessionsDir, `${hash}-${safe}`)
}

/* ---------- 凭据配置 ---------- */

export function maskApiKey(key) {
  const raw = text(key).trim()
  if (!raw) return ''
  if (raw.length <= 8) return '••••'
  return `••••${raw.slice(-4)}`
}

/** 配置规整：只留三个字符串字段；configured＝endpoint 非空。 */
export function normalizeAgentConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    endpoint: text(source.endpoint).trim(),
    model: text(source.model).trim(),
    apiKey: text(source.apiKey).trim()
  }
}

export function configPublic(config, configPath) {
  const normalized = normalizeAgentConfig(config)
  return {
    ok: true,
    configured: Boolean(normalized.endpoint),
    endpoint: normalized.endpoint,
    model: normalized.model,
    ...(normalized.apiKey ? { apiKeyMasked: maskApiKey(normalized.apiKey) } : {}),
    configPath: text(configPath)
  }
}

/** 读配置：缺档/坏档＝未配置＋warning，不拦启动（作者随时可以在设置里补）。 */
export async function loadAgentConfig(configPath) {
  const empty = { config: { endpoint: '', model: '', apiKey: '' }, warnings: [] }
  if (!text(configPath).trim()) return empty
  let raw
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return empty
    return { ...empty, warnings: [{ code: 'AGENT_CONFIG_UNREADABLE', message: `Agent 配置读不了：${text(error?.message || error)}` }] }
  }
  try {
    return { config: normalizeAgentConfig(JSON.parse(raw)), warnings: [] }
  } catch (error) {
    return { ...empty, warnings: [{ code: 'AGENT_CONFIG_CORRUPT', message: `Agent 配置不是有效 JSON：${text(error?.message || error)}` }] }
  }
}

/**
 * 写配置（原子：tmp＋rename）。patch.apiKey === undefined ＝ 保留原值；
 * 空串 ＝ 清除；非空 ＝ 覆盖。返回写好后的完整配置。
 */
export async function saveAgentConfig(configPath, patch = {}) {
  const { config } = await loadAgentConfig(configPath)
  const next = normalizeAgentConfig({
    ...config,
    endpoint: patch.endpoint ?? config.endpoint,
    model: patch.model ?? config.model,
    apiKey: patch.apiKey === undefined ? config.apiKey : text(patch.apiKey).trim()
  })
  await mkdir(join(configPath, '..'), { recursive: true })
  const tmp = `${configPath}.tmp-${randomUUID()}`
  await writeFile(tmp, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2), 'utf-8')
  await rename(tmp, configPath)
  return next
}

/* ---------- 会话 JSONL ---------- */

export function newSessionId() {
  return `s-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

export function newMessageId() {
  return `m-${randomUUID().slice(0, 10)}`
}

export function newCardId() {
  return `c-${randomUUID().slice(0, 10)}`
}

function sessionTitleFrom(content) {
  const body = text(content).replace(/\s+/gu, ' ').trim()
  return body.slice(0, 24) || '新会话'
}

function sessionFilePath(dir, id) {
  return join(dir, `${id}.jsonl`)
}

/** 行 → 对外形状（meta 行不外露；msg/card 补 kind 字段）。 */
function itemFromLine(line) {
  if (!line || typeof line !== 'object') return null
  if (line.t === 'msg') {
    return {
      kind: 'msg',
      id: text(line.id),
      role: line.role === 'assistant' ? 'assistant' : 'user',
      content: text(line.content),
      at: text(line.at),
      ...(line.partial === true ? { partial: true } : {})
    }
  }
  if (line.t === 'card') {
    return {
      kind: 'card',
      id: text(line.id),
      state: line.state === 'adopted' || line.state === 'rejected' ? line.state : 'open',
      file: text(line.file),
      text: text(line.text),
      note: text(line.note).trim(),
      chars: Number.isSafeInteger(line.chars) ? line.chars : text(line.text).length,
      snapshot: line.snapshot && typeof line.snapshot === 'object'
        ? { exists: line.snapshot.exists === true, chars: Number(line.snapshot.chars) || 0, sha256: text(line.snapshot.sha256) }
        : { exists: false, chars: 0, sha256: '' },
      createdAt: text(line.createdAt),
      ...(line.resolvedAt ? { resolvedAt: text(line.resolvedAt) } : {}),
      ...(line.backup ? { backup: text(line.backup) } : {})
    }
  }
  return null
}

function sessionFromLines(lines) {
  const meta = lines.find((line) => line?.t === 'meta') || null
  if (!meta) return null
  const items = lines.map(itemFromLine).filter(Boolean)
  const msgs = items.filter((item) => item.kind === 'msg')
  const lastAt = lines.filter((line) => line?.t !== 'meta' && text(line.at)).map((line) => line.at).pop()
  return {
    id: text(meta.id),
    title: text(meta.title) || '新会话',
    createdAt: text(meta.createdAt),
    updatedAt: text(lastAt) || text(meta.createdAt),
    messageCount: msgs.length
  }
}

async function readLines(dir, id) {
  let raw
  try {
    raw = await readFile(sessionFilePath(dir, id), 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  return raw.split('\n').filter((line) => line.trim()).map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null // 坏行跳过，不拖垮整个会话
    }
  }).filter(Boolean)
}

async function writeLines(dir, id, lines) {
  await mkdir(dir, { recursive: true })
  const tmp = `${sessionFilePath(dir, id)}.tmp-${randomUUID()}`
  await writeFile(tmp, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf-8')
  await rename(tmp, sessionFilePath(dir, id))
}

export async function createSession(sessionsDir, root, title = '', now = new Date()) {
  const dir = sessionDirFor(sessionsDir, root)
  const session = {
    id: newSessionId(),
    title: text(title).trim() || '新会话',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    messageCount: 0
  }
  await writeLines(dir, session.id, [{ t: 'meta', id: session.id, title: session.title, createdAt: session.createdAt }])
  return session
}

export async function listSessions(sessionsDir, root) {
  const dir = sessionDirFor(sessionsDir, root)
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const sessions = []
  for (const name of names.filter((item) => item.endsWith('.jsonl') && !item.includes('.tmp-'))) {
    const id = name.slice(0, -'.jsonl'.length)
    if (!isValidSessionId(id)) continue
    try {
      const session = sessionFromLines(await readLines(dir, id))
      if (session) sessions.push(session)
    } catch { /* 单个坏档不拖垮清单 */ }
  }
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function readSession(sessionsDir, root, id) {
  if (!isValidSessionId(id)) return null
  const dir = sessionDirFor(sessionsDir, root)
  const lines = await readLines(dir, id)
  if (!lines) return null
  const session = sessionFromLines(lines)
  if (!session) return null
  return { session, items: lines.map(itemFromLine).filter(Boolean) }
}

export async function appendSession(sessionsDir, root, id, entries) {
  if (!isValidSessionId(id)) return null
  const dir = sessionDirFor(sessionsDir, root)
  const lines = await readLines(dir, id)
  if (!lines || !lines.some((line) => line?.t === 'meta')) return null
  const additions = (Array.isArray(entries) ? entries : [entries]).filter(Boolean)
  await writeLines(dir, id, [...lines, ...additions])
  return sessionFromLines([...lines, ...additions])
}

export async function renameSession(sessionsDir, root, id, title) {
  if (!isValidSessionId(id)) return null
  const dir = sessionDirFor(sessionsDir, root)
  const lines = await readLines(dir, id)
  if (!lines) return null
  const next = lines.map((line) => (line?.t === 'meta' ? { ...line, title: text(title).trim() || line.title } : line))
  await writeLines(dir, id, next)
  return sessionFromLines(next)
}

export async function deleteSession(sessionsDir, root, id) {
  if (!isValidSessionId(id)) return false
  const dir = sessionDirFor(sessionsDir, root)
  try {
    await rm(sessionFilePath(dir, id), { force: false })
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** 改卡状态：找到 card 行替换后整文件重写；找不到返回 null。 */
export async function updateCard(sessionsDir, root, sessionId, cardId, patch = {}) {
  const loaded = await readSession(sessionsDir, root, sessionId)
  if (!loaded) return null
  const dir = sessionDirFor(sessionsDir, root)
  const raw = await readLines(dir, sessionId)
  let updated = null
  const next = raw.map((line) => {
    if (line?.t !== 'card' || line.id !== cardId) return line
    updated = { ...line, ...patch }
    return updated
  })
  if (!updated) return null
  await writeLines(dir, sessionId, next)
  return itemFromLine(updated)
}

/* ---------- 正文快照闸 ---------- */

export function sha256Of(content) {
  return createHash('sha256').update(text(content), 'utf-8').digest('hex')
}

/** 目标文件快照：不存在也是合法快照（exists:false），采纳时以「仍然不存在」为一致。 */
export function fileSnapshot(absPath) {
  try {
    const content = readFileSync(absPath, 'utf-8')
    return { exists: true, chars: content.length, sha256: sha256Of(content) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, chars: 0, sha256: '' }
    throw error
  }
}

export function snapshotsMatch(current, snapshot) {
  const left = current || { exists: false, chars: 0, sha256: '' }
  const right = snapshot || { exists: false, chars: 0, sha256: '' }
  if (left.exists !== right.exists) return false
  if (!left.exists) return true
  return left.sha256 === right.sha256
}

/* ---------- 上游 SSE 解析 ---------- */

/**
 * 把 OpenAI 兼容上游的 SSE 流拆成 delta 文本。
 * onDelta(chunk) 逐片回调（daemon 边收边转发帧）；测试收集即可。
 * 非 SSE 的整段 JSON（上游没理会 stream:true）在 end() 兜底解析一次。
 * [DONE]/坏行丢弃——不伪造内容。
 */
export function createSseDeltaParser(onDelta) {
  const sink = typeof onDelta === 'function' ? onDelta : () => {}
  let buffer = ''
  let sawDataLine = false

  const emit = (piece) => {
    if (typeof piece === 'string' && piece) sink(piece)
  }

  const handleData = (data) => {
    if (!data || data === '[DONE]') return
    try {
      const parsed = JSON.parse(data)
      const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : parsed?.choices
      emit(choice?.delta?.content)
      emit(choice?.message?.content)
    } catch { /* 半包/坏行如实丢弃 */ }
  }

  return {
    feed(chunk) {
      buffer += text(chunk)
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/u, '')
        buffer = buffer.slice(index + 1)
        if (line.startsWith('data:')) {
          sawDataLine = true
          handleData(line.slice(5).trim())
        }
      }
    },
    end() {
      const tail = buffer.trim()
      buffer = ''
      if (!tail) return
      if (sawDataLine) {
        if (tail.startsWith('data:')) handleData(tail.slice(5).trim())
        return
      }
      // 上游返回了整段 JSON（非流式）：取 message.content 兜底，一次发完。
      try {
        const parsed = JSON.parse(tail)
        const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : parsed?.choices
        emit(choice?.message?.content)
        emit(choice?.delta?.content)
      } catch { /* 不是 JSON 也不是 SSE，如实丢弃 */ }
    }
  }
}

/** 组装上游消息：system ＋ 会话历史（从尾部截，总字数封顶）。 */
export function buildUpstreamMessages(systemPrompt, items, { maxMessages = 24, maxChars = 48000 } = {}) {
  const history = (Array.isArray(items) ? items : [])
    .filter((item) => item?.kind === 'msg')
    .map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: text(item.content) }))
    .filter((message) => message.content.trim())
  const picked = []
  let used = 0
  for (let index = history.length - 1; index >= 0 && picked.length < maxMessages; index -= 1) {
    const message = history[index]
    if (used + message.content.length > maxChars && picked.length > 0) break
    picked.unshift(message)
    used += message.content.length
  }
  return [{ role: 'system', content: text(systemPrompt) }, ...picked]
}
