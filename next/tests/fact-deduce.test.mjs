import test from 'node:test'
import assert from 'node:assert/strict'
import { openDeduceSession } from '../fact/usecases/deduce/opening.js'
import { generateCandidates, roll2d6, mulberry32 } from '../fact/usecases/deduce/candidates.js'
import { settleChoice, settleInject, settleHypothesis } from '../fact/usecases/deduce/settle.js'
import { presentTurn, applyDirectorAction } from '../fact/usecases/deduce/turn.js'
import { createMemoryFactStore } from '../fact/adapters/memoryPediaStore.mjs'
import { FACT_SCHEMA } from '../fact/domain/vocabulary.js'
import { stableEntryId } from '../fact/domain/stableId.js'

const DOMAIN = '诡秘之主'

function worldview(overrides = {}) {
  const name = overrides.name ?? '旧钟楼'
  const slot = overrides.slot ?? 'locations'
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain: DOMAIN, slot, name }),
    layer: 'worldview', name, domain: DOMAIN, slot,
    status: 'adopted',
    definition: `${name}的设定。`,
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    ...overrides
  }
}

function person(overrides = {}) {
  const name = overrides.name ?? '克莱恩'
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name }),
    layer: 'character', name, domain: DOMAIN,
    status: 'adopted',
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} },
    ...overrides
  }
}

function fakeLlm(text) {
  return { complete: async () => ({ text }) }
}

const DRAMA_JSON = '{"proposals":[{"text":"司灯人的怀表停在沉船那晚——追问守夜人","refs":["旧钟楼"]},{"text":"夜巡提前，全城戒备","refs":[]}]}'

test('开局：worldview 有非 adopted 条目 → 拒绝从草稿开局', () => {
  assert.throws(
    () => openDeduceSession({ entries: [worldview({ status: 'draft' })], pov: '克莱恩' }),
    /WORLD_NOT_ADOPTED|拒绝从草稿/
  )
})

test('开局：POV 角色不存在 → POV_NOT_FOUND；正常开局 → 快照 hash＋runId＋预算状态', () => {
  assert.throws(() => openDeduceSession({ entries: [worldview()], pov: '不存在' }), /POV_NOT_FOUND/)
  const { session, state, frozen } = openDeduceSession({
    entries: [worldview(), worldview({ name: '值夜者' , slot: 'orgs' }), person()],
    pov: '克莱恩'
  })
  assert.ok(session.runId && session.runId.length === 12)
  assert.ok(session.worldHash.length === 40)
  assert.equal(frozen.length, 2)
  assert.equal(state.round, 0)
  assert.equal(state.aiActionsLeft, state.budgetMax)
})

test('种子化 50 拍连续推演：每拍≥2 合法候选、零事务错误、预算不透支、事件流可回放', async () => {
  const wv = [
    worldview({ name: '旧钟楼', slot: 'locations' }),
    worldview({ name: '值夜者', slot: 'orgs' }),
    worldview({ name: '序列魔药', slot: 'rules' }),
    worldview({ name: '沉船之夜', slot: 'events' })
  ]
  const k = person({ name: '克莱恩', knowledge: [] })
  const store = createMemoryFactStore([wv[0], wv[1], wv[2], wv[3], k])
  const { session, state } = openDeduceSession({ entries: [...wv, k], pov: '克莱恩' })
  let seed = 42
  for (let r = 1; r <= 50; r++) {
    const { candidates, sceneCard } = await presentTurn({
      state, entries: [...wv, k], pov: '克莱恩',
      llmPort: fakeLlm(DRAMA_JSON), seed: seed++
    })
    assert.ok(candidates.length >= 2, `第${r}拍候选不足`)
    assert.ok(sceneCard.hook)
    assert.ok(state.aiActionsLeft >= 0, '预算不许负')
    const chosen = candidates[0]
    const { entry } = settleChoice({ state, domain: DOMAIN, candidate: chosen })
    assert.equal(entry.provenance.runId, session.runId)
    assert.equal(entry.provenance.pov, '克莱恩')
    assert.ok(['fate', 'author'].includes(entry.provenance.decidedBy))
    const saved = store.save(entry, { operationId: `beat-${r}`, expectedRevision: 0 })
    assert.ok(!saved.error, `第${r}拍落库失败：${JSON.stringify(saved.error ?? {})}`)
  }
  assert.equal(state.round, 50)
  assert.equal(state.log.filter((l) => l.kind === 'round-begin').length, 50)
  assert.equal(state.log.filter((l) => l.kind === 'settle').length, 50)
  assert.ok(store.stats().writes >= 50)
})

