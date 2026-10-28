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
import ImportSection from './settings/ImportSection.vue'
import PrimaryCarrierSection from './settings/PrimaryCarrierSection.vue'
import HistorySection from './settings/HistorySection.vue'
import WorkbenchTooltip from '../../src/components/workbench/WorkbenchTooltip.vue'
import { useBoardData } from './useBoardData.mjs'
import { IPC_CHANNELS, IPC_EVENT } from './ipcContract.mjs'
import { applyScheme, isValidScheme, readScheme, writeScheme } from './theme.mjs'

/**
 * Next 外壳根组件：Obsidian 三栏（图标竖条／索引窗／核心区）＋右栏运行时 ＋ 统一设置二级页。
 *
 * 分工（作者口径：正文是核心，不能被别的页面挤到旁边）：
 *   - 竖条：一格＝一块板（一个载体），纯图标，44px 宽；
 *   - 索引窗：竖条右边那一栏，列这块板的目录树（会话管理／文件结构管理那件事）；
 *   - 核心区：只挂 center 槽的 pane，正文在这里，宽的那一栏就是它；
 *   - 右栏：Pi-Agent 运行时独占（一级公民，插件抢不走）；
 *   - 设置（工单C0 · U13）：偏好／载体管理／新建项目／主载体选择一律收进
 *     SettingsModal 这一枚统一的二级页面（左栏目录＋右栏设置项）；
 *     D2 起「文档」组再收一节「文档历史」（快照列表／diff／恢复）。
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

/**
 * 当前文档（D2 历史面板的锚点）：索引窗选中什么，历史就查什么。
 * 路径与修订号都取自已读回的状态（不是列表页的旧值）——恢复时 expectedRevision 才对得上。
 */
const historyTarget = computed(() => {
  const selection = data.selection
  if (!selection?.type) return null
  if (selection.type === 'chapter' && data.chapter?.file) {
    return {
      kind: 'chapter',
      path: data.chapter.file,
      title: data.chapter.title ?? selection.item?.title ?? '章节',
      revision: Number.isInteger(data.chapter.revision) ? data.chapter.revision : 0
    }
  }
  if (selection.type === 'entry' && (data.entry?.path ?? selection.item?.path)) {
    return {
      kind: 'entry',
      path: data.entry?.path ?? selection.item.path,
      title: data.entry?.title ?? data.entry?.name ?? selection.item?.name ?? '条目',
      revision: Number.isInteger(data.entry?.revision) ? data.entry.revision : 0
    }
  }
  if (selection.type === 'note' && (data.note?.file ?? selection.item?.file)) {
    return {
      kind: 'note',
      path: data.note?.file ?? selection.item.file,
      title: data.note?.title ?? selection.item?.title ?? '构思',
      revision: Number.isInteger(data.note?.revision) ? data.note.revision : 0
    }
  }
  if (selection.type === 'outline-node') {
    return {
      kind: 'outline',
      path: '大纲/outline.json',
      title: '大纲',
      revision: Number.isInteger(data.outlineRevision) ? data.outlineRevision : 0
    }
  }
  return null
})

/** 统一设置二级页（工单C0 · U13）：一枚弹窗＝左栏目录＋右栏设置项。
 *  外壳只留挂载与 open／activeSection 两个状态；各节的内容与状态住在各自 SFC
 *  （next/shell/settings/，照 AssistantDialog 从 AuthoringKnowledgeAssistant 抽取的同一模式）。
 *  节的动作经事件上交：通道调用与 refresh 留在外壳（同 RuntimeDock 持桥发问的分工）。 */
const settingsOpen = ref(false)
const activeSection = ref('prefs')

