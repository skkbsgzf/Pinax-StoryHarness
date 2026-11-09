import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FACT_SCHEMA, stableEntryId } from '../fact/domain/pediaSchema.js'
import { buildFactPack } from '../fact/usecases/factPack.js'
import {
  NON_ENTRY_OUTPUTS,
  PRODUCE_STATUSES,
  SKILL_CONTRACT_VERSION,
  SkillContractError,
  assembleRequires,
  defineSkillContract,
  validateProduces,
  validateSkillContract
} from '../fact/usecases/skillContract.js'
import { SKILL_CONTRACTS } from '../skills/contracts.mjs'
import { DEFAULT_SKILLS_DIR, loadSkills } from '../skills/loadSkills.mjs'

/**
 * P3 编剧技能数据契约的合同测试（零网络、纯内存）：
 *   1) 五张卡逐项过 validateSkillContract，层／槽位／produces 白名单都在词表内；
 *   2) validateProduces：合法产出通过，越层／越槽／状态或 mode 不符／schema 不合规逐条拒；
 *   3) assembleRequires：按 requires 裁剪事实包，事件与角色该空的空、该留的留，原包不被改；
 *   4) 坏契约在装载时拒装并记账（SKILL_CONTRACT_INVALID／NAME_MISMATCH），随包五卡装载数不增不减。
 */

const DOMAIN = '契约之城'

function worldview({ name = '旧钟楼', slot = 'locations', status = 'proposed', mode = 'author', definition = '城南的钟楼。' } = {}) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'worldview', domain: DOMAIN, slot, name }),
    layer: 'worldview',
    name,
    domain: DOMAIN,
    slot,
    status,
    definition,
    provenance: { mode, book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' }
  }
}

function plot({ name = '停摆', status = 'draft', mode = 'author', events = [] } = {}) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain: DOMAIN, slot: '', name }),
    layer: 'plot',
    name,
    domain: DOMAIN,
    status,
    provenance: { mode, book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} },
    events
  }
}

function character({ name = '柯秒', status = 'proposed', mode = 'author' } = {}) {
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'character', domain: DOMAIN, slot: '', name }),
    layer: 'character',
    name,
    domain: DOMAIN,
    status,
    provenance: { mode, book: DOMAIN, book_id: 'abcd1234', chapters: [], scenes: [], extractor: 'test/1' },
    fingerprint: { vec: null, metrics: {} }
  }
}

const CONTRACT_NAMES = ['chapter-rewrite', 'continuity-check', 'outline-restructure', 'scene-expand', 'worldbook-refactor']

/* ───────────── 1. 五张卡逐项校验 ───────────── */

test('〔P3·五卡〕五份契约都合法，层／槽位／produces 白名单在 fact 词表内', () => {
  assert.deepEqual(Object.keys(SKILL_CONTRACTS).sort(), CONTRACT_NAMES.slice().sort())
  for (const name of CONTRACT_NAMES) {
    const contract = SKILL_CONTRACTS[name]
    assert.equal(contract.version, SKILL_CONTRACT_VERSION)
    assert.equal(contract.skill, name, '注册键必须与契约内 skill 名一致')
    const check = validateSkillContract(contract)
    assert.equal(check.ok, true, `${name}：${JSON.stringify(check.errors)}`)
    assert.equal(check.value.skill, name)
    assert.ok(contract.requires.layers.length > 0)
    assert.ok(contract.produces.length > 0)
    for (const item of contract.produces) {
      if (item.nonEntry !== undefined) {
        assert.equal(typeof item.nonEntry, 'string')
        assert.ok(item.output === null || NON_ENTRY_OUTPUTS.includes(item.output))
      } else {
        assert.ok(['worldview', 'character', 'plot'].includes(item.layer))
        assert.ok(PRODUCE_STATUSES.includes(item.asStatus))
      }
    }
  }
})

