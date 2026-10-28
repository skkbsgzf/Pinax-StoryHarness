<script setup>
import { computed, ref } from 'vue'

/**
 * 核心区里的载体面板：正文的编辑面、构思速记的编辑面（工单B1）、条目的阅读与编辑面（工单A2 起条目可改）、
 * 约束的编辑面（工单E2）。
 *
 * 数据不在这里自己取——索引窗与核心区共用 useBoardData 的同一份对象，
 * 所以「索引窗列着第 1 版、正文存成了第 2 版」这种不同步不会发生。
 * 认不出的 pane id 不空白、不假装能编辑：如实说这块视图还没实现。
 */
const props = defineProps({
  pane: { type: Object, default: null },
  /** useBoardData 的返回值。 */
  data: { type: Object, required: true }
})

const paneId = computed(() => props.pane?.id ?? '')
const viewKind = computed(() => {
  // 小说板块的中栏只有 editor 一块：选中大纲节点就是大纲编辑面（工单B2），
  // 点名速记（索引窗构思区）换构思编辑面，点开提案（索引窗提案区）换审阅面，
  // 其余时候是正文编辑面。
  if (paneId.value === 'novel.editor') {
    if (props.data.selection?.type === 'outline-node') return 'outline-editor'
    if (props.data.selection?.type === 'proposal') return 'proposal-review'
    return props.data.selection?.type === 'note' ? 'notes-editor' : 'chapter-editor'
  }
  // 设定板（工单E2）：点名约束（索引窗「约束」区）换约束编辑面，其余时候是条目详情。
  if (paneId.value === 'setting.entries') {
    return props.data.selection?.type === 'rule' ? 'rule-editor' : 'entry-detail'
  }
  return 'placeholder'
})

/** 提案头部的时刻：模型写这一版提案的时间（精确到分钟），解析不了就退回原话。 */
function stampOf(value) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) return String(value ?? '')
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 新建构思输入（工单B1）：照索引窗「新章标题」的形态，速记是随手记，行常驻在面板尾部。 */
const newNoteTitle = ref('')

async function createNote() {
  const title = newNoteTitle.value.trim()
  if (!title) return
  newNoteTitle.value = ''
  await props.data.createNote(title)
}

/** 新建约束输入（工单E2）：照「新构思标题」的形态，约束也是短文本，行常驻在设定面板尾部。 */
const newRuleTitle = ref('')

async function createRule() {
  const title = newRuleTitle.value.trim()
  if (!title) return
  newRuleTitle.value = ''
  await props.data.createRule(title)
}
</script>

