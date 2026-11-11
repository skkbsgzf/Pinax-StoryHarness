/**
 * 显著度权重与剪枝策略（P-TRIM T-2 前置件，作者 2026-11-11 裁定补充）。
 *
 * 作者原话：「以经理这个例子，那他确实是没有用的，从后文包括前文都能够反映出他就是主角随手一提的
 * 一个没有任何作用的一个角色，他就不能被当作一个角色去建立角色文档——因为他权重没有达到一定比例，
 * 所以相应的一些流程其实也是需要对应的去省略的。诸如此类，其他的情况也是需要有类似的阈值权重，
 * 然后基于权重去做策略变化剪枝这样的一些流程。」
 *
 * 与 ADR §3.5 S1（minor 无言行只写 identity）的区别：S1 是「建一条很薄的文档」，本模块是
 * **「权重不够就根本不建条目」**。前者仍会在世界书里留一个空壳卡片，后者让它只作为
 * 「被提及的名字」存在（plot 事件 refs 里照旧，但不占条目、不进世界书面板）。
 *
 * 三条纪律：
 *   1) **权重只看可数证据**：出场段数、台词条数、动作条数、跨章数、关系数、剧作档位——
 *      全部来自抽取行，可复算，不看「重要/不重要」这类模型主观判断；
 *   2) **剪枝必须记账**：剪掉的角色进 stats.pruned + index.mentions（名字保留可解析），
 *      一致性检测不把「被剪的提及名」当悬空引用（它不是数据错，是策略结果）；
 *   3) **阈值全可配**：policy 从 compile options 注入，默认值只是「当前推荐档」，
 *      作者调一个数字就能整体变松/变紧，不用改代码。
 *
 * 纯函数、零宿主依赖。
 */

export const SALIENCE_VERSION = 'fact-salience@1'

/**
 * 默认策略。数值含义＝「该证据出现一次值多少分」；阈值是「建条目的最低分」。
 * 校准依据（guimi 前 10 章 422 条实测）：
 *   - 经理（1 次提及、0 台词、0 动作、minor）≈ 1.0 分 → 低于 floor 2.0 → 剪掉；
 *   - 周明瑞（2 段、0 台词、5 动作、protagonist）≈ 12 分 → 全档案；
 *   - 路人级（1 段、1 句台词、参与背景）≈ 2.5 分 → 建 minimal 卡片（比剪掉多一层信息，值得留）。
 */
export const DEFAULT_SALIENCE_POLICY = Object.freeze({
  version: SALIENCE_VERSION,
  /** 权重单价：每出现一次值多少分。 */
  weights: Object.freeze({
    appearance: 1.0,     // 出场段数（同一角色在不同 segment 出现）
    saying: 1.5,         // 台词条数（say 通道）
    acting: 1.0,         // 动作条数（do 通道）
    perceiving: 0.25,    // 感知/感受/内心（有戏但不推动，权重低）
    crossChapter: 2.0,   // 每跨一章（跨章出现＝长期在场，强信号）
    relation: 0.5,       // 关系条数（被反复提及的枢纽）
    knowledge: 0.5,      // 知情记录条数（参与信息流）
    cast: Object.freeze({ protagonist: 5.0, supporting: 3.0, minor: 0 })
  }),
  /** 建条目的最低分——低于它就不建角色条目（只作为提及名存在）。 */
  characterEntryFloor: 2.0,
  /** 内容深度分档（≥ 该档阈值即按该档产出）。低于 characterEntryFloor 的由上一行拦截。 */
  characterTiers: Object.freeze([
    Object.freeze({ tier: 'full', floor: 6.0 }),   // 全档案：身份/性格/言行/记忆点/剧作功能/知情
    Object.freeze({ tier: 'brief', floor: 3.0 }),  // 简报：身份/性格/言行锚点
    Object.freeze({ tier: 'minimal', floor: 2.0 }) // 最小卡：只身份一段
  ]),
  /** 设定（worldview）的存在门槛：只被顺口提一句、无定义深度的不建条目。 */
  worldviewEntryFloor: 1.5,
  /** 关系边的门槛：两端都必须是「已建条目或已登记提及」，且关系本身有 how 说明。 */
  relationRequiresHow: false,
  /** 剪掉的角色名登记进 index.mentions（一致性检测据此不报悬空）。 */
  registerMentions: true
})

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

/** policy 合并：浅合并 weights/cast，数组类字段整体覆盖（作者给了就用自己的）。 */
export function normalizeSaliencePolicy(policy = {}) {
  const source = isPlainObject(policy) ? policy : {}
  const base = DEFAULT_SALIENCE_POLICY
  const weights = isPlainObject(source.weights) ? source.weights : {}
  return {
    version: SALIENCE_VERSION,
    weights: {
      ...base.weights,
      ...weights,
      cast: { ...base.weights.cast, ...(isPlainObject(weights.cast) ? weights.cast : {}) }
    },
    characterEntryFloor: Number.isFinite(source.characterEntryFloor) ? source.characterEntryFloor : base.characterEntryFloor,
    characterTiers: Array.isArray(source.characterTiers) && source.characterTiers.length
      ? source.characterTiers.map((item) => ({ tier: str(item?.tier) || 'minimal', floor: Number(item?.floor) || 0 }))
        .sort((left, right) => right.floor - left.floor)
      : base.characterTiers.map((item) => ({ ...item })),
    worldviewEntryFloor: Number.isFinite(source.worldviewEntryFloor) ? source.worldviewEntryFloor : base.worldviewEntryFloor,
    relationRequiresHow: source.relationRequiresHow === true,
    registerMentions: source.registerMentions !== false
  }
}

