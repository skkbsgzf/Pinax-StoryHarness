import test from 'node:test'
import assert from 'node:assert/strict'
import {
  characterSalience,
  decideCharacter,
  worldviewSalience,
  fieldsForTier,
  summarizePruning,
  normalizeSaliencePolicy,
  DEFAULT_SALIENCE_POLICY,
  SALIENCE_VERSION
} from '../fact/usecases/pipeline/salience.js'
import { buildExtractionSource, compileExtractionEntries } from '../fact/usecases/pipeline/extractionChain.js'

/**
 * P-TRIM 显著度剪枝（作者 2026-11-11 裁定）：权重不够就不建条目，不是建薄文档。
 *
 * 作者原话锚点：「经理…就是主角随手一提的没有任何作用的角色，他就不能被当作一个角色去建立角色文档…
 * 因为他权重没有达到一定比例，所以相应的一些流程也需要对应的去省略」。
 *
 * 本测试钉四件事：
 *   1) 「经理」型（1 次提及、0 台词、0 动作、minor）必须被剪；
 *   2) 「周明瑞」型（多段、多动作、protagonist）必须 full；
 *   3) 阈值全部可配（作者调一个数字就能整体松紧）；
 *   4) 剪掉的名字进 index.mentions，不占条目——剪枝是策略结果，不是数据错。
 */

const DOMAIN = '停摆之城'

function row(segment, overrides = {}) {
  return {
    segmentId: segment.id,
    who: [],
    when: { story_time: '夜', timeline: '顺叙' },
    where: '卧室',
    events: [],
    notes: '',
    characters: [],
    settings: [],
    ...overrides
  }
}

function character(name, overrides = {}) {
  return {
    name,
    aliases: [],
    identity: `${name}的档案。`,
    traits: [],
    speech: [],
    behavior: [],
    ...overrides
  }
}

test('版本与默认策略：权重单价齐全、三档阈值递减', () => {
  assert.equal(SALIENCE_VERSION, 'fact-salience@1')
  const policy = DEFAULT_SALIENCE_POLICY
  assert.equal(policy.characterEntryFloor, 2.0)
  assert.deepEqual(policy.characterTiers.map((item) => item.tier), ['full', 'brief', 'minimal'])
  assert.deepEqual(policy.characterTiers.map((item) => item.floor), [6.0, 3.0, 2.0])
  assert.equal(policy.weights.cast.protagonist, 5.0)
})

test('「经理」型必须被剪：1 段提及、0 台词、0 动作、minor → 低于门槛', () => {
  // guimi 实测形状：仅以职务称谓出现一次、无台词无动作
  const salience = characterSalience({ segments: 1, chapters: 1, sayings: 0, actings: 0, perceivings: 0, relations: 0, knowledge: 0, castTier: 'minor' })
  assert.equal(salience.score, 1.0, `1 段 × 1.0 = 1.0，实际 ${salience.score}`)
  const decision = decideCharacter(salience.score)
  assert.equal(decision.keep, false, '低于 2.0 不建条目')
  assert.equal(decision.tier, null)
  assert.match(decision.reason, /只作为提及名登记/u)
})

test('「周明瑞」型必须 full：多段多动作 protagonist → 高档', () => {
  const salience = characterSalience({ segments: 2, chapters: 1, sayings: 0, actings: 5, perceivings: 3, relations: 1, knowledge: 0, castTier: 'protagonist' })
  // 2×1 + 5×1 + 3×0.25 + 1×0.5 + 5 = 13.25
  assert.equal(salience.score, 13.25)
  const decision = decideCharacter(salience.score)
  assert.equal(decision.keep, true)
  assert.equal(decision.tier, 'full')
})

