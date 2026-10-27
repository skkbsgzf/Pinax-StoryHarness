<script setup>
import { computed } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { vWorkbenchTooltip } from '../../src/components/workbench/workbenchTooltip.js'

/**
 * 最左一栏：图标竖条（Obsidian 的 ribbon）。
 *
 * 一格＝一块板（一个载体）。点它：右边开出索引窗；再点同一格：索引窗收起。
 * 图标与提示复用老前端本体（WorkbenchIcon / workbenchTooltip），
 * 度量与配色抄老前端 .workspace-activity-bar（src/components/workbench/WorkspaceContentGroups.vue:190-196），
 * 数字由 next/tests/visual-contract.test.mjs 钉住，不许两边各漂各的。
 */
const props = defineProps({
  boards: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
  /** 哪个板块的索引窗正开着（开着的那一格才有展开记号）。 */
  openId: { type: String, default: null },
  scheme: { type: String, default: 'light' }
})
const emit = defineEmits(['select', 'toggle-theme'])

const isDark = computed(() => props.scheme === 'dark')
</script>

<template>
  <nav class="nx-ribbon" aria-label="板块竖条">
    <button
      v-for="board in boards"
      :key="board.id"
      type="button"
      class="nx-ribbon-item"
      :class="{ 'is-active': board.id === activeId }"
      :aria-pressed="board.id === activeId"
      :aria-expanded="board.id === openId"
      aria-controls="nx-index-window"
      :aria-label="board.title"
      v-workbench-tooltip="{ text: board.title, side: 'right' }"
      @click="emit('select', board.id)"
    >
      <WorkbenchIcon :name="board.icon" :size="22" />
    </button>
    <button
      type="button"
      class="nx-ribbon-item is-bottom"
      :aria-pressed="isDark"
      aria-label="切换明暗主题"
      v-workbench-tooltip="{ text: isDark ? '切到明亮' : '切到深色', side: 'right' }"
      @click="emit('toggle-theme')"
    >
      <WorkbenchIcon :name="isDark ? 'sun' : 'moon'" :size="20" />
    </button>
  </nav>
</template>
