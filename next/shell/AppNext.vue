<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ActivityRail from './ActivityRail.vue'
import IndexWindow from './IndexWindow.vue'
import CenterSlotHost from './CenterSlotHost.vue'
import CarrierPaneHost from './CarrierPaneHost.vue'
import FloatingWidget from './FloatingWidget.vue'
import RuntimeDock from './RuntimeDock.vue'
import SettingsModal from './SettingsModal.vue'
import PrefsSection from './settings/PrefsSection.vue'
import CarriersSection from './settings/CarriersSection.vue'
import NewProjectSection from './settings/NewProjectSection.vue'
import ImportSection from './settings/ImportSection.vue'
import OutlineImportSection from './settings/OutlineImportSection.vue'
import BackupSection from './settings/BackupSection.vue'
import PrimaryCarrierSection from './settings/PrimaryCarrierSection.vue'
import HistorySection from './settings/HistorySection.vue'
import ProposalsSection from './settings/ProposalsSection.vue'
import ExportSection from './settings/ExportSection.vue'
import WritingPrefsSection from './settings/WritingPrefsSection.vue'
import WorkbenchTooltip from '../../src/components/workbench/WorkbenchTooltip.vue'
import { useBoardData } from './useBoardData.mjs'
import { IPC_CHANNELS, IPC_EVENT } from './ipcContract.mjs'
import { MENU_TEMPLATE } from './menus.mjs'
import {
  PANE_FORMS,
  PANE_FORM_LABELS,
  sanitizePaneForms
} from './paneForms.mjs'
import {
  hostWorkspace,
  instanceIdFor,
  isPlacement,
  subscribeWorkspace
} from './workspace.mjs'
import { legacyLocalStorage, migrateLegacyWorkspace } from './workspaceMigration.mjs'
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
 *     E1 导入既有稿、G2 备份与恢复也登记在这张目录里；
 *     D2 起「文档」组再收一节「文档历史」（快照列表／diff／恢复）；
 *     工单B 起目录按「应用／项目／文档」分组并带搜索，载体设置占位节归「载体」组。
 *     核心区不再内嵌任何配置 section 与按钮，目录之外的弹窗不允许存在。
 *     工单B1：索引窗不再摆提案区——「文档」组新增「提案审阅」节（协议 v1.1-B），
 *     列表在设置里看、点开即关窗并把 selection 置为该提案，核心区沿用既有审阅面。
 *     工单C（协议 v1.1-C）：载体可以声明 overlay pane（悬浮小工具窗）——外壳用宿主
 *     FloatingWidget 渲染（定位/拖动/收起/位置记忆全在宿主），内容按 pane id 在这里接线；
 *     大纲悬浮窗在正文写作时也能用（大纲板不必是当前板）。
 *     工单A（协议 v1.2 P18–P21）：载体按 manifest.panes 的 forms 声明可选 dock/split/overlay/fullscreen；
 *     竖条格与索引窗树行右键出「打开方式」，形态归 paneForms.mjs 的宿主状态机，载体 SFC 不感知。
 *     浮窗可吸附侧缘（宿主容器子状态）或扩至中栏全屏；分屏副栏 v1 只挂一块（多副栏记账）。
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
/** 写作偏好（工单B）：字号／行高的兜底值与 appPreferences.PREFS_DEFAULTS 一致（17／1.9）。 */
const WRITING_FONT_SIZE_DEFAULT = 17
const WRITING_LINE_HEIGHT_DEFAULT = 1.9
const writingPrefs = ref({ fontSize: WRITING_FONT_SIZE_DEFAULT, lineHeight: WRITING_LINE_HEIGHT_DEFAULT })

/**
 * 多形态打开（协议 v1.2 P18–P21 → M2.5-C 四轴）：宿主一份工作区状态，AppNext 只订阅快照。
 * 位置（placement）／最小化（minimized）／几何（geometry）／还原记忆（restore）都是工作区的一轴，
 * 落 `.pinax/workspace.json`（项目级，经主进程通道），不再写 localStorage。
 * 形态由载体 manifest.panes 的 forms 声明；未声明的形态不出现（见 formTargetsForBoard）。
 */
const workspaceSnapshot = ref(hostWorkspace.snapshot())
const unsubscribeWorkspace = subscribeWorkspace((snapshot) => {
  workspaceSnapshot.value = snapshot
})

/** 一块 pane 的缺省实例（`<paneId>#1`）。第二份起由 openInstance 分配，#n 各记各的状态。 */
function paneInstance(paneId) {
  return instanceIdFor(paneId, 1)
}

/** 某条实例的状态（没记录时给一份不落盘的缺省）。 */
function paneState(instance) {
  return workspaceSnapshot.value.entries[instance] ?? hostWorkspace.get(instance)
}

/** 当前 pane 的位置（缺省 dock）。模板与 computed 都走这一条，避免各写各的默认值。 */
function paneFormOf(paneId) {
  return paneState(paneInstance(paneId))?.placement ?? 'dock'
}

/** 当前 pane 的最小化状态（缺省 none）。 */
function minimizedOf(paneId) {
  return paneState(paneInstance(paneId))?.minimized ?? 'none'
}

/** 某条实例的几何（null＝还没拖过）。 */
function geometryOf(instance) {
  return paneState(instance)?.geometry ?? null
}

/** P21 的宿主统一入口（右键菜单与浮窗按钮都走这一条）。 */
function setPaneForm(paneId, form) {
  return hostWorkspace.place(paneInstance(paneId), form)
}

/** 一块 pane 的全部实例 id（#1 永远在，第二份起由「再开一份」创建）。 */
function overlayInstances(paneId) {
  return hostWorkspace.instancesOf(paneId)
}

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

/**
 * 导出目标（批次26）：当前打开的那一份文档。
 * 锚点与历史面板同一个（data.selection），但取的是「作者此刻看到的那份文本」——
 * 编辑态取草稿（未保存的改动也在），阅读态取读回来的正文；没有打开文档就是 null。
 * 只在六个有正文的载体之间取：章节／条目／构思／资料／约束／剧本（大纲是结构不是正文，不导）。
 */
const exportDocumentTarget = computed(() => {
  const selection = data.selection
  if (!selection?.type) return null
  if (selection.type === 'chapter' && data.chapter?.file) {
    return { kind: 'chapter', title: data.chapter.title ?? selection.item?.title ?? '章节', path: data.chapter.file, text: data.draft ?? '' }
  }
  if (selection.type === 'entry' && data.entry?.path) {
    return {
      kind: 'entry',
      title: data.entry.name ?? selection.item?.name ?? '条目',
      path: data.entry.path,
      text: data.editingEntry ? (data.entryDraft ?? '') : (data.entry.content ?? '')
    }
  }
  if (selection.type === 'note' && data.note?.file) {
    return { kind: 'note', title: data.note.title ?? '构思', path: data.note.file, text: data.noteDraft ?? data.note.text ?? '' }
  }
  if (selection.type === 'document' && data.document?.file) {
    return {
      kind: 'document',
      title: data.document.title ?? '资料',
      path: data.document.file,
      text: data.editingDocument ? (data.documentDraft ?? '') : (data.document.text ?? '')
    }
  }
  if (selection.type === 'rule' && data.rule?.file) {
    return { kind: 'rule', title: data.rule.title ?? '约束', path: data.rule.file, text: data.ruleDraft ?? data.rule.text ?? '' }
  }
  if (selection.type === 'script' && data.script?.file) {
    return {
      kind: 'script',
      title: data.script.title ?? '剧本',
      path: data.script.file,
      text: data.editingScript ? (data.scriptDraft ?? '') : (data.script.text ?? '')
    }
  }
  return null
})

/**
 * @ 引用清单（批次27 · 任务三）：从 board data 组一份 { kind, title, path } 交给右栏。
 * 只列已经载入过的树——为了这份清单额外读盘会顺手打开第一条（loadEntries 的既有行为），
 * 那不是作者点的事，所以这里只做投影，不触发取数。对应栏目打开过一次，它的内容就会出现在 @ 里。
 */
