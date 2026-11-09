<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import EntryDetailPanel from './EntryDetailPanel.vue'
import EntryGraph from './EntryGraph.vue'
import { worldbookToHub } from '../wikihub/convert.mjs'
import {
  buildHubViewModel,
  filterHubEntries,
  hubGroupOptions,
  hubInboundCounts,
  hubInfoboxFields
} from '../wikihub/viewModel.mjs'
import {
  ENTRY_COLUMNS,
  clipEntrySummary,
  entryCategoryTree,
  nextEntriesView,
  readEntriesView,
  sortEntriesBy,
  writeEntriesView
} from './entriesView.mjs'

/**
 * 世界书看板区（批次68-R2 · 三栏维基版式；批次 W3 · 数据源切 pedia/v1 hub）。
 *
 * 版式口径（工单死口径，参照 NovelPedia demo）：树 : 阅读 : 条目信息卡 起排
 * `260px : 1fr : min(46%, 430px)`；窄窗口时信息卡折到阅读列下方（@media）。
 *   ① 左条目树＝hub 分组（layer → domain → 槽位 → 条目，每级带条目数）；
 *      世界观用 11 个中文槽位名；人物／剧情两层的「小说／剧本锚点占位组」始终在场；
 *   ② 中央阅读列＝选中条目的 wiki 阅读版式（EntryDetailPanel wiki 态，正文仍是 md 原文）；
 *      表格／图谱两态仍在——切换钮把中栏在「阅读／表格／图谱」之间循环；
 *   ③ 右信息卡＝hub 字段（槽位／域／别名／序位／类型／关系数／字数／修订／来源）
 *      ＋ 关系列表（目标能唯一解析就染蓝，未收录的灰显 wl-missing）＋ 图谱缩览。
 *
 * 三条纪律一个字没动：
 *   1) 三态视图记忆按项目根落 localStorage（键 entriesView.<projectRoot>，照 paneForm 先例）；
 *   2) 筛选、排序、层级 dot 都是纯前端的事，数据源仍是 data.entries／data.entry（不新增工具调用）；
 *   3) 筛选下拉与窄栏的类别树共用 data.entriesFilterCat 一格——两边不各记一份。
 *
 * 层级 dot 的诚实口径：数据里没有作者声明的权重，dot 一律按**被引用次数**统计分档，
 * 文案写明「统计」；档位边界 6/3/1 只是视觉分档，不是放行闸，也不冒充作者意图。
 */
const props = defineProps({
  /** useBoardData 的返回值：看板区与详情区看的是同一份数据。 */
  data: { type: Object, required: true },
  /** 当前项目根：只用来拼视图记忆的 localStorage 键与书名。 */
  projectRoot: { type: String, default: '' },
  /** 保存 chip（由 pane 统一管状态，中栏详情面只画）。 */
  chip: { type: Object, default: null },
  chipVisible: { type: Boolean, default: false },
  chipStale: { type: Boolean, default: false },
  chipText: { type: String, default: '' }
})
const emit = defineEmits(['history', 'chip-action'])

/** 三态视图：list（条目树＋阅读列）→ table（Dataview 式表格）→ graph（整书图谱）。 */
const view = ref('list')
const filter = ref('')
const sort = ref(null)
/** 信息卡整体收起（一钮，收起后阅读列吃满）。 */
const infoboxCollapsed = ref(false)

/**
 * 〔批次68-R2 调度方补刀〕窄容器自动收信息卡：三栏死口径（260 树＋信息卡 ≤430）在主组被
 * 对半分屏挤窄时会把阅读列压成竖条（实拍 543px 容器里中列只剩 53px）。折行判定按**容器**宽
 * （ResizeObserver 实测），不按视口 @media——侧组开着任何一页、主组变窄，先自动收信息卡；
 * 作者手动点过收起/展开之后以作者为准（userToggled），自动判定不再来回抢。
 */
