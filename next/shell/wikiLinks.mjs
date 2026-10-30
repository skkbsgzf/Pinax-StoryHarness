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
