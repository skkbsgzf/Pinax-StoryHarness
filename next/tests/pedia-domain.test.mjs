import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import {
  FACT_SCHEMA,
  FACT_LAYERS,
  WORLDVIEW_SLOTS,
  CATEGORY_MAP,
  ENTRY_STATUSES,
  STATUS_TRANSITIONS,
  DEFAULT_RHYTHM_SPEC,
  canTransitionStatus,
  validateStatusTransition,
  transitionEntryStatus,
  stableEntryId,
  sha1Hex,
  slotForCategory,
  isOrderedSlot,
  validateFactEntry,
  isWorldviewEntry,
  createRhythmSpec,
  instantiateStructureTemplate
} from '../fact/domain/pediaSchema.js'
import {
  normalizeSpan,
  validityBounds,
  spansOverlap,
  isActiveAt,
  intersectValidity,
  validityFromSpan,
  validateValidityShape
} from '../fact/domain/validity.js'
import { checkPerspective, normalizeKnowledgeLedger } from '../fact/domain/perspective.js'
import {
  SEGMENT_MIN_CHARS,
  SEGMENT_MAX_CHARS,
  charCount,
  segmentText,
  segmentStats,
  splitParagraphs,
  splitSentences
} from '../fact/domain/segment.js'
import { createAliasIndex } from '../fact/domain/aliases.js'

/**
 * P1 域层合同测试：只钉 next/fact/domain 的纯函数口径——
 *   1) 词表/稳定 id/状态机/双时间轴/schema/视角/分段/别名；
 *   2) 静态边界：fact 域不得 import 宿主（node 内置、shell/runtime/kernel/carriers）；
 *   3) wikihub 里没有域实现副本（旧入口只剩转发薄壳）。
 * 期望值来自 fact.data/v2 定稿（ADR）与 v1 迁移口径，不另立标准。
 */

const sha1 = (text) => createHash('sha1').update(text, 'utf8').digest('hex')

function worldviewEntry(overrides = {}) {
  const name = overrides.name ?? '旧钟楼'
  const domain = overrides.domain ?? '停摆之城'
  const slot = overrides.slot ?? 'locations'
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain, slot, name }),
    layer: 'worldview',
    name,
    domain,
    slot,
    status: 'draft',
    definition: '城南的钟楼。',
    provenance: { mode: 'author', book: domain, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    ...overrides
  }
}

function characterEntry(overrides = {}) {
  const name = overrides.name ?? '柯秒'
  const domain = overrides.domain ?? '停摆之城'
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain, slot: '', name }),
    layer: 'character',
    name,
    domain,
    status: 'draft',
    provenance: { mode: 'author', book: domain, chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} },
    ...overrides
  }
}

function plotEntry(overrides = {}) {
  const name = overrides.name ?? '停摆'
  const domain = overrides.domain ?? '停摆之城'
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain, slot: '', name }),
    layer: 'plot',
    name,
    domain,
    status: 'draft',
    provenance: { mode: 'author', book: domain, chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} },
    ...overrides
  }
}

test('词汇表：三层一等公民、11 槽位、34 类归并；style 不在层里（S1 解耦）', () => {
  assert.deepEqual(Object.keys(FACT_LAYERS), ['worldview', 'character', 'plot'])
  assert.equal(FACT_LAYERS.worldview.align, 'hard')
  assert.equal(FACT_LAYERS.character.align, 'soft')
  assert.equal(FACT_LAYERS.style, undefined)
  assert.equal(Object.keys(WORLDVIEW_SLOTS).length, 11)
  assert.equal(isOrderedSlot('power_levels'), true)
  assert.equal(isOrderedSlot('locations'), false)
  assert.equal(slotForCategory('境界'), 'power_levels')
  assert.equal(slotForCategory('编年'), 'other')
  assert.equal(Object.keys(CATEGORY_MAP).length, 48, '34 类归并 + 同义分类，表本身冻结在 48 条')
  assert.deepEqual(DEFAULT_RHYTHM_SPEC.windowChars, [500, 1500, 4500])
  assert.deepEqual(createRhythmSpec({ windowChars: [300, 900], noveltyTags: ['燃'] }), { windowChars: [300, 900], noveltyTags: ['燃'] })
  const instance = instantiateStructureTemplate({ name: '三幕', kind: 'beat-sheet', beats: ['起', '承', '转'] })
  assert.match(instance.id, /^三幕-inst-/u)
  assert.equal(instance.instanceOf, '三幕')
})

