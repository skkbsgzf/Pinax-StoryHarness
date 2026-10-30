<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { vWorkbenchTooltip } from '../../src/components/workbench/workbenchTooltip.js'
import { outlineDepths as depthsOfOutline } from './outlineTree.mjs'
import { nextEntriesView, readEntriesView, writeEntriesView } from './entriesView.mjs'
import EntryGraph from './EntryGraph.vue'

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
  width: { type: Number, default: 256 },
  /** 当前项目根：只用来拼界面偏好的 localStorage 键（entriesView.<projectRoot>，照 paneForm 先例）。 */
  projectRoot: { type: String, default: '' }
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

/** 菜单里的一下：先收起菜单，再照旧走 useBoardData 的同一个动作（只改草稿，Ctrl+S 才落盘）。 */
function runNodeAction(action, payload) {
  closeNodeMenu()
  if (action === 'move') props.data.moveOutlineNode(payload)
  else if (action === 'remove') props.data.removeOutlineNode()
  else if (action === 'add') props.data.addOutlineNode(payload)
}

/** Esc 先关菜单；点菜单外也收起（捕获阶段，先于行自己的 click）。 */
function onNodeMenuKeydown(event) {
  if (!nodeMenu.value || event.key !== 'Escape') return
  event.preventDefault()
  closeNodeMenu()
}

function onNodeMenuPointerDown(event) {
  if (!nodeMenu.value) return
  if (nodeMenuRoot.value?.contains?.(event.target)) return
  closeNodeMenu()
}

onMounted(() => {
  globalThis.addEventListener?.('keydown', onNodeMenuKeydown, true)
  globalThis.addEventListener?.('pointerdown', onNodeMenuPointerDown, true)
})

onBeforeUnmount(() => {
  globalThis.removeEventListener?.('keydown', onNodeMenuKeydown, true)
  globalThis.removeEventListener?.('pointerdown', onNodeMenuPointerDown, true)
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
  return 'none'
})

/** 树所在的目录名：取板块认领的第一个目录（小说＝正文，大纲＝大纲，构思＝构思…）。 */
const treeDir = computed(() => props.board?.dataDirs?.[0] ?? props.board?.treePaneTitle ?? '目录')

const isChapterOpen = (item) => props.data.selection?.type === 'chapter' && props.data.selection.item?.file === item.file
const isEntryOpen = (item) => props.data.selection?.type === 'entry' && props.data.selection.item?.path === item.path
const isNoteOpen = (item) => props.data.selection?.type === 'note' && props.data.selection.item?.file === item.file
const isRuleOpen = (item) => props.data.selection?.type === 'rule' && props.data.selection.item?.file === item.file
const isDocumentOpen = (item) => props.data.selection?.type === 'document' && props.data.selection.item?.file === item.file
const isScriptOpen = (item) => props.data.selection?.type === 'script' && props.data.selection.item?.file === item.file

/** 卷→章两级（工单B）：useBoardData 组好组，这里只负责画；没有 groups 时退回平铺列表。 */
const chapterGroups = computed(() => {
  const groups = props.data.chapterGroups
  if (Array.isArray(groups) && groups.length) return groups
  return Array.isArray(props.data.chapters) && props.data.chapters.length ? [{ name: '', chapters: props.data.chapters }] : []
})

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
 * 世界书条目的列表/表格/图谱视图（批次28 · 工单3 → 批次36）：只这一栏有，别的栏不加。
 * 状态进 localStorage（`entriesView.<projectRoot>`，照 paneForm.<paneId> 的先例）——
 * 读写都收在 next/shell/entriesView.mjs 里，这里只把它接进一个 ref；
 * 键随项目根换（换项目＝各记各的），读失败按 list 起步，不把界面顶成空白。
 */
const entriesView = ref('list')

function toggleEntriesView() {
  entriesView.value = nextEntriesView(entriesView.value)
  writeEntriesView(props.projectRoot, entriesView.value)
}

