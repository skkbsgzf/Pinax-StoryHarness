import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { BUILT_IN_CARRIER_PLUGINS, NOVEL_CARRIER_ID, OUTLINE_CARRIER_ID, SETTING_CARRIER_ID, WORLDBOOK_CARRIER_ID } from '../carriers/index.mjs'
import { AGENT_CONTEXT_PROFILES } from '../../shared/agentContextProfiles.js'
import { validateAgentContextEnvelope } from '../../shared/agentContextContract.js'
import { buildRuntimeEnvelope, readOnlyProfiles, readOnlyTaskForProfile } from '../runtime/contextProfiles.mjs'
import { createAdvisorRunner, ADVISOR_RUNNER_SOURCE } from '../runtime/runnerAdvisor.mjs'
import { CHAPTER_REVIEW_QUESTION } from '../shell/useBoardData.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * M2 · WP3 收口：运行时接上进程内 advisor 运行器。
 * 这一批证的四件事都有真字节做证：
 *   1) 档案名 → 只读任务号 只认既有只读档，映射不到就拒答（绝不换一个有写盘副作用的任务冒充）；
 *   2) 上下文块一律由载体提供：小说给 selection/outline，设定给 rules/style/worldbook，
 *      没启用的板块就是一条 missing 记账，运行时不越过去自己开文件；
 *   3) 组装出的信封过的是 shared 里那份既有合同校验（validateAgentContextEnvelope），
 *      与浏览器/服务端 advisor 同一口径，不新造一套信封格式；
 *   4) 模型面不可达时把内核那句原话带回给作者，运行时一个字都不替模型编。
 * 用例里的 runAgent 一律是注入的假实现：这条链的真实出口是内核任务面，测试不去探它的端口。
 */

const CHAPTER_TEXT = '# 第一章 入场\n\n他醒来时，雪已经埋了半条街。'
const OUTLINE_JSON = JSON.stringify({ nodes: [{ id: 'n1', title: '开场', summary: '雪夜醒来' }], edges: [] }, null, 2)

async function materialProject(label, { extraEnabled = [OUTLINE_CARRIER_ID, WORLDBOOK_CARRIER_ID, SETTING_CARRIER_ID], fill = true, chapterChars = null, bigRules = 0 } = {}) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '上下文靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    const installed = registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
    assert.equal(installed.ok, true, JSON.stringify(installed.error ?? {}))
  }
  const created = await createProject({ root, name: '上下文靶子', primaryCarrier: NOVEL_CARRIER_ID, registry, extraEnabled })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  if (fill) {
    await mkdir(join(root, '正文'), { recursive: true })
    await writeFile(join(root, '正文', '第001章-入场.md'), chapterChars ? `${CHAPTER_TEXT}\n${'雪'.repeat(chapterChars)}` : CHAPTER_TEXT, 'utf-8')
    await mkdir(join(root, '大纲'), { recursive: true })
    await writeFile(join(root, '大纲', 'outline.json'), OUTLINE_JSON, 'utf-8')
    await mkdir(join(root, '约束'), { recursive: true })
    await writeFile(join(root, '约束', '纪律.md'), '- 不许出现现代词\n- 每章 2000 字', 'utf-8')
    await writeFile(join(root, '约束', '文风.md'), '短句为主，一拍一段。', 'utf-8')
    for (let index = 0; index < bigRules; index += 1) {
      await writeFile(join(root, '约束', `设定册-${index}.md`), `# 设定册 ${index}\n\n${'规矩'.repeat(3000)}`, 'utf-8')
    }
    await mkdir(join(root, '世界书'), { recursive: true })
    await writeFile(join(root, '世界书', '人物·柯秒.md'), '---\nschemaVersion: 1\nid: kb-1\nname: 人物·柯秒\ntype: character\nkeys:\n  - 柯秒\n---\n\n冷穿越剧版主角，醒来在雪夜。', 'utf-8')
    await writeFile(join(root, '世界书', '地点·北关.md'), '北关是一座被雪埋了半条街的城。', 'utf-8')
  }
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  return { workspace, root, registry, view: opened.value.view, fileService: opened.value.fileService }
}

