<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { renderMarkdown } from './mdRender.mjs'

/**
 * 核心区里的载体面板：正文的编辑面、构思的编辑面、大纲的编辑面、世界书条目的阅读与编辑面
 * （工单A2 起条目可改；工单C 起契约条目的 frontmatter 关键词／标签也能在编辑态改，随 save 的 meta 落盘）、
 * 约束的编辑面（工单E2）、资料的阅读与编辑面（工单G1）、剧本的阅读与编辑面（批次26）。
 *
 * 协议 v1.1-A（作者 2026-10-28 裁定）：一个载体＝竖条一格＝一棵纯粹的本域内容树。
 * 中栏视图按载体 paneId 前缀路由，不再靠 selection 类型跨栏串面：
 *   novel.* → 正文编辑（选中提案时换审阅面）
 *   outline.* → 大纲编辑
 *   notes.* → 构思编辑
 *   worldbook.* → 条目阅读/编辑
 *   script.* → 剧本阅读/编辑（批次26）
 *   setting.* → 约束编辑
 *   reference.* → 资料阅读/编辑
 *
 * 阅读态一律渲染 md（批次26）：Markdown → HTML 走 next/shell/mdRender.mjs（手写轻量解析，
 * 输入先整段转义再拼我们自己的标签，出线前过一遍 sanitize）；编辑态仍是 textarea 纯文本——
 * 作者改的是源文，不是渲染结果。所有 carrier 的阅读态共用同一条渲染路径。
 *
 * 数据不在这里自己取——索引窗与核心区共用 useBoardData 的同一份对象，
 * 所以「索引窗列着第 1 版、正文存成了第 2 版」这种不同步不会发生。
 * 认不出的 pane id 不空白、不假装能编辑：如实说这块视图还没实现。
 *
 * 保存交互（工单H1，对齐老版）：没有常驻保存按钮——Ctrl+S／Cmd+S 触发（编辑器聚焦时生效），
 * 结果只落在编辑面头部一枚自动消失的保存 chip 上（复刻 wall__save-chip 的度量）。
 * 批次19 H1 收尾：大纲与条目两块面按双通道——各自的常驻「保存」按钮保留（这两块面的主操作位已有惯例），
 * 同时接 Ctrl+S；两条路落同一格 chip，不另铺常驻提示。
 */
const props = defineProps({
  pane: { type: Object, default: null },
  /** useBoardData 的返回值。 */
  data: { type: Object, required: true }
})

const paneId = computed(() => props.pane?.id ?? '')
const viewKind = computed(() => {
  const id = paneId.value
  // 小说栏只有正文一棵内容树；提案的目标是正文，审阅面随正文留在这块板上（协议 v1.1-A）。
  if (id.startsWith('novel.')) return props.data.selection?.type === 'proposal' ? 'proposal-review' : 'chapter-editor'
  if (id.startsWith('outline.')) return 'outline-editor'
  if (id.startsWith('notes.')) return 'notes-editor'
  if (id.startsWith('worldbook.')) return 'entry-detail'
  if (id.startsWith('script.')) return 'script-editor'
  if (id.startsWith('setting.')) return 'rule-editor'
  if (id.startsWith('reference.')) return 'document-detail'
  return 'placeholder'
})

/**
 * 阅读态的 md 渲染（批次26）：三处阅读面（条目／资料／剧本）与提案审阅的两段正文共用这条路径。
 * 解析与清洗都在 mdRender.mjs；这里只做「源文 → HTML」的一次计算，编辑态不经过它（textarea 拿源文）。
 * 稿件里出现渲染器不认的写法时按段落原样显示——不吞内容，也不假装渲染了。
 */
const entryHtml = computed(() => renderMarkdown(props.data.entry?.content ?? ''))
const documentHtml = computed(() => renderMarkdown(props.data.document?.text ?? ''))
const scriptHtml = computed(() => renderMarkdown(props.data.script?.text ?? ''))
const proposalCurrentHtml = computed(() => renderMarkdown(props.data.proposalChapter?.text ?? '（目标章还没读到）'))
const proposalDraftHtml = computed(() => renderMarkdown(props.data.proposal?.content ?? ''))

/** 提案头部的时刻：模型写这一版提案的时间（精确到分钟），解析不了就退回原话。 */
function stampOf(value) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) return String(value ?? '')
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 条目摘要的阅读态预览（收口包②）：meta 行只占一行，超过 80 字就截断并加省略号。
 *  截断只发生在这里（显示），保存与磁盘上的摘要始终是全文。 */