/** 切换钮的文案跟着「下一步是哪个视图」走：list 显示「表」、table 显示「图」、graph 显示「列」。 */
const ENTRIES_VIEW_TOGGLE = {
  list: { label: '表', aria: '切换为表格视图', title: '表格视图' },
  table: { label: '图', aria: '切换为图谱视图', title: '图谱视图' },
  graph: { label: '列', aria: '切换为列表视图', title: '列表视图' }
}

/** 表格里的摘要列只占一格：截 40 字（截断只发生在显示上，磁盘与详情面仍是全文）。 */
const TABLE_SUMMARY_CHARS = 40
function clipTableSummary(value) {
  const text = String(value ?? '').trim()
  return text.length > TABLE_SUMMARY_CHARS ? `${text.slice(0, TABLE_SUMMARY_CHARS)}…` : text
}

/**
 * 世界书类别分组（批次34）：按 世界书/ 的一级子目录分组，组头用老版小节头词汇。
 * 组序以工具返回的 categories 为准（已是字典序）；声明外出现过的类别按出现序补在后；
 * 没有类别的条目归「未分类」并永远排最后——旧项目（没有子目录）只剩这一组，看上去与之前一样。
 * 批次36：表格视图的分组走同一只函数（Dataview 的组语义与列表一致），组内行再按当前排序摆。
 */
function groupEntriesByCat(entries) {
  const declared = Array.isArray(props.data.categories) ? props.data.categories : []
  // 没有类别目录的旧项目：不摆「未分类」这个头——列表与原样一致（兼容优先）。
  if (!declared.length) return entries.length ? [{ name: '', label: '', items: entries }] : []
  const order = [...declared]
  for (const entry of entries) {
    const cat = String(entry?.cat ?? '')
    if (cat && !order.includes(cat)) order.push(cat)
  }
  const groups = []
  for (const cat of order) {
    const items = entries.filter((entry) => String(entry?.cat ?? '') === cat)
    if (items.length) groups.push({ name: cat, label: cat, items })
  }
  const loose = entries.filter((entry) => !String(entry?.cat ?? ''))
  if (loose.length) groups.push({ name: '', label: '未分类', items: loose })
  return groups
}

const entryGroups = computed(() => groupEntriesByCat(props.data.entries ?? []))

/**
 * Dataview 式表格（批次36 · 任务一）：列头可排序（升→降→默认循环）、筛选行（文本包含匹配
 * 名称/关键词/摘要 ＋ 类别下拉）、按类别分组组头带条数。排序与筛选纯前端，数据源仍是
 * data.entries（不新增工具调用）。
 */
const ENTRY_COLUMNS = [
  { key: 'name', label: '名称' },
  { key: 'cat', label: '类别' },
  { key: 'type', label: '类型' },
  { key: 'keys', label: '关键词' },
  { key: 'chars', label: '字数' },
  { key: 'summary', label: '摘要' }
]

const entriesFilter = ref('')
const entriesFilterCat = ref('')
const entriesSort = ref(null)

function toggleEntriesSort(key) {
  const current = entriesSort.value
  if (!current || current.key !== key) {
    entriesSort.value = { key, dir: 'asc' }
    return
  }
  if (current.dir === 'asc') {
    entriesSort.value = { key, dir: 'desc' }
    return
  }
  entriesSort.value = null
}

function sortIndicator(key) {
  const current = entriesSort.value
  if (!current || current.key !== key) return ''
  return current.dir === 'asc' ? '▲' : '▼'
}

/** 类别下拉的选项：全部＋既有类别（与分组同一顺序——声明在前，出现序补后）。 */
const entryFilterOptions = computed(() => {
  const order = []
  for (const cat of Array.isArray(props.data.categories) ? props.data.categories : []) {
    if (cat && !order.includes(cat)) order.push(cat)
  }
  for (const entry of props.data.entries ?? []) {
    const cat = String(entry?.cat ?? '')
    if (cat && !order.includes(cat)) order.push(cat)
  }
  return order
})

