<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { DEFAULT_FLOATING_GEOMETRY, GEOMETRY_MIN_H, GEOMETRY_MIN_W } from './workspace.mjs'

/**
 * 统一窗口（批次59 · 协议 v1.3 铁律一）。
 *
 * 任何打开的内容＝一扇带标题的 PaneWindow；chrome 归宿主这一个组件。右上角固定三个钮：
 *
 *   收起  → 缩成侧缘标签（再点标签还原）
 *   分屏  → 当前窗与分屏搭档对半贴（已贴着时再点解除）
 *   ×     → 关闭（窗口记录删除）
 *
 * 浮窗态可拖标题栏移动、可拖四角缩放；双击标题栏＝最大化／还原（占满中栏）。
 * 最大化／分屏不是第二套外壳：同一扇窗、同一套 chrome，只换几何与类名。
 *
 * 定位坐标来自工作区（next/shell/workspace.mjs）的窗口记录；本组件只在拖动／缩放期间
 * 持本地坐标（手感），松手时 emit('geometry') 交回宿主。内容经插槽由外壳注入。
 */
const props = defineProps({
  /** 实例 id：`<paneId>#<n>`（同一块 pane 可开多份，状态各记各的）。 */
  instance: { type: String, required: true },
  /** pane 声明 id（如 outline.widget）；用于数据属性与无障碍标签。 */
  paneId: { type: String, required: true },
  title: { type: String, default: '' },
  /** 窗口矩形 { x, y, w, h }；null＝还没开过（用缺省矩形）。 */
  geometry: { type: Object, default: null },
  /** none｜tab（tab＝右侧缘小标签）。 */
  minimized: { type: String, default: 'none' },
  /** 占满中栏（标题栏双击切换）。 */
  maximized: { type: Boolean, default: false },
  /** 分屏侧：left｜right｜null（null＝浮窗态）。 */
  tileSide: { type: String, default: null },
  /** 叠序（工作区 z）。 */
  z: { type: Number, default: 0 },
  /** 收起标签在右缘的序号（多扇窗同时收起时依次排开，不叠成一枚）。 */
  tabIndex: { type: Number, default: 0 },
  /** 统一二级页开着时为 true：Esc 先归弹窗（外壳决定，这里只透传数据属性）。 */
  suspendEsc: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'collapse', 'expand', 'split', 'maximize', 'geometry', 'focus', 'mounted'])

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
  if (props.minimized === 'tab') return 'tab'
  if (props.maximized) return 'maximized'
  if (props.tileSide) return 'tiled'
  return 'floating'
})

const floatingGeometry = computed(() => localGeometry.value ?? props.geometry ?? DEFAULT_FLOATING_GEOMETRY)

const cardStyle = computed(() => {
  if (state.value === 'tab') return {}
  if (state.value === 'maximized') return { left: '0px', top: '0px', width: '100%', height: '100%', 'z-index': String(props.z) }
  const rect = floatingGeometry.value
  if (state.value === 'tiled') {
    const left = props.tileSide === 'right' ? rect.x + rect.w / 2 : rect.x
    return { left: `${left}px`, top: `${rect.y}px`, width: `${Math.round(rect.w / 2)}px`, height: `${rect.h}px`, 'z-index': String(props.z) }
  }
  return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, 'z-index': String(props.z) }
})

const tabStyle = computed(() => ({ top: `${120 + Math.max(0, props.tabIndex) * 36}px` }))

const splitLabel = computed(() => (props.tileSide ? '解除分屏' : '分屏'))

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
  if (state.value === 'tab') return
  emit('maximize')
}

function onTabClick() {
  emit('expand')
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
    data-window-state="tab"
    @click="onTabClick"
  >{{ title || paneId }}</button>

  <section
    v-else
    ref="card"
    class="nx-pane-window"
    :class="{
      'is-dragging': dragging,
      'is-resizing': resizing,
      'is-maximized': state === 'maximized',
      'is-tiled': state === 'tiled',
      'is-tile-left': tileSide === 'left',
      'is-tile-right': tileSide === 'right'
    }"
    :style="cardStyle"
    role="region"
    :aria-label="`${title || paneId}窗口`"
    :data-window-pane="paneId"
    :data-window-instance="instance"
    :data-window-state="state"
    :data-suspend-esc="suspendEsc ? 'true' : 'false'"
    @pointerdown="emit('focus')"
  >
    <header
      class="nx-pane-window-head"
      :title="state === 'floating' ? '拖动可移动；双击最大化' : ''"
      @pointerdown="startDrag"
      @dblclick="onTitleDblclick"
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
          :class="{ 'is-active': tileSide }"
          :aria-label="splitLabel"
          :aria-pressed="tileSide ? 'true' : 'false'"
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
