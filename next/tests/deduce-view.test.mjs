import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeFactEntries,
  characterOptions,
  povKnown,
  povRelations,
  sceneViewModel,
  archiveSnapshot,
  CANDIDATE_BADGES
} from '../fact/usecases/deduce/deduceView.js'
import { openDeduceSession } from '../fact/usecases/deduce/opening.js'
import { presentTurn } from '../fact/usecases/deduce/turn.js'
import { settleChoice } from '../fact/usecases/deduce/settle.js'
import { createSessionStore } from '../fact/usecases/deduce/sessionStore.js'

/** 一份最小「世界书面」夹具：人物／地点／规则／事件四类，带 relations 与 knowledge。 */
function boardEntries() {
  return [
    { name: '克莱恩', cat: '人物', summary: '灰雾之上的复生者。', relations: [{ to: '旧钟楼', label: '驻守' }, { to: '未知的门', label: '窥见' }], knowledge: [{ fromEntry: '旧钟楼', kind: '驻守' }] },
    { name: '奥黛丽', cat: '人物', summary: '观众途径的非凡者。', relations: [{ to: '克莱恩', label: '同盟' }], knowledge: [{ fromEntry: '值夜者', kind: '听闻' }] },
    { name: '旧钟楼', cat: '地点', summary: '鲁恩王国北郊的钟楼。', relations: [{ to: '值夜者', label: '据点' }] },
    { name: '值夜者', cat: '组织', summary: '官方非凡者小队。' },
    { name: '序列魔药', cat: '规则', summary: '服食魔药才能晋升。' },
    { name: '沉船之夜', cat: '事件', summary: '那场改变航线的风暴。' }
  ]
}

test('normalizeFactEntries：世界书条目归一为 fact 形状（layer/slot/status/definition/relations）', () => {
  const entries = normalizeFactEntries(boardEntries())
  const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]))
  assert.equal(entries.length, 6)
  assert.equal(byName['克莱恩'].layer, 'character')
  assert.equal(byName['奥黛丽'].layer, 'character')
  assert.equal(byName['旧钟楼'].layer, 'worldview')
  assert.equal(byName['旧钟楼'].slot, 'locations')
  assert.equal(byName['值夜者'].slot, 'orgs')
  assert.equal(byName['序列魔药'].slot, 'rules')
  assert.equal(byName['沉船之夜'].slot, 'events')
  assert.ok(entries.every((entry) => entry.status === 'adopted'))
  assert.ok(entries.every((entry) => entry.id && entry.definition))
  assert.deepEqual(byName['克莱恩'].relations.map((r) => r.to), ['旧钟楼', '未知的门'])
  assert.deepEqual(byName['克莱恩'].knowledge, [{ fromEntry: '旧钟楼', kind: '驻守' }])
  // 不改原数据：归一结果是新数组新对象。
  assert.equal(boardEntries()[0].layer, undefined)
})

test('normalizeFactEntries：已是 fact 形状的条目原样保留，草稿状态不被静默改判', () => {
  const draft = { schema: 'fact.data/v2', id: 'draft-1', name: '草稿设定', layer: 'worldview', slot: 'rules', status: 'draft', definition: '未定' }
  const out = normalizeFactEntries([draft, { name: '正式设定', cat: '规则', summary: '已定' }])
  assert.equal(out[0].status, 'draft')
  assert.equal(out[1].status, 'adopted')
  assert.throws(() => openDeduceSession({ entries: out, pov: '克莱恩' }), /WORLD_NOT_ADOPTED|WORLD_EMPTY|POV_NOT_FOUND/)
})

test('characterOptions：只列 character 条目', () => {
  const options = characterOptions(normalizeFactEntries(boardEntries()))
  assert.deepEqual(options.map((item) => item.name), ['克莱恩', '奥黛丽'])
})

test('povKnown：只取 factPack 里 POV 自己的 knowledge（POV 只见已知）', () => {
  const entries = normalizeFactEntries(boardEntries())
  assert.deepEqual(povKnown(entries, '克莱恩'), ['旧钟楼'])
  // 另一位角色的知情不串进本视角。
  assert.deepEqual(povKnown(entries, '奥黛丽'), ['值夜者'])
  assert.deepEqual(povKnown(entries, '不存在'), [])
})

test('povRelations：两端都已知才可见，指向未知实体的边被裁掉', () => {
  const entries = normalizeFactEntries(boardEntries())
  const known = povKnown(entries, '克莱恩')
  const rows = povRelations(entries, '克莱恩', known)
  assert.ok(rows.length > 0, '已知集合里应至少有一条可见关系')
  assert.ok(rows.every((row) => row.to !== '未知的门'), '指向未知实体的关系必须裁掉')
  assert.ok(rows.some((row) => row.from === '克莱恩' && row.to === '旧钟楼'))
  // 把「旧钟楼」从已知集合里拿掉，那条边也跟着消失。
  assert.equal(povRelations(entries, '克莱恩', []).some((row) => row.to === '旧钟楼'), false)
})

