import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWorldbookPatch,
  adoptPatch,
  reconcilePatches,
  replayBackdrop,
  PATCH_CHANNEL_VERSION
} from '../fact/usecases/deduce/patchChannel.js'
import { openDeduceSession } from '../fact/usecases/deduce/opening.js'
import { settleChoice } from '../fact/usecases/deduce/settle.js'
import { createSessionStore } from '../fact/usecases/deduce/sessionStore.js'
import { FACT_SCHEMA } from '../fact/domain/vocabulary.js'
import { stableEntryId } from '../fact/domain/stableId.js'

/**
 * P-M5 合同测试：连续宇宙（补丁通道 ＋ 多周目分支 ＋ 多视角重演）。
 *
 * 钉住 ADR 裁定 ⑤⑥⑦ 的结构性要求：
 *   ⑤ 补丁通道：只认已确认事实、一律 proposed 落地、带出处；
 *   ⑥ 读档即分支：父会话 atSeq 处开子会话、可换 POV；
 *   ⑦ 端点固定、路径自由：后跑视角的固定背景＝先跑视角的已确认拍，且不钉死自己的拍。
 */

const DOMAIN = '停摆之城'

function worldview(name = '旧钟楼', slot = 'locations') {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain: DOMAIN, slot, name }),
    layer: 'worldview', name, domain: DOMAIN, slot, status: 'adopted',
    definition: `${name}。`,
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' }
  }
}

function person(name) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name }),
    layer: 'character', name, domain: DOMAIN, status: 'adopted',
    definition: `${name}。`,
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} }
  }
}

/** 一局跑 n 拍，返回它的会话存储与事件流。 */
function runSession({ pov = '柯秒', rounds = 3, runId = 'run-a' } = {}) {
  const entries = [worldview(), person('柯秒'), person('奥黛丽')]
  const opened = openDeduceSession({ entries, pov, runId })
  const store = createSessionStore()
  store.create({ sessionId: opened.session.runId, pov, worldHash: opened.session.worldHash })
  let seq = 1
  store.appendEvent(opened.session.runId, seq++, { type: 'opening', pov })
  for (let round = 1; round <= rounds; round += 1) {
    opened.state.round = round
    settleChoice({
      state: opened.state, domain: DOMAIN,
      candidate: { text: `${pov}第${round}拍做了什么`, source: '必然', refs: ['旧钟楼'], goal: '查清钟声' }
    })
    store.appendEvent(opened.session.runId, seq++, { type: 'settle', round, text: `${pov}第${round}拍做了什么`, source: '必然', pov, decidedBy: 'fate', runId: opened.session.runId, goal: '查清钟声', refs: ['旧钟楼'] })
  }
  return { opened, store, events: store.listEvents(opened.session.runId).events }
}

test('版本常量', () => {
  assert.equal(PATCH_CHANNEL_VERSION, 'fact-patch@1')
})

test('补丁通道：只认已确认事实——hypothesis 与非 settle 事件进不来', () => {
  const events = [
    { type: 'opening', pov: '柯秒' },
    { type: 'candidates', round: 1, candidates: [{ text: '未选的戏剧分支', source: '戏剧', adopted: false }] },
    { type: 'settle', round: 1, text: '确认的一拍', pov: '柯秒', decidedBy: 'fate' },
    { type: 'hypothesis', round: 2, text: '悬而未决的假设', hypothesis: true, open: true },
    { type: 'settle', round: 2, text: '受阻留下的拍', pov: '柯秒', hypothesis: true },
    { type: 'knowledge-delta', gained: ['旧钟楼'] }
  ]
  const patch = buildWorldbookPatch({ events, domain: DOMAIN, bookId: 'abcd1234' })
  assert.equal(patch.counts.confirmedBeats, 1, '只有那一条真 settle 算已确认')
  assert.equal(patch.patches.length, 1)
  assert.equal(patch.patches[0].definition, '确认的一拍')
  assert.equal(patch.patches[0].window, undefined)
})

