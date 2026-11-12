/**
 * 身份演进：先到先得采集 ＋ 真名优先呈现（作者 2026-11-12 裁定）。
 *
 * 作者原话：「最后再世界 wiki 里呈现的时候，真名 > 昵称 > 视角关系。
 * 但是再采集的过程中，先出现什么，就锁定什么。必要的时候也允许流程打开 thinking 结合已有的 rag 去推理身份。」
 *
 * 两套规则，互不冲突：
 *   · **采集期（先到先得）**：第一个出现的称呼就是条目身份，立刻建条目——
 *     不等到真名（否则第一人称小说里的「男友」「妈妈」会整段丢失）。
 *   · **呈现期（真名优先）**：条目名按 identityRank 排序替换：
 *     真名(3) > 昵称/绰号(2) > 视角称谓(1)。真名一旦出现，条目的 displayName 就升级为真名，
 *     原称谓降为 alias（历史引用不断链）。
 *
 * 本模块纯函数：不做"哪两个名字是同一个人"的推理（那需要 RAG + thinking，由 Host 决定），
 * 只负责「给定一组名字，谁该当显示名、谁做别名」以及排序权重。
 */

export const IDENTITY_VERSION = 'fact-identity@1'

/** 身份强度：数字越大越优先当显示名。 */
export const IDENTITY_RANK = Object.freeze({
  title: 1,   // 视角称谓：男友、妈妈、闺蜜
  alias: 2,   // 昵称/绰号/化名：小柯、老李、愚者
  name: 3     // 真名：林逸、沈岚、欧阳修
})

/** 真名形态：2–5 字纯中文（姓＋名）；西文名首字母大写。 */
const SURNAME_LIKE = /^[\u4e00-\u9fa5]{2,5}$/u
const WESTERN_NAME = /^[A-Z][A-Za-z'.-]{1,20}$/u
/**
 * 昵称/绰号形态（优先级低于真名）：
 *   · 小X / 老X / 阿X（小柯、老李、阿明）——单字昵称；
 *   · 带「小/老/阿」前缀 + 1–2 字；
 *   · 叠字（婷婷、圆圆）；
 *   · 带引号的绰号（愚者、倒吊人这类塔罗代号由调用方标 isAlias）。
 */
const NICKNAME_PATTERN = /^(?:小|老|阿)[\u4e00-\u9fa5]$|^([\u4e00-\u9fa5])\1$/u

/**
 * 给一个名字打身份权重。
 * @param {string} name
 * @param {{isTitle?:boolean, isAlias?:boolean}} [hints] 已知是称谓/昵称时标注
 * @returns {{rank:number, kind:'name'|'alias'|'title'}}
 */
export function identityRank(name, hints = {}) {
  const value = String(name ?? '').trim()
  if (!value) return { rank: 0, kind: 'title' }
  if (hints.isTitle) return { rank: IDENTITY_RANK.title, kind: 'title' }
  // 昵称低于真名：小柯/老李/阿明/婷婷。
  if (hints.isAlias || NICKNAME_PATTERN.test(value)) return { rank: IDENTITY_RANK.alias, kind: 'alias' }
  if (WESTERN_NAME.test(value)) return { rank: IDENTITY_RANK.name, kind: 'name' }
  if (SURNAME_LIKE.test(value)) {
    // 2–5 字中文：默认按真名算（称谓由 hints.isTitle 单独标注，不在这里猜）。
    return { rank: IDENTITY_RANK.name, kind: 'name' }
  }
  return { rank: IDENTITY_RANK.alias, kind: 'alias' }
}

/**
 * 从一组候选名里挑显示名。
 * 规则：rank 高者胜；同 rank 取**先出现**的（先到先得，保证确定性）。
 * @param {Array<{name:string, order:number, isTitle?:boolean}>} candidates
 * @returns {{displayName:string|null, aliases:string[]}}
 */
export function pickDisplayName(candidates) {
  const list = (Array.isArray(candidates) ? candidates : [])
    .filter((item) => item && typeof item.name === 'string' && item.name.trim())
    .map((item) => ({
      name: item.name.trim(),
      order: Number.isFinite(item.order) ? item.order : 0,
      ...identityRank(item.name, { isTitle: item.isTitle })
    }))
  if (!list.length) return { displayName: null, aliases: [] }
  const sorted = [...list].sort((left, right) => right.rank - left.rank || left.order - right.order)
  const displayName = sorted[0].name
  const aliases = [...new Set(sorted.slice(1).map((item) => item.name))].filter((name) => name !== displayName)
  return { displayName, aliases }
}

/**
 * 把一个新出现的名字并入既有身份：
 *   · 新名 rank 更高 → 新名当显示名，旧名降别名（**id 不变**，历史引用不断）；
 *   · 否则 → 新名进别名。
 * @param {{displayName:string|null, aliases:string[], isTitle?:boolean}} current
 * @param {string} incoming
 * @param {{order?:number}} [options]
 */
export function mergeIdentity(current, incoming, options = {}) {
  const existing = {
    displayName: current?.displayName ?? null,
    aliases: Array.isArray(current?.aliases) ? [...current.aliases] : [],
    isTitle: Boolean(current?.isTitle)
  }
  const name = String(incoming ?? '').trim()
  if (!name) return existing
  if (!existing.displayName) return { displayName: name, aliases: existing.aliases, isTitle: Boolean(options.isTitle) }
  if (name === existing.displayName) return existing

  const currentRank = identityRank(existing.displayName, { isTitle: existing.isTitle })
  const incomingRank = identityRank(name, { isTitle: options.isTitle })
  if (incomingRank.rank > currentRank.rank) {
    const aliases = [...new Set([existing.displayName, ...existing.aliases])].filter((item) => item !== name)
    return { displayName: name, aliases, isTitle: Boolean(options.isTitle) }
  }
  if (!existing.aliases.includes(name)) existing.aliases.push(name)
  return existing
}

/**
 * 批处理：从抽取行里聚合出「一个身份的所有叫法」。
 * 采集期先到先得（order 递增），呈现期按 rank 排序。
 * @param {Array<{name:string, isTitle?:boolean}>} occurrences 按出现顺序
 */
export function resolveIdentity(occurrences) {
  let state = { displayName: null, aliases: [], isTitle: false }
  occurrences.forEach((item, index) => {
    state = mergeIdentity(state, item.name, { order: index, isTitle: item.isTitle })
  })
  return state
}