test('〔P3·五卡〕逐卡对表：requires 投影与 produces 产物类型按工单落位', () => {
  const chapter = SKILL_CONTRACTS['chapter-rewrite']
  assert.deepEqual(chapter.requires.layers.slice().sort(), ['character', 'plot'])
  assert.deepEqual({ ...chapter.requires.spans }, { current: true, before: 1, after: 1 })
  assert.equal(chapter.requires.knowledgeOf, 'cast')
  assert.deepEqual(chapter.produces.map((item) => [item.layer, item.asStatus, item.mode]), [
    ['plot', 'draft', 'author'],
    ['worldview', 'proposed', 'author']
  ])

  const continuity = SKILL_CONTRACTS['continuity-check']
  assert.deepEqual(continuity.requires.layers.slice().sort(), ['character', 'plot', 'worldview'])
  assert.equal(continuity.requires.knowledgeOf, 'cast')
  assert.deepEqual(continuity.produces.map((item) => [item.nonEntry, item.output]), [['violation-list', 'checklist']])

  const outline = SKILL_CONTRACTS['outline-restructure']
  assert.deepEqual(outline.requires.layers.slice(), ['plot'])
  assert.deepEqual(outline.produces.map((item) => item.nonEntry ?? item.layer), ['plot', 'relation-edges'])

  const scene = SKILL_CONTRACTS['scene-expand']
  assert.deepEqual(scene.requires.layers.slice().sort(), ['character', 'plot'])
  assert.deepEqual({ ...scene.requires.spans }, { current: true, before: 0, after: 0 })
  assert.deepEqual(scene.produces.map((item) => item.nonEntry ?? item.layer), ['scene-skeleton', 'plot'])

  const worldbook = SKILL_CONTRACTS['worldbook-refactor']
  assert.deepEqual(worldbook.requires.layers.slice(), ['worldview'])
  assert.equal(worldbook.requires.slots, null, '不写 slots＝不限槽位（全世界观投影）')
  assert.deepEqual(worldbook.produces.map((item) => [item.layer, item.asStatus, item.mode]), [['worldview', 'proposed', 'author']])
})

test('〔P3·契约格式〕非法契约在 define 时抛 SkillContractError，validate 只回 errors', () => {
  assert.throws(
    () => defineSkillContract({ skill: 'bad', requires: { layers: ['nowhere'] }, produces: [{ layer: 'plot', asStatus: 'draft' }] }),
    (error) => error instanceof SkillContractError && error.code === 'SKILL_CONTRACT_INVALID' && error.errors.length > 0
  )
  const checked = validateSkillContract({ skill: 'bad', requires: { layers: ['worldview'], slots: ['nowhere'] }, produces: [{ layer: 'plot', asStatus: 'draft' }] })
  assert.equal(checked.ok, false)
  assert.equal(checked.value, null)
  assert.ok(checked.errors.some((error) => error.code === 'CONTRACT_SLOT_UNKNOWN'))
  assert.ok(validateSkillContract({ requires: { layers: ['character'], slots: ['locations'] }, produces: [{ layer: 'plot', asStatus: 'draft' }] })
    .errors.some((error) => error.code === 'CONTRACT_SLOT_WITHOUT_WORLDVIEW'))
  assert.ok(validateSkillContract({ requires: { layers: ['plot'] }, produces: [{ layer: 'plot', asStatus: 'adopted' }] })
    .errors.some((error) => error.code === 'CONTRACT_PRODUCE_STATUS'))
  assert.ok(validateSkillContract({ requires: { layers: ['plot'] }, produces: [{ nonEntry: 'violation-list', output: 'prompt' }] })
    .errors.some((error) => error.code === 'CONTRACT_NON_ENTRY_OUTPUT'))
})

/* ───────────── 2. validateProduces：好／坏产出 ───────────── */

