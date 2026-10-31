import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WRITING_ACTIONS,
  WRITING_MAX_TEXT_CHARS,
  applyWritingResult,
  availableWritingActions,
  buildWritingRequest,
  cleanWritingResult,
  normalizeSelection,
  validateWritingRequest,
  writingActionOf
} from '../shell/writingActions.mjs'
import { createWritingComplete } from '../runtime/writingComplete.mjs'
import { IPC_CHANNELS, createIpcDispatcher } from '../shell/ipcContract.mjs'

/**
 * 批次41：正文写作动作（续写／改写／扩写／压缩／润色）。
 * 口径：动作是闭集；提示词只由 writingActions 拼；结果不自动落进正文——先校验、后落位，两步分开测。
 */

const TEXT = '他推开门，屋里没有点灯。'

test('动作闭集：五个动作各就各位，未登记的动作返回 null（不猜近义）', () => {
  assert.deepEqual(WRITING_ACTIONS.map((action) => action.id), ['continue', 'rewrite', 'expand', 'condense', 'polish'])
  assert.equal(writingActionOf('continue')?.target, 'insert')
  assert.equal(writingActionOf('rewrite')?.target, 'replace')
  assert.equal(writingActionOf('summarize'), null)
  assert.equal(writingActionOf(undefined), null)
  // 只有续写不要求选区：其余四个点了没反应会像坏了，干脆不出。
  assert.deepEqual(availableWritingActions({ hasSelection: false }).map((a) => a.id), ['continue'])
  assert.deepEqual(availableWritingActions({ hasSelection: true }).map((a) => a.id),
    ['continue', 'rewrite', 'expand', 'condense', 'polish'])
})

test('请求校验：空正文、超长正文、需要选区却没选、要求过长都给人话拒绝', () => {
  assert.equal(validateWritingRequest({ action: 'nope', text: TEXT }).ok, false)
  assert.match(validateWritingRequest({ action: 'continue', text: '   ' }).message, /正文是空的/u)
  assert.equal(validateWritingRequest({ action: 'continue', text: 'x'.repeat(WRITING_MAX_TEXT_CHARS + 1) }).ok, false)
  const noSelection = validateWritingRequest({ action: 'rewrite', text: TEXT })
  assert.equal(noSelection.ok, false)
  assert.match(noSelection.message, /先选中/u)
  assert.equal(validateWritingRequest({ action: 'rewrite', text: TEXT, selection: { start: 2, end: 6 } }).ok, true)
  assert.equal(validateWritingRequest({ action: 'continue', text: TEXT, instruction: '要'.repeat(501) }).ok, false)
})

test('选区归一：反向拖选换成正序，越界钳在正文长度内（不炸整次请求）', () => {
  assert.deepEqual(normalizeSelection({ start: 6, end: 2 }, TEXT), { start: 2, end: 6, collapsed: false })
  assert.deepEqual(normalizeSelection({ start: -5, end: 9999 }, TEXT), { start: 0, end: TEXT.length, collapsed: false })
  assert.deepEqual(normalizeSelection({}, TEXT), { start: TEXT.length, end: TEXT.length, collapsed: true })
  // 越界后再校验：原文被换短了，选区跟着收进来，不报错。
  const validated = validateWritingRequest({ action: 'rewrite', text: TEXT, selection: { start: 0, end: 9999 } })
  assert.equal(validated.ok, true)
  assert.equal(validated.value.selection.end, TEXT.length)
})

test('提示词组装：续写只带上文，改写带「要处理的段落」两侧留上下文，额外要求进同一段', () => {
  const continued = buildWritingRequest(validateWritingRequest({ action: 'continue', text: TEXT }).value)
  assert.match(continued.messages[0].content, /【上文】/u)
  assert.doesNotMatch(continued.messages[0].content, /【要处理的段落】/u)
  assert.match(continued.systemPrompt, /只输出可以直接粘回正文的汉字段落/u)

  const rewritten = buildWritingRequest(validateWritingRequest({
    action: 'rewrite', text: TEXT, selection: { start: 0, end: 3 }, instruction: '别用成语'
  }).value)
  assert.match(rewritten.messages[0].content, /【要处理的段落】\n他推开/u)
  assert.match(rewritten.messages[0].content, /【额外要求】别用成语/u)
  assert.ok(rewritten.maxTokens >= 1000)

  // 长文只带尾部上文：续写要的是最近的话，不是开头。
  const long = `【开头】${'前'.repeat(9000)}${'后'.repeat(200)}`
  const tailed = buildWritingRequest(validateWritingRequest({ action: 'continue', text: long }).value)
  assert.ok(tailed.messages[0].content.includes('后'.repeat(200)))
  assert.ok(!tailed.messages[0].content.includes('【开头】'), '上文必须按尾部截断')
})

