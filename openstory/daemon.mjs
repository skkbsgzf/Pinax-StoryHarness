#!/usr/bin/env node
/**
 * OpenStory daemon（OS-1/4）——轻 Node HTTP 服务，OpenStory 工作台的唯一磁盘层。
 *
 * 四件事：
 *   1) 静态托管 `openstory/public/`（index.html ＋ app.js）；
 *   2) 文件绑定 API（库 / 条目 / 正文 / wiki），读走 S1 `factFileStore`，写走 S2 `writeFactFile`
 *      （经 store 的 save/wikiDerive 转调，本文件不重写任何写协议）；
 *   3) Agent 通道（OS-4）：会话 JSONL（`agentStore.mjs`）＋ OpenAI 兼容上游流式转发；
 *      端点/模型/key 只存 daemon 本机配置（%LOCALAPPDATA%/PinaxNext/openstory/agent-config.json），
 *      任何响应不回显完整 key；待确认卡采纳走正文快照闸（创建→采纳窗口）＋与手工保存同一条原子写。
 *   4) daemon 不做工具循环：模型读不到库文件，除非作者粘贴（v1 边界，诚实标注）。
 *
 * 三条硬边界：
 *   · 只绑 127.0.0.1（不监外网，对齐 OpenDesign sidecar）；不做 HTTPS/隧道/多用户。
 *   · `root` 必须命中库清单（`%LOCALAPPDATA%/PinaxNext/next-preferences.json` 的 recentProjects）
 *     或启动时显式 `--root=` 授权；文件路径 resolve 后必须落在 root 内（照 S2 的路径逃逸拒收写法）。
 *   · 正文写入不做 revision 闸（v1 边界）：OpenStory 与 Electron 同时写同一库时，只有写前
 *     `.history/<file>.bak-<时间戳>` 这层粗保护。真正的冲突保护归后续写协议接入。
 *
 * 启动：`node openstory/daemon.mjs [--port=8807] [--root=<库路径>]`
 */
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  API_ERROR_CODES,
  endpointFor,
  errorEnvelope,
  isPlainObject,
  normalizeLibraries,
  validateRequest,
  validateResponse
} from './contracts.mjs'
import {
  appendSession,
  buildUpstreamMessages,
  configPublic,
  createSession,
  createSseDeltaParser,
  defaultAgentConfigPath,
  defaultSessionsDir,
  deleteSession,
  fileSnapshot,
  listSessions,
  loadAgentConfig,
  newCardId,
  newMessageId,
  readSession,
  renameSession,
  saveAgentConfig,
  snapshotsMatch,
  updateCard
} from './agentStore.mjs'
import { createFactFileStore } from '../next/kernel/factFileStore.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_PORT = 8807
export const DEFAULT_PUBLIC_DIR = join(HERE, 'public')
const MAX_JSON_BODY = 16 * 1024 * 1024
const MAX_STATIC_BYTES = 8 * 1024 * 1024
const METADATA_DIR = '.pinax'

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
})

const STATUS_BY_CODE = Object.freeze({
  NO_LIBRARY: 403,
  PATH_ESCAPE: 403,
  NOT_FOUND: 404,
  INVALID_ENTRY: 400,
  REVISION_MISMATCH: 409,
  WRITE_PROTOCOL_OPERATION_ID_REQUIRED: 400,
  WRITE_PROTOCOL_VALIDATION_FAILED: 422,
  WRITE_PROTOCOL_INVALID_INPUT: 400,
  WRITE_PROTOCOL_NOT_FOUND: 404,
  WRITE_PROTOCOL_IO_FAILED: 500,
  AGENT_NOT_CONFIGURED: 400,
  AGENT_UPSTREAM_ERROR: 502
})

function text(value) {
  return String(value ?? '')
}

/* ---------- 库清单与 root 白名单 ---------- */

/** 与 Electron 库管理器同一份数据：%LOCALAPPDATA%/PinaxNext/next-preferences.json。 */
export function defaultPreferencesPath(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'next-preferences.json') : ''
}

/**
 * 读库清单。坏档/缺档不拦启动：按空清单回，并记一条 warning 让工作台摆空态。
 * `recentProjects` 真实形状只保底 path/name/at；kind/count 缺了补默认值。
 */
