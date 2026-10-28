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

/** 偏好与模型（批次8①）：应用级偏好面，菜单「设置 → 偏好与模型…」打开。 */
const settingsOpen = ref(false)
const prefsDraft = ref({ modelPlaneEndpoint: '', uiZoom: 0.85 })
const prefsBusy = ref(false)
const prefsFeedback = ref(null)
const probeState = ref(null)
const probeClass = computed(() => ({ ready: 'is-ready', 'no-model': 'is-warn', unreachable: 'is-error' })[probeState.value?.state ?? ''] ?? 'is-warn')
const probeText = computed(() => {
  const state = probeState.value
  if (!state) return ''
  if (state.state === 'ready') return `模型面就绪：${state.endpoint}`
  if (state.state === 'no-model') return `任务面可达但未配模型：请在 serve:pinax 一侧选择模型（${state.endpoint}）`
  return `模型面不可达：${state.endpoint}${state.detail ? `（${state.detail}）` : ''}。请启动 pi-agent 任务面（serve:pinax）或修改端点。`
})
/** 外观主题走 theme.mjs 的 localStorage 契约（与老前端共用 app_theme），偏好面只给它一个入口。 */
const themeDraft = ref('light')

/** 载体管理（工单A1）：项目打开后的启用／停用／切主载体面板，菜单「设置 → 载体管理…」打开。 */
const carriersOpen = ref(false)

/** 新建项目（批次9）：名字可改，目录必须经系统对话框选一个空文件夹——
 *  会话根（Documents）几乎必然非空，createProject 的空目录闸会永远拦住默认路径。 */
const newProjectName = ref('')
const newProjectDir = ref(null)

async function pickProjectDir() {
  if (!props.bridge?.request) return
  const result = await props.bridge.request(IPC_CHANNELS.projectPickDir, {})
  if (result.ok && result.value?.picked) newProjectDir.value = result.value.path
}

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

async function createProject() {
  if (!props.bridge?.request || !newProjectDir.value) return
  const primary = carriers.value.find((item) => item.primary)?.id ?? null
  if (!primary) return
  const result = await props.bridge.request(IPC_CHANNELS.projectCreate, {
    name: newProjectName.value.trim() || '未命名新书',
    primaryCarrier: primary,
    extraEnabled: extraEnabled.value,
    root: newProjectDir.value
  })
  if (result.ok) {
    newProjectDir.value = null
    newProjectName.value = ''
  }
  await refresh()
}

async function openSettings() {
  settingsOpen.value = true
  prefsFeedback.value = null
  probeState.value = null
  themeDraft.value = scheme.value
  if (!props.bridge?.request) return
  const result = await props.bridge.request(IPC_CHANNELS.prefsGet, {})
  if (result.ok) {
    prefsDraft.value = {
      modelPlaneEndpoint: result.value.modelPlaneEndpoint ?? '',
      uiZoom: result.value.uiZoom ?? 0.85
    }
  }
}

/** 载体管理面：先 refresh 拿最新 view，别让面板摊着一份上一秒的启停状态。 */
async function openCarriers() {
  carriersOpen.value = true
  await refresh()
}

async function probePlane() {
  if (!props.bridge?.request || prefsBusy.value) return
  prefsBusy.value = true
  probeState.value = null
  const result = await props.bridge.request(IPC_CHANNELS.prefsProbeModelPlane, {})
  prefsBusy.value = false
  probeState.value = result.ok ? result.value : { state: 'unreachable', endpoint: '', detail: result.error?.message ?? '探测失败' }
}

async function savePrefs() {
  if (!props.bridge?.request || prefsBusy.value) return
  prefsBusy.value = true
  prefsFeedback.value = null
  const result = await props.bridge.request(IPC_CHANNELS.prefsSet, {
    modelPlaneEndpoint: String(prefsDraft.value.modelPlaneEndpoint || '').trim() || null,
    uiZoom: Number(prefsDraft.value.uiZoom)
  })
  prefsBusy.value = false
  prefsFeedback.value = result.ok
    ? { kind: 'ok', text: '已保存并生效。' }
    : { kind: 'error', text: result.error?.message ?? '保存失败。' }
}

