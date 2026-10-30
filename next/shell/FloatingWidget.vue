<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'

/**
 * 悬浮窗的宿主容器（协议 v1.1-C 首个实现；协议 v1.2 P20 吸附扩屏；M2.5-C 四轴工作区；
 * 批次35 标题条按钮组归位）。
 *
 * 分工（合同层写死在 next/kernel/carrierManifest.mjs 的 overlay 槽位注释里）：
 *   载体只声明「要有这一枚悬浮窗」与它的宽度（width，200–600，缺省 300）；
 *   定位、拖动、展开/收起/气泡、吸附、位置记忆全部归宿主——载体 SFC 不许自带拖拽/定位逻辑。
 *
 * M2.5-C 起状态不再写 localStorage：位置（geometry）与最小化（minimized）都是工作区四轴的一部分，
 * 由外壳持在 next/shell/workspace.mjs 并按实例落 `.pinax/workspace.json`。本组件只做三件事：
 *   拖动时算本地坐标（为了手感，不每一帧都回宿主）；
 *   松手时 emit('geometry', { x, y, w, h, snap })；
 *   emit 开合/全屏/气泡/吸附/钉住/再开一份/关闭/分屏，自己不决定状态。
 *
 * 标题条按钮组（批次35 作者裁定；顺序固定，一个钮一件事）：
 *   放大（全屏 ↔ 还原）／缩小（气泡球）／吸附（左右半屏 ↔ 解除）／分屏（落中栏副栏）／
 *   固定（钉住：位置锁定，再点解除）／再开一份（＋）／关闭（×：回停靠，不是收起）。
 *   旧的那组 +1／●／全屏／– 已拆掉——收起（collapsed，侧缘小标签）只剩 Esc 一条路。
 *
 * 三个「展开」向的事件各有一词，不混用：
 *   expand   放大到全屏（进全屏形态）；
 *   restore  从全屏还原（回进全屏之前的位置）；
 *   toggle   从最小化回卡片（气泡球／侧缘小标签点它）。
 *   批次35 之前 restore 一词两义（既是回卡片又是离开全屏），多开一份时点错会展开气泡。
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
  /** 钉住（批次35）：true＝位置锁定（禁拖）＋钉钮高亮；状态住在 workspace 的 pinned 轴。 */
  pinned: { type: Boolean, default: false },
  /** 展开态（placement=fullscreen 且 minimized=none）：放大钮据此在「放大／还原」之间选语义。 */
  expanded: { type: Boolean, default: false },
  /** 统一二级页开着时为 true：Esc 先关弹窗，不收起悬浮窗（工单C 边界）。 */
  suspendEsc: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'collapse', 'toggle', 'expand', 'restore', 'bubble', 'geometry', 'duplicate', 'pin', 'split', 'mounted'])

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
  // Esc 是「收起」（侧缘小标签），不是「关闭」——关闭（回停靠）只有标题条的 × 一个入口。
  emit('collapse')
}

/** 标题条按钮组的状态语义（模板与无障碍标签读同一份，不各写各的）。 */
const expandLabel = computed(() => (props.expanded ? '还原' : '放大'))
const expandTitle = computed(() => (props.expanded ? '还原到窗口' : '放大到全屏'))
const pinLabel = computed(() => (props.pinned ? '解除固定' : '固定'))
const snapLabel = computed(() => (snapped.value ? '解除吸附' : '吸附到侧边'))

/**
 * 放大／还原是同一个钮的两面（工单批次35 表第一行）：
 *   不是全屏 → emit('expand')（进全屏形态）；
 *   已是全屏 → emit('restore')（回到进全屏之前的位置，工作区 restore 轴记着）。
 * 「还原」这一面只有形态真是全屏时才露出来（aria-label 与 title 同步换）。
 */
function toggleExpand() {
  if (props.expanded) emit('restore')
  else emit('expand')
}

/** 钉住：只上报意图，状态住 workspace 的 pinned 轴（进 .pinax/workspace.json）。 */
function togglePin() {
  emit('pin', !props.pinned)
}

/**
 * 吸附钮（批次35）：与「拖到边缘」同一个状态机（geometry.snap），只是不用拖。
 * 当前没吸附 → 吸附到离卡片中心更近的那一侧；已吸附 → 解除并退开一点（留在 32px 判定带外，
 * 否则一解除就会在下一次松手时又被判成吸附）。
 */
function parentRectOf() {
  const element = card.value
  const parent = element?.offsetParent
  const rect = parent?.getBoundingClientRect?.()
  if (rect && rect.width) return rect
  return { left: 0, top: 0, width: globalThis.innerWidth ?? 0, height: globalThis.innerHeight ?? 0 }
}

function currentHeight() {
  return Math.round(card.value?.getBoundingClientRect?.().height ?? 0) || undefined
}

