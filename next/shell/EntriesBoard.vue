<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import EntryDetailPanel from './EntryDetailPanel.vue'
import EntryGraph from './EntryGraph.vue'
import { computeBacklinks } from './wikiLinks.mjs'
import {
  ENTRY_COLUMNS,
  clipEntrySummary,
  entryCategoryTree,
  filterEntries,
  groupEntriesByCat,
  nextEntriesView,
  readEntriesView,
  sortEntriesBy,
  writeEntriesView
} from './entriesView.mjs'

/**
 * 世界书看板区（批次68-R2 · 任务二：从「图表列＋详情」两块板改成**三栏维基阅读版**）。
 *
 * 版式口径（工单死口径，参照 NovelPedia demo）：树 : 阅读 : 条目信息卡 起排
 * `260px : 1fr : min(46%, 430px)`；窄窗口时信息卡折到阅读列下方（@media）。
 *   ① 左条目树＝按类别分组的条目清单（列表视图的化身），每行前缀一枚层级 dot；
 *   ② 中央阅读列＝选中条目的 wiki 阅读版式（EntryDetailPanel wiki 态）；
 *      表格／图谱两态仍在——切换钮把中栏在「阅读／表格／图谱」之间循环；
 *   ③ 右信息卡＝条目元信息（类别徽章、层级 dot、字数、修订、类型、来源如实）
 *      ＋ 关系列表 ＋ 图谱 svg（底部 260px，数据源与 EntryGraph 同一份 entries）。
 *
 * 三条纪律一个字没动：
 *   1) 三态视图记忆按项目根落 localStorage（键 entriesView.<projectRoot>，照 paneForm 先例）；
 *   2) 筛选、排序、层级 dot 都是纯前端的事，数据源仍是 data.entries／data.entry（不新增工具调用）；
 *   3) 类别筛选与窄栏的类别树共用 data.entriesFilterCat 一格——两边不各记一份。
 *
 * 层级 dot 的诚实口径（工单要「权重 lvl-dot」，红线不许给条目加字段）：
 *   数据里没有作者声明的权重，dot 一律按**被引用次数**（computeBacklinks，relations 与正文提及）
 *   统计分档，文案里写明「统计」；档位边界 6/3/1 只是视觉分档，不是放行闸，也不冒充作者意图。
 */