test('档案名只认只读任务：writing-chapter 映射到 authoring.review.chapter，映射不到的一律拒答', async () => {
  const definition = readOnlyTaskForProfile('writing-chapter')
  assert.equal(definition.id, 'authoring.review.chapter')
  assert.equal(definition.effectPolicy, 'review-only', '只读档才可被运行时使用')
  assert.equal(readOnlyTaskForProfile('narrative-scene'), null, '写作生成档带写盘副作用，不允许运行时借它答题')
  assert.ok(readOnlyProfiles().includes('writing-chapter'))

  const target = await materialProject('ctx-unknown-profile')
  try {
    const built = await buildRuntimeEnvelope({
      registry: target.registry,
      view: { ...target.view, contextProfile: 'narrative-scene' },
      fileService: target.fileService,
      question: '这段节奏对不对？'
    })
    assert.equal(built.ok, false)
    assert.equal(built.error.code, NEXT_ERROR_CODES.DEPENDENCY_UNMET)
    assert.match(built.error.message, /不会自行换一个有写盘副作用的任务/)
  } finally {
    await target.workspace.cleanup()
  }
})

test('信封由载体块拼成：五块齐、优先级按档案顺序、过的既有合同校验、target 带章节修订', async () => {
  const target = await materialProject('ctx-envelope')
  try {
    const built = await buildRuntimeEnvelope({
      registry: target.registry,
      view: target.view,
      fileService: target.fileService,
      question: '柯秒醒来这一段节奏对不对？'
    })
    assert.equal(built.ok, true, JSON.stringify(built.error ?? {}))
    const payload = built.value
    assert.equal(payload.taskType, 'authoring.review.chapter')
    assert.equal(payload.capability, 'text')
    const allowed = AGENT_CONTEXT_PROFILES['writing-chapter'].blocks
    // 协议 v3 的 agentMd 面：四栏的作者须知排在内容块前面（优先级 1100），内容块仍按档案顺序排。
    const agentMdBlocks = payload.envelope.blocks.filter((block) => block.kind === 'agent-md')
    assert.equal(agentMdBlocks.length, 4, '小说／大纲／世界书／设定四栏的 AGENT.md 都进信封')
    assert.deepEqual([...new Set(agentMdBlocks.map((block) => block.priority))], [1100])
    assert.ok(agentMdBlocks.every((block) => block.sourceRefs[0].startsWith('agentmd:')))
    assert.deepEqual(payload.envelope.blocks.map((block) => block.kind), ['agent-md', 'agent-md', 'agent-md', 'agent-md', 'rules', 'style', 'selection', 'outline', 'worldbook', 'worldbook'])
    assert.deepEqual(payload.missingKinds, [])
    payload.envelope.blocks.forEach((block, index) => {
      const kind = block.kind
      if (kind !== 'agent-md') {
        assert.equal(block.priority, 1000 - allowed.indexOf(kind) * 10, `${kind} 的优先级要和档案顺序对齐`)
      }
      assert.ok(block.sourceRefs.length > 0 && block.sourceRefs.length <= 32)
      assert.ok(block.sourceRefs.every((ref) => ref.length <= 200))
      assert.ok(index === 0 || block.priority <= payload.envelope.blocks[index - 1].priority)
    })
    assert.equal(payload.envelope.surface, 'authoring', 'surface 取任务的 owner，不是载体的名字')
    assert.equal(payload.envelope.target.type, 'chapter')
    assert.match(payload.envelope.target.revision, /^novel-chapter:正文\/第001章-入场\.md:\d+$/)
    assert.equal(payload.envelope.budget.maxChars, 24000, '预算取档案与任务上限的较小者')
    assert.equal(payload.envelope.budget.usedChars <= payload.envelope.budget.maxChars, true)
    assert.equal(validateAgentContextEnvelope(payload.envelope, { surfaces: undefined }).valid, true)
    // 素材来源必须逐条对得上板块目录，作者才查得到「模型看了哪份文件」。
    const refs = payload.envelope.blocks.flatMap((block) => block.sourceRefs)
    assert.ok(refs.some((ref) => ref.startsWith('setting-rules:约束/')))
    assert.ok(refs.some((ref) => ref.startsWith('setting-style:约束/')))
    assert.ok(refs.some((ref) => ref.startsWith('worldbook:世界书/')))
    assert.ok(refs.some((ref) => ref.startsWith('novel-chapter:正文/')))
    assert.ok(refs.some((ref) => ref.startsWith('outline:大纲/')))
  } finally {
    await target.workspace.cleanup()
  }
})

