import { createPinaxMcpServer, tools as kernelTools } from '../../server/mcp/createMcpServer.js'
import { collectCarrierTools, createAggregatedMcpServer } from './surfaceAggregate.mjs'
import { KERNEL_WRITE_TOOL_NAMES, guardKernelToolCall } from './kernelWriteGuard.mjs'
import { loadSkills } from '../skills/loadSkills.mjs'
import { createSkillTools, SKILL_READ_TOOL } from './skillTools.mjs'

/**
 * 运行时的工具面（WP3 → M2 · WP6）。
 * 两条出口分成两个函数，别混：
 *   createMcpSurface()     —— 纯内核 19 工具（stdio 出口、旧验收路径仍用它，行为与 M1 一致）；
 *   createRuntimeSurface() —— 内核 ∪ 启用载体声明的工具，是主进程运行时实际连的那一面。
 * 「工具面从载体清单聚合」到这里才算真做了：认领＝同名接管，没认领＝内核兜底，
 * 声明了却没实现的只进 withoutImplementation 记账，绝不虚列一个点了会炸的工具。
 */
export const SURFACE_NAME = 'pinax-runtime'
export const SURFACE_VERSION = '0.2.0'

/** 内核工具 → 将来应认领它的载体能力（搬迁底稿；kernel.* 表示永久归内核）。 */
export const TOOL_CAPABILITY_HINTS = Object.freeze({
  pinax_project_list: 'kernel.project.access',
  pinax_project_open: 'kernel.project.access',
  pinax_project_init: 'kernel.project.access',
  pinax_project_import: 'kernel.project.access',
  pinax_project_context: 'kernel.project.context',
  pinax_chapter_list: 'text.chapters',
  pinax_chapter_read: 'text.chapters',
  pinax_chapter_write: 'text.chapters',
  pinax_chapter_import: 'text.chapters',
  pinax_outline_read: 'outline.tree',
  pinax_worldbook_list: 'setting.entries',
  pinax_worldbook_read: 'setting.entries',
  pinax_worldbook_write: 'setting.entries',
  pinax_rule_write: 'constraint.rules',
  pinax_knowledge_search: 'reference.documents',
  pinax_project_index: 'reference.documents',
  pinax_agent_ask: 'kernel.runtime.ask',
  pinax_expert_list: 'kernel.runtime.expert',
  pinax_expert_invoke: 'kernel.runtime.expert'
})

/** 内核那一份，原样不动：不开聚合、不接载体。 */
export function createMcpSurface(options = {}) {
  return createPinaxMcpServer({ name: SURFACE_NAME, version: SURFACE_VERSION, ...options })
}

/**
 * 主进程运行时连的那一面。返回 { server, carrierCount, ... }；
 * server 交给 connectInProcess，聚合链路随它一起关。
 *
 * M2 批次 2 起这一条路只有一份形状：无论有没有载体进面都经聚合面出去，
 * 因为写族闸就装在聚合面「内核兜底」的那一支上——空框架（没载体）时也必须拦得住，
 * 否则「运行时不改原稿」就只在装了板块的项目里成立。
 * `aggregated` 仍按「有没有载体工具进面」记账，右栏与验收读它。
 */
export async function createRuntimeSurface({ registry, view, fileService, advisorBaseUrl, projectRoot, skillsDir } = {}) {
  const kernelServer = createPinaxMcpServer({ name: SURFACE_NAME, version: SURFACE_VERSION, advisorBaseUrl })
  const { map, missing } = collectCarrierTools({ registry, view, fileService })
  const root = projectRoot ?? view?.root ?? fileService?.root ?? null
  // 技能装载：tools 必须都在这一刻的面上（内核 ∪ 载体 ∪ 技能读取自己），缺一把就不装载并记账。
  const availableTools = [...kernelToolNames(), ...map.keys(), SKILL_READ_TOOL]
  const loaded = await loadSkills({ ...(skillsDir ? { dir: skillsDir } : {}), availableTools })
  const nativeMap = createSkillTools({ skills: loaded.skills })
  const guard = (tool, args) => guardKernelToolCall({ tool, args, root, registry })
  const aggregated = await createAggregatedMcpServer({ kernelServer, carrierMap: map, nativeMap, guard, name: SURFACE_NAME, version: SURFACE_VERSION })
  return {
    server: aggregated.server,
    carrierCount: map.size,
    carrierToolNames: [...map.keys()],
    missingImplementations: missing,
    aggregated: map.size > 0,
    writeGuard: { tools: KERNEL_WRITE_TOOL_NAMES, projectRoot: root },
    skills: {
      names: loaded.skills.map((skill) => skill.name),
      rejected: loaded.rejected,
      catalog: loaded.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        tools: [...skill.tools],
        output: skill.output
      }))
    }
  }
}

/** 写族闸的对外口径从这一处出口取，别在界面或测试里各写一份名单。 */
export { KERNEL_WRITE_TOOL_NAMES, guardClassificationGaps, guardKernelToolCall } from './kernelWriteGuard.mjs'

export function kernelToolNames() {
  return kernelTools.map((tool) => tool.name)
}

/**
 * 归属核对（M2 口径）：
 *   claimed   ＝ 内核工具里已被某个已安装载体认领的（unclaimed 必须逐批缩小，这是 M2 的进度尺）；
 *   declaredOutsideKernel ＝ 载体自有工具（内核没有的新名字）；
 *   withoutImplementation ＝ 声明了但载体没给实现、内核也接不住的——面里不会列它。
 */
export function toolOwnershipReport(registry) {
  const kernel = kernelToolNames()
  const installed = registry.list()
  const declared = new Set(installed.flatMap((manifest) => manifest.tools))
  const implemented = new Set()
  for (const manifest of installed) {
    const impl = registry.impl(manifest.id)
    if (typeof impl?.tools !== 'function') continue
    const provided = impl.tools({ pluginId: manifest.id, manifest, fileService: null, registry }) ?? []
    for (const tool of provided) if (tool && typeof tool.name === 'string') implemented.add(tool.name)
  }
  return {
    kernelCount: kernel.length,
    declaredCount: declared.size,
    unclaimed: kernel.filter((name) => !declared.has(name)),
    claimed: kernel.filter((name) => declared.has(name)),
    declaredOutsideKernel: [...declared].filter((name) => !kernel.includes(name)),
    withoutImplementation: [...declared].filter((name) => !implemented.has(name) && !kernel.includes(name)),
    unmappedHints: kernel.filter((name) => !TOOL_CAPABILITY_HINTS[name])
  }
}
