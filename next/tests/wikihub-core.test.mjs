import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { parseWorldbookEntryFile } from '@pinax/core/domain/worldbookFileContract'
import {
  CATEGORY_MAP,
  PEDIA_SCHEMA,
  sha1Hex,
  slotForCategory,
  stableEntryId,
  validatePediaEntry
} from '../wikihub/pediaSchema.mjs'
import {
  NOVEL_STRUCTURE_LOSSES,
  PEDIA_EXPORT_LOSSES,
  SCRIPT_STRUCTURE_LOSSES,
  hubToNovelRefs,
  hubToScriptSkeleton,
  hubToWorldbook,
  novelToHubAnchors,
  refsToRelations,
  relationsToRefs,
  scriptToHubAnchors,
  worldbookToHub
} from '../wikihub/convert.mjs'

/**
 * W1 数据层的对照测试：不落盘、不接工具面，只钉住三件事——
 *   1) 世界书 → hub → 世界书 无损（worldview 硬层铁保证），且经得起「再序列化再解析」；
 *   2) 小说/剧本 → plot/character 只做结构映射，软层损失按清单如实标注（不假装无损）；
 *   3) @《…》 token ↔ hub relations 互逆。
 * 期望值全部来自 pedia/v1 的原文口径（category_map、稳定 id、信封必填），不另立标准。
 */

const sha1 = (text) => createHash('sha1').update(text, 'utf8').digest('hex')

function contractEntry(md) {
  const parsed = parseWorldbookEntryFile(md)
  assert.equal(parsed.ok, true, JSON.stringify(parsed.error ?? {}))
  return parsed.entry
}

function worldbookFile(md) {
  return contractEntry(md)
}

const KEMIAO_MD = [
  '---',
  'schemaVersion: 1',
  'id: k-001',
  'title: 柯秒',
  'name: 柯秒',
  'kind: character',
  'status: active',
  'version: 1.2.0',
  'tags: [主角, 停摆的表]',
  'links: []',
  'cat: [角色]',
  'keys: [秒子, 表匠]',
  'keysSecondary: [小柯]',
  'summary: 修表匠，袖口的表停在十二点差三分。',
  'sourceRefs: [大纲/人物.md]',
  'updatedAt: 2026-11-01',
  'relations:',
  '  - to: k-002',
  '    type: ally',
  '    stance: 信任',
  '    covert: true',
  '    weight: 3',
  'injection:',
  '  mode: always',
  '  priority: 9',
  'profile:',
  '  avatar: a.png',
  'extraUnknown: kept',
  'extraNested:',
  '  a: 1',
  '---',
  '柯秒是城南的修表匠。',
  '',
  '他的袖口总有一块停摆的表。',
  ''
].join('\n')

const TOWER_MD = [
  '---',
  'schemaVersion: 1',
  'id: k-002',
  'title: 旧钟楼',
  'name: 旧钟楼',
  'kind: location',
  'status: active',
  'version: 3',
  'tags: [场景]',
  'cat: [地点]',
  'keys: [钟楼]',
  'summary: 停在十二点差三分的钟楼。',
  'relations: []',
  '---',
  '旧钟楼在城南尽头。',
  ''
].join('\n')

/** 契约字段投影：只比 worldbook 文件真正承载的字段，运行时附加字段（path/revision）不参与。 */
function worldbookProjection(entry) {
  return {
    id: entry.id,
    name: entry.name,
    title: entry.title,
    kind: entry.kind,
    type: entry.type,
    status: entry.status,
    version: entry.version,
    tags: entry.tags,
    links: entry.links,
    cat: entry.cat,
    keys: entry.keys,
    keysSecondary: entry.keysSecondary,
    summary: entry.summary,
    sourceRefs: entry.sourceRefs,
    updatedAt: entry.updatedAt,
    relations: entry.relations,
    injection: entry.injection,
    profile: entry.profile,
    extra: entry.extra,
    content: entry.content
  }
}

