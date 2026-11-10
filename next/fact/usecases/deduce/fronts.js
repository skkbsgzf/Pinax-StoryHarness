/**
 * 张力引擎（P-M4 / ADR 裁定 ②）：威胁前线（fronts）＋压力时钟（clocks）。
 *
 * 为什么需要它：M1 的张力读数只有「这一拍的 2d6」，那是**单拍**随机，不是**曲线**。
 * 200 拍连续游玩时，骰子不会累积——没有东西在后台变糟，故事就不会自己往坏处走，
 * 玩家也就不觉得「该做点什么了」。fronts/clocks 补的就是这条累积轴：
 *
 *   clock  压力时钟：0..max 的确定性计数器，每满一格＝世界向你逼近一步（满＝触发）。
 *   front  威胁前线：一条「谁在暗处推进什么」的线，持有一组 clock，带危险等级与到期行为。
 *
 * 三条纪律（照 ADR 与作者裁定）：
 *   1) **只推进不倒退**：时钟格数单调不减（回退＝世界倒退，故事失去压力）。想缓解只能靠
 *      作者的剧情动作结掉这条 front（archive），不是把数字改小。
 *   2) **推进源全是确定性的**：检定失败／挂机（同一条 front 连续多拍没被处理）／Oracle 否/
 *      导演手动点火——每条推进都留 trace，可复算，不靠模型心情。
 *   3) **满格＝触发，不是静默**：满了要给出可观察的世界动作（trigger text），
 *      由调用方决定接进候选还是直接落一条必然事件；引擎不替作者写剧情。
 *
 * 纯函数、零宿主依赖：只 import fact 域内相对路径，不碰 node 内置 / process / 文件系统。
 */
import { sha1Hex } from '../../domain/stableId.js'

export const FRONTS_VERSION = 'fronts-clock@1'

/** 推进源（全部确定性；模型提议不算推进源——它只能建议作者手动点火）。 */
export const CLOCK_ADVANCE_SOURCES = Object.freeze([
  'fate-fail',   // 命运检定受阻
  'idle',        // 同一条 front 连续 N 拍没被处理
  'oracle-no',   // Oracle／作者否掉一条推进
  'director'     // 导演手动点火
])

/** front 生命期：active 在推进；resolved 已被剧情结掉（不再计时）。 */
export const FRONT_STATUSES = Object.freeze(['active', 'resolved'])

const DANGER_LEVELS = Object.freeze(['low', 'medium', 'high'])

function str(value) {
  return String(value ?? '')
}

function trimmed(value) {
  return str(value).trim()
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function clampInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

export const DEFAULT_CLOCK_MAX = 6

/**
 * 造一条 front（威胁前线）。
 * @param {{id?, name, threat?, danger?, max?, idleThreshold?, trigger?, clocks?, prefix?}} input
 */
export function createFront(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const name = trimmed(source.name)
  if (!name) return null
  const danger = DANGER_LEVELS.includes(trimmed(source.danger)) ? trimmed(source.danger) : 'medium'
  const max = clampInt(source.max, 1, 12, DEFAULT_CLOCK_MAX)
  return {
    version: FRONTS_VERSION,
    id: trimmed(source.id) || `front-${sha1Hex(`front|${name}`).slice(0, 8)}`,
    name,
    threat: trimmed(source.threat),
    danger,
    // 挂机判定阈值：同一条 front 连续这么多拍没被处理就自己走一格。
    idleThreshold: clampInt(source.idleThreshold, 1, 20, 3),
    trigger: trimmed(source.trigger),
    status: 'active',
    // 两枚时钟：impending＝世界逼近（危险），progress＝玩家推进（好转）。语义分开才读得出局势。
    clocks: {
      impending: { value: 0, max, filled: false, triggeredAtRound: null },
      progress: { value: 0, max, filled: false, triggeredAtRound: null }
    },
    idleCount: 0,
    trace: [],
    createdAtRound: Number.isInteger(source.createdAtRound) ? source.createdAtRound : 0
  }
}

/** 从世界书 rules 槽位预埋 fronts 模板（ADR「世界书 rules 槽位预埋 fronts 模板」）。 */
export function frontsFromRules(entries = [], { atRound = 0 } = {}) {
  const fronts = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isPlainObject(entry)) continue
    if (entry.layer !== 'worldview' || entry.slot !== 'rules') continue
    if (trimmed(entry.status) !== 'adopted') continue
    // 只有显式声明了 fronts 模板的规则条目才立 front——不拿自由文本猜威胁。
    const template = isPlainObject(entry.fronts) ? entry.fronts : null
    if (!template) continue
    const front = createFront({
      id: trimmed(template.id) || `front-${sha1Hex(`rule|${str(entry.id)}`).slice(0, 8)}`,
      name: trimmed(template.name) || entry.name,
      threat: trimmed(template.threat) || trimmed(entry.definition),
      danger: template.danger,
      max: template.max,
      idleThreshold: template.idleThreshold,
      trigger: template.trigger,
      createdAtRound: atRound
    })
    if (front) fronts.push(front)
  }
  return fronts
}

