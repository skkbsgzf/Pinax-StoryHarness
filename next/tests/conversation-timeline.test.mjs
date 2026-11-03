import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TIMELINE_BLOCK_KINDS,
  TIMELINE_ICON_NAMES,
  TIMELINE_STATES,
  TOOL_ICON_CLASSES,
  blockHeadline,
  buildTimelineBlocks,
  classifyToolIcon,
  isWriteToolName,
  timelineElapsed,
  timelineIconName,
  timelineLabel,
  timelinePath,
  timelineSummary
} from '../shell/conversationTimeline.mjs'

/**
 * 〔批次77 任务4〕消息内处理时间线的判定层（纯函数，不进 jsdom）。
 *
 * 分工口径：这个文件钉的是**判断**（块型／四态文案／图标归类／只读并组／耗时合成），
 * `ConversationTimeline.vue` 只负责摆——所以能在 node:test 里钉死的一律不放给界面测试去猜。
 * 数据源仍是既有 trail（`agentSessions.sanitizeTrailEvent` 那条链）：本批不加事件、不补事件、不重排。
 */

test('词表：五类块、四态、五个图标类是闭集（界面不许自造第六类）', () => {
  assert.deepEqual(TIMELINE_BLOCK_KINDS, ['thinking', 'response', 'tool', 'tool-group', 'subagent'])
  assert.deepEqual(TIMELINE_STATES, ['preparing', 'running', 'completed', 'error'])
  assert.deepEqual(TOOL_ICON_CLASSES, ['folder', 'terminal', 'file', 'globe', 'sparkles'])
  // 图标类名 → 我们图标集里真有的名字：工单沿用的是 DeepWrite 的叫法，terminal／globe／file 这三个字面名我们没长。
  assert.deepEqual(Object.values(TIMELINE_ICON_NAMES), ['folder', 'search', 'document', 'network', 'sparkles'])
})

test('图标按名字归类：写入类不显图标，认不出来兜到 file（不硬塞 sparkles 装生成）', () => {
  assert.equal(isWriteToolName('pinax_chapter_save'), true)
  assert.equal(classifyToolIcon('pinax_chapter_save'), null, '写入类一律不给图标')
  assert.equal(classifyToolIcon('pinax_worldbook_write'), null)
  assert.equal(classifyToolIcon('pinax_entry_delete'), null)
  assert.equal(timelineIconName('pinax_chapter_save'), '', '写入类拿不到图标名')
  // 跑到外面去的落 globe。
  assert.equal(classifyToolIcon('pinax_web_fetch'), 'globe')
  assert.equal(classifyToolIcon('pinax_mcp_call'), 'globe')
  // 生成／技能类落 sparkles。
  assert.equal(classifyToolIcon('pinax_skill_read'), 'sparkles')
  assert.equal(classifyToolIcon('pinax_chapter_rewrite'), 'sparkles')
  // 目录／清单类落 folder。
  assert.equal(classifyToolIcon('pinax_project_tree'), 'folder')
  assert.equal(classifyToolIcon('pinax_worldbook_list'), 'folder')
  // 检索／比对类落 terminal（渲染名 search）。
  assert.equal(classifyToolIcon('pinax_chapter_search'), 'terminal')
  assert.equal(classifyToolIcon('pinax_knowledge_query'), 'terminal')
  assert.equal(timelineIconName('pinax_chapter_search'), 'search', 'terminal 类要换成真图标名')
  // 认不出来兜到 file：单文档读写是这壳里最大的那一类，落这儿比落 sparkles 诚实。
  assert.equal(classifyToolIcon('pinax_chapter_read'), 'file')
  assert.equal(timelineIconName('pinax_chapter_read'), 'document')
  assert.equal(classifyToolIcon(''), null, '空名字不给图标')
  assert.equal(classifyToolIcon(null), null)
})

test('四态文案工厂：等待执行／正在 X／已 X／X 失败，改词只改这一处', () => {
  assert.equal(timelineLabel('preparing', '调用工具'), '等待执行')
  assert.equal(timelineLabel('running', '调用工具'), '正在调用工具')
  assert.equal(timelineLabel('completed', '调用工具'), '已调用工具')
  assert.equal(timelineLabel('error', '调用工具'), '调用工具失败')
  assert.equal(timelineLabel('completed', ''), '', '没有动作短语就不拼句子（不许编一个动词）')
})

