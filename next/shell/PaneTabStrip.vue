<script setup>
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'

/**
 * 中心区页签栏（批次61 · 工单任务五）。
 *
 * 它只回答一句话：「哪一页是当前页」。所以：
 *   · DOM 里没有拖拽句柄、没有缩放角、没有标题栏、没有任何常驻形态钮——
 *     形态切换一律走右键菜单（作者裁定③），窗口动作一律回 PaneWindow；
 *   · 列的是 `list()` 里的**全部**页记录，跨 main／side／floating／tab 四种形态——
 *     浮窗与侧缘标签也要有签，否则「看得见」这件事只覆盖了一半；
 *   · 点＝揭示那一页（不新建、不升档），×＝关页。
 *
 * 同一块 pane 开两页（`keyed` 载体）时两条签各自指向自己的实例，标题后缀序号区分。
 */
defineProps({
  /** [{ instance, pane, title, form, group, active }]，顺序＝页态（按组内序号）→ 浮窗（按叠序）→ 侧缘标签。 */
  pages: { type: Array, default: () => [] },
  /** 作者此刻看着的那一页（页态取所在组的 active，浮窗取叠序最高）。 */
  currentInstance: { type: String, default: '' }
})
const emit = defineEmits(['reveal', 'close', 'menu'])

function onContextMenu(entry, event) {
  event.preventDefault()
  event.stopPropagation()
  emit('menu', entry.instance, { x: event.clientX, y: event.clientY })
}

function onKeydown(entry, event) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('reveal', entry.instance)
  }
}

const FORM_HINTS = { page: '页', floating: '浮窗', tab: '标签' }
function formHint(form) {
  return FORM_HINTS[form] ?? ''
}
</script>

<template>
  <div
    v-if="pages.length"
    class="nx-page-tabstrip"
    role="tablist"
    aria-label="中心区页签"
    data-test="page-tabstrip"
  >
    <div
      v-for="entry in pages"
      :key="entry.instance"
      class="nx-page-tab"
      :class="[`is-form-${entry.form}`, { 'is-active': entry.instance === currentInstance }]"
      role="tab"
      tabindex="0"
      :aria-selected="entry.instance === currentInstance"
      :data-page-instance="entry.instance"
      :data-page-pane="entry.pane"
      :data-page-form="entry.form"
      :data-page-group="entry.group"
      :title="`${entry.title}（${formHint(entry.form)}）`"
      @click="emit('reveal', entry.instance)"
      @keydown="onKeydown(entry, $event)"
      @contextmenu="onContextMenu(entry, $event)"
    >
      <span class="nx-page-tab-label">{{ entry.title }}</span>
      <span v-if="entry.form !== 'page'" class="nx-page-tab-flag" :data-page-form-flag="entry.form">{{ formHint(entry.form) }}</span>
      <button
        type="button"
        class="control-quiet nx-page-tab-close"
        data-page-action="close"
        :aria-label="`关闭${entry.title}这一页`"
        title="关闭这一页"
        @click.stop="emit('close', entry.instance)"
      >
        <WorkbenchIcon name="close" :size="12" />
      </button>
    </div>
  </div>
</template>
