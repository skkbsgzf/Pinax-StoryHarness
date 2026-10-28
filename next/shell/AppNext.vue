<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import ActivityRail from './ActivityRail.vue'
import IndexWindow from './IndexWindow.vue'
import CenterSlotHost from './CenterSlotHost.vue'
import RuntimeDock from './RuntimeDock.vue'
import SettingsModal from './SettingsModal.vue'
import PrefsSection from './settings/PrefsSection.vue'
import CarriersSection from './settings/CarriersSection.vue'
import NewProjectSection from './settings/NewProjectSection.vue'
import PrimaryCarrierSection from './settings/PrimaryCarrierSection.vue'
import WorkbenchTooltip from '../../src/components/workbench/WorkbenchTooltip.vue'
import { useBoardData } from './useBoardData.mjs'
import { IPC_CHANNELS, IPC_EVENT } from './ipcContract.mjs'
import { applyScheme, readScheme, writeScheme } from './theme.mjs'

/**
 * Next 外壳根组件：Obsidian 三栏（图标竖条／索引窗／核心区）＋右栏运行时 ＋ 统一设置二级页。
 *
 * 分工（作者口径：正文是核心，不能被别的页面挤到旁边）：
 *   - 竖条：一格＝一块板（一个载体），纯图标，44px 宽；
 *   - 索引窗：竖条右边那一栏，列这块板的目录树（会话管理／文件结构管理那件事）；
 *   - 核心区：只挂 center 槽的 pane，正文在这里，宽的那一栏就是它；
 *   - 右栏：Pi-Agent 运行时独占（一级公民，插件抢不走）；
 *   - 设置（工单C0 · U13）：偏好／载体管理／新建项目／主载体选择一律收进
 *     SettingsModal 这一枚统一的二级页面（左栏目录＋右栏设置项），
 *     核心区不再内嵌任何配置 section 与按钮，目录之外的弹窗不允许存在。
 *
 * 不引 vue-router、不引 Pinia、不 import src/ 的页面——零插件时外壳仍要能起来（M1 判据）。
 * 唯一从老前端拿的是 CSS 本体与三个叶子组件（图标／提示／提示宿主），风格与控件不另起一套。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  initialView: { type: Object, default: null }
})

const view = ref(props.initialView ?? null)
/** 章节／条目的单一归属：索引窗与核心区共用这一份，存完正文索引窗不会还写着旧版本号。 */
const data = useBoardData(props.bridge)
const activeBoardId = ref(null)
/**
 * 索引窗默认开合按视口宽度定：宽屏展开（Obsidian 桌面形态），窄屏（手机）收起——
 * 窄屏它会盖住正文，作者点竖条那一格再展开。窗口跨过 860px 时跟着换。
 */
const narrowQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 860px)') : null
const indexOpen = ref(!narrowQuery?.matches)
const indexWidth = ref(256)
const dockWidth = ref(360)
const dragging = ref(null)
/** 建项目向导里勾选的伴生板块（只申请只读权限的默认随行）。 */
const extraEnabled = ref([])
/** 明暗主题：键与 class 契约跟老前端 themeStore 一致，两边共用一份偏好。 */
const scheme = ref(readScheme())

const project = computed(() => view.value?.project ?? null)
const runtime = computed(() => view.value?.runtime ?? { tools: [], started: false, title: 'Pi-Agent', budgetPriority: 0, writeSurface: '.pinax/proposals/', reservedSlotReason: '' })
const leftItems = computed(() => view.value?.left ?? [])
const centerPanes = computed(() => view.value?.center ?? [])
const carriers = computed(() => view.value?.carriers ?? [])
const rejected = computed(() => view.value?.rejected ?? [])
const needsPrimary = computed(() => Boolean(view.value?.needsPrimary))
const openError = computed(() => view.value?.openError ?? null)
const kinds = computed(() => view.value?.kernel?.kinds ?? [])

/** 统一设置二级页（工单C0 · U13）：一枚弹窗＝左栏目录＋右栏设置项。
 *  外壳只留挂载与 open／activeSection 两个状态；四节的内容与状态住在各自 SFC
 *  （next/shell/settings/，照 AssistantDialog 从 AuthoringKnowledgeAssistant 抽取的同一模式）。
 *  节的动作经事件上交：通道调用与 refresh 留在外壳（同 RuntimeDock 持桥发问的分工）。 */
const settingsOpen = ref(false)
const activeSection = ref('prefs')

/** 目录表：本批登记四节；未登记的功能不许开弹窗（门禁见 next/tests/visual-contract.test.mjs）。 */
const settingsSections = computed(() => [
  { id: 'prefs', title: '偏好与模型', component: PrefsSection, props: { bridge: props.bridge, scheme: scheme.value } },
  { id: 'carriers', title: '载体管理', component: CarriersSection, props: { carriers: carriers.value } },
  { id: 'newProject', title: '新建项目', component: NewProjectSection, props: { bridge: props.bridge, primaryCarrierId: primaryCarrierId.value, extraEnabled: extraEnabled.value } },
  { id: 'primary', title: '主载体选择', component: PrimaryCarrierSection, props: { carriers: carriers.value, kinds: kinds.value, companions: companions.value, extraEnabled: extraEnabled.value } }
])