export function loadLibraries({ preferencesPath, env = process.env } = {}) {
  const target = text(preferencesPath || env.PINAX_OS_PREFERENCES || defaultPreferencesPath(env)).trim()
  const warnings = []
  if (!target) {
    return {
      libraries: [],
      warnings: [{ code: 'PREFERENCES_PATH_UNKNOWN', message: '找不到 LOCALAPPDATA，无法定位 next-preferences.json' }],
      preferencesPath: ''
    }
  }
  let raw
  try {
    raw = readFileSync(target, 'utf-8')
  } catch (error) {
    warnings.push({
      code: error?.code === 'ENOENT' ? 'PREFERENCES_MISSING' : 'PREFERENCES_UNREADABLE',
      path: target,
      message: error?.code === 'ENOENT'
        ? '库清单文件还不存在：先在 Pinax 里打开一个库'
        : `库清单文件读不了：${text(error?.message || error)}`
    })
    return { libraries: [], warnings, preferencesPath: target }
  }
  let document
  try {
    document = JSON.parse(raw)
  } catch (error) {
    warnings.push({ code: 'PREFERENCES_CORRUPT', path: target, message: `库清单不是有效 JSON：${text(error?.message || error)}` })
    return { libraries: [], warnings, preferencesPath: target }
  }
  if (!isPlainObject(document) || !Array.isArray(document.recentProjects)) {
    warnings.push({ code: 'PREFERENCES_SHAPE', path: target, message: '库清单缺少 recentProjects 数组' })
    return { libraries: [], warnings, preferencesPath: target }
  }
  const normalized = normalizeLibraries(document.recentProjects)
  return {
    libraries: normalized.libraries,
    warnings: [...warnings, ...normalized.warnings],
    preferencesPath: target
  }
}

