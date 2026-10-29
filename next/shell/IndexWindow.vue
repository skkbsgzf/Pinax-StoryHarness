<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { vWorkbenchTooltip } from '../../src/components/workbench/workbenchTooltip.js'
import { outlineDepths as depthsOfOutline } from './outlineTree.mjs'
import { nextEntriesView, readEntriesView, writeEntriesView } from './entriesView.mjs'

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

const newTitle = ref('')

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

/** 章节序号：工具给的全局 index（拆分前就是它）；缺 index 时退回组内位置，不让行文空着。 */
const chapterNumber = (item, localIndex) => (Number.isSafeInteger(item?.index) ? item.index + 1 : localIndex + 1)

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
 * 世界书条目的列表/表格视图（批次28 · 工单3）：只这一栏有，别的栏不加。
 * 状态进 localStorage（`entriesView.<projectRoot>`，照 paneForm.<paneId> 的先例）——
 * 读写都收在 next/shell/entriesView.mjs 里，这里只把它接进一个 ref；
 * 键随项目根换（换项目＝各记各的），读失败按 list 起步，不把界面顶成空白。
 */
const entriesView = ref('list')

function toggleEntriesView() {
  entriesView.value = nextEntriesView(entriesView.value)
  writeEntriesView(props.projectRoot, entriesView.value)
}

watch(() => props.projectRoot, () => {
  entriesView.value = readEntriesView(props.projectRoot)
}, { immediate: true })

/** 表格里的摘要列只占一格：截 40 字（截断只发生在显示上，磁盘与详情面仍是全文）。 */
const TABLE_SUMMARY_CHARS = 40
function clipTableSummary(value) {
  const text = String(value ?? '').trim()
  return text.length > TABLE_SUMMARY_CHARS ? `${text.slice(0, TABLE_SUMMARY_CHARS)}…` : text
}

async function createChapter() {
  const title = newTitle.value.trim()
  if (!title) return
  newTitle.value = ''
  await props.data.createChapter(title)
}

async function createDocument() {
  const title = newTitle.value.trim()
  if (!title) return
  newTitle.value = ''
  await props.data.createDocument(title)
}

/** 剧本（批次26）：与资料同一个新建形态——标题行＋新建钮。 */
async function createScript() {
  const title = newTitle.value.trim()
  if (!title) return
  newTitle.value = ''
  await props.data.createScript(title)
}

/**
 * 构思／约束的新建入口（工单H1）：面板尾部那行常驻输入收进对应区标题行右侧的「＋」。
 * 点开才在区顶出现输入行（照「新章标题」的 .nx-index-new 形态）：失焦／Enter 提交，Esc 收起。
 * 还没有条目时也能新建——入口常驻在区标题上，不靠空态里的按钮。
 */
const newNoteOpen = ref(false)
const newNoteTitle = ref('')
const newNoteInput = ref(null)
const newRuleOpen = ref(false)
const newRuleTitle = ref('')
const newRuleInput = ref(null)

async function toggleNewNote() {
  if (newNoteOpen.value) {
    // 输入行开着时再点「＋」＝提交（mousedown.prevent 挡住 blur，避免先提交再重开）。
    await submitNewNote()
    return
  }
  newNoteOpen.value = true
  newNoteTitle.value = ''
  await nextTick()
  newNoteInput.value?.focus()
}

function closeNewNote() {
  newNoteOpen.value = false
  newNoteTitle.value = ''
}

async function submitNewNote() {
  const title = newNoteTitle.value.trim()
  closeNewNote()
  if (!title) return
  await props.data.createNote(title)
}

async function toggleNewRule() {
  if (newRuleOpen.value) {
    // 输入行开着时再点「＋」＝提交（mousedown.prevent 挡住 blur，避免先提交再重开）。
    await submitNewRule()
    return
  }
  newRuleOpen.value = true
  newRuleTitle.value = ''
  await nextTick()
  newRuleInput.value?.focus()
}

function closeNewRule() {
  newRuleOpen.value = false
  newRuleTitle.value = ''
}

