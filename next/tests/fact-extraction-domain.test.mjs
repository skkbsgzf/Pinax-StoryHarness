import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  EXTRACTION_CHAIN_VERSION,
  EXTRACTION_ROW_SCHEMA,
  buildExtractionSource,
  validateExtractionRows,
  compileExtractionEntries
} from '../fact/index.js'
import { segmentText } from '../fact/domain/segment.js'
import { stableEntryId, sha1Hex } from '../fact/domain/stableId.js'
import { validateFactEntry } from '../fact/domain/schema.js'
import { FACT_SCHEMA, WORLDVIEW_SLOT_NAMES } from '../fact/domain/vocabulary.js'

const CONTEXT = { domain: '停摆之城', book: '离线合成书', bookId: 'book-offline' }
const hash = (text) => createHash('sha1').update(text, 'utf8').digest('hex')
const source = (id = '正文/001.txt', chapterNo = 1, text = '甲'.repeat(620)) => buildExtractionSource({ id, chapterNo, text })
const character = (overrides = {}) => ({
  name: '柯秒', aliases: ['小柯'], identity: '修钟人', traits: ['谨慎'],
  speech: ['请等一等。'], behavior: ['检查钟摆'], ...overrides
})
const setting = (overrides = {}) => ({
  name: '旧钟楼', slot: 'locations', definition: '城中的报时设施。', aliases: ['钟楼'], ...overrides
})
const row = (segment, overrides = {}) => ({
  segmentId: segment.id,
  who: [], when: { story_time: '', timeline: '未明示' }, where: '',
  events: [], notes: '', characters: [], settings: [], ...overrides
})
const compile = (sources, rows, context = CONTEXT) => compileExtractionEntries({ sources, rows, ...context })

function assertEntries(entries) {
  for (const entry of entries) {
    const validation = validateFactEntry(entry)
    assert.equal(validation.ok, true, JSON.stringify(validation.errors))
    assert.equal(entry.id, stableEntryId({ layer: entry.layer, domain: entry.domain, slot: entry.slot ?? '', name: entry.name }))
    assert.equal(entry.provenance.mode, 'analyze')
    assert.equal(entry.provenance.extractor, EXTRACTION_CHAIN_VERSION)
    assert.match(entry.provenance.quote_hash, /^[0-9a-f]{40}$/u)
    assert.ok(entry.sources.length > 0)
    for (const ref of entry.sources) {
      assert.deepEqual(Object.keys(ref).sort(), ['quote_hash', 'segmentId', 'sourceId'])
      assert.match(ref.quote_hash, /^[0-9a-f]{40}$/u)
    }
  }
  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(key, 'quote', 'analyze 结果不得包含 quote')
      walk(child)
    }
  }
  walk(entries)
}

function assertInvalid(rows, segments, field) {
  const result = validateExtractionRows(rows, segments)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'INVALID_EXTRACTION')
  assert.ok(result.error.message)
  assert.ok(result.error.details.length)
  if (field) assert.ok(result.error.details.some((detail) => detail.field.includes(field)), JSON.stringify(result.error.details))
}

test('公开 API 与 rows.items schema：所有对象严格、全部行字段必填、没有长度/条数上限', () => {
  assert.equal(EXTRACTION_CHAIN_VERSION, 'fact-chain/v1')
  assert.deepEqual(EXTRACTION_ROW_SCHEMA.required, ['segmentId', 'who', 'when', 'where', 'events', 'notes', 'characters', 'settings'])
  assert.deepEqual(EXTRACTION_ROW_SCHEMA.properties.settings.items.properties.slot.enum, WORLDVIEW_SLOT_NAMES)
  const walk = (schema) => {
    assert.equal(Object.isFrozen(schema), true)
    if (schema.type === 'object') assert.equal(schema.additionalProperties, false)
    assert.equal(schema.maxLength, undefined)
    assert.equal(schema.maxItems, undefined)
    for (const child of Object.values(schema)) if (child && typeof child === 'object') walk(child)
  }
  walk(EXTRACTION_ROW_SCHEMA)
})

