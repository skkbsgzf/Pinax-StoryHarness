<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { DEFAULT_FLOATING_GEOMETRY, GEOMETRY_MIN_H, GEOMETRY_MIN_W } from './workspace.mjs'
import { snapPreviewBox, snapTargetAt } from './paneSnap.mjs'

/**
 * 统一窗口（批次61 · 协议 v1.3（批次61 窗口模型）；批次76 〔裁定A／B〕改了 chrome）。
 *
 * 任何打开的内容＝一扇带标题的 PaneWindow；chrome 归宿主这一个组件。状态轴只剩三条：
 *
 *   form  page｜floating｜tab    这一页此刻是「占一页」「浮着」还是「收进右下角悬浮球」
 *   group main｜side             页态落在哪个页组（两块都在页态＝对半，即原来的分屏）
 *   geometry                     只有 floating 持有矩形；page／tab 由宿主排版
 *
 * 批次76 之后右上角**只剩 ×**（作者〔裁定A〕：「相关的页面形态转换按钮，用拖拽的形式去做」）：
 *   收起／分屏两枚钮撤了，换形态改成为——拖到核心区左/右缘＝落进那一侧页组（对半），
 *   拖到顶缘＝浮窗最大化，拖到右下角悬浮球＝收起；阈值外松手只改矩形，不改形态。
 *   右键菜单仍是形态的无障碍入口（作者批次61 裁定③不变），判定与预览都来自 next/shell/paneSnap.mjs。
 * tab 态在这里**不渲染任何东西**（〔裁定B〕：竖排缘签「用文字代表吸附、还堆叠，看不清也点不到」，
 * 整条撤掉，收起态统一由 AppNext 的 CollapseOrb 呈现）。
 *
 * 〔批次76-R2 任务2〕页态连**窗头也不渲染**（作者：「画布页签条 → 页签条 → 窗头标题 → 网址 → 内容」
 * 五层太多，「浏览器 IDE 的分屏就是普通的平级」）：活动页签就是这一页的标题，× 与拖拽手柄都在页签上，
 * 右键形态菜单跟页签行走。浮窗／最大化没有页签可代替标题行，那两档窗头照旧。
 *
 * 浮窗态可拖标题栏移动、可拖四角缩放；双击标题栏＝最大化／还原（占满中栏）——
 * `maximized` 在 v3 只是浮窗的子态：页态天然铺满所在页组，没有「再最大化」一档。
 *
 * 定位坐标来自工作区（next/shell/workspace.mjs v3）的页记录；本组件只在拖动／缩放期间
 * 持本地坐标（手感），松手时 emit('geometry') 或 emit('snap') 交回宿主。内容经插槽由外壳注入。
 */
const props = defineProps({
  /** 实例 id：`<paneId>#<n>`（同一块 pane 可开多份，状态各记各的）。 */
  instance: { type: String, required: true },
  /** pane 声明 id（如 outline.widget）；用于数据属性与无障碍标签。 */
  paneId: { type: String, required: true },
  title: { type: String, default: '' },
  /** page｜floating｜tab。 */
  form: { type: String, default: 'page' },
  /** main｜side（页态落在哪个页组；浮窗／收起不参与排版）。 */
  group: { type: String, default: 'main' },
  /** 窗口矩形 { x, y, w, h }；只有浮窗态读它。 */
  geometry: { type: Object, default: null },
  /** 浮窗占满中栏（标题栏双击切换）；页态没有这一档。 */
  maximized: { type: Boolean, default: false },
  /** 叠序（工作区 z）。 */
  z: { type: Number, default: 0 },
  /** 统一二级页开着时为 true：Esc 先归弹窗（外壳决定，这里只透传数据属性）。 */
  suspendEsc: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'maximize', 'geometry', 'focus', 'menu', 'mounted', 'snap'])

const card = ref(null)
/** 拖动／缩放期间只在本地记坐标；松手交回宿主。 */
const localGeometry = ref(null)
const dragging = ref(false)
const resizing = ref(false)
/** 拖动中的吸附落点（'orb'／'top'／'left'／'right'／null）——预览与松手都读这一个值。 */
const snap = ref(null)

watch(() => props.geometry, (value) => {
  if (dragging.value || resizing.value) return
  localGeometry.value = value
    ? { x: Number(value.x) || 0, y: Number(value.y) || 0, w: Number(value.w) || DEFAULT_FLOATING_GEOMETRY.w, h: Number(value.h) || DEFAULT_FLOATING_GEOMETRY.h }
    : null
}, { immediate: true })

const state = computed(() => {
  if (props.form === 'tab') return 'tab'
  if (props.form === 'page') return 'page'
  return props.maximized ? 'maximized' : 'floating'
})

const floatingGeometry = computed(() => localGeometry.value ?? props.geometry ?? DEFAULT_FLOATING_GEOMETRY)

