import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createFront,
  frontsFromRules,
  advanceFront,
  tickIdleFronts,
  touchFront,
  resolveFront,
  tensionReading,
  tensionText,
  pendingTriggers,
  DEFAULT_CLOCK_MAX,
  FRONTS_VERSION
} from '../fact/usecases/deduce/fronts.js'
import { openDeduceSession } from '../fact/usecases/deduce/opening.js'
import { presentTurn } from '../fact/usecases/deduce/turn.js'
import { settleChoice, settleHypothesis } from '../fact/usecases/deduce/settle.js'
import { FACT_SCHEMA } from '../fact/domain/vocabulary.js'
import { stableEntryId } from '../fact/domain/stableId.js'

/**
 * P-M4 合同测试：威胁前线／压力时钟。
 * 钉住 ADR 裁定 ② 的四条：
 *   1) 只推进不倒退（时钟单调，缓解只能结掉前线）；
 *   2) 推进源确定性（fate-fail／idle／director），每条留 trace 可复算；
 *   3) 满格＝触发，给出可观察的世界动作，不静默；
 *   4) 200 拍张力曲线不塌（连续推进、有起伏、不留零读数空档）。
 */

const DOMAIN = '停摆之城'

function ruleWithFront(overrides = {}) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain: DOMAIN, slot: 'rules', name: overrides.name ?? '钟楼规则' }),
    layer: 'worldview',
    name: overrides.name ?? '钟楼规则',
    domain: DOMAIN,
    slot: 'rules',
    status: 'adopted',
    definition: '钟楼每夜多响一声。',
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    fronts: overrides.fronts ?? { name: '钟楼之影', threat: '钟声每夜多一声，总有一天会响满', danger: 'high', max: 4, idleThreshold: 2, trigger: '钟声响满，城里所有人都听见了' }
  }
}

function plainRule(name = '普通规则') {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain: DOMAIN, slot: 'rules', name }),
    layer: 'worldview', name, domain: DOMAIN, slot: 'rules', status: 'adopted',
    definition: '一条没有 fronts 模板的规则。',
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' }
  }
}

function person(name = '柯秒') {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name }),
    layer: 'character', name, domain: DOMAIN, status: 'adopted',
    definition: `${name}。`,
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} }
  }
}

test('版本常量与造 front：id 稳定、danger 收词表、max 夹在 1..12', () => {
  assert.equal(FRONTS_VERSION, 'fronts-clock@1')
  const a = createFront({ name: '钟楼之影' })
  const b = createFront({ name: '钟楼之影' })
  assert.equal(a.id, b.id, '同名同 id（确定性，重开一局不换身份）')
  assert.equal(a.clocks.impending.max, DEFAULT_CLOCK_MAX)
  assert.equal(a.clocks.impending.value, 0)
  assert.equal(createFront({ name: 'x', danger: '荒唐' }).danger, 'medium', '未知危险级落 medium')
  assert.equal(createFront({ name: 'x', max: 99 }).clocks.impending.max, 12, 'max 上夹到 12')
  assert.equal(createFront({ name: '  ' }), null, '没名字不造')
})

test('rules 预埋：只有显式 fronts 模板的规则才立前线，自由文本不猜威胁', () => {
  const fronts = frontsFromRules([ruleWithFront(), plainRule(), { ...ruleWithFront({ name: '草稿规则' }), status: 'draft' }])
  assert.equal(fronts.length, 1, '只有 adopted＋有模板的那条立起')
  assert.equal(fronts[0].name, '钟楼之影')
})

test('只推进不倒退：时钟单调递增、满格置 filled 并记 triggeredAtRound', () => {
  const [front] = frontsFromRules([ruleWithFront({ fronts: { name: '钟楼之影', max: 3, idleThreshold: 5 } })])
  const fronts = [front]
  assert.equal(advanceFront(fronts, front.id, { round: 1, source: 'director' }).value, 1)
  assert.equal(advanceFront(fronts, front.id, { round: 2, source: 'fate-fail' }).value, 2)
  const third = advanceFront(fronts, front.id, { round: 3, source: 'idle' })
  assert.equal(third.value, 3)
  assert.equal(third.filled, true)
  assert.equal(third.triggered, true, '满格即触发')
  assert.equal(front.clocks.impending.triggeredAtRound, 3)
  // 已满再推进：不越界、不二次触发
  const overflow = advanceFront(fronts, front.id, { round: 4, source: 'director' })
  assert.equal(overflow.value, 3)
  assert.equal(overflow.filled, false, '满了就不再报「刚刚填满」')
  assert.equal(front.clocks.impending.value, 3, '不会超过 max')
})

