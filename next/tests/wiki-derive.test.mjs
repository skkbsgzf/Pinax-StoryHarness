import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveWiki,
  derivePseudoChapters,
  hasRealChapters,
  pseudoChapterCount,
  plotMinSegment,
  chapterTitlesFromSource
} from '../kernel/wikiDerive.mjs'

/**
 * deriveWiki（S4 · WO-S4-01）：从 build-wiki 搬进内核的纯派生。
 * 全部用内存夹具，不碰磁盘、不调模型——这里钉的是字段结构、伪章切分、噪声过滤与幂等。
 */

const plot = ({ name, from = 1, who = ['柯秒'], content = '雪夜里钟停了。', seg = 1, relations = [] }) => ({
  schema: 'fact.data/v3',
  id: `plot-${name}`,
  layer: 'plot',
  name,
  domain: '停摆之城',
  validity: { from, to: from },
  who,
  events: [{ who: who[0], channel: 'say', content, segments: [{ index: seg }] }],
  relations
})

const character = (name, extra = {}) => ({
  schema: 'fact.data/v3',
  id: `char-${name}`,
  layer: 'character',
  name,
  domain: '停摆之城',
  aliases: [],
  ...extra
})

function envelope(overrides = {}) {
  const plots = [
    plot({ name: '雪夜', who: ['柯秒', '钟楼'], seg: 1, relations: [{ from: '柯秒', to: '钟楼', type: '守望', how: '每夜上钟楼' }] }),
    plot({ name: '修表', who: ['柯秒', '钟楼'], seg: 60 }),
    plot({ name: '停摆', who: ['柯秒', '钟楼'], seg: 160 }),
    plot({ name: '归来', who: ['柯秒', '钟楼'], seg: 260 }),
    plot({ name: '路人', who: ['配角甲'], seg: 300 }),
    plot({ name: '噪声一', who: ['最后'], seg: 320 }),
    plot({ name: '噪声二', who: ['最后'], seg: 340 }),
    plot({ name: '噪声三', who: ['最后'], seg: 360 })
  ]
  return {
    book: { id: 'book-tower', title: '停摆之城', author: '放', word_count: 6600 },
    source: { file: '停摆之城.txt', chars: 6600 },
    revision: 3,
    perspective: '第三人称',
    quality: { traceableRate: 0.936 },
    entries: [
      ...plots,
      character('柯秒', { identity: '钟表匠', traits: ['冷静'] }),
      character('钟楼'),
      character('配角甲'),
      character('最后'),
      { schema: 'fact.data/v3', id: 'world-table', layer: 'world', name: '停摆的表', domain: '停摆之城', definition: '停在十一点。' }
    ],
    ...overrides
  }
}

function enrichWiki() {
  return {
    version: 'wiki-enrich@3',
    perspective: '第三人称',
    slots: { gimmick: '停摆', plotDesign: '以表计时', intro: '雪夜', style: {} },
    ledger: { knows: ['柯秒'] },
    enums: { structures: ['单线'], chapterFunctions: ['铺垫'], emotions: ['冷'] },
    excerpts: ['「雪停了。」'],
    storySummary: '一只停在十一点的表，和守了十年的人。',
    arc: [{ phase: '起', chapters: [1, 2], text: '雪夜钟停' }],
    chapterSummaries: [
      { chapter: 1, title: '雪夜', summary: '钟楼停摆。', function: '铺垫', emotion: '冷', beats: 3 }
    ],
    foreshadows: [{ chapter: 1, text: '停在十一点的表' }],
    characterProfiles: [
      { name: '柯秒', identity: '钟表匠', archetype: '守望者', goal: '修好表', personality: ['冷静'], arc: null, keyChoices: [], mirror: '', summary: '守了十年钟楼的人。' }
    ],
    worldElements: {
      scenes: [{ name: '钟楼', chapters: [1, 2], desc: '雪中的钟楼' }],
      items: [{ name: '停摆的表', chapters: [1], holder: '柯秒', desc: '停在十一点' }]
    },
    failures: []
  }
}

