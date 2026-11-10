/** 作品一致性检测（fact-consistency）：抽取之后、全书拆解完成或改编改写前，对整库过一遍。
 * 分工：抽取链只负责「记下来」，错判/漏判的判定集中在这一次全文扫描里。
 * 复用 gate 的四类断言（锚点/规则/时间轴/知情），再补抽取态特有的一致性：
 *   关系目标悬空、知情来源悬空、同名跨层冲突、槽位堆积、别名歧义、伏笔未回收统计。
 * 确定性检查先行：可判定的直接给 conflict；不可判定的如实列 undecidable，不拿文本猜语义。 */
import { runFactGate, FACT_GATE_VERSION } from './gate.js'
import { normalizeName, buildIndex } from './pipeline/extractionChain.js'

export const FACT_CONSISTENCY_VERSION = 'fact-consistency/v1'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 关系目标 / 知情来源悬空：引用了索引里不存在的实体名。 */
function checkDanglingReferences(entries, byName, byAlias) {
  const known = (name) => {
    const token = normalizeName(name)
    return Boolean(token) && (Object.hasOwn(byName, token) || Object.hasOwn(byAlias, token))
  }
  const out = []
  for (const entry of entries) {
    for (const relation of Array.isArray(entry.relations) ? entry.relations : []) {
      const to = relation?.to
      if (!to || known(to)) continue
      out.push({
        code: 'RELATION_TARGET_UNRESOLVED', category: 'relations', severity: 'warning', decidable: true,
        where: entry.name, detail: `关系目标「${to}」不在索引中（type=${relation.type ?? '?'}）`,
        entryId: entry.id
      })
    }
    for (const record of Array.isArray(entry.knowledge) ? entry.knowledge : []) {
      const from = record?.fromEntry
      if (!from || known(from)) continue
      out.push({
        code: 'KNOWLEDGE_SOURCE_UNRESOLVED', category: 'knowledge', severity: 'warning', decidable: true,
        where: entry.name, detail: `知情来源「${from}」不在索引中`, entryId: entry.id
      })
    }
  }
  return out
}

/** 同名跨层：同一规范名同时出现在世界观/人物/剧情三层，多半是模型把实体拆成了两份。 */
function checkCrossLayerNames(entries) {
  const byNameLayer = new Map()
  for (const entry of entries) {
    const name = normalizeName(entry.name)
    if (!name) continue
    if (!byNameLayer.has(name)) byNameLayer.set(name, new Set())
    byNameLayer.get(name).add(entry.layer)
  }
  const out = []
  for (const [name, layers] of byNameLayer) {
    if (layers.size <= 1) continue
    out.push({
      code: 'NAME_ACROSS_LAYERS', category: 'identity', severity: 'warning', decidable: true,
      where: name, detail: `同一名称出现在多层：${[...layers].join('/')}（可能是同一实体的两份投影）`
    })
  }
  return out
}

/** 槽位堆积：worldview 里落进 other 的比例过高，说明槽位映射没跟上（补映射的体检指标）。 */
function checkSlotPileup(entries, threshold = 0.3) {
  const worldview = entries.filter((entry) => entry.layer === 'worldview')
  if (!worldview.length) return []
  const others = worldview.filter((entry) => entry.slot === 'other')
  const ratio = others.length / worldview.length
  if (ratio <= threshold) return []
  return [{
    code: 'SLOT_PILEUP', category: 'mapping', severity: 'warning', decidable: true,
    where: 'worldview', detail: `other 槽位占 ${Math.round(ratio * 100)}%（${others.length}/${worldview.length}），建议补槽位映射表`,
    names: others.map((entry) => entry.name).slice(0, 20)
  }]
}

/** 伏笔回收统计：hooks 里能对上下文的算已回收（仅统计，不判定是否该回收）。 */
function summarizeHooks(entries) {
  const hooks = []
  for (const entry of entries) {
    for (const text of Array.isArray(entry.hooks) ? entry.hooks : []) {
      hooks.push({ text: String(text ?? '').trim(), entryId: entry.id, chapter: entry.validity?.from ?? null })
    }
  }
  const open = hooks.filter((item) => item.text)
  return { total: open.length, items: open.slice(0, 50) }
}

/**
 * 整库一致性检测。
 * @param {Object[]} entries 已编译的 fact.data/v2 条目（抽取快照或作者事实库皆可）
 * @param {Object} [options] 透传给 gate 的选项（aliasIndex、roundTrip 端口）
 */
export function checkConsistency(entries, options = {}) {
  const list = (Array.isArray(entries) ? entries : []).filter(isPlainObject)
  const gate = runFactGate(list, options)
  const index = buildIndex(list)
  const byName = index.byName
  const byAlias = index.byAlias

  const extra = [
    ...checkDanglingReferences(list, byName, byAlias),
    ...checkCrossLayerNames(list),
    ...checkSlotPileup(list)
  ]
  const conflicts = [...gate.conflicts, ...extra.filter((item) => item.severity === 'error' && item.decidable)]
  const warnings = [...gate.assertions.filter((item) => item.severity === 'warning'), ...extra.filter((item) => item.severity === 'warning')]

  return {
    ok: conflicts.length === 0,
    version: FACT_CONSISTENCY_VERSION,
    gateVersion: FACT_GATE_VERSION,
    counts: {
      entries: list.length,
      errors: conflicts.length,
      warnings: warnings.length,
      undecidable: gate.undecidable.length,
      hooks: summarizeHooks(list).total
    },
    conflicts,
    warnings,
    undecidable: gate.undecidable,
    hooks: summarizeHooks(list),
    index
  }
}
