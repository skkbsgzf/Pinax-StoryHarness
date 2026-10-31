<script setup>
import { computed } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { vWorkbenchTooltip } from '../../src/components/workbench/workbenchTooltip.js'

/**
 * 最左一栏：图标竖条（Obsidian 的 ribbon）。
 *
 * 有项目：一格＝一块板（一个载体）。点它：右边开出索引窗；再点同一格：索引窗收起。
 * 无项目（工单F · 作者反馈③「没有项目的情况下，左边的按钮也给我弄没了」）：
 * 载体清单来自 registry.list()（与「有没有打开项目」无关，见 next/shell/ipcContract.mjs 的
 * carriers 分支），画成禁用格（tooltip「打开项目后可用」）；顶部再加「打开项目…」「新建项目…」
 * 两枚动作，底部照旧留主题钮。动作只上报事件——通道调用与弹窗落点仍在 AppNext（与菜单同一条分发）。
 *
 * 图标与提示复用老前端本体（WorkbenchIcon / workbenchTooltip），
 * 度量与配色抄老前端 .workspace-activity-bar（src/components/workbench/WorkspaceContentGroups.vue:190-196），
 * 数字由 next/tests/visual-contract.test.mjs 钉住，不许两边各漂各的。
 */
const props = defineProps({
  boards: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
  /** 哪个板块的索引窗正开着（开着的那一格才有展开记号）。 */
  openId: { type: String, default: null },
  scheme: { type: String, default: 'light' },
  /** 已打开的项目；null／缺省＝无项目形态（载体格禁用 + 打开／新建动作）。 */
  project: { type: Object, default: null },
  /** registry.list() 的载体清单：无项目时也照常给（不依赖 view）。 */
  carriers: { type: Array, default: () => [] },
  /**
   * 载体 id → { color, unackedNotices }（批次49，服务与通知池的行色）。
   * 没声明的载体不在表里——没有服务／MCP 的板不画点。
   */
  serviceStatus: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['select', 'toggle-theme', 'open-project', 'new-project', 'context-menu'])

const isDark = computed(() => props.scheme === 'dark')

/**
 * 协议 v1.2 P19：竖条格的右键＝「打开方式」入口。
 * 菜单本身归宿主（AppNext 一枚 .nx-context-menu），这里只上报格子与指针坐标；
 * 形态清单按载体 manifest.panes 的 forms 声明由宿主列，竖条不自己猜。
 */
function onContextMenu(event, board) {
  emit('context-menu', { boardId: board.id, x: event.clientX, y: event.clientY })
}

/** 载体格的图标：清单里目录窗 pane 声明的那枚（没有就退回库图标）。 */
function carrierIcon(carrier) {
  const panes = Array.isArray(carrier?.panes) ? carrier.panes : []
  const pane = panes.find((item) => item?.slot === 'left-dock' && item.icon) ?? panes.find((item) => item?.icon)
  return pane?.icon ?? 'library'
}
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
        @contextmenu.prevent.stop="onContextMenu($event, board)"
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

    <!-- 无项目形态（工单F · 反馈③）：动作钮常驻，载体格如实禁用，不让左栏只剩主题钮。 -->
    <template v-else>
      <button
        type="button"
        class="nx-ribbon-item"
        aria-label="打开项目…"
        v-workbench-tooltip="{ text: '打开项目…', side: 'right' }"
        @click="emit('open-project')"
      >
        <WorkbenchIcon name="folder-open" :size="20" />
      </button>
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
        v-for="carrier in carriers"
        :key="carrier.id"
        type="button"
        class="nx-ribbon-item is-disabled"
        aria-disabled="true"
        tabindex="-1"
        :aria-label="carrier.title"
        :data-carrier-id="carrier.id"
        data-tooltip="打开项目后可用"
        v-workbench-tooltip="{ text: '打开项目后可用', side: 'right' }"
      >
        <WorkbenchIcon :name="carrierIcon(carrier)" :size="22" />
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