test('结果清洗与落位：去围栏、末尾插入另起一段、中间插入不加空行、替换顶掉选中段', () => {
  assert.equal(cleanWritingResult('```md\n第一段\n```'), '第一段')
  assert.equal(cleanWritingResult('  \n第一段\n  '), '第一段')
  assert.equal(applyWritingResult({ text: 'abc', selection: { start: 3, end: 3 }, action: writingActionOf('continue'), result: 'def' }).text, 'abc\n\ndef')
  assert.equal(applyWritingResult({ text: 'abc', selection: { start: 1, end: 1 }, action: writingActionOf('continue'), result: 'X' }).text, 'aXbc')
  const replaced = applyWritingResult({ text: TEXT, selection: { start: 0, end: 3 }, action: writingActionOf('rewrite'), result: '她合上门' })
  assert.equal(replaced.text, `她合上门${TEXT.slice(3)}`)
  assert.equal(replaced.caret, 4)
  assert.equal(replaced.mode, 'replace')
  // 空结果不落位：宁可提示，也不往稿子里插一段空白。
  assert.equal(applyWritingResult({ text: TEXT, selection: { start: 0, end: 0 }, action: writingActionOf('continue'), result: '   ' }), null)
  // 需要替换的动作在空选区上也不落位（界面已经拦过一次，这里是第二道）。
  assert.equal(applyWritingResult({ text: TEXT, selection: { start: 2, end: 2 }, action: writingActionOf('rewrite'), result: 'x' }), null)
})

test('主进程写作服务：拿到正文就回 ok，上游抛错／空补全一律如实报 IO_FAILED，不编字', async () => {
  const seen = []
  const okService = createWritingComplete({
    complete: async (payload) => {
      seen.push(payload)
      return { ok: true, content: '门外有人叫他。', model: 'fake-model', usage: { total_tokens: 12 } }
    }
  })
  const answered = await okService.run({ action: 'continue', text: TEXT, selection: { start: TEXT.length, end: TEXT.length } })
  assert.equal(answered.ok, true)
  assert.equal(answered.value.text, '门外有人叫他。')
  assert.equal(answered.value.target, 'insert')
  assert.equal(seen[0].messages.length, 1)

  const badAction = await okService.run({ action: 'summarize', text: TEXT })
  assert.equal(badAction.ok, false)
  assert.equal(badAction.error.code, 'PINAX_INVALID_INPUT')

  const boom = createWritingComplete({ complete: async () => { throw Object.assign(new Error('任务面不可达'), { code: 'KIT_COMPLETE_FAILED' }) } })
  const failed = await boom.run({ action: 'continue', text: TEXT })
  assert.equal(failed.ok, false)
  assert.match(failed.error.message, /任务面不可达/u)

  const empty = createWritingComplete({ complete: async () => ({ ok: true, content: '   ' }) })
  const blank = await empty.run({ action: 'continue', text: TEXT })
  assert.equal(blank.ok, false)
  assert.match(blank.error.message, /没有返回正文/u)
})

test('五动作信封升级（批次46A）：参考块按 kind 标注并入【本书参考】，排在任务之前；返回 references 清单', async () => {
  const seen = []
  const outline = '第一幕：雨夜有人敲门'
  const setting = '守夜人只在子时巡街'
  const service = createWritingComplete({
    complete: async (payload) => {
      seen.push(payload)
      return { ok: true, content: '门外有人叫他。' }
    },
    contextSources: () => ({ registry: {}, view: {}, fileService: {} }),
    buildEnvelope: async ({ question }) => {
      assert.match(question, /他推开门/u, '检索问句带上了光标附近的正文')
      return {
        ok: true,
        value: {
          envelope: { blocks: [{ kind: 'outline', content: outline }, { kind: 'worldbook', content: setting }] },
          missingKinds: ['style']
        }
      }
    }
  })
  const answered = await service.run({ action: 'continue', text: TEXT, selection: { start: TEXT.length, end: TEXT.length } })
  assert.equal(answered.ok, true)
  const user = seen[0].messages[0].content
  assert.match(user, /【本书参考】/u)
  assert.match(user, new RegExp(`【大纲】\\n${outline}`, 'u'))
  assert.match(user, new RegExp(`【世界书·设定】\\n${setting}`, 'u'))
  assert.ok(user.indexOf('【本书参考】') < user.indexOf('【任务】'), '参考段必须在任务之前')
  assert.deepEqual(answered.value.references, [
    { kind: 'outline', chars: outline.length },
    { kind: 'worldbook', chars: setting.length }
  ])
  assert.equal(answered.value.degraded, false)
  assert.equal(answered.value.referenceNote, null)
  assert.deepEqual(answered.value.missingKinds, ['style'])
})

