import test from 'node:test'
import assert from 'node:assert/strict'
import { FACT_SCHEMA, stableEntryId, validateFactEntry } from '../fact/domain/pediaSchema.js'
import { SEGMENT_MAX_CHARS, SEGMENT_MIN_CHARS, segmentStats } from '../fact/domain/segment.js'
import {
  cleanActinfo,
  extractChapter,
  parseJsonLoose
} from '../fact/usecases/pipeline/extract.js'
import {
  accumulateCharacterFacts,
  mineCharacters,
  mineSettings
} from '../fact/usecases/pipeline/mine.js'
import {
  DEFAULT_CLUSTER_THRESHOLD,
  clusterEntries,
  cosineSimilarity
} from '../fact/usecases/pipeline/cluster.js'
import {
  EXTRACTION_PROMPTS,
  MINING_PROMPTS,
  PROMPT_SOURCE,
  buildExtractPrompt
} from '../fact/usecases/pipeline/prompts.mjs'
import { createMemoryFactStore } from '../fact/adapters/memoryPediaStore.mjs'

/**
 * P2a 管线合同测试（零网络）：
 *   1) 提示词来源可溯源，抽取组/挖掘组都按 fact.data/v2 字段族给 JSON 指令；
 *   2) 容错解析 + 失败重试（≤2 次）+ 单段失败隔离；
 *   3) 段粒度 100–300 字，plot 草稿只存 quote_hash；
 *   4) 同一 bundle 重跑 operationId 幂等，不重复落库；
 *   5) 挖掘：say/do 锚点、memoryPoints、状态机（adopted 不降级 / superseded 不复活）；
 *   6) 聚类：余弦 0.5 单链合并，别名归并复用 domain/aliases。
 */

const DOMAIN = '停摆之城'
const BAD_OUTPUT = '抱歉，我无法按要求输出 JSON {'

function fakeLlm(responses) {
  const calls = []
  let index = 0
  return {
    calls,
    async complete(request) {
      calls.push(request)
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      if (response instanceof Error) throw response
      return { text: typeof response === 'function' ? response(request) : response }
    }
  }
}

function extractionOutput(overrides = {}) {
  return JSON.stringify({
    who: [
      { name: '柯秒', role: '主事' },
      { name: '守夜人', role: '参与' }
    ],
    when: { story_time: '入夜三更', timeline: '顺叙' },
    where: '旧钟楼',
    actinfo: [
      { type: 'act', channel: 'do', who: '柯秒', content: '推开钟楼的门' },
      { type: 'act', channel: 'say', who: '柯秒', content: '钟又响了。' },
      { type: 'act', channel: 'do', who: '陌生客', content: '从阴影里走出' },
      { type: 'event', content: '钟声第三次响起', scope: ['柯秒', '不存在的人'] }
    ],
    notes: '钟声异常，守夜人没有察觉。',
    ...overrides
  })
}

const SENTENCE = `${'甲'.repeat(95)}钟声一响。`

function longText(count = 5) {
  return Array.from({ length: count }, () => SENTENCE).join('\n')
}

test('提示词：来源可溯源，抽取组与挖掘组都要求 fact.data/v2 字段族 JSON', () => {
  assert.match(PROMPT_SOURCE.root, /ref-Novelpedia/u)
  assert.match(PROMPT_SOURCE.files.extraction, /prompts\.py/u)
  assert.match(PROMPT_SOURCE.files.setting, /setting_agent\.py/u)
  assert.equal(PROMPT_SOURCE.target.includes('fact.data/v2'), true)

  const prompt = buildExtractPrompt({
    segment: { index: 2, text: '钟楼的指针停了。', chars: 120 },
    chapterNo: 3,
    knownNames: ['柯秒']
  })
  assert.match(prompt, /actinfo/u)
  assert.match(prompt, /段 2/u)
  assert.match(prompt, /只输出 JSON/u)
  assert.equal(EXTRACTION_PROMPTS.buildUser, buildExtractPrompt)
  assert.match(MINING_PROMPTS.character.buildUser({ name: '柯秒' }), /memoryPoints/u)
  assert.match(MINING_PROMPTS.setting.buildUser({ chapterNo: 1 }), /readerCognition/u)
})

