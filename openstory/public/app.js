/**
 * OpenStory 工作台数据与路由（OS-3）。
 *
 * 全部数据来自本机 daemon（127.0.0.1）：
 *   GET  /api/libraries → 库卡
 *   GET  /api/entries   → 拆解条目清单（S1 factFileStore 同构）
 *   GET  /api/entry     → 单条
 *   GET/PUT /api/chapter→ 正文读/写（PUT 同目录 .history 备份）
 *   GET  /api/wiki、POST /api/wiki/derive → S4 派生 wiki
 *
 * v1 边界：不做 Agent 对话（OS-4）；正文保存不做 revision 闸（与 Electron 同写靠 .history 粗保护）。
 * 这里不内置任何演示数据——读不到就摆空态，不拿假卡片冒充库。
 */

const state = {
  libraries: [],
  warnings: [],
  preferencesPath: '',
  kindFilter: '全部',
  current: null,
  view: 'library',
  entries: [],
  total: 0,
  entryWarnings: [],
  layerFilter: '',
  search: '',
  entry: null,
  entryRevision: null,
  chapterFiles: [],
  chapterFile: '',
  chapterText: '',
  chapterLoaded: false,
  chapterNote: '',
  savedAt: '',
  books: [],
  bookId: '',
  wiki: null,
  wikiFrom: null,
  wikiLoaded: false,
  loading: false,
  error: ''
}

const viewEl = document.getElementById('view')

const LAYER_LABELS = {
  plot: '剧情',
  character: '人物',
  world: '世界观',
  worldview: '世界观',
  setting: '设定',
  term: '术语',
  item: '物品',
  location: '地点',
  faction: '势力',
  event: '事件',
  relation: '关系',
  concept: '概念',
  rule: '规则'
}

const STATUS_LABELS = {
  draft: '草稿',
  confirmed: '已确认',
  reviewed: '已审',
  archived: '归档'
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]))
}

function text(value) {
  return String(value ?? '')
}

function layerLabel(layer) {
  const key = text(layer).trim()
  return LAYER_LABELS[key] ?? (key || '未分层')
}

function statusLabel(status) {
  const key = text(status).trim()
  return STATUS_LABELS[key] ?? key
}

function entrySummary(entry) {
  for (const value of [entry?.summary, entry?.definition, entry?.notes]) {
    const body = text(value).trim()
    if (body) return body
  }
  const events = Array.isArray(entry?.events) ? entry.events : []
  for (const event of events) {
    const body = text(event?.content).trim()
    if (body) return body
  }
  return ''
}

function truncate(value, max = 110) {
  const body = text(value).replace(/\s+/gu, ' ').trim()
  return body.length > max ? `${body.slice(0, max)}…` : body
}

/** 拆解条目的 name 常是「第1章·正文/x.txt·段1」：清单里只显示「第1章 · 段1」，全名留在详情。 */
function entryDisplayName(entry) {
  const raw = text(entry?.name || entry?.id).trim()
  const parts = raw.split('·').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2 && /^段\d+$/u.test(parts[parts.length - 1])) {
    return `${parts[0]} · ${parts[parts.length - 1]}`
  }
  return raw
}

