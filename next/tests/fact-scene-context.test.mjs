import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSceneContext, refsWithinKnown, visibleNamesOf, SCENE_CONTEXT_VERSION } from '../fact/usecases/deduce/sceneContext.js'
import { presentTurn } from '../fact/usecases/deduce/turn.js'
import { openDeduceSession } from '../fact/usecases/deduce/opening.js'
import { FACT_SCHEMA } from '../fact/domain/vocabulary.js'
import { stableEntryId } from '../fact/domain/stableId.js'

/**
 * P-WIRE 合同测试：factPack → 推演编排输入的第一视角裁剪。
 * 钉住四件事：
 *   1) 知情账本有条目时，present/locations 只出 POV 知道的；未知实体不进局面卡；
 *   2) 账本为空时降级成 world 级可见并如实记账（不假装全知，也不做成空局）；
 *   3) 悬置伏笔进局面卡钩子（张力来自上一拍没解决的事）；
 *   4) 候选视角筛：POV 不知晓的引用不出现在候选里。
 */

const DOMAIN = '停摆之城'

function worldview(name, slot, overrides = {}) {
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

function character(name, overrides = {}) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name }),
    layer: 'character', name, domain: DOMAIN,
    status: 'adopted',
    definition: `${name}这个人。`,
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} },
    ...overrides
  }
}

function openHook(name, runId = 'run-a', pov = '克莱恩') {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain: DOMAIN, slot: '', name }),
    layer: 'plot', name, domain: DOMAIN,
    status: 'adopted',
    definition: '钟楼里的脚步声没解释。',
    hypothesis: true, open: true,
    provenance: { mode: 'author', book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1', runId, pov },
    fingerprint: { vec: null, metrics: {} }
  }
}

/** 柯秒只认识「槐巷」与「奥黛丽」——世界书里还有三个他不该看到的东西。 */
function ledgerEntries() {
  return [
    worldview('槐巷', 'locations'),
    worldview('钟楼地窖', 'locations'),
    worldview('值夜者', 'orgs'),
    worldview('序列魔药', 'rules'),
    character('柯秒', {
      knowledge: [
        { fromEntry: '槐巷', kind: 'setting', atSpan: { from: 1 } },
        { fromEntry: '奥黛丽', kind: 'event', atSpan: { from: 1 } }
      ]
    }),
    character('奥黛丽', { castRole: { tier: 'supporting', goal: '查明真相', plotFunction: '提供线索' } }),
    character('未蒙面的敌人', { castRole: { tier: 'minor', goal: '阻拦', plotFunction: '制造压力' } }),
    openHook('第3拍·悬而未决')
  ]
}

test('版本常量与空输入：不抛，给出空壳', () => {
  assert.equal(SCENE_CONTEXT_VERSION, 'scene-context@1')
  const context = buildSceneContext({})
  assert.equal(context.known.length, 0)
  assert.deepEqual(context.present, [])
  assert.deepEqual(context.locations, [])
})

test('知情账本有条目：present／locations 只出 POV 知道的，未知角色与地点不进局面卡', () => {
  const context = buildSceneContext({ entries: ledgerEntries(), pov: '柯秒' })
  assert.equal(context.knowledgeFidelity, 'ledger')
  const names = context.present.map((item) => item.name)
  assert.deepEqual(names, ['奥黛丽'], '只有已知的奥黛丽进场；未蒙面的敌人不在场')
  assert.deepEqual(context.locations, ['槐巷'], '只有已知的槐巷；钟楼地窖不该出现')
  assert.ok(context.known.includes('柯秒'), 'POV 自己始终在已知集合里')
  assert.ok(!context.warnings.some((w) => w.code === 'KNOWLEDGE_LEDGER_EMPTY'))
})

test('账本为空：降级 world 级可见并如实记账，不假装全知、也不做成空局', () => {
  const entries = [worldview('槐巷', 'locations'), character('柯秒'), character('奥黛丽')]
  const context = buildSceneContext({ entries, pov: '柯秒' })
  assert.equal(context.knowledgeFidelity, 'world')
  assert.ok(context.warnings.some((w) => w.code === 'KNOWLEDGE_LEDGER_EMPTY'), '降级必须记账')
  assert.ok(context.present.length >= 1, '降级时角色仍要进场，否则局面卡是空的')
  const visible = visibleNamesOf(context, entries)
  assert.ok(visible.has('槐巷'), 'world 降级下地点可见')
})

