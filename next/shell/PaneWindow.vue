<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { DEFAULT_FLOATING_GEOMETRY, GEOMETRY_MIN_H, GEOMETRY_MIN_W } from './workspace.mjs'

/**
 * 统一窗口（批次61 · 协议 v1.3（批次61 窗口模型））。
 *
 * 任何打开的内容＝一扇带标题的 PaneWindow；chrome 归宿主这一个组件。状态轴只剩三条：
 *
 *   form  page｜floating｜tab    这一页此刻是「占一页」「浮着」还是「收成侧缘标签」
 *   group main｜side             页态落在哪个页组（两块都在页态＝对半，即原来的分屏）
 *   geometry                     只有 floating 持有矩形；page／tab 由宿主排版
 *
 * 右上角固定三个钮（外观与 `data-window-action` 标记沿用批次59 已批的 chrome，只改后果）：
 *   收起 → form:'tab'（再点标签还原）
 *   分屏 → 搬进对面页组（在那一侧对半占位）
 *   ×    → 关闭（页记录删除）
 * 标题栏右键出形态菜单（作者裁定③：形态切换走右键，不做死按钮），与页签右键是同一条通路。
 * 浮窗态可拖标题栏移动、可拖四角缩放；双击标题栏＝最大化／还原（占满中栏）——
 * `maximized` 在 v3 只是浮窗的子态：页态天然铺满所在页组，没有「再最大化」一档。
 *
 * 定位坐标来自工作区（next/shell/workspace.mjs v3）的页记录；本组件只在拖动／缩放期间
 * 持本地坐标（手感），松手时 emit('geometry') 交回宿主。内容经插槽由外壳注入。
 */
const props = defineProps({
  /** 实例 id：`<paneId>#<n>`（同一块 pane 可开多份，状态各记各的）。 */
  instance: { type: String, required: true },
  /** pane 声明 id（如 outline.widget）；用于数据属性与无障碍标签。 */
  paneId: { type: String, required: true },
  title: { type: String, default: '' },
  /** page｜floating｜tab。 */
  form: { type: String, default: 'page' },
  /** main｜side（页态落在哪个页组；浮窗／标签不参与排版）。 */
  group: { type: String, default: 'main' },
  /** 窗口矩形 { x, y, w, h }；只有浮窗态读它。 */
  geometry: { type: Object, default: null },
  /** 浮窗占满中栏（标题栏双击切换）；页态没有这一档。 */
  maximized: { type: Boolean, default: false },
  /** 叠序（工作区 z）。 */
  z: { type: Number, default: 0 },
  /** 收起标签在右缘的序号（多扇窗同时收起时依次排开，不叠成一枚）。 */
  tabIndex: { type: Number, default: 0 },
  /** 统一二级页开着时为 true：Esc 先归弹窗（外壳决定，这里只透传数据属性）。 */
  suspendEsc: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'collapse', 'expand', 'split', 'maximize', 'geometry', 'focus', 'menu', 'mounted'])

const card = ref(null)
/** 拖动／缩放期间只在本地记坐标；松手交回宿主。 */
const localGeometry = ref(null)
const dragging = ref(false)
const resizing = ref(false)

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
  // 页态与标签态都不自带定位：页态由宿主的页层排版，标签态由侧缘列排版。
  if (state.value === 'page' || state.value === 'tab') return {}
  if (state.value === 'maximized') return { left: '0px', top: '0px', width: '100%', height: '100%', 'z-index': String(props.z) }
  const rect = floatingGeometry.value
  return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, 'z-index': String(props.z) }
})

const tabStyle = computed(() => ({ top: `${120 + Math.max(0, props.tabIndex) * 36}px` }))

/** 「分屏」钮的后果（批次61）：页态＝搬到对面页组；浮窗＝先落成对面页组的一页。 */
const splitLabel = computed(() => (props.group === 'side' && props.form === 'page' ? '移回主页组' : '移到侧页组（对半）'))

function parentRect() {
  const element = card.value
  const parent = element?.offsetParent
  const rect = parent?.getBoundingClientRect?.()
  if (rect && rect.width) return rect
  return { left: 0, top: 0, width: globalThis.innerWidth ?? 0, height: globalThis.innerHeight ?? 0 }
}

let dragSession = null
function startDrag(event) {
  if (state.value !== 'floating') return
  if (event.button !== undefined && event.button !== 0) return
  const element = card.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const parent = parentRect()
  dragSession = {
    startX: event.clientX,
    startY: event.clientY,
    x: rect.left - parent.left,
    y: rect.top - parent.top,
    width: rect.width,
    height: rect.height,
    maxLeft: Math.max(0, (parent.width || 0) - rect.width),
    maxTop: Math.max(0, (parent.height || 0) - rect.height),
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
  dragSession.moved = true
  const x = Math.min(dragSession.maxLeft, Math.max(0, dragSession.x + (event.clientX - dragSession.startX)))
  const y = Math.min(dragSession.maxTop, Math.max(0, dragSession.y + (event.clientY - dragSession.startY)))
  localGeometry.value = {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(dragSession.width),
    h: Math.round(dragSession.height)
  }
}

function endDrag() {
  if (!dragSession) return
  if (dragSession.moved && localGeometry.value) emit('geometry', { ...localGeometry.value })
  stopDrag()
}

function stopDrag() {
  dragSession = null
  dragging.value = false
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

function onTabClick() {
  emit('expand')
}

/** 窗头右键＝形态菜单（〔裁定③〕与页签右键同一条通路、同一份菜单）。 */
function onContextMenu(event) {
  event.preventDefault()
  event.stopPropagation()
  emit('menu', { x: event.clientX, y: event.clientY })
}

defineExpose({ state })
onBeforeUnmount(() => {
  stopDrag()
  stopResize()
})
</script>

<template>
  <button
    v-if="state === 'tab'"
    type="button"
    class="control-quiet nx-pane-window-tab"
    :style="tabStyle"
    :aria-label="`展开${title || paneId}窗口`"
    :data-window-pane="paneId"
    :data-window-instance="instance"
    :data-window-group="group"
    data-window-state="tab"
    @click="onTabClick"
    @contextmenu="onContextMenu"
  >{{ title || paneId }}</button>

  <section
    v-else
    ref="card"
    class="nx-pane-window"
    :class="{
      'is-dragging': dragging,
      'is-resizing': resizing,
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
    @pointerdown="emit('focus')"
  >
    <header
      class="nx-pane-window-head"
      :title="state === 'floating' ? '拖动可移动；双击最大化；右键换形态' : '右键换形态'"
      @pointerdown="startDrag"
      @dblclick="onTitleDblclick"
      @contextmenu="onContextMenu"
    >
      <span class="nx-pane-window-title">{{ title }}</span>
      <span class="nx-pane-window-actions">
        <button
          type="button"
          class="control-quiet nx-pane-window-btn nx-pane-window-collapse"
          data-window-action="collapse"
          aria-label="收起为侧缘标签"
          title="收起为侧缘标签"
          @pointerdown.stop
          @click="emit('collapse')"
        >
          <WorkbenchIcon name="chevron-down" :size="14" />
        </button>
        <button
          type="button"
          class="control-quiet nx-pane-window-btn nx-pane-window-split"
          data-window-action="split"
          :class="{ 'is-active': state === 'page' && group === 'side' }"
          :aria-label="splitLabel"
          :aria-pressed="state === 'page' && group === 'side' ? 'true' : 'false'"
          :title="splitLabel"
          @pointerdown.stop
          @click="emit('split')"
        >
          <WorkbenchIcon name="columns" :size="14" />
        </button>
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