const referenceCatalog = computed(() => {
  const out = []
  for (const chapter of data.chapters ?? []) {
    if (!chapter?.file) continue
    out.push({ kind: 'chapter', title: chapter.title ?? chapter.file, path: chapter.file })
  }
  for (const entry of data.entries ?? []) {
    if (!entry?.path) continue
    out.push({ kind: 'entry', title: entry.name ?? entry.title ?? entry.path, path: entry.path, id: entry.id ?? null })
  }
  for (const document of data.documents ?? []) {
    if (!document?.file) continue
    out.push({ kind: 'document', title: document.title ?? document.file, path: document.file })
  }
  for (const script of data.scripts ?? []) {
    if (!script?.file) continue
    out.push({ kind: 'script', title: script.title ?? script.file, path: script.file })
  }
  return out
})

/** 统一设置二级页（工单C0 · U13）：一枚弹窗＝左栏目录＋右栏设置项。
 *  外壳只留挂载与 open／activeSection 两个状态；各节的内容与状态住在各自 SFC
 *  （next/shell/settings/，照 AssistantDialog 从 AuthoringKnowledgeAssistant 抽取的同一模式）。
 *  节的动作经事件上交：通道调用与 refresh 留在外壳（同 RuntimeDock 持桥发问的分工）。 */
const settingsOpen = ref(false)
const activeSection = ref('prefs')

/**
 * 载体声明节的内容组件表（工单B · P14 第三步）：键是「声明 id」（不是载体 id）。
 * 第一个真内容＝novel.writing → WritingPrefsSection；props 里是当前偏好值。
 * 合并（声明 → 目录项 → 组件）在 SettingsModal.carrierSections 里做：没有映射的声明仍出空态。
 */
const carrierSectionComponents = computed(() => ({
  'novel.writing': {
    component: WritingPrefsSection,
    props: {
      bridge: props.bridge,
      fontSize: writingPrefs.value.fontSize,
      lineHeight: writingPrefs.value.lineHeight
    }
  }
}))

/**
 * 目录表（工单B · 作者裁定：参照 Obsidian 设置页）。
 * 三组：「应用」不随项目走的偏好与整目录搬运；「项目」对当前项目的载体/结构动作；「文档」文档历史。
 * keywords 是各节标题/说明字段的浅匹配摘要——只给目录搜索用（SettingsModal 不读渲染文本，v1 不做全文深搜）。
 * 载体设置占位节不在这张表里：SettingsModal 从 view.carriers 动态补「载体」组（协议 P14 第一步）。
 * 未登记的功能不许开弹窗（门禁见 next/tests/visual-contract.test.mjs）。
 */