test('〔P3·产出〕chapter-rewrite 的 plot 草稿＋worldview 提案都通过', () => {
  const contract = SKILL_CONTRACTS['chapter-rewrite']
  const result = validateProduces(contract, [
    plot({ status: 'draft', mode: 'author' }),
    worldview({ name: '铜钥匙', slot: 'items', status: 'proposed', mode: 'author' })
  ])
  assert.equal(result.ok, true, JSON.stringify(result.errors))
  assert.equal(result.checked, 2)
  assert.equal(result.contract.skill, 'chapter-rewrite')
})

test('〔P3·产出〕越层／越槽／状态不符／mode 不符／schema 不合格逐条拒', () => {
  const chapter = SKILL_CONTRACTS['chapter-rewrite']

  const wrongLayer = validateProduces(chapter, [character({ status: 'proposed', mode: 'author' })])
  assert.ok(wrongLayer.errors.some((error) => error.code === 'PRODUCES_LAYER_NOT_ALLOWED'))
  assert.equal(wrongLayer.ok, false)

  const wrongStatus = validateProduces(chapter, [plot({ status: 'proposed', mode: 'author' })])
  assert.ok(wrongStatus.errors.some((error) => error.code === 'PRODUCES_STATUS_MISMATCH'))
  assert.ok(wrongStatus.errors.some((error) => error.field === 'entries[0].status'))

  const wrongMode = validateProduces(chapter, [plot({ status: 'draft', mode: 'analyze' })])
  assert.ok(wrongMode.errors.some((error) => error.code === 'PRODUCES_MODE_MISMATCH'))

  const schemaBad = { ...plot({ status: 'draft', mode: 'author' }) }
  delete schemaBad.fingerprint
  assert.ok(validateProduces(chapter, [schemaBad]).errors.some((error) => error.code === 'MISSING_REQUIRED'))

  const slotOnly = defineSkillContract({
    skill: 'slot-only',
    requires: { layers: ['worldview'] },
    produces: [{ layer: 'worldview', slot: 'locations', asStatus: 'proposed', mode: 'author' }]
  })
  assert.equal(validateProduces(slotOnly, [worldview({ slot: 'locations', status: 'proposed', mode: 'author' })]).ok, true)
  const outOfSlot = validateProduces(slotOnly, [worldview({ name: '铜钥匙', slot: 'items', status: 'proposed', mode: 'author' })])
  assert.ok(outOfSlot.errors.some((error) => error.code === 'PRODUCES_SLOT_NOT_ALLOWED'))

  const slotOnCharacter = validateProduces(chapter, [{ ...character({ status: 'proposed', mode: 'author' }), slot: 'locations' }])
  assert.ok(slotOnCharacter.errors.some((error) => error.code === 'PRODUCES_SLOT_NOT_ALLOWED'))

  const brokenContract = validateProduces({ requires: { layers: ['nowhere'] }, produces: [] }, [plot()])
  assert.equal(brokenContract.ok, false)
  assert.equal(brokenContract.checked, 0)
  assert.ok(brokenContract.errors.every((error) => error.code.startsWith('CONTRACT_')))
})

/* ───────────── 3. assembleRequires：裁剪事实包 ───────────── */

function sampleEntries() {
  return [
    worldview({ name: '旧钟楼', slot: 'locations' }),
    worldview({ name: '铜钥匙', slot: 'items' }),
    character({ name: '柯秒' }),
    character({ name: '守夜人' }),
    plot({
      name: '停摆',
      status: 'proposed',
      events: [
        { index: 1, track: 'fact', title: '钟声三响', segments: [{ index: 1, chars: 120 }] },
        { index: 2, track: 'hypothesis', title: '守夜人知情', segments: [{ index: 1, chars: 130 }] }
      ]
    })
  ]
}

