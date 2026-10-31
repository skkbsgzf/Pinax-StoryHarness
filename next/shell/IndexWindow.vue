<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { vWorkbenchTooltip } from '../../src/components/workbench/workbenchTooltip.js'
import { outlineDepths as depthsOfOutline } from './outlineTree.mjs'
import { recordCarrierOfPaneId } from './recordCarriers.mjs'
import EntriesCategoryTree from './EntriesCategoryTree.vue'

/**
 * 索引窗：竖条右边那一栏——会话管理／文件结构管理那件事就落在这里。
 *
 * 行用老前端的 .workspace-nav-item 词汇（src/styles/workspace-navigation.css:21-75）：
 * 行高、悬停、选中色、焦点环全部是原件那份 CSS，Next 不另配一套。
 * 宽度沿用老版目录窗的口径（200–360px，见 WorkspaceContentGroups.vue:155 的 aria-valuemin/max）。
 *
 * 协议 v1.1-A（作者 2026-10-28 裁定）：一个载体＝竖条一格＝一棵纯粹的本域内容树。
 * 这一栏按板块目录窗 pane 的前缀只渲染**本载体 dataDir** 的内容层级：
 *   novel.*      → 正文（卷→章两级树；提案审阅在统一二级页「文档 → 提案审阅」，工单B）
 *   outline.*    → 大纲树
 *   notes.*      → 构思清单
 *   worldbook.*  → 世界书条目树
 *   setting.*    → 约束清单
 *   reference.*  → 资料清单
 * 上一版把大纲／构思／世界书都塞进小说／设定板是模型错误，本版按六栏拆开。
 * 工单B：小说栏再纯粹化——只渲染章节树；提案区迁统一二级页（设置 → 文档 → 提案审阅）。
 * 卷→章两级：正文/ 下的一级子目录＝卷（不可点的分区标题），卷下是章行；没有子目录时
 * 与旧的平铺列表一模一样（大梦的真实数据就是平铺的）。
 *
 * 批次33（作者 2026-10-30 裁定「正常的 IDE 是怎么设计的，你就怎么设计」）：这一栏按 IDE 的
 * 文件树收一遍——
 *   1. 行＝名字：行首的「1. 」数字前缀全拆（章节与大纲都一样），顺序由文件名与排序自明；
 *      「第 N 版」「N 字」从可见 meta 退到行的 title（悬停才出现，IDE 的 hover 同一个道理）；
 *   2. 动作 hover 显形：行尾历史钮默认不占视觉，hover／键盘聚焦这一行才显形（命中区始终在）；
 *   3. 新建只留区标题行右侧一枚 hover 显形的「＋」，点开是临时输入行——Enter 建档、
 *      Esc／失焦取消（常驻的「新标题＋新建」输入排不再占一行）。
 */
const props = defineProps({
  /** 当前板块（一个载体）：树从哪来、标题叫什么都在这块板上。 */
  board: { type: Object, default: null },
  /** useBoardData 的返回值：索引窗与核心区看的是同一份数据。 */
  data: { type: Object, required: true },
  archive: { type: Array, default: () => [] },
  width: { type: Number, default: 256 }
})
const emit = defineEmits(['collapse', 'history', 'overlay', 'context-menu'])

/**
 * 协议 v1.2 P19：索引窗树行的右键也是「打开方式」入口（统一二级页目录项后续批同法）。
 * 这一栏只显示当前板，所以只上报坐标；菜单条目（哪些形态）由宿主按当前载体的 forms 声明列。
 * 批次31：大纲行例外——右键先开「节点」菜单（上移／下移／删除／加同级／加子节点），
 * 那些操作原先是大纲编辑面底部那排常驻按钮。打开方式在竖条右键照旧可达。
 */
function onRowContextMenu(event) {
  emit('context-menu', { x: event.clientX, y: event.clientY })
}

/**
 * 大纲行右键菜单（批次31 · P18 第 2 条）：节点操作退到「按需浮现」——
 * 右键先选中这一行（操作都作用在所选节点上），再在同一位置开出节点菜单。
 * 样式与通路照批次24 的打开方式菜单：同一套 .nx-context-* 词汇、同样 Esc／点外收起、
 * 同样按视口钳住坐标；不另起一套菜单皮。
 */
const nodeMenu = ref(null)
const nodeMenuRoot = ref(null)
const NODE_MENU_WIDTH = 200
const NODE_MENU_ITEM_HEIGHT = 30

const nodeMenuStyle = computed(() => {
  const menu = nodeMenu.value
  if (!menu) return {}
  const viewportWidth = Number(globalThis.innerWidth) || 0
  const viewportHeight = Number(globalThis.innerHeight) || 0
  const menuHeight = 30 + 5 * NODE_MENU_ITEM_HEIGHT + 16
  const left = Math.max(8, Math.min(menu.x, Math.max(8, viewportWidth - NODE_MENU_WIDTH - 8)))
  const top = Math.max(8, Math.min(menu.y, Math.max(8, viewportHeight - menuHeight - 8)))
  return { left: `${left}px`, top: `${top}px` }
})

function openOutlineNodeMenu(event, index) {
  props.data.selectOutlineNode(index)
  nodeMenu.value = { x: event.clientX, y: event.clientY }
}

function closeNodeMenu() {
  nodeMenu.value = null
}

/** 菜单里的一下：先收起菜单，再照旧走 useBoardData 的同一个动作（只改草稿，改完自动落盘）。 */
function runNodeAction(action, payload) {
  closeNodeMenu()
  if (action === 'move') props.data.moveOutlineNode(payload)
  else if (action === 'remove') props.data.removeOutlineNode()
  else if (action === 'add') props.data.addOutlineNode(payload)
}

/**
 * 章节行右键菜单（批次46A）：删除／重命名／上移／下移。
 * 删除照既有确认风格走两步（第一下只把文案换成「确认删除」，再点一下才真的删，
 * 与记录型载体那枚 records-remove 同一套措辞）；重命名在行内换成临时输入
 * （Enter 确认、Esc／失焦取消，与批次33 的新建临时输入同一套约定）；
 * 上移／下移只在同卷内换相邻两章的 NNN- 前缀，边界项置灰而不是点了报错。
 * 样式与 Esc／点外收起照大纲节点菜单：同一套 .nx-context-* 词汇，不另起一套菜单皮。
 */
const chapterMenu = ref(null)
const chapterMenuRoot = ref(null)
const renameTarget = ref(null)
const renameDraft = ref('')
const renameInput = ref(null)

const chapterMenuStyle = computed(() => {
  const menu = chapterMenu.value
  if (!menu) return {}
  const viewportWidth = Number(globalThis.innerWidth) || 0
  const viewportHeight = Number(globalThis.innerHeight) || 0
  const menuHeight = 30 + 5 * NODE_MENU_ITEM_HEIGHT + 30
  const left = Math.max(8, Math.min(menu.x, Math.max(8, viewportWidth - NODE_MENU_WIDTH - 8)))
  const top = Math.max(8, Math.min(menu.y, Math.max(8, viewportHeight - menuHeight - 8)))
  return { left: `${left}px`, top: `${top}px` }
})

function openChapterMenu(event, item, groupIndex, itemIndex) {
  closeNodeMenu()
  cancelRename()
  chapterMenu.value = { x: event.clientX, y: event.clientY, item, groupIndex, itemIndex, armed: false }
}

function closeChapterMenu() {
  chapterMenu.value = null
}

function chapterCanMove(delta) {
  const menu = chapterMenu.value
  if (!menu) return false
  const group = chapterGroups.value[menu.groupIndex]
  if (!group) return false
  const target = menu.itemIndex + delta
  return target >= 0 && target < group.chapters.length
}

