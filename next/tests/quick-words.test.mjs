import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildQuickWordCatalog,
  extractQuickTerms,
  filterQuickWords,
  groupQuickWords,
  isQuickWordEnabled,
  markQuickWordUsed,
  quickWordMemory,
  resetQuickWordMemory,
  toggleQuickWord
} from '../shell/quickWords.mjs'
import {
  generateNameSuggestions,
  generateNames
} from '../shell/nameGenerator.mjs'

/**
 * 批次46B · 任务②：快捷词与取名。
 *
 * 快捷词是纯派生（世界书条目＋正文 n-gram），启用／最近使用只在内存里；
 * 取名是本地名字池，批次内按核心名去重，与世界书重名只标 duplicate 不替换。
 * 两条都不落盘——这组测试同时钉住「不写文件」这件事只是模块形态（没有 fs 引用）。
 */

const ENTRIES = [
  { id: 's1', type: 'setting', name: '雨夜城', keys: ['雨城'], summary: '常年落雨的城' },
  { id: 'c1', type: 'character', name: '沈砚', keys: ['阿砚'], keysSecondary: ['砚哥'], aliases: ['沈先生'], summary: '主角' },
  { id: 'c2', type: 'character', name: '沈砚', summary: '同名的第二个条目' }
]

test('词表：世界书条目在前（角色优先），名称／别名／次别名都收，同名只留第一条', () => {
  const catalog = buildQuickWordCatalog({ entries: ENTRIES, text: '' })
  assert.deepEqual(catalog.map((item) => item.text), ['沈砚', '阿砚', '砚哥', '沈先生', '雨夜城', '雨城'])
  assert.deepEqual(catalog.map((item) => item.sourceKind), ['character', 'character', 'character', 'character', 'setting', 'setting'])
  // 固定形状：id／text／label／summary／sourceKind。
  assert.deepEqual(Object.keys(catalog[0]).sort(), ['id', 'label', 'sourceKind', 'summary', 'text'])
  assert.equal(catalog[0].summary, '主角')
  assert.equal(catalog[4].summary, '常年落雨的城')
  assert.equal(Object.isFrozen(catalog), true)
  assert.equal(Object.isFrozen(catalog[0]), true)
})

test('正文提取：引号词权重高、英文专名计入、中文片段出现两次才收，占用词不重复', () => {
  const text = '他说「青灯」。「青灯」亮了，Arden 走进 Arden 的屋。'
  const terms = extractQuickTerms(text)
  const byText = new Map(terms.map((item) => [item.text, item]))

  assert.equal(byText.get('青灯')?.sourceKind, 'extracted')
  assert.match(byText.get('青灯')?.summary ?? '', /出现 10 次/u, '引号内每次记 4 分（两处共 8），中文片段再各记 1 分')
  assert.equal(byText.get('Arden')?.sourceKind, 'extracted')
  assert.match(byText.get('Arden')?.summary ?? '', /出现 6 次/u, '英文专名每次记 3 分')
  assert.equal(byText.has('亮了'), false, '只出现一次的中文片段不收')

  const occupied = extractQuickTerms(text, { occupied: new Set(['青灯']) })
  assert.equal(occupied.some((item) => item.text === '青灯'), false)
  assert.equal(extractQuickTerms(text, { limit: 1 }).length, 1)

  // 世界书已有的词不再从正文里重复抽出来。
  const merged = buildQuickWordCatalog({ entries: ENTRIES, text })
  assert.equal(merged.filter((item) => item.text === '青灯').length, 1)
  assert.equal(merged.filter((item) => item.text === '沈砚').length, 1)
})

test('分组与搜索：角色／设定／提取三组，名称与摘要都参与过滤', () => {
  const catalog = buildQuickWordCatalog({ entries: ENTRIES, text: '「青灯」又亮了，「青灯」很旧。' })
  const groups = groupQuickWords(catalog)
  assert.equal(groups.character.length, 4)
  assert.equal(groups.setting.length, 2)
  assert.equal(groups.extracted.length, 1)

  assert.deepEqual(filterQuickWords(catalog, '阿').map((item) => item.text), ['阿砚'])
  assert.deepEqual(filterQuickWords(catalog, '落雨').map((item) => item.text), ['雨夜城', '雨城'], '摘要也参与过滤')
  assert.deepEqual(filterQuickWords(catalog, '主角').map((item) => item.text), ['沈砚', '阿砚', '砚哥', '沈先生'])
  assert.equal(filterQuickWords(catalog, '').length, catalog.length)
})

test('会话内记忆：默认启用、可停用、最近使用最多 8 条且倒序', () => {
  resetQuickWordMemory()
  try {
    assert.equal(isQuickWordEnabled('c1:沈砚'), true, '没被停用就是启用')
    assert.equal(toggleQuickWord('c1:沈砚'), false)
    assert.equal(isQuickWordEnabled('c1:沈砚'), false)
    assert.deepEqual(quickWordMemory().disabled, ['c1:沈砚'])
    assert.equal(toggleQuickWord('c1:沈砚', true), true)
    assert.equal(isQuickWordEnabled('c1:沈砚'), true)

    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) markQuickWordUsed(id)
    const memory = quickWordMemory()
    assert.deepEqual(memory.recent, ['i', 'h', 'g', 'f', 'e', 'd', 'c', 'b'], '只留最近 8 条，新的在前')
    assert.deepEqual(markQuickWordUsed('c'), ['c', 'i', 'h', 'g', 'f', 'e', 'd', 'b'], '重复使用把它顶到最前')
  } finally {
    resetQuickWordMemory()
  }
})

test('取名：中文三字、批次内核心名不重复、数量钳在 1–24', () => {
  const names = generateNames({ category: 'person', language: 'chinese', length: 'three', count: 8, random: () => 0 })
  assert.equal(names.length, 8)
  assert.equal(new Set(names).size, 8)
  for (const name of names) assert.equal([...name].length, 3, `三字名长度不对：${name}`)

  assert.equal(generateNames({ category: 'person', count: 0, random: () => 0 }).length, 1)
  assert.equal(generateNames({ category: 'person', count: 100, random: () => 0 }).length, 24)
})

test('取名：西式／日式与地名、组织、能力、器物都给得出，批次内不重复', () => {
  for (const language of ['western', 'japanese']) {
    const names = generateNames({ category: 'person', language, length: 'three', count: 8, random: () => 0 })
    assert.equal(names.length, 8, `${language} 三字名不够`)
    assert.equal(new Set(names).size, 8)
  }
  for (const category of ['place', 'organization', 'ability', 'item']) {
    const names = generateNames({ category, count: 8, random: () => 0 })
    assert.equal(names.length, 8, `${category} 名字不够`)
    assert.equal(new Set(names).size, 8)
  }
})

test('取名：与世界书重名标 duplicate，不替作者换掉', () => {
  const first = generateNames({ category: 'place', count: 1, random: () => 0 })[0]
  const suggestions = generateNameSuggestions({
    entries: [{ name: first }, { aliases: ['另一个名字'] }],
    category: 'place',
    count: 3,
    random: () => 0
  })
  assert.equal(suggestions.length, 3)
  assert.deepEqual(suggestions[0], { name: first, duplicate: true })
  assert.equal(suggestions[1].duplicate, false)
  // 重名只打标，名字本身还在列表里。
  assert.equal(suggestions.some((item) => item.name === first), true)
})