test('三档分界：brief 与 minimal 各落其位', () => {
  // 3.0 分（1 段 + 2 句台词 = 1 + 3 = 4.0 → brief；1 段 + 1.5 台词不足）
  const brief = decideCharacter(3.5)
  assert.equal(brief.tier, 'brief')
  const minimal = decideCharacter(2.2)
  assert.equal(minimal.tier, 'minimal')
  const cut = decideCharacter(1.9)
  assert.equal(cut.keep, false)
})

test('阈值可配：调 characterEntryFloor 就能整体松紧', () => {
  const lenient = normalizeSaliencePolicy({ characterEntryFloor: 0.5 })
  assert.equal(decideCharacter(1.0, lenient).keep, true, '门槛 0.5 时 1.0 分建条目')
  const strict = normalizeSaliencePolicy({ characterEntryFloor: 5 })
  assert.equal(decideCharacter(4.0, strict).keep, false, '门槛 5 时 4.0 分也剪')
  // 权重也可配：把 appearance 调高，经理型就能过线
  const heavyAppearance = normalizeSaliencePolicy({ weights: { appearance: 3 } })
  assert.equal(decideCharacter(characterSalience({ segments: 1 }, heavyAppearance).score, heavyAppearance).keep, true)
})

test('字段分层：minimal 只留身份，brief 砍记忆点/剧作功能/知情，full 全留', () => {
  assert.deepEqual(fieldsForTier('minimal'), ['identity'])
  assert.ok(!fieldsForTier('brief').includes('memoryPoints'))
  assert.ok(!fieldsForTier('brief').includes('knowledge'))
  assert.ok(fieldsForTier('full').includes('memoryPoints'))
  assert.ok(fieldsForTier('full').includes('knowledge'))
  assert.deepEqual(fieldsForTier('剪掉'), [])
})

test('设定显著度：一句顺口提的不建条目，有实质定义才建', () => {
  const passing = worldviewSalience({ definitionChars: 12, segments: 1 })  // 0.2 + 0.5 = 0.7
  assert.equal(passing.keep, false)
  assert.match(passing.reason, /只是顺口一提/u)
  const substantial = worldviewSalience({ definitionChars: 120, segments: 1 }) // 2.0 + 0.5 = 2.5
  assert.equal(substantial.keep, true)
  const medium = worldviewSalience({ definitionChars: 45, segments: 3 })  // 1.0 + 1.5 = 2.5
  assert.equal(medium.keep, true)
})

test('summarizePruning：计数分档＋剪掉名单', () => {
  const summary = summarizePruning([
    { name: '甲', decision: { keep: true, tier: 'full', score: 10 } },
    { name: '乙', decision: { keep: true, tier: 'minimal', score: 2.5 } },
    { name: '经理', decision: { keep: false, tier: null, score: 1 } }
  ])
  assert.equal(summary.considered, 3)
  assert.equal(summary.kept, 2)
  assert.equal(summary.pruned, 1)
  assert.deepEqual(summary.byTier, { full: 1, minimal: 1 })
  assert.deepEqual(summary.prunedNames, ['经理'])
})

/* ---------- 端到端：compile 里真的剪掉，且不占条目 ---------- */

function source(text = '甲'.repeat(620)) {
  return buildExtractionSource({ id: '正文/001-第一章.md', chapterNo: 1, text })
}

