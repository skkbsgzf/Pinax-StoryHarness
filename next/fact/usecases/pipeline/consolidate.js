/**
 * 确定性折叠（P-TRIM Track 3，T-1.5）：跨 run 的「命中即合并」——IG 巩固的纯函数核心。
 *
 * 定位（ADR §4.3）：finish 编译出本 run 的条目后，不整表替换已发布快照，而是把每条 incoming
 * 折进已存在的同实体条目——匹配与合并全部程序侧确定性完成（B8：巩固零模型注意力）。
 *
 * 三级匹配（渐进，L2 向量后置）：
 *   id 匹配     stableEntryId 相同（同名同层同槽）→ 直接合并；
 *   L0 别名     incoming.name 命中 existing 的别名组（name＋aliases 的 aliasIndex）；
 *   L1 词法     归一后包含关系（短侧 ≥2 字、唯一候选、非 plot）→ 自动并＋L1_LEXICAL_MERGE 留痕；
 *               多候选 → 不合并，L1_AMBIGUOUS 记账（不猜）。
 *
 * fold 语义（v1 knowledge.py 的教训逐条落实）：
 *   - 增量不拼接：文本字段走 unique/joined（identical 去重），数组走并集去重——不产生「同一句话滚三次」；
 *   - existing 赢身份：id/name/slot/status 不动（作者已 adopted 的条目永不被降级、不被改名）；
 *   - 冲突不静默：constraint 同 key 异值 → CONSTRAINT_VALUE_CONFLICT_FOLDED（保 existing 值）；
 *     definitions 多版 → DEFINITION_VARIANTS；castRole 跨 tier → castRoles 保留全部带出处；
 *   - 出处并集：sources 按 segmentId 去重并集、provenance.chapters 并集排序、validity 取跨度；
 *   - fingerprint 重算：metrics.chars 用 segmentChars 逐段求和（service 注入段表，不估不摊）。
 *
 * 纯函数、零宿主依赖：只 import fact 域内相对路径；同一输入永远得到同一输出。
 */
import { createAliasIndex } from '../../domain/aliases.js'
import { normalizeName } from './extractionChain.js'

export const CONSOLIDATE_VERSION = 'fact-consolidate@1'

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

const unique = (values) => [...new Set(values)]
const joined = (values) => unique(values.map((value) => str(value ?? '').trim()).filter(Boolean)).join('\n')
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

/** 无向关系去重键：{from,to} 排序对＋type——消「两条 to:梅丽莎 type:兄妹」式重复（guimi E9）。 */
const relationKey = (from, to, type) => `${[from, to].slice().sort(compareText).join('|')}|${type}`

function minMax(a, b) {
  if (!isPlainObject(a)) return b ? { ...b } : undefined
  if (!isPlainObject(b)) return { ...a }
  const from = [a.from, b.from].every((v) => Number.isInteger(v)) ? Math.min(a.from, b.from) : (a.from ?? b.from ?? null)
  const to = [a.to, b.to].every((v) => Number.isInteger(v)) ? Math.max(a.to, b.to) : (a.to ?? b.to ?? null)
  return { from, to }
}

/** L1 词法候选：归一后包含关系（短侧 ≥2 字）；返回所有命中的 existing 条目。 */
function lexicalCandidates(incomingName, existingEntries) {
  const incoming = normalizeName(incomingName)
  if (incoming.length < 2) return []
  const hits = []
  for (const entry of existingEntries) {
    const existing = normalizeName(entry.name)
    if (!existing || existing === incoming) continue
    if (existing.includes(incoming) || incoming.includes(existing)) {
      const shorter = Math.min(existing.length, incoming.length)
      if (shorter >= 2) hits.push(entry)
    }
  }
  return hits
}

/**
 * 三级匹配：incoming（编译产物条目）→ existing 里的一员。
 * @returns {{target: Object|null, matchedBy: 'id'|'L0-alias'|'L1-lexical'|null, ambiguous: Object[]}}
 */