const cardStyle = computed(() => {
  // 页态不自带定位（宿主的页层排版）；tab 态根本不渲染（〔裁定B〕归悬浮球）。
  if (state.value === 'page') return {}
  if (state.value === 'maximized') return { left: '0px', top: '0px', width: '100%', height: '100%', 'z-index': String(props.z) }
  const rect = floatingGeometry.value
  return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, 'z-index': String(props.z) }
})

const previewStyle = computed(() => snapPreviewBox(snap.value) ?? {})

function parentRect() {
  const element = card.value
  const parent = element?.offsetParent
  const rect = parent?.getBoundingClientRect?.()
  if (rect && rect.width) return rect
  return { left: 0, top: 0, width: globalThis.innerWidth ?? 0, height: globalThis.innerHeight ?? 0 }
}

/**
 * 拖动。两种模式（〔裁定A〕把形态钮换成动线之后）：
 *   move 浮窗态＝跟着指针改矩形，同时算吸附
 *   snap 页态＝矩形不归它管（不写 localGeometry），只跟指针算吸附
 * 松手时：命中圈里就 emit('snap')（宿主落形态），否则浮窗 emit('geometry')。
 * 〔批次76-R2 任务2〕页态的起点不再是自己那行窗头（窗头撤了）：宿主把页签行的 pointerdown
 * 转进这里（见 defineExpose），吸附判定与预览仍是同一份代码，没有第二套手势实现。
 */
let dragSession = null
function startDrag(event) {
  if (state.value === 'tab') return
  if (event.button !== undefined && event.button !== 0) return
  const element = card.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const parent = parentRect()
  dragSession = {
    mode: state.value === 'page' ? 'snap' : 'move',
    startX: event.clientX,
    startY: event.clientY,
    x: rect.left - parent.left,
    y: rect.top - parent.top,
    width: rect.width,
    height: rect.height,
    maxLeft: Math.max(0, (parent.width || 0) - rect.width),
    maxTop: Math.max(0, (parent.height || 0) - rect.height),
    // 吸附的分界线是「窗口层」这块板，不是屏幕：层矩形在这里先量好。
    layer: { x: parent.left, y: parent.top, width: parent.width, height: parent.height },
    moved: false
  }
  dragging.value = true
  emit('focus')
  globalThis.addEventListener?.('pointermove', onDragMove)
  globalThis.addEventListener?.('pointerup', endDrag)
  event.preventDefault?.()
}

function onDragMove(event) {
  if (!dragSession) return
  if (Math.abs(event.clientX - dragSession.startX) > 2 || Math.abs(event.clientY - dragSession.startY) > 2) dragSession.moved = true
  if (dragSession.mode === 'move') {
    const x = Math.min(dragSession.maxLeft, Math.max(0, dragSession.x + (event.clientX - dragSession.startX)))
    const y = Math.min(dragSession.maxTop, Math.max(0, dragSession.y + (event.clientY - dragSession.startY)))
    localGeometry.value = {
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(dragSession.width),
      h: Math.round(dragSession.height)
    }
  }
  snap.value = snapTargetAt({ x: event.clientX, y: event.clientY }, dragSession.layer, { form: state.value })
}

function endDrag() {
  if (!dragSession) return
  const session = dragSession
  const target = snap.value
  stopDrag()
  if (!session.moved) return
  // 〔守卫④〕无预览不落位：命中圈外松手只是把矩形挪了挪。
  if (target) {
    emit('snap', { target, geometry: localGeometry.value ? { ...localGeometry.value } : null })
    return
  }
  if (session.mode === 'move' && localGeometry.value) emit('geometry', { ...localGeometry.value })
}

function stopDrag() {
  dragSession = null
  dragging.value = false
  snap.value = null
  globalThis.removeEventListener?.('pointermove', onDragMove)
  globalThis.removeEventListener?.('pointerup', endDrag)
}

/** 四角缩放：起点记矩形与指针差，移动时按方向改宽高并钳回值域。 */
let resizeSession = null
function startResize(event, corner) {
  if (state.value !== 'floating') return
  if (event.button !== undefined && event.button !== 0) return
  const rect = floatingGeometry.value
  resizeSession = {
    corner,
    startX: event.clientX,
    startY: event.clientY,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    parent: parentRect()
  }
  resizing.value = true
  emit('focus')
  globalThis.addEventListener?.('pointermove', onResizeMove)
  globalThis.addEventListener?.('pointerup', endResize)
  event.preventDefault?.()
  event.stopPropagation?.()
}

