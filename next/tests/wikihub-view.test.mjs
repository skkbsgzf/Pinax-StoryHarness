import test from 'node:test'
import assert from 'node:assert/strict'
import { WORLDVIEW_SLOT_NAMES, stableEntryId } from '../wikihub/pediaSchema.mjs'
import { worldbookToHub } from '../wikihub/convert.mjs'
import {
  HUB_VIEW_LAYER_ORDER,
  HUB_VIEW_SLOT_LABELS,
  buildHubLinkTable,
  buildHubViewModel,
  entryContentLeadsWithName,
  filterHubEntries,
  hubEntryTokensOf,
  hubGroupOptions,
  hubInboundCounts,
  hubInfoboxFields,
  hubLinkTargets,
  hubSlotLabel
} from '../wikihub/viewModel.mjs'

/**
 * W3 视图模型的对照测试：不挂组件、不碰磁盘，只钉住三栏版式吃的那几件事——
 *   1) 左树分组：layer → domain → 槽位（世界观 11 个中文名）→ 条目，每级计数；
 *      人物／剧情两层的「小说／剧本锚点占位组」在场且是惰性的（wired=false）；
 *   2) 链接表：名称／短名／别名唯一归属才进表，同名多归属整词剔除并逐条记账；
 *   3) 信息卡字段：缺的不摆，未建档如实写「未建档」。
 * 期望值全部走 W1 的 worldbookToHub（数据源切 hub 的真实链路），不手搓 pedia 信封。
 */

const RUNTIME_ENTRIES = [
  { id: 'wb-ch1', name: '编年·停摆的表', type: 'event', cat: '编年', tags: [], aliases: [], chars: 10, summary: '', path: '世界书/编年/编年·停摆的表.md', revision: 1, contract: true },
  { id: 'wb-ch2', name: '编年·雨夜', type: 'event', cat: '编年', tags: [], aliases: [], chars: 12, summary: '', path: '世界书/编年/编年·雨夜.md', revision: 1, contract: true },
  { id: 'wb-1', name: '人物·柯秒', type: 'character', cat: '人物', tags: ['主角'], aliases: ['柯秒'], chars: 18, summary: '', path: '世界书/人物/人物·柯秒.md', revision: 1, contract: true },
  { id: 'wb-p1', name: '地点·槐巷', type: 'location', cat: '人物', tags: [], aliases: ['槐巷'], chars: 20, summary: '', path: '世界书/人物/地点·槐巷.md', revision: 1, contract: true },
  { id: 'wb-s1', name: '设定·钟楼', type: 'setting', cat: '设定', tags: [], aliases: [], chars: 16, summary: '', path: '世界书/设定/设定·钟楼.md', revision: 1, contract: true }
]

function fixtureModel(options = {}) {
  const converted = worldbookToHub(RUNTIME_ENTRIES, { book: '大梦' })
  assert.equal(converted.ok, true)
  return buildHubViewModel(converted, { book: '大梦', ...options })
}

function pediaEntry({ name, slot = 'power_levels', rank = null, domain = '大梦', layer = 'worldview', aliases = [], content = '', contract = true }) {
  const id = stableEntryId({ layer, domain, slot, name })
  return {
    schema: 'pedia/v2',
    id,
    layer,
    name,
    domain,
    slot,
    rank,
    definition: `${name}的摘要`,
    ...(aliases.length ? { aliases: [...aliases] } : {}),
    next: {
      worldbook: {
        name,
        type: 'setting',
        catDir: '',
        keys: [...aliases],
        tags: [],
        summary: `${name}的摘要`,
        relations: [],
        content,
        path: `世界书/${name}.md`,
        revision: 1,
        chars: content.length,
        contract
      }
    }
  }
}

