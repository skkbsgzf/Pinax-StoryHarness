<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import ActivityRail from './ActivityRail.vue'
import IndexWindow from './IndexWindow.vue'
import CarrierPaneHost from './CarrierPaneHost.vue'
import PaneWindow from './PaneWindow.vue'
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
import ServicesSection from './settings/ServicesSection.vue'
import WorkbenchTooltip from '../../src/components/workbench/WorkbenchTooltip.vue'
import { useBoardData } from './useBoardData.mjs'
import { refreshTargetsFor } from './projectEventRefresh.mjs'
import { RECORD_CARRIER_KEYS, recordCarrierOfPaneId, recordTreeKey } from './recordCarriers.mjs'
import { IPC_CHANNELS, IPC_EVENT, IPC_PUSH } from './ipcContract.mjs'
import { MENU_TEMPLATE } from './menus.mjs'
import {
  DEFAULT_FLOATING_GEOMETRY,
  hostWorkspace,
  instanceIdFor,
  subscribeWorkspace
} from './workspace.mjs'
import { layoutTemplateForBoard, templateHasTree } from './layoutTemplates.mjs'
import { legacyLocalStorage, migrateLegacyWorkspace } from './workspaceMigration.mjs'
import { hostViewRegistry } from './viewRegistry.mjs'
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
 *     批次59（协议 v1.3）：中间 doc 区是窗口管理器——任何打开的内容都是一扇 PaneWindow，
 *     宿主统一 chrome（收起／分屏／×）；浮窗可叠、可拖可缩放，分屏对半贴，收起成侧缘标签。
 *     左树不再是每载体标配：folder 模板才渲染 IndexWindow，web／gallery 由宿主模板决定
 *     （layoutTemplates.mjs）。竖条点击＝开／还原该载体的文档窗。
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
/** 写作偏好（工单B）：字号／行高的兜底值与 appPreferences.PREFS_DEFAULTS 一致（17／1.9）。
 *  批次46B 补齐段距／首行缩进（0.8／2）与两个行为开关（打字机／段落聚焦，默认关）。 */
const WRITING_FONT_SIZE_DEFAULT = 17
const WRITING_LINE_HEIGHT_DEFAULT = 1.9
const WRITING_PARAGRAPH_SPACING_DEFAULT = 0.8
const WRITING_TEXT_INDENT_DEFAULT = 2
const writingPrefs = ref({
  fontSize: WRITING_FONT_SIZE_DEFAULT,
  lineHeight: WRITING_LINE_HEIGHT_DEFAULT,
  paragraphSpacing: WRITING_PARAGRAPH_SPACING_DEFAULT,
  textIndent: WRITING_TEXT_INDENT_DEFAULT,
  typewriter: false,
  focusMode: false
})

/**
 * 窗口状态（批次59 · 协议 v1.3）：宿主一份工作区状态，AppNext 只订阅快照。
 * 「记录存在＝窗口开着」；几何／叠序／最小化（none|tab）／最大化／分屏搭档都是窗口自己的轴，
 * 落 `.pinax/workspace.json`（项目级，经主进程通道）。四轴 placement 已退役。
 */
const workspaceSnapshot = ref(hostWorkspace.snapshot())
const unsubscribeWorkspace = subscribeWorkspace((snapshot) => {
  workspaceSnapshot.value = snapshot
})

/** 一块 pane 的缺省实例（`<paneId>#1`）。第二份起由 openInstance 分配，#n 各记各的状态。 */
function paneInstance(paneId) {
  return instanceIdFor(paneId, 1)
}


const project = computed(() => view.value?.project ?? null)
const runtime = computed(() => view.value?.runtime ?? { tools: [], started: false, title: 'Pi-Agent', budgetPriority: 0, writeSurface: '.pinax/proposals/', reservedSlotReason: '' })
const leftItems = computed(() => view.value?.left ?? [])
const centerPanes = computed(() => view.value?.center ?? [])
const carriers = computed(() => view.value?.carriers ?? [])
/**
 * 资源认领（批次53 · 协议 @4）：把各载体 pane 的 claims／priority／canOpen／takes 交给数据层作裁决表。
 * 裁决在打开某份资源时发生（useBoardData.noteClaim），这里只负责喂表——清单一变（热载／启停）就重喂。
 * 裁决是旁路事实：它记录「谁赢了／谁为什么落选」，不拦任何打开。
 */