test('稳定 id：sha1 与 node:crypto 同值，格式固定 12 位十六进制', () => {
  assert.equal(sha1Hex('fact.data/v2'), sha1('fact.data/v2'))
  assert.equal(sha1Hex(''), sha1(''))
  const id = stableEntryId({ layer: 'worldview', domain: '停摆之城', slot: 'locations', name: '旧钟楼' })
  assert.equal(id, sha1('worldview|停摆之城|locations|旧钟楼').slice(0, 12))
  assert.match(id, /^[0-9a-f]{12}$/u)
})

test('状态机：draft→proposed→adopted→superseded；同态幂等，跳级与回终态都拒', () => {
  assert.equal(canTransitionStatus('draft', 'proposed'), true)
  assert.equal(canTransitionStatus('proposed', 'adopted'), true)
  assert.equal(canTransitionStatus('adopted', 'superseded'), true)
  assert.equal(canTransitionStatus('draft', 'adopted'), false)
  assert.equal(canTransitionStatus('superseded', 'draft'), false)
  assert.equal(canTransitionStatus('draft', 'draft'), true, '同态转移按幂等放行')
  assert.deepEqual(Object.keys(STATUS_TRANSITIONS), ENTRY_STATUSES)

  const illegal = validateStatusTransition('draft', 'adopted')
  assert.equal(illegal.ok, false)
  assert.equal(illegal.code, 'ILLEGAL_STATUS_TRANSITION')

  const entry = worldviewEntry()
  const adopted = transitionEntryStatus(entry, 'adopted')
  assert.equal(adopted.ok, false, 'draft 不能一步到 adopted')
  const proposed = transitionEntryStatus(entry, 'proposed')
  assert.equal(proposed.ok, true)
  assert.equal(proposed.entry.status, 'proposed')
  assert.equal(entry.status, 'draft', '不改原对象')
})

test('双时间轴：归一化、相交、交集与从 span 推 validity（无界用 null，不编 0）', () => {
  assert.deepEqual(normalizeSpan(3), { from: 3, to: 3 })
  assert.deepEqual(normalizeSpan({ from: 2 }), { from: 2, to: null })
  assert.deepEqual(normalizeSpan(undefined), { from: null, to: null })
  assert.deepEqual(validityBounds({ from: 2, to: 5 }), { from: 2, to: 5 })
  assert.deepEqual(validityBounds(undefined), { from: null, to: null })

  assert.equal(spansOverlap({ from: 1, to: 3 }, { from: 3, to: 5 }), true, '端点相接算相交')
  assert.equal(spansOverlap({ from: 1, to: 2 }, 3), false)
  assert.equal(spansOverlap({ from: null, to: null }, { from: 9, to: 9 }), true, '无界与任意区间相交')
  assert.equal(isActiveAt({ from: 1, to: 3 }, 2), true)
  assert.equal(isActiveAt(undefined, 99), true, 'validity 缺省＝全时段生效')
  assert.deepEqual(intersectValidity({ from: 1, to: 5 }, { from: 4, to: 9 }), { from: 4, to: 5 })
  assert.equal(intersectValidity({ from: 1, to: 2 }, { from: 5, to: 6 }), null)

  assert.deepEqual(validityFromSpan({ first_chapter: 3, last_chapter: 7 }), { from: 3, to: 7 })
  assert.deepEqual(validityFromSpan({ first_scene: 2, last_scene: 4 }), { from: 2, to: 4 })
  assert.deepEqual(validityFromSpan({}), { from: null, to: null })
  assert.deepEqual(validityFromSpan({ first_chapter: 5 }), { from: 5, to: null })

  assert.equal(validateValidityShape({ from: 5, to: 1 }).errors[0].code, 'VALIDITY_RANGE')
  assert.equal(validateValidityShape({ from: 'x' }).errors[0].code, 'VALIDITY_VALUE')
})