function runChapterAction(action) {
  const menu = chapterMenu.value
  if (!menu) return
  if (action === 'remove') {
    if (!menu.armed) {
      chapterMenu.value = { ...menu, armed: true }
      return
    }
    closeChapterMenu()
    void props.data.deleteChapter(menu.item)
    return
  }
  closeChapterMenu()
  if (action === 'rename') startRename(menu.item)
  else if (action === 'move-up') void props.data.moveChapter(menu.item, -1)
  else if (action === 'move-down') void props.data.moveChapter(menu.item, 1)
}

function startRename(item) {
  renameTarget.value = item
  renameDraft.value = item.title
  void nextTick(() => {
    renameInput.value?.focus?.()
    renameInput.value?.select?.()
  })
}

function cancelRename() {
  renameTarget.value = null
  renameDraft.value = ''
}

async function submitRename() {
  const target = renameTarget.value
  if (!target) return
  const title = renameDraft.value.trim()
  cancelRename()
  if (!title) return
  await props.data.renameChapter(target, title)
}

/** Esc 先关菜单；点菜单外也收起（捕获阶段，先于行自己的 click）。 */
function onNodeMenuKeydown(event) {
  if (!nodeMenu.value && !chapterMenu.value) return
  if (event.key !== 'Escape') return
  event.preventDefault()
  closeNodeMenu()
  closeChapterMenu()
}

function onNodeMenuPointerDown(event) {
  if (nodeMenu.value && !nodeMenuRoot.value?.contains?.(event.target)) closeNodeMenu()
  if (chapterMenu.value && !chapterMenuRoot.value?.contains?.(event.target)) closeChapterMenu()
  // 导出格式菜单：点它外面就收起（命中的是同一枚标题行时交给按钮自己切换）。
  if (exportOpen.value && !event.target?.closest?.('.nx-index-section-head.is-chapters')) exportOpen.value = false
}


onMounted(() => {
  globalThis.addEventListener?.('keydown', onNodeMenuKeydown, true)
  globalThis.addEventListener?.('pointerdown', onNodeMenuPointerDown, true)
  globalThis.addEventListener?.('keydown', onFindShortcut, true)
})

onBeforeUnmount(() => {
  globalThis.removeEventListener?.('keydown', onNodeMenuKeydown, true)
  globalThis.removeEventListener?.('pointerdown', onNodeMenuPointerDown, true)
  globalThis.removeEventListener?.('keydown', onFindShortcut, true)
})

/** 树的口径由板块声明的目录窗 pane 前缀决定（协议 v1.1-A：一载体一棵本域内容树）。 */
const treeKind = computed(() => {
  const paneId = String(props.board?.treePaneId ?? '')
  if (paneId.startsWith('novel.')) return 'chapters'
  if (paneId.startsWith('outline.')) return 'outline'
  if (paneId.startsWith('notes.')) return 'notes'
  if (paneId.startsWith('worldbook.')) return 'entries'
  if (paneId.startsWith('script.')) return 'scripts'
  if (paneId.startsWith('setting.')) return 'rules'
  if (paneId.startsWith('reference.')) return 'documents'
  if (recordCarrierOfPaneId(paneId)) return 'records'
  return 'none'
})

/** 记录型载体（批次40）：当前栏的对照表项与它那棵树的列表。 */
const recordCarrier = computed(() => recordCarrierOfPaneId(props.board?.treePaneId))
const recordSet = computed(() => {
  const key = recordCarrier.value?.key
  return (key && props.data.recordSets?.[key]) || { records: [], error: null, loaded: false }
})

/** 树所在的目录名：取板块认领的第一个目录（小说＝正文，大纲＝大纲，构思＝构思…）。 */
const treeDir = computed(() => props.board?.dataDirs?.[0] ?? props.board?.treePaneTitle ?? '目录')

const isChapterOpen = (item) => props.data.selection?.type === 'chapter' && props.data.selection.item?.file === item.file
const isNoteOpen = (item) => props.data.selection?.type === 'note' && props.data.selection.item?.file === item.file
const isRuleOpen = (item) => props.data.selection?.type === 'rule' && props.data.selection.item?.file === item.file
const isDocumentOpen = (item) => props.data.selection?.type === 'document' && props.data.selection.item?.file === item.file
const isScriptOpen = (item) => props.data.selection?.type === 'script' && props.data.selection.item?.file === item.file
const isRecordOpen = (item) => props.data.selection?.type === 'record'
  && props.data.selection.item?.carrier === recordCarrier.value?.key
  && props.data.selection.item?.id === item.id

/** 记录行的提示：类型 · 状态 · 更新时间（记录没有文件路径与修订号那两栏）。 */
function recordRowHint(item) {
  return [item?.type, item?.status, item?.updatedAt ? `更新于 ${String(item.updatedAt).slice(0, 10)}` : '']
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}

/** 卷→章两级（工单B）：useBoardData 组好组，这里只负责画；没有 groups 时退回平铺列表。 */
const chapterGroups = computed(() => {
  const groups = props.data.chapterGroups
  if (Array.isArray(groups) && groups.length) return groups
  return Array.isArray(props.data.chapters) && props.data.chapters.length ? [{ name: '', chapters: props.data.chapters }] : []
})

/* —— 全书查找与当前章替换（批次46B · 任务①）————————————————————————————
 * 查找只读，走 book:search（fileService.searchChapters 扫 正文/ 全章，上限 500）；
 * 替换刻意只做「当前打开的章」——不提供全书一键替换（破坏面大，作者逐章替换），
 * 且走 expectedRevision 闸（useBoardData 拿当前章修订号），冲突如实拒绝。
 * 查找条收在章节区标题行的一枚钮后面；Ctrl+F 打开，Esc 收起并清掉结果。
 */
const findOpen = ref(false)
const findQuery = ref('')
const findInput = ref(null)
const findIndex = ref(-1)
const replaceText = ref('')
const replaceArmed = ref(false)

const findBusy = computed(() => props.data.bookSearch?.busy === true)
const findHits = computed(() => (Array.isArray(props.data.bookSearch?.hits) ? props.data.bookSearch.hits : []))
const findHasHits = computed(() => findHits.value.length > 0)
const findSearched = computed(() => Boolean(props.data.bookSearch?.query) && !findBusy.value)
const findCountText = computed(() => {
  if (findBusy.value) return '查找中…'
  const total = Number(props.data.bookSearch?.total ?? 0)
  if (!props.data.bookSearch?.query) return ''
  if (!total) return '0 处'
  return findIndex.value >= 0
    ? `${total} 处 · 第 ${findIndex.value + 1} 处`
    : `${total} 处`
})

/** 按章分组（保持主进程给的顺序：卷→文件→行号），每处带全局序号供上／下一处用。 */
const findGroups = computed(() => {
  const groups = []
  const byFile = new Map()
  let index = 0
  for (const hit of findHits.value) {
    let group = byFile.get(hit.file)
    if (!group) {
      group = { file: hit.file, title: hit.chapterTitle ?? hit.file, hits: [] }
      byFile.set(hit.file, group)
      groups.push(group)
    }
    group.hits.push({ ...hit, index })
    index += 1
  }
  return groups
})

function openFind() {
  findOpen.value = true
  void nextTick(() => findInput.value?.focus?.())
}

function closeFind() {
  findOpen.value = false
  findIndex.value = -1
  replaceArmed.value = false
  props.data.clearBookSearch?.()
}

function toggleFind() {
  if (findOpen.value) closeFind()
  else openFind()
}