const colsRef = ref(null)
const colsWidth = ref(0)
const userToggledInfobox = ref(false)
let colsObserver = null
onMounted(() => {
  // jsdom（vitest 环境）没有 ResizeObserver：窄容器自动收卡是排版增强，环境不支持就跳过，
  // 声明层判据归 visual-contract（node:test 真 fs），不为了它给测试环境塞 polyfill。
  if (typeof globalThis.ResizeObserver !== 'function') return
  colsObserver = new ResizeObserver((entries) => {
    for (const entry of entries) colsWidth.value = Math.round(entry.contentRect.width)
  })
  if (colsRef.value) colsObserver.observe(colsRef.value)
})
onBeforeUnmount(() => colsObserver?.disconnect())
watch(colsWidth, (width) => {
  if (!width || userToggledInfobox.value) return
  infoboxCollapsed.value = width < 760
})

watch(() => props.projectRoot, () => {
  view.value = readEntriesView(props.projectRoot)
  filter.value = ''
  sort.value = null
}, { immediate: true })

function toggleView() {
  view.value = nextEntriesView(view.value)
  writeEntriesView(props.projectRoot, view.value)
}

/** 切换钮的文案跟着「下一步是哪个视图」走：list 显示「表」、table 显示「图」、graph 显示「列」。 */
const VIEW_TOGGLE = {
  list: { label: '表', aria: '切换为表格视图', title: '表格视图' },
  table: { label: '图', aria: '切换为图谱视图', title: '图谱视图' },
  graph: { label: '列', aria: '切换为列表视图', title: '列表视图' }
}

/** 书名：项目根目录名（hub 的 domain 兜底与信息卡「域」共用这一口）。 */
const bookName = computed(() => {
  const root = String(props.projectRoot ?? '').trim().replace(/[\\/]+$/u, '')
  return root.split(/[\\/]/u).filter(Boolean).pop() || '世界书'
})

/**
 * hub 视图模型（批次 W3）：世界书清单 →（W1 转换器）pedia/v1 条目 → 层／域／槽位分组＋链接表。
 * 先过 worldbookToHub：清单工具给的是运行时读回形状（没有 slot），槽位只能由转换器按
 * 分类／类型推导——直接喂清单会全落在「其他」，等于没有分组。
 * 人物／剧情占位组只登记小说／剧本锚点数（data.chapters／data.scripts 已载入时如实计数），
 * 不接线到章节／剧集打开——世界书栏没有那条既有通路，hint 里写明。
 */
const hubModel = computed(() => {
  const converted = worldbookToHub(props.data.entries ?? [], { book: bookName.value })
  return buildHubViewModel(converted, {
    book: bookName.value,
    anchors: {
      chapters: props.data.chapters ?? [],
      scripts: props.data.scripts ?? [],
      characters: []
    }
  })
})

/** 筛选下拉与窄栏的类别树共用这一格（useBoardData 的 entriesFilterCat），值＝槽位／层 key。 */
const catFilter = computed({
  get: () => String(props.data.entriesFilterCat ?? ''),
  set: (value) => props.data.setEntriesFilterCat?.(value)
})

/** 筛选下拉的选项：hub 里出现过的槽位／层（出现序），外加「全部槽位」清空位。 */
const groupOptions = computed(() => hubGroupOptions(hubModel.value))

/**
 * 新建条目（批次60 · 工单任务一）：类别下拉＋标题输入，落盘仍走既有 createEntry
 * （世界书/<类别>/<名称>.md）。这里的类别是**世界书目录**，不是 pedia 槽位——
 * 槽位由转换器按分类／类型推导，作者不用在新建时先懂槽位表。
 */
const newTitle = ref('')
const newCat = ref('')
const createCategoryOptions = computed(() => [
  { value: '', label: '顶层' },
  ...entryCategoryTree(props.data.entries ?? [], props.data.categories)
    .filter((node) => node.name !== '__all')
    .map((node) => ({ value: node.name, label: node.label }))
])
async function submitNewEntry() {
  const title = newTitle.value.trim()
  if (!title) return
  await props.data.createEntry?.(title, newCat.value)
  newTitle.value = ''
}

/** 筛完的条目：槽位／层精确匹配 ＋ 文本对名称／别名／摘要／类型／标签／路径做包含匹配。 */
const visibleEntries = computed(() => filterHubEntries(hubModel.value.entries, {
  text: filter.value,
  group: catFilter.value
}))

const visibleIds = computed(() => new Set(visibleEntries.value.map((entry) => entry.id)))

/**
 * 左树用的分层视图：hub 分组 → 只留命中的条目 → 组内排序；空组／空层收起。
 * 有筛选时占位组让位（作者在找具体条目，不是看结构）；无筛选时占位组始终在场。
 */