watch(
  () => carriers.value.flatMap((carrier) => (Array.isArray(carrier?.panes) ? carrier.panes : [])),
  (panes) => data.declareClaimPanes?.(panes),
  { immediate: true }
)
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
 * 服务与通知（批次49）：公共池的唯一读数口。
 * 启动时取一份快照，之后只跟池的推送增量刷新——竖条状态点与设置页「服务与通知」共用这一份，不轮询。
 * 快照经 provide 交给 CarrierPaneHost（漫画「预览」钮按声明里的端口拼地址，不在这里猜）。
 */
const EMPTY_SERVICE_LOG = Object.freeze({ at: null, ackedAt: null, carriers: [], entries: [] })
const serviceSnapshot = ref({ ...EMPTY_SERVICE_LOG })
let offServiceLog = null

async function loadServiceSnapshot() {
  if (typeof props.bridge?.request !== 'function') return
  try {
    const result = await props.bridge.request(IPC_CHANNELS.runtimeServiceLog, {})
    if (result?.ok) serviceSnapshot.value = result.value?.log ?? { ...EMPTY_SERVICE_LOG }
  } catch {
    // 状态点是旁路：读不到就保持上一份，不拦外壳。
  }
}

/** 载体 id → 四色状态（只给声明了服务／外部 MCP 的载体；没声明的板不画点）。 */
const serviceStatus = computed(() => {
  const map = {}
  for (const carrier of serviceSnapshot.value?.carriers ?? []) {
    if (!carrier?.carrierId || !carrier?.color) continue
    map[carrier.carrierId] = { color: carrier.color, unackedNotices: carrier.unackedNotices ?? 0 }
  }
  return map
})

provide('pinaxServiceSnapshot', serviceSnapshot)

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
      lineHeight: writingPrefs.value.lineHeight,
      paragraphSpacing: writingPrefs.value.paragraphSpacing,
      textIndent: writingPrefs.value.textIndent,
      typewriter: writingPrefs.value.typewriter,
      focusMode: writingPrefs.value.focusMode
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
  // 批次49：服务与通知（公共池）。一行一个声明的服务／外部 MCP：状态、日志尾巴、重启与确认。
  { id: 'services', title: '服务与通知', group: '应用', keywords: ['服务', '外部 MCP', '端口', '日志', '通知', '重启', '状态', 'comfy'], component: ServicesSection, props: { bridge: props.bridge, snapshot: serviceSnapshot.value, reload: loadServiceSnapshot } },
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
  // 批次37：多给一条 bridge——节自己订阅 proposals-changed 自动重列（数据仍走 data 那一份）。
  { id: 'proposals', title: '提案审阅', group: '文档', keywords: ['提案', '模型改稿', '采纳', '弃用', 'proposals'], component: ProposalsSection, props: { data, open: openProposalFromSettings, bridge: props.bridge } },
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
 * 一块板声明的全部 pane（清单原话优先，视图里的 pane 对象补字段）。
 * carrier.panes 是主来源，视图的 left/center pane 是同一份清单的投影，
 * 合并去重后按 pane id 认。
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
        // 载体声明的 overlay 小窗（索引窗大纲区标题行的「悬浮」钮据此出现）。
        overlayPane: (carrier?.panes ?? []).find((candidate) => candidate?.slot === 'overlay') ?? null,
        // 这一格声明的全部 pane（窗口管理器按它认 pane 归属）。
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
 *
 * 协议 v3：这块 pane 自己可能是「自带面板」（view=pinax.view.custom），
 * 所以要把 entry／view／kind 一并带出来，宿主才知道给 iframe 还是给宿主视图。
 */
const overlayPanes = computed(() => carriers.value
  .filter((carrier) => carrier.isEnabled)
  .flatMap((carrier) => (Array.isArray(carrier.panes) ? carrier.panes : [])
    .filter((pane) => pane?.slot === 'overlay' && pane.id)
    .map((pane) => ({
      paneId: pane.id,
      id: pane.id,
      title: pane.title ?? carrier.title,
      width: Number.isSafeInteger(pane.width) ? pane.width : 300,
      carrierId: carrier.id,
      carrierTitle: carrier.title,
      pluginId: carrier.id,
      pluginTitle: carrier.title,
      view: pane.view ?? null,
      kind: pane.kind ?? null,
      entry: carrier.entry ?? null
    }))))

/** 一块 pane 属于哪个载体（分屏与默认窗口都要找它）。 */
function boardForPane(paneId) {
  const id = String(paneId ?? '')
  if (!id) return null
  return boards.value.find((item) => (item.centerPanes ?? []).some((pane) => pane.id === id))
    ?? boards.value.find((item) => item.overlayPane?.id === id)
    ?? null
}