test('sceneViewModel：四字段齐、徽章与命运骰 trace 文案来自引擎数据', () => {
  const sceneCard = { who: ['克莱恩', '奥黛丽'], where: '旧钟楼', tension: '命运骰 9（顺遂）', hook: '怀表停在那一夜' }
  const candidates = [
    { id: 'a', source: '必然', badge: '▮', text: '规则推进', adopted: true, proposed: false, refs: ['序列魔药'] },
    { id: 'b', source: '命运', badge: '⚙', text: '剧情检定', adopted: true, proposed: false, trace: { a: 4, b: 5, sum: 9, success: true }, refs: [] },
    { id: 'c', source: '戏剧', badge: '✦', text: '追问守夜人', adopted: false, proposed: true, refs: [] }
  ]
  const view = sceneViewModel(sceneCard, candidates)
  assert.deepEqual(view.fields.map((field) => field.key), ['who', 'where', 'tension', 'hook'])
  assert.equal(view.fields[0].value, '克莱恩、奥黛丽')
  assert.deepEqual(view.options.map((option) => option.badge), ['▮', '⚙', '✦'])
  assert.equal(view.options[1].traceText, '2d6 4+5=9 · 顺遂')
  assert.equal(view.options[2].proposed, true)
  assert.deepEqual(CANDIDATE_BADGES.map((item) => item.badge), ['▮', '⚙', '✦'])
})

test('archiveSnapshot：留档形状带 runId/round/stateHash，reason 只认 final|interrupt', () => {
  const entries = normalizeFactEntries(boardEntries())
  const { session, state } = openDeduceSession({ entries, pov: '克莱恩' })
  state.round = 3
  const final = archiveSnapshot({ state, session, reason: 'final', events: [{}, {}, {}], at: '2026-11-10T00:00:00.000Z' })
  assert.equal(final.runId, session.runId)
  assert.equal(final.pov, '克莱恩')
  assert.equal(final.round, 3)
  assert.equal(final.reason, 'final')
  assert.equal(final.eventCount, 3)
  assert.equal(final.stateHash.length, 40)
  assert.equal(archiveSnapshot({ state, session, reason: 'interrupt' }).reason, 'interrupt')
  assert.equal(archiveSnapshot({ state, session, reason: '别的' }).reason, 'final')
})

test('薄封装贯通：归一 → 开局 → 呈现 → 结算 → 知情增量并入 POV 已知集合 → M1-b 留档', async () => {
  const entries = normalizeFactEntries(boardEntries())
  const { session, state } = openDeduceSession({ entries, pov: '克莱恩' })
  assert.equal(session.runId.length, 12)

  const store = createSessionStore()
  assert.equal(store.create({ sessionId: session.runId, pov: session.pov, worldHash: session.worldHash }).ok, true)
  let seq = 1
  assert.equal(store.appendEvent(session.runId, seq++, { type: 'opening', pov: session.pov }).ok, true)

  const known = new Set(povKnown(entries, '克莱恩'))
  const { candidates, sceneCard } = await presentTurn({ state, entries, pov: '克莱恩', seed: 42 })
  assert.ok(candidates.length >= 2 && candidates.length <= 4)
  assert.ok(sceneViewModel(sceneCard, candidates).fields.every((field) => field.value))
  assert.equal(store.appendEvent(session.runId, seq++, { type: 'candidates', count: candidates.length }).ok, true)

  const chosen = candidates.find((candidate) => candidate.proposed) ?? candidates[0]
  const { knowledgeDelta } = settleChoice({ state, domain: '推演', candidate: chosen })
  for (const name of knowledgeDelta.gained) known.add(name)
  assert.equal(store.appendEvent(session.runId, seq++, { type: 'settle', text: chosen.text }).ok, true)

  // 结算后关系面板按「POV 已知集合」裁剪，不会泄露未知实体。
  const rows = povRelations(entries, '克莱恩', [...known])
  assert.ok(rows.every((row) => known.has(row.to) || row.to === '克莱恩'))

  // 非法 purpose 要被拒且不占 seq，合法 purpose 才落档。
  const bad = store.checkpoint(session.runId, seq, 'not-a-purpose', state)
  assert.equal(bad.ok, false)
  const ok = store.checkpoint(session.runId, seq++, 'final', state)
  assert.equal(ok.ok, true)
  assert.equal(store.appendEvent(session.runId, seq++, { type: 'session-end' }).ok, true)
  const listed = store.listEvents(session.runId)
  assert.ok(listed.events.length >= 4)
})