function toggleTheme() {
  scheme.value = writeScheme(scheme.value === 'dark' ? 'light' : 'dark')
}

/** 偏好面里的主题选择：写回同一份 localStorage 契约，竖条的明暗按钮跟着变。 */
function applyThemeChoice() {
  scheme.value = writeScheme(themeDraft.value)
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

      <section v-if="settingsOpen" class="wizard" aria-label="偏好与模型">
        <h3>偏好与模型</h3>
        <p class="wizard-note">应用级偏好，不随项目走。模型凭据仍由任务面（serve:pinax）持有——这里只决定「任务面在哪个端点」与界面观感。</p>
        <div class="prefs-grid">
          <div class="prefs-row">
            <span class="prefs-row-label">外观主题</span>
            <label class="wizard-companion"><input v-model="themeDraft" type="radio" name="prefs-theme" value="light" @change="applyThemeChoice"> 浅色</label>
            <label class="wizard-companion"><input v-model="themeDraft" type="radio" name="prefs-theme" value="dark" @change="applyThemeChoice"> 深色</label>
            <span class="prefs-row-hint">与老前端共用同一份偏好，改了那边也跟着变</span>
          </div>
          <div class="prefs-row">
            <span class="prefs-row-label">模型面端点</span>
            <input v-model="prefsDraft.modelPlaneEndpoint" class="nx-field prefs-input" type="text" placeholder="http://127.0.0.1:8451（留空＝默认 8451）">
            <button type="button" class="control-secondary" :disabled="prefsBusy" @click="probePlane">检测模型面</button>
          </div>
          <p v-if="probeState" class="prefs-state" :class="probeClass">{{ probeText }}</p>
          <div class="prefs-row">
            <span class="prefs-row-label">界面缩放</span>
            <input v-model.number="prefsDraft.uiZoom" class="nx-field prefs-zoom" type="number" min="0.5" max="2" step="0.05">
            <span class="prefs-row-hint">0.5–2.0，保存即生效</span>
          </div>
          <div class="prefs-actions">
            <button type="button" class="control-primary" :disabled="prefsBusy" @click="savePrefs">保存并生效</button>
            <button type="button" class="control-quiet" @click="settingsOpen = false">关闭</button>
            <span v-if="prefsFeedback" class="prefs-state" :class="prefsFeedback.kind === 'ok' ? 'is-ready' : 'is-error'">{{ prefsFeedback.text }}</span>
          </div>
        </div>
      </section>

      <!-- 载体管理（工单A1）：启停/切主载体是对项目合同的写入，只在该有项目时渲染（通道层同样这么闸）。 -->
      <section v-if="carriersOpen && project" class="wizard" aria-label="载体管理">
        <h3>载体管理</h3>
        <p class="wizard-note">这个项目装了哪些板块（载体），在这里启用、停用或换主载体。停用不删数据：目录转只读归档，随时可以再启用。</p>
        <div class="carriers-list">
          <div v-for="carrier in carriers" :key="carrier.id" class="carriers-row">
            <div class="carriers-info">
              <span class="carriers-title">
                {{ carrier.title }}
                <span v-if="carrier.isPrimary" class="carriers-badge">主载体</span>
              </span>
              <small class="carriers-meta">
                <span>{{ (carrier.dataDirs || []).join(' / ') || '无数据目录' }}</span>
                <span v-if="(carrier.scopes || []).length">权限：{{ carrier.scopes.join('、') }}</span>
                <span class="carriers-tools">工具 {{ (carrier.tools || []).length }}</span>
              </small>
            </div>
            <div class="carriers-actions">
              <button
                type="button"
                class="control-secondary carriers-toggle"
                :disabled="carrier.isPrimary"
                :title="carrier.isPrimary ? '主载体不可停用' : null"
                @click="setCarrierEnabled(carrier)"
              >{{ carrier.isEnabled ? '停用' : '启用' }}</button>
              <button
                v-if="!carrier.isPrimary && carrier.primary"
                type="button"
                class="control-quiet carriers-set-primary"
                @click="pickPrimary(carrier.id)"
              >设为主载体</button>
              <small v-if="carrier.isPrimary" class="carriers-hint">主载体不可停用</small>
            </div>
          </div>
        </div>
        <div class="prefs-actions">
          <button type="button" class="control-quiet" @click="carriersOpen = false">关闭</button>
        </div>
      </section>

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
      </section>

      <!-- 新建项目（批次9）：只要没有已打开的项目就可见——首启打开会话根失败（非 .pinax 目录）也必须能新建，
           不然作者卡死在错误横幅上。目录经系统对话框选空文件夹，createProject 的空目录闸靠它过。 -->
      <section v-if="!project && canPickPrimary" class="wizard" aria-label="新建项目">
        <h3>新建项目</h3>
        <p class="wizard-note">新项目是磁盘上的一个文件夹（文件夹即数据）：选一个空目录——也可以在对话框里新建，然后在里面开写。</p>
        <div class="prefs-grid">
          <div class="prefs-row">
            <span class="prefs-row-label">项目名称</span>
            <input v-model="newProjectName" class="nx-field prefs-input" type="text" placeholder="未命名新书">
          </div>
          <div class="prefs-row">
            <span class="prefs-row-label">项目文件夹</span>
            <button type="button" class="control-secondary" @click="pickProjectDir">选择空目录…</button>
            <span class="prefs-row-hint">{{ newProjectDir || '尚未选择' }}</span>
          </div>
          <div class="prefs-actions">
            <button type="button" class="control-primary" :disabled="!newProjectDir" @click="createProject">在所选目录新建项目</button>
          </div>
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

<style scoped>
/* 偏好面布局层（批次8①）：颜色与字号全走 token（U9/U10），这里只补栅格与输入宽度。 */
.prefs-grid { display: flex; flex-direction: column; gap: 14px; }
.prefs-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.prefs-row-label { flex: 0 0 auto; min-width: 88px; font-size: var(--nx-fs-md); color: var(--archive-ink-soft); }
.prefs-input { flex: 1 1 260px; width: auto; }
.prefs-zoom { flex: 0 0 96px; width: 96px; }
.prefs-row-hint { font-size: var(--nx-fs-md); color: var(--text-muted); }
.prefs-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.prefs-state { margin: 0; padding: 8px 12px; border-radius: var(--radius-control); font-size: var(--nx-fs-md); line-height: 1.7; }
.prefs-state.is-ready { border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent); background: color-mix(in srgb, var(--accent) 7%, transparent); color: var(--accent); }
.prefs-state.is-warn { border: 1px solid color-mix(in srgb, var(--signal-warm) 40%, transparent); background: color-mix(in srgb, var(--signal-warm) 10%, transparent); color: var(--signal-warm); }
.prefs-state.is-error { border: 1px solid color-mix(in srgb, var(--control-danger) 40%, transparent); background: color-mix(in srgb, var(--control-danger) 8%, transparent); color: var(--control-danger); }

/* 载体管理面（工单A1）：颜色与字号全走既有 token（视觉门禁 U9/U10），这里只补行布局与徽标。 */
.carriers-list { display: flex; flex-direction: column; gap: 8px; }
.carriers-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 10px 12px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--surface-workbench-muted) 60%, transparent);
}
.carriers-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.carriers-title { font-size: var(--nx-fs-md); color: var(--archive-ink); }
.carriers-badge {
  display: inline-block; margin-left: 6px; padding: 1px 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: var(--nx-radius-xs);
  font-size: var(--nx-fs-2xs); color: var(--accent);
}
.carriers-meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: var(--nx-fs-2xs); color: var(--text-muted); }
.carriers-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.carriers-hint { font-size: var(--nx-fs-2xs); color: var(--text-muted); }
</style>
