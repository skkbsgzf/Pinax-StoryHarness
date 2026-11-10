/**
 * Wiki 双链与反向链接（批次38）：条目阅读态的「条目名 → 可点链接」与「谁引用了我」。
 *
 * 设计口径：
 *   - 双链是**前端后处理**：渲染层在 md 渲染产物上把其它条目的名字包成链接（DOM 文本节点遍历，
 *     不碰 HTML 字符串——正则改 HTML 是转义漏洞的温床）。`<a>/<code>/<pre>` 子树跳过。
 *   - 匹配是**整串包含、最长优先、互不重叠**：名字两两交叠时长的赢（「真相层·十二维、阶数与主角」
 *     优先于「真相层·十二维」），同一段文字只归一条链接。
 *   - 反向链接＝其它条目的 relations[].to 提到我，或正文包含我的名字——两种都算，来源不必区分
 *     （来源标注是图谱视图的事，阅读态只管「还有哪里能看到我」）。
 *   - 反向链接不含自己（path 与 name 双重排除），空名一律不算。
 */

/** 纯函数：text 里 names 的出现区间（最长优先、互不重叠，按出现顺序）。node 轨可测。 */
export function wikiLinkRanges(text, names) {
  const source = String(text ?? '')
  const sorted = [...(names ?? [])]
    .map((name) => String(name ?? '').trim())
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length)
  const ranges = []
  for (const name of sorted) {
    let from = 0
    for (;;) {
      const idx = source.indexOf(name, from)
      if (idx < 0) break
      const end = idx + name.length
      if (!ranges.some((range) => idx < range.end && end > range.start)) {
        ranges.push({ start: idx, end, name })
      }
      from = end
    }
  }
  return ranges.sort((a, b) => a.start - b.start)
}

/**
 * 条目词表（批次44 · 作者 2026-10-31：「你在前端设计了一些蓝色的标签，看上去能跳转，但是其实不行」）。
 *
 * 一条纪律贯穿：**看着能点就必须点得动**。所以词表只收「恰好指向一条条目」的词：
 *   - 全名、短名（· 后缀）、别名（aliases／keys）、标签（tags）都算候选；
 *   - 一个词若落在两条以上条目上（通用标签「记忆」「结构」就是这种），它不进词表——
 *     正文里就当普通文字，不染蓝。染了蓝还点不动，比不染更坏。
 * 词表与解析器共用这一张表（buildEntryTokenMap）：渲染时链进去的词，点下去一定打得开。
 */
export function buildEntryTokenMap(entries) {
  const owners = new Map()
  for (const entry of entries ?? []) {
    for (const token of entryLinkTokensOf(entry)) {
      if (!owners.has(token)) owners.set(token, new Set())
      owners.get(token).add(entry)
    }
  }
  const map = new Map()
  for (const [token, ownersOfToken] of owners) {
    if (ownersOfToken.size !== 1) continue
    map.set(token, [...ownersOfToken][0])
  }
  return map
}

/** 一条条目贡献的全部候选词（去重、长度 ≥2）。 */
export function entryLinkTokensOf(entry) {
  const tokens = []
  const push = (value) => {
    const text = String(value ?? '').trim()
    if (text.length >= 2 && !tokens.includes(text)) tokens.push(text)
  }
  const name = String(entry?.name ?? '').trim()
  push(name)
  const short = name.split('·')[1]
  if (short) push(short)
  for (const word of [...(entry?.aliases ?? []), ...(entry?.keys ?? []), ...(entry?.tags ?? [])]) push(word)
  return tokens
}

/** 当前条目自己的词：它们不链自己（链到自己等于没跳）。 */
export function ownEntryTokens(entry) {
  return new Set(entryLinkTokensOf(entry))
}

/** 目标身份：同一张词表里同名不同物的词必须判得出来（条目／资料／约束各自 kind 与 path 不同）。 */
function tokenTargetIdentity(target) {
  if (!target || typeof target !== 'object') return ''
  return [target.kind ?? '', target.path ?? '', target.name ?? target.item?.path ?? ''].join('\u0000')
}

/**
 * 合并多张 token → target 词表（批次 W3：hub 链接表 ＋ 资料／约束词表）。
 * 纪律与 buildEntryTokenMap 一致：一个词只有**恰好指向同一个目标**时才留下；
 * 词出现在两张表里但目标是不同东西（同类名不同 path，或条目与资料同名），整词剔除并记冲突。
 * 返回 { map, conflicts }；冲突逐条带 token 与全部候选目标，调用方可以如实显示「未链接」。
 */