const visibleLayers = computed(() => {
  const active = Boolean(String(filter.value).trim() || catFilter.value)
  const layers = []
  for (const layer of hubModel.value.layers) {
    const domains = layer.domains
      .map((domainInfo) => {
        const groups = domainInfo.groups
          .map((group) => {
            const entries = sortEntriesBy(group.entries.filter((entry) => visibleIds.value.has(entry.id)), sort.value)
            return { ...group, entries, count: entries.length }
          })
          .filter((group) => group.entries.length)
        return {
          ...domainInfo,
          groups,
          count: groups.reduce((sum, group) => sum + group.count, 0)
        }
      })
      .filter((domainInfo) => domainInfo.groups.length)
    const count = domains.reduce((sum, domainInfo) => sum + domainInfo.count, 0)
    const placeholders = active ? [] : layer.placeholders
    if (!count && !placeholders.length) continue
    layers.push({ ...layer, domains, count, placeholders })
  }
  return layers
})

/** 表格分组：把分层视图摊平成「层:域:组」一行一组（组头顺序＝hub 槽位序）。 */
const tableGroups = computed(() => visibleLayers.value.flatMap((layer) => layer.domains.flatMap((domainInfo) => (
  domainInfo.groups.map((group) => ({
    key: `${layer.layer}:${domainInfo.key || '__nodomain'}:${group.key}`,
    label: group.label,
    entries: group.entries
  }))
))))

function toggleSort(key) {
  const current = sort.value
  if (!current || current.key !== key) {
    sort.value = { key, dir: 'asc' }
    return
  }
  if (current.dir === 'asc') {
    sort.value = { key, dir: 'desc' }
    return
  }
  sort.value = null
}

function sortIndicator(key) {
  const current = sort.value
  if (!current || current.key !== key) return ''
  return current.dir === 'asc' ? '▲' : '▼'
}

function isEntryOpen(entry) {
  if (props.data.selection?.type !== 'entry') return false
  const selected = props.data.selection.item
  if (!selected) return false
  if (entry.path) return selected.path === entry.path
  return selected.name === entry.name
}

function openEntry(entry) {
  if (!entry) return
  void props.data.openEntry?.(entry.item ?? entry)
}

/** 行的悬停提示：全名（长名单行会被截断，悬浮看全）· 路径 · 版本 · 字数 · 是否建档。 */
function rowHint(entry) {
  const parts = []
  const name = String(entry?.name ?? '').trim()
  if (name) parts.push(name)
  const file = String(entry?.path ?? '').trim()
  if (file) parts.push(file)
  if (Number.isFinite(Number(entry?.revision))) parts.push(`第 ${entry.revision} 版`)
  if (Number.isFinite(Number(entry?.chars))) parts.push(`${entry.chars} 字`)
  if (entry?.contract === false) parts.push('未建档')
  return parts.join(' · ')
}

/* —— 层级 dot（统计口径，见头注）—————————————————————————————————————— */
const inboundCounts = computed(() => hubInboundCounts(hubModel.value.entries))

const TIER_LABELS = { s: 'S', a: 'A', b: 'B', c: 'C' }
function tierOf(count) {
  if (count >= 6) return 's'
  if (count >= 3) return 'a'
  if (count >= 1) return 'b'
  return 'c'
}
function inboundOf(entry) {
  return inboundCounts.value.get(entry?.id) ?? 0
}
function lvlTitle(entry) {
  const count = inboundOf(entry)
  return `被引用 ${count} 次 · 层级 ${TIER_LABELS[tierOf(count)]}（按被引用次数统计）`
}

/* —— 信息卡读数（hub 字段＋当前 data.entry 的新鲜读数；缺了就不摆那一行） ——————————— */
/**
 * 信息卡看的条目：hub 视图条目打底，再用 data.entry（read 的新鲜读数）盖一层——
 * 保存后 state.entries 不重列，关系／别名／字数只有 data.entry 是新的。
 */
