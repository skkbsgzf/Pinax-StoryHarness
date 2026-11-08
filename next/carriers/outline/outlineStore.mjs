import { fail as coreFail, ok as coreOk } from '@pinax/core/contracts/result'
import { CORE_ERROR_CODES } from '@pinax/core/contracts/errors'
import { normalizeOutlineNode, outlineNodeRevision } from '@pinax/core/domain/outlineNode'
import { normalizeOutlineEdge, outlineEdgeKey } from '@pinax/core/domain/outlineEdge'
import { planOutlineMove } from '@pinax/core/domain/outlineTree'
import { createSyncOutlineEdgeService } from '@pinax/core/usecases/syncOutlineEdgeService'
import { fail, ok } from '../../kernel/errors.mjs'
import { OUTLINE_CARRIER_ID } from './manifest.mjs'

/**
 * T5：fileService → Core 大纲语义的薄适配器。
 *
 * 分工（这一层不发明规则）：
 *   - 落盘仍是「大纲/outline.json 整份覆盖」，文件服务三道闸（归属／file:大纲:rw／修订并发）一个字节没搬；
 *   - 节点语义用 Core：normalizeOutlineNode 定 id/title/parentId/order/status/revision；重复 id 按
 *     DUPLICATE_OUTLINE_NODE 拒；声明了 parentId 的节点走 planOutlineMove 的父存在与环检测（Core 0.6 招牌）；
 *   - 边语义用 Core：legacy 的 {from,to}/{source,target} 在适配器里映射成 Core 边（缺 id 用端点合成，
 *     kind 缺省 causes），交给 createSyncOutlineEdgeService 判自环、端点存在与 (kind,from,to) 去重；
 *   - 校验视图只读：**落盘仍是作者原文**（节点/边的其余字段与形状原样保留），不把 Core 的默认字段
 *     （intent/parentId/order/status/revision）静默补进作者文档。
 *
 * 错误码只在 toHostResult 一处翻译：fileService 的 PINAX_* 原样放行，Core 裸码按表翻译，
 * 未登记的一律 INVALID_INPUT，绝不把 CORE_ERROR_CODES 漏出载体边界。
 */
const OUTLINE_FILE = 'outline.json'

const HOST_ERROR_KEY_BY_CORE = Object.freeze({
  [CORE_ERROR_CODES.STALE_REVISION]: 'STALE_REVISION',
  [CORE_ERROR_CODES.IO_FAILED]: 'IO_FAILED',
  [CORE_ERROR_CODES.INVALID_INPUT]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.OUTLINE_NODE_NOT_FOUND]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.DUPLICATE_OUTLINE_NODE]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.OUTLINE_CYCLE]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.OUTLINE_EDGE_NOT_FOUND]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.DUPLICATE_OUTLINE_EDGE]: 'INVALID_INPUT',
  [CORE_ERROR_CODES.OUTLINE_ENDPOINT_NOT_FOUND]: 'INVALID_INPUT'
})

export function toHostResult(result) {
  if (!result || result.ok) return result
  const error = result.error ?? {}
  const code = String(error.code ?? '')
  if (code.startsWith('PINAX_')) return result
  const key = HOST_ERROR_KEY_BY_CORE[code] ?? 'INVALID_INPUT'
  return fail(key, typeof error.message === 'string' && error.message ? error.message : '大纲操作失败', error.details)
}

function text(value) {
  return String(value ?? '').trim()
}

function edgeEndpoints(raw) {
  return {
    from: text(raw?.fromNodeId ?? raw?.from ?? raw?.source),
    to: text(raw?.toNodeId ?? raw?.to ?? raw?.target)
  }
}

// legacy 边没有 id：用 kind+端点合成稳定的定位键；id 与 (kind,from,to) 两重判重都按 Core 规则来。
function hostEdgeId(raw, from, to) {
  return text(raw?.id) || `legacy-${text(raw?.kind) || 'causes'}:${from}->${to}`
}

/** 给 Core 边用例的只读节点视图：端口要的六个方法都在，写方法永不被调用。 */
function createDocumentNodeStore(nodes) {
  const readonly = () => coreFail(CORE_ERROR_CODES.INVALID_INPUT, '大纲文档校验视图只读，不支持写入')
  return {
    list() {
      return coreOk(nodes.slice())
    },
    read(_bookId, nodeId) {
      const id = text(nodeId)
      return coreOk(nodes.find((node) => node.id === id) ?? null)
    },
    create: readonly,
    update: readonly,
    move: readonly,
    remove: readonly
  }
}

