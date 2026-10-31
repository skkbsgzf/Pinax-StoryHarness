import { fail, ok } from './errors.mjs'
import { isPlainObject, isPredicateScalar } from './carrierManifest.shared.mjs'

/**
 * 资源认领与接管（批次52，对 Cordis `ctx.sidebarRightTabs.register({ patterns, priority, canOpen, builtin|extension|fallback })`）。
 *
 *   pane.claims    glob 列表，只许项目内相对路径（禁绝对、盘符、`..`、隐藏段）
 *   pane.priority  0–100，同资源争用时高者先（消费归批次53，本批只收口值域）
 *   pane.canOpen   { field, equals|in } 声明式谓词，不许夹 JS（JSON 清单塞函数＝RCE 口）
 *   pane.takes     extension | fallback；builtin 归宿主保留，写进清单即拒
 *
 * `validateClaims` 的三件套（长度／字符集／协议白名单）与 `validateAppPane` 同纪律：
 * 这里不解析 glob，只守「形状像不像项目内路径」，真正匹配归宿主。
 */
export const PANE_TAKES = Object.freeze(['extension', 'fallback'])
/** 接管档里宿主保留的那一档：载体不得声明 builtin。 */
export const RESERVED_PANE_TAKES = Object.freeze(['builtin'])
export const PANE_CLAIMS_MAX = 64
export const PANE_CLAIM_MAX = 200
export const PANE_PRIORITY_MIN = 0
export const PANE_PRIORITY_MAX = 100
export const CAN_OPEN_IN_MAX = 32

const CLAIM_SEGMENT_PATTERN = /^[\p{Script=Han}A-Za-z0-9._*?[\]-]+$/u
const CAN_OPEN_FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/u

/** 项目内相对 glob：绝对路径、盘符、反斜杠、`.`/`..`、隐藏段与 `.pinax` 全拒。 */
export function validateClaims(value, { pluginId, paneId = '?' } = {}) {
  if (value === undefined || value === null) return ok([])
  if (!Array.isArray(value)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」claims 必须是数组`, { pluginId, paneId })
  }
  if (value.length === 0) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」claims 声明了就必须非空（不声明＝不认领）`, { pluginId, paneId })
  }
  if (value.length > PANE_CLAIMS_MAX) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」claims 最多 ${PANE_CLAIMS_MAX} 条，收到 ${value.length}`, { pluginId, paneId })
  }
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string' || !raw.trim()) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」claims 项必须是非空字符串`, { pluginId, paneId })
    }
    const claim = raw.trim()
    if (claim.length > PANE_CLAIM_MAX) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」claim 过长（上限 ${PANE_CLAIM_MAX} 字）：${claim}`, { pluginId, paneId })
    }
    if (claim.includes('\0') || claim.includes('\\') || claim.includes(':') || claim.startsWith('/') || /^[a-zA-Z]:/u.test(claim)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」claim 必须是项目内相对 glob（禁绝对／盘符／反斜杠）：${claim}`, { pluginId, paneId, claim })
    }
    const segments = claim.split('/')
    if (segments.some((segment) => segment === '.pinax')) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」claim 不得伸进 .pinax/（元数据目录归内核）：${claim}`, { pluginId, paneId, claim })
    }
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」claim 含非法路径段：${claim}`, { pluginId, paneId, claim })
    }
    for (const segment of segments) {
      if (!CLAIM_SEGMENT_PATTERN.test(segment)) {
        return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」claim 字符集不合法：${claim}`, { pluginId, paneId, claim })
      }
      // `**` 只能独占一段；`a**b` 这种写法各 glob 实现口径不一，先拒。
      if (segment.includes('**') && segment !== '**') {
        return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」claim 的 ** 必须独占一段：${claim}`, { pluginId, paneId, claim })
      }
    }
    if (!out.includes(claim)) out.push(claim)
  }
  return ok(out)
}

function validateCanOpen(value, { pluginId, paneId }) {
  if (!isPlainObject(value)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」canOpen 必须是对象 { field, equals|in }`, { pluginId, paneId })
  }
  for (const key of Object.keys(value)) {
    if (!['field', 'equals', 'in'].includes(key)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」canOpen 含未知字段 "${key}"：可声明 field / equals / in`, { pluginId, paneId, key })
    }
  }
  if (typeof value.field !== 'string' || !CAN_OPEN_FIELD_PATTERN.test(value.field)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」canOpen.field 须匹配 ${CAN_OPEN_FIELD_PATTERN}`, { pluginId, paneId, field: value.field })
  }
  const hasEquals = value.equals !== undefined
  const hasIn = value.in !== undefined
  if (hasEquals === hasIn) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」canOpen 必须二选一：equals 或 in（不能都给也不能都不给）`, { pluginId, paneId })
  }
  if (hasEquals) {
    if (!isPredicateScalar(value.equals)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」canOpen.equals 只收字符串／数字／布尔`, { pluginId, paneId })
    }
    return ok({ field: value.field, equals: value.equals })
  }
  if (!Array.isArray(value.in) || value.in.length === 0 || value.in.length > CAN_OPEN_IN_MAX) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」canOpen.in 必须是 1–${CAN_OPEN_IN_MAX} 项的数组`, { pluginId, paneId })
  }
  const list = []
  for (const item of value.in) {
    if (!isPredicateScalar(item)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」canOpen.in 只收字符串／数字／布尔`, { pluginId, paneId })
    }
    if (!list.includes(item)) list.push(item)
  }
  return ok({ field: value.field, in: list })
}

/** 认领四件套一起校验：priority／canOpen／takes 离开 claims 就是死声明，直接拒。 */
export function validatePaneClaims(pane, { pluginId } = {}) {
  const paneId = String(pane.id ?? '?')
  const claims = validateClaims(pane.claims, { pluginId, paneId })
  if (!claims.ok) return claims
  const declared = pane.claims !== undefined
  let priority = 0
  if (pane.priority !== undefined) {
    if (!declared) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」声明了 priority 却没有 claims：优先级是认领的裁决档，不是空标签`, { pluginId, paneId })
    }
    if (!Number.isSafeInteger(pane.priority) || pane.priority < PANE_PRIORITY_MIN || pane.priority > PANE_PRIORITY_MAX) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」priority 须是 ${PANE_PRIORITY_MIN}–${PANE_PRIORITY_MAX} 的整数`, { pluginId, paneId, priority: pane.priority })
    }
    priority = pane.priority
  }
  let canOpen = null
  if (pane.canOpen !== undefined) {
    if (!declared) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」声明了 canOpen 却没有 claims：谓词是给认领资源用的`, { pluginId, paneId })
    }
    const predicate = validateCanOpen(pane.canOpen, { pluginId, paneId })
    if (!predicate.ok) return predicate
    canOpen = predicate.value
  }
  let takes = null
  if (pane.takes !== undefined) {
    if (RESERVED_PANE_TAKES.includes(pane.takes)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」takes=${pane.takes} 是宿主保留档，载体只能声明 ${PANE_TAKES.join(' / ')}`, { pluginId, paneId })
    }
    if (!PANE_TAKES.includes(pane.takes)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」takes 须是 ${PANE_TAKES.join(' / ')}，收到 ${String(pane.takes)}`, { pluginId, paneId })
    }
    if (!declared) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」声明了 takes 却没有 claims：接管的是被认领的资源`, { pluginId, paneId })
    }
    takes = pane.takes
  }
  return ok({ claims: claims.value, priority, canOpen, takes })
}
