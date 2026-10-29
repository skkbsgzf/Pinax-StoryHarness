import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_REFERENCE_TOKENS,
  REFERENCE_CLIP_CHARS,
  matchReference,
  parseRefs,
  referenceKindLabel,
  resolveRefs,
  withRefs
} from '../shell/agentReferences.mjs'

/**
 * @ 引用参考单测（批次27 · 任务三）。
 * tool 回调是注入的假实现：真链路走 runtimeToolCall，这里只钉解析、调用形状、截断、上限与失败标注。
 */

const CATALOG = [
  { kind: 'chapter', title: '第001章-入场', path: '正文/第001章-入场.md' },
  { kind: 'chapter', title: '第002章-雨夜', path: '正文/第002章-雨夜.md' },
  { kind: 'entry', title: '人物·柯秒', path: '世界书/人物·柯秒.md', id: 'kb-1' },
  { kind: 'document', title: '开篇参考', path: '资料/开篇参考.md' },
  { kind: 'script', title: '第一场', path: '剧本/第001章/剧本.md' }
]

/** 记录每次调用的假工具面：按 name 返回准备好的载荷。 */
function fakeTool(responses = {}) {
  const calls = []
  const tool = async (name, args) => {
    calls.push({ name, args })
    const answer = responses[name]
    if (typeof answer === 'function') return answer(args)
    if (answer) return answer
    return { ok: false, message: `没有为 ${name} 准备返回` }
  }
  return { tool, calls }
}

test('parseRefs：抽 @《…》 token，去重，正文里的普通 @ 不算', () => {
  const tokens = parseRefs('看看 @《第001章-入场》 和 @《人物·柯秒》，再看看 @《第001章-入场》')
  assert.deepEqual(tokens.map((token) => token.title), ['第001章-入场', '人物·柯秒'], '同一条标题只算一次')
  assert.equal(tokens[0].token, '@《第001章-入场》')

  assert.deepEqual(parseRefs('邮箱 a@b.com 不是引用'), [])
  assert.deepEqual(parseRefs('@《》空标题不算'), [])
  assert.deepEqual(parseRefs(''), [])
  assert.deepEqual(parseRefs(null), [])
})

test('matchReference：精确优先，包含匹配只有唯一命中才算', () => {
  assert.equal(matchReference('人物·柯秒', CATALOG).path, '世界书/人物·柯秒.md')
  assert.equal(matchReference('第002章', CATALOG).path, '正文/第002章-雨夜.md', '唯一包含命中可以认')
  assert.equal(matchReference('第00', CATALOG), null, '包含匹配命中多条时宁可取不到')
  assert.equal(matchReference('根本没有', CATALOG), null)
  assert.equal(matchReference('', CATALOG), null)
})

test('resolveRefs：按 kind 走对应的只读工具，取正文摘要', async () => {
  const { tool, calls } = fakeTool({
    pinax_chapter_read: { ok: true, value: { text: '雨从檐口滴下来。' } },
    pinax_worldbook_read: { ok: true, value: { entry: { content: '冷穿越剧版主角。' } } },
    pinax_document_read: { ok: true, value: { text: '开篇参考的正文。' } },
    pinax_script_read: { ok: true, value: { text: '第一场 内景 夜。' } }
  })
  const refs = [
    { ...matchReference('第001章-入场', CATALOG), title: '第001章-入场' },
    { ...matchReference('人物·柯秒', CATALOG), title: '人物·柯秒' },
    { ...matchReference('开篇参考', CATALOG), title: '开篇参考' },
    { ...matchReference('第一场', CATALOG), title: '第一场' }
  ]
  const resolved = await resolveRefs(refs, tool)

  assert.deepEqual(resolved.map((item) => [item.kind, item.ok]), [
    ['chapter', true], ['entry', true], ['document', true], ['script', true]
  ])
  assert.equal(resolved[0].text, '雨从檐口滴下来。')
  assert.equal(resolved[1].text, '冷穿越剧版主角。', '世界书取的是 entry.content')

  assert.deepEqual(calls.map((call) => call.name), [
    'pinax_chapter_read', 'pinax_worldbook_read', 'pinax_document_read', 'pinax_script_read'
  ])
  assert.equal(calls[0].args.file, '正文/第001章-入场.md')
  assert.equal(calls[1].args.id, 'kb-1', '世界书按 id 定位（该工具没有 path 参数）')
  assert.equal(calls[2].args.file, '资料/开篇参考.md')
  assert.equal(calls[3].args.file, '剧本/第001章/剧本.md')
  // 读工具的 maxChars 下限是 1000：截断在本地做，不靠参数压到 600。
  for (const call of calls) assert.equal(call.args.maxChars, 1000)
})

