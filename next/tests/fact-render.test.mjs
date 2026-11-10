import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chapterize,
  CHAPTERIZE_VERSION,
  DEFAULT_MAX_BEATS_PER_CHAPTER
} from '../fact/usecases/render/chapterize.js'
import {
  renderChapter,
  buildProsePrompt,
  gateProseKnowledge,
  povKnownNames,
  normalizeStyleSpec,
  styleSpecHash,
  RENDER_PROSE_SYSTEM_PROMPT,
  PROSE_RENDER_VERSION
} from '../fact/usecases/render/prose.js'
import { renderBatch, RENDER_BATCH_VERSION } from '../fact/usecases/render/renderBatch.js'
import { DEDUCE_DRAMA_SYSTEM_PROMPT } from '../fact/usecases/deduce/candidates.js'
import { projectOutline } from '../fact/usecases/deduce/outlineProjector.js'

/**
 * 批次 M3：成书渲染（章纲→正文批量渲染＋知情贯穿＋多文风，ADR M3）合同测试。
 *   1) 分章结构：POV/目标标记变化分组＋每章拍数上限、确定性、M2 投影可串联；
 *   2) 知情约束＋越界断言：POV 已知集合来自 factPack；干净稿无越知、未知/晚知实体在稿中被 flag；
 *      perspective gate 复用 precheckDraft（不新造第二套）；
 *   3) 多文风重渲染：同一章纲×N styleSpec→N 份正文、章节结构确定性一致、可重渲染；
 *   4) 双叙述纪律：渲染 prompt 常量 ≠ deduce/candidates 的 prompt 常量（两常量互不等）。
 *
 * 全程零网络、零真实模型、零宿主依赖：fake LlmPort 固定文风输出，只用 next/fact/** 域内纯模块。
 */

const DOMAIN = '停摆之城'
const POV_A = '克莱恩'
const POV_B = '奥黛丽'

const STYLE_A = {
  name: '白描',
  targets: { sentenceChars: [10, 20], paragraphChars: [80, 150] },
  samples: ['他推开门，风很冷。'],
  constraints: { forbidden: ['华丽辞藻', 'AI腔'], required: ['短句'] }
}
const STYLE_B = {
  name: '抒情',
  targets: { sentenceChars: [25, 50], dialogueRatio: [0.1, 0.3] },
  samples: ['风穿过长廊，像一句没说完的话。'],
  constraints: { forbidden: ['网络用语'], required: ['意象'] }
}
const STYLE_C = {
  name: '冷硬',
  targets: { dialogueRatio: [0.4, 0.7] },
  samples: ['雨没停。'],
  constraints: { forbidden: ['比喻'], required: [] }
}

// 干净稿：只引用本章 POV 已知实体。越界稿：含 POV 未知（禁库密卷）与晚知（迟到的信）实体。
const CLEAN_TEXT = '他抬头望向 @《旧钟楼》 ， @《值夜者》 的灯还亮着。'
const LEAK_TEXT = '他翻开 @《禁库密卷》 ，又想起迟到的信， @《旧钟楼》 的影子压下来。'

/** fixed 文风输出 fake LlmPort：记录每次请求，恒定返回给定正文。 */
function fixedLlm(text) {
  const calls = []
  return {
    calls,
    async complete(request) {
      calls.push(request)
      return { text }
    }
  }
}

function node(order, pov, goal, definition) {
  return {
    id: `beat-${order}`,
    title: `第${order}拍·${goal}`,
    definition,
    intent: definition,
    summary: definition,
    status: 'adopted',
    order,
    seq: order,
    domain: DOMAIN,
    pov,
    goal
  }
}

/** 13 拍：1–4 POV_A/目标甲；5–7 POV_A/目标乙；8–13 POV_B/目标甲。 */
function markedNodes() {
  const out = []
  for (let o = 1; o <= 4; o += 1) out.push(node(o, POV_A, '查明停摆', `${POV_A}在旧钟楼勘察第${o}条线索。`))
  for (let o = 5; o <= 7; o += 1) out.push(node(o, POV_A, '追查内鬼', `${POV_A}比对值夜者名册第${o}条。`))
  for (let o = 8; o <= 13; o += 1) out.push(node(o, POV_B, '查明停摆', `${POV_B}从旁记录第${o}条。`))
  return out
}

