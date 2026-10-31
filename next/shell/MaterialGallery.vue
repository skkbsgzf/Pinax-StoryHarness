<script setup>
import { computed, onMounted, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { recordCarrierOfPaneId } from './recordCarriers.mjs'

/**
 * 素材图库（批次60 · gallery 模板）：没有左栏，核心区就是一整面卡片墙。
 *
 * 素材的记录真源仍是 素材/素材.json（pinax_material_* 四条工具不动），这里只换看法：
 *   - 一张卡＝一条记录：标题＋类型＋图片位＋状态；
 *   - 图片文件位仍挂账（文件服务还是文本口），所以卡片给的是占位图形，不是假图片；
 *   - 点一张卡＝开这条记录的素材窗（走既有 openRecord → PaneWindow），不在画廊里就地编辑。
 *
 * 图库模板由 layoutTemplates.mjs 按 pane id 前缀（material.）推断，宿主据此不渲染 IndexWindow。
 */
const props = defineProps({
  /** 当前板的视图（useBoardData 的 view.boards 那一块）。 */
  board: { type: Object, default: null },
  /** useBoardData 的返回值。 */
  data: { type: Object, required: true }
})
const emit = defineEmits(['open'])

/** 载体 key 从这块板的 pane id 首段认（material.）——画廊只服务记录型载体。 */
const carrier = computed(() => {
  const pane = (props.board?.panes ?? []).find((item) => recordCarrierOfPaneId(item.id))
  return recordCarrierOfPaneId(pane?.id ?? '') ?? null
})
const key = computed(() => carrier.value?.key ?? '')
const set = computed(() => (key.value ? props.data.recordSets?.[key.value] : null)
  ?? { records: [], loaded: false, error: null })

/** 每个载体只补一次列树：已经取过数的树不重取（重取会把作者手上的编辑冲掉）。 */
const requested = new Set()
async function ensureRecords() {
  if (!key.value || set.value.loaded || requested.has(key.value)) return
  requested.add(key.value)
  await props.data.loadRecords?.(key.value, { syncCurrent: false })
}
onMounted(ensureRecords)
watch(key, ensureRecords)

function typeLabel(item) {
  return String(item?.type ?? '').trim() || '未分类'
}

function statusLabel(item) {
  return String(item?.status ?? '').trim()
}

function updatedLabel(item) {
  const stamp = String(item?.updatedAt ?? '')
  return stamp ? stamp.slice(0, 10) : ''
}

async function openCard(item) {
  if (!key.value) return
  await props.data.openRecord?.(key.value, item)
  emit('open')
}
</script>

<template>
  <section class="nx-material-gallery" data-test="material-gallery">
    <header class="nx-material-gallery-head">
      <span class="nx-material-gallery-title">{{ carrier?.title ?? '素材' }}</span>
      <span class="nx-material-gallery-count">{{ set.records.length }} 件</span>
    </header>
    <p v-if="set.error" class="nx-index-error">{{ set.error }}</p>
    <p v-else-if="!set.loaded" class="nx-index-empty">正在载入素材…</p>
    <p v-else-if="!set.records.length" class="nx-index-empty">
      素材还没有内容（{{ carrier?.dir }}/{{ carrier?.file }}）。
    </p>
    <div v-else class="nx-material-grid">
      <button
        v-for="item in set.records"
        :key="item.id"
        type="button"
        class="nx-row nx-material-card"
        data-test="material-card"
        :title="[item.title || item.id, typeLabel(item), statusLabel(item), updatedLabel(item)].filter(Boolean).join(' · ')"
        @click="openCard(item)"
      >
        <span class="nx-material-thumb" aria-hidden="true">
          <WorkbenchIcon name="image" :size="22" />
        </span>
        <span class="nx-material-card-title">{{ item.title || item.id }}</span>
        <span class="nx-material-card-meta">
          <span class="nx-material-card-type">{{ typeLabel(item) }}</span>
          <span v-if="statusLabel(item)" class="nx-material-card-status">{{ statusLabel(item) }}</span>
          <span v-if="updatedLabel(item)" class="nx-material-card-date">{{ updatedLabel(item) }}</span>
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped>
/* 画廊铺满窗口层：绝对定位在 .nx-window-layer 里，窗户（z-index 走叠序）浮在它上面。 */
.nx-material-gallery {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  overflow: auto;
}
.nx-material-gallery-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex: none;
}
.nx-material-gallery-title {
  font-size: var(--nx-fs-md);
  font-weight: 500;
  color: var(--archive-ink);
}
.nx-material-gallery-count {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.nx-material-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 12px;
  align-content: start;
}
.nx-material-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-raised);
  color: var(--text-primary);
  text-align: start;
  cursor: pointer;
}
.nx-material-card:hover {
  border-color: var(--workbench-selected);
  background: var(--nav-hover);
}
.nx-material-card:focus-visible {
  outline: 2px solid var(--workbench-selected);
  outline-offset: -2px;
}
.nx-material-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  border-radius: calc(var(--radius-control) - 2px);
  background: var(--surface-workbench-muted);
  color: var(--text-muted);
}
.nx-material-card-title {
  font-size: var(--nx-fs-md);
  color: var(--archive-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nx-material-card-meta {
  display: flex;
  gap: 6px;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  overflow: hidden;
}
.nx-material-card-type {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nx-material-card-status,
.nx-material-card-date {
  flex: none;
}
</style>
