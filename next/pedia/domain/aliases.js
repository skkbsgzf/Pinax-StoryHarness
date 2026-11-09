/**
 * 别名归并（union-find，双向互指）——domain 真源。
 *
 * 用途：世界书条目带 aliases（v2 的 aliases／世界书的 keys），一个词可能指多条条目：
 *   - 正向：词 → 规范名（resolve），用于「@《秒子》」这类引用定位；
 *   - 反向：规范名 → 全部词（aliasesOf），用于生成索引与提示；
 *   - 冲突：同一个词被两条不同条目声明时，如实报出来（不静默选一个）。
 *
 * 归并策略：同一条目的 name＋aliases 归到一组（互相等价）；组内规范名取最先登记的条目名，
 * 保证同一输入得到同一输出。别名不去跨条目「猜同义」——只有同一条目声明的词才并组。
 */

function str(value) {
  return String(value ?? '')
}

function normalizeTerm(value) {
  return str(value).trim()
}

function normalizeAliases(name, aliases) {
  const canonical = normalizeTerm(name)
  const list = []
  const source = Array.isArray(aliases) ? aliases : []
  for (const alias of source) {
    const term = normalizeTerm(alias)
    if (!term || term === canonical || list.includes(term)) continue
    list.push(term)
  }
  return list
}

/**
 * 创建别名索引。
 * @param {Array<{name: string, aliases?: string[]}>} entries 初始条目（可后补 add）
 */
export function createAliasIndex(entries = []) {
  const parent = new Map()
  const rank = new Map()
  const canonicalOfRoot = new Map()
  const seenOrder = new Map()
  const declarations = new Map()
  let order = 0
  const conflicts = []

  const ensure = (term) => {
    if (!parent.has(term)) {
      parent.set(term, term)
      rank.set(term, 0)
      canonicalOfRoot.set(term, term)
      seenOrder.set(term, order)
      order += 1
    }
  }

  const find = (term) => {
    let root = term
    while (parent.get(root) !== root) root = parent.get(root)
    let cursor = term
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)
      parent.set(cursor, root)
      cursor = next
    }
    return root
  }

  const canonicalOf = (term) => {
    const root = find(term)
    return canonicalOfRoot.get(root) ?? root
  }

  const union = (left, right) => {
    const rootLeft = find(left)
    const rootRight = find(right)
    if (rootLeft === rootRight) return false
    // 规范名取先登记者，与并查树形状无关，保证输出确定。
    const first = seenOrder.get(canonicalOfRoot.get(rootLeft)) <= seenOrder.get(canonicalOfRoot.get(rootRight))
      ? rootLeft
      : rootRight
    const second = first === rootLeft ? rootRight : rootLeft
    if (rank.get(first) < rank.get(second)) {
      parent.set(first, second)
      canonicalOfRoot.set(second, canonicalOfRoot.get(first))
      canonicalOfRoot.delete(first)
    } else {
      parent.set(second, first)
      if (rank.get(first) === rank.get(second)) rank.set(first, rank.get(first) + 1)
      canonicalOfRoot.delete(second)
    }
    return true
  }

  const add = (name, aliases = []) => {
    const canonical = normalizeTerm(name)
    if (!canonical) return { ok: false, code: 'EMPTY_NAME', added: [] }
    ensure(canonical)
    if (!declarations.has(canonical)) declarations.set(canonical, canonical)
    const added = []
    for (const term of normalizeAliases(canonical, aliases)) {
      ensure(term)
      // 冲突：这个词已被另一条条目声明过，且两边还没并组——先记账再并组。
      const prior = declarations.get(term)
      if (prior && prior !== canonical && find(prior) !== find(canonical)) {
        if (!conflicts.some((item) => item.term === term && item.claimants.includes(prior) && item.claimants.includes(canonical))) {
          conflicts.push({ term, claimants: [prior, canonical] })
        }
      }
      if (!declarations.has(term)) declarations.set(term, canonical)
      if (union(canonical, term)) added.push(term)
    }
    return { ok: true, canonical, added }
  }

  const resolve = (term) => {
    const text = normalizeTerm(term)
    if (!text || !parent.has(text)) return null
    return canonicalOf(text)
  }

  const aliasesOf = (name) => {
    const canonical = resolve(name)
    if (!canonical) return []
    return [...parent.keys()].filter((term) => canonicalOf(term) === canonical)
  }

  const groups = () => {
    const byRoot = new Map()
    for (const term of parent.keys()) {
      const canonical = canonicalOf(term)
      if (!byRoot.has(canonical)) byRoot.set(canonical, [])
      byRoot.get(canonical).push(term)
    }
    return [...byRoot.entries()]
      .map(([canonical, terms]) => ({
        canonical,
        aliases: terms.filter((term) => term !== canonical),
        members: terms
      }))
      .sort((left, right) => left.canonical.localeCompare(right.canonical, 'zh-Hans-CN'))
  }

  const forward = () => {
    const map = new Map()
    for (const term of parent.keys()) map.set(term, canonicalOf(term))
    return map
  }

  const reverse = () => {
    const map = new Map()
    for (const group of groups()) map.set(group.canonical, group.aliases)
    return map
  }

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry) continue
    add(entry.name, entry.aliases ?? entry.keys)
  }

  return {
    add,
    resolve,
    aliasesOf,
    groups,
    conflicts: () => conflicts.map((item) => ({ term: item.term, claimants: [...item.claimants] })),
    forward,
    reverse,
    size: () => parent.size
  }
}