test('推进留 trace：每条都带 source/round/value，未知 source 归一成 director', () => {
  const [front] = frontsFromRules([ruleWithFront({ fronts: { name: '钟楼之影', max: 6 } })])
  advanceFront([front], front.id, { round: 5, source: '瞎编来源', note: '测试' })
  assert.equal(front.trace.length, 1)
  assert.equal(front.trace[0].source, 'director', '不认的来源落 director，不写脏值')
  assert.equal(front.trace[0].atRound, 5)
  assert.equal(front.trace[0].value, 1)
})

test('挂机推进：连续 idleThreshold 拍没被处理才走一格，touch 归零计数', () => {
  const [front] = frontsFromRules([ruleWithFront({ fronts: { name: '钟楼之影', max: 6, idleThreshold: 3 } })])
  const fronts = [front]
  assert.deepEqual(tickIdleFronts(fronts, { round: 1 }), [], '第 1 拍不到阈值')
  assert.deepEqual(tickIdleFronts(fronts, { round: 2 }), [], '第 2 拍不到阈值')
  const third = tickIdleFronts(fronts, { round: 3 })
  assert.equal(third.length, 1, '第 3 拍推进')
  assert.equal(third[0].value, 1)
  assert.equal(front.idleCount, 0, '推进后计数归零')

  assert.equal(touchFront(fronts, front.id).ok, true)
  tickIdleFronts(fronts, { round: 4 })
  assert.equal(front.idleCount, 1)
  touchFront(fronts, front.id)
  tickIdleFronts(fronts, { round: 5 })
  assert.equal(front.idleCount, 1, '被碰过就从零开始数')
})

test('结掉前线＝唯一缓解路径：resolved 后不再计时、不进张力读数', () => {
  const [front] = frontsFromRules([ruleWithFront({ fronts: { name: '钟楼之影', max: 6 } })])
  const fronts = [front]
  advanceFront(fronts, front.id, { round: 1, source: 'director' })
  assert.equal(tensionReading(fronts).active, 1)
  assert.equal(resolveFront(fronts, front.id, { round: 2, note: '钟声的秘密解开了' }).ok, true)
  assert.equal(front.status, 'resolved')
  assert.equal(tensionReading(fronts).active, 0, '结掉后不再是活跃压力')
  assert.equal(tensionReading(fronts).resolved, 1)
  const blocked = advanceFront(fronts, front.id, { round: 3, source: 'director' })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'FRONT_RESOLVED', '结掉的前线不再计时')
})

test('张力读数与文案：heat 取最紧那条；无 frontline 时「平缓」', () => {
  assert.equal(tensionText([]), '平缓')
  assert.deepEqual(pendingTriggers([]), [])
  const [a, b] = [
    ...frontsFromRules([ruleWithFront({ name: '甲规则', fronts: { name: '甲', max: 4 } })]),
    ...frontsFromRules([ruleWithFront({ name: '乙规则', fronts: { name: '乙', max: 8 } })])
  ]
  const fronts = [a, b]
  advanceFront(fronts, a.id, { round: 1, source: 'director' })
  advanceFront(fronts, a.id, { round: 2, source: 'director' })
  advanceFront(fronts, b.id, { round: 2, source: 'director' })
  const reading = tensionReading(fronts)
  assert.equal(reading.active, 2)
  assert.equal(reading.heat, 0.5, '甲 2/4＝0.5 最紧')
  assert.equal(tensionText(fronts), '甲 2/4')
})

test('开局从规则立前线：没模板＝这一局零累积压力（如实为空，不凭空造威胁）', () => {
  const withFront = openDeduceSession({ entries: [ruleWithFront(), person()], pov: '柯秒' })
  assert.equal(withFront.state.fronts.length, 1)
  assert.equal(withFront.session.frontCount, 1)
  const without = openDeduceSession({ entries: [plainRule(), person()], pov: '柯秒' })
  assert.equal(without.state.fronts.length, 0)
  assert.equal(without.session.frontCount, 0)
})