test('信封校验：必填/枚举/id 漂移/quote 哈希规则；castRole 在 analyze 是错、author 是警告', () => {
  const base = worldviewEntry()
  assert.equal(validateFactEntry(base).ok, true)
  assert.equal(isWorldviewEntry(base), true)
  assert.deepEqual(validateFactEntry({ ...base, id: '000000000000' }).errors.map((error) => error.code).includes('ID_MISMATCH'), true)
  assert.equal(validateFactEntry({ ...base, slot: 'weird' }).errors.some((error) => error.code === 'UNKNOWN_SLOT'), true)
  assert.equal(validateFactEntry({ ...base, definition: '' }).errors.some((error) => error.code === 'MISSING_REQUIRED'), true)
  assert.equal(validateFactEntry({ ...base, status: 'weird' }).errors.some((error) => error.code === 'STATUS_INVALID'), true)

  const analyzeWithQuote = {
    ...base,
    provenance: { ...base.provenance, mode: 'analyze', quote: '原文' }
  }
  assert.equal(validateFactEntry(analyzeWithQuote).errors.some((error) => error.code === 'PROVENANCE_QUOTE_NOT_HASHED'), true, 'analyze 不得带 quote 原文')

  const incompleteCast = characterEntry({
    castRole: { tier: 'supporting', goal: '', plotFunction: '' }
  })
  const asAuthor = validateFactEntry(incompleteCast)
  assert.equal(asAuthor.ok, true, 'author 模式先给警告')
  assert.ok(asAuthor.warnings.some((warning) => warning.code === 'CAST_ROLE_INCOMPLETE'))
  const asAnalyze = validateFactEntry({
    ...incompleteCast,
    provenance: { ...incompleteCast.provenance, mode: 'analyze' }
  })
  assert.equal(asAnalyze.ok, false, 'analyze 模式直接拒')
  assert.ok(asAnalyze.errors.some((error) => error.code === 'CAST_ROLE_INCOMPLETE'))

  const ordered = worldviewEntry({ name: '钟表境', slot: 'power_levels' })
  assert.ok(validateFactEntry(ordered).warnings.some((warning) => warning.code === 'ORDERED_SLOT_WITHOUT_RANK'))

  const plot = plotEntry({ events: [{ index: 1, track: 'dream', segments: [{ index: 1, chars: 0 }] }] })
  const plotResult = validateFactEntry(plot)
  assert.ok(plotResult.errors.some((error) => error.code === 'PLOT_EVENT_TRACK'))
  assert.ok(plotResult.errors.some((error) => error.code === 'PLOT_EVENT_SEGMENT_CHARS'))
})