test('保留默认 100–300 字分段：边界、短篇、多段均与 segmentText 完全一致', () => {
  for (const size of [1, 99, 100, 299, 300, 301, 620, 2000]) {
    const text = '字'.repeat(size)
    const built = source(`正文/长度${size}.txt`, 7, text)
    const original = segmentText(text)
    assert.equal(built.segments.length, original.length)
    if (size >= 100) assert.ok(built.segments.every((segment) => segment.chars >= 100 && segment.chars <= 300))
    assert.deepEqual(built.segments.map(({ index, chars }) => ({ index, chars })), original.map(({ index, chars }) => ({ index, chars })))
    for (let index = 0; index < original.length; index += 1) {
      assert.equal(built.segments[index].hash, hash(original[index].text))
      assert.equal(built.segments[index].id, `${hash(built.id).slice(0, 10)}:${index + 1}:${hash(original[index].text).slice(0, 8)}`)
    }
  }
  assert.ok(source().segments.length > 1)
})

test('sourceHash 对精确原文计算，段 hash 对默认分段原文计算；元数据不包含原文', () => {
  const text = `  ${'𠀀é'.repeat(75)}。\r\n\r\n${'另一段'.repeat(60)}。 \n`
  const built = source('卷一/𠀀.txt', 19, text)
  assert.equal(built.hash, hash(text))
  assert.equal(built.hash, sha1Hex(text))
  assert.notEqual(built.hash, hash(text.trim()))
  assert.deepEqual(Object.keys(built).sort(), ['chapterNo', 'hash', 'id', 'segments'])
  for (const segment of built.segments) assert.deepEqual(Object.keys(segment).sort(), ['chars', 'hash', 'id', 'index'])
  assert.equal(JSON.stringify(built).includes('另一段'), false)
  assert.deepEqual(built, source('卷一/𠀀.txt', 19, text))
  assert.notEqual(built.hash, source('卷一/𠀀.txt', 19, `${text}改`).hash)
})