/**
 * 角色显著度：只数可复算的证据。
 * @param {Object} input
 *   segments     该角色出现过的 segment 数（去重）
 *   chapters     出现过的章号集合（去重）
 *   sayings/actings/perceivings  按 channel 分类的行为条数
 *   relations/knowledge          关系、知情条数
 *   castTier     protagonist|supporting|minor（取最强档）
 * @returns {{score:number, breakdown:Object}}
 */
export function characterSalience(input = {}, policy = DEFAULT_SALIENCE_POLICY) {
  const p = normalizeSaliencePolicy(policy)
  const source = isPlainObject(input) ? input : {}
  const num = (value) => (Number.isFinite(value) && value > 0 ? value : 0)
  const breakdown = {
    appearance: num(source.segments) * p.weights.appearance,
    saying: num(source.sayings) * p.weights.saying,
    acting: num(source.actings) * p.weights.acting,
    perceiving: num(source.perceivings) * p.weights.perceiving,
    crossChapter: Math.max(0, num(source.chapters) - 1) * p.weights.crossChapter,
    relation: num(source.relations) * p.weights.relation,
    knowledge: num(source.knowledge) * p.weights.knowledge,
    cast: p.weights.cast[str(source.castTier).trim()] ?? 0
  }
  const score = Number(Object.values(breakdown).reduce((sum, value) => sum + value, 0).toFixed(2))
  return { score, breakdown }
}

/**
 * 剪枝决策：分数 → 该不该建条目、建到哪一档。
 * @returns {{keep:boolean, tier:'full'|'brief'|'minimal'|null, score:number, floor:number, reason:string}}
 */
export function decideCharacter(score, policy = DEFAULT_SALIENCE_POLICY) {
  const p = normalizeSaliencePolicy(policy)
  const value = Number.isFinite(score) ? score : 0
  if (value < p.characterEntryFloor) {
    return {
      keep: false, tier: null, score: value, floor: p.characterEntryFloor,
      reason: `显著度 ${value} 低于建条目门槛 ${p.characterEntryFloor}——只作为提及名登记，不建角色文档`
    }
  }
  const matched = p.characterTiers.find((item) => value >= item.floor) ?? { tier: 'minimal', floor: p.characterEntryFloor }
  return {
    keep: true, tier: matched.tier, score: value, floor: matched.floor,
    reason: `显著度 ${value} ≥ ${matched.floor} → ${matched.tier} 档`
  }
}

/** 设定显著度：定义深度（字数）、被提及的段数、是否有别名/关系。 */
export function worldviewSalience(input = {}, policy = DEFAULT_SALIENCE_POLICY) {
  const p = normalizeSaliencePolicy(policy)
  const source = isPlainObject(input) ? input : {}
  const definitionChars = Number.isFinite(source.definitionChars) ? source.definitionChars : 0
  const segments = Number.isFinite(source.segments) ? source.segments : 0
  // 定义本身是主信号：>60 字视为「有实质设定」，只有一句顺口提到的不到 30 字
  const score = Number(((definitionChars >= 60 ? 2.0 : definitionChars >= 30 ? 1.0 : 0.2) + segments * 0.5).toFixed(2))
  return {
    score,
    keep: score >= p.worldviewEntryFloor,
    floor: p.worldviewEntryFloor,
    reason: score >= p.worldviewEntryFloor
      ? `设定显著度 ${score} ≥ ${p.worldviewEntryFloor}`
      : `设定显著度 ${score} 低于门槛 ${p.worldviewEntryFloor}——只是顺口一提，不建设定条目`
  }
}

/**
 * 内容深度分层：按 tier 裁剪条目字段（不删事实，只决定哪些字段值得产出）。
 * 注意：本函数只返回「该产出哪些字段组」的清单，实际裁剪由 compile 执行——
 * 因为字段裁剪要跟 sources/provenance 一起动，散在这里会失控。
 */
export function fieldsForTier(tier) {
  switch (str(tier)) {
    case 'full':
      return ['identity', 'personality', 'traits', 'anchors', 'castRole', 'castRoles', 'knowledge', 'relations', 'memoryPoints']
    case 'brief':
      return ['identity', 'personality', 'traits', 'anchors', 'relations']
    case 'minimal':
      return ['identity']
    default:
      return []
  }
}

/**
 * 一次编译的剪枝汇总：把逐条决策收成 stats + 提及登记。
 * @param {Array<{name:string, decision:Object}>} decisions
 */
export function summarizePruning(decisions) {
  const list = Array.isArray(decisions) ? decisions.filter((item) => isPlainObject(item) && item.decision) : []
  const kept = list.filter((item) => item.decision.keep)
  const pruned = list.filter((item) => !item.decision.keep)
  const byTier = {}
  for (const item of kept) byTier[item.decision.tier] = (byTier[item.decision.tier] ?? 0) + 1
  return {
    considered: list.length,
    kept: kept.length,
    pruned: pruned.length,
    byTier,
    prunedNames: pruned.map((item) => str(item.name)).filter(Boolean),
    scores: list.map((item) => ({ name: str(item.name), score: item.decision.score, tier: item.decision.tier }))
  }
}