const entryCollator = new Intl.Collator('zh-Hans-CN')

function entrySortValue(item, key) {
  if (key === 'chars') return Number(item?.chars ?? 0) || 0
  if (key === 'keys') return (Array.isArray(item?.aliases) ? item.aliases : []).join('、')
  if (key === 'cat') return String(item?.cat ?? '')
  if (key === 'type') return String(item?.type ?? '')
  if (key === 'summary') return String(item?.summary ?? '')
  return String(item?.name ?? '')
}

/** 筛选：类别精确匹配；文本对名称/关键词/摘要做不区分大小写的包含匹配。 */
const filteredEntries = computed(() => {
  const needle = entriesFilter.value.trim().toLowerCase()
  const cat = entriesFilterCat.value
  return (props.data.entries ?? []).filter((item) => {
    if (cat && String(item?.cat ?? '') !== cat) return false
    if (!needle) return true
    const haystack = [
      String(item?.name ?? ''),
      (Array.isArray(item?.aliases) ? item.aliases : []).join('、'),
      String(item?.summary ?? '')
    ].join('\n').toLowerCase()
    return haystack.includes(needle)
  })
})

/** 组内排序（组头顺序不动——Dataview 的分组是第一维，排序是组内第二维）。 */
function sortEntries(items) {
  const sort = entriesSort.value
  if (!sort) return items
  const dir = sort.dir === 'desc' ? -1 : 1
  return [...items].sort((a, b) => {
    const left = entrySortValue(a, sort.key)
    const right = entrySortValue(b, sort.key)
    if (sort.key === 'chars') return (left - right) * dir
    return entryCollator.compare(String(left), String(right)) * dir
  })
}

const tableGroups = computed(() => groupEntriesByCat(filteredEntries.value)
  .map((group) => ({ ...group, items: sortEntries(group.items) })))

/** 换项目＝换树也换视图记忆；筛选与排序是会话内的临时状态，一并清零。 */
watch(() => props.projectRoot, () => {
  entriesView.value = readEntriesView(props.projectRoot)
  entriesFilter.value = ''
  entriesFilterCat.value = ''
  entriesSort.value = null
}, { immediate: true })

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
  else if (draft.kind === 'notes') await props.data.createNote(title)
  else if (draft.kind === 'rules') await props.data.createRule(title)
  else if (draft.kind === 'entries') await props.data.createEntry(title, draft.category ?? '')
}

// 换板＝换树：目录窗自己负责把这一板的东西列出来（核心区不替它列），且只列本载体那一棵。
// 协议 v1.1-A：小说板不再顺手取大纲／构思／世界书——那些是别的栏的树。
watch(() => props.board?.id, () => {
  closeNewItem()
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
  }
}, { immediate: true })
</script>