test('容错解析：围栏/解释文字/前后噪声都能取出 JSON；纯噪声返回失败码', () => {
  const fenced = parseJsonLoose('```json\n{"a":1}\n```')
  assert.equal(fenced.ok, true)
  assert.deepEqual(fenced.value, { a: 1 })

  const noisy = parseJsonLoose('好的，结果如下：{"a":{"b":2}} 以上。')
  assert.equal(noisy.ok, true)
  assert.equal(noisy.value.a.b, 2)

  const array = parseJsonLoose('前缀 [1,2,3] 后缀')
  assert.equal(array.ok, true)
  assert.deepEqual(array.value, [1, 2, 3])

  const broken = parseJsonLoose('完全不是 JSON')
  assert.equal(broken.ok, false)
  assert.equal(broken.code, 'JSON_PARSE_FAILED')
})

test('actinfo 清洗：渠道白名单、scope 过滤、同类合并、条数上限都按参考口径', () => {
  const cleaned = cleanActinfo([
    { type: 'act', channel: 'see', who: '柯秒', content: '看见钟摆' },
    { type: 'act', channel: 'see', who: '柯秒', content: '听见回声' },
    { type: 'act', channel: 'see', who: '柯秒', content: '闻到铁锈' },
    { type: 'act', channel: 'invalid', who: '柯秒', content: '应被丢弃' },
    { type: 'act', channel: 'do', who: '', content: '缺执行者应被丢弃' },
    { type: 'event', content: '钟声响起', scope: ['柯秒', '陌生人'] }
  ], new Set(['柯秒']), 600)

  assert.equal(cleaned.filter((item) => item.channel === 'invalid').length, 0)
  assert.equal(cleaned.filter((item) => item.type === 'act' && !item.who).length, 0)
  assert.equal(cleaned.filter((item) => item.channel === 'see').length, 2, '同角色同渠道最多 2 条，第 3 条并入')
  assert.match(cleaned.find((item) => item.type === 'event').scope.join(','), /^柯秒$/u)
})

test('抽取：段粒度 100–300 字，坏 JSON 自动重试，plot 草稿只存 quote_hash', async () => {
  const llm = fakeLlm([BAD_OUTPUT, extractionOutput(), extractionOutput()])
  const result = await extractChapter({
    text: longText(5),
    llm,
    domain: DOMAIN,
    chapterNo: 7,
    book: DOMAIN,
    bookId: 'book-7',
    knownNames: ['柯秒']
  })

  assert.equal(result.ok, true)
  assert.equal(result.failures.length, 0)
  assert.equal(llm.calls.length, 3, '第 1 段先失败一次再成功，第 2 段一次成功')
  assert.equal(result.segments.count, 2)
  assert.equal(result.segments.underMin, 0)
  assert.equal(result.segments.overMax, 0)
  assert.equal(result.drafts.length, 2)
  assert.equal(result.extractions.length, 2)

  for (const draft of result.drafts) {
    const validation = validateFactEntry(draft)
    assert.equal(validation.ok, true)
    assert.equal(draft.layer, 'plot')
    assert.equal(draft.status, 'draft')
    assert.equal(draft.provenance.mode, 'analyze')
    assert.equal(draft.provenance.quote, undefined, 'analyze 模式不许存原文')
    assert.match(draft.provenance.quote_hash, /^[0-9a-f]{40}$/u)
    assert.equal(draft.id, stableEntryId({ layer: 'plot', domain: DOMAIN, slot: '', name: draft.name }))

    const segment = draft.events[0].segments[0]
    assert.ok(segment.chars >= SEGMENT_MIN_CHARS && segment.chars <= SEGMENT_MAX_CHARS)
    assert.doesNotMatch(JSON.stringify(draft), new RegExp(`甲{10}`, 'u'), '原文不得随草稿落库')
  }

  const extraction = result.extractions[0]
  assert.equal(extraction.where, '旧钟楼')
  assert.deepEqual(extraction.when, { story_time: '入夜三更', timeline: '顺叙' })
  assert.ok(extraction.who.some((item) => item.name === '陌生客'), 'actinfo 里出现但 who 漏列的角色会补进 who')
  assert.deepEqual(extraction.actinfo.find((item) => item.type === 'event').scope, ['柯秒'])
})

