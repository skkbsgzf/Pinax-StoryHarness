<script setup>
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import ActivityRail from './ActivityRail.vue'
import IndexWindow from './IndexWindow.vue'
import CarrierPaneHost from './CarrierPaneHost.vue'
import PaneWindow from './PaneWindow.vue'
import MaterialGallery from './MaterialGallery.vue'
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
import CommandPalette from './CommandPalette.vue'
import StatusBar from './StatusBar.vue'
import { useBoardData } from './useBoardData.mjs'
import { refreshTargetsFor } from './projectEventRefresh.mjs'
import { RECORD_CARRIER_KEYS, recordCarrierOfPaneId, recordTreeKey } from './recordCarriers.mjs'
import { IPC_CHANNELS, IPC_EVENT, IPC_PUSH } from './ipcContract.mjs'
import { MENU_TEMPLATE, flattenMenuEntries } from './menus.mjs'
import {
  HOTKEY_COLLAPSE_TOP,
  HOTKEY_PALETTE_OPEN,
  HOTKEYS_VERSION,
  acceleratorLabel,
  defaultBindings,
  matchHotkey,
  normalizeHotkeys
} from './hotkeys.mjs'
import {
  hostWorkspace,
  instanceIdFor,
  subscribeWorkspace
} from './workspace.mjs'
import { resolveOpenTarget } from './openTarget.mjs'
import { FORM_ACTIONS, MENU_TARGET_FORM, PAGE_ACTIONS } from './paneForms.mjs'
import PaneTabStrip from './PaneTabStrip.vue'
import PaneFormMenu from './PaneFormMenu.vue'
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
/**
 * 基座数据面：项目级的事（清单、检索、Agent、设置页）都归它。
 * 〔批次61 · 裁定④〕中心区的**每一页各持一份** boardData——索引窗与核心区不再共用一份，
 * 因为「一页一份文档」要求两块同 pane 的页能显示两份不同的稿子（共用一份时必然同文档）。
 * 页实例（`<paneId>#<n>`）→ 数据面的登记表与取用口在下面 pageDataOf／prunePageData。
 */
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
 * 工作区页状态（批次61 · v3）：宿主一份状态，AppNext 只订阅快照。
 * 「记录存在＝这一页开着」；页组（main|side）× 组内序号 × 每组当前页（active）× 形态
 * （page|floating|tab）＋ resource（这页装哪份文档）是页自己的轴，落 `.pinax/workspace.json`（version:3）。
 * v2 的 minimized／maximized（页档）／tiledWith／tileSide 全部退役。
 */
const workspaceSnapshot = ref(hostWorkspace.snapshot())
const unsubscribeWorkspace = subscribeWorkspace((snapshot) => {
  workspaceSnapshot.value = snapshot
  prunePageData()
})

/** 一块 pane 的缺省实例（`<paneId>#1`）。第二份起由页身份分配，#n 各记各的状态。 */
function paneInstance(paneId) {
  return instanceIdFor(paneId, 1)
}

/**
 * 页实例 → 这一页自己的数据面（〔裁定④〕D 的落点）。
 * 每份都是独立的 useBoardData：各自的 selection／chapter／draft／entry／note…，
 * 所以两块同 pane 的页能各开各的稿子；代价是同一棵树可能被两页各取一次（走同一条
 * runtimeToolCall 通道，不是第二套读法——批次35 那条纪律仍成立）。
 * 认领表要喂给每一页，否则 noteClaim／claimDecision 在页面上读不到裁决事实。
 */
const pageDataMap = new Map()
/** instance → 这页此刻materialize 的是哪份文档；用来判「已载入就别重取」（会冲掉手上草稿）。 */
const pageResource = new Map()
let claimPanesSnapshot = []

function pageDataOf(instance) {
  if (!instance) return data
  let page = pageDataMap.get(instance)
  if (!page) {
    page = useBoardData(props.bridge)
    page.declareClaimPanes?.(claimPanesSnapshot)
    pageDataMap.set(instance, page)
  }
  return page
}

/** 关页要把那页的数据面摘掉：留着既不释放草稿也没人再读它。 */
function prunePageData() {
  const alive = new Set(Object.keys(workspaceSnapshot.value.entries))
  for (const instance of [...pageDataMap.keys()]) {
    if (alive.has(instance)) continue
    pageDataMap.get(instance).dispose?.()
    pageDataMap.delete(instance)
    pageResource.delete(instance)
  }
}

/** 此刻说话的那一页：焦点组的当前页 → 另一组 → 最靠前的浮窗 → 都没有就是基座。 */
function focusedInstance() {
  const snap = workspaceSnapshot.value
  const order = [snap.focus, snap.focus === 'main' ? 'side' : 'main']
  for (const group of order) {
    const instance = snap.active?.[group]
    if (instance && snap.entries[instance]) return instance
  }
  const floats = Object.values(snap.entries).filter((entry) => entry.form === 'floating').sort((a, b) => a.z - b.z)
  return floats.length ? floats[floats.length - 1].instance : null
}

/** 历史／导出／Agent 这些「作者此刻看到的文档」都从这里取，不再钉死基座那一份。 */
function activeData() {
  return pageDataOf(focusedInstance())
}

/**
 * 全部数据面（基座＋每一扇开着的页）——旁路广播只用它。
 * 批次39 的事件刷新与批次43 的自动保存各自挂在一份 useBoardData 上：一页一份文档之后，
 * 一次磁盘变更要落到所有正在看这棵树的页，否则「A 页保存了，B 页还揣着旧稿」。
 * 这不是第二套读法：每一份走的仍是它自己那条 runtimeToolCall。
 */
function allDataSources() {
  return [data, ...pageDataMap.values()]
}

/**
 * 某一页此刻装的文档换了（不是经 routeOpen 进来的那条路，例如历史恢复后的回读）：
 * 记账两处——工作区记录里的 resource（重启后还回到这一份）＋页数据面的备忘录（别重复取数）。
 * 没有焦点页（还没开窗）就什么都不做，不拿基座当替身。
 */
function rememberPageResource(resource) {
  const instance = focusedInstance()
  if (!instance) return
  hostWorkspace.setResource(instance, resource)
  pageResource.set(instance, resource)
}

/** 大纲转换落盘后重列：基座（索引窗那棵树）与每扇开着的大纲页各取各的，一份都不落。 */
function reloadOutlineEverywhere() {
  for (const page of allDataSources()) void page.loadOutline?.()
}

/** 这一页此刻装的是哪份文档（从它自己的 selection 推，不另记第二份真相）。 */
function selectionResource(page) {
  const selection = page?.selection
  if (!selection?.type) return null
  if (selection.type === 'outline-node') return `outline:node:${selection.item?.index ?? 0}`
  return resourceOf(selection.type, selection.item)
}

/**
 * 页记录里的 resource 必须跟着「这一页此刻装哪份文档」走——不管作者是经 routeOpen 跳过来的，
 * 还是在索引窗／画廊里直接点的行（它们拿到的就是这一页自己的数据面，〔任务四〕归一的副作用）。
 * 少了这一条，作者点过的文档不会落盘，重启后那一页会回到它第一次打开的那一份。
 * 读 workspaceSnapshot 那一行是有意的：页开／关都要重算（登记表不是响应式的）。
 */
watch(() => {
  void workspaceSnapshot.value
  const out = {}
  for (const [instance, page] of pageDataMap.entries()) out[instance] = selectionResource(page)
  return out
}, (next, previous) => {
  for (const [instance, resource] of Object.entries(next)) {
    if (previous?.[instance] === resource) continue
    pageResource.set(instance, resource)
    if (hostWorkspace.get(instance)?.resource !== resource) hostWorkspace.setResource(instance, resource)
  }
}, { deep: true })


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
  (panes) => {
    claimPanesSnapshot = panes
    data.declareClaimPanes?.(panes)
    // 页实例是懒建的，认领表要一并补喂；否则后开的页读不到裁决事实。
    for (const page of pageDataMap.values()) page.declareClaimPanes?.(panes)
  },
  { immediate: true }
)
const rejected = computed(() => view.value?.rejected ?? [])
const needsPrimary = computed(() => Boolean(view.value?.needsPrimary))
const openError = computed(() => view.value?.openError ?? null)
const kinds = computed(() => view.value?.kernel?.kinds ?? [])

/**
 * 当前文档（D2 历史面板的锚点）：此刻聚焦那一页选中什么，历史就查什么。
 * 路径与修订号都取自已读回的状态（不是列表页的旧值）——恢复时 expectedRevision 才对得上。
 * 〔裁定④〕取的是**那一页自己的**数据面，不再钉死基座：两页各开各的稿子时，
 * 历史面板跟着作者正在看的那一页走。
 */
