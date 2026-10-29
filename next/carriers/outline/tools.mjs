import { fail, ok } from '../../kernel/errors.mjs'
import { OUTLINE_CARRIER, OUTLINE_CARRIER_ID } from './manifest.mjs'

/**
 * 大纲载体的工具实现（协议 v1.1-A：从小说载体整块迁出，语义一字不改）。
 * 读盘一律走内核文件服务——归属闸、file:大纲:rw 作用域闸、修订并发都在那边。
 *
 * pinax_outline_read：优先读「大纲/outline.json」的节点与连线；只有 大纲.md 时返回原文与警告，
 *   绝不把散文编成节点树；两样都没有就如实回 INVALID_INPUT（新建项目的常态，界面据此给「新建大纲」）。
 * pinax_outline_save：整份覆盖「大纲/outline.json」——nodes 是全量（改名/增删后整份写回），
 *   不收增量、不做合并；首次建档传 expectedRevision 0，改稿必须带回 read 给的修订号。
 *   大纲的层级语义住在 edges（from→to）里，保存原样落盘。
 */
const OUTLINE_DIR = OUTLINE_CARRIER.dataDirs.outline

export function createOutlineTools(context = {}) {
  const pluginId = context.pluginId ?? OUTLINE_CARRIER_ID
  const fileService = context.fileService ?? null

  function needService() {
    return fileService
      ? null
      : fail('INVALID_INPUT', `载体 ${pluginId} 的工具需要已打开项目的文件服务；空框架下请回落内核工具`, { pluginId })
  }

  return [
    {
      name: 'pinax_outline_read',
      title: '读取大纲（大纲载体）',
      description: '优先读「大纲/outline.json」的节点与连线；只有 大纲.md 时返回原文与警告，绝不把散文编成节点树。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          maxNodes: { type: 'integer', minimum: 1, maximum: 1000, description: '最多返回多少节点，默认 300。' }
        }
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        const maxNodes = args.maxNodes ?? 300
        if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 1000) {
          return fail('INVALID_INPUT', 'maxNodes 须是 1–1000 的整数', { got: args.maxNodes })
        }
        const structured = await fileService.read({ pluginId, dir: OUTLINE_DIR, file: 'outline.json' })
        if (structured.ok) {
          let parsed
          try {
            parsed = JSON.parse(structured.value.text)
          } catch (error) {
            return fail('IO_FAILED', `「${OUTLINE_DIR}/outline.json」不是合法 JSON：${String(error?.message || error)}`, { path: structured.value.relativePath })
          }
          const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : []
          const edges = Array.isArray(parsed?.edges) ? parsed.edges : []
          return ok({
            source: structured.value.relativePath,
            nodes: nodes.slice(0, maxNodes),
            edges,
            nodeTotal: nodes.length,
            truncated: nodes.length > maxNodes,
            revision: structured.value.revision,
            warning: Array.isArray(parsed?.nodes) ? null : 'outline.json 里没有 nodes 数组，按空大纲返回'
          })
        }
        const asText = await fileService.read({ pluginId, dir: OUTLINE_DIR, file: '大纲.md' })
        if (asText.ok) {
          return ok({
            source: asText.value.relativePath,
            nodes: [],
            edges: [],
            nodeTotal: 0,
            truncated: false,
            text: asText.value.text.slice(0, maxNodes * 200),
            revision: asText.value.revision,
            warning: '大纲只有散文稿（大纲.md），没有结构化节点；未凭空生成节点树'
          })
        }
        const listed = await fileService.list({ pluginId, dir: OUTLINE_DIR })
        return fail('INVALID_INPUT', `「${OUTLINE_DIR}/」下既没有 outline.json 也没有 大纲.md`, {
          outlineError: asText.error.code,
          entries: listed.ok ? listed.value.entries.map((entry) => entry.name) : null
        })
      }
    },
    {
      name: 'pinax_outline_save',
      title: '保存大纲（大纲载体）',
      description: '作者确认后的大纲落盘口：整份覆盖「大纲/outline.json」——nodes 是全量（pinax_outline_read 的原样回传，改名/增删后整份写回），不收增量、不做合并；首次建档传 expectedRevision 0，改稿必须带回 read 给的修订号，不符即 PINAX_STALE_REVISION。写 大纲/ 走文件服务三道闸（归属＋file:大纲:rw＋并发）。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['nodes', 'expectedRevision'],
        properties: {
          nodes: {
            type: 'array',
            minItems: 1,
            description: '全量节点，每条至少要有非空 id 与 title（其余字段如 type/summary 原样保留）；空数组与缺 nodes 都拒。'
          },
          edges: {
            type: 'array',
            description: '连线（from/to），可选；缺省按空数组落盘。'
          },
          expectedRevision: { type: 'integer', minimum: 0, description: 'pinax_outline_read 给的修订号；首次建档传 0。' }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args = {}) => {
        const missing = needService()
        if (missing) return missing
        if (!Array.isArray(args.nodes)) return fail('INVALID_INPUT', 'nodes 必须是数组（整份覆盖，不收增量）', { got: typeof args.nodes })
        if (!args.nodes.length) return fail('INVALID_INPUT', 'nodes 不能为空：要清空大纲请删文件，不在保存口留空文档')
        for (const [index, node] of args.nodes.entries()) {
          if (!node || typeof node !== 'object' || Array.isArray(node)) {
            return fail('INVALID_INPUT', `nodes[${index}] 不是对象`, { got: node === null ? 'null' : typeof node })
          }
          if (typeof node.id !== 'string' || !node.id.trim()) return fail('INVALID_INPUT', `nodes[${index}] 缺非空 id`, { title: node.title ?? null })
          if (typeof node.title !== 'string' || !node.title.trim()) return fail('INVALID_INPUT', `nodes[${index}] 缺非空 title`, { id: node.id })
        }
        if (args.edges !== undefined && !Array.isArray(args.edges)) {
          return fail('INVALID_INPUT', 'edges 须是数组（每条含 from/to）', { got: typeof args.edges })
        }
        if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
          return fail('INVALID_INPUT', 'expectedRevision 必填：改稿带回 pinax_outline_read 给的修订号，首次建档传 0')
        }
        const document = { nodes: args.nodes, edges: args.edges ?? [] }
        const written = await fileService.write({ pluginId, dir: OUTLINE_DIR, file: 'outline.json', text: JSON.stringify(document, null, 2), expectedRevision: args.expectedRevision })
        if (!written.ok) return written
        return ok({
          file: written.value.relativePath,
          revision: written.value.revision,
          nodeTotal: args.nodes.length,
          sha256: written.value.sha256,
          bytes: written.value.bytes
        })
      }
    }
  ]
}

/** 大纲板块的工具名：一把从内核认领的只读名＋一把载体自有写入口；供门禁核「认领面只增不减」。 */
export const OUTLINE_TOOL_NAMES = Object.freeze(['pinax_outline_read', 'pinax_outline_save'])

export default createOutlineTools