function canonicalRoot(value) {
  const raw = text(value).trim()
  if (!raw) return ''
  const absolute = resolve(raw)
  // Windows 会把 8.3 短名与长名当成同一目录：先 realpath 归一再比，避免
  // `ADMINI~1` 与 `Administrator` 明明同一个库却互相不认。路径不存在时回落 resolve。
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

function rootKey(value) {
  const canonical = canonicalRoot(value)
  if (!canonical) return ''
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

/**
 * root 白名单＝库清单 ＋ 启动时 `--root=` 的显式授权。
 * 显式 CLI 授权与库登记等价：作者指定了哪个库，daemon 才敢碰哪个库。
 */
export function createRootAllowlist(libraries = [], extraRoots = []) {
  const byKey = new Map()
  for (const library of libraries) {
    const root = canonicalRoot(library?.path)
    if (root) byKey.set(rootKey(root), root)
  }
  for (const extra of extraRoots) {
    const root = canonicalRoot(extra)
    if (root) byKey.set(rootKey(root), root)
  }
  const resolveRoot = (value) => {
    const key = rootKey(value)
    return key ? (byKey.get(key) ?? null) : null
  }
  return {
    roots: [...byKey.values()],
    resolve: resolveRoot,
    isAllowed(value) {
      return Boolean(resolveRoot(value))
    }
  }
}

/* ---------- 路径安全 ---------- */

function pathFail(message, path) {
  return { ok: false, code: API_ERROR_CODES.PATH_ESCAPE, message, details: path ? { path } : undefined }
}

/**
 * 相对路径 → 绝对路径，并保证落在 root 内。照 S2 `validateRelativePath` 的口径：
 * 不得绝对、不得含 `.`/`..`/空段、不得碰 `.pinax/`（元数据只归 Electron 内核写）。
 * 额外用 path.relative 复核一次，防止符号链接/大小写以外的拼接意外。
 */
export function resolveInsideRoot(root, relativePath, { allowMetadata = false } = {}) {
  const base = canonicalRoot(root)
  if (!base) {
    return { ok: false, code: API_ERROR_CODES.NO_LIBRARY, message: '文件路径需要一个项目根（root）' }
  }
  const raw = text(relativePath).trim()
  if (!raw || raw.includes('\0')) return pathFail('路径必须是非空字符串', raw)
  const normalized = raw.replaceAll('\\', '/').replace(/^\.\//u, '')
  const segments = normalized.split('/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//u.test(normalized)
    || segments.some((part) => !part || part === '.' || part === '..')) {
    return pathFail(`路径不合法或越出库根：${raw}`, normalized)
  }
  if (!allowMetadata && segments.some((part) => part.toLowerCase() === METADATA_DIR)) {
    return pathFail(`${METADATA_DIR}/ 只归 Pinax 内核写，OpenStory 不碰`, normalized)
  }
  const target = resolve(base, normalized)
  const rel = relative(base, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return pathFail(`路径解析后落在库根之外：${raw}`, normalized)
  }
  return { ok: true, path: target, relative: normalized }
}

/** 写前备份路径：同目录 `.history/<file>.bak-<时间戳>`（不覆盖旧备份）。 */
export function historyBackupPath(root, file, now = new Date()) {
  const resolved = resolveInsideRoot(root, file)
  if (!resolved.ok) return resolved
  const stamp = now.toISOString().replace(/[:.]/gu, '-')
  return {
    ok: true,
    path: join(dirname(resolved.path), '.history', `${basename(resolved.path)}.bak-${stamp}`),
    relative: `${dirname(resolved.relative)}/.history/${basename(resolved.relative)}.bak-${stamp}`.replace(/^\.\//u, '')
  }
}

/* ---------- 写协议错误码透传 ---------- */

/**
 * S2 的失败码 → OpenStory 契约码。writeFail 会把内核码表里的码解析成 `PINAX_*`，
 * 这里剥前缀后按语义归并；未识别的写失败统一 WRITE_PROTOCOL_IO_FAILED（不假装成功）。
 */
export function mapWriteErrorCode(code) {
  const upper = text(code).trim().replace(/^PINAX_/u, '').toUpperCase()
  if (upper.includes('OPERATION_ID_REQUIRED')) return API_ERROR_CODES.WRITE_PROTOCOL_OPERATION_ID_REQUIRED
  if (upper.includes('VALIDATION_FAILED')) return API_ERROR_CODES.WRITE_PROTOCOL_VALIDATION_FAILED
  if (upper.includes('REVISION_MISMATCH')) return API_ERROR_CODES.REVISION_MISMATCH
  if (upper.includes('NOT_FOUND')) return API_ERROR_CODES.WRITE_PROTOCOL_NOT_FOUND
  if (upper.includes('INVALID_INPUT')) return API_ERROR_CODES.WRITE_PROTOCOL_INVALID_INPUT
  if (upper.includes('INVALID_ENTRY')) return API_ERROR_CODES.WRITE_PROTOCOL_VALIDATION_FAILED
  return API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED
}

function mapReadErrorCode(code) {
  const upper = text(code).trim().replace(/^PINAX_/u, '').toUpperCase()
  if (upper.includes('NOT_FOUND')) return API_ERROR_CODES.NOT_FOUND
  return API_ERROR_CODES.INVALID_ENTRY
}

/* ---------- HTTP 工具 ---------- */

function statusFor(code) {
  return STATUS_BY_CODE[code] ?? 500
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  res.end(body)
}

function sendError(res, code, message, details) {
  sendJson(res, statusFor(code), errorEnvelope(code, message, details))
}

function readBody(req, limit = MAX_JSON_BODY) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        const error = new Error('请求体超过上限')
        error.code = 'BODY_TOO_LARGE'
        rejectPromise(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectPromise)
  })
}

async function readJson(req) {
  const raw = await readBody(req)
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch (error) {
    const failure = new Error(`请求体不是有效 JSON：${text(error?.message || error)}`)
    failure.code = 'INVALID_JSON'
    throw failure
  }
}

async function serveStatic(req, res, url, publicDir) {
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '静态路径编码不合法')
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html'
  const resolved = resolveInsideRoot(publicDir, pathname.replace(/^\/+/u, ''), { allowMetadata: true })
  if (!resolved.ok) {
    return sendError(res, API_ERROR_CODES.PATH_ESCAPE, '静态文件路径越界')
  }
  let stats
  try {
    stats = statSync(resolved.path)
  } catch {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `静态文件不存在：${pathname}`)
  }
  if (stats.isDirectory()) {
    return serveStatic(req, res, { pathname: `${pathname.replace(/\/+$/u, '')}/index.html` }, publicDir)
  }
  if (stats.size > MAX_STATIC_BYTES) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '静态文件过大')
  }
  res.writeHead(200, {
    'content-type': MIME[extname(resolved.path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stats.size,
    'cache-control': 'no-cache'
  })
  createReadStream(resolved.path).pipe(res)
}

/* ---------- 业务处理 ---------- */

function mergeLibraryRoots(libraries, extraRoots) {
  const list = [...libraries]
  const seen = new Set(libraries.map((library) => rootKey(library.path)))
  for (const extra of extraRoots) {
    const root = canonicalRoot(extra)
    if (!root) continue
    const key = rootKey(root)
    if (seen.has(key)) continue
    seen.add(key)
    // --root 显式授权的库不在 recentProjects 里时也上屏，作者才能点得到。
    list.push({ path: root, name: basename(root) || root, kind: '未分类', count: 0, at: '' })
  }
  return list
}

function authorizeRoot(allowlist, requested) {
  const root = allowlist.resolve(requested)
  if (!root) {
    return {
      ok: false,
      code: API_ERROR_CODES.NO_LIBRARY,
      message: `root 不在库清单里：${text(requested)}`,
      details: { root: text(requested) }
    }
  }
  return { ok: true, root }
}

/**
 * 正文原子写（tmp＋rename）＋写前 .history 备份。`PUT /api/chapter`（手工保存）与
 * 待确认卡采纳共用同一条实现，保证两条路的落盘行为完全一致。
 */
async function writeChapterWithBackup(root, file, newText) {
  const resolved = resolveInsideRoot(root, file)
  if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message, details: resolved.details }
  try {
    await mkdir(dirname(resolved.path), { recursive: true })
    let backupRelative = null
    if (existsSync(resolved.path)) {
      // v1 粗保护：写前把原内容复制到同目录 .history/。OpenStory 与 Electron 同时写同一库时，
      // 这里不拦冲突（不做跨进程 revision 闸），只保证「上一版还能捞回来」。
      // 待确认卡另有快照闸（卡创建→采纳窗口），见 agentStore.fileSnapshot/snapshotsMatch。
      const backup = historyBackupPath(root, file)
      if (!backup.ok) return { ok: false, code: backup.code, message: backup.message, details: backup.details }
      await mkdir(dirname(backup.path), { recursive: true })
      await copyFile(resolved.path, backup.path)
      backupRelative = backup.relative
    }
    const tmp = `${resolved.path}.tmp-${randomUUID()}`
    await writeFile(tmp, newText, 'utf-8')
    await rename(tmp, resolved.path)
    return { ok: true, chars: newText.length, savedAt: new Date().toISOString(), ...(backupRelative ? { backup: backupRelative } : {}) }
  } catch (error) {
    return { ok: false, code: API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, message: `正文写入失败：${text(error?.message || error)}`, details: { file } }
  }
}