<template>
  <div v-if="!pane" class="pane pane-empty">
    <p>没有已启用的中栏面板。竖条、索引窗和右栏对话照常可用。</p>
  </div>

  <div v-else class="pane" :data-pane-id="pane.id">
    <div v-if="data.error" class="pane-error">{{ data.error }}</div>
    <div v-if="data.notice" class="pane-notice">{{ data.notice }}</div>

    <template v-if="viewKind === 'chapter-editor'">
      <div v-if="data.chapter" class="editor">
        <div class="editor-head">
          <h4 class="pane-sub">{{ data.chapter.title }}</h4>
          <span class="editor-meta">
            {{ data.chapter.file }} · 第 {{ data.chapter.revision }} 版 · {{ data.chapter.totalChars }} 字
            <em v-if="data.chapter.truncated">（当前只载入前段）</em>
          </span>
        </div>
        <textarea
          class="editor-area"
          :value="data.draft"
          spellcheck="false"
          aria-label="正文编辑器"
          @input="data.setDraft($event.target.value)"
        />
        <div class="editor-foot">
          <button type="button" class="pane-btn is-primary control-primary" :disabled="data.busy || !data.draft" @click="data.save()">
            {{ data.busy ? '写入中…' : `保存为第 ${(data.chapter?.revision ?? 0) + 1} 版` }}
          </button>
        </div>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一章，或在那里新建一章。</p>
    </template>

    <!-- 构思速记编辑面（工单B1）：照章节编辑器的形态。正文来自 pinax_notes_list 的随手带回，
         保存走载体自有的 pinax_notes_save（带修订号，冲突如实摊开）。 -->
    <template v-else-if="viewKind === 'notes-editor'">
      <div v-if="data.note" class="editor">
        <div class="editor-head">
          <h4 class="pane-sub">{{ data.note.title }}</h4>
          <span class="editor-meta">
            {{ data.note.file }} · 第 {{ data.note.revision }} 版 · {{ data.note.totalChars }} 字
            <em v-if="data.note.truncated">（当前只载入前段）</em>
          </span>
        </div>
        <textarea
          class="editor-area"
          :value="data.noteDraft"
          spellcheck="false"
          aria-label="构思编辑器"
          @input="data.setNoteDraft($event.target.value)"
        />
        <div class="editor-foot">
          <button type="button" class="pane-btn is-primary control-primary" :disabled="data.busy || !data.noteDraft" @click="data.saveNote()">
            {{ data.busy ? '写入中…' : `保存为第 ${(data.note?.revision ?? 0) + 1} 版` }}
          </button>
        </div>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一篇构思，或在下面新建一篇。</p>
    </template>

    <!-- 大纲编辑面（工单B2）：改名与加节点都先落在整份草稿上，按保存才走 pinax_outline_save 整份覆盖。
         改名选中「中栏改名」这一实现（比行内编辑省一套焦点管理）；不提供拖拽重排。 -->
    <template v-else-if="viewKind === 'outline-editor'">
      <div v-if="data.outlineDraft" class="editor">
        <div class="editor-head">
          <h4 class="pane-sub">大纲 · {{ data.outlineDraft.nodes[data.outlineNodeIndex]?.title ?? '节点' }}</h4>
          <span class="editor-meta">大纲/outline.json · 第 {{ data.outlineRevision ?? 0 }} 版 · 共 {{ data.outlineDraft.nodes.length }} 个节点</span>
        </div>
        <input
          class="nx-field outline-title"
          :value="data.outlineDraft.nodes[data.outlineNodeIndex]?.title ?? ''"
          spellcheck="false"
          aria-label="大纲节点标题"
          @input="data.setOutlineNodeTitle(data.outlineNodeIndex, $event.target.value)"
        >
        <div class="editor-foot">
          <button type="button" class="control-secondary" @click="data.addOutlineNode('sibling')">在后面加同级节点</button>
          <button type="button" class="control-secondary" @click="data.addOutlineNode('child')">加子节点</button>
          <button type="button" class="pane-btn is-primary control-primary" :disabled="data.busy" @click="data.saveOutline()">
            {{ data.busy ? '写入中…' : `保存为第 ${(data.outlineRevision ?? 0) + 1} 版` }}
          </button>
        </div>
        <p class="pane-hint">大纲按整份覆盖保存：改名与新增先记在草稿上，按保存才写 大纲/outline.json；层级关系记在连线上。</p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一个大纲节点。</p>
    </template>

    <!-- 提案审阅面（工单A）：模型改稿落在 .pinax/proposals/，这里做最后一道人审。
         上下两段是同一章的两个版本（当前正文／提案新文），不逐句 diff——历史面板已有 diff 能力，后续复用。
         采纳＝按此刻的章节修订号走载体 save（写入为新一版），弃用＝删提案文件；两者都不静默合并。 -->
    <template v-else-if="viewKind === 'proposal-review'">
      <div v-if="data.proposal" class="editor proposal-review">
        <div class="editor-head">
          <h4 class="pane-sub">提案 · {{ data.proposal.target?.title ?? data.proposal.name }}</h4>
          <span class="editor-meta">
            {{ data.proposal.target?.file ?? '（没有目标章）' }} · {{ data.proposal.contentChars ?? (data.proposal.content?.length ?? 0) }} 字 · {{ stampOf(data.proposal.createdAt) }}
          </span>
        </div>
        <p v-if="data.proposal.note" class="pane-hint proposal-note">提案说明：{{ data.proposal.note }}</p>
        <div class="proposal-stack">
          <section class="proposal-panel">
            <h5 class="proposal-label">
              当前正文
              <span class="editor-meta">{{ data.proposalChapter?.totalChars ?? 0 }} 字<template v-if="data.proposalChapter"> · 第 {{ data.proposalChapter.revision }} 版</template></span>
            </h5>
            <pre class="entry-text proposal-text">{{ data.proposalChapter?.text ?? '（目标章还没读到）' }}</pre>
          </section>
          <section class="proposal-panel">
            <h5 class="proposal-label">
              提案新文
              <span class="editor-meta">{{ data.proposal.contentChars ?? (data.proposal.content?.length ?? 0) }} 字</span>
            </h5>
            <pre class="editor-area proposal-text" aria-label="提案新文">{{ data.proposal.content ?? '' }}</pre>
          </section>
        </div>
        <div class="editor-foot">
          <button
            type="button"
            class="pane-btn is-primary control-primary"
            :disabled="data.busy || !data.proposal.content"
            @click="data.adoptProposal()"
          >
            {{ data.busy ? '写入中…' : '采纳（写入为新一版）' }}
          </button>
          <button type="button" class="control-quiet" :disabled="data.busy" @click="data.discardProposal()">弃用</button>
        </div>
        <p v-if="data.proposal.status === 'adopted'" class="pane-hint">这条提案已经采纳过；再采纳会按当前章节版本重新写入一版。</p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗的「提案」区选一条。</p>
    </template>

    <!-- 新建构思输入（工单B1）：照索引窗「新章标题」的形态。速记讲的是随手记，
         所以这一行常驻在小说面板尾部——还没有任何一篇构思时，第一篇也从这里起头。 -->
    <template v-if="viewKind === 'chapter-editor' || viewKind === 'notes-editor'">
      <div class="nx-index-new notes-new">
        <input
          v-model="newNoteTitle"
          class="nx-field is-tiny"
          placeholder="新构思标题"
          aria-label="新构思标题"
          @keydown.enter.prevent="createNote"
        >
        <button type="button" class="control-quiet nx-index-add" :disabled="data.busy || !newNoteTitle.trim()" @click="createNote">新建构思</button>
      </div>
    </template>

    <!-- 约束编辑面（工单E2）：照构思速记的同一形态。正文来自 pinax_rule_list 的随手带回，
         保存走载体自有的 pinax_rule_save（带修订号，冲突如实摊开）。 -->
    <template v-else-if="viewKind === 'rule-editor'">
      <div v-if="data.rule" class="editor">
        <div class="editor-head">
          <h4 class="pane-sub">{{ data.rule.title }}</h4>
          <span class="editor-meta">
            {{ data.rule.file }} · 第 {{ data.rule.revision }} 版 · {{ data.rule.totalChars }} 字
            <em v-if="data.rule.truncated">（当前只载入前段）</em>
          </span>
        </div>
        <textarea
          class="editor-area"
          :value="data.ruleDraft"
          spellcheck="false"
          aria-label="约束编辑器"
          @input="data.setRuleDraft($event.target.value)"
        />
        <div class="editor-foot">
          <button type="button" class="pane-btn is-primary control-primary" :disabled="data.busy || !data.ruleDraft" @click="data.saveRule()">
            {{ data.busy ? '写入中…' : `保存为第 ${(data.rule?.revision ?? 0) + 1} 版` }}
          </button>
        </div>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗的「约束」区选一份约束，或在下面新建一份。</p>
      <div class="nx-index-new notes-new">
        <input
          v-model="newRuleTitle"
          class="nx-field is-tiny"
          placeholder="新约束标题"
          aria-label="新约束标题"
          @keydown.enter.prevent="createRule"
        >
        <button type="button" class="control-quiet nx-index-add" :disabled="data.busy || !newRuleTitle.trim()" @click="createRule">新建约束</button>
      </div>
    </template>

    <template v-else-if="viewKind === 'entry-detail'">
      <div v-if="data.entry" class="entry-body">
        <div class="entry-head">
          <h4 class="pane-sub">{{ data.entry.name }}</h4>
          <span class="entry-meta">{{ data.entry.path }} · 第 {{ data.entry.revision }} 版 · {{ data.entry.contentChars }} 字<template v-if="!data.entry.contract">（未建档）</template></span>
          <button v-if="!data.editingEntry" type="button" class="control-secondary entry-edit" @click="data.editEntry()">编辑</button>
        </div>
        <textarea
          v-if="data.editingEntry"
          class="editor-area"
          :value="data.entryDraft"
          spellcheck="false"
          aria-label="条目编辑器"
          @input="data.setEntryDraft($event.target.value)"
        />
        <pre v-else class="entry-text">{{ data.entry.content }}</pre>
        <div v-if="data.editingEntry" class="editor-foot">
          <button type="button" class="pane-btn is-primary control-primary" :disabled="data.busy || !data.entryDraft" @click="data.saveEntry()">
            {{ data.busy ? '写入中…' : '保存为新版本' }}
          </button>
          <button type="button" class="control-quiet entry-cancel" :disabled="data.busy" @click="data.cancelEditEntry()">取消</button>
        </div>
        <p v-if="data.entry.contentTruncated" class="pane-notice">只显示前 {{ data.entry.content.length }} 字，全篇 {{ data.entry.contentChars }} 字。</p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一条设定。</p>
      <p v-if="data.entry?.relations?.length" class="pane-hint">关系字段 {{ data.entry.relations.length }} 条（面板第一批只列不画图）。</p>
      <ul v-if="data.entryWarnings.length" class="pane-warn">
        <li v-for="(warning, index) in data.entryWarnings" :key="`e-${index}`">{{ warning }}</li>
      </ul>
    </template>

    <!-- 只在真的没有对应视图时才显示（批次15 验收修：原来挂在第二条链的 v-else 上，
         提案审阅态会误把占位文案渲染在审阅面之下）。 -->
    <p v-else-if="viewKind === 'placeholder'" class="pane-note">
      「{{ pane.pluginTitle }}」这块板块的面板视图还没做出来。它的工具和上下文块照常可用——先在右栏问 Pi-Agent。
    </p>
  </div>
</template>

<style scoped>
/* 提案审阅（工单A）：两段上下堆叠，各自独立滚动——长章不会把「采纳」按钮顶到看不见的地方。
   颜色／字号／圆角一律走老前端 token（门禁见 next/tests/visual-contract.test.mjs）。 */
.proposal-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.proposal-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-muted);
}
.proposal-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: var(--nx-fs-md);
  font-weight: 600;
  color: var(--archive-ink);
}
.proposal-note {
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.proposal-text {
  margin: 0;
  max-height: 420px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: var(--nx-fs-lg);
}
</style>