test('失败隔离：一段连续 3 次坏输出只记 failures，另一段照常产出', async () => {
  const llm = fakeLlm([BAD_OUTPUT, BAD_OUTPUT, BAD_OUTPUT, extractionOutput()])
  const result = await extractChapter({
    text: longText(5),
    llm,
    domain: DOMAIN,
    chapterNo: 8
  })

  assert.equal(result.ok, false)
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].code, 'EXTRACT_FAILED')
  assert.equal(result.failures[0].attempts, 3, '默认最多重试 2 次')
  assert.equal(result.drafts.length, 1, '失败段不阻塞后续段')
})

test('幂等：同一 bundle 重跑不新增条目，operationId 重放标记 duplicate', async () => {
  const store = createMemoryFactStore()
  const llm = fakeLlm([extractionOutput()])
  const input = { text: longText(5), llm, domain: DOMAIN, chapterNo: 9, bookId: 'book-9', store }

  const first = await extractChapter(input)
  assert.equal(first.saved.length, 2)
  assert.ok(first.saved.every((item) => item.ok && item.duplicate === false))
  assert.equal(store.stats().entries, 2)

  const second = await extractChapter({ ...input, llm: fakeLlm([extractionOutput()]) })
  assert.equal(second.saved.length, 2)
  assert.ok(second.saved.every((item) => item.ok && item.duplicate === true))
  assert.equal(store.stats().entries, 2, '重跑后条目数不变')
  assert.equal(store.stats().writes, 2, '第二次全是重放，没有新增写入')
})

const EXTRACTIONS = [{
  schema: 'fact-extract/v2',
  chapterNo: 1,
  sceneId: 1,
  segment: { index: 1, chars: 240 },
  who: [
    { name: '柯秒', role: '主事' },
    { name: '守夜人', role: '参与' }
  ],
  when: { story_time: '入夜', timeline: '顺叙' },
  where: '旧钟楼',
  actinfo: [
    { type: 'act', channel: 'do', who: '柯秒', content: '推开钟楼的门' },
    { type: 'act', channel: 'say', who: '柯秒', content: '钟又响了。' },
    { type: 'act', channel: 'feel', who: '柯秒', content: '心跳发紧' },
    { type: 'act', channel: 'say', who: '守夜人', content: '别上去。' }
  ],
  notes: '钟声异常。'
}]

function characterProfileLlm() {
  return {
    calls: [],
    async complete(request) {
      this.calls.push(request)
      const matched = /小说人物「([^」]+)」/u.exec(request.prompt)
      const name = matched?.[1] ?? '未知'
      return {
        text: JSON.stringify({
          identity: `${name}的身份`,
          personality: '冷静',
          trajectory: `${name}在钟楼里行动。`,
          relations: [{ name: '守夜人', relation: '对头' }],
          anchors: { catchphrase: ['钟又响了。'] },
          memoryPoints: ['钟声第三次响起'],
          castRole: { tier: 'supporting', goal: '追查钟声', plotFunction: '推动主线' }
        })
      }
    }
  }
}