test('〔P3·装配〕只要 worldview/locations：事件与角色空，items 记入 dropped，原包不被改', () => {
  const pack = buildFactPack(sampleEntries(), { span: 2 })
  const contract = defineSkillContract({
    skill: 'locations-only',
    requires: { layers: ['worldview'], slots: ['locations'] },
    produces: [{ layer: 'plot', asStatus: 'draft', mode: 'author' }]
  })
  const assembled = assembleRequires(contract, pack)
  assert.equal(assembled.ok, true)
  assert.deepEqual(Object.keys(assembled.world.slots), ['locations'])
  assert.equal(assembled.world.slots.locations.length, 1)
  assert.deepEqual(assembled.events, { facts: [], hypotheses: [] })
  assert.deepEqual(assembled.characters, {})
  assert.ok(assembled.effective.every((item) => item.layer === 'worldview'))
  assert.equal(assembled.effective.length, 1)
  assert.deepEqual(assembled.dropped.slots, ['items'])
  assert.deepEqual(assembled.dropped.layers.slice().sort(), ['character', 'plot'])
  assert.equal(assembled.counts.facts, 0)
  assert.equal(assembled.counts.characters, 0)

  assert.equal(pack.world.slots.items.length, 1, '裁的是副本，事实包原件不动')
  assert.equal(pack.events.facts.length, 1)
  assert.equal(Object.keys(pack.characters).length, 2)
})

test('〔P3·装配〕要 plot＋character 且 knowledgeOf 点名：只留柯秒，节奏缺失如实告警', () => {
  const pack = buildFactPack(sampleEntries(), { span: 2 })
  const contract = defineSkillContract({
    skill: 'scene-focus',
    requires: { layers: ['plot', 'character'], spans: { current: true }, knowledgeOf: ['柯秒'], rhythm: true },
    produces: [{ layer: 'plot', asStatus: 'draft', mode: 'author' }]
  })
  const assembled = assembleRequires(contract, pack)
  assert.equal(assembled.ok, true)
  assert.deepEqual(Object.keys(assembled.characters), ['柯秒'])
  assert.deepEqual(assembled.dropped.characters, ['守夜人'])
  assert.equal(assembled.counts.facts, 1)
  assert.equal(assembled.counts.hypotheses, 1)
  assert.deepEqual(assembled.world.slots, {}, '没要世界观层就一个槽位都不给')
  assert.equal(assembled.rhythm, null)
  assert.ok(assembled.warnings.some((warning) => warning.code === 'RHYTHM_NOT_IN_FACT_PACK'))
  assert.deepEqual({ ...assembled.spans }, { current: true, before: 0, after: 0 })
  assert.deepEqual(assembled.query.knowledgeOf, ['柯秒'])

  const withRhythm = assembleRequires(contract, { ...pack, rhythm: { windowChars: [500, 1500], noveltyTags: ['燃'] } })
  assert.deepEqual(withRhythm.rhythm, { windowChars: [500, 1500], noveltyTags: ['燃'] })
  assert.equal(withRhythm.warnings.some((warning) => warning.code === 'RHYTHM_NOT_IN_FACT_PACK'), false)
})

test('〔P3·装配〕knowledgeOf=focus 只取查询聚焦的角色', () => {
  const base = buildFactPack(sampleEntries(), { span: 2 })
  const pack = { ...base, query: { ...base.query, character: '柯秒' } }
  const contract = defineSkillContract({
    skill: 'focus-scene',
    requires: { layers: ['character'], knowledgeOf: 'focus' },
    produces: [{ nonEntry: 'scene-skeleton', output: 'proposal' }]
  })
  const assembled = assembleRequires(contract, pack)
  assert.deepEqual(Object.keys(assembled.characters), ['柯秒'])
  assert.deepEqual(assembled.dropped.characters, ['守夜人'])
})

/* ───────────── 4. 装载：坏契约拒装并记账 ───────────── */

const MARKDOWN = '---\nname: demo\ndescription: 一句话说清这个技能干什么。\ntools: [pinax_chapter_read]\noutput: checklist\n---\n\n## 步骤\n\n1. 先读。\n'