async function handleApi(req, res, url, context) {
  const endpointId = endpointFor(req.method, url.pathname)
  if (!endpointId) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `没有这个端点：${req.method} ${url.pathname}`)
  }

  const loaded = loadLibraries({ preferencesPath: context.preferencesPath, env: context.env })
  const allowlist = createRootAllowlist(loaded.libraries, context.extraRoots)

  if (endpointId === 'libraries') {
    const libraries = mergeLibraryRoots(loaded.libraries, context.extraRoots)
    const defaultRecord = context.defaultRoot
      ? libraries.find((library) => rootKey(library.path) === rootKey(context.defaultRoot))
      : null
    const payload = {
      ok: true,
      libraries,
      warnings: loaded.warnings,
      preferencesPath: loaded.preferencesPath,
      ...(context.defaultRoot ? { defaultRoot: defaultRecord?.path ?? context.defaultRoot } : {})
    }
    const checked = validateResponse('libraries', payload)
    if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '库清单响应形状不符合契约', { errors: checked.errors })
    return sendJson(res, 200, payload)
  }

  let input
  if (ENDPOINT_HAS_QUERY.has(endpointId)) {
    input = Object.fromEntries(url.searchParams.entries())
  } else {
    try {
      input = await readJson(req)
    } catch (error) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, text(error?.message || error))
    }
  }

  const checked = validateRequest(endpointId, input)
  if (!checked.ok) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '请求参数不符合契约', { errors: checked.errors })
  }
  const request = checked.value

  // Agent 配置不碰库文件，不做 root 校验。
  if (endpointId === 'agentConfigGet') return handleAgentConfigGet(res, context)
  if (endpointId === 'agentConfigPut') return handleAgentConfigPut(res, request, context)

  if (endpointId === 'agentChat') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    return handleAgentChat(req, res, request, context, authorized.root, loaded.libraries)
  }

  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const store = createFactFileStore({ root })

  if (endpointId === 'entries') {
    const result = store.list({
      layer: request.layer,
      offset: request.offset,
      limit: request.limit
    })
    if (!result.ok) {
      return sendError(res, mapReadErrorCode(result.error?.code), text(result.error?.message || '条目清单读取失败'), result.error?.details)
    }
    return sendJson(res, 200, {
      ok: true,
      entries: result.entries,
      total: result.total,
      warnings: [...loaded.warnings, ...(result.warnings ?? [])]
    })
  }

  if (endpointId === 'entry') {
    const result = store.get({ id: request.id })
    if (!result.ok) {
      return sendError(res, mapReadErrorCode(result.error?.code), text(result.error?.message || '条目读取失败'), result.error?.details)
    }
    return sendJson(res, 200, { ok: true, entry: result.entry, revision: result.revision })
  }

  if (endpointId === 'chapterGet') {
    const resolved = resolveInsideRoot(root, request.file)
    if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
    let body
    try {
      const stats = statSync(resolved.path)
      if (!stats.isFile()) return sendError(res, API_ERROR_CODES.NOT_FOUND, '正文路径不是文件', { file: request.file })
      body = await readFile(resolved.path, 'utf-8')
    } catch (error) {
      if (error?.code === 'ENOENT') return sendError(res, API_ERROR_CODES.NOT_FOUND, `正文文件不存在：${request.file}`, { file: request.file })
      return sendError(res, API_ERROR_CODES.NOT_FOUND, `正文读取失败：${text(error?.message || error)}`, { file: request.file })
    }
    return sendJson(res, 200, { ok: true, name: basename(resolved.path), text: body, chars: body.length })
  }

  if (endpointId === 'chapterPut') {
    const written = await writeChapterWithBackup(root, request.file, request.text)
    if (!written.ok) return sendError(res, written.code, written.message, written.details)
    return sendJson(res, 200, {
      ok: true,
      chars: written.chars,
      savedAt: written.savedAt,
      ...(written.backup ? { backup: written.backup } : {})
    })
  }

  if (endpointId === 'agentSessions') {
    const sessions = await listSessions(context.agentSessionsDir, root)
    return sendJson(res, 200, { ok: true, sessions })
  }

  if (endpointId === 'agentSessionCreate') {
    const session = await createSession(context.agentSessionsDir, root, request.title)
    return sendJson(res, 200, { ok: true, session })
  }

  if (endpointId === 'agentSessionGet') {
    const loaded = await readSession(context.agentSessionsDir, root, request.id)
    if (!loaded) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.id}`)
    return sendJson(res, 200, { ok: true, session: loaded.session, items: loaded.items })
  }

  if (endpointId === 'agentSessionRename') {
    const session = await renameSession(context.agentSessionsDir, root, request.id, request.title)
    if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.id}`)
    return sendJson(res, 200, { ok: true, session })
  }

  if (endpointId === 'agentSessionDelete') {
    const removed = await deleteSession(context.agentSessionsDir, root, request.id)
    if (!removed) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.id}`)
    return sendJson(res, 200, { ok: true })
  }

  if (endpointId === 'agentCardCreate') {
    return handleAgentCardCreate(res, request, context, root)
  }

  if (endpointId === 'agentCardAdopt') {
    return handleAgentCardAdopt(res, request, context, root)
  }

  if (endpointId === 'agentCardReject') {
    return handleAgentCardReject(res, request, context, root)
  }

  if (endpointId === 'wiki') {
    const result = store.wikiGet({ bookId: request.bookId })
    if (!result.ok) {
      return sendError(res, mapReadErrorCode(result.error?.code), text(result.error?.message || 'wiki 读取失败'), result.error?.details)
    }
    return sendJson(res, 200, { ok: true, wiki: result.wiki, derivedFrom: result.derivedFrom })
  }

  if (endpointId === 'wikiDerive') {
    const result = await store.wikiDerive({ bookId: request.bookId, operationId: request.operationId })
    if (!result.ok) {
      const code = mapWriteErrorCode(result.error?.code)
      return sendError(res, code, text(result.error?.message || 'wiki 派生失败'), result.error?.details)
    }
    return sendJson(res, 200, {
      ok: true,
      wiki: result.wiki,
      derivedFrom: result.derivedFrom,
      revision: result.revision,
      duplicate: result.duplicate === true
    })
  }

  return sendError(res, API_ERROR_CODES.NOT_FOUND, `端点未实现：${endpointId}`)
}

const ENDPOINT_HAS_QUERY = new Set(['entries', 'entry', 'chapterGet', 'wiki', 'agentSessions', 'agentSessionGet', 'agentSessionDelete'])

/* ---------- Agent 通道（OS-4）---------- */

function systemPromptFor(root, libraries) {
  const key = rootKey(root)
  const record = (Array.isArray(libraries) ? libraries : []).find((library) => rootKey(library.path) === key)
  const name = record?.name || basename(root) || '未命名库'
  return [
    `你是 OpenStory 工作台的写作助手，正在协助作者创作《${name}》（本机磁盘上的一个 Pinax 库）。`,
    '- 用中文回复。',
    '- 作者可以把你的回复转成「待确认卡」并采纳写进正文文件：给出正文片段时，请给完整、可直接粘贴的文本，不要只给修改说明。',
    '- v1 你读不到库里的文件；作者会把需要的上下文粘贴给你，不要假装读过文件。'
  ].join('\n')
}

function sseFrame(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

async function handleAgentConfigGet(res, context) {
  const { config } = await loadAgentConfig(context.agentConfigPath)
  return sendJson(res, 200, configPublic(config, context.agentConfigPath))
}

async function handleAgentConfigPut(res, request, context) {
  const config = await saveAgentConfig(context.agentConfigPath, request)
  return sendJson(res, 200, configPublic(config, context.agentConfigPath))
}

/**
 * Agent 对话（OS-4）：会话 JSONL ＋ OpenAI 兼容上游流式转发。
 * 帧协议（daemon 自有）：start（回填 sessionId）→ delta* → done；出错发 error 帧。
 * 凭据只来自 daemon 本机配置，不回显、不进日志；上游失败如实报，不伪造回答。
 */
async function handleAgentChat(req, res, request, context, root, libraries) {
  const { config } = await loadAgentConfig(context.agentConfigPath)
  const endpoint = text(config.endpoint).trim()
  if (!endpoint) {
    return sendError(res, API_ERROR_CODES.AGENT_NOT_CONFIGURED,
      '还没配置模型端点：点 Agent 列右上角的齿轮，填 OpenAI 兼容端点（key 只存本机 daemon 配置）')
  }
  let targetUrl
  try {
    targetUrl = new URL(endpoint)
  } catch {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `配置的模型端点不是有效 URL：${endpoint}`)
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '模型端点只支持 http/https')
  }

  // 会话：sessionId 缺省＝新建（标题取首句）；给了就必须真存在。
  const sessionsDir = context.agentSessionsDir
  let loaded = request.sessionId ? await readSession(sessionsDir, root, request.sessionId) : null
  if (request.sessionId && !loaded) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.sessionId}`)
  }
  if (!loaded) {
    const title = text(request.content).replace(/\s+/gu, ' ').trim().slice(0, 24) || '新会话'
    const created = await createSession(sessionsDir, root, title)
    loaded = { session: created, items: [] }
  }
  const sessionId = loaded.session.id
  await appendSession(sessionsDir, root, sessionId, [{
    t: 'msg', id: newMessageId(), role: 'user', content: request.content, at: new Date().toISOString()
  }])
  const history = await readSession(sessionsDir, root, sessionId)
  const upstreamMessages = buildUpstreamMessages(systemPromptFor(root, libraries), history.items)
  const model = text(request.model || config.model).trim()

  const headers = { 'content-type': 'application/json', accept: 'text/event-stream' }
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`

  const controller = new AbortController()
  let clientGone = false
  // res 'close'＝连接提前断开（工作台点了停止/关页）；正常结束后 res 的 close 不触发 abort。
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true
      controller.abort()
    }
  })

  let upstream
  try {
    upstream = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...(model ? { model } : {}), messages: upstreamMessages, stream: true }),
      signal: controller.signal
    })
  } catch (error) {
    if (clientGone) return
    return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `模型端点连不上：${text(error?.message || error)}`)
  }

  if (!upstream.ok) {
    if (clientGone) return
    const detail = text(await upstream.text().catch(() => '')).slice(0, 500)
    return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `模型端点返回 ${upstream.status}`, { status: upstream.status, detail })
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
  sseFrame(res, { type: 'start', sessionId })

  const decoder = new TextDecoder()
  let full = ''
  const parser = createSseDeltaParser((piece) => {
    full += piece
    if (!res.writableEnded) sseFrame(res, { type: 'delta', text: piece })
  })

  let upstreamError = ''
  try {
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        parser.feed(decoder.decode(chunk, { stream: true }))
      }
      parser.feed(decoder.decode())
    }
    parser.end()
  } catch (error) {
    if (!clientGone && !controller.signal.aborted) {
      upstreamError = text(error?.message || error)
      sseFrame(res, { type: 'error', error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: upstreamError } })
    }
  }

  // 落档：完整回答、或被停止/中断的部分回答，partial 如实标；空回答不落（错误帧已如实报）。
  if (full.trim()) {
    const partial = controller.signal.aborted || Boolean(upstreamError)
    await appendSession(sessionsDir, root, sessionId, [{
      t: 'msg', id: newMessageId(), role: 'assistant', content: full,
      at: new Date().toISOString(), ...(partial ? { partial: true } : {})
    }])
  }
  if (!clientGone && !res.writableEnded) {
    sseFrame(res, { type: 'done', sessionId, chars: full.length })
  }
  res.end()
}

/** 待确认卡：创建即取目标正文快照——「卡创建→采纳」窗口的修订闸从这里起算。 */
async function handleAgentCardCreate(res, request, context, root) {
  const loaded = await readSession(context.agentSessionsDir, root, request.sessionId)
  if (!loaded) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.sessionId}`)
  const resolved = resolveInsideRoot(root, request.file)
  if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
  let snapshot
  try {
    snapshot = fileSnapshot(resolved.path)
  } catch (error) {
    return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `目标文件快照失败：${text(error?.message || error)}`, { file: request.file })
  }
  const note = text(request.note).trim()
  const card = {
    t: 'card',
    id: newCardId(),
    state: 'open',
    file: resolved.relative,
    text: request.text,
    ...(note ? { note } : {}),
    chars: request.text.length,
    snapshot,
    createdAt: new Date().toISOString()
  }
  await appendSession(context.agentSessionsDir, root, request.sessionId, [card])
  return sendJson(res, 200, {
    ok: true,
    card: {
      kind: 'card',
      id: card.id,
      state: card.state,
      file: card.file,
      text: card.text,
      ...(card.note ? { note: card.note } : {}),
      chars: card.chars,
      snapshot: card.snapshot,
      createdAt: card.createdAt
    }
  })
}