test('块序列：过程段合成 thinking、一次调用一个 tool 块、answer 成 response（顺序＝运行顺序）', () => {
  const trail = [
    { stage: 'start', questionChars: 12 },
    { stage: 'envelope', blocks: 6, chars: 1800, profile: 'writing-chapter' },
    { stage: 'model-round', round: 1 },
    { stage: 'tool-start', callId: 'c1', name: 'pinax_chapter_read' },
    { stage: 'tool-end', callId: 'c1', name: 'pinax_chapter_read', ok: true, ms: 12 },
    { stage: 'tool-start', callId: 'c2', name: 'pinax_chapter_save' },
    { stage: 'proposal-created', callId: 'c2', name: 'pinax_chapter_save', proposalId: 'p-9' },
    { stage: 'answer', chars: 320, structured: true, roundsUsed: 2 }
  ]
  const blocks = buildTimelineBlocks(trail)
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['thinking', 'tool', 'tool', 'response'],
    '三段过程合成一个 thinking；两次调用各自一块；答案一块'
  )
  assert.deepEqual(blocks[1].events.map((event) => event.stage), ['tool-start', 'tool-end'], '按 callId 归块，不串味')
  assert.deepEqual(blocks[2].events.map((event) => event.stage), ['tool-start', 'proposal-created'])
  assert.equal(blocks[1].name, 'pinax_chapter_read')
  assert.equal(blocks[1].write, false)
  assert.equal(blocks[2].write, true)
  assert.equal(blocks[2].proposalId, 'p-9')
  assert.equal(blocks[1].state, 'completed', 'tool-end ok=true 才算完成')
  assert.equal(blocks[2].state, 'completed', 'proposal-created 也是终态')
  assert.equal(blocks[0].state, 'completed')
  // 块头那一句由判定层给，组件不再现造文案。
  assert.equal(blocks[0].headline, '已梳理上下文')
  assert.equal(blocks[1].headline, '已调用 pinax_chapter_read')
  assert.equal(blocks[3].headline, '已给出回答')
})

test('写入那一块只说有据的话：被拒带 code、提案带 id，没有真字数就不许冒「若干字」', () => {
  const denied = buildTimelineBlocks([
    { stage: 'tool-start', callId: 'w1', name: 'pinax_chapter_save' },
    { stage: 'tool-denied', callId: 'w1', name: 'pinax_chapter_save', code: 'WRITE_BLOCKED' }
  ])
  assert.equal(denied[0].state, 'error')
  assert.equal(blockHeadline(denied[0]), '写入被拒 · WRITE_BLOCKED')

  const proposed = buildTimelineBlocks([
    { stage: 'tool-start', callId: 'w2', name: 'pinax_chapter_save' },
    { stage: 'tool-end', callId: 'w2', name: 'pinax_chapter_save', ok: true, ms: 30 },
    { stage: 'proposal-created', callId: 'w2', name: 'pinax_chapter_save', proposalId: 'proposal-77' }
  ])
  assert.equal(blockHeadline(proposed[0]), '写入结果已生成 · 提案 proposal-77')
  assert.ok(!proposed[0].headline.includes('字'), '上游没回报写入字数，这里就不许出现字数')

  const running = buildTimelineBlocks([{ stage: 'tool-start', callId: 'w3', name: 'pinax_chapter_save' }], { streaming: true })
  assert.equal(blockHeadline(running[0]), '正在写入 pinax_chapter_save')
})