test('resolveRefs：每条截前 600 字，最多 4 条', async () => {
  const long = '雨'.repeat(REFERENCE_CLIP_CHARS + 100)
  const { tool } = fakeTool({ pinax_chapter_read: { ok: true, value: { text: long } } })
  const refs = Array.from({ length: 6 }, (_item, index) => ({ kind: 'chapter', title: `第${index}章`, path: `正文/${index}.md` }))

  const resolved = await resolveRefs(refs, tool)
  assert.equal(resolved.length, MAX_REFERENCE_TOKENS, `最多 ${MAX_REFERENCE_TOKENS} 条`)
  assert.equal(resolved[0].text.length, REFERENCE_CLIP_CHARS + 1, '超出部分截掉，末尾留一个省略号')
  assert.ok(resolved[0].text.endsWith('…'))
})

test('resolveRefs：取不到的那条如实标注，不静默丢、也不编内容', async () => {
  const { tool } = fakeTool({
    pinax_chapter_read: { ok: false, message: '「正文/第009章.md」不存在' },
    pinax_worldbook_read: { ok: true, value: { entry: { content: '   ' } } }
  })
  const resolved = await resolveRefs([
    { kind: 'chapter', title: '第009章', path: '正文/第009章.md' },
    { kind: 'entry', title: '空条目', path: '世界书/空条目.md' },
    { title: '清单里没有这条' }
  ], tool)

  assert.equal(resolved.length, 3, '失败的那条也要留在结果里')
  assert.equal(resolved[0].ok, false)
  assert.match(resolved[0].note, /不存在/)
  assert.equal(resolved[0].text, undefined, '失败就不给正文')
  assert.equal(resolved[1].ok, false)
  assert.match(resolved[1].note, /空/)
  assert.equal(resolved[2].ok, false)
  assert.match(resolved[2].note, /清单/)

  // 工具抛错与「没有工具面」：同样标注，不把整次提问打掉。
  const throwing = await resolveRefs([{ kind: 'chapter', title: '炸', path: '正文/炸.md' }], async () => {
    throw new Error('通道断了')
  })
  assert.equal(throwing[0].ok, false)
  assert.match(throwing[0].note, /通道断了/)
  const noTool = await resolveRefs([{ kind: 'script', title: '第一场', path: '剧本/第一场.md' }], null)
  assert.equal(noTool[0].ok, false)
  assert.match(noTool[0].note, /工具面/)
})

test('withRefs：问题原文 + 每条一段【参考·kind《title》】；失败段写明取不到', () => {
  const resolved = [
    { kind: 'chapter', title: '第001章-入场', ok: true, text: '雨从檐口滴下来。' },
    { kind: 'entry', title: '人物·柯秒', ok: false, note: '「世界书/人物·柯秒.md」不存在' }
  ]
  const text = withRefs('  这两处对得上吗？  ', resolved)
  assert.ok(text.startsWith('这两处对得上吗？'), '问题原文在最前')
  assert.match(text, /【参考·章节《第001章-入场》】\n雨从檐口滴下来。/)
  assert.match(text, /【参考·条目《人物·柯秒》】\n（引用取不到：「世界书\/人物·柯秒.md」不存在）/)
  assert.equal(referenceKindLabel('document'), '资料')
  assert.equal(referenceKindLabel('不懂的'), '引用')

  // 没有引用就原样返回，不留空壳分隔线。
  assert.equal(withRefs('就一个问题', []), '就一个问题')
  assert.equal(withRefs('就一个问题', null), '就一个问题')
})
