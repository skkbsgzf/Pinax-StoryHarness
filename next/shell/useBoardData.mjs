import { reactive } from 'vue'
import { IPC_CHANNELS } from './ipcContract.mjs'

/**
 * 板块数据（章节／大纲／构思／条目／约束）的单一归属。
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
    /** 树级提示：列目录失败摊在索引窗（与文档级分开，免得作者分不清是哪一步说的话）。 */
    treeError: null,
    chapters: [],
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
    /** 提案审阅（工单A）：.pinax/proposals/ 里的模型改稿。
     *  proposals＝列表摘要；proposal＝点开的那份整份 JSON；proposalChapter＝目标章此刻的正文（左右对照用）。
     *  采纳仍走载体 save（带当前修订号），外壳不自己拼一份「采纳后」的正文。 */
    proposals: [],
    proposal: null,
    proposalChapter: null,
    proposalWarnings: [],
    proposalsError: null,
    entries: [],
    entry: null,
    /** 条目编辑（工单A2）：阅读态与编辑态的开关＋草稿，与正文的 draft 分开各拿各的。 */
    editingEntry: false,
    entryDraft: '',
    listWarnings: [],
    entryWarnings: [],
    selection: { type: null, item: null }
  })

  /** 只经一条通道：内核/载体返回的 {ok:false,code,message} 一律变成界面可见的话，不吞错。 */
  async function tool(name, args = {}) {
    if (!bridge?.request) return { ok: false, message: '渲染层未接主进程桥（preload 的 pinaxNext 通道）。' }
    const result = await bridge.request(IPC_CHANNELS.runtimeToolCall, { tool: name, args })
    if (!result.ok) return { ok: false, message: result.error?.message ?? `通道 ${name} 调用失败`, code: result.error?.code }
    const payload = result.value?.payload ?? {}
    if (payload.ok === false) return { ok: false, message: payload.message ?? `${name} 被拒绝`, code: payload.code, details: payload.details }
    return { ok: true, value: payload, owner: result.value?.owner ?? 'kernel' }
  }

  async function loadChapters({ keep = true } = {}) {
    state.busy = true
    state.treeError = null
    const listed = await tool('pinax_chapter_list', { limit: 500 })
    state.busy = false
    if (!listed.ok) {
      state.treeError = listed.message
      state.chapters = []
      return
    }
    state.chapters = listed.value.chapters ?? []
    if (!keep) return
    const current = state.chapter ? state.chapters.find((item) => item.file === state.chapter.file) : null
    if (!state.chapter && state.chapters.length) await openChapter(state.chapters[state.chapters.length - 1])
    else if (current) await openChapter(current)
  }

  async function openChapter(item) {
    if (!item) return
    state.busy = true
    state.error = null
    state.notice = ''
    const read = await tool('pinax_chapter_read', { file: item.file, maxChars: 20000 })
    state.busy = false
    if (!read.ok) {
      state.error = read.message
      return
    }
    state.chapter = { ...item, revision: read.value.revision, totalChars: read.value.totalChars, truncated: read.value.truncated }
    state.draft = read.value.text ?? ''
    state.notice = read.value.truncated
      ? `只载入了前 ${read.value.text.length} 字（全章 ${read.value.totalChars} 字）：保存会覆盖未载入的部分，请先用工具分页读全再改。`
      : `已载入 ${read.value.totalChars} 字 · 第 ${read.value.revision} 版`
    state.selection = { type: 'chapter', item: { ...item, revision: read.value.revision } }
  }

  /** 保存＝作者按下去的那一下：带读到的修订号走 pinax_chapter_save，冲突由文件服务拒，不静默覆盖。 */
  async function save() {
    if (!state.chapter || !state.draft) return
    state.busy = true
    state.error = null
    state.notice = ''
    const saved = await tool('pinax_chapter_save', { file: state.chapter.file, text: state.draft, expectedRevision: state.chapter.revision })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新载入该章后再改，外壳不做静默合并）' : ''}`
      return
    }
    state.chapter = { ...state.chapter, revision: saved.value.revision, totalChars: state.draft.length, truncated: false }
    state.busy = false
    state.notice = `已保存到「${saved.value.file}」· 第 ${saved.value.revision} 版`
    // 就地推进索引窗里的版本号，不为一次保存重读整章（重读会把「已保存」这句提示冲掉）。
    state.chapters = state.chapters.map((item) => (item.file === saved.value.file ? { ...item, revision: saved.value.revision } : item))
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
    state.notice = item.truncated
      ? `只载入了前 ${(item.text ?? '').length} 字（全篇 ${item.totalChars} 字）：保存会覆盖未载入的部分，请先用工具读全再改。`
      : `已载入 ${item.totalChars} 字 · 第 ${item.revision} 版`
    state.selection = { type: 'note', item: { ...item } }
  }

  function setNoteDraft(value) {
    state.noteDraft = value
  }

  /** 保存速记＝作者按下去的那一下：带读到的修订号走 pinax_notes_save，冲突由文件服务拒，不静默覆盖。 */
  async function saveNote() {
    if (!state.note || !state.noteDraft) return
    state.busy = true
    state.error = null
    state.notice = ''
    const saved = await tool('pinax_notes_save', { file: state.note.file, text: state.noteDraft, expectedRevision: state.note.revision })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新打开该篇后再改，外壳不做静默合并）' : ''}`
      return
    }
    state.note = { ...state.note, revision: saved.value.revision, totalChars: state.noteDraft.length, truncated: false }
    state.busy = false
    state.notice = `已保存到「${saved.value.file}」· 第 ${saved.value.revision} 版`
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
    state.notice = item.truncated
      ? `只载入了前 ${(item.text ?? '').length} 字（全篇 ${item.totalChars} 字）：保存会覆盖未载入的部分，请先用工具读全再改。`
      : `已载入 ${item.totalChars} 字 · 第 ${item.revision} 版`
    state.selection = { type: 'rule', item: { ...item } }
  }

  function setRuleDraft(value) {
    state.ruleDraft = value
  }

  /** 保存约束＝作者按下去的那一下：带读到的修订号走 pinax_rule_save，冲突由文件服务拒，不静默覆盖。 */
  async function saveRule() {
    if (!state.rule || !state.ruleDraft) return
    state.busy = true
    state.error = null
    state.notice = ''
    const saved = await tool('pinax_rule_save', { file: state.rule.file, text: state.ruleDraft, expectedRevision: state.rule.revision })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新打开该份约束后再改，外壳不做静默合并）' : ''}`
      return
    }
    state.rule = { ...state.rule, revision: saved.value.revision, totalChars: state.ruleDraft.length, truncated: false }
    state.busy = false
    state.notice = `已保存到「${saved.value.file}」· 第 ${saved.value.revision} 版`
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
   * 提案（工单A）：列 .pinax/proposals/。
   * 失败摊在索引窗自己的错误位（不发到文档级），提案是索引窗这一栏的东西；
   * 打开着的那份若已不在列表里（被外面删了），状态一并清掉，不留一份点不开的「当前提案」。
   */
  async function loadProposals() {
    state.proposalsError = null
    const listed = await tool('pinax_proposal_list', {})
    if (!listed.ok) {
      state.proposals = []
      state.proposalWarnings = []
      state.proposalsError = listed.message
      return
    }
    state.proposals = listed.value.proposals ?? []
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
   *  ——带读到的修订号，冲突由文件服务拒，与正文保存同一套并发规矩。 */
  function editEntry() {
    if (!state.entry) return
    state.entryDraft = state.entry.content ?? ''
    state.editingEntry = true
    state.error = null
  }

  function cancelEditEntry() {
    state.editingEntry = false
    state.entryDraft = ''
    state.error = null
  }

  function setEntryDraft(value) {
    state.entryDraft = value
  }

  async function saveEntry() {
    if (!state.entry || !state.entryDraft) return
    state.busy = true
    state.error = null
    const saved = await tool('pinax_worldbook_save', { path: state.entry.path, text: state.entryDraft, expectedRevision: state.entry.revision })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新打开该条目后再改，外壳不做静默合并）' : ''}`
      return
    }
    // 退出编辑态后重新 openEntry：版本号与全文以重读为准，不就地拼一份「自以为保存成功」的条目。
    state.editingEntry = false
    state.entryDraft = ''
    await openEntry(state.entry)
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
    const read = await tool('pinax_outline_read', {})
    if (!read.ok) {
      state.outline = []
      state.outlineEdges = []
      state.outlineRevision = null
      if (read.code !== 'PINAX_INVALID_INPUT') state.outlineError = read.message
      return
    }
    state.outline = read.value.nodes ?? []
    state.outlineEdges = read.value.edges ?? []
    state.outlineRevision = read.value.revision ?? null
  }

  /** 点索引窗的大纲行：把整份文档拷成草稿（只拷一次），选中该节点——中栏换大纲编辑面。 */
  function selectOutlineNode(index) {
    if (!state.outline.length) return
    if (!state.outlineDraft) {
      state.outlineDraft = {
        nodes: JSON.parse(JSON.stringify(state.outline)),
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
   *  （outline.json 的层级语义住在 edges 里，树显示仍是平铺——本批不做拖拽重排）。 */
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

  /** 大纲保存＝作者按下去的那一下：整份草稿走 pinax_outline_save，冲突由文件服务拒，不静默覆盖。
   *  成功后就地推进树与修订号（不重读、不冲掉提示），草稿继续开着——作者可以接着改。 */
  async function saveOutline() {
    if (!state.outlineDraft || !state.outlineDraft.nodes.length) return
    state.busy = true
    state.error = null
    state.notice = ''
    const saved = await tool('pinax_outline_save', {
      nodes: state.outlineDraft.nodes,
      edges: state.outlineDraft.edges,
      expectedRevision: state.outlineRevision ?? 0
    })
    if (!saved.ok) {
      state.busy = false
      state.error = `${saved.message}${saved.code === 'PINAX_STALE_REVISION' ? '（请重新点开大纲节点后再改，外壳不做静默合并）' : ''}`
      return
    }
    state.outlineRevision = saved.value.revision
    state.outline = JSON.parse(JSON.stringify(state.outlineDraft.nodes))
    state.outlineEdges = JSON.parse(JSON.stringify(state.outlineDraft.edges))
    state.busy = false
    state.notice = `已保存大纲 · 第 ${saved.value.revision} 版 · ${saved.value.nodeTotal} 个节点`
  }

  return Object.assign(state, {
    tool,
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
    loadProposals,
    openProposal,
    adoptProposal,
    discardProposal,
    loadEntries,
    openEntry,
    editEntry,
    cancelEditEntry,
    setEntryDraft,
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
