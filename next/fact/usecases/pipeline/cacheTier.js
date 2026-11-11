/**
 * 缓存池分层存储（P-TRIM Track 4，作者 2026-11-11 架构裁定）。
 *
 * 作者原话：「利用缓存池机制。RAG 被视作硬储存（SSD），data 属于快储存（DDR），data 每储存 N 条
 * （可能 3-5 章的体量）触发一次 RAG 的更新，把 data 的内容 flush 进 RAG 时，同时给 data 基于 rag 的
 * 知识映射、剪枝、清理后归档。并开一个新的 data 继续在缓存池里闯，这样可以最大程度规避注意力涣散的问题，
 * 也可以及时清理掉上下文，充分利用 rag。」
 *
 * 三层模型：
 *   **working（DDR／热窗）**：当前正在抽取/推演的条目。只有这一层进模型上下文——
 *     它是「注意力预算」的物理边界：条数/字数超了就必须 flush，不许无限长。
 *   **archive（SSD／RAG）**：已 flush 的条目，冷存储。**不进 prompt**，只经检索按需取回少量命中。
 *   **retired（归档）**：被剪枝/重复/失效的条目，只留 id 与原因，不占任何上下文。
 *
 * 关键设计（与 §4 Track 3、§7bis 剪枝咬合）：
 *   1) **flush 是确定性操作**：把 working 的一批条目「折叠进」archive（复用 consolidateEntries，
 *      命中即合并不新增），同时产出**知识映射**（archive 里每个实体当前指向哪条、别名有哪些）——
 *      映射本身就是 RAG 的轻量索引，不必等向量；
 *   2) **flush 后 working 清空换新**：只有「跨窗口仍然被引用」的条目才留在 working（谓词注入），
 *      其余下沉——这是「规避注意力涣散」的机制本体；
 *   3) **retrieval window 有硬上限**：从 archive 取回时按「字面命中优先 + 条数/字数双闸」，
 *      绝不因为 archive 很大就往 prompt 里灌；
 *   4) **一切可复算**：flush 决策只看条数/字数/章跨度，不看模型判断；同输入同输出。
 *
 * 纯函数、零宿主依赖（向量检索经 VectorPort 注入，本模块只定义窗口与预算）。
 */

export const CACHE_TIER_VERSION = 'fact-cache-tier@1'

/** working 层默认预算：条数上限，或（章跨度达到 N 章）。作者给的体量参考是「3–5 章」。 */
export const DEFAULT_FLUSH_POLICY = Object.freeze({
  version: CACHE_TIER_VERSION,
  /** 触发 flush 的条数门槛（working 条目数 ≥ 此值）。 */
  flushEntries: 120,
  /** 触发 flush 的章跨度（working 覆盖的章数 ≥ 此值）。3–5 章取自作者口述。 */
  flushChapters: 4,
  /** working 层字数上限（粗估注意力成本；超了也触发 flush）。 */
  flushChars: 60_000,
  /** flush 后仍留在 working 的条件：被最近一次推演/渲染引用过（谓词由调用方给）。 */
  keepReferenced: true,
  /** 从 archive 取回的硬上限：条数。 */
  retrieveLimit: 12,
  /** 从 archive 取回的字数上限（单条截断到这个长度的 1/N）。 */
  retrieveChars: 2_400
})

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function entryChars(entry) {
  let total = 0
  for (const key of ['definition', 'fact', 'identity', 'personality']) {
    if (typeof entry?.[key] === 'string') total += entry[key].length
  }
  if (Array.isArray(entry?.definitions)) total += entry.definitions.join('').length
  if (Array.isArray(entry?.events)) {
    for (const event of entry.events) total += str(event?.title ?? event?.content).length
  }
  return total
}

/** 条目覆盖的章号集合（validity + provenance.chapters 双来源）。 */
function chaptersOf(entry) {
  const set = new Set()
  for (const value of [entry?.validity?.from, entry?.validity?.to]) {
    if (Number.isInteger(value)) set.add(value)
  }
  for (const value of Array.isArray(entry?.provenance?.chapters) ? entry.provenance.chapters : []) {
    if (Number.isInteger(value)) set.add(value)
  }
  return set
}

export function normalizeFlushPolicy(policy = {}) {
  const source = isPlainObject(policy) ? policy : {}
  const pick = (key) => (Number.isFinite(source[key]) && source[key] > 0 ? source[key] : DEFAULT_FLUSH_POLICY[key])
  return {
    version: CACHE_TIER_VERSION,
    flushEntries: pick('flushEntries'),
    flushChapters: pick('flushChapters'),
    flushChars: pick('flushChars'),
    keepReferenced: source.keepReferenced !== false,
    retrieveLimit: pick('retrieveLimit'),
    retrieveChars: pick('retrieveChars')
  }
}

/**
 * 缓存池水位读数（决定该不该 flush）。
 * @param {Object[]} working 当前热窗条目
 * @returns {{entries:number, chars:number, chapters:number[], shouldFlush:boolean, reason:string|null}}
 */
export function workingLevel(working, policy = DEFAULT_FLUSH_POLICY) {
  const p = normalizeFlushPolicy(policy)
  const list = (Array.isArray(working) ? working : []).filter(isPlainObject)
  const chapters = new Set()
  let chars = 0
  for (const entry of list) {
    chars += entryChars(entry)
    for (const chapter of chaptersOf(entry)) chapters.add(chapter)
  }
  const chapterList = [...chapters].sort((left, right) => left - right)
  let shouldFlush = false
  let reason = null
  if (list.length >= p.flushEntries) { shouldFlush = true; reason = `条数 ${list.length} ≥ ${p.flushEntries}` }
  else if (chars >= p.flushChars) { shouldFlush = true; reason = `字数 ${chars} ≥ ${p.flushChars}` }
  else if (chapterList.length >= p.flushChapters) { shouldFlush = true; reason = `章跨度 ${chapterList.length} ≥ ${p.flushChapters}` }
  return { entries: list.length, chars, chapters: chapterList, shouldFlush, reason }
}