const SUMMARY_PREVIEW_CHARS = 80
function clipSummary(value) {
  const text = String(value ?? '').trim()
  return text.length > SUMMARY_PREVIEW_CHARS ? `${text.slice(0, SUMMARY_PREVIEW_CHARS)}…` : text
}

/**
 * 资料板检索（工单H2）：输入在面板头部，结果只走 knowledge:search 通道（主进程 knowledgeService，
 * worker 线程、零 HTTP）。命中若指向「资料/」下的文件，点击回到 pinax_document_read 打开原文；
 * 否则只展示片段（知识库卡／归档片段没有可直接打开的原文）。
 */
const knowledgeQuery = ref('')

const knowledgeEmptyText = computed(() => {
  const error = props.data.knowledgeError
  if (error) {
    if (error.code === 'KNOWLEDGE_RUNTIME_MISSING') return '知识内核未安装'
    if (error.code === 'KNOWLEDGE_BUSY') return '知识服务忙'
    return `检索失败：${error.message ?? '未知错误'}`
  }
  if (!props.data.knowledgeSearched) return ''
  return props.data.knowledgeResults?.length ? '' : '没有命中'
})

/** readRef 指向 资料/ 下的 .md/.txt 才是可打开的原文；知识库卡与归档片段只展示。
 *  实测内核给项目卡片的 readRef 是编译产物 cards/…，原文路径在 provenance.path（如 资料/设定集.md）；
 *  两个都看：readRef 优先，退回 provenance.path，仍不是资料文本就只展示片段。 */
function knowledgeHitFile(hit) {
  for (const value of [hit?.readRef, hit?.provenance?.path]) {
    const reference = String(value ?? '').replaceAll('\\', '/')
    if (reference.startsWith('资料/') && /\.(?:md|txt)$/iu.test(reference)) return reference
  }
  return null
}

async function runKnowledgeSearch() {
  if (props.data.knowledgeSearching) return
  const query = knowledgeQuery.value.trim()
  if (!query) return
  await props.data.searchKnowledge?.(query)
}

async function openKnowledgeHit(hit) {
  const file = knowledgeHitFile(hit)
  if (!file) return
  await props.data.openDocument({ file, title: hit.title ?? file })
}

/**
 * 保存 chip（工单H1）：只认 useBoardData.saveFeedback 这一格。
 * 六个编辑面共用同一条反馈状态，但每块面只显示自己 target 的那一条；
 * saved 2.5 秒后收起，saving／error 常驻（失败带重试，STALE 换成重新载入）。
 * 大纲与条目（批次19 H1 收尾）：按「双通道」保存——常驻按钮保留（这两块面的主操作位已有惯例），
 * 同时接 Ctrl+S，两条路都落这一格 chip。
 */
const SAVE_TARGET_BY_VIEW = {
  'chapter-editor': 'chapter',
  'notes-editor': 'note',
  'outline-editor': 'outline',
  'rule-editor': 'rule',
  'document-detail': 'document',
  'script-editor': 'script',
  'entry-detail': 'entry'
}

const chipVisible = ref(false)
let chipTimer = null

const saveChip = computed(() => {
  const feedback = props.data.saveFeedback
  if (!feedback) return null
  return SAVE_TARGET_BY_VIEW[viewKind.value] === feedback.target ? feedback : null
})
const saveChipStale = computed(() => saveChip.value?.code === 'PINAX_STALE_REVISION')
const saveChipText = computed(() => {
  const chip = saveChip.value
  if (!chip) return ''
  if (chip.status === 'saving') return '保存中…'
  if (chip.status === 'saved') return `已保存 · 第 ${chip.revision} 版`
  return saveChipStale.value ? '保存失败 · 版本冲突' : '保存失败'
})

watch(() => props.data.saveFeedback, (feedback) => {
  if (chipTimer) {
    clearTimeout(chipTimer)
    chipTimer = null
  }
  if (!feedback) {
    chipVisible.value = false
    return
  }
  chipVisible.value = true
  if (feedback.status === 'saved') {
    chipTimer = setTimeout(() => {
      chipVisible.value = false
      chipTimer = null
    }, 2500)
  }
}, { immediate: true })

