import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseScript,
  serializeScript,
  validateScriptDocument,
  sceneSummaries,
  scriptTimeline,
  SCRIPT_CHANNELS,
  SCRIPT_LEXICON_VERSION
} from '../../shared/scriptLexicon.js'
import { hubToWorldbook } from '../wikihub/convert.mjs'
import { parseWorldbookEntryFile } from '../../shared/worldbookFileContract.js'
import { FACT_SCHEMA } from '../fact/domain/vocabulary.js'
import { stableEntryId } from '../fact/domain/stableId.js'

/**
 * SCRIPT-1 合同测试：剧本区块词法契约（A4）＋ character 层世界书导出（A3）。
 *
 * 词法契约钉三件事：①只认标记不猜语义（未知行进 prose）②行号可溯源 ③parse→serialize 逐字节往返。
 * character 导出钉：人物卡分节口径（身份/性格/言行/记忆点/剧作功能/知情）、kind=character、
 * keys=别名、空节不写、relations 进 frontmatter（世界书 roundtrip 与世界书面板都靠它）。
 */

const SAMPLE = `# 第1集 绯红

（本集由第 1 章抽取数据转换而来；共 2 场）

## 场1 〔深夜〕 〔卧室床上〕

**人物**：克莱恩

（感知·克莱恩）剧痛中，梦境支离破碎
（感受·克莱恩）脑袋抽痛异常，像被棒子狠狠抡过
（内心·克莱恩）判断自己还没真醒、仍在梦里
*克莱恩：借着抽痛积累的力量一鼓作气挺动腰背*
**克莱恩**：「一个尝试。」

参考：@《克莱恩》 @《旧钟楼》

## 场2 〔深夜（接上段）〕

**人物**：克莱恩、奥黛丽

（感知·克莱恩）看见书桌与泛黄笔记本
**奥黛丽**：「你终于醒了。」

参考：@《克莱恩》
`

test('版本常量与通道词表', () => {
  assert.equal(SCRIPT_LEXICON_VERSION, 'script-lexicon/v1')
  assert.equal(SCRIPT_CHANNELS.perceive, '感知')
  assert.equal(SCRIPT_CHANNELS.say, '台词')
  assert.equal(SCRIPT_CHANNELS.think, '内心')
})

test('parse：集/场/人物/通道/动作/台词/参考 全部识别，行号可溯源', () => {
  const doc = parseScript(SAMPLE)
  assert.equal(doc.ok, true)
  assert.equal(doc.episodes.length, 1)
  const episode = doc.episodes[0]
  assert.equal(episode.index, 1)
  assert.equal(episode.title, '绯红')
  assert.equal(episode.line, 1)
  assert.equal(episode.scenes.length, 2)

  const scene1 = episode.scenes[0]
  assert.equal(scene1.index, 1)
  assert.equal(scene1.time, '深夜')
  assert.equal(scene1.place, '卧室床上')
  assert.equal(scene1.line, 5)
  assert.deepEqual(scene1.cast, ['克莱恩'])
  assert.deepEqual(scene1.refs, ['克莱恩', '旧钟楼'])

  const types = scene1.blocks.map((block) => block.type)
  assert.deepEqual(types, ['channel', 'channel', 'channel', 'action', 'dialogue'])
  assert.equal(scene1.blocks[0].channel, 'perceive')
  assert.equal(scene1.blocks[0].label, '感知')
  assert.equal(scene1.blocks[0].who, '克莱恩')
  assert.equal(scene1.blocks[0].content, '剧痛中，梦境支离破碎')
  assert.equal(scene1.blocks[3].who, '克莱恩')
  assert.match(scene1.blocks[3].text, /挺动腰背/u)
  assert.equal(scene1.blocks[4].who, '克莱恩')
  assert.equal(scene1.blocks[4].text, '「一个尝试。」')

  // 集注释行（集头下、第一个场之前）挂 episode.note——不丢，也不硬塞进任何场
  assert.match(episode.note, /本集由第 1 章抽取数据转换而来/u)
  assert.equal(doc.counts.orphan, 0)
  assert.equal(doc.counts.episodes, 1)
  assert.equal(doc.counts.scenes, 2)
  assert.equal(doc.counts.dialogue, 2)
  assert.equal(doc.counts.action, 1)
  assert.equal(doc.counts.channel, 4)
  assert.equal(SCRIPT_CHANNELS.event, '事件', '事件通道在词表里（真实剧本使用）')
})