test('人物挖掘：say/do 锚点 + memoryPoints + 状态机（adopted 不降级、superseded 不复活）', async () => {
  const facts = accumulateCharacterFacts(EXTRACTIONS)
  assert.ok(facts['柯秒'].sayings.some((line) => line.includes('钟又响了')))
  assert.ok(facts['柯秒'].doings.some((line) => line.includes('推开钟楼的门')))
  assert.equal(facts['柯秒'].coOccurrences['守夜人'], 3, 'say/do/feel 三次行为都记共现')

  const kemiaoId = stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name: '柯秒' })
  const keeperId = stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name: '守夜人' })
  const authorEntry = (name, status) => ({
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name }),
    layer: 'character',
    name,
    domain: DOMAIN,
    status,
    provenance: { mode: 'author', book: DOMAIN, book_id: 'book-1', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} }
  })
  const store = createMemoryFactStore([authorEntry('柯秒', 'adopted'), authorEntry('守夜人', 'superseded')])

  const result = await mineCharacters({
    extractions: EXTRACTIONS,
    llm: characterProfileLlm(),
    domain: DOMAIN,
    book: DOMAIN,
    bookId: 'book-1',
    store
  })

  assert.equal(result.ok, true)
  assert.equal(result.entries.length, 2)
  const kemiao = result.entries.find((entry) => entry.name === '柯秒')
  assert.equal(kemiao.status, 'proposed')
  assert.ok(kemiao.anchors.speech.some((line) => line.includes('钟又响了')))
  assert.ok(kemiao.anchors.behavior.some((line) => line.includes('推开钟楼的门')))
  assert.ok(kemiao.anchors.behavior.some((line) => line.includes('心跳发紧')), '非 say 渠道进 behavior')
  assert.deepEqual(kemiao.anchors.catchphrase, ['钟又响了。'])
  assert.deepEqual(kemiao.memoryPoints, ['钟声第三次响起'])
  assert.equal(kemiao.castRole.tier, 'supporting')
  assert.equal(kemiao.provenance.mode, 'analyze')
  assert.deepEqual(kemiao.provenance.chapters, [1])
  assert.equal(validateFactEntry(kemiao).ok, true)

  assert.ok(result.warnings.some((warning) => warning.code === 'STATUS_KEPT'))
  assert.ok(result.warnings.some((warning) => warning.code === 'STATUS_TRANSITION_BLOCKED'))

  const storedKemiao = await store.get(kemiaoId)
  assert.equal(storedKemiao.entry.status, 'adopted', 'adopted 条目不被流水线降级')
  assert.ok(storedKemiao.entry.anchors.behavior.length > 0, '只补字段不推翻状态')
  const storedKeeper = await store.get(keeperId)
  assert.equal(storedKeeper.entry.status, 'superseded', 'superseded 是终态，不回写')
  assert.equal(storedKeeper.revision, 1)
})

function settingLlm() {
  const replies = [
    JSON.stringify([
      {
        name: '钟表法则',
        category: '规则',
        definition: '表针停摆时，全城记忆停止。',
        aliases: ['停摆法则'],
        related: [{ to: '旧钟楼', type: '地点', how: '钟楼是法则的载体' }],
        readerCognition: { firstMention: true, supplementNeeded: false }
      },
      { name: '医院', category: '地点', definition: '治病的场所' }
    ]),
    JSON.stringify([
      { name: '停摆法则', category: '规则', definition: '停摆期间无人能离开钟楼。' }
    ])
  ]
  let index = 0
  return {
    calls: [],
    async complete(request) {
      this.calls.push(request)
      const reply = replies[Math.min(index, replies.length - 1)]
      index += 1
      return { text: reply }
    }
  }
}

test('设定挖掘：同期多次提及归并到规范名，定义用"；"补充，通用词拒收，状态走 proposed', async () => {
  const existing = {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain: DOMAIN, slot: 'rules', name: '钟表法则' }),
    layer: 'worldview',
    name: '钟表法则',
    domain: DOMAIN,
    slot: 'rules',
    status: 'draft',
    definition: '表针停摆时，所有人的记忆停止。',
    aliases: ['停摆律'],
    provenance: { mode: 'author', book: DOMAIN, book_id: 'book-1', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} }
  }
  const extractions = [
    { ...EXTRACTIONS[0], sceneId: 1 },
    { ...EXTRACTIONS[0], sceneId: 2 }
  ]
  const store = createMemoryFactStore()
  const llm = settingLlm()
  const result = await mineSettings({
    extractions,
    entries: [existing],
    llm,
    domain: DOMAIN,
    book: DOMAIN,
    bookId: 'book-1',
    store
  })

  assert.equal(result.ok, true)
  assert.equal(result.entries.length, 1, '医院被通用词规则拒收')
  assert.ok(result.warnings.some((warning) => warning.code === 'SETTING_GENERIC_REJECTED'))
  assert.equal(llm.calls.length, 2)

  const entry = result.entries[0]
  assert.equal(entry.name, '钟表法则')
  assert.equal(entry.slot, 'rules')
  assert.equal(entry.status, 'proposed')
  assert.match(entry.definition, /所有人的记忆停止/u)
  assert.match(entry.definition, /全城记忆停止/u)
  assert.match(entry.definition, /无人能离开钟楼/u, '两次提及的定义都补进来')
  assert.deepEqual(entry.aliases.sort(), ['停摆律', '停摆法则'].sort())
  assert.deepEqual(entry.provenance.chapters, [1])
  assert.deepEqual(entry.provenance.scenes, [1, 2])
  assert.equal(entry.readerCognition.firstMention, true)
  assert.ok(entry.relations.some((relation) => relation.to === '旧钟楼'))
  assert.equal(validateFactEntry(entry).ok, true)

  assert.equal(result.saved.length, 1)
  assert.equal(result.saved[0].ok, true)
  assert.equal(result.saved[0].duplicate, false)
  assert.equal(store.stats().entries, 1)

  const rerun = await mineSettings({
    extractions,
    entries: [existing],
    llm: settingLlm(),
    domain: DOMAIN,
    book: DOMAIN,
    bookId: 'book-1',
    store
  })
  assert.ok(rerun.saved.every((item) => item.ok && item.duplicate === true), '设定重跑幂等')
  assert.equal(store.stats().entries, 1)
})