function formatAt(value) {
  const raw = text(value).trim()
  if (!raw) return '时间未知'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const diff = Date.now() - date.getTime()
  if (diff >= 0 && diff < 60_000) return '刚刚'
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`)
    error.code = payload?.error?.code || ''
    error.details = payload?.error?.details || null
    throw error
  }
  return payload
}

function rememberError(error) {
  state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  state.loading = false
}

/* ---------- 渲染 ---------- */

function render() {
  const current = state.current
  document.getElementById('crumb-current').textContent = current ? current.name : '未选库'
  document.getElementById('crumb-kind').textContent = current ? current.kind : '—'
  for (const tab of document.querySelectorAll('#tabs .tab')) {
    tab.classList.toggle('on', tab.dataset.view === state.view)
  }
  if (state.view === 'library') viewEl.innerHTML = libraryHtml()
  else if (state.view === 'entries') viewEl.innerHTML = state.entry ? entryDetailHtml() : entriesHtml()
  else if (state.view === 'write') viewEl.innerHTML = writeHtml()
  else if (state.view === 'wiki') viewEl.innerHTML = wikiHtml()
}

function errorHtml() {
  return state.error ? `<div class="error-box">${esc(state.error)}</div>` : ''
}

function warningsHtml(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return ''
  const lines = warnings.map((warning) => `<div>${esc(warning.message || warning.code || warning)}</div>`).join('')
  return `<div class="warn-box"><b>提示</b>${lines}</div>`
}

function libraryHtml() {
  const kinds = ['全部', ...new Set(state.libraries.map((library) => library.kind))]
  const visible = state.kindFilter === '全部'
    ? state.libraries
    : state.libraries.filter((library) => library.kind === state.kindFilter)
  const filters = kinds.map((kind) => {
    const count = kind === '全部'
      ? state.libraries.length
      : state.libraries.filter((library) => library.kind === kind).length
    return `<button class="f${state.kindFilter === kind ? ' on' : ''}" data-kind="${esc(kind)}">${esc(kind)}<span class="n"> ${count}</span></button>`
  }).join('')

  const cards = visible.map((library) => {
    const active = state.current?.path === library.path
    const stat = library.count > 0
      ? `${library.count} 条 · ${formatAt(library.at)}`
      : formatAt(library.at)
    return `<button class="card${active ? ' on' : ''}" data-lib-path="${esc(library.path)}">
      <span class="t">${esc(library.name)}<span class="pill">${esc(library.kind)}</span></span>
      <span class="path">${esc(library.path)}</span>
      <span class="stat">${esc(stat)}</span>
    </button>`
  }).join('')

  const empty = state.libraries.length === 0
    ? `<div class="empty-state">
        <h2>还没有库，去 Pinax 里打开一个</h2>
        <p>OpenStory 与 Pinax 共用同一份库清单；在 Pinax 里打开过的文件夹会出现在这里。</p>
        <div class="hint">库清单：${esc(state.preferencesPath || '%LOCALAPPDATA%\\PinaxNext\\next-preferences.json')}</div>
      </div>`
    : `<div class="filter">${filters}</div><div class="cards">${cards}</div>`

  return `<div class="lib-wrap">
    <h1>我的库</h1>
    <p class="sub">每个库就是磁盘上的一个文件夹，库清单与 Pinax 同一份。</p>
    ${errorHtml()}
    ${warningsHtml(state.warnings)}
    ${empty}
  </div>`
}

function entriesHtml() {
  if (!state.current) return needLibraryHtml()
  if (state.loading && state.entries.length === 0) return '<div class="loading">正在读取拆解条目…</div>'
  if (state.entries.length === 0) {
    return `<div class="empty-state">
      <h2>这个库还没有拆解条目</h2>
      <p>OpenStory 读的是 <span class="hint">拆解/&lt;bookId&gt;.json</span> 里的 entries；先在 Pinax 里跑一次抽取，或确认库路径。</p>
    </div>`
  }

  const layers = [...new Set(state.entries.map((entry) => text(entry.layer).trim()).filter(Boolean))]
  const layerChips = [`<button class="chip${state.layerFilter === '' ? ' on' : ''}" data-layer="">全部</button>`]
    .concat(layers.map((layer) => `<button class="chip${state.layerFilter === layer ? ' on' : ''}" data-layer="${esc(layer)}">${esc(layerLabel(layer))}</button>`))
    .join('')

  const visible = visibleEntries()
  const rows = visible.map((entry) => `<button class="entry-row" data-entry-id="${esc(entry.id)}">
    <span class="nm">${esc(entryDisplayName(entry))}</span>
    <span class="sm${entrySummary(entry) ? '' : ' empty'}">${esc(truncate(entrySummary(entry)) || '（无摘要）')}</span>
    <span class="ly">${esc(layerLabel(entry.layer))}${entry.status ? ` · ${esc(statusLabel(entry.status))}` : ''}</span>
  </button>`).join('')

  const more = state.entries.length < state.total
    ? `<div class="pager"><span>已显示 ${state.entries.length} / ${state.total}</span><button class="btn-ghost" data-load-more>加载更多</button></div>`
    : `<div class="pager"><span>共 ${state.total} 条</span></div>`

  return `<div class="toolbar">
      <input class="search" id="entry-search" type="search" placeholder="按名称 / 摘要过滤…" value="${esc(state.search)}">
      <span class="sp"></span>
      <span class="count">${state.current.name} · 拆解条目</span>
    </div>
    ${errorHtml()}
    ${warningsHtml(state.entryWarnings)}
    <div class="toolbar">${layerChips}</div>
    <div class="entry-list">${rows || '<div class="loading">没有匹配的条目</div>'}</div>
    ${more}`
}

function visibleEntries() {
  const needle = state.search.trim().toLowerCase()
  return state.entries.filter((entry) => {
    if (state.layerFilter && text(entry.layer) !== state.layerFilter) return false
    if (!needle) return true
    const haystack = [
      entry.name,
      entrySummary(entry),
      Array.isArray(entry.aliases) ? entry.aliases.join(' ') : '',
      entry.bookName
    ].join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}

function entryDetailHtml() {
  const entry = state.entry
  if (!entry) return entriesHtml()
  const summary = entrySummary(entry)
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : []
  const events = Array.isArray(entry.events) ? entry.events : []
  const sources = Array.isArray(entry.sources) ? entry.sources : []
  const identity = entry.identity && typeof entry.identity === 'object' ? Object.entries(entry.identity) : []

  const eventBlocks = events.map((event) => {
    const who = text(event?.who).trim()
    const channel = text(event?.channel).trim()
    const label = [who, channel].filter(Boolean).join(' · ')
    return `<div class="e-sec"><h3>${esc(label || '事件')}</h3><p>${esc(text(event?.content).trim())}</p></div>`
  }).join('')

  const identityBlocks = identity
    .filter(([, value]) => typeof value === 'string' || Array.isArray(value))
    .map(([key, value]) => `<div class="e-sec"><h3>${esc(key)}</h3><p>${esc(Array.isArray(value) ? value.join('、') : value)}</p></div>`)
    .join('')

  return `<div class="toolbar">
      <button class="btn-ghost" data-action="back-entries">← 条目清单</button>
      <span class="sp"></span>
      <span class="count">${esc(layerLabel(entry.layer))}${entry.status ? ` · ${esc(statusLabel(entry.status))}` : ''}</span>
    </div>
    ${errorHtml()}
    <div class="entry-grid">
      <div>
        <h1 class="e-title">${esc(entryDisplayName(entry))}</h1>
        <p class="e-sum">${esc(summary || '（没有摘要）')}</p>
        <div class="e-meta">
          <span class="t">${esc(layerLabel(entry.layer))}</span>
          ${aliases.length ? `<span>触发词 ${esc(aliases.join('、'))}</span>` : ''}
          ${entry.bookName ? `<span>${esc(entry.bookName)}</span>` : ''}
        </div>
        ${entry.definition ? `<div class="e-sec"><h3>定义</h3><p>${esc(entry.definition)}</p></div>` : ''}
        ${identityBlocks}
        ${eventBlocks}
        ${entry.notes ? `<div class="e-sec"><h3>备注</h3><p>${esc(entry.notes)}</p></div>` : ''}
      </div>
      <aside class="e-side">
        <h4>条目信息</h4>
        <div class="kv"><span class="k">id</span><span class="v">${esc(entry.id)}</span></div>
        <div class="kv"><span class="k">名称</span><span class="v">${esc(entry.name || '—')}</span></div>
        <div class="kv"><span class="k">分层</span><span class="v">${esc(layerLabel(entry.layer))}</span></div>
        <div class="kv"><span class="k">状态</span><span class="v">${esc(statusLabel(entry.status) || '—')}</span></div>
        <div class="kv"><span class="k">书</span><span class="v">${esc(entry.bookName || '—')}</span></div>
        <div class="kv"><span class="k">版本</span><span class="v">${esc(state.entryRevision ?? '—')}</span></div>
        <h4>来源 · ${sources.length}</h4>
        ${sources.map((source) => `<div class="kv"><span class="k">文件</span><span class="v">${esc(source?.sourceId || '—')}</span></div>`).join('') || '<div class="kv"><span class="k">文件</span><span class="v">—</span></div>'}
      </aside>
    </div>`
}

function needLibraryHtml() {
  return `<div class="empty-state">
    <h2>先选一个库</h2>
    <p>回「我的库」点一张库卡，OpenStory 才会去读那个文件夹。</p>
    <button class="btn-ghost" data-go="library">回我的库</button>
  </div>`
}

function writeHtml() {
  if (!state.current) return needLibraryHtml()
  if (state.loading && !state.chapterLoaded) return '<div class="loading">正在读取正文…</div>'

  const options = state.chapterFiles
    .map((file) => `<option value="${esc(file)}"${file === state.chapterFile ? ' selected' : ''}>${esc(file)}</option>`)
    .join('')
  const saved = state.savedAt ? `<span class="saved-chip">已保存 · ${esc(formatAt(state.savedAt))}</span>` : ''
  const note = state.chapterNote ? `<span class="count">${esc(state.chapterNote)}</span>` : ''
  const editor = state.chapterLoaded
    ? `<textarea class="editor" id="chapter-editor" spellcheck="false" placeholder="正文内容…">${esc(state.chapterText)}</textarea>`
    : `<div class="empty-state">
        <h2>选一个正文文件</h2>
        <p>候选文件来自拆解条目的溯源；也可以直接填库内相对路径（例如 <span class="hint">正文/第001章.md</span>）。</p>
      </div>`

  return `<div class="doc-head">
      <div class="kick">${esc(state.current.name)} / 正文</div>
      <h1>${esc(state.chapterFile || '正文')}</h1>
      <div class="doc-meta">
        <span class="b">正文</span>
        <span id="chapter-chars">${state.chapterText.length} 字</span>
        ${saved}
        ${note}
      </div>
    </div>
    ${errorHtml()}
    <div class="toolbar">
      ${options ? `<select class="select" id="chapter-select">${options}</select>` : ''}
      <input class="file-input" id="chapter-file" placeholder="正文/xxx.md" value="${esc(state.chapterFile)}">
      <button class="btn-ghost" data-action="load-chapter">读取</button>
      <span class="sp"></span>
      <button class="btn-primary" data-action="save-chapter"${state.chapterLoaded ? '' : ' disabled'}>保存</button>
    </div>
    ${editor}`
}

function wikiHtml() {
  if (!state.current) return needLibraryHtml()
  if (state.loading && !state.wikiLoaded) return '<div class="loading">正在读取 wiki…</div>'

  const bookOptions = state.books
    .map((book) => `<option value="${esc(book.bookId)}"${book.bookId === state.bookId ? ' selected' : ''}>${esc(book.bookName || book.bookId)}（${book.count} 条）</option>`)
    .join('')

  if (!state.wiki) {
    return `<div class="toolbar">
        ${bookOptions ? `<select class="select" id="wiki-book">${bookOptions}</select>` : '<span class="count">没有可派生的书</span>'}
        <span class="sp"></span>
        <button class="btn-primary" data-action="derive-wiki"${state.loading || !state.bookId ? ' disabled' : ''}>派生 wiki</button>
      </div>
      ${errorHtml()}
      <div class="empty-state">
        <h2>这本书还没有 wiki</h2>
        <p>wiki 是零模型纯计算派生，随时可重建；派生结果落在 <span class="hint">拆解/&lt;bookId&gt;.wiki.json</span>。</p>
      </div>`
  }

  const wiki = state.wiki
  const book = wiki.book ?? {}
  const characters = Array.isArray(wiki.characters) ? wiki.characters : []
  const chapters = Array.isArray(wiki.chapters) ? wiki.chapters : []
  const terms = Array.isArray(wiki.terms) ? wiki.terms : []

  const characterCards = characters.map((character) => {
    const detail = [character.identity, character.archetype, character.summary]
      .map((value) => text(value).trim())
      .filter(Boolean)
      .join(' · ')
    return `<div class="wiki-card"><b>${esc(character.name)}</b><span class="sub">${esc(detail || '（无画像）')}${character.appearances ? ` · 出现 ${esc(character.appearances)} 次` : ''}</span></div>`
  }).join('')

  const chapterLines = chapters.map((chapter) => `<div class="wiki-line">
      <span class="no">${esc(chapter.no ?? '—')}</span>
      <span class="tt">${esc(chapter.title || `第 ${chapter.no} 章`)}${chapter.summary ? ` · ${esc(truncate(chapter.summary, 80))}` : ''}</span>
    </div>`).join('')

  const termCards = terms.map((term) => `<div class="wiki-card"><b>${esc(term.name || term.term || '—')}</b><span class="sub">${esc(truncate(term.summary || term.definition || '', 80) || '—')}</span></div>`).join('')

  return `<div class="toolbar">
      ${bookOptions ? `<select class="select" id="wiki-book">${bookOptions}</select>` : ''}
      <span class="sp"></span>
      <span class="count">派生自 fact revision ${esc(state.wikiFrom?.factRevision ?? '—')}</span>
      <button class="btn-ghost" data-action="derive-wiki"${state.loading ? ' disabled' : ''}>重新派生</button>
    </div>
    ${errorHtml()}
    <div class="wiki-wrap">
      <div class="wiki-head">
        <h2>${esc(book.title || state.current.name)}</h2>
        <div class="meta">
          ${book.author ? `<span>作者 ${esc(book.author)}</span>` : ''}
          ${book.group ? `<span>${esc(book.group)}</span>` : ''}
          <span>${chapters.length} 章</span>
          <span>${characters.length} 人</span>
          <span>${terms.length} 术语</span>
        </div>
      </div>
      <section class="wiki-section"><h3>人物 · ${characters.length}</h3><div class="wiki-cards">${characterCards || '<span class="count">没有人物条目</span>'}</div></section>
      <section class="wiki-section"><h3>章节 · ${chapters.length}</h3>${chapterLines || '<span class="count">没有章节</span>'}</section>
      ${termCards ? `<section class="wiki-section"><h3>术语 · ${terms.length}</h3><div class="wiki-cards">${termCards}</div></section>` : ''}
    </div>`
}

/* ---------- 数据加载 ---------- */

async function boot() {
  try {
    const payload = await api('/api/libraries')
    state.libraries = Array.isArray(payload.libraries) ? payload.libraries : []
    state.warnings = Array.isArray(payload.warnings) ? payload.warnings : []
    state.preferencesPath = text(payload.preferencesPath)
    if (payload.defaultRoot) {
      // 启动时带 --root：跳过库选择，直接进这个库的工作台。
      await openLibrary(payload.defaultRoot)
      return
    }
  } catch (error) {
    rememberError(error)
  }
  render()
}

async function openLibrary(path) {
  const library = state.libraries.find((item) => item.path === path)
  if (!library) return
  state.current = library
  state.entries = []
  state.total = 0
  state.entryWarnings = []
  state.entry = null
  state.entryRevision = null
  state.books = []
  state.bookId = ''
  state.wiki = null
  state.wikiFrom = null
  state.wikiLoaded = false
  state.chapterFiles = []
  state.chapterFile = ''
  state.chapterText = ''
  state.chapterLoaded = false
  state.chapterNote = ''
  state.savedAt = ''
  state.layerFilter = ''
  state.search = ''
  state.error = ''
  state.view = 'entries'
  render()
  await ensureEntries()
}

async function ensureEntries({ append = false } = {}) {
  if (!state.current) return
  if (!append && state.entries.length > 0) return
  state.loading = true
  state.error = ''
  render()
  try {
    const query = new URLSearchParams({
      root: state.current.path,
      offset: String(append ? state.entries.length : 0),
      limit: '500'
    })
    const payload = await api(`/api/entries?${query.toString()}`)
    const incoming = Array.isArray(payload.entries) ? payload.entries : []
    state.entries = append ? [...state.entries, ...incoming] : incoming
    state.total = Number(payload.total) || 0
    state.entryWarnings = Array.isArray(payload.warnings) ? payload.warnings : []
    state.books = collectBooks(state.entries)
    if (!state.bookId && state.books.length) state.bookId = state.books[0].bookId
    state.chapterFiles = collectChapterFiles(state.entries)
    if (!state.chapterFile && state.chapterFiles.length) state.chapterFile = state.chapterFiles[0]
  } catch (error) {
    rememberError(error)
  }
  state.loading = false
  render()
}

function collectBooks(entries) {
  const byId = new Map()
  for (const entry of entries) {
    const bookId = text(entry.bookId).trim()
    if (!bookId) continue
    const found = byId.get(bookId)
    if (found) found.count += 1
    else byId.set(bookId, { bookId, bookName: text(entry.bookName).trim() || bookId, count: 1 })
  }
  return [...byId.values()]
}

/** 正文候选：拆解条目的 sources[].sourceId（通常是 `正文/<file>`）。 */
function collectChapterFiles(entries) {
  const files = new Set()
  for (const entry of entries) {
    const sources = Array.isArray(entry?.sources) ? entry.sources : []
    for (const source of sources) {
      const id = text(source?.sourceId).trim()
      if (!id) continue
      if (id.startsWith('正文/') || /\.(md|txt)$/iu.test(id)) files.add(id)
    }
  }
  return [...files].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

async function openEntry(id) {
  state.loading = true
  state.error = ''
  render()
  try {
    const payload = await api(`/api/entry?${new URLSearchParams({ root: state.current.path, id }).toString()}`)
    state.entry = payload.entry
    state.entryRevision = payload.revision
  } catch (error) {
    rememberError(error)
  }
  state.loading = false
  render()
}

async function loadChapter(file) {
  if (!state.current) return
  const target = text(file).trim()
  if (!target) {
    state.error = '先填正文文件路径'
    render()
    return
  }
  state.chapterFile = target
  state.loading = true
  state.chapterLoaded = false
  state.error = ''
  state.chapterNote = ''
  state.savedAt = ''
  render()
  try {
    const payload = await api(`/api/chapter?${new URLSearchParams({ root: state.current.path, file: target }).toString()}`)
    state.chapterText = text(payload.text)
    state.chapterLoaded = true
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      state.chapterText = ''
      state.chapterLoaded = true
      state.chapterNote = '文件不存在；保存会新建'
      state.error = ''
    } else {
      rememberError(error)
    }
  }
  state.loading = false
  render()
}

async function saveChapter() {
  if (!state.current) return
  const editor = document.getElementById('chapter-editor')
  if (!editor) return
  const value = editor.value
  state.loading = true
  state.error = ''
  try {
    const payload = await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({
        root: state.current.path,
        file: state.chapterFile,
        text: value
      })
    })
    state.chapterText = value
    state.savedAt = payload.savedAt
    state.chapterNote = payload.backup ? `上一版备份：${payload.backup}` : ''
  } catch (error) {
    // 写失败也不吞作者刚敲的字：先把编辑框内容放回 state 再重渲染。
    state.chapterText = value
    rememberError(error)
  }
  state.loading = false
  render()
}

async function ensureWiki({ force = false } = {}) {
  if (!state.current) return
  if (state.wikiLoaded && !force) return
  const bookId = state.bookId || collectBooks(state.entries)[0]?.bookId || ''
  if (!bookId) {
    state.wikiLoaded = true
    render()
    return
  }
  state.bookId = bookId
  state.loading = true
  state.error = ''
  render()
  try {
    const payload = await api(`/api/wiki?${new URLSearchParams({ root: state.current.path, bookId }).toString()}`)
    state.wiki = payload.wiki ?? null
    state.wikiFrom = payload.derivedFrom ?? null
    state.wikiLoaded = true
  } catch (error) {
    rememberError(error)
  }
  state.loading = false
  render()
}

async function deriveWiki() {
  if (!state.current || !state.bookId) return
  state.loading = true
  state.error = ''
  render()
  try {
    const operationId = `openstory-derive-${state.bookId}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`
    const payload = await api('/api/wiki/derive', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, bookId: state.bookId, operationId })
    })
    state.wiki = payload.wiki ?? null
    state.wikiFrom = payload.derivedFrom ?? null
    state.wikiLoaded = true
  } catch (error) {
    rememberError(error)
  }
  state.loading = false
  render()
}

/* ---------- 交互 ---------- */

function go(view) {
  state.error = ''
  if (view !== 'library' && !state.current) {
    state.view = 'library'
    render()
    return
  }
  state.view = view
  if (view === 'entries') state.entry = null
  render()
  if (view === 'entries') ensureEntries()
  const needsEntries = (view === 'write' || view === 'wiki') && state.current && state.entries.length === 0
  if (needsEntries) {
    ensureEntries().then(() => {
      if (state.view === 'write' && !state.chapterLoaded && state.chapterFile) loadChapter(state.chapterFile)
      if (state.view === 'wiki') ensureWiki()
    })
    return
  }
  if (view === 'write' && !state.chapterLoaded && state.chapterFile) loadChapter(state.chapterFile)
  if (view === 'wiki') ensureWiki()
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-view], [data-go], [data-action], [data-skin], [data-lib-path], [data-entry-id], [data-layer], [data-kind], [data-load-more]')
  if (!target) return

  if (target.dataset.view) {
    go(target.dataset.view)
    return
  }
  if (target.dataset.go) {
    go(target.dataset.go)
    return
  }
  if (target.dataset.skin) {
    setSkin(target.dataset.skin)
    return
  }
  if (target.dataset.kind !== undefined) {
    state.kindFilter = target.dataset.kind
    render()
    return
  }
  if (target.dataset.libPath) {
    openLibrary(target.dataset.libPath)
    return
  }
  if (target.dataset.entryId) {
    openEntry(target.dataset.entryId)
    return
  }
  if (target.dataset.layer !== undefined) {
    state.layerFilter = target.dataset.layer
    render()
    return
  }
  if (target.dataset.loadMore !== undefined) {
    ensureEntries({ append: true })
    return
  }
  const action = target.dataset.action
  if (action === 'toggle-palette') {
    document.getElementById('palette').classList.toggle('open')
  } else if (action === 'back-entries') {
    state.entry = null
    render()
  } else if (action === 'load-chapter') {
    const input = document.getElementById('chapter-file')
    loadChapter(input?.value || state.chapterFile)
  } else if (action === 'save-chapter') {
    saveChapter()
  } else if (action === 'derive-wiki') {
    deriveWiki()
  }
})

document.addEventListener('change', (event) => {
  const target = event.target
  if (target.id === 'chapter-select') {
    state.chapterFile = target.value
    loadChapter(target.value)
    return
  }
  if (target.id === 'wiki-book') {
    state.bookId = target.value
    state.wiki = null
    state.wikiLoaded = false
    ensureWiki({ force: true })
  }
})

document.addEventListener('input', (event) => {
  const target = event.target
  if (target.id === 'entry-search') {
    state.search = target.value
    const list = document.querySelector('.entry-list')
    if (list) {
      const rows = visibleEntries().map((entry) => `<button class="entry-row" data-entry-id="${esc(entry.id)}">
        <span class="nm">${esc(entryDisplayName(entry))}</span>
        <span class="sm${entrySummary(entry) ? '' : ' empty'}">${esc(truncate(entrySummary(entry)) || '（无摘要）')}</span>
        <span class="ly">${esc(layerLabel(entry.layer))}${entry.status ? ` · ${esc(statusLabel(entry.status))}` : ''}</span>
      </button>`).join('')
      list.innerHTML = rows || '<div class="loading">没有匹配的条目</div>'
    }
    return
  }
  if (target.id === 'chapter-editor') {
    state.chapterText = target.value
    state.savedAt = ''
    const chars = document.getElementById('chapter-chars')
    if (chars) chars.textContent = `${target.value.length} 字`
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.id === 'chapter-file') {
    event.preventDefault()
    loadChapter(event.target.value)
  }
})

function setSkin(name) {
  document.documentElement.dataset.skin = name
  for (const option of document.querySelectorAll('.palette .opt')) {
    option.classList.toggle('on', option.dataset.skin === name)
  }
}

boot()