export function matchExisting(incoming, existingEntries, options = {}) {
  if (!isPlainObject(incoming)) return { target: null, matchedBy: null, ambiguous: [] }
  // id 匹配（同名同层同槽 ⇒ 同 stableEntryId）
  const byId = existingEntries.find((entry) => entry.id === incoming.id)
  if (byId) return { target: byId, matchedBy: 'id', ambiguous: [] }
  // plot 不参与 L0/L1：plot id 由段哈希决定，没有「同实体不同名」——未命中就是新段
  if (incoming.layer === 'plot') return { target: null, matchedBy: null, ambiguous: [] }
  // L0 别名：existing 的别名组（name＋aliases）解析 incoming.name
  const aliasIndex = options.aliasIndex ?? createAliasIndex(existingEntries)
  const resolved = aliasIndex.resolve(normalizeName(incoming.name))
  if (resolved) {
    const target = existingEntries.find((entry) => normalizeName(entry.name) === resolved)
    if (target) return { target, matchedBy: 'L0-alias', ambiguous: [] }
  }
  // L1 词法：包含关系且唯一（非 plot）
  const candidates = lexicalCandidates(incoming.name, existingEntries.filter((entry) => entry.layer === incoming.layer))
  if (candidates.length === 1) return { target: candidates[0], matchedBy: 'L1-lexical', ambiguous: [] }
  if (candidates.length > 1) return { target: null, matchedBy: null, ambiguous: candidates }
  return { target: null, matchedBy: null, ambiguous: [] }
}

/** sources 并集（按 segmentId 去重；existing 在前，顺序稳定）。 */
function unionSources(existing, incoming) {
  const out = []
  const seen = new Set()
  for (const ref of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!isPlainObject(ref) || !ref.segmentId || seen.has(ref.segmentId)) continue
    seen.add(ref.segmentId)
    out.push({ sourceId: ref.sourceId ?? null, segmentId: ref.segmentId, quote_hash: ref.quote_hash ?? null })
  }
  return out
}

function unionRelations(existing, incoming) {
  const seen = new Set()
  const out = []
  for (const relation of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!isPlainObject(relation)) continue
    const to = str(relation.to).trim()
    if (!to) continue
    const key = relationKey(str(relation.from ?? to), to, str(relation.type))
    if (seen.has(key)) continue
    seen.add(key)
    out.push(relation)
  }
  return out
}

