/** 三层候选生成（M1-a）：必然▮（世界事实确定性推导）／命运⚙（2d6 剧情检定）／戏剧✦（LlmPort 提议）。
 * 每候选带来源徽章；全部过一致性筛（引用未知实体＝与已确认世界矛盾，候选层确定性拒——端点固定路径自由）。
 * P-WIRE：筛子有两档——世界级（实体存在）与视角级（POV 此刻是否知晓，见 sceneContext.js）。 */
import { createAliasIndex } from '../../domain/aliases.js'
import { spendAi } from './sessionState.js'
import { buildSceneContext, refsWithinKnown, visibleNamesOf } from './sceneContext.js'
/**
 * 游玩 / 推演提议用的 system prompt（双叙述纪律的「游玩侧」常量）。
 * 这是主持问答 / 候选提议体：提议剧情走向、输出候选 JSON，面向推演会话，
 * 不是小说叙述体。成书渲染走 render/prose.js 的 RENDER_PROSE_SYSTEM_PROMPT，
 * 两者绝不共用、绝不拼接（fact-render.test.mjs 断言两常量互不等）。
 */
export const DEDUCE_DRAMA_SYSTEM_PROMPT = '你是剧情推演提议器。基于事实包提出候选剧情走向，输出 JSON：{"proposals":[{"text":"一句话走向","refs":["涉及的已有实体名"]}}}。refs 只能引用事实包里存在的实体。'


/** 种子化 PRNG（mulberry32）——2d6 可复现（重掷＝换 seed）。 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function roll2d6(rng) {
  const a = 1 + Math.floor(rng() * 6)
  const b = 1 + Math.floor(rng() * 6)
  return { a, b, sum: a + b, success: a + b >= 7 }
}

function knownNames(entries) {
  const index = createAliasIndex(Array.isArray(entries) ? entries : [])
  const names = new Set()
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry && entry.name) names.add(entry.name)
  }
  for (const alias of index.aliases ?? []) names.add(alias)
  return names
}

/** 一致性筛：候选引用的实体必须存在于已确认世界（否则拒——引用未知＝矛盾）。 */
function screen(candidate, known) {
  for (const ref of candidate.refs ?? []) {
    if (!known.has(ref)) return false
  }
  return true
}

/** L-必然▮：rules/events 槽位里生效的世界事实确定性推导（直接 adopted——世界自己在推进）。 */
export function necessityCandidates(entries, limit = 2) {
  const out = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.layer !== 'worldview') continue
    if (entry.slot !== 'rules' && entry.slot !== 'events') continue
    if (entry.status !== 'adopted') continue
    out.push({
      id: `necessity-${entry.id}`,
      source: '必然', badge: '▮',
      text: `${entry.name}——${entry.definition ?? '世界规则在推进'}`,
      adopted: true, proposed: false,
      refs: [entry.name]
    })
    if (out.length >= limit) break
  }
  return out
}

/** L-命运⚙：2d6 剧情检定（结算确定、结果真不确定；骰点 trace 全留）。 */
export function fateCandidates(state, rng, limit = 1) {
  const out = []
  for (let i = 0; i < limit; i++) {
    const trace = roll2d6(rng)
    out.push({
      id: `fate-${state.round}-${i}`,
      source: '命运', badge: '⚙',
      text: `剧情检定 2d6=${trace.a}+${trace.b}=${trace.sum}：${trace.success ? '顺遂' : '受阻'}`,
      adopted: true, proposed: false,
      trace, refs: []
    })
  }
  return out
}

/** L-戏剧✦：LlmPort 基于事实包提议（proposed——作者选了才转正）。预算耗尽/端口缺失/解析失败→隔离返回空。
 * P-WIRE：简报只给 POV 此刻可用的东西（sceneContext），不给整本世界书的目录。 */