/** 新窗的落点：缺省矩形按打开顺序向右下错开一点，多扇窗不会完全叠死。 */
function nextFloatingGeometry() {
  const count = Object.keys(workspaceSnapshot.value.entries).length
  const offset = (count % 6) * 24
  return {
    x: DEFAULT_FLOATING_GEOMETRY.x + offset,
    y: DEFAULT_FLOATING_GEOMETRY.y + offset,
    w: DEFAULT_FLOATING_GEOMETRY.w,
    h: DEFAULT_FLOATING_GEOMETRY.h
  }
}

/** 当前打开的窗口（记录存在且 pane 仍在注册表里），按叠序从低到高。 */
const openWindows = computed(() => Object.values(workspaceSnapshot.value.entries)
  .map((entry) => ({ entry, pane: descriptorFor(entry.pane) }))
  .filter((item) => item.pane)
  .sort((a, b) => a.entry.z - b.entry.z))

/** pane id → 窗口内容声明（只认 center／overlay 槽；左树不是可开窗的内容）。 */
function descriptorFor(paneId) {
  const id = String(paneId ?? '')
  if (!id) return null
  for (const board of boards.value) {
    const pane = (board.centerPanes ?? []).find((item) => item.id === id)
    if (pane) {
      return { ...pane, id, boardId: board.id, pluginId: board.id, pluginTitle: board.title }
    }
  }
  const overlay = overlayPanes.value.find((pane) => pane.paneId === id)
  return overlay ? { ...overlay, id, slot: 'overlay', boardId: overlay.carrierId } : null
}

function anyOpenWindow() {
  return Object.values(workspaceSnapshot.value.entries).some((entry) => entry.minimized !== 'tab')
}

/** 收起标签在右缘的排位：只看已收起的窗，按叠序依次下移。 */
function tabOrdinal(instance) {
  let ordinal = 0
  for (const win of openWindows.value) {
    if (win.entry.instance === instance) return ordinal
    if (win.entry.minimized === 'tab') ordinal += 1
  }
  return ordinal
}

/** 载体的文档窗 pane：多中栏 pane 时用作者选过的那块（切换条），否则第一块。 */
function chosenCenterPaneFor(board) {
  if (!board) return null
  const panes = board.centerPanes ?? []
  if (!panes.length) return board.overlayPane ?? null
  const chosen = centerPaneChoice[board.id]
  return panes.find((pane) => pane.id === chosen) ?? panes[0]
}

/**
 * 竖条点击＝开／还原该载体的文档窗（铁律二）。
 * 一扇都没有时开成最大化（先有一页），已有别的窗则开成浮窗（自由几何可叠）。
 */
function showBoardWindow(board, { maximize = null } = {}) {
  const pane = chosenCenterPaneFor(board)
  if (!pane) return null
  const instance = paneInstance(pane.id)
  const existing = hostWorkspace.get(instance)
  if (!existing) {
    const shouldMaximize = maximize ?? !anyOpenWindow()
    hostWorkspace.open(instance, { geometry: nextFloatingGeometry() })
    if (shouldMaximize) hostWorkspace.setMaximized(instance, true)
  } else {
    if (existing.minimized === 'tab') hostWorkspace.expand(instance)
    hostWorkspace.bringToFront(instance)
  }
  // 窗一打开就把这块 pane 的树取回来（已载入的不重取，免得冲掉作者手上的草稿）。
  void ensurePaneData(pane.id)
  return instance
}

/** 收起＝侧缘标签；标签点开＝还原（几何不动）。 */
function collapseWindow(instance) {
  return hostWorkspace.minimize(instance, 'tab')
}

function expandWindow(instance) {
  const entry = hostWorkspace.get(instance)
  if (!entry) return null
  hostWorkspace.expand(instance)
  hostWorkspace.bringToFront(instance)
  const board = boardForPane(entry.pane)
  if (board) activeBoardId.value = board.id
  return entry
}

function toggleWindowMaximized(instance) {
  return hostWorkspace.toggleMaximized(instance)
}

/** 宽高／位置拖完回宿主；宿主据此解除贴靠并取消最大化。 */
function saveWindowGeometry(instance, geometry) {
  if (!instance) return null
  return hostWorkspace.setGeometry(instance, geometry)
}

/**
 * 分屏（铁律一／二）：当前窗与另一扇窗对半贴（当前窗在左）。
 * 搭档优先级：已开着的另一扇窗 > 同载体另一块中栏 pane > 同载体 overlay pane > 同一 pane 再开一份。
 */
