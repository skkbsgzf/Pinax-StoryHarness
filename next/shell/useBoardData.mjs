import { reactive } from 'vue'
import { IPC_CHANNELS } from './ipcContract.mjs'

/**
 * 板块数据（章节／大纲／构思／条目／约束／资料）的单一归属。
 *
 * 索引窗列的是它、核心区写的也是它——分成两份就会不同步（正文存了第 2 版，索引窗还写着第 1 版）。
 * 所以外壳里凡是碰这块数据的组件都拿同一个对象，不各自取数。
 *
 * 取数只有一条路：runtimeToolCall。渲染层拿不到文件服务，也拿不到载体实现，
 * 因此每一次读盘都必然过载体自己的 scope 与修订号并发闸（不存在「界面绕过合同写文件」这条路）。
 */
export function useBoardData(bridge) {
  const state = reactive({
    busy: false,
    /** 文档级提示：读章节／读条目／保存的结果摊在核心区。 */
    error: null,
    notice: '',
    /** 保存反馈（工单H1）：编辑面头部的保存 chip 只读这一格。
     *  target 是 chapter／note／outline／rule／document／entry——chip 只在该编辑面上出现；
     *  status 三态 saving／saved／error，只有 saved 由界面安排 2.5 秒后收起（失败常驻）。
     *  保存语义（expectedRevision／提案链）不在这里动，这里只记「这一下按下去的结果」。
     *  大纲与条目（批次19 H1 收尾）：保留各自的常驻保存按钮，同时接 Ctrl+S——两通道落的是同一格反馈。 */
    saveFeedback: null,
    /** 资料板检索（工单H2）：走 knowledge:search 通道，主进程内部是 createKnowledgeRuntime（worker 线程）。
     *  knowledgeSearched 只用来区分「还没检索」与「检索完没命中」；错误码留给界面翻人话。 */
    knowledgeSearching: false,
    knowledgeSearched: false,
    knowledgeResults: [],
    knowledgeCoverage: null,
    knowledgeError: null,
    /** 树级提示：列目录失败摊在索引窗（与文档级分开，免得作者分不清是哪一步说的话）。 */
    treeError: null,
    chapters: [],
    /** 卷→章两级（工单B）：正文/ 下的一级子目录＝卷；{ name, chapters[] }，平铺数据只有一个无名组
     *  （name:''，IndexWindow 不画卷标题，渲染与旧版平铺列表一致）。chapters 仍是扁平全集，
     *  openChapter／修订号推进／提案采纳都按 file 定位，不依赖分组。 */
    chapterGroups: [],
    chapter: null,
    draft: '',
    /** 大纲（工单A3 只读树 → 工单B2 可编辑）：索引窗的第三棵树。
     *  草稿是整份文档的深拷贝（大纲保存＝整份覆盖）：改名/新增都先落在 outlineDraft 上，按保存才写盘。 */
    outline: [],
    outlineEdges: [],
    outlineRevision: null,
    outlineDraft: null,
    outlineNodeIndex: null,
    outlineError: null,
    /** 构思速记（工单B1）：索引窗的第四棵树，可点开编辑；与章节各拿各的草稿与错误位。 */
    notes: [],
    note: null,
    noteDraft: '',
    notesError: null,
    /** 约束（工单E2）：设定板的第二棵树，与构思速记同一形态（列表带回全文、自有 save 带修订号）。 */
    rules: [],
    rule: null,
    ruleDraft: '',
    rulesError: null,
    /** 资料（工单G1）：资料板的树（泛型项目里它就是主树）。列表只带回前 20000 字，
     *  点开时再走 pinax_document_read 取全文——资料可能很长，草稿不能建立在一份截断文本上。
     *  编辑态与条目一样是显式开关（阅读态 pre／编辑态 textarea），取消原样退回。 */
    documents: [],
    document: null,
    documentDraft: '',
    documentsError: null,
    editingDocument: false,
    /** 提案审阅（工单A）：.pinax/proposals/ 里的模型改稿。
     *  proposals＝列表摘要；proposal＝点开的那份整份 JSON；proposalChapter＝目标章此刻的正文（左右对照用）。
     *  采纳仍走载体 save（带当前修订号），外壳不自己拼一份「采纳后」的正文。 */
    proposals: [],
    /** 运行时轨写下的纯文本散件（kind:'raw'）：不当成可审阅提案，但在提案审阅节里如实报数。 */
    proposalRaw: [],
    proposal: null,
    proposalChapter: null,
    proposalWarnings: [],
    proposalsError: null,
    entries: [],
    entry: null,
    /** 条目编辑（工单A2）：阅读态与编辑态的开关＋草稿，与正文的 draft 分开各拿各的。 */
    editingEntry: false,
    entryDraft: '',
    /** 条目元数据草稿（工单C／收口包②）：frontmatter 的 keys／tags 在界面上是逗号分隔字符串，
     *  保存时再拆成数组随 pinax_worldbook_save 的 meta 传（裸 md 没有 frontmatter，不进这三栏）。
     *  summary 是原样的字符串：空串＝清空（与工具 schema 的「传空串清空」同一口径），不在这里做截断。 */
    entryMetaDraft: { keys: '', tags: '', summary: '' },
    listWarnings: [],
    entryWarnings: [],
    selection: { type: null, item: null }
  })

  /** 资料板检索的请求序号：换板/清空后旧请求晚到的结果不再覆盖新状态。 */
  let knowledgeCallId = 0

  /** 只经一条通道：内核/载体返回的 {ok:false,code,message} 一律变成界面可见的话，不吞错。 */
  async function tool(name, args = {}) {
    if (!bridge?.request) return { ok: false, message: '渲染层未接主进程桥（preload 的 pinaxNext 通道）。' }
    const result = await bridge.request(IPC_CHANNELS.runtimeToolCall, { tool: name, args })
    if (!result.ok) return { ok: false, message: result.error?.message ?? `通道 ${name} 调用失败`, code: result.error?.code }
    const payload = result.value?.payload ?? {}
    if (payload.ok === false) return { ok: false, message: payload.message ?? `${name} 被拒绝`, code: payload.code, details: payload.details }
    return { ok: true, value: payload, owner: result.value?.owner ?? 'kernel' }
  }

  /** 保存 chip（工单H1）：保存一开始就把这一格翻成「保存中…」，
   *  落盘结果再翻成「已保存 · 第 N 版」或「保存失败」（带 code，STALE 由界面换「重新载入」动作）。 */
  function beginSaveFeedback(target) {
    state.saveFeedback = { target, status: 'saving', revision: null, code: null, message: '' }
  }

  function settleSaveFeedback(target, saved) {
    state.saveFeedback = saved.ok
      ? { target, status: 'saved', revision: saved.value.revision ?? null, code: null, message: '' }
      : { target, status: 'error', revision: null, code: saved.code ?? null, message: saved.message ?? '' }
  }

  async function loadChapters({ keep = true } = {}) {
    state.busy = true
    state.treeError = null
    const listed = await tool('pinax_chapter_list', { limit: 500 })
    state.busy = false
    if (!listed.ok) {
      state.treeError = listed.message
      state.chapters = []
      state.chapterGroups = []
      return
    }
    state.chapters = listed.value.chapters ?? []
    // 卷→章两级（工单B）：章的卷名以工具返回的 volume 字段为准（顶层章为 null）；
    // 缺字段时按章节相对路径的 正文/<卷>/<章>.md 分段现算。两级封顶，更深的层级按同一卷归类。
    state.chapterGroups = groupChaptersByVolume(state.chapters, listed.value.volumes)
    if (!keep) return
    const current = state.chapter ? state.chapters.find((item) => item.file === state.chapter.file) : null
    if (!state.chapter && state.chapters.length) await openChapter(state.chapters[state.chapters.length - 1])
    else if (current) await openChapter(current)
  }

  async function openChapter(item) {
    if (!item) return
    state.busy = true
    state.error = null
    // 打开只清旧提示，不再写「已载入 N 字 · 第 N 版」（工单H1：字数与版本在编辑面头部 meta 行）。
    state.notice = ''
    state.saveFeedback = null
    const read = await tool('pinax_chapter_read', { file: item.file, maxChars: 20000 })
    state.busy = false
    if (!read.ok) {
      state.error = read.message
      return
    }
    state.chapter = { ...item, revision: read.value.revision, totalChars: read.value.totalChars, truncated: read.value.truncated }
    state.draft = read.value.text ?? ''
    state.selection = { type: 'chapter', item: { ...item, revision: read.value.revision } }
  }

  /** 保存＝作者按 Ctrl+S 的那一下（工单H1：常驻保存按钮已移除）：带读到的修订号走 pinax_chapter_save，
   *  冲突由文件服务拒，不静默覆盖；结果只进保存 chip，不再写一条常驻提示。 */
  async function save() {
    if (!state.chapter || !state.draft) return
    state.busy = true
    state.error = null
    state.notice = ''
    beginSaveFeedback('chapter')
    const saved = await tool('pinax_chapter_save', { file: state.chapter.file, text: state.draft, expectedRevision: state.chapter.revision })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新载入该章后再改，外壳不做静默合并）' : ''}`
      settleSaveFeedback('chapter', saved)
      return
    }
    state.chapter = { ...state.chapter, revision: saved.value.revision, totalChars: state.draft.length, truncated: false }
    state.busy = false
    settleSaveFeedback('chapter', saved)
    // 就地推进索引窗里的版本号，不为一次保存重读整章（重读会把 chip 的版本号冲掉）。
    state.chapters = state.chapters.map((item) => (item.file === saved.value.file ? { ...item, revision: saved.value.revision } : item))
    state.chapterGroups = groupChaptersByVolume(state.chapters)
  }

  async function createChapter(title) {
    const name = String(title ?? '').trim()
    if (!name) return
    state.busy = true
    state.error = null
    state.notice = ''
    const saved = await tool('pinax_chapter_save', { title: name, text: `${name}\n`, expectedRevision: 0 })
    state.busy = false
    if (!saved.ok) {
      state.error = saved.message
      return
    }
    state.notice = `已新建「${saved.value.file}」`
    await loadChapters({ keep: false })
    const made = state.chapters.find((item) => item.file === saved.value.file)
    if (made) await openChapter(made)
  }

  /** 构思速记（工单B1）：列篇目。与章节同走 runtimeToolCall 一条通道（pinax_notes_list）；
   *  刻意不自动打开任何一篇——正文是核心区的主角，速记只在作者点索引窗那一行时进场。 */
  async function loadNotes() {
    state.notesError = null
    const listed = await tool('pinax_notes_list', { limit: 500 })
    if (!listed.ok) {
      state.notes = []
      state.notesError = listed.message
      return
    }
    state.notes = listed.value.notes ?? []
    // 换板后再回来：让打开着的那篇跟上最新修订号与正文，别摊着一份上一秒的草稿来源。
    const current = state.note ? state.notes.find((item) => item.file === state.note.file) : null
    if (current) {
      state.note = { ...current }
      state.noteDraft = current.text ?? ''
    }
  }

  /** 打开一篇速记：正文随 pinax_notes_list 一起回来了（速记都短），这里不再发第二次读。 */
  function openNote(item) {
    if (!item) return
    state.note = { ...item }
    state.noteDraft = item.text ?? ''
    state.error = null
    // 打开只清旧提示：「已载入 N 字 · 第 N 版」不再占一条常驻 notice（工单H1）。
    state.notice = ''
    state.saveFeedback = null
    state.selection = { type: 'note', item: { ...item } }
  }

  function setNoteDraft(value) {
    state.noteDraft = value
  }

  /** 保存速记＝作者按 Ctrl+S 的那一下：带读到的修订号走 pinax_notes_save，
   *  冲突由文件服务拒，不静默覆盖；结果只进保存 chip（工单H1）。 */
  async function saveNote() {
    if (!state.note || !state.noteDraft) return
    state.busy = true
    state.error = null
    state.notice = ''
    beginSaveFeedback('note')
    const saved = await tool('pinax_notes_save', { file: state.note.file, text: state.noteDraft, expectedRevision: state.note.revision })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新打开该篇后再改，外壳不做静默合并）' : ''}`
      settleSaveFeedback('note', saved)
      return
    }
    state.note = { ...state.note, revision: saved.value.revision, totalChars: state.noteDraft.length, truncated: false }
    state.busy = false
    settleSaveFeedback('note', saved)
    // 就地推进索引窗里的版本号与正文，不为一次保存重列整个构思目录。
    state.notes = state.notes.map((item) => (item.file === saved.value.file
      ? { ...item, revision: saved.value.revision, text: state.noteDraft, totalChars: state.noteDraft.length, truncated: false }
      : item))
  }

  /** 新建速记：工具拒空 text（速记也不是空文件），以标题作首行落盘，随后列一次并打开。 */
  async function createNote(title) {
    const name = String(title ?? '').trim()
    if (!name) return
    state.busy = true
    state.error = null
    state.notice = ''
    const saved = await tool('pinax_notes_save', { title: name, text: `${name}\n`, expectedRevision: 0 })
    state.busy = false
    if (!saved.ok) {
      state.error = saved.message
      return
    }
    state.notice = `已新建「${saved.value.file}」`
    await loadNotes()
    const made = state.notes.find((item) => item.file === saved.value.file)
    if (made) openNote(made)
  }

  /** 约束（工单E2）：列 约束/ 篇目。与构思速记同一个列法——pinax_rule_list 把全文随手带回，
   *  设定板换进来时与条目一起列；失败摊在索引窗自己的错误位。 */
  async function loadRules() {
    state.rulesError = null
    const listed = await tool('pinax_rule_list', { limit: 500 })
    if (!listed.ok) {
      state.rules = []
      state.rulesError = listed.message
      return
    }
    state.rules = listed.value.rules ?? []
    // 换板后再回来：让打开着的那份跟上最新修订号与正文，别摊着一份上一秒的草稿来源。
    const current = state.rule ? state.rules.find((item) => item.file === state.rule.file) : null
    if (current) {
      state.rule = { ...current }
      state.ruleDraft = current.text ?? ''
    }
  }

  /** 打开一份约束：正文随 pinax_rule_list 一起回来了，这里不再发第二次读。 */
  function openRule(item) {
    if (!item) return
    state.rule = { ...item }
    state.ruleDraft = item.text ?? ''
    state.error = null
    // 打开只清旧提示：「已载入 N 字 · 第 N 版」不再占一条常驻 notice（工单H1）。
    state.notice = ''
    state.saveFeedback = null
    state.selection = { type: 'rule', item: { ...item } }
  }

  function setRuleDraft(value) {
    state.ruleDraft = value
  }

  /** 保存约束＝作者按 Ctrl+S 的那一下：带读到的修订号走 pinax_rule_save，
   *  冲突由文件服务拒，不静默覆盖；结果只进保存 chip（工单H1）。 */
  async function saveRule() {
    if (!state.rule || !state.ruleDraft) return
    state.busy = true
    state.error = null
    state.notice = ''
    beginSaveFeedback('rule')
    const saved = await tool('pinax_rule_save', { file: state.rule.file, text: state.ruleDraft, expectedRevision: state.rule.revision })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新打开该份约束后再改，外壳不做静默合并）' : ''}`
      settleSaveFeedback('rule', saved)
      return
    }
    state.rule = { ...state.rule, revision: saved.value.revision, totalChars: state.ruleDraft.length, truncated: false }
    state.busy = false
    settleSaveFeedback('rule', saved)
    // 就地推进索引窗里的版本号与正文，不为一次保存重列整个约束目录。
    state.rules = state.rules.map((item) => (item.file === saved.value.file
      ? { ...item, revision: saved.value.revision, text: state.ruleDraft, totalChars: state.ruleDraft.length, truncated: false }
      : item))
  }

  /** 新建约束：工具拒空 text，以标题作首行落盘，随后列一次并打开。 */
  async function createRule(title) {
    const name = String(title ?? '').trim()
    if (!name) return
    state.busy = true
    state.error = null
    state.notice = ''
    const saved = await tool('pinax_rule_save', { title: name, text: `${name}\n`, expectedRevision: 0 })
    state.busy = false
    if (!saved.ok) {
      state.error = saved.message
      return
    }
    state.notice = `已新建「${saved.value.file}」`
    await loadRules()
    const made = state.rules.find((item) => item.file === saved.value.file)
    if (made) openRule(made)
  }

  /**
   * 资料（工单G1）：列 资料/ 篇目。与构思速记同一个列法——pinax_document_list 把正文随手带回
   * （前 20000 字，超出标注）；失败摊在索引窗自己的错误位。
   * 换板后再回来：打开着的那篇重读一次（pinax_document_read 取全文），
   * 不拿列表里那份截断文本去顶替作者手上的草稿。
   */
  async function loadDocuments() {
    state.documentsError = null
    const listed = await tool('pinax_document_list', { limit: 500 })
    if (!listed.ok) {
      state.documents = []
      state.documentsError = listed.message
      return
    }
    state.documents = listed.value.documents ?? []
    const current = state.document ? state.documents.find((item) => item.file === state.document.file) : null
    if (current) await openDocument(current)
  }

  /** 点开一篇资料：走 pinax_document_read 取全文（列表那份最多 20000 字，不足以做编辑底稿）。 */
  async function openDocument(item) {
    if (!item) return
    state.busy = true
    state.error = null
    // 打开只清旧提示：「已载入 N 字 · 第 N 版」不再占一条常驻 notice（工单H1）。
    state.notice = ''
    state.saveFeedback = null
    const read = await tool('pinax_document_read', { file: item.file, maxChars: 200000 })
    state.busy = false
    if (!read.ok) {
      state.error = read.message
      return
    }
    state.document = {
      ...item,
      title: read.value.document?.title ?? item.title,
      // text 是读回来的全文（列表那份最多 20000 字）：阅读态显示它，编辑态另拿 draft，
      // 取消编辑时 draft 丢掉、正文原样退回——与条目详情的 content／entryDraft 同一套。
      text: read.value.text ?? '',
      revision: read.value.revision,
      totalChars: read.value.totalChars,
      truncated: read.value.truncated
    }
    state.documentDraft = read.value.text ?? ''
    state.editingDocument = false
    state.selection = { type: 'document', item: { ...item, revision: read.value.revision } }
  }

  /** 资料编辑（工单G1）：与条目同一套开关——「编辑」把正文拷进草稿，「取消」原样退回。 */
  function editDocument() {
    if (!state.document) return
    state.documentDraft = state.document.text ?? ''
    state.editingDocument = true
    state.error = null
  }

  function cancelEditDocument() {
    state.editingDocument = false
    state.documentDraft = state.document?.text ?? ''
    state.error = null
  }

  function setDocumentDraft(value) {
    state.documentDraft = value
  }

  /** 保存资料＝作者按 Ctrl+S 的那一下：带读到的修订号走 pinax_document_save，
   *  冲突由文件服务拒，不静默覆盖；结果只进保存 chip（工单H1）。 */
  async function saveDocument() {
    if (!state.document || !state.documentDraft) return
    state.busy = true
    state.error = null
    state.notice = ''
    beginSaveFeedback('document')
    const saved = await tool('pinax_document_save', { file: state.document.file, text: state.documentDraft, expectedRevision: state.document.revision })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新打开该篇资料后再改，外壳不做静默合并）' : ''}`
      settleSaveFeedback('document', saved)
      return
    }
    state.busy = false
    state.editingDocument = false
    state.document = { ...state.document, text: state.documentDraft, revision: saved.value.revision, totalChars: state.documentDraft.length, truncated: false }
    settleSaveFeedback('document', saved)
    // 就地推进索引窗里的版本号与字数，不为一次保存重列整个资料目录。
    state.documents = state.documents.map((item) => (item.file === saved.value.file
      ? { ...item, revision: saved.value.revision, text: state.documentDraft, totalChars: state.documentDraft.length, truncated: false }
      : item))
  }

  /** 新建资料：工具拒空 text，以标题作首行落盘，随后列一次并打开新篇（打开时取全文与修订号）。 */
  async function createDocument(title) {
    const name = String(title ?? '').trim()
    if (!name) return
    state.busy = true
    state.error = null
    state.notice = ''
    const saved = await tool('pinax_document_save', { title: name, text: `${name}\n`, expectedRevision: 0 })
    state.busy = false
    if (!saved.ok) {
      state.error = saved.message
      return
    }
    state.notice = `已新建「${saved.value.file}」`
    await loadDocuments()
    const made = state.documents.find((item) => item.file === saved.value.file)
    if (made) await openDocument(made)
  }

  /**
   * 提案（工单A）：列 .pinax/proposals/。
   * 失败摊在索引窗自己的错误位（不发到文档级），提案是索引窗这一栏的东西；
   * 打开着的那份若已不在列表里（被外面删了），状态一并清掉，不留一份点不开的「当前提案」。
   */
  async function loadProposals() {
    state.proposalsError = null
    const listed = await tool('pinax_proposal_list', {})
    if (!listed.ok) {
      state.proposals = []
      state.proposalRaw = []
      state.proposalWarnings = []
      state.proposalsError = listed.message
      return
    }
    state.proposals = listed.value.proposals ?? []
    state.proposalRaw = listed.value.raw ?? []
    state.proposalWarnings = listed.value.warnings ?? []
    if (!state.proposal) return
    const fresh = state.proposals.find((item) => item.name === state.proposal.name)
    if (!fresh) {
      state.proposal = null
      state.proposalChapter = null
      if (state.selection?.type === 'proposal') state.selection = { type: null, item: null }
      return
    }
    if (state.proposal.status !== fresh.status) state.proposal = { ...state.proposal, status: fresh.status }
  }

  /**
   * 点开一份提案：整份 JSON 读回来，再把目标章此刻的正文读一份做对照。
   * 目标章读不到不拦住审阅（提案内容本身还在），但会把原话摊在文档级错误条上。
   */
  async function openProposal(item) {
    if (!item?.name) return
    state.busy = true
    state.error = null
    state.notice = ''
    const read = await tool('pinax_proposal_read', { name: item.name })
    if (!read.ok) {
      state.busy = false
      state.proposalsError = read.message
      return
    }
    const proposal = { ...read.value.proposal, name: read.value.name }
    state.proposal = proposal
    state.proposalChapter = null
    const targetFile = proposal.target?.file
    if (targetFile) {
      const current = await tool('pinax_chapter_read', { file: targetFile, maxChars: 200000 })
      if (current.ok) {
        state.proposalChapter = {
          file: current.value.chapter?.file ?? targetFile,
          title: current.value.chapter?.title ?? proposal.target?.title ?? '',
          text: current.value.text ?? '',
          totalChars: current.value.totalChars ?? (current.value.text ?? '').length,
          revision: current.value.revision,
          truncated: Boolean(current.value.truncated)
        }
      } else {
        state.error = `读不到提案的目标章「${targetFile}」：${current.message}`
      }
    }
    state.busy = false
    state.notice = proposal.status === 'adopted'
      ? '这条提案已经采纳过；再采纳会按当前章节版本重新写入一版。'
      : ''
    state.selection = { type: 'proposal', item: { name: proposal.name, target: proposal.target ?? null } }
  }

  /**
   * 采纳＝把提案正文写成目标章的新一版：先读当前修订号，再走载体 save（带修订号）。
   * STALE_REVISION 原样摊开——提案按的是旧稿，外壳不做静默合并；正文已经落盘但状态没记上时，
   * 保存结果里的 proposalWarning 随提示一起说清楚。
   */
  async function adoptProposal() {
    const proposal = state.proposal
    if (!proposal?.name || typeof proposal.content !== 'string' || !proposal.content.length) return
    const targetFile = proposal.target?.file
    if (!targetFile) {
      state.error = '这份提案没有目标章（target.file），无法采纳'
      return
    }
    state.busy = true
    state.error = null
    state.notice = ''
    const current = await tool('pinax_chapter_read', { file: targetFile, maxChars: 200000 })
    if (!current.ok) {
      state.busy = false
      state.error = `读不到目标章「${targetFile}」的当前修订号：${current.message}`
      return
    }
    const saved = await tool('pinax_chapter_save', {
      file: targetFile,
      text: proposal.content,
      expectedRevision: current.value.revision,
      proposal: proposal.name
    })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（提案已过期：目标章在提案生成后又被改过。请先重新打开该章再决定，外壳不做静默合并）' : ''}`
      return
    }
    state.busy = false
    state.notice = `已采纳提案，写入「${saved.value.file}」· 第 ${saved.value.revision} 版`
    if (saved.value.proposalWarning) state.notice += `（${saved.value.proposalWarning}）`
    // 目标章若正开着，草稿与版本号一起跟上新一版，免得下次按保存时拿旧稿覆盖刚采纳的正文。
    if (state.chapter?.file === saved.value.file) {
      state.chapter = { ...state.chapter, revision: saved.value.revision, totalChars: proposal.content.length, truncated: false }
      state.draft = proposal.content
    }
    state.chapters = state.chapters.map((item) => (item.file === saved.value.file ? { ...item, revision: saved.value.revision } : item))
    state.chapterGroups = groupChaptersByVolume(state.chapters)
    state.proposalChapter = {
      ...(state.proposalChapter ?? {}),
      file: targetFile,
      text: proposal.content,
      totalChars: proposal.content.length,
      revision: saved.value.revision,
      truncated: false
    }
    // 重列：状态（adopted）以磁盘上的 JSON 为准，不在界面上自说自话。
    await loadProposals()
  }

  /** 弃用＝删掉提案文件；正文从未被它改过，所以这里也没有「回滚」可做。 */
  async function discardProposal() {
    const proposal = state.proposal
    if (!proposal?.name) return
    state.busy = true
    state.error = null
    state.notice = ''
    const discarded = await tool('pinax_proposal_discard', { name: proposal.name })
    state.busy = false
    if (!discarded.ok) {
      state.error = discarded.message
      return
    }
    state.notice = `已弃用提案「${proposal.name}」`
    state.proposal = null
    state.proposalChapter = null
    if (state.selection?.type === 'proposal') state.selection = { type: null, item: null }
    await loadProposals()
  }

  async function loadEntries() {
    state.busy = true
    state.treeError = null
    // 设定板块没有大纲树（工单A3）：换到这块板就把大纲清空，别让上一块板的节点挂在状态里。
    state.outline = []
    state.outlineError = null
    const listed = await tool('pinax_worldbook_list', { limit: 500 })
    state.busy = false
    if (!listed.ok) {
      state.treeError = listed.message
      state.entries = []
      return
    }
    state.entries = listed.value.entries ?? []
    state.listWarnings = listed.value.warnings ?? []
    const current = state.entry ? state.entries.find((item) => item.path === state.entry.path) : null
    if (!state.entry && state.entries.length) await openEntry(state.entries[0])
    else if (current) await openEntry(current)
  }

  async function openEntry(item) {
    if (!item) return
    state.busy = true
    state.error = null
    state.notice = ''
    state.saveFeedback = null
    const read = await tool('pinax_worldbook_read', item.id ? { id: item.id } : { name: item.name })
    state.busy = false
    if (!read.ok) {
      state.error = read.message
      return
    }
    state.entry = read.value.entry
    state.entryWarnings = [...(read.value.warnings ?? [])]
    state.selection = { type: 'entry', item }
  }

  /** 条目编辑（工单A2）：「编辑」进草稿，「取消」原样退回，保存走设定载体自有的 pinax_worldbook_save
   *  ——带读到的修订号，冲突由文件服务拒，与正文保存同一套并发规矩。
   *  工单C：契约条目的 frontmatter 关键词／标签一起进草稿（entryMetaDraft），保存时随 meta 落盘。
   *  收口包②：摘要（summary）与关键词／标签同进同出——空串在保存时按「清空」传。 */
  function editEntry() {
    if (!state.entry) return
    state.entryDraft = state.entry.content ?? ''
    state.entryMetaDraft = {
      keys: joinMetaList(state.entry.keys),
      tags: joinMetaList(state.entry.tags),
      summary: typeof state.entry.summary === 'string' ? state.entry.summary : ''
    }
    state.editingEntry = true
    state.error = null
  }

  function cancelEditEntry() {
    state.editingEntry = false
    state.entryDraft = ''
    state.entryMetaDraft = { keys: '', tags: '', summary: '' }
    state.error = null
  }

  function setEntryDraft(value) {
    state.entryDraft = value
  }

  /** 元数据草稿的逐字写入（工单C／收口包②）：field 只认 keys／tags／summary，
   *  值原样保留（逗号在保存时才切，摘要不截断——上限由输入框 maxlength 与工具 schema 两头守）。 */
  function setEntryMeta(field, value) {
    if (field !== 'keys' && field !== 'tags' && field !== 'summary') return
    state.entryMetaDraft = { ...state.entryMetaDraft, [field]: String(value ?? '') }
  }

  async function saveEntry() {
    if (!state.entry || !state.entryDraft) return
    state.busy = true
    state.error = null
    beginSaveFeedback('entry')
    // 元数据只对契约条目开（工单C）：裸 md 提供 meta 会被载体拒（INVALID_INPUT），所以干脆不传。
    const payload = { path: state.entry.path, text: state.entryDraft, expectedRevision: state.entry.revision }
    if (state.entry.contract) {
      payload.meta = {
        keys: splitMetaList(state.entryMetaDraft.keys),
        tags: splitMetaList(state.entryMetaDraft.tags),
        // 摘要按原话落盘；首尾空白不算内容，整栏留空＝空串＝清空。
        summary: String(state.entryMetaDraft.summary ?? '').trim()
      }
    }
    const saved = await tool('pinax_worldbook_save', payload)
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新打开该条目后再改，外壳不做静默合并）' : ''}`
      settleSaveFeedback('entry', saved)
      return
    }
    // 退出编辑态后重新 openEntry：版本号与全文以重读为准，不就地拼一份「自以为保存成功」的条目。
    state.editingEntry = false
    state.entryDraft = ''
    await openEntry(state.entry)
    // openEntry 会清瞬时提示（打开＝新状态）：落盘结果在重读之后才进 chip，否则刚保存就被冲掉。
    settleSaveFeedback('entry', saved)
  }

  function setDraft(value) {
    state.draft = value
  }

  /** 大纲树（工单A3 只读 → 工单B2 起可编辑）：小说板块把 大纲/outline.json 的节点列进索引窗。
   *  大纲还没写（工具对「既没有 outline.json 也没有 大纲.md」回 INVALID_INPUT）是新建项目的常态：
   *  清空、revision 记为 null（首次保存传 0 建档）、不报错，索引窗给一行说明＋「新建大纲」；
   *  其余失败才进 outlineError 摊在索引窗。换板重列＝丢草稿，跟章节换板重读同一口径。 */
  async function loadOutline() {
    state.outlineError = null
    state.outlineDraft = null
    state.outlineNodeIndex = null
    // 重读＝新状态：上一枚保存 chip（尤其失败态）不能挂在新读到的树上。
    state.saveFeedback = null
    const read = await tool('pinax_outline_read', {})
    if (!read.ok) {
      state.outline = []
      state.outlineEdges = []
      state.outlineRevision = null
      if (read.code !== 'PINAX_INVALID_INPUT') state.outlineError = read.message
      return
    }
    // 工单G3：edges 也留在状态里——索引窗按它算层级缩进与「有子节点」的记号。
    // depth 由 outlineDepths() 现算（不写进文档：草稿与保存都不带这个界面字段）。
    state.outlineEdges = read.value.edges ?? []
    state.outline = decorateOutlineNodes(read.value.nodes ?? [], state.outlineEdges)
    state.outlineRevision = read.value.revision ?? null
  }

  /** 点索引窗的大纲行：把整份文档拷成草稿（只拷一次），选中该节点——中栏换大纲编辑面。 */
  function selectOutlineNode(index) {
    if (!state.outline.length) return
    if (!state.outlineDraft) {
      state.outlineDraft = {
        // 草稿是「要落盘的文档」：界面用的 depth 不进草稿，否则保存会把 depth 写进 outline.json。
        nodes: JSON.parse(JSON.stringify(plainOutlineNodes(state.outline))),
        edges: JSON.parse(JSON.stringify(state.outlineEdges ?? []))
      }
    }
    state.outlineNodeIndex = index
    const node = state.outlineDraft.nodes[index]
    if (!node) return
    state.error = null
    state.notice = ''
    state.selection = { type: 'outline-node', item: { ...node, index } }
  }

  /** 大纲还没建档时的第一笔：起一份只有一个未命名节点的草稿，改名后保存即建 outline.json。 */
  function startOutline() {
    if (state.outline.length || state.outlineError) return
    state.outlineDraft = { nodes: [{ id: freshOutlineNodeId([]), title: '未命名节点' }], edges: [] }
    state.outlineNodeIndex = 0
    state.error = null
    state.notice = ''
    state.selection = { type: 'outline-node', item: { ...state.outlineDraft.nodes[0], index: 0 } }
  }

  /** 改名落草稿：行内不改，中栏的标题输入框逐字进草稿，按保存才落盘。 */
  function setOutlineNodeTitle(index, title) {
    const node = state.outlineDraft?.nodes[index]
    if (node) node.title = title
  }

  /** 加节点（工单B2）：同级＝插在所选节点后；子级＝同样紧随其后，另记一条 from→to 连线
   *  （outline.json 的层级语义住在 edges 里；工单G3 起索引窗按 depth 缩进显示，仍不做拖拽重排）。 */
  function addOutlineNode(kind) {
    if (!state.outlineDraft || state.outlineNodeIndex === null) return
    const nodes = state.outlineDraft.nodes
    const anchor = nodes[state.outlineNodeIndex]
    if (!anchor) return
    const node = { id: freshOutlineNodeId(nodes), title: '未命名节点' }
    nodes.splice(state.outlineNodeIndex + 1, 0, node)
    if (kind === 'child') state.outlineDraft.edges.push({ from: anchor.id, to: node.id })
    selectOutlineNode(state.outlineNodeIndex + 1)
  }

  function freshOutlineNodeId(nodes) {
    const taken = new Set(nodes.map((node) => String(node?.id ?? '')))
    let index = nodes.length + 1
    while (taken.has(`node-${index}`)) index += 1
    return `node-${index}`
  }

  /** 大纲保存＝作者按下去的那一下（按钮与 Ctrl+S 是同一条路）：整份草稿走 pinax_outline_save，
   *  冲突由文件服务拒，不静默覆盖。成功率先进保存 chip（工单H1 同款，不再铺常驻 notice）；
   *  成功后就地推进树与修订号（不重读、不冲掉提示），草稿继续开着——作者可以接着改。 */
  async function saveOutline() {
    if (!state.outlineDraft || !state.outlineDraft.nodes.length) return
    state.busy = true
    state.error = null
    state.notice = ''
    beginSaveFeedback('outline')
    const saved = await tool('pinax_outline_save', {
      nodes: state.outlineDraft.nodes,
      edges: state.outlineDraft.edges,
      expectedRevision: state.outlineRevision ?? 0
    })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新点开大纲节点后再改，外壳不做静默合并）' : ''}`
      settleSaveFeedback('outline', saved)
      return
    }
    state.outlineRevision = saved.value.revision
    // 就地推进树（不重读、不冲掉提示）：depth 按新 edges 现算，草稿继续开着。
    state.outline = decorateOutlineNodes(JSON.parse(JSON.stringify(state.outlineDraft.nodes)), state.outlineDraft.edges)
    state.outlineEdges = JSON.parse(JSON.stringify(state.outlineDraft.edges))
    state.busy = false
    settleSaveFeedback('outline', saved)
  }

  /**
   * 资料板检索（工单H2）：渲染层只说检索词，项目根由主进程从 session.projectRoot 补；
   * 结果只收命中数组与 coverage，错误码原样留给界面（KNOWLEDGE_RUNTIME_MISSING／KNOWLEDGE_BUSY…）。
   */
  async function searchKnowledge(query, { k, dir = '资料' } = {}) {
    const text = String(query ?? '').trim()
    if (!text) return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '检索词不能为空' } }
    const callId = ++knowledgeCallId
    state.knowledgeSearching = true
    state.knowledgeSearched = true
    state.knowledgeError = null
    state.knowledgeResults = []
    state.knowledgeCoverage = null
    let result
    try {
      result = bridge?.request
        ? await bridge.request(IPC_CHANNELS.knowledgeSearch, {
          q: text,
          ...(k !== undefined ? { k } : {}),
          ...(dir ? { dir } : {})
        })
        : { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '渲染层未接主进程桥（preload 的 pinaxNext 通道）。' } }
    } catch (error) {
      result = { ok: false, error: { code: 'PINAX_IO_FAILED', message: String(error?.message || error) } }
    }
    // 换板/再次检索后，旧请求的结果晚到也不覆盖新状态。
    if (callId !== knowledgeCallId) return result
    state.knowledgeSearching = false
    if (!result?.ok) {
      state.knowledgeError = result?.error ?? { code: 'KNOWLEDGE_SEARCH_FAILED', message: '知识检索失败' }
      return result ?? { ok: false, error: state.knowledgeError }
    }
    const value = result.value ?? {}
    state.knowledgeResults = Array.isArray(value.hits) ? value.hits : []
    state.knowledgeCoverage = value.coverage ?? null
    return result
  }

  function clearKnowledgeSearch() {
    knowledgeCallId += 1
    state.knowledgeSearching = false
    state.knowledgeSearched = false
    state.knowledgeResults = []
    state.knowledgeCoverage = null
    state.knowledgeError = null
  }

  /** 换板时清瞬时提示：上一块板的提示、保存 chip 与检索结果不该出现在这一块板上（批次18 验收修 / 工单H1/H2）。
   *  协议 v1.1-A 起一载体一棵本域内容树：上一栏的树级错误（treeError）与世界书列举警告（listWarnings）
   *  也随换板收掉，否则「世界书/ 读失败」会挂到小说栏的正文树上。 */
  function clearTransient() {
    state.notice = ''
    state.error = null
    state.saveFeedback = null
    state.treeError = null
    state.listWarnings = []
    clearKnowledgeSearch()
  }

  return Object.assign(state, {
    tool,
    clearTransient,
    searchKnowledge,
    clearKnowledgeSearch,
    loadChapters,
    openChapter,
    save,
    createChapter,
    loadNotes,
    openNote,
    setNoteDraft,
    saveNote,
    createNote,
    loadRules,
    openRule,
    setRuleDraft,
    saveRule,
    createRule,
    loadDocuments,
    openDocument,
    editDocument,
    cancelEditDocument,
    setDocumentDraft,
    saveDocument,
    createDocument,
    loadProposals,
    openProposal,
    adoptProposal,
    discardProposal,
    loadEntries,
    openEntry,
    editEntry,
    cancelEditEntry,
    setEntryDraft,
    setEntryMeta,
    saveEntry,
    loadOutline,
    selectOutlineNode,
    startOutline,
    setOutlineNodeTitle,
    addOutlineNode,
    saveOutline,
    setDraft
  })
}