const settingsSections = computed(() => [
  // 应用
  { id: 'prefs', title: '偏好与模型', group: '应用', keywords: ['外观主题', '模型面端点', '界面缩放', '应用级偏好', '明暗'], component: PrefsSection, props: { bridge: props.bridge, scheme: scheme.value } },
  // 工单G2：备份与恢复（整目录复制，零新依赖）。导出/恢复都是主进程的结构动作，与导入同级。
  { id: 'backup', title: '备份与恢复', group: '应用', keywords: ['导出备份', '从备份恢复', '历史仓', '复制'], component: BackupSection, props: { bridge: props.bridge, project: project.value } },
  // 项目
  { id: 'carriers', title: '载体管理', group: '项目', keywords: ['板块', '载体', '启用', '停用', '主载体', '权限', '数据目录'], component: CarriersSection, props: { carriers: carriers.value } },
  // 工单E1：导入既有稿（老作者带稿上车）。三步与建项目同级，落盘走主进程 project:import-run。
  { id: 'import', title: '导入既有稿', group: '项目', keywords: ['带稿上车', '稿子目录', '项目位置', '导入计划', '原文件只新增不修改'], component: ImportSection, props: { bridge: props.bridge, primaryCarrierId: primaryCarrierId.value, extraEnabled: extraEnabled.value, currentProjectName: project.value?.name ?? null } },
  { id: 'newProject', title: '新建项目', group: '项目', keywords: ['项目名称', '项目文件夹', '空目录', '磁盘上的一个文件夹'], component: NewProjectSection, props: { bridge: props.bridge, primaryCarrierId: primaryCarrierId.value, extraEnabled: extraEnabled.value } },
  { id: 'primary', title: '主载体选择', group: '项目', keywords: ['这个项目要创作什么', '创作小说还是剧本'], component: PrimaryCarrierSection, props: { carriers: carriers.value, kinds: kinds.value, companions: companions.value, extraEnabled: extraEnabled.value } },
  // 文档
  { id: 'history', title: '文档历史', group: '文档', keywords: ['快照', '历史版本', '恢复', 'diff'], component: HistorySection, props: { bridge: props.bridge, target: historyTarget.value, restore: restoreHistoryVersion } },
  // 工单B1（协议 v1.1-B）：提案审阅迁出小说板索引窗，收进统一二级页的「文档」组。
  // 数据走 useBoardData 的同一份（loadProposals → pinax_proposal_list），不另开取数路径。
  { id: 'proposals', title: '提案审阅', group: '文档', keywords: ['提案', '模型改稿', '采纳', '弃用', 'proposals'], component: ProposalsSection, props: { data, open: openProposalFromSettings } },
  // 批次26（任务三）：导出当前打开的文档（txt／doc）。锚点与历史面板共用 data.selection。
  { id: 'export', title: '导出', group: '文档', keywords: ['导出', '另存为', 'txt', 'doc', 'word', '纯文本', '下载'], component: ExportSection, props: { bridge: props.bridge, document: exportDocumentTarget.value } },
  // 批次30：散文章节稿 → 大纲/outline.json。只追加缺的章节，现有节点不动（dryRun 扫描后才落盘）。
  { id: 'outline-import', title: '大纲转换', group: '文档', keywords: ['大纲', '章节稿', 'outline', '001-004', '散文', '转换', 'md'], component: OutlineImportSection, props: { bridge: props.bridge, project: project.value, reload: data.loadOutline } }
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

/** 导入既有稿（工单E1）：菜单「文件 → 导入既有稿…」的落点。
 * 不做「有项目就不给开」的闸——恰恰是老作者带着稿子上车时才需要它；
 * 向导里会明示「导入会切换到新项目」，避免误切时没看见。
 */
function openImport() {
  openSection('import')
}

/** 备份与恢复（工单G2）：菜单「文件 → 备份与恢复…」的落点。
 *  与导入同一口径——不拦「有项目才给开」：恢复本来就是在别处打开面之前先把项目弄出来；
 *  导出按钮在没有项目时自己会说「先打开一个项目」（备份的是当前项目）。 */
function openBackup() {
  openSection('backup')
}

/** 当前文档历史（D2）：菜单「文件 → 当前文档历史…」与索引窗行动作的共同落点。 */
function openHistory() {
  openSection('history')
}

/** 提案审阅（工单B1）：菜单「项目 → 提案审阅…」的落点——统一二级页的「文档 → 提案审阅」节。 */
function openProposals() {
  openSection('proposals')
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
 * 打开项目文件夹（工单F · 作者反馈②「打开项目这个操作根本行不通」）：
 * 菜单「文件 → 打开项目文件夹…」与竖条「打开项目…」的共同落点。
 * 选目录（默认 purpose）→ 取消就什么都不做 → project:open → refresh。
 * 打开失败（如大梦这类 D2 闸）不改走别的路：view.openError 的横幅会把内核那句原因原样摊开。
 */
async function openProjectFolder() {
  if (!props.bridge?.request) return
  const picked = await props.bridge.request(IPC_CHANNELS.projectPickDir, {})
  if (!picked?.ok || !picked.value?.picked || !picked.value.path) return
  try {
    await props.bridge.request(IPC_CHANNELS.projectOpen, { root: picked.value.path })
  } catch {
    // 桥自身抛错也落到 refresh：外壳照常把最新状态画出来，不白屏。
  }
  await refresh()
}

/* —— 标题栏与页内菜单行（工单F · 作者反馈①②）————————————————————
 * 原生应用菜单保留（accelerator 仍由主进程的 Menu.setApplicationMenu 提供）；
 * 可见的菜单行改成页内渲染，数据源就是同一份 MENU_TEMPLATE（./menus.mjs）——
 * 菜单项不另立第二份清单；点击一律经 menuInvoke 通道（与原生菜单同一条分发），
 * 页面内的落点（开弹窗／换主题／打开项目）与原生菜单事件共用 menuActions。 */
const openMenuLabel = ref(null)
const menubarRoot = ref(null)

/** 模板里的角色项没有 label（原生菜单由 Electron 自己取名），页内菜单行补一份人话。 */
const ROLE_LABELS = Object.freeze({
  undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
  minimize: '最小化', zoom: '缩放', close: '关闭窗口',
  resetZoom: '重置缩放', zoomIn: '放大', zoomOut: '缩小',
  toggleDevTools: '开发者工具', reload: '重新加载', quit: '退出'
})

function menuLabel(item) {
  return item?.label ?? ROLE_LABELS[item?.role] ?? String(item?.role ?? '')
}

/** 项目信息 chip（作者反馈①）：有项目给「名称 · 类型 · 第 N 版」，没有就明说未打开。 */
const projectChip = computed(() => {
  const current = project.value
  if (!current) return '未打开项目'
  const name = current.name ?? '未命名项目'
  const kind = current.kind ?? '未定类型'
  const revision = Number.isFinite(current.revision) ? current.revision : 0
  return `${name} · ${kind} · 第 ${revision} 版`
})

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform ?? '')
function acceleratorHint(accelerator) {
  if (!accelerator) return ''
  return isMac ? accelerator.replace('CmdOrCtrl', '⌘') : accelerator.replace('CmdOrCtrl', 'Ctrl')
}

function toggleTopMenu(label) {
  openMenuLabel.value = openMenuLabel.value === label ? null : label
}
function hoverTopMenu(label) {
  openMenuLabel.value = label
}
function closeTopMenu() {
  openMenuLabel.value = null
}

/** 菜单动作的页面内落点：原生菜单事件（menuInvoked）与页内菜单点击共用这一份。 */
const menuActions = {
  'project.create': () => openNewProject(),
  'project.open': () => void openProjectFolder(),
  'project.import': () => openImport(),
  'project.backup': () => openBackup(),
  'project.history': () => openHistory(),
  'project.reviewProposals': () => openProposals(),
  'settings.theme': () => toggleTheme(),
  'settings.preferences': () => void openSettings(),
  'settings.carriers': () => void openCarriers()
}

function runMenuAction(id) {
  const action = menuActions[id]
  if (action) action()
}

/**
 * 页内菜单项点击：先落页面内动作，再经 menuInvoke 通道交给主进程分发（与原生菜单同一条路）。
 * 只读角色项（撤销／复制／最小化…）没有 IPC id，按钮本身是禁用态——原生菜单与快捷键照常可用。
 */
async function invokeMenu(item) {
  closeTopMenu()
  if (!item?.id) return
  runMenuAction(item.id)
  if (!props.bridge?.request) return
  try {
    await props.bridge.request(IPC_CHANNELS.menuInvoke, { id: item.id })
  } catch {
    // 分发失败不收回已经摊开的弹窗：主进程侧各通道会各自如实报错。
  }
}

/** Esc 与点击外部收起下拉（页内菜单不能挡着内容）。 */
function onTitlebarKeydown(event) {
  if (event.key === 'Escape' && openMenuLabel.value) closeTopMenu()
}
function onTitlebarPointerDown(event) {
  if (!openMenuLabel.value) return
  if (menubarRoot.value?.contains?.(event.target)) return
  closeTopMenu()
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
 * 一块板声明的全部 pane（清单原话优先，视图里的 pane 对象补 forms 等字段）。
 * 协议 v1.2 P18：打开方式只看 manifest.panes 的 forms 声明——carrier.panes 是主来源，
 * 视图的 left/center pane 是同一份清单的投影，合并去重后按 pane id 认。
 */
function collectBoardPanes(declared, centerPaneList, treePane) {
  const byId = new Map()
  const candidates = [...(Array.isArray(declared) ? declared : []), ...(centerPaneList ?? []), treePane]
  for (const pane of candidates) {
    if (!pane) continue
    const id = String(pane.id ?? '').trim()
    if (!id) continue
    if (!byId.has(id)) {
      byId.set(id, pane)
      continue
    }
    // 同一 pane 的清单声明与视图投影各带一半字段时补全（forms 是 P18 的开关，split 是 P11 的副栏声明）。
    const merged = { ...byId.get(id) }
    if (merged.forms === undefined && Array.isArray(pane.forms)) merged.forms = pane.forms
    if (merged.split === undefined && pane.split !== undefined) merged.split = pane.split
    byId.set(id, merged)
  }
  return [...byId.values()]
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
        treePane: null,
        treePaneTitle: pane.title ?? '',
        // 协议 v1.1-C：载体声明的悬浮小工具窗（索引窗大纲区标题行的「悬浮」钮据此出现）。
        overlayPane: (carrier?.panes ?? []).find((candidate) => candidate?.slot === 'overlay') ?? null,
        // 协议 v1.2 P18：这一格的全部 pane（含 forms 声明），右键「打开方式」按它列。
        panes: Array.isArray(carrier?.panes) ? carrier.panes : [],
        centerPanes: []
      })
    }
    const board = byPlugin.get(id)
    if (pane.slot === 'center') board.centerPanes.push(pane)
    else if (!board.treePaneId) {
      board.treePaneId = pane.id
      board.treePane = pane
    }
  }
  const list = [...byPlugin.values()].sort((a, b) => Number(b.primary) - Number(a.primary))
  for (const board of list) board.panes = collectBoardPanes(board.panes, board.centerPanes, board.treePane)
  return list
})

const activeBoard = computed(() => boards.value.find((board) => board.id === activeBoardId.value) ?? boards.value[0] ?? null)

/**
 * 协议 v1.1-C：启用的载体声明的 overlay pane（一载体至多一个实例）。
 * 从 view.carriers[].panes 里取（pluginRegistry 只把 left-dock/center 拆进视图的 left/center，
 * overlay 不进竖条、也不占中栏）。宽度用合同校验过的值（缺省 300）。
 */
const overlayPanes = computed(() => carriers.value
  .filter((carrier) => carrier.isEnabled)
  .flatMap((carrier) => (Array.isArray(carrier.panes) ? carrier.panes : [])
    .filter((pane) => pane?.slot === 'overlay' && pane.id)
    .map((pane) => ({
      paneId: pane.id,
      title: pane.title ?? carrier.title,
      width: Number.isSafeInteger(pane.width) ? pane.width : 300,
      carrierId: carrier.id,
      carrierTitle: carrier.title
    }))))

/**
 * 悬浮窗开合＝工作区的一次切换（M2.5-C 四轴）：
 *   打开＝placement:overlay + minimized:none；收起＝留在 overlay，minimized:collapsed（侧缘标签）；
 *   气泡＝minimized:bubble（同一轴上的另一种最小化，不占第五种位置）。
 */
/** 实例缺省＝#1；多开时由模板把具体实例传进来（两份状态各记各的）。 */
function resolveInstance(paneId, instance) {
  return instance || paneInstance(paneId)
}

