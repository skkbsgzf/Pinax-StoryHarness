<script setup>
import { computed, ref } from 'vue'
import { ENTRY_CAT_PALETTE, ENTRY_UNCAT_COLOR, entryEdges, radialLayout } from './entriesView.mjs'

/**
 * 条目知识图谱（批次36 · 任务二）：世界书栏的第三种视图（列表／表格／图谱）。
 *
 * 节点＝条目（圆点＋名字，按类别着色——六档色全部取自老前端 token，见 entriesView.mjs
 * 的 ENTRY_CAT_PALETTE；「被引用最多」的条目在圆心带一圈淡色外环，孤点沿外圈）。
 * 边＝relations[].to（按名字匹配，解析与坐标都在 entriesView.mjs 的纯函数里，本组件只画）。
 * 匹配不到的边不画幽灵节点，如实记进角落图例的「未落图」计数。
 *
 * 布局是 d3-hierarchy 的径向树（批次36 复用老前端 LocationTreeMap 同一依赖，零新增）；
 * 缩放平移走 viewBox 变换（滚轮缩放、拖拽平移），不改 SVG 本体。
 * 图谱是只读总览：点节点打开条目（同一个 openEntry），编辑仍走条目编辑面。
 */
const props = defineProps({
  /** 世界书条目清单（与列表／表格同源 data.entries，不新增工具调用）。 */
  entries: { type: Array, default: () => [] }
})
const emit = defineEmits(['open'])

/** 边解析＋径向布局，一次算完（输入不变不重算）。 */
const model = computed(() => {
  const { edges, unmatched } = entryEdges(props.entries)
  return { ...radialLayout(props.entries ?? [], edges), unmatched }
})

/** 类别清单（出现序）：着色映射与图例共用一份顺序，同一类别在节点与图例里必同色。 */
const catList = computed(() => {
  const seen = []
  for (const entry of props.entries ?? []) {
    const cat = String(entry?.cat ?? '')
    if (!seen.includes(cat)) seen.push(cat)
  }
  return seen
})

function colorOf(cat) {
  if (!cat) return ENTRY_UNCAT_COLOR
  const index = catList.value.indexOf(cat)
  return ENTRY_CAT_PALETTE[index % ENTRY_CAT_PALETTE.length]
}

const legend = computed(() => catList.value.map((cat) => ({
  key: cat || '__uncat',
  label: cat || '未分类',
  color: colorOf(cat)
})))

/* —— 缩放平移（viewBox 变换）：zoom 夹在 0.5–2.5，平移换算成 viewBox 用户单位 —— */
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const svgEl = ref(null)
const VIEWBOX_SPAN = 380

function onWheel(event) {
  const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
  zoom.value = Math.min(2.5, Math.max(0.5, zoom.value * factor))
}

const dragging = ref(false)
let dragStart = null
/** 本次按下的位移量：拖完松手的那次 click 不是「点节点」，按这个门槛挡掉。 */
let dragDistance = 0

function onPointerDown(event) {
  if (!event.isPrimary) return
  dragging.value = true
  dragDistance = 0
  dragStart = { x: event.clientX, y: event.clientY, px: pan.value.x, py: pan.value.y }
  svgEl.value?.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event) {
  if (!dragging.value || !dragStart) return
  const dx = event.clientX - dragStart.x
  const dy = event.clientY - dragStart.y
  dragDistance = Math.max(dragDistance, Math.abs(dx) + Math.abs(dy))
  const rect = svgEl.value?.getBoundingClientRect?.()
  const scale = rect?.width ? VIEWBOX_SPAN / rect.width : 1
  pan.value = { x: dragStart.px + dx * scale, y: dragStart.py + dy * scale }
}

function onPointerUp(event) {
  dragging.value = false
  dragStart = null
  svgEl.value?.releasePointerCapture?.(event.pointerId)
}

/* —— hover 高亮邻边；点节点打开条目（拖拽过的那一下不算点） —— */
const hoverName = ref(null)

function isEdgeHi(line) {
  return hoverName.value !== null && (line.source === hoverName.value || line.target === hoverName.value)
}