test('参考块缺席时降级为裸补全：提示词回到批次41 的形状，结果如实标注原因', async () => {
  const seen = []
  const service = createWritingComplete({
    complete: async (payload) => {
      seen.push(payload)
      return { ok: true, content: '门外有人叫他。' }
    },
    contextSources: () => ({ registry: {}, view: {}, fileService: {} }),
    buildEnvelope: async () => ({ ok: false, error: { code: 'PINAX_DEPENDENCY_UNMET', message: '本次提问组装不出任何上下文块' } })
  })
  const answered = await service.run({ action: 'continue', text: TEXT })
  assert.equal(answered.ok, true)
  assert.equal(answered.value.text, '门外有人叫他。')
  assert.equal(answered.value.degraded, true)
  assert.match(answered.value.referenceNote, /参考块缺席/u)
  assert.deepEqual(answered.value.references, [])
  assert.doesNotMatch(seen[0].messages[0].content, /【本书参考】/u)

  // 没接运行时取数面（单测／项目没打开）也走同一条降级：不抛、不硬失败。
  const bare = createWritingComplete({ complete: async () => ({ ok: true, content: '好' }) })
  const plain = await bare.run({ action: 'continue', text: TEXT })
  assert.equal(plain.ok, true)
  assert.equal(plain.value.degraded, true)
  assert.match(plain.value.referenceNote, /参考块缺席/u)
})

test('提示词预览：只读返回最近一次请求的 system＋user，不跨项目；通道未接入／没开项目如实报缺', async () => {
  const service = createWritingComplete({ complete: async () => ({ ok: true, content: '好' }) })
  assert.equal(service.preview().ok, false, '还没发起过请求就没有预览')

  await service.run({ action: 'continue', text: TEXT, root: '/tmp/book' })
  const preview = service.preview({ root: '/tmp/book' })
  assert.equal(preview.ok, true)
  assert.match(preview.value.systemPrompt, /中文小说写作助手/u)
  assert.match(preview.value.userPrompt, /【上文】/u)
  assert.equal(preview.value.action, 'continue')
  assert.equal(preview.value.projectRoot, '/tmp/book')
  // 换项目不跨项目给预览。
  const other = service.preview({ root: '/tmp/other' })
  assert.equal(other.ok, false)
  assert.match(other.error.message, /另一个项目/u)

  const bare = createIpcDispatcher({ session: { projectRoot: '/tmp/book' } })
  const unwired = await bare.dispatch(IPC_CHANNELS.writingPreview, {})
  assert.equal(unwired.ok, false)
  assert.match(unwired.error.message, /提示词预览未接入/u)

  const noProject = createIpcDispatcher({
    session: { projectRoot: '' },
    writingComplete: { run: async () => ({ ok: true }), preview: () => ({ ok: true, value: {} }) }
  })
  const closed = await noProject.dispatch(IPC_CHANNELS.writingPreview, {})
  assert.equal(closed.ok, false)
  assert.match(closed.error.message, /先打开一个项目/u)

  let askedRoot = null
  const wired = createIpcDispatcher({
    session: { projectRoot: '/tmp/book' },
    writingComplete: {
      run: async () => ({ ok: true }),
      preview: (input) => { askedRoot = input?.root ?? null; return { ok: true, value: { userPrompt: 'U' } } }
    }
  })
  const read = await wired.dispatch(IPC_CHANNELS.writingPreview, {})
  assert.equal(read.ok, true)
  assert.equal(askedRoot, '/tmp/book', '预览只认当前项目根')
})

test('通道：没注入写作服务／没打开项目都如实报缺，注入了才走服务', async () => {
  const bare = createIpcDispatcher({ session: { projectRoot: '/tmp/book' } })
  const missing = await bare.dispatch(IPC_CHANNELS.runtimeComplete, { action: 'continue', text: TEXT })
  assert.equal(missing.ok, false)
  assert.match(missing.error.message, /写作动作未接入/u)

  const noProject = createIpcDispatcher({
    session: { projectRoot: '' },
    writingComplete: { run: async () => ({ ok: true, value: { text: 'x' } }) }
  })
  const closed = await noProject.dispatch(IPC_CHANNELS.runtimeComplete, { action: 'continue', text: TEXT })
  assert.equal(closed.ok, false)
  assert.match(closed.error.message, /先打开一个项目/u)

  let received = null
  const wired = createIpcDispatcher({
    session: { projectRoot: '/tmp/book' },
    writingComplete: { run: async (input) => { received = input; return { ok: true, value: { text: '写好的' } } } }
  })
  const done = await wired.dispatch(IPC_CHANNELS.runtimeComplete, { action: 'rewrite', text: TEXT, selection: { start: 0, end: 3 }, instruction: '轻一点' })
  assert.equal(done.ok, true)
  assert.deepEqual(received.selection, { start: 0, end: 3 })
  assert.equal(received.instruction, '轻一点')
})
