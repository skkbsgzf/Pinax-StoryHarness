<script setup>
import { computed, nextTick, ref } from 'vue'
import WorkbenchModal from './WorkbenchModal.vue'

/**
 * SettingsModal（工单C0 · U13 作者裁定）：统一的二级页面。
 * 设置／配置类功能不再各开各的弹窗，一律收进这一枚：左栏是设置分区目录（索引），
 * 右栏是当前节的设置项面板——解剖照 IDE/ZCode 设置页与老前端 SettingsPopup
 * （src/components/workbench/SettingsPopup.vue：左栏 nav.settings-navigation，
 * 右栏 section.settings-section，.modal-fade-* 过渡）。
 *
 * 工单B（作者裁定：参照 Obsidian 设置页）：目录按 group 分组渲染（应用／项目／文档，
 * 载体声明的设置节归「载体」组），组标题只用 token；目录顶部一枚搜索框，按
 * 目录项标题＋注册表里的已知关键词做浅匹配（v1 不做渲染文本深搜）。
 *
 * 底座是 WorkbenchModal（遮罩／圆角／Esc／过渡原样沿用，props open/dismissable/title 透传）。
 * 目录表 props.sections = [{ id, title, group?, keywords?, component, props? }] 注册——分三组：
 * 「应用」偏好与模型／备份与恢复；「项目」载体管理／导入既有稿／新建项目／主载体选择；「文档」文档历史。
 * 载体设置（协议 P14 第一步）：props.carriers 的每块载体在目录里另挂一个「<载体> 设置」占位节
 * （「载体」组，右栏是空态说明）；清单里的 settings 声明本批先空数组，具体设置项后续批再注册。
 * 未登记的功能不许开弹窗（门禁：next/tests/visual-contract.test.mjs「目录外弹窗不允许存在」的机器版）。
 * 分组标签和目录项同在 tablist 里：标签是 <p>，不是 tab，不参与 roving tabindex；搜索框在 tablist 之外。
 *
 * 键盘语义取老版 tablist 的那半：目录 roving tabindex＋方向键换节（SettingsPopup.vue:489-501）。
 * 焦点陷阱（批次15 B · 差异表 #10）：打开时由底座 WorkbenchModal 对面板根起 next/shell/focusTrap.mjs
 * 的陷阱——焦点先收进面板、Tab 在面板内可聚焦元素之间循环、关闭/卸载时摘监听并归还打开前的焦点；
 * Esc 仍归 WorkbenchModal。老版 src/ 的 trapFocusWithin 是 composable，薄渲染层门禁不许引，
 * 这里是 next/ 内的纯 DOM 重写（同一行为，不引旧轨）。
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  dismissable: { type: Boolean, default: true },
  title: { type: String, default: '设置' },
  activeSection: { type: String, default: '' },
  /** 目录表：[{ id, title, group?, keywords?, component, props? }]。 */
  sections: { type: Array, default: () => [] },
  /** 视图里的载体清单：[{ id, title, dataDirs? }]——每块载体挂一个设置占位节（P14 第一步）。 */
  carriers: { type: Array, default: () => [] }
})
const emit = defineEmits(['close', 'changed', 'theme', 'set-enabled', 'set-primary', 'toggle-companion', 'update:activeSection'])

/** 目录搜索（工单B）：只过滤左栏，不换右栏当前节。 */
const searchQuery = ref('')

/**
 * 载体设置占位节（协议 P14 第一步）：清单里每块载体在目录里占一格「<载体> 设置」，
 * 右栏是空态说明。settings 声明（本批三载体都是空数组）留给后续批填内容，
 * 这里先立住「载体设置进统一目录」的机制。
 */