/**
 * fact.data/v2 条目夹具：
 *   旧钟楼/值夜者 = 克莱恩第 1 章已知；迟到的信 = 第 5 章才知（本章晚知）；
 *   禁库密卷 = 真实条目但不在克莱恩知情矩阵（POV 未知）；克莱恩 = POV 角色。
 */
function entriesFixture() {
  return [
    { id: 'e-clock', layer: 'worldview', name: '旧钟楼', definition: '停摆的钟楼。', aliases: ['钟塔'] },
    { id: 'e-org', layer: 'worldview', name: '值夜者', definition: '守夜组织。' },
    { id: 'e-vault', layer: 'worldview', name: '禁库密卷', definition: '藏在禁库的密卷。' },
    { id: 'e-letter', layer: 'worldview', name: '迟到的信', definition: '第五章才送达的信。' },
    {
      id: 'e-pov',
      layer: 'character',
      name: POV_A,
      knowledge: [
        { fromEntry: '旧钟楼', kind: 'place', atSpan: { from: 1, to: 1 } },
        { fromEntry: '值夜者', kind: 'org', atSpan: { from: 1, to: 1 } },
        { fromEntry: '迟到的信', kind: 'item', atSpan: { from: 5, to: 5 } }
      ]
    }
  ]
}

/* ---------- 1) 分章结构 ---------- */

test('分章启发式：POV/目标标记变化分组＋每章拍数上限，确定性且改动输入为零', (t) => {
  const nodes = markedNodes()
  const snapshot = JSON.stringify(nodes)
  const result = chapterize(nodes)

  assert.equal(result.version, CHAPTERIZE_VERSION)
  assert.equal(result.counts.nodes, 13)
  assert.equal(result.counts.maxBeatsPerChapter, DEFAULT_MAX_BEATS_PER_CHAPTER)
  assert.equal(result.chapters.length, 3)
  assert.deepEqual(result.chapters.map((c) => c.beatCount), [4, 3, 6])
  assert.deepEqual(result.chapters.map((c) => c.pov), [POV_A, POV_A, POV_B])
  assert.deepEqual(result.chapters.map((c) => c.marker), [
    `${POV_A}∷查明停摆`, `${POV_A}∷追查内鬼`, `${POV_B}∷查明停摆`
  ])
  assert.deepEqual(result.chapters[0].nodeIds, ['beat-1', 'beat-2', 'beat-3', 'beat-4'])
  assert.equal(result.chapters[2].nodeIds.length, 6)

  // 确定性：同输入 → 深度相等；不改输入（纯函数）；{ nodes } 包装等价。
  assert.deepEqual(chapterize(nodes), result)
  assert.equal(JSON.stringify(nodes), snapshot)
  assert.deepEqual(chapterize({ nodes }), result)

  t.diagnostic(`[分章读数] ${JSON.stringify({
    version: result.version,
    chapters: result.counts.chapters,
    beats: result.chapters.map((c) => c.beatCount),
    markers: result.chapters.map((c) => c.marker)
  })}`)
})

test('可配置每章拍数上限：单标记 13 拍、上限 2 → 7 章且每章 ≤2', () => {
  const nodes = markedNodes().map((n) => ({ ...n, pov: POV_A, goal: '单一目标' }))
  const result = chapterize(nodes, { maxBeatsPerChapter: 2 })
  assert.ok(result.chapters.every((c) => c.beatCount <= 2))
  assert.equal(result.chapters.length, 7)
  assert.equal(result.chapters.reduce((sum, c) => sum + c.beatCount, 0), 13)
})

test('M2 投影 → M3 分章可串联（无 POV/目标标记时按 domain 兜底）', () => {
  const events = Array.from({ length: 7 }, (_, i) => ({ type: 'settle', seq: i + 1, text: `第${i + 1}拍：某人在某地做了某事。` }))
  const outline = projectOutline(events, { domain: DOMAIN })
  const result = chapterize(outline, { maxBeatsPerChapter: 3 })
  assert.equal(result.counts.nodes, outline.nodes.length)
  assert.equal(result.chapters.length, 3)
  assert.ok(result.chapters.every((c) => c.pov === DOMAIN))
})

/* ---------- 2) 知情约束 ＋ perspective gate 越界断言 ---------- */

