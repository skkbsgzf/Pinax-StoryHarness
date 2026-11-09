/**
 * P2a 向量聚类 usecase（纯函数 + VectorPort）：
 *   embedding 相似度 ≥ 阈值（默认 0.5）→ 单链（single-link）合并 → 别名组。
 *
 * 参照 NovelPedia `src/segment.py` 的余弦与向量丢弃口径；差异（ADR P2a）：
 *   - 这里只做「同实体表达聚合」，不切场景、不落库；
 *   - 向量一律经 VectorPort 注入（测试用假端口，零网络）；
 *   - 别名归并复用 domain/aliases.js 的 union-find（规范名＝组内最早出现的名字）。
 */

import { createAliasIndex } from '../../domain/aliases.js'
import { assertVectorPort } from '../../ports/vectorPort.js'

export const DEFAULT_CLUSTER_THRESHOLD = 0.5

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function isVector(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

/** 余弦相似度；长度不一致、空向量或含非有限数一律返回 0（不猜）。 */
export function cosineSimilarity(left, right) {
  if (!isVector(left) || !isVector(right) || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function createUnionFind(size) {
  const parent = Array.from({ length: size }, (_value, index) => index)
  const find = (index) => {
    let root = index
    while (parent[root] !== root) root = parent[root]
    let cursor = index
    while (parent[cursor] !== root) {
      const next = parent[cursor]
      parent[cursor] = root
      cursor = next
    }
    return root
  }
  const union = (left, right) => {
    const rootLeft = find(left)
    const rootRight = find(right)
    if (rootLeft === rootRight) return false
    parent[rootRight] = rootLeft
    return true
  }
  return { find, union }
}

function normalizeItems(input) {
  if (Array.isArray(input)) return input
  if (isPlainObject(input) && Array.isArray(input.items)) return input.items
  return []
}

/**
 * 向量聚类 + 别名归并。
 * @param {Object|Object[]} input
 *   数组：`[{ name, aliases?, vector?, text? }]`；
 *   对象：`{ items, vectorPort?, threshold? }`
 * @param {Object} [options] { vectorPort, threshold }
 * @returns {Promise<{ok:boolean, threshold:number, clusters:Object[], aliasIndex:Object,
 *   warnings:Object[], embedded:number}>}
 */
export async function clusterEntries(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {}
  const opts = isPlainObject(input) ? { ...options, ...source } : { ...options }
  const vectorPort = opts.vectorPort
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : DEFAULT_CLUSTER_THRESHOLD
  const rawItems = normalizeItems(input)
  const warnings = []

  const records = []
  const seenNames = new Set()
  for (const item of rawItems) {
    if (!isPlainObject(item)) continue
    const name = str(item.name).trim()
    if (!name) {
      warnings.push({ code: 'CLUSTER_NAME_MISSING', message: '聚类条目缺少 name，已跳过' })
      continue
    }
    if (seenNames.has(name)) {
      warnings.push({ code: 'CLUSTER_DUPLICATE_NAME', name, message: `聚类输入重复出现「${name}」，保留首条` })
      continue
    }
    seenNames.add(name)
    records.push({
      name,
      aliases: Array.isArray(item.aliases) ? item.aliases.map((alias) => str(alias).trim()).filter(Boolean) : [],
      text: str(item.text).trim(),
      vector: isVector(item.vector) ? [...item.vector] : null
    })
  }

  let embedded = 0
  const missing = records.filter((record) => !record.vector)
  if (missing.length) {
    if (!vectorPort) {
      warnings.push({
        code: 'NO_VECTORS',
        count: missing.length,
        message: `有 ${missing.length} 条缺向量且未注入 VectorPort，只能各自成簇`
      })
    } else {
      assertVectorPort(vectorPort)
      try {
        const vectors = await vectorPort.embed(missing.map((record) => record.text || record.name))
        missing.forEach((record, index) => {
          const vector = Array.isArray(vectors) ? vectors[index] : null
          if (isVector(vector)) {
            record.vector = vector.map(Number)
            embedded += 1
          } else {
            warnings.push({
              code: 'EMBED_MISSING',
              name: record.name,
              message: `VectorPort.embed 没有返回「${record.name}」的合法向量，按单簇处理`
            })
          }
        })
      } catch (error) {
        warnings.push({
          code: 'EMBED_FAILED',
          message: `VectorPort.embed 失败：${str(error?.message ?? error)}`
        })
      }
    }
  }

  const unionFind = createUnionFind(records.length)
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      const a = records[left]
      const b = records[right]
      if (!a.vector || !b.vector) continue
      if (a.vector.length !== b.vector.length) {
        warnings.push({
          code: 'VECTOR_DIM_MISMATCH',
          pair: [a.name, b.name],
          message: `「${a.name}」与「${b.name}」向量维度不同，不参与聚类`
        })
        continue
      }
      if (cosineSimilarity(a.vector, b.vector) >= threshold) unionFind.union(left, right)
    }
  }

  const grouped = new Map()
  records.forEach((record, index) => {
    const root = unionFind.find(index)
    if (!grouped.has(root)) grouped.set(root, [])
    grouped.get(root).push(index)
  })

  const clusters = [...grouped.values()]
    .sort((left, right) => left[0] - right[0])
    .map((indices) => {
      const members = indices.map((index) => records[index])
      const canonical = members[0].name
      const aliases = []
      for (const member of members) {
        if (member.name !== canonical && !aliases.includes(member.name)) aliases.push(member.name)
        for (const alias of member.aliases) {
          if (alias !== canonical && !aliases.includes(alias)) aliases.push(alias)
        }
      }
      return {
        canonical,
        members: members.map((member) => member.name),
        aliases,
        size: members.length
      }
    })

  const aliasIndex = createAliasIndex()
  for (const cluster of clusters) aliasIndex.add(cluster.canonical, cluster.aliases)

  return {
    ok: records.length > 0,
    threshold,
    clusters,
    aliasIndex,
    warnings,
    embedded
  }
}
