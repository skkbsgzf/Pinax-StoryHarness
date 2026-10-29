/**
 * @ 引用参考（批次27 · 任务三）：@《标题》 → 运行时已有工具取摘要 → 拼进问题原文。
 *
 * 作者原话：「@ 弹出参考」。这里只做三件纯事：
 *   1) parseRefs(text)  抽出 @《…》 token（去重，正文里的普通 @ 不算）；
 *   2) resolveRefs(...) 按 kind 走运行时已有的只读工具取一段摘要（每条截前 600 字，最多 4 条），
 *      取不到的那条如实标注「（引用取不到：…）」，不静默丢、也不编内容；
 *   3) withRefs(...)    把问题原文与每条参考拼成一次提问的正文。
 *
 * 工具面按现有 schema 调用（与 useBoardData 同一条 runtimeToolCall 通道，不新增 IPC）：
 *   chapter  → pinax_chapter_read   { file }
 *   entry    → pinax_worldbook_read { id } 或 { name }（该工具没有 path 参数，按标题定位）
 *   document → pinax_document_read  { file }
 *   script   → pinax_script_read    { file }
 * 读工具的 maxChars 下限是 1000，所以截断在本地做（clip），不靠参数。
 *
 * 纯数据模块，不 import Vue，也不碰网络：tool 回调由调用方注入（真实链路是 bridge.request）。
 */

/** 一次提问最多带几条引用。 */
export const MAX_REFERENCE_TOKENS = 4

/** 每条引用的摘要长度（超出截断，末尾标「…」）。 */
export const REFERENCE_CLIP_CHARS = 600

/** 引用清单的分类顺序（@ 弹层按它排）。 */
export const REFERENCE_KIND_ORDER = Object.freeze(['chapter', 'entry', 'document', 'script'])

/** 分类徽章的人话。 */
export const REFERENCE_KIND_LABELS = Object.freeze({
  chapter: '章节',
  entry: '条目',
  document: '资料',
  script: '剧本'
})

export function referenceKindLabel(kind) {
  return REFERENCE_KIND_LABELS[String(kind ?? '')] ?? '引用'
}

const REFERENCE_TOKEN = /@《([^》\n]{1,80})》/gu

/**
 * 抽出 @《…》 token。同一标题只算一条（作者在正文里重复点到同一篇是常事）。
 * 返回 [{ title, token }]，顺序即出现顺序。
 */
export function parseRefs(text) {
  const found = []
  const seen = new Set()
  for (const match of String(text ?? '').matchAll(REFERENCE_TOKEN)) {
    const title = match[1].trim()
    if (!title || seen.has(title)) continue
    seen.add(title)
    found.push({ title, token: match[0] })
  }
  return found
}

/**
 * 标题 → 引用清单里的一条（{ kind, title, path }）。
 * 先精确后唯一包含；命中多条的包含匹配宁可不认（取错一条比取不到更糟）。
 */
export function matchReference(title, catalog) {
  const wanted = String(title ?? '').trim()
  if (!wanted) return null
  const list = (Array.isArray(catalog) ? catalog : []).filter((item) => item && typeof item === 'object')
  const exact = list.find((item) => String(item.title ?? '') === wanted)
  if (exact) return exact
  const loose = list.filter((item) => String(item.title ?? '').includes(wanted))
  return loose.length === 1 ? loose[0] : null
}

function referenceCall(ref) {
  const file = String(ref.path ?? ref.file ?? '').trim()
  switch (ref.kind) {
    case 'chapter':
      return { tool: 'pinax_chapter_read', args: file ? { file } : { title: ref.title } }
    case 'document':
      return { tool: 'pinax_document_read', args: file ? { file } : { title: ref.title } }
    case 'script':
      return { tool: 'pinax_script_read', args: file ? { file } : { title: ref.title } }
    case 'entry':
      // 世界书读取按 id／name 定位（没有 path 参数）：清单带了 id 就用 id，否则按标题找名字。
      return { tool: 'pinax_worldbook_read', args: ref.id ? { id: String(ref.id) } : { name: String(ref.title ?? '') } }
    default:
      return null
  }
}

function extractText(kind, value) {
  if (!value || typeof value !== 'object') return ''
  if (kind === 'entry') {
    const content = value.entry?.content
    return typeof content === 'string' ? content : (typeof value.text === 'string' ? value.text : '')
  }
  return typeof value.text === 'string' ? value.text : ''
}

function clipText(text, limit) {
  const source = String(text ?? '').trim()
  if (source.length <= limit) return source
  return `${source.slice(0, limit)}…`
}

/**
 * 逐条取引用。
 * tool: async (name, args) → { ok, value } | { ok:false, message }
 * 返回 [{ kind, title, ok, text?, note? }]——失败的那条带 note，不静默丢。
 */
export async function resolveRefs(refs, tool, options = {}) {
  const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : MAX_REFERENCE_TOKENS
  const clip = Number.isSafeInteger(options.clip) && options.clip > 0 ? options.clip : REFERENCE_CLIP_CHARS
  const list = (Array.isArray(refs) ? refs : []).slice(0, limit)
  const resolved = []

  for (const ref of list) {
    const title = String(ref?.title ?? '').trim()
    const kind = String(ref?.kind ?? '').trim()
    if (!title) continue
    if (!kind) {
      resolved.push({ kind: '', title, ok: false, note: '项目清单里没有这一条（可能已删除，或那一栏还没打开过）' })
      continue
    }
    const call = referenceCall(ref)
    if (!call) {
      resolved.push({ kind, title, ok: false, note: `外壳不认识「${kind}」这类引用` })
      continue
    }
    if (typeof tool !== 'function') {
      resolved.push({ kind, title, ok: false, note: '运行时没接工具面（渲染层未接主进程桥）' })
      continue
    }

    let result
    try {
      result = await tool(call.tool, { ...call.args, maxChars: Math.max(1000, clip) })
    } catch (error) {
      result = { ok: false, message: String(error?.message || error) }
    }
    if (!result || result.ok !== true) {
      resolved.push({ kind, title, ok: false, note: String(result?.message ?? '读取失败') })
      continue
    }
    const text = clipText(extractText(kind, result.value), clip)
    if (!text) {
      resolved.push({ kind, title, ok: false, note: '读回来是空的' })
      continue
    }
    resolved.push({ kind, title, ok: true, text })
  }

  return resolved
}

/**
 * 拼成一次提问的正文：问题原文 + 每条一段【参考·kind《title》】。
 * 失败的那条也占一段，写清「（引用取不到：…）」——模型该知道哪条没拿到，而不是当它不存在。
 */
export function withRefs(question, resolved) {
  const base = String(question ?? '').trim()
  const list = Array.isArray(resolved) ? resolved : []
  if (!list.length) return base
  const parts = [base]
  for (const ref of list) {
    const label = `【参考·${referenceKindLabel(ref.kind)}《${String(ref.title ?? '').trim()}》】`
    parts.push(ref.ok
      ? `${label}\n${String(ref.text ?? '').trim()}`
      : `${label}\n（引用取不到：${String(ref.note ?? '未知原因').trim()}）`)
  }
  return parts.join('\n\n')
}