function setOverlayOpen(paneId, open, instance) {
  if (!paneId) return
  const target = resolveInstance(paneId, instance)
  if (open) {
    const result = hostWorkspace.place(target, 'overlay')
    hostWorkspace.expand(target)
    return result
  }
  hostWorkspace.place(target, 'overlay')
  return hostWorkspace.minimize(target, 'collapsed')
}

function toggleBoardOverlay(paneId) {
  const willOpen = !(paneFormOf(paneId) === 'overlay' && minimizedOf(paneId) === 'none')
  // 批次35（空白卡修复）：开卡即补一次取数（已取过的树不重取）——卡片内容不等下一次板激活。
  if (willOpen) void ensureOverlayData(paneId)
  setOverlayOpen(paneId, willOpen)
}

/** 缩成气泡球（作者原话）：位置不变，只换最小化这一轴。 */
function bubblePane(paneId, instance) {
  if (!paneId) return
  const target = resolveInstance(paneId, instance)
  hostWorkspace.place(target, 'overlay')
  return hostWorkspace.minimize(target, 'bubble')
}

/**
 * 气泡／侧缘标签回卡片：只动最小化那一轴（placement 不动）。
 * 「还原」一词在批次35 之后只留给「从全屏还原」——两个动作各说各的（见 FloatingWidget 的事件表）。
 */
function expandPane(paneId, instance) {
  if (!paneId) return
  hostWorkspace.expand(resolveInstance(paneId, instance))
}

/**
 * 还原（放大钮的第二面，批次35）：这块 pane 从全屏回到进全屏之前的位置。
 * 工作区的 restore 轴记着那个位置（applyPaneForm 走的就是这条记忆），所以这里只给形态不给坐标。
 * 与「从气泡／侧缘标签回卡片」（toggle）是两件事，两个词各说各的。
 */
function restorePaneFromFullscreen(paneId) {
  const id = String(paneId ?? '')
  if (!id) return null
  return applyPaneForm(id, restoreFormFor(id))
}

/** 再开一份：同一块 pane 的第二份实例，状态各记各的（大纲浮在正文上时中栏也能有一份树）。 */
function duplicatePane(paneId) {
  if (!paneId) return null
  const instance = hostWorkspace.openInstance(paneId, { placement: 'overlay' })
  if (instance) void preparePaneData(paneId)
  return instance
}

/**
 * 关闭（批次35 的「×」钮）：回到停靠，不是收起——#2 起连同实例记录一起删掉（workspace.closeInstance）。
 * 与「收起」（minimized=collapsed，右侧缘小标签）分开：收起只剩 Esc 一条路。
 */
function closeOverlayInstance(paneId, instance) {
  if (!paneId) return null
  return hostWorkspace.closeInstance(resolveInstance(paneId, instance))
}

/** 钉住（批次35）：位置锁定＋进 .pinax/workspace.json；再点解除。状态只走工作区，组件不自留一份。 */
function setPanePinned(instance, pinned) {
  if (!instance) return null
  return hostWorkspace.setPinned(instance, pinned === true)
}

/** 这块 pane 属于哪个载体（分屏与右键菜单都要找它）。 */
function boardForPane(paneId) {
  const id = String(paneId ?? '')
  if (!id) return null
  return boards.value.find((item) => (item.centerPanes ?? []).some((pane) => pane.id === id))
    ?? boards.value.find((item) => (item.panes ?? []).some((pane) => pane.id === id))
    ?? null
}

/**
 * 分屏（批次35 · 「分屏是一等公民」）：把这块 pane 的内容送进中栏右侧副栏，浮窗随之退场。
 * 落点分两种：
 *   - 浮的是中栏 pane 自己（右键把它摆成浮窗）：落点就是它自己——形态切成 split 即摘掉浮窗层；
 *   - 浮的是 overlay 槽的小窗（outline.widget）：它的正装是同一载体声明的中栏 pane，落点是那块。
 * 落点与浮窗是同一块 pane 时**不能**再 closeInstance——那会把刚切好的 split 收回 dock（分屏自毁）。
 */
function splitPaneFromWidget(paneId, instance) {
  const id = String(paneId ?? '')
  if (!id) return null
  // 浮的是 overlay 槽的小窗（outline.widget）不在 board.panes 投影里，boardForPane 会扑空并回退到
  // widget 自己——落点就错了（批次35 夜验抓的）。正确的映射：谁声明了这枚 overlay，就送谁的中栏 pane。
  const board = boards.value.find((item) => item.overlayPane?.id === id) ?? boardForPane(id)
  const isCenterPane = board?.centerPanes?.some((pane) => pane.id === id) ?? false
  const target = isCenterPane ? id : (board?.centerPanes?.[0]?.id ?? id)
  const result = applyPaneForm(target, 'split')
  if (!result?.ok) return result
  // 落点是别家 pane 时，浮窗实例照常关闭（回停靠，与 × 同一语义）。
  if (target !== id) closeOverlayInstance(id, instance)
  return result
}

/** 迷你卡里的右键：与索引窗树行同一枚宿主「打开方式」菜单（不另造第二套）。 */
function openPaneContextMenu(paneId, event) {
  const board = boardForPane(paneId)
  if (!board) return
  openContextMenu(board.id, { x: event?.clientX ?? 0, y: event?.clientY ?? 0 })
}

/** 拖动结束：几何回宿主（本组件不自己存坐标）。 */
function savePaneGeometry(instance, geometry) {
  if (!instance) return
  hostWorkspace.setGeometry(instance, geometry)
}

/**
 * 迷你大纲里点一行：切到大纲栏（若已启用）并把该节点送进中栏编辑面；悬浮窗保持开着，方便连续跳。
 * 切板会触发索引窗的 watch 重列大纲（它会先把草稿清空）——所以先让那一拍跑完（nextTick），
 * 需要时再补齐一份大纲，最后才 selectOutlineNode；否则刚建好的草稿会被换板重列冲掉。
 */
async function openOutlineNodeFromWidget(index) {
  const board = boards.value.find((item) => (item.centerPanes ?? []).some((pane) => String(pane.id).startsWith('outline.')))
  if (board) activeBoardId.value = board.id
  indexOpen.value = true
  await nextTick()
  if (!data.outline?.length) await data.loadOutline()
  data.selectOutlineNode(index)
}
/** 提案的目标是正文：审阅面只挂在「正文」那一栏（协议 v1.1-A 的载体分栏，一栏一棵树）。 */
const chapterBoardId = computed(() => {
  const byDir = boards.value.find((board) => (board.dataDirs ?? []).includes('正文'))
  return byDir?.id ?? boards.value.find((board) => board.primary)?.id ?? null
})

/**
 * 二级页里点开一条提案（工单B1）：关闭设置 → 切到正文那一栏 → 把 selection 置为该提案。
 * 核心区由 CarrierPaneHost 的 proposal-review 分支接住（审阅面只有那一块，不复制第二套）；
 * 采纳／弃用仍在那块面上，本节只做列表与导航。
 */
async function openProposalFromSettings(item) {
  if (!item?.name) return
  closeSettings()
  const target = chapterBoardId.value
  if (target) activeBoardId.value = target
  indexOpen.value = true
  await data.openProposal(item)
}
/** 核心区只挂这块板的 center 面板：正文不再被目录视图挤到旁边。 */
const activeCenterPane = computed(() => activeBoard.value?.centerPanes?.[0] ?? null)

/* —— 多形态打开（协议 v1.2 P18–P21）——————————————————————————————
 * 形态是宿主状态：dock＝三栏里的中栏、split＝中栏右侧副栏、overlay＝宿主浮窗、
 * fullscreen＝占满中栏。载体 SFC 一律不感知（P12/P21）：这里只决定把哪块 pane 摆到哪。
 * 摆放优先级：fullscreen > split > 普通中栏。 */
const centerPaneRecords = computed(() => boards.value.flatMap((board) => (board.centerPanes ?? []).map((pane) => ({ pane, board }))))