async function findOpenCard(context, root, sessionId, cardId) {
  const loaded = await readSession(context.agentSessionsDir, root, sessionId)
  if (!loaded) return { error: { code: API_ERROR_CODES.NOT_FOUND, message: `会话不存在：${sessionId}` } }
  const card = loaded.items.find((item) => item.kind === 'card' && item.id === cardId)
  if (!card) return { error: { code: API_ERROR_CODES.NOT_FOUND, message: `待确认卡不存在：${cardId}` } }
  if (card.state !== 'open') {
    return { error: { code: API_ERROR_CODES.INVALID_ENTRY, message: `这张卡已处理过（${card.state === 'adopted' ? '已采纳' : '已拒绝'}），不能再改` } }
  }
  return { card }
}

async function handleAgentCardAdopt(res, request, context, root) {
  const found = await findOpenCard(context, root, request.sessionId, request.id)
  if (found.error) return sendError(res, found.error.code, found.error.message)
  const card = found.card
  const resolved = resolveInsideRoot(root, card.file)
  if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
  let current
  try {
    current = fileSnapshot(resolved.path)
  } catch (error) {
    return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `正文快照失败：${text(error?.message || error)}`, { file: card.file })
  }
  if (!snapshotsMatch(current, card.snapshot)) {
    return sendError(res, API_ERROR_CODES.REVISION_MISMATCH,
      `正文在卡片创建后被改过（创建时 ${card.snapshot.exists ? `${card.snapshot.chars} 字` : '不存在'}，现在 ${current.exists ? `${current.chars} 字` : '不存在'}），拒绝覆盖。请重新创建待确认卡。`,
      { file: card.file, expected: card.snapshot, actual: current })
  }
  const written = await writeChapterWithBackup(root, card.file, card.text)
  if (!written.ok) return sendError(res, written.code, written.message, written.details)
  const updated = await updateCard(context.agentSessionsDir, root, request.sessionId, request.id, {
    state: 'adopted',
    resolvedAt: new Date().toISOString(),
    ...(written.backup ? { backup: written.backup } : {})
  })
  return sendJson(res, 200, {
    ok: true,
    card: updated,
    chars: written.chars,
    savedAt: written.savedAt,
    ...(written.backup ? { backup: written.backup } : {})
  })
}