function onResizeMove(event) {
  if (!resizeSession) return
  const session = resizeSession
  const dx = event.clientX - session.startX
  const dy = event.clientY - session.startY
  const west = session.corner === 'nw' || session.corner === 'sw'
  const north = session.corner === 'nw' || session.corner === 'ne'
  let w = Math.max(GEOMETRY_MIN_W, session.w + (west ? -dx : dx))
  let h = Math.max(GEOMETRY_MIN_H, session.h + (north ? -dy : dy))
  w = Math.min(w, Math.max(GEOMETRY_MIN_W, (session.parent.width || w + session.x) - session.x))
  h = Math.min(h, Math.max(GEOMETRY_MIN_H, (session.parent.height || h + session.y) - session.y))
  const x = west ? Math.max(0, session.x + session.w - w) : session.x
  const y = north ? Math.max(0, session.y + session.h - h) : session.y
  localGeometry.value = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

function endResize() {
  if (!resizeSession) return
  if (localGeometry.value) emit('geometry', { ...localGeometry.value })
  stopResize()
}

function stopResize() {
  resizeSession = null
  resizing.value = false
  globalThis.removeEventListener?.('pointermove', onResizeMove)
  globalThis.removeEventListener?.('pointerup', endResize)
}

function onTitleDblclick() {
  // 只有浮窗有「最大化／还原」这一档；页态天然铺满所在页组，双击不改任何东西。
  // 判 props.form 而不是 state：maximized 是浮窗的子态，用 state 就把「再双击还原」这条路堵死了。
  if (props.form !== 'floating') return
  emit('maximize')
}

/** 窗头右键＝形态菜单（〔裁定③〕与页签右键同一条通路、同一份菜单；也是拖拽的无障碍兜底）。 */
function onContextMenu(event) {
  event.preventDefault()
  event.stopPropagation()
  emit('menu', { x: event.clientX, y: event.clientY })
}

/**
 * 〔批次76-R2 任务2〕页态没有窗头可拖，宿主拿这句把**页签行**的 pointerdown 接成拖拽起点：
 * 起点在页签、判定与预览仍在本组件（吸附的唯一实现处）。startDrag 内部按 state 分 move／snap，
 * 页态走 snap 模式：不写矩形，只跟指针算吸附，命中圈里松手 emit('snap')。
 */
defineExpose({ state, startDrag })
onBeforeUnmount(() => {
  stopDrag()
  stopResize()
})
</script>

<template>
  <!-- 〔裁定B〕form==='tab' 的窗在这里什么都不画：收起态统一由右下角的 CollapseOrb 呈现，
       竖排缘签（.nx-pane-window-tab）整条退役——「用文字代表吸附、还堆叠，看不清也点不到」。 -->
  <section
    v-if="state !== 'tab'"
    ref="card"
    class="nx-pane-window"
    :class="{
      'is-dragging': dragging,
      'is-resizing': resizing,
      'is-snapping': Boolean(snap),
      'is-page': state === 'page',
      'is-in-side': state === 'page' && group === 'side',
      'is-maximized': state === 'maximized',
      'is-floating': state === 'floating'
    }"
    :style="cardStyle"
    role="region"
    :aria-label="`${title || paneId}窗口`"
    :data-window-pane="paneId"
    :data-window-instance="instance"
    :data-window-group="group"
    :data-suspend-esc="suspendEsc ? 'true' : 'false'"
    :data-window-state="state"
    :data-window-snap="snap || ''"
    @pointerdown="emit('focus')"
  >
    <!-- 〔批次76-R2 任务2〕页态不再渲染窗头：活动页签就是标题（×与拖拽手柄都落在页签上，
         由宿主把这一下 pointerdown 接回下面那句 startDrag）。浮窗／最大化没有页签可代替标题行，头保留。
         〔守卫⑪〕state==='page' 的窗口 DOM 里不得出现 nx-pane-window-head。 -->
    <header
      v-if="state !== 'page'"
      class="nx-pane-window-head"
      title="拖动可移动；拖到边缘吸附；双击最大化；右键换形态"
      @pointerdown="startDrag"
      @dblclick="onTitleDblclick"
      @contextmenu="onContextMenu"
    >
      <span class="nx-pane-window-title">{{ title }}</span>
      <span class="nx-pane-window-actions">
        <!-- 〔裁定A〕收起／分屏两枚钮撤了：形态归拖拽（＋右键兜底），右上角只留关闭。 -->
        <button
          type="button"
          class="control-quiet nx-pane-window-btn nx-pane-window-close"
          data-window-action="close"
          aria-label="关闭窗口"
          title="关闭窗口"
          @pointerdown.stop
          @click="emit('close')"
        >
          <WorkbenchIcon name="close" :size="14" />
        </button>
      </span>
    </header>
    <div class="nx-pane-window-body">
      <slot />
    </div>
    <!-- 吸附预览：命中圈里才亮，亮在哪一块就是松手后的落点（〔守卫④〕无预览不落位）。 -->
    <div
      v-if="snap"
      class="nx-pane-snap-preview"
      :data-snap-target="snap"
      :style="previewStyle"
      aria-hidden="true"
    />
    <template v-if="state === 'floating'">
      <span
        v-for="corner in ['nw', 'ne', 'sw', 'se']"
        :key="corner"
        class="nx-pane-window-resize"
        :class="`is-${corner}`"
        :data-window-resize="corner"
        aria-hidden="true"
        @pointerdown="startResize($event, corner)"
      />
    </template>
  </section>
</template>
