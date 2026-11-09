/**
 * FactStore 的内存参考实现（适配层，供测试与无宿主场景用）。
 *
 * 事务口径与 Core 对齐（迁移时整段换成 core 的 createProjectTransactionService）：
 *   - 每次写必须带 operationId：同一 operationId 重放返回首次结果（duplicate=true），不重复落库；
 *   - 更新必须带 expectedRevision（新建给 0 或缺省）：与当前 revision 不符返回 REVISION_MISMATCH；
 *   - 条目落库前过 validateFactEntry：有硬错误拒绝写（VALIDATION_FAILED），警告随结果返回。
 *
 * 本文件不读磁盘、不依赖 node 内置模块：同一实现可在浏览器侧当缓存用。
 */

import { validateFactEntry } from '../domain/schema.js'
import { isActiveAt } from '../domain/validity.js'

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function clone(value) {
  if (value === undefined) return undefined
  if (typeof structuredClone !== 'function') return jsonClone(value)
  try {
    return structuredClone(value)
  } catch {
    // 条目都是 JSON 形状：不可 structuredClone 的值落到 JSON 克隆。
    return jsonClone(value)
  }
}

function fail(code, error) {
  return { ok: false, code, error }
}

/**
 * @param {Object[]|{entries?: Object[]}} [initial]
 */
export function createMemoryFactStore(initial = []) {
  const source = Array.isArray(initial)
    ? initial
    : (isPlainObject(initial) && Array.isArray(initial.entries) ? initial.entries : [])
  const records = new Map()
  const operations = new Map()
  const stats = { writes: 0, duplicates: 0, rejected: 0 }

  for (const entry of source) {
    if (!isPlainObject(entry) || !str(entry.id)) continue
    records.set(str(entry.id), { entry: clone(entry), revision: 1 })
  }

  const replay = (operationId) => {
    const previous = operations.get(operationId)
    if (!previous) return null
    stats.duplicates += 1
    return { ...clone(previous), duplicate: true }
  }

  const remember = (operationId, result) => {
    operations.set(operationId, clone(result))
    return result
  }

  return {
    version: 'fact-store/memory@1',

    async get(id) {
      const record = records.get(str(id))
      return record ? { entry: clone(record.entry), revision: record.revision } : null
    },

    async list(filter = {}) {
      const query = isPlainObject(filter) ? filter : {}
      const ids = Array.isArray(query.ids) ? new Set(query.ids.map(str)) : null
      const entries = []
      for (const [id, record] of records) {
        if (ids && !ids.has(id)) continue
        const entry = record.entry
        if (query.layer && entry.layer !== query.layer) continue
        if (query.domain && entry.domain !== query.domain) continue
        if (query.slot && entry.slot !== query.slot) continue
        if (query.status && entry.status !== query.status) continue
        if (query.atSpan !== undefined && !isActiveAt(entry.validity, query.atSpan)) continue
        entries.push({ entry: clone(entry), revision: record.revision })
      }
      entries.sort((left, right) => str(left.entry.name).localeCompare(str(right.entry.name), 'zh-Hans-CN'))
      return { entries, total: entries.length }
    },

    async save(entry, options = {}) {
      const opts = isPlainObject(options) ? options : {}
      const operationId = str(opts.operationId).trim()
      if (!operationId) {
        stats.rejected += 1
        return fail('OPERATION_ID_REQUIRED', { message: '写操作必须带 operationId（幂等键）' })
      }
      const duplicated = replay(operationId)
      if (duplicated) return duplicated

      const id = str(entry?.id).trim()
      if (!id) {
        stats.rejected += 1
        return fail('VALIDATION_FAILED', { message: '条目缺少 id' })
      }
      const validation = validateFactEntry(entry)
      if (!validation.ok) {
        stats.rejected += 1
        return fail('VALIDATION_FAILED', { errors: validation.errors, warnings: validation.warnings })
      }

      const current = records.get(id)
      const expected = opts.expectedRevision
      if (current) {
        if (!Number.isInteger(expected) || expected !== current.revision) {
          stats.rejected += 1
          return fail('REVISION_MISMATCH', {
            currentRevision: current.revision,
            expectedRevision: Number.isInteger(expected) ? expected : null,
            message: Number.isInteger(expected)
              ? `revision 不符：当前 ${current.revision}，期望 ${expected}`
              : '更新必须带 expectedRevision（读到的 revision）'
          })
        }
        const revision = current.revision + 1
        records.set(id, { entry: clone(entry), revision })
        stats.writes += 1
        return remember(operationId, { ok: true, entry: clone(entry), revision, duplicate: false, warnings: validation.warnings })
      }
      if (Number.isInteger(expected) && expected > 0) {
        stats.rejected += 1
        return fail('REVISION_MISMATCH', {
          currentRevision: 0,
          expectedRevision: expected,
          message: '条目不存在，expectedRevision 应给 0 或缺省'
        })
      }
      records.set(id, { entry: clone(entry), revision: 1 })
      stats.writes += 1
      return remember(operationId, { ok: true, entry: clone(entry), revision: 1, duplicate: false, warnings: validation.warnings })
    },

    async remove(id, options = {}) {
      const opts = isPlainObject(options) ? options : {}
      const operationId = str(opts.operationId).trim()
      if (!operationId) {
        stats.rejected += 1
        return fail('OPERATION_ID_REQUIRED', { message: '删除操作必须带 operationId（幂等键）' })
      }
      const duplicated = replay(operationId)
      if (duplicated) return duplicated

      const key = str(id)
      const current = records.get(key)
      if (!current) {
        stats.rejected += 1
        return fail('NOT_FOUND', { id: key, message: `条目 ${key} 不存在` })
      }
      const expected = opts.expectedRevision
      if (!Number.isInteger(expected) || expected !== current.revision) {
        stats.rejected += 1
        return fail('REVISION_MISMATCH', {
          currentRevision: current.revision,
          expectedRevision: Number.isInteger(expected) ? expected : null,
          message: '删除必须带与当前一致的 expectedRevision'
        })
      }
      records.delete(key)
      stats.writes += 1
      return remember(operationId, { ok: true, id: key, revision: null, duplicate: false })
    },

    stats() {
      return { entries: records.size, operations: operations.size, ...stats }
    }
  }
}

export default createMemoryFactStore