test('已知情报用 extraKnown 累积：结算后新知道的名字立刻进可见集合', () => {
  const entries = [worldview('槐巷', 'locations'), worldview('钟楼地窖', 'locations'), character('柯秒', { knowledge: [{ fromEntry: '槐巷', kind: 'setting' }] })]
  const before = buildSceneContext({ entries, pov: '柯秒' })
  assert.deepEqual(before.locations, ['槐巷'])
  const after = buildSceneContext({ entries, pov: '柯秒', extraKnown: ['钟楼地窖'] })
  assert.deepEqual(after.locations.sort(), ['槐巷', '钟楼地窖'].sort(), '结算得来的知情增量要和账本同权')
})

test('悬置伏笔：hypothesis+open 进 openHypotheses，并成为局面卡钩子', async () => {
  const entries = ledgerEntries()
  const context = buildSceneContext({ entries, pov: '柯秒' })
  assert.equal(context.openHypotheses.length, 1)
  assert.equal(context.openHypotheses[0].runId, 'run-a')

  const { state } = openDeduceSession({ entries, pov: '柯秒' })
  const { sceneCard } = await presentTurn({ state, entries, pov: '柯秒', seed: 5 })
  assert.match(sceneCard.hook, /伏笔/, '钩子优先取已埋的悬置伏笔')
  assert.match(sceneCard.hook, /脚步声|悬而未决/)
})

test('局面卡第一视角：where 只出 POV 知道的地点；一个都不知道时如实「未标记地点」', async () => {
  const entries = ledgerEntries()
  const { state } = openDeduceSession({ entries, pov: '柯秒' })
  const { sceneCard } = await presentTurn({ state, entries, pov: '柯秒', seed: 9 })
  assert.equal(sceneCard.where, '槐巷')
  assert.ok(sceneCard.who.includes('柯秒'))
  assert.ok(sceneCard.who.includes('奥黛丽'))
  assert.ok(!sceneCard.who.includes('未蒙面的敌人'), '第一视角不报未蒙面的人')

  const blind = [worldview('钟楼地窖', 'locations'), character('柯秒', { knowledge: [{ fromEntry: '奥黛丽', kind: 'event' }] }), character('奥黛丽')]
  const opened = openDeduceSession({ entries: blind, pov: '柯秒' })
  const turn = await presentTurn({ state: opened.state, entries: blind, pov: '柯秒', seed: 3 })
  assert.equal(turn.sceneCard.where, '未标记地点', '不能拿世界书里他没见过的地方顶上')
})

test('候选视角筛：refsWithinKnown 按别名归一后判，未知引用为 false', () => {
  const known = new Set(['柯秒', '槐巷'])
  assert.equal(refsWithinKnown({ refs: ['槐巷'] }, known), true)
  assert.equal(refsWithinKnown({ refs: ['钟楼地窖'] }, known), false)
  assert.equal(refsWithinKnown({ refs: [] }, known), true)

  const aliasIndex = { resolve: (name) => (name === '巷子' ? '槐巷' : null) }
  assert.equal(refsWithinKnown({ refs: ['巷子'] }, known, aliasIndex), true, '别名要归一到规范名再判')
  assert.equal(refsWithinKnown({ refs: ['隧道'] }, known, aliasIndex), false)
})

test('候选视角筛接入生成链：戏剧候选引用 POV 未知实体时被剔除，局面仍出 2–4 条', async () => {
  const entries = ledgerEntries()
  const { state } = openDeduceSession({ entries, pov: '柯秒' })
  const llm = {
    complete: async () => ({
      text: JSON.stringify({
        proposals: [
          { text: '直奔钟楼地窖——那里有答案', refs: ['钟楼地窖'] },
          { text: '在槐巷等奥黛丽', refs: ['槐巷'] }
        ]
      })
    })
  }
  const { generateCandidates } = await import('../fact/usecases/deduce/candidates.js')
  const { candidates } = await generateCandidates({ entries, state, pov: '柯秒', llmPort: llm, seed: 21 })
  assert.ok(candidates.length >= 2 && candidates.length <= 4)
  assert.ok(candidates.every((item) => !(item.refs ?? []).includes('钟楼地窖')), 'POV 不知道的地点不能出现在候选引用里')
})
