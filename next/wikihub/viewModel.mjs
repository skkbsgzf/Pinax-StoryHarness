import { OTHER_SLOT, WORLDVIEW_SLOTS, WORLDVIEW_SLOT_NAMES } from '../fact/domain/pediaSchema.js'

/**
 * wikihub 三栏视图模型（批次 W3 · 纯函数，浏览器侧可用）。
 *
 * 输入＝fact.data/v2 hub 条目集（worldbookToHub 的结果或任意 { entries } / 条目数组），
 * 输出＝世界书三栏维基版式要用的四件事：
 *   1) 左索引树：layer → domain → group（世界观＝11 个标准槽位名；软层＝层名）→ 条目，
 *      每级带条目数；人物／剧情两层的「小说／剧本锚点占位组」始终在场（惰性，见 limitations）；
 *   2) 链接表：条目名＋「·」后短名＋全部别名 → 条目 id，只收「恰好指向一条」的词；
 *      同名／同别名多归属的词不进表，冲突逐条记账（看着能点就必须点得动）；
 *   3) 信息卡字段：槽位中文名／域／别名／序位／类型／关系数／字数／修订／来源路径；
 *   4) 正文＝条目 md 原文（hub 只补信息，不重写正文）。
 *
 * S1（fact.data/v2）：一等公民层只有 worldview／character／plot；文风不再是层，
 * 旧 style 条目进视图时逐条记 STYLE_LAYER_DECOUPLED 并丢弃，文风内容改由能力包
 * （hub.stylePack → model.stylePack）承载。
 *
 * 本文件不 import 任何 Node 内置模块，也不 import render.mjs（避免环）：
 * render.mjs 反过来从这里取层／槽位中文名，单一来源。
 */

export const HUB_VIEW_VERSION = 'wikihub-view/v2'

export const HUB_VIEW_LAYER_ORDER = Object.freeze(['worldview', 'character', 'plot'])

export const HUB_VIEW_LAYER_LABELS = Object.freeze({
  worldview: '世界观',
  character: '人物',
  plot: '剧情'
})

/** 11 个标准槽位的人话（NovelPedia 的槽位名照抄，读者不用再记英文）。 */
export const HUB_VIEW_SLOT_LABELS = Object.freeze({
  power_levels: '力量等级',
  abilities: '技能与能力',
  rules: '规则与机制',
  locations: '地点',
  items: '物品',
  orgs: '组织与势力',
  roles: '身份与角色',
  creatures: '种族与生物',
  concepts: '概念与现象',
  events: '历史事件',
  other: '其他'
})

/**
 * 人物／剧情两层的锚点占位组：这两层的条目一半来自小说／剧本结构（章节序、剧集序），
 * 在 Next 里没有「从世界书栏直接打开章节／剧集」的既有通路，所以这里只登记锚点、不接点击。
 * 接不上这件事写进 hint，也写进执行记录的 limitations——不做假按钮。
 */
const PLACEHOLDER_SPECS = Object.freeze({
  character: Object.freeze([
    Object.freeze({
      key: 'character:novel-anchors',
      kind: 'novel-anchors',
      anchor: 'characters',
      label: '小说人物锚点',
      hint: '人物名单来自小说侧；本栏只登记锚点，点击不跳转（章节打开未接线）。'
    }),
    Object.freeze({
      key: 'character:script-anchors',
      kind: 'script-anchors',
      anchor: 'characters',
      label: '剧本角色锚点',
      hint: '角色名单来自剧本侧；本栏只登记锚点，点击不跳转（剧集打开未接线）。'
    })
  ]),
  plot: Object.freeze([
    Object.freeze({
      key: 'plot:novel-anchors',
      kind: 'novel-anchors',
      anchor: 'chapters',
      label: '小说章节锚点',
      hint: '章节在小说栏正文里；本栏只登记锚点，点击不跳转（章节打开未接线）。'
    }),
    Object.freeze({
      key: 'plot:script-anchors',
      kind: 'script-anchors',
      anchor: 'scripts',
      label: '剧本分集锚点',
      hint: '剧集在剧本栏里；本栏只登记锚点，点击不跳转（剧集打开未接线）。'
    })
  ])
})