test('视图模型：layer → domain → 槽位三级分组，每级计数，世界观用 11 个中文槽位名', () => {
  const model = fixtureModel()

  assert.equal(model.version, 'wikihub-view/v2')
  assert.equal(model.book, '大梦')
  assert.equal(model.domain, '大梦')
  // 层序：世界观有条目；人物／剧情无条目但有占位组，仍须在场；v2 已无 style 层。
  assert.equal(HUB_VIEW_LAYER_ORDER.join(','), 'worldview,character,plot')
  assert.deepEqual(model.layers.map((layer) => [layer.layer, layer.label, layer.count]), [
    ['worldview', '世界观', 5],
    ['character', '人物', 0],
    ['plot', '剧情', 0]
  ])

  const worldview = model.layers[0]
  assert.equal(worldview.domains.length, 1, '运行时清单没有域字段，回落到书名打一个域')
  assert.equal(worldview.domains[0].key, '大梦')
  assert.equal(worldview.domains[0].count, 5)
  const groups = worldview.domains[0].groups
  // 槽位序＝WORLDVIEW_SLOT_NAMES 的声明序（roles 在 concepts 前、concepts 在 events 前、other 永远最后）。
  // 〔批次 W4〕「设定·钟楼」由名称前缀规则救出 other，落 concepts 组。
  assert.deepEqual(groups.map((group) => [group.key, group.label, group.count]), [
    ['roles', '身份与角色', 2],
    ['concepts', '概念与现象', 1],
    ['events', '历史事件', 2]
  ])
  // 组内默认按中文名排：地(di) 在 人(ren) 前。
  assert.deepEqual(groups[0].entries.map((entry) => entry.name), ['地点·槐巷', '人物·柯秒'])
  assert.deepEqual(groups[1].entries.map((entry) => entry.name), ['设定·钟楼'])
  assert.deepEqual(groups[2].entries.map((entry) => entry.name), ['编年·停摆的表', '编年·雨夜'])

  // 11 个槽位名一个不少、顺序与 schema 一致：左树与 render.mjs 共用这一份词表。
  assert.deepEqual(Object.keys(HUB_VIEW_SLOT_LABELS), [...WORLDVIEW_SLOT_NAMES])
  assert.deepEqual(WORLDVIEW_SLOT_NAMES.map(hubSlotLabel), [
    '力量等级', '技能与能力', '规则与机制', '地点', '物品', '组织与势力',
    '身份与角色', '种族与生物', '概念与现象', '历史事件', '其他'
  ])

  assert.deepEqual(model.counts, {
    entries: 5,
    layers: 1,
    domains: 1,
    groups: 3,
    placeholders: 4,
    relations: 0,
    links: 10,
    conflicts: 0,
    stylePackEntries: 0
  })
})

test('批次 W4／S1：剧作· 前缀条目解耦进文风能力包，不再是视图层（不污染 11 槽位词表）', () => {
  const runtime = (name, chars) => ({
    id: `wb-${name}`,
    name,
    type: 'general',
    cat: '',
    tags: [],
    aliases: [],
    chars,
    summary: '',
    path: `世界书/剧作/${name}.md`,
    revision: 1,
    contract: true
  })
  const converted = worldbookToHub([
    runtime('剧作·插叙结构', 8),
    runtime('剧作·术语与声线', 9)
  ], { book: '大梦' })
  assert.equal(converted.valid, true, JSON.stringify(converted.issues))
  assert.equal(converted.entries.length, 0, '文风类条目不进 pedia 主条目集')
  const model = buildHubViewModel(converted, { book: '大梦' })

  assert.equal(model.layers.some((layer) => layer.layer === 'style'), false, 'v2 不再有 style 层')
  assert.equal(model.entries.length, 0)
  assert.ok(model.stylePack, '能力包要随模型可用')
  assert.equal(model.stylePack.pack, 'novel-style')
  assert.equal(model.stylePack.active, true)
  assert.deepEqual(model.stylePack.entries.map((entry) => [entry.name, entry.slot]), [
    ['剧作·插叙结构', 'creative_rules'],
    ['剧作·术语与声线', 'creative_rules']
  ])
  assert.equal(model.counts.stylePackEntries, 2)
  assert.deepEqual(hubGroupOptions(model).filter((option) => option.value), [], '能力包不产生视图筛选组')
  // 能力包分组不进 11 槽位词表（HUB_VIEW_SLOT_LABELS 必须与 schema 一一对应）。
  assert.deepEqual(Object.keys(HUB_VIEW_SLOT_LABELS), [...WORLDVIEW_SLOT_NAMES])

  // 旧数据里的 style 层条目：丢弃并记账，不画半截。
  const legacy = buildHubViewModel([
    { id: 'style0000001', layer: 'style', name: '旧文风', slot: 'creative_rules', definition: 'x' },
    pediaEntry({ name: '钟楼', slot: 'locations' })
  ], { book: '大梦' })
  assert.equal(legacy.entries.length, 1)
  assert.ok(legacy.warnings.some((warning) => warning.code === 'STYLE_LAYER_DECOUPLED'))
})

test('视图模型：有序槽位按 rank 排，缺 rank 的排到最后（名字只做并列时的次序）', () => {
  const model = buildHubViewModel([
    pediaEntry({ name: '筑基', rank: 3 }),
    pediaEntry({ name: '炼气', rank: 1 }),
    pediaEntry({ name: '金丹', rank: 2 }),
    pediaEntry({ name: '未定阶', rank: null })
  ], { book: '大梦' })
  const groups = model.layers[0].domains[0].groups
  assert.equal(groups[0].key, 'power_levels')
  assert.deepEqual(groups[0].entries.map((entry) => entry.name), ['炼气', '金丹', '筑基', '未定阶'])
})