const infoboxEntry = computed(() => {
  const fresh = props.data.entry
  if (!fresh) return null
  const matched = fresh.path ? hubModel.value.entries.find((entry) => entry.path && entry.path === fresh.path) : null
  // 清单里没有这条（刚新建／筛选前保存）时按同一条转换链现算，槽位口径才和左树一致。
  const base = matched
    ?? buildHubViewModel(worldbookToHub([fresh], { book: bookName.value }), { book: bookName.value }).entries[0]
    ?? null
  if (!base) return null
  const name = fresh.name || base.name
  const aliases = [...new Set([
    ...(Array.isArray(fresh.keys) ? fresh.keys : []),
    ...(Array.isArray(fresh.aliases) ? fresh.aliases : []),
    ...base.aliases
  ].map((alias) => String(alias).trim()).filter((alias) => alias && alias !== name))]
  const freshRelations = Array.isArray(fresh.relations) ? fresh.relations : null
  const relations = (freshRelations ?? base.relations)
    .map((relation) => {
      if (!relation || typeof relation.to !== 'string' || !relation.to.trim()) return null
      return {
        ...relation,
        to: relation.to.trim(),
        stance: String(relation.stance ?? relation.how ?? '').trim()
      }
    })
    .filter(Boolean)
  const chars = Number.isFinite(Number(fresh.chars)) ? Number(fresh.chars) : base.chars
  const revision = Number.isFinite(Number(fresh.revision)) ? Number(fresh.revision) : base.revision
  return {
    ...base,
    name,
    aliases,
    relations,
    chars,
    revision,
    type: fresh.type || base.type,
    contract: fresh.contract === false ? false : base.contract,
    path: fresh.path || base.path,
    sourcePath: fresh.path || base.sourcePath,
    definition: typeof fresh.summary === 'string' && fresh.summary ? fresh.summary : base.definition,
    summary: typeof fresh.summary === 'string' && fresh.summary ? fresh.summary : base.summary
  }
})

const infoboxFields = computed(() => hubInfoboxFields(infoboxEntry.value))
const infoboxDetailFields = computed(() => infoboxFields.value.filter((field) => field.key !== 'category'))
const infoboxRelations = computed(() => infoboxEntry.value?.relations ?? [])

function relationDetail(relation) {
  return [relation?.type, relation?.stance]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}

/** 关系目标 → hub 链接表（唯一归属才染蓝）；同名多归属／未收录的灰显，说明原因。 */
function relationTarget(name) {
  return hubModel.value.linkTable.resolve(name)
}
function relationMissingHint(name) {
  const owners = hubModel.value.linkTable.byExactName.get(String(name ?? '').trim()) ?? []
  return owners.length > 1 ? '多条同名条目，未链接' : '当前世界书里没有这条条目'
}
function openRelationTarget(name) {
  const target = relationTarget(name)
  if (target) openEntry(target)
}

const infoboxTier = computed(() => {
  if (!infoboxEntry.value) return null
  const count = inboundOf(infoboxEntry.value)
  return { tier: tierOf(count), letter: TIER_LABELS[tierOf(count)], count }
})
</script>

