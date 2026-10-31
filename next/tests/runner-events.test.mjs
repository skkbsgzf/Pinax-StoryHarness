import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { NEXT_ERROR_CODES, fail } from '../kernel/errors.mjs'
import { createProject } from '../project/createProject.mjs'
import { openProject } from '../project/openProject.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { createAdvisorRunner } from '../runtime/runnerAdvisor.mjs'
import { BUILT_IN_CARRIER_PLUGINS, NOVEL_CARRIER_ID, OUTLINE_CARRIER_ID, SETTING_CARRIER_ID, WORLDBOOK_CARRIER_ID } from '../carriers/index.mjs'
import { createTempWorkspace } from '../testing/harness.mjs'

/**
 * 运行过程事件（批次29 · 任务一）。
 *
 * 这一层只证「真实节点发真事件」：
 *   1) 成功路径的事件序就是那条链的执行序（start → envelope → 每个真实轮 → answer）；
 *   2) 失败路径说清断在哪一步（failed.atStage），不外推、不补一句；
 *   3) 事件回调抛错不打断提问本身（事件是旁路，不是提问的一部分）；
 *   4) createAdvisorRunner({ onEvent }) 与单次 ask 传的事件口都通——外壳每一问带自己的 askId。
 * 前三条用注入的 buildEnvelope／runAgent，只测事件层；第四条的 blocks/chars 由真信封产出。
 */

/** 假信封：形状对齐 buildRuntimeEnvelope 的 value，不碰真实项目文件。 */
function fakeBuilt({ blocks = 6, chars = 18_240, missingKinds = [], profile = 'writing-chapter' } = {}) {
  return {
    ok: true,
    value: {
      taskType: 'authoring.review.chapter',
      capability: 'text',
      profile,
      providerKinds: ['selection'],
      missingKinds,
      warnings: [],
      dropped: [],
      envelope: {
        surface: 'authoring',
        target: { type: 'chapter', revision: 'novel-chapter:正文/第001章-入场.md:1' },
        blocks: Array.from({ length: blocks }, (_item, index) => ({
          kind: 'selection',
          priority: 1000 - index * 10,
          sourceRefs: ['novel-chapter:正文/第001章-入场.md'],
          content: '雪'.repeat(10)
        })),
        budget: { usedChars: chars, maxChars: 24_000, truncated: false }
      }
    }
  }
}

/** 运行器只用到 contextSources 的三个存在性判断：给三个非空对象即可。 */
const fakeRuntime = () => ({ contextSources: () => ({ registry: {}, view: {}, fileService: {} }) })

const SECTIONED_ADVICE = ['摘要', '节奏整体偏慢', '问题', '第三句太长', '动作', '断成两拍'].join('\n')

test('成功路径：事件序＝真实执行序（start → envelope → 每轮 → answer）', async () => {
  const events = []
  const runner = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    runAgent: async ({ taskMeta }) => {
      // 真链里这两声 acquire 由 textModelAgentProvider 发出：两声＝两轮，就该有两条 model-round。
      taskMeta.roundGuard.acquire('text-model')
      taskMeta.roundGuard.acquire('text-model')
      return { advice: SECTIONED_ADVICE, provider: { id: 'text-model' } }
    }
  })
  const answer = await runner({
    question: '这一章的开场能再狠一点吗？',
    runtime: fakeRuntime(),
    onEvent: (event) => events.push(event)
  })

  assert.equal(answer.ok, true, JSON.stringify(answer.error ?? {}))
  assert.deepEqual(events.map((event) => event.stage), ['start', 'envelope', 'model-round', 'model-round', 'answer'])
  assert.equal(events[0].questionChars, '这一章的开场能再狠一点吗？'.length)

  const envelope = events[1]
  assert.equal(envelope.taskType, 'authoring.review.chapter')
  assert.equal(envelope.profile, 'writing-chapter')
  assert.equal(envelope.blocks, 6, 'blocks 是信封里真实块数')
  assert.equal(envelope.chars, 18_240, 'chars 是信封预算里的真实已用字数')
  assert.deepEqual(envelope.missingKinds, [])

  assert.deepEqual(events.filter((event) => event.stage === 'model-round').map((event) => event.round), [1, 2], '轮次从 1 起、逐轮报')

  const done = events.at(-1)
  assert.equal(done.chars, answer.text.length, 'answer.chars 是最终给作者那段字的长度')
  assert.equal(done.structured, true, '分段建议解析成了结构化结果')
  assert.equal(done.roundsUsed, 2)
  assert.equal(answer.meta.roundsUsed, 2)
  assert.equal(answer.text, '节奏整体偏慢')

  // 同一份输入但模型只回一句原话：解析不成结构化，事件如实报 structured:false，不冒充解析成功。
  const plainEvents = []
  const plain = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    runAgent: async () => ({ advice: '就一句话。' })
  })
  const plainAnswer = await plain({ question: '问一句', runtime: fakeRuntime(), onEvent: (event) => plainEvents.push(event) })
  assert.equal(plainAnswer.text, '就一句话。')
  assert.equal(plainEvents.at(-1).structured, false)
  assert.equal(plainEvents.at(-1).roundsUsed, 0, '没占轮也照实报 0')
  assert.deepEqual(plainEvents.at(-1).chars, '就一句话。'.length)
})