onBeforeUnmount(() => {
  if (chipTimer) clearTimeout(chipTimer)
})

/** 编辑器聚焦时的 Ctrl+S／Cmd+S：只认编辑区里的事件，别处按快捷键不抢。 */
function onPaneKeydown(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  if (String(event.key ?? '').toLowerCase() !== 's') return
  // 只认真正的编辑器（textarea／大纲标题输入框）：提案的 pre 也挂 .editor-area，不能当编辑区。
  // 收口包②：条目摘要也是编辑面的一部分，在摘要栏里按 Ctrl+S 同样落这次保存。
  if (!event.target?.matches?.('textarea.editor-area, textarea.entry-meta-summary, input.outline-title')) return
  event.preventDefault()
  void saveCurrent()
}

function saveCurrent() {
  switch (viewKind.value) {
    case 'chapter-editor': return props.data.save()
    case 'notes-editor': return props.data.saveNote()
    case 'outline-editor': return props.data.saveOutline()
    case 'rule-editor': return props.data.saveRule()
    case 'document-detail': return props.data.saveDocument()
    case 'script-editor': return props.data.editingScript ? props.data.saveScript() : undefined
    case 'entry-detail': return props.data.editingEntry ? props.data.saveEntry() : undefined
    default: return undefined
  }
}

/** 失败 chip 的「重试」：同一份草稿再走一次保存（修订号仍是读到的那一版）。 */
function retrySaveFromChip() {
  void saveCurrent()
}

/** STALE 的「重新载入」：丢弃本稿、按磁盘重读当前文档（文案在 chip 里说明会丢弃未保存修改）。
 *  速记与约束的正文随 list 工具一起回来，所以先重列再打开——不能拿手里这份旧 item 当磁盘。
 *  大纲／条目（批次19 H1 收尾）同一条规矩：大纲整份重读后重新选中同一位置的节点，
 *  条目先重列再打开，修订号与正文都以磁盘为准。 */
async function reloadFromChip() {
  const target = saveChip.value?.target
  if (target === 'chapter' && props.data.chapter) {
    await props.data.openChapter(props.data.chapter)
    return
  }
  if (target === 'note') {
    await props.data.loadNotes()
    if (props.data.note) props.data.openNote(props.data.note)
    return
  }
  if (target === 'rule') {
    await props.data.loadRules()
    if (props.data.rule) props.data.openRule(props.data.rule)
    return
  }
  if (target === 'document' && props.data.document) await props.data.openDocument(props.data.document)
  if (target === 'script' && props.data.script) await props.data.openScript(props.data.script)
  if (target === 'outline') {
    // loadOutline 会收起旧 chip（重读＝新状态）；节点下标按重读后的长度钳一下，节点被删也不越界。
    await props.data.loadOutline()
    const last = Math.max(0, (props.data.outline?.length ?? 1) - 1)
    props.data.selectOutlineNode(Math.min(props.data.outlineNodeIndex ?? 0, last))
    return
  }
  if (target === 'entry') {
    await props.data.loadEntries()
    if (props.data.entry) await props.data.openEntry(props.data.entry)
  }
}

function actOnSaveChip() {
  if (saveChipStale.value) void reloadFromChip()
  else retrySaveFromChip()
}
</script>