test('补丁一律 proposed 落地：不直接改世界书，采纳要作者显式动作', () => {
  const { events } = runSession({ rounds: 2 })
  const patch = buildWorldbookPatch({ events, domain: DOMAIN, bookId: 'abcd1234' })
  assert.ok(patch.patches.length >= 2)
  assert.ok(patch.patches.every((item) => item.status === 'proposed'), '补丁全 proposed')

  const adopted = adoptPatch(patch.patches[0])
  assert.equal(adopted.ok, true)
  assert.equal(adopted.patch.status, 'adopted')
  // 已经是 adopted 的再采纳要被拒（状态转移不合法）
  const again = adoptPatch(adopted.patch)
  assert.equal(again.ok, false)
  assert.equal(again.code, 'NOT_PROPOSED')
})

test('补丁带出处：runId/pov/round/decidedBy 都在 provenance 里（多周目可追溯）', () => {
  const { events, opened } = runSession({ rounds: 2, runId: 'run-x' })
  const patch = buildWorldbookPatch({ events, domain: DOMAIN, bookId: 'abcd1234' })
  for (const item of patch.patches) {
    assert.equal(item.provenance.runId, opened.session.runId)
    assert.equal(item.provenance.pov, '柯秒')
    assert.ok(Number.isInteger(item.provenance.round))
    assert.equal(item.provenance.decidedBy, 'fate')
  }
})

test('补丁幂等：同一事件回写两次不产生重复条目', () => {
  const { events } = runSession({ rounds: 2 })
  const first = buildWorldbookPatch({ events, domain: DOMAIN, bookId: 'abcd1234' })
  const second = buildWorldbookPatch({
    events, domain: DOMAIN, bookId: 'abcd1234',
    existingIds: first.patches.map((item) => item.id)
  })
  assert.equal(second.patches.length, 0, '第二次一条都不新增')
  assert.equal(second.counts.duplicate, first.patches.length)
  assert.ok(second.notes.some((note) => /幂等/u.test(note)))
})

test('多周目并存：不同 runId 的补丁并存；同 id 或同 run+pov+round 才算重复', () => {
  const runA = runSession({ rounds: 2, runId: 'run-a' })
  const runB = runSession({ rounds: 2, runId: 'run-b', pov: '奥黛丽' })
  const patchA = buildWorldbookPatch({ events: runA.events, domain: DOMAIN, bookId: 'abcd1234' })
  const patchB = buildWorldbookPatch({ events: runB.events, domain: DOMAIN, bookId: 'abcd1234' })

  const merged = reconcilePatches(patchA.patches, patchB.patches)
  assert.equal(merged.ok, true)
  assert.equal(merged.counts.accepted, patchB.patches.length, '另一局另一视角的补丁全部并存')
  assert.equal(merged.counts.duplicates, 0)

  // 同一批再来一次：全部重复
  const again = reconcilePatches([...patchA.patches, ...patchB.patches], patchB.patches)
  assert.equal(again.counts.accepted, 0)
  assert.ok(again.duplicates.every((item) => item.reason === 'same-id'))
})

test('多视角重演：先跑视角的已确认拍成为固定端点，且不钉死自己的拍', () => {
  const runA = runSession({ pov: '柯秒', rounds: 3, runId: 'run-a' })
  // 奥黛丽重演同一时段：柯秒的拍是固定背景，奥黛丽自己没有先跑记录
  const backdrop = replayBackdrop(runA.events, { pov: '奥黛丽' })
  assert.equal(backdrop.counts.fixed, 3)
  assert.deepEqual(backdrop.coveredRounds, [1, 2, 3])
  assert.ok(backdrop.fixedEndpoints.every((item) => item.fixed === true))
  assert.ok(backdrop.fixedEndpoints.every((item) => item.pov === '柯秒'))

  // 柯秒自己重演：自己的拍不该钉死自己（否则等于重放录像）
  const own = replayBackdrop(runA.events, { pov: '柯秒' })
  assert.equal(own.counts.fixed, 0)
  assert.equal(own.counts.excludedOwn, 3)
})

test('换视角开局：端点进 session.replay 与 state.replayEndpoints（戏剧层据此锁端点）', () => {
  const runA = runSession({ pov: '柯秒', rounds: 2, runId: 'run-a' })
  const entries = [worldview(), person('柯秒'), person('奥黛丽')]
  const replay = openDeduceSession({ entries, pov: '奥黛丽', priorEvents: runA.events, lineage: { parent: 'run-a', atSeq: 1 } })
  assert.ok(replay.session.replay)
  assert.equal(replay.session.replay.fixedEndpoints.length, 2)
  assert.deepEqual(replay.session.replay.coveredRounds, [1, 2])
  assert.deepEqual(replay.session.lineage, { parent: 'run-a', atSeq: 1 })
  assert.equal(replay.state.replayEndpoints.length, 2, '状态上要有端点，presentTurn 才传得下去')
})

