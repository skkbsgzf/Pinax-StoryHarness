/**
 * Pinax-Electron-Next · 内核统一错误码（规范 v1 第 3/4 节）。
 * 约定：所有内核拒绝都带 code + 人话 message + 可机读 details；插件不得自造码。
 */
export const NEXT_ERROR_CODES = Object.freeze({
  INVALID_MANIFEST: 'PINAX_INVALID_MANIFEST',
  DUPLICATE_PLUGIN: 'PINAX_DUPLICATE_PLUGIN',
  KERNEL_INCOMPATIBLE: 'PINAX_KERNEL_INCOMPATIBLE',
  RESERVED_SLOT: 'PINAX_RESERVED_SLOT',
  TOOL_CONFLICT: 'PINAX_TOOL_CONFLICT',
  UNKNOWN_CAPABILITY: 'PINAX_UNKNOWN_CAPABILITY',
  DIR_CONFLICT: 'PINAX_DIR_CONFLICT',
  SCOPE_NOT_GRANTED: 'PINAX_SCOPE_NOT_GRANTED',
  SCOPE_OUTSIDE_OWNER: 'PINAX_SCOPE_OUTSIDE_OWNER',
  RESERVED_VIEW_TYPE: 'PINAX_RESERVED_VIEW_TYPE',
  UNKNOWN_SUBSCRIPTION: 'PINAX_UNKNOWN_SUBSCRIPTION',
  INVALID_ENTRY: 'PINAX_INVALID_ENTRY',
  INVALID_SERVICE: 'PINAX_INVALID_SERVICE',
  INVALID_MCP: 'PINAX_INVALID_MCP',
  // 批次51：效应合同的两种拒绝——setup 没交回 disposer（注册了但没法拆）／
  // 向已卸载的 owner 继续注册（等价 Cordis 的 INACTIVE_EFFECT）。
  INVALID_EFFECT: 'PINAX_INVALID_EFFECT',
  EFFECT_ON_DISPOSED: 'PINAX_EFFECT_ON_DISPOSED',
  PATH_OUTSIDE_PROJECT: 'PINAX_PATH_OUTSIDE_PROJECT',
  STALE_REVISION: 'PINAX_STALE_REVISION',
  DEPENDENCY_UNMET: 'PINAX_DEPENDENCY_UNMET',
  PRIMARY_CARRIER_MISSING: 'PINAX_PRIMARY_CARRIER_MISSING',
  PRIMARY_CARRIER_NOT_ENABLED: 'PINAX_PRIMARY_CARRIER_NOT_ENABLED',
  IO_FAILED: 'PINAX_IO_FAILED',
  INVALID_INPUT: 'PINAX_INVALID_INPUT'
})

export function ok(value) {
  return { ok: true, value }
}

export function fail(code, message, details) {
  const error = { code: NEXT_ERROR_CODES[code] ?? NEXT_ERROR_CODES.INVALID_INPUT, message }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, error }
}

/** 把 fail() 的载荷抛成 Error，供 async 出口统一使用。 */
export function throwFailure(result) {
  const error = new Error(result.error?.message ?? 'Pinax-Next operation failed')
  error.code = result.error?.code ?? NEXT_ERROR_CODES.INVALID_INPUT
  error.details = result.error?.details ?? null
  throw error
}