test('知情约束：POV 已知集合只含本章（第1章）已知事实', () => {
  const known = povKnownNames(entriesFixture(), POV_A, 1)
  assert.ok(known.has('旧钟楼'))
  assert.ok(known.has('值夜者'))
  assert.ok(known.has(POV_A), 'POV 角色当然知道自己')
  assert.ok(!known.has('禁库密卷'), '不在知情矩阵 → 未知')
  assert.ok(!known.has('迟到的信'), '第5章才知道 → 本章未知')
})

test('perspective gate 集成：干净稿无越知，POV 未知/晚知实体在稿中被 flag', () => {
  const entries = entriesFixture()
  const clean = gateProseKnowledge({ text: CLEAN_TEXT, entries, pov: POV_A, atSpan: 1 })
  assert.equal(clean.ok, true)
  assert.equal(clean.knowledgeLeaks.length, 0)

  const leak = gateProseKnowledge({ text: LEAK_TEXT, entries, pov: POV_A, atSpan: 1 })
  assert.equal(leak.ok, false)
  const flagged = leak.knowledgeLeaks.map((v) => v.referenced).sort()
  assert.deepEqual(flagged, ['禁库密卷', '迟到的信'].sort())
  // 违规码来自复用的 precheckDraft / checkPerspective，不是新造的第二套断言。
  assert.ok(leak.knowledgeLeaks.every((v) => v.code === 'PERSPECTIVE_LEAK'))
  assert.equal(leak.precheck.checked.character, POV_A)
  assert.ok(leak.ledgerCharacters.includes(POV_A))
  // 裸实体提及（非 @《…》 标记）也纳入 declaredRefs 并被同一 gate 判。
  assert.ok(leak.mentioned.includes('迟到的信'))
  assert.ok(leak.declaredRefs.includes('迟到的信'))
  assert.ok(leak.refTags.includes('禁库密卷'))
})

test('renderChapter 渲染稿过 perspective gate ＋ provenance 可确定性重渲染', async () => {
  const entries = entriesFixture()
  const chapter = chapterize(markedNodes()).chapters[0]
  const run = () => renderChapter({
    chapter, entries, pov: POV_A, atSpan: 1, styleSpec: STYLE_A, llm: fixedLlm(LEAK_TEXT)
  })
  const a = await run()
  const b = await run()

  assert.equal(a.version, PROSE_RENDER_VERSION)
  assert.equal(a.gate.ok, false, '渲染稿里 POV 未知实体被 gate flag')
  assert.ok(a.gate.knowledgeLeaks.some((v) => v.referenced === '禁库密卷'))

  // 同数据 → 同 batchId / styleSpecHash / renderKey（可重渲染）。
  assert.equal(a.provenance.batchId, b.provenance.batchId)
  assert.equal(a.provenance.styleSpecHash, b.provenance.styleSpecHash)
  assert.equal(a.provenance.renderKey, b.provenance.renderKey)
  assert.equal(a.provenance.styleSpecHash, styleSpecHash(STYLE_A))
  assert.equal(styleSpecHash(normalizeStyleSpec(STYLE_A)), styleSpecHash(STYLE_A))
})

/* ---------- 3) 多文风重渲染 ---------- */

test('多文风重渲染：同一章纲×N styleSpec→N 份正文，章节结构确定性一致', async (t) => {
  const entries = entriesFixture()
  const outline = { nodes: markedNodes() }
  const styleSpecs = [STYLE_A, STYLE_B, STYLE_C]
  const run = () => renderBatch({
    outline, entries, pov: POV_A, styleSpecs, llm: fixedLlm(CLEAN_TEXT)
  })
  const a = await run()
  const b = await run()

  assert.equal(a.version, RENDER_BATCH_VERSION)
  assert.equal(a.styleCount, 3)
  assert.equal(a.variants.length, 3)
  assert.equal(new Set(a.styleSpecHashes).size, 3, '三个不同文风 → 三个不同 hash')
  assert.equal(a.structureConsistent, true)

  for (const variant of a.variants) {
    assert.equal(variant.chapters.length, a.chapterCount)
    assert.equal(variant.structureSignature, a.structureSignature)
    assert.ok(variant.chapters.every((c) => c.provenance.batchId === a.batchId))
  }
  const idSequences = a.variants.map((v) => v.chapters.map((c) => c.chapterId))
  assert.ok(idSequences.every((seq) => JSON.stringify(seq) === JSON.stringify(idSequences[0])))

  // 可重渲染：两次运行 batchId / 结构签名 / 每章 renderKey 全同。
  assert.equal(b.batchId, a.batchId)
  assert.equal(b.structureSignature, a.structureSignature)
  assert.deepEqual(
    b.variants.map((v) => v.chapters.map((c) => c.provenance.renderKey)),
    a.variants.map((v) => v.chapters.map((c) => c.provenance.renderKey))
  )

  t.diagnostic(`[多文风读数] ${JSON.stringify({
    batchId: a.batchId,
    chapters: a.chapterCount,
    styles: a.styleCount,
    renders: a.counts.renders,
    structureConsistent: a.structureConsistent,
    styleSpecHashes: a.styleSpecHashes
  })}`)
})