test('失败路径：failed 事件带上游错误码与断点阶段（模型面 / 信封 / 没有项目）', async () => {
  const modelError = Object.assign(new Error('未检测到可用模型。请先启动 pi-agent 任务面（serve:pinax）。'), {
    code: 'AGENT_PROVIDER_CONFIG_INVALID',
    retryable: false
  })
  const modelEvents = []
  const modelRunner = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    runAgent: async ({ taskMeta }) => {
      taskMeta.roundGuard.acquire('text-model')
      throw modelError
    }
  })
  const modelAnswer = await modelRunner({ question: '这章行不行？', runtime: fakeRuntime(), onEvent: (event) => modelEvents.push(event) })
  assert.equal(modelAnswer.ok, false)
  assert.equal(modelAnswer.error.code, NEXT_ERROR_CODES.DEPENDENCY_UNMET)
  assert.equal(modelAnswer.error.message, modelError.message, '上游那句原话一个字都不改')
  assert.deepEqual(modelEvents.at(-1), {
    stage: 'failed',
    code: 'AGENT_PROVIDER_CONFIG_INVALID',
    atStage: 'model-round'
  }, '断在模型那一轮：既要上游错误码，也要断点阶段')

  const envelopeEvents = []
  const envelopeRunner = createAdvisorRunner({
    buildEnvelope: async () => fail('DEPENDENCY_UNMET', '组装不出任何上下文块'),
    runAgent: async () => assert.fail('信封没组装出来就不该调模型')
  })
  const envelopeAnswer = await envelopeRunner({ question: '这章怎么样？', runtime: fakeRuntime(), onEvent: (event) => envelopeEvents.push(event) })
  assert.equal(envelopeAnswer.ok, false)
  assert.deepEqual(envelopeEvents.map((event) => event.stage), ['start', 'failed'], '信封失败时不该有条目骗人的 envelope 事件')
  assert.deepEqual(envelopeEvents.at(-1), { stage: 'failed', code: NEXT_ERROR_CODES.DEPENDENCY_UNMET, atStage: 'envelope' })

  const bareEvents = []
  const bareRunner = createAdvisorRunner({ runAgent: async () => assert.fail('没有项目就不该调模型') })
  const bareAnswer = await bareRunner({ question: '随便问', runtime: {}, onEvent: (event) => bareEvents.push(event) })
  assert.equal(bareAnswer.ok, false)
  assert.deepEqual(bareEvents.at(-1), { stage: 'failed', code: NEXT_ERROR_CODES.INVALID_INPUT, atStage: 'start' })
})

test('事件回调抛错不打断提问：runner 级与单次级事件口都只记旁路失败', async () => {
  const runner = createAdvisorRunner({
    buildEnvelope: async () => fakeBuilt(),
    runAgent: async () => ({ advice: SECTIONED_ADVICE }),
    onEvent: () => {
      throw new Error('事件订阅者自己的 bug')
    }
  })
  const answer = await runner({ question: '这一章如何？', runtime: fakeRuntime() })
  assert.equal(answer.ok, true, '事件回调抛错不许把提问翻成失败')
  assert.equal(answer.text, '节奏整体偏慢')

  // 单次提问的事件口同样被包住：抛错也不影响这一次回答。
  const perAsk = []
  const perAskAnswer = await runner({
    question: '再问一次',
    runtime: fakeRuntime(),
    onEvent: (event) => {
      perAsk.push(event.stage)
      throw new Error('又一个 bug')
    }
  })
  assert.equal(perAskAnswer.ok, true)
  assert.deepEqual(perAsk, ['start', 'envelope', 'answer'], '回调抛错只跳过这一条之后的副作用，事件序列不因此断在第一次')

  // 完全不给事件口也能跑（两参调用面照旧）。
  const silent = createAdvisorRunner({ buildEnvelope: async () => fakeBuilt(), runAgent: async () => ({ advice: SECTIONED_ADVICE }) })
  assert.equal((await silent({ question: '没有事件口', runtime: fakeRuntime() })).ok, true)
})