test('来源拒绝空文本/空 ID/非正整章节，不强转类型', () => {
  const valid = { id: 'chapter.txt', text: '内容', chapterNo: 1 }
  for (const input of [
    null, {}, { ...valid, id: '' }, { ...valid, id: ' \t' }, { ...valid, id: 12 },
    { ...valid, text: '' }, { ...valid, text: '\n\t' }, { ...valid, text: 23 },
    ...[0, -1, 1.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((chapterNo) => ({ ...valid, chapterNo }))
  ]) assert.throws(() => buildExtractionSource(input), { code: 'INVALID_INPUT' })
})

test('三层同时编译：真实章号、稳定 ID、正确生命周期、逐条真实 schema 全合法', () => {
  const built = source('卷二/旁章.txt', 23)
  const rows = built.segments.map((segment) => row(segment, {
    who: ['柯秒'], when: { story_time: '夜半', timeline: '倒叙' }, where: '旧钟楼',
    events: [{ who: '柯秒', channel: 'perceive', content: '发现指针倒行。' }], notes: '钟楼停摆。',
    characters: [character({ castRole: { tier: 'supporting', goal: '修好钟', plotFunction: '发现异常' } })],
    settings: [setting()]
  }))
  const { entries } = compile([built], rows)
  assertEntries(entries)
  assert.equal(entries.filter((entry) => entry.layer === 'plot').length, built.segments.length)
  assert.equal(entries.filter((entry) => entry.layer === 'character').length, 1)
  assert.equal(entries.filter((entry) => entry.layer === 'worldview').length, 1)
  for (const entry of entries) {
    assert.equal(entry.status, entry.layer === 'plot' ? 'draft' : 'proposed')
    assert.deepEqual(entry.provenance.chapters, [23])
    assert.equal(entry.provenance.book, CONTEXT.book)
    assert.equal(entry.provenance.book_id, CONTEXT.bookId)
    for (const ref of entry.sources) assert.equal(ref.quote_hash, built.segments.find((segment) => segment.id === ref.segmentId).hash)
  }
  const plot = entries[0]
  assert.equal(plot.name.includes(built.id), true)
  assert.deepEqual(plot.when, rows[0].when)
  assert.equal(plot.where, rows[0].where)
  assert.equal(plot.provenance.quote_hash, built.segments[0].hash)
  assert.equal(entries.find((entry) => entry.layer === 'character').anchors.speech[0], '请等一等。')
})

test('超过 12 条 events、不同行为渠道、长 notes/定义/锚点/别名均不丢失', () => {
  const built = source()
  const channels = ['do', 'say', 'think', 'feel', 'perceive', 'state', 'event']
  const events = Array.from({ length: 35 }, (_, index) => ({ who: '柯秒', channel: channels[index % channels.length], content: `${index}：${'完整信息'.repeat(120)}` }))
  const notes = '完整注记'.repeat(500)
  const aliases = Array.from({ length: 25 }, (_, index) => `称呼${index}`)
  const speech = Array.from({ length: 30 }, (_, index) => `言语${index}：${'长内容'.repeat(100)}`)
  const definition = '完整定义'.repeat(500)
  const rows = [row(built.segments[0], { events, notes, characters: [character({ aliases, speech })], settings: [setting({ definition })] })]
  const before = structuredClone({ built, rows })
  const { entries } = compile([built], rows)
  assertEntries(entries)
  const plot = entries.find((entry) => entry.layer === 'plot')
  assert.equal(plot.events.length, 35)
  assert.deepEqual(plot.events.map(({ who, channel, content }) => ({ who, channel, content })), events)
  assert.equal(plot.notes, notes)
  assert.ok(plot.fact.includes(notes))
  for (const event of events) assert.ok(plot.fact.includes(event.content))
  assert.deepEqual(entries.find((entry) => entry.layer === 'character').aliases, aliases)
  assert.deepEqual(entries.find((entry) => entry.layer === 'character').anchors.speech, speech)
  assert.equal(entries.find((entry) => entry.layer === 'worldview').definition, definition)
  assert.deepEqual({ built, rows }, before, '不突变调用方数据')
})

test('部分提交、空明确事实和全空提交均合法，不凭空制造事实', () => {
  const built = source()
  const rows = [row(built.segments[1])]
  const validated = validateExtractionRows(rows, built.segments)
  assert.equal(validated.ok, true)
  assert.deepEqual(validated.value, rows)
  assert.notEqual(validated.value[0].when, rows[0].when, '规范化结果是独立 JSON 数据')
  const { entries } = compile([built], rows)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].fact, '')
  assert.deepEqual(entries[0].events, [])
  assert.deepEqual(entries[0].sources.map((ref) => ref.segmentId), [built.segments[1].id])
  assertEntries(entries)
  assert.deepEqual(compile([built], []).entries, [])
  assert.deepEqual(compile([built], []).warnings, [])
  assert.deepEqual(compile([], []).entries, [])
  assert.deepEqual(compile([], []).warnings, [])
  assertEntries(compile([source('短篇', 2, '一字。')], [row(source('短篇', 2, '一字。').segments[0])]).entries)
})

test('重复/未知段、行内重复人物及 slot+name 拒绝；同名不同 slot 不误拒', () => {
  const built = source()
  const first = row(built.segments[0])
  assertInvalid([first, first], built.segments, 'segmentId')
  assertInvalid([{ ...first, segmentId: 'unknown' }], built.segments, 'segmentId')
  assertInvalid([first], [built.segments[0], built.segments[0]], 'segments')
  assertInvalid([{ ...first, characters: [character(), character()] }], built.segments, 'characters')
  assertInvalid([{ ...first, settings: [setting(), setting()] }], built.segments, 'settings')
  assert.equal(validateExtractionRows([{ ...first, settings: [setting(), setting({ slot: 'orgs' })] }], built.segments).ok, true)
})