async function submitNewRule() {
  const title = newRuleTitle.value.trim()
  closeNewRule()
  if (!title) return
  await props.data.createRule(title)
}

// 换板＝换树：目录窗自己负责把这一板的东西列出来（核心区不替它列），且只列本载体那一棵。
// 协议 v1.1-A：小说板不再顺手取大纲／构思／世界书——那些是别的栏的树。
watch(() => props.board?.id, () => {
  newTitle.value = ''
  closeNewNote()
  closeNewRule()
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
        <div class="nx-index-new">
          <input v-model="newTitle" class="nx-field is-tiny" placeholder="新章标题" @keydown.enter.prevent="createChapter">
          <button type="button" class="control-quiet nx-index-add" :disabled="data.busy || !newTitle.trim()" @click="createChapter">新建</button>
        </div>
        <p class="workspace-nav-section">{{ treeDir }}</p>
        <!-- 卷→章（工单B）：有子目录时先出卷标题（不可点），卷下是章行；平铺时只有一个无名组。 -->
        <template v-for="(group, groupIndex) in chapterGroups" :key="group.name || `flat-${groupIndex}`">
          <p v-if="group.name" class="workspace-nav-section nx-volume" data-test="chapter-volume">{{ group.name }}</p>
          <ul class="nx-tree">
            <li v-for="(item, localIndex) in group.chapters" :key="item.file" class="nx-tree-line">
              <button
                type="button"
                class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
                :class="{ 'is-active': isChapterOpen(item) }"
                :aria-current="isChapterOpen(item) ? 'page' : null"
                @click="data.openChapter(item)"
                @contextmenu.prevent.stop="onRowContextMenu"
              >
                <span class="workspace-nav-label">{{ chapterNumber(item, localIndex) }}. {{ item.title }}</span>
                <span class="workspace-nav-meta">第 {{ item.revision }} 版</span>
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
              <span class="workspace-nav-label">{{ index + 1 }}. {{ node.title }}</span>
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
           新建（工单H1）：入口是区标题右侧的「＋」，点开才在区顶出现输入行（失焦／Enter 提交，Esc 收起）。 -->
      <template v-else-if="treeKind === 'notes'">
        <div class="nx-index-section-head">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <button
            type="button"
            class="nx-row nx-index-icon-btn nx-index-add-toggle"
            aria-label="新建构思"
            :aria-expanded="newNoteOpen.toString()"
            v-workbench-tooltip="{ text: '新建构思', side: 'left' }"
            @mousedown.prevent
            @click="toggleNewNote"
          >
            <WorkbenchIcon name="plus" :size="14" />
          </button>
        </div>
        <div v-if="newNoteOpen" class="nx-index-new nx-index-new-inline">
          <input
            ref="newNoteInput"
            v-model="newNoteTitle"
            class="nx-field is-tiny"
            placeholder="新构思标题"
            aria-label="新构思标题"
            @keydown.enter.prevent="submitNewNote"
            @keydown.esc.prevent="closeNewNote"
            @blur="submitNewNote"
          >
        </div>
        <ul class="nx-tree">
          <li v-for="item in data.notes" :key="item.file" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isNoteOpen(item) }"
              :aria-current="isNoteOpen(item) ? 'page' : null"
              @click="data.openNote(item)"
              @contextmenu.prevent.stop="onRowContextMenu"
            >
              <span class="workspace-nav-label">{{ item.title }}</span>
              <span class="workspace-nav-meta">第 {{ item.revision }} 版</span>
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
           批次28 · 工单3：区标题行右侧一枚「表／列」切换——表格视图只影响这一栏，
           状态按项目根落 localStorage；两种视图点行都是同一个 openEntry（不新增工具调用）。 -->
      <template v-else-if="treeKind === 'entries'">
        <div class="nx-index-section-head">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <button
            type="button"
            class="control-quiet nx-index-view-toggle"
            data-test="entries-view-toggle"
            :aria-label="entriesView === 'table' ? '切换为列表视图' : '切换为表格视图'"
            :aria-pressed="entriesView === 'table' ? 'true' : 'false'"
            v-workbench-tooltip="{ text: entriesView === 'table' ? '列表视图' : '表格视图', side: 'left' }"
            @click="toggleEntriesView"
          >{{ entriesView === 'table' ? '列' : '表' }}</button>
        </div>
        <table v-if="entriesView === 'table' && data.entries.length" class="nx-entries-table" data-test="entries-table">
          <thead>
            <tr>
              <th scope="col">名称</th>
              <th scope="col">类型</th>
              <th scope="col">关键词</th>
              <th scope="col">字数</th>
              <th scope="col">摘要</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in data.entries"
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
              <td>{{ item.type }}</td>
              <td class="nx-entries-keys">{{ (item.aliases ?? []).join('、') }}</td>
              <td class="nx-entries-chars">{{ item.chars }}</td>
              <td class="nx-entries-summary">{{ clipTableSummary(item.summary) }}</td>
            </tr>
          </tbody>
        </table>
        <ul v-else class="nx-tree">
          <li v-for="item in data.entries" :key="item.path" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isEntryOpen(item) }"
              :aria-current="isEntryOpen(item) ? 'page' : null"
              @click="data.openEntry(item)"
              @contextmenu.prevent.stop="onRowContextMenu"
            >
              <span class="workspace-nav-label">{{ item.name }}</span>
              <span class="workspace-nav-meta">{{ item.chars }} 字<template v-if="item.contract === false"> · 未建档</template></span>
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
        <p v-if="!data.entries.length && !data.treeError" class="nx-index-empty">这一栏还没有条目。</p>
      </template>

      <!-- 约束（协议 v1.1-A：设定栏只剩这一棵内容树；世界书已独立成栏）。
           行可点开——正文随 pinax_rule_list 一起回来，点击只换核心区的面板，不再发第二次读；
           新建（工单H1）：与构思同一形态——区标题右侧「＋」，点开才出现输入行。 -->
      <template v-else-if="treeKind === 'rules'">
        <div class="nx-index-section-head">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <button
            type="button"
            class="nx-row nx-index-icon-btn nx-index-add-toggle"
            aria-label="新建约束"
            :aria-expanded="newRuleOpen.toString()"
            v-workbench-tooltip="{ text: '新建约束', side: 'left' }"
            @mousedown.prevent
            @click="toggleNewRule"
          >
            <WorkbenchIcon name="plus" :size="14" />
          </button>
        </div>
        <div v-if="newRuleOpen" class="nx-index-new nx-index-new-inline">
          <input
            ref="newRuleInput"
            v-model="newRuleTitle"
            class="nx-field is-tiny"
            placeholder="新约束标题"
            aria-label="新约束标题"
            @keydown.enter.prevent="submitNewRule"
            @keydown.esc.prevent="closeNewRule"
            @blur="submitNewRule"
          >
        </div>
        <ul class="nx-tree">
          <li v-for="item in data.rules" :key="item.file" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isRuleOpen(item) }"
              :aria-current="isRuleOpen(item) ? 'page' : null"
              @click="data.openRule(item)"
              @contextmenu.prevent.stop="onRowContextMenu"
            >
              <span class="workspace-nav-label">{{ item.title }}</span>
              <span class="workspace-nav-meta">第 {{ item.revision }} 版</span>
            </button>
          </li>
        </ul>
        <p v-if="!data.rules.length && !data.rulesError" class="nx-index-empty">约束还没有内容（约束/）。</p>
        <p v-if="data.rulesError" class="nx-index-error">{{ data.rulesError }}</p>
      </template>

      <!-- 资料（工单G1）：资料板的树。行可点开——点行进中栏的阅读面（编辑在那里按）；
           行文＝篇名＋字数＋版本号；目录还没写就给一行说明，不当成错误。
           这里不摆「历史…」：资料的历史还没接（工单边界），给一个点了没东西的按钮更糟。 -->
      <template v-else-if="treeKind === 'documents'">
        <div class="nx-index-new">
          <input v-model="newTitle" class="nx-field is-tiny" placeholder="新资料标题" @keydown.enter.prevent="createDocument">
          <button type="button" class="control-quiet nx-index-add" :disabled="data.busy || !newTitle.trim()" @click="createDocument">新建</button>
        </div>
        <p class="workspace-nav-section">{{ treeDir }}</p>
        <ul class="nx-tree">
          <li v-for="item in data.documents" :key="item.file" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isDocumentOpen(item) }"
              :aria-current="isDocumentOpen(item) ? 'page' : null"
              @click="data.openDocument(item)"
              @contextmenu.prevent.stop="onRowContextMenu"
            >
              <span class="workspace-nav-label">{{ item.title }}</span>
              <span class="workspace-nav-meta">{{ item.totalChars }} 字 · 第 {{ item.revision }} 版</span>
            </button>
          </li>
        </ul>
        <p v-if="!data.documents.length && !data.documentsError" class="nx-index-empty">资料还没有内容（资料/）。</p>
        <p v-if="data.documentsError" class="nx-index-error">{{ data.documentsError }}</p>
      </template>

      <!-- 剧本（批次26 · M6 提前）：剧本板的树。行可点开——点行进中栏的阅读面（编辑在那里按）；
           行文＝篇名＋字数＋版本号；目录还没写就给一行说明，不当成错误。
           与资料同一口径：这里不摆「历史…」（剧本的历史还没接，给一个点了没东西的按钮更糟）。 -->
      <template v-else-if="treeKind === 'scripts'">
        <div class="nx-index-new">
          <input v-model="newTitle" class="nx-field is-tiny" placeholder="新剧本标题" aria-label="新剧本标题" @keydown.enter.prevent="createScript">
          <button type="button" class="control-quiet nx-index-add" :disabled="data.busy || !newTitle.trim()" @click="createScript">新建</button>
        </div>
        <p class="workspace-nav-section">{{ treeDir }}</p>
        <ul class="nx-tree">
          <li v-for="item in data.scripts" :key="item.file" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isScriptOpen(item) }"
              :aria-current="isScriptOpen(item) ? 'page' : null"
              @click="data.openScript(item)"
              @contextmenu.prevent.stop="onRowContextMenu"
            >
              <span class="workspace-nav-label">{{ item.title }}</span>
              <span class="workspace-nav-meta">{{ item.totalChars }} 字 · 第 {{ item.revision }} 版</span>
            </button>
          </li>
        </ul>
        <p v-if="!data.scripts.length && !data.scriptsError" class="nx-index-empty">剧本还没有内容（剧本/）。</p>
        <p v-if="data.scriptsError" class="nx-index-error">{{ data.scriptsError }}</p>
      </template>

      <ul v-if="data.listWarnings.length" class="nx-index-warn">
        <li v-for="(warning, index) in data.listWarnings" :key="`l-${index}`">{{ warning }}</li>
      </ul>

      <template v-if="archive.length">
        <p class="workspace-nav-section">只读归档</p>
        <ul class="nx-tree">
          <li v-for="item in archive" :key="item.dir">
            <span class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-static is-static" :title="item.reason">
              <span class="workspace-nav-label">{{ item.dir }}</span>
              <span class="workspace-nav-meta">{{ item.files }} 项</span>
            </span>
          </li>
        </ul>
      </template>
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
/* 大纲「＋」（P18 第 2 条：按需浮现）：默认不可见，hover／聚焦这一区才显形。
   opacity 只管看得见与否——命中区始终在，键盘也能到（focus-visible 直接显形）。 */
.nx-index-append-node {
  opacity: 0;
  transition: opacity 120ms ease;
}
.nx-index-section-head:hover .nx-index-append-node,
.nx-index-section-head:focus-within .nx-index-append-node,
.nx-index-append-node:focus-visible {
  opacity: 0.8;
}
.nx-index-section-head:hover .nx-index-append-node:hover {
  opacity: 1;
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
.nx-entries-table th:nth-child(1) { width: 26%; }
.nx-entries-table th:nth-child(2) { width: 14%; }
.nx-entries-table th:nth-child(3) { width: 18%; }
.nx-entries-table th:nth-child(4) { width: 10%; }
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
}</style>
