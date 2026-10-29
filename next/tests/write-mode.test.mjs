import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionStore, formatClock } from '../shell/agentSessions.mjs'
import { createAgentRuntime } from '../runtime/agentRuntime.mjs'
import { createAdvisorRunner } from '../runtime/runnerAdvisor.mjs'
import { normalizeWriteMode, WRITE_MODES } from '../runtime/writePolicy.mjs'

/**
 * 写模式是真值（M2.5-B · 任务二）。
 *
 * 三处都必须同一条口径：未知值回落 review、切到 auto 只认作者确认、每次切换留一条会话事件。
 *   - 会话层（agentSessions）：模式与事件随会话落盘，重开还在；
 *   - 运行时层（agentRuntime.ask）：载荷里的 writeMode 归一后交给 runner，不猜；
 *   - 运行器层（runnerAdvisor）：每一问把它传给工具循环（写策略在主进程现造）。
 * 界面上的「二次确认」在 shell-ui.spec.mjs 里测，这里测数据与接线。
 */

/** 落盘替身：收整份快照（M2.5-B 起状态机只经 save 口持久化）。 */
const recorder = () => {
  let latest = null
  const save = (payload) => { latest = JSON.parse(JSON.stringify(payload)) }
  return { save, latest: () => latest }
}

const clock = () => 1_760_000_000_000

test('会话真值：切模式写事件、随会话落盘、未知值回落 review', () => {
  const saver = recorder()
  const store = createSessionStore('D:/mode-truth', { save: saver.save, now: clock })
  assert.deepEqual(WRITE_MODES, ['review', 'auto', 'blocked'])
  assert.equal(store.snapshot().writeMode, 'review', '缺省永远是 review')

  assert.equal(store.setWriteMode('auto'), true)
  let snapshot = store.snapshot()
  assert.equal(snapshot.writeMode, 'auto')
  assert.deepEqual(snapshot.events.map((event) => [event.kind, event.from, event.to, event.by]), [['mode', 'review', 'auto', 'author']])

  // 同一个模式再切一次不重复记事件（没有变化就没有事实）。
  store.setWriteMode('auto')
  assert.equal(store.snapshot().events.length, 1)

  // 未知值回落 review：从 auto 掉回 review 是一条真事件，不能悄悄改。
  store.setWriteMode('yolo')
  snapshot = store.snapshot()
  assert.equal(snapshot.writeMode, 'review')
  assert.deepEqual(snapshot.events.map((event) => event.to), ['auto', 'review'])

  // 落盘往返：换一个 store 实例读主进程读回的那份（initial），模式与事件都还在。
  const reopened = createSessionStore('D:/mode-truth', { initial: saver.latest(), save: saver.save, now: clock })
  assert.equal(reopened.snapshot().writeMode, 'review')
  assert.equal(reopened.snapshot().events.length, 2)

  // 坏事件不进存储：未知 kind／非法 from/to 一律丢。
  const cleaned = createSessionStore('D:/mode-truth-2', { now: clock })
  assert.equal(cleaned.recordEvent({ kind: 'tool', from: 'review', to: 'auto' }), null)
  assert.equal(cleaned.recordEvent({ kind: 'mode', from: 'review', to: 'yolo' }), null)
  assert.deepEqual(cleaned.recordEvent({ kind: 'mode', from: 'review', to: 'blocked' }), {
    kind: 'mode',
    from: 'review',
    to: 'blocked',
    by: 'author',
    // 时刻随本机时区：断言的形状是「时钟格式化过的那一秒」，不写死某台机器的时区读数。
    at: formatClock(clock())
  })
})

test('会话隔离：每个会话有自己的写模式，切会话就切真值', () => {
  const store = createSessionStore('D:/mode-sessions', { save: recorder().save, now: clock })
  const first = store.snapshot().activeId
  store.setWriteMode('auto')
  const second = store.create('另一件事').id
  assert.equal(store.snapshot().writeMode, 'review', '新会话从 review 起，不继承上一件的模式')
  store.switchTo(first)
  assert.equal(store.snapshot().writeMode, 'auto', '切回去还是它自己的真值')
  assert.notEqual(second, first)
})

test('运行时归一：ask 把 writeMode 原样传给 runner，未知值回落 review', async () => {
  const seen = []
  const runtime = createAgentRuntime({
    runner: async ({ writeMode, skill }) => {
      seen.push({ writeMode, skill })
      return { text: '好' }
    }
  })
  const first = await runtime.ask('问一句', {}, { writeMode: 'auto' })
  assert.equal(first.ok, true)
  const second = await runtime.ask('再问', {}, { writeMode: 'yolo' })
  assert.equal(second.ok, true)
  await runtime.ask('没带', {})
  assert.deepEqual(seen.map((item) => item.writeMode), ['auto', 'review', 'review'])
  assert.deepEqual(seen.map((item) => item.skill), [null, null, null])
})

test('技能随 ask 走：未知技能如实拒绝；已装载的技能以清单形状交给 runner', async () => {
  const seen = []
  const runtime = createAgentRuntime({
    runner: async ({ skill }) => {
      seen.push(skill)
      return { text: '好' }
    }
  })
  const catalog = [{ name: 'continuity-check', description: '核对连续性。', tools: ['pinax_chapter_read'], output: 'checklist' }]
  runtime.skills = () => ({ names: catalog.map((item) => item.name), rejected: [], catalog })

  const ok = await runtime.ask('查连续性', {}, { skill: 'continuity-check' })
  assert.equal(ok.ok, true)
  assert.deepEqual(seen[0], catalog[0])

  const unknown = await runtime.ask('查连续性', {}, { skill: 'no-such-skill' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'PINAX_INVALID_INPUT')
  assert.match(unknown.error.message, /没有这个技能/)
})

test('运行器把 writeMode 交给循环；policy 是工厂时每一问现造', async () => {
  const loopInputs = []
  const runner = createAdvisorRunner({
    buildEnvelope: async () => ({
      ok: true,
      value: {
        taskType: 'authoring.review.chapter',
        capability: 'text',
        profile: 'writing-chapter',
        missingKinds: [],
        warnings: [],
        envelope: {
          target: { type: 'chapter', revision: 'r1' },
          blocks: [{ kind: 'selection', priority: 1000, sourceRefs: [], content: '雪' }],
          budget: { usedChars: 10, maxChars: 24_000, truncated: false }
        }
      }
    }),
    toolLoop: {
      async run(input) {
        loopInputs.push({ writeMode: input.writeMode, skill: input.skill })
        return { kind: 'final', text: '好', steps: [], calls: [], dropped: [] }
      }
    }
  })
  const runtime = {
    contextSources: () => ({ registry: {}, view: {}, fileService: {} }),
    listTools: () => [],
    skills: () => ({ names: [], rejected: [], catalog: [] })
  }
  const auto = await runner({ question: '改这一章', runtime, writeMode: 'auto' })
  assert.equal(auto.meta.writeMode, 'auto')
  const unknown = await runner({ question: '再改', runtime, writeMode: 'yolo' })
  assert.equal(unknown.meta.writeMode, 'review', '未知模式进 meta 前就归一')
  assert.deepEqual(loopInputs.map((item) => item.writeMode), ['auto', 'yolo'], '循环拿到载荷原值，归一由策略工厂做')
  assert.equal(normalizeWriteMode('none'), 'review')
})