const historyTarget = computed(() => {
  const source = activeData()
  const selection = source.selection
  if (!selection?.type) return null
  if (selection.type === 'chapter' && source.chapter?.file) {
    return {
      kind: 'chapter',
      path: source.chapter.file,
      title: source.chapter.title ?? selection.item?.title ?? '章节',
      revision: Number.isInteger(source.chapter.revision) ? source.chapter.revision : 0
    }
  }
  if (selection.type === 'entry' && (source.entry?.path ?? selection.item?.path)) {
    return {
      kind: 'entry',
      path: source.entry?.path ?? selection.item.path,
      title: source.entry?.title ?? source.entry?.name ?? selection.item?.name ?? '条目',
      revision: Number.isInteger(source.entry?.revision) ? source.entry.revision : 0
    }
  }
  if (selection.type === 'note' && (source.note?.file ?? selection.item?.file)) {
    return {
      kind: 'note',
      path: source.note?.file ?? selection.item.file,
      title: source.note?.title ?? selection.item?.title ?? '构思',
      revision: Number.isInteger(source.note?.revision) ? source.note.revision : 0
    }
  }
  if (selection.type === 'outline-node') {
    return {
      kind: 'outline',
      path: '大纲/outline.json',
      title: '大纲',
      revision: Number.isInteger(source.outlineRevision) ? source.outlineRevision : 0
    }
  }
  return null
})

/**
 * 导出目标（批次26）：当前打开的那一份文档。
 * 锚点与历史面板同一个（此刻那一页的 selection），但取的是「作者此刻看到的那份文本」——
 * 编辑态取草稿（未保存的改动也在），阅读态取读回来的正文；没有打开文档就是 null。
 * 只在六个有正文的载体之间取：章节／条目／构思／资料／约束／剧本（大纲是结构不是正文，不导）。
 */
const exportDocumentTarget = computed(() => {
  const source = activeData()
  const selection = source.selection
  if (!selection?.type) return null
  if (selection.type === 'chapter' && source.chapter?.file) {
    return { kind: 'chapter', title: source.chapter.title ?? selection.item?.title ?? '章节', path: source.chapter.file, text: source.draft ?? '' }
  }
  if (selection.type === 'entry' && source.entry?.path) {
    return {
      kind: 'entry',
      title: source.entry.name ?? selection.item?.name ?? '条目',
      path: source.entry.path,
      text: source.editingEntry ? (source.entryDraft ?? '') : (source.entry.content ?? '')
    }
  }
  if (selection.type === 'note' && source.note?.file) {
    return { kind: 'note', title: source.note.title ?? '构思', path: source.note.file, text: source.noteDraft ?? source.note.text ?? '' }
  }
  if (selection.type === 'document' && source.document?.file) {
    return {
      kind: 'document',
      title: source.document.title ?? '资料',
      path: source.document.file,
      text: source.editingDocument ? (source.documentDraft ?? '') : (source.document.text ?? '')
    }
  }
  if (selection.type === 'rule' && source.rule?.file) {
    return { kind: 'rule', title: source.rule.title ?? '约束', path: source.rule.file, text: source.ruleDraft ?? source.rule.text ?? '' }
  }
  if (selection.type === 'script' && source.script?.file) {
    return {
      kind: 'script',
      title: source.script.title ?? '剧本',
      path: source.script.file,
      text: source.editingScript ? (source.scriptDraft ?? '') : (source.script.text ?? '')
    }
  }
  return null
})

/**
 * @ 引用清单（批次27 · 任务三）：从 board data 组一份 { kind, title, path } 交给右栏。
 * 只列已经载入过的树——为了这份清单额外读盘会顺手打开第一条（loadEntries 的既有行为），
 * 那不是作者点的事，所以这里只做投影，不触发取数。
 * 〔裁定④〕树现在可能只载在某一页那份数据面里，所以基座与每一页都取并去重；
 * 读 workspaceSnapshot 那一行是有意的——页开／关时这份清单要重算（登记表不是响应式的）。
 */
