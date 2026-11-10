import test from 'node:test'
import assert from 'node:assert/strict'
import { SLASH_COMMANDS, isSlashDraft, resolveSlash, slashMessageFields } from '../shell/slashCommands.mjs'

/**
 * slash 命令单测（批次27 · 任务二）。
 * 只测纯逻辑：命令词识别、模板、omit 组装、命令徽章字段——渲染层怎么弹提示归界面测。
 */

test('四条命令：名字、模板、omit 组合与工单一致', () => {
  assert.deepEqual(SLASH_COMMANDS.map((command) => command.name), ['/审阅', '/大纲', '/总结', '/资料'])

  const byName = new Map(SLASH_COMMANDS.map((command) => [command.name, command]))
  assert.deepEqual(byName.get('/审阅').omit, [])
  assert.deepEqual(byName.get('/大纲').omit, ['scene', 'memory', 'history'])
  assert.deepEqual(byName.get('/总结').omit, ['style'])
  assert.deepEqual(byName.get('/资料').omit, ['scene', 'memory', 'outline'])
  for (const command of SLASH_COMMANDS) {
    assert.ok(command.template.length > 10, `${command.name} 的模板不能是空壳`)
    assert.ok(command.desc.length > 0, `${command.name} 的提示层要有一句人话`)
  }
  // 词表是数据：冻结，界面不许就地改它。
  assert.equal(Object.isFrozen(SLASH_COMMANDS), true)
  assert.equal(Object.isFrozen(SLASH_COMMANDS[0]), true)
})

test('resolveSlash：只认草稿开头那一个命令词，命令词要成词', () => {
  const routed = resolveSlash('/资料 柯秒是谁？')
  assert.equal(routed.command.name, '/资料')
  assert.equal(routed.rest, '柯秒是谁？')
  assert.deepEqual(routed.command.omit, ['scene', 'memory', 'outline'])

  // 只有命令词：rest 是空串（RuntimeDock 会拿模板当正文）。
  assert.equal(resolveSlash('/审阅').rest, '')
  assert.equal(resolveSlash('  /总结  ').command.name, '/总结')

  // 正文里的 / 不是命令：不误伤。
  assert.equal(resolveSlash('路径是 a/b 与 c/d'), null)
  assert.equal(resolveSlash('帮我看一下 /资料 这一节'), null, '命令词必须出现在开头')
  assert.equal(resolveSlash('这一句的结尾是 / 吗'), null)
  // 命令词必须是完整一个词：/资料库 不是 /资料。
  assert.equal(resolveSlash('/资料库怎么建？'), null)
  // 词表外的命令不认（不猜一个最近的）。
  assert.equal(resolveSlash('/重写 这一章'), null)
  assert.equal(resolveSlash(''), null)
  assert.equal(resolveSlash(null), null)
})

test('isSlashDraft：只有开头的 / 才弹提示', () => {
  assert.equal(isSlashDraft('/'), true)
  assert.equal(isSlashDraft('/资'), true)
  assert.equal(isSlashDraft('  /审阅'), true)
  assert.equal(isSlashDraft('正文里有 / 斜杠'), false)
  assert.equal(isSlashDraft('@《第001章》 看看'), false)
  assert.equal(isSlashDraft(''), false)
})

test('slashMessageFields：剥掉命令词，带回 omit 与徽章字段', () => {
  const command = SLASH_COMMANDS.find((item) => item.name === '/大纲')
  const fields = slashMessageFields(command, '  主线是不是太散？  ')
  assert.deepEqual(fields, {
    text: '主线是不是太散？',
    command: '/大纲',
    omit: ['scene', 'memory', 'history']
  })
  // omit 是拷贝：界面改它不会污染命令表。
  fields.omit.push('rules')
  assert.deepEqual(command.omit, ['scene', 'memory', 'history'])

  assert.deepEqual(slashMessageFields(null, '空命令'), { text: '空命令', command: '', omit: [] })
})