async function runFind() {
  const query = String(findQuery.value ?? '').trim()
  replaceArmed.value = false
  if (!query) {
    findIndex.value = -1
    props.data.clearBookSearch?.()
    return
  }
  await props.data.searchBook(query)
  findIndex.value = findHasHits.value ? 0 : -1
}

function hitsFlat() {
  return findGroups.value.flatMap((group) => group.hits)
}

/** 跳到某一处：先按 file 找到章节条目，再打开它（结果以盘上那份为准）。 */
async function jumpTo(hit) {
  findIndex.value = hit.index
  const target = chapterGroups.value
    .flatMap((group) => group.chapters)
    .find((item) => item.file === hit.file)
  if (target && !isChapterOpen(target)) await props.data.openChapter(target)
}

function stepHit(delta) {
  const hits = hitsFlat()
  if (!hits.length) return
  const current = hits.findIndex((item) => item.index === findIndex.value)
  const next = (Math.max(0, current) + delta + hits.length) % hits.length
  void jumpTo(hits[next])
}

/** 当前章替换：两步确认；真正落盘由 useBoardData 带 expectedRevision 走文件服务闸。 */
async function doReplace() {
  const find = String(findQuery.value ?? '').trim()
  if (!find || !findHasHits.value || !props.data.chapter) return
  if (!replaceArmed.value) {
    replaceArmed.value = true
    return
  }
  replaceArmed.value = false
  await props.data.replaceInCurrentChapter(find, replaceText.value)
}

/** 导入单篇稿（.txt／.md）：主进程选文件，落 正文/NNN-标题.md；完事刷新并打开新章。 */
async function importDocument() {
  await props.data.importBookDocument?.()
}

/**
 * 整本导出（批次46B）：格式在校验层只认 txt／doc；另存为对话框与写盘都在主进程。
 * 入口与「导入」相邻——窄栏里就是这两枚按需浮现的图标钮，格式用一枚小菜单选。
 */
const exportOpen = ref(false)

async function exportBook(format) {
  exportOpen.value = false
  await props.data.exportBookFile?.(format)
}

/** Ctrl+F 只在章节栏生效：编辑正文时也抓（capture），不让浏览器自带的查找条顶上来。 */
function onFindShortcut(event) {
  if (treeKind.value !== 'chapters') return
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  if (String(event.key ?? '').toLowerCase() !== 'f') return
  event.preventDefault()
  openFind()
}

/**
 * 大纲缩进层级（批次28 · 工单1a）：edges → 每个节点的 depth，索引窗按它做缩进阶梯，
 * 不再用「·」点标记父子（缩进本身就说明了层级）。
 * 算法在 next/shell/outlineTree.mjs（纯函数，useBoardData 与这里共用一份）：
 * 无入边的节点是一级（depth 0），BFS 向下逐层 +1；悬空边、自环、重复 id 只让相关节点留在 0，
 * 不会让整棵树崩掉；没有 edges 时整份一级（还没连线的草稿是常态）。
 */
const outlineDepths = computed(() => depthsOfOutline(props.data.outline ?? [], props.data.outlineEdges ?? []))
/** 缩进阶梯：一级 10px 起，每层 +14px（布局尺寸可按像素；字号仍走 token）。 */
const outlineIndent = (index) => 10 + (outlineDepths.value[index] ?? 0) * 14
const isOutlineNodeOpen = (index) => props.data.selection?.type === 'outline-node' && props.data.selection.item?.index === index

/**
 * 世界书这一栏（批次44）：图表列（列表／表格／图谱）搬去了核心区的看板区，
 * 窄栏退成**类别导航树**——只管「按类别找条目」。
 *
 * 为什么这么搬（作者 2026-10-31：「图表列的切换全都挤在左侧小区域里进行，右侧大面积留空」）：
 * 表格与图谱挤在两百多像素宽的窄栏里，列头折行、图谱缩成一小块，而核心区大片空着——
 * 两头都不好用。搬上去之后核心区是竖排：上＝图表列，下＝选中条目的详情。
 *
 * 视图记忆（`entriesView.<projectRoot>`）与看板区的筛选排序都归 EntriesBoard 那块，
 * 窄栏不再各记一份（那一格在 useBoardData 的 entriesFilterCat：点类别＝给看板区加一道筛选）。
 */

/**
 * 新建下拉的选项（批次34）：有类别目录＝那些目录；一个都没有＝只有「顶层」。
 * 默认选中第一个——在真实数据（人物／编年／设定）里就是「人物」。
 */
const entryCategoryOptions = computed(() => {
  const categories = Array.isArray(props.data.categories) ? props.data.categories : []
  return categories.length ? categories.map((cat) => ({ value: cat, label: cat })) : [{ value: '', label: '顶层' }]
})

function defaultEntryCategory() {
  return entryCategoryOptions.value[0]?.value ?? ''
}

/**
 * 行 title（批次33 · 索引窗 IDE 化）：「第 N 版」「N 字」从可见 meta 退到行 tooltip——
 * 顺序由文件名与排序自明，版本与字数要问的时候悬停一下就有（IDE 的 hover 提示同一个道理）。
 * 只拼这条数据真的有的字段：章节列表不带字数，就不编一个 0 出来。
 */
function rowHint(item) {
  const parts = []
  const file = String(item?.file ?? item?.path ?? '').trim()
  if (file) parts.push(file)
  if (Number.isFinite(Number(item?.revision))) parts.push(`第 ${item.revision} 版`)
  const chars = item?.totalChars ?? item?.chars
  if (Number.isFinite(Number(chars))) parts.push(`${chars} 字`)
  if (item?.contract === false) parts.push('未建档')
  return parts.join(' · ')
}

/**
 * 新建入口（批次33 · IDE 化）：常驻的「新标题＋新建」输入排全拆，改成区标题行右侧一枚
 * hover 显形「＋」（照批次31 大纲那枚 outline-append-node 的先例）。点开才在区顶出现一行
 * 临时输入：Enter 建档、Esc 或失焦取消（都不建档）。「先起名再建档」这条边界不变。
 */
const newItem = ref(null)
const newItemInput = ref(null)
const newItemRow = ref(null)

function toggleNewItem(kind) {
  if (newItem.value?.kind === kind) {
    closeNewItem()
    return
  }
  newItem.value = { kind, title: '', category: kind === 'entries' ? defaultEntryCategory() : '' }
  void nextTick(() => newItemInput.value?.focus())
}

function closeNewItem() {
  newItem.value = null
}

/** 世界书那行多一枚类别下拉（批次34）：焦点移到同一行的下拉上不算「失焦取消」。 */
function onNewItemBlur(event) {
  const next = event?.relatedTarget
  if (next && newItemRow.value?.contains?.(next)) return
  closeNewItem()
}

async function submitNewItem() {
  const draft = newItem.value
  if (!draft) return
  const title = String(draft.title ?? '').trim()
  closeNewItem()
  if (!title) return
  if (draft.kind === 'chapters') await props.data.createChapter(title)
  else if (draft.kind === 'documents') await props.data.createDocument(title)
  else if (draft.kind === 'scripts') await props.data.createScript(title)
  else if (draft.kind === 'records' && recordCarrier.value) await props.data.createRecord(recordCarrier.value.key, title)
  else if (draft.kind === 'notes') await props.data.createNote(title)
  else if (draft.kind === 'rules') await props.data.createRule(title)
  else if (draft.kind === 'entries') await props.data.createEntry(title, draft.category ?? '')
}