<template>
  <section class="nx-entries-board" data-test="entries-board">
    <div ref="colsRef" class="nx-wiki-cols" data-test="entries-wiki-cols" :class="{ 'is-infobox-collapsed': infoboxCollapsed }">
      <!-- ① 左条目树（≈260px）：layer → domain → 槽位 → 条目，每级带条目数；行前缀层级 dot。 -->
      <div class="nx-wiki-tree" data-test="entries-tree-col">
        <header class="nx-entries-board-head">
          <!-- 视图切换：中栏在 阅读／表格／图谱 之间循环。 -->
          <button
            type="button"
            class="control-quiet nx-entries-view-toggle"
            data-test="entries-view-toggle"
            :aria-label="VIEW_TOGGLE[view].aria"
            :aria-pressed="(view !== 'list').toString()"
            :title="VIEW_TOGGLE[view].title"
            @click="toggleView"
          >{{ VIEW_TOGGLE[view].label }}</button>
          <input
            v-model="filter"
            class="nx-field nx-entries-filter"
            data-test="entries-filter-input"
            placeholder="筛选：名称／别名／摘要"
            aria-label="筛选条目"
          >
          <select
            v-model="catFilter"
            class="nx-field nx-entries-cat-filter"
            data-test="entries-filter-category"
            aria-label="按槽位筛选"
          >
            <option v-for="option in groupOptions" :key="option.value || '__all'" :value="option.value">{{ option.label }}</option>
          </select>
          <!-- 新建条目（批次60）：类别下拉＋标题输入，回车或点「新建」落盘。 -->
          <span class="nx-entries-new">
            <select
              v-model="newCat"
              class="nx-field nx-entries-new-cat"
              data-test="entries-new-category"
              aria-label="新条目类别"
            >
              <option v-for="option in createCategoryOptions" :key="option.value || '__top'" :value="option.value">{{ option.label }}</option>
            </select>
            <input
              v-model="newTitle"
              class="nx-field nx-entries-new-title"
              data-test="entries-new-title"
              placeholder="新建条目名"
              aria-label="新条目名"
              @keydown.enter.prevent="submitNewEntry"
            >
            <button
              type="button"
              class="control-quiet nx-entries-new-submit"
              data-test="entries-new-submit"
              :disabled="!newTitle.trim()"
              @click="submitNewEntry"
            >新建</button>
          </span>
        </header>
        <div class="nx-wiki-tree-body">
          <section v-for="layer in visibleLayers" :key="layer.layer" class="nx-hub-layer" :data-layer="layer.layer">
            <p class="workspace-nav-section nx-hub-layer-head" data-test="entry-layer">
              {{ layer.label }}<span class="nx-hub-count"> · {{ layer.count }}</span>
            </p>
            <template v-for="domainInfo in layer.domains" :key="`${layer.layer}:${domainInfo.key || '__nodomain'}`">
              <p class="nx-hub-domain-head" data-test="entry-domain">
                {{ domainInfo.label }}<span class="nx-hub-count"> · {{ domainInfo.count }}</span>
              </p>
              <template v-for="group in domainInfo.groups" :key="`${layer.layer}:${domainInfo.key}:${group.key}`">
                <p class="workspace-nav-section nx-entry-category" data-test="entry-category">
                  {{ group.label }}<span class="nx-hub-count"> · {{ group.count }}</span>
                </p>
                <ul class="nx-tree">
                  <li v-for="item in group.entries" :key="item.id" class="nx-tree-line">
                    <button
                      type="button"
                      class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
                      :class="{ 'is-active': isEntryOpen(item) }"
                      :aria-current="isEntryOpen(item) ? 'page' : null"
                      :title="rowHint(item)"
                      @click="openEntry(item)"
                    >
                      <i
                        class="nx-wiki-lvl-dot"
                        :class="`is-${tierOf(inboundOf(item))}`"
                        :title="lvlTitle(item)"
                        aria-hidden="true"
                      ></i>
                      <span class="workspace-nav-label">{{ item.name }}</span>
                    </button>
                    <button
                      type="button"
                      class="nx-row nx-entries-history"
                      :aria-label="`「${item.name}」的历史`"
                      @click.stop="emit('history', item.item ?? item)"
                    >
                      <WorkbenchIcon name="history" :size="14" />
                    </button>
                  </li>
                </ul>
              </template>
            </template>
            <!-- 人物／剧情占位组：小说／剧本结构锚点，惰性（不接线），数量如实。 -->
            <template v-for="placeholder in layer.placeholders" :key="placeholder.key">
              <p class="workspace-nav-section nx-entry-category nx-hub-placeholder" data-test="entry-placeholder">
                {{ placeholder.label }}<span class="nx-hub-count"> · {{ placeholder.count }}</span>
              </p>
              <p class="nx-hub-placeholder-hint">{{ placeholder.hint }}</p>
            </template>
          </section>
          <p v-if="!visibleEntries.length && !props.data.busy && !props.data.treeError" class="nx-index-empty">
            {{ hubModel.entries.length ? '没有条目命中这一道筛选。' : '这一栏还没有条目。' }}
          </p>
        </div>
      </div>

      <!-- ② 中央阅读列（1fr）：阅读是常态，表格／图谱是切换态。 -->
      <div class="nx-wiki-center" data-test="entries-center-col">
        <!-- 表格（批次36 · 任务一）：可排序列头 ＋ 按槽位分组（组头带条数）。 -->
        <table v-if="view === 'table' && visibleEntries.length" class="nx-entries-table" data-test="entries-table">
          <thead>
            <tr>
              <th v-for="column in ENTRY_COLUMNS" :key="column.key" scope="col">
                <button
                  type="button"
                  class="control-quiet nx-entries-sort"
                  :data-test="`entries-sort-${column.key}`"
                  :aria-label="`按${column.label}排序`"
                  @click="toggleSort(column.key)"
                >{{ column.label }}<span v-if="sortIndicator(column.key)" class="nx-entries-sort-mark" aria-hidden="true">{{ sortIndicator(column.key) }}</span></button>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="group in tableGroups" :key="group.key">
              <tr class="nx-entries-group-row" data-test="entries-table-group">
                <td colspan="6">{{ group.label }}<span class="nx-entries-group-count"> · {{ group.entries.length }} 条</span></td>
              </tr>
              <tr
                v-for="item in group.entries"
                :key="item.id"
                class="nx-entries-row"
                :class="{ 'is-active': isEntryOpen(item) }"
                :aria-current="isEntryOpen(item) ? 'page' : null"
                tabindex="0"
                @click="openEntry(item)"
                @keydown.enter.prevent="openEntry(item)"
              >
                <td class="nx-entries-name">{{ item.name }}</td>
                <td class="nx-entries-cat">{{ item.cat || '—' }}</td>
                <td>{{ item.type }}</td>
                <td class="nx-entries-keys">{{ (item.aliases ?? []).join('、') }}</td>
                <td class="nx-entries-chars">{{ item.chars }}</td>
                <td class="nx-entries-summary">{{ clipEntrySummary(item.summary) }}</td>
              </tr>
            </template>
          </tbody>
        </table>

        <!-- 图谱态（批次36 · 任务二）：整书大图在中栏；信息卡的小图此时让位。 -->
        <EntryGraph
          v-else-if="view === 'graph' && visibleEntries.length"
          :entries="visibleEntries"
          @open="openEntry"
        />

        <!-- 阅读态（批次68-R2）：条目详情面的 wiki 皮——名＝大标题、h2 底线、导语、蓝链胶囊。 -->
        <EntryDetailPanel
          v-else
          :data="data"
          :hub="hubModel"
          :chip="chip"
          :chip-visible="chipVisible"
          :chip-stale="chipStale"
          :chip-text="chipText"
          wiki
          empty-hint="从左边条目树里选一条条目。"
          @chip-action="emit('chip-action')"
        />
      </div>

      <!-- ③ 右信息卡（min(46%,430px)）：hub 字段＋关系列表＋图谱（底部 260px）。可一钮收起。 -->
      <aside v-if="data.entry || infoboxCollapsed" class="nx-wiki-infobox" :class="{ 'is-collapsed': infoboxCollapsed }" data-test="entries-infobox">
        <button
          v-if="infoboxCollapsed"
          type="button"
          class="control-quiet nx-wiki-infobox-expand"
          data-test="entries-infobox-expand"
          aria-label="展开条目信息"
          @click="infoboxCollapsed = false; userToggledInfobox = true"
        >展开条目信息</button>
        <template v-else>
          <header class="nx-wiki-infobox-head">
            <span class="nx-wiki-infobox-caption">条目信息</span>
            <button
              type="button"
              class="control-quiet nx-wiki-infobox-collapse"
              data-test="entries-infobox-collapse"
              aria-label="收起条目信息"
              @click="infoboxCollapsed = true; userToggledInfobox = true"
            >收起</button>
          </header>
          <dl class="nx-wiki-infobox-rows">
            <dt>类别</dt>
            <dd><span class="nx-wiki-infobox-badge" data-test="infobox-category">{{ infoboxEntry?.groupLabel || '顶层' }}</span></dd>
            <dt>层级</dt>
            <dd v-if="infoboxTier" data-test="infobox-tier">
              <span class="nx-wiki-infobox-tier">
                <i class="nx-wiki-lvl-dot" :class="`is-${infoboxTier.tier}`" aria-hidden="true"></i>
                <span>{{ infoboxTier.letter }} · 被引用 {{ infoboxTier.count }} 次</span>
                <span class="nx-wiki-infobox-hint">按被引用次数统计</span>
              </span>
            </dd>
            <template v-for="field in infoboxDetailFields" :key="field.key">
              <dt>{{ field.label }}</dt>
              <dd :data-test="`infobox-${field.key}`">
                <span v-if="field.key === 'source'" class="nx-wiki-infobox-provenance">{{ field.value }}</span>
                <template v-else>{{ field.value }}</template>
              </dd>
            </template>
          </dl>
          <!-- 关系列表（与 EntryGraph 同一数据源 relations[].to；没有关系就不摆这块）。 -->
          <div v-if="!data.editingEntry && infoboxRelations.length" class="nx-wiki-infobox-relations">
            <p class="nx-wiki-infobox-subhead">关系</p>
            <ul class="entry-relations-read" data-test="entry-relations-read">
              <li v-for="(relation, index) in infoboxRelations" :key="`infobox-rel-${index}`"><a v-if="relationTarget(relation.to)" class="nx-wikilink" :data-entry="relation.to" href="#" @click.prevent="openRelationTarget(relation.to)">{{ relation.to }}</a><span v-else class="wl-missing" :title="relationMissingHint(relation.to)">{{ relation.to }}</span><span v-if="relationDetail(relation)"> · {{ relationDetail(relation) }}</span></li>
            </ul>
          </div>
          <!-- 图谱缩览（底部 260px）：数据源仍是这份 hub entries，0 边如实文案由 EntryGraph 自己守。 -->
          <div v-if="view !== 'graph' && hubModel.entries.length" class="nx-wiki-infobox-graph" data-test="infobox-graph">
            <p class="nx-wiki-infobox-subhead">关系图</p>
            <EntryGraph variant="infobox" :entries="hubModel.entries" @open="openEntry" />
          </div>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
