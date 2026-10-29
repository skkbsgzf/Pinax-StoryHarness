<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * 悬浮窗的宿主容器（协议 v1.1-C 首个实现；协议 v1.2 P20 吸附扩屏；M2.5-C 四轴工作区）。
 *
 * 分工（合同层写死在 next/kernel/carrierManifest.mjs 的 overlay 槽位注释里）：
 *   载体只声明「要有这一枚悬浮窗」与它的宽度（width，200–600，缺省 300）；
 *   定位、拖动、展开/收起/气泡、吸附、位置记忆全部归宿主——载体 SFC 不许自带拖拽/定位逻辑。
 *
 * M2.5-C 起状态不再写 localStorage：位置（geometry）与最小化（minimized）都是工作区四轴的一部分，
 * 由外壳持在 next/shell/workspace.mjs 并按实例落 `.pinax/workspace.json`。本组件只做三件事：
 *   拖动时算本地坐标（为了手感，不每一帧都回宿主）；
 *   松手时 emit('geometry', { x, y, w, h, snap })；
 *   emit 开合/全屏/气泡/再开一份，自己不决定状态。
 *
 * 三种呈现（同一枚实例，placement 都是 overlay）：
 *   minimized='none'      → 卡片；
 *   minimized='bubble'    → 气泡球（作者原话「可以缩成气泡球」），点它展开；
 *   minimized='collapsed' → 右侧缘小标签（收起），点它展开。
 *
 * 层序走老 token --z-floating-dock（240 < popover 400 < modal 800）；统一二级页开着时 Esc 先归它。
 */
const props = defineProps({
  /** 实例 id：`<paneId>#<n>`（同一块 pane 可以开两份，状态各记各的）。 */
  instance: { type: String, required: true },
  /** pane 声明 id（如 outline.widget）；只用于数据属性与无障碍标签。 */
  id: { type: String, required: true },
  /** 展开态（placement=overlay 且 minimized=none）。 */
  open: { type: Boolean, default: false },
  /** 最小化状态：none｜bubble｜collapsed（仅 placement=overlay 时由外壳传入）。 */
  minimized: { type: String, default: 'none' },
  title: { type: String, default: '' },
  /** 合同校验过的宽度（200–600，缺省 300）；宿主只消费，不在这里再猜。 */
  width: { type: Number, default: 300 },
  /** 工作区里的 geometry：{ x, y, w, h, snap }；null＝还没拖过，走 CSS 默认右上角。 */
  geometry: { type: Object, default: null },
  /** 统一二级页开着时为 true：Esc 先关弹窗，不收起悬浮窗（工单C 边界）。 */
  suspendEsc: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'toggle', 'expand', 'bubble', 'restore', 'geometry', 'duplicate'])

const card = ref(null)
/** { x, y } 相对 offsetParent；null＝还没拖过，走 CSS 默认的右上角偏移。 */
const position = ref(null)
/** 吸附边：'left' | 'right' | null。吸附态走 CSS 半屏，不消费 x/y 内联坐标。 */
const snapped = ref(null)
const dragging = ref(false)
/** 拖到边缘多少 px 内算吸附（布局 px，允许）。 */
const SNAP_EDGE = 32

/** 外部状态变化（换项目读回存档、别人改了这条实例）时要跟上；拖动中不覆盖手感。 */
watch(() => props.geometry, (value) => {
  if (dragging.value) return
  if (!value) {
    position.value = null
    snapped.value = null
    return
  }
  position.value = { x: Math.max(0, Math.round(Number(value.x) || 0)), y: Math.max(0, Math.round(Number(value.y) || 0)) }
  snapped.value = value.snap === 'left' || value.snap === 'right' ? value.snap : null
}, { immediate: true })

const cardStyle = computed(() => {
  if (snapped.value) return {}
  const style = { width: `${props.width}px` }
  if (!position.value) return style
  return { ...style, left: `${position.value.x}px`, top: `${position.value.y}px`, right: 'auto' }
})

const tabStyle = computed(() => (position.value ? { top: `${Math.max(8, position.value.y)}px` } : {}))

const bubbleStyle = computed(() => (position.value ? { left: `${Math.max(8, position.value.x)}px`, top: `${Math.max(8, position.value.y)}px` } : {}))

function onKeydown(event) {
  if (event.key !== 'Escape' || !props.open || props.suspendEsc) return
  event.preventDefault()
  emit('close')
}

onMounted(() => {
  globalThis.document?.addEventListener?.('keydown', onKeydown)
})
onBeforeUnmount(() => {
  globalThis.document?.removeEventListener?.('keydown', onKeydown)
  stopDrag()
})