/** 目录表：两组，设置五节＋文档历史（D2）。未登记的功能不许开弹窗（门禁见 next/tests/visual-contract.test.mjs）。 */
const settingsSections = computed(() => [
  { id: 'prefs', title: '偏好与模型', group: '设置', component: PrefsSection, props: { bridge: props.bridge, scheme: scheme.value } },
  { id: 'carriers', title: '载体管理', group: '设置', component: CarriersSection, props: { carriers: carriers.value } },
  { id: 'newProject', title: '新建项目', group: '设置', component: NewProjectSection, props: { bridge: props.bridge, primaryCarrierId: primaryCarrierId.value, extraEnabled: extraEnabled.value } },
  // 工单E1：导入既有稿（老作者带稿上车）。三步与建项目同级，落盘走主进程 project:import-run。
  { id: 'import', title: '导入既有稿', group: '设置', component: ImportSection, props: { bridge: props.bridge, primaryCarrierId: primaryCarrierId.value, extraEnabled: extraEnabled.value, currentProjectName: project.value?.name ?? null } },
  { id: 'primary', title: '主载体选择', group: '设置', component: PrimaryCarrierSection, props: { carriers: carriers.value, kinds: kinds.value, companions: companions.value, extraEnabled: extraEnabled.value } },
  { id: 'history', title: '文档历史', group: '文档', component: HistorySection, props: { bridge: props.bridge, target: historyTarget.value, restore: restoreHistoryVersion } }
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

/**
 * 导入既有稿（工单E1）：菜单「文件 → 导入既有稿…」的落点。
 * 不做「有项目就不给开」的闸——恰恰是老作者带着稿子上车时才需要它；
 * 向导里会明示「导入会切换到新项目」，避免误切时没看见。
 */
function openImport() {
  openSection('import')
}

/** 当前文档历史（D2）：菜单「文件 → 当前文档历史…」与索引窗行动作的共同落点。 */
function openHistory() {
  openSection('history')
}

/** 索引窗行动作：先把该文档读进来（修订号以磁盘为准），再摊开历史。 */
async function openHistoryFor(payload) {
  if (!payload) return
  if (payload.type === 'chapter') await data.openChapter(payload.item)
  else if (payload.type === 'entry') await data.openEntry(payload.item)
  else if (payload.type === 'note') data.openNote(payload.item)
  else if (payload.type === 'outline') data.selectOutlineNode(payload.index)
  openSection('history')
}

/**
 * 世界书历史版本是整份文件（含契约 frontmatter）；载体的 save 只收正文，
 * frontmatter 由工具按当前文件原样保留。这里只剥历史文本的头，不重写契约字段。
 */
function stripWorldbookFrontmatter(text) {
  const source = String(text ?? '')
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u.exec(source)
  return match ? source.slice(match[0].length) : source
}

/**
 * 恢复到某一版（D2）：内容已由 HistorySection 经 history.show 取到，
 * 这里只走载体自己的 save 工具（带 expectedRevision）——恢复＝新增一次版本，
 * 不绕过载体的 scope 与并发闸直写文件服务。
 */
async function restoreHistoryVersion({ target, text } = {}) {
  if (!target) return { ok: false, message: '没有可恢复的文档' }
  const revision = Number.isInteger(target.revision) ? target.revision : 0

  if (target.kind === 'chapter') {
    const saved = await data.tool('pinax_chapter_save', { file: target.path, text: String(text ?? ''), expectedRevision: revision })
    if (!saved.ok) return { ok: false, message: saved.message }
    await data.openChapter({ file: target.path, title: target.title })
    return { ok: true, message: `已恢复「${target.title}」· 第 ${saved.value.revision} 版；下一次快照会记为一条新版本。` }
  }

  if (target.kind === 'entry') {
    const body = stripWorldbookFrontmatter(text)
    if (!body.trim()) return { ok: false, message: '这一版条目只有契约头、没有正文，无法恢复。' }
    const saved = await data.tool('pinax_worldbook_save', { path: target.path, text: body, expectedRevision: revision })
    if (!saved.ok) return { ok: false, message: saved.message }
    const entry = data.entry ?? data.selection?.item
    if (entry) await data.openEntry(entry)
    return { ok: true, message: `已恢复「${target.title}」· 第 ${saved.value.revision} 版；下一次快照会记为一条新版本。` }
  }

  if (target.kind === 'note') {
    const saved = await data.tool('pinax_notes_save', { file: target.path, text: String(text ?? ''), expectedRevision: revision })
    if (!saved.ok) return { ok: false, message: saved.message }
    await data.loadNotes()
    const note = data.notes.find((item) => item.file === saved.value.file)
    if (note) data.openNote(note)
    return { ok: true, message: `已恢复「${target.title}」· 第 ${saved.value.revision} 版；下一次快照会记为一条新版本。` }
  }

  if (target.kind === 'outline') {
    let document
    try {
      document = JSON.parse(String(text ?? ''))
    } catch {
      return { ok: false, message: '这一版大纲不是合法 JSON，无法恢复。' }
    }
    const nodes = Array.isArray(document?.nodes) ? document.nodes : null
    if (!nodes?.length) return { ok: false, message: '这一版大纲没有节点，无法恢复。' }
    const saved = await data.tool('pinax_outline_save', {
      nodes,
      edges: Array.isArray(document.edges) ? document.edges : [],
      expectedRevision: revision
    })
    if (!saved.ok) return { ok: false, message: saved.message }
    await data.loadOutline()
    return { ok: true, message: `已恢复大纲 · 第 ${saved.value.revision} 版；下一次快照会记为一条新版本。` }
  }

  return { ok: false, message: `未知的文档类型：${String(target.kind)}` }
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

/** 主题切换（D2）：偏好 JSON 为准；过渡期由 theme.mjs 双写老前端的 app_theme 键。 */
async function persistTheme(value) {
  scheme.value = writeScheme(value)
  if (!props.bridge?.request) return
  try {
    await props.bridge.request(IPC_CHANNELS.prefsSet, { theme: scheme.value })
  } catch {
    // 偏好写失败时内存与老键的主题照样生效；下次切换会再试。
  }
}

function toggleTheme() {
  void persistTheme(scheme.value === 'dark' ? 'light' : 'dark')
}

/** 偏好节里的主题选择：同一条持久化路径，竖条的明暗按钮跟着变。 */
function applyThemeChoice(value) {
  void persistTheme(value)
}

/** 启动时以偏好为准；偏好还没有 theme（迁移前）→ 把老 localStorage 的值一次性迁进去。 */
async function syncThemeFromPrefs() {
  if (!props.bridge?.request) return
  let stored = null
  try {
    stored = await props.bridge.request(IPC_CHANNELS.prefsGet, {})
  } catch {
    return
  }
  if (!stored?.ok) return
  const theme = stored.value?.theme
  if (isValidScheme(theme)) {
    scheme.value = writeScheme(theme)
    return
  }
  try {
    await props.bridge.request(IPC_CHANNELS.prefsSet, { theme: scheme.value })
  } catch {
    // 迁移失败不拦：老键还在，下次启动再试。
  }
}

function startDrag(target, event) {
  dragging.value = target
  const startX = event.clientX
  const startValue = target === 'index' ? indexWidth.value : dockWidth.value
  // 两条把手都在各自面板的右缘：往左拖＝变宽。
  // 右栏的钳制对齐老版参考区 320–680（src/composables/useWorkspaceHost.js:286 的 resize()）；
  // 索引窗仍是老版目录窗的 200–360，不动。
  const move = (moveEvent) => {
    const next = startValue - (moveEvent.clientX - startX)
    if (target === 'index') indexWidth.value = Math.min(360, Math.max(200, next))
    else dockWidth.value = Math.min(680, Math.max(320, next))
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
  void syncThemeFromPrefs()
  void refresh()
  // 视口跨过 860px：窄屏收起索引窗（它会盖住正文），宽屏展开（桌面形态）。
  narrowQuery?.addEventListener?.('change', (event) => {
    indexOpen.value = !event.matches
  })
  // 应用菜单走主进程（文件／编辑／视图／运行时／窗口／帮助／设置），这里只接自己关心的那几条。
  props.bridge?.onEvent?.(IPC_EVENT.menuInvoked, (payload) => {
    if (payload?.id === 'project.create') openNewProject()
    if (payload?.id === 'project.import') openImport()
    if (payload?.id === 'project.history') openHistory()
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
        @history="openHistoryFor"
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

