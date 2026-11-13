<script setup>
import { computed, nextTick, ref } from 'vue'
import LibraryCard from './LibraryCard.vue'
import CreateLibrary from './CreateLibrary.vue'
import ImportLibrary from './ImportLibrary.vue'
import OpenFailureCard from './OpenFailureCard.vue'
import { LIBRARY_FILTER_ALL, LIBRARY_FILTERS, buildLibraryFilterTabs, filterLibraryEntries } from './libraryFilters.mjs'

/**
 * 库管理器（前端重构工单 A）：无项目时的一级整窗视图。
 * 内部三视图：list（最近库＋动作）／create（两步建库，A-4）／import（四步导库，A-6）；
 * 打开失败修复卡（A-5）内嵌在 list 顶部——四类失败都有可点的下一步，不是死胡同。
 * 渲染零 IPC（工单 A-2）：最近清单与失败详情由外壳以 props 快照传入；全部动作只 emit，
 * 通道调用与错误处理留在外壳（与菜单同一条分发口径）。
 *
 * 工单 P1：标题与卡片之间加类型筛选条——类别只读 recentProjects[].kind（libraryFilters 纯函数），
 * 选中态只在会话内记忆、不落盘；计数为 0 的类别不渲染。某一类在移除记录后变空时，
 * 列表区给「这里还没有这一类库」空态与新建入口，不留白。
 */
const props = defineProps({
  /** 最近打开的库（appPreferences.recentProjects 快照；{path, name, kind, at}）。 */
  recents: { type: Array, default: () => [] },
  /** 建库／导库整页的通道出口（外壳转发层）。 */
  bridge: { type: Object, default: null },
  /** 打开失败（A-5）：{ path, error, details }；null＝无失败卡。 */
  openFailure: { type: Object, default: null },
  /** 可任主模块的板块（[{id, title, projectKind}]，声明了 primary 的）。 */
  primaryCarriers: { type: Array, default: () => [] },
  /** 模块清单与伴生（失败卡内嵌主模块选择用）。 */
  carriers: { type: Array, default: () => [] },
  companions: { type: Array, default: () => [] },
  extraEnabled: { type: Array, default: () => [] },
  /** 相对时间的基准（测试注入）。 */
  now: { type: Object, default: null }
})
const emit = defineEmits(['open', 'reveal', 'remove', 'open-folder', 'open-settings', 'create-done', 'set-primary', 'toggle-companion', 'open-modules'])

/** 内部路由：list／create／import（工单 A-4／A-6 整页流；不套设置弹窗）。 */
const view = ref('list')
const createInitialDir = ref(null)
const importInitialSource = ref(null)

function startCreate(path = null) {
  createInitialDir.value = path
  view.value = 'create'
}
function startImport(source = null) {
  importInitialSource.value = source
  view.value = 'import'
}
function backToList() {
  view.value = 'list'
}

const lead = () => (props.recents.length ? '接着写，或者开个新的。' : '从一个空文件夹开始你的下一本书。')

/** 筛选条（P1-1）：会话内记忆，默认「全部」；不写偏好、不落盘。 */
const activeFilter = ref(LIBRARY_FILTER_ALL)
const filterTabs = computed(() => buildLibraryFilterTabs(props.recents))
const visibleRecents = computed(() => filterLibraryEntries(props.recents, activeFilter.value))
const activeFilterLabel = computed(() => {
  if (activeFilter.value === LIBRARY_FILTER_ALL) return '全部'
  return LIBRARY_FILTERS.find((item) => item.id === activeFilter.value)?.label ?? '全部'
})

/**
 * roving tabindex 的 0 位（复用 SettingsModal.vue:225-252）：当前类别被移除（计数归零、
 * tab 不再渲染）时落到第一个可见项；选中态仍保留，好让下方空态说明「这一类空了」。
 */
const focusFilterId = computed(() => {
  const ids = filterTabs.value.map((tab) => tab.id)
  return ids.includes(activeFilter.value) ? activeFilter.value : ids[0] ?? null
})

/** 方向键左右换类别（只走渲染出来的 tab）；Home/End 到两端。 */
function onFilterKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = filterTabs.value
  if (!tabs.length) return
  const index = tabs.findIndex((tab) => tab.id === focusFilterId.value)
  let next = index < 0 ? 0 : index
  if (event.key === 'ArrowRight') next = (next + 1) % tabs.length
  if (event.key === 'ArrowLeft') next = (next - 1 + tabs.length) % tabs.length
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = tabs.length - 1
  if (next === index) return
  event.preventDefault()
  activeFilter.value = tabs[next].id
  void nextTick(() => document.getElementById(`library-filter-${tabs[next].id}`)?.focus())
}
</script>