test('检定受阻推进 frontline（fate-fail 源），成功不推进', () => {
  const entries = [ruleWithFront({ fronts: { name: '钟楼之影', max: 6, idleThreshold: 99 } }), person()]
  const { state } = openDeduceSession({ entries, pov: '柯秒' })
  state.round = 1
  // 成功骰：不推进
  settleHypothesis({ state, domain: DOMAIN, candidate: { text: '顺遂', trace: { a: 4, b: 4, sum: 8, success: true } } })
  assert.equal(state.fronts[0].clocks.impending.value, 0)
  // 受阻骰：推进一格
  settleHypothesis({ state, domain: DOMAIN, candidate: { text: '受阻', trace: { a: 1, b: 2, sum: 3, success: false } } })
  assert.equal(state.fronts[0].clocks.impending.value, 1)
  assert.ok(state.log.some((row) => row.kind === 'fronts-advance' && row.source === 'fate-fail'))
})

test('局面卡张力读累积时钟：有前线时报 frontline 读数，没有才退回单拍骰点', async () => {
  const withFront = [ruleWithFront({ fronts: { name: '钟楼之影', max: 4, idleThreshold: 99 } }), person()]
  const opened = openDeduceSession({ entries: withFront, pov: '柯秒' })
  await presentTurn({ state: opened.state, entries: withFront, pov: '柯秒', seed: 7 })
  assert.match(opened.state.round ? (await presentTurn({ state: opened.state, entries: withFront, pov: '柯秒', seed: 8 })).sceneCard.tension : '', /钟楼之影/u)

  const noFront = [plainRule(), person()]
  const plain = openDeduceSession({ entries: noFront, pov: '柯秒' })
  const turn = await presentTurn({ state: plain.state, entries: noFront, pov: '柯秒', seed: 7 })
  assert.match(turn.sceneCard.tension, /命运骰|平缓/u)
})

test('验收：200 拍张力曲线不塌——挂机推进＋伏笔编织持续供压，读数有起伏', async () => {
  const entries = [
    ruleWithFront({ name: '甲规则', fronts: { name: '甲线', max: 6, idleThreshold: 2 } }),
    ruleWithFront({ name: '乙规则', fronts: { name: '乙线', max: 5, idleThreshold: 3 } }),
    person()
  ]
  const { state } = openDeduceSession({ entries, pov: '柯秒' })
  // 结算落的假设条目要进条目集（真实链路里它们会被存进 fact 快照），
  // 这样 sceneContext.openHypotheses 才看得到、braidFronts 才有东西可编织。
  const ledger = [...entries]
  const curve = []
  let seed = 100
  let braided = 0
  for (let round = 1; round <= 200; round += 1) {
    const { candidates, tension, braided: created } = await presentTurn({ state, entries: ledger, pov: '柯秒', seed: seed++ })
    braided += created.length
    curve.push(tension.heat)
    if (!candidates.length) continue
    const chosen = candidates[0]
    // 忠于面板流程（DeducePanel.choose）：先结算，再按骰点判假设轨。
    settleChoice({ state, domain: DOMAIN, candidate: chosen })
    // 假设轨只看命运骰（settleHypothesis 要求 candidate.trace）；必须取命运候选，不能拿第一条。
    const fate = candidates.find((item) => item.source === '命运')
    if (fate?.trace) {
      const hypothesis = settleHypothesis({ state, domain: DOMAIN, candidate: fate })
      // 部分伏笔留着发酵（成为后续压力源），部分当场被解释掉（不落条目集）。
      if (hypothesis && round % 3 !== 0) ledger.push(hypothesis)
    }
    // 玩家有时处理（碰前线）：制造起伏，而不是一路挂机到满
    if (round % 7 === 0) {
      const front = state.fronts.find((item) => item.status === 'active')
      if (front) touchFront(state.fronts, front.id)
    }
    // 作者把已经满了的线收掉——否则读数会长期钉死在 1
    for (const front of state.fronts) {
      if (front.status === 'active' && front.clocks.impending.filled && round % 13 === 0) {
        resolveFront(state.fronts, front.id, { round, note: '本线收束' })
      }
    }
  }
  assert.equal(curve.length, 200)
  const distinct = new Set(curve)
  assert.ok(distinct.size >= 3, `张力读数要有起伏，实际只有 ${distinct.size} 种取值`)
  assert.ok(curve.some((value) => value > 0), '200 拍里世界必须真的逼近过')
  assert.ok(curve.every((value) => value >= 0 && value <= 1), '读数恒在 0..1')
  assert.ok(braided > 0 || curve.slice(-40).some((value) => value > 0), '伏笔编织接管或在跑的前线维持了后段压力')
  const tail = curve.slice(-40)
  assert.ok(tail.some((value) => value > 0), '后 40 拍不能完全平掉（曲线不塌）')
})