<template>
  <aside id="nx-index-window" class="workspace-sidebar nx-index-window" :style="{ width: width + 'px' }" aria-label="索引窗">
    <header class="nx-index-head">
      <span class="workspace-nav-section">{{ board?.title ?? '索引' }}</span>
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
        <div class="nx-index-section-head">
          <p class="workspace-nav-section">{{ treeDir }}</p>
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
        <!-- 卷→章（工单B）：有子目录时先出卷标题（不可点），卷下是章行；平铺时只有一个无名组。 -->
        <template v-for="(group, groupIndex) in chapterGroups" :key="group.name || `flat-${groupIndex}`">
          <p v-if="group.name" class="workspace-nav-section nx-volume" data-test="chapter-volume">{{ group.name }}</p>
          <ul class="nx-tree">
            <li v-for="item in group.chapters" :key="item.file" class="nx-tree-line">
              <button
                type="button"
                class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
                :class="{ 'is-active': isChapterOpen(item) }"
                :aria-current="isChapterOpen(item) ? 'page' : null"
                :title="rowHint(item)"
                @click="data.openChapter(item)"
                @contextmenu.prevent.stop="onRowContextMenu"
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
        <!-- 工单C（协议 v1.1-C）：载体声明了 overlay pane 才出这枚「悬浮」钮——
             点它由外壳打开 FloatingWidget 的大纲悬浮窗（正文写作时不必切回这一栏）。
             批次31（P18）：区标题行右侧另有一枚 hover 才显形的「＋」——在末尾追一个同级节点；
             大纲编辑面底部那排节点操作按钮拆掉后，新建入口只剩这里（带 tooltip 说明）。 -->
        <div class="nx-index-section-head is-outline">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <span class="nx-index-section-actions">
            <button
              v-if="board?.overlayPane"
              type="button"
              class="control-quiet nx-index-overlay-toggle"
              aria-label="悬浮大纲"
              @click="emit('overlay', board.overlayPane.id)"
            >悬浮</button>
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

      <!-- 世界书（协议 v1.1-A：独立一栏，条目树）。未建档的条目在行尾标出来。
           批次28 · 工单3：区标题行右侧一枚视图切换——状态按项目根落 localStorage；
           批次36 起：列表／表格／图谱三态循环（切换钮显示「下一步」），三态点行都是
           同一个 openEntry（不新增工具调用）。
           批次34：列表按类别分组（世界书/ 的一级子目录），表格有「类别」列，
           新建（区头 ＋）的临时行带一枚类别下拉——选中的类别决定这一条落在哪个子目录。 -->
      <template v-else-if="treeKind === 'entries'">
        <div class="nx-index-section-head is-entries">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <span class="nx-index-section-actions">
            <button
              type="button"
              class="control-quiet nx-index-view-toggle"
              data-test="entries-view-toggle"
              :aria-label="ENTRIES_VIEW_TOGGLE[entriesView].aria"
              :aria-pressed="(entriesView !== 'list').toString()"
              v-workbench-tooltip="{ text: ENTRIES_VIEW_TOGGLE[entriesView].title, side: 'left' }"
              @click="toggleEntriesView"
            >{{ ENTRIES_VIEW_TOGGLE[entriesView].label }}</button>
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
        <!-- Dataview 式表格（批次36 · 任务一）：筛选行（文本＋类别）＋可排序列头＋按类别分组
             （组头带条数，与列表视图同一组语义）。排序与筛选纯前端，数据源仍是 data.entries。 -->
        <div v-if="entriesView === 'table' && data.entries.length" class="nx-entries-tools" data-test="entries-tools">
          <input
            v-model="entriesFilter"
            class="nx-field nx-entries-filter"
            data-test="entries-filter-input"
            placeholder="筛选：名称／关键词／摘要"
            aria-label="筛选条目"
          >
          <select
            v-model="entriesFilterCat"
            class="nx-field nx-entries-cat-filter"
            data-test="entries-filter-category"
            aria-label="按类别筛选"
          >
            <option value="">全部类别</option>
            <option v-for="cat in entryFilterOptions" :key="cat" :value="cat">{{ cat }}</option>
          </select>
        </div>
        <table v-if="entriesView === 'table' && data.entries.length" class="nx-entries-table" data-test="entries-table">
          <thead>
            <tr>
              <th v-for="column in ENTRY_COLUMNS" :key="column.key" scope="col">
                <button
                  type="button"
                  class="control-quiet nx-entries-sort"
                  :data-test="`entries-sort-${column.key}`"
                  :aria-label="`按${column.label}排序`"
                  @click="toggleEntriesSort(column.key)"
                >{{ column.label }}<span v-if="sortIndicator(column.key)" class="nx-entries-sort-mark" aria-hidden="true">{{ sortIndicator(column.key) }}</span></button>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="group in tableGroups" :key="group.name || '__uncategorized'">
              <tr v-if="group.label" class="nx-entries-group-row" data-test="entries-table-group">
                <td colspan="6">{{ group.label }}<span class="nx-entries-group-count"> · {{ group.items.length }} 条</span></td>
              </tr>
              <tr
                v-for="item in group.items"
                :key="item.path"
                class="nx-entries-row"
                :class="{ 'is-active': isEntryOpen(item) }"
                :aria-current="isEntryOpen(item) ? 'page' : null"
                tabindex="0"
                @click="data.openEntry(item)"
                @keydown.enter.prevent="data.openEntry(item)"
                @contextmenu.prevent.stop="onRowContextMenu"
              >
                <td class="nx-entries-name">{{ item.name }}</td>
                <td class="nx-entries-cat">{{ item.cat || '—' }}</td>
                <td>{{ item.type }}</td>
                <td class="nx-entries-keys">{{ (item.aliases ?? []).join('、') }}</td>
                <td class="nx-entries-chars">{{ item.chars }}</td>
                <td class="nx-entries-summary">{{ clipTableSummary(item.summary) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
        <!-- 知识图谱（批次36 · 任务二）：节点＝条目，边＝relations[].to；点节点打开条目，
             与列表／表格同一个 openEntry（EntryGraph.vue，坐标计算在 entriesView.mjs 纯函数里）。 -->
        <EntryGraph
          v-else-if="entriesView === 'graph' && data.entries.length"
          :entries="data.entries"
          @open="data.openEntry"
        />
        <template v-else>
          <template v-for="group in entryGroups" :key="group.name || '__uncategorized'">
            <p v-if="group.label" class="workspace-nav-section nx-entry-category" data-test="entry-category">{{ group.label }}</p>
            <ul class="nx-tree">
              <li v-for="item in group.items" :key="item.path" class="nx-tree-line">
                <button
                  type="button"
                  class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
                  :class="{ 'is-active': isEntryOpen(item) }"
                  :aria-current="isEntryOpen(item) ? 'page' : null"
                  :title="rowHint(item)"
                  @click="data.openEntry(item)"
                  @contextmenu.prevent.stop="onRowContextMenu"
                >
                  <span class="workspace-nav-label">{{ item.name }}</span>
                </button>
                <button
                  type="button"
                  class="nx-row nx-index-icon-btn nx-index-history"
                  :aria-label="`「${item.name}」的历史`"
                  v-workbench-tooltip="{ text: '历史', side: 'left' }"
                  @click.stop="emit('history', { type: 'entry', item })"
                >
                  <WorkbenchIcon name="history" :size="14" />
                </button>
              </li>
            </ul>
          </template>
        </template>
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
/* 「悬浮」小钮（工单C）：收在区标题行右侧，与「＋」同一条基准线；命中区压到行高内，不另起一行。 */
.nx-index-overlay-toggle {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  min-height: 24px;
  padding: 0 6px;
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
   批次33：五棵树的「新建＋」与行尾历史钮走同一套显形规则（同一枚区标题行、同一档动效）。 */
.nx-index-append-node,
.nx-index-add-toggle {
  opacity: 0;
  transition: opacity 120ms ease;
}
.nx-index-section-head:hover .nx-index-append-node,
.nx-index-section-head:focus-within .nx-index-append-node,
.nx-index-append-node:focus-visible,
.nx-index-section-head:hover .nx-index-add-toggle,
.nx-index-section-head:focus-within .nx-index-add-toggle,
.nx-index-add-toggle:focus-visible {
  opacity: 0.8;
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
/* 类别小节头（批次34）：组与组之间留一点呼吸，第一组紧贴区标题。 */
.nx-tree + .nx-entry-category {
  margin-top: 6px;
}
/* 世界书视图切换（批次28 · 工单3）：区标题行右侧一枚小钮，与「＋」「悬浮」同一条基准线；
   文案是「表」（切到表格）／「列」（切回列表），命中区压到行高内，不另起一行。 */
.nx-index-view-toggle {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  min-height: 24px;
  padding: 0 6px;
  font-size: var(--nx-fs-2xs);
}
/* 世界书那一行改成一组成组钮之后（批次34），视图切换与「＋」并排——
   它不再自己定位，位置交给 .nx-index-section-actions。 */
.nx-index-section-actions > .nx-index-view-toggle {
  position: static;
  transform: none;
}
/* 条目表格：列宽按内容伸缩，摘要列吃掉剩余宽度；行仍是「点一下打开条目」那件事。 */
.nx-entries-table {
  width: 100%;
  margin: 0 0 8px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--nx-fs-2xs);
  color: var(--text-primary);
}
.nx-entries-table th {
  padding: 2px 4px;
  text-align: start;
  font-weight: 500;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  border-bottom: 1px solid var(--hairline-soft);
  white-space: nowrap;
}
.nx-entries-table td {
  padding: 3px 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--hairline-soft);
}
/* 列宽（批次34：加了一列「类别」）：名称与关键词各让出一截，摘要仍吃剩余宽度。 */
.nx-entries-table th:nth-child(1) { width: 22%; }
.nx-entries-table th:nth-child(2) { width: 14%; }
.nx-entries-table th:nth-child(3) { width: 12%; }
.nx-entries-table th:nth-child(4) { width: 16%; }
.nx-entries-table th:nth-child(5) { width: 9%; }
.nx-entries-row {
  cursor: pointer;
}
.nx-entries-row:hover td {
  background: var(--nav-hover);
}
.nx-entries-row.is-active td {
  background: var(--nav-selected);
}
.nx-entries-row:focus-visible {
  outline: 2px solid var(--workbench-selected);
  outline-offset: -2px;
}
.nx-entries-name {
  color: var(--archive-ink);
}
.nx-entries-chars {
  font-variant-numeric: tabular-nums;
}
.nx-entries-summary,
.nx-entries-keys {
  color: var(--text-muted);
}
/* —— Dataview 式表格（批次36）：筛选行／可排序列头／分组组头 ——————————————
   筛选行：文本输入吃剩余宽度，类别下拉占一小截，与新建临时行同一档紧凑度量。
   列头是共享词汇里的 control-quiet（门禁要求），这里把它的命中区压回表头尺寸。 */
.nx-entries-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 6px;
}
.nx-entries-tools .nx-field {
  min-height: 28px;
  padding: 4px 8px;
  font-size: var(--nx-fs-2xs);
}
.nx-entries-filter {
  flex: 1 1 auto;
  min-width: 0;
}
.nx-entries-cat-filter {
  flex: 0 1 42%;
  min-width: 0;
}
.nx-entries-table th {
  padding: 2px 2px;
}
.nx-entries-table th .nx-entries-sort {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 2px;
  width: 100%;
  min-height: 20px;
  padding: 0;
  font-size: var(--nx-fs-2xs);
  font-weight: 500;
  color: var(--text-muted);
  text-align: start;
  white-space: nowrap;
}
.nx-entries-table th .nx-entries-sort:hover {
  background: transparent;
  color: var(--archive-ink);
}
.nx-entries-sort-mark {
  flex: none;
  font-size: var(--nx-fs-2xs);
  line-height: 1;
}
/* 组头行：与列表视图的小节头同一语义，样式走表格自己的度量（数字对齐交给 tabular-nums）。 */
.nx-entries-group-row td {
  padding: 6px 4px 2px;
  border-bottom: 1px solid var(--hairline-soft);
  font-size: var(--nx-fs-2xs);
  font-weight: 500;
  color: var(--archive-ink-soft);
  white-space: nowrap;
}
.nx-entries-group-count {
  color: var(--text-muted);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}</style>