/** 声明了 overlay 槽的 pane id（用于全屏还原时判断「还原浮窗」还是「还原停靠」）。 */
const overlayPaneIds = computed(() => overlayPanes.value.map((pane) => pane.paneId))

/** 中栏 pane 被选成浮窗时，仍然用宿主 FloatingWidget 装它（内容仍由 CarrierPaneHost 渲染）。 */
const floatingCenterPanes = computed(() => centerPaneRecords.value
  .filter(({ pane }) => paneFormOf(pane.id) === 'overlay')
  .map(({ pane, board }) => ({ ...pane, boardId: board.id, instance: paneInstance(pane.id) })))

/** 全屏形态（P20/P21）：占满中栏的 pane。中栏 pane 优先于 overlay 槽的迷你窗。 */
const fullscreenTarget = computed(() => {
  for (const { pane } of centerPaneRecords.value) {
    if (paneFormOf(pane.id) === 'fullscreen') return pane
  }
  for (const pane of overlayPanes.value) {
    if (paneFormOf(pane.paneId) === 'fullscreen') return { id: pane.paneId, title: pane.title, slot: 'overlay' }
  }
  return null
})

/**
 * 分屏副栏（P11/P21）：formMap 里第一块 split 的 pane。
 * P11 的 split:'side' 声明优先当副栏；主 pane 仍是当前板，副栏只挂这一块（v1 单副栏，多副栏记账）。
 */
const splitTarget = computed(() => {
  const records = [...centerPaneRecords.value]
  for (const pane of overlayPanes.value) {
    records.push({ pane: { id: pane.paneId, title: pane.title, slot: 'overlay' }, board: null })
  }
  const matching = records.filter(({ pane }) => paneFormOf(pane.id) === 'split')
  if (!matching.length) return null
  matching.sort((a, b) => Number(b.pane.split === 'side') - Number(a.pane.split === 'side'))
  return matching[0]
})

/** 普通中栏 pane：当前板的中栏面板；它自己不在 dock 时让位（副栏/浮窗/全屏各走各的分支）。 */
const mainCenterPane = computed(() => {
  const pane = activeCenterPane.value
  if (!pane || paneFormOf(pane.id) !== 'dock') return null
  return pane
})

/** P11 的 split:'main' 声明：有声明且当前在 dock，就由它当主 pane；没有声明时主 pane＝当前板。 */
const declaredSplitMain = computed(() => centerPaneRecords.value.find(({ pane }) => pane.split === 'main')?.pane ?? null)

/** 分屏主 pane：声明的主 pane 优先；否则普通中栏 pane。副栏若是同一块就不再重复渲染。 */
const splitMainPane = computed(() => {
  const declared = declaredSplitMain.value
  if (declared && paneFormOf(declared.id) === 'dock' && declared.id !== splitTarget.value?.pane?.id) return declared
  const pane = mainCenterPane.value
  if (!pane) return null
  return splitTarget.value?.pane?.id === pane.id ? null : pane
})

/** 分屏副栏 ≥420px（协议 P10：载体必须在半宽 ≥420px 下可用）。 */
const SPLIT_SIDE_MIN = 420
const SPLIT_MAIN_MIN = 320
const SPLIT_DIVIDER_WIDTH = 5
const splitWidth = ref(480)
const splitContainer = ref(null)
const splitSideStyle = computed(() => (splitMainPane.value ? { width: `${splitWidth.value}px` } : { width: '100%' }))

