<script setup>
import { computed, onMounted, ref } from 'vue'
import ActivityRail from './ActivityRail.vue'
import IndexWindow from './IndexWindow.vue'
import CenterSlotHost from './CenterSlotHost.vue'
import RuntimeDock from './RuntimeDock.vue'
import WorkbenchTooltip from '../../src/components/workbench/WorkbenchTooltip.vue'
import { useBoardData } from './useBoardData.mjs'
import { IPC_CHANNELS, IPC_EVENT } from './ipcContract.mjs'
import { applyScheme, readScheme, writeScheme } from './theme.mjs'

/**
 * Next 外壳根组件：Obsidian 三栏（图标竖条／索引窗／核心区）＋右栏运行时 ＋ 主载体向导。
 *
 * 分工（作者口径：正文是核心，不能被别的页面挤到旁边）：
 *   - 竖条：一格＝一块板（一个载体），纯图标，44px 宽；
 *   - 索引窗：竖条右边那一栏，列这块板的目录树（会话管理／文件结构管理那件事）；
 *   - 核心区：只挂 center 槽的 pane，正文在这里，宽的那一栏就是它；
 *   - 右栏：Pi-Agent 运行时独占（一级公民，插件抢不走）。
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
const indexOpen = ref(true)
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

function toggleCompanion(pluginId) {
  extraEnabled.value = extraEnabled.value.includes(pluginId)
    ? extraEnabled.value.filter((id) => id !== pluginId)
    : [...extraEnabled.value, pluginId]
}

async function createProject(name) {
  if (!props.bridge?.request) return
  const primary = carriers.value.find((item) => item.primary)?.id ?? null
  if (!primary) return
  await props.bridge.request(IPC_CHANNELS.projectCreate, { name, primaryCarrier: primary, extraEnabled: extraEnabled.value })
  await refresh()
}

function toggleTheme() {
  scheme.value = writeScheme(scheme.value === 'dark' ? 'light' : 'dark')
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
  // 应用菜单走主进程（文件／编辑／视图／运行时／窗口／帮助／设置），这里只接自己关心的那一条。
  props.bridge?.onEvent?.(IPC_EVENT.menuInvoked, (payload) => {
    if (payload?.id === 'settings.theme') toggleTheme()
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

      <section v-if="needsPrimary" class="wizard" aria-label="主载体选择">
        <h3>这个项目要创作什么？</h3>
        <p class="wizard-note">
          主载体决定这个项目是哪一类（{{ kinds.join(' / ') }}）。
        </p>
        <div v-if="canPickPrimary" class="wizard-list">
          <button
            v-for="carrier in view.carriers.filter((item) => item.primary)"
            :key="carrier.id"
            type="button"
            class="wizard-item control-secondary"
            @click="pickPrimary(carrier.id)"
          >
            {{ carrier.title }} <small>{{ carrier.primary.projectKind }}</small>
          </button>
        </div>
        <p v-else class="wizard-empty">
          当前没有可担任主载体的插件板块。不装载体也能进来、能开项目、右栏能提问；
          随框架发布的小说／设定板块从 M2 起填在这里。
        </p>
        <div v-if="canPickPrimary && companions.length" class="wizard-companions">
          <p class="wizard-note is-tight">伴生板块（默认随行，只读权限——它们给正文补背景，不跟主载体抢写盘）：</p>
          <label v-for="carrier in companions" :key="carrier.id" class="wizard-companion">
            <input type="checkbox" :checked="extraEnabled.includes(carrier.id) || carrier.isEnabled" :disabled="carrier.isEnabled" @change="toggleCompanion(carrier.id)">
            {{ carrier.title }}
            <small>{{ carrier.isEnabled ? '已启用' : (carrier.dataDirs || []).join(' / ') }}</small>
          </label>
        </div>
        <div v-if="!project" class="wizard-bare">
          <button type="button" class="wizard-item control-secondary" @click="createProject('未命名新书')">用第一个可用载体新建项目</button>
        </div>
      </section>

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

    <WorkbenchTooltip />
  </div>
</template>