function splitWindow(instance) {
  const entry = hostWorkspace.get(instance)
  if (!entry) return null
  if (entry.tileSide) return hostWorkspace.untile(instance)
  if (entry.maximized) hostWorkspace.setMaximized(instance, false)
  let partner = hostWorkspace.list()
    .filter((candidate) => candidate.instance !== instance && candidate.minimized !== 'tab' && !candidate.tiledWith)
    .pop()
  if (!partner) {
    const board = boardForPane(entry.pane)
    const target = board?.centerPanes?.find((pane) => pane.id !== entry.pane) ?? board?.overlayPane ?? null
    if (target) {
      const partnerInstance = paneInstance(target.id)
      if (!hostWorkspace.get(partnerInstance)) {
        hostWorkspace.open(partnerInstance, { geometry: entry.geometry ?? nextFloatingGeometry() })
      }
      partner = hostWorkspace.get(partnerInstance)
    }
  }
  if (!partner) {
    const partnerInstance = hostWorkspace.openInstance(entry.pane, { geometry: entry.geometry ?? nextFloatingGeometry() })
    partner = partnerInstance ? hostWorkspace.get(partnerInstance) : null
  }
  if (!partner) return null
  return hostWorkspace.tile(instance, partner.instance)
}

function closeWindow(instance) {
  return hostWorkspace.close(instance)
}

/** 索引窗标题行的「悬浮」钮：开／收起这块 overlay 小窗（开＝浮窗，收起＝侧缘标签）。 */
function toggleBoardOverlay(paneId) {
  const instance = paneInstance(paneId)
  const entry = hostWorkspace.get(instance)
  if (entry) {
    if (entry.minimized !== 'tab') return hostWorkspace.minimize(instance, 'tab')
    return hostWorkspace.expand(instance)
  }
  // 开卡即补一次取数：卡片内容不等下一次板激活。
  void ensurePaneData(paneId)
  return hostWorkspace.open(instance, { geometry: nextFloatingGeometry() })
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
  // 窗口模型下「跳到编辑面」＝把该载体的文档窗开／还原并抬到最前（标签态则展开）。
  if (board) showBoardWindow(board)
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
/**
 * 核心区挂哪块 center pane：一块板可能声明两块以上（comic.editor 与 comic.canvas 同载体双 center）。
 * 作者选过的那块按板记住（centerPaneChoice[boardId]）；没选过或已不在板上时回落第一块。
 * 批次58 实拍的「双中栏 pane 无切换入口」由这条选择 + 下方切换条收口。
 */
const centerPaneChoice = reactive({})
const activeCenterPanes = computed(() => activeBoard.value?.centerPanes ?? [])
const activeCenterPane = computed(() => chosenCenterPaneFor(activeBoard.value))
/** 同一块板有两块以上中栏 pane 时才出切换条（单 pane 的板维持原样，不新增视觉噪声）。 */
const centerPaneTabs = computed(() => (activeCenterPanes.value.length > 1 ? activeCenterPanes.value : []))
/**
 * 同载体双中栏 pane 的切换：旧窗收成侧缘标签、新窗接着占位（原窗最大化时新窗也最大化）。
 * 二者仍是同一套 PaneWindow，只是内容 pane 换了。
 */
function chooseCenterPane(paneId) {
  const board = activeBoard.value
  if (!board) return null
  const id = String(paneId ?? '')
  centerPaneChoice[board.id] = id
  const previousMaximized = (board.centerPanes ?? []).some((pane) => hostWorkspace.get(paneInstance(pane.id))?.maximized)
  for (const pane of board.centerPanes ?? []) {
    if (pane.id === id) continue
    const instance = paneInstance(pane.id)
    if (hostWorkspace.get(instance)) hostWorkspace.minimize(instance, 'tab')
  }
  showBoardWindow(board, { maximize: previousMaximized })
  return id
}

/** 当前载体的布局模板：folder 有左树，web／gallery 没有（铁律四）。 */
const activeLayoutTemplate = computed(() => layoutTemplateForBoard(activeBoard.value))
/** 索引窗左树是 folder 模板的 pane，不再每载体标配。 */
const showIndexWindow = computed(() => indexOpen.value && templateHasTree(activeLayoutTemplate.value))

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
  else {
    const records = recordCarrierOfPaneId(id)
    if (records) await data.loadRecords(records.key)
  }
}

/** pane 前缀 → useBoardData 里那棵树的名字（只用于「取过数没有」这一格，取数入口仍是 preparePaneData）。 */
const PANE_TREE_KEYS = Object.freeze([
  ['novel.', 'chapters'],
  ['outline.', 'outline'],
  ['notes.', 'notes'],
  ['worldbook.', 'entries'],
  ['setting.', 'rules'],
  ['reference.', 'documents'],
  ['script.', 'scripts'],
  ...RECORD_CARRIER_KEYS.map((key) => [`${key}.`, recordTreeKey(key)])
])

