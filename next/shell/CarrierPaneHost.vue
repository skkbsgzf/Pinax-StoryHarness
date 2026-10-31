<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { renderMarkdown } from './mdRender.mjs'
import { resolvePaneView } from './viewRegistry.mjs'
import { recordCarrierOfPaneId } from './recordCarriers.mjs'
import { availableWritingActions, referenceLabel } from './writingActions.mjs'
import PluginPanelHost from './PluginPanelHost.vue'
import EntryDetailPanel from './EntryDetailPanel.vue'
import EntriesBoard from './EntriesBoard.vue'
import ExternalAppHost from './ExternalAppHost.vue'

/**
 * 核心区里的载体面板：正文的编辑面、构思的编辑面、大纲的编辑面、世界书条目的阅读与编辑面
 * （工单A2 起条目可改；工单C 起契约条目的 frontmatter 关键词／标签也能在编辑态改，随 save 的 meta 落盘）、
 * 约束的编辑面（工单E2）、资料的阅读与编辑面（工单G1）、剧本的阅读与编辑面（批次26）。
 *
 * 协议 v1.1-A（作者 2026-10-28 裁定）：一个载体＝竖条一格＝一棵纯粹的本域内容树。
 * M2.5-C 起视图解析走注册表（next/shell/viewRegistry.mjs）：pane 声明 view 就按类型查，
 * 没声明时按 paneId 前缀回落（v1 兼容）——外壳里不再写死分支：
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
 *
 * P18 文档为主合同（批次31，作者 2026-10-29 裁定）：「我们是一个面向 Obsidian 的 doc 类组件，
 * 应该是以文档为主」。据此三件事落到这一枚组件上：
 *   1. 编辑面就是文档本身——正文满幅铺在窗格底色上（无 border／无卡片背景／无圆角，只留呼吸留白）；
 *   2. 控件只有三分：窗格头部一行（标题＋meta＋至多两个 quiet 操作，右端对齐）、按需浮现
 *      （索引窗树行右键菜单／hover 显形）、Ctrl+S＋保存 chip；**常驻按钮行一律取消**；
 *   3. 元数据默认折叠：条目的关键词／标签／摘要／关系收进一行「条目信息」层（照 Obsidian properties）。
 * 面板型界面（提案审阅的两版对照）不受此合同约束——两份文档需要视觉分隔。
 *
 * 批次33（作者 2026-10-30 裁定）把第 2 条的「头部」再收一刀——文档头只放一个标题：
 *   「作为一个 doc 来说，就是标题栏放一个标题，其他东西就不用放了，最多在底部放一些提示。」
 *   1. 头部只剩一行 .doc-title（章节名／条目名／资料名／剧本名／规则名／提案文件名）；
 *      「正文」「演示之书 · novel」那层身份与项目名都不在文档头里再念一遍——
 *      载体身份在竖条上，项目名在标题栏；
 *   2. 写作面聚焦不再套蓝框（.editor-area 的 outline 规则已拆，焦点指示就是光标）。
 *
 * 批次43（作者 2026-10-31：「正文区域没有适配md格式原生渲染么，还有，你加了很多无效的提示，
 * 然后文件添加了，修改了，也没发保存」）把同一份合同又推进一步：
 *   1. 正文／构思／大纲／约束四个面也有阅读态了——md 渲染成 HTML（与条目／资料／剧本同一条路径），
 *      头部一枚「编辑」切到 textarea；文档先是一篇文，再是编辑器；
 *   2. 底部 .doc-meta-hint 不再摆路径 · 第 N 版 · N 字 · 节点数这些开发者信息，
 *      只留作者用得上的：有没有没落盘的改动、是不是只载入了前段、条目自己的关键词与摘要；
 *   3. 改动会自己落盘（自动保存，见 useBoardData）：作者不该靠记忆去按 Ctrl+S。
 */
const props = defineProps({
  pane: { type: Object, default: null },
  /** useBoardData 的返回值。 */
  data: { type: Object, required: true },
  /** 当前项目根：看板区用它拼视图记忆的 localStorage 键（换项目＝各记各的）。 */
  projectRoot: { type: String, default: '' }
})
const emit = defineEmits(['history'])

/**
 * 视图解析（M2.5-C 任务二）：pane 声明 `view: 'pinax.view.*'`，宿主查注册表拿内容面；
 * 没声明时按 id 前缀回落（v1 兼容，见 next/shell/viewRegistry.mjs 的 LEGACY_VIEW_BINDINGS）。
 * 解析不到就出占位——不再在外壳里按前缀写死七个分支。
 */
const viewResolution = computed(() => resolvePaneView(props.pane, props.data))
const viewKind = computed(() => viewResolution.value?.result?.kind ?? 'placeholder')
const viewPlaceholderReason = computed(() => {
  const resolution = viewResolution.value
  if (!resolution) return '这块 pane 没有声明视图类型（view），宿主也不认它的 id 前缀。'
  if (!resolution.result) return `视图类型 ${resolution.type} 没有内容面（kind）：宿主不知道该渲染哪一种。`
  return ''
})

/**
 * 阅读态的 md 渲染（批次26）：资料／剧本／提案几面走这条路径（mdRender.mjs）。
 * 条目那一面搬进了 EntryDetailPanel（批次44：看板区要能单独摆它），那边自己渲染。
 */
const documentHtml = computed(() => renderMarkdown(props.data.document?.text ?? ''))
const scriptHtml = computed(() => renderMarkdown(props.data.script?.text ?? ''))
const recordHtml = computed(() => renderMarkdown(props.data.record?.body ?? ''))