test('审查本章的固定问句走同一份 writing-chapter 信封：正文/约束/文风/大纲/世界书都在，任务号仍是 authoring.review.chapter', async () => {
  const target = await materialProject('ctx-review-question')
  try {
    const built = await buildRuntimeEnvelope({
      registry: target.registry,
      view: target.view,
      fileService: target.fileService,
      question: CHAPTER_REVIEW_QUESTION
    })
    assert.equal(built.ok, true, JSON.stringify(built.error ?? {}))
    assert.equal(built.value.taskType, 'authoring.review.chapter', '审查本章不另造任务号')
    const kinds = built.value.envelope.blocks.map((block) => block.kind)
    for (const kind of ['selection', 'rules', 'style', 'outline', 'worldbook']) {
      assert.ok(kinds.includes(kind), `审查信封里应有「${kind}」块：${kinds.join('/')}`)
    }
    assert.ok(built.value.envelope.blocks.some((block) => block.kind === 'selection' && block.sourceRefs?.some((ref) => ref.startsWith('novel-chapter:正文/'))), '审查看的就是正文那一份字节')
  } finally {
    await target.workspace.cleanup()
  }
})

test('正文块与工具读到的是同一份字节；未指定章节时如实记账默认取了最后一章', async () => {
  const target = await materialProject('ctx-same-bytes')
  try {
    const runtime = createAgentRuntime({ registry: target.registry, fileService: target.fileService, view: target.view })
    await runtime.start()
    const read = await runtime.callTool('pinax_chapter_read', { index: 0 })
    assert.equal(read.ok, true)
    assert.equal(read.value.payload.ok, true, JSON.stringify(read.value.payload))
    const built = await buildRuntimeEnvelope({ registry: target.registry, view: target.view, fileService: target.fileService, question: '看一下' })
    const selection = built.value.envelope.blocks.find((block) => block.kind === 'selection')
    assert.ok(selection.content.includes(read.value.payload.text), '预塞的正文块必须是工具返回的那段字，不能是第二条取数路径')
    assert.ok(built.value.warnings.some((warning) => /默认取最后一章/.test(warning)), '默认口径要写进账，不能悄悄替作者选章')

    const pointed = await buildRuntimeEnvelope({ registry: target.registry, view: target.view, fileService: target.fileService, question: '看一下', context: { chapterIndex: 0 } })
    assert.equal(pointed.value.warnings.some((warning) => /默认取最后一章/.test(warning)), false, '点名了就不该再记默认账')
  } finally {
    await target.workspace.cleanup()
  }
})

test('板块缺席只记账不硬失败：未启用设定/大纲/世界书时 rules/style/outline/worldbook 进 missingKinds', async () => {
  const target = await materialProject('ctx-missing-provider', { extraEnabled: [] })
  try {
    const built = await buildRuntimeEnvelope({ registry: target.registry, view: target.view, fileService: target.fileService, question: '节奏对不对？' })
    assert.equal(built.ok, true, JSON.stringify(built.error ?? {}))
    assert.deepEqual(built.value.providerKinds, ['selection'])
    assert.deepEqual(built.value.missingKinds.sort(), ['outline', 'rules', 'style', 'worldbook'])
    assert.ok(built.value.warnings.some((warning) => /没有提供者/.test(warning)))
    assert.deepEqual(built.value.envelope.blocks.map((block) => block.kind), ['agent-md', 'selection'], '只有小说一栏开着：它那份作者须知也跟着进信封')
  } finally {
    await target.workspace.cleanup()
  }
})