async function demoSkillDir() {
  const dir = await mkdtemp(join(tmpdir(), 'pinax-skill-contract-'))
  await mkdir(join(dir, 'demo'))
  await writeFile(join(dir, 'demo', 'SKILL.md'), MARKDOWN, 'utf-8')
  return dir
}

test('〔P3·装载〕非法契约（未知层／未知槽位／名字不符）拒装并写清原因', async () => {
  const dir = await demoSkillDir()
  const goodRequires = { layers: ['plot'] }
  const goodProduces = [{ layer: 'plot', asStatus: 'draft', mode: 'author' }]

  const unknownLayer = await loadSkills({
    dir,
    availableTools: ['pinax_chapter_read'],
    contracts: { demo: { skill: 'demo', requires: { layers: ['nowhere'] }, produces: goodProduces } }
  })
  assert.deepEqual(unknownLayer.skills, [])
  assert.equal(unknownLayer.rejected[0].code, 'SKILL_CONTRACT_INVALID')
  assert.match(unknownLayer.rejected[0].message, /nowhere/)

  const unknownSlot = await loadSkills({
    dir,
    availableTools: ['pinax_chapter_read'],
    contracts: { demo: { skill: 'demo', requires: { layers: ['worldview'], slots: ['nowhere'] }, produces: goodProduces } }
  })
  assert.equal(unknownSlot.rejected[0].code, 'SKILL_CONTRACT_INVALID')
  assert.match(unknownSlot.rejected[0].message, /nowhere/)

  const nameMismatch = await loadSkills({
    dir,
    availableTools: ['pinax_chapter_read'],
    contracts: { demo: defineSkillContract({ skill: 'another-skill', requires: goodRequires, produces: goodProduces }) }
  })
  assert.equal(nameMismatch.skills.length, 0)
  assert.equal(nameMismatch.rejected[0].code, 'SKILL_CONTRACT_NAME_MISMATCH')
  assert.match(nameMismatch.rejected[0].message, /another-skill/)
})

test('〔P3·装载〕合法契约挂到技能上；没登记契约的包照样装载（contract:null）', async () => {
  const dir = await demoSkillDir()
  const good = defineSkillContract({
    skill: 'demo',
    requires: { layers: ['plot'], spans: { current: true } },
    produces: [{ nonEntry: 'violation-list', output: 'checklist' }]
  })
  const loaded = await loadSkills({ dir, availableTools: ['pinax_chapter_read'], contracts: { demo: good } })
  assert.equal(loaded.rejected.length, 0)
  assert.equal(loaded.skills.length, 1)
  assert.equal(loaded.skills[0].contract.version, SKILL_CONTRACT_VERSION)
  assert.deepEqual(loaded.skills[0].contract.produces.map((item) => item.nonEntry), ['violation-list'])

  const plain = await loadSkills({ dir, availableTools: ['pinax_chapter_read'], contracts: {} })
  assert.equal(plain.rejected.length, 0)
  assert.equal(plain.skills.length, 1)
  assert.equal(plain.skills[0].contract, null, '作者导入的包不写契约不为难')
})

test('〔P3·装载〕随包五卡：装载数不增不减，每张都挂上合法契约', async () => {
  const loaded = await loadSkills({
    dir: DEFAULT_SKILLS_DIR,
    availableTools: [
      'pinax_project_context', 'pinax_chapter_read', 'pinax_chapter_save',
      'pinax_outline_read', 'pinax_outline_save', 'pinax_worldbook_list',
      'pinax_worldbook_read', 'pinax_worldbook_save', 'pinax_skill_read'
    ]
  })
  assert.deepEqual(loaded.rejected, [])
  assert.equal(loaded.skills.length, 5)
  for (const skill of loaded.skills) {
    assert.ok(skill.contract, `${skill.name} 没有挂上契约`)
    assert.equal(validateSkillContract(skill.contract).ok, true)
    assert.equal(skill.contract.skill, skill.name)
  }
})