const MIN_TOKEN_LENGTH = 2
const entryCollator = new Intl.Collator('zh-Hans-CN')

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function uniqueTexts(values) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const text = str(value).trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function arrayOfTexts(value) {
  return Array.isArray(value) ? uniqueTexts(value) : []
}

export function hubLayerLabel(layer) {
  return HUB_VIEW_LAYER_LABELS[layer] ?? str(layer)
}

export function hubSlotLabel(slot) {
  return HUB_VIEW_SLOT_LABELS[slot] ?? str(slot)
}

function normalizeRelations(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((relation) => isPlainObject(relation) && typeof relation.to === 'string' && relation.to.trim())
    .map((relation) => {
      const stance = firstText(relation.stance, relation.how)
      const edge = { ...relation, to: relation.to.trim(), type: firstText(relation.type), stance }
      return edge
    })
}

/**
 * 一个 hub 条目 → 视图条目。
 * 正文只搬 snapshot.content（md 原文），不搬 definition 去顶正文——hub 只补信息，不改内容。
 * 同时带上看板既有组件吃得着的兼容字段（cat／keys／summary），排序与表格不用另写一套。
 */
function normalizeEntry(raw, index, warnings, fallbackDomain = '') {
  // 两种输入形状：fact 条目（正文/元数据在 next.worldbook 快照里）与运行时读回的世界书条目
  // （name/keys/content 都在顶层）——后者把自己当快照，信息卡与蓝链词表不因形状而丢字段。
  const snapshot = isPlainObject(raw.next?.worldbook)
    ? raw.next.worldbook
    : (isPlainObject(raw) && (typeof raw.content === 'string' || typeof raw.kind === 'string' || Array.isArray(raw.keys)) ? raw : {})
  const layer = firstText(raw.layer, 'worldview')
  let slot = firstText(raw.slot)
  const name = firstText(raw.name, snapshot.name, raw.title, raw.id, `未命名条目 ${index + 1}`)
  let id = firstText(raw.id)
  if (!id) {
    id = `entry-${index + 1}`
    warnings.push({ code: 'MISSING_ID', message: `条目「${name}」没有 fact id，本视图用占位 id ${id}` })
  }
  if (layer === 'worldview' && !WORLDVIEW_SLOTS[slot]) {
    if (slot) warnings.push({ code: 'UNKNOWN_SLOT', message: `条目「${name}」的槽位「${slot}」不认识，按其他显示` })
    slot = OTHER_SLOT
  }
  // v2：槽位词表只属于 worldview；character/plot 是软层，没有槽位。
  if (layer !== 'worldview') slot = ''
  const domain = firstText(raw.domain, fallbackDomain)
  const aliases = uniqueTexts([...(Array.isArray(raw.aliases) ? raw.aliases : []), ...arrayOfTexts(snapshot.keys)])
    .filter((alias) => alias !== name)
  const tags = uniqueTexts([...(Array.isArray(raw.tags) ? raw.tags : []), ...arrayOfTexts(snapshot.tags)])
  const definition = firstText(raw.definition, snapshot.summary)
  const content = typeof snapshot.content === 'string' ? snapshot.content : (typeof raw.content === 'string' ? raw.content : '')
  const type = firstText(snapshot.type, snapshot.kind, raw.type)
  const status = firstText(snapshot.status, raw.status)
  const path = firstText(snapshot.path, raw.provenance?.source?.path, raw.path)
  const sourcePath = firstText(raw.provenance?.source?.path, snapshot.path, raw.path)
  const revision = Number.isSafeInteger(snapshot.revision) ? snapshot.revision : (Number.isSafeInteger(raw.revision) ? raw.revision : 0)
  const chars = Number.isSafeInteger(snapshot.chars) ? snapshot.chars : (Number.isSafeInteger(raw.chars) ? raw.chars : content.length)
  const updatedAt = firstText(snapshot.updatedAt, raw.updatedAt)
  const rank = Number.isSafeInteger(raw.rank) && raw.rank >= 1 ? raw.rank : null
  const relations = normalizeRelations(Array.isArray(raw.relations) ? raw.relations : snapshot.relations)
  const contract = snapshot.contract !== undefined ? snapshot.contract === true : raw.contract === true
  const span = isPlainObject(raw.span) ? raw.span : null
  const groupKey = layer === 'worldview' ? slot : layer
  const groupLabel = layer === 'worldview' ? hubSlotLabel(slot) : hubLayerLabel(layer)
  const search = [
    name,
    ...aliases,
    ...tags,
    type,
    status,
    definition,
    groupLabel,
    hubLayerLabel(layer),
    path
  ].filter(Boolean).join(' ').toLowerCase()

  const item = {
    ...snapshot,
    id: firstText(snapshot.id, raw.id) || null,
    name,
    type,
    cat: firstText(snapshot.catDir),
    keys: [...aliases],
    aliases: [...aliases],
    tags: [...tags],
    summary: definition,
    content,
    relations: relations.map((relation) => ({ ...relation })),
    path,
    revision,
    chars,
    contract
  }

  return {
    id,
    entryId: firstText(raw.id),
    name,
    layer,
    layerLabel: hubLayerLabel(layer),
    domain,
    slot,
    slotLabel: layer === 'worldview' ? hubSlotLabel(slot) : '',
    groupKey,
    groupLabel,
    rank,
    definition,
    content,
    type,
    status,
    path,
    sourcePath,
    revision,
    chars,
    updatedAt,
    aliases,
    tags,
    relations,
    span,
    contract,
    search,
    // 看板既有组件（表格／图谱／排序）吃得着的兼容字段：cat 仍给世界书目录（表格那一列
    // 与图谱图例维持 68-R2 的旧语义，不因数据源换 hub 而改色），keys 给别名，summary 给摘要。
    cat: firstText(snapshot.catDir),
    keys: [...aliases],
    summary: definition,
    totalChars: chars,
    item
  }
}