/**
 * 正文／构思／大纲／约束的阅读面（批次43 · 作者 2026-10-31：「正文区域没有适配md格式原生渲染么」）。
 *
 * 这四个面原来只有 textarea——正文是 md 稿子，却以纯源码的样子摊在核心区，
 * 与条目／资料／剧本那几面（早就有阅读态）不是一回事。现在它们与那几面对齐：
 *   1) 阅读态＝源文渲染成 HTML（标题／粗体／列表／引用／代码块…），走同一条 mdRender 路径；
 *   2) 编辑态＝textarea 拿源文（作者改的是源文，不是渲染结果）；
 *   3) 头部一枚「编辑」按钮切过去、「取消」切回来——默认落在阅读态（文档先是一篇文，再是编辑器）。
 */
const chapterHtml = computed(() => renderMarkdown(props.data.draft ?? ''))
const noteHtml = computed(() => renderMarkdown(props.data.noteDraft ?? ''))
const ruleHtml = computed(() => renderMarkdown(props.data.ruleDraft ?? ''))
const outlineNoteHtml = computed(() => renderMarkdown(props.data.outlineDraft?.nodes?.[props.data.outlineNodeIndex]?.note ?? ''))

const chapterEditing = ref(false)
const noteEditing = ref(false)
const outlineEditing = ref(false)
const ruleEditing = ref(false)

// 换一份稿子＝换一篇文：编辑态随之收掉（别把上一份的编辑姿势带到下一份上）。
// 大纲按节点 id 判：把节点上下挪一挪，编辑的还是同一篇，不该把编辑区收走。
watch(() => props.data.chapter?.file ?? null, () => { chapterEditing.value = false })
watch(() => props.data.note?.file ?? null, () => { noteEditing.value = false })
watch(() => props.data.rule?.file ?? null, () => { ruleEditing.value = false })
watch(() => props.data.outlineDraft?.nodes?.[props.data.outlineNodeIndex]?.id ?? null, () => { outlineEditing.value = false })

/**
 * 未落盘的改动（批次43）：自动保存还没跑到时，底部给一句人话。
 * 没有未落盘的改动时这一行整个不出现——文档面上不留常驻噪声。
 */
function pendingText(target) {
  if (!props.data.pendingSave?.[target]) return ''
  const feedback = props.data.saveFeedback
  if (feedback?.target === target && feedback.status === 'saving') return '正在保存…'
  return '未保存的改动'
}

const chapterPending = computed(() => pendingText('chapter'))
const notePending = computed(() => pendingText('note'))
const outlinePending = computed(() => pendingText('outline'))
const rulePending = computed(() => pendingText('rule'))

/**
 * 正文写作动作（批次41 · 对齐老前端写作面）：「续写／改写／扩写／压缩／润色」收在正文下方一条轻量动作带上。
 *
 * 三个约定：
 *   1) 动作带跟着写作面走——正文一聚焦就浮现，离开就收起；只剩「续写」时它也还在，
 *      因为那是写作时最常按的那一下。有产出／生成中／报错时常驻，否则作者会看不到自己刚按出来的东西。
 *   2) 结果不自动落进正文：先摆出来，作者按「插入光标处／替换选中段」才动稿子。
 *      老版就是这个顺序——先看，再决定收不收。
 *   3) 按钮用 mousedown.prevent，点它不会把焦点从 textarea 抢走，光标位置因此不会丢。
 */
const hasDraftSelection = computed(() => {
  const range = props.data.draftSelection
  return Boolean(range && Number(range.end) > Number(range.start))
})
const writingActions = computed(() => availableWritingActions({ hasSelection: hasDraftSelection.value }))
const writingInstruction = ref('')
const editorFocused = ref(false)
const instructionFocused = ref(false)
const writingBarVisible = computed(() => editorFocused.value || instructionFocused.value
  || Boolean(props.data.writingBusy || props.data.writingResult || props.data.writingError))
const writingBusy = computed(() => Boolean(props.data.writingBusy))
const reviewBusy = computed(() => Boolean(props.data.reviewBusy))
const chapterArea = ref(null)

/** 选区上报：正文面每次 select／keyup／mouseup 报一次，动作带据此决定出哪几个按钮。 */
function onDraftSelect(event) {
  const el = event?.target
  if (!el || typeof el.selectionStart !== 'number') return
  props.data.setDraftSelection(el.selectionStart, el.selectionEnd)
}

function startWriting(actionId) {
  if (!actionId) return
  instructionFocused.value = false
  props.data.requestWriting(actionId, writingInstruction.value)
}

/** 审查本章（批次46A）：走 authoring.review.chapter 只读轨，一句固定问句，结果落成下面的卡片。 */
function startReview() {
  instructionFocused.value = false
  props.data.reviewChapter()
}

/** 「转改写」：把这条意见的描述预填进五动作的额外要求，再按改写发出（选区不动）。 */
function reviewIssueToRewrite(issue) {
  const description = String(issue?.message ?? '').trim()
  if (!description) return
  writingInstruction.value = description
  props.data.requestWriting('rewrite', description)
}

function severityLabel(severity) {
  if (severity === 'high') return '高'
  if (severity === 'low') return '低'
  return '中'
}

/**
 * 提示词预览（批次46A）：折叠层按需读主进程留存的最近一次请求。
 * 换了一条结果（落位／丢弃／重新生成）就自动收起——预览永远对着上面那张结果卡。
 */
const writingPreviewOpen = ref(false)
const writingReferenceText = computed(() => (Array.isArray(props.data.writingResult?.references)
  ? props.data.writingResult.references
    .map((item) => `${referenceLabel(item.kind)} ${item.chars} 字`)
    .join(' · ')
  : ''))