const props = defineProps({
  /** useBoardData 的返回值：看板区与详情区看的是同一份数据。 */
  data: { type: Object, required: true },
  /** 当前项目根：只用来拼视图记忆的 localStorage 键。 */
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

/** 类别筛选与窄栏的类别树共用这一格（useBoardData 的 entriesFilterCat）。 */
const catFilter = computed({
  get: () => String(props.data.entriesFilterCat ?? ''),
  set: (value) => props.data.setEntriesFilterCat?.(value)
})

/** 类别下拉的选项：既有类别按声明序／出现序排（与类别树同一份顺序）。 */
const categoryOptions = computed(() => entryCategoryTree(props.data.entries ?? [], props.data.categories)
  .filter((node) => node.name !== '__all')
  .map((node) => ({ value: node.name, label: node.label })))

/**
 * 新建条目（批次60 · 工单任务一）：批次59 下线左栏新建入口后，新建搬回看板区工具条——
 * 类别下拉＋标题输入，落盘仍走既有 createEntry（世界书/<类别>/<名称>.md）。
 * 类别下拉的清空项是「顶层」，与没有类别目录的旧项目同一落点。
 */
const newTitle = ref('')
const newCat = ref('')
const createCategoryOptions = computed(() => [
  { value: '', label: '顶层' },
  ...categoryOptions.value
])
async function submitNewEntry() {
  const title = newTitle.value.trim()
  if (!title) return
  await props.data.createEntry?.(title, newCat.value)
  newTitle.value = ''
}

/** 筛完的条目：类别精确匹配 ＋ 文本对名称／关键词／摘要做包含匹配。 */
const visibleEntries = computed(() => filterEntries(props.data.entries ?? [], {
  text: filter.value,
  cat: catFilter.value
}))

/** 分组（类别）＋ 组内排序：分组是第一维，排序是组内第二维。 */
const groups = computed(() => groupEntriesByCat(visibleEntries.value, props.data.categories)
  .map((group) => ({ ...group, items: sortEntriesBy(group.items, sort.value) })))

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

function isEntryOpen(item) {
  return props.data.selection?.type === 'entry' && props.data.selection.item?.path === item.path
}

function openEntry(item) {
  void props.data.openEntry?.(item)
}

/** 行的悬停提示：路径 · 版本 · 字数 · 是否建档（批次33 的 IDE 化口径，行上只留名字＋层级 dot）。 */
function rowHint(item) {
  const parts = []
  const file = String(item?.file ?? item?.path ?? '').trim()
  if (file) parts.push(file)
  if (Number.isFinite(Number(item?.revision))) parts.push(`第 ${item.revision} 版`)
  const chars = item?.totalChars ?? item?.chars
  if (Number.isFinite(Number(chars))) parts.push(`${chars} 字`)
  if (item?.contract === false) parts.push('未建档')
  return parts.join(' · ')
}

/* —— 层级 dot（统计口径，见头注）—————————————————————————————————————— */
/** 每条目的被引用次数（inbound，relations 与正文提及都算——与反向链接同一个 computeBacklinks）。 */
const inboundCounts = computed(() => {
  const entries = props.data.entries ?? []
  const byPath = new Map()
  for (const entry of entries) {
    if (!entry) continue
    byPath.set(entry.path, computeBacklinks(entries, entry.name, entry.path).length)
  }
  return byPath
})

const TIER_LABELS = { s: 'S', a: 'A', b: 'B', c: 'C' }
function tierOf(count) {
  if (count >= 6) return 's'
  if (count >= 3) return 'a'
  if (count >= 1) return 'b'
  return 'c'
}
function inboundOf(item) {
  return inboundCounts.value.get(item?.path) ?? 0
}
function lvlTitle(item) {
  const count = inboundOf(item)
  return `被引用 ${count} 次 · 层级 ${TIER_LABELS[tierOf(count)]}（按被引用次数统计）`
}

/* —— 信息卡读数（全部来自 data.entry 的真字段，缺了就不摆那一行） ——————————— */
const infoboxRelations = computed(() => (Array.isArray(props.data.entry?.relations) ? props.data.entry.relations : [])
  .filter((relation) => typeof relation?.to === 'string' && relation.to.trim()))
function relationLine(relation) {
  return [relation?.to, relation?.type, relation?.stance]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}
const infoboxChars = computed(() => {
  const entry = props.data.entry
  const value = entry?.chars ?? entry?.totalChars ?? entry?.contentChars
  return Number.isFinite(Number(value)) ? `${value} 字` : ''
})
const infoboxRevision = computed(() => {
  const value = props.data.entry?.revision
  return Number.isFinite(Number(value)) ? `第 ${value} 版` : ''
})
const infoboxTier = computed(() => {
  if (!props.data.entry) return null
  const count = inboundOf(props.data.entry)
  return { tier: tierOf(count), letter: TIER_LABELS[tierOf(count)], count }
})
</script>

<template>
  <section class="nx-entries-board" data-test="entries-board">
    <div ref="colsRef" class="nx-wiki-cols" data-test="entries-wiki-cols" :class="{ 'is-infobox-collapsed': infoboxCollapsed }">
      <!-- ① 左条目树（≈260px）：按类别分组，行前缀层级 dot（统计口径）。 -->
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
            placeholder="筛选：名称／关键词／摘要"
            aria-label="筛选条目"
          >
          <select
            v-model="catFilter"
            class="nx-field nx-entries-cat-filter"
            data-test="entries-filter-category"
            aria-label="按类别筛选"
          >
            <option value="">全部类别</option>
            <option v-for="option in categoryOptions" :key="option.value || '__uncat'" :value="option.value">{{ option.label }}</option>
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
          <template v-if="visibleEntries.length">
            <template v-for="group in groups" :key="group.name || '__uncategorized'">
              <p v-if="group.label" class="workspace-nav-section nx-entry-category" data-test="entry-category">{{ group.label }}</p>
              <ul class="nx-tree">
                <li v-for="item in group.items" :key="item.path" class="nx-tree-line">
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
                    @click.stop="emit('history', item)"
                  >
                    <WorkbenchIcon name="history" :size="14" />
                  </button>
                </li>
              </ul>
            </template>
          </template>
          <p v-else-if="!props.data.busy && !props.data.treeError" class="nx-index-empty">
            {{ props.data.entries.length ? '没有条目命中这一道筛选。' : '这一栏还没有条目。' }}
          </p>
        </div>
      </div>

      <!-- ② 中央阅读列（1fr）：阅读是常态，表格／图谱是切换态。 -->
      <div class="nx-wiki-center" data-test="entries-center-col">
        <!-- 表格（批次36 · 任务一）：可排序列头 ＋ 按类别分组（组头带条数）。 -->
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
            <template v-for="group in groups" :key="group.name || '__uncategorized'">
              <tr v-if="group.label" class="nx-entries-group-row" data-test="entries-table-group">
                <td colspan="6">{{ group.label }}<span class="nx-entries-group-count"> · {{ group.items.length }} 条</span></td>
              </tr>
              <tr
                v-for="item in group.items"
                :key="item.path"
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
          :chip="chip"
          :chip-visible="chipVisible"
          :chip-stale="chipStale"
          :chip-text="chipText"
          wiki
          empty-hint="从左边条目树里选一条条目。"
          @chip-action="emit('chip-action')"
        />
      </div>

      <!-- ③ 右信息卡（min(46%,430px)）：元信息＋关系列表＋图谱（底部 260px）。可一钮收起。 -->
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
            <dd><span class="nx-wiki-infobox-badge" data-test="infobox-category">{{ data.entry.cat || '顶层' }}</span></dd>
            <dt>层级</dt>
            <dd v-if="infoboxTier" data-test="infobox-tier">
              <span class="nx-wiki-infobox-tier">
                <i class="nx-wiki-lvl-dot" :class="`is-${infoboxTier.tier}`" aria-hidden="true"></i>
                <span>{{ infoboxTier.letter }} · 被引用 {{ infoboxTier.count }} 次</span>
                <span class="nx-wiki-infobox-hint">按被引用次数统计</span>
              </span>
            </dd>
            <template v-if="infoboxChars">
              <dt>字数</dt>
              <dd data-test="infobox-chars">{{ infoboxChars }}</dd>
            </template>
            <template v-if="infoboxRevision">
              <dt>修订</dt>
              <dd data-test="infobox-revision">{{ infoboxRevision }}</dd>
            </template>
            <template v-if="data.entry.type">
              <dt>类型</dt>
              <dd>{{ data.entry.type }}</dd>
            </template>
            <dt>来源</dt>
            <dd><span class="nx-wiki-infobox-provenance" data-test="infobox-provenance">{{ data.entry.contract === false ? '未建档' : '原文' }}</span></dd>
          </dl>
          <!-- 关系列表（与 EntryGraph 同一数据源 relations[].to；没有关系就不摆这块）。 -->
          <div v-if="!data.editingEntry && infoboxRelations.length" class="nx-wiki-infobox-relations">
            <p class="nx-wiki-infobox-subhead">关系</p>
            <ul class="entry-relations-read" data-test="entry-relations-read">
              <li v-for="(relation, index) in infoboxRelations" :key="`infobox-rel-${index}`">{{ relationLine(relation) }}</li>
            </ul>
          </div>
          <!-- 图谱缩览（底部 260px）：数据源仍是这份 entries，0 边如实文案由 EntryGraph 自己守。 -->
          <div v-if="view !== 'graph' && (data.entries ?? []).length" class="nx-wiki-infobox-graph" data-test="infobox-graph">
            <p class="nx-wiki-infobox-subhead">关系图</p>
            <EntryGraph variant="infobox" :entries="data.entries ?? []" @open="openEntry" />
          </div>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
/* 看板区：三栏排版本身住在 next-shell.css（.nx-wiki-* 是布局层词汇）；
   这里只留表格／排序／行控件自己的度量。
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
/* 筛选行：文本输入吃剩余宽度，类别下拉占一小截。 */
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

/* 行尾历史钮（照索引窗那一枚）：默认不占视觉，hover 这一行或键盘聚焦到它才显形。
   opacity 只管看得见与否——按钮始终在文档流里、始终可 Tab 到（无鼠标可达）。 */
.nx-tree-line {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.nx-tree-line > .nx-tree-item {
  flex: 1 1 auto;
  min-width: 0;
}
.nx-entries-history {
  opacity: 0;
  transition: opacity 120ms ease;
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
</style>