// 换板＝换树：目录窗自己负责把这一板的东西列出来（核心区不替它列），且只列本载体那一棵。
// 协议 v1.1-A：小说板不再顺手取大纲／构思／世界书——那些是别的栏的树。
watch(() => props.board?.id, () => {
  closeNewItem()
  closeFind()
  exportOpen.value = false
  if (treeKind.value === 'chapters') {
    void props.data.loadChapters()
  } else if (treeKind.value === 'outline') {
    void props.data.loadOutline()
  } else if (treeKind.value === 'notes') {
    void props.data.loadNotes()
  } else if (treeKind.value === 'entries') {
    void props.data.loadEntries()
  } else if (treeKind.value === 'rules') {
    void props.data.loadRules()
  } else if (treeKind.value === 'documents') {
    // 资料（工单G1）：资料板只有这一棵树；泛型项目里它也是主树。
    void props.data.loadDocuments()
  } else if (treeKind.value === 'scripts') {
    // 剧本（批次26）：剧本板只有这一棵树（剧本/）。
    void props.data.loadScripts()
  } else if (treeKind.value === 'records' && recordCarrier.value) {
    // 记录型载体（批次40）：素材／漫画／视频／体验／联机各列各的那棵记录树。
    void props.data.loadRecords(recordCarrier.value.key)
  }
}, { immediate: true })
</script>