test('deriveWiki：结构——书／章节／人物／矩阵／词条／图谱／时间线／增补字段齐备', () => {
  const wiki = enrichWiki()
  const result = deriveWiki(envelope(), { wiki })

  assert.deepEqual(result.book, {
    id: 'book-tower',
    title: '停摆之城',
    author: '放',
    words: 6600,
    group: '',
    url: null
  })
  // 6600 字 → 伪章 4 节（round(3) 被下限抬到 4）
  assert.equal(result.pseudoChapters, true)
  assert.equal(result.chapters.length, 4)
  assert.equal(result.chapters[0].title, '雪夜', '增补小标题优先')
  assert.equal(result.chapters[0].summary, '钟楼停摆。')
  assert.equal(result.chapters[0].function, '铺垫')
  assert.equal(result.chapters[0].foreshadow.length, 1)

  // 人物：出场 ≥3 或无档案过滤；「最后」在黑名单；「配角甲」只出场 1 段且无档案 → 滤掉
  assert.deepEqual(result.characters.map((person) => person.name), ['柯秒', '钟楼'])
  const ke = result.characters[0]
  assert.equal(ke.identity, '钟表匠', '增补档案覆盖条目 identity')
  assert.equal(ke.summary, '守了十年钟楼的人。')
  assert.equal(ke.appearances, 4)
  assert.equal(ke.edges.length, 1)
  assert.equal(ke.edges[0].other, '钟楼')

  assert.equal(result.matrix.length, 2, '矩阵＝人物 × 章节')
  assert.equal(result.matrix[0].length, 4)
  assert.equal(result.channels.length, 2)
  assert.deepEqual(result.channels[0], { say: 4, do: 0, other: 0 })

  // 词条：world 条目＋增补的场景／道具
  assert.deepEqual(result.terms.map((term) => [term.name, term.kind]), [
    ['停摆的表', '设定'],
    ['钟楼', '场景'],
    ['停摆的表', '道具']
  ])
  assert.equal(result.charGraph.nodes.length, 2 + 4 + 3, '人物＋事件节点＋词条节点')
  assert.ok(result.charGraph.edges.length > 0)

  assert.equal(result.timeline.length, 4)
  assert.equal(result.timeline[0].events.length, 2)
  assert.deepEqual(result.timeline[0].events[0], { who: '柯秒', channel: 'say', text: '雪夜里钟停了。' })

  // 增补字段原样保留（重复派生不丢）
  assert.deepEqual(result.slots, wiki.slots)
  assert.deepEqual(result.ledger, wiki.ledger)
  assert.deepEqual(result.enums, wiki.enums)
  assert.deepEqual(result.excerpts, wiki.excerpts)
  assert.deepEqual(result.characterProfiles, wiki.characterProfiles)
  assert.deepEqual(result.chapterSummaries, wiki.chapterSummaries)
  assert.deepEqual(result.worldElements, wiki.worldElements)
  assert.equal(result.storySummary, wiki.storySummary)
  assert.deepEqual(result.arc, wiki.arc)
  assert.equal(result.enrich.perspective, '第三人称')
  assert.equal(result.enrich.storySummary, wiki.storySummary)
  assert.deepEqual(result.quality, { traceableRate: 0.936 })
})

test('deriveWiki：纯函数幂等——同输入两次 deepEqual；上一版输出当输入再派生也 deepEqual', () => {
  const wiki = enrichWiki()
  const first = deriveWiki(envelope(), { wiki })
  const second = deriveWiki(envelope(), { wiki })
  assert.deepEqual(second, first)
  // 派生档回灌（store 第二次派生走的就是这条路）：增补字段不丢，派生字段不漂
  const again = deriveWiki(envelope(), { wiki: first })
  assert.deepEqual(again, first)
})

test('deriveWiki：空输入——空 entries／null 都给出可消费的空壳，不抛', () => {
  for (const input of [[], null, {}, { entries: [] }]) {
    const result = deriveWiki(input)
    assert.deepEqual(result.chapters, [])
    assert.deepEqual(result.characters, [])
    assert.deepEqual(result.matrix, [])
    assert.deepEqual(result.channels, [])
    assert.deepEqual(result.terms, [])
    assert.deepEqual(result.timeline, [])
    assert.deepEqual(result.charGraph, { nodes: [], edges: [] })
    assert.deepEqual(result.quality, { traceableRate: null })
    assert.equal(result.pseudoChapters, true, '与 devtools 同式：没有 plot 时 hasRealChapters 为假，走伪章分支')
    assert.equal(result.book.author, '佚名')
  }
})

test('deriveWiki：真章书不走伪章，章标题回退「第 N 章」；原文章名优先', () => {
  const input = envelope({
    entries: [
      plot({ name: '一', from: 1, seg: 1 }),
      plot({ name: '二', from: 2, seg: 100 })
    ]
  })
  const withoutSource = deriveWiki(input)
  assert.equal(withoutSource.pseudoChapters, false)
  assert.deepEqual(withoutSource.chapters.map((chapter) => chapter.title), ['第 1 章', '第 2 章'])

  const withSource = deriveWiki(input, { sourceText: '第1章 相亲\n正文\n第2章 上钟楼\n正文' })
  assert.deepEqual(withSource.chapters.map((chapter) => chapter.title), ['第1章 相亲', '第2章 上钟楼'])
})

test('伪章辅助：段号切分与节数封顶（与 devtools 版同式）', () => {
  assert.equal(pseudoChapterCount(0), 4)
  assert.equal(pseudoChapterCount(6600), 4)
  assert.equal(pseudoChapterCount(30000), 12)
  assert.equal(plotMinSegment({ events: [{ segments: [{ index: 7 }, { index: 3 }] }] }), 3)
  assert.equal(plotMinSegment({ events: [] }), Infinity)

  const plots = [
    { events: [{ segments: [{ index: 1 }] }] },
    { events: [{ segments: [{ index: 50 }] }] },
    { events: [{ segments: [{ index: 99 }] }] }
  ]
  const groups = derivePseudoChapters(plots, 6600)
  assert.equal(groups.length, 3, '空节不产出（byNo 只认有 plot 的节号）')
  assert.deepEqual(groups.map((group) => group.no), [1, 2, 4])
  assert.equal(groups[0].plots[0], plots[0])

  assert.equal(hasRealChapters([{ validity: { from: 1 } }, { validity: { from: 1 } }]), false)
  assert.equal(hasRealChapters([{ validity: { from: 1 } }, { validity: { from: 2 } }]), true)
  assert.equal(chapterTitlesFromSource('第1章 相亲\n第 2 章 上钟楼').size, 2)
})

test('deriveWiki：视角／质量／book 覆盖走 options，缺省回信封', () => {
  const result = deriveWiki(envelope(), {
    perspective: '第一人称',
    quality: { traceableRate: 0.5 },
    book: { id: 'book-x', title: '替换书名', word_count: 4400 }
  })
  assert.equal(result.enrich.perspective, '第一人称')
  assert.deepEqual(result.quality, { traceableRate: 0.5 })
  assert.equal(result.book.id, 'book-x')
  assert.equal(result.book.title, '替换书名')
  assert.equal(result.book.words, 4400)
})
