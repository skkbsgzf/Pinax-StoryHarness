/**
 * 条目生命周期状态机（domain 真源，Core 平移件）。
 *
 * 同态转移按幂等放行；非法转移直接拒。状态词表见 ./vocabulary.js。
 */

import { ENTRY_STATUSES, STATUS_TRANSITIONS } from './vocabulary.js'

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

/** 合法转移判定；同状态按幂等放行。 */
export function canTransitionStatus(from, to) {
  const source = str(from)
  const target = str(to)
  if (!ENTRY_STATUSES.includes(source) || !ENTRY_STATUSES.includes(target)) return false
  if (source === target) return true
  return (STATUS_TRANSITIONS[source] ?? []).includes(target)
}

/**
 * 校验一次状态迁移。
 * 返回 { ok, from, to, allowed } 或 { ok:false, code, message, from, to, allowed }。
 */
export function validateStatusTransition(from, to) {
  const source = str(from)
  const target = str(to)
  const allowed = [...(STATUS_TRANSITIONS[source] ?? [])]
  if (!ENTRY_STATUSES.includes(source)) {
    return { ok: false, code: 'UNKNOWN_STATUS', message: `未知状态：${source || '空'}`, from: source, to: target, allowed: [...ENTRY_STATUSES] }
  }
  if (!ENTRY_STATUSES.includes(target)) {
    return { ok: false, code: 'UNKNOWN_STATUS', message: `未知目标状态：${target || '空'}`, from: source, to: target, allowed: [...ENTRY_STATUSES] }
  }
  if (!canTransitionStatus(source, target)) {
    return { ok: false, code: 'ILLEGAL_STATUS_TRANSITION', message: `${source} → ${target} 不是合法转移（允许：${allowed.join('/') || '无'}）`, from: source, to: target, allowed }
  }
  return { ok: true, from: source, to: target, allowed }
}

/** 条目状态迁移：非法转移直接拒，合法时返回新条目（不改原对象）。 */
export function transitionEntryStatus(entry, to) {
  if (!isPlainObject(entry)) {
    return { ok: false, error: { code: 'INVALID_ENTRY', message: '转移状态的条目必须是对象' } }
  }
  const check = validateStatusTransition(entry.status, to)
  if (!check.ok) return { ok: false, error: check }
  return { ok: true, from: check.from, to: check.to, entry: { ...entry, status: check.to } }
}
