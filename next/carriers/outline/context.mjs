import { OUTLINE_CARRIER_ID } from './manifest.mjs'
import { createOutlineTools } from './tools.mjs'

/**
 * 大纲载体的上下文块构建器（协议 v1.1-A：从小说载体的 context.mjs 整块迁出）。
 * 约定与小说/设定同一套：`createOutlineBlocks(projectCtx)` 返回 `{ kind: async (askCtx) => 素材包 }`，
 * 素材包 = { blocks:[{kind, content, sourceRefs}], warnings:[] }；读不到只记账，不硬失败。
 * 取数只有一条路：复用载体自己的 pinax_outline_read——上下文块与面板看到的是同一份节点表。
 * 只给「节点标题＋摘要」清单，不把 edges 铺进上下文（层级语义在面板与工具返回值里，不在这里重编一份）。
 */
const OUTLINE_NODE_LIMIT = 120

export const OUTLINE_CONTEXT_KINDS = Object.freeze(['outline'])

export function createOutlineBlocks(context = {}) {
  const pluginId = context.pluginId ?? OUTLINE_CARRIER_ID
  const fileService = context.fileService ?? null
  const tools = createOutlineTools({ ...context, pluginId, fileService })

  async function call(name, args) {
    const tool = tools.find((item) => item.name === name)
    if (!tool) return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: `大纲载体没有工具 ${name}` } }
    return tool.run(args ?? {})
  }

  return {
    outline: async () => outlineBlock(call)
  }
}

async function outlineBlock(call) {
  const read = await call('pinax_outline_read', { maxNodes: OUTLINE_NODE_LIMIT })
  if (!read.ok) return { blocks: [], warnings: [`大纲块未取得：${read.error.message}`], target: null }
  const warnings = []
  if (read.value.warning) warnings.push(read.value.warning)
  if (read.value.truncated) warnings.push(`大纲节点超过 ${OUTLINE_NODE_LIMIT} 个，只附带前 ${OUTLINE_NODE_LIMIT} 个。`)

  if (Array.isArray(read.value.nodes) && read.value.nodes.length) {
    const lines = read.value.nodes.map((node) => {
      const title = String(node.title || node.id || '（未命名）')
      const summary = String(node.summary || '').trim()
      return `- ${title}${summary ? `：${summary}` : ''}`
    })
    return {
      blocks: [{
        kind: 'outline',
        content: `# 故事大纲（${read.value.nodeTotal} 个节点，取自 ${read.value.source}）\n${lines.join('\n')}`,
        sourceRefs: [`outline:${read.value.source}`]
      }],
      warnings,
      target: null
    }
  }
  const prose = String(read.value.text || '').trim()
  if (!prose) return { blocks: [], warnings: [...warnings, '大纲为空，未附带大纲块。'], target: null }
  return {
    blocks: [{
      kind: 'outline',
      content: `# 故事大纲（散文稿，非结构化）\n${prose}`,
      sourceRefs: [`outline:${read.value.source}`]
    }],
    warnings,
    target: null
  }
}

export default createOutlineBlocks