/** 时钟推进一格（不越界）；返回这一格是否把时钟推满。source/note 只进 trace，不进时钟本身。 */
function advanceClock(clock, round) {
  if (!isPlainObject(clock) || clock.filled) return { filled: false, at: clock?.value ?? 0 }
  clock.value = Math.min(clock.max, clock.value + 1)
  if (clock.value >= clock.max) {
    clock.filled = true
    clock.triggeredAtRound = round
    return { filled: true, at: clock.value }
  }
  return { filled: false, at: clock.value }
}

/**
 * 推进一条 front 的 impending 时钟，并留 trace。
 * @returns {{ok:true, front, filled, triggered:boolean}|{ok:false, code, message}}
 */
export function advanceFront(fronts, frontId, { round = 0, source = 'director', note = '', clock = 'impending' } = {}) {
  const target = (Array.isArray(fronts) ? fronts : []).find((item) => item?.id === trimmed(frontId))
  if (!target) return { ok: false, code: 'FRONT_NOT_FOUND', message: `没有这条前线：${trimmed(frontId)}` }
  if (target.status === 'resolved') return { ok: false, code: 'FRONT_RESOLVED', message: `前线「${target.name}」已结，不再计时` }
  const kind = clock === 'progress' ? 'progress' : 'impending'
  const prior = target.clocks?.[kind]
  const { filled, at } = advanceClock(prior, round)
  const triggered = filled && kind === 'impending'
  target.trace.push({
    atRound: round,
    clock: kind,
    source: CLOCK_ADVANCE_SOURCES.includes(source) ? source : 'director',
    note: trimmed(note),
    value: at,
    filled,
    triggered
  })
  return { ok: true, front: target, filled, triggered, clock: kind, value: at }
}

/**
 * 挂机推进：同一条 front 连续 idleThreshold 拍没被处理 → 自己走一格，计数归零。
 * 「被处理」由调用方显式 touchFront 声明（作者选了这条线相关的候选、或导演注入了干预）。
 */
export function tickIdleFronts(fronts, { round = 0 } = {}) {
  const advanced = []
  for (const front of Array.isArray(fronts) ? fronts : []) {
    if (!isPlainObject(front) || front.status !== 'active') continue
    front.idleCount = (Number.isInteger(front.idleCount) ? front.idleCount : 0) + 1
    if (front.idleCount < front.idleThreshold) continue
    front.idleCount = 0
    const result = advanceFront(fronts, front.id, { round, source: 'idle', note: '挂机推进' })
    if (result.ok) advanced.push({ frontId: front.id, name: front.name, filled: result.filled, triggered: result.triggered, value: result.value })
  }
  return advanced
}

/** 这条 front 被处理了（作者的剧情动作碰了它）：挂机计数归零，不推进时钟。 */
export function touchFront(fronts, frontId) {
  const target = (Array.isArray(fronts) ? fronts : []).find((item) => item?.id === trimmed(frontId))
  if (!target) return { ok: false, code: 'FRONT_NOT_FOUND' }
  target.idleCount = 0
  return { ok: true, front: target }
}

/** 结掉一条 front（剧情上真的解决了）：status=resolved，全部时钟停摆。 */
export function resolveFront(fronts, frontId, { round = 0, note = '' } = {}) {
  const target = (Array.isArray(fronts) ? fronts : []).find((item) => item?.id === trimmed(frontId))
  if (!target) return { ok: false, code: 'FRONT_NOT_FOUND' }
  target.status = 'resolved'
  target.resolvedAtRound = round
  target.trace.push({ atRound: round, clock: 'none', source: 'director', note: trimmed(note) || '结掉前线', value: null, filled: false, triggered: false })
  return { ok: true, front: target }
}

/**
 * 张力读数（给局面卡与曲线验收用）。
 *   heat    0..1：所有 active front 的 impending 填充率的最大值（最紧的那条说了算）
 *   filled  已触发的 front 清单（世界动作待接）
 *   curve   逐拍历史（由调用方在每拍后推入）——200 拍不塌的验收就是看这条
 */