function fakeVectorPort(table) {
  return {
    calls: [],
    async embed(texts) {
      this.calls.push([...texts])
      return texts.map((text) => table[text] ?? [0, 0])
    },
    async search() {
      return []
    }
  }
}

test('聚类：余弦阈值 0.5、单链合并、别名归并复用 domain/aliases', async () => {
  const radians = (degrees) => (degrees * Math.PI) / 180
  const table = {
    程实: [1, 0],
    程哥: [Math.cos(radians(55)), Math.sin(radians(55))],
    实哥: [Math.cos(radians(110)), Math.sin(radians(110))],
    路人甲: [-1, 0]
  }
  const port = fakeVectorPort(table)
  const result = await clusterEntries({
    items: [
      { name: '程实', aliases: ['程哥'] },
      { name: '程哥' },
      { name: '实哥' },
      { name: '路人甲' }
    ],
    vectorPort: port,
    threshold: 0.5
  })

  assert.equal(result.threshold, DEFAULT_CLUSTER_THRESHOLD)
  assert.equal(result.ok, true)
  assert.equal(result.embedded, 4)
  assert.deepEqual(port.calls[0], ['程实', '程哥', '实哥', '路人甲'])
  assert.equal(result.clusters.length, 2)

  const main = result.clusters[0]
  assert.equal(main.canonical, '程实')
  assert.deepEqual(main.members, ['程实', '程哥', '实哥'], 'A-B、B-C 过阈值即单链合并，A-C 不必直接相似')
  assert.deepEqual(main.aliases, ['程哥', '实哥'])
  assert.equal(result.aliasIndex.resolve('实哥'), '程实')
  assert.deepEqual(
    result.aliasIndex.aliasesOf('程实').filter((term) => term !== '程实').sort(),
    ['实哥', '程哥'].sort()
  )
  assert.deepEqual(result.clusters[1].members, ['路人甲'])

  assert.ok(cosineSimilarity([1, 0], [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)]) >= 0.5)
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0, '维度不同不猜相似度')
})

test('聚类：边界值 0.5 合并；缺向量且无 VectorPort 时如实告警并各自成簇', async () => {
  const boundary = await clusterEntries({
    items: [
      { name: '甲', vector: [1, 0] },
      { name: '乙', vector: [0.5, Math.sqrt(0.75)] }
    ],
    threshold: 0.5
  })
  assert.equal(boundary.clusters.length, 1)
  assert.deepEqual(boundary.clusters[0].members, ['甲', '乙'])

  const noVectors = await clusterEntries({
    items: [{ name: '甲' }, { name: '乙' }]
  })
  assert.equal(noVectors.clusters.length, 2)
  assert.ok(noVectors.warnings.some((warning) => warning.code === 'NO_VECTORS'))
})

test('段粒度读数与抽取结果一致（防止段边界回归）', async () => {
  const result = await extractChapter({
    text: longText(5),
    llm: fakeLlm([extractionOutput()]),
    domain: DOMAIN,
    chapterNo: 11
  })
  assert.deepEqual(result.segments.limits, { min: SEGMENT_MIN_CHARS, max: SEGMENT_MAX_CHARS })
  assert.equal(result.segments.count, 2)
  const chars = result.drafts.map((draft) => draft.events[0].segments[0].chars)
  assert.deepEqual(chars, [300, 200])
  assert.deepEqual(segmentStats(result.extractions.map((item) => item.segment)), {
    count: 2,
    totalChars: 500,
    minChars: 200,
    maxChars: 300,
    underMin: 0,
    overMax: 0,
    limits: { min: SEGMENT_MIN_CHARS, max: SEGMENT_MAX_CHARS }
  })
})