function withRuntimeFields(entry, overrides = {}) {
  return { ...entry, path: `世界书/${entry.name}.md`, revision: 2, contract: true, ...overrides }
}

test('sha1 与 node:crypto 同值；稳定 id = sha1(layer|domain|slot|name)[:12]', () => {
  for (const sample of ['', 'abc', 'pedia/v1', '世界观|钟楼|roles|柯秒']) {
    assert.equal(sha1Hex(sample), sha1(sample), `sha1(${JSON.stringify(sample)})`)
  }
  const args = { layer: 'worldview', domain: '修真', slot: 'power_levels', name: '境界一' }
  assert.equal(stableEntryId(args), sha1('worldview|修真|power_levels|境界一').slice(0, 12))
  assert.match(stableEntryId({ layer: 'character', domain: '某书', name: '柯秒' }), /^[0-9a-f]{12}$/u)
})

test('pedia/v1 校验：必填、槽位、稳定 id 漂移都拦；有序槽位缺 rank 只警告', () => {
  const id = stableEntryId({ layer: 'worldview', domain: '停摆之城', slot: 'locations', name: '旧钟楼' })
  const base = {
    schema: PEDIA_SCHEMA,
    id,
    layer: 'worldview',
    name: '旧钟楼',
    domain: '停摆之城',
    slot: 'locations',
    definition: '城南的钟楼。',
    provenance: { book: '停摆之城', book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1', confidence: 1 }
  }
  assert.equal(validatePediaEntry(base).ok, true)

  const missing = validatePediaEntry({ ...base, definition: '' })
  assert.equal(missing.ok, false)
  assert.ok(missing.errors.some((error) => error.code === 'MISSING_REQUIRED' && error.field === 'definition'))

  const unknownSlot = validatePediaEntry({ ...base, slot: 'weird' })
  assert.ok(unknownSlot.errors.some((error) => error.code === 'UNKNOWN_SLOT'))

  const drift = validatePediaEntry({ ...base, id: '000000000000' })
  assert.ok(drift.errors.some((error) => error.code === 'ID_MISMATCH'))

  const powerId = stableEntryId({ layer: 'worldview', domain: '停摆之城', slot: 'power_levels', name: '钟表境' })
  const ordered = validatePediaEntry({ ...base, id: powerId, slot: 'power_levels', name: '钟表境' })
  assert.equal(ordered.ok, true)
  assert.ok(ordered.warnings.some((warning) => warning.code === 'ORDERED_SLOT_WITHOUT_RANK'))
})

test('category_map 归并抽查：34 种分类收敛到 11 个标准槽位', () => {
  assert.equal(slotForCategory('角色'), 'roles')
  assert.equal(slotForCategory('境界'), 'power_levels')
  assert.equal(slotForCategory('势力'), 'orgs')
  assert.equal(slotForCategory('编年'), 'other', '「编年」不在 category_map 里（Next 的目录名要经桥接表）')
  assert.equal(slotForCategory('事件'), 'events')
  assert.equal(slotForCategory('未知分类'), 'other')
  assert.equal(slotForCategory(''), 'other')
  assert.deepEqual(Object.keys(CATEGORY_MAP).length > 30, true)
})

test('世界书 → hub → 世界书无损：契约字段逐项相等，且经得起再序列化再解析', () => {
  const original = worldbookFile(KEMIAO_MD)
  const input = withRuntimeFields(original, { path: '人物/人物·柯秒.md' })

  const hub = worldbookToHub([input], { book: '停摆之城' })
  assert.equal(hub.ok, true)
  assert.equal(hub.valid, true, JSON.stringify(hub.issues))
  assert.deepEqual(hub.losses, [], '契约条目转 hub 不应有信息损失')
  assert.equal(hub.entries.length, 1)

  const entry = hub.entries[0]
  assert.equal(entry.schema, PEDIA_SCHEMA)
  assert.equal(entry.layer, 'worldview')
  assert.equal(entry.name, '柯秒')
  assert.equal(entry.domain, '停摆之城')
  assert.equal(entry.id, stableEntryId({ layer: 'worldview', domain: '停摆之城', slot: 'roles', name: '柯秒' }))
  assert.equal(entry.definition, original.summary, 'definition 取作者写的 summary，不摘正文')
  assert.deepEqual(entry.aliases, ['秒子', '表匠'], 'frontmatter keys → aliases')

  const back = hubToWorldbook(entry)
  assert.equal(back.ok, true)
  assert.deepEqual(back.losses, [], '有 next.worldbook 快照时反向无损')
  assert.deepEqual(worldbookProjection(back.entry), worldbookProjection(original))

  const reparsed = parseWorldbookEntryFile(back.draft.fileText)
  assert.equal(reparsed.ok, true, JSON.stringify(reparsed.error ?? {}))
  assert.deepEqual(worldbookProjection(reparsed.entry), worldbookProjection(original), '序列化再解析后仍逐项相等')
  assert.equal(back.draft.path, '人物/人物·柯秒.md', '路径沿用快照里的真实路径')

  assert.deepEqual(
    PEDIA_EXPORT_LOSSES.map((item) => item.code),
    hub.exportLosses.map((item) => item.code),
    '纯 pedia 导出的剥离清单要随结果返回'
  )
})

test('世界书 → hub：槽位走 category_map／type／目录桥，关系 id→名称，rank 从 extra 取', () => {
  const kemiao = withRuntimeFields(worldbookFile(KEMIAO_MD), { path: '人物/人物·柯秒.md' })
  const tower = withRuntimeFields(worldbookFile(TOWER_MD), { path: '地理/地理·旧钟楼.md' })
  const generalInGeo = {
    id: 'k-003',
    name: '雾港',
    kind: 'general',
    type: 'general',
    cat: '地理',
    keys: [],
    summary: '常年起雾的港口。',
    relations: [],
    content: '雾港。',
    path: '地理/地理·雾港.md',
    revision: 1,
    contract: true
  }
  const realm = {
    id: 'k-004',
    name: '钟表境',
    kind: 'rule',
    type: 'rule',
    cat: ['境界'],
    keys: [],
    extra: { rank: 3 },
    summary: '时间之力。',
    relations: [],
    content: '钟表境。',
    path: '设定/设定·钟表境.md',
    revision: 1,
    contract: true
  }

  const hub = worldbookToHub([kemiao, tower, generalInGeo, realm], { book: '停摆之城' })
  assert.equal(hub.valid, true, JSON.stringify(hub.issues))
  const byName = Object.fromEntries(hub.entries.map((entry) => [entry.name, entry]))
  const via = Object.fromEntries(hub.mappings.map((item) => [item.name, item.via]))

  assert.equal(byName['柯秒'].slot, 'roles')
  assert.equal(via['柯秒'], 'cat:角色', 'frontmatter 分类优先（走 category_map）')
  assert.equal(byName['旧钟楼'].slot, 'locations')
  assert.equal(byName['雾港'].slot, 'locations', 'type=general 不吞掉目录信息')
  assert.equal(via['雾港'], 'dir:地理')
  assert.equal(byName['钟表境'].slot, 'power_levels')
  assert.equal(byName['钟表境'].rank, 3, 'ordered 槽位的 rank 从 extra.rank 读回')

  // 关系：目标 id → 目标名称；stance/covert/weight 合成 how，原始字段留在 next 里供反向还原。
  const relation = byName['柯秒'].relations[0]
  assert.equal(relation.to, '旧钟楼')
  assert.equal(relation.type, 'ally')
  assert.equal(relation.how, '信任 · 暗线 · 权重 3')
  assert.deepEqual(relation.next, { origin: 'relation', to_id: 'k-002', stance: '信任', covert: true, weight: 3 })

  // provenance 锚在条目文件路径上（Next 没有章/场景数字锚点：给空数组）。
  assert.deepEqual(byName['柯秒'].provenance.chapters, [])
  assert.deepEqual(byName['柯秒'].provenance.scenes, [])
  assert.equal(byName['柯秒'].provenance.source.kind, 'worldbook-entry')
  assert.equal(byName['柯秒'].provenance.source.path, '人物/人物·柯秒.md')
  assert.equal(byName['柯秒'].provenance.extractor, 'pinax-next/worldbook@1')
  assert.equal(hub.index.nameToId['柯秒'], byName['柯秒'].id)

  const stray = worldbookToHub([{ ...kemiao, relations: [{ to: 'k-999', type: 'rival' }] }])
  assert.ok(stray.warnings.some((warning) => warning.code === 'RELATION_TARGET_UNRESOLVED'))
  assert.equal(stray.entries[0].relations[0].to, 'k-999', '未知目标保留原值，不编一个名字')
})

test('世界书 → hub：裸 md 与运行时读回形状都接，缺 frontmatter 如实记损失', () => {
  const fromText = worldbookToHub(KEMIAO_MD, { book: '停摆之城' })
  assert.equal(fromText.ok, true)
  assert.equal(fromText.entries.length, 1)
  assert.equal(fromText.entries[0].name, '柯秒')

  const runtimeShape = {
    id: 'k-010',
    name: '雨中曲',
    type: 'style',
    keys: ['雨'],
    tags: [],
    summary: '',
    relations: [],
    cat: '',
    content: '一章都在下雨。',
    path: '设定/雨中曲.md',
    revision: 1,
    chars: 7,
    contract: true
  }
  const result = worldbookToHub([runtimeShape])
  assert.ok(result.losses.some((loss) => loss.code === 'worldbook-frontmatter-unavailable'))
  assert.ok(result.warnings.some((warning) => warning.code === 'TYPE_NOT_WORLDVIEW'), 'style 不是世界观设定，要警告')
  assert.equal(result.entries[0].slot, 'other')
  assert.equal(result.entries[0].definition, '一章都在下雨。', '没有 summary 时 definition 取正文首段并警告')
  assert.ok(result.warnings.some((warning) => warning.code === 'DEFINITION_EXCERPT'))

  const bad = worldbookToHub('这不是 frontmatter')
  assert.equal(bad.ok, false)
  assert.equal(bad.issues[0].code, 'WORLDBOOK_PARSE_FAILED')
})

test('hub → 世界书（没有 next 快照）：损失逐条标注，type/cat 由槽位反推，rank 存进 extra', () => {
  const hub = worldbookToHub([withRuntimeFields(worldbookFile(KEMIAO_MD)), withRuntimeFields(worldbookFile(TOWER_MD))], { book: '停摆之城' })
  const native = { ...hub.entries[0] }
  delete native.next
  native.definition = '修表匠。'
  native.relations = [{ to: '旧钟楼', type: 'ally', how: '信任 · 暗线 · 权重 3', next: { stance: '信任', covert: true, weight: 3 } }]

  const back = hubToWorldbook(native)
  assert.equal(back.ok, true)
  const codes = back.losses.map((loss) => loss.code)
  for (const code of ['content-from-definition', 'worldbook-type-inferred', 'stats-dropped']) {
    assert.ok(codes.includes(code), `损失清单应含 ${code}`)
  }
  assert.equal(back.entry.type, 'character', 'roles 槽位反推 character')
  assert.deepEqual(back.entry.cat, ['人物'])
  assert.deepEqual(back.entry.keys, ['秒子', '表匠'], 'aliases → keys')
  assert.equal(back.entry.content, '修表匠。')
  assert.deepEqual(back.entry.relations, [{ to: '旧钟楼', type: 'ally', stance: '信任', covert: true, weight: 3 }])
  assert.equal(back.draft.path, '人物/人物·柯秒.md')
  assert.match(back.draft.fileText, /^---\n/u)

  const ordered = {
    schema: PEDIA_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain: '停摆之城', slot: 'power_levels', name: '钟表境' }),
    layer: 'worldview',
    name: '钟表境',
    domain: '停摆之城',
    slot: 'power_levels',
    rank: 3,
    definition: '时间之力。',
    provenance: { book: '停摆之城', chapters: [], scenes: [], extractor: 'test/1' }
  }
  const orderedBack = hubToWorldbook(ordered)
  assert.equal(orderedBack.entry.extra.rank, 3, 'rank 存进 extra，下一次 worldbookToHub 能读回')
  const again = worldbookToHub([{ ...orderedBack.entry, contract: true }], { book: '停摆之城' })
  assert.equal(again.entries[0].rank, 3, 'hub → 世界书 → hub 保住 rank')

  const wrongLayer = hubToWorldbook({ ...native, layer: 'character' })
  assert.equal(wrongLayer.ok, false)
  assert.equal(wrongLayer.error.code, 'WRONG_LAYER')
})

