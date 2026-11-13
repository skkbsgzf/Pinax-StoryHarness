<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'
import {
  WIKI_TABS,
  buildWikiForeshadows,
  buildWikiMatrix,
  buildWikiOutline,
  buildWikiOverview,
  buildWikiTimeline,
  isWikiTab
} from './wikiView.mjs'

/**
 * 世界书 wiki 五页签（S4 · WO-S4-02）。
 *
 * 只读 `fact:wiki:get`：取回来的 wiki JSON 是 deriveWiki 的产物（零模型纯计算），
 * 五页签全部从它读数——概览／人物矩阵／时间线／章纲／伏笔，不另发工具调用。
 *
 * 沉默层：没有 wiki 数据时不摆页签组，只留一句说明与一枚「派生 wiki」。
 * 派生钮只在有拆解书（bookId）时存在——无书可派生的状态不摆死钮。
 * 派生走 `fact:wiki:derive`（主进程经 writeFactFile 落 `拆解/<id>.wiki.json`），响应即刷新。
 */
const props = defineProps({
  root: { type: String, default: '' },
  bookId: { type: String, default: '' },
  /** 当前页签（父组件记在视图记忆里）；词表外的值按「概览」渲染。 */
  tab: { type: String, default: 'overview' }
})
const emit = defineEmits(['tab'])

const wiki = ref(null)
const derivedFrom = ref(null)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const deriving = ref(false)
let loadToken = 0

const activeTab = computed(() => (isWikiTab(props.tab) ? props.tab : 'overview'))
const overview = computed(() => buildWikiOverview(wiki.value))
const matrix = computed(() => buildWikiMatrix(wiki.value))
const timeline = computed(() => buildWikiTimeline(wiki.value))
const outline = computed(() => buildWikiOutline(wiki.value))
const foreshadows = computed(() => buildWikiForeshadows(wiki.value))

function bridge() {
  const candidate = globalThis.pinaxNext
  return candidate && typeof candidate.request === 'function' ? candidate : null
}

async function load() {
  wiki.value = null
  derivedFrom.value = null
  error.value = ''
  notice.value = ''
  const root = String(props.root ?? '').trim()
  const bookId = String(props.bookId ?? '').trim()
  if (!root || !bookId) return
  const token = ++loadToken
  const channel = bridge()
  if (!channel) {
    error.value = '渲染层未接主进程桥，wiki 读不到。'
    return
  }
  loading.value = true
  try {
    const result = await channel.request(IPC_CHANNELS.factWikiGet, { root, bookId })
    if (token !== loadToken) return
    if (!result?.ok) {
      error.value = result?.error?.message ?? 'wiki 读取失败。'
      return
    }
    wiki.value = result.wiki ?? null
    derivedFrom.value = result.derivedFrom ?? null
  } catch (caught) {
    if (token === loadToken) error.value = `wiki 读取失败：${String(caught?.message || caught)}`
  } finally {
    if (token === loadToken) loading.value = false
  }
}

async function derive() {
  if (deriving.value) return
  const root = String(props.root ?? '').trim()
  const bookId = String(props.bookId ?? '').trim()
  if (!root || !bookId) return
  const channel = bridge()
  if (!channel) {
    error.value = '渲染层未接主进程桥，无法派生 wiki。'
    return
  }
  deriving.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await channel.request(IPC_CHANNELS.factWikiDerive, { root, bookId })
    if (!result?.ok) {
      error.value = result?.error?.message ?? 'wiki 派生失败。'
      return
    }
    wiki.value = result.wiki ?? null
    derivedFrom.value = result.derivedFrom ?? null
    notice.value = '已生成 wiki。'
  } catch (caught) {
    error.value = `wiki 派生失败：${String(caught?.message || caught)}`
  } finally {
    deriving.value = false
  }
}

function pick(id) {
  if (!isWikiTab(id) || id === activeTab.value) return
  emit('tab', id)
}

onMounted(load)
watch(() => [props.root, props.bookId], () => { void load() })
</script>