function toggleSnap() {
  if (props.pinned) return
  const parent = parentRectOf()
  const width = props.width
  const maxLeft = Math.max(0, (parent.width || 0) - width)
  const y = Math.max(0, Math.round(position.value?.y ?? 16))
  if (snapped.value) {
    // 解除：左右各退开 8px，离开 SNAP_EDGE 判定带。
    const x = snapped.value === 'left'
      ? Math.min(maxLeft, SNAP_EDGE + 8)
      : Math.max(0, maxLeft - SNAP_EDGE - 8)
    snapped.value = null
    position.value = { x, y }
    emit('geometry', { x, y, w: width, h: currentHeight(), snap: null })
    return
  }
  // 吸附：卡片中心偏左就吸左，偏右就吸右（没拖过的卡片默认在右上角 → 吸右）。
  const center = (position.value?.x ?? maxLeft) + width / 2
  const edge = center < (parent.width || 0) / 2 ? 'left' : 'right'
  const x = edge === 'left' ? 0 : maxLeft
  snapped.value = edge
  position.value = { x, y }
  emit('geometry', { x, y, w: width, h: currentHeight(), snap: edge })
}

onMounted(() => {
  globalThis.document?.addEventListener?.('keydown', onKeydown)
  // 卡片挂载＝作者要看这块内容：外壳据此补一次取数（已取过的树不重取，免得冲掉草稿）。
  emit('mounted', props.id)
})
onBeforeUnmount(() => {
  globalThis.document?.removeEventListener?.('keydown', onKeydown)
  stopDrag()
})

/** 拖动：起点记在标题条上，坐标换算到 offsetParent（.next-shell）坐标系，越界钳回可拖区。 */
let dragSession = null
function startDrag(event) {
  if (event.button !== undefined && event.button !== 0) return
  // 钉住的实例位置锁定：标题条上的按下不进入拖拽（按钮自己不冒泡到这里，见模板的 .stop）。
  if (props.pinned) return
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
      'is-pinned': pinned,
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
    :data-pinned="pinned ? 'true' : 'false'"
  >
    <div class="nx-overlay-head" @pointerdown="startDrag">
      <span class="nx-overlay-title">{{ title }}</span>
      <!-- 按钮组（批次35，顺序固定）：放大／缩小／吸附／分屏／固定／再开一份／关闭。
           全部 control-quiet（老版控件词汇），hover 前弱化、hover／聚焦显形（样式层管）。 -->
      <span class="nx-overlay-actions">
        <button
          type="button"
          class="control-quiet nx-overlay-btn nx-overlay-expand"
          data-action="expand"
          :aria-label="expandLabel"
          :aria-pressed="expanded ? 'true' : 'false'"
          :title="expandTitle"
          @pointerdown.stop
          @click="toggleExpand"
        >
          <WorkbenchIcon name="expand" :size="14" />
        </button>
        <button
          type="button"
          class="control-quiet nx-overlay-btn nx-overlay-bubble-btn"
          data-action="bubble"
          aria-label="缩成气泡球"
          title="缩成气泡球"
          @pointerdown.stop
          @click="emit('bubble')"
        >
          <span class="nx-overlay-dot" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="control-quiet nx-overlay-btn nx-overlay-snap"
          data-action="snap"
          :class="{ 'is-active': snapped, 'is-snapped-left': snapped === 'left', 'is-snapped-right': snapped === 'right' }"
          :aria-label="snapLabel"
          :aria-pressed="snapped ? 'true' : 'false'"
          :disabled="pinned"
          :title="pinned ? '已固定，解除后可吸附' : snapLabel"
          @pointerdown.stop
          @click="toggleSnap"
        >
          <WorkbenchIcon name="panel-left" :size="14" />
        </button>
        <button
          type="button"
          class="control-quiet nx-overlay-btn nx-overlay-split"
          data-action="split"
          aria-label="分屏"
          title="分屏（落到中栏右侧）"
          @pointerdown.stop
          @click="emit('split')"
        >
          <WorkbenchIcon name="columns" :size="14" />
        </button>
        <button
          type="button"
          class="control-quiet nx-overlay-btn nx-overlay-pin"
          data-action="pin"
          :class="{ 'is-active': pinned }"
          :aria-label="pinLabel"
          :aria-pressed="pinned ? 'true' : 'false'"
          :title="pinLabel"
          @pointerdown.stop
          @click="togglePin"
        >
          <WorkbenchIcon name="pin" :size="14" />
        </button>
        <button
          type="button"
          class="control-quiet nx-overlay-btn nx-overlay-duplicate"
          data-action="duplicate"
          aria-label="再开一份"
          title="再开一份"
          @pointerdown.stop
          @click="emit('duplicate')"
        >
          <WorkbenchIcon name="plus" :size="14" />
        </button>
        <button
          type="button"
          class="control-quiet nx-overlay-btn nx-overlay-close"
          data-action="close"
          aria-label="关闭悬浮窗"
          title="关闭（回到停靠栏）"
          @pointerdown.stop
          @click="emit('close')"
        >
          <WorkbenchIcon name="close" :size="14" />
        </button>
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
    @click="emit('toggle')"
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
