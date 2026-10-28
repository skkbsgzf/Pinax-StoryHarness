import { reactive } from 'vue'
import { IPC_CHANNELS } from './ipcContract.mjs'

/**
 * 板块数据（章节／条目）的单一归属。
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
    /** 大纲（工单A3）：索引窗的第三棵树，只读——节点来自 大纲/outline.json，本批不编辑不开面板。 */
    outline: [],
    outlineError: null,
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
    const saved = await tool('pinax_chapter_save', { title: name, text: '', expectedRevision: 0 })
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

  /** 大纲树（工单A3）：小说板块把 大纲/outline.json 的节点列进索引窗，入参照工具实现的原样（默认 maxNodes）。
   *  大纲还没写（工具对「既没有 outline.json 也没有 大纲.md」回 INVALID_INPUT）是新建项目的常态：
   *  清空、不报错，界面给一行「大纲还没有内容」；其余失败才进 outlineError 摊在索引窗。 */
  async function loadOutline() {
    state.outlineError = null
    const read = await tool('pinax_outline_read', {})
    if (!read.ok) {
      state.outline = []
      if (read.code !== 'PINAX_INVALID_INPUT') state.outlineError = read.message
      return
    }
    state.outline = read.value.nodes ?? []
  }

  return Object.assign(state, {
    tool,
    loadChapters,
    openChapter,
    save,
    createChapter,
    loadEntries,
    openEntry,
    editEntry,
    cancelEditEntry,
    setEntryDraft,
    saveEntry,
    loadOutline,
    setDraft
  })
}