function treeKeyForPane(paneId) {
  const id = String(paneId ?? '')
  const hit = PANE_TREE_KEYS.find(([prefix]) => id.startsWith(prefix))
  return hit ? hit[1] : null
}

/**
 * 窗口的数据闸（批次35 · 修「先开浮窗就是空卡」；批次59 起所有窗共用）：
 * 窗一打开／恢复时先补一次取数，走的是停靠板同一条口（preparePaneData → 载体工具 →
 * runtimeToolCall），不是第二套读法。已经取过的树不重取——重取会把作者手上的草稿
 * （大纲节点、条目编辑）冲掉；在途期间由 overlayLoading 让卡片显示载入语。
 */
const overlayLoading = ref({})

async function ensurePaneData(paneId) {
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
    // 本次打开的第一次有效清单：先把上次留下的窗内容取回来，再保证至少有一扇文档窗。
    paneDataRestored = true
    for (const entry of hostWorkspace.list()) void preparePaneData(entry.pane)
    restoreActiveBoardFromWorkspace()
    if (!anyOpenWindow()) showBoardWindow(activeBoard.value)
  }
}

/** 从工作区把「上次看的那一栏」找回来：叠序最高的窗口属于哪个载体，竖条就落哪一格。 */
function restoreActiveBoardFromWorkspace() {
  const top = hostWorkspace.list().filter((entry) => entry.minimized !== 'tab').pop()
  const board = top ? boardForPane(top.pane) : null
  if (board) activeBoardId.value = board.id
}