/** 给 Core 边用例的落地视图：按 OutlineEdgeStore 端口判 id 与 (kind,from,to) 重复。 */
function createDocumentEdgeStore() {
  const records = []
  return {
    list() {
      return coreOk(records.slice())
    },
    add(_bookId, edge) {
      const record = normalizeOutlineEdge(edge)
      if (!record) return coreFail(CORE_ERROR_CODES.INVALID_INPUT, '边形状无效')
      const key = outlineEdgeKey(record)
      const duplicate = records.some((existing) => existing.id === record.id || outlineEdgeKey(existing) === key)
      if (duplicate) {
        return coreFail(CORE_ERROR_CODES.DUPLICATE_OUTLINE_EDGE, '边已存在', {
          kind: record.kind,
          fromNodeId: record.fromNodeId,
          toNodeId: record.toNodeId
        })
      }
      records.push(record)
      return coreOk(record)
    },
    remove(_bookId, edgeId) {
      const id = text(edgeId)
      const index = records.findIndex((edge) => edge.id === id)
      if (index < 0) return coreFail(CORE_ERROR_CODES.OUTLINE_EDGE_NOT_FOUND, '边不存在', { edgeId: id })
      const [removed] = records.splice(index, 1)
      return coreOk(removed)
    }
  }
}

/**
 * 整份文档的 Core 语义校验（只读，不改 document）：
 *   1) 节点逐个 normalizeOutlineNode；重复 id → DUPLICATE_OUTLINE_NODE；
 *   2) 声明了 parentId 的节点走 planOutlineMove（父存在、非自身、非后代环）；
 *   3) 边映射成 Core 边后交给 sync 边用例（自环、端点存在、去重）。
 * 传统 {from,to} 边图的层级仍归宿主 projections（next/shell/outlineTree.mjs）：
 * Core 的树是 parentId 模型，没有「边图环」规则；这里不替它发明一条。
 */
export function validateOutlineDocument({ nodes, edges } = {}) {
  const nodeList = Array.isArray(nodes) ? nodes : []
  const normalizedNodes = []
  const seen = new Set()
  for (const [index, raw] of nodeList.entries()) {
    const node = normalizeOutlineNode(raw)
    if (!node) {
      return toHostResult(coreFail(CORE_ERROR_CODES.INVALID_INPUT, `nodes[${index}] 不是有效的大纲节点`, { index }))
    }
    if (seen.has(node.id)) {
      return toHostResult(coreFail(CORE_ERROR_CODES.DUPLICATE_OUTLINE_NODE, '节点 id 重复', { nodeId: node.id, index }))
    }
    seen.add(node.id)
    normalizedNodes.push(node)
  }

  for (const node of normalizedNodes) {
    if (!node.parentId) continue
    const planned = planOutlineMove(normalizedNodes, {
      nodeId: node.id,
      parentId: node.parentId,
      order: node.order,
      expectedRevision: outlineNodeRevision(node)
    })
    if (!planned.ok) return toHostResult(planned)
  }

  const edgeService = createSyncOutlineEdgeService({
    store: createDocumentEdgeStore(),
    nodeStore: createDocumentNodeStore(normalizedNodes)
  })
  for (const raw of Array.isArray(edges) ? edges : []) {
    const { from, to } = edgeEndpoints(raw)
    const added = edgeService.add('outline', {
      id: hostEdgeId(raw, from, to),
      from,
      to,
      kind: raw?.kind,
      sourceRefs: raw?.sourceRefs
    })
    if (!added.ok) return toHostResult(added)
  }

  return ok(true)
}

export function createOutlineDocumentStore({ pluginId = OUTLINE_CARRIER_ID, fileService, dir } = {}) {
  if (!fileService || typeof fileService.read !== 'function' || typeof fileService.write !== 'function') {
    throw new TypeError('createOutlineDocumentStore 需要已打开项目的文件服务（read/write）')
  }
  if (typeof dir !== 'string' || !dir) throw new TypeError('createOutlineDocumentStore 需要大纲板块目录')

  const label = `${dir}/${OUTLINE_FILE}`

  return Object.freeze({
    async read() {
      return toHostResult(await fileService.read({ pluginId, dir, file: OUTLINE_FILE }))
    },

    parse(textValue, relativePath = label) {
      let parsed
      try {
        parsed = JSON.parse(textValue)
      } catch (error) {
        return fail('IO_FAILED', `「${label}」不是合法 JSON：${String(error?.message || error)}`, { path: relativePath })
      }
      const hasNodes = Array.isArray(parsed?.nodes)
      return ok({
        nodes: hasNodes ? parsed.nodes : [],
        edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
        warning: hasNodes ? null : 'outline.json 里没有 nodes 数组，按空大纲返回'
      })
    },

    validate(document) {
      return validateOutlineDocument(document)
    },

    async write(document, { expectedRevision } = {}) {
      return toHostResult(await fileService.write({
        pluginId,
        dir,
        file: OUTLINE_FILE,
        text: JSON.stringify(document, null, 2),
        expectedRevision
      }))
    }
  })
}

export default createOutlineDocumentStore
