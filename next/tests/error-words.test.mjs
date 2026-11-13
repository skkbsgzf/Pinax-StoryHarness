import test from 'node:test'
import assert from 'node:assert/strict'
import { ERROR_STAGE_WORDS, dedupeMcpCodes, humanizeError } from '../shell/errorWords.mjs'

/**
 * 错误人话层（P9 · 作者 2026-11-13 UX 审计裁定）纯函数测试。
 *
 * 钉的是**规则**不是措辞之外的实现：五条规则按序命中即停（每条都有正反两例），
 * MCP 码只折一层并只进 detail，工具 id 绝不进主文案，detail 恒留原文。
 */

const E1 = '工具 pinax_proposal_list 的进程内调用失败：MCP error -32602: MCP error -32602: Tool pinax_proposal_list not found'

test('规则① MCP + not found：归因纠正为「没打开库」，工具 id 只进 detail', () => {
  const words = humanizeError(E1)
  assert.equal(words.title, '这个功能还没接上当前库')
  assert.equal(words.hint, '先新建或打开一个库，再回到这一节。')
  // 主文案不许出现错误码与工具 id。
  assert.equal(`${words.title}${words.hint}`.includes('MCP'), false)
  assert.equal(`${words.title}${words.hint}`.includes('pinax_proposal_list'), false)
  // detail 恒留原文信息（工具 id 与错误码都在），且 MCP 前缀只折叠成一层。
  assert.ok(words.detail.includes('pinax_proposal_list'))
  assert.ok(words.detail.includes('MCP error -32602'))
  assert.equal(words.detail.includes('MCP error -32602: MCP error -32602'), false)
})

test('规则①反例：只有 not found、没有 MCP 码时不抢这条归因', () => {
  const words = humanizeError('目标文件 not found，已在磁盘上找过一遍。')
  assert.notEqual(words.title, '这个功能还没接上当前库')
  assert.equal(words.title, '目标文件 not found，已在磁盘上找过一遍。')
})

test('规则② fetch failed：说「连不上模型服务」，英文原文不进主文案', () => {
  const words = humanizeError('运行时执行失败：fetch failed（断在：组装上下文）')
  assert.equal(words.title, '连不上模型服务')
  assert.ok(words.hint.includes('设置·应用·偏好与模型'))
  assert.equal(`${words.title}${words.hint}`.includes('fetch failed'), false)
  assert.ok(words.detail.includes('fetch failed'))
})

test('规则② ECONNREFUSED / UND_ERR_CONNECT_FAILED 同档；反例：普通执行失败不被误认成网络', () => {
  assert.equal(humanizeError('run failed: ECONNREFUSED 127.0.0.1:3001').title, '连不上模型服务')
  assert.equal(humanizeError('run failed: UND_ERR_CONNECT_FAILED').title, '连不上模型服务')

  const words = humanizeError('运行时执行失败（断在：落盘）')
  assert.notEqual(words.title, '连不上模型服务')
  assert.equal(words.title, '运行时执行失败')
})

test('规则③ 其余 MCP 码：参数没对上；反例（已命中规则①的不许掉到这里）', () => {
  const words = humanizeError('MCP error -32602: invalid params: args.maxChars must be a number')
  assert.equal(words.title, '参数没对上，这一步没执行')
  assert.equal(words.hint, '把这条错误反馈给开发者。')
  assert.equal(`${words.title}${words.hint}`.includes('-32602'), false)

  assert.equal(humanizeError(E1).title, '这个功能还没接上当前库')
})

test('规则④ 断在：X：阶段映射到人话，标题去掉英文错误与内部阶段括注', () => {
  const words = humanizeError('运行时执行失败：APIConnectionError（断在：调用模型）')
  assert.equal(words.title, '运行时执行失败')
  assert.ok(words.hint.includes('生成回复'))
  assert.equal(words.hint.includes('调用模型'), false)
  assert.ok(words.detail.includes('APIConnectionError'))

  const write = humanizeError('写入没完成（断在：落盘）')
  assert.ok(write.hint.includes('写入'))

  const context = humanizeError('这一步失败', { stageLabel: '组装上下文' })
  assert.ok(context.hint.includes('准备写作资料'))
})

test('规则④：未映射但已是人话的阶段名不扣「内部阶段」；ASCII 阶段名才标', () => {
  const human = humanizeError('未检测到可用模型。请先启动 pi-agent 任务面（serve:pinax）。（断在：模型第 1 轮）')
  assert.equal(human.title, '未检测到可用模型。请先启动 pi-agent 任务面（serve:pinax）。')
  assert.ok(human.hint.includes('模型第 1 轮'))
  assert.equal(human.hint.includes('内部阶段'), false)

  const internal = humanizeError('runtime aborted（断在：model-round）')
  assert.ok(internal.hint.includes('model-round'))
  assert.ok(internal.hint.includes('内部阶段'))
})

test('规则④反例：没有断在信息时不乱猜阶段（规则⑤原样退回）', () => {
  const words = humanizeError('Next M1 骨架未接模型运行器（runner）')
  assert.equal(words.title, 'Next M1 骨架未接模型运行器（runner）')
  assert.equal(words.hint, '')
})

test('规则⑤ 都不命中：标题原样退回，不硬翻；空串给出空三件套', () => {
  assert.equal(humanizeError('磁盘写满了。').title, '磁盘写满了。')
  assert.deepEqual(humanizeError(''), { title: '', hint: '', detail: '' })
  assert.deepEqual(humanizeError(null), { title: '', hint: '', detail: '' })
})

test('detail 恒留原文：非 MCP 的普通错误一字不改；MCP 重复前缀只折一层', () => {
  const plain = '通道 runtime:ask 调用失败'
  assert.equal(humanizeError(plain).detail, plain)

  const folded = dedupeMcpCodes(E1)
  assert.ok(folded.includes('MCP error -32602: Tool pinax_proposal_list not found'))
  assert.equal(humanizeError(E1).detail, folded)

  // 阶段映射表是导出的闭集：改词只改这一处。
  assert.deepEqual(Object.keys(ERROR_STAGE_WORDS), ['组装上下文', '调用模型', '落盘'])
})