test('视角校验：已知、未知、晚于时点三种；无 perspective 跳过不误报', () => {
  const ledger = {
    柯秒: [
      { fromEntry: '旧钟楼', kind: 'setting', atSpan: { from: 1, to: 1 } },
      { fromEntry: '钟表境', kind: 'setting', atSpan: { from: 5, to: 5 } }
    ]
  }
  assert.equal(normalizeKnowledgeLedger(ledger).get('柯秒').length, 2)
  assert.equal(normalizeKnowledgeLedger([{ character: '柯秒', fromEntry: '旧钟楼' }]).get('柯秒').length, 1)

  const at2 = {
    name: '雨夜',
    perspective: { character: '柯秒', atSpan: { from: 2, to: 2 } },
    relations: [{ to: '旧钟楼' }, { to: '钟表境' }, { to: '雾港' }]
  }
  const result = checkPerspective(at2, ledger)
  assert.equal(result.ok, false)
  assert.equal(result.checked, 3)
  const byRef = Object.fromEntries(result.violations.map((violation) => [violation.referenced, violation]))
  assert.equal(byRef['旧钟楼'], undefined, '第 1 章就知道的事，第 2 章可用')
  assert.equal(byRef['钟表境'].reason, 'known-later')
  assert.equal(byRef['钟表境'].knownAt, 5)
  assert.equal(byRef['雾港'].reason, 'not-in-ledger')

  const skipped = checkPerspective({ name: '独白', relations: [{ to: '钟表境' }] }, ledger)
  assert.equal(skipped.ok, true)
  assert.equal(skipped.skipped, 'NO_PERSPECTIVE')
})

test('S4 分段：99/100/300/301 边界；超长均衡拆、短段并邻、读数如实记账', () => {
  assert.equal(SEGMENT_MIN_CHARS, 100)
  assert.equal(SEGMENT_MAX_CHARS, 300)
  assert.equal(charCount('钟表'), 2)
  assert.equal(charCount('🙂'), 1, '按码点计，表情算 1 字')

  const exact100 = '甲'.repeat(100)
  const exact300 = '甲'.repeat(300)
  const over301 = '甲'.repeat(301)
  const under99 = '甲'.repeat(99)

  assert.deepEqual(segmentText(exact100).map((segment) => segment.chars), [100])
  assert.deepEqual(segmentText(exact300).map((segment) => segment.chars), [300])
  const split = segmentText(over301)
  assert.equal(split.length, 2)
  assert.ok(split.every((segment) => segment.chars <= SEGMENT_MAX_CHARS))
  assert.ok(split.every((segment) => segment.chars >= SEGMENT_MIN_CHARS))

  const shortStats = segmentStats(segmentText(under99))
  assert.equal(shortStats.count, 1)
  assert.equal(shortStats.underMin, 1, '整篇不足 100 无处可并，如实记欠账')

  const paragraphs = splitParagraphs('第一段。\n\n第二段。\n')
  assert.deepEqual(paragraphs, ['第一段。', '第二段。'])
  assert.deepEqual(splitSentences('甲。乙！丙？'), ['甲。', '乙！', '丙？'])

  const merged = segmentText(`${'甲'.repeat(60)}\n\n${'乙'.repeat(80)}`)
  assert.equal(merged.length, 1, '两段都短，合并后 140 字不超上限')
  assert.equal(merged[0].chars, 140)
})

test('别名 union-find：正反向互指；同一个词被两条条目声明时记冲突并合组', () => {
  const index = createAliasIndex([
    { name: '柯秒', aliases: ['秒子', '表匠'] },
    { name: '旧钟楼', aliases: ['钟楼'] }
  ])
  assert.equal(index.resolve('秒子'), '柯秒')
  assert.equal(index.resolve('表匠'), '柯秒')
  assert.equal(index.resolve('柯秒'), '柯秒')
  assert.deepEqual(index.aliasesOf('秒子'), ['柯秒', '秒子', '表匠'])
  assert.deepEqual(index.forward().get('钟楼'), '旧钟楼')
  assert.deepEqual(index.reverse().get('柯秒'), ['秒子', '表匠'])
  assert.equal(index.resolve('不存在'), null)

  const conflicting = createAliasIndex([
    { name: '柯秒', aliases: ['秒子'] },
    { name: '旧钟楼', aliases: ['秒子'] }
  ])
  assert.equal(conflicting.conflicts().length, 1)
  assert.deepEqual(conflicting.conflicts()[0].claimants, ['柯秒', '旧钟楼'])
  assert.equal(conflicting.resolve('秒子'), '柯秒', '合组后规范名取先登记者')
  assert.equal(conflicting.resolve('旧钟楼'), '柯秒', '双向互指：原规范名也能解析到合并后的规范名')

  const added = index.add('雾港', ['雾之港'])
  assert.equal(added.ok, true)
  assert.equal(index.resolve('雾之港'), '雾港')
  assert.equal(index.add('', ['x']).ok, false)
})