function layerOrderOf(layer) {
  const index = HUB_VIEW_LAYER_ORDER.indexOf(layer)
  return index < 0 ? HUB_VIEW_LAYER_ORDER.length : index
}

function slotOrderOf(slot) {
  const index = WORLDVIEW_SLOT_NAMES.indexOf(slot)
  return index < 0 ? WORLDVIEW_SLOT_NAMES.length : index
}

/** 默认序：层 → 域 → 槽位（世界观）→ 有序槽位的 rank → 名字。 */
export function sortHubEntries(entries) {
  const list = Array.isArray(entries) ? entries : []
  list.sort((a, b) => {
    const byLayer = layerOrderOf(a.layer) - layerOrderOf(b.layer)
    if (byLayer !== 0) return byLayer
    if (a.layer !== b.layer) return a.layer.localeCompare(b.layer)
    const byDomain = entryCollator.compare(a.domain, b.domain)
    if (byDomain !== 0) return byDomain
    if (a.layer === 'worldview') {
      const bySlot = slotOrderOf(a.slot) - slotOrderOf(b.slot)
      if (bySlot !== 0) return bySlot
      if (WORLDVIEW_SLOTS[a.slot]?.ordered) {
        const rankA = a.rank ?? Number.MAX_SAFE_INTEGER
        const rankB = b.rank ?? Number.MAX_SAFE_INTEGER
        if (rankA !== rankB) return rankA - rankB
      }
    }
    return entryCollator.compare(a.name, b.name)
  })
  return list
}

/** 一条条目贡献的候选词：全名＋「·」后短名＋全部别名；短于 2 字的不进正文词表。 */
export function hubEntryTokensOf(entry) {
  const tokens = []
  const push = (value) => {
    const text = str(value).trim()
    if (text.length >= MIN_TOKEN_LENGTH && !tokens.includes(text)) tokens.push(text)
  }
  const name = str(entry?.name).trim()
  push(name)
  const short = name.split('·')[1]
  if (short) push(short)
  for (const alias of entry?.aliases ?? []) push(alias)
  return tokens
}

/**
 * 链接表：条目名＋别名 → 条目。只收恰好指向一条的词；同名／同别名多归属的词不进表，
 * 冲突逐条进 conflicts（「为什么没链 X」永远有账可查）。
 *
 *   byToken          Map<token, entry>      —— 正文／关系用它解析（唯一归属）
 *   byExactName      Map<name, entry[]>     —— 精确名字的全部归属（含 1 字名）
 *   byEntryId        Map<id, entry>
 *   tokensByEntryId  Map<id, token[]>       —— 一条条目自己的全部词
 *   conflicts        [{ token, owners:[{id,name}] }]
 */