test('stripContent：正文剥离并记账，反向用调用方正文重建', () => {
  const hub = worldbookToHub([withRuntimeFields(worldbookFile(KEMIAO_MD))], { book: '停摆之城', stripContent: true })
  assert.equal(hub.entries[0].next.worldbook.content, null)
  assert.ok(hub.losses.some((loss) => loss.code === 'entry-content-stripped'))

  const back = hubToWorldbook(hub.entries[0], { content: '重新给的正文。' })
  assert.equal(back.entry.content, '重新给的正文。')
  assert.ok(back.losses.some((loss) => loss.code === 'entry-content-unavailable'))
})

test('小说章结构 → plot/character 锚点：结构序、span、@ 引用与出现锚定都可校验', () => {
  const chapters = [
    { index: 0, title: '雨夜的钟', file: '正文/第001章-雨夜的钟.md', revision: 2, text: '柯秒在雨里走。@《旧钟楼》他抬头。' },
    { index: 1, title: '表针', file: '正文/第二卷/第002章-表针.md', volume: '第二卷', revision: 0, text: '旧钟楼的门开着。柯秒进去了。' }
  ]
  const result = novelToHubAnchors({ bookName: '停摆之城', chapters, characters: [{ name: '柯秒', aliases: ['秒子'], entryId: 'k-001' }, { name: '旧钟楼' }] })

  assert.equal(result.ok, true)
  assert.equal(result.valid, true, JSON.stringify(result.issues))
  assert.deepEqual(result.plotEntry.events.map((event) => event.index), [1, 2], '章号 = 列表序 + 1')
  assert.deepEqual(result.plotEntry.events[0].refs, ['旧钟楼'])
  assert.deepEqual(result.plotEntry.events[1].anchor.group, '第二卷')
  assert.deepEqual(result.plotEntry.span, { first_chapter: 1, last_chapter: 2, first_scene: null, last_scene: null, scene_count: 2, chapter_count: 2 })
  assert.deepEqual(result.refIndex, { 旧钟楼: [1] })

  const kemiao = result.characterEntries.find((entry) => entry.name === '柯秒')
  assert.deepEqual(kemiao.provenance.chapters, [1, 2], '按名字/别名做出现锚定（结构化匹配）')
  assert.equal(kemiao.fingerprint.vec, null)
  assert.equal(kemiao.fingerprint.metrics.appearance_count, 2)

  assert.deepEqual(result.losses.map((loss) => loss.code), NOVEL_STRUCTURE_LOSSES.map((loss) => loss.code), '软层损失按清单如实标注')
})

