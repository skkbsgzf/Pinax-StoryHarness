<script setup>
import { computed, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import EntryGraph from './EntryGraph.vue'
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
 * 世界书看板区（批次44 · 作者 2026-10-31：「图表列的切换全都挤在左侧小区域里进行，
 * 右侧大面积留空，非常别扭，更合理的一个情况是，上面放图表列，下面放详情信息」）。
 *
 * 这块看板区住在核心区（不再是窄栏里那块挤着的小地方）：
 *   上＝图表列（列表／表格／图谱三态＋筛选），下＝选中条目的详情（由 CarrierPaneHost 拼）。
 * 窄栏（IndexWindow）退成类别导航树——它只管「按类别找条目」，不再摊表格与图谱。
 *
 * 三条纪律：
 *   1) 三态视图记忆按项目根落 localStorage（键 entriesView.<projectRoot>，照 paneForm 先例）；
 *   2) 筛选、排序是纯前端的事，数据源仍是 data.entries（不新增工具调用）；
 *   3) 类别筛选与窄栏的类别树共用 data.entriesFilterCat 一格——两边不各记一份。
 */
const props = defineProps({
  /** useBoardData 的返回值：看板区与详情区看的是同一份数据。 */
  data: { type: Object, required: true },
  /** 当前项目根：只用来拼视图记忆的 localStorage 键。 */
  projectRoot: { type: String, default: '' }
})
const emit = defineEmits(['history'])

/** 三态视图：list（条目清单）→ table（Dataview 式表格）→ graph（关系图谱）。 */
const view = ref('list')
const filter = ref('')
const sort = ref(null)

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

/** 行的悬停提示：路径 · 版本 · 字数 · 是否建档（批次33 的 IDE 化口径，行上只留名字）。 */
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
</script>

<template>
  <section class="nx-entries-board" data-test="entries-board">
    <header class="nx-entries-board-head">
      <!-- 视图切换（批次44：从窄栏搬到看板区头上——切换在它自己该在的地方） -->
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
    </header>

    <div class="nx-entries-board-body">
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

      <!-- 图谱（批次36 · 任务二）：节点＝条目，边＝relations[].to；点节点打开条目。 -->
      <EntryGraph
        v-else-if="view === 'graph' && visibleEntries.length"
        :entries="visibleEntries"
        @open="openEntry"
      />

      <!-- 清单：按类别分组，组头带条数。 -->
      <template v-else-if="visibleEntries.length">
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
                <span class="workspace-nav-label">{{ item.name }}</span>
              </button>
              <!-- 历史（窄栏那版行尾的那枚钮搬过来了：条目挪到核心区，入口跟着走）。 -->
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
  </section>
</template>

<style scoped>
/* 看板区：一块有边界的区域，表格／图谱在里面滚，详情区在它下面。
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
  gap: 6px;
  flex: none;
  margin: 0 0 6px;
}

.nx-entries-view-toggle {
  flex: none;
  min-width: 30px;
}

.nx-entries-board-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
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
  min-height: 20px;
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
</style>
