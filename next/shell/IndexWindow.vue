<script setup>
import { computed, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { vWorkbenchTooltip } from '../../src/components/workbench/workbenchTooltip.js'

/**
 * 索引窗：竖条右边那一栏——会话管理／文件结构管理那件事就落在这里。
 *
 * 行用老前端的 .workspace-nav-item 词汇（src/styles/workspace-navigation.css:21-75）：
 * 行高、悬停、选中色、焦点环全部是原件那份 CSS，Next 不另配一套。
 * 宽度沿用老版目录窗的口径（200–360px，见 WorkspaceContentGroups.vue:155 的 aria-valuemin/max）。
 */
const props = defineProps({
  /** 当前板块（一个载体）：树从哪来、标题叫什么都在这块板上。 */
  board: { type: Object, default: null },
  /** useBoardData 的返回值：索引窗与核心区看的是同一份数据。 */
  data: { type: Object, required: true },
  archive: { type: Array, default: () => [] },
  width: { type: Number, default: 256 }
})
const emit = defineEmits(['collapse'])

const newTitle = ref('')

/** 树的口径由板块声明的目录窗 pane 决定（novel.* 列章节，setting.* 列世界书条目）。 */
const treeKind = computed(() => {
  const paneId = String(props.board?.treePaneId ?? '')
  if (paneId.startsWith('novel.')) return 'chapters'
  if (paneId.startsWith('setting.')) return 'entries'
  return 'none'
})

/** 树所在的目录名：取板块认领的第一个目录（小说＝正文，设定＝世界书）。 */
const treeDir = computed(() => props.board?.dataDirs?.[0] ?? props.board?.treePaneTitle ?? '目录')

const isChapterOpen = (item) => props.data.selection?.type === 'chapter' && props.data.selection.item?.file === item.file
const isEntryOpen = (item) => props.data.selection?.type === 'entry' && props.data.selection.item?.path === item.path
const isNoteOpen = (item) => props.data.selection?.type === 'note' && props.data.selection.item?.file === item.file
const isOutlineNodeOpen = (index) => props.data.selection?.type === 'outline-node' && props.data.selection.item?.index === index

async function createChapter() {
  const title = newTitle.value.trim()
  if (!title) return
  newTitle.value = ''
  await props.data.createChapter(title)
}

// 换板＝换树：目录窗自己负责把这一板的东西列出来（核心区不替它列）。
// 大纲随章节一起取（工单A3）：同属小说板块的索引窗，一次换板三棵树都是新的。
// 构思速记（工单B1）也在这一拍里列出来；它刻意不自动打开，正文仍是核心区的主角。
watch(() => props.board?.id, () => {
  newTitle.value = ''
  if (treeKind.value === 'chapters') {
    void props.data.loadChapters()
    void props.data.loadOutline()
    void props.data.loadNotes()
  } else if (treeKind.value === 'entries') {
    void props.data.loadEntries()
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

      <template v-if="treeKind === 'chapters'">
        <div class="nx-index-new">
          <input v-model="newTitle" class="nx-field is-tiny" placeholder="新章标题" @keydown.enter.prevent="createChapter">
          <button type="button" class="control-quiet nx-index-add" :disabled="data.busy || !newTitle.trim()" @click="createChapter">新建</button>
        </div>
        <p class="workspace-nav-section">{{ treeDir }}</p>
        <ul class="nx-tree">
          <li v-for="item in data.chapters" :key="item.file">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isChapterOpen(item) }"
              :aria-current="isChapterOpen(item) ? 'page' : null"
              @click="data.openChapter(item)"
            >
              <span class="workspace-nav-label">{{ item.index + 1 }}. {{ item.title }}</span>
              <span class="workspace-nav-meta">第 {{ item.revision }} 版</span>
            </button>
          </li>
        </ul>
        <p v-if="!data.chapters.length && !data.treeError" class="nx-index-empty">这一栏还没有条目。</p>

        <!-- 大纲（工单A3 只读 → 工单B2 可编辑）：行可点选——点行把节点送进中栏的大纲编辑面（改名/加节点在那里）；
             大纲还没写就给一行说明＋「新建大纲」，不当成错误。 -->
        <p class="workspace-nav-section">大纲</p>
        <ul class="nx-tree">
          <li v-for="(node, index) in data.outline" :key="node.id ?? `outline-${index}`">
            <button
              type="button"
              class="workspace-nav-item workspace-nav-item--tree nx-tree-row nx-tree-item"
              :class="{ 'is-active': isOutlineNodeOpen(index) }"
              :aria-current="isOutlineNodeOpen(index) ? 'page' : null"
              @click="data.selectOutlineNode(index)"
            >
              <span class="workspace-nav-label">{{ index + 1 }}. {{ node.title }}</span>
            </button>
          </li>
        </ul>
        <p v-if="!data.outline.length && !data.outlineError" class="nx-index-empty">
          大纲还没有内容（大纲/outline.json）。
          <button type="button" class="control-quiet nx-index-add" :disabled="data.busy" @click="data.startOutline()">新建大纲</button>
        </p>
        <p v-if="data.outlineError" class="nx-index-error">{{ data.outlineError }}</p>

        <!-- 构思速记（工单B1）：第四棵树。行可点开——正文随 pinax_notes_list 一起回来，
             点击只换核心区的面板，不再发第二次读；目录还没写就给一行说明，不当成错误。 -->
        <p class="workspace-nav-section">构思</p>
        <ul class="nx-tree">
          <li v-for="item in data.notes" :key="item.file">
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
          </li>
        </ul>
        <p v-if="!data.notes.length && !data.notesError" class="nx-index-empty">构思还没有内容（构思/）。</p>
        <p v-if="data.notesError" class="nx-index-error">{{ data.notesError }}</p>
      </template>

      <template v-else-if="treeKind === 'entries'">
        <p class="workspace-nav-section">{{ treeDir }}</p>
        <ul class="nx-tree">
          <li v-for="item in data.entries" :key="item.path">
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
          </li>
        </ul>
        <p v-if="!data.entries.length && !data.treeError" class="nx-index-empty">这一栏还没有条目。</p>
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