<template>
  <aside id="nx-index-window" class="workspace-sidebar nx-index-window" :style="{ width: width + 'px' }" aria-label="索引窗">
    <header class="nx-index-head">
      <span class="workspace-nav-section">{{ board?.title ?? '索引' }}</span>
      <!-- 协议 v3：载体声明了 overlay 槽的 pane（自带面板）才出这枚「悬浮」钮——
           点它由外壳把那块 pane 开成浮窗（正文写作时不必切回这一栏）。
           这枚钮原来只在大纲那一栏里，于是「素材面板」这类自带面板在界面上没有入口：
           清单里声明了、运行时也渲染得出来，作者却点不开（声明了却不生效）。 -->
      <button
        v-if="board?.overlayPane"
        type="button"
        class="control-quiet nx-index-overlay-btn"
        :aria-label="'悬浮 ' + (board.overlayPane.title ?? '面板')"
        @click="emit('overlay', board.overlayPane.id)"
      >悬浮</button>
      <button
        type="button"
        class="nx-row nx-index-collapse"
        aria-label="收起索引窗"
        v-workbench-tooltip="{ text: '收起索引窗', side: 'right' }"
        @click="emit('collapse')"
      >
        <WorkbenchIcon name="panel-left" :size="16" />
      </button>
    </header>

    <div class="nx-index-body">
      <p v-if="data.treeError" class="nx-index-error">{{ data.treeError }}</p>

      <!-- 小说（协议 v1.1-A：这一栏只有正文一棵树；提案审阅已迁统一二级页，工单B1） -->
      <template v-if="treeKind === 'chapters'">
        <div class="nx-index-section-head is-chapters">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <span class="nx-index-section-actions">
            <button
              type="button"
              class="nx-row nx-index-icon-btn nx-index-find-toggle"
              data-test="index-find-toggle"
              aria-label="全书查找"
              :aria-expanded="findOpen.toString()"
              v-workbench-tooltip="{ text: '查找（Ctrl+F）', side: 'left' }"
              @mousedown.prevent
              @click="toggleFind"
            >
              <WorkbenchIcon name="search" :size="14" />
            </button>
            <button
              type="button"
              class="nx-row nx-index-icon-btn nx-index-import"
              data-test="index-import"
              aria-label="导入文档"
              v-workbench-tooltip="{ text: '导入文档（.txt／.md）', side: 'left' }"
              :disabled="data.busy"
              @mousedown.prevent
              @click="importDocument"
            >
              <WorkbenchIcon name="import-manuscript" :size="14" />
            </button>
            <button
              type="button"
              class="nx-row nx-index-icon-btn nx-index-export"
              data-test="index-export"
              aria-label="导出整本"
              :aria-expanded="exportOpen.toString()"
              v-workbench-tooltip="{ text: '导出整本', side: 'left' }"
              :disabled="data.busy"
              @mousedown.prevent
              @click="exportOpen = !exportOpen"
            >
              <WorkbenchIcon name="download" :size="14" />
            </button>
            <button
              type="button"
              class="nx-row nx-index-icon-btn nx-index-add-toggle"
              data-test="index-new-toggle"
              aria-label="新建章节"
              :aria-expanded="(newItem?.kind === 'chapters').toString()"
              v-workbench-tooltip="{ text: '新建章节', side: 'left' }"
              @mousedown.prevent
              @click="toggleNewItem('chapters')"
            >
              <WorkbenchIcon name="plus" :size="14" />
            </button>
          </span>
          <div v-if="exportOpen" class="nx-export-menu" data-test="export-menu" role="menu" aria-label="导出整本">
            <button type="button" class="control-quiet nx-export-item" role="menuitem" data-test="export-txt" @click="exportBook('txt')">纯文本（.txt）</button>
            <button type="button" class="control-quiet nx-export-item" role="menuitem" data-test="export-doc" @click="exportBook('doc')">Word 文档（.doc）</button>
          </div>
        </div>
        <div v-if="newItem?.kind === 'chapters'" class="nx-index-new nx-index-new-inline">
          <input
            ref="newItemInput"
            v-model="newItem.title"
            class="nx-field is-tiny"
            data-test="index-new-input"
            placeholder="新章节标题"
            aria-label="新章节标题"
            @keydown.enter.prevent="submitNewItem"
            @keydown.esc.prevent="closeNewItem"
            @blur="closeNewItem"
          >
        </div>
        <!-- 全书查找（批次46B）：查找条 + 按章分组的结果 + 当前章替换（两步确认）。
             替换只作用在打开的章上：不做全书一键替换，也不绕开 expectedRevision。 -->
        <section v-if="findOpen" class="nx-find" data-test="find-panel" aria-label="全书查找" @keydown.esc.stop.prevent="closeFind">
          <div class="nx-find-row">
            <input
              ref="findInput"
              v-model="findQuery"
              class="nx-field is-tiny nx-find-input"
              data-test="find-input"
              placeholder="在全书里查找…"
              aria-label="全书查找"
              spellcheck="false"
              @keydown.enter.prevent="runFind"
            >
            <button type="button" class="control-quiet nx-find-submit" data-test="find-submit" :disabled="findBusy" @click="runFind">查找</button>
            <button type="button" class="control-quiet nx-find-step" data-test="find-prev" :disabled="!findHasHits" @click="stepHit(-1)">上一处</button>
            <button type="button" class="control-quiet nx-find-step" data-test="find-next" :disabled="!findHasHits" @click="stepHit(1)">下一处</button>
            <button type="button" class="control-quiet nx-find-close" data-test="find-close" aria-label="收起查找" @click="closeFind">×</button>
          </div>
          <p v-if="findCountText" class="nx-find-count" data-test="find-count">{{ findCountText }}</p>
          <div class="nx-find-row">
            <input
              v-model="replaceText"
              class="nx-field is-tiny nx-find-input"
              data-test="replace-input"
              placeholder="替换为…"
              aria-label="替换为"
              spellcheck="false"
              @keydown.enter.prevent="doReplace"
            >
            <button
              type="button"
              class="control-secondary nx-find-replace"
              data-test="replace-current"
              :disabled="!findHasHits || !data.chapter"
              @click="doReplace"
            >{{ replaceArmed ? '确认替换本章' : '替换本章' }}</button>
          </div>
          <p v-if="replaceArmed" class="nx-find-hint" data-test="replace-hint">只改当前打开的这一章；再点一下确认。</p>
          <p v-if="data.bookSearch?.error" class="nx-index-error" data-test="find-error">{{ data.bookSearch.error }}</p>
          <p v-else-if="data.bookSearch?.truncated" class="nx-find-hint" data-test="find-truncated">已到 500 处上限，后面的命中未列出。</p>
          <div v-if="findGroups.length" class="nx-find-results">
            <div v-for="group in findGroups" :key="group.file" class="nx-find-group" data-test="find-group">
              <p class="nx-find-group-title">
                {{ group.title }}
                <span class="nx-find-group-count">{{ group.hits.length }}</span>
              </p>
              <button
                v-for="hit in group.hits"
                :key="hit.index"
                type="button"
                class="control-quiet nx-find-hit"
                :class="{ 'is-active': findIndex === hit.index }"
                data-test="find-hit"
                :title="`${hit.file} · 第 ${hit.line} 行`"
                @click="jumpTo(hit)"
              >
                <span class="nx-find-hit-line">{{ hit.line }}</span>
                <span class="nx-find-hit-snippet">{{ hit.snippet }}</span>
              </button>
            </div>
          </div>
          <p v-else-if="findSearched" class="nx-find-hint" data-test="find-empty">没有命中。</p>
        </section>
        <!-- 卷→章（工单B）：有子目录时先出卷标题（不可点），卷下是章行；平铺时只有一个无名组。 -->
        <template v-for="(group, groupIndex) in chapterGroups" :key="group.name || `flat-${groupIndex}`">
          <p v-if="group.name" class="workspace-nav-section nx-volume" data-test="chapter-volume">{{ group.name }}</p>
          <ul class="nx-tree">
            <li v-for="(item, itemIndex) in group.chapters" :key="item.file" class="nx-tree-line">
              <input
                v-if="renameTarget?.file === item.file"
                ref="renameInput"
                v-model="renameDraft"
                class="nx-field is-tiny nx-index-rename-input"
                data-test="chapter-rename-input"
                aria-label="章节新标题"
                @keydown.enter.prevent="submitRename"
                @keydown.esc.prevent="cancelRename"
                @blur="cancelRename"
              >
              <button
                v-else
                type="button"
                class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
                :class="{ 'is-active': isChapterOpen(item) }"
                :aria-current="isChapterOpen(item) ? 'page' : null"
                :title="rowHint(item)"
                @click="data.openChapter(item)"
                @contextmenu.prevent.stop="openChapterMenu($event, item, groupIndex, itemIndex)"
              >
                <span class="workspace-nav-label">{{ item.title }}</span>
              </button>
              <button
                type="button"
                class="nx-row nx-index-icon-btn nx-index-history"
                :aria-label="`「${item.title}」的历史`"
                v-workbench-tooltip="{ text: '历史', side: 'left' }"
                @click.stop="emit('history', { type: 'chapter', item })"
              >
                <WorkbenchIcon name="history" :size="14" />
              </button>
            </li>
          </ul>
        </template>
        <p v-if="!data.chapters.length && !data.treeError" class="nx-index-empty">这一栏还没有条目。</p>
      </template>

      <!-- 大纲（协议 v1.1-A：独立一栏，只有大纲那一棵内容树）。
           行可点选——点行把节点送进中栏的大纲编辑面（改名/备注/增删/排序在那里）；
           层级用缩进阶梯表达（depth 由 edges 现算，批次28 起不再用「·」点标记）。
           大纲还没写就给一行说明＋「新建大纲」，不当成错误。 -->
      <template v-else-if="treeKind === 'outline'">
        <!-- 批次31（P18）：区标题行右侧另有一枚 hover 才显形的「＋」——在末尾追一个同级节点；
             大纲编辑面底部那排节点操作按钮拆掉后，新建入口只剩这里（带 tooltip 说明）。
             「悬浮」钮搬去了索引窗标题行（协议 v3 的自带面板要对所有载体可见，不只大纲）。 -->
        <div class="nx-index-section-head is-outline">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <span class="nx-index-section-actions">
            <button
              type="button"
              class="nx-row nx-index-icon-btn nx-index-add-toggle nx-index-append-node"
              data-test="outline-append-node"
              aria-label="新建大纲节点"
              v-workbench-tooltip="{ text: '新建节点（加在末尾）', side: 'left' }"
              @click="data.appendOutlineNode()"
            >
              <WorkbenchIcon name="plus" :size="14" />
            </button>
          </span>
        </div>
        <ul class="nx-tree">
          <li v-for="(node, index) in data.outline" :key="node.id ?? `outline-${index}`" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isOutlineNodeOpen(index) }"
              :aria-current="isOutlineNodeOpen(index) ? 'page' : null"
              :style="{ paddingInlineStart: outlineIndent(index) + 'px' }"
              @click="data.selectOutlineNode(index)"
              @contextmenu.prevent.stop="openOutlineNodeMenu($event, index)"
            >
              <span class="workspace-nav-label">{{ node.title }}</span>
            </button>
            <button
              type="button"
              class="nx-row nx-index-icon-btn nx-index-history"
              :aria-label="`大纲「${node.title}」节点的历史`"
              v-workbench-tooltip="{ text: '历史', side: 'left' }"
              @click.stop="emit('history', { type: 'outline', index })"
            >
              <WorkbenchIcon name="history" :size="14" />
            </button>
          </li>
        </ul>
        <p v-if="!data.outline.length && !data.outlineError" class="nx-index-empty">
          大纲还没有内容（大纲/outline.json）。
          <button type="button" class="control-quiet nx-index-add" :disabled="data.busy" @click="data.startOutline()">新建大纲</button>
        </p>
        <!-- 批次30（U13 纯文案，不加按钮）：告诉作者散文章节稿有官方转换入口——不在这里放第二个动作钮。 -->
        <p v-if="!data.outline.length && !data.outlineError" class="nx-index-empty" data-test="outline-import-hint">
          大纲目录里有章节稿（md）时，可在 设置 → 大纲转换 一键生成节点。
        </p>
        <p v-if="data.outlineError" class="nx-index-error">{{ data.outlineError }}</p>
      </template>

      <!-- 构思（协议 v1.1-A：独立一栏）。行可点开——正文随 pinax_notes_list 一起回来，
           点击只换核心区的面板，不再发第二次读；目录还没写就给一行说明，不当成错误。
           新建（批次33）：区标题右侧 hover 显形的「＋」，点开才出现临时输入行（Enter 建档，Esc／失焦取消）。 -->
      <template v-else-if="treeKind === 'notes'">
        <div class="nx-index-section-head">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <button
            type="button"
            class="nx-row nx-index-icon-btn nx-index-add-toggle"
            data-test="index-new-toggle"
            aria-label="新建构思"
            :aria-expanded="(newItem?.kind === 'notes').toString()"
            v-workbench-tooltip="{ text: '新建构思', side: 'left' }"
            @mousedown.prevent
            @click="toggleNewItem('notes')"
          >
            <WorkbenchIcon name="plus" :size="14" />
          </button>
        </div>
        <div v-if="newItem?.kind === 'notes'" class="nx-index-new nx-index-new-inline">
          <input
            ref="newItemInput"
            v-model="newItem.title"
            class="nx-field is-tiny"
            data-test="index-new-input"
            placeholder="新构思标题"
            aria-label="新构思标题"
            @keydown.enter.prevent="submitNewItem"
            @keydown.esc.prevent="closeNewItem"
            @blur="closeNewItem"
          >
        </div>
        <ul class="nx-tree">
          <li v-for="item in data.notes" :key="item.file" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isNoteOpen(item) }"
              :aria-current="isNoteOpen(item) ? 'page' : null"
              :title="rowHint(item)"
              @click="data.openNote(item)"
              @contextmenu.prevent.stop="onRowContextMenu"
            >
              <span class="workspace-nav-label">{{ item.title }}</span>
            </button>
            <button
              type="button"
              class="nx-row nx-index-icon-btn nx-index-history"
              :aria-label="`「${item.title}」的历史`"
              v-workbench-tooltip="{ text: '历史', side: 'left' }"
              @click.stop="emit('history', { type: 'note', item })"
            >
              <WorkbenchIcon name="history" :size="14" />
            </button>
          </li>
        </ul>
        <p v-if="!data.notes.length && !data.notesError" class="nx-index-empty">构思还没有内容（构思/）。</p>
        <p v-if="data.notesError" class="nx-index-error">{{ data.notesError }}</p>
      </template>

      <!-- 世界书（批次44：窄栏只做类别导航，图表列搬去核心区的看板区）。
           作者 2026-10-31：「图表列的切换全都挤在左侧小区域里进行，右侧大面积留空，
           非常别扭，更合理的一个情况是，上面放图表列，下面放详情信息」。
           所以这一栏不再有视图切换钮、表格、图谱——只剩「按类别找条目」这一件事：
           类别树点一下＝给核心区的看板区加一道类别筛选（共享 state.entriesFilterCat）。
           新建（＋）留在这栏：IDE 的「新建」本来就是文件树的动作，建完条目在看板区显形。 -->
      <template v-else-if="treeKind === 'entries'">
        <div class="nx-index-section-head is-entries">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <span class="nx-index-section-actions">
            <button
              type="button"
              class="nx-row nx-index-icon-btn nx-index-add-toggle"
              data-test="index-new-toggle"
              aria-label="新建条目"
              :aria-expanded="(newItem?.kind === 'entries').toString()"
              v-workbench-tooltip="{ text: '新建条目', side: 'left' }"
              @mousedown.prevent
              @click="toggleNewItem('entries')"
            >
              <WorkbenchIcon name="plus" :size="14" />
            </button>
          </span>
        </div>
        <div v-if="newItem?.kind === 'entries'" ref="newItemRow" class="nx-index-new nx-index-new-inline nx-index-new-entry" data-test="index-new-entry">
          <input
            ref="newItemInput"
            v-model="newItem.title"
            class="nx-field is-tiny"
            data-test="index-new-input"
            placeholder="新条目名称"
            aria-label="新条目名称"
            @keydown.enter.prevent="submitNewItem"
            @keydown.esc.prevent="closeNewItem"
            @blur="onNewItemBlur"
          >
          <select
            v-model="newItem.category"
            class="nx-field is-tiny nx-index-new-category"
            data-test="index-new-category"
            aria-label="条目类别"
          >
            <option v-for="option in entryCategoryOptions" :key="option.value || '__top'" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
        <EntriesCategoryTree v-if="data.entries.length" :data="data" />
        <p v-if="!data.entries.length && !data.treeError" class="nx-index-empty">这一栏还没有条目。</p>
      </template>

      <!-- 约束（协议 v1.1-A：设定栏只剩这一棵内容树；世界书已独立成栏）。
           行可点开——正文随 pinax_rule_list 一起回来，点击只换核心区的面板，不再发第二次读；
           新建（批次33）：与构思同一形态——区标题右侧 hover 显形的「＋」，点开才是临时输入行。 -->
      <template v-else-if="treeKind === 'rules'">
        <div class="nx-index-section-head">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <button
            type="button"
            class="nx-row nx-index-icon-btn nx-index-add-toggle"
            data-test="index-new-toggle"
            aria-label="新建约束"
            :aria-expanded="(newItem?.kind === 'rules').toString()"
            v-workbench-tooltip="{ text: '新建约束', side: 'left' }"
            @mousedown.prevent
            @click="toggleNewItem('rules')"
          >
            <WorkbenchIcon name="plus" :size="14" />
          </button>
        </div>
        <div v-if="newItem?.kind === 'rules'" class="nx-index-new nx-index-new-inline">
          <input
            ref="newItemInput"
            v-model="newItem.title"
            class="nx-field is-tiny"
            data-test="index-new-input"
            placeholder="新约束标题"
            aria-label="新约束标题"
            @keydown.enter.prevent="submitNewItem"
            @keydown.esc.prevent="closeNewItem"
            @blur="closeNewItem"
          >
        </div>
        <ul class="nx-tree">
          <li v-for="item in data.rules" :key="item.file" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isRuleOpen(item) }"
              :aria-current="isRuleOpen(item) ? 'page' : null"
              :title="rowHint(item)"
              @click="data.openRule(item)"
              @contextmenu.prevent.stop="onRowContextMenu"
            >
              <span class="workspace-nav-label">{{ item.title }}</span>
            </button>
          </li>
        </ul>
        <p v-if="!data.rules.length && !data.rulesError" class="nx-index-empty">约束还没有内容（约束/）。</p>
        <p v-if="data.rulesError" class="nx-index-error">{{ data.rulesError }}</p>
      </template>

      <!-- 资料（工单G1）：资料板的树。行可点开——点行进中栏的阅读面（编辑在那里按）；
           批次33 起行＝篇名，字数与版本退到行 tooltip；目录还没写就给一行说明，不当成错误。
           这里不摆「历史…」：资料的历史还没接（工单边界），给一个点了没东西的按钮更糟。 -->
      <template v-else-if="treeKind === 'documents'">
        <div class="nx-index-section-head">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <button
            type="button"
            class="nx-row nx-index-icon-btn nx-index-add-toggle"
            data-test="index-new-toggle"
            aria-label="新建资料"
            :aria-expanded="(newItem?.kind === 'documents').toString()"
            v-workbench-tooltip="{ text: '新建资料', side: 'left' }"
            @mousedown.prevent
            @click="toggleNewItem('documents')"
          >
            <WorkbenchIcon name="plus" :size="14" />
          </button>
        </div>
        <div v-if="newItem?.kind === 'documents'" class="nx-index-new nx-index-new-inline">
          <input
            ref="newItemInput"
            v-model="newItem.title"
            class="nx-field is-tiny"
            data-test="index-new-input"
            placeholder="新资料标题"
            aria-label="新资料标题"
            @keydown.enter.prevent="submitNewItem"
            @keydown.esc.prevent="closeNewItem"
            @blur="closeNewItem"
          >
        </div>
        <ul class="nx-tree">
          <li v-for="item in data.documents" :key="item.file" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isDocumentOpen(item) }"
              :aria-current="isDocumentOpen(item) ? 'page' : null"
              :title="rowHint(item)"
              @click="data.openDocument(item)"
              @contextmenu.prevent.stop="onRowContextMenu"
            >
              <span class="workspace-nav-label">{{ item.title }}</span>
            </button>
          </li>
        </ul>
        <p v-if="!data.documents.length && !data.documentsError" class="nx-index-empty">资料还没有内容（资料/）。</p>
        <p v-if="data.documentsError" class="nx-index-error">{{ data.documentsError }}</p>
      </template>

      <!-- 剧本（批次26 · M6 提前）：剧本板的树。行可点开——点行进中栏的阅读面（编辑在那里按）；
           批次33 起行＝篇名，字数与版本退到行 tooltip；目录还没写就给一行说明，不当成错误。
           与资料同一口径：这里不摆「历史…」（剧本的历史还没接，给一个点了没东西的按钮更糟）。 -->
      <template v-else-if="treeKind === 'scripts'">
        <div class="nx-index-section-head">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <button
            type="button"
            class="nx-row nx-index-icon-btn nx-index-add-toggle"
            data-test="index-new-toggle"
            aria-label="新建剧本"
            :aria-expanded="(newItem?.kind === 'scripts').toString()"
            v-workbench-tooltip="{ text: '新建剧本', side: 'left' }"
            @mousedown.prevent
            @click="toggleNewItem('scripts')"
          >
            <WorkbenchIcon name="plus" :size="14" />
          </button>
        </div>
        <div v-if="newItem?.kind === 'scripts'" class="nx-index-new nx-index-new-inline">
          <input
            ref="newItemInput"
            v-model="newItem.title"
            class="nx-field is-tiny"
            data-test="index-new-input"
            placeholder="新剧本标题"
            aria-label="新剧本标题"
            @keydown.enter.prevent="submitNewItem"
            @keydown.esc.prevent="closeNewItem"
            @blur="closeNewItem"
          >
        </div>
        <ul class="nx-tree">
          <li v-for="item in data.scripts" :key="item.file" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isScriptOpen(item) }"
              :aria-current="isScriptOpen(item) ? 'page' : null"
              :title="rowHint(item)"
              @click="data.openScript(item)"
              @contextmenu.prevent.stop="onRowContextMenu"
            >
              <span class="workspace-nav-label">{{ item.title }}</span>
            </button>
          </li>
        </ul>
        <p v-if="!data.scripts.length && !data.scriptsError" class="nx-index-empty">剧本还没有内容（剧本/）。</p>
        <p v-if="data.scriptsError" class="nx-index-error">{{ data.scriptsError }}</p>
      </template>

      <!-- 记录型载体（批次40 · M4／M5）：素材／漫画／视频／体验／联机共用一棵记录树。
           行可点开——点行进中栏的记录详情／编辑面；类型与状态退到行 tooltip。 -->
      <template v-else-if="treeKind === 'records'">
        <div class="nx-index-section-head">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <button
            type="button"
            class="nx-row nx-index-icon-btn nx-index-add-toggle"
            data-test="index-new-toggle"
            :aria-label="`新建${recordCarrier?.title ?? '记录'}`"
            :aria-expanded="(newItem?.kind === 'records').toString()"
            v-workbench-tooltip="{ text: `新建${recordCarrier?.title ?? '记录'}`, side: 'left' }"
            @mousedown.prevent
            @click="toggleNewItem('records')"
          >
            <WorkbenchIcon name="plus" :size="14" />
          </button>
        </div>
        <div v-if="newItem?.kind === 'records'" class="nx-index-new nx-index-new-inline">
          <input
            ref="newItemInput"
            v-model="newItem.title"
            class="nx-field is-tiny"
            data-test="index-new-input"
            :placeholder="`新${recordCarrier?.title ?? '记录'}标题`"
            :aria-label="`新${recordCarrier?.title ?? '记录'}标题`"
            @keydown.enter.prevent="submitNewItem"
            @keydown.esc.prevent="closeNewItem"
            @blur="closeNewItem"
          >
        </div>
        <ul class="nx-tree">
          <li v-for="item in recordSet.records" :key="item.id" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isRecordOpen(item) }"
              :aria-current="isRecordOpen(item) ? 'page' : null"
              :title="recordRowHint(item)"
              @click="data.openRecord(recordCarrier.key, item)"
              @contextmenu.prevent.stop="onRowContextMenu"
            >
              <span class="workspace-nav-label">{{ item.title || item.id }}</span>
            </button>
          </li>
        </ul>
        <p v-if="!recordSet.records.length && !recordSet.error" class="nx-index-empty">
          {{ recordCarrier?.title }}还没有记录（{{ recordCarrier?.dir }}/{{ recordCarrier?.file }}）。
        </p>
        <p v-if="recordSet.error" class="nx-index-error">{{ recordSet.error }}</p>
      </template>

      <ul v-if="data.listWarnings.length" class="nx-index-warn">
        <li v-for="(warning, index) in data.listWarnings" :key="`l-${index}`">{{ warning }}</li>
      </ul>

    </div>

    <!-- 大纲节点菜单（批次31 · P18 第 2 条）：右键才出现，默认不可见——节点操作退到按需浮现。
         词汇与行为照批次24 的「打开方式」菜单：.nx-context-* 同一套样式（next-shell.css），
         Esc／点菜单外收起，坐标按视口钳住。首行上移／末行下移禁用（no-op 不给假动作）。 -->
    <div
      v-if="nodeMenu"
      ref="nodeMenuRoot"
      class="nx-context-menu"
      role="menu"
      aria-label="大纲节点"
      :style="nodeMenuStyle"
      @contextmenu.prevent
    >
      <p class="nx-context-group">节点</p>
      <button
        type="button"
        class="control-quiet nx-context-item outline-node-move outline-node-move-up"
        role="menuitem"
        data-test="outline-node-move-up"
        :disabled="!data.canMoveOutlineNode(-1)"
        @click="runNodeAction('move', -1)"
      >上移</button>
      <button
        type="button"
        class="control-quiet nx-context-item outline-node-move outline-node-move-down"
        role="menuitem"
        data-test="outline-node-move-down"
        :disabled="!data.canMoveOutlineNode(1)"
        @click="runNodeAction('move', 1)"
      >下移</button>
      <button
        type="button"
        class="control-quiet nx-context-item outline-node-remove"
        role="menuitem"
        data-test="outline-node-remove"
        @click="runNodeAction('remove')"
      >删除节点</button>
      <div class="nx-context-separator" role="separator"></div>
      <button
        type="button"
        class="control-quiet nx-context-item outline-node-add outline-node-add-sibling"
        role="menuitem"
        data-test="outline-node-add-sibling"
        @click="runNodeAction('add', 'sibling')"
      >加同级节点</button>
      <button
        type="button"
        class="control-quiet nx-context-item outline-node-add outline-node-add-child"
        role="menuitem"
        data-test="outline-node-add-child"
        @click="runNodeAction('add', 'child')"
      >加子节点</button>
    </div>

    <!-- 章节菜单（批次46A）：删除两步确认（照记录型载体 records-remove 的措辞），
         重命名走行内临时输入，上移／下移只在同卷相邻两章之间换前缀。 -->
    <div
      v-if="chapterMenu"
      ref="chapterMenuRoot"
      class="nx-context-menu nx-chapter-menu"
      role="menu"
      aria-label="章节操作"
      :style="chapterMenuStyle"
      @contextmenu.prevent
    >
      <p class="nx-context-group">章节</p>
      <button
        type="button"
        class="control-quiet nx-context-item chapter-menu-delete"
        role="menuitem"
        data-test="chapter-menu-delete"
        @click="runChapterAction('remove')"
      >{{ chapterMenu.armed ? '确认删除' : '删除' }}</button>
      <button
        type="button"
        class="control-quiet nx-context-item chapter-menu-rename"
        role="menuitem"
        data-test="chapter-menu-rename"
        @click="runChapterAction('rename')"
      >重命名</button>
      <button
        type="button"
        class="control-quiet nx-context-item chapter-menu-move-up"
        role="menuitem"
        data-test="chapter-menu-move-up"
        :disabled="!chapterCanMove(-1)"
        @click="runChapterAction('move-up')"
      >上移</button>
      <button
        type="button"
        class="control-quiet nx-context-item chapter-menu-move-down"
        role="menuitem"
        data-test="chapter-menu-move-down"
        :disabled="!chapterCanMove(1)"
        @click="runChapterAction('move-down')"
      >下移</button>
      <p v-if="chapterMenu.armed" class="nx-context-hint">删除后只能从历史里找回：再点「确认删除」。</p>
    </div>
  </aside>