<template>
  <section v-if="root && bookId" class="nx-wiki-tabs" data-test="wiki-tabs">
    <p v-if="loading" class="pane-hint" data-test="wiki-loading">读取中…</p>
    <p v-else-if="error" class="nx-index-error" data-test="wiki-error">{{ error }}</p>

    <template v-else-if="wiki">
      <header class="nx-wiki-tabs-head">
        <div class="nx-wiki-tabs-bar" role="tablist" data-test="wiki-tab-bar">
          <button
            v-for="item in WIKI_TABS"
            :key="item.id"
            type="button"
            class="control-quiet nx-wiki-tab"
            :class="{ 'is-active': activeTab === item.id }"
            :data-test="`wiki-tab-${item.id}`"
            role="tab"
            :aria-selected="activeTab === item.id ? 'true' : 'false'"
            @click="pick(item.id)"
          >{{ item.label }}</button>
        </div>
        <button
          type="button"
          class="control-secondary nx-wiki-derive"
          data-test="wiki-derive"
          :disabled="deriving"
          @click="derive"
        >{{ deriving ? '派生中…' : '派生 wiki' }}</button>
      </header>

      <p v-if="notice" class="pane-hint" data-test="wiki-notice">{{ notice }}</p>
      <p v-if="derivedFrom && Number.isInteger(derivedFrom.factRevision)" class="nx-wiki-derived" data-test="wiki-derived">
        依据第 {{ derivedFrom.factRevision }} 版拆解派生
      </p>

      <div class="nx-wiki-tab-body">
        <section v-if="activeTab === 'overview'" data-test="wiki-panel-overview">
          <div class="nx-wiki-kpis">
            <div class="nx-wiki-kpi" data-test="wiki-kpi-entries">
              <span class="nx-wiki-kpi-value">{{ overview.entryTotal }}</span>
              <span class="nx-wiki-kpi-label">条目</span>
            </div>
            <div class="nx-wiki-kpi" data-test="wiki-kpi-chapters">
              <span class="nx-wiki-kpi-value">{{ overview.chapterTotal }}</span>
              <span class="nx-wiki-kpi-label">{{ overview.unit }}数</span>
            </div>
            <div class="nx-wiki-kpi" data-test="wiki-kpi-foreshadow">
              <span class="nx-wiki-kpi-value">{{ overview.foreshadowTotal }}</span>
              <span class="nx-wiki-kpi-label">伏笔</span>
            </div>
            <div class="nx-wiki-kpi" data-test="wiki-kpi-traceable">
              <span class="nx-wiki-kpi-value">{{ overview.traceableRate === null ? '—' : `${overview.traceableRate}%` }}</span>
              <span class="nx-wiki-kpi-label">可溯源率</span>
            </div>
          </div>
          <p class="nx-wiki-tab-caption">类型分布</p>
          <ul v-if="overview.types.length" class="nx-wiki-type-list" data-test="wiki-types">
            <li v-for="type in overview.types" :key="type.key" class="nx-wiki-type-row">
              <span>{{ type.label }}</span>
              <span class="nx-wiki-type-count">{{ type.count }}</span>
            </li>
          </ul>
          <p v-else class="nx-wiki-tab-empty">暂无可展示的类型分布。</p>
        </section>

        <section v-else-if="activeTab === 'matrix'" data-test="wiki-panel-matrix">
          <div v-if="matrix.rows.length" class="nx-wiki-matrix-wrap">
            <table class="nx-wiki-matrix" data-test="wiki-matrix">
              <thead>
                <tr>
                  <th scope="col">人物</th>
                  <th v-for="chapter in matrix.chapters" :key="chapter.no" scope="col" :title="chapter.title">{{ chapter.no }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in matrix.rows" :key="row.name">
                  <th scope="row">{{ row.name }}</th>
                  <td
                    v-for="(cell, index) in row.cells"
                    :key="index"
                    :class="`is-heat-${cell.level}`"
                  >{{ cell.value || '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="nx-wiki-tab-empty">暂无可展示的人物矩阵。</p>
        </section>

        <section v-else-if="activeTab === 'timeline'" data-test="wiki-panel-timeline">
          <ol v-if="timeline.length" class="nx-wiki-timeline" data-test="wiki-timeline">
            <li v-for="chapter in timeline" :key="chapter.no">
              <p class="nx-wiki-timeline-head">第 {{ chapter.no }} {{ chapter.unit }} · {{ chapter.title }}</p>
              <p v-if="!chapter.events.length" class="nx-wiki-tab-empty">这一{{ chapter.unit }}没有事件记录。</p>
              <ul v-else class="nx-wiki-timeline-events">
                <li v-for="(event, index) in chapter.events" :key="index" class="nx-wiki-timeline-event">
                  <span class="nx-wiki-event-who">{{ event.who }}</span>
                  <span class="nx-wiki-event-channel">{{ event.channelLabel }}</span>
                  <span>{{ event.text }}</span>
                </li>
              </ul>
            </li>
          </ol>
          <p v-else class="nx-wiki-tab-empty">暂无可展示的时间线。</p>
        </section>

        <section v-else-if="activeTab === 'outline'" data-test="wiki-panel-outline">
          <div v-if="outline.length" class="nx-wiki-outline" data-test="wiki-outline">
            <article v-for="chapter in outline" :key="chapter.no" class="nx-wiki-outline-card">
              <h3 class="nx-wiki-outline-title">第 {{ chapter.no }} {{ chapter.unit }} · {{ chapter.title }}</h3>
              <p v-if="chapter.summary" class="nx-wiki-outline-summary">{{ chapter.summary }}</p>
              <p v-if="chapter.function || chapter.emotion" class="nx-wiki-outline-meta">
                <span v-if="chapter.function">功能：{{ chapter.function }}</span>
                <span v-if="chapter.emotion">情绪：{{ chapter.emotion }}</span>
              </p>
              <p v-if="chapter.newChars.length" class="nx-wiki-outline-meta">新出场：{{ chapter.newChars.join('、') }}</p>
              <p v-if="chapter.foreshadow.length" class="nx-wiki-outline-meta">伏笔：{{ chapter.foreshadow.length }} 条</p>
            </article>
          </div>
          <p v-else class="nx-wiki-tab-empty">暂无可展示的章纲。</p>
        </section>

        <section v-else data-test="wiki-panel-foreshadow">
          <ul v-if="foreshadows.length" class="nx-wiki-foreshadow" data-test="wiki-foreshadow">
            <li v-for="(item, index) in foreshadows" :key="index" class="nx-wiki-foreshadow-item">
              <span class="nx-wiki-foreshadow-ch">第 {{ item.no }} {{ item.unit }}</span>
              <span>{{ item.text }}</span>
            </li>
          </ul>
          <p v-else class="nx-wiki-tab-empty">暂无可展示的伏笔。</p>
        </section>
      </div>
    </template>

    <div v-else class="nx-wiki-empty" data-test="wiki-empty">
      <p class="nx-wiki-empty-text">这本书暂未派生 wiki。</p>
      <button
        type="button"
        class="control-secondary nx-wiki-derive"
        data-test="wiki-derive"
        :disabled="deriving"
        @click="derive"
      >{{ deriving ? '派生中…' : '派生 wiki' }}</button>
    </div>
  </section>
</template>

<style scoped>
/* wiki 五页签：与看板中栏同一套度量（11/13/17 字阶、6px 小圆角、token 着色）。
   表格与图都是只读读数，不设第二套交互；页签本身是 control-quiet 的紧凑档。 */
.nx-wiki-tabs {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.nx-wiki-tabs-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  flex: none;
  margin: 0 0 8px;
}

.nx-wiki-tabs-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}

.nx-wiki-tab {
  flex: none;
  min-height: 24px;
  padding: 2px 10px;
  border-radius: var(--nx-radius-pill);
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}

.nx-wiki-tab.is-active {
  background: var(--nav-selected);
  color: var(--archive-ink);
  font-weight: 500;
}

.nx-wiki-derive {
  flex: none;
}

.nx-wiki-derived {
  margin: 0 0 8px;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}

.nx-wiki-tab-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.nx-wiki-tab-caption {
  margin: 0 0 4px;
  font-size: var(--nx-fs-2xs);
  font-weight: 500;
  color: var(--text-muted);
}

.nx-wiki-tab-empty {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}

/* —— 概览 —— */
.nx-wiki-kpis {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 12px;
}

.nx-wiki-kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 88px;
  padding: 8px 12px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-xs);
  background: color-mix(in srgb, var(--archive-ink) 3%, transparent);
}