test('剧本集结构 → plot/character 锚点：剧集即场次（span 用 scenes）', () => {
  const scripts = [
    { index: 0, title: '第一幕 雨夜', file: '剧本/第一幕 雨夜.md', revision: 1, text: '【雨夜】柯秒登场。@《旧钟楼》' },
    { index: 1, title: '第二幕 停摆', file: '剧本/第二幕 停摆.md', revision: 0, text: '柯秒修表。' }
  ]
  const result = scriptToHubAnchors({ book: '表匠', scripts, characters: [{ name: '柯秒' }] })

  assert.equal(result.valid, true, JSON.stringify(result.issues))
  assert.deepEqual(result.plotEntry.span, { first_chapter: null, last_chapter: null, first_scene: 1, last_scene: 2, scene_count: 2, chapter_count: null })
  assert.deepEqual(result.plotEntry.events[0].refs, ['旧钟楼'])
  assert.deepEqual(result.characterEntries[0].provenance.scenes, [1, 2])
  assert.deepEqual(result.losses.map((loss) => loss.code), SCRIPT_STRUCTURE_LOSSES.map((loss) => loss.code))
})

test('反向骨架：hub plot 事件 → 小说章纲／剧本分集与 @《…》引用行', () => {
  const novel = novelToHubAnchors({
    bookName: '停摆之城',
    chapters: [
      { index: 0, title: '雨夜的钟', file: '正文/第001章-雨夜的钟.md', text: '@《旧钟楼》 @《柯秒》' },
      { index: 1, title: '表针', file: '正文/第002章-表针.md', text: '没有引用。' }
    ]
  })
  const refs = hubToNovelRefs({ plot: novel.plotEntry })
  assert.equal(refs.chapters.length, 2)
  assert.equal(refs.chapters[0].refLine, '@《旧钟楼》 @《柯秒》')
  assert.match(refs.chapters[0].skeleton, /^## 第1章 雨夜的钟/u)
  assert.match(refs.chapters[0].skeleton, /@《旧钟楼》 @《柯秒》/u)
  assert.ok(refs.losses.some((loss) => loss.code === 'chapter-body'))
  assert.ok(refs.warnings.some((warning) => warning.code === 'CHAPTERS_WITHOUT_REFS'))

  const script = scriptToHubAnchors({
    book: '表匠',
    scripts: [{ index: 0, title: '第一幕 雨夜', file: '剧本/第一幕 雨夜.md', text: '@《旧钟楼》' }]
  })
  const skeleton = hubToScriptSkeleton(script.plotEntry)
  assert.equal(skeleton.episodes[0].refLine, '@《旧钟楼》')
  assert.match(skeleton.episodes[0].skeleton, /^# 第1集 第一幕 雨夜/u)
  assert.match(skeleton.episodes[0].skeleton, /【参考】@《旧钟楼》/u)
  assert.ok(skeleton.losses.some((loss) => loss.code === 'script-body'))
})

test('@《…》 token ↔ hub relations 互逆：去重、空目标与不可表示标题如实跳过', () => {
  const back = refsToRelations('@《旧钟楼》 和 @《柯秒》 还有 @《旧钟楼》')
  assert.deepEqual(back.relations.map((relation) => relation.to), ['旧钟楼', '柯秒'])
  assert.deepEqual(back.relations[0], {
    to: '旧钟楼',
    type: 'reference',
    how: '@《旧钟楼》',
    next: { origin: 'ref-token', token: '@《旧钟楼》' }
  })

  const forward = relationsToRefs(back.relations)
  assert.equal(forward.text, '@《旧钟楼》 @《柯秒》')
  assert.equal(forward.refs.length, 2)

  const limited = relationsToRefs(back.relations, { limit: 1 })
  assert.equal(limited.refs.length, 1)

  const skipped = relationsToRefs([{ to: '' }, { to: '带》括号' }])
  assert.deepEqual(skipped.skipped.map((item) => item.reason), ['empty-target', 'unrepresentable-title'])
  assert.equal(skipped.text, '')
})