test('全部字段必填且类型/枚举严格；嵌套数组不会静默筛掉坏项', () => {
  const built = source()
  const valid = row(built.segments[0], {
    events: [{ who: '', channel: 'event', content: '城门关闭。' }], characters: [character()], settings: [setting()]
  })
  const inspectObject = (targetOf, path, requiredKeys = null) => {
    // requiredKeys 给定时只检这些键：settings[].constraints 是可选补强字段（给了 gate 才能机判，
    // 不给不算失败），不该被「行里出现即必填」的老口径要求必填。其余对象仍按全键必填检。
    const keys = requiredKeys ?? Object.keys(targetOf(valid))
    for (const key of keys) {
      const missing = structuredClone(valid)
      delete targetOf(missing)[key]
      assertInvalid([missing], built.segments, `${path}${key}`)
      const wrong = structuredClone(valid)
      targetOf(wrong)[key] = null
      assertInvalid([wrong], built.segments, `${path}${key}`)
    }
  }
  inspectObject((value) => value, '')
  inspectObject((value) => value.when, 'when.')
  inspectObject((value) => value.events[0], 'events[0].')
  inspectObject((value) => value.characters[0], 'characters[0].')
  inspectObject((value) => value.settings[0], 'settings[0].', ['name', 'slot', 'definition'])
  for (const mutate of [
    (value) => { value.when.timeline = '过去' },
    (value) => { value.events[0].channel = 'see' },
    (value) => { value.events[0].content = ' \t' },
    (value) => { value.settings[0].slot = 'constructor' },
    (value) => { value.settings[0].name = '' },
    (value) => { value.settings[0].definition = '  ' },
    (value) => { value.characters[0].name = '\n' },
    (value) => { value.who.push({ name: '柯秒' }) },
    ...['aliases', 'traits', 'speech', 'behavior'].map((key) => (value) => { value.characters[0][key].push(12) }),
    (value) => { value.settings[0].aliases.push(false) }
  ]) {
    const invalid = structuredClone(valid)
    mutate(invalid)
    assertInvalid([invalid], built.segments)
  }
  for (const invalid of [null, {}, '[]', [null], Array(1)]) assertInvalid(invalid, built.segments)
})

test('未知字段与模型提供的 id/status/provenance/quote/指纹在任何对象层一律拒绝', () => {
  const built = source()
  const valid = row(built.segments[0], {
    events: [{ who: '柯秒', channel: 'do', content: '推门' }],
    characters: [character({ castRole: { tier: 'protagonist' } })], settings: [setting()]
  })
  for (const targetOf of [(value) => value, (value) => value.when, (value) => value.events[0], (value) => value.characters[0], (value) => value.characters[0].castRole, (value) => value.settings[0]]) {
    for (const key of ['unknown', 'id', 'status', 'provenance', 'fingerprint', 'quote']) {
      const invalid = structuredClone(valid)
      targetOf(invalid)[key] = '模型无权填这个字段'
      assertInvalid([invalid], built.segments, key)
    }
  }
})

test('禁止 prototype 特殊键/原型/访问器/数组附加属性；普通 Unicode 名称值不受误伤', () => {
  const built = source()
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const invalid = row(built.segments[0])
    Object.defineProperty(invalid.when, key, { value: {}, enumerable: true })
    assertInvalid([invalid], built.segments, key)
    const invalidArray = [row(built.segments[0])]
    Object.defineProperty(invalidArray, key, { value: {}, enumerable: true })
    assertInvalid(invalidArray, built.segments, key)
  }
  const inherited = Object.assign(Object.create({ injected: true }), row(built.segments[0]))
  assertInvalid([inherited], built.segments)
  const getter = row(built.segments[0])
  Object.defineProperty(getter, 'notes', { enumerable: true, get() { return assert.fail('不得执行 getter') } })
  assertInvalid([getter], built.segments)
  for (const key of ['extra', '4294967295']) {
    const array = [row(built.segments[0])]
    array[key] = '不能被 JSON 静默丢弃'
    assertInvalid(array, built.segments)
  }
  const rows = [row(built.segments[0], { characters: [character({ name: '__proto__' })] })]
  assertEntries(compile([built], rows).entries)
})

test('castRole 按真实 analyze schema：protagonist 可缺目标，supporting/minor 缺/空/错类型拒绝', () => {
  const built = source()
  for (const castRole of [
    { tier: 'protagonist' }, { tier: 'protagonist', goal: '', plotFunction: '' },
    { tier: 'supporting', goal: '寻找出口', plotFunction: '带路' },
    { tier: 'minor', goal: '守门', plotFunction: '造成障碍' },
    { tier: 'supporting' }, { tier: 'minor', goal: '守门' },
    { tier: 'supporting', goal: '', plotFunction: '带路' },
    { tier: 'minor', goal: '守门', plotFunction: '\n ' },
    { tier: 'protagonist', goal: 5 }, { tier: 'villain' }, null
  ]) {
    const entry = { schema: FACT_SCHEMA, layer: 'character', name: '测试人物', status: 'proposed', provenance: { mode: 'analyze' }, fingerprint: { vec: null }, castRole }
    const expected = validateFactEntry(entry).ok
    const rows = [row(built.segments[0], { characters: [character({ castRole })] })]
    assert.equal(validateExtractionRows(rows, built.segments).ok, expected, JSON.stringify(castRole))
    if (expected) assertEntries(compile([built], rows).entries)
    else assert.throws(() => compile([built], rows), { code: 'INVALID_EXTRACTION' })
  }
})

