/**
 * PediaStore 端口（Core-shape：只定契约，不落实现）。
 *
 * 实现方：adapters/memoryPediaStore.mjs（参考实现）与宿主（Next 侧接项目文件存储，
 * 迁 Core 后接 createProjectTransactionService）。
 *
 * 写事务口径（与 Core 事务三件套对齐，迁移时直接换成 core 的事务服务）：
 *   - operationId：每次写操作必须带，同一 operationId 重放返回首次结果（幂等，duplicate=true）；
 *   - expectedRevision：更新必须带「读到的 revision」，与当前不符返回 REVISION_MISMATCH（乐观并发）；
 *     新建时 expectedRevision 为 0 或缺省。
 *
 * @typedef {Object} StoredEntry
 * @property {Object} entry   pedia/v2 条目（不可变快照）
 * @property {number} revision 该条目当前的 revision（从 1 起）
 *
 * @typedef {Object} SaveOptions
 * @property {string} operationId 幂等键（必填）
 * @property {number} [expectedRevision] 乐观并发期望值；新建给 0 或缺省
 *
 * @typedef {Object} SaveResult
 * @property {boolean} ok
 * @property {Object} [entry]       已落库的条目（带回填的 status 等）
 * @property {number} [revision]
 * @property {boolean} [duplicate]  同一 operationId 的重放
 * @property {Array} [warnings]     校验警告（不拦写）
 * @property {string} [code]        失败码：OPERATION_ID_REQUIRED / VALIDATION_FAILED /
 *                                  REVISION_MISMATCH / NOT_FOUND / OPERATION_CONFLICT
 * @property {Object} [error]       失败详情（含 currentRevision 等）
 *
 * @typedef {Object} PediaStore
 * @property {(id: string) => Promise<StoredEntry|null>} get
 * @property {(filter?: {layer?: string, domain?: string, slot?: string, status?: string,
 *            atSpan?: number|{from?: number, to?: number}}) => Promise<{entries: StoredEntry[], total: number}>} list
 * @property {(entry: Object, options: SaveOptions) => Promise<SaveResult>} save
 * @property {(id: string, options: SaveOptions) => Promise<SaveResult>} remove
 */

export const PEDIA_STORE_METHODS = Object.freeze(['get', 'list', 'save', 'remove'])

export const PEDIA_STORE_WRITE_CODES = Object.freeze([
  'OPERATION_ID_REQUIRED',
  'VALIDATION_FAILED',
  'REVISION_MISMATCH',
  'NOT_FOUND',
  'OPERATION_CONFLICT'
])

/** 实现是否满足端口形状（鸭子类型，不要求继承）。 */
export function isPediaStore(candidate) {
  if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) return false
  return PEDIA_STORE_METHODS.every((method) => typeof candidate[method] === 'function')
}

export function assertPediaStore(candidate) {
  if (!isPediaStore(candidate)) {
    throw new TypeError(`PediaStore 端口缺方法：需要 ${PEDIA_STORE_METHODS.join('/')}`)
  }
  return candidate
}