test('只读并组：连续两把以上才并，一把不并；写入类没有并组资格；组按最坏说', () => {
  const single = buildTimelineBlocks([
    { stage: 'tool-start', callId: 'c1', name: 'pinax_chapter_read' },
    { stage: 'tool-end', callId: 'c1', name: 'pinax_chapter_read', ok: true, ms: 1 }
  ])
  assert.deepEqual(single.map((block) => block.kind), ['tool'], '一把只读不并（并了反而多藏一层）')

  const pair = buildTimelineBlocks([
    { stage: 'tool-start', callId: 'c1', name: 'pinax_chapter_read' },
    { stage: 'tool-end', callId: 'c1', name: 'pinax_chapter_read', ok: true, ms: 1 },
    { stage: 'tool-start', callId: 'c2', name: 'pinax_outline_read' },
    { stage: 'tool-end', callId: 'c2', name: 'pinax_outline_read', ok: true, ms: 2 }
  ])
  assert.deepEqual(pair.map((block) => block.kind), ['tool-group'], '连续两把只读并成一组')
  assert.equal(pair[0].items.length, 2)
  assert.equal(pair[0].events.length, 4, '组的原始事件仍是那四条，一条不丢')
  assert.equal(pair[0].groupLine, '已读取 2 项项目内容（2 项）')
  assert.deepEqual(pair[0].items.map((item) => item.callId), ['c1', 'c2'], '明细留在组里，展开看得到每一把')

  const split = buildTimelineBlocks([
    { stage: 'tool-start', callId: 'c1', name: 'pinax_chapter_read' },
    { stage: 'tool-end', callId: 'c1', name: 'pinax_chapter_read', ok: true, ms: 1 },
    { stage: 'tool-start', callId: 'c2', name: 'pinax_outline_read' },
    { stage: 'tool-end', callId: 'c2', name: 'pinax_outline_read', ok: true, ms: 2 },
    { stage: 'tool-start', callId: 'w1', name: 'pinax_chapter_save' },
    { stage: 'tool-end', callId: 'w1', name: 'pinax_chapter_save', ok: true, ms: 5 },
    { stage: 'tool-start', callId: 'c3', name: 'pinax_entry_read' },
    { stage: 'tool-end', callId: 'c3', name: 'pinax_entry_read', ok: true, ms: 3 }
  ])
  assert.deepEqual(split.map((block) => block.kind), ['tool-group', 'tool', 'tool'], '写入类打断并组，后面那把单独成块')
  assert.equal(split[1].write, true)

  const mixed = buildTimelineBlocks([
    { stage: 'tool-start', callId: 'e1', name: 'pinax_chapter_read' },
    { stage: 'tool-end', callId: 'e1', name: 'pinax_chapter_read', ok: false, ms: 8 },
    { stage: 'tool-start', callId: 'e2', name: 'pinax_outline_read' },
    { stage: 'tool-end', callId: 'e2', name: 'pinax_outline_read', ok: true, ms: 9 }
  ])
  assert.equal(mixed[0].kind, 'tool-group')
  assert.equal(mixed[0].state, 'error', '组里有一把报错，整组按最坏说（不许把失败读成已完成）')
  assert.equal(mixed[0].ms, 17, '组的 ms 是两把之和（只记账，不当任何闸）')
})

test('子代理／工作流段：同名连续成一块，没发就一条都不出（预留位不等于摆假块）', () => {
  const subagentTrail = [
    { stage: 'subagent', name: '研究员', callId: 's1', task: '查伏笔', ok: false },
    { stage: 'subagent', name: '研究员', callId: 's2', task: '', ok: false },
    { stage: 'workflow-step', name: '分段执笔', callId: 'f1', step: 1 }
  ]
  const live = buildTimelineBlocks(subagentTrail, { streaming: true })
  assert.deepEqual(live.map((block) => block.kind), ['subagent', 'subagent'], '同名的连续两段并成一块，换名字开新块')
  assert.equal(live[0].events.length, 2)
  assert.equal(live[0].name, '研究员')
  assert.equal(live[0].state, 'running', '在途：没有终态回报就说正在')
  assert.equal(live[0].headline, '正在交给子代理 研究员')
  assert.equal(live[1].headline, '正在走工作流第 1 步', '工作流段不许说成「交给子代理」')
  const settledRun = buildTimelineBlocks(subagentTrail)
  assert.deepEqual(settledRun.map((block) => block.state), ['completed', 'completed'], '收工之后两段都不再挂着进行态：说的是这一问跑完了，不是子代理成功了')
  assert.equal(settledRun[0].headline, '已交给子代理 研究员')
  assert.equal(settledRun[1].headline, '已走工作流第 1 步')

  const settled = buildTimelineBlocks([{ stage: 'subagent', name: '研究员', callId: 's1', task: '查伏笔', ok: true }])
  assert.equal(settled[0].state, 'completed', '问已收工：末块不再挂着「正在」骗人')
  assert.deepEqual(buildTimelineBlocks([]), [], '没有段就一块都不摆')
  assert.deepEqual(buildTimelineBlocks(null), [], '轨迹缺失回空序列，不抛')
})