/* ---------- 4) 双叙述纪律 ---------- */

test('双叙述纪律：渲染 prompt 常量 ≠ deduce/candidates 的 prompt 常量（两常量互不等）', async (t) => {
  assert.notEqual(RENDER_PROSE_SYSTEM_PROMPT, DEDUCE_DRAMA_SYSTEM_PROMPT, '两常量必须互不等')
  assert.ok(!RENDER_PROSE_SYSTEM_PROMPT.includes(DEDUCE_DRAMA_SYSTEM_PROMPT))
  assert.ok(!DEDUCE_DRAMA_SYSTEM_PROMPT.includes(RENDER_PROSE_SYSTEM_PROMPT))
  // 文体标记：渲染＝小说叙述且明确禁用主持问答体；游玩＝推演提议/候选体。
  assert.match(RENDER_PROSE_SYSTEM_PROMPT, /小说/)
  assert.match(RENDER_PROSE_SYSTEM_PROMPT, /严禁/)
  assert.match(RENDER_PROSE_SYSTEM_PROMPT, /玩家/)
  assert.match(DEDUCE_DRAMA_SYSTEM_PROMPT, /推演提议器/)
  assert.match(DEDUCE_DRAMA_SYSTEM_PROMPT, /proposals/)
  assert.ok(!RENDER_PROSE_SYSTEM_PROMPT.includes('proposals'))

  const entries = entriesFixture()
  const chapter = chapterize(markedNodes()).chapters[0]
  const llm = fixedLlm(CLEAN_TEXT)
  const result = await renderChapter({ chapter, entries, pov: POV_A, atSpan: 1, styleSpec: STYLE_A, llm })
  assert.equal(result.ok, true)

  // 实际渲染请求用的是渲染 prompt，绝不共用游玩 prompt。
  const req = llm.calls[0]
  assert.equal(req.system, RENDER_PROSE_SYSTEM_PROMPT)
  assert.notEqual(req.system, DEDUCE_DRAMA_SYSTEM_PROMPT)
  assert.ok(!req.prompt.includes('推演提议器'))
  assert.ok(!req.prompt.includes('proposals'))
  assert.ok(!req.prompt.includes(DEDUCE_DRAMA_SYSTEM_PROMPT))

  // prompt 组装含：叙述目标 / 该章 definition 序列 / 知情约束 / 文风 styleSpec。
  assert.match(req.prompt, /【叙述目标】/)
  assert.match(req.prompt, /【本章拍序/)
  assert.match(req.prompt, /【知情约束】/)
  assert.match(req.prompt, /【文风规范 styleSpec】/)
  assert.ok(req.prompt.includes(chapter.beats[0].definition), '该章拍的 definition 进了 prompt')
  assert.ok(req.prompt.includes(STYLE_A.samples[0]), '文风代表句进了 prompt')
  assert.ok(req.prompt.includes(STYLE_A.constraints.forbidden[0]), '文风禁则清单进了 prompt')

  const body = buildProsePrompt({ chapter, entries, pov: POV_A, atSpan: 1, styleSpec: STYLE_A })
  assert.ok(body.includes('【叙述目标】'))
  assert.ok(body.includes('【文风规范 styleSpec】'))

  // 知情约束只注入 POV 已知集合：未知名不出现在「POV 已知集合」行。
  const knownLine = req.prompt.split('\n').find((line) => line.startsWith('POV 已知集合：'))
  assert.ok(knownLine && knownLine.includes('旧钟楼'))
  assert.ok(knownLine && !knownLine.includes('禁库密卷'))

  t.diagnostic(`[双叙述纪律] renderLen=${RENDER_PROSE_SYSTEM_PROMPT.length} playLen=${DEDUCE_DRAMA_SYSTEM_PROMPT.length} notEqual=true`)
})

