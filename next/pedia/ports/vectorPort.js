/**
 * VectorPort 端口（Core-shape：指纹向量化与相似检索）。
 *
 * 实现方：宿主（本地 embedding 服务／远端 API）。域内只允许通过此端口用向量，
 * 不直接读模型文件、不依赖任何具体 provider。
 *
 * @typedef {Object} SearchHit
 * @property {string} id    条目 id
 * @property {number} score 相似度（越大越相似，归一化由实现方负责）
 *
 * @typedef {Object} VectorPort
 * @property {(texts: string[]) => Promise<number[][]>} embed  文本批量化向量
 * @property {(query: {vector: number[], k?: number, filter?: Object}) => Promise<SearchHit[]>} search
 */

export const VECTOR_PORT_METHODS = Object.freeze(['embed', 'search'])

export function isVectorPort(candidate) {
  if (!candidate || typeof candidate !== 'object') return false
  return VECTOR_PORT_METHODS.every((method) => typeof candidate[method] === 'function')
}

export function assertVectorPort(candidate) {
  if (!isVectorPort(candidate)) {
    throw new TypeError(`VectorPort 端口缺方法：需要 ${VECTOR_PORT_METHODS.join('/')}`)
  }
  return candidate
}
