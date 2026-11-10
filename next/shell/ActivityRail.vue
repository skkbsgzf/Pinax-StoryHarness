<script setup>
import { computed } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { vWorkbenchTooltip } from '../../src/components/workbench/workbenchTooltip.js'

/**
 * 最左一栏：图标竖条（Obsidian 的 ribbon）。
 *
 * 有项目：一格＝一块板（一个载体）。点它：右边开出索引窗；再点同一格：索引窗收起。
 * 无项目（作者 2026-11-11 裁定：原「载体格禁用态」很诡异——「没有项目的时候，左侧弄很多
 * 灰的不可用载体就很诡异」，11 个灰格是提前展示未来才存在的东西）：只留「新建项目…」（主操作）
 * 与「打开项目…」两枚动作，底部照旧留主题钮。动作只上报事件——通道调用与弹窗落点仍在
 * AppNext（与菜单同一条分发）。
 *
 * 图标与提示复用老前端本体（WorkbenchIcon / workbenchTooltip），
 * 度量与配色抄老前端 .workspace-activity-bar（src/components/workbench/WorkspaceContentGroups.vue:190-196）。
 */
const props = defineProps({
  boards: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
  /** 哪个板块的索引窗正开着（开着的那一格才有展开记号）。 */
  openId: { type: String, default: null },
  scheme: { type: String, default: 'light' },
  /** 已打开的项目；null／缺省＝无项目形态（只有新建／打开两枚动作）。 */
  project: { type: Object, default: null },
  /**
   * 载体 id → { color, unackedNotices }（批次49，服务与通知池的行色）。
   * 没声明的载体不在表里——没有服务／MCP 的板不画点。
   */
  serviceStatus: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['select', 'toggle-theme', 'open-project', 'new-project'])

const isDark = computed(() => props.scheme === 'dark')
</script>

<template>
  <nav class="nx-ribbon" aria-label="板块竖条">
    <template v-if="project">
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
        @contextmenu.prevent
      >
        <WorkbenchIcon :name="board.icon" :size="22" />
        <!-- 服务状态点（批次49）：只在载体声明了服务／外部 MCP 时出现；颜色语义见 serviceLogPool 头注释。 -->
        <span
          v-if="serviceStatus[board.id]?.color"
          class="nx-rail-status-dot"
          :class="`is-${serviceStatus[board.id].color}`"
          :data-status="serviceStatus[board.id].color"
          aria-hidden="true"
        />
      </button>
    </template>

    <!-- 无项目形态（作者 2026-11-11 裁定）：新建为主操作，打开为次操作；灰载体格退役。 -->
    <template v-else>
      <button
        type="button"
        class="nx-ribbon-item"
        aria-label="新建项目…"
        v-workbench-tooltip="{ text: '新建项目…', side: 'right' }"
        @click="emit('new-project')"
      >
        <WorkbenchIcon name="plus" :size="20" />
      </button>
      <button
        type="button"
        class="nx-ribbon-item"
        aria-label="打开项目…"
        v-workbench-tooltip="{ text: '打开项目…', side: 'right' }"
        @click="emit('open-project')"
      >
        <WorkbenchIcon name="folder-open" :size="20" />
      </button>
    </template>

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