/* ---------- 5) P-WIRE：目标弧与未回收伏笔进成书 prompt ---------- */

test('P-WIRE：章带 goal 时 prompt 注入目标弧；不带时不出现该行（不伪造目标）', () => {
  const entries = [{ id: 'e1', layer: 'worldview', slot: 'locations', name: '旧钟楼', definition: '钟楼。', status: 'adopted' }]
  const withGoal = buildProsePrompt({
    chapter: { id: 'chapter-1', index: 1, pov: POV_A, goal: '查清钟声来源', beats: [{ definition: '听见脚步' }] },
    entries,
    pov: POV_A,
    styleSpec: STYLE_A
  })
  assert.match(withGoal, /【本章目标弧】查清钟声来源/u)

  const noGoal = buildProsePrompt({
    chapter: { id: 'chapter-1', index: 1, pov: POV_A, beats: [{ definition: '听见脚步' }] },
    entries,
    pov: POV_A,
    styleSpec: STYLE_A
  })
  assert.doesNotMatch(noGoal, /【本章目标弧】/u, '没有目标就不写这一行')
})

test('P-WIRE：未回收伏笔进 prompt（可继续加码但不得矛盾）；无伏笔时整段缺席', () => {
  const entries = [{ id: 'e1', layer: 'worldview', slot: 'locations', name: '旧钟楼', definition: '钟楼。', status: 'adopted' }]
  const withHooks = buildProsePrompt({
    chapter: { id: 'chapter-1', index: 1, pov: POV_A, beats: [{ definition: '听见脚步' }] },
    entries,
    pov: POV_A,
    styleSpec: STYLE_A,
    openHooks: [{ name: '第3拍·悬而未决', definition: '钟楼里的脚步声没解释' }, '门口的陌生人']
  })
  assert.match(withHooks, /【未回收伏笔】/u)
  assert.match(withHooks, /钟楼里的脚步声没解释/u)
  assert.match(withHooks, /门口的陌生人/u, '字符串形状的伏笔也要能注入')
  assert.match(withHooks, /不得与之矛盾/u)

  const noHooks = buildProsePrompt({
    chapter: { id: 'chapter-1', index: 1, pov: POV_A, beats: [{ definition: '听见脚步' }] },
    entries,
    pov: POV_A,
    styleSpec: STYLE_A,
    openHooks: []
  })
  assert.doesNotMatch(noHooks, /【未回收伏笔】/u)
})

test('P-WIRE：chapterize 把节点 openHooks 收进章，renderChapter 透传进 prompt', async () => {
  const outline = {
    nodes: [
      { id: 'beat-1', order: 1, title: '第1拍', definition: '听见脚步', pov: POV_A, goal: '查清钟声', openHooks: ['钟楼的脚步声'] },
      { id: 'beat-2', order: 2, title: '第2拍', definition: '追上影子', pov: POV_A, goal: '查清钟声' }
    ]
  }
  const grouped = chapterize(outline, { maxBeatsPerChapter: 10 })
  assert.equal(grouped.chapters.length, 1)
  assert.deepEqual(grouped.chapters[0].openHooks, ['钟楼的脚步声'])
  assert.equal(grouped.chapters[0].beats[0].pov, POV_A, '拍上也要带视角')
  assert.equal(grouped.chapters[0].beats[0].goal, '查清钟声')

  const entries = [{ id: 'e1', layer: 'worldview', slot: 'locations', name: '旧钟楼', definition: '钟楼。', status: 'adopted' }]
  const seen = {}
  const result = await renderChapter({
    chapter: grouped.chapters[0],
    entries,
    pov: POV_A,
    styleSpec: STYLE_A,
    llm: { complete: async (r) => { seen.prompt = r.prompt; return { text: '钟楼的脚步声还在，他握紧了门框。' } } }
  })
  assert.equal(result.ok, true)
  assert.match(seen.prompt, /【未回收伏笔】/u)
  assert.match(seen.prompt, /钟楼的脚步声/u)
})
