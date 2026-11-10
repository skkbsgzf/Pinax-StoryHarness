/**
 * 双时间轴（validity）纯函数（domain 真源，Core 平移件）。
 *
 * validity = { from, to }：整数章／场序或 null（无界）。
 * 条目在某个 span 内是否「生效」＝两个区间的交集非空；null 视为无界。
 */

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null
}

/** 校验 validity 形状；与 v2 信封校验同码同文案。undefined 视为未提供（合法）。 */
export function validateValidityShape(validity) {
  const errors = []
  if (validity === undefined) return { ok: true, errors }
  if (!isPlainObject(validity)) {
    errors.push({ code: 'VALIDITY_SHAPE', field: 'validity', message: 'validity 必须是 { from, to } 对象' })
    return { ok: false, errors }
  }
  for (const key of ['from', 'to']) {
    const value = validity[key]
    if (value !== undefined && value !== null && !Number.isInteger(value)) {
      errors.push({ code: 'VALIDITY_VALUE', field: `validity.${key}`, message: 'from/to 必须是整数或 null' })
    }
  }
  if (Number.isInteger(validity.from) && Number.isInteger(validity.to) && validity.from > validity.to) {
    errors.push({ code: 'VALIDITY_RANGE', field: 'validity', message: 'validity.from 不能大于 validity.to' })
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 把查询里的 span 归一成 { from, to }。
 *   整数           → { from: n, to: n }
 *   { from, to }   → 缺省一侧补 null
 *   其他／未提供   → { from: null, to: null }（无界）
 */
export function normalizeSpan(span) {
  if (Number.isInteger(span)) return { from: span, to: span }
  if (!isPlainObject(span)) return { from: null, to: null }
  return { from: integerOrNull(span.from), to: integerOrNull(span.to) }
}

/** validity 的边界读数（null 保留 null，不编造 0 或无穷）。 */
export function validityBounds(validity) {
  if (!isPlainObject(validity)) return { from: null, to: null }
  return { from: integerOrNull(validity.from), to: integerOrNull(validity.to) }
}

/** 两个区间是否相交；null 视为无界。 */
export function spansOverlap(left, right) {
  const a = normalizeSpan(left)
  const b = normalizeSpan(right)
  if (a.from !== null && b.to !== null && a.from > b.to) return false
  if (a.to !== null && b.from !== null && a.to < b.from) return false
  return true
}

/** 条目在某个时点／区间是否生效（validity 缺省＝无界＝生效）。 */
export function isActiveAt(validity, atSpan) {
  return spansOverlap(validityBounds(validity), normalizeSpan(atSpan))
}

/** 两个 validity 的交集；任一侧完全无界时返回另一侧。无交集返回 null。 */
export function intersectValidity(left, right) {
  if (!spansOverlap(left, right)) return null
  const a = validityBounds(left)
  const b = validityBounds(right)
  const from = a.from === null ? b.from : (b.from === null ? a.from : Math.max(a.from, b.from))
  const to = a.to === null ? b.to : (b.to === null ? a.to : Math.min(a.to, b.to))
  return { from, to }
}

/**
 * 从 span（first_chapter/last_chapter 或 first_scene/last_scene）推 validity。
 * 这是迁移器（v1→v2）与锚点转换共用的口径；没有锚点时给 null/null。
 */
export function validityFromSpan(span) {
  if (!isPlainObject(span)) return { from: null, to: null }
  if (Number.isInteger(span.first_chapter) || Number.isInteger(span.last_chapter)) {
    return {
      from: Number.isInteger(span.first_chapter) ? span.first_chapter : null,
      to: Number.isInteger(span.last_chapter) ? span.last_chapter : null
    }
  }
  if (Number.isInteger(span.first_scene) || Number.isInteger(span.last_scene)) {
    return {
      from: Number.isInteger(span.first_scene) ? span.first_scene : null,
      to: Number.isInteger(span.last_scene) ? span.last_scene : null
    }
  }
  return { from: null, to: null }
}