export function tensionReading(fronts = []) {
  const list = (Array.isArray(fronts) ? fronts : []).filter((item) => isPlainObject(item) && item.status === 'active')
  let heat = 0
  for (const front of list) {
    const clock = front.clocks?.impending
    if (!isPlainObject(clock) || !Number.isFinite(clock.max) || clock.max <= 0) continue
    heat = Math.max(heat, Math.min(1, (Number(clock.value) || 0) / clock.max))
  }
  const filled = (Array.isArray(fronts) ? fronts : [])
    .filter((item) => isPlainObject(item) && item.status === 'active' && item.clocks?.impending?.filled === true)
    .map((item) => ({ id: item.id, name: item.name, danger: item.danger, trigger: item.trigger, triggeredAtRound: item.clocks.impending.triggeredAtRound }))
  return {
    version: FRONTS_VERSION,
    active: list.length,
    resolved: (Array.isArray(fronts) ? fronts : []).filter((item) => isPlainObject(item) && item.status === 'resolved').length,
    heat: Number(heat.toFixed(3)),
    level: heat >= 0.85 ? 'critical' : heat >= 0.6 ? 'high' : heat >= 0.3 ? 'medium' : 'low',
    filled
  }
}

/** 时钟文案（局面卡「张力」字段用）：没 frontline 时说平缓，有则报最紧那条。 */
export function tensionText(fronts = []) {
  const reading = tensionReading(fronts)
  if (!reading.active) return '平缓'
  const list = (Array.isArray(fronts) ? fronts : []).filter((item) => isPlainObject(item) && item.status === 'active')
  let tightest = null
  let ratio = -1
  for (const front of list) {
    const clock = front.clocks?.impending
    if (!isPlainObject(clock) || !Number.isFinite(clock.max) || clock.max <= 0) continue
    const current = (Number(clock.value) || 0) / clock.max
    if (current > ratio) { ratio = current; tightest = front }
  }
  if (!tightest) return '平缓'
  const clock = tightest.clocks.impending
  return `${tightest.name} ${clock.value}/${clock.max}${clock.filled ? '（已触发）' : ''}`
}

/** 已触发、但还没被剧情接住的 front（世界动作待接清单）。 */
export function pendingTriggers(fronts = []) {
  return tensionReading(fronts).filled
}

/**
 * 伏笔编织（ADR「M4 fronts·clocks＋伏笔编织」的后半条）：
 * 把**已经存在**的悬置伏笔（plot 里 hypothesis＋open）接成新的威胁前线。
 *
 * 为什么必须有这一条：fronts 是有限的（世界书里预埋几条就是几条），全部结掉后张力归零——
 * 200 拍连续游玩到中段就会平掉。真实跑团靠「旧钩子发酵成新麻烦」续压：上一章没解释的脚步声，
 * 这一章该找上门了。这里只做**转换**，不凭空造威胁——没有悬置伏笔就什么都不发生。
 *
 * 种子时钟：伏笔已经悬了至少 1 拍，所以新 front 的 impending 从 1 起（不是 0）——
 * 它不是「刚刚出现」，是「一直没解决，现在开始收利息」。
 *
 * @param {Object[]} fronts      现有前线（就地追加）
 * @param {Object[]} hypotheses  悬置伏笔（plot 条目；按 runId/id 去重，已被转化过的不再转）
 * @param {{round?:number, max?:number, floor?:number}} [options]
 *        floor：低于这个活跃数才补线（默认 1——至少有 1 条在跑，不让曲线彻底平掉）
 * @returns {Object[]} 新立起的前线
 */
export function braidFronts(fronts = [], hypotheses = [], { round = 0, max = 6, floor = 1 } = {}) {
  const list = Array.isArray(fronts) ? fronts : []
  const active = list.filter((item) => isPlainObject(item) && item.status === 'active')
  if (active.length >= floor) return []
  const used = new Set(list.map((item) => trimmed(item?.fromHypothesis)).filter(Boolean))
  const created = []
  for (const hypothesis of Array.isArray(hypotheses) ? hypotheses : []) {
    if (active.length + created.length >= floor) break
    if (!isPlainObject(hypothesis)) continue
    const hypothesisId = trimmed(hypothesis.id) || trimmed(hypothesis.name)
    if (!hypothesisId || used.has(hypothesisId)) continue
    const name = trimmed(hypothesis.name) || '未命名伏笔'
    const front = createFront({
      id: `front-hyp-${sha1Hex(`hypothesis|${hypothesisId}`).slice(0, 8)}`,
      name,
      threat: trimmed(hypothesis.definition) || name,
      danger: 'medium',
      max: clampInt(max, 1, 12, DEFAULT_CLOCK_MAX),
      trigger: `${name}——这条一直没解释的线找上门了`,
      createdAtRound: round
    })
    if (!front) continue
    front.fromHypothesis = hypothesisId
    // 已经悬了至少 1 拍：种子时钟从 1 起，不假装它刚刚出现。
    front.clocks.impending.value = Math.min(front.clocks.impending.max, 1)
    front.trace.push({ atRound: round, clock: 'impending', source: 'director', note: '伏笔发酵成威胁前线', value: front.clocks.impending.value, filled: false, triggered: false })
    list.push(front)
    created.push(front)
  }
  return created
}