export function mergeTokenMaps(...maps) {
  const owners = new Map()
  for (const map of maps) {
    if (!(map instanceof Map)) continue
    for (const [token, target] of map) {
      if (!owners.has(token)) owners.set(token, new Map())
      owners.get(token).set(tokenTargetIdentity(target), target)
    }
  }
  const merged = new Map()
  const conflicts = []
  for (const [token, targets] of owners) {
    if (targets.size === 1) merged.set(token, [...targets.values()][0])
    else conflicts.push({ token, owners: [...targets.values()] })
  }
  return { map: merged, conflicts }
}

/**
 * 跨载体知识库（批次60）：蓝链的目标不再只是世界书——资料与约束同属一个知识库。
 * 这里把三棵既有树归一成一张清单（kind／name／path／原始 item），词表仍交给
 * buildEntryTokenMap 收口：一个词落在两条以上知识条目上，照旧不染蓝。
 * 只做归一，不发任何工具调用——三棵树仍由 useBoardData 各记各的。
 */
export function buildKnowledgeCatalog({ entries = [], documents = [], rules = [] } = {}) {
  const catalog = []
  for (const item of entries ?? []) {
    const name = String(item?.name ?? '').trim()
    if (name) catalog.push({ kind: 'entry', name, path: String(item?.path ?? ''), item })
  }
  for (const item of documents ?? []) {
    const name = String(item?.title ?? item?.name ?? '').trim() || String(item?.file ?? '')
    if (name) catalog.push({ kind: 'document', name, path: String(item?.file ?? ''), item })
  }
  for (const item of rules ?? []) {
    const name = String(item?.title ?? item?.name ?? '').trim() || String(item?.file ?? '')
    if (name) catalog.push({ kind: 'rule', name, path: String(item?.file ?? ''), item })
  }
  return catalog
}

/** 纯函数：反向链接清单（relations 提到或正文包含；排除自己；node 轨可测）。 */
export function computeBacklinks(entries, currentName, currentPath) {
  const name = String(currentName ?? '').trim()
  if (!name) return []
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && String(entry?.name ?? '') !== name)
    .filter((entry) => (String(entry?.path ?? '') || null) !== (String(currentPath ?? '') || null))
    .filter((entry) => {
      const relations = Array.isArray(entry.relations) ? entry.relations : []
      const viaRelations = relations.some((relation) => String(relation?.to ?? '').includes(name))
      const viaContent = typeof entry.content === 'string' && entry.content.includes(name)
      return viaRelations || viaContent
    })
    .map((entry) => ({ name: String(entry.name), path: String(entry.path ?? ''), cat: String(entry.cat ?? '') }))
}

/**
 * DOM 后处理：在 root 的文本节点里把 names 包成 .nx-wikilink 链接（渲染层专用，要有 document）。
 * 返回包了几个链接；`<a>/<code>/<pre>/已包过` 的子树整段跳过。调用方负责挂点击委托。
 * `firstOnly`（维基惯例）：每个 token 全篇只链首现——通用词（记忆/结构这类 tag）开了
 * 全链会把正文糊成蓝色，首现既给入口又不吵。
 */
export function linkifyEntryNames(root, names, { firstOnly = true } = {}) {
  if (!root || typeof document === 'undefined' || !names?.length) return 0
  const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode: (node) =>
      node.parentElement?.closest('a, code, pre, .nx-wikilink') ? 2 /* REJECT */ : 1 /* ACCEPT */
  })
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  const used = new Set()
  let linked = 0
  for (const node of nodes) {
    const text = node.textContent ?? ''
    let ranges = wikiLinkRanges(text, names)
    if (firstOnly) ranges = ranges.filter((range) => !used.has(range.name))
    if (!ranges.length) continue
    const fragment = document.createDocumentFragment()
    let cursor = 0
    for (const range of ranges) {
      if (range.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, range.start)))
      const anchor = document.createElement('a')
      anchor.className = 'nx-wikilink'
      anchor.dataset.entry = range.name
      anchor.textContent = range.name
      fragment.appendChild(anchor)
      cursor = range.end
      used.add(range.name)
      linked += 1
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
    node.replaceWith(fragment)
  }
  return linked
}