export function buildHubLinkTable(entries) {
  const list = Array.isArray(entries) ? entries : []
  const byEntryId = new Map()
  const tokensByEntryId = new Map()
  const owners = new Map()
  const byExactName = new Map()

  for (const entry of list) {
    if (!entry) continue
    byEntryId.set(entry.id, entry)
    const name = str(entry.name).trim()
    if (name) {
      if (!byExactName.has(name)) byExactName.set(name, [])
      byExactName.get(name).push(entry)
    }
    const tokens = hubEntryTokensOf(entry)
    tokensByEntryId.set(entry.id, tokens)
    for (const token of tokens) {
      if (!owners.has(token)) owners.set(token, new Map())
      owners.get(token).set(entry.id, entry)
    }
  }

  const byToken = new Map()
  const conflicts = []
  for (const [token, tokenOwners] of owners) {
    if (tokenOwners.size === 1) {
      byToken.set(token, [...tokenOwners.values()][0])
      continue
    }
    conflicts.push({
      token,
      owners: [...tokenOwners.values()].map((entry) => ({ id: entry.id, name: entry.name }))
    })
  }

  return {
    byToken,
    byExactName,
    byEntryId,
    tokensByEntryId,
    conflicts,
    size: byToken.size,
    resolve(token) {
      return byToken.get(str(token).trim()) ?? null
    },
    resolveId(id) {
      return byEntryId.get(str(id).trim()) ?? null
    }
  }
}

function buildDomains(layerEntries, layer) {
  const domainMap = new Map()
  for (const entry of layerEntries) {
    const key = entry.domain || ''
    if (!domainMap.has(key)) domainMap.set(key, [])
    domainMap.get(key).push(entry)
  }
  const domains = []
  for (const [key, list] of domainMap) {
    let groups
    if (layer === 'worldview') {
      const bySlot = new Map()
      for (const entry of list) {
        if (!bySlot.has(entry.slot)) bySlot.set(entry.slot, [])
        bySlot.get(entry.slot).push(entry)
      }
      groups = []
      for (const slot of WORLDVIEW_SLOT_NAMES) {
        if (bySlot.has(slot)) {
          groups.push({ key: slot, kind: 'slot', label: hubSlotLabel(slot), labelKind: 'slot', count: bySlot.get(slot).length, entries: bySlot.get(slot) })
        }
      }
      for (const [slot, slotEntries] of bySlot) {
        if (WORLDVIEW_SLOTS[slot]) continue
        groups.push({ key: slot, kind: 'slot', label: hubSlotLabel(slot), labelKind: 'slot', count: slotEntries.length, entries: slotEntries })
      }
    } else {
      // 软层（character/plot）一层一组：v2 起没有槽位，组键就是层名。
      groups = [{
        key: layer,
        kind: 'layer',
        label: hubLayerLabel(layer),
        labelKind: 'layer',
        count: list.length,
        entries: list
      }]
    }
    domains.push({ key, label: key || '未标域', count: list.length, groups })
  }
  return domains
}

function anchorCount(anchors, key) {
  return Array.isArray(anchors?.[key]) ? anchors[key].length : 0
}

function buildPlaceholders(layer, anchors) {
  const specs = PLACEHOLDER_SPECS[layer] ?? []
  return specs.map((spec) => ({
    ...spec,
    count: anchorCount(anchors, spec.anchor),
    wired: false
  }))
}

/**
 * hub 条目集 → 三栏视图模型。
 *
 * 输入：fact 条目数组／{ entries }／worldbookToHub 的返回值。
 * options：
 *   book     书名（顶层展示口，默认「世界书」）
 *   domain   兜底域（条目自带 domain 优先）
 *   anchors  { chapters, scripts, characters } —— 只用来给占位组记条目数，不接线
 *
 * 返回 { version, book, domain, entries, layers, linkTable, stylePack, warnings, counts }。
 * layers 里 worldview 按 11 槽位分组，character/plot 各一组（另带 placeholders）；
 * stylePack 是 fact.data/v2 的文风能力包（可能为 null），不再作为视图层出现。
 */