test('跨来源精确同名合并，信息去重串联不覆盖，逐来源哈希和实际章号完整', () => {
  const a = source('甲.txt', 2)
  const b = source('乙.txt', 9)
  const rows = [
    row(a.segments[0], { characters: [character()], settings: [setting({ definition: '禁行' })] }),
    row(b.segments[0], {
      characters: [character({ identity: '守城人', aliases: ['小柯', '钟匠'], traits: ['谨慎', '果断'], speech: ['另一句'], behavior: ['检查钟摆', '敲门'] })],
      settings: [setting({ definition: '禁行，仅黎明开放。' })]
    }),
    row(b.segments[1], { characters: [character()], settings: [setting({ definition: '禁行' })] })
  ]
  const result = compile([b, a], rows)
  assertEntries(result.entries)
  const person = result.entries.find((entry) => entry.layer === 'character')
  assert.equal(result.entries.filter((entry) => entry.layer === 'character').length, 1)
  assert.equal(person.identity, '修钟人\n守城人')
  assert.deepEqual(person.aliases, ['小柯', '钟匠'])
  assert.deepEqual(person.traits, ['谨慎', '果断'])
  assert.deepEqual(person.anchors.behavior, ['检查钟摆', '敲门'])
  assert.deepEqual(person.anchors.speech, ['请等一等。', '另一句'])
  assert.deepEqual(person.provenance.chapters, [2, 9])
  assert.equal(person.sources.length, 3)
  assert.equal(person.provenance.quote_hash, hash(JSON.stringify(person.sources)))
  const world = result.entries.find((entry) => entry.layer === 'worldview')
  assert.deepEqual(world.definitions, ['禁行', '禁行，仅黎明开放。'])
  assert.equal(world.definition, '禁行\n禁行，仅黎明开放。')
  assert.ok(result.warnings.some((warning) => warning.code === 'DEFINITION_VARIANTS' && warning.entryId === world.id))
  assert.deepEqual(compile([a, b], [...rows].reverse()), result, '来源与提交顺序不影响确定性编译')
})

test('别名碰撞只告警：别名对别名、别名对正式名、跨槽位均不强制合并', () => {
  const built = source()
  const rows = [row(built.segments[0], {
    characters: [character({ name: '甲', aliases: ['乙', '同称'] }), character({ name: '乙', aliases: ['同称'] })],
    settings: [setting({ name: '组织甲', slot: 'orgs', aliases: ['同称'] }), setting({ name: '组织甲', slot: 'locations', aliases: ['同称'] })]
  })]
  const result = compile([built], rows)
  assertEntries(result.entries)
  assert.equal(result.entries.length, 5)
  const aliases = result.warnings.filter((warning) => warning.code === 'ALIAS_AMBIGUITY')
  assert.equal(aliases.find((warning) => warning.alias === '同称').entryIds.length, 4)
  assert.equal(aliases.find((warning) => warning.alias === '乙').entryIds.length, 2)
})

test('castRole 跨段同 tier 合并目标，不同 tier 全部带出处保留并告警，不伪造枚举', () => {
  const built = source()
  const rows = built.segments.map((segment, index) => row(segment, {
    characters: [character({ castRole: { tier: index === 2 ? 'minor' : 'supporting', goal: `目标${index}`, plotFunction: `作用${index}` } })]
  }))
  const same = compile([built], rows.slice(0, 2)).entries.find((entry) => entry.layer === 'character')
  assert.equal(same.castRole.goal, '目标0\n目标1')
  const result = compile([built], rows)
  assertEntries(result.entries)
  const person = result.entries.find((entry) => entry.layer === 'character')
  assert.equal(person.castRole, undefined)
  assert.equal(person.castRoles.length, 2)
  assert.equal(person.castRoles[0].goal, '目标0\n目标1')
  assert.equal(person.castRoles[1].goal, '目标2')
  assert.equal(person.castRoles[0].sources.length, 2)
  assert.ok(result.warnings.some((warning) => warning.code === 'CAST_ROLE_CONFLICT'))
})