async function handleAgentCardReject(res, request, context, root) {
  const found = await findOpenCard(context, root, request.sessionId, request.id)
  if (found.error) return sendError(res, found.error.code, found.error.message)
  const updated = await updateCard(context.agentSessionsDir, root, request.sessionId, request.id, {
    state: 'rejected',
    resolvedAt: new Date().toISOString()
  })
  return sendJson(res, 200, { ok: true, card: updated })
}

/* ---------- 服务器 ---------- */

export function createOpenStoryHandler({
  publicDir = DEFAULT_PUBLIC_DIR,
  preferencesPath,
  extraRoots = [],
  defaultRoot = '',
  agentConfigPath = defaultAgentConfigPath(),
  agentSessionsDir = defaultSessionsDir(),
  env = process.env
} = {}) {
  return async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return await handleApi(req, res, url, { preferencesPath, extraRoots, defaultRoot, agentConfigPath, agentSessionsDir, env })
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendError(res, API_ERROR_CODES.NOT_FOUND, `静态托管只支持 GET/HEAD：${req.method}`)
      }
      return await serveStatic(req, res, url, publicDir)
    } catch (error) {
      if (res.headersSent) {
        res.end()
        return
      }
      return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `daemon 内部错误：${text(error?.message || error)}`)
    }
  }
}