/** 分屏分界的拖拽：与三栏 .resizer 同一套手势（起点记录→pointermove 改宽度→pointerup 收）。 */
function startSplitDrag(event) {
  if (event?.button !== undefined && event.button !== 0) return
  const startX = event.clientX
  const startWidth = splitWidth.value
  const total = splitContainer.value?.getBoundingClientRect?.().width ?? 0
  const maxWidth = Math.max(SPLIT_SIDE_MIN, total ? total - SPLIT_MAIN_MIN - SPLIT_DIVIDER_WIDTH : startWidth + 480)
  dragging.value = 'split'
  const move = (moveEvent) => {
    const next = startWidth - (moveEvent.clientX - startX)
    splitWidth.value = Math.round(Math.min(maxWidth, Math.max(SPLIT_SIDE_MIN, next)))
  }
  const up = () => {
    dragging.value = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  event.preventDefault?.()
}

/** 形态切换的唯一外壳入口：单副栏／单全屏的清理在这里做，右键菜单与浮窗按钮都走它。 */
function applyPaneForm(paneId, form) {
  if (form === 'split' || form === 'fullscreen') {
    for (const entry of Object.values(workspaceSnapshot.value.entries)) {
      if (entry.pane === paneId) continue
      // 单副栏：第二块 split 收回 dock。
      if (entry.placement === form) hostWorkspace.dockPane(entry.pane)
      // 全屏占满中栏时会盖住分屏：选分屏＝明确要看见副栏，先把全屏收回 dock。
      else if (form === 'split' && entry.placement === 'fullscreen') hostWorkspace.dockPane(entry.pane)
    }
  }
  const result = setPaneForm(paneId, form)
  if (result.ok && form !== 'dock') void preparePaneData(paneId)
  return result
}

/** 全屏的「还原」目标：工作区的 restore 轴记着进来之前的位置（不再是外壳里的一枚补丁 ref）。 */
function enterFullscreen(paneId) {
  // 空 id 直接交给状态机拒绝：不能因为一次无效点击先把别的全屏 pane 清掉。
  if (!paneId) return hostWorkspace.place('', 'fullscreen')
  return applyPaneForm(paneId, 'fullscreen')
}

function restoreFormFor(paneId) {
  const previous = paneState(paneInstance(paneId))?.restore
  if (isPlacement(previous) && previous !== 'fullscreen') return previous
  return overlayPaneIds.value.includes(paneId) ? 'overlay' : 'dock'
}

const fullscreenRestoreLabel = computed(() => (
  fullscreenTarget.value && restoreFormFor(fullscreenTarget.value.id) === 'overlay' ? '还原浮窗' : '还原停靠'
))

function restoreFromFullscreen() {
  const pane = fullscreenTarget.value
  if (!pane) return
  applyPaneForm(pane.id, restoreFormFor(pane.id))
}

/** 换形态后把对应载体的内容取回来（浮窗／分屏／全屏都可能打开一块不在当前板的树）。 */
async function preparePaneData(paneId) {
  const id = String(paneId ?? '')
  if (!id) return
  if (id.startsWith('novel.')) await data.loadChapters()
  else if (id.startsWith('outline.')) await data.loadOutline()
  else if (id.startsWith('notes.')) await data.loadNotes()
  else if (id.startsWith('worldbook.')) await data.loadEntries()
  else if (id.startsWith('setting.')) await data.loadRules()
  else if (id.startsWith('reference.')) await data.loadDocuments()
  else if (id.startsWith('script.')) await data.loadScripts()
}

/** pane 前缀 → useBoardData 里那棵树的名字（只用于「取过数没有」这一格，取数入口仍是 preparePaneData）。 */
const PANE_TREE_KEYS = Object.freeze([
  ['novel.', 'chapters'],
  ['outline.', 'outline'],
  ['notes.', 'notes'],
  ['worldbook.', 'entries'],
  ['setting.', 'rules'],
  ['reference.', 'documents'],
  ['script.', 'scripts']
])

function treeKeyForPane(paneId) {
  const id = String(paneId ?? '')
  const hit = PANE_TREE_KEYS.find(([prefix]) => id.startsWith(prefix))
  return hit ? hit[1] : null
}

/**
 * 悬浮卡的数据闸（批次35 · 修「先开浮窗就是空卡」）：卡片挂载时先补一次取数，
 * 走的是停靠板同一条口（preparePaneData → 载体工具 → runtimeToolCall），不是第二套读法。
 * 已经取过的树不重取——重取会把作者手上的草稿（大纲节点、条目编辑）冲掉；
 * 在途期间由 overlayLoading 让卡片显示载入语，而不是先摊一棵空树。
 */
const overlayLoading = ref({})

async function ensureOverlayData(paneId) {
  const id = String(paneId ?? '')
  if (!id) return
  const key = treeKeyForPane(id)
  if (!key || data.loadedTrees?.[key]) return
  if (overlayLoading.value[id]) return
  overlayLoading.value = { ...overlayLoading.value, [id]: true }
  try {
    await preparePaneData(id)
  } finally {
    const next = { ...overlayLoading.value }
    delete next[id]
    overlayLoading.value = next
  }
}

/**
 * 工作区状态的水合（M2.5-C）：换项目＝换一份 `.pinax/workspace.json`。
 * 顺序固定——先读主进程那份，再搬老键（已有记录不覆盖），最后补一次不在 dock 的内容。
 * 没有桥（浏览器预览）时纯内存：persistent=false，界面不假装落过盘。
 */
let workspaceReady = false
let paneDataRestored = false
let legacyMigrated = false
let workspaceHydrateSeq = 0

function workspacePaneIds() {
  const ids = new Set()
  for (const board of boards.value) for (const pane of board.panes ?? []) ids.add(pane.id)
  for (const pane of overlayPanes.value) ids.add(pane.paneId)
  return [...ids]
}

function syncWorkspaceForView() {
  if (!workspaceReady) return
  const ids = workspacePaneIds()
  if (!ids.length) return
  if (!legacyMigrated) {
    legacyMigrated = true
    // 只读一次老键；搬成功（或已有记录）才删键，删不掉的留着下次再搬。
    migrateLegacyWorkspace({ store: hostWorkspace, storage: legacyLocalStorage(), paneIds: ids })
  }
  if (!paneDataRestored) {
    // 本次打开的第一次有效清单：所有非 dock 的位置都要内容（可能是上次启动留下的）。
    paneDataRestored = true
    for (const paneId of ids) if (paneFormOf(paneId) !== 'dock') void preparePaneData(paneId)
  }
}

async function hydrateWorkspace(bridge) {
  const seq = ++workspaceHydrateSeq
  workspaceReady = false
  paneDataRestored = false
  legacyMigrated = false
  if (!bridge?.request) {
    hostWorkspace.attachPersistence(null)
    workspaceReady = true
    syncWorkspaceForView()
    return
  }
  let loaded = null
  try {
    const result = await bridge.request(IPC_CHANNELS.workspaceLoad, {})
    if (result?.ok) loaded = result.value
  } catch {
    loaded = null
  }
  if (seq !== workspaceHydrateSeq) return
  if (loaded && loaded.entries && typeof loaded.entries === 'object') {
    hostWorkspace.load({ version: loaded.version ?? 1, entries: loaded.entries })
  }
  hostWorkspace.attachPersistence((snapshot) => bridge.request(IPC_CHANNELS.workspaceSave, { snapshot }))
  workspaceReady = true
  syncWorkspaceForView()
}

watch([boards, overlayPanes], () => syncWorkspaceForView(), { immediate: true })
watch([() => props.bridge, () => project.value?.root ?? ''], ([bridge]) => { void hydrateWorkspace(bridge) }, { immediate: true })

/* —— 右键「打开方式」（协议 v1.2 P19）：竖条格与索引窗树行共用一枚宿主菜单 ————————— */
/** 菜单里的「打开方式」按 pane 的 forms 声明列；slot 排序让 center 优先当形态目标。 */
function paneSlotRank(pane) {
  if (pane?.slot === 'center') return 0
  if (pane?.slot === 'overlay') return 1
  return 2
}

function formTargetsForBoard(board) {
  const panes = [...(Array.isArray(board?.panes) ? board.panes : [])]
    .sort((a, b) => paneSlotRank(a) - paneSlotRank(b))
  const targets = new Map()
  for (const pane of panes) {
    if (!pane?.id) continue
    for (const form of sanitizePaneForms(pane.forms)) {
      if (!targets.has(form)) targets.set(form, pane)
    }
  }
  return PANE_FORMS
    .filter((form) => targets.has(form))
    .map((form) => ({ form, paneId: targets.get(form).id, label: PANE_FORM_LABELS[form] }))
}

const contextMenu = ref(null)
const contextMenuRoot = ref(null)
const CONTEXT_MENU_WIDTH = 220
const CONTEXT_MENU_ITEM_HEIGHT = 30

const contextMenuStyle = computed(() => {
  const menu = contextMenu.value
  if (!menu) return {}
  const viewportWidth = Number(globalThis.innerWidth) || 0
  const viewportHeight = Number(globalThis.innerHeight) || 0
  const menuHeight = 56 + menu.entries.length * CONTEXT_MENU_ITEM_HEIGHT + 30
  const left = Math.max(8, Math.min(menu.x, viewportWidth - CONTEXT_MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(menu.y, viewportHeight - menuHeight - 8))
  return { left: `${left}px`, top: `${top}px` }
})

function openContextMenu(boardId, point = {}) {
  const board = boards.value.find((item) => item.id === boardId)
  if (!board) return
  contextMenu.value = {
    boardId,
    title: board.title,
    x: Number.isFinite(point.x) ? point.x : 0,
    y: Number.isFinite(point.y) ? point.y : 0,
    entries: formTargetsForBoard(board)
  }
}

function openRailContextMenu(payload) {
  if (payload?.boardId) openContextMenu(payload.boardId, payload)
}

/** 索引窗树行右键：目标就是当前板（这一栏只显示当前载体的树）。 */
function openIndexContextMenu(payload) {
  if (activeBoard.value) openContextMenu(activeBoard.value.id, payload)
}

function closeContextMenu() {
  contextMenu.value = null
}

function choosePaneForm(entry) {
  const menu = contextMenu.value
  if (!entry) return
  if (entry.form === 'dock') {
    const board = boards.value.find((item) => item.id === menu?.boardId)
    // 「停靠栏」是载体整体回到竖条切换：这一格所有 pane 都收回 dock（含收起浮窗、撤掉副栏/全屏）。
    for (const pane of board?.panes ?? []) hostWorkspace.dockPane(pane.id)
    hostWorkspace.dockPane(entry.paneId)
  } else if (entry.form === 'fullscreen') {
    enterFullscreen(entry.paneId)
  } else {
    applyPaneForm(entry.paneId, entry.form)
  }
  closeContextMenu()
}

/** Esc 先关菜单（window 捕获，先于 FloatingWidget/标题栏的 document 监听）；点菜单外也收起。 */
function onContextMenuKeydown(event) {
  if (!contextMenu.value || event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  closeContextMenu()
}

function onContextMenuPointerDown(event) {
  if (!contextMenu.value) return
  if (contextMenuRoot.value?.contains?.(event.target)) return
  closeContextMenu()
}

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
  data.clearTransient?.()
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

/**
 * 写作偏好的生效方式（工单B）：把字号／行高写到根节点的 CSS 变量上。
 * next-shell.css 的 .editor-area 只读 --writing-font-size／--writing-line-height，
 * 没写变量时用 var() 回退（--nx-fs-lg／1.9）——首帧与「桥不在」都不空。
 * 变量名与 .editor-area 的 var() 一一对应，改一边必须改另一边（视觉/界面测试钉着）。
 */
function applyWritingPrefs({ fontSize, lineHeight } = {}) {
  const root = globalThis.document?.documentElement
  if (!root?.style?.setProperty) return
  const size = Number.isFinite(fontSize) ? fontSize : WRITING_FONT_SIZE_DEFAULT
  const height = Number.isFinite(lineHeight) ? lineHeight : WRITING_LINE_HEIGHT_DEFAULT
  root.style.setProperty('--writing-font-size', `${size}px`)
  root.style.setProperty('--writing-line-height', String(height))
}

/** 挂载时读一次偏好（应用级、不随项目走），把写作偏好落到根节点。读不到就保留默认值。 */
async function loadWritingPrefs() {
  if (!props.bridge?.request) return
  try {
    const stored = await props.bridge.request(IPC_CHANNELS.prefsGet, {})
    if (!stored?.ok) return
    writingPrefs.value = {
      fontSize: Number.isFinite(stored.value?.writingFontSize) ? stored.value.writingFontSize : WRITING_FONT_SIZE_DEFAULT,
      lineHeight: Number.isFinite(stored.value?.writingLineHeight) ? stored.value.writingLineHeight : WRITING_LINE_HEIGHT_DEFAULT
    }
    applyWritingPrefs(writingPrefs.value)
  } catch {
    // 偏好读失败不拦外壳：CSS 变量没设时 .editor-area 走 var() 回退。
  }
}

/** 写作偏好节保存成功后的落地：更新组件 props 源并立即改根节点变量（不再读一次偏好）。 */
function applyWritingPrefsFromSection(value) {
  const fontSize = Number(value?.fontSize)
  const lineHeight = Number(value?.lineHeight)
  writingPrefs.value = {
    fontSize: Number.isFinite(fontSize) ? fontSize : WRITING_FONT_SIZE_DEFAULT,
    lineHeight: Number.isFinite(lineHeight) ? lineHeight : WRITING_LINE_HEIGHT_DEFAULT
  }
  applyWritingPrefs(writingPrefs.value)
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
  void loadWritingPrefs()
  void refresh()
  // 视口跨过 860px：窄屏收起索引窗（它会盖住正文），宽屏展开（桌面形态）。
  narrowQuery?.addEventListener?.('change', (event) => {
    indexOpen.value = !event.matches
  })
  // 应用菜单走主进程（文件／编辑／视图／运行时／窗口／帮助／设置），这里只接自己关心的那几条。
  // 工单F：页内菜单行的点击也收敛到同一个 runMenuAction——两条入口，一份落点。
  props.bridge?.onEvent?.(IPC_EVENT.menuInvoked, (payload) => runMenuAction(payload?.id))
  // 页内菜单行的收起手势挂在 document 上：Esc 与点击菜单外都收（下拉不许一直挂着）。
  document.addEventListener('keydown', onTitlebarKeydown)
  document.addEventListener('pointerdown', onTitlebarPointerDown)
  // 右键「打开方式」菜单：window 捕获阶段先收菜单（Esc 不再传给悬浮窗/标题栏）。
  window.addEventListener('keydown', onContextMenuKeydown, true)
  window.addEventListener('pointerdown', onContextMenuPointerDown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onTitlebarKeydown)
  document.removeEventListener('pointerdown', onTitlebarPointerDown)
  window.removeEventListener('keydown', onContextMenuKeydown, true)
  window.removeEventListener('pointerdown', onContextMenuPointerDown, true)
  unsubscribeWorkspace()
  hostWorkspace.attachPersistence(null)
})
</script>

<template>
  <div class="nx-shell-root">
    <!-- —— 标题栏（工单F · 作者反馈①②）——————————————————————————————
         全宽一条：左侧应用名＋页内菜单行（数据源＝menus.mjs 的 MENU_TEMPLATE，与原生菜单同一份），
         中间项目信息 chip，右侧给原生窗控 overlay 留空（主进程 titleBarOverlay，约 138px）。
         整条可拖动窗口（-webkit-app-region:drag）；只有按钮与下拉回到 no-drag（样式见
         next-shell.css 的标题栏段）。 -->
    <header class="nx-titlebar">
      <span class="nx-titlebar-brand">Pinax · Next</span>

      <nav ref="menubarRoot" class="nx-menubar" aria-label="应用菜单">
        <div v-for="(top, topIndex) in MENU_TEMPLATE" :key="`menu-${topIndex}`" class="nx-menu">
          <button
            type="button"
            class="control-quiet nx-menu-trigger"
            :class="{ 'is-open': openMenuLabel === top.label }"
            :data-menu="top.label"
            aria-haspopup="menu"
            :aria-expanded="(openMenuLabel === top.label).toString()"
            @click="toggleTopMenu(top.label)"
            @mouseenter="hoverTopMenu(top.label)"
          >{{ top.label }}</button>
          <ul v-if="openMenuLabel === top.label" class="nx-menu-popup" role="menu" :aria-label="top.label">
            <template v-for="(item, itemIndex) in top.submenu" :key="`${topIndex}-${itemIndex}`">
              <li v-if="item.type === 'separator'" class="nx-menu-separator" role="separator"></li>
              <li v-else role="none">
                <!-- 有 id 的项走 menuInvoke 通道（与原生菜单同一条分发）；只有 role 的项由原生菜单
                     与快捷键提供，页内渲染成禁用行，不假装点了有用。 -->
                <button
                  type="button"
                  class="control-quiet nx-menu-item"
                  :data-menu-id="item.id"
                  role="menuitem"
                  :disabled="!item.id"
                  :title="item.id ? null : '由系统菜单与快捷键提供'"
                  @click="invokeMenu(item)"
                >
                  <span class="nx-menu-label">{{ menuLabel(item) }}</span>
                  <span v-if="item.accelerator" class="nx-menu-accelerator">{{ acceleratorHint(item.accelerator) }}</span>
                </button>
              </li>
            </template>
          </ul>
        </div>
      </nav>

      <span
        class="nx-titlebar-chip"
        :class="{ 'is-empty': !project }"
        data-test="titlebar-project-chip"
      >{{ projectChip }}</span>

      <span class="nx-titlebar-drag" aria-hidden="true"></span>
      <!-- 原生窗控浮层占位：主进程 titleBarOverlay 盖在这块约 138px 上，页面上不放可点元素。 -->
      <span class="nx-titlebar-window-controls" aria-hidden="true"></span>
    </header>

    <div class="next-shell app-shell" :data-dragging="dragging">
      <ActivityRail
        :boards="boards"
        :carriers="carriers"
        :project="project"
        :active-id="activeBoardId"
        :open-id="indexOpen ? activeBoardId : null"
        :scheme="scheme"
        @select="selectBoard"
        @toggle-theme="toggleTheme"
        @open-project="openProjectFolder"
        @new-project="openNewProject"
        @context-menu="openRailContextMenu"
      />

      <template v-if="indexOpen">
        <IndexWindow
          :board="activeBoard"
          :data="data"
          :width="indexWidth"
          :project-root="view?.project?.root ?? ''"
          @collapse="indexOpen = false"
          @history="openHistoryFor"
          @overlay="toggleBoardOverlay"
          @context-menu="openIndexContextMenu"
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

        <!-- 协议 v1.2 P20/P21：全屏形态占满中栏。宿主只多一条「还原」形态条，
             载体内容仍由 CenterSlotHost 原样渲染（P12：内容渲染不随形态变）。 -->
        <template v-else-if="fullscreenTarget">
          <div class="nx-form-bar" data-form="fullscreen">
            <span class="nx-form-bar-label">全屏 · {{ fullscreenTarget.title }}</span>
            <button type="button" class="control-quiet nx-form-bar-action" @click="restoreFromFullscreen">{{ fullscreenRestoreLabel }}</button>
          </div>
          <CenterSlotHost
            :active-pane="fullscreenTarget"
            :data="data"
          />
        </template>

        <!-- 协议 v1.2 P11/P21：中栏左右分屏——主 pane 与副 pane 各挂一块 CenterSlotHost，
             副栏 ≥420px；具体哪块载体进副栏由右键「在分屏中打开」触发。 -->
        <div v-else-if="splitTarget" ref="splitContainer" class="nx-split" :data-split-pane="splitTarget.pane.id">
          <div v-if="splitMainPane" class="nx-split-main" data-split="main">
            <CenterSlotHost
              :active-pane="splitMainPane"
              :data="data"
            />
          </div>
          <div
            v-if="splitMainPane"
            class="resizer nx-split-divider"
            role="separator"
            aria-orientation="vertical"
            @pointerdown="startSplitDrag"
          />
          <div class="nx-split-side" :style="splitSideStyle" data-split="side">
            <CenterSlotHost
              :active-pane="splitTarget.pane"
              :data="data"
            />
          </div>
        </div>

        <p v-else-if="!mainCenterPane && activeCenterPane" class="center-empty">「{{ activeCenterPane.title }}」现在以浮窗打开。</p>
        <CenterSlotHost
          v-else
          :active-pane="mainCenterPane"
          :data="data"
        />
      </div>

      <div class="resizer" role="separator" aria-orientation="vertical" @pointerdown="startDrag('right', $event)" />

      <div class="col-dock" :style="{ width: dockWidth + 'px' }">
        <!-- 批次27：会话按项目根隔离（换项目＝另一份会话）；@ 引用清单与 Esc 让位也在这里接线。 -->
        <RuntimeDock
          :runtime="runtime"
          :bridge="bridge"
          :project-root="project?.root ?? ''"
          :references="referenceCatalog"
          :suspend-esc="settingsOpen"
        />
      </div>

      <!-- —— 统一设置二级页（工单C0 · U13）：一枚弹窗＝左栏目录＋右栏设置项 ——————————
           各节都登记在上面的目录表里（工单B 起按「应用／项目／文档」分组，载体占位节由弹窗补）；
           D1 硬闸（needsPrimary）时自动落在主载体节且不可关闭。 -->
      <SettingsModal
        :open="settingsOpen"
        :dismissable="!needsPrimary"
        :active-section="activeSection"
        :sections="settingsSections"
        :carriers="carriers"
        :carrier-section-components="carrierSectionComponents"
        @close="closeSettings"
        @changed="refresh"
        @theme="applyThemeChoice"
        @writing-prefs="applyWritingPrefsFromSection"
        @set-enabled="setCarrierEnabled"
        @set-primary="pickPrimary"
        @toggle-companion="toggleCompanion"
        @update:active-section="activeSection = $event"
      />

      <!-- 协议 v1.1-C / v1.2 → M2.5-C：悬浮小工具窗。宿主容器与定位全在 FloatingWidget；
           一条实例一行（#1 永远在，第二份由「+1」创建），位置／最小化各记各的。
           状态四轴：placement=overlay 才出现在这一层；minimized=none 是卡片、bubble 是气泡球、collapsed 是侧缘标签。 -->
      <template v-for="pane in overlayPanes" :key="pane.paneId">
        <template v-for="instance in overlayInstances(pane.paneId)" :key="`${pane.paneId}-${instance}`">
          <FloatingWidget
            v-if="paneState(instance)?.placement === 'overlay'"
            :instance="instance"
            :id="pane.paneId"
            :open="(paneState(instance)?.minimized ?? 'none') === 'none'"
            :minimized="paneState(instance)?.minimized ?? 'none'"
            :geometry="geometryOf(instance)"
            :pinned="paneState(instance)?.pinned === true"
            :expanded="paneFormOf(pane.paneId) === 'fullscreen'"
            :title="pane.title"
            :width="pane.width"
            :suspend-esc="settingsOpen"
            @close="closeOverlayInstance(pane.paneId, instance)"
            @collapse="setOverlayOpen(pane.paneId, false, instance)"
            @toggle="expandPane(pane.paneId, instance)"
            @bubble="bubblePane(pane.paneId, instance)"
            @restore="restorePaneFromFullscreen(pane.paneId)"
            @expand="enterFullscreen(pane.paneId)"
            @duplicate="duplicatePane(pane.paneId)"
            @pin="setPanePinned(instance, $event)"
            @split="splitPaneFromWidget(pane.paneId, instance)"
            @mounted="ensureOverlayData($event)"
            @geometry="savePaneGeometry(instance, $event)"
          >
            <template v-if="pane.paneId === 'outline.widget'">
              <!-- 批次35（空白卡修复）：取数在途先给载入语，不摊一棵空树。 -->
              <p v-if="overlayLoading[pane.paneId]" class="nx-overlay-empty">正在载入大纲…</p>
              <p v-else-if="data.outlineError" class="nx-overlay-error">{{ data.outlineError }}</p>
              <p v-else-if="!data.outline.length" class="nx-overlay-empty">大纲还没有内容（大纲/outline.json）。</p>
              <ul v-else class="nx-overlay-tree" aria-label="迷你大纲">
                <li v-for="(node, index) in data.outline" :key="node.id ?? `overlay-node-${index}`">
                  <button
                    type="button"
                    class="workspace-nav-item workspace-nav-item--tree nx-tree-row"
                    @click="openOutlineNodeFromWidget(index)"
                    @contextmenu.stop.prevent="openPaneContextMenu(pane.paneId, $event)"
                  >
                    <span class="workspace-nav-label">{{ index + 1 }}. {{ node.title }}</span>
                  </button>
                </li>
              </ul>
            </template>
            <p v-else class="nx-overlay-empty">这块悬浮窗还没有内容。</p>
          </FloatingWidget>
        </template>
      </template>

      <!-- 中栏 pane 被右键选成浮窗（P18/P21）：同一宿主容器装 CarrierPaneHost，内容渲染不变（P12）。 -->
      <FloatingWidget
        v-for="pane in floatingCenterPanes"
        :key="`float-${pane.id}`"
        :instance="pane.instance"
        :id="pane.id"
        :open="minimizedOf(pane.id) === 'none'"
        :minimized="minimizedOf(pane.id)"
        :geometry="geometryOf(pane.instance)"
        :pinned="paneState(pane.instance)?.pinned === true"
        :expanded="paneFormOf(pane.id) === 'fullscreen'"
        :title="pane.title"
        :width="360"
        :suspend-esc="settingsOpen"
        @close="closeOverlayInstance(pane.id, pane.instance)"
        @collapse="setOverlayOpen(pane.id, false)"
        @toggle="setOverlayOpen(pane.id, true)"
        @bubble="bubblePane(pane.id)"
        @restore="expandPane(pane.id)"
        @expand="enterFullscreen(pane.id)"
        @duplicate="duplicatePane(pane.id)"
        @pin="setPanePinned(pane.instance, $event)"
        @split="splitPaneFromWidget(pane.id, pane.instance)"
        @mounted="ensureOverlayData($event)"
        @geometry="savePaneGeometry(pane.instance, $event)"
      >
        <CarrierPaneHost :pane="pane" :data="data" />
      </FloatingWidget>

      <!-- 协议 v1.2 P19：竖条格／索引窗树行的右键「打开方式」。宿主菜单，Esc／点外收起。
           只有 manifest.panes 的 forms 声明过的形态才出现（无声明时给一句说明，不伪造形态）。 -->
      <div
        v-if="contextMenu"
        ref="contextMenuRoot"
        class="nx-context-menu"
        role="menu"
        :aria-label="`${contextMenu.title} 打开方式`"
        :style="contextMenuStyle"
        @contextmenu.prevent
      >
        <p class="nx-context-group">打开方式</p>
        <template v-if="contextMenu.entries.length">
          <button
            v-for="entry in contextMenu.entries"
            :key="entry.form"
            type="button"
            class="control-quiet nx-context-item"
            role="menuitem"
            :data-form="entry.form"
            @click="choosePaneForm(entry)"
          >
            <span>{{ entry.label }}</span>
            <span v-if="paneFormOf(entry.paneId) === entry.form" class="nx-context-mark" aria-hidden="true">✓</span>
          </button>
        </template>
        <p v-else class="nx-context-empty">该载体未声明打开形态</p>
        <div class="nx-context-separator" role="separator"></div>
        <button type="button" class="control-quiet nx-context-item" role="menuitem" disabled title="后续批次">在新窗口打开</button>
      </div>

      <WorkbenchTooltip />
    </div>
  </div>
</template>