test('所有 WORLDVIEW_SLOTS 均合法；power_levels 缺 rank 只告警，不从出现顺序猜等级', () => {
  const built = source()
  const rows = [row(built.segments[0], { settings: WORLDVIEW_SLOT_NAMES.map((slot) => setting({ slot, name: `设定-${slot}` })) })]
  const result = compile([built], rows)
  assertEntries(result.entries)
  assert.equal(result.entries.filter((entry) => entry.layer === 'worldview').length, WORLDVIEW_SLOT_NAMES.length)
  assert.ok(result.entries.every((entry) => !Object.hasOwn(entry, 'rank')))
  assert.ok(result.warnings.some((warning) => warning.code === 'ORDERED_SLOT_WITHOUT_RANK'))
})

test('同章多文件 plot 不碰撞；来源内容更新保持逻辑 plot ID，哈希更新', () => {
  const a = source('正文/上.txt', 4)
  const b = source('正文/下.txt', 4)
  const first = compile([a, b], [row(a.segments[0]), row(b.segments[0])])
  assert.equal(new Set(first.entries.map((entry) => entry.id)).size, 2)
  const changed = source('正文/上.txt', 4, '乙'.repeat(620))
  const next = compile([changed], [row(changed.segments[0])]).entries[0]
  const previous = first.entries.find((entry) => entry.sources[0].sourceId === a.id)
  assert.equal(previous.id, next.id)
  assert.notEqual(previous.provenance.quote_hash, next.provenance.quote_hash)
})

test('Unicode 码点、组合字符、长名称与字符串内容原样保留；精确名不擅自归一', () => {
  const text = '𠀀'.repeat(620)
  const built = source('正文/𠀀章.txt', 31, text)
  assert.equal(built.segments.reduce((sum, segment) => sum + segment.chars, 0), 620)
  const name = `𠀀${'长名'.repeat(80)}`
  const content = '  𠀀说：e\u0301 不等于 é 的编码。\n保留换行。  '
  const rows = [row(built.segments[0], {
    who: [name], events: [{ who: name, channel: 'say', content }], notes: content,
    characters: [character({ name }), character({ name: 'e\u0301' }), character({ name: 'é' })],
    settings: [setting({ name: `𠀀${name}`, definition: content })]
  })]
  const validation = validateExtractionRows(rows, built.segments)
  assert.equal(validation.ok, true)
  assert.deepEqual(validation.value, rows)
  const result = compile([built], rows)
  assertEntries(result.entries)
  assert.equal(result.entries.filter((entry) => entry.layer === 'character').length, 3)
  assert.equal(result.entries[0].events[0].content, content)
  assert.equal(result.entries.find((entry) => entry.name === name).name, name)
})

test('非法来源、伪造段标识和非法 fact 不返回伪成功；未知字段无法绕过 compile', () => {
  const built = source()
  const rows = [row(built.segments[0], { settings: [setting()] })]
  assert.throws(() => compile([built], rows, { ...CONTEXT, domain: '' }), (error) => {
    assert.equal(error.code, 'INVALID_EXTRACTION')
    assert.ok(error.details.some((detail) => detail.field === 'domain'))
    return true
  })
  assert.throws(() => compile([built, built], rows), { code: 'INVALID_INPUT' })
  const forged = structuredClone(built)
  forged.segments[0].hash = '0'.repeat(40)
  assert.throws(() => compile([forged], rows), { code: 'INVALID_INPUT' })
  const badHash = { ...built, hash: '原文不是 SHA1' }
  assert.throws(() => compile([badHash], rows), { code: 'INVALID_INPUT' })
  assert.throws(() => compile([built], [{ ...rows[0], quote: '原文' }]), { code: 'INVALID_EXTRACTION' })
  assert.throws(() => compile([built], rows, { ...CONTEXT, bookId: {} }), { code: 'INVALID_INPUT' })
})