function unionKnowledge(existing, incoming) {
  const seen = new Set()
  const out = []
  for (const record of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!isPlainObject(record)) continue
    const key = `${str(record.fromEntry)}|${str(record.note)}|${record.atSpan?.from ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(record)
  }
  return out
}

/** 知情/锚点这类「数组 of 对象」的并集由各字段专管；这里管 anchors。 */
function unionAnchors(existing, incoming) {
  const channels = new Set([...Object.keys(existing ?? {}), ...Object.keys(incoming ?? {})])
  const out = {}
  for (const channel of channels) {
    out[channel] = unique([...(existing?.[channel] ?? []), ...(incoming?.[channel] ?? [])])
  }
  return out
}

/** 文本行合并：并集后去掉「是另一行严格子串」的短行（保最长）——逐字重复与被覆盖的旧句都不滚存。 */
function mergeLines(oldText, newText) {
  const lines = unique([...str(oldText ?? '').split('\n'), ...str(newText ?? '').split('\n')].map((line) => line.trim()).filter(Boolean))
  const kept = lines.filter((line, index) => !lines.some((other, otherIndex) => otherIndex !== index && other.includes(line) && other.length > line.length))
  return kept.join('\n')
}

/** castRole/castRoles 按 tier 归并；跨 tier 保留 castRoles 全部带出处（compile 同口径）。 */
function mergeCastRole(existing, incoming, warnings, entryId) {
  const groups = new Map()
  const collect = (role) => {
    if (!isPlainObject(role) || !role.tier) return
    if (!groups.has(role.tier)) groups.set(role.tier, [])
    groups.get(role.tier).push(role)
  }
  collect(existing.castRole)
  for (const role of Array.isArray(existing.castRoles) ? existing.castRoles : []) collect(role)
  collect(incoming.castRole)
  for (const role of Array.isArray(incoming.castRoles) ? incoming.castRoles : []) collect(role)
  if (!groups.size) return {}
  const castRoles = [...groups].map(([tier, list]) => ({
    tier,
    goal: mergeLines(list.map((role) => role.goal ?? '').join('\n'), ''),
    plotFunction: mergeLines(list.map((role) => role.plotFunction ?? '').join('\n'), '')
  }))
  if (castRoles.length === 1) return { castRole: castRoles[0] }
  warnings.push({ code: 'CAST_ROLE_CONFLICT_FOLDED', entryId, message: `折叠时人物出现多个 tier（${castRoles.map((role) => role.tier).join('/')}），保留 castRoles 全部，未裁定单值` })
  return { castRoles }
}

/** worldview 约束合并：按 key first-wins；同 key 异值告警不静默（X0 作用域随条目走）。 */
function mergeConstraint(existing, incoming, warnings, entryId) {
  const hasExisting = Array.isArray(existing?.constraint) || isPlainObject(existing?.constraint)
  const hasIncoming = Array.isArray(incoming?.constraint) || isPlainObject(incoming?.constraint)
  if (!hasExisting) return incoming?.constraint !== undefined ? { constraint: incoming.constraint } : {}
  if (!hasIncoming) return { constraint: existing.constraint }
  const list = (value) => (Array.isArray(value) ? value : isPlainObject(value) ? [value] : [])
  const byKey = new Map()
  for (const item of [...list(existing.constraint), ...list(incoming.constraint)]) {
    if (!isPlainObject(item)) continue
    const key = str(item.key).trim()
    if (!key) continue
    const prior = byKey.get(key)
    if (!prior) { byKey.set(key, { ...item, scope: item.scope === 'world' ? 'world' : 'entry' }); continue }
    if (JSON.stringify(prior.value) !== JSON.stringify(item.value)) {
      warnings.push({ code: 'CONSTRAINT_VALUE_CONFLICT_FOLDED', entryId, key, message: `折叠时约束「${key}」出现不同值（${JSON.stringify(prior.value)} / ${JSON.stringify(item.value)}），保留先到值` })
    }
    if (prior.scope !== 'world' && item.scope === 'world') byKey.set(key, { ...prior, scope: 'world' })
  }
  return { constraint: [...byKey.values()] }
}

/**
 * 把 incoming 折进 existing（existing 赢身份：id/name/slot/status 不动）。
 * plot 同 id ⇒ 同段同哈希 ⇒ 幂等（existing 原样返回）。
 */
export function consolidatePair(existing, incoming, warnings = [], options = {}) {
  const segmentChars = options.segmentChars ?? new Map()
  const entry = { ...existing }
  const sources = unionSources(existing.sources, incoming.sources)
  entry.sources = sources
  const provenance = { ...(isPlainObject(existing.provenance) ? existing.provenance : {}) }
  provenance.chapters = [...new Set([
    ...(Array.isArray(existing.provenance?.chapters) ? existing.provenance.chapters : []),
    ...(Array.isArray(incoming.provenance?.chapters) ? incoming.provenance.chapters : [])
  ])].sort((a, b) => a - b)
  entry.provenance = provenance
  const validity = minMax(existing.validity, incoming.validity)
  if (validity) entry.validity = validity
  entry.fingerprint = {
    vec: entry.fingerprint?.vec ?? null,
    metrics: { sources: sources.length, chars: sources.reduce((sum, ref) => sum + (segmentChars.get(ref.segmentId) ?? 0), 0) }
  }
  if (existing.layer === 'plot') return entry // plot id 由段哈希决定：同 id ⇒ 同段 ⇒ 幂等
  entry.aliases = unique([
    ...(Array.isArray(existing.aliases) ? existing.aliases : []),
    ...(Array.isArray(incoming.aliases) ? incoming.aliases : []),
    ...(normalizeName(incoming.name) !== normalizeName(existing.name) ? [normalizeName(incoming.name)] : [])
  ].map((alias) => normalizeName(alias))).filter(Boolean)
  if (existing.layer === 'character') {
    entry.identity = mergeLines(existing.identity, incoming.identity)
    entry.traits = unique([...(existing.traits ?? []), ...(incoming.traits ?? [])])
    entry.personality = mergeLines(entry.personality, joined(entry.traits))
    entry.anchors = unionAnchors(existing.anchors ?? {}, incoming.anchors ?? {})
    const knowledge = unionKnowledge(existing.knowledge, incoming.knowledge)
    if (knowledge.length) entry.knowledge = knowledge
    const relations = unionRelations(existing.relations, incoming.relations)
    if (relations.length) entry.relations = relations
    const cast = mergeCastRole(existing, incoming, warnings, entry.id)
    Object.assign(entry, cast)
    if (entry.castRoles) delete entry.castRole // 折出多 tier 后单值 castRole 必须让位，不能两套并存
    if (entry.castRole) delete entry.castRoles
  }
  if (existing.layer === 'worldview') {
    const definitions = unique([
      ...(Array.isArray(existing.definitions) ? existing.definitions : (existing.definition ? [existing.definition] : [])),
      ...(Array.isArray(incoming.definitions) ? incoming.definitions : (incoming.definition ? [incoming.definition] : []))
    ]).filter(Boolean)
    if (definitions.length) {
      const kept = definitions.filter((line, index) => !definitions.some((other, otherIndex) => otherIndex !== index && other.includes(line) && other.length > line.length))
      entry.definitions = kept
      entry.definition = kept.join('\n')
      if (kept.length > 1) warnings.push({ code: 'DEFINITION_VARIANTS', entryId: entry.id, message: '折叠后定义存在多版本，全部保留，未判定覆盖或矛盾' })
    }
    Object.assign(entry, mergeConstraint(existing, incoming, warnings, entry.id))
    if (entry.rank === undefined && incoming.rank !== undefined) entry.rank = incoming.rank
  }
  if (Array.isArray(existing.hooks) || Array.isArray(incoming.hooks)) {
    entry.hooks = unique([...(existing.hooks ?? []), ...(incoming.hooks ?? [])])
  }
  return entry
}

/**
 * 批后巩固：把 incoming（本 run 编译产物）折进 existing（已发布快照）。
 *
 * @returns {{entries, assignments, stats, warnings}}
 *   assignments: [{incomingId, targetId, matchedBy}]——incoming.id ≠ targetId 即吸收（原 id 让位）
 *   stats: {matched: {id,L0-alias,L1-lexical}, added, unchanged, changed, ambiguous}
 */
export function consolidateEntries(existingEntries, incomingEntries, options = {}) {
  const existing = (Array.isArray(existingEntries) ? existingEntries : []).filter(isPlainObject)
  const incoming = (Array.isArray(incomingEntries) ? incomingEntries : []).filter(isPlainObject)
  const warnings = []
  const aliasIndex = createAliasIndex(existing)
  const segmentChars = options.segmentChars ?? new Map()

  // 先全量进列（匹配宇宙＝existing ∪ 已新增），收尾再剪掉「从未成为合并目标」的既有条目（＝来源已移出）。
  const entries = [...existing]
  const position = new Map(entries.map((entry, index) => [entry.id, index]))
  const assignments = []
  const stats = { matched: { id: 0, 'L0-alias': 0, 'L1-lexical': 0 }, added: 0, unchanged: 0, changed: 0, ambiguous: 0 }

  for (const item of incoming) {
    const match = matchExisting(item, entries, { aliasIndex })
    if (match.ambiguous.length) {
      stats.ambiguous += 1
      warnings.push({ code: 'L1_AMBIGUOUS', incomingId: item.id, name: str(item.name), message: `词法候选不唯一（${match.ambiguous.map((entry) => str(entry.name)).join('、')}），不合并，等作者裁定` })
    }
    if (!match.target) {
      entries.push(item)
      position.set(item.id, entries.length - 1)
      // 新增条目同步进别名索引：后续 incoming 若是它的别名/包含名，走 L0 而不是落 L1
      aliasIndex.add(normalizeName(item.name), (Array.isArray(item.aliases) ? item.aliases : []).map(normalizeName))
      stats.added += 1
      assignments.push({ incomingId: item.id, targetId: item.id, matchedBy: null })
      continue
    }
    const target = match.target
    const before = JSON.stringify(target)
    const merged = consolidatePair(target, item, warnings, { segmentChars })
    entries[position.get(target.id)] = merged
    stats.matched[match.matchedBy] += 1
    assignments.push({ incomingId: item.id, targetId: target.id, matchedBy: match.matchedBy })
    if (match.matchedBy === 'L1-lexical') {
      warnings.push({ code: 'L1_LEXICAL_MERGE', entryId: target.id, incomingId: item.id, message: `「${str(item.name)}」词法包含命中「${str(target.name)}」，已自动折叠（唯一候选）` })
    }
    const after = JSON.stringify(merged)
    if (after === before) stats.unchanged += 1
    else stats.changed += 1
  }
  // 未命中的 existing 原样保留——「来源是否移出范围」是调用方的范围知识，模块不越权删除。
  // service 在 finish 里按「entry.sources 全不在新范围内」决定 removed（旧整表替换语义的等价物）。
  const unassigned = existing.filter((entry) => !assignments.some((item) => item.targetId === entry.id))
  return { entries, assignments, unassigned, stats, warnings, version: CONSOLIDATE_VERSION }
}