</template>

<style scoped>
/* 行上下文动作（D2 → 工单H1）：每行右侧一枚极小的图标钮（14px 图标），
   不再用「历史…」文字占一行；tooltip 说明它的用途。行本体仍是老版 .workspace-nav-item 词汇。 */
.nx-tree-line {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.nx-tree-line > .nx-tree-item {
  flex: 1 1 auto;
  min-width: 0;
}
/* 行内改名（批次46A）：沿用批次33 临时输入的外观，只在章节行原位出现。 */
.nx-index-rename-input {
  flex: 1 1 auto;
  min-width: 0;
}
.nx-index-icon-btn {
  flex: none;
  width: 22px;
  height: 22px;
  min-height: 22px;
  padding: 0;
  justify-content: center;
  border-radius: var(--nx-radius-xs);
  color: var(--text-muted);
  opacity: 0.75;
}
.nx-index-icon-btn:hover,
.nx-index-icon-btn:focus-visible {
  color: var(--archive-ink);
  opacity: 1;
}
/* 区标题行右侧的「＋」（工单H1）：不占一行，点开才在区顶露出输入行。 */
.nx-index-section-head {
  position: relative;
}
.nx-index-section-head .workspace-nav-section {
  padding-inline-end: 30px;
}
.nx-index-add-toggle {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
}
.nx-index-new-inline {
  padding-top: 0;
}
/* 「悬浮」小钮（协议 v3）：收在索引窗标题行里，与收起钮同一条基准线。
   每一块声明了 overlay 槽的载体都出这枚——自带面板要在界面上有入口。 */
.nx-index-overlay-btn {
  min-height: 24px;
  padding: 0 8px;
  font-size: var(--nx-fs-2xs);
}
/* 区标题行右侧成组的小钮（批次31）：大纲那一行要放「悬浮」与「＋」两枚，
   所以它们是同一个绝对定位容器里的两枚静态钮（各自不再自己定位）。 */
.nx-index-section-actions {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
}
.nx-index-section-actions > * {
  position: static;
  transform: none;
}
.nx-index-section-head.is-outline .workspace-nav-section {
  padding-inline-end: 72px;
}
/* 世界书那一行有两枚钮（视图切换＋新建），标题给它们让够位置（批次34）。 */
.nx-index-section-head.is-entries .workspace-nav-section {
  padding-inline-end: 66px;
}
/* 大纲「＋」（P18 第 2 条：按需浮现）：默认不可见，hover／聚焦这一区才显形。
   opacity 只管看得见与否——命中区始终在，键盘也能到（focus-visible 直接显形）。
   批次33：五棵树的「新建＋」与行尾历史钮走同一套显形规则（同一枚区标题行、同一档动效）。
   批次46B：章节区标题行的「查找」「导入」同一档显形。 */
.nx-index-append-node,
.nx-index-add-toggle,
.nx-index-find-toggle,
.nx-index-import,
.nx-index-export {
  opacity: 0;
  transition: opacity 120ms ease;
}
.nx-index-section-head:hover .nx-index-append-node,
.nx-index-section-head:focus-within .nx-index-append-node,
.nx-index-append-node:focus-visible,
.nx-index-section-head:hover .nx-index-add-toggle,
.nx-index-section-head:focus-within .nx-index-add-toggle,
.nx-index-add-toggle:focus-visible,
.nx-index-section-head:hover .nx-index-find-toggle,
.nx-index-section-head:focus-within .nx-index-find-toggle,
.nx-index-find-toggle:focus-visible,
.nx-index-section-head:hover .nx-index-import,
.nx-index-section-head:focus-within .nx-index-import,
.nx-index-import:focus-visible,
.nx-index-section-head:hover .nx-index-export,
.nx-index-section-head:focus-within .nx-index-export,
.nx-index-export:focus-visible {
  opacity: 0.8;
}
.nx-index-section-head:hover .nx-index-find-toggle:hover,
.nx-index-section-head:hover .nx-index-import:hover,
.nx-index-section-head:hover .nx-index-export:hover {
  opacity: 1;
}
.nx-index-section-head:hover .nx-index-append-node:hover,
.nx-index-section-head:hover .nx-index-add-toggle:hover {
  opacity: 1;
}
/* 行尾历史钮（批次33 · 索引窗 IDE 化）：默认不占视觉，hover 这一行或键盘聚焦到它才显形。
   opacity 只管看得见与否——按钮始终在文档流里、始终可 Tab 到（无鼠标可达）。 */
.nx-index-history {
  opacity: 0;
  transition: opacity 120ms ease;
}
.nx-tree-line:hover .nx-index-history,
.nx-tree-line:focus-within .nx-index-history,
.nx-index-history:focus-visible {
  opacity: 0.85;
}
/* 降级动作偏好：显形不做淡入淡出，直接出现／消失。 */
@media (prefers-reduced-motion: reduce) {
  .nx-index-append-node,
  .nx-index-add-toggle,
  .nx-index-find-toggle,
  .nx-index-import,
  .nx-index-export,
  .nx-index-history {
    transition: none;
  }
}
/* 新建条目那一行＝名字输入＋类别下拉（批次34）：两者共用同一行，下拉不挤掉输入。 */
.nx-index-new-entry {
  display: flex;
  align-items: center;
  gap: 4px;
}
.nx-index-new-entry .nx-index-new-category {
  flex: 0 1 42%;
  min-width: 0;
}
/* 世界书视图切换（批次28 · 工单3）与条目表格样式（批次36）都搬去了核心区的看板区
   （EntriesBoard.vue）——图表列不再挤在这条窄栏里。 */

/* 章节区标题行右侧三枚钮（查找／导入／新建）：标题给它们让够位置（批次46B）。 */
.nx-index-section-head.is-chapters .workspace-nav-section {
  padding-inline-end: 104px;
}
/* 导出格式菜单（批次46B）：标题行下面右对齐的一枚小菜单，两项都是 quiet 行。 */
.nx-export-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 4px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 148px;
  padding: 4px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-raised);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--text-primary) 16%, transparent);
}
.nx-export-item {
  padding: 4px 8px;
  font-size: var(--nx-fs-2xs);
  color: var(--text-secondary);
  text-align: left;
}
.nx-export-item:hover { color: var(--archive-ink); background: var(--nav-hover); }
/* 全书查找（批次46B）：查找条与结果都收在章节栏里——窄栏里一行条、下面按章分组。
   结果行不画框（仍是行词汇），只有当前这一处带一层极淡的选中底。 */
