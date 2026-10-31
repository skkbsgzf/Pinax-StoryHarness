<script setup>
import { computed } from 'vue'
import { entryCategoryTree } from './entriesView.mjs'

/**
 * 世界书的类别导航树（批次44 · 作者 2026-10-31：「图表列的切换全都挤在左侧小区域里进行」）。
 *
 * 窄栏这一格现在只干一件事：**按类别找条目**。
 * 图表列（列表／表格／图谱）搬去了核心区的看板区，窄栏不再摊表格与图谱——
 * 表格与图谱挤在两百多像素宽的窄栏里，右侧大片留白，两头都不好用。
 *
 * 点一个类别＝给看板区加一道筛选（与看板区里那个类别下拉共用 data.entriesFilterCat 一格）。
 */
const props = defineProps({
  /** useBoardData 的返回值。 */
  data: { type: Object, required: true }
})

const nodes = computed(() => entryCategoryTree(props.data.entries ?? [], props.data.categories))

/** 当前筛选的类别（空串＝不过滤）。 */
const activeCat = computed(() => String(props.data.entriesFilterCat ?? ''))

function isActive(node) {
  return activeCat.value === (node.name === '__all' ? '' : node.name)
}

function pick(node) {
  props.data.setEntriesFilterCat?.(node.name === '__all' ? '' : node.name)
}
</script>

<template>
  <ul class="nx-tree nx-entry-cats" data-test="entry-category-tree">
    <li v-for="node in nodes" :key="node.name || '__all'" class="nx-tree-line">
      <button
        type="button"
        class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item nx-entry-cat-row"
        :class="{ 'is-active': isActive(node) }"
        :aria-current="isActive(node) ? 'page' : null"
        :data-test="`entry-cat-${node.name || 'all'}`"
        @click="pick(node)"
      >
        <span class="workspace-nav-label">{{ node.label }}</span>
        <span class="nx-entry-cat-count">{{ node.count }}</span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
/* 类别行：左边名字，右边条数（跟老前端目录树同一档度量）。 */
.nx-entry-cat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nx-entry-cat-count {
  flex: none;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