export function buildHubViewModel(input, options = {}) {
  const hub = Array.isArray(input) ? { entries: input } : (isPlainObject(input) ? input : {})
  const book = firstText(options.book, hub.book, options.title, hub.title, '世界书')
  const domain = firstText(options.domain, hub.domain, book)
  const warnings = []
  const entries = []
  const seenIds = new Set()
  const stylePack = isPlainObject(hub.stylePack)
    ? hub.stylePack
    : (isPlainObject(options.stylePack) ? options.stylePack : null)

  for (const notice of Array.isArray(options.notices) ? options.notices : []) {
    const message = typeof notice === 'string' ? notice : str(notice?.message)
    if (message) warnings.push({ code: 'NOTICE', message })
  }

  const rawEntries = Array.isArray(hub.entries) ? hub.entries : []
  rawEntries.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      warnings.push({ code: 'ENTRY_NOT_OBJECT', message: `第 ${index + 1} 条不是对象，已跳过` })
      return
    }
    // S1：fact.data/v2 没有 style 层，旧数据里的文风条目按能力包口径处理，不画进三栏。
    if (raw.layer === 'style') {
      warnings.push({
        code: 'STYLE_LAYER_DECOUPLED',
        message: `条目「${str(raw.name) || raw.id || index + 1}」是旧 style 层，v2 起改由文风能力包承载，未进三栏视图`
      })
      return
    }
    const entry = normalizeEntry(raw, index, warnings, domain)
    if (seenIds.has(entry.id)) {
      warnings.push({ code: 'DUPLICATE_ID', message: `条目「${entry.name}」与已有条目同 id（${entry.id}），后一条未进视图` })
      return
    }
    seenIds.add(entry.id)
    entries.push(entry)
  })

  sortHubEntries(entries)

  const layers = []
  const byLayer = new Map()
  for (const entry of entries) {
    if (!byLayer.has(entry.layer)) byLayer.set(entry.layer, [])
    byLayer.get(entry.layer).push(entry)
  }
  const layerKeys = []
  for (const layer of HUB_VIEW_LAYER_ORDER) {
    const hasEntries = byLayer.has(layer)
    const hasPlaceholders = (PLACEHOLDER_SPECS[layer] ?? []).length > 0
    if (hasEntries || hasPlaceholders) layerKeys.push(layer)
  }
  for (const layer of byLayer.keys()) {
    if (!layerKeys.includes(layer)) layerKeys.push(layer)
  }
  for (const layer of layerKeys) {
    const layerEntries = byLayer.get(layer) ?? []
    const domains = buildDomains(layerEntries, layer)
    layers.push({
      layer,
      label: hubLayerLabel(layer),
      count: layerEntries.length,
      domains,
      placeholders: buildPlaceholders(layer, options.anchors)
    })
  }

  const linkTable = buildHubLinkTable(entries)
  for (const conflict of linkTable.conflicts) {
    warnings.push({
      code: 'LINK_CONFLICT',
      message: `词「${conflict.token}」指向 ${conflict.owners.length} 条条目（${conflict.owners.map((owner) => owner.name).join(' / ')}），不染蓝`
    })
  }

  return {
    version: HUB_VIEW_VERSION,
    book,
    domain,
    entries,
    layers,
    linkTable,
    stylePack,
    warnings,
    counts: {
      entries: entries.length,
      layers: layers.filter((layer) => layer.count > 0).length,
      domains: layers.reduce((sum, layer) => sum + layer.domains.length, 0),
      groups: layers.reduce((sum, layer) => sum + layer.domains.reduce((inner, domainInfo) => inner + domainInfo.groups.length, 0), 0),
      placeholders: layers.reduce((sum, layer) => sum + layer.placeholders.length, 0),
      relations: entries.reduce((sum, entry) => sum + entry.relations.length, 0),
      links: linkTable.size,
      conflicts: linkTable.conflicts.length,
      stylePackEntries: Array.isArray(stylePack?.entries) ? stylePack.entries.length : 0
    }
  }
}

/** 筛选：槽位／层精确匹配；文本对名称／别名／摘要／类型／标签／路径做包含匹配。 */
export function filterHubEntries(entries, { text = '', group = '' } = {}) {
  const list = Array.isArray(entries) ? entries : []
  const needle = str(text).trim().toLowerCase()
  const wantGroup = str(group)
  if (!needle && !wantGroup) return list
  return list.filter((entry) => {
    if (wantGroup && entry.groupKey !== wantGroup) return false
    if (!needle) return true
    return entry.search.includes(needle)
  })
}