/* —— 真信封：blocks/chars 不是我们编的数字，是载体块构建器产出的那份 —— */

const CHAPTER_TEXT = '# 第一章 入场\n\n他醒来时，雪已经埋了半条街。'
const OUTLINE_JSON = JSON.stringify({ nodes: [{ id: 'n1', title: '开场', summary: '雪夜醒来' }], edges: [] }, null, 2)

async function materialProject(label) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '运行过程靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  for (const plugin of BUILT_IN_CARRIER_PLUGINS) {
    assert.equal(registry.install(plugin.manifest, plugin.impl ?? {}, plugin.meta ?? {}).ok, true)
  }
  const created = await createProject({
    root,
    name: '运行过程靶子',
    primaryCarrier: NOVEL_CARRIER_ID,
    registry,
    extraEnabled: [OUTLINE_CARRIER_ID, WORLDBOOK_CARRIER_ID, SETTING_CARRIER_ID]
  })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '正文', '第001章-入场.md'), CHAPTER_TEXT, 'utf-8')
  await mkdir(join(root, '大纲'), { recursive: true })
  await writeFile(join(root, '大纲', 'outline.json'), OUTLINE_JSON, 'utf-8')
  await mkdir(join(root, '约束'), { recursive: true })
  await writeFile(join(root, '约束', '纪律.md'), '- 不许出现现代词', 'utf-8')
  await writeFile(join(root, '约束', '文风.md'), '短句为主，一拍一段。', 'utf-8')
  await mkdir(join(root, '世界书'), { recursive: true })
  await writeFile(join(root, '世界书', '人物·柯秒.md'), '冷穿越剧版主角，醒来在雪夜。', 'utf-8')
  await writeFile(join(root, '世界书', '地点·北关.md'), '北关是一座被雪埋了半条街的城。', 'utf-8')
  const opened = await openProject({ root, registry })
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? {}))
  return { workspace, registry, view: opened.value.view, fileService: opened.value.fileService }
}

test('端到端：runtime.ask 第三参的事件口拿到真信封统计（blocks／chars／missingKinds）', async () => {
  const target = await materialProject('runner-events')
  const runtime = createAgentRuntime({
    registry: target.registry,
    fileService: target.fileService,
    view: target.view,
    runner: createAdvisorRunner({
      runAgent: async ({ taskMeta }) => {
        taskMeta.roundGuard.acquire('text-model')
        return { advice: SECTIONED_ADVICE, provider: { id: 'text-model' } }
      }
    })
  })
  const events = []
  try {
    await runtime.start()
    const answer = await runtime.ask('柯秒醒来这一段节奏对不对？', {}, { onEvent: (event) => events.push(event) })
    assert.equal(answer.ok, true, JSON.stringify(answer.error ?? {}))
    assert.deepEqual(events.map((event) => event.stage), ['start', 'envelope', 'model-round', 'answer'])

    const envelope = events[1]
    assert.equal(envelope.blocks, 10, '真信封是十块（四栏的 AGENT.md ＋ 六块内容：rules/style/selection/outline/世界书×2）')
    assert.ok(envelope.chars > 0, '真信封的已用字数必须大于 0')
    assert.deepEqual(envelope.missingKinds, [], '五类素材齐时没有缺失记账')
    assert.equal(events.at(-1).roundsUsed, 1)
    assert.equal(answer.value.meta.roundsUsed, 1)

    // 两参调用面不变：不传第三参照样问得通，事件口是 null。
    const plain = await runtime.ask('再问一句', {})
    assert.equal(plain.ok, true, JSON.stringify(plain.error ?? {}))
  } finally {
    await runtime.stop()
    await target.workspace.cleanup()
  }
})
