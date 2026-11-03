<script setup>
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'

/**
 * 中心区页签栏（批次61 · 工单任务五）。
 *
 * 它只回答一句话：「哪一页是当前页」。所以：
 *   · DOM 里没有拖拽句柄、没有缩放角、没有标题栏、没有任何常驻形态钮——
 *     形态切换一律走右键菜单（作者裁定③），窗口动作一律回 PaneWindow；
 *   · 列的是 `list()` 里的**全部**页记录，跨 main／side／floating／tab 四种形态——
 *     浮窗与收进悬浮球的那一档也要有签，否则「看得见」这件事只覆盖了一半；
 *     〔批次76 裁定B〕tab 态不再在右缘排一竖列文字标签，这枚签就是它在页面上的落点，
 *     点它＝按 `restore` 回收起前那一档（不是硬写页态）。
 *   · 点＝揭示那一页（不新建、不升档），×＝关页。
 *
 * 同一块 pane 开两页（`keyed` 载体）时两条签各自指向自己的实例，标题后缀序号区分。
 */
defineProps({
  /** [{ instance, pane, title, form, group, active }]，顺序＝页态（按组内序号）→ 浮窗（按叠序）→ 收进悬浮球的（tab）。 */
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

/**
 * 非页态的角标（〔批次76 裁定A〕文字角标撤了）：
 * 浮窗＝一枚 12px 图标点，tab 态**什么都不显示**——收起态的呈现归右下角悬浮球（CollapseOrb），
 * 页签栏只回答「哪一页」，不再用「标签」两个字去画第二套状态语言。
 * 形态本身仍有 DOM 可读：`data-page-form` 属性与 `is-form-*` 类都在，测试与样式都靠它们。
 */
const FORM_ICON = { floating: 'expand' }
/** 只进 title／aria 的形态说法：屏幕上不再出文字角标，但读屏与悬浮提示得说清这一页在哪。 */
const FORM_WORDS = { page: '页', floating: '浮窗', tab: '已收进悬浮球' }
function formWord(form) {
  return FORM_WORDS[form] ?? ''
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
      :title="`${entry.title}（${formWord(entry.form)}）`"
      @click="emit('reveal', entry.instance)"
      @keydown="onKeydown(entry, $event)"
      @contextmenu="onContextMenu(entry, $event)"
    >
      <span class="nx-page-tab-label">{{ entry.title }}</span>
      <span
        v-if="FORM_ICON[entry.form]"
        class="nx-page-tab-flag"
        :data-page-form-flag="entry.form"
        :aria-label="formWord(entry.form)"
        :title="formWord(entry.form)"
      ><WorkbenchIcon :name="FORM_ICON[entry.form]" :size="12" /></span>
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