/* ---------- 静态边界：fact 域必须宿主无关 ---------- */

const factRoot = resolve(fileURLToPath(new URL('../fact/', import.meta.url)))
const repoNext = resolve(factRoot, '..')

async function walk(dir) {
  const out = []
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name)
    if (item.isDirectory()) out.push(...await walk(full))
    else if (/\.(m?js)$/u.test(item.name)) out.push(full)
  }
  return out
}

const FROM_SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]/gu
const BARE_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gmu
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu

function* specifiersOf(source) {
  for (const pattern of [FROM_SPECIFIER, BARE_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of source.matchAll(pattern)) yield match[1]
  }
}

test('静态边界：next/fact 只 import 域内相对路径，不碰 node 内置与宿主模块', async () => {
  const files = await walk(factRoot)
  assert.ok(files.length >= 10, '域文件应被扫到')

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const shown = relative(repoNext, file)
    for (const specifier of specifiersOf(source)) {
      assert.ok(specifier.startsWith('.'), `${shown} 出现非相对 import：${specifier}`)
      const target = resolve(dirname(file), specifier)
      const inside = relative(factRoot, target)
      assert.ok(inside && !inside.startsWith('..'), `${shown} 越界 import：${specifier}`)
    }
    assert.doesNotMatch(source, /\brequire\s*\(/u, `${shown} 不得用 require`)
    assert.doesNotMatch(source, /\bnode:/u, `${shown} 不得引用 node 内置`)
    assert.doesNotMatch(source, /\bprocess\./u, `${shown} 不得读 process`)
    assert.doesNotMatch(source, /\bBuffer\b/u, `${shown} 不得用 Buffer`)
    assert.doesNotMatch(source, /__dirname|__filename/u, `${shown} 不得用 CommonJS 注入变量`)
  }
})

test('静态边界：wikihub 不残留域实现（旧入口只剩转发薄壳，内部 import 指向 fact）', async () => {
  const wikihubRoot = resolve(repoNext, 'wikihub')
  const shim = await readFile(join(wikihubRoot, 'pediaSchema.mjs'), 'utf8')
  assert.match(shim, /export \* from '\.\.\/fact\/domain\/pediaSchema\.js'/u)
  assert.doesNotMatch(shim, /export (const|function) (FACT_SCHEMA|validateFactEntry|sha1Hex)/u, '薄壳不得再定义实现')
  const segmentShim = await readFile(join(wikihubRoot, 'segment.mjs'), 'utf8')
  assert.match(segmentShim, /export \* from '\.\.\/fact\/domain\/segment\.js'/u)

  const files = await walk(wikihubRoot)
  for (const file of files) {
    if (file.endsWith('pediaSchema.mjs') || file.endsWith('segment.mjs')) continue
    const source = await readFile(file, 'utf8')
    const shown = relative(repoNext, file)
    assert.doesNotMatch(source, /export (function|const) (validateFactEntry|stableEntryId|sha1Hex|segmentText|WORLDVIEW_SLOTS)\b/u, `${shown} 仍在定义域实现`)
  }

  for (const name of ['convert.mjs', 'migrate.mjs', 'build.mjs', 'render.mjs', 'viewModel.mjs']) {
    const source = await readFile(join(wikihubRoot, name), 'utf8')
    assert.match(source, /from '\.\.\/fact\/domain\//u, `${name} 应直接从 next/fact 导入`)
  }
  const pack = await readFile(join(wikihubRoot, 'packs', 'novel-style.mjs'), 'utf8')
  assert.match(pack, /from '\.\.\/\.\.\/fact\/domain\//u, '能力包也直接吃 fact 域')
})