test('parse→serialize 逐字节往返（格式即契约）', () => {
  const doc = parseScript(SAMPLE)
  const roundtrip = serializeScript(doc)
  const again = parseScript(roundtrip)
  assert.equal(again.counts.scenes, doc.counts.scenes)
  assert.equal(again.counts.dialogue, doc.counts.dialogue)
  assert.equal(again.counts.channel, doc.counts.channel)
  // 二次序列化稳定（幂等）
  assert.equal(serializeScript(again), roundtrip)
  // 关键标记都在
  for (const marker of ['# 第1集 绯红', '## 场1 〔深夜〕 〔卧室床上〕', '**人物**：克莱恩', '参考：@《克莱恩》 @《旧钟楼》']) {
    assert.ok(roundtrip.includes(marker), `缺少 ${marker}`)
  }
})

test('只认标记不猜语义：未知行进 prose，不硬塞成台词/动作', () => {
  const doc = parseScript(`# 第1集 测试\n\n## 场1 〔夜〕\n\n这是一句散文，不是台词也不是动作。\n（奇怪标签·某人）这句话的通道不认识\n`)
  const scene = doc.episodes[0].scenes[0]
  assert.equal(scene.prose.length, 1, '散文行进 prose')
  assert.equal(scene.prose[0].text, '这是一句散文，不是台词也不是动作。')
  const channel = scene.blocks[0]
  assert.equal(channel.type, 'channel')
  assert.equal(channel.channel, 'other', '不认识的通道标 other，原样保留 label')
  assert.equal(channel.label, '奇怪标签')
})

test('容错：场先于集出现时建匿名集，孤儿场不丢；集/场号缺省按序', () => {
  const doc = parseScript('## 场1 〔夜〕\n\n**人物**：某人\n')
  assert.equal(doc.episodes.length, 1)
  assert.equal(doc.episodes[0].scenes.length, 1)
  assert.equal(doc.episodes[0].scenes[0].cast[0], '某人')
})

test('validateScriptDocument：结构错误（重复集号/未知区块/缺角色名）拦，空场只告警', () => {
  const ok = validateScriptDocument(parseScript(SAMPLE))
  assert.equal(ok.ok, true, JSON.stringify(ok.errors))

  const bad = validateScriptDocument({
    episodes: [
      { index: 1, scenes: [{ index: 1, blocks: [{ type: 'bogus' }, { type: 'dialogue', text: '无角色' }] }, { index: 2, blocks: [] }] },
      { index: 1, scenes: [] }
    ]
  })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some((error) => /集号重复/u.test(error.message)))
  assert.ok(bad.errors.some((error) => /未知区块类型/u.test(error.message)))
  assert.ok(bad.errors.some((error) => /必须带角色名/u.test(error.message)))
  assert.ok(bad.warnings.some((warning) => /没有任何区块/u.test(warning.message)), '空场（有场无区块）告警')
  assert.ok(bad.warnings.some((warning) => /没有场/u.test(warning.message)), '整集无场告警')
})

test('sceneSummaries／scriptTimeline：场号/时地/人物/首句可读，序号不断档', () => {
  const doc = parseScript(SAMPLE)
  const rows = sceneSummaries(doc)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].label, '第1集·场1')
  assert.equal(rows[0].where, '深夜 / 卧室床上')
  assert.deepEqual(rows[0].cast, ['克莱恩'])
  assert.match(rows[0].opening, /台词|一个尝试|克莱恩/)
  const timeline = scriptTimeline(doc)
  assert.deepEqual(timeline.map((row) => row.shot), ['S01', 'S02'])
  assert.deepEqual(timeline.map((row) => row.order), [1, 2])
})

/* ---------- A3：character 层 → 世界书人物卡 ---------- */

function characterEntry(overrides = {}) {
  const name = overrides.name ?? '克莱恩'
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain: '诡秘之主', slot: '', name }),
    layer: 'character',
    name,
    domain: '诡秘之主',
    status: 'proposed',
    aliases: ['周明瑞'],
    identity: '穿越者，值夜者候选。',
    personality: '冷静推断、意志自救。',
    traits: ['冷静', '惜命'],
    anchors: { speech: ['一个尝试。'], behavior: ['挺腰睁眼'], catchphrase: ['呵呵'] },
    memoryPoints: ['剧痛中仍层层推断未真醒。'],
    castRole: { tier: 'protagonist', goal: '立住视角人物', plotFunction: '全段行为主体' },
    knowledge: [{ fromEntry: '赫密斯文笔记', kind: 'event', atSpan: { from: 1, to: 1 }, note: '认出文字' }],
    relations: [{ to: '奥黛丽', type: '同盟', how: '塔罗会结识' }],
    provenance: { mode: 'analyze', book: '诡秘之主', book_id: 'guimi', chapters: [1], scenes: [], extractor: 'fact-chain/v1', quote_hash: 'a'.repeat(40) },
    fingerprint: { vec: null, metrics: { sources: 1, chars: 100 } },
    ...overrides
  }
}

