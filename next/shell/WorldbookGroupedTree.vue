<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { entrySegmentCount, entrySegmentLabel, groupedEntryList } from './entriesGroupedList.mjs'

/**
 * 世界书板的左栏（工单 P3）：搜索＋「关系图谱」组头＋按 type 分组的分组列表。
 *
 * 形态口径照作者原型（D:\Pinax-e2e\proto-v1\pinax-writing-screen.html 左栏）：
 *   [搜索条目…]
 *   关系图谱            N 节点
 *   人物                3
 *     林砚              16 段
 *     …
 * 分组键与段数口径都写在 entriesGroupedList.mjs 的文件头（纯函数，node 轨可直测）；
 * 这里只负责画与三次交互：搜索框过滤、组头折叠、点条目走既有 openEntry。
 *
 * 折叠态是这一栏自己的临时状态（组件存活期间有效），不写 localStorage——
 * 重启后一律按「全部展开」起步，不在任何存储里留第二份视图记忆。
 *
 * 「关系图谱」组头只上报意图（emit open-graph）。三态视图（list/table/graph）
 * 与它的持久化归核心区看板区（EntriesBoard），索引窗不另记一份。
 */
const props = defineProps({
  /** useBoardData 的返回值（entries／selection／openEntry／tool 都在这上面）。 */
  data: { type: Object, required: true }
})
const emit = defineEmits(['open-graph'])

const search = ref('')
/** 收起的组名（人话组名，如「人物」）。会话内记忆：不落盘。 */
const collapsedGroups = reactive(new Set())

const model = computed(() => groupedEntryList(props.data.entries ?? [], {
  text: search.value,
  collapsed: [...collapsedGroups]
}))

function toggleGroup(key) {
  if (collapsedGroups.has(key)) collapsedGroups.delete(key)
  else collapsedGroups.add(key)
}

/* —— 段数：列表工具不带正文，缺 content/segs 的条目按 path 懒读一次 ——
 * 读结果按「路径#修订号」缓存：保存后修订号变了会重新取，同一份清单不会重复读。
 * 并发封顶 4，避免一次展开几百条时把运行时通道打满；读失败不摆数字（不知道≠零段）。 */
const segmentContent = reactive(new Map())
const segmentQueue = new Set()
let activeReads = 0
let disposed = false
const MAX_ACTIVE_READS = 4
onBeforeUnmount(() => { disposed = true })

function entryCacheKey(entry) {
  const locator = String(entry?.path ?? entry?.id ?? entry?.name ?? '')
  return `${locator}#${entry?.revision ?? ''}`
}

function segmentLabelOf(entry) {
  if (entrySegmentCount(entry) !== null) return entrySegmentLabel(entry)
  const key = entryCacheKey(entry)
  const cached = segmentContent.get(key)
  if (typeof cached === 'string') return entrySegmentLabel({ content: cached })
  if (cached === false) return ''
  queueSegment(entry, key)
  return ''
}

/** 行读数在渲染前算一次，模板里不用为同一行调两遍。 */
const segmentLabels = computed(() => {
  const labels = new Map()
  for (const entry of props.data.entries ?? []) labels.set(entryCacheKey(entry), segmentLabelOf(entry))
  return labels
})

function queueSegment(entry, key) {
  if (disposed || !entry?.path || segmentQueue.has(key) || segmentContent.has(key)) return
  if (typeof props.data.tool !== 'function') return
  segmentQueue.add(key)
  void pumpSegments()
}

async function pumpSegments() {
  while (!disposed && activeReads < MAX_ACTIVE_READS) {
    const key = segmentQueue.values().next().value
    if (!key) return
    segmentQueue.delete(key)
    const entry = (props.data.entries ?? []).find((item) => entryCacheKey(item) === key)
    if (!entry?.path) continue
    activeReads += 1
    props.data.tool('pinax_worldbook_read', { path: entry.path })
      .then((read) => {
        if (!disposed) segmentContent.set(key, read?.ok ? String(read.value?.entry?.content ?? '') : false)
      })
      .catch(() => {
        if (!disposed) segmentContent.set(key, false)
      })
      .finally(() => {
        activeReads -= 1
        if (!disposed) void pumpSegments()
      })
  }
}

