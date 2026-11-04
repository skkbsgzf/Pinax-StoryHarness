<script setup>
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'

/**
 * 中心区页签栏（批次61 · 工单任务五；批次76-R2 任务2/3/4 把它收成屏幕上的**那一行**）。
 *
 * 它回答两句话：「哪一页是当前页」＋「这块板还有哪面没开」。批次76-R2 之后它同时是页态窗口的
 * 那一行标题——窗头撤了（〔任务2〕），所以标题、关闭、拖拽手柄、右键形态菜单都在这行上：
 *   · DOM 里没有缩放角、没有常驻形态钮——形态切换一律走右键菜单（作者裁定③）＋拖拽吸附；
 *   · 列的是 `list()` 里的**全部**页记录，跨 main／side／floating／tab 四种形态——
 *     浮窗与收进悬浮球的那一档也要有签，否则「看得见」这件事只覆盖了一半；
 *     〔批次76 裁定B〕tab 态不再在右缘排一竖列文字标签，这枚签就是它在页面上的落点，
 *     点它＝按 `restore` 回收起前那一档（不是硬写页态）。
 *   · 〔批次76-R2 任务3〕原来顶部那行 `nx-center-tabs`（同载体多块中栏 pane 的切换条）整行退役，
 *     没开出来的那几面以「虚线待开页签」挂在同一行末尾——一块板一行，不再两行都列同一批 pane；
 *   · 〔批次76-R2 任务4〕应用面的地址行撤了，地址进这枚签的 title（同一份读数也进底栏状态栏）。
 *   · 点＝揭示那一页（不新建、不升档），×＝关页，按住页态的签拖＝换形态的起点。
 *
 * 同一块 pane 开两页（`keyed` 载体）时两条签各自指向自己的实例，标题后缀序号区分。
 */
defineProps({
  /** [{ instance, pane, title, form, group, active, address }]，顺序＝页态（按组内序号）→ 浮窗（按叠序）→ 收进悬浮球的（tab）。 */
  pages: { type: Array, default: () => [] },
  /** 此刻这一屏的页签高亮跟的是这一页（页态取所在组的 active，浮窗取叠序最高）。 */
  currentInstance: { type: String, default: '' },
  /**
   * 〔批次76-R2 任务3〕这块板声明了、但一页都没开出来的中栏 pane：[{ pane, title }]。
   * 它们是「待开页签」——点一下就开出来（宿主走 routeOpen 那条唯一通路），不是第二套状态轴。
   */
  pendingPanes: { type: Array, default: () => [] }
})
const emit = defineEmits(['reveal', 'close', 'menu', 'drag', 'open-pane'])

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
 * 页签＝页态窗口的拖拽起点（〔批次76-R2 任务2〕）：这一下 pointerdown 交回宿主，
 * 由宿主转进那一页自己的 PaneWindow.startDrag——吸附判定、预览、落位全在那一处，这里不实现第二套。
 *
 * 顺带一句必要的脏活：签上真的拖动过之后，紧随其后的那一下 click **不能再当「揭示那一页」**。
 * 拖到右下角悬浮球那一下要是跟着一次点击，刚收起来的页会立刻被点回来，作者看见的就是「收不起」。
 * 不靠 preventDefault 压 click（各家浏览器对 pointerdown 取消后是否还发 click 口径不一），
 * 也不用时间窗猜（阈值 4px 是自己量出来的事实）。
 */
let draggedOnThisPress = false
function onTabPointerDown(entry, event) {
  draggedOnThisPress = false
  if (entry.form !== 'page') return
  if (event.button !== undefined && event.button !== 0) return
  const startX = event.clientX
  const startY = event.clientY
  const onMove = (moveEvent) => {
    if (Math.abs(moveEvent.clientX - startX) > 4 || Math.abs(moveEvent.clientY - startY) > 4) draggedOnThisPress = true
  }
  const onUp = () => {
    globalThis.removeEventListener?.('pointermove', onMove)
    globalThis.removeEventListener?.('pointerup', onUp)
  }
  globalThis.addEventListener?.('pointermove', onMove)
  globalThis.addEventListener?.('pointerup', onUp)
  emit('drag', entry.instance, event)
}

function onTabClick(entry) {
  if (draggedOnThisPress) {
    draggedOnThisPress = false
    return
  }
  emit('reveal', entry.instance)
}

/** 待开页签的键盘通路：Enter／空格＝开出来（与页签同一套键盘语义）。 */
function onPendingKeydown(pane, event) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('open-pane', pane.pane)
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
    v-if="pages.length || pendingPanes.length"
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
      :data-page-address="entry.address || ''"
      :title="`${entry.title}（${formWord(entry.form)}）${entry.address ? `｜${entry.address}` : ''}`"
      @pointerdown="onTabPointerDown(entry, $event)"
      @click="onTabClick(entry)"
      @keydown="onKeydown(entry, $event)"
      @contextmenu="onContextMenu(entry, $event)"
    >
      <!-- 〔批次76-R2 任务2〕页态的窗头撤了，这一行就是标题行；签上的这枚 × 是这一页唯一的关闭入口
           （右上角那枚只在浮窗／最大化上还有）。按 × 别顺带把拖拽起点也点着——pointerdown 就地拦掉。 -->
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
        @pointerdown.stop
        @click.stop="emit('close', entry.instance)"
      >
        <WorkbenchIcon name="close" :size="12" />
      </button>
    </div>
    <!-- 〔批次76-R2 任务3〕顶部那行 nx-center-tabs 退役后，同一块板的其他中栏面挂在这儿待开：
         一块板一行，屏幕上不再有两行都在列同一批 pane。虚线＝这面还没开出来，点一下就开。 -->
    <div
      v-for="pane in pendingPanes"
      :key="`pending-${pane.pane}`"
      class="nx-page-tab is-pending-pane"
      role="tab"
      tabindex="0"
      :aria-selected="false"
      :data-pending-pane="pane.pane"
      :title="`${pane.title}｜这一面还没开，点一下开出来`"
      @click="emit('open-pane', pane.pane)"
      @keydown="onPendingKeydown(pane, $event)"
    >
      <span class="nx-page-tab-label">{{ pane.title }}</span>
    </div>
  </div>
</template>
