import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionStore, createMemorySessionStore, SESSION_EVENT_TYPES, CHECKPOINT_PURPOSES } from '../fact/usecases/deduce/sessionStore.js'
import { presentTurn } from '../fact/usecases/deduce/turn.js'
import { settleChoice } from '../fact/usecases/deduce/settle.js'
import { openDeduceSession } from '../fact/usecases/deduce/opening.js'
import { createMemoryFactStore } from '../fact/adapters/memoryPediaStore.mjs'
import { FACT_SCHEMA } from '../fact/domain/vocabulary.js'
import { stableEntryId } from '../fact/domain/stableId.js'

const DOMAIN = '诡秘之主'

function worldview(name) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain: DOMAIN, slot: 'locations', name }),
    layer: 'worldview', name, domain: DOMAIN, slot: 'locations',
    status: 'adopted',
    definition: `${name}的设定。`,
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' }
  }
}

function person(name) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name }),
    layer: 'character', name, domain: DOMAIN,
    status: 'adopted',
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} }
  }
}

test('事件类型枚举收敛：未知类型拒、seq 重复拒', () => {
  const store = createSessionStore({ store: createMemorySessionStore() })
  store.create({ sessionId: 's1', pov: '克莱恩', worldHash: 'h' })
  assert.equal(SESSION_EVENT_TYPES.includes('unknown-thing'), false)
  const bad = store.appendEvent('s1', 1, { type: 'unknown-thing' })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'EVENT_TYPE_UNKNOWN')
  store.appendEvent('s1', 1, { type: 'round-begin' })
  const dup = store.appendEvent('s1', 1, { type: 'settle' })
  assert.equal(dup.ok, false)
  assert.equal(dup.code, 'SEQ_DUPLICATE')
})

test('checkpoint：purpose 枚举＋stateHash 校验（篡改可检出）', () => {
  const store = createSessionStore({ store: createMemorySessionStore() })
  store.create({ sessionId: 's2', pov: '克莱恩', worldHash: 'h' })
  const badPurpose = store.checkpoint('s2', 1, '未知用途', { round: 1 })
  assert.equal(badPurpose.ok, false)
  assert.equal(badPurpose.code, 'PURPOSE_UNKNOWN')
  assert.ok(CHECKPOINT_PURPOSES.includes('opening'))
  store.checkpoint('s2', 1, 'opening', { round: 1 })
  const events = store.listEvents('s2').events
  assert.equal(store.verifyCheckpoint(events[0]).ok, true)
  const tampered = { ...events[0], state: { round: 999 } }
  assert.equal(store.verifyCheckpoint(tampered).ok, false)
})

test('读档即分支：父进度保留、子继承前缀、lineage 可溯；branch of branch 链可解析', () => {
  const store = createSessionStore({ store: createMemorySessionStore() })
  store.create({ sessionId: 'A', pov: '克莱恩', worldHash: 'h' })
  for (let seq = 1; seq <= 10; seq++) store.appendEvent('A', seq, { type: 'settle', round: seq })
  const b = store.branch('A', 6, { newPov: '值夜者' })
  assert.equal(b.ok, true)
  assert.equal(b.inheritedEvents, 6)
  const childEvents = store.listEvents(b.sessionId).events
  assert.equal(childEvents.length, 6)
  store.appendEvent(b.sessionId, 7, { type: 'settle', round: 7, pov: '值夜者' })
  assert.equal(store.listEvents('A').events.length, 10, '父会话不动')
  assert.equal(store.listEvents(b.sessionId).events.length, 7)
  const b2 = store.branch(b.sessionId, 7, {})
  assert.ok(b2.ok)
  assert.deepEqual(store.lineage(b2.sessionId), { parent: b.sessionId, atSeq: 7 })
  const chainEvents = store.listEvents(b2.sessionId).events
  assert.equal(chainEvents.length, 7)
})

test('与 M1-a 引擎联跑 20 拍：事件全落流、replay 重建 state.round=20', async () => {
  const wv = [
    worldview('旧钟楼'),
    (() => { const e = worldview('序列魔药'); e.slot = 'rules'; return e })()
  ]
  const k = person('克莱恩')
  const factStore = createMemoryFactStore([...wv, k])
  const { session, state } = openDeduceSession({ entries: [...wv, k], pov: '克莱恩' })
  const store = createSessionStore({ store: createMemorySessionStore() })
  store.create({ sessionId: session.runId, pov: '克莱恩', worldHash: session.worldHash })
  store.appendEvent(session.runId, 1, { type: 'opening', worldHash: session.worldHash })
  let seq = 2
  let seed = 99
  for (let r = 1; r <= 20; r++) {
    const { candidates } = await presentTurn({
      state, entries: [...wv, k], pov: '克莱恩',
      llmPort: { complete: async () => ({ text: '{"proposals":[]}' }) }, seed: seed++
    })
    store.appendEvent(session.runId, seq++, { type: 'candidates', round: r, count: candidates.length })
    const chosen = candidates[0]
    const { entry, knowledgeDelta } = settleChoice({ state, domain: DOMAIN, candidate: chosen })
    store.appendEvent(session.runId, seq++, { type: 'settle', round: r, entryId: entry.id })
    store.appendEvent(session.runId, seq++, { type: 'knowledge-delta', round: r, ...knowledgeDelta })
    factStore.save(entry, { operationId: `beat-${r}`, expectedRevision: 0 })
  }
  assert.equal(state.round, 20)
  const replay = store.listEvents(session.runId).events
  assert.ok(replay.length >= 61, `事件流应有 ≥61 条（1 opening＋20×3），实际 ${replay.length}`)
  assert.equal(replay.filter((e) => e.type === 'settle').length, 20)
  const lastSeq = replay[replay.length - 1].seq
  store.checkpoint(session.runId, lastSeq + 1, 'final', { round: state.round })
  const finalEvents = store.listEvents(session.runId).events
  const finalCp = finalEvents[finalEvents.length - 1]
  assert.equal(finalCp.type, 'checkpoint')
  assert.equal(finalCp.purpose, 'final')
  assert.equal(store.verifyCheckpoint(finalCp).ok, true)
})