watch(() => props.data.writingResult, (value) => {
  if (!value) writingPreviewOpen.value = false
})
async function toggleWritingPreview() {
  writingPreviewOpen.value = !writingPreviewOpen.value
  if (writingPreviewOpen.value) await props.data.loadWritingPreview()
}

/** 落位后把光标放回正文（caret 由 applyWritingResult 算好）：作者接着往下写，不用再点一下。 */
watch(() => [props.data.draftSelection?.start, props.data.draftSelection?.end], async () => {
  const start = Number(props.data.draftSelection?.start ?? 0)
  const end = Number(props.data.draftSelection?.end ?? start)
  await nextTick()
  const el = chapterArea.value
  if (!el || document.activeElement !== el) return
  if (el.selectionStart !== start || el.selectionEnd !== end) el.setSelectionRange(start, end)
})

/**
 * 记录型载体（批次40 · M4／M5）：中间这条记录详情／编辑面由 pane id 首段认出是哪一栏。
 * 类型与状态用清单里的建议值做下拉；遇到老数据里的陌生值，把它原样加进选项——
 * 不做「读得到但一保存就被洗成默认值」那种事。
 */
const recordCarrier = computed(() => recordCarrierOfPaneId(props.pane?.id))
const recordTags = computed(() => (Array.isArray(props.data.record?.tags) ? props.data.record.tags : []))
const recordRefs = computed(() => (Array.isArray(props.data.record?.refs) ? props.data.record.refs : []))
const recordMetaCount = computed(() => {
  const meta = props.data.record?.meta
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? Object.keys(meta).length : 0
})
const recordTypeOptions = computed(() => withCurrent(recordCarrier.value?.types, props.data.recordDraft?.type))
const recordStatusOptions = computed(() => withCurrent(recordCarrier.value?.statuses, props.data.recordDraft?.status))
function withCurrent(list, current) {
  const out = [...(Array.isArray(list) ? list : [])]
  const value = String(current ?? '').trim()
  if (value && !out.includes(value)) out.push(value)
  return out
}

/** 删除的两步确认：第一下只把按钮文案换成「确认删除」，换一条记录或再点一下才真的删。 */
const recordDeleteArmed = ref(false)
watch(() => props.data.record?.id, () => {
  recordDeleteArmed.value = false
})
function askRemoveRecord() {
  if (!recordDeleteArmed.value) {
    recordDeleteArmed.value = true
    return
  }
  recordDeleteArmed.value = false
  void props.data.removeRecord()
}
const proposalCurrentHtml = computed(() => renderMarkdown(props.data.proposalChapter?.text ?? '（目标章还没读到）'))
const proposalDraftHtml = computed(() => renderMarkdown(props.data.proposal?.content ?? ''))

/**
 * Wiki 双链与反向链接（批次38）：条目阅读态里其它条目的名字包成可点链接。
 * 批次44 整块搬进了 EntryDetailPanel——词表与解析器现在共用一张表，
 * 不会再出现「染成蓝色却点不动」的链接（作者 2026-10-31：「看着能跳转，但是其实不行」）。
 */

/** 提案头部的时刻：模型写这一版提案的时间（精确到分钟），解析不了就退回原话。 */
function stampOf(value) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) return String(value ?? '')
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 条目那一面的摘要预览、关系、meta 行都搬进了 EntryDetailPanel（批次44）。 */

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
 * 批次31（P18）起 chip 是保存的唯一常驻形态：大纲与条目的常驻「保存」按钮已拆净（双通道收成单通道）。
 */