.nx-find {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 6px 6px;
  border-bottom: 1px solid var(--hairline-soft);
}
.nx-find-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.nx-find-input {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  min-height: 28px;
  padding: 3px 6px;
  font-size: var(--nx-fs-2xs);
}
.nx-find-submit,
.nx-find-step,
.nx-find-close,
.nx-find-replace {
  flex: none;
  padding: 2px 6px;
  font-size: var(--nx-fs-2xs);
  color: var(--text-secondary);
}
.nx-find-submit:hover:not(:disabled),
.nx-find-step:hover:not(:disabled),
.nx-find-close:hover { color: var(--archive-ink); }
.nx-find-count {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.nx-find-hint {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  color: var(--text-muted);
}
.nx-find-results {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 46vh;
  overflow: auto;
}
.nx-find-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nx-find-group-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: var(--nx-fs-2xs);
  font-weight: 600;
  color: var(--text-secondary);
}
.nx-find-group-count {
  font-weight: 400;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.nx-find-hit {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  min-height: 0;
  padding: 3px 6px;
  border: 0;
  border-radius: var(--nx-radius-xs);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  text-align: left;
  cursor: pointer;
}
.nx-find-hit:hover {
  background: var(--nav-hover);
  color: var(--archive-ink);
}
.nx-find-hit.is-active {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--archive-ink);
}
.nx-find-hit-line {
  flex: none;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.nx-find-hit-snippet {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
