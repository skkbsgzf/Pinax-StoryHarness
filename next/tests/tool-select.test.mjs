import test from 'node:test'
import assert from 'node:assert/strict'
import { selectTools, TOOL_SELECT_LIMIT } from '../runtime/toolSelect.mjs'

/**
 * 工具披露（M2.5-A · 任务一）。
 * 这一层不调模型，所以每条规则都能钉死：技能优先、上下文恒定、写意图按域、
 * 上限 6、缺工具记账、结果顺序可复现。
 */

const NAMES = [
  'pinax_project_context',
  'pinax_outline_read',
  'pinax_outline_save',
  'pinax_chapter_read',
  'pinax_chapter_save',
  'pinax_worldbook_read',
  'pinax_worldbook_save',
  'pinax_rule_save',
  'pinax_script_read',
  'pinax_notes_save',
  'pinax_knowledge_search'
]
const TOOLS = NAMES.map((name) => ({ name }))

test('命中技能：按声明取，缺的工具记 dropped', () => {
  const result = selectTools({
    tools: TOOLS,
    intent: '随便说点什么',
    skill: { tools: ['pinax_outline_read', 'pinax_outline_save', 'pinax_unknown_tool'] }
  })
  assert.deepEqual(result.names, ['pinax_project_context', 'pinax_outline_read', 'pinax_outline_save'])
  assert.deepEqual(result.dropped, [{ name: 'pinax_unknown_tool', reason: 'not-on-surface' }])
})

test('没有技能时恒定带上下文块', () => {
  const result = selectTools({ tools: TOOLS, intent: '看看这一章' })
  assert.equal(result.names[0], 'pinax_project_context')
})

test('写意图 + 大纲域：只披露大纲的写工具，其余给读工具', () => {
  const result = selectTools({ tools: TOOLS, intent: '把大纲第二卷的支线合并一下' })
  assert.ok(result.names.includes('pinax_outline_save'))
  assert.ok(result.names.includes('pinax_outline_read'))
  assert.ok(result.names.filter((name) => /_save$|_write$|_import$/u.test(name)).length <= 2)
  assert.ok(result.names.length <= TOOL_SELECT_LIMIT)
})

test('没有写意图：一把写工具都不披露', () => {
  const result = selectTools({ tools: TOOLS, intent: '大纲现在长什么样' })
  assert.equal(result.names.filter((name) => /_save$|_write$|_import$/u.test(name)).length, 0)
})

test('上限硬封顶，多出来的记 limit', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({ name: `pinax_tool_${index}_read` }))
  const result = selectTools({ tools: many, intent: '读点东西' })
  assert.equal(result.names.length, TOOL_SELECT_LIMIT)
  assert.ok(result.dropped.some((item) => item.reason === 'limit'))
})

test('结果按面上的原顺序返回：同一输入两次跑逐项相同', () => {
  const first = selectTools({ tools: TOOLS, intent: '改世界书条目' })
  const second = selectTools({ tools: TOOLS, intent: '改世界书条目' })
  assert.deepEqual(first.names, second.names)
  assert.ok(first.names.includes('pinax_worldbook_save'))
  const indexes = first.names.map((name) => NAMES.indexOf(name))
  assert.deepEqual(indexes, [...indexes].sort((left, right) => left - right))
})