/* —— 交互 —— */

function openGraph() {
  emit('open-graph')
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
  props.data.openEntry?.(entry)
}
</script>

<template>
  <div class="nx-grouped" data-test="worldbook-grouped-tree">
    <input
      v-model="search"
      class="nx-field nx-grouped-search"
      data-test="worldbook-grouped-search"
      type="search"
      placeholder="搜索条目…"
      aria-label="搜索条目"
      spellcheck="false"
    >

    <button
      type="button"
      class="workspace-nav-item workspace-nav-item--tree nx-grouped-graph"
      data-test="worldbook-group-graph"
      @click="openGraph"
    >
      <span class="workspace-nav-label">关系图谱</span>
      <span class="nx-grouped-count">{{ model.graph.count }} 节点</span>
    </button>

    <section v-for="group in model.groups" :key="group.key" class="nx-grouped-group">
      <button
        type="button"
        class="workspace-nav-item workspace-nav-item--tree nx-grouped-head"
        data-test="worldbook-group"
        :data-group="group.key"
        :aria-expanded="(!group.collapsed).toString()"
        @click="toggleGroup(group.key)"
      >
        <WorkbenchIcon
          :name="group.collapsed ? 'chevron-right' : 'chevron-down'"
          :size="12"
          class="nx-grouped-chevron"
        />
        <span class="workspace-nav-label">{{ group.label }}</span>
        <span class="nx-grouped-count">{{ group.count }}</span>
      </button>
      <ul v-if="!group.collapsed" class="nx-tree nx-grouped-list">
        <li v-for="entry in group.entries" :key="entry.id ?? entry.path ?? entry.name" class="nx-tree-line">
          <button
            type="button"
            class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-grouped-row"
            data-test="worldbook-entry-row"
            :data-entry="entry.name"
            :class="{ 'is-active': isEntryOpen(entry) }"
            :aria-current="isEntryOpen(entry) ? 'page' : null"
            :title="entry.name"
            @click="openEntry(entry)"
          >
            <span class="workspace-nav-label">{{ entry.name }}</span>
            <span
              v-if="segmentLabels.get(entryCacheKey(entry))"
              class="nx-grouped-segs"
              data-test="worldbook-entry-segs"
            >{{ segmentLabels.get(entryCacheKey(entry)) }}</span>
          </button>
        </li>
      </ul>
    </section>

    <!-- 零条目那一屏归索引窗的区头（它带着「新建条目」主操作钮）；这里只说搜索没命中。 -->
    <p v-if="model.total > 0 && !model.matched" class="nx-index-empty" data-test="worldbook-grouped-empty">没有匹配的条目</p>
  </div>
</template>

<style scoped>
.nx-grouped {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 搜索框：沿用 .nx-field 的字段度量，这里只让它与上下两组留一口气。 */
.nx-grouped-search {
  flex: none;
  width: 100%;
  min-height: 32px;
  margin: 0 0 6px;
  padding: 6px 10px;
  font-size: var(--nx-fs-md);
}

/* 「关系图谱」与每个组头：同一档行，名字吃剩余宽度、读数靠右。 */
.nx-grouped-graph,
.nx-grouped-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 30px;
  padding: 3px 10px;
  text-align: left;
}

.nx-grouped-graph {
  font-weight: 500;
}

.nx-grouped-graph .workspace-nav-label,
.nx-grouped-head .workspace-nav-label,
.nx-grouped-row .workspace-nav-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nx-grouped-chevron {
  flex: none;
  color: var(--text-muted);
}

.nx-grouped-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* 条目行：比组头缩进一档，行高仍走老版 --tree 的 36px 档。 */
.nx-grouped-row {
  justify-content: flex-start;
  padding: 3px 10px 3px 24px;
}

.nx-grouped-count,
.nx-grouped-segs {
  flex: none;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