/**
 * 卷→章两级（工单B）：正文/ 下的一级子目录＝卷。
 * 章的卷名以工具给的 volume 字段为准（pinax_chapter_list 每条带 volume，顶层章为 null）；
 * 没这个字段时按章节相对路径分段现算：
 *   '正文/第一卷/第001章.md' → 卷「第一卷」；'正文/第001章.md' → 平铺（name:'' 的无名组）。
 * 另保留 volumes（[{ name, chapters }]）这一形状，工具将来直接返回卷结构时按它排。
 * 两级封顶——更深的层级不会被拆成第三级，整段目录名按一卷归类。平铺数据只得到无名组，
 * 索引窗不画卷标题，渲染与拆分前完全一致。
 */
function groupChaptersByVolume(chapters, volumes = null) {
  const list = Array.isArray(chapters) ? chapters : []
  const groups = []
  if (Array.isArray(volumes) && volumes.length) {
    const grouped = new Set()
    for (const volume of volumes) {
      const name = String(volume?.name ?? '').trim()
      const items = Array.isArray(volume?.chapters) ? volume.chapters : []
      if (!name) continue
      for (const item of items) grouped.add(item?.file)
      groups.push({ name, chapters: items })
    }
    const loose = list.filter((item) => !grouped.has(item?.file))
    if (loose.length || !groups.length) groups.push({ name: '', chapters: loose })
    return groups
  }
  const byName = new Map()
  const loose = []
  for (const chapter of list) {
    const declared = typeof chapter?.volume === 'string' && chapter.volume.trim() ? chapter.volume.trim() : ''
    const parts = String(chapter?.file ?? '').replaceAll('\\', '/').split('/')
    // 工具给了 volume 就用它；否则只认 正文/<卷>/<文件> 这一段（两段以内是平铺，更深的按同一卷归类）。
    const volume = declared || (parts.length >= 3 ? parts[1] : '')
    if (!volume) {
      loose.push(chapter)
      continue
    }
    if (!byName.has(volume)) {
      const group = { name: volume, chapters: [] }
      byName.set(volume, group)
      groups.push(group)
    }
    byName.get(volume).chapters.push(chapter)
  }
  if (loose.length || !groups.length) groups.push({ name: '', chapters: loose })
  return groups
}