.nx-wiki-kpi-value {
  font-size: var(--nx-fs-xl);
  color: var(--archive-ink);
  font-variant-numeric: tabular-nums;
}

.nx-wiki-kpi-label {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}

.nx-wiki-type-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}

.nx-wiki-type-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}

.nx-wiki-type-count {
  color: var(--archive-ink);
  font-variant-numeric: tabular-nums;
}

/* —— 人物矩阵（热力档 0–4；色只走 --accent 的透明度档） —— */
.nx-wiki-matrix-wrap {
  overflow: auto;
}

.nx-wiki-matrix {
  border-collapse: collapse;
  font-size: var(--nx-fs-2xs);
}

.nx-wiki-matrix th,
.nx-wiki-matrix td {
  padding: 3px 6px;
  border: 1px solid var(--hairline-soft);
  text-align: center;
  white-space: nowrap;
}

.nx-wiki-matrix thead th {
  font-weight: 500;
  color: var(--text-muted);
}

.nx-wiki-matrix tbody th {
  text-align: start;
  font-weight: 500;
  color: var(--archive-ink);
}

.nx-wiki-matrix td {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.nx-wiki-matrix td.is-heat-1 {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.nx-wiki-matrix td.is-heat-2 {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.nx-wiki-matrix td.is-heat-3 {
  background: color-mix(in srgb, var(--accent) 30%, transparent);
}

.nx-wiki-matrix td.is-heat-4 {
  background: color-mix(in srgb, var(--accent) 45%, transparent);
}

/* —— 时间线 —— */
.nx-wiki-timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.nx-wiki-timeline-head {
  margin: 0 0 4px;
  font-size: var(--nx-fs-md);
  font-weight: 600;
  color: var(--archive-ink);
}

.nx-wiki-timeline-events {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--nx-fs-2xs);
  color: var(--text-primary);
}

.nx-wiki-timeline-event {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.nx-wiki-event-who {
  flex: none;
  color: var(--archive-ink);
}

.nx-wiki-event-channel {
  flex: none;
  padding: 0 5px;
  border-radius: var(--nx-radius-pill);
  background: color-mix(in srgb, var(--archive-ink) 6%, transparent);
  color: var(--text-muted);
}

/* —— 章纲 —— */
.nx-wiki-outline {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.nx-wiki-outline-card {
  padding: 10px 12px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-xs);
  background: color-mix(in srgb, var(--archive-ink) 2%, transparent);
}

.nx-wiki-outline-title {
  margin: 0 0 4px;
  font-size: var(--nx-fs-md);
  font-weight: 600;
  color: var(--archive-ink);
}

.nx-wiki-outline-summary {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  line-height: 1.7;
  color: var(--text-primary);
}

.nx-wiki-outline-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 4px 0 0;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}

/* —— 伏笔 —— */
.nx-wiki-foreshadow {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.nx-wiki-foreshadow-item {
  display: flex;
  gap: 8px;
  font-size: var(--nx-fs-2xs);
  color: var(--text-primary);
}

.nx-wiki-foreshadow-ch {
  flex: none;
  color: var(--archive-ink-soft);
}

/* —— 无 wiki（沉默层：不摆页签，只留一句说明与派生钮） —— */
.nx-wiki-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px 0;
}

.nx-wiki-empty-text {
  margin: 0;
  font-size: var(--nx-fs-md);
  color: var(--text-muted);
}
</style>