/**
 * 正文首个标题是否就是条目名（批次 W5 · 修复①）。
 *
 * 阅读列首的大标题由视图给出；正文若又以同名一级标题开头，屏幕上会出现两行一样的题。
 * 判据只认**正文第一个非空行**（ATX `#` 或 setext `===`），归一化空白后与条目名逐字相等才算；
 * 正文中段出现的同名 H1 不动——那是作者的行文结构，不是重复的题。
 */
export function entryContentLeadsWithName(content, name) {
  const title = str(name).replace(/\s+/gu, ' ').trim()
  const text = str(content).replace(/\r\n?/gu, '\n')
  if (!title || !text.trim()) return false
  const lines = text.split('\n')
  let index = 0
  while (index < lines.length && !lines[index].trim()) index += 1
  if (index >= lines.length) return false
  const first = lines[index]
  const atx = /^[ \t]{0,3}#[ \t]+(.*?)[ \t]*#*[ \t]*$/u.exec(first)
  let heading = atx ? atx[1] : ''
  if (!heading && /^[ \t]{0,3}=+[ \t]*$/u.test(lines[index + 1] ?? '')) heading = first
  return heading.replace(/\s+/gu, ' ').trim() === title
}

/** 筛选下拉的选项：模型里出现过的槽位／层（出现序），外加「全部槽位」清空位。 */
export function hubGroupOptions(model) {
  const options = [{ value: '', label: '全部槽位' }]
  const seen = new Set()
  for (const layer of model?.layers ?? []) {
    for (const domainInfo of layer.domains ?? []) {
      for (const group of domainInfo.groups ?? []) {
        if (seen.has(group.key)) continue
        seen.add(group.key)
        options.push({ value: group.key, label: group.label })
      }
    }
  }
  return options
}

/**
 * 信息卡字段（缺的字段整行不摆——不编造）：
 * 槽位中文名／域／别名／序位／类型／关系数／字数／修订／来源路径。
 */
export function hubInfoboxFields(entry) {
  if (!entry) return []
  const fields = [{ key: 'category', label: '分类', value: entry.groupLabel }]
  if (entry.domain) fields.push({ key: 'domain', label: '域', value: entry.domain })
  if (entry.aliases.length) fields.push({ key: 'aliases', label: '别名', value: entry.aliases.join('、') })
  if (entry.rank) fields.push({ key: 'rank', label: '序位', value: `第 ${entry.rank} 档` })
  if (entry.type) fields.push({ key: 'type', label: '类型', value: entry.type })
  if (entry.relations.length) fields.push({ key: 'relations', label: '关系', value: `${entry.relations.length} 条` })
  if (entry.chars > 0) fields.push({ key: 'chars', label: '字数', value: `${entry.chars} 字` })
  if (entry.revision > 0) fields.push({ key: 'revision', label: '修订', value: `第 ${entry.revision} 版` })
  const source = entry.contract === false ? '未建档' : firstText(entry.sourcePath, entry.path, '原文')
  fields.push({ key: 'source', label: '来源', value: source })
  return fields
}

/** 视图模型 → 正文蓝链目标表（token → target，target 形状与 EntryDetailPanel 旧词表一致）。 */
export function hubLinkTargets(model) {
  const map = new Map()
  const linkTable = model?.linkTable
  if (!linkTable) return map
  for (const [token, entry] of linkTable.byToken) {
    map.set(token, {
      kind: 'entry',
      name: entry.name,
      path: entry.path,
      aliases: entry.aliases,
      keys: entry.aliases,
      tags: entry.tags,
      item: entry.item,
      entryId: entry.id,
      tokens: linkTable.tokensByEntryId.get(entry.id) ?? [token]
    })
  }
  return map
}

/** 层级 dot 的统计口径：被引用次数（其它条目的 relations 提到我，或正文包含我的名字）。 */
export function hubInboundCounts(entries) {
  const list = Array.isArray(entries) ? entries : []
  const counts = new Map()
  for (const entry of list) {
    let count = 0
    for (const other of list) {
      if (other.id === entry.id) continue
      const viaRelations = other.relations.some((relation) => str(relation?.to).includes(entry.name))
      const viaContent = typeof other.content === 'string' && other.content.includes(entry.name)
      if (viaRelations || viaContent) count += 1
    }
    counts.set(entry.id, count)
  }
  return counts
}
