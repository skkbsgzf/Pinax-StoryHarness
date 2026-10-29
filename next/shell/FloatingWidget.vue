<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 悬浮窗的宿主容器（协议 v1.1-C 首个实现，工单C；协议 v1.2 P20 补吸附与扩屏）。
 *
 * 分工（合同层写死在 next/kernel/carrierManifest.mjs 的 overlay 槽位注释里）：
 *   载体只声明「要有这一枚悬浮窗」与它的宽度（width，200–600，缺省 300）；
 *   定位、拖动、收起/展开、吸附、位置记忆全部归宿主——载体 SFC 不许自带拖拽/定位逻辑。
 * 形态：absolute 定位卡片，默认贴核心区右上角；拖动句柄是标题条（按钮上不触发拖动）。
 * 收起态＝右侧缘一枚小标签，点它展开（emit toggle）。
 * z-index 高于编辑器、低于统一二级页：走老 token --z-floating-dock（240 < popover 400 < modal 800）。
 * Esc 收起；统一二级页开着时 Esc 先归它（挂起由外壳经 suspendEsc 传入）。
 *
 * 协议 v1.2 P20：
 *   - 吸附：拖到左右边缘（32px 内）松手 → 半屏 dock（左右贴边）；从吸附态拖离 → 回到浮动态。
 *     吸附是 overlay 形态的子状态，不是第五种形态；状态随位置一起记忆，切换形态仍走宿主
 *     paneForms.mjs 的 setPaneForm（全屏由「扩至全屏」按钮 emit expand，外壳改 form）。
 *   - 扩至全屏：标题条上的「全屏」按钮只发事件，宿主把 form 改成 fullscreen；本组件不搬内容。
 *
 * 位置记忆（localStorage 例外之一，门禁例外见 next/tests/visual-contract.test.mjs）：
 * 键 `overlay.<id>`，id 就是 pane id（每载体至多一个悬浮窗，后续载体照此声明、宿主按键区分）。
 * 值 { left, top } 相对 offsetParent（.next-shell）；吸附时多一枚 snap:'left'|'right'。
 * 读写都 try/catch——持久化失败不拦拖动。收起状态不落盘（形态归 paneForms 的 paneForm.<id>）。
 */
const props = defineProps({
  /** pane id（如 outline.widget）：位置记忆键 overlay.<id> 由它拼出。 */
  id: { type: String, required: true },
  /** 展开态；false 时只留侧缘小标签。 */
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  /** 合同校验过的宽度（200–600，缺省 300）；宿主只消费，不在这里再猜。 */
  width: { type: Number, default: 300 },
  /** 统一二级页开着时为 true：Esc 先关弹窗，不收起悬浮窗（工单C 边界）。 */
  suspendEsc: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'toggle', 'expand'])

const card = ref(null)
/** { left, top }（相对 offsetParent）；null＝还没拖过，走 CSS 默认的右上角偏移。 */
const position = ref(null)
/** 吸附边：'left' | 'right' | null。吸附态走 CSS 半屏，不消费 left/top 内联坐标。 */
const snapped = ref(null)
const dragging = ref(false)
/** 拖到边缘多少 px 内算吸附（布局 px，允许）。 */
const SNAP_EDGE = 32

const storageKey = computed(() => `overlay.${props.id}`)

const cardStyle = computed(() => {
  if (snapped.value) return {}
  const style = { width: `${props.width}px` }
  if (!position.value) return style
  return { ...style, left: `${position.value.left}px`, top: `${position.value.top}px`, right: 'auto' }
})

const tabStyle = computed(() => (position.value ? { top: `${Math.max(8, position.value.top)}px` } : {}))

function readPosition() {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey.value)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Number.isFinite(parsed?.left) || !Number.isFinite(parsed?.top)) return null
    return {
      left: Math.max(0, Math.round(parsed.left)),
      top: Math.max(0, Math.round(parsed.top)),
      snap: parsed.snap === 'left' || parsed.snap === 'right' ? parsed.snap : null
    }
  } catch {
    return null
  }
}

function persistPosition(value) {
  if (!value) return
  try {
    globalThis.localStorage?.setItem(storageKey.value, JSON.stringify(value))
  } catch {
    // 持久化失败（隐私模式/配额）不拦拖动：位置在这次会话里仍然生效。
  }
}

function onKeydown(event) {
  if (event.key !== 'Escape' || !props.open || props.suspendEsc) return
  event.preventDefault()
  emit('close')
}

onMounted(() => {
  const saved = readPosition()
  if (saved) {
    position.value = { left: saved.left, top: saved.top }
    snapped.value = saved.snap
  }
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
    left: rect.left - parentRect.left,
    top: rect.top - parentRect.top,
    parentWidth: parentRect.width || 0,
    // 吸附态的卡片是半屏宽；一松手就按浮动宽度算可拖区，所以这里用 props.width。
    maxLeft: Math.max(0, (parentRect.width || 0) - (snapped.value ? props.width : rect.width)),
    maxTop: Math.max(0, (parentRect.height || 0) - rect.height),
    wasSnapped: Boolean(snapped.value),
    unsnapped: false,
    moved: false
  }
  dragging.value = true
  position.value = { left: Math.round(dragSession.left), top: Math.round(dragSession.top) }
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
  const left = Math.min(dragSession.maxLeft, Math.max(0, dragSession.left + (event.clientX - dragSession.startX)))
  const top = Math.min(dragSession.maxTop, Math.max(0, dragSession.top + (event.clientY - dragSession.startY)))
  position.value = { left: Math.round(left), top: Math.round(top) }
}

/** 松手时的吸附判定：左右边缘 32px 内 → 半屏 dock；否则保持浮动态。 */
function detectSnap() {
  if (!dragSession || !position.value) return null
  if (position.value.left <= SNAP_EDGE) return 'left'
  if (dragSession.maxLeft - position.value.left <= SNAP_EDGE) return 'right'
  return null
}

function endDrag() {
  if (!dragSession) return
  if (dragSession.moved) snapped.value = detectSnap()
  const value = {
    left: Math.round(position.value?.left ?? 0),
    top: Math.round(position.value?.top ?? 0)
  }
  if (snapped.value) value.snap = snapped.value
  persistPosition(value)
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
    :data-snap="snapped"
  >
    <div class="nx-overlay-head" @pointerdown="startDrag">
      <span class="nx-overlay-title">{{ title }}</span>
      <span class="nx-overlay-actions">
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
    v-else
    type="button"
    class="control-quiet nx-overlay-tab"
    :style="tabStyle"
    :aria-label="`展开${title || '大纲'}悬浮窗`"
    :data-overlay-id="id"
    @click="emit('toggle')"
  >{{ title }}</button>
</template>