const SAVE_TARGET_BY_VIEW = {
  'chapter-editor': 'chapter',
  'notes-editor': 'note',
  'outline-editor': 'outline',
  'rule-editor': 'rule',
  'document-detail': 'document',
  'script-editor': 'script',
  'records-editor': 'record',
  'entry-detail': 'entry',
  // 看板区（批次44）：上图表列、下详情，详情里那条条目仍是同一个保存目标。
  'entries-workspace': 'entry'
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
  // 自动保存的那一下只说「已保存」：版本号是开发者信息，作者要的是「落盘了没有」。
  if (chip.status === 'saved') return chip.auto ? '已保存' : `已保存 · 第 ${chip.revision} 版`
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
  // 批次28：大纲节点备注（textarea.outline-note）同样属于大纲草稿，按 Ctrl+S 落整份保存。
  if (!event.target?.matches?.('textarea.editor-area, textarea.entry-meta-summary, textarea.outline-note, input.outline-title')) return
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
    case 'records-editor': return props.data.editingRecord ? props.data.saveRecord() : undefined
    case 'entry-detail': return props.data.editingEntry ? props.data.saveEntry() : undefined
    case 'entries-workspace': return props.data.editingEntry ? props.data.saveEntry() : undefined
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
  if (target === 'record' && props.data.record) {
    // 记录：先重列拿到最新文档修订号，再按 id 重读；不做静默合并。
    const carrier = props.data.record.carrier
    const id = props.data.record.id
    await props.data.loadRecords(carrier, { syncCurrent: false })
    const item = props.data.recordSets?.[carrier]?.records?.find((candidate) => candidate.id === id)
    if (item) await props.data.openRecord(carrier, item)
    return
  }
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

/**
 * 条目信息折叠层（批次31 · P18 第 4 条）整块搬进了 EntryDetailPanel（批次44）。
 */
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
        <div class="doc-head">
          <h2 class="doc-title">{{ data.chapter.title }}</h2>
          <span class="nx-pane-actions">
            <span v-if="chipVisible && saveChip" class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
            <!-- 阅读态／编辑态（批次43）：默认是读（md 渲染过的一篇文），要改就按这一枚「编辑」。 -->
            <button v-if="!chapterEditing" type="button" class="control-secondary chapter-edit" data-test="chapter-edit" @click="chapterEditing = true">编辑</button>
            <button v-else type="button" class="control-quiet chapter-cancel" data-test="chapter-cancel" @click="chapterEditing = false">取消</button>
          </span>
        </div>
        <!-- 阅读态（批次43）：正文是 md 稿子，默认渲染出来（标题／粗体／列表…），不再是裸源码。 -->
        <div v-if="!chapterEditing" class="entry-text nx-rendered-md doc-reading chapter-reading" data-test="chapter-rendered" v-html="chapterHtml" />
        <textarea
          v-else
          ref="chapterArea"
          class="editor-area"
          :value="data.draft"
          spellcheck="false"
          aria-label="正文编辑器"
          @input="data.setDraft($event.target.value)"
          @focus="editorFocused = true"
          @blur="editorFocused = false"
          @select="onDraftSelect"
          @keyup="onDraftSelect"
          @mouseup="onDraftSelect"
        />
        <!-- 写作动作带（批次41）：正文一聚焦就浮现，离开就收起。按钮不抢焦点（mousedown.prevent），
             所以「选中一段 → 按改写」之后光标与选区都还在原处。 -->
        <div v-if="writingBarVisible" class="nx-writing-bar" data-test="writing-bar">
          <span class="nx-writing-actions">
            <button
              v-for="action in writingActions"
              :key="action.id"
              type="button"
              class="control-quiet nx-writing-action"
              :data-test="`writing-${action.id}`"
              :disabled="writingBusy"
              @mousedown.prevent
              @click="startWriting(action.id)"
            >{{ action.label }}</button>
          </span>
          <!-- 审查本章（批次46A）：同一排动作里的只读项——它不改正文，只把意见摆出来。 -->
          <button
            type="button"
            class="control-quiet nx-writing-review"
            data-test="writing-review"
            :disabled="writingBusy || reviewBusy"
            @mousedown.prevent
            @click="startReview"
          >审查本章</button>
          <input
            v-model="writingInstruction"
            class="nx-writing-ask"
            type="text"
            maxlength="500"
            spellcheck="false"
            placeholder="这次的要求（可不填）"
            aria-label="写作动作的额外要求"
            data-test="writing-instruction"
            @focus="instructionFocused = true"
            @blur="instructionFocused = false"
            @keydown.enter.prevent="startWriting(writingActions[0]?.id)"
          >
          <span v-if="writingBusy" class="nx-writing-busy" role="status">正在写…</span>
          <span v-else-if="hasDraftSelection" class="nx-writing-hint">
            已选中 {{ data.draftSelection.end - data.draftSelection.start }} 字
          </span>
        </div>
        <!-- 生成结果先摆出来，不自动落进正文：作者按「插入／替换」才动稿子。 -->
        <div v-if="data.writingResult" class="nx-writing-result" data-test="writing-result">
          <div class="nx-writing-result-head">
            <span class="nx-writing-result-label">{{ data.writingResult.label }} · 还没落进正文</span>
            <span class="nx-writing-actions">
              <button
                type="button"
                class="control-secondary nx-writing-apply"
                data-test="writing-apply"
                @mousedown.prevent
                @click="data.applyWriting()"
              >{{ data.writingResult.target === 'replace' ? '替换选中段' : '插入光标处' }}</button>
              <button
                type="button"
                class="control-quiet nx-writing-discard"
                data-test="writing-discard"
                @mousedown.prevent
                @click="data.discardWriting()"
              >丢弃</button>
            </span>
          </div>
          <div class="nx-writing-text">{{ data.writingResult.text }}</div>
          <!-- 参考块清单（批次46A）：这次用的是哪几块、各多少字；参考缺席时把原因照原话摊开。 -->
          <p
            v-if="writingReferenceText || data.writingResult.referenceNote"
            class="nx-writing-refs"
            data-test="writing-references"
          >{{ writingReferenceText || data.writingResult.referenceNote }}</p>
          <!-- 提示词预览（批次46A）：只读展示主进程留存的那一份，不实时、不跨项目。 -->
          <div class="nx-writing-preview">
            <button
              type="button"
              class="control-quiet nx-writing-preview-toggle"
              data-test="writing-preview-toggle"
              @mousedown.prevent
              @click="toggleWritingPreview"
            >{{ writingPreviewOpen ? '收起提示词' : '查看提示词' }}</button>
            <div v-if="writingPreviewOpen" class="nx-writing-preview-body" data-test="writing-preview">
              <p v-if="data.writingPreviewError" class="nx-writing-error nx-writing-preview-error" data-test="writing-preview-error">{{ data.writingPreviewError }}</p>
              <template v-else-if="data.writingPreview">
                <div class="nx-writing-preview-label">系统提示词</div>
                <pre class="nx-writing-preview-text" data-test="writing-preview-system">{{ data.writingPreview.systemPrompt }}</pre>
                <div class="nx-writing-preview-label">用户提示词</div>
                <pre class="nx-writing-preview-text" data-test="writing-preview-user">{{ data.writingPreview.userPrompt }}</pre>
              </template>
              <p v-else class="nx-writing-preview-wait">正在读取最近一次请求…</p>
            </div>
          </div>
        </div>
        <p v-if="data.writingError" class="nx-writing-error" data-test="writing-error">{{ data.writingError }}</p>
        <!-- 审查本章（批次46A）：摘要／问题／动作三层，问题可「转改写」；
             结果不落正文、不进会话存储——这一栏收起就没了。 -->
        <div v-if="reviewBusy || data.reviewResult || data.reviewError" class="nx-review" data-test="review-panel">
          <div v-if="reviewBusy" class="nx-review-busy" role="status" data-test="review-busy">正在审查本章…</div>
          <template v-else-if="data.reviewResult">
            <div class="nx-review-head">
              <span class="nx-review-label">本章审查</span>
              <button type="button" class="control-quiet nx-review-close" data-test="review-discard" @mousedown.prevent @click="data.discardReview()">收起</button>
            </div>
            <p v-if="data.reviewResult.summary" class="nx-review-summary" data-test="review-summary">{{ data.reviewResult.summary }}</p>
            <ol v-if="data.reviewResult.issues.length" class="nx-review-issues">
              <li v-for="(issue, index) in data.reviewResult.issues" :key="`${issue.message}-${index}`" class="nx-review-issue" data-test="review-issue">
                <span class="nx-review-severity" :class="`is-${issue.severity}`">{{ severityLabel(issue.severity) }}</span>
                <span class="nx-review-issue-text">{{ issue.message }}</span>
                <button type="button" class="control-quiet nx-review-rewrite" data-test="review-issue-rewrite" @mousedown.prevent @click="reviewIssueToRewrite(issue)">转改写</button>
              </li>
            </ol>
            <ul v-if="data.reviewResult.actions.length" class="nx-review-actions">
              <li v-for="(action, index) in data.reviewResult.actions" :key="`${action}-${index}`" data-test="review-action">{{ action }}</li>
            </ul>
          </template>
          <p v-if="data.reviewError" class="nx-writing-error nx-review-error" data-test="review-error">{{ data.reviewError }}</p>
        </div>
        <!-- 底部只留作者用得上的信息（批次43）：有没有没落盘的改动、是不是只载入了前段。
             路径 · 第 N 版 · N 字 这些是开发者信息，作者看不见也不需要（作者 2026-10-31）。 -->
        <p v-if="chapterPending || data.chapter.truncated" class="doc-meta-hint">
          {{ chapterPending }}<em v-if="data.chapter.truncated">只载入了前段（全文 {{ data.chapter.totalChars }} 字）：自动保存不会动它</em>
        </p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一章，或在那里新建一章。</p>
    </template>

    <!-- 构思速记编辑面（工单B1）：照章节编辑器的形态。正文来自 pinax_notes_list 的随手带回，
         保存走载体自有的 pinax_notes_save（带修订号，冲突如实摊开）。 -->
    <template v-else-if="viewKind === 'notes-editor'">
      <div v-if="data.note" class="editor">
        <div class="doc-head">
          <h2 class="doc-title">{{ data.note.title }}</h2>
          <span class="nx-pane-actions">
            <span v-if="chipVisible && saveChip" class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
            <button v-if="!noteEditing" type="button" class="control-secondary note-edit" data-test="note-edit" @click="noteEditing = true">编辑</button>
            <button v-else type="button" class="control-quiet note-cancel" data-test="note-cancel" @click="noteEditing = false">取消</button>
          </span>
        </div>
        <!-- 阅读态（批次43）：速记也是 md 稿子，默认渲染出来。 -->
        <div v-if="!noteEditing" class="entry-text nx-rendered-md doc-reading note-reading" data-test="note-rendered" v-html="noteHtml" />
        <textarea
          v-else
          class="editor-area"
          :value="data.noteDraft"
          spellcheck="false"
          aria-label="构思编辑器"
          @input="data.setNoteDraft($event.target.value)"
        />
        <p v-if="notePending || data.note.truncated" class="doc-meta-hint">
          {{ notePending }}<em v-if="data.note.truncated">只载入了前段：自动保存不会动它</em>
        </p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一篇构思，或用索引窗「构思」区的 ＋ 新建一篇。</p>
    </template>

    <!-- 大纲编辑面（工单B2 → 批次31 · P18）：中栏只剩文档本身。
         节点标题是一行无边框大字，备注是标题下面的第二行无框文字——不再是一个框把内容装进去。
         节点操作（上移／下移／删除／加同级／加子节点）整排退到索引窗大纲行的右键菜单，
         树区标题行的「＋」在末尾追一个同级节点；改完自动落盘，Ctrl+S 可立刻存，结果只进头部 chip。 -->
    <template v-else-if="viewKind === 'outline-editor'">
      <div v-if="data.outlineDraft" class="editor">
        <!-- 头部只有一行标题（批次33）：大纲文档的名字就是节点标题本身（可改的那枚输入框），
             右端留保存 chip；批次43 起这一行还担着「编辑／取消」——读态是标题＋渲染出来的备注。 -->
        <div class="doc-head">
          <input
            v-if="outlineEditing"
            class="doc-title outline-title"
            :value="data.outlineDraft.nodes[data.outlineNodeIndex]?.title ?? ''"
            spellcheck="false"
            aria-label="大纲节点标题"
            title="改名、备注、增删与排序都先记在草稿上，改完自动落盘（Ctrl+S 可立刻存）"
            @input="data.setOutlineNodeTitle(data.outlineNodeIndex, $event.target.value)"
          >
          <h2 v-else class="doc-title" data-test="outline-reading-title">{{ data.outlineDraft.nodes[data.outlineNodeIndex]?.title ?? '' }}</h2>
          <span class="nx-pane-actions">
            <span v-if="chipVisible && saveChip" class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
            <button v-if="!outlineEditing" type="button" class="control-secondary outline-edit" data-test="outline-edit" @click="outlineEditing = true">编辑</button>
            <button v-else type="button" class="control-quiet outline-cancel" data-test="outline-cancel" @click="outlineEditing = false">取消</button>
          </span>
        </div>
        <!-- 阅读态（批次43）：节点备注是 md，渲染出来；标题就在头部那一行。 -->
        <div v-if="!outlineEditing" class="entry-text nx-rendered-md doc-reading outline-reading" data-test="outline-rendered" v-html="outlineNoteHtml" />
        <!-- 节点备注（批次28 · 工单1c）：这一节要写什么，一句话；note 是节点上的普通字段，
             随整份草稿保存走（工具原样透传，不需要改合同）。批次31 起无边框，是标题下的第二行。 -->
        <textarea
          v-else
          class="doc-field outline-note"
          :value="data.outlineDraft.nodes[data.outlineNodeIndex]?.note ?? ''"
          maxlength="200"
          rows="2"
          placeholder="这一节要写什么（一句话）"
          spellcheck="false"
          aria-label="大纲节点备注（最多 200 字）"
          @input="data.setOutlineNodeNote(data.outlineNodeIndex, $event.target.value)"
        />
        <p v-if="outlinePending" class="doc-meta-hint">{{ outlinePending }}</p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一个大纲节点。</p>
    </template>

    <!-- 提案审阅面（工单A）：模型改稿落在 .pinax/proposals/，这里做最后一道人审。
         上下两段是同一章的两个版本（当前正文／提案新文），不逐句 diff——历史面板已有 diff 能力，后续复用。
         采纳＝按此刻的章节修订号走载体 save（写入为新一版），弃用＝删提案文件；两者都不静默合并。 -->
    <template v-else-if="viewKind === 'proposal-review'">
      <div v-if="data.proposal" class="editor proposal-review">
        <!-- 头部同样归一（批次33）：一行标题「提案审阅 · 文件名」，meta 沉到正文之下。
             两版对照的框保留（P18 第 5 条豁免：两份文档需要视觉分隔）。 -->
        <div class="doc-head">
          <h2 class="doc-title">提案审阅 · {{ data.proposal.name ?? data.proposal.target?.file ?? '提案' }}</h2>
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
          <!-- 面板型界面（P18 第 5 条豁免）：两版对照需要视觉分隔，采纳／弃用留在审阅面的动作行。
               批次31：文档面已无常驻主按钮，这两枚也退回次级控件词汇（不复用主操作皮）。 -->
          <button
            type="button"
            class="pane-btn proposal-adopt control-secondary"
            :disabled="data.busy || !data.proposal.content"
            @click="data.adoptProposal()"
          >
            {{ data.busy ? '写入中…' : '采纳（写入为新一版）' }}
          </button>
          <button type="button" class="control-quiet proposal-discard" :disabled="data.busy" @click="data.discardProposal()">弃用</button>
        </div>
        <p v-if="data.proposal.status === 'adopted'" class="pane-hint">这条提案已经采纳过；再采纳会按当前章节版本重新写入一版。</p>
        <p class="doc-meta-hint">
          {{ data.proposal.target?.file ?? '（没有目标章）' }} · {{ data.proposal.contentChars ?? (data.proposal.content?.length ?? 0) }} 字 · {{ stampOf(data.proposal.createdAt) }}
        </p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗的「提案」区选一条。</p>
    </template>

    <!-- 约束编辑面（工单E2）：照构思速记的同一形态。正文来自 pinax_rule_list 的随手带回，
         保存走载体自有的 pinax_rule_save（带修订号，冲突如实摊开）。 -->
    <template v-else-if="viewKind === 'rule-editor'">
      <div v-if="data.rule" class="editor">
        <div class="doc-head">
          <h2 class="doc-title">{{ data.rule.title }}</h2>
          <span class="nx-pane-actions">
            <span v-if="chipVisible && saveChip" class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
            <button v-if="!ruleEditing" type="button" class="control-secondary rule-edit" data-test="rule-edit" @click="ruleEditing = true">编辑</button>
            <button v-else type="button" class="control-quiet rule-cancel" data-test="rule-cancel" @click="ruleEditing = false">取消</button>
          </span>
        </div>
        <!-- 阅读态（批次43）：约束也是 md 稿子，默认渲染出来。 -->
        <div v-if="!ruleEditing" class="entry-text nx-rendered-md doc-reading rule-reading" data-test="rule-rendered" v-html="ruleHtml" />
        <textarea
          v-else
          class="editor-area"
          :value="data.ruleDraft"
          spellcheck="false"
          aria-label="约束编辑器"
          @input="data.setRuleDraft($event.target.value)"
        />
        <p v-if="rulePending || data.rule.truncated" class="doc-meta-hint">
          {{ rulePending }}<em v-if="data.rule.truncated">只载入了前段：自动保存不会动它</em>
        </p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗的「约束」区选一份约束，或用那里的 ＋ 新建一份。</p>
    </template>

    <!-- 条目详情面（批次44：整块搬进 EntryDetailPanel——看板区要能单独摆它，
         蓝色双链的词表与解析器也在那边合成了一张表）。 -->
    <template v-else-if="viewKind === 'entry-detail'">
      <EntryDetailPanel
        :data="data"
        :chip="saveChip"
        :chip-visible="chipVisible"
        :chip-stale="saveChipStale"
        :chip-text="saveChipText"
        @chip-action="actOnSaveChip"
      />
    </template>

    <!-- 世界书看板区（批次44 · 作者 2026-10-31：「上面放图表列，下面放详情信息」）。
         上＝图表列（列表／表格／图谱＋筛选），下＝选中条目的详情；
         窄栏退成类别导航树，点类别＝给这块看板区加一道筛选（同一格状态）。 -->
    <template v-else-if="viewKind === 'entries-workspace'">
      <div class="nx-entries-workspace" data-test="entries-workspace">
        <div class="nx-entries-workspace-board">
          <EntriesBoard
            :data="data"
            :project-root="projectRoot"
            @history="emit('history', { type: 'entry', item: $event })"
          />
        </div>
        <div class="nx-entries-workspace-detail">
          <EntryDetailPanel
            :data="data"
            :chip="saveChip"
            :chip-visible="chipVisible"
            :chip-stale="saveChipStale"
            :chip-text="saveChipText"
            empty-hint="从上面的图表列里选一条条目。"
            @chip-action="actOnSaveChip"
          />
        </div>
      </div>
    </template>

    <!-- 应用面（批次44 · 作者 2026-10-31：「后续假如我们真的要把 ComfyUI 挪进来，
         那一定是要通过浏览器去把这个端口承载起来，而不可能说我们自己手搓一个组件」）。
         外部应用不手搓：宿主给一块 iframe，端口那个页面自己长什么样就是什么样。 -->
    <template v-else-if="viewKind === 'external-app'">
      <ExternalAppHost :pane="pane" :data="data" />
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
        <div class="doc-head">
          <h2 class="doc-title">{{ data.document.title }}</h2>
          <span class="nx-pane-actions">
            <span v-if="chipVisible && saveChip" class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
            <button v-if="!data.editingDocument" type="button" class="control-secondary document-edit" @click="data.editDocument()">编辑</button>
            <!-- 取消退到头部右端（P18 第 2 条）：底部不再留按钮行。 -->
            <button v-else type="button" class="control-quiet document-cancel" :disabled="data.busy" @click="data.cancelEditDocument()">取消</button>
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
        <div class="doc-head">
          <h2 class="doc-title">{{ data.script.title }}</h2>
          <span class="nx-pane-actions">
            <span v-if="chipVisible && saveChip" class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
            <button v-if="!data.editingScript" type="button" class="control-secondary script-edit" @click="data.editScript()">编辑</button>
            <!-- 取消退到头部右端（P18 第 2 条）：底部不再留按钮行。 -->
            <button v-else type="button" class="control-quiet script-cancel" :disabled="data.busy" @click="data.cancelEditScript()">取消</button>
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
        <p v-if="data.script.truncated" class="pane-notice">
          只载入了前 {{ data.script.text?.length ?? 0 }} 字，全篇 {{ data.script.totalChars }} 字：保存会覆盖未载入的部分。
        </p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一篇剧本，或在那里新建一篇。</p>
    </template>

    <!-- 记录型载体（批次40 · M4／M5）：素材／漫画／视频／体验／联机共用这条详情面。
         阅读态＝md 渲染正文＋标签／引用／类型状态；编辑态＝标题、类型、状态、标签、引用与正文。
         Ctrl+S 与头部「保存」走同一个 saveRecord；meta 不在界面上拆，但保存时原样带回。
         删除是两步确认：第一下只换文案，换一条记录即复位。 -->
    <template v-else-if="viewKind === 'records-editor'">
      <div v-if="data.record && recordCarrier" class="entry-body">
        <div class="doc-head">
          <h2 class="doc-title">{{ data.record.title || data.record.id }}</h2>
          <span class="nx-pane-actions">
            <span v-if="chipVisible && saveChip" class="nx-save-chip" :class="`is-${saveChip.status}`" role="status" aria-label="保存状态">
              <span class="nx-save-chip-state">{{ saveChipText }}</span>
              <button v-if="saveChip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="actOnSaveChip">{{ saveChipStale ? '重新载入' : '重试' }}</button>
              <span v-if="saveChipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
            </span>
            <template v-if="data.editingRecord">
              <button type="button" class="control-secondary records-save" :disabled="data.busy" @click="data.saveRecord()">保存</button>
              <button type="button" class="control-quiet records-cancel" :disabled="data.busy" @click="data.cancelEditRecord()">取消</button>
            </template>
            <template v-else>
              <button type="button" class="control-secondary records-edit" @click="data.editRecord()">编辑</button>
              <button type="button" class="control-quiet records-remove" :disabled="data.busy" @click="askRemoveRecord()">{{ recordDeleteArmed ? '确认删除' : '删除' }}</button>
            </template>
          </span>
        </div>
        <div v-if="data.editingRecord" class="entry-meta-edit records-form">
          <label class="entry-meta-field">
            <span class="entry-meta-label">标题</span>
            <input
              class="nx-field"
              :value="data.recordDraft.title"
              spellcheck="false"
              aria-label="记录标题"
              @input="data.setRecordField('title', $event.target.value)"
            >
          </label>
          <label class="entry-meta-field">
            <span class="entry-meta-label">类型</span>
            <select class="nx-field" :value="data.recordDraft.type" aria-label="记录类型" @change="data.setRecordField('type', $event.target.value)">
              <option v-for="option in recordTypeOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="entry-meta-field">
            <span class="entry-meta-label">状态</span>
            <select class="nx-field" :value="data.recordDraft.status" aria-label="记录状态" @change="data.setRecordField('status', $event.target.value)">
              <option v-for="option in recordStatusOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </label>
          <label class="entry-meta-field">
            <span class="entry-meta-label">标签</span>
            <input
              class="nx-field"
              :value="data.recordDraft.tags"
              spellcheck="false"
              placeholder="逗号分隔"
              aria-label="记录标签（逗号分隔）"
              @input="data.setRecordField('tags', $event.target.value)"
            >
          </label>
          <label class="entry-meta-field is-summary">
            <span class="entry-meta-label">引用</span>
            <textarea
              class="nx-field"
              :value="data.recordDraft.refs"
              rows="2"
              spellcheck="false"
              placeholder="一行一条：相对路径或外链"
              aria-label="记录引用（一行一条）"
              @input="data.setRecordField('refs', $event.target.value)"
            />
          </label>
        </div>
        <textarea
          v-if="data.editingRecord"
          class="editor-area"
          :value="data.recordDraft.body"
          spellcheck="false"
          aria-label="记录正文编辑器"
          @input="data.setRecordField('body', $event.target.value)"
        />
        <div v-else class="entry-text nx-rendered-md" aria-label="记录正文" v-html="recordHtml" />
        <p v-if="!data.editingRecord && recordTags.length" class="pane-hint">标签：{{ recordTags.join('、') }}</p>
        <p v-if="!data.editingRecord && recordRefs.length" class="pane-hint">引用：{{ recordRefs.join(' · ') }}</p>
        <p v-if="!data.editingRecord && recordMetaCount" class="pane-hint">这条记录还带着 {{ recordMetaCount }} 项载体私有字段（原样保存，界面不拆）。</p>
        <p v-if="data.record.type || data.record.status" class="doc-meta-hint">{{ data.record.type || '未分类' }} · {{ data.record.status || '无状态' }}</p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一条{{ recordCarrier?.title ?? '记录' }}，或在那里新建一条。</p>
    </template>

    <!-- 自带面板（协议 v3 的 entry 面）：内容面是插件自己的页面，宿主只给一块沙箱 iframe
         （sandbox=allow-scripts，无 allow-same-origin）＋一条只读工具桥。 -->
    <template v-else-if="viewKind === 'custom-panel'">
      <PluginPanelHost
        :entry="pane.entry"
        :plugin-id="pane.pluginId ?? ''"
        :title="pane.pluginTitle ?? ''"
      />
    </template>

    <!-- 只在真的没有对应视图时才显示（批次15 验收修：原来挂在第二条链的 v-else 上，
         提案审阅态会误把占位文案渲染在审阅面之下）。 -->
    <p v-else-if="viewKind === 'placeholder'" class="pane-note">
      「{{ pane.pluginTitle }}」这块板块的面板视图还没做出来。它的工具和上下文块照常可用——先在右栏问 Pi-Agent。<span v-if="viewPlaceholderReason">（{{ viewPlaceholderReason }}）</span>
    </p>
  </div>
</template>

<style scoped>
/* 提案审阅（工单A）：两段上下堆叠，各自独立滚动——长章不会把「采纳」按钮顶到看不见的地方。
   颜色／字号／圆角一律走老前端 token（门禁见 next/tests/visual-contract.test.mjs）。
   批次31（P18 第 5 条）：两版对照属于面板型界面，框留着（两份文档需要视觉分隔），只把外框收窄
   ——内边距与标签间距各收一档，正文占的位置多回来一点。 */
.proposal-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.proposal-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
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

/* 条目信息折叠层（批次31 · P18 第 4 条）：默认只有一行「▸ 条目信息 关键词 1 · 关系 0」，
   点开才在正文之上摊开字段（照 Obsidian properties）。收起态的行高与正文行距同一档，
   展开后字段仍走 .nx-field primitive，这里只调排布。 */
.entry-meta-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.entry-meta-toggle {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 4px;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.entry-meta-toggle:hover,
.entry-meta-toggle:focus-visible {
  color: var(--archive-ink);
}
.entry-meta-caret {
  width: 1em;
  text-align: center;
}
.entry-meta-hint {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
/* 条目元数据行（工单C）：关键词／标签两栏并列。输入沿用 .nx-field primitive
   （颜色／圆角／字号都由它带），这里只调排布，不另起一套控件度量。 */
.entry-meta-edit {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
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
/* 裸 md（没有 frontmatter）的说明：编辑态里的一句话，不再是带 .pane-hint 的常驻提示行
   ——它说的是「为什么没有元数据」，属于这条条目的属性，不是操作提示。 */
.entry-meta-bare {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  line-height: 1.7;
  color: var(--text-muted);
}

/* 关系区（批次28 · 工单2b）：整行独占，一行一条；输入仍是 .nx-field primitive，这里只调排布。
   目标／类型／立场三栏按 1.2 : 1 : 1 分宽，暗线是复选框＋小字，删行收在行尾。 */
.entry-relations {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
.entry-relation-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}
.entry-relation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.entry-relation-row .nx-field {
  flex: 1 1 120px;
  width: auto;
  min-height: 32px;
  padding: 6px 10px;
}
.entry-relation-row .entry-relation-target {
  flex-grow: 1.2;
}
.entry-relation-covert {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  white-space: nowrap;
}
.entry-relation-remove {
  flex: none;
  min-height: 28px;
  padding: 0 8px;
  font-size: var(--nx-fs-2xs);
}
.entry-relation-add {
  align-self: flex-start;
  min-height: 28px;
  padding: 0 10px;
  font-size: var(--nx-fs-2xs);
}

/* 阅读态的关系行：一条一行，前缀点做得比正文轻，不抢正文的注意力。 */
.entry-relations-read {
  margin: 0 0 8px;
  padding-inline-start: 1.2em;
  font-size: var(--nx-fs-2xs);
  line-height: 1.7;
  color: var(--text-muted);
}

/* 大纲节点备注（批次28 · 工单1c → 批次31 P18）：标题下的第二行无框文字，
   度量随 .doc-field（底色／描边／圆角都不画），这里只给高度与不随窗格缩放的手感。 */
.outline-note {
  min-height: 48px;
  line-height: 1.7;
  resize: none;
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
