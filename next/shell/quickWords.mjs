/**
 * 快捷词（批次46B · 任务②）：纯派生，不落盘。
 *
 * 词表来自两处：
 *   1) 世界书条目——名称／别名（keys）／次别名（keysSecondary），按条目类型分「角色」「设定」；
 *   2) 当前正文的 n-gram 提取——引号里的词权重最高，其次英文专名，再是 4／3／2 字中文片段，
 *      出现至少两次才收（与老线 authoringQuickWords 的派生口径一致，逻辑重写、不复制文件）。
 *
 * 启用与最近使用只活在这个模块的内存里：关掉应用就没了，不进偏好 JSON、不进 .pinax/。
 * 这是有意的——它们是「这一会儿顺手用的词」，不是项目数据。
 */

const STOP_CHARS = new Set('的了是在把被和与也都就而又这那一个我们你们他们她们它们着过'.split(''))
const MAX_TERM_CHARS = 18
const MAX_EXTRACTED_CHARS = 12

function text(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function validTerm(value) {
  return value.length >= 2 && value.length <= MAX_TERM_CHARS
}

function entryTerms(entry) {
  const raw = [entry?.name, ...list(entry?.keys), ...list(entry?.keysSecondary), ...list(entry?.aliases)]
    .map(text)
    .filter(validTerm)
  return [...new Set(raw)]
}

function excerpt(value, fallback) {
  const normalized = text(value).replace(/\s+/gu, ' ')
  if (!normalized) return fallback
  return normalized.length > 40 ? `${normalized.slice(0, 40)}…` : normalized
}

/** 正文提取（纯函数）：引号词 ×4、英文专名 ×3、中文 4／3／2 字片段 ×1；出现两次才收。 */
export function extractQuickTerms(source, { occupied = new Set(), limit = 16 } = {}) {
  const body = text(source)
  if (!body) return []
  const counts = new Map()
  const add = (value, weight = 1) => {
    const needle = text(value)
    if (needle.length < 2 || needle.length > MAX_EXTRACTED_CHARS || occupied.has(needle)) return
    counts.set(needle, (counts.get(needle) ?? 0) + weight)
  }
  for (const match of body.matchAll(/[《「【“]([^》」】”\n]{2,12})[》」】”]/gu)) add(match[1], 4)
  for (const match of body.matchAll(/\b[A-Z][A-Za-z'-]{2,18}\b/g)) add(match[0], 3)
  const runs = body.match(/[\p{Script=Han}]{2,18}/gu) ?? []
  for (const run of runs) {
    for (const size of [4, 3, 2]) {
      for (let index = 0; index + size <= run.length; index += 1) {
        const term = run.slice(index, index + size)
        if ([...term].some((char) => STOP_CHARS.has(char))) continue
        add(term)
      }
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length || left[0].localeCompare(right[0], 'zh-CN'))
    .slice(0, limit)
    .map(([value, count]) => ({
      id: `extracted:${value}`,
      text: value,
      label: value,
      summary: `正文出现 ${count} 次`,
      sourceKind: 'extracted'
    }))
}

/**
 * 建词表：世界书条目在前（角色优先于设定），正文提取在后，同文只留第一条。
 * 返回冻结数组，项形状固定 { id, text, label, summary, sourceKind }。
 */
export function buildQuickWordCatalog({ entries = [], text: body = '', limit = 16 } = {}) {
  const byText = new Map()
  const ordered = [...list(entries)].sort((left, right) => rankOf(right) - rankOf(left))
  for (const entry of ordered) {
    const sourceKind = entry?.type === 'character' ? 'character' : 'setting'
    for (const term of entryTerms(entry)) {
      if (byText.has(term)) continue
      byText.set(term, {
        id: `${sourceKind}:${entry?.id ?? entry?.path ?? entry?.name}:${term}`,
        text: term,
        label: term,
        summary: excerpt(entry?.summary || entry?.content || entry?.text, sourceKind === 'character' ? '世界书角色' : '世界书设定'),
        sourceKind
      })
    }
  }
  for (const item of extractQuickTerms(body, { occupied: new Set(byText.keys()), limit })) {
    if (byText.has(item.text)) continue
    byText.set(item.text, item)
  }
  return Object.freeze([...byText.values()].map((item) => Object.freeze(item)))
}

function rankOf(entry) {
  return entry?.type === 'character' ? 1 : 0
}

/** 按来源分组（界面用）：角色／设定／提取；空组保留空数组，界面自己决定摆不摆。 */
export function groupQuickWords(catalog = []) {
  const groups = { character: [], setting: [], extracted: [] }
  for (const item of catalog) {
    const bucket = groups[item.sourceKind] ?? groups.setting
    bucket.push(item)
  }
  return groups
}

/** 搜索过滤（名称／摘要包含即命中，大小写不敏感）。 */
export function filterQuickWords(catalog = [], query = '') {
  const needle = text(query).toLowerCase()
  if (!needle) return [...catalog]
  return catalog.filter((item) => item.text.toLowerCase().includes(needle) || String(item.summary ?? '').toLowerCase().includes(needle))
}

/* —— 会话内记忆：启用／最近使用（不落盘）————————————————————————— */

const enabledIds = new Set()
const disabledIds = new Set()
const recentIds = []

export function isQuickWordEnabled(id) {
  const key = String(id ?? '')
  // 没被显式停用就是启用：作者打开面板就能用，不必先「启用」一遍。
  return key ? !disabledIds.has(key) : false
}

export function toggleQuickWord(id, enabled = undefined) {
  const key = String(id ?? '')
  if (!key) return false
  const next = enabled === undefined ? !isQuickWordEnabled(key) : Boolean(enabled)
  if (next) disabledIds.delete(key)
  else disabledIds.add(key)
  enabledIds.add(key)
  return next
}

/** 记一次「用过」：最近使用按调用顺序倒排，最多留 8 条。 */
export function markQuickWordUsed(id) {
  const key = String(id ?? '')
  if (!key) return []
  const index = recentIds.indexOf(key)
  if (index >= 0) recentIds.splice(index, 1)
  recentIds.unshift(key)
  if (recentIds.length > 8) recentIds.length = 8
  return [...recentIds]
}

export function quickWordMemory() {
  return {
    enabled: [...enabledIds],
    disabled: [...disabledIds],
    recent: [...recentIds]
  }
}

/** 仅测试用：清空会话内记忆。 */
export function resetQuickWordMemory() {
  enabledIds.clear()
  disabledIds.clear()
  recentIds.length = 0
}
