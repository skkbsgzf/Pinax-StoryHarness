import { fail, ok, NEXT_ERROR_CODES } from './errors.mjs'

/**
 * 作用域授予判定（规范 v1 第 2 节「同一份权限申请」＋第 7 节信任级）。
 * 原则：未声明即拒绝；每次拒绝都要回一句「请申请哪条 scope」，方便插件作者收口。
 */
export const GRANTABLE_FILE_MODES = Object.freeze(['read', 'write'])

export function parseScope(scope) {
  const parts = String(scope || '').trim().split(':')
  switch (parts[0]) {
    case 'file':
      if (parts.length !== 3 || !['r', 'rw'].includes(parts[2])) return null
      return { kind: 'file', dir: parts[1], mode: parts[2] }
    case 'agent':
      return parts.length === 2 && parts[1] === 'ask' ? { kind: 'agent', action: 'ask' } : null
    case 'state':
      return parts.length === 2 && ['read', 'write'].includes(parts[1]) ? { kind: 'state', action: parts[1] } : null
    case 'net':
      return parts.length === 2 ? { kind: 'net', host: parts[1] } : null
    default:
      return null
  }
}

export function buildGrantTable(scopes = []) {
  const table = { file: new Map(), agent: false, state: new Set(), net: new Set() }
  for (const scope of scopes) {
    const parsed = parseScope(scope)
    if (!parsed) continue
    if (parsed.kind === 'file') table.file.set(parsed.dir, parsed.mode)
    else if (parsed.kind === 'agent') table.agent = true
    else if (parsed.kind === 'state') table.state.add(parsed.action)
    else table.net.add(parsed.host)
  }
  return table
}

/**
 * 判定某个操作是否被授权。
 * request: {type:'file',dir,mode:'read'|'write'} | {type:'agent',action:'ask'}
 *        | {type:'state',action:'read'|'write'} | {type:'net',host}
 */
export function canPerform(grantTable, request) {
  if (!grantTable || !isPlainObject(request)) {
    return fail('INVALID_INPUT', '权限判定需要授予表与请求对象')
  }
  if (request.type === 'file') {
    const mode = grantTable.file.get(String(request.dir || ''))
    if (!mode) {
      return denied(`插件未申请 file:${request.dir}:r，无法读取目录「${request.dir}」`, request)
    }
    if (request.mode === 'write' && mode !== 'rw') {
      return denied(`插件只申请了 file:${request.dir}:r，写入需要 file:${request.dir}:rw`, request)
    }
    return ok(true)
  }
  if (request.type === 'agent') {
    return grantTable.agent ? ok(true) : denied('插件未申请 agent:ask，无法调用运行时', request)
  }
  if (request.type === 'state') {
    return grantTable.state.has(request.action)
      ? ok(true)
      : denied(`插件未申请 state:${request.action}，无法读写 .pinax/state/`, request)
  }
  if (request.type === 'net') {
    if (grantTable.net.has('*') || grantTable.net.has(request.host)) return ok(true)
    return denied(`插件未申请 net:${request.host}，禁止联网`, request)
  }
  return fail('INVALID_INPUT', `未知操作类型：${String(request.type)}`)
}

/** 运行时（一级公民）自身的自缚声明：内核也要过同一套判定，不给自己开后门。 */
export const RUNTIME_SCOPES = Object.freeze([
  'agent:ask',
  'state:read',
  'state:write'
])

export const FILE_SERVICE_SCOPES = Object.freeze([
  'file:*:rw'
])

function denied(message, request) {
  return fail('SCOPE_NOT_GRANTED', message, {
    request: { type: request.type, dir: request.dir, mode: request.mode, host: request.host, action: request.action },
    code: NEXT_ERROR_CODES.SCOPE_NOT_GRANTED
  })
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