const carrierSections = computed(() => props.carriers
  .filter((carrier) => carrier?.id && carrier?.title)
  .map((carrier) => ({
    id: `carrier:${carrier.id}`,
    title: `${carrier.title} 设置`,
    group: '载体',
    kind: 'carrier-settings',
    carrierId: carrier.id,
    // 浅匹配只用已知字段：载体标题／「设置」／它认领的数据目录名；不做渲染文本深搜。
    keywords: [carrier.title, '设置', ...(Array.isArray(carrier.dataDirs) ? carrier.dataDirs : [])]
  })))

const allSections = computed(() => [...props.sections, ...carrierSections.value])

/** 当前节：目录里没有的 id 回落第一节，右栏不出现空窗。搜索不过滤当前节（右栏不跟着空）。 */
const current = computed(() => allSections.value.find((section) => section.id === props.activeSection) ?? allSections.value[0] ?? null)
const currentProps = computed(() => current.value?.props ?? {})

const normalizedQuery = computed(() => searchQuery.value.trim().toLowerCase())

/** 浅匹配（v1）：目录项标题＋注册表里的已知标题/描述关键词；不读挂载后的渲染文本。 */
function matchesQuery(section) {
  if (!normalizedQuery.value) return true
  const fields = [section.title, ...(section.keywords ?? [])]
  return fields.some((text) => String(text ?? '').toLowerCase().includes(normalizedQuery.value))
}

const visibleSections = computed(() => allSections.value.filter(matchesQuery))

/** 按 group 归组（同组只出一个标题；组序取首次出现顺序，不要求注册表里连续）。 */
const groupedSections = computed(() => {
  const order = []
  const groups = new Map()
  for (const section of visibleSections.value) {
    const name = section.group ?? '设置'
    if (!groups.has(name)) {
      groups.set(name, [])
      order.push(name)
    }
    groups.get(name).push(section)
  }
  return order.map((name) => ({ name, items: groups.get(name) }))
})

const visibleIds = computed(() => visibleSections.value.map((section) => section.id))

/** roving tabindex 的 0 位：当前节被搜索滤掉时落到第一个可见项（右栏当前节不变）。 */
const focusId = computed(() => (visibleIds.value.includes(current.value?.id) ? current.value.id : visibleIds.value[0] ?? null))

function select(id) {
  if (id !== props.activeSection) emit('update:activeSection', id)
}

/** 方向键在目录上换节（roving tabindex，抄老版 SettingsPopup.vue:489-501）——只走可见项。 */
function onTablistKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const ids = visibleIds.value
  if (!ids.length) return
  const index = ids.indexOf(focusId.value ?? '')
  let next = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % ids.length
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + ids.length) % ids.length
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = ids.length - 1
  if (next === index || next < 0) return
  event.preventDefault()
  select(ids[next])
  void nextTick(() => document.getElementById(`settings-tab-${ids[next]}`)?.focus())
}
</script>