test('占位组：人物／剧情各两枚锚点组，计数来自 anchors，明确惰性（wired=false）', () => {
  const model = fixtureModel({
    anchors: { chapters: [{ index: 0 }, { index: 1 }], scripts: [{ index: 0 }], characters: [{ name: '柯秒' }, { name: '槐巷' }, { name: '钟楼' }] }
  })
  const character = model.layers.find((layer) => layer.layer === 'character')
  const plot = model.layers.find((layer) => layer.layer === 'plot')
  assert.deepEqual(character.placeholders.map((item) => [item.key, item.label, item.count, item.wired]), [
    ['character:novel-anchors', '小说人物锚点', 3, false],
    ['character:script-anchors', '剧本角色锚点', 3, false]
  ])
  assert.deepEqual(plot.placeholders.map((item) => [item.key, item.label, item.count, item.wired]), [
    ['plot:novel-anchors', '小说章节锚点', 2, false],
    ['plot:script-anchors', '剧本分集锚点', 1, false]
  ])
  for (const placeholder of [...character.placeholders, ...plot.placeholders]) {
    assert.match(placeholder.hint, /不跳转/u, '接不上就要写明接不上')
  }

  // 没有 anchors 时计数为 0，但占位组仍在（结构诚实，不因空数据消失）。
  const bare = fixtureModel()
  assert.deepEqual(bare.layers.find((layer) => layer.layer === 'plot').placeholders.map((item) => item.count), [0, 0])
})

test('链接表：名称／短名／别名唯一归属才进表，同名多归属整词剔除并逐条记账', () => {
  const model = buildHubViewModel([
    pediaEntry({ name: '人物·柯秒', aliases: ['柯秒', '秒子'] }),
    pediaEntry({ name: '地点·槐巷', aliases: ['槐巷'] }),
    pediaEntry({ name: '人物·阿青', aliases: ['青云'] }),
    pediaEntry({ name: '地点·青云', slot: 'locations' })
  ], { book: '大梦' })

  const table = model.linkTable
  assert.equal(table.resolve('秒子').name, '人物·柯秒', '别名唯一归属进表')
  assert.equal(table.resolve('槐巷').name, '地点·槐巷')
  assert.equal(table.resolve('青云'), null, '一个人物的别名与另一条目的短名撞车：整词不染蓝')
  assert.equal(table.resolve('阿青').name, '人物·阿青', '同一条目的其它词不受影响')
  const conflict = table.conflicts.find((item) => item.token === '青云')
  assert.ok(conflict, '冲突要有账')
  assert.deepEqual(conflict.owners.map((owner) => owner.name).sort(), ['人物·阿青', '地点·青云'])
  assert.ok(model.warnings.some((warning) => warning.code === 'LINK_CONFLICT' && warning.message.includes('青云')), '冲突进 warnings')

  // 目标表（正文蓝链吃的那张）：token → 目标，冲突词不在其中。
  const targets = hubLinkTargets(model)
  assert.equal(targets.get('秒子').name, '人物·柯秒')
  assert.equal(targets.get('秒子').kind, 'entry')
  assert.equal(targets.get('秒子').item.path, '世界书/人物·柯秒.md', '目标带得回 openEntry 的 item')
  assert.equal(targets.has('青云'), false)
})

test('链接表：纯函数也可单独用——短名取自「·」后那一段，短于 2 字不进词表', () => {
  const entries = [
    { id: 'a', name: '甲·乙丙', aliases: [] },
    { id: 'b', name: '丁', aliases: ['戊己'] }
  ]
  assert.deepEqual(hubEntryTokensOf(entries[0]), ['甲·乙丙', '乙丙'])
  assert.deepEqual(hubEntryTokensOf(entries[1]), ['戊己'], '1 字名不进候选词（长度门槛 2）')
  const table = buildHubLinkTable(entries)
  assert.equal(table.resolve('乙丙').id, 'a')
  assert.equal(table.resolve('戊己').id, 'b')
  assert.equal(table.resolve('丁'), null, '1 字词不染蓝（正文里误伤太大）')
  assert.deepEqual(table.tokensByEntryId.get('b'), ['戊己'])
})

test('信息卡字段：缺的不摆，来源区分「未建档」与路径', () => {
  const withSource = pediaEntry({ name: '钟楼', slot: 'locations', content: '钟楼在巷尾。' })
  const fields = hubInfoboxFields(buildHubViewModel([withSource], { book: '大梦' }).entries[0])
  assert.deepEqual(fields.map((field) => [field.key, field.value]), [
    ['category', '地点'],
    ['domain', '大梦'],
    ['type', 'setting'],
    ['chars', '6 字'],
    ['revision', '第 1 版'],
    ['source', '世界书/钟楼.md']
  ])
  assert.equal(fields.some((field) => field.key === 'aliases'), false, '没有别名就不摆那一行')
  assert.equal(fields.some((field) => field.key === 'rank'), false, '非有序槽位没有序位')

  const bare = pediaEntry({ name: '碎句', slot: 'other', contract: false })
  const bareFields = hubInfoboxFields(buildHubViewModel([bare], { book: '大梦' }).entries[0])
  assert.equal(bareFields.find((field) => field.key === 'source').value, '未建档')
  assert.equal(bareFields.some((field) => field.key === 'rank'), false)
})