test('streaming 只改「最后一块怎么说」，不改任何已经发生的数字与段', () => {
  const trail = [
    { stage: 'envelope', blocks: 6, chars: 1800, profile: 'writing-chapter' },
    { stage: 'tool-dropped', dropped: [{ name: 'pinax_deep_read', reason: 'limit' }] },
    { stage: 'tool-start', callId: 'c1', name: 'pinax_chapter_read' }
  ]
  const live = buildTimelineBlocks(trail, { streaming: true })
  assert.deepEqual(live.map((block) => [block.kind, block.state]), [['thinking', 'completed'], ['tool', 'running']])
  const done = buildTimelineBlocks(trail)
  assert.deepEqual(done.map((block) => [block.kind, block.state]), [['thinking', 'completed'], ['tool', 'running']])
  assert.equal(done[0].events.length, live[0].events.length, '同一叠事件，两边一条不差')
  // tool-dropped 没有 callId、也不是一次调用，它归进过程块：明细看得见，但不参与只读并组。
  assert.deepEqual(live[0].events.map((event) => event.stage), ['envelope', 'tool-dropped'], '两段过程合成一块，顺序不变')
  assert.deepEqual(live.map((block) => block.kind), ['thinking', 'tool'], 'dropped 不许冒充第二把只读工具并成一组')
  // 纯过程段收尾时：流中报「正在」，收工后报「已」——同一叠事件，只改措辞，一个数字都不动。
  const thinkingOnly = [{ stage: 'model-round', round: 1 }]
  assert.equal(buildTimelineBlocks(thinkingOnly, { streaming: true })[0].headline, '正在梳理上下文')
  assert.equal(buildTimelineBlocks(thinkingOnly)[0].headline, '已梳理上下文')
  // preparing 这一档真轨迹现在到不了（块都由带 callId 的调用段开出来）；文案位留给「排进本轮还没发」那层意思，直测工厂函数钉措辞。
  assert.equal(blockHeadline({ kind: 'tool', write: true, state: 'preparing', name: 'pinax_chapter_save' }), '等待执行')
})

test('耗时：时间差与工具自报两条都留，缺哪个就如实说缺哪个（不许拿 ms 冒充秒）', () => {
  const trail = [
    { stage: 'start', questionChars: 4, at: 1000 },
    { stage: 'tool-start', callId: 'c1', name: 'pinax_chapter_read', at: 1400 },
    { stage: 'tool-end', callId: 'c1', name: 'pinax_chapter_read', ok: true, ms: 120, at: 4400 }
  ]
  const elapsed = timelineElapsed(trail)
  assert.equal(elapsed.seconds, 3.4, '量的是外壳看到的首尾差，不含主进程排队')
  assert.equal(elapsed.toolMs, 120)
  assert.equal(elapsed.hasTimeDiff, true)
  const summary = timelineSummary(trail)
  assert.ok(summary.includes('3.4 秒'), summary)
  assert.ok(summary.includes('工具累计 120ms'), summary)

  // 老 JSONL 没有 at：只有工具自报时长，而且必须把「没记到时刻」讲明白。
  const blind = timelineSummary([{ stage: 'tool-end', callId: 'c1', name: 'pinax_chapter_read', ok: true, ms: 90 }])
  assert.ok(blind.includes('工具累计 90ms'), blind)
  assert.ok(blind.includes('外壳没记到事件时刻'), blind)
  assert.ok(!blind.includes('秒'), '没有时刻就不许报秒数')
  assert.equal(timelineElapsed([]).seconds, null)
  assert.equal(timelineElapsed([]).hasTimeDiff, false)
  assert.equal(timelineSummary([]), '这一问没留下耗时读数', '什么都没有：直说没有，不报零秒')
  assert.ok(timelineSummary(trail, { streaming: true }).startsWith('正在处理'), '流中只报进行态')
  // 不足 0.1 秒：不许写成「已处理 0 秒／已过 0 秒」那种看着像坏掉的读数，如实说不足。
  const blink = [{ stage: 'start', questionChars: 2, at: 500 }, { stage: 'answer', chars: 8, structured: false, roundsUsed: 1, at: 501 }]
  assert.equal(timelineElapsed(blink).seconds, 0)
  assert.equal(timelineSummary(blink), '已处理（不足 0.1 秒）')
  assert.equal(timelineSummary(blink, { streaming: true }), '正在处理')
})

test('timelinePath：折叠态的键带消息 id 与后缀（守卫⑨说的就是这份状态只活在内存）', () => {
  assert.equal(timelinePath('m-1'), 'm-1#trail')
  assert.equal(timelinePath('m-1', 'thinking'), 'm-1#thinking')
  assert.equal(timelinePath(null), '#trail', '缺 id 也得到一个稳定键')
})