async function hydrateWorkspace(bridge) {
  const seq = ++workspaceHydrateSeq
  workspaceReady = false
  paneDataRestored = false
  legacyMigrated = false
  if (!bridge?.request) {
    hostWorkspace.load(null)
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
  // 读不到存档（新项目／没有 .pinax/workspace.json／读盘失败）＝这个项目还没有窗口：
  // 先清掉上一个项目留在单例里的记录，免得换项目时把旧窗带过来。
  if (loaded && loaded.entries && typeof loaded.entries === 'object') {
    hostWorkspace.load({ version: loaded.version ?? 1, entries: loaded.entries })
  } else {
    hostWorkspace.load(null)
  }
  hostWorkspace.attachPersistence((snapshot) => bridge.request(IPC_CHANNELS.workspaceSave, { snapshot }))
  workspaceReady = true
  syncWorkspaceForView()
}

watch([boards, overlayPanes], () => syncWorkspaceForView(), { immediate: true })
watch([() => props.bridge, () => project.value?.root ?? ''], ([bridge]) => { void hydrateWorkspace(bridge) }, { immediate: true })

/**
 * Esc＝把叠序最高的那扇窗收成侧缘标签（铁律二）。
 * 统一二级页或页内菜单开着时让位——那一层自己的 Esc 先走。
 */
function onWindowKeydown(event) {
  if (event.key !== 'Escape') return
  if (settingsOpen.value || openMenuLabel.value) return
  const top = hostWorkspace.list().filter((entry) => entry.minimized !== 'tab').pop()
  if (!top) return
  event.preventDefault()
  hostWorkspace.minimize(top.instance, 'tab')
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

/**
 * 点竖条：开／还原该载体的文档窗（铁律二），索引窗跟着换树。
 * 再点同一格＝收起索引窗；若该载体是 web／gallery 模板（没有树），再点就是还原它的窗。
 */
function selectBoard(id) {
  data.clearTransient?.()
  const board = boards.value.find((item) => item.id === id)
  if (!board) return
  if (activeBoardId.value === id) {
    if (templateHasTree(layoutTemplateForBoard(board)) && indexOpen.value) {
      indexOpen.value = false
      return
    }
    indexOpen.value = true
    showBoardWindow(board)
    return
  }
  activeBoardId.value = id
  indexOpen.value = true
  showBoardWindow(board)
}

async function pickPrimary(pluginId) {
  if (!props.bridge?.request) return
  const revision = project.value?.revision ?? 0
  await props.bridge.request(IPC_CHANNELS.carrierSetPrimary, { pluginId, expectedRevision: revision })
  await refresh()
}

/**
 * 停用＝解注册（批次45）：先把这块载体注册的视图与它全部已开的 pane 实例收掉，再交内核重建。
 * 「已开」覆盖 #1 与多开的 #n（含 overlay 小窗）：删除工作区记录即同时清掉
 * 几何／叠序／窗态，窗口层里那扇窗自动消失。
 * 换来源的 pane id 以清单声明为准，再用视图里的 pluginId 兜一层——两边哪边更全都能认出来。
 */
function releaseCarrierPanes(carrier) {
  const views = hostViewRegistry.disposeOwner(carrier.id)
  const paneIds = new Set((carrier?.panes ?? []).map((pane) => pane?.id).filter(Boolean))
  for (const pane of [...leftItems.value, ...centerPanes.value]) {
    if (pane.pluginId === carrier.id && pane.id) paneIds.add(pane.id)
  }
  const removed = hostWorkspace.removePanes([...paneIds])
  return { views, instances: removed.instances }
}

/** 启用／停用一个载体：翻转 enabled；主载体行不可停用自己（按钮已禁用，函数再闸一道）。
 *  revision 用当前 view 的值——陈旧写入内核会以 STALE_REVISION 拒掉，refresh 后如实呈现。
 *  停用先走解注册清理再交重建：服务／MCP／工具面在 session.refresh 里收，pane 与工作区在外壳侧收。 */
async function setCarrierEnabled(carrier) {
  if (!props.bridge?.request || carrier.isPrimary) return
  const enabling = !carrier.isEnabled
  if (!enabling) releaseCarrierPanes(carrier)
  const revision = project.value?.revision ?? 0
  await props.bridge.request(IPC_CHANNELS.carrierSetEnabled, {
    pluginId: carrier.id,
    enabled: enabling,
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
function applyWritingPrefs({ fontSize, lineHeight, paragraphSpacing, textIndent, typewriter, focusMode } = {}) {
  const root = globalThis.document?.documentElement
  if (!root?.style?.setProperty) return
  const size = Number.isFinite(fontSize) ? fontSize : WRITING_FONT_SIZE_DEFAULT
  const height = Number.isFinite(lineHeight) ? lineHeight : WRITING_LINE_HEIGHT_DEFAULT
  const spacing = Number.isFinite(paragraphSpacing) ? paragraphSpacing : WRITING_PARAGRAPH_SPACING_DEFAULT
  const indent = Number.isFinite(textIndent) ? textIndent : WRITING_TEXT_INDENT_DEFAULT
  root.style.setProperty('--writing-font-size', `${size}px`)
  root.style.setProperty('--writing-line-height', String(height))
  root.style.setProperty('--writing-paragraph-spacing', `${spacing}em`)
  root.style.setProperty('--writing-text-indent', `${indent}em`)
  // 两个行为开关走 dataset（不是 CSS 变量）：打字机滚动与段落聚焦由编辑面读它决定做不做事；
  // CSS 侧也用 [data-writing-focus="on"] 挑段落变暗的规则。
  root.dataset.writingTypewriter = typewriter === true ? 'on' : 'off'
  root.dataset.writingFocus = focusMode === true ? 'on' : 'off'
}

/** 挂载时读一次偏好（应用级、不随项目走），把写作偏好落到根节点。读不到就保留默认值。 */
async function loadWritingPrefs() {
  if (!props.bridge?.request) return
  try {
    const stored = await props.bridge.request(IPC_CHANNELS.prefsGet, {})
    if (!stored?.ok) return
    writingPrefs.value = {
      fontSize: Number.isFinite(stored.value?.writingFontSize) ? stored.value.writingFontSize : WRITING_FONT_SIZE_DEFAULT,
      lineHeight: Number.isFinite(stored.value?.writingLineHeight) ? stored.value.writingLineHeight : WRITING_LINE_HEIGHT_DEFAULT,
      paragraphSpacing: Number.isFinite(stored.value?.writingParagraphSpacing) ? stored.value.writingParagraphSpacing : WRITING_PARAGRAPH_SPACING_DEFAULT,
      textIndent: Number.isFinite(stored.value?.writingTextIndent) ? stored.value.writingTextIndent : WRITING_TEXT_INDENT_DEFAULT,
      typewriter: stored.value?.writingTypewriter === true,
      focusMode: stored.value?.writingFocusMode === true
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
  const paragraphSpacing = Number(value?.paragraphSpacing)
  const textIndent = Number(value?.textIndent)
  writingPrefs.value = {
    fontSize: Number.isFinite(fontSize) ? fontSize : WRITING_FONT_SIZE_DEFAULT,
    lineHeight: Number.isFinite(lineHeight) ? lineHeight : WRITING_LINE_HEIGHT_DEFAULT,
    paragraphSpacing: Number.isFinite(paragraphSpacing) ? paragraphSpacing : WRITING_PARAGRAPH_SPACING_DEFAULT,
    textIndent: Number.isFinite(textIndent) ? textIndent : WRITING_TEXT_INDENT_DEFAULT,
    typewriter: value?.typewriter === true,
    focusMode: value?.focusMode === true
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

/* —— 项目事件 → 板块树自动刷新（批次39）————————————————————————————
   主进程把 `{ kind, at }` 推过来；这里按 kind 合并到一拍再刷（一次保存往往连发两三条）。
   真正的重扫在 useBoardData.refreshFromProjectEvent：只碰已经载入过的树，草稿脏就只重建树。
   提案审阅节／大纲转换节各自订阅自己的 kind，这条订阅不替它们做事。 */
let offProjectEvent = null
let projectEventTimer = null
const pendingProjectEventKinds = new Set()

function onProjectEvent(payload) {
  const kind = payload?.kind
  if (!refreshTargetsFor(kind).length) return
  pendingProjectEventKinds.add(kind)
  if (projectEventTimer) clearTimeout(projectEventTimer)
  projectEventTimer = setTimeout(() => {
    projectEventTimer = null
    const kinds = [...pendingProjectEventKinds]
    pendingProjectEventKinds.clear()
    for (const pending of kinds) void data.refreshFromProjectEvent(pending)
  }, 150)
}

onMounted(() => {
  applyScheme(scheme.value)
  void syncThemeFromPrefs()
  void loadWritingPrefs()
  void loadServiceSnapshot()
  void refresh()
  // 视口跨过 860px：窄屏收起索引窗（它会盖住正文），宽屏展开（桌面形态）。
  narrowQuery?.addEventListener?.('change', (event) => {
    indexOpen.value = !event.matches
  })
  // 应用菜单走主进程（文件／编辑／视图／运行时／窗口／帮助／设置），这里只接自己关心的那几条。
  // 工单F：页内菜单行的点击也收敛到同一个 runMenuAction——两条入口，一份落点。
  props.bridge?.onEvent?.(IPC_EVENT.menuInvoked, (payload) => runMenuAction(payload?.id))
  // 项目事件（批次39）：同一条桥，只接「有人消费」的 kind；退订在 onBeforeUnmount。
  if (typeof props.bridge?.onEvent === 'function') {
    offProjectEvent = props.bridge.onEvent(IPC_EVENT.projectEvent, onProjectEvent)
    // 服务与通知池：主进程每次变化推一份全量快照，这里只替换引用（不轮询）。
    offServiceLog = props.bridge.onEvent(IPC_PUSH.runtimeServiceLogChanged, (payload) => {
      serviceSnapshot.value = payload && Array.isArray(payload.carriers) ? payload : { ...EMPTY_SERVICE_LOG }
    })
  }
  // 页内菜单行的收起手势挂在 document 上：Esc 与点击菜单外都收（下拉不许一直挂着）。
  document.addEventListener('keydown', onTitlebarKeydown)
  document.addEventListener('pointerdown', onTitlebarPointerDown)
  // Esc 收起叠序最高的窗口（统一二级页先走自己的 Esc）。
  window.addEventListener('keydown', onWindowKeydown, true)
})

onBeforeUnmount(() => {
  // 自动保存的计时器收摊（批次43）：组件拆了不许再拿着工具去写盘。
  data.dispose?.()
  if (offProjectEvent) {
    offProjectEvent()
    offProjectEvent = null
  }
  if (offServiceLog) {
    offServiceLog()
    offServiceLog = null
  }
  if (projectEventTimer) {
    clearTimeout(projectEventTimer)
    projectEventTimer = null
  }
  pendingProjectEventKinds.clear()
  document.removeEventListener('keydown', onTitlebarKeydown)
  document.removeEventListener('pointerdown', onTitlebarPointerDown)
  window.removeEventListener('keydown', onWindowKeydown, true)
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
        :service-status="serviceStatus"
        @select="selectBoard"
        @toggle-theme="toggleTheme"
        @open-project="openProjectFolder"
        @new-project="openNewProject"
      />

      <!-- 左树是 folder 模板的一个 pane：web／gallery 载体不渲染 IndexWindow（铁律四）。 -->
      <template v-if="showIndexWindow">
        <IndexWindow
          :board="activeBoard"
          :data="data"
          :width="indexWidth"
          @collapse="indexOpen = false"
          @history="openHistoryFor"
          @overlay="toggleBoardOverlay"
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

        <!-- 批次53：一块板声明多块中栏 pane 时（comic.editor／comic.canvas），顶部出切换条；
             切换＝旧窗收成标签、新窗接着占位（仍是同一套 PaneWindow）。单 pane 板不显。 -->
        <div
          v-if="centerPaneTabs.length"
          class="nx-center-tabs"
          role="tablist"
          aria-label="核心区视图切换"
          data-test="center-pane-tabs"
        >
          <button
            v-for="pane in centerPaneTabs"
            :key="pane.id"
            type="button"
            class="control-quiet nx-center-tab"
            :class="{ 'is-active': pane.id === activeCenterPane?.id }"
            role="tab"
            :aria-selected="pane.id === activeCenterPane?.id"
            :data-pane="pane.id"
            @click="chooseCenterPane(pane.id)"
          >{{ pane.title ?? pane.id }}</button>
        </div>

        <!-- 中间 doc 区＝窗口管理器（铁律二）：多载体共存；所有窗走同一个 PaneWindow。
             浮窗可叠、可拖动缩放；分屏对半贴；收起＝侧缘标签；×＝关窗。 -->
        <div class="nx-window-layer" data-test="window-layer">
          <p v-if="!openWindows.length" class="center-empty">没有打开的窗口。点竖条上的载体打开它的文档窗。</p>
          <PaneWindow
            v-for="win in openWindows"
            :key="win.entry.instance"
            :instance="win.entry.instance"
            :pane-id="win.entry.pane"
            :title="win.pane.title ?? win.entry.pane"
            :geometry="win.entry.geometry"
            :minimized="win.entry.minimized"
            :maximized="win.entry.maximized"
            :tile-side="win.entry.tileSide"
            :z="win.entry.z"
            :tab-index="win.entry.minimized === 'tab' ? tabOrdinal(win.entry.instance) : 0"
            :suspend-esc="settingsOpen"
            @close="closeWindow(win.entry.instance)"
            @collapse="collapseWindow(win.entry.instance)"
            @expand="expandWindow(win.entry.instance)"
            @maximize="toggleWindowMaximized(win.entry.instance)"
            @split="splitWindow(win.entry.instance)"
            @focus="hostWorkspace.bringToFront(win.entry.instance)"
            @geometry="saveWindowGeometry(win.entry.instance, $event)"
          >
            <!-- 大纲小窗：迷你大纲（只读清单，点一行跳到大纲编辑面）。 -->
            <template v-if="win.entry.pane === 'outline.widget'">
              <p v-if="overlayLoading[win.entry.pane]" class="nx-overlay-empty">正在载入大纲…</p>
              <p v-else-if="data.outlineError" class="nx-overlay-error">{{ data.outlineError }}</p>
              <p v-else-if="!data.outline.length" class="nx-overlay-empty">大纲还没有内容（大纲/outline.json）。</p>
              <ul v-else class="nx-overlay-tree" aria-label="迷你大纲">
                <li v-for="(node, index) in data.outline" :key="node.id ?? `overlay-node-${index}`">
                  <button
                    type="button"
                    class="workspace-nav-item workspace-nav-item--tree nx-tree-row"
                    @click="openOutlineNodeFromWidget(index)"
                  >
                    <span class="workspace-nav-label">{{ index + 1 }}. {{ node.title }}</span>
                  </button>
                </li>
              </ul>
            </template>
            <!-- 其余窗口（中栏／自带面板）：内容渲染不随窗态变，一律走同一个 CarrierPaneHost。 -->
            <CarrierPaneHost
              v-else
              :pane="win.pane"
              :data="data"
              :project-root="project?.root ?? ''"
              @history="openHistoryFor"
            />
          </PaneWindow>
        </div>
      </div>

      <div
        class="resizer"
        role="separator"
        aria-orientation="vertical"
        @pointerdown="startDrag('right', $event)"
      />

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
        :bridge="props.bridge"
        @close="closeSettings"
        @changed="refresh"
        @theme="applyThemeChoice"
        @writing-prefs="applyWritingPrefsFromSection"
        @set-enabled="setCarrierEnabled"
        @set-primary="pickPrimary"
        @toggle-companion="toggleCompanion"
        @update:active-section="activeSection = $event"
      />

      <WorkbenchTooltip />
    </div>
  </div>
</template>

<style scoped>
/* 批次53：一块板声明多块中栏 pane 时的切换条。
   形态沿用老版侧栏行的度量与色阶：发丝分隔线、muted 底、选中走 workbench-selected。 */
.nx-center-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding: 4px 12px;
  border-bottom: 1px solid var(--hairline-soft);
  background: var(--surface-workbench-muted);
}
.nx-center-tab {
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--nx-fs-md);
}
.nx-center-tab:hover {
  background: var(--workbench-selected);
  color: var(--archive-ink);
}
.nx-center-tab.is-active {
  background: var(--surface-workbench);
  border-color: var(--hairline-soft);
  color: var(--archive-ink);
}
</style>