/** 拖动：起点记在标题条上，坐标换算到 offsetParent（.next-shell）坐标系，越界钳回可拖区。 */
let dragSession = null
function startDrag(event) {
  if (event.button !== undefined && event.button !== 0) return
  const element = card.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const parent = element.offsetParent
  const parentRect = parent?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: globalThis.innerWidth ?? 0, height: globalThis.innerHeight ?? 0 }
  dragSession = {
    startX: event.clientX,
    startY: event.clientY,
    x: rect.left - parentRect.left,
    y: rect.top - parentRect.top,
    parentWidth: parentRect.width || 0,
    // 吸附态的卡片是半屏宽；一松手就按浮动宽度算可拖区，所以这里用 props.width。
    maxLeft: Math.max(0, (parentRect.width || 0) - (snapped.value ? props.width : rect.width)),
    maxTop: Math.max(0, (parentRect.height || 0) - rect.height),
    height: rect.height,
    wasSnapped: Boolean(snapped.value),
    unsnapped: false,
    moved: false
  }
  dragging.value = true
  position.value = { x: Math.round(dragSession.x), y: Math.round(dragSession.y) }
  globalThis.addEventListener?.('pointermove', onDragMove)
  globalThis.addEventListener?.('pointerup', endDrag)
  event.preventDefault?.()
}

function onDragMove(event) {
  if (!dragSession) return
  // 吸附态下真的拖开（>3px）才解除吸附：单击标题条不会把半屏 dock 弹回浮窗。
  if (dragSession.wasSnapped && !dragSession.unsnapped) {
    const dx = event.clientX - dragSession.startX
    const dy = event.clientY - dragSession.startY
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return
    snapped.value = null
    dragSession.unsnapped = true
    dragSession.maxLeft = Math.max(0, dragSession.parentWidth - props.width)
  }
  dragSession.moved = true
  const x = Math.min(dragSession.maxLeft, Math.max(0, dragSession.x + (event.clientX - dragSession.startX)))
  const y = Math.min(dragSession.maxTop, Math.max(0, dragSession.y + (event.clientY - dragSession.startY)))
  position.value = { x: Math.round(x), y: Math.round(y) }
}

/** 松手时的吸附判定：左右边缘 32px 内 → 半屏 dock；否则保持浮动态。 */
function detectSnap() {
  if (!dragSession || !position.value) return null
  if (position.value.x <= SNAP_EDGE) return 'left'
  if (dragSession.maxLeft - position.value.x <= SNAP_EDGE) return 'right'
  return null
}

function endDrag() {
  if (!dragSession) return
  if (dragSession.moved) snapped.value = detectSnap()
  const geometry = {
    x: Math.round(position.value?.x ?? 0),
    y: Math.round(position.value?.y ?? 0),
    w: props.width,
    h: Math.round(dragSession.height || 0) || undefined,
    snap: snapped.value ?? null
  }
  emit('geometry', geometry)
  stopDrag()
}

function stopDrag() {
  dragSession = null
  dragging.value = false
  globalThis.removeEventListener?.('pointermove', onDragMove)
  globalThis.removeEventListener?.('pointerup', endDrag)
}
</script>

<template>
  <div
    v-if="open"
    ref="card"
    class="nx-overlay-widget"
    :class="{
      'is-dragging': dragging,
      'is-snapped': snapped,
      'is-snapped-left': snapped === 'left',
      'is-snapped-right': snapped === 'right'
    }"
    :style="cardStyle"
    role="region"
    :aria-label="`${title || '大纲'}悬浮窗`"
    :data-overlay-id="id"
    :data-overlay-instance="instance"
    :data-snap="snapped"
  >
    <div class="nx-overlay-head" @pointerdown="startDrag">
      <span class="nx-overlay-title">{{ title }}</span>
      <span class="nx-overlay-actions">
        <button
          type="button"
          class="control-quiet nx-overlay-duplicate"
          aria-label="再开一份"
          title="再开一份"
          @pointerdown.stop
          @click="emit('duplicate')"
        >+1</button>
        <button
          type="button"
          class="control-quiet nx-overlay-bubble-btn"
          aria-label="缩成气泡球"
          title="缩成气泡球"
          @pointerdown.stop
          @click="emit('bubble')"
        >●</button>
        <button
          type="button"
          class="control-quiet nx-overlay-expand"
          aria-label="扩至全屏"
          title="扩至全屏"
          @pointerdown.stop
          @click="emit('expand')"
        >全屏</button>
        <button
          type="button"
          class="nx-row nx-overlay-collapse"
          aria-label="收起悬浮窗"
          @pointerdown.stop
          @click="emit('close')"
        >–</button>
      </span>
    </div>
    <div class="nx-overlay-body">
      <slot />
    </div>
  </div>

  <button
    v-else-if="minimized === 'bubble'"
    type="button"
    class="control-quiet nx-overlay-bubble"
    :style="bubbleStyle"
    :aria-label="`展开${title || '大纲'}气泡`"
    :data-overlay-id="id"
    :data-overlay-instance="instance"
    :data-minimized="minimized"
    @click="emit('restore')"
  >
    <span class="nx-overlay-bubble-dot" aria-hidden="true" />
    <span class="nx-overlay-bubble-label">{{ title }}</span>
  </button>

  <button
    v-else
    type="button"
    class="control-quiet nx-overlay-tab"
    :style="tabStyle"
    :aria-label="`展开${title || '大纲'}悬浮窗`"
    :data-overlay-id="id"
    :data-overlay-instance="instance"
    :data-minimized="minimized || 'collapsed'"
    @click="emit('toggle')"
  >{{ title }}</button>
</template>