function openPoint(point) {
  if (dragDistance > 4) return
  const entry = (props.entries ?? []).find((item) => String(item?.name ?? '') === point.name)
  if (entry) emit('open', entry)
}
</script>

<template>
  <div class="nx-entry-graph" data-test="entries-graph">
    <svg
      ref="svgEl"
      class="nx-entry-graph-canvas"
      viewBox="-190 -190 380 380"
      role="img"
      aria-label="条目知识图谱（滚轮缩放，拖拽平移，点节点打开条目）"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <g :transform="`translate(${pan.x} ${pan.y}) scale(${zoom})`">
        <line
          v-for="(line, index) in model.lines"
          :key="`edge-${index}`"
          class="nx-entry-graph-edge"
          :class="{ 'is-hi': isEdgeHi(line), 'is-dim': hoverName !== null && !isEdgeHi(line) }"
          :x1="line.x1"
          :y1="line.y1"
          :x2="line.x2"
          :y2="line.y2"
        />
        <g
          v-for="point in model.points"
          :key="point.name"
          class="nx-entry-graph-node"
          :class="{ 'is-hi': hoverName === point.name }"
          :transform="`translate(${point.x} ${point.y})`"
          @mouseenter="hoverName = point.name"
          @mouseleave="hoverName = null"
          @click="openPoint(point)"
        >
          <circle v-if="point.name === model.root" class="nx-entry-graph-root-ring" :fill="colorOf(point.cat)" r="9" />
          <circle class="nx-entry-graph-dot" :fill="colorOf(point.cat)" r="5" />
          <text class="nx-entry-graph-label" x="8" y="4">{{ point.name }}</text>
        </g>
      </g>
    </svg>
    <p class="nx-entry-graph-legend" data-test="entries-graph-legend">
      <span v-for="item in legend" :key="item.key" class="nx-entry-graph-legend-item">
        <i class="nx-entry-graph-legend-dot" :style="{ background: item.color }" aria-hidden="true"></i>{{ item.label }}
      </span>
      <span v-if="model.unmatched" class="nx-entry-graph-legend-missing" data-test="entries-graph-unmatched">
        {{ model.unmatched }} 条关系边未落图（目标不存在）
      </span>
    </p>
  </div>
</template>

<style scoped>
/* 图谱画布：索引窗窄栏里的一块方形 SVG（viewBox 固定，滚轮/拖拽只动 transform）。
   颜色全走 token；字号走 --nx-fs-* 刻度；其余 px 都是布局尺寸。 */
.nx-entry-graph {
  margin: 0 0 8px;
}
.nx-entry-graph-canvas {
  display: block;
  width: 100%;
  height: 340px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-xs);
  background: color-mix(in srgb, var(--surface-workbench-muted) 60%, transparent);
  cursor: grab;
  touch-action: none;
}
.nx-entry-graph-canvas:active {
  cursor: grabbing;
}
.nx-entry-graph-edge {
  stroke: var(--archive-ink-soft);
  stroke-width: 1;
  opacity: 0.45;
  transition: opacity 120ms ease, stroke 120ms ease;
}
.nx-entry-graph-edge.is-hi {
  stroke: var(--accent);
  stroke-width: 1.5;
  opacity: 1;
}
.nx-entry-graph-edge.is-dim {
  opacity: 0.12;
}
.nx-entry-graph-node {
  cursor: pointer;
}
.nx-entry-graph-dot {
  stroke: var(--nav-surface);
  stroke-width: 1.5;
}
.nx-entry-graph-root-ring {
  fill-opacity: 0.25;
}
.nx-entry-graph-label {
  font-size: var(--nx-fs-2xs);
  fill: var(--text-primary);
  paint-order: stroke;
  stroke: var(--nav-surface);
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}
.nx-entry-graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  margin: 0;
  padding: 6px 2px 0;
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  color: var(--text-muted);
}
.nx-entry-graph-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.nx-entry-graph-legend-dot {
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.nx-entry-graph-legend-missing {
  flex-basis: 100%;
  color: var(--signal-warm);
}
</style>