<template>
  <div class="lib-manager" data-test="library-manager">
    <header class="lib-topbar">
      <span class="lib-brand">Pinax · Next</span>
      <h1 class="lib-title">我的库</h1>
      <button type="button" class="control-quiet lib-settings" data-test="library-open-settings" @click="emit('open-settings')">设置</button>
    </header>

    <main class="lib-body">
      <!-- ① 新建库整页（A-4） -->
      <CreateLibrary
        v-if="view === 'create'"
        :bridge="bridge"
        :primary-carriers="primaryCarriers"
        :extra-enabled="extraEnabled"
        :initial-dir="createInitialDir"
        @done="emit('create-done', $event)"
        @back="backToList"
      />

      <!-- ② 导入整页（A-6）：四步＋完成页两出口 -->
      <ImportLibrary
        v-else-if="view === 'import'"
        :bridge="bridge"
        :primary-carriers="primaryCarriers"
        :extra-enabled="extraEnabled"
        :initial-source="importInitialSource"
        @import-open="(payload) => emit('open', payload)"
        @done="backToList"
        @back="backToList"
      />

      <!-- ③ 列表态：失败修复卡（A-5）＋动作行＋最近库 -->
      <template v-else>
        <OpenFailureCard
          v-if="openFailure"
          :failure="openFailure"
          :primary-carriers="primaryCarriers"
          :carriers="carriers"
          :companions="companions"
          :extra-enabled="extraEnabled"
          @create-here="(path) => startCreate(path)"
          @import-here="(path) => startImport(path)"
          @set-primary="(pluginId) => emit('set-primary', pluginId)"
          @toggle-companion="(pluginId) => emit('toggle-companion', pluginId)"
          @open-modules="emit('open-modules')"
          @dismiss="emit('open', { __dismissFailure: true })"
        />

        <p class="lib-lead">{{ lead() }}</p>
        <div class="lib-actions">
          <button type="button" class="control-primary" data-test="library-new" @click="startCreate(null)">新建库</button>
          <button type="button" class="control-secondary" data-test="library-open-folder" @click="emit('open-folder')">打开文件夹</button>
          <button type="button" class="control-secondary" data-test="library-import" @click="startImport(null)">导入既有稿</button>
        </div>

        <section v-if="recents.length" class="lib-recent" aria-label="最近打开的库">
          <div class="lib-filterbar">
            <div class="lib-filters" role="tablist" aria-label="按类型筛选" @keydown="onFilterKeydown">
              <button
                v-for="tab in filterTabs"
                :id="`library-filter-${tab.id}`"
                :key="tab.id"
                type="button"
                class="lib-filter"
                role="tab"
                :aria-selected="(tab.id === activeFilter).toString()"
                aria-controls="library-filter-panel"
                :tabindex="tab.id === focusFilterId ? 0 : -1"
                :data-test="`library-filter-${tab.id}`"
                @click="activeFilter = tab.id"
              >
                <span>{{ tab.label }}</span>
                <span class="lib-filter-count">{{ tab.count }}</span>
              </button>
            </div>
          </div>

          <h2 class="lib-section-title">最近打开的库</h2>
          <div id="library-filter-panel" role="tabpanel" :aria-label="activeFilterLabel">
            <div v-if="visibleRecents.length" class="lib-grid">
              <LibraryCard
                v-for="entry in visibleRecents"
                :key="entry.path"
                :entry="entry"
                :now="now"
                @open="(entryItem) => emit('open', entryItem)"
                @reveal="(entryItem) => emit('reveal', entryItem)"
                @remove="(entryItem) => emit('remove', entryItem)"
              />
            </div>
            <div v-else class="lib-filter-empty" data-test="library-filter-empty">
              <p class="lib-filter-empty-text">这里还没有这一类库</p>
              <button type="button" class="control-secondary" data-test="library-filter-empty-new" @click="startCreate(null)">新建库</button>
            </div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
/* 库管理器（工单 A／C）：整窗一级视图；间距 4 的倍数；字号全走令牌（页面标题 --nx-fs-hero）。 */
.lib-manager {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--workbench-chrome);
  color: var(--text-secondary);
}
.lib-topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 32px;
  border-bottom: 1px solid var(--hairline-soft);
}
.lib-brand {
  font-size: var(--nx-fs-md);
  color: var(--text-muted);
}
.lib-title {
  flex: 1 1 auto;
  margin: 0;
  font-size: var(--nx-fs-hero);
  line-height: 1.2;
  font-weight: 600;
  color: var(--text-primary);
}
.lib-settings { flex: none; }
.lib-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 24px;
  width: min(960px, 92vw);
  margin: 0 auto;
  padding: 32px 24px 48px;
}
.lib-lead {
  margin: 0;
  font-size: var(--nx-fs-xl);
  color: var(--text-secondary);
}
.lib-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
/* 筛选条（P1-1）：原型是 Airbnb 式墨色下划线标签，不用色块；计数是角注胶囊。
   圆角/字号/颜色全走令牌；激活态同时有颜色与下划线，不单靠颜色传达。 */
.lib-filterbar {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}
.lib-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  border-bottom: 1px solid var(--hairline-soft);
}
.lib-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: -1px;
  padding: 8px 2px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--nx-fs-md);
  cursor: pointer;
}
.lib-filter:hover { color: var(--text-primary); }
.lib-filter[aria-selected="true"] {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
}
.lib-filter:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.lib-filter-count {
  min-width: 18px;
  padding: 0 6px;
  border-radius: var(--nx-radius-pill);
  background: var(--nav-hover);
  color: var(--text-muted);
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  text-align: center;
}
.lib-filter[aria-selected="true"] .lib-filter-count { color: var(--text-primary); }
.lib-filter-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 24px 16px;
  border: 1px dashed var(--hairline-soft);
  border-radius: var(--radius-surface);
}
.lib-filter-empty-text {
  margin: 0;
  font-size: var(--nx-fs-lg);
  color: var(--text-secondary);
}
.lib-section-title {
  margin: 0 0 12px;
  font-size: var(--nx-fs-lg);
  font-weight: 600;
  color: var(--text-primary);
}
.lib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
</style>