/**
 * 大纲层级（工单G3）：edges 决定每个节点的 depth，索引窗据此缩进。
 * 只有「每条连线的两端都在节点表里、且从根节点出发能把整片森林走完」时才给层级：
 * 无入边的节点是根（depth 0），BFS 向下逐层 +1（同一子节点被多条线指向时取最先到达的最浅一层）。
 * 以下任一情况整份大纲按一级平铺（全部 depth 0）——宁可不缩进，也不给作者编一层不存在的结构：
 *   • 没有 edges（还没连线的草稿是常态）；
 *   • 连线端点缺失／指向不存在的节点（断链）；
 *   • 自环、重复 id、或存在从根到不了的环（整片森林走不完）。
 * edges 两种字段名都认：{ from, to }（本仓 outline.json 的既有形状）与 { source, target }。
 */
function outlineDepths(nodes, edges) {
  const list = Array.isArray(nodes) ? nodes : []
  const flat = list.map(() => 0)
  const links = Array.isArray(edges) ? edges : []
  if (!list.length || !links.length) return flat

  // id → 下标；缺 id 的节点只能是独立根（连线引用不到它，depth 恒为 0）。
  const indexById = new Map()
  for (const [index, node] of list.entries()) {
    const id = typeof node?.id === 'string' && node.id.trim() ? node.id : null
    if (!id) continue
    if (indexById.has(id)) return flat // 重复 id：连线指向谁都不确定
    indexById.set(id, index)
  }
  if (!indexById.size) return flat

  const children = new Map()
  const indegree = list.map(() => 0)
  for (const edge of links) {
    const from = edge?.from ?? edge?.source
    const to = edge?.to ?? edge?.target
    if (typeof from !== 'string' || typeof to !== 'string') return flat
    const parent = indexById.get(from)
    const child = indexById.get(to)
    if (parent === undefined || child === undefined || parent === child) return flat
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(child)
    indegree[child] += 1
  }

  const depths = list.map(() => 0)
  const visited = list.map(() => false)
  const queue = []
  for (let index = 0; index < list.length; index += 1) {
    if (indegree[index] !== 0) continue
    visited[index] = true
    queue.push(index)
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    for (const child of children.get(current) ?? []) {
      if (visited[child]) continue
      visited[child] = true
      depths[child] = depths[current] + 1
      queue.push(child)
    }
  }
  // 有 id 的节点里有走不到的（环）：整份平铺，不给半棵树编层级。
  for (const index of indexById.values()) if (!visited[index]) return flat
  return depths
}

/** 给每个节点贴上 depth（新对象，不改状态里那份文档数据）。 */
function decorateOutlineNodes(nodes, edges) {
  const list = Array.isArray(nodes) ? nodes : []
  const depths = outlineDepths(list, edges)
  return list.map((node, index) => ({ ...node, depth: depths[index] ?? 0 }))
}

/** 摘掉界面用的 depth：草稿与保存载荷只带文档里的字段。 */
function plainOutlineNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    if (!node || typeof node !== 'object') return node
    const copy = { ...node }
    delete copy.depth
    return copy
  })
}

/**
 * 条目元数据的界面 ↔ 落盘互转（工单C）：界面是一个逗号分隔的输入框，frontmatter 是字符串数组。
 * 切分中英文逗号都认（作者常从别处粘「柯秒, 秒子」或「柯秒，秒子」）；空白项丢弃，避免存进空关键词。
 * 合并用中文逗号显示，与中文正文的排版一致。
 */
function splitMetaList(text) {
  return String(text ?? '')
    .split(/[,，]/u)
    .map((part) => part.trim())
    .filter(Boolean)
}

function joinMetaList(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .join('，')
}