export async function dramaCandidates({ state, pov, llmPort, seedPrompt, limit = 2, sceneContext = null }) {
  if (!llmPort || typeof llmPort.complete !== 'function') return []
  if (state.aiActionsLeft <= 0) return []
  const brief = JSON.stringify({
    pov,
    round: state.round,
    // P-WIRE：简报里给的是「POV 此刻可用的东西」，不是整个世界的目录。
    // 悬置伏笔一并喂进去——戏剧层最擅长的就是在已埋的钩子上加码，而不是另起一条线。
    present: (sceneContext?.present ?? []).slice(0, 6).map((item) => item.name),
    locations: (sceneContext?.locations ?? []).slice(0, 4),
    rules: (sceneContext?.rules ?? []).map((item) => item.name).slice(0, 5),
    openHooks: (sceneContext?.openHypotheses ?? []).slice(0, 3).map((item) => item.definition || item.name),
    recentEvents: state.log.filter((l) => l.kind === 'settle').slice(-3).map((l) => l.text ?? '')
  })
  const spend = spendAi(state, 1)
  if (spend === 0) return []
  try {
    const answer = await llmPort.complete({
      system: DEDUCE_DRAMA_SYSTEM_PROMPT + '最多 ' + limit + ' 条。' + (seedPrompt ? `\n锚定：${seedPrompt}` : '') + `\n事实包简报：${brief}`,
      maxTokens: 400
    })
    const match = /\{[\s\S]*\}/.exec(String(answer?.text ?? ''))
    if (!match) return []
    const parsed = JSON.parse(match[0])
    // spendAi 已扣预算：模型调用之后才判预算只在调用前有意义，这里不再二次扣。
    const proposals = Array.isArray(parsed?.proposals) ? parsed.proposals.slice(0, limit) : []
    return proposals.map((item, i) => ({
      id: `drama-${state.round}-${i}`,
      source: '戏剧', badge: '✦',
      text: String(item?.text ?? '').slice(0, 120),
      adopted: false, proposed: true,
      refs: Array.isArray(item?.refs) ? item.refs.map(String) : []
    })).filter((c) => c.text.length > 0)
  } catch {
    return [] // 失败隔离：戏剧层缺席不阻塞必然/命运
  }
}

/**
 * 混合呈现：必然 ≤2 ＋ 命运 1 ＋ 戏剧 ≤2，筛一致性后 2–4 条；不足用命运补位。
 *
 * 两道筛（P-WIRE）：
 *   1) 世界级——候选引用的实体必须真实存在（引用未知＝与已确认世界矛盾，恒拒）；
 *   2) 视角级——POV 此刻不知晓的实体不出现在候选里（第一视角不穿帮）。
 *      只在知情账本有条目时生效；账本为空时 sceneContext 已降级成 world 并记账，
 *      此时不拿「不知道」当「不可能」，避免把局面卡做成空的。
 */
export async function generateCandidates({ entries, state, pov, llmPort, seed = 1, seedPrompt, sceneContext = null } = {}) {
  const known = knownNames(entries)
  const aliasIndex = createAliasIndex(Array.isArray(entries) ? entries : [])
  const context = sceneContext ?? buildSceneContext({ entries, pov, extraKnown: state?.knownExtra ?? [] })
  const visible = visibleNamesOf(context, entries, aliasIndex)
  const rng = mulberry32(seed)
  const all = [
    ...necessityCandidates(entries, 2),
    ...fateCandidates(state, rng, 1),
    ...(await dramaCandidates({ state, pov, llmPort, seedPrompt, sceneContext: context }))
  ].filter((c) => screen(c, known))
    .filter((c) => refsWithinKnown(c, visible, aliasIndex))
  const deduped = []
  for (const c of all) {
    if (!deduped.some((x) => x.text === c.text)) deduped.push(c)
  }
  const mixed = [...deduped.filter((c) => c.source !== '命运'), ...deduped.filter((c) => c.source === '命运')]
  const picked = mixed.slice(0, 4)
  while (picked.length < 2) {
    const extra = fateCandidates(state, rng, 1)
    if (extra.length === 0) break
    if (!picked.some((x) => x.text === extra[0].text)) picked.push(extra[0])
    else break
  }
  return { candidates: picked.slice(0, 4), rng, sceneContext: context }
}