<template>
  <WorkbenchModal
    :open="open"
    :dismissable="dismissable"
    :title="title"
    @close="emit('close')"
  >
    <div class="settings-layout">
      <!-- legacy-copied：左栏目录照抄 src/components/workbench/SettingsPopup.vue:15-30
           （settings-tabs／settings-navigation 词汇、tablist／tab 角色与 roving tabindex）；
           按钮本体落 .nx-row（Next 行按钮 primitive），激活态与配色按老版原件重刷。
           工单B：目录顶部加搜索框（照 Obsidian 设置页），分组标题按 group 现算。 -->
      <div class="settings-sidebar">
        <input
          v-model="searchQuery"
          class="nx-field settings-search"
          type="search"
          placeholder="搜索设置"
          aria-label="搜索设置"
          data-test="settings-search"
        >
        <nav class="settings-tabs settings-navigation" role="tablist" aria-label="设置分区" @keydown="onTablistKeydown">
          <template v-for="group in groupedSections" :key="group.name">
            <!-- 分组标题：同一 tablist 里的静态标题，不是 tab，不参与方向键换节。 -->
            <p class="settings-group-label" aria-hidden="true">{{ group.name }}</p>
            <button
              v-for="section in group.items"
              :id="`settings-tab-${section.id}`"
              :key="section.id"
              class="settings-tab nx-row"
              :class="{ active: section.id === current?.id }"
              :data-test="`settings-tab-${section.id}`"
              role="tab"
              :aria-selected="(section.id === current?.id).toString()"
              :aria-controls="`settings-panel-${section.id}`"
              :tabindex="section.id === focusId ? 0 : -1"
              type="button"
              @click="select(section.id)"
            >{{ section.title }}</button>
          </template>
        </nav>
        <!-- 搜索无命中（工单B）：目录给一句话，不留白。空查询不报「无匹配」；不放进 tablist 里。 -->
        <p v-if="!visibleSections.length && normalizedQuery" class="pane-hint settings-empty" data-test="settings-empty">无匹配设置</p>
      </div>

      <div class="settings-modal__body">
        <section
          v-if="current"
          :id="`settings-panel-${current.id}`"
          class="settings-section"
          role="tabpanel"
          :aria-label="current.title"
          :data-test="`settings-panel-${current.id}`"
        >
          <!-- 载体设置占位节（P14 第一步）：目录先占位，内容后续批注册。 -->
          <p
            v-if="current.kind === 'carrier-settings'"
            class="pane-hint"
            data-test="carrier-settings-empty"
          >该载体的设置项还没有内容</p>
          <component
            v-else
            :is="current.component"
            v-bind="currentProps"
            @close="emit('close')"
            @changed="emit('changed')"
            @theme="(value) => emit('theme', value)"
            @set-enabled="(carrier) => emit('set-enabled', carrier)"
            @set-primary="(pluginId) => emit('set-primary', pluginId)"
            @toggle-companion="(pluginId) => emit('toggle-companion', pluginId)"
          />
        </section>
      </div>
    </div>
  </WorkbenchModal>
</template>

<style scoped>
/* legacy-copied：两栏骨架与目录度量逐条抄自 src/components/workbench/SettingsPopup.vue:778-796
   （960×720 的两栏网格、184px 目录栏、muted 底、active 行 --bg-hover、窄屏目录转横条），
   不是另立刻度。弹窗尺寸压过 WorkbenchModal 的单块面板默认值（那是给单节内容用的）。 */
.workbench-modal :deep(.workbench-modal-panel) {
  width: min(960px, 94vw);
  height: min(720px, 88vh);
  max-height: min(88vh, 100%);
  overflow: hidden;
}
.settings-layout {
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr);
  flex: 1 1 auto;
  min-height: 0;
}
/* 目录栏（工单B）：搜索框＋分组目录。muted 底从 nav 提升到这一层，搜索框才有同一块底。 */
.settings-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px 12px;
  background: var(--surface-workbench-muted);
}
.settings-search {
  flex: none;
  margin: 0 0 8px;
  min-height: 32px;
  padding: 6px 10px;
  font-size: var(--nx-fs-md);
}
.settings-navigation {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  overflow-y: auto;
}
.settings-navigation .settings-tab {
  min-height: 40px;
  padding: 10px 12px;
  border: 0;
  text-align: left;
  color: var(--text-secondary);
}
/* 分组标题（应用／项目／文档／载体）：老版设置弹窗的目录分段语义，静态文本不是 tab。 */
.settings-navigation .settings-group-label {
  margin: 8px 12px 2px;
  color: var(--text-muted);
  font-size: var(--nx-fs-2xs);
  letter-spacing: 0.06em;
}
.settings-navigation .settings-group-label:first-child {
  margin-top: 0;
}
.settings-navigation .settings-tab.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  font-weight: 500;
}
.settings-empty {
  margin: 8px 4px 0;
}
.settings-modal__body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
}
@media (max-width: 640px) {
  .settings-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .settings-sidebar { padding: 8px; }
  .settings-navigation { flex-direction: row; flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; }
  .settings-navigation .settings-tab { min-height: 44px; flex: none; }
  .settings-navigation .settings-group-label { display: none; }
}
</style>