function openSection(id) {
  settingsOpen.value = true
  activeSection.value = id
}
function closeSettings() {
  settingsOpen.value = false
}

/** 菜单接线（工单C0 任务3）：settings.preferences／settings.carriers／project.create 各自落到自己的节。 */
function openSettings() {
  openSection('prefs')
}

/** 载体管理面：先 refresh 拿最新 view，别让面板摊着一份上一秒的启停状态。 */
async function openCarriers() {
  if (!project.value) return
  openSection('carriers')
  await refresh()
}

/** 新建项目（批次9 的闸原样保留）：只在「没有已打开的项目且装了可任主载体的板块」时摊得开。 */
function openNewProject() {
  if (project.value || !canPickPrimary.value) return
  openSection('newProject')
}

/** D1 硬闸（工单C0）：needsPrimary 时统一弹窗自动打开、落在主载体节且不可关闭——
 *  目录里其它节可看（可点开），但选完主载体之前弹窗关不了；needsPrimary 翻 false 即放行。 */
watch(needsPrimary, (now) => {
  if (now) {
    openSection('primary')
    return
  }
  if (activeSection.value === 'primary') closeSettings()
}, { immediate: true })

/**
 * 一块板＝一个载体：竖条一格、索引窗一份树、核心区一份正文。
 * 图标取这块板的目录窗 pane 声明的图标（清单原话），不是外壳自己编的。
 */
const boards = computed(() => {
  const byPlugin = new Map()
  for (const pane of [...leftItems.value, ...centerPanes.value]) {
    const id = pane.pluginId ?? pane.id
    if (!byPlugin.has(id)) {
      const carrier = carriers.value.find((item) => item.id === id)
      byPlugin.set(id, {
        id,
        title: pane.pluginTitle ?? pane.title ?? id,
        icon: pane.icon ?? 'library',
        primary: Boolean(pane.primary),
        dataDirs: carrier?.dataDirs ?? [],
        treePaneId: null,
        treePaneTitle: pane.title ?? '',
        centerPanes: []
      })
    }
    const board = byPlugin.get(id)
    if (pane.slot === 'center') board.centerPanes.push(pane)
    else if (!board.treePaneId) board.treePaneId = pane.id
  }
  return [...byPlugin.values()].sort((a, b) => Number(b.primary) - Number(a.primary))
})

const activeBoard = computed(() => boards.value.find((board) => board.id === activeBoardId.value) ?? boards.value[0] ?? null)
/** 核心区只挂这块板的 center 面板：正文不再被目录视图挤到旁边。 */
const activeCenterPane = computed(() => activeBoard.value?.centerPanes?.[0] ?? null)

/** 只申请只读作用域的板块适合默认随行：它贡献上下文块，不跟主载体抢写盘。 */
function isReadOnlyCompanion(carrier) {
  const scopes = carrier.scopes ?? []
  return scopes.length > 0 && scopes.every((scope) => !scope.endsWith(':rw'))
}
const companions = computed(() => carriers.value.filter((item) => !item.isPrimary))
/** 清单里声明了 primary 的板块才配当主载体：没有就明说空框架，不让作者点一个假的。 */
const canPickPrimary = computed(() => carriers.value.some((item) => item.primary))
/** 新建项目载荷里的主载体 id（原 createProject 内联的那一句，提出来给节经 props 注入）。 */
const primaryCarrierId = computed(() => carriers.value.find((item) => item.primary)?.id ?? null)

async function refresh() {
  if (!props.bridge?.request) return
  const result = await props.bridge.request(IPC_CHANNELS.view, {})
  if (result.ok) {
    view.value = result.value
    if (!activeBoardId.value) activeBoardId.value = boards.value.find((board) => board.primary)?.id ?? boards.value[0]?.id ?? null
    if (!project.value && !extraEnabled.value.length) {
      extraEnabled.value = companions.value.filter((item) => isReadOnlyCompanion(item) && !item.isEnabled).map((item) => item.id)
    }
  }
}

/** 点竖条：换板就换索引窗与正文；再点同一格＝收起索引窗（Obsidian 的行为）。 */
function selectBoard(id) {
  if (activeBoardId.value === id) {
    indexOpen.value = !indexOpen.value
    return
  }
  activeBoardId.value = id
  indexOpen.value = true
}

async function pickPrimary(pluginId) {
  if (!props.bridge?.request) return
  const revision = project.value?.revision ?? 0
  await props.bridge.request(IPC_CHANNELS.carrierSetPrimary, { pluginId, expectedRevision: revision })
  await refresh()
}

