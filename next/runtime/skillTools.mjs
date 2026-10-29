import { readSkillBody } from '../skills/loadSkills.mjs'

/**
 * 技能读取工具（M2.5-B · 任务一）。
 *
 * 为什么是工具而不是把正文塞进系统提示：渐进披露。系统提示里只有一行描述，
 * 模型真要按某个方法做事时才展开全文——否则五个技能的正文会长期占着预算。
 *
 * 归运行时的原生工具（不经 server/mcp 的那份内核清单）：它的数据源是 next/skills/，
 * 与内核的 19 把项目工具不是同一类东西。只读，不写盘。
 */
export const SKILL_READ_TOOL = 'pinax_skill_read'

export const SKILL_READ_DESCRIPTOR = Object.freeze({
  name: SKILL_READ_TOOL,
  title: '读取技能',
  description: '读取一个创作技能的完整方法说明（步骤与禁止项）。系统提示里只有技能名与一句话，真正执行前用这把工具展开正文。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80, description: '技能名，必须是技能清单里列出的那个' }
    }
  },
  annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true })
})

/**
 * @param {{ skills?: Array<object> }} [input]
 * @returns {Map<string, { pluginId: string, tool: object }>} 与载体工具同形的 map，交给聚合面
 */
export function createSkillTools({ skills = [] } = {}) {
  const map = new Map()
  map.set(SKILL_READ_TOOL, {
    pluginId: 'kernel.runtime.skill',
    tool: {
      ...SKILL_READ_DESCRIPTOR,
      run(args = {}) {
        const name = String(args?.name ?? '').trim()
        if (!name) return { ok: false, error: { code: 'INVALID_INPUT', message: '缺 name：要读哪个技能' } }
        const read = readSkillBody(skills, name)
        if (!read.ok) return { ok: false, error: { code: 'INVALID_INPUT', message: read.error.message } }
        return { ok: true, value: read.value }
      }
    }
  })
  return map
}