test('筛选与下拉：槽位／层精确匹配，文本打名称／别名／摘要／路径', () => {
  const model = fixtureModel()
  assert.deepEqual(hubGroupOptions(model), [
    { value: '', label: '全部槽位' },
    { value: 'roles', label: '身份与角色' },
    { value: 'concepts', label: '概念与现象' },
    { value: 'events', label: '历史事件' }
  ])
  assert.deepEqual(filterHubEntries(model.entries, { group: 'events' }).map((entry) => entry.name), ['编年·停摆的表', '编年·雨夜'])
  assert.deepEqual(filterHubEntries(model.entries, { text: '柯秒' }).map((entry) => entry.name), ['人物·柯秒'], '别名命中也算')
  assert.deepEqual(filterHubEntries(model.entries, { text: '槐巷', group: 'events' }), [], '两个条件叠加')
  assert.equal(filterHubEntries(model.entries, { text: '查无此条' }).length, 0)
})

test('运行时读回形状：keys 里的别名进链接表，目录仍留在兼容 cat（表格与图例不换语义）', () => {
  const converted = worldbookToHub(RUNTIME_ENTRIES, { book: '大梦' })
  const model = buildHubViewModel(converted, { book: '大梦' })
  const kemiao = model.entries.find((entry) => entry.name === '人物·柯秒')
  assert.deepEqual(kemiao.aliases, ['柯秒'])
  assert.equal(kemiao.cat, '人物', '兼容字段 cat 仍是世界书目录')
  assert.equal(kemiao.groupLabel, '身份与角色')
  assert.equal(model.linkTable.resolve('柯秒').name, '人物·柯秒')
  assert.equal(kemiao.item.path, '世界书/人物/人物·柯秒.md')
})

test('重复 id：后一条不进视图并记账，不在树上摆两行同 id', () => {
  const first = pediaEntry({ name: '钟楼', slot: 'locations' })
  const model = buildHubViewModel([first, { ...first, name: '钟楼（重复）' }], { book: '大梦' })
  assert.equal(model.entries.length, 1)
  assert.ok(model.warnings.some((warning) => warning.code === 'DUPLICATE_ID'))
})

test('层级 dot 的统计口径：relations 提到或正文包含都算「被引用」', () => {
  const described = pediaEntry({ name: '钟楼', slot: 'locations' })
  const referrer = {
    ...pediaEntry({ name: '停摆的表', slot: 'items' }),
    relations: [{ to: '钟楼', type: '位于' }]
  }
  const mentioner = pediaEntry({ name: '雨夜', slot: 'events', content: '那夜他爬上了钟楼。' })
  const model = buildHubViewModel([described, referrer, mentioner], { book: '大梦' })
  const counts = hubInboundCounts(model.entries)
  const byName = new Map(model.entries.map((entry) => [entry.name, counts.get(entry.id)]))
  assert.equal(byName.get('钟楼'), 2)
  assert.equal(byName.get('停摆的表'), 0)
})

test('修复①：只有正文首个标题（ATX／setext）与条目名逐字相同才判重复', () => {
  const name = '人物·柯秒'
  // ATX：允许前导空行、行尾闭合 #；空白归一化后再比。
  assert.equal(entryContentLeadsWithName('# 人物·柯秒\n\n冷穿越剧版主角。', name), true)
  assert.equal(entryContentLeadsWithName('\n\n#  人物·柯秒  ###\n正文', name), true)
  // setext 一级标题。
  assert.equal(entryContentLeadsWithName('人物·柯秒\n=====\n\n正文', name), true)
  // 不同的题、二级题、没有题、正文中段的同名 H1 都不算重复（那是作者的行文结构）。
  assert.equal(entryContentLeadsWithName('# 柯秒\n正文', name), false)
  assert.equal(entryContentLeadsWithName('## 人物·柯秒\n正文', name), false)
  assert.equal(entryContentLeadsWithName('冷穿越剧版主角。', name), false)
  assert.equal(entryContentLeadsWithName('正文一段。\n\n# 人物·柯秒\n正文', name), false)
  assert.equal(entryContentLeadsWithName('', name), false)
  assert.equal(entryContentLeadsWithName('# 人物·柯秒', ''), false)
})