<template>
  <div v-if="!pane" class="pane pane-empty">
    <p>没有已启用的中栏面板。竖条、索引窗和右栏对话照常可用。</p>
  </div>

  <div v-else class="pane" :data-pane-id="pane.id" @keydown="onPaneKeydown">
    <div v-if="data.error" class="pane-error">{{ data.error }}</div>
    <div v-if="data.notice" class="pane-notice">{{ data.notice }}</div>

    <template v-if="viewKind === 'chapter-editor'">
      <div v-if="data.chapter" class="editor">
        <div class="editor-head nx-pane-header">
          <h4 class="pane-sub">{{ data.chapter.title }}</h4>
          <span class="editor-meta">
            {{ data.chapter.file }} · 第 {{ data.chapter.revision }} 版 · {{ data.chapter.totalChars }} 字
            <em v-if="data.chapter.truncated">（当前只载入前段）</em>
          </span>
          <span v-if="chipVisible && saveChip" class="nx-pane-actions">
            <span class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
          </span>
        </div>
        <textarea
          class="editor-area"
          :value="data.draft"
          spellcheck="false"
          aria-label="正文编辑器"
          @input="data.setDraft($event.target.value)"
        />
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一章，或在那里新建一章。</p>
    </template>

    <!-- 构思速记编辑面（工单B1）：照章节编辑器的形态。正文来自 pinax_notes_list 的随手带回，
         保存走载体自有的 pinax_notes_save（带修订号，冲突如实摊开）。 -->
    <template v-else-if="viewKind === 'notes-editor'">
      <div v-if="data.note" class="editor">
        <div class="editor-head nx-pane-header">
          <h4 class="pane-sub">{{ data.note.title }}</h4>
          <span class="editor-meta">
            {{ data.note.file }} · 第 {{ data.note.revision }} 版 · {{ data.note.totalChars }} 字
            <em v-if="data.note.truncated">（当前只载入前段）</em>
          </span>
          <span v-if="chipVisible && saveChip" class="nx-pane-actions">
            <span class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
          </span>
        </div>
        <textarea
          class="editor-area"
          :value="data.noteDraft"
          spellcheck="false"
          aria-label="构思编辑器"
          @input="data.setNoteDraft($event.target.value)"
        />
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一篇构思，或用索引窗「构思」区的 ＋ 新建一篇。</p>
    </template>

    <!-- 大纲编辑面（工单B2）：改名与加节点都先落在整份草稿上，按保存才走 pinax_outline_save 整份覆盖。
         改名选中「中栏改名」这一实现（比行内编辑省一套焦点管理）；不提供拖拽重排。
         批次19 H1 收尾：保存是双通道——下方按钮保留，Ctrl+S 同效；结果只进头部保存 chip。 -->
    <template v-else-if="viewKind === 'outline-editor'">
      <div v-if="data.outlineDraft" class="editor">
        <div class="editor-head nx-pane-header">
          <h4 class="pane-sub">大纲 · {{ data.outlineDraft.nodes[data.outlineNodeIndex]?.title ?? '节点' }}</h4>
          <span class="editor-meta">大纲/outline.json · 第 {{ data.outlineRevision ?? 0 }} 版 · 共 {{ data.outlineDraft.nodes.length }} 个节点</span>
          <span v-if="chipVisible && saveChip" class="nx-pane-actions">
            <span class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
          </span>
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
          <!-- P3：版本号不进按钮文案——版本在头部 meta 与历史面板看。 -->
          <button type="button" class="pane-btn is-primary control-primary" :disabled="data.busy" @click="data.saveOutline()">
            {{ data.busy ? '写入中…' : '保存' }}
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
        <div class="editor-head nx-pane-header">
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
            <div class="entry-text proposal-text nx-rendered-md" v-html="proposalCurrentHtml" />
          </section>
          <section class="proposal-panel">
            <h5 class="proposal-label">
              提案新文
              <span class="editor-meta">{{ data.proposal.contentChars ?? (data.proposal.content?.length ?? 0) }} 字</span>
            </h5>
            <div class="editor-area proposal-text nx-rendered-md" aria-label="提案新文" v-html="proposalDraftHtml" />
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

    <!-- 约束编辑面（工单E2）：照构思速记的同一形态。正文来自 pinax_rule_list 的随手带回，
         保存走载体自有的 pinax_rule_save（带修订号，冲突如实摊开）。 -->
    <template v-else-if="viewKind === 'rule-editor'">
      <div v-if="data.rule" class="editor">
        <div class="editor-head nx-pane-header">
          <h4 class="pane-sub">{{ data.rule.title }}</h4>
          <span class="editor-meta">
            {{ data.rule.file }} · 第 {{ data.rule.revision }} 版 · {{ data.rule.totalChars }} 字
            <em v-if="data.rule.truncated">（当前只载入前段）</em>
          </span>
          <span v-if="chipVisible && saveChip" class="nx-pane-actions">
            <span class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
          </span>
        </div>
        <textarea
          class="editor-area"
          :value="data.ruleDraft"
          spellcheck="false"
          aria-label="约束编辑器"
          @input="data.setRuleDraft($event.target.value)"
        />
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗的「约束」区选一份约束，或用那里的 ＋ 新建一份。</p>
    </template>

    <template v-else-if="viewKind === 'entry-detail'">
      <div v-if="data.entry" class="entry-body">
        <div class="entry-head nx-pane-header">
          <h4 class="pane-sub">{{ data.entry.name }}</h4>
          <span class="entry-meta">{{ data.entry.path }} · 第 {{ data.entry.revision }} 版 · {{ data.entry.contentChars }} 字<template v-if="data.entry.keys?.length"> · 关键词：{{ data.entry.keys.join('、') }}</template><template v-if="clipSummary(data.entry.summary)"> · 摘要：{{ clipSummary(data.entry.summary) }}</template><template v-if="!data.entry.contract">（未建档）</template></span>
          <span v-if="(chipVisible && saveChip) || !data.editingEntry" class="nx-pane-actions">
            <!-- 保存 chip（批次19 H1 收尾）：Ctrl+S 与下方「保存」按钮同一格反馈；阅读态留着让结果看得见。 -->
            <span v-if="chipVisible && saveChip" class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
            <button v-if="!data.editingEntry" type="button" class="control-secondary entry-edit" @click="data.editEntry()">编辑</button>
          </span>
        </div>
        <!-- 条目元数据（工单C）：契约条目的 frontmatter 关键词／标签在这里改，随保存一起走 meta；
             裸 md 没有 frontmatter，只给一句话说明（保存仍按原样整份写正文）。
             收口包②：关键词／标签之下补「摘要」一栏——textarea 走 .nx-field 词汇，500 字上限由
             maxlength 与工具 schema 两头守，旁边一枚字数说明（不另起常驻提示）。 -->
        <div v-if="data.editingEntry && data.entry.contract" class="entry-meta-edit">
          <label class="entry-meta-field">
            <span class="entry-meta-label">关键词</span>
            <input
              class="nx-field"
              :value="data.entryMetaDraft.keys"
              spellcheck="false"
              aria-label="条目关键词（逗号分隔）"
              @input="data.setEntryMeta('keys', $event.target.value)"
            >
          </label>
          <label class="entry-meta-field">
            <span class="entry-meta-label">标签</span>
            <input
              class="nx-field"
              :value="data.entryMetaDraft.tags"
              spellcheck="false"
              aria-label="条目标签（逗号分隔）"
              @input="data.setEntryMeta('tags', $event.target.value)"
            >
          </label>
          <label class="entry-meta-field is-summary">
            <span class="entry-meta-label">摘要</span>
            <textarea
              class="nx-field entry-meta-summary"
              :value="data.entryMetaDraft.summary"
              maxlength="500"
              rows="2"
              spellcheck="false"
              aria-label="条目摘要（最多 500 字）"
              @input="data.setEntryMeta('summary', $event.target.value)"
            />
            <span class="entry-meta-count" aria-hidden="true">{{ data.entryMetaDraft.summary.length }}/500</span>
          </label>
        </div>
        <p v-else-if="data.editingEntry" class="pane-hint entry-meta-bare" data-test="entry-meta-bare">
          这篇没有 frontmatter（未按世界书文件契约建档），关键词／标签／摘要改不了；保存仍按原样整份写正文。
        </p>
        <textarea
          v-if="data.editingEntry"
          class="editor-area"
          :value="data.entryDraft"
          spellcheck="false"
          aria-label="条目编辑器"
          @input="data.setEntryDraft($event.target.value)"
        />
        <!-- 阅读态（批次26）：md 原文渲染成 HTML（标题／粗体／列表／引用／代码块…）。
             渲染器只产出自己拼的标签，输入整段先转义，所以 v-html 的来源是可信的。 -->
        <div v-else class="entry-text nx-rendered-md" data-test="entry-rendered" v-html="entryHtml" />
        <div v-if="data.editingEntry" class="editor-foot">
          <button type="button" class="pane-btn is-primary control-primary" :disabled="data.busy || !data.entryDraft" @click="data.saveEntry()">
            {{ data.busy ? '写入中…' : '保存' }}
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

    <!-- 资料（工单G1）：阅读态＝元信息＋pre 正文，编辑态＝textarea（Ctrl+S 保存）＋取消。
         读的是 pinax_document_read 的全文（列表那份最多 20000 字，不能当编辑底稿）；
         保存走载体自有的 pinax_document_save，带读到的修订号，冲突如实摊开。 -->
    <template v-else-if="viewKind === 'document-detail'">
      <!-- 资料板检索（工单H2）：头部输入＋结果列表；三种空态分开说（未装内核／服务忙／无命中）。 -->
      <section class="reference-search">
        <form class="reference-search-row" @submit.prevent="runKnowledgeSearch">
          <input
            v-model="knowledgeQuery"
            class="nx-field is-tiny reference-search-input"
            placeholder="在资料里检索…"
            aria-label="资料检索"
            spellcheck="false"
            @keydown.enter.prevent="runKnowledgeSearch"
            @keydown.esc.prevent="data.clearKnowledgeSearch?.()"
          >
          <button type="submit" class="control-secondary reference-search-submit" :disabled="data.knowledgeSearching || !knowledgeQuery.trim()">
            {{ data.knowledgeSearching ? '检索中…' : '检索' }}
          </button>
        </form>
        <p v-if="data.knowledgeSearching" class="pane-hint reference-search-state">检索中…</p>
        <p v-else-if="knowledgeEmptyText" class="pane-hint reference-search-state">{{ knowledgeEmptyText }}</p>
        <ul v-if="!data.knowledgeSearching && data.knowledgeResults?.length" class="reference-search-results">
          <li v-for="(hit, index) in data.knowledgeResults" :key="hit.id ?? hit.readRef ?? index">
            <button v-if="knowledgeHitFile(hit)" type="button" class="nx-row reference-search-hit" @click="openKnowledgeHit(hit)">
              <span class="reference-search-hit-title">{{ hit.title ?? hit.file }}</span>
              <span v-if="hit.readRef" class="reference-search-hit-meta">{{ hit.provenance?.path ?? hit.readRef }}</span>
              <span class="reference-search-hit-excerpt">{{ hit.excerpt ?? '' }}</span>
            </button>
            <div v-else class="reference-search-hit is-static">
              <span class="reference-search-hit-title">{{ hit.title ?? hit.file }}</span>
              <span v-if="hit.readRef" class="reference-search-hit-meta">{{ hit.provenance?.path ?? hit.readRef }}</span>
              <span class="reference-search-hit-excerpt">{{ hit.excerpt ?? '' }}</span>
            </div>
          </li>
        </ul>
      </section>
      <div v-if="data.document" class="entry-body">
        <div class="entry-head nx-pane-header">
          <h4 class="pane-sub">{{ data.document.title }}</h4>
          <span class="entry-meta">{{ data.document.file }} · 第 {{ data.document.revision }} 版 · {{ data.document.totalChars }} 字</span>
          <span class="nx-pane-actions">
            <span v-if="chipVisible && saveChip" class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
            <button v-if="!data.editingDocument" type="button" class="control-secondary document-edit" @click="data.editDocument()">编辑</button>
          </span>
        </div>
        <textarea
          v-if="data.editingDocument"
          class="editor-area"
          :value="data.documentDraft"
          spellcheck="false"
          aria-label="资料编辑器"
          @input="data.setDocumentDraft($event.target.value)"
        />
        <div v-else class="entry-text nx-rendered-md" aria-label="资料正文" v-html="documentHtml" />
        <div v-if="data.editingDocument" class="editor-foot">
          <button type="button" class="control-quiet document-cancel" :disabled="data.busy" @click="data.cancelEditDocument()">取消</button>
        </div>
        <p v-if="data.document.truncated" class="pane-notice">
          只载入了前 {{ data.document.text?.length ?? 0 }} 字，全篇 {{ data.document.totalChars }} 字：保存会覆盖未载入的部分。
        </p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一篇资料，或在那里新建一篇。</p>
    </template>

    <!-- 剧本（批次26 · M6 提前）：阅读态＝元信息＋md 渲染正文（场次标题、台词、△ 舞台说明都是 md 文本），
         编辑态＝textarea（Ctrl+S 保存）＋取消。读的是 pinax_script_read 的全文（列表那份最多 20000 字）；
         保存走载体自有的 pinax_script_save，带读到的修订号，冲突如实摊开。 -->
    <template v-else-if="viewKind === 'script-editor'">
      <div v-if="data.script" class="entry-body">
        <div class="entry-head nx-pane-header">
          <h4 class="pane-sub">{{ data.script.title }}</h4>
          <span class="entry-meta">{{ data.script.file }} · 第 {{ data.script.revision }} 版 · {{ data.script.totalChars }} 字</span>
          <span class="nx-pane-actions">
            <span v-if="chipVisible && saveChip" class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
            <button v-if="!data.editingScript" type="button" class="control-secondary script-edit" @click="data.editScript()">编辑</button>
          </span>
        </div>
        <textarea
          v-if="data.editingScript"
          class="editor-area"
          :value="data.scriptDraft"
          spellcheck="false"
          aria-label="剧本编辑器"
          @input="data.setScriptDraft($event.target.value)"
        />
        <div v-else class="entry-text nx-rendered-md" aria-label="剧本正文" v-html="scriptHtml" />
        <div v-if="data.editingScript" class="editor-foot">
          <button type="button" class="control-quiet script-cancel" :disabled="data.busy" @click="data.cancelEditScript()">取消</button>
        </div>
        <p v-if="data.script.truncated" class="pane-notice">
          只载入了前 {{ data.script.text?.length ?? 0 }} 字，全篇 {{ data.script.totalChars }} 字：保存会覆盖未载入的部分。
        </p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一篇剧本，或在那里新建一篇。</p>
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