test('端到端：「经理」被剪——不建条目，名字只进 index.mentions，且别的条目不留它的关系', () => {
  const built = source()
  const seg = built.segments[0]
  const rows = [row(seg, {
    who: ['周明瑞', '经理'],
    // 事件里只有周明瑞有动作；经理只被提了一次
    events: [
      { who: '周明瑞', channel: 'do', content: '挺腰睁眼' },
      { who: '周明瑞', channel: 'do', content: '攥紧信' },
      { who: '周明瑞', channel: 'say', content: '一个尝试。' },
      { who: '周明瑞', channel: 'do', content: '盘算请假' },
      { who: '周明瑞', channel: 'do', content: '推断未真醒' },
      { who: '周明瑞', channel: 'feel', content: '头痛' }
    ],
    characters: [
      character('周明瑞', { identity: '穿越者。', castRole: { tier: 'protagonist', goal: '立住视角', plotFunction: '行为主体' } }),
      character('经理', { identity: '仅以职务称谓出现。', castRole: { tier: 'minor', goal: '背景指称', plotFunction: '空记录位' } })
    ],
    relations: [{ from: '周明瑞', to: '经理', type: '隶属', how: '盘算请假需面对他' }]
  })]
  const result = compileExtractionEntries({ sources: [built], rows, domain: DOMAIN, book: '停摆之城', bookId: 'b1' })

  const names = result.entries.map((entry) => entry.name)
  assert.ok(names.includes('周明瑞'), '主角建条目')
  assert.ok(!names.includes('经理'), '经理不建条目（权重不够）')
  assert.equal(result.pruning.pruned, 1)
  assert.deepEqual(result.pruning.prunedNames, ['经理'])
  assert.equal(result.index.mentions['经理'], 'pruned', '剪掉的名字进 mentions，引用解析仍认得出')
  // 经理不在，那条「周明瑞→经理」的关系也不该留在周明瑞名下
  const zhou = result.entries.find((entry) => entry.name === '周明瑞')
  assert.ok(!(zhou.relations ?? []).some((relation) => relation.to === '经理'), '被剪角色的关系一并剪掉')
  // 剪枝留痕
  assert.ok(result.warnings.some((warning) => warning.code === 'SALIENCE_PRUNED'))
})

test('端到端：policy 注入能整体关掉剪枝（floor=0）', () => {
  const built = source()
  const seg = built.segments[0]
  const rows = [row(seg, {
    who: ['周明瑞', '经理'],
    events: [{ who: '周明瑞', channel: 'do', content: '挺腰睁眼' }],
    characters: [
      character('周明瑞', { castRole: { tier: 'protagonist', goal: 'g', plotFunction: 'p' } }),
      character('经理', { identity: '仅称谓。', castRole: { tier: 'minor', goal: 'g', plotFunction: 'p' } })
    ]
  })]
  const result = compileExtractionEntries({ sources: [built], rows, domain: DOMAIN, book: '停摆之城', bookId: 'b1', policy: { characterEntryFloor: 0 } })
  assert.ok(result.entries.some((entry) => entry.name === '经理'), 'threshold=0 时经理也建条目')
  assert.equal(result.pruning.pruned, 0)
})

test('端到端：minimal 档只留身份（不产出性格/锚点/知情）', () => {
  const built = source()
  const seg = built.segments[0]
  const rows = [row(seg, {
    who: ['路人'],
    events: [{ who: '路人', channel: 'say', content: '一句话。' }],
    characters: [character('路人', { identity: '路人档案。', traits: ['焦急'], behavior: ['抬头'] })],
    knowledge: [{ character: '路人', source: '告示', learned: '看到告示' }]
  })]
  const result = compileExtractionEntries({ sources: [built], rows, domain: DOMAIN, book: '停摆之城', bookId: 'b1' })
  const passerby = result.entries.find((entry) => entry.name === '路人')
  assert.ok(passerby, '路人（1 段 + 1 台词 + 1 知情 ≈ 3 分）应建条目')
  // 档位由分数决定，这里验的是「按档裁剪真的生效」：非 full 档必须砍掉记忆点/知情等深字段
  assert.notEqual(passerby.salienceTier, 'full', `路人得分不该到 full 档，实际 ${passerby.salienceTier}`)
  assert.equal(passerby.identity, '路人档案。', '身份永远保留')
  assert.equal(passerby.memoryPoints, undefined, '非 full 档不留记忆点')
  assert.equal(passerby.knowledge, undefined, '非 full 档不留知情')
  if (passerby.salienceTier === 'minimal') {
    assert.equal(passerby.traits, undefined, 'minimal 不留 traits')
    assert.equal(passerby.anchors, undefined, 'minimal 不留 anchors')
  }
})