export function startDaemon({
  port = DEFAULT_PORT,
  host = '127.0.0.1',
  root = '',
  publicDir = DEFAULT_PUBLIC_DIR,
  preferencesPath,
  extraRoots = [],
  agentConfigPath = defaultAgentConfigPath(),
  agentSessionsDir = defaultSessionsDir(),
  env = process.env,
  logger = console
} = {}) {
  // 硬约束：只绑回环地址。传其他 host 也不接受，避免误开外网。
  const bindHost = host === '127.0.0.1' || host === 'localhost' ? '127.0.0.1' : '127.0.0.1'
  const authorizedExtras = [...extraRoots, ...(root ? [root] : [])]
  const handler = createOpenStoryHandler({
    publicDir,
    preferencesPath,
    extraRoots: authorizedExtras,
    defaultRoot: root ? canonicalRoot(root) : '',
    agentConfigPath,
    agentSessionsDir,
    env
  })
  const server = createServer((req, res) => {
    handler(req, res)
  })
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, bindHost, () => {
      const actualPort = server.address().port
      if (logger?.log) {
        logger.log(`OpenStory daemon → http://127.0.0.1:${actualPort}`)
        if (root) logger.log(`直接进入库：${resolve(root)}`)
      }
      resolvePromise({
        server,
        port: actualPort,
        host: bindHost,
        close: () => new Promise((done) => server.close(() => done()))
      })
    })
  })
}

/* ---------- CLI ---------- */

export function parseArgs(argv = []) {
  const options = { port: DEFAULT_PORT, root: '', preferencesPath: '', help: false }
  const args = [...argv]
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length))
      continue
    }
    if (arg === '--port') {
      options.port = Number(args[index + 1])
      index += 1
      continue
    }
    if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length)
      continue
    }
    if (arg === '--root') {
      options.root = args[index + 1] ?? ''
      index += 1
      continue
    }
    if (arg.startsWith('--preferences=')) {
      options.preferencesPath = arg.slice('--preferences='.length)
      continue
    }
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    options.port = DEFAULT_PORT
  }
  return options
}

const isMain = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false

if (isMain) {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('用法：node openstory/daemon.mjs [--port=8807] [--root=<库路径>] [--preferences=<next-preferences.json>]')
    process.exit(0)
  }
  startDaemon({
    port: options.port,
    root: options.root,
    preferencesPath: options.preferencesPath || undefined
  }).then((daemon) => {
    const shutdown = () => {
      daemon.close().finally(() => process.exit(0))
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }).catch((error) => {
    console.error(`OpenStory daemon 启动失败：${text(error?.message || error)}`)
    process.exit(1)
  })
}