/* 资料板检索（工单H2）：一条输入行＋结果列表；命中行仍是 .nx-row，静态片段不假装可点。 */
.reference-search {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-muted);
}
.reference-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.reference-search-input {
  flex: 1 1 auto;
  width: auto;
  min-height: 32px;
  padding: 6px 10px;
}
.reference-search-submit {
  flex: none;
  min-height: 32px;
  padding: 0 12px;
  font-size: var(--nx-fs-md);
}
.reference-search-state {
  font-size: var(--nx-fs-2xs);
}
.reference-search-results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow: auto;
}
.reference-search-hit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 2px;
  width: 100%;
  min-height: 0;
  padding: 6px 10px;
  text-align: left;
}
.reference-search-hit.is-static {
  cursor: default;
  color: var(--text-muted);
}
.reference-search-hit-title {
  font-size: var(--nx-fs-md);
  color: var(--archive-ink);
}
.reference-search-hit-meta {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.reference-search-hit-excerpt {
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  color: var(--text-muted);
  white-space: pre-wrap;
}

/* 条目元数据行（工单C）：关键词／标签两栏并列。输入沿用 .nx-field primitive
   （颜色／圆角／字号都由它带），这里只调排布，不另起一套控件度量。 */
.entry-meta-edit {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 8px;
}
.entry-meta-field {
  display: flex;
  flex: 1 1 220px;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.entry-meta-label {
  flex: none;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.entry-meta-field .nx-field {
  flex: 1 1 auto;
  width: auto;
  min-height: 32px;
  padding: 6px 10px;
  resize: none;
}
.entry-meta-bare {
  margin: 0 0 8px;
}

/* 摘要一栏（收口包②）：独占整行——label 顶对齐，textarea 占满剩余宽度，右侧一枚字数说明。
   输入仍是 .nx-field primitive（颜色／圆角／字号都由它带），这里只调排布与高度。 */
.entry-meta-field.is-summary {
  flex-basis: 100%;
  align-items: flex-start;
}
.entry-meta-field.is-summary .entry-meta-label {
  padding-top: 8px;
}
.entry-meta-summary {
  min-height: 56px;
  line-height: 1.6;
}
.entry-meta-count {
  flex: none;
  padding-top: 8px;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* 阅读态的 md 渲染（批次26）。容器带 .entry-text 继承基础度量（字号／行高／墨色），
   这里只把 pre-wrap 收回来——渲染出的块级标签之间会有换行，保留空白会把版面撑出空行。 */
.entry-text.nx-rendered-md {
  white-space: normal;
}
.nx-rendered-md :deep(p:first-child) {
  margin-top: 0;
}
.nx-rendered-md :deep(p:last-child) {
  margin-bottom: 0;
}
.nx-rendered-md :deep(p) {
  margin: 0 0 0.9em;
}
.nx-rendered-md :deep(h1),
.nx-rendered-md :deep(h2),
.nx-rendered-md :deep(h3),
.nx-rendered-md :deep(h4),
.nx-rendered-md :deep(h5),
.nx-rendered-md :deep(h6) {
  margin: 1.1em 0 0.5em;
  font-weight: 600;
  line-height: 1.45;
  color: var(--archive-ink);
}
.nx-rendered-md :deep(h1) { font-size: var(--nx-fs-2xl); }
.nx-rendered-md :deep(h2) { font-size: var(--nx-fs-xl); }
.nx-rendered-md :deep(h3) { font-size: var(--nx-fs-lg); }
.nx-rendered-md :deep(h4),
.nx-rendered-md :deep(h5),
.nx-rendered-md :deep(h6) { font-size: var(--nx-fs-md); }
.nx-rendered-md :deep(strong) {
  font-weight: 600;
  color: var(--archive-ink);
}
.nx-rendered-md :deep(em) {
  font-style: italic;
}
.nx-rendered-md :deep(del) {
  opacity: 0.7;
}
.nx-rendered-md :deep(ul),
.nx-rendered-md :deep(ol) {
  margin: 0 0 0.9em;
  padding-inline-start: 1.4em;
  list-style-position: outside;
}
.nx-rendered-md :deep(li) {
  margin: 0.2em 0;
}
.nx-rendered-md :deep(blockquote) {
  margin: 0 0 0.9em;
  padding: 2px 0 2px 12px;
  border-inline-start: 2px solid var(--hairline-soft);
  color: var(--text-muted);
}
.nx-rendered-md :deep(hr) {
  margin: 1.2em 0;
  border: 0;
  border-top: 1px solid var(--hairline-soft);
}
.nx-rendered-md :deep(code) {
  padding: 1px 5px;
  border-radius: var(--nx-radius-xs);
  background: var(--surface-workbench-input);
  font-family: var(--font-mono);
  font-size: var(--nx-fs-md);
}
.nx-rendered-md :deep(pre.md-code) {
  margin: 0 0 0.9em;
  padding: 10px 12px;
  overflow-x: auto;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-input);
  white-space: pre;
}
.nx-rendered-md :deep(pre.md-code code) {
  padding: 0;
  background: transparent;
  font-size: var(--nx-fs-md);
  line-height: 1.65;
}
.nx-rendered-md :deep(a) {
  color: var(--archive-olive);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>

<style scoped>
/* legacy-copied：保存 chip 的度量逐条抄自老版的 wall__save-chip。
   基准在 src/pages/Writing.scoped.css:213-250（src/pages/Authoring.vue:12-17 引用的就是这一枚；
   样式实际住在 Writing.scoped.css，不在 Authoring.vue 的 SFC 里）。
   只换数据源：老版读 saveStatus，这里读 useBoardData.saveFeedback；视觉不另起一套。
   颜色一律走 token；11px 字号／12px 圆角是老版原件的度量，本块按门禁的 legacy-copied 例外保留。 */
.nx-save-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid var(--archive-olive);
  background: color-mix(in srgb, var(--bg-secondary) 70%, var(--archive-olive) 8%);
  font-size: 11px;
  color: var(--text-primary);
  box-shadow:
    inset 0 1px 0 var(--surface-workbench-raised),
    inset 0 -1px 0 color-mix(in srgb, var(--archive-olive) 20%, transparent),
    0 1px 2px color-mix(in srgb, var(--text-primary) 18%, transparent);
  white-space: nowrap;
}
.nx-save-chip.is-saving {
  border-style: dashed;
  opacity: 0.85;
}
.nx-save-chip.is-saved {
  border-color: color-mix(in srgb, var(--archive-olive) 60%, transparent);
  background: color-mix(in srgb, var(--archive-olive) 14%, var(--bg-secondary));
  /* 2.5 秒收起的最后 200ms 淡出（界面在 2.5s 整摘掉节点）。 */
  animation: nx-save-chip-out 200ms ease 2300ms forwards;
}
@keyframes nx-save-chip-out {
  to { opacity: 0; }
}
.nx-save-chip.is-error {
  border-color: var(--archive-rose);
  background: color-mix(in srgb, var(--archive-rose) 12%, var(--bg-secondary));
  color: var(--archive-rose);
}
.nx-save-chip-state {
  font-family: var(--font-display);
  font-weight: 500;
  color: var(--archive-olive);
}
.nx-save-chip.is-error .nx-save-chip-state {
  color: var(--archive-rose);
  font-weight: 600;
}
/* 失败常驻时的动作：chip 里的小钮，不另占一条自救条。 */
.nx-save-chip-action {
  width: auto;
  min-height: 0;
  padding: 0 6px;
  line-height: 1.6;
  font-size: var(--nx-fs-2xs);
  color: inherit;
}
.nx-save-chip-hint {
  font-size: var(--nx-fs-2xs);
  color: color-mix(in srgb, var(--archive-rose) 82%, var(--archive-ink));
}
</style>