/**
 * 知识映射：archive 的轻量索引（实体 → 条目 + 别名），供检索与「命中即合并」用。
 * 这是 RAG 的词法层地基——有了它，字面命中检索不需要向量。
 */
export function buildKnowledgeMap(entries) {
  const byName = new Map()
  const byAlias = new Map()
  for (const entry of (Array.isArray(entries) ? entries : []).filter(isPlainObject)) {
    const name = str(entry.name).trim()
    if (!name) continue
    byName.set(name, entry.id)
    for (const alias of Array.isArray(entry.aliases) ? entry.aliases : []) {
      const token = str(alias).trim()
      if (!token || token === name) continue
      if (!byAlias.has(token)) byAlias.set(token, [])
      byAlias.get(token).push(entry.id)
    }
  }
  return { byName, byAlias, size: byName.size }
}

/**
 * flush 决策：working → archive 的搬运清单。
 * **确定性**：只按谓词 keep(entry) 与预算判定，不看模型。
 * @param {Object} input
 *   working    热窗条目
 *   keep       谓词：仍要留在 working 的条目（如被推演/渲染引用的）——缺省只保留「章跨度最大的一章」
 *   policy     预算
 * @returns {{move:Object[], stay:Object[], level:Object, reason:string|null}}
 */
export function planFlush({ working = [], keep = null, policy = DEFAULT_FLUSH_POLICY } = {}) {
  const p = normalizeFlushPolicy(policy)
  const level = workingLevel(working, p)
  if (!level.shouldFlush) return { move: [], stay: [...working], level, reason: null }
  const predicate = typeof keep === 'function' ? keep : (entry) => {
    // 缺省：保留最新一章（下一批抽取通常从它接续上下文），其余下沉
    const latest = level.chapters[level.chapters.length - 1]
    if (!Number.isInteger(latest)) return false
    return chaptersOf(entry).has(latest)
  }
  const move = []
  const stay = []
  for (const entry of Array.isArray(working) ? working : []) {
    if (p.keepReferenced && predicate(entry)) stay.push(entry)
    else move.push(entry)
  }
  return { move, stay, level, reason: level.reason }
}

/**
 * 检索窗口：从 archive 取回少量命中（字面命中优先，条数与字数双闸）。
 * **不灌 top-k 大水漫灌**——这是作者「充分利用 rag 又不涣散注意力」的机制本体。
 *
 * @param {Object} input
 *   entries    archive 条目（全量；本函数只做确定性筛选，向量检索经 VectorPort 另行注入）
 *   query      文本（通常是当前段/当前提问）
 *   names      已知实体名（额外命中源：与 query 无关但明确需要的实体）
 *   policy     预算
 * @returns {{hits:Object[], dropped:number, usedChars:number, note:string}}
 */
export function retrieveWindow({ entries = [], query = '', names = [], policy = DEFAULT_FLUSH_POLICY } = {}) {
  const p = normalizeFlushPolicy(policy)
  const list = (Array.isArray(entries) ? entries : []).filter(isPlainObject)
  const text = str(query)
  const wanted = new Set((Array.isArray(names) ? names : []).map((name) => str(name).trim()).filter(Boolean))
  const scored = []
  for (const entry of list) {
    const name = str(entry.name).trim()
    const aliases = (Array.isArray(entry.aliases) ? entry.aliases : []).map((alias) => str(alias).trim())
    // 字面命中双向判：query 里出现名字（正文提名）或名字里含 query（查短名「克莱恩」命中「克莱恩·莫雷蒂」）。
    // 反向（名字含 query）要求 query ≥2 字且名字 ≥2 字——防「不」这类单字把无关条目全捞进来。
    const hitsName = (term) => {
      if (!term || !text) return false
      if (text.includes(term)) return true
      return text.length >= 2 && term.length >= 2 && term.includes(text)
    }
    let score = 0
    if (wanted.has(name)) score += 10
    if (hitsName(name)) score += 5
    for (const alias of aliases) {
      if (!alias) continue
      if (wanted.has(alias)) score += 8
      if (hitsName(alias)) score += 4
    }
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((left, right) => right.score - left.score)
  const hits = []
  let usedChars = 0
  for (const { entry } of scored) {
    if (hits.length >= p.retrieveLimit) break
    const size = entryChars(entry)
    if (usedChars + size > p.retrieveChars) continue
    hits.push(entry)
    usedChars += size
  }
  return {
    hits,
    dropped: scored.length - hits.length,
    usedChars,
    note: scored.length && !hits.length
      ? '全部命中的条目都超出检索预算——本轮不带 archive 内容（宁缺不灌）'
      : hits.length ? `按字面命中取回 ${hits.length}/${scored.length} 条` : '无字面命中，本轮不带 archive 内容'
  }
}

/**
 * 归档（retired）：剪枝/重复/失效的条目只留指纹，不占上下文也不占 archive。
 * @param {Object[]} entries
 * @param {string} reason  'pruned'|'duplicate'|'superseded'
 */
export function retireEntries(entries, reason = 'pruned') {
  return (Array.isArray(entries) ? entries : []).filter(isPlainObject).map((entry) => ({
    id: str(entry.id),
    name: str(entry.name),
    layer: str(entry.layer),
    reason: str(reason),
    archivedAt: null // 时间戳由调用方填（域内不取系统时钟）
  }))
}
