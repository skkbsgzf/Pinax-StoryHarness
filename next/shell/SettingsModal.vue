<script setup>
import { computed, nextTick } from 'vue'
import WorkbenchModal from './WorkbenchModal.vue'

/**
 * SettingsModal（工单C0 · U13 作者裁定）：统一的二级页面。
 * 设置／配置类功能不再各开各的弹窗，一律收进这一枚：左栏是设置分区目录（索引），
 * 右栏是当前节的设置项面板——解剖照 IDE/ZCode 设置页与老前端 SettingsPopup
 * （src/components/workbench/SettingsPopup.vue：左栏 nav.settings-navigation，
 * 右栏 section.settings-section，.modal-fade-* 过渡）。
 *
 * 底座是 WorkbenchModal（遮罩／圆角／Esc／过渡原样沿用，props open/dismissable/title 透传）。
 * 目录表 props.sections = [{ id, title, component, props? }] 注册——本批四节：
 * 偏好与模型／载体管理／新建项目／主载体选择；未登记的功能不许开弹窗
 * （门禁：next/tests/visual-contract.test.mjs「目录外弹窗不允许存在」的机器版）。
 *
 * 键盘语义取老版 tablist 的那半：目录 roving tabindex＋方向键换节（SettingsPopup.vue:489-501）。
 * 老版 C07 的 trapFocusWithin 焦点陷阱不在 Next 落地——它是 src/ 的 composable，
 * 薄渲染层门禁（next/tests/shell-contract.test.mjs「外壳引旧轨叶子件只引这三个」）不许引；
 * Tab 走浏览器默认顺序。
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  dismissable: { type: Boolean, default: true },
  title: { type: String, default: '设置' },
  activeSection: { type: String, default: '' },
  /** 目录表：[{ id, title, component, props? }]。 */
  sections: { type: Array, default: () => [] }
})
const emit = defineEmits(['close', 'changed', 'theme', 'set-enabled', 'set-primary', 'toggle-companion', 'update:activeSection'])

/** 当前节：目录里没有的 id 回落第一节，右栏不出现空窗。 */
const current = computed(() => props.sections.find((section) => section.id === props.activeSection) ?? props.sections[0] ?? null)
const currentProps = computed(() => current.value?.props ?? {})

function select(id) {
  if (id !== props.activeSection) emit('update:activeSection', id)
}

/** 方向键在目录上换节（roving tabindex，抄老版 SettingsPopup.vue:489-501）。 */
function onTablistKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const ids = props.sections.map((section) => section.id)
  if (!ids.length) return
  const index = ids.indexOf(current.value?.id ?? '')
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
           按钮本体落 .nx-row（Next 行按钮 primitive），激活态与配色按老版原件重刷。 -->
      <nav class="settings-tabs settings-navigation" role="tablist" aria-label="设置分区" @keydown="onTablistKeydown">
        <button
          v-for="section in sections"
          :id="`settings-tab-${section.id}`"
          :key="section.id"
          class="settings-tab nx-row"
          :class="{ active: section.id === current?.id }"
          :data-test="`settings-tab-${section.id}`"
          role="tab"
          :aria-selected="(section.id === current?.id).toString()"
          :aria-controls="`settings-panel-${section.id}`"
          :tabindex="section.id === current?.id ? 0 : -1"
          type="button"
          @click="select(section.id)"
        >{{ section.title }}</button>
      </nav>

      <div class="settings-modal__body">
        <section
          v-if="current"
          :id="`settings-panel-${current.id}`"
          class="settings-section"
          role="tabpanel"
          :aria-label="current.title"
          :data-test="`settings-panel-${current.id}`"
        >
          <component
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
.settings-navigation {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 12px;
  border: 0;
  background: var(--surface-workbench-muted);
  overflow-y: auto;
}
.settings-navigation .settings-tab {
  min-height: 40px;
  padding: 10px 12px;
  border: 0;
  text-align: left;
  color: var(--text-secondary);
}
.settings-navigation .settings-tab.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  font-weight: 500;
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
  .settings-navigation { flex-direction: row; flex-wrap: nowrap; padding: 8px; overflow-x: auto; }
  .settings-navigation .settings-tab { min-height: 44px; flex: none; }
}
</style>