/** 启用／停用一个载体：翻转 enabled；主载体行不可停用自己（按钮已禁用，函数再闸一道）。
 *  revision 用当前 view 的值——陈旧写入内核会以 STALE_REVISION 拒掉，refresh 后如实呈现。 */
async function setCarrierEnabled(carrier) {
  if (!props.bridge?.request || carrier.isPrimary) return
  const revision = project.value?.revision ?? 0
  await props.bridge.request(IPC_CHANNELS.carrierSetEnabled, {
    pluginId: carrier.id,
    enabled: !carrier.isEnabled,
    expectedRevision: revision
  })
  await refresh()
}

function toggleCompanion(pluginId) {
  extraEnabled.value = extraEnabled.value.includes(pluginId)
    ? extraEnabled.value.filter((id) => id !== pluginId)
    : [...extraEnabled.value, pluginId]
}

function toggleTheme() {
  scheme.value = writeScheme(scheme.value === 'dark' ? 'light' : 'dark')
}

/** 偏好节里的主题选择：写回同一份 localStorage 契约，竖条的明暗按钮跟着变。 */
function applyThemeChoice(value) {
  scheme.value = writeScheme(value)
}

function startDrag(target, event) {
  dragging.value = target
  const startX = event.clientX
  const startValue = target === 'index' ? indexWidth.value : dockWidth.value
  // 两条把手都在各自面板的右缘：往左拖＝变宽。
  const move = (moveEvent) => {
    const next = startValue - (moveEvent.clientX - startX)
    if (target === 'index') indexWidth.value = Math.min(360, Math.max(200, next))
    else dockWidth.value = Math.min(640, Math.max(260, next))
  }
  const up = () => {
    dragging.value = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

onMounted(() => {
  applyScheme(scheme.value)
  void refresh()
  // 视口跨过 860px：窄屏收起索引窗（它会盖住正文），宽屏展开（桌面形态）。
  narrowQuery?.addEventListener?.('change', (event) => {
    indexOpen.value = !event.matches
  })
  // 应用菜单走主进程（文件／编辑／视图／运行时／窗口／帮助／设置），这里只接自己关心的那几条。
  props.bridge?.onEvent?.(IPC_EVENT.menuInvoked, (payload) => {
    if (payload?.id === 'project.create') openNewProject()
    if (payload?.id === 'settings.theme') toggleTheme()
    if (payload?.id === 'settings.preferences') void openSettings()
    if (payload?.id === 'settings.carriers') void openCarriers()
  })
})
</script>

<template>
  <div class="next-shell app-shell" :data-dragging="dragging">
    <ActivityRail
      :boards="boards"
      :active-id="activeBoardId"
      :open-id="indexOpen ? activeBoardId : null"
      :scheme="scheme"
      @select="selectBoard"
      @toggle-theme="toggleTheme"
    />

    <template v-if="indexOpen">
      <IndexWindow
        :board="activeBoard"
        :data="data"
        :archive="view?.archive ?? []"
        :width="indexWidth"
        @collapse="indexOpen = false"
      />
      <div class="resizer" role="separator" aria-orientation="vertical" @pointerdown="startDrag('index', $event)" />
    </template>

    <div class="col-center">
      <div v-if="openError" class="banner is-error">
        <strong>{{ openError.code }}</strong>
        <span>{{ openError.message }}</span>
      </div>
      <div v-for="item in rejected" :key="item.pluginId" class="banner is-warn">
        插件「{{ item.pluginId }}」未加载：{{ item.error?.message }}
      </div>

      <!-- 工单B0/C0（U13 作者裁定）：核心区是纯净的文档与组件展示——
           偏好／载体管理／主载体选择／新建项目全部收进统一的设置二级页（SettingsModal，模板尾部），
           这里不再内嵌任何配置 section。 -->

      <p v-if="!boards.length" class="center-empty">当前没有已启用的载体板块。右栏对话照常可用。</p>

      <CenterSlotHost
        :active-pane="activeCenterPane"
        :data="data"
        :project="project"
      />
    </div>

    <div class="resizer" role="separator" aria-orientation="vertical" @pointerdown="startDrag('right', $event)" />

    <div class="col-dock" :style="{ width: dockWidth + 'px' }">
      <RuntimeDock :runtime="runtime" :bridge="bridge" />
    </div>

    <!-- —— 统一设置二级页（工单C0 · U13）：一枚弹窗＝左栏目录＋右栏设置项 ——————————
         四节都登记在上面的目录表里；D1 硬闸（needsPrimary）时自动落在主载体节且不可关闭。 -->
    <SettingsModal
      :open="settingsOpen"
      :dismissable="!needsPrimary"
      :active-section="activeSection"
      :sections="settingsSections"
      @close="closeSettings"
      @changed="refresh"
      @theme="applyThemeChoice"
      @set-enabled="setCarrierEnabled"
      @set-primary="pickPrimary"
      @toggle-companion="toggleCompanion"
      @update:active-section="activeSection = $event"
    />

    <WorkbenchTooltip />
  </div>
</template>