const referenceCatalog = computed(() => {
  void workspaceSnapshot.value
  const out = []
  const seen = new Set()
  const push = (item) => {
    const key = `${item.kind}|${item.path ?? ''}|${item.id ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  }
  for (const source of [data, ...pageDataMap.values()]) {
    for (const chapter of source.chapters ?? []) {
      if (!chapter?.file) continue
      push({ kind: 'chapter', title: chapter.title ?? chapter.file, path: chapter.file })
    }
    for (const entry of source.entries ?? []) {
      if (!entry?.path) continue
      push({ kind: 'entry', title: entry.name ?? entry.title ?? entry.path, path: entry.path, id: entry.id ?? null })
    }
    for (const document of source.documents ?? []) {
      if (!document?.file) continue
      push({ kind: 'document', title: document.title ?? document.file, path: document.file })
    }
    for (const script of source.scripts ?? []) {
      if (!script?.file) continue
      push({ kind: 'script', title: script.title ?? script.file, path: script.file })
    }
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
 * 状态栏（批次63 任务1）的四要素读数。
 *
 * 一句话：状态栏只转述，不记账——四个数全从既有事实源现取，外壳不留第二份真相。
 *   ① 服务灯＝serviceLogPool 那份快照（与竖条状态点、设置页「服务与通知」同一来源）；
 *   ② 载体＝此刻那块板的标题；页组＝此刻那一页在 main 还是 side 组；
 *   ③「1＋N 的 N」＝在册窗数（工单口径：openWindows，四种形态都算在册）；
 *   ④ 字数＝此刻那一页装载的文档：有草稿读作者手上那份，没草稿读盘上那份的字数。
 * 唯一可点件（服务灯）落的是既有那节：点开设置里的「服务与通知」，不新增任何动作。
 */
const statusLights = computed(() => (serviceSnapshot.value?.carriers ?? [])
  .filter((carrier) => carrier?.carrierId && carrier?.color)
  .map((carrier) => ({
    id: carrier.carrierId,
    title: carrier.carrierTitle ?? carrier.carrierId,
    color: carrier.color,
    notices: carrier.unackedNotices ?? 0
  })))

const STATUS_GROUP_LABELS = { main: '主组', side: '侧组' }

/** 此刻站在哪块板（竖条那一格）；没开项目就没板。 */
const statusCarrier = computed(() => activeBoard.value?.title ?? '')

const statusPageGroup = computed(() => {
  const instance = focusedInstance()
  const group = instance ? workspaceSnapshot.value.entries[instance]?.group : null
  return group ? STATUS_GROUP_LABELS[group] ?? String(group) : ''
})

/** 「1＋N 的 N」：此刻在册的窗数（页／浮窗／侧缘标签都算）。 */
const statusWindows = computed(() => openWindows.value.length)

/** 编辑面与草稿位的对照：草稿非空就读草稿（作者手上那份），否则读盘上那份的 totalChars。 */
const STATUS_DOC_FIELDS = [
  ['chapter', 'draft'], ['entry', 'entryDraft'], ['note', 'noteDraft'], ['rule', 'ruleDraft'],
  ['document', 'documentDraft'], ['script', 'scriptDraft'], ['record', null]
]

/** 焦点文档：标题＋字数。没装可计字的文档就 chars=null，状态栏如实留一道破折号。 */
const statusDoc = computed(() => {
  const page = pageDataOf(focusedInstance())
  for (const [key, draftKey] of STATUS_DOC_FIELDS) {
    const doc = page?.[key]
    if (!doc) continue
    const draft = draftKey ? page?.[draftKey] : null
    if (typeof draft === 'string' && draft) return { title: doc.title ?? doc.name ?? '', chars: draft.length }
    const chars = Number.isFinite(doc.totalChars) ? doc.totalChars
      : typeof doc.text === 'string' ? doc.text.length : null
    return { title: doc.title ?? doc.name ?? '', chars }
  }
  return { title: '', chars: null }
})

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
  { id: 'outline-import', title: '大纲转换', group: '文档', keywords: ['大纲', '章节稿', 'outline', '001-004', '散文', '转换', 'md'], component: OutlineImportSection, props: { bridge: props.bridge, project: project.value, reload: reloadOutlineEverywhere } }
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

/** 索引窗行动作：先把该文档读进它自己的那一页（修订号以磁盘为准），再摊开历史。 */
async function openHistoryFor(payload) {
  if (!payload) return
  if (payload.type === 'outline') await openResource('outline-node', { index: payload.index })
  else await openResource(payload.type, payload.item)
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
/** 壳层根节点：手势的捕获监听挂在这里（批次62 任务五）。 */
const shellRoot = ref(null)

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

/**
 * 批次63 收编b：载体的命令 id 也走到这里（主进程那条 menu:invoke 一直按「MENU_TEMPLATE ∪
 * registry.commands()」放行并回 handled:true，但页面内没有它的落点，作者看到的成功是假的）。
 * 现在按命令表里那条 run 走面板同一条执行通路——不新开第二条做事的路，
 * 落点认不出就如实提示，与 runPaletteCommand 用的是同一句话。
 */
async function runMenuAction(id) {
  const action = menuActions[id]
  if (action) {
    action()
    return
  }
  // 只认 carrier 分组：菜单项的 run 是 `menu:<自己的 id>`，回到这里就是死循环。
  const entry = commandEntries.value.find((item) => item.group === 'carrier' && item.id === id)
  if (!entry) return
  const ran = await resolveCommandRun(entry.run, entry)
  if (ran) return
  data.notice = `命令「${entry.title ?? entry.id}」未接线：落点 ${String(entry.run || '（空）')} 不是既有动作`
}

/**
 * 页内菜单项点击：先落页面内动作，再经 menuInvoke 通道交给主进程分发（与原生菜单同一条路）。
 * 只读角色项（撤销／复制／最小化…）没有 IPC id，按钮本身是禁用态——原生菜单与快捷键照常可用。
 */
async function invokeMenu(item) {
  closeTopMenu()
  if (!item?.id) return
  void runMenuAction(item.id)
  if (!props.bridge?.request) return
  try {
    await props.bridge.request(IPC_CHANNELS.menuInvoke, { id: item.id })
  } catch {
    // 分发失败不收回已经摊开的弹窗：主进程侧各通道会各自如实报错。
  }
}

/**
 * —— 命令面（批次62 任务三）——————————————————————————————————————
 * 面板自己不认识任何一块载体：它只把这张表摊出来、把选中的那条回给宿主。
 * 表的内容 ＝ 应用菜单动作 ∪ 载体清单声明的命令 ∪ 当前焦点页可用的形态动作。
 * 前两块一律经 `command:list` 通道取（主进程那一份是唯一口径，见 ipcContract 的 commandTable）；
 * 桥不在（jsdom 验收、无主进程的开发模式）就回落到本地按同样两条数据源重算——
 * 回落用的仍是 MENU_TEMPLATE 与 view.carriers[].commands 这两处既有声明，不另立第三份清单。
 */
const paletteOpen = ref(false)
const remoteCommands = ref([])
const hotkeyBindings = ref(defaultBindings())

/** 桥不在时的回落口径：与主进程 commandTable 同一条映射，两条数据源都是既有的声明。 */
function localCommandEntries() {
  const fromMenu = flattenMenuEntries(MENU_TEMPLATE).map((item) => ({
    id: item.id,
    title: item.label,
    owner: 'app.menu',
    ownerTitle: '应用菜单',
    group: 'menu',
    accelerator: item.accelerator ?? '',
    run: `menu:${item.id}`
  }))
  const fromCarriers = []
  for (const carrier of carriers.value) {
    for (const command of carrier.commands ?? []) {
      fromCarriers.push({
        id: command.id,
        title: command.title,
        owner: carrier.id,
        ownerTitle: carrier.title ?? carrier.id,
        group: 'carrier',
        accelerator: '',
        run: typeof command.run === 'string' ? command.run : ''
      })
    }
  }
  return [...fromMenu, ...fromCarriers]
}

/** 键位显示走 hotkeys 那一张表：作者改了键位，面板上就跟着变，不抄第二份。 */
function acceleratorOf(entry) {
  const bound = hotkeyBindings.value[entry.id]
  if (bound) return acceleratorLabel(bound, { mac: isMac })
  return acceleratorHint(entry.accelerator ?? '')
}

/**
 * 当前焦点页可用的动作：项来自这块 pane 清单声明的 `forms` ∩ 真能落地的 FORM_ACTIONS，
 * 再加 PAGE_ACTIONS 那两条（收成标签／关闭）——与页签右键菜单同一份词汇、同一个落点
 * （applyFormAction）。面板只是这套房形态动作的第三个入口，不是第四套逻辑。
 */
function pageCommandEntries() {
  const instance = focusedInstance()
  if (!instance) return []
  const entry = hostWorkspace.get(instance)
  if (!entry) return []
  const descriptor = descriptorFor(entry.pane)
  const label = descriptor?.title ?? entry.pane
  const shape = (item) => ({
    id: `page.${instance}.${item.action}`,
    title: `${item.label}（${label}）`,
    owner: 'host.page',
    ownerTitle: '当前页',
    group: 'page',
    accelerator: '',
    run: `page:${item.action}`,
    instance
  })
  const formItems = (descriptor?.forms ?? []).map((form) => FORM_ACTIONS[form]).filter(Boolean).map(shape)
  return [...formItems, ...PAGE_ACTIONS.map(shape)]
}

const commandEntries = computed(() => {
  const base = remoteCommands.value.length ? remoteCommands.value : localCommandEntries()
  const entries = base
    .filter((item) => item && item.id)
    .map((item) => ({ ...item, accelerator: acceleratorOf(item) }))
  const seen = new Set(entries.map((item) => item.id))
  return [...entries, ...pageCommandEntries().filter((item) => !seen.has(item.id))]
})

async function loadCommandTable() {
  if (!props.bridge?.request) {
    remoteCommands.value = []
    return
  }
  try {
    const result = await props.bridge.request(IPC_CHANNELS.commandList, {})
    remoteCommands.value = result?.ok && Array.isArray(result.value?.commands) ? result.value.commands : []
  } catch {
    remoteCommands.value = []
  }
}

function openPalette() {
  paletteOpen.value = true
  void loadCommandTable()
}
function closePalette() {
  paletteOpen.value = false
}

/**
 * `run` 串的词汇（清单注释里那张映射表的另一半）。这里只认六个前缀，
 * 每个前缀都落到一个**已经存在**的函数上——命令面不开第二条做事的路（工单禁止边界）。
 * 认不出的串如实返回 false，不猜、不静默。
 */
async function resolveCommandRun(run, entry = null) {
  const text = String(run ?? '')
  const split = text.indexOf(':')
  const verb = split < 0 ? '' : text.slice(0, split)
  const arg = split < 0 ? '' : text.slice(split + 1)
  if (!verb || !arg) return false
  switch (verb) {
    case 'menu':
      await invokeMenu({ id: arg })
      return true
    case 'section':
      openSection(arg)
      return true
    case 'board':
      selectBoard(arg)
      return true
    case 'overlay':
      toggleBoardOverlay(arg)
      return true
    case 'pane':
      await routeOpen({ pane: arg })
      return true
    case 'page': {
      const instance = entry?.instance ?? focusedInstance()
      if (!instance) return false
      applyFormAction(instance, arg)
      return true
    }
    case 'data': {
      // data:<方法>[?:参数]——方法与索引窗／编辑位上那枚按钮点下去调的是同一个（useBoardData 的导出面）。
      // 参数段允许是空串：`data:setEntriesFilterCat:` 的入参就是「不设分类筛选」（EntriesCategoryTree.vue:29）。
      const colon = arg.indexOf(':')
      const method = colon < 0 ? arg : arg.slice(0, colon)
      const param = colon < 0 ? undefined : arg.slice(colon + 1)
      const target = activeData()
      if (!target || typeof target[method] !== 'function') return false
      await (param === undefined ? target[method]() : target[method](param))
      return true
    }
    default:
      return false
  }
}

async function runPaletteCommand(entry) {
  closePalette()
  if (!entry) return
  const ran = await resolveCommandRun(entry.run, entry)
  if (ran) return
  // 执行不了要说得出为什么：run 串是清单里的原话，认不出＝清单写错（或那条动作此刻没有承载的页）。
  data.notice = `命令「${entry.title}」未接线：落点 ${String(entry.run || '（空）')} 不是既有动作`
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
  // 批次61〔裁定④〕：历史面板锚的是「作者此刻那一页」，恢复后回读也必须回到同一页——
  // 用基座那份 data 会把结果写进没人看的 selection。
  const source = activeData()
  const revision = Number.isInteger(target.revision) ? target.revision : 0

  if (target.kind === 'chapter') {
    const saved = await source.tool('pinax_chapter_save', { file: target.path, text: String(text ?? ''), expectedRevision: revision })
    if (!saved.ok) return { ok: false, message: saved.message }
    await source.openChapter({ file: target.path, title: target.title })
    rememberPageResource(`chapter:${target.path}`)
    return { ok: true, message: `已恢复「${target.title}」· 第 ${saved.value.revision} 版；下一次快照会记为一条新版本。` }
  }

  if (target.kind === 'entry') {
    const body = stripWorldbookFrontmatter(text)
    if (!body.trim()) return { ok: false, message: '这一版条目只有契约头、没有正文，无法恢复。' }
    const saved = await source.tool('pinax_worldbook_save', { path: target.path, text: body, expectedRevision: revision })
    if (!saved.ok) return { ok: false, message: saved.message }
    const entry = source.entry ?? source.selection?.item
    if (entry) await source.openEntry(entry)
    rememberPageResource(`entry:${target.path}`)
    return { ok: true, message: `已恢复「${target.title}」· 第 ${saved.value.revision} 版；下一次快照会记为一条新版本。` }
  }

  if (target.kind === 'note') {
    const saved = await source.tool('pinax_notes_save', { file: target.path, text: String(text ?? ''), expectedRevision: revision })
    if (!saved.ok) return { ok: false, message: saved.message }
    await source.loadNotes()
    const note = source.notes.find((item) => item.file === saved.value.file)
    if (note) source.openNote(note)
    rememberPageResource(`note:${target.path}`)
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
    const saved = await source.tool('pinax_outline_save', {
      nodes,
      edges: Array.isArray(document.edges) ? document.edges : [],
      expectedRevision: revision
    })
    if (!saved.ok) return { ok: false, message: saved.message }
    await source.loadOutline()
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
      entry: carrier.entry ?? null,
      // 窗头右键的形态菜单只认清单声明（P18）：这一格不带出来，overlay 小窗的右键就只剩页操作。
      forms: Array.isArray(pane.forms) ? pane.forms : []
    }))))

/** 一块 pane 属于哪个载体（分屏与默认窗口都要找它）。 */
function boardForPane(paneId) {
  const id = String(paneId ?? '')
  if (!id) return null
  return boards.value.find((item) => (item.centerPanes ?? []).some((pane) => pane.id === id))
    ?? boards.value.find((item) => item.overlayPane?.id === id)
    ?? null
}

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

/** 此刻的全部页记录（四种形态都在内）——开窗决策吃的就是这份。 */
function pageRecords() {
  return hostWorkspace.list()
}

/* —— 资源标识（〔裁定④〕D 的口径：一页一份文档，文档用一条字符串标识） ————————
 * 前缀按 pane 声明的 keyField／清单归属推出来，不在状态轴里再造第二套身份：
 *   chapter:正文/12.md   note:构思/x.md   entry:世界书/北境军报.md
 *   document:资料/x.md   rule:约束/y.md   script:剧本/z.md
 *   record:material#7    outline:node#3   proposal:名字
 * 页只认这一条串；重启后据它把那一页恢复到它自己的那份文档。
 */
function resourceOf(kind, item) {
  if (!item) return null
  if (kind === 'record') return `record:${item.carrier ?? ''}:${item.id ?? ''}`
  if (kind === 'outline-node') return `outline:node:${item.index ?? 0}`
  if (kind === 'proposal') return `proposal:${item.name ?? ''}`
  const path = item.path ?? item.file ?? null
  if (!path) return null
  return `${kind}:${path}`
}

/** 从 resource 串还原「该调哪棵树里的哪一条」。认不出来返回 null（回落该 pane 的缺省那份，并如实留在记账里）。 */
function resourceTarget(resource) {
  const match = /^(chapter|note|entry|document|rule|script):(.+)$/u.exec(String(resource ?? ''))
  if (match) return { kind: match[1], path: match[2] }
  const record = /^record:([^:]+):(.+)$/u.exec(String(resource ?? ''))
  if (record) return { kind: 'record', carrier: record[1], id: record[2] }
  const outline = /^outline:node:(\d+)$/u.exec(String(resource ?? ''))
  if (outline) return { kind: 'outline-node', index: Number.parseInt(outline[1], 10) }
  return null
}

/** 把一条 resource 送进那一页自己的数据面（清单反查 → 该载体的既有读法，不另开辟读路径）。 */
async function openResourceInPage(page, paneId, resource) {
  const target = resourceTarget(resource)
  if (!target) {
    // 没标识＝这块 pane 的缺省那份：载树时它自己会开第一条，这里不替它决定。
    await ensurePaneData(paneInstance(paneId), paneId)
    return false
  }
  if (target.kind === 'outline-node') {
    page.selectOutlineNode(target.index)
    return true
  }
  if (target.kind === 'record') {
    await page.loadRecords?.(target.carrier)
    const item = (page.recordSets?.[target.carrier] ?? []).find((record) => String(record.id) === String(target.id))
    if (!item) return false
    page.openRecord(target.carrier, item)
    return true
  }
  // 条目／资料／约束这一类要先有清单；dossier 的约束与文档同 pane，按前缀选那一棵树。
  if (target.kind === 'entry') await page.loadEntries?.()
  if (target.kind === 'note') await page.loadNotes?.()
  // 章这一棵点名「不要顺手开别的」：下面就是按 resource 开那一份，先自动开一条会让作者看见闪一下的错文档。
  // 找不到那一条（改名／删除）就如实留着——这一页空着，比替作者挑一章好。
  if (target.kind === 'chapter') await page.loadChapters?.({ keep: false })
  if (target.kind === 'script') await page.loadScripts?.()
  if (target.kind === 'document' || target.kind === 'rule') {
    await page.loadDocuments?.()
    await page.loadRules?.()
  }
  const lists = {
    chapter: page.chapters,
    note: page.notes,
    entry: page.entries,
    document: page.documents,
    rule: page.rules,
    script: page.scripts
  }
  const field = target.kind === 'entry' ? 'path' : 'file'
  const item = (lists[target.kind] ?? []).find((candidate) => candidate?.[field] === target.path)
  if (!item) return false
  const openers = {
    chapter: () => page.openChapter(item),
    note: () => page.openNote(item),
    entry: () => page.openEntry(item),
    document: () => page.openDocument(item),
    rule: () => page.openRule(item),
    script: () => page.openScript(item)
  }
  await openers[target.kind]?.()
  return true
}

/**
 * 开窗的唯一通路（〔铁律二〕缺省＝切换；升档只从右键菜单进来）。
 * 竖条、左树、看板卡、蓝链、检索命中、图谱节点、命令——七条路径都只问这里一次，
 * 结果只有五种：回到已开着的那一页（reveal）、展开侧缘标签（raise-tab）、
 * 换这一页装哪份文档（replace-page，single 硬闸的后果）、新开一页（open-page）、拒（block）。
 * **这里没有任何一档会新建浮窗**：浮窗只经 PaneFormMenu 的「浮出为窗」到达。
 */
async function routeOpen({ pane, resource = null, opener = null, gesture = null }) {
  const descriptor = descriptorFor(pane)
  if (!descriptor) return { action: 'block', reason: 'UNKNOWN_PANE', pane }
  const decision = resolveOpenTarget({
    pane,
    multiplicity: descriptor.multiplicity ?? 'single',
    resource,
    pages: pageRecords(),
    groups: { focus: workspaceSnapshot.value.focus },
    gesture: gesture ?? {}
  })
  if (decision.action === 'block') return decision
  // 〔批次62 任务五〕中键点页签：openTarget 判出 close-page，落到宿主那句既有的 close——
  // 关窗仍只有 hostWorkspace.close 一条路，手势只是把它提前到「点哪一条签就关哪一页」。
  if (decision.action === 'close-page') {
    hostWorkspace.close(decision.instance)
    return { ...decision }
  }
  const instance = decision.instance
  const page = pageDataOf(instance)
  await ensurePaneData(instance, decision.pane)
  if (decision.action === 'open-page') hostWorkspace.open(instance, { resource: decision.resource, group: decision.group, form: decision.form ?? 'page' })
  else if (decision.action === 'replace-page') hostWorkspace.setResource(instance, decision.resource)
  else if (decision.action === 'raise-tab') hostWorkspace.setForm(instance, 'page')
  else hostWorkspace.bringToFront(instance)
  // 〔批次62 任务五〕Alt＋点：落点判定一个字没改，只是那一页要以手势指定的形态出现。
  if (decision.form && decision.form !== hostWorkspace.get(instance)?.form) hostWorkspace.setForm(instance, decision.form)
  const settled = decision.resource ?? hostWorkspace.get(instance)?.resource ?? null
  if (pageResource.get(instance) !== settled) {
    if (opener) await opener(page)
    else await openResourceInPage(page, decision.pane, settled)
    pageResource.set(instance, settled)
  }
  if (descriptor.boardId) activeBoardId.value = descriptor.boardId
  return { ...decision, instance, resource: settled }
}

/**
 * 竖条点击＝揭示／新开该载体的那一页（〔铁律二〕原文的「开浮窗」已被本批推翻）。
 * `maximize` 这个入参在 v3 不再有意义（页态天然铺满）：保留形参只为七个调用点一行不改（工单任务四），
 * 传进来的旧轴残值一律忽略，不拿它当隐形闸。
 */
function showBoardWindow(board, { maximize = null } = {}) {
  void maximize
  const pane = chosenCenterPaneFor(board)
  if (!pane) return null
  const instance = paneInstance(pane.id)
  const existing = hostWorkspace.get(instance)
  if (existing) {
    // 已开着：回到那一页（侧缘标签先展开），不动它此刻装的文档。
    if (existing.form === 'tab') hostWorkspace.setForm(instance, 'page')
    else hostWorkspace.bringToFront(instance)
    void ensurePaneData(instance, pane.id)
    if (existing.resource) pageResource.set(instance, existing.resource)
    return instance
  }
  void routeOpen({ pane: pane.id, resource: null })
  return instance
}

/** 索引窗那一棵树里点一行／看板卡／检索命中：按 kind 找到它归属的 pane，再走唯一通路。 */
function paneIdForKind(kind, item) {
  if (kind === 'record') {
    const carrier = String(item?.carrier ?? '')
    return descriptorFor(`${carrier}.editor`) ? `${carrier}.editor` : `${carrier}.board`
  }
  const board = boards.value.find((entry) => (entry.centerPanes ?? []).some((pane) => String(pane.id).startsWith(`${kind === 'entry' ? 'worldbook' : kind === 'chapter' ? 'novel' : kind === 'note' ? 'notes' : kind === 'script' ? 'script' : kind === 'outline-node' ? 'outline' : 'dossier'}.`)))
  const pane = board ? chosenCenterPaneFor(board) : null
  return pane?.id ?? null
}

/** 交给索引窗／画廊的注入口（替代它们直接调 props.data.openX 的老路）。 */
function openResource(kind, item) {
  const pane = paneIdForKind(kind, item)
  if (!pane) return Promise.resolve({ action: 'block', reason: 'NO_PANE_FOR_KIND' })
  const resource = resourceOf(kind, item)
  const openers = {
    chapter: (page) => page.openChapter(item),
    note: (page) => page.openNote(item),
    entry: (page) => page.openEntry(item),
    document: (page) => page.openDocument(item),
    rule: (page) => page.openRule(item),
    script: (page) => page.openScript(item),
    record: (page) => page.openRecord(item.carrier, item),
    'outline-node': (page) => page.selectOutlineNode(item.index ?? 0)
  }
  return routeOpen({ pane, resource, opener: openers[kind] })
}
provide('pinaxOpenResource', openResource)

/** 当前打开的页：页态按组内序号、浮窗按叠序，侧缘标签排最后（页签栏与窗口层共同的数据源）。 */
const openWindows = computed(() => Object.values(workspaceSnapshot.value.entries)
  .map((entry) => ({ entry, pane: descriptorFor(entry.pane) }))
  .filter((item) => item.pane)
  .sort((a, b) => formRank(a.entry.form) - formRank(b.entry.form) || a.entry.z - b.entry.z || a.entry.order - b.entry.order))

/** 渲染序：页态 → 浮窗 → 侧缘标签（标签不是窗，只留一条记录给页签栏与侧缘列）。 */
function formRank(form) {
  return form === 'page' ? 0 : form === 'floating' ? 1 : 2
}

/** 侧缘标签那一竖列的排位：只看标签态的记录，按叠序依次下移。 */
function tabOrdinal(instance) {
  let ordinal = 0
  for (const win of openWindows.value) {
    if (win.entry.instance === instance) return ordinal
    if (win.entry.form === 'tab') ordinal += 1
  }
  return ordinal
}

/* —— 中心区的三层渲染（批次61 · 〔铁律一〕页是一等对象）————————————————
 * 页签栏列全部页；页层（page 层）只放两组各自的当前页——同组还有第二页时它不占屏，
 * 但签上有名，点一下就揭示（这正是作者要的「首先考虑切换」）；
 * 浮窗层与侧缘标签层各按自己的形态渲染，都用同一个 PaneWindow，不出第二套窗口壳。
 */
const pageTierWindows = computed(() => [activePageWindow('main'), activePageWindow('side')].filter(Boolean))
const floatWindows = computed(() => openWindows.value.filter((win) => win.entry.form === 'floating'))
const sideTabWindows = computed(() => openWindows.value.filter((win) => win.entry.form === 'tab'))
/** 摆在屏幕上的那些页：页层（两组各占其当前页）＋浮窗层。同组没被选中的页只出现在页签栏。 */
const visibleWindows = computed(() => [...pageTierWindows.value, ...floatWindows.value])

function activePageWindow(group) {
  const snap = workspaceSnapshot.value
  const instance = snap.active?.[group]
  const entry = instance ? snap.entries[instance] : null
  if (!entry || entry.form !== 'page' || entry.group !== group) return null
  return openWindows.value.find((win) => win.entry.instance === instance) ?? null
}

/** 一条 resource 的短标签（页签与窗头用它区分同 pane 的两页）：取路径末段，去掉 md／json 尾巴。 */
function resourceLabel(resource) {
  const text = String(resource ?? '')
  if (!text) return ''
  const tail = text.split(':').filter(Boolean).pop() ?? ''
  return tail.split('/').pop()?.replace(/\.(md|json)$/u, '') ?? ''
}

/** 页签与窗头的标题：载体名打底，装了具体文档就补上文档名。 */
function windowTitle(win) {
  const base = win.pane.title ?? win.entry.pane
  const label = resourceLabel(win.entry.resource)
  return label ? `${base} · ${label}` : base
}

/** 页签栏的数据源：全部页记录（四种形态都在内），高亮跟着作者此刻那一页。 */
const tabStripPages = computed(() => {
  const current = focusedInstance() ?? ''
  return openWindows.value.map((win) => ({
    instance: win.entry.instance,
    pane: win.entry.pane,
    title: windowTitle(win),
    form: win.entry.form,
    group: win.entry.group,
    active: win.entry.instance === current
  }))
})

/** 此刻说话的那一页（页签高亮与 aria-selected 的口径，与 activeData 同源）。 */
const currentInstance = computed(() => focusedInstance() ?? '')

/**
 * 索引窗／画廊跟着走的那一页：当前板的那块中栏 pane 里序号最靠前的页。
 * 没开页就回落基座那一份数据（索引窗自己会取数，行为与批次60 一致）。
 * 批次66 起索引窗开始吃宿主注口（最近打开／树折叠态），但「点一行开哪份文档」仍由它直接调
 * 它拿到的那份数据——把「这一页」递给它就是归一的那一步：跳转落在页上，不再写没人看的基座 selection。
 */
function indexPageInstance() {
  const pane = chosenCenterPaneFor(activeBoard.value)
  if (!pane) return null
  const snap = workspaceSnapshot.value
  const focused = focusedInstance()
  if (focused && snap.entries[focused]?.pane === pane.id) return focused
  const candidates = Object.values(snap.entries)
    .filter((entry) => entry.pane === pane.id && entry.form === 'page')
    .sort((a, b) => a.order - b.order)
  return candidates.length ? candidates[0].instance : null
}
const indexData = computed(() => pageDataOf(indexPageInstance()))

/* —— 最近打开（批次66 任务二）——————————————————————————————
 * 真相只有一处：workspace v3 的 lastOpenFiles（打开文档时由状态机滚动记入，20 条封顶、去重最近优先）。
 * 这里把它翻译成「能点的一行」，点击仍旧走 routeOpen 那条唯一通路——恢复语义＝预填不自动开：
 * 启动后列表摆在那里，谁都不占中心区；页已经关掉的条目也留在列表里（「打开过」不跟着页一起消失）。
 */
const RECENT_KIND_PLURALS = Object.freeze({ chapter: 'chapters', note: 'notes', entry: 'entries', document: 'documents', rule: 'rules', script: 'scripts' })
const RECENT_KIND_WORDS = Object.freeze({ chapter: '章', note: '构思', entry: '条目', document: '文档', rule: '约束', script: '剧本', record: '记录', 'outline-node': '大纲' })

/** 标题从各页已经取回的清单里现找（不另存一份名字）：找不到就退到路径末段，如实而不是编一个。 */
function recentTitleOf(target) {
  const pages = [data, ...pageDataMap.values()]
  if (target.kind === 'record') {
    for (const page of pages) {
      const list = page?.recordSets?.[target.carrier]?.records
      const hit = (Array.isArray(list) ? list : []).find((record) => String(record?.id) === String(target.id))
      if (hit?.title || hit?.name) return hit.title ?? hit.name
    }
    return null
  }
  const key = RECENT_KIND_PLURALS[target.kind]
  if (!key) return null
  const field = target.kind === 'entry' ? 'path' : 'file'
  for (const page of pages) {
    const list = page?.[key]
    const hit = (Array.isArray(list) ? list : []).find((item) => item?.[field] === target.path)
    if (hit?.title) return hit.title
  }
  return null
}

function recentLabel(resource) {
  const target = resourceTarget(resource)
  if (!target) return String(resource ?? '')
  const word = RECENT_KIND_WORDS[target.kind] ?? ''
  const title = recentTitleOf(target)
  if (title) return word ? `${word} · ${title}` : title
  if (target.kind === 'outline-node') return `大纲节点 ${target.index}`
  const tail = String(target.path ?? resource ?? '').split('/').filter(Boolean).pop() ?? String(resource ?? '')
  return tail.replace(/\.(?:md|txt)$/u, '')
}

const recentFiles = computed(() => (workspaceSnapshot.value.lastOpenFiles ?? []).map((item) => ({
  pane: item.pane,
  resource: item.resource,
  label: recentLabel(item.resource)
})))

/** 点一条＝按 resource 走那条唯一通路开页（已开着就回到那一页，没开就新开；记不记新开由 resolveOpenTarget 判）。 */
function openRecentFile(item) {
  const pane = String(item?.pane ?? '')
  if (!pane) return
  void routeOpen({ pane, resource: item.resource ?? null })
}

/**
 * 〔批次66 任务三〕folder 树的卷折叠态：按页读／写 workspace 条目上的 viewState（每页自己的状态）。
 * 读的是 workspaceSnapshot 那一行（不是 hostWorkspace.get），与页签高亮同一口径——登记表不是响应式的。
 */
const indexTreeState = computed(() => {
  const instance = indexPageInstance()
  return instance ? (workspaceSnapshot.value.entries[instance]?.viewState ?? null) : null
})
function onIndexTreeState(state) {
  const instance = indexPageInstance()
  if (!instance) return
  hostWorkspace.setViewState(instance, state)
}

/** 页签／窗头右键共用的形态菜单状态：同一时刻只有一份，锚点＝右键处的视口坐标。 */
const formMenu = ref(null)

function openFormMenu(instance, anchor) {
  formMenu.value = { instance, ...anchor }
}

function closeFormMenu() {
  formMenu.value = null
}

const formMenuTarget = computed(() => {
  const menu = formMenu.value
  if (!menu) return null
  const entry = hostWorkspace.get(menu.instance)
  if (!entry) return null
  return { instance: menu.instance, anchor: { x: menu.x, y: menu.y }, forms: descriptorFor(entry.pane)?.forms ?? [], form: entry.form, group: entry.group }
})

/**
 * 页签点击＝揭示（〔铁律二〕唯一的缺省动作）：
 * 页态→置为该组当前页；浮窗→抬到最前（不改形态，点签不升档也不降档）；标签→展开。
 */
function revealPage(instance) {
  const entry = hostWorkspace.get(instance)
  if (!entry) return null
  if (entry.form === 'tab') hostWorkspace.setForm(instance, 'page')
  else if (entry.form === 'floating') hostWorkspace.bringToFront(instance)
  else hostWorkspace.setActive(entry.group, instance)
  const board = boardForPane(entry.pane)
  if (board) activeBoardId.value = board.id
  void ensurePaneData(instance, entry.pane)
  return instance
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
 * 跨载体跳转（批次60）：蓝链的目标不限于世界书——资料与约束也在同一个知识库里。
 * 〔任务四〕这条曾是第二条开窗旁路（自己 openEntry ＋ 自己 showBoardWindow，两处各开各的）；
 * 现在它只报「要去哪块 pane、哪份文档」，落点与那一页的数据面都交回 routeOpen 一处判。
 */
function boardWithPrefix(prefix) {
  return boards.value.find((board) => (board.panes ?? []).some((pane) => String(pane.id).startsWith(prefix))) ?? null
}

async function openKnowledge(target) {
  const item = target?.item
  if (!item) return
  const kind = target.kind === 'entry' ? 'entry' : target.kind === 'rule' ? 'rule' : 'document'
  const board = boardWithPrefix(kind === 'entry' ? 'worldbook.' : 'dossier.')
  if (board) activeBoardId.value = board.id
  await openResource(kind, { ...item, carrier: item.carrier ?? null })
}
provide('pinaxOpenKnowledge', openKnowledge)

/** 收成侧缘标签（v3 的 form:'tab'）——右键菜单与窗头「—」钮共用这一句。 */
function collapseWindow(instance) {
  return hostWorkspace.setForm(instance, 'tab')
}

function expandWindow(instance) {
  const entry = hostWorkspace.get(instance)
  if (!entry) return null
  const result = hostWorkspace.setForm(instance, 'page')
  const board = boardForPane(entry.pane)
  if (board) activeBoardId.value = board.id
  return result ?? entry
}

/** 浮窗的双击标题栏：占满中栏是浮窗的子态，页态没有这一档（天然铺满）。 */
function toggleWindowMaximized(instance) {
  return hostWorkspace.toggleMaximized(instance)
}

/** 宽高／位置拖完回宿主；只有浮窗有矩形可写（页态在状态机里就被拒）。 */
function saveWindowGeometry(instance, geometry) {
  if (!instance) return null
  return hostWorkspace.setGeometry(instance, geometry)
}

/**
 * 分屏（〔铁律一〕side 是页组不是形态）：把这页搬到对面那一组，两组各占一半。
 * 已经在对面组／已是页态在同一组的另一侧，就搬回来——一条动作，没有「半对」这种残留态。
 */
function splitWindow(instance) {
  const entry = hostWorkspace.get(instance)
  if (!entry) return null
  const target = entry.group === 'main' ? 'side' : 'main'
  if (entry.form === 'page') {
    // 页态点分屏：已经在对面组就是「解除」（搬回主组），否则就是移到对面。
    const opposite = entry.group === 'main' ? 'side' : 'main'
    return hostWorkspace.moveToGroup(instance, opposite)
  }
  const moved = hostWorkspace.setForm(instance, 'page')
  if (!moved?.ok) return moved
  return hostWorkspace.moveToGroup(instance, target)
}

function closeWindow(instance) {
  return hostWorkspace.close(instance)
}

/**
 * 形态菜单的唯一落点（页签右键与窗头右键是同一个入口的两份）。
 * 项从这块 pane 清单声明的 `forms` 里出；批次66 Q2 裁定后词表只有 dock／split／overlay 三值，
 * 每一项都有真实落点（FORM_ACTIONS），不再有「看着能点、其实没差别」的骗人入口。
 */
function applyFormAction(instance, action) {
  const entry = hostWorkspace.get(instance)
  if (!entry) return null
  if (action === 'close') return closeWindow(instance)
  const target = MENU_TARGET_FORM[action]
  if (!target) return null
  const result = hostWorkspace.setForm(instance, target)
  // 「分屏」不是第四种形态：先把这一页落成页态，再搬进对面那一组。
  if (action === 'side') return hostWorkspace.moveToGroup(instance, entry.group === 'main' ? 'side' : 'main') ?? result
  return result
}

/** 索引窗标题行的「悬浮」钮：开／收起这块 overlay 小窗。〔§7 待裁 ②〕overlay 槽仍默认浮——
 *  它是协议里的覆层物种，不是稿件页，本批不收口。 */
function toggleBoardOverlay(paneId) {
  const instance = paneInstance(paneId)
  const entry = hostWorkspace.get(instance)
  if (entry) {
    if (entry.form !== 'tab') return hostWorkspace.setForm(instance, 'tab')
    return hostWorkspace.setForm(instance, 'floating')
  }
  // 开卡即补一次取数：卡片内容不等下一次板激活。
  void ensurePaneData(instance, paneId)
  return hostWorkspace.open(instance, { form: 'floating', resource: null })
}

/**
 * 迷你大纲里点一行：切到大纲栏（若已启用）并把该节点送进那一页的编辑面；小窗保持开着，方便连续跳。
 * 批次61：一页一份文档之后，「先 nextTick 再 selectOutlineNode」那套防冲草稿的编排不再需要——
 * 大纲页自己的草稿不会被索引窗换板重列抹掉（那是基座那一份 data 的事）。跳转只走 routeOpen 一条口。
 */
async function openOutlineNodeFromWidget(index) {
  const board = boards.value.find((item) => (item.centerPanes ?? []).some((pane) => String(pane.id).startsWith('outline.')))
  if (!board) return
  activeBoardId.value = board.id
  indexOpen.value = true
  const pane = chosenCenterPaneFor(board)
  if (!pane) return
  await routeOpen({ pane: pane.id, resource: `outline:node:${index}` })
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
  const board = boards.value.find((entry) => entry.id === chapterBoardId.value)
  if (board) activeBoardId.value = board.id
  indexOpen.value = true
  const pane = board ? chosenCenterPaneFor(board) : null
  if (!pane) return
  await routeOpen({ pane: pane.id, resource: resourceOf('proposal', item), opener: (page) => page.openProposal(item) })
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
 * 同载体双中栏 pane 的切换：旧窗收成侧缘标签、新窗接着占位。
 * 二者仍是同一套 PaneWindow，只是内容 pane 换了。
 * （批次61 v3：页态天然铺满所在页组，原来那句「旧窗最大化则新窗也最大化」没有对应落点，删。）
 */
function chooseCenterPane(paneId) {
  const board = activeBoard.value
  if (!board) return null
  const id = String(paneId ?? '')
  centerPaneChoice[board.id] = id
  for (const pane of board.centerPanes ?? []) {
    if (pane.id === id) continue
    const instance = paneInstance(pane.id)
    if (hostWorkspace.get(instance)) hostWorkspace.setForm(instance, 'tab')
  }
  showBoardWindow(board)
  return id
}

/** 当前载体的布局模板：folder 有左树，web／gallery 没有（铁律四）。 */
const activeLayoutTemplate = computed(() => layoutTemplateForBoard(activeBoard.value))
/** 索引窗左树是 folder 模板的 pane，不再每载体标配。 */
const showIndexWindow = computed(() => indexOpen.value && templateHasTree(activeLayoutTemplate.value))

/** 换形态后把对应载体的内容取回来（浮窗／分屏／全屏都可能打开一块不在当前板的树）。 */
async function preparePaneData(page, paneId, { autoOpen = true } = {}) {
  const id = String(paneId ?? '')
  if (!id || !page) return
  // 〔批次66 任务三〕这一页存档里带着自己的文档时，别让目录替作者挑一条：
  // folder 树那条「没有就开最后一章」、世界书那条「没有就开第一条」都会把存档那份顶掉，重启后选中就漂移了。
  if (id.startsWith('novel.')) await page.loadChapters(autoOpen ? {} : { keep: false })
  else if (id.startsWith('outline.')) await page.loadOutline()
  else if (id.startsWith('notes.')) await page.loadNotes()
  else if (id.startsWith('worldbook.')) {
    await page.loadEntries(autoOpen ? {} : { syncCurrent: false })
    // 批次60：蓝色双链指向整个知识库（条目＋资料＋约束）——另两棵树没取过就顺手补一次。
    await page.ensureKnowledgeCatalog?.()
  }
  // 批次60：设定与资料合并体——编辑面要在文档与约束之间切换，两份清单都备齐。
  else if (id.startsWith('dossier.')) {
    await page.loadDocuments()
    await page.loadRules()
  }
  else if (id.startsWith('script.')) await page.loadScripts()
  else {
    const records = recordCarrierOfPaneId(id)
    if (records) await page.loadRecords(records.key)
  }
}

/** pane 前缀 → useBoardData 里那棵树的名字（只用于「取过数没有」这一格，取数入口仍是 preparePaneData）。 */
const PANE_TREE_KEYS = Object.freeze([
  ['novel.', 'chapters'],
  ['outline.', 'outline'],
  ['notes.', 'notes'],
  ['worldbook.', 'entries'],
  // 批次60：合并体的树由两份清单拼成——两棵树都取过才算齐。
  ['dossier.', ['documents', 'rules']],
  ['script.', 'scripts'],
  ...RECORD_CARRIER_KEYS.map((key) => [`${key}.`, recordTreeKey(key)])
])

function treeKeyForPane(paneId) {
  const id = String(paneId ?? '')
  const hit = PANE_TREE_KEYS.find(([prefix]) => id.startsWith(prefix))
  if (!hit) return null
  return Array.isArray(hit[1]) ? hit[1] : [hit[1]]
}

/**
 * 窗口的数据闸（批次35 · 修「先开浮窗就是空卡」；批次61 起一扇窗一份数据）：
 * 窗一打开／恢复时先补一次取数，走的是停靠板同一条口（preparePaneData → 载体工具 →
 * runtimeToolCall），不是第二套读法。已经取过的树不重取——重取会把作者手上的草稿
 * （大纲节点、条目编辑）冲掉；在途期间由 overlayLoading 让卡片显示载入语。
 * 「取过没有」读的是这一页自己的 `loadedTrees`：D（一页一份文档）之后，两扇窗各查各的树，
 * 不会因为别的页取过就跟着跳过，也不会把别的页的草稿算在自己头上。
 */
const overlayLoading = ref({})
/**
 * 在途取数按「这一页的哪一份文档面」记账，不是只按实例名：
 * 水合换掉工作区时，同名实例的数据面会被摘掉重造（〔D〕之后一页一份），
 * 只认实例名的话，新那一页会顶着上一页的在途标记直接跳过取数——永远是一棵空树。
 */
const pendingPaneLoads = new Map()

async function ensurePaneData(instance, paneId) {
  const id = String(paneId ?? '')
  if (!instance || !id) return
  const page = pageDataOf(instance)
  const keys = treeKeyForPane(id)
  if (!keys?.length || keys.every((key) => page.loadedTrees?.[key])) return
  if (pendingPaneLoads.get(instance) === page) return
  pendingPaneLoads.set(instance, page)
  overlayLoading.value = { ...overlayLoading.value, [instance]: true }
  try {
    // 这一页在存档里已经认了自己的文档＝取树时不触发「替你开最后一章」。
    await preparePaneData(page, id, { autoOpen: !hostWorkspace.get(instance)?.resource })
  } finally {
    if (pendingPaneLoads.get(instance) === page) pendingPaneLoads.delete(instance)
    const next = { ...overlayLoading.value }
    delete next[instance]
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
    // 本次打开的第一次有效清单：先把上次留下的窗内容取回来，再保证至少有一页占着中心区。
    paneDataRestored = true
    for (const entry of hostWorkspace.list()) {
      void restorePageDocument(entry.instance, entry.pane, entry.resource ?? null)
    }
    restoreActiveBoardFromWorkspace()
    // 图库模板不补页：它的内容（画廊）本身就在核心区，开一扇记录窗反而是多余的遮挡。
    if (!hostWorkspace.list().length && layoutTemplateForBoard(activeBoard.value) !== 'gallery') showBoardWindow(activeBoard.value)
  }
}

/**
 * 〔批次66 任务三〕重启恢复「这一页装的是哪份文档」：先取清单，再把存档那一份放回页上。
 * 少了后半段，页会停在目录顺手挑的那一条，而 selection→resource 那条看门狗会照着页上的选中标
 * 反过来改写存档——作者上次看的稿子就此丢失，「最近打开」也会被这一条假记录污染。
 * 找回失败（那一份改了名／删了）就如实让页空着：不替作者挑，也不动存档里那条 resource，
 * 等他自己点一行，看门狗照实更新。
 */
async function restorePageDocument(instance, paneId, recorded) {
  await ensurePaneData(instance, paneId)
  if (!recorded) return
  const page = pageDataOf(instance)
  if (selectionResource(page) === recorded) {
    pageResource.set(instance, recorded)
    return
  }
  const opened = await openResourceInPage(page, paneId, recorded)
  if (!opened) return
  pageResource.set(instance, recorded)
}

/** 从工作区把「上次看的那一栏」找回来：叠序最高的窗口属于哪个载体，竖条就落哪一格。 */
function restoreActiveBoardFromWorkspace() {
  const top = hostWorkspace.list().filter((entry) => entry.form !== 'tab').pop()
  const board = top ? boardForPane(top.pane) : null
  if (board) activeBoardId.value = board.id
}

async function hydrateWorkspace(bridge, root) {
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
  if (!root) {
    // 还没选项目＝没有那一份 `.pinax/workspace.json` 可读：清空、不算就绪、也不补默认页。
    // 等项目到了再水合——抢先把页开出来，随后水合一定位就把这一页的数据面连草稿一起摘掉。
    hostWorkspace.load(null)
    hostWorkspace.attachPersistence(null)
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
    hostWorkspace.load({
      version: loaded.version ?? 1,
      entries: loaded.entries,
      active: loaded.active ?? null,
      focus: loaded.focus ?? null,
      // 批次66 任务二：最近打开跟着整份读回来。它是预填数据——这里只列表，不开页。
      lastOpenFiles: Array.isArray(loaded.lastOpenFiles) ? loaded.lastOpenFiles : []
    })
  } else {
    hostWorkspace.load(null)
  }
  hostWorkspace.attachPersistence((snapshot) => bridge.request(IPC_CHANNELS.workspaceSave, { snapshot }))
  workspaceReady = true
  syncWorkspaceForView()
}

watch([boards, overlayPanes], () => syncWorkspaceForView(), { immediate: true })
watch([() => props.bridge, () => project.value?.root ?? ''], ([bridge, root]) => { void hydrateWorkspace(bridge, root) }, { immediate: true })

/**
 * Esc＝把叠序最高的那扇窗收成侧缘标签（铁律二）。
 * 统一二级页／命令面板／页内菜单开着时让位——那一层自己的 Esc 先走。
 */
function collapseTopWindow() {
  const top = hostWorkspace.list().filter((entry) => entry.form !== 'tab').pop()
  if (!top) return false
  hostWorkspace.setForm(top.instance, 'tab')
  return true
}

/**
 * 快捷键总线（批次62 任务四）。收编的只有点名的高频项，词汇来自 next/shell/hotkeys.mjs 那张表：
 *   · palette.open          Ctrl+P   唤起命令面板
 *   · workspace.collapse-top Esc     收叠序最高的那一扇（本批第一次有实现落在这条键位串上）
 *   · project.reviewProposals Ctrl+Shift+R —— 批次63 收编c：这条**不在这里生效**。
 *     原生菜单带着同一个 accelerator，Electron 直办后回一条 menuInvoked（见上面那条订阅）；
 *     matchHotkey 按 nativeAcceleratedIds() 把它剔掉，一次按键只走一条路。表里留着它是让作者看得见键位。
 * 表里将来再收编纯宿主动作（不在菜单里的）就自动生效，不必改这个函数。
 * 上层（面板／二级页／菜单下拉）开着就整体让位：Esc 同时是「关面板」和「收窗」时，先关面板。
 */
function onWindowKeydown(event) {
  if (paletteOpen.value || settingsOpen.value || openMenuLabel.value) return
  const id = matchHotkey(event, hotkeyBindings.value)
  if (!id) return
  event.preventDefault()
  if (id === HOTKEY_PALETTE_OPEN) {
    openPalette()
    return
  }
  if (id === HOTKEY_COLLAPSE_TOP) {
    collapseTopWindow()
    return
  }
  void runMenuAction(id)
}

/* —— 手势入口（批次62 任务五）——————————————————————————————————
 * 竖条与页签这两个组件不在本工单的允许文件里，所以入口不写进它们内部，而是在壳层用
 * **捕获阶段**的监听器认领那两个修饰：普通点击照常冒泡给组件自己（一次都不拦），
 * 只有带手势的那一下被这里吃掉并 preventDefault＋stopPropagation。
 * 认元素靠组件已有的稳定钩子：页签带 `data-page-instance`，竖条格带 `aria-label＝板块标题`。
 */
function gestureTabInstance(event) {
  const tab = event.target?.closest?.('.nx-page-tab[data-page-instance]')
  return tab?.getAttribute?.('data-page-instance') ?? null
}

/** Alt＋点击：竖条图标／页签 → 以浮窗态执行同一个动作（值就交给 openTarget 的 gesture 形参）。 */
function onGestureKeyClick(event) {
  if (event.button !== 0 || !event.altKey || event.defaultPrevented) return
  const instance = gestureTabInstance(event)
  if (instance) {
    const entry = hostWorkspace.get(instance)
    if (!entry) return
    event.preventDefault()
    event.stopPropagation()
    void routeOpen({ pane: entry.pane, resource: entry.resource ?? null, gesture: { form: 'floating' } })
    return
  }
  const rail = event.target?.closest?.('.nx-ribbon-item[aria-label]')
  const title = rail?.getAttribute?.('aria-label') ?? ''
  const board = boards.value.find((item) => item.title === title)
  const pane = board ? chosenCenterPaneFor(board) : null
  if (!pane) return
  event.preventDefault()
  event.stopPropagation()
  void routeOpen({ pane: pane.id, gesture: { form: 'floating' } })
}

/** 中键点击页签＝关那一页（值走 gesture:{action:'close', instance}，落点仍是宿主那句 close）。 */
function onGestureMiddleDown(event) {
  if (event.button !== 1) return
  const instance = gestureTabInstance(event)
  if (!instance) return
  event.preventDefault()
  event.stopPropagation()
  const entry = hostWorkspace.get(instance)
  if (!entry) return
  void routeOpen({ pane: entry.pane, gesture: { action: 'close', instance } })
}

/* —— 快捷键表读盘（批次62 任务四）：经主进程 hotkeys:load 取当前项目那一份，写口在合同侧（hotkeys:save），
 *    本批的界面还没有改键位的地方，所以渲染层今天只读不写——不设「点了没反应」的假口。 ———— */
async function hydrateHotkeys() {
  if (!props.bridge?.request) return
  try {
    const result = await props.bridge.request(IPC_CHANNELS.hotkeysLoad, {})
    if (result?.ok && result.value?.bindings) {
      hotkeyBindings.value = normalizeHotkeys({ version: HOTKEYS_VERSION, bindings: result.value.bindings }).bindings
    }
  } catch {
    // 读不到就用默认表：快捷键是便利，不是真相来源，不许因为它把外壳卡住。
  }
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
  for (const page of allDataSources()) page.clearTransient?.()
  const board = boards.value.find((item) => item.id === id)
  if (!board) return
  // 图库模板的内容就是画廊本身：竖条只负责换板，不替作者凭空开一扇记录窗。
  if (layoutTemplateForBoard(board) === 'gallery') {
    activeBoardId.value = id
    indexOpen.value = false
    return
  }
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
    for (const pending of kinds) for (const page of allDataSources()) void page.refreshFromProjectEvent(pending)
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
  props.bridge?.onEvent?.(IPC_EVENT.menuInvoked, (payload) => { void runMenuAction(payload?.id) })
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
  // 批次62 任务五：手势入口挂在壳层的捕获阶段——竖条与页签这两个组件不在本工单的允许文件里，
  // 但它们已有的稳定钩子（data-page-instance／aria-label）足够认出「被点的是哪一格」。
  shellRoot.value?.addEventListener?.('click', onGestureKeyClick, true)
  shellRoot.value?.addEventListener?.('mousedown', onGestureMiddleDown, true)
  void hydrateHotkeys()
})

onBeforeUnmount(() => {
  // 自动保存的计时器收摊（批次43）：组件拆了不许再拿着工具去写盘。
  data.dispose?.()
  // 批次61：一页一份数据面，拆外壳时每一页都要各自收掉自动保存计时器与在途请求。
  for (const page of pageDataMap.values()) page.dispose?.()
  pageDataMap.clear()
  pageResource.clear()
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
  shellRoot.value?.removeEventListener?.('click', onGestureKeyClick, true)
  shellRoot.value?.removeEventListener?.('mousedown', onGestureMiddleDown, true)
  unsubscribeWorkspace()
  hostWorkspace.attachPersistence(null)
})
</script>

<template>
  <div ref="shellRoot" class="nx-shell-root">
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
          :data="indexData"
          :width="indexWidth"
          :recent="recentFiles"
          :tree-state="indexTreeState"
          @collapse="indexOpen = false"
          @history="openHistoryFor"
          @overlay="toggleBoardOverlay"
          @open-recent="openRecentFile"
          @tree-state="onIndexTreeState"
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

        <!-- 中间 doc 区＝页底座（批次61 · 〔铁律一〕）：页签栏在上，页层按页组排版，
             浮窗与侧缘标签叠在同一层里，全都走同一个 PaneWindow（〔铁律四〕不出第二套窗口壳）。 -->
        <PaneTabStrip
          :pages="tabStripPages"
          :current-instance="currentInstance"
          @reveal="revealPage"
          @close="closeWindow"
          @menu="openFormMenu"
        />
        <div class="nx-window-layer" data-test="window-layer">
          <!-- 图库模板（批次60）：没有左栏也没有缺省文档窗，核心区就是一整面素材卡片墙；
               窗户仍叠在它上面，点一张卡才开那条记录的素材窗。 -->
          <MaterialGallery
            v-if="activeLayoutTemplate === 'gallery'"
            :board="activeBoard"
            :data="indexData"
            @open="showBoardWindow(activeBoard)"
          />
          <p v-else-if="!visibleWindows.length && !sideTabWindows.length" class="center-empty">
            中心区还没有页。点竖条上的载体，或在左树里点一份文档。
          </p>
          <!-- 页层与浮窗层同一条 v-for（〔铁律四〕PaneWindow 是唯一窗口壳，排版差异交给 CSS：
               页态 flex 占位、主／侧两组各半＝原来的分屏；浮窗态绝对定位可拖可缩）。 -->
          <PaneWindow
            v-for="win in visibleWindows"
            :key="win.entry.instance"
            :instance="win.entry.instance"
            :pane-id="win.entry.pane"
            :title="windowTitle(win)"
            :form="win.entry.form"
            :group="win.entry.group"
            :geometry="win.entry.geometry"
            :maximized="win.entry.maximized"
            :z="win.entry.z"
            :tab-index="0"
            :suspend-esc="settingsOpen"
            @close="closeWindow(win.entry.instance)"
            @collapse="collapseWindow(win.entry.instance)"
            @expand="expandWindow(win.entry.instance)"
            @maximize="toggleWindowMaximized(win.entry.instance)"
            @split="splitWindow(win.entry.instance)"
            @focus="hostWorkspace.bringToFront(win.entry.instance)"
            @geometry="saveWindowGeometry(win.entry.instance, $event)"
            @menu="openFormMenu(win.entry.instance, $event)"
          >
            <template v-if="win.entry.pane === 'outline.widget'">
              <p v-if="overlayLoading[win.entry.instance]" class="nx-overlay-empty">正在载入大纲…</p>
              <p v-else-if="pageDataOf(win.entry.instance).outlineError" class="nx-overlay-error">{{ pageDataOf(win.entry.instance).outlineError }}</p>
              <p v-else-if="!pageDataOf(win.entry.instance).outline.length" class="nx-overlay-empty">大纲还没有内容（大纲/outline.json）。</p>
              <ul v-else class="nx-overlay-tree" aria-label="迷你大纲">
                <li v-for="(node, index) in pageDataOf(win.entry.instance).outline" :key="node.id ?? `overlay-node-${index}`">
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
            <!-- 其余窗口（中栏／自带面板）：内容渲染不随窗态变，一律走同一个 CarrierPaneHost；
                 〔裁定④〕数据面用的是这一页自己的那一份，不是基座——两页各看各的稿子。 -->
            <CarrierPaneHost
              v-else
              :pane="win.pane"
              :data="pageDataOf(win.entry.instance)"
              :project-root="project?.root ?? ''"
              @history="openHistoryFor"
            />
          </PaneWindow>
          <!-- 侧缘标签列：收起≠关掉，一扇窗收成一条缘签，点它展开（页签栏里也有一条签）。 -->
          <PaneWindow
            v-for="win in sideTabWindows"
            :key="win.entry.instance"
            :instance="win.entry.instance"
            :pane-id="win.entry.pane"
            :title="windowTitle(win)"
            :form="win.entry.form"
            :group="win.entry.group"
            :geometry="null"
            :maximized="false"
            :z="win.entry.z"
            :tab-index="tabOrdinal(win.entry.instance)"
            :suspend-esc="settingsOpen"
            @expand="expandWindow(win.entry.instance)"
            @menu="openFormMenu(win.entry.instance, $event)"
          />
        </div>
        <PaneFormMenu
          v-if="formMenuTarget"
          :anchor="formMenuTarget.anchor"
          :forms="formMenuTarget.forms"
          :form="formMenuTarget.form"
          :group="formMenuTarget.group"
          @action="applyFormAction(formMenuTarget.instance, $event)"
          @dismiss="closeFormMenu"
        />
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

      <!-- 批次62 任务三：命令面板（Ctrl+P）。它不是「第二枚弹窗」的例外——
           焦点走与 SettingsModal 同一份 focusTrap.mjs，条目表走 command:list 同一条口径。 -->
      <CommandPalette
        :open="paletteOpen"
        :entries="commandEntries"
        placeholder="输入命令名…（应用菜单／载体命令／当前页动作）"
        @close="closePalette"
        @run="runPaletteCommand"
      />

      <WorkbenchTooltip />
    </div>

    <!-- 批次63 任务1：底栏常驻的状态栏。它是 .nx-shell-root 的最后一段（标题栏 → 三栏 → 状态栏），
         四个读数全由上面那几格现取，组件自己不认识桥。 -->
    <StatusBar
      :lights="statusLights"
      :carrier="statusCarrier"
      :page-group="statusPageGroup"
      :windows="statusWindows"
      :doc-title="statusDoc.title"
      :doc-chars="statusDoc.chars"
      @open-services="openSection('services')"
    />
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
