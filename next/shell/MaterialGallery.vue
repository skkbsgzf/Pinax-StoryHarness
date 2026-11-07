<script setup>
import { computed, onMounted, ref, watch } from 'vue'
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
 *
 * 〔批次76 · 任务4-3〕空态从「一句话就把作者打发走」补成「一句话＋真的建得了档」：
 * 遍历实测素材板点了像没反应——图库模板按裁定只换板、不凭空开窗（AppNext.vue selectBoard()
 * 那条分支不动），于是零记录时整面墙只剩「素材还没有内容（素材/素材.json）」，作者没有下一步。
 * 这里给一枚「新建素材」入口：仍走 useBoardData.createRecord（先起名再建档这条边界与目录窗
 * IndexWindow.vue:498-511 一致，不发明第二套建档路径），建完 emit('open') 让新记录出窗——
 * 出窗的是作者这一次点击的结果，不是换板时的自动开窗，裁定A 的口径不破。
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

/**
 * 空态里的「新建素材」（〔批次76 · 任务4-3〕）。
 * 建档只走 useBoardData.createRecord 这一条路（它自己带 expectedRevision、建完 openRecord），
 * 这里不重复实现一套写盘。createRecord 失败只写 data.error（文档级错误位，不在 recordSets 里），
 * 所以本组件把「长度没变」当成失败信号，把那一句 error 就地显出来——作者点了没动静是最坏的反馈。
 */
const newTitle = ref('')
const createError = ref('')
const isBusy = computed(() => props.data?.busy === true)
const canCreate = computed(() => Boolean(key.value) && typeof props.data?.createRecord === 'function')

async function createFirstRecord() {
  const title = String(newTitle.value ?? '').trim()
  if (!title || !canCreate.value || isBusy.value) return
  createError.value = ''
  const before = set.value.records.length
  await props.data.createRecord(key.value, title)
  if (set.value.records.length === before) {
    createError.value = String(props.data?.error ?? '新建没成功，再试一次。')
    return
  }
  newTitle.value = ''
  // 建完让这条记录出窗：驱动是作者这次点击，不是换板自动开窗（裁定A 的「不凭空开窗」不动）。
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
    <div v-else-if="!set.records.length" class="nx-material-empty" data-test="material-empty">
      <p class="nx-material-empty-line" :title="carrier ? `记录写在项目的 ${carrier.dir}/${carrier.file} 里` : ''">
        {{ carrier ? `${carrier.title}这一栏还没有记录，建第一条就有卡片了。` : '这块板没有可登记的记录载体。' }}
      </p>
      <!-- 〔批次68-R3 指南层〕常驻只剩一句＋钮：怎么用输入框由占位文案自己说（先起名再建档进 title）。 -->
      <div v-if="canCreate" class="nx-material-empty-actions" title="先起名再建档：填好标题按回车，或点新建。">
        <input
          v-model="newTitle"
          class="nx-field nx-material-new-title"
          data-test="material-new-title"
          :placeholder="`第 1 条${carrier?.title ?? '素材'}的名字`"
          :disabled="isBusy"
          @keydown.enter.prevent="createFirstRecord"
        >
        <button
          type="button"
          class="control-secondary nx-material-create"
          data-test="material-create"
          :disabled="isBusy || !newTitle.trim()"
          @click="createFirstRecord"
        >{{ isBusy ? '正在新建…' : `新建${carrier?.title ?? '素材'}` }}</button>
      </div>
      <p v-if="createError" class="nx-index-error" data-test="material-create-error">{{ createError }}</p>
    </div>
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
/* 空态（〔批次76 · 任务4-3〕）：一句话＋真建得了档的入口。
   命中区按任务4-4 口径给：输入框走全局 .nx-field（min-height 38px），按钮 min-height 32px、
   横向 padding 14px——都过 24×24 这条线。 */
.nx-material-empty {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 8px;
  max-width: 460px;
  padding: 14px 16px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-raised);
}
.nx-material-empty-line {
  margin: 0;
  font-size: var(--nx-fs-md);
  color: var(--archive-ink);
}
.nx-material-empty-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.nx-material-new-title {
  flex: 1 1 auto;
  min-width: 0;
}
.nx-material-create {
  flex: none;
  min-height: 32px;
  padding: 0 14px;
  font-size: var(--nx-fs-md);
  cursor: pointer;
}
.nx-material-create:disabled {
  cursor: default;
  opacity: 0.55;
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