test('首周目不带重演端点：没传 priorEvents 就没有 replay（不凭空造别人的固定背景）', () => {
  const entries = [worldview(), person('柯秒')]
  const opened = openDeduceSession({ entries, pov: '柯秒' })
  assert.equal(opened.session.replay, undefined)
  assert.equal(opened.state.replayEndpoints, undefined)
})

test('读档即分支：父会话 atSeq 处开子会话、可换 POV、父段事件作前缀', () => {
  const runA = runSession({ pov: '柯秒', rounds: 3, runId: 'run-a' })
  const store = runA.store
  const branched = store.branch('run-a', 4, { newPov: '奥黛丽' })
  assert.equal(branched.ok, true, JSON.stringify(branched))
  assert.equal(branched.pov, '奥黛丽')
  const child = store.listEvents(branched.sessionId)
  assert.equal(child.ok, true)
  assert.ok(child.events.length <= 4, '子会话继承父会话 ≤atSeq 的事件')
  assert.equal(store.lineage(branched.sessionId).parent, 'run-a')
  assert.equal(store.lineage(branched.sessionId).atSeq, 4)

  // 分支后子会话继续跑，父会话不受影响（读档不污染原局）
  const before = store.listEvents('run-a').events.length
  store.appendEvent(branched.sessionId, 100, { type: 'settle', round: 9, text: '子局新拍', pov: '奥黛丽' })
  assert.equal(store.listEvents('run-a').events.length, before, '父会话事件数不变')
  assert.ok(store.listEvents(branched.sessionId).events.some((event) => event.text === '子局新拍'))
})

test('端到端：一局跑完 → 补丁 → 另一局重演 → 两批补丁并存（同一事件图被两双眼睛各织一遍）', () => {
  const runA = runSession({ pov: '柯秒', rounds: 3, runId: 'run-a' })
  const patchA = buildWorldbookPatch({ events: runA.events, domain: DOMAIN, bookId: 'abcd1234' })
  assert.ok(patchA.patches.length > 0)

  const entries = [worldview(), person('柯秒'), person('奥黛丽')]
  const replay = openDeduceSession({ entries, pov: '奥黛丽', priorEvents: runA.events })
  // 奥黛丽自己跑两拍
  const storeB = createSessionStore()
  storeB.create({ sessionId: 'run-b', pov: '奥黛丽', worldHash: replay.session.worldHash })
  let seq = 1
  for (let round = 1; round <= 2; round += 1) {
    replay.state.round = round
    settleChoice({ state: replay.state, domain: DOMAIN, candidate: { text: `奥黛丽第${round}拍看见的`, source: '戏剧', refs: ['旧钟楼'], goal: '找出内鬼' } })
    storeB.appendEvent('run-b', seq++, { type: 'settle', round, text: `奥黛丽第${round}拍看见的`, pov: '奥黛丽', decidedBy: 'author', runId: 'run-b', goal: '找出内鬼', refs: ['旧钟楼'] })
  }
  const patchB = buildWorldbookPatch({ events: storeB.listEvents('run-b').events, domain: DOMAIN, bookId: 'abcd1234' })
  assert.ok(patchB.patches.length >= 2)
  assert.ok(patchB.patches.every((item) => item.provenance.pov === '奥黛丽'))

  const merged = reconcilePatches(patchA.patches, patchB.patches)
  assert.equal(merged.counts.accepted, patchB.patches.length, '两个视角的补丁并存')
  assert.equal(merged.counts.duplicates, 0, '没有误判成重复')

  // 固定端点仍在：奥黛丽这一局的补丁没有改写柯秒的拍（柯秒的 3 条补丁文本不变）
  const aTexts = patchA.patches.map((item) => item.definition).sort()
  const afterTexts = merged.accepted.map((item) => item.definition).sort()
  assert.ok(aTexts.every((text) => !text.includes('奥黛丽')), '柯秒的补丁里不该混进奥黛丽的拍')
  assert.ok(afterTexts.every((text) => !text.includes('柯秒')), '奥黛丽的补丁里不该混进柯秒的拍')
})