test('A3：character 层导出世界书人物卡——分节正文、kind=character、keys=别名、relations 进 frontmatter', () => {
  const result = hubToWorldbook(characterEntry())
  assert.equal(result.ok, true, JSON.stringify(result.error ?? {}))
  const { entry, draft } = result
  assert.equal(entry.kind, 'character')
  assert.equal(entry.type, 'character')
  assert.equal(entry.catDir, '人物')
  assert.deepEqual(entry.keys, ['周明瑞'])
  assert.equal(entry.summary, '穿越者，值夜者候选。')
  for (const marker of ['## 身份', '## 性格', '## 言行锚点', '## 记忆点', '## 剧作功能', '## 知情']) {
    assert.ok(entry.content.includes(marker), `人物卡缺 ${marker}`)
  }
  assert.match(entry.content, /周明瑞|穿越者/u)
  assert.match(entry.content, /口癖：呵呵/u)
  assert.match(entry.content, /知道「赫密斯文笔记」/u)
  assert.equal(entry.relations.length, 1)
  assert.equal(entry.relations[0].to, '奥黛丽')
  // 产出可被世界书契约解析回来（roundtrip 的门槛）
  const parsed = parseWorldbookEntryFile(draft.fileText)
  assert.equal(parsed.ok, true, String(parsed.error?.message ?? ''))
  assert.equal(parsed.entry.kind, 'character')
  assert.ok(parsed.entry.content.includes('## 身份'))
})

test('A3：空节不写（人物卡薄就薄，不为齐整编字）', () => {
  const thin = characterEntry({
    personality: '', traits: [], anchors: {}, memoryPoints: [], castRole: undefined,
    knowledge: [], relations: [], identity: '仅以职务称谓「经理」出现。'
  })
  const result = hubToWorldbook(thin)
  assert.equal(result.ok, true)
  assert.ok(result.entry.content.includes('## 身份'))
  for (const absent of ['## 性格', '## 言行锚点', '## 记忆点', '## 剧作功能', '## 知情']) {
    assert.ok(!result.entry.content.includes(absent), `空节不该出现：${absent}`)
  }
})

test('A3：plot 层仍拒（没有世界书对应物）；worldview 层不受影响', () => {
  const plot = { ...characterEntry(), layer: 'plot' }
  const rejected = hubToWorldbook(plot)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'WRONG_LAYER')
  assert.match(rejected.error.message, /plot/u)

  const world = hubToWorldbook({
    ...characterEntry(),
    layer: 'worldview', slot: 'locations', identity: undefined,
    definition: '午夜后禁止进入的建筑。'
  })
  assert.equal(world.ok, true, JSON.stringify(world.error ?? {}))
  assert.equal(world.entry.kind, 'location')
  assert.equal(world.entry.relations.length, 1, 'X6/resolvableNames 不传时关系照常导出')
})

test('A3＋X6：character 卡导出时支持 resolvableNames 过滤断链关系', () => {
  const withOrphan = characterEntry({
    relations: [{ to: '奥黛丽', type: '同盟', how: 'a' }, { to: '克莱恩的父亲', type: '亲属', how: '称谓式目标' }]
  })
  const filtered = hubToWorldbook(withOrphan, { resolvableNames: new Set(['克莱恩', '奥黛丽']) })
  assert.equal(filtered.ok, true)
  assert.deepEqual(filtered.entry.relations.map((relation) => relation.to), ['奥黛丽'])
  assert.ok(filtered.losses.some((loss) => loss.code === 'RELATION_TARGET_UNRESOLVED_DROPPED'))
  const parsed = parseWorldbookEntryFile(filtered.draft.fileText)
  assert.equal(parsed.ok, true)
  assert.ok(!parsed.entry.content.includes('克莱恩的父亲') || parsed.entry.relations.every((relation) => relation.to !== '克莱恩的父亲'))
})