/* 看板区：三栏排版本身住在 next-shell.css（.nx-wiki-* 是布局层词汇）；
   这里只留表格／排序／行控件与 hub 树头自己的度量。
   颜色全走 token；字号走 --nx-fs-* 刻度；其余 px 都是布局尺寸。 */
.nx-entries-board {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.nx-entries-board-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  row-gap: 6px;
  flex: none;
  margin: 0 0 6px;
}

.nx-entries-view-toggle {
  flex: none;
  min-width: 30px;
}

/* —— hub 分层树（W3）：层头／域头／槽位头三级；计数走 tabular-nums，不在正文里再念一遍 ——— */
.nx-hub-layer + .nx-hub-layer {
  margin-top: 10px;
}
.nx-hub-layer-head {
  margin: 0 0 2px;
  color: var(--archive-ink);
  font-weight: 600;
}
.nx-hub-domain-head {
  margin: 0 0 2px 10px;
  font-size: var(--nx-fs-2xs);
  font-weight: 500;
  color: var(--archive-ink-soft);
}
/* 组头（槽位/组名＋计数）：比层头轻一档的度量，语义与计数不动（批次 W4 只收行高）。 */
.nx-entry-category {
  margin: 6px 0 2px;
  font-size: var(--nx-fs-2xs);
  font-weight: 500;
  color: var(--archive-ink-soft);
}
.nx-hub-count {
  color: var(--text-muted);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.nx-hub-placeholder-hint {
  margin: 0 0 4px 10px;
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  color: var(--text-muted);
}

/* 条目表格：列宽按内容伸缩，摘要列吃掉剩余宽度；行仍是「点一下打开条目」那件事。 */
.nx-entries-table {
  width: 100%;
  margin: 0 0 8px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--nx-fs-2xs);
  color: var(--text-primary);
}
.nx-entries-table th {
  padding: 2px 4px;
  text-align: start;
  font-weight: 500;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  border-bottom: 1px solid var(--hairline-soft);
  white-space: nowrap;
}
.nx-entries-table td {
  padding: 3px 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--hairline-soft);
}
/* 列宽（批次34：加了一列「类别」）：名称与关键词各让出一截，摘要仍吃剩余宽度。 */
.nx-entries-table th:nth-child(1) { width: 22%; }
.nx-entries-table th:nth-child(2) { width: 14%; }
.nx-entries-table th:nth-child(3) { width: 12%; }
.nx-entries-table th:nth-child(4) { width: 16%; }
.nx-entries-table th:nth-child(5) { width: 9%; }
.nx-entries-row {
  cursor: pointer;
}
.nx-entries-row:hover td {
  background: var(--nav-hover);
}
.nx-entries-row.is-active td {
  background: var(--nav-selected);
}
.nx-entries-row:focus-visible {
  outline: 2px solid var(--workbench-selected);
  outline-offset: -2px;
}
.nx-entries-name {
  color: var(--archive-ink);
}
.nx-entries-chars {
  font-variant-numeric: tabular-nums;
}
.nx-entries-summary,
.nx-entries-keys {
  color: var(--text-muted);
}
/* 筛选行：文本输入吃剩余宽度，槽位下拉占一小截。 */
.nx-entries-filter {
  flex: 1 1 auto;
  min-width: 0;
}
.nx-entries-cat-filter {
  flex: 0 1 42%;
  min-width: 0;
}
/* 新建组：类别下拉＋标题输入＋「新建」，与筛选行同一套字段度量。 */
.nx-entries-new {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.nx-entries-new-cat {
  width: 84px;
}
.nx-entries-new-title {
  width: 120px;
}
.nx-entries-new-submit {
  flex: none;
}
.nx-entries-board-head .nx-field {
  min-height: 28px;
  padding: 4px 8px;
  font-size: var(--nx-fs-2xs);
}
.nx-entries-table th .nx-entries-sort {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 2px;
  width: 100%;
  /* 〔批次76 任务4-4〕表头这五枚「按 X 排序」实测 20–21 高：宽度吃了 th（width:100%），
     纵向就差那 4px。抬到 24，字号与 padding 不动，表头不会被撑出第二行。 */
  min-height: 24px;
  padding: 0;
  font-size: var(--nx-fs-2xs);
  font-weight: 500;
  color: var(--text-muted);
  text-align: start;
  white-space: nowrap;
}
.nx-entries-table th .nx-entries-sort:hover {
  background: transparent;
  color: var(--archive-ink);
}
.nx-entries-sort-mark {
  flex: none;
  font-size: var(--nx-fs-2xs);
  line-height: 1;
}
/* 组头行：与清单视图的小节头同一语义，样式走表格自己的度量（数字对齐交给 tabular-nums）。 */
.nx-entries-group-row td {
  padding: 6px 4px 2px;
  border-bottom: 1px solid var(--hairline-soft);
  font-size: var(--nx-fs-2xs);
  font-weight: 500;
  color: var(--archive-ink-soft);
  white-space: nowrap;
}
.nx-entries-group-count {
  color: var(--text-muted);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

/* 条目行（批次 W4）：一行一条、无卡片底、行高紧凑；当前条目用令牌色高亮。
   行本身就是按钮（选它＝看它），历史钮只做页内动作。 */
.nx-tree-line {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.nx-tree-line > .nx-tree-item {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 24px;
  padding: 2px 8px;
  border: 0;
  border-radius: var(--nx-radius-xs);
  background: transparent;
  color: var(--archive-ink-soft);
  font-family: var(--font-interface);
  font-size: var(--nx-fs-md);
  line-height: 1.35;
}
.nx-tree-line > .nx-tree-item:hover {
  background: var(--nav-hover);
  color: var(--archive-ink);
}
.nx-tree-line > .nx-tree-item.is-active {
  background: var(--nav-selected);
  color: var(--archive-ink);
  font-weight: 500;
}
.nx-tree-line > .nx-tree-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
/* 长名单行截断；全名在 title 里（rowHint 第一段就是条目名）。 */
.nx-tree-line > .nx-tree-item .workspace-nav-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 行尾历史钮（照索引窗那一枚）：默认不占视觉，hover 这一行或键盘聚焦到它才显形。
   紧凑行高不再沿用 .nx-row 的 42px 行高——命中区 24×24，仍在文档流里、仍可 Tab。 */
.nx-entries-history {
  flex: none;
  justify-content: center;
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  border-radius: var(--nx-radius-xs);
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 120ms ease;
}
.nx-entries-history:hover {
  color: var(--archive-ink);
}
.nx-tree-line:hover .nx-entries-history,
.nx-tree-line:focus-within .nx-entries-history,
.nx-entries-history:focus-visible {
  opacity: 0.85;
}

/* 信息卡内部的小度量（卡的外框在布局层 .nx-wiki-infobox 管）。 */
.nx-wiki-infobox-subhead {
  margin: 10px 0 4px;
  font-size: var(--nx-fs-2xs);
  font-weight: 500;
  color: var(--text-muted);
}
/* 关系目标未收录／同名多归属：灰显＋问号提示，不染成看着能点的蓝。 */
.wl-missing {
  color: var(--text-muted);
  border-bottom: 1px dotted var(--border-strong);
  cursor: help;
}
</style>