test('素材为空时拒发空信封：宁可不答，也不发一个只有提问没有书的信封', async () => {
  const target = await materialProject('ctx-empty', { fill: false })
  try {
    const built = await buildRuntimeEnvelope({ registry: target.registry, view: target.view, fileService: target.fileService, question: '这章怎么样？' })
    assert.equal(built.ok, false)
    assert.equal(built.error.code, NEXT_ERROR_CODES.DEPENDENCY_UNMET)
    assert.match(built.error.message, /组装不出任何上下文块/)
    assert.ok(Array.isArray(built.error.details.missingKinds))
  } finally {
    await target.workspace.cleanup()
  }
})

test('超预算就裁：单块有上限、整封不越界、被挤掉的块逐条记账', async () => {
  // 只有一章超长：正文块自身先按载体上限截，信封仍装得下，账上留「只带前 N 字」。
  const longChapter = await materialProject('ctx-clip-block', { chapterChars: 40_000 })
  try {
    const built = await buildRuntimeEnvelope({ registry: longChapter.registry, view: longChapter.view, fileService: longChapter.fileService, question: '节奏对不对？' })
    assert.equal(built.ok, true)
    assert.ok(built.value.warnings.some((warning) => /只带前/.test(warning)), JSON.stringify(built.value.warnings))
    assert.equal(built.value.envelope.budget.usedChars <= built.value.envelope.budget.maxChars, true)
  } finally {
    await longChapter.workspace.cleanup()
  }

  // 约束册子把预算吃满：信封按优先级裁，被挤掉的块（含正文）必须在 dropped 里逐条留名，不静默丢。
  const crowded = await materialProject('ctx-clip-envelope', { bigRules: 6 })
  try {
    const built = await buildRuntimeEnvelope({ registry: crowded.registry, view: crowded.view, fileService: crowded.fileService, question: '节奏对不对？' })
    assert.equal(built.ok, true)
    const envelope = built.value.envelope
    assert.equal(envelope.budget.truncated, true)
    assert.equal(envelope.budget.usedChars <= envelope.budget.maxChars, true)
    assert.ok(built.value.dropped.length > 0, '超出的块要进 dropped 记账')
    assert.ok(built.value.dropped.some((item) => item.kind === 'selection'), '正文被约束挤掉时也要留名，作者才看得见是谁吃了预算')
    assert.ok(envelope.blocks.every((block) => block.priority >= built.value.dropped[0].priority), '留下的块优先级不低于被裁的块')
  } finally {
    await crowded.workspace.cleanup()
  }
})