test('戏剧层失败隔离：LlmPort 抛错 → 戏剧缺席但必然/命运照常', async () => {
  const wv = [worldview({ name: '序列魔药', slot: 'rules' })]
  const k = person()
  const state = openDeduceSession({ entries: [...wv, k], pov: '克莱恩' }).state
  const broken = { complete: async () => { throw new Error('provider down') } }
  const { candidates } = await generateCandidates({
    entries: [...wv, k], state, pov: '克莱恩', llmPort: broken, seed: 7
  })
  assert.ok(candidates.length >= 2)
  assert.ok(candidates.every((c) => c.source !== '戏剧'))
})

test('一致性筛：戏剧候选引用未知实体 → 候选层确定性拒', async () => {
  const wv = [worldview({ name: '旧钟楼', slot: 'locations' })]
  const k = person()
  const state = openDeduceSession({ entries: [...wv, k], pov: '克莱恩' }).state
  const ghost = fakeLlm('{"proposals":[{"text":"不存在的 entity 的暗线","refs":["根本没这条目"]}]}')
  const { candidates } = await generateCandidates({
    entries: [...wv, k], state, pov: '克莱恩', llmPort: ghost, seed: 11
  })
  assert.ok(candidates.every((c) => !(c.refs ?? []).includes('根本没这条目')))
})

test('预算耗尽：aiActionsLeft=0 → 戏剧层不出且预算不为负', async () => {
  const wv = [worldview({ name: '旧钟楼', slot: 'locations' })]
  const k = person()
  const { state } = openDeduceSession({ entries: [...wv, k], pov: '克莱恩' })
  state.aiActionsLeft = 0
  const { candidates } = await generateCandidates({
    entries: [...wv, k], state, pov: '克莱恩', llmPort: fakeLlm(DRAMA_JSON), seed: 3
  })
  assert.equal(state.aiActionsLeft, 0)
  assert.ok(candidates.length >= 2)
  assert.ok(candidates.every((c) => c.source !== '戏剧'))
})

test('POV 知情增量：settle 只给视角角色记知情，不含 POV 自己', () => {
  const { state } = openDeduceSession({ entries: [worldview(), person()], pov: '克莱恩' })
  const { knowledgeDelta } = settleChoice({
    state, domain: DOMAIN,
    candidate: { text: '在旧钟楼发现了怀表', adopted: true, proposed: false, refs: ['旧钟楼', '克莱恩'] }
  })
  assert.equal(knowledgeDelta.pov, '克莱恩')
  assert.deepEqual(knowledgeDelta.gained, ['旧钟楼'])
})

test('命运受阻 → 假设轨 open 条目（叠加微调钩子）', () => {
  const { state } = openDeduceSession({ entries: [worldview(), person()], pov: '克莱恩' })
  let blocked = null
  for (let s = 1; s < 500 && !blocked; s++) {
    const trace = roll2d6(mulberry32(s))
    if (!trace.success) blocked = { trace, seed: s }
  }
  assert.ok(blocked, '500 个种子内必然存在受阻骰')
  const candidate = { text: '剧情检定 2d6=1+2=3：受阻', adopted: true, proposed: false, trace: blocked.trace, refs: [] }
  const entry = settleHypothesis({ state, domain: DOMAIN, candidate })
  assert.equal(entry.hypothesis, true)
  assert.equal(entry.open, true)
  assert.equal(entry.status, 'adopted')
})

test('导演三动作：veto 无落库／reroll 返回重掷语义／inject author 直落', () => {
  const { state } = openDeduceSession({ entries: [worldview(), person()], pov: '克莱恩' })
  const v = applyDirectorAction({ state, action: 'veto', candidate: { id: 'fate-1-0' } })
  assert.equal(v.entry, null)
  const r = applyDirectorAction({ state, action: 'reroll', candidate: { id: 'fate-1-0' } })
  assert.match(r.note, /重掷|不重掷/)
  const inj = applyDirectorAction({ state, action: 'inject', name: '深夜来客', definition: '门口出现陌生人' })
  assert.equal(inj.action, 'inject')
  const { entry } = settleInject({ state, domain: DOMAIN, name: inj.entry.name, definition: inj.entry.definition })
  assert.equal(entry.provenance.decidedBy, 'author')
  assert.equal(entry.provenance.source, '导演注入')
})
