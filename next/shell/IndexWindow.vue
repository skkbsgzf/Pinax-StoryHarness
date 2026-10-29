<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { vWorkbenchTooltip } from '../../src/components/workbench/workbenchTooltip.js'

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
  width: { type: Number, default: 256 }
})
const emit = defineEmits(['collapse', 'history', 'overlay'])

const newTitle = ref('')

/** 树的口径由板块声明的目录窗 pane 前缀决定（协议 v1.1-A：一载体一棵本域内容树）。 */
const treeKind = computed(() => {
  const paneId = String(props.board?.treePaneId ?? '')
  if (paneId.startsWith('novel.')) return 'chapters'
  if (paneId.startsWith('outline.')) return 'outline'
  if (paneId.startsWith('notes.')) return 'notes'
  if (paneId.startsWith('worldbook.')) return 'entries'
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

/** 章节序号：工具给的全局 index（拆分前就是它）；缺 index 时退回组内位置，不让行文空着。 */
const chapterNumber = (item, localIndex) => (Number.isSafeInteger(item?.index) ? item.index + 1 : localIndex + 1)

/** 卷→章两级（工单B）：useBoardData 组好组，这里只负责画；没有 groups 时退回平铺列表。 */
const chapterGroups = computed(() => {
  const groups = props.data.chapterGroups
  if (Array.isArray(groups) && groups.length) return groups
  return Array.isArray(props.data.chapters) && props.data.chapters.length ? [{ name: '', chapters: props.data.chapters }] : []
})

/**
 * 哪些大纲行有子节点：只看 edges，两种字段名都认（{from,to} / {source,target}）；
 * 端点缺失或指向不存在的节点的连线不算——不拿断链给行头加记号。
 * depth（缩进层级）由 useBoardData 的 loadOutline／saveOutline 贴上，这里只负责画。
 */
const outlineParentIds = computed(() => {
  const nodes = props.data.outline ?? []
  const known = new Set()
  for (const node of nodes) {
    if (typeof node?.id === 'string' && node.id.trim()) known.add(node.id)
  }
  const parents = new Set()
  for (const edge of props.data.outlineEdges ?? []) {
    const from = edge?.from ?? edge?.source
    const to = edge?.to ?? edge?.target
    if (typeof from !== 'string' || typeof to !== 'string') continue
    if (!known.has(from) || !known.has(to) || from === to) continue
    parents.add(from)
  }
  return parents
})
const hasOutlineChildren = (node) => typeof node?.id === 'string' && outlineParentIds.value.has(node.id)
const isOutlineNodeOpen = (index) => props.data.selection?.type === 'outline-node' && props.data.selection.item?.index === index

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
           行可点选——点行把节点送进中栏的大纲编辑面（改名/加节点在那里）；
           depth 由 edges 现算（断链/无 edges 全是一级），行头「·」只标有子节点的行。
           大纲还没写就给一行说明＋「新建大纲」，不当成错误。 -->
      <template v-else-if="treeKind === 'outline'">
        <!-- 工单C（协议 v1.1-C）：载体声明了 overlay pane 才出这枚「悬浮」钮——
             点它由外壳打开 FloatingWidget 的大纲悬浮窗（正文写作时不必切回这一栏）。 -->
        <div class="nx-index-section-head">
          <p class="workspace-nav-section">{{ treeDir }}</p>
          <button
            v-if="board?.overlayPane"
            type="button"
            class="control-quiet nx-index-overlay-toggle"
            aria-label="悬浮大纲"
            @click="emit('overlay', board.overlayPane.id)"
          >悬浮</button>
        </div>
        <ul class="nx-tree">
          <li v-for="(node, index) in data.outline" :key="node.id ?? `outline-${index}`" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isOutlineNodeOpen(index) }"
              :aria-current="isOutlineNodeOpen(index) ? 'page' : null"
              :style="{ paddingInlineStart: (10 + (node.depth ?? 0) * 14) + 'px' }"
              @click="data.selectOutlineNode(index)"
            >
              <span class="workspace-nav-label"><span v-if="hasOutlineChildren(node)" class="nx-outline-mark" aria-hidden="true">·</span>{{ index + 1 }}. {{ node.title }}</span>
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

      <!-- 世界书（协议 v1.1-A：独立一栏，条目树）。未建档的条目在行尾标出来。 -->
      <template v-else-if="treeKind === 'entries'">
        <p class="workspace-nav-section">{{ treeDir }}</p>
        <ul class="nx-tree">
          <li v-for="item in data.entries" :key="item.path" class="nx-tree-line">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isEntryOpen(item) }"
              :aria-current="isEntryOpen(item) ? 'page' : null"
              @click="data.openEntry(item)"
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
            >
              <span class="workspace-nav-label">{{ item.title }}</span>
              <span class="workspace-nav-meta">{{ item.totalChars }} 字 · 第 {{ item.revision }} 版</span>
            </button>
          </li>
        </ul>
        <p v-if="!data.documents.length && !data.documentsError" class="nx-index-empty">资料还没有内容（资料/）。</p>
        <p v-if="data.documentsError" class="nx-index-error">{{ data.documentsError }}</p>
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
/* 大纲层级记号（工单G3）：有子节点的行在标题前点一枚极轻的「·」，不引新图标、不另立一套行形态。 */
.nx-outline-mark {
  margin-inline-end: 4px;
  color: var(--text-muted);
  font-size: var(--nx-fs-2xs);
}
</style>