test('端到端：runtime.ask 走进程内 advisor，信封/任务号/轮数闸都交给运行器，回答带出处', async () => {
  const target = await materialProject('ctx-runner')
  const seen = []
  const runtime = createAgentRuntime({
    registry: target.registry,
    fileService: target.fileService,
    view: target.view,
    runner: createAdvisorRunner({
      runAgent: async ({ envelope, question, taskMeta, capability, providerId }) => {
        seen.push({
          blocks: envelope.blocks.length,
          question,
          taskType: taskMeta.taskType,
          capability,
          providerId,
          target: envelope.target,
          guard: typeof taskMeta.roundGuard?.acquire === 'function' ? taskMeta.roundGuard : null
        })
        // 真链里这一声 acquire 由 textModelAgentProvider 发出；假实现照样按同一合同占用，
        // 于是 meta.roundsUsed 记的是「这次提问真的用了几回合」，不是我们 pretend 的数。
        seen[seen.length - 1].guard?.acquire('text-model')
        return { advice: '第三句太长，建议断成两拍。', provider: { id: 'text-model', capabilities: ['text'], timeoutMs: 45000, fallbackUsed: false } }
      }
    })
  })
  try {
    await runtime.start()
    const answer = await runtime.ask('柯秒醒来这一段节奏对不对？')
    assert.equal(answer.ok, true, JSON.stringify(answer.error ?? {}))
    assert.equal(answer.value.source, ADVISOR_RUNNER_SOURCE)
    assert.match(answer.value.text, /第三句太长/)
    assert.equal(seen.length, 1, '一次提问＝一次上游调用（重试由内核那条链自己管）')
    assert.equal(seen[0].taskType, 'authoring.review.chapter')
    assert.equal(seen[0].capability, 'text')
    assert.equal(seen[0].providerId, 'text-model')
    assert.equal(seen[0].blocks, 10, '真信封是十块：四栏的 AGENT.md ＋ 六块内容（rules/style/selection/outline/世界书×2）')
    assert.ok(seen[0].guard, '单次请求的模型调用轮数闸必须透传给运行器（与 advisor 路由同口径）')
    assert.equal(answer.value.meta.taskType, 'authoring.review.chapter')
    assert.match(answer.value.meta.targetRevision, /^novel-chapter:正文/)
    assert.ok(answer.value.meta.sourceRefs.some((ref) => ref.startsWith('novel-chapter:')), '回答要能追到看了哪份稿子')
    assert.equal(answer.value.meta.roundsUsed, 1)
  } finally {
    await runtime.stop()
    await target.workspace.cleanup()
  }
})

test('模型面不可达：内核那句原话透传给作者，运行时不编一个字的回答', async () => {
  const target = await materialProject('ctx-unreachable')
  const kernelMessage = '未检测到可用模型。请先启动 pi-agent 任务面（serve:pinax），并在设置中选择模型。'
  const runtime = createAgentRuntime({
    registry: target.registry,
    fileService: target.fileService,
    view: target.view,
    runner: createAdvisorRunner({
      runAgent: async () => {
        const error = new Error(kernelMessage)
        error.code = 'AGENT_PROVIDER_CONFIG_INVALID'
        error.retryable = false
        throw error
      }
    })
  })
  try {
    await runtime.start()
    const answer = await runtime.ask('这章行不行？')
    assert.equal(answer.ok, false)
    assert.equal(answer.error.code, NEXT_ERROR_CODES.DEPENDENCY_UNMET)
    assert.equal(answer.error.message, kernelMessage, '上游文案一个字都不许改')
    assert.equal(answer.error.details.code, 'AGENT_PROVIDER_CONFIG_INVALID')
    assert.equal(answer.error.details.taskType, 'authoring.review.chapter')
  } finally {
    await runtime.stop()
    await target.workspace.cleanup()
  }
})

test('没有项目就没有素材：运行器如实报「还没打开项目」，不去猜任何一个目录', async () => {
  const bareRegistry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) bareRegistry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {})
  const runtime = createAgentRuntime({ registry: bareRegistry, runner: createAdvisorRunner({ runAgent: async () => ({ advice: '绝不该被调用' }) }) })
  try {
    await runtime.start()
    const answer = await runtime.ask('随便问一句')
    assert.equal(answer.ok, false)
    assert.equal(answer.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.match(answer.error.message, /没有打开项目/)
  } finally {
    await runtime.stop()
  }
})

test('提问为空仍由运行时先拦：不给运行器一个空问题去烧模型调用', async () => {
  const target = await materialProject('ctx-empty-question')
  let calls = 0
  const runtime = createAgentRuntime({
    registry: target.registry,
    fileService: target.fileService,
    view: target.view,
    runner: createAdvisorRunner({ runAgent: async () => { calls += 1; return { advice: 'x', provider: {} } } })
  })
  try {
    await runtime.start()
    const answer = await runtime.ask('   ')
    assert.equal(answer.ok, false)
    assert.equal(answer.error.code, NEXT_ERROR_CODES.INVALID_INPUT)
    assert.equal(calls, 0)
  } finally {
    await runtime.stop()
    await target.workspace.cleanup()
  }
})
