/**
 * Agent 会话状态机（批次27 起）：多会话 ＋ 可注入的落盘适配器。
 *
 * 作者原话：「参考 dsh，需要有会话管理」。批次25 之前右栏只有一份内存里的 messages，
 * 刷新即丢、也开不了第二个话题。这份模块把会话做成一个真正的状态机：
 *   - 状态全在内存里（同步、可测）；落盘交给注入的 `save(payload)`（M2.5-B：主进程写 JSONL）；
 *   - 上限：30 个会话、每会话 200 条消息，超限丢最旧（丢的是「最早的」，不是「正在看的」）；
 *   - 标题：自动取第一条 user 消息前 24 字；手动 rename 之后不再自动改；
 *   - 首启自动建一个空会话；没有 save（没打开项目／没有桥）时不落盘，照样能问。
 *
 * 本模块不再直接碰 localStorage：`initial` 是主进程读回的那份会话，`save` 是回写口。
 * 落盘失败不崩：降级为内存会话，界面照常，`snapshot().persistent` 如实报这件事。
 *
 * 纯数据模块，不 import Vue、不 import fs：node:test 能直接测状态机、上限截断与降级路径；
 * 渲染层用 subscribe() 把快照接进 ref（与 paneForms.mjs 同一套「宿主一份真相」）。
 */

/**
 * 老 localStorage 键前缀：`agentSessions.<projectRoot>`。
 * M2.5-B 起会话存 `.pinax/sessions/`，这个前缀只留给一次性迁移（sessionMigration.mjs）认老键。
 */
export const AGENT_SESSION_STORAGE_PREFIX = 'agentSessions.'

/** 会话上限：超了丢最旧。 */
export const MAX_SESSIONS = 30

/** 每会话消息上限：超了丢最旧的一条。 */
export const MAX_SESSION_MESSAGES = 200

/** 自动标题的截断长度（第一条 user 消息的前 N 字）。 */
export const SESSION_TITLE_CHARS = 24

/**
 * 每条消息随身携带的运行过程轨迹上限（批次29）。
 * 一问最多 5 类事件、每轮一条 model-round（轮数闸上限 3），32 条够装下正常一整轮，
 * 再多就是有人在灌事件——多出来的丢最旧的，不让 localStorage 被一条消息撑爆。
 */
export const MAX_TRAIL_EVENTS = 32

/** 运行过程事件只有这五种阶段（与 next/runtime/runnerAdvisor.mjs 的发射点一一对应）。 */
export const TRAIL_STAGES = Object.freeze([
  'start',
  'envelope',
  'model-round',
  // M2.5-A：工具循环接上后，这几段是运行器真会发的事件（循环默认关，关着时一条都不会出现）。
  'step',
  'tool-start',
  'tool-end',
  'tool-denied',
  'tool-dropped',
  'tool-unknown',
  'proposal-created',
  'answer',
  'failed'
])

/** 断点只认「一条链上的五个阶段」：工具事件是链上的旁支，不能冒充 failed.atStage。 */
export const TRAIL_BREAKPOINT_STAGES = Object.freeze(['start', 'envelope', 'model-round', 'answer'])

/** 还没有人说话时的会话名。 */
export const DEFAULT_SESSION_TITLE = '新会话'

export function agentSessionStorageKey(projectRoot) {
  return `${AGENT_SESSION_STORAGE_PREFIX}${String(projectRoot ?? '').trim()}`
}

/** 小时:分钟，与老版会话的时间戳同一形状（RuntimeDock 原来那行 toLocaleTimeString）。 */
export function formatClock(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** 会话列表里的相对时间：刚刚／N 分钟前／N 小时前／N 天前／到期后给日期。 */
export function formatRelativeTime(timestamp, now = Date.now()) {
  const at = Number(timestamp)
  if (!Number.isFinite(at)) return ''
  const delta = Number(now) - at
  if (!Number.isFinite(delta) || delta < 60_000) return '刚刚'
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`
  const date = new Date(at)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function cleanText(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

function cleanList(value, limit = 40) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .slice(0, limit)
    .map((item) => item.slice(0, 400))
}

/** 计数类字段：只留有限非负整数，别的一律回落 0（localStorage 里的值不可信）。 */
function cleanCount(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0
}

/**
 * 单条运行过程事件 → JSON 安全形状（批次29）。
 *
 * 逐阶段列白名单，不做「原样透传」：事件会随会话落进 localStorage，
 * 未知阶段与多余字段一律丢掉，免得存储里长出一份影子 schema。
 * 注意 failed 的断点字段叫 `atStage`——工单里写的是 `{ stage:'failed', code, stage }`（键重名），
 * 实现按语义落成 `atStage`：「stage 说这是失败，atStage 说断在哪一步」。
 */
export function sanitizeTrailEvent(raw) {
  if (!raw || typeof raw !== 'object' || !TRAIL_STAGES.includes(raw.stage)) return null
  if (raw.stage === 'start') {
    return { stage: 'start', questionChars: cleanCount(raw.questionChars) }
  }
  if (raw.stage === 'envelope') {
    return {
      stage: 'envelope',
      taskType: cleanText(raw.taskType, 80),
      profile: cleanText(raw.profile, 60),
      blocks: cleanCount(raw.blocks),
      chars: cleanCount(raw.chars),
      missingKinds: cleanList(raw.missingKinds, 12)
    }
  }
  if (raw.stage === 'model-round') {
    return { stage: 'model-round', round: cleanCount(raw.round) }
  }
  if (raw.stage === 'answer') {
    return {
      stage: 'answer',
      chars: cleanCount(raw.chars),
      structured: raw.structured === true,
      roundsUsed: cleanCount(raw.roundsUsed)
    }
  }
  if (raw.stage === 'step') {
    return {
      stage: 'step',
      step: cleanCount(raw.step),
      tools: cleanList(raw.tools, 8)
    }
  }
  if (raw.stage === 'tool-start' || raw.stage === 'tool-unknown') {
    return { stage: raw.stage, name: cleanText(raw.name, 80), callId: cleanText(raw.callId, 80) }
  }
  if (raw.stage === 'tool-end') {
    return {
      stage: 'tool-end',
      name: cleanText(raw.name, 80),
      callId: cleanText(raw.callId, 80),
      ok: raw.ok === true,
      ms: cleanCount(raw.ms)
    }
  }
  if (raw.stage === 'tool-denied') {
    return {
      stage: 'tool-denied',
      name: cleanText(raw.name, 80),
      callId: cleanText(raw.callId, 80),
      code: cleanText(raw.code, 80)
    }
  }
  if (raw.stage === 'tool-dropped') {
    // dropped 的每一项是 { name, reason }：只留这两个确定字段，理由不自由发挥。
    return {
      stage: 'tool-dropped',
      dropped: (Array.isArray(raw.dropped) ? raw.dropped : [])
        .filter((item) => item && typeof item === 'object')
        .slice(0, 8)
        .map((item) => ({ name: cleanText(item.name, 80), reason: cleanText(item.reason, 40) }))
        .filter((item) => item.name)
    }
  }
  if (raw.stage === 'proposal-created') {
    return {
      stage: 'proposal-created',
      name: cleanText(raw.name, 80),
      callId: cleanText(raw.callId, 80),
      proposalId: cleanText(raw.proposalId, 120)
    }
  }
  return {
    stage: 'failed',
    code: cleanText(raw.code, 80),
    atStage: TRAIL_BREAKPOINT_STAGES.includes(raw.atStage) ? raw.atStage : 'start'
  }
}

/** 轨迹清洗：未知阶段丢弃，超上限丢最旧的（保留最近 32 条）。 */
export function sanitizeTrail(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map(sanitizeTrailEvent)
    .filter(Boolean)
    .slice(-MAX_TRAIL_EVENTS)
}

/** 阶段的人类说法（断点行与折叠层共用一份，别处不另写一套词）。 */
export function trailStageLabel(stage) {
  const labels = {
    start: '开始',
    envelope: '组装上下文',
    'model-round': '模型轮次',
    step: '工具回合',
    'tool-start': '调用工具',
    'tool-end': '工具返回',
    'tool-denied': '写入被拒',
    'tool-dropped': '工具未披露',
    'tool-unknown': '越界工具',
    'proposal-created': '生成提案',
    answer: '回答'
  }
  return labels[stage] ?? '未知步骤'
}

/** 折叠层的一行：阶段名 ＋ 关键数字（没有数字的阶段就只留阶段名）。 */
export function describeTrailEvent(event) {
  if (!event || typeof event !== 'object') return null
  if (event.stage === 'start') {
    return { stage: event.stage, label: '开始', detail: `问题 ${event.questionChars} 字` }
  }
  if (event.stage === 'envelope') {
    const profile = event.profile || event.taskType || '未标注档案'
    return { stage: event.stage, label: '组装上下文', detail: `${event.blocks} 块 · ${event.chars} 字 · ${profile}` }
  }
  if (event.stage === 'model-round') {
    return { stage: event.stage, label: `模型第 ${event.round} 轮`, detail: '' }
  }
  if (event.stage === 'answer') {
    return {
      stage: event.stage,
      label: '回答',
      detail: `${event.chars} 字 · ${event.structured ? '结构化' : '原文'} · ${event.roundsUsed} 轮`
    }
  }
  if (event.stage === 'failed') {
    return { stage: event.stage, label: '中断', detail: `${event.code || '未知错误'} · 断在${trailStageLabel(event.atStage)}` }
  }
  if (event.stage === 'step') {
    return { stage: event.stage, label: `工具第 ${event.step} 步`, detail: `${Array.isArray(event.tools) ? event.tools.length : 0} 把可用` }
  }
  if (event.stage === 'tool-start') {
    return { stage: event.stage, label: '调用工具', detail: event.name }
  }
  if (event.stage === 'tool-end') {
    return { stage: event.stage, label: event.ok ? '工具返回' : '工具出错', detail: `${event.name} · ${event.ms}ms` }
  }
  if (event.stage === 'tool-denied') {
    return { stage: event.stage, label: '写入被拒', detail: `${event.name} · ${event.code}` }
  }
  if (event.stage === 'tool-dropped') {
    const names = (Array.isArray(event.dropped) ? event.dropped : []).map((item) => item?.name).filter(Boolean)
    return { stage: event.stage, label: '工具未披露', detail: names.join('、') }
  }
  if (event.stage === 'tool-unknown') {
    return { stage: event.stage, label: '越界工具', detail: `${event.name}（未执行）` }
  }
  if (event.stage === 'proposal-created') {
    return { stage: event.stage, label: '生成提案', detail: `${event.name} · ${event.proposalId}` }
  }
  return null
}

/**
 * busy 期那句阶段语：只认这几种真实事件，别的一律回空串让调用方保留固定语。
 * 「没有事件时保持现有固定语」是工单的硬要求——不能为了好看编一句「正在深度思考」。
 */
export function describeRuntimeProgress(event) {
  if (!event || typeof event !== 'object') return ''
  if (event.stage === 'envelope') return `正在组装上下文（${event.blocks} 块 · ${event.chars} 字）`
  if (event.stage === 'model-round') return `模型第 ${event.round} 轮`
  if (event.stage === 'step') return `工具第 ${event.step} 步`
  if (event.stage === 'tool-start') return `正在调用 ${event.name}`
  if (event.stage === 'proposal-created') return '已生成提案，等你采纳'
  if (event.stage === 'answer') return '正在整理回答'
  if (event.stage === 'failed') return '这一步中断了'
  return ''
}

/**
 * 写模式（M2.5-B）：会话级真值。词表与 next/runtime/writePolicy 一致，但这里不 import 运行时
 * ——渲染层必须保持薄，词表只有三个值，重复一份不构成漂移风险。
 */
export const WRITE_MODES = Object.freeze(['review', 'auto', 'blocked'])
export const MAX_SESSION_EVENTS = 200

/** 会话事件：目前只有「模式切换」一种（谁、何时、从什么切到什么）。未知类型不带进存储。 */
export function sanitizeSessionEvent(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.kind !== 'mode') return null
  const from = WRITE_MODES.includes(raw.from) ? raw.from : null
  const to = WRITE_MODES.includes(raw.to) ? raw.to : null
  if (!from || !to) return null
  return {
    kind: 'mode',
    from,
    to,
    // 能切模式的只有作者本人；这里不臆造别的来源。
    by: 'author',
    at: cleanText(raw.at, 40)
  }
}

/**
 * 消息 → JSON 安全形状。
 * 字段沿用 RuntimeDock 既有那份（{ id, role, text, findings, actions, failed, at }），
 * 批次27 只多两个界面字段：command（slash 命令徽章）与 notes（引用取不到的如实标注）。
 * 批次29 多一个 trail：这一问真实的运行过程事件（封顶 32 条），刷新后答下方的「过程」折叠层还在。
 * 未知字段一律不带进存储——localStorage 里不该长出一份随版本漂移的影子 schema。
 */
export function sanitizeSessionMessage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const role = raw.role === 'user' || raw.role === 'agent' ? raw.role : null
  if (!role) return null
  const findings = Array.isArray(raw.findings)
    ? raw.findings
      .filter((item) => item && typeof item === 'object' && typeof item.message === 'string')
      .slice(0, 40)
      .map((item) => ({
        message: cleanText(item.message, 2000),
        severity: typeof item.severity === 'string' ? cleanText(item.severity, 20) : null
      }))
    : []
  return {
    id: cleanText(raw.id, 80),
    role,
    text: cleanText(raw.text, 200_000),
    findings,
    actions: cleanList(raw.actions),
    notes: cleanList(raw.notes),
    command: typeof raw.command === 'string' ? cleanText(raw.command, 40) : '',
    trail: sanitizeTrail(raw.trail),
    failed: raw.failed === true,
    at: cleanText(raw.at, 40)
  }
}

function copyMessage(message) {
  return {
    ...message,
    findings: message.findings.map((item) => ({ ...item })),
    actions: [...message.actions],
    notes: [...message.notes],
    trail: message.trail.map((event) => ({ ...event }))
  }
}

function summaryOf(session) {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    writeMode: session.writeMode
  }
}

/**
 * 会话存储实例。
 *
 * API（工单 §1 那张表 ＋ 两处界面必需的补充）：
 *   list()                  → 摘要数组（按最近更新倒序）
 *   active()                → 当前会话的完整拷贝（含 messages）
 *   switchTo(id)            → boolean
 *   create(title?)          → 新会话摘要（并切过去）
 *   rename(id, title)       → boolean（之后不再自动改标题）
 *   remove(id)              → boolean（删空会自动补一个空会话）
 *   append(message, id?)    → 落进 id 那条会话（缺省＝当前会话）；上限截断、标题自动生成
 *   updateLast(patch, id?)  → 改那条会话的最后一条（回答晚到、引用标注都走它）
 *   dropLast(id?)           → 重试时去掉那条失败的回答
 *   setBusy(busy) / isBusy()→ 忙态只活在这一个实例里，不持久化
 *   snapshot() / subscribe()→ 渲染层的唯一真相源（结构与 paneForms 的快照同一用法）
 */
export function createSessionStore(projectRoot, options = {}) {
  const clock = typeof options.now === 'function' ? options.now : () => Date.now()
  const root = String(projectRoot ?? '').trim()
  const save = typeof options.save === 'function' ? options.save : null
  const listeners = new Set()
  const sessions = []
  let activeId = null
  let busy = false
  let counter = 0
  /** 落盘失败后就地降级：状态照旧在内存里，界面不因为一次配额错误白屏。 */
  let degraded = false

  const stamp = () => {
    const value = Number(clock())
    return Number.isFinite(value) ? value : Date.now()
  }
  const nextId = (prefix) => `${prefix}-${stamp().toString(36)}-${(++counter).toString(36)}`

  function normalizeSession(raw) {
    if (!raw || typeof raw !== 'object') return null
    const messages = (Array.isArray(raw.messages) ? raw.messages : [])
      .map(sanitizeSessionMessage)
      .filter(Boolean)
      .slice(-MAX_SESSION_MESSAGES)
    const createdAt = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : stamp()
    const updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : createdAt
    const title = cleanText(raw.title, 120).trim() || DEFAULT_SESSION_TITLE
    const renamed = raw.renamed === true
    const events = (Array.isArray(raw.events) ? raw.events : [])
      .map(sanitizeSessionEvent)
      .filter(Boolean)
      .slice(-MAX_SESSION_EVENTS)
    return {
      id: cleanText(raw.id, 80).trim() || nextId('s'),
      title,
      createdAt,
      updatedAt,
      renamed,
      // 名字不是缺省名又没被手动改过 → 只可能是自动标题，别让下一条 user 消息把它重写。
      autoTitled: raw.autoTitled === true || (!renamed && title !== DEFAULT_SESSION_TITLE),
      // 写模式是会话真值：未知值一律回落 review（与运行时同一条口径）。
      writeMode: WRITE_MODES.includes(raw.writeMode) ? raw.writeMode : 'review',
      events,
      messages
    }
  }

  /** 算「超限丢哪个」和「删完切到哪」都看这一份：最近更新的排前面。 */
  function list() {
    return [...sessions]
      .sort((a, b) => (b.updatedAt - a.updatedAt) || (b.createdAt - a.createdAt))
      .map(summaryOf)
  }

  function findSession(sessionId) {
    return sessions.find((session) => session.id === String(sessionId ?? '').trim()) ?? null
  }

  /** 目标会话：不传 id 就是当前会话；传了就按 id 认（回答晚到、作者已经换过会话时用）。 */
  function targetSession(sessionId) {
    if (sessionId === undefined || sessionId === null || sessionId === '') return activeSession()
    return findSession(sessionId)
  }

  function activeSession() {
    return findSession(activeId) ?? sessions[0] ?? null
  }

  function active() {
    const session = activeSession()
    if (!session) return null
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      writeMode: session.writeMode,
      events: session.events.map((event) => ({ ...event })),
      messages: session.messages.map(copyMessage)
    }
  }

  function snapshot() {
    const current = active()
    return {
      projectRoot: root,
      persistent: Boolean(save) && !degraded,
      sessions: list(),
      activeId: current?.id ?? null,
      title: current?.title ?? '',
      messages: current?.messages ?? [],
      writeMode: current?.writeMode ?? 'review',
      events: current?.events ?? [],
      busy
    }
  }

  function notify() {
    const value = snapshot()
    for (const listener of [...listeners]) {
      try {
        listener(value)
      } catch {
        // 订阅者自己的异常不拦状态机与其它订阅者。
      }
    }
  }

  /**
   * 落盘：save 可以是异步（主进程写 JSONL）。同步抛错与 Promise 拒绝都只降级，
   * 不打断状态机——回答还在，作者还能接着问；`persistent` 会变 false。
   */
  function persist() {
    if (!save) return false
    try {
      const returned = save({ sessions, activeId })
      if (returned && typeof returned.then === 'function') {
        returned.then(
          () => {},
          () => {
            degraded = true
            notify()
          }
        )
      }
      degraded = false
      return true
    } catch {
      degraded = true
      return false
    }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function switchTo(sessionId) {
    const target = findSession(sessionId)
    if (!target) return false
    if (target.id === activeId) return true
    activeId = target.id
    // 忙态不跟人走：换会话就是换一件事，上一问的「正在核对」不该挂在新会话上。
    busy = false
    persist()
    notify()
    return true
  }

  function create(title = '') {
    const timestamp = stamp()
    const manual = cleanText(title, 120).trim()
    const session = {
      id: nextId('s'),
      title: manual || DEFAULT_SESSION_TITLE,
      createdAt: timestamp,
      updatedAt: timestamp,
      renamed: Boolean(manual),
      autoTitled: false,
      writeMode: 'review',
      events: [],
      messages: []
    }
    sessions.push(session)
    if (sessions.length > MAX_SESSIONS) sessions.splice(0, sessions.length - MAX_SESSIONS)
    activeId = session.id
    busy = false
    persist()
    notify()
    return summaryOf(session)
  }

  function rename(sessionId, title) {
    const session = findSession(sessionId)
    const text = cleanText(title, 120).replace(/\s+/gu, ' ').trim()
    if (!session || !text) return false
    session.title = text
    session.renamed = true
    session.updatedAt = stamp()
    persist()
    notify()
    return true
  }

  function remove(sessionId) {
    const index = sessions.findIndex((session) => session.id === String(sessionId ?? '').trim())
    if (index < 0) return false
    const [removed] = sessions.splice(index, 1)
    if (removed.id === activeId) {
      activeId = list()[0]?.id ?? null
      busy = false
    }
    // 删到一条不剩也要留一个能打字的地方：无会话时首启建空会话，同一条规矩。
    if (!sessions.length) {
      create()
      return true
    }
    persist()
    notify()
    return true
  }

  /**
   * 追加一条消息。sessionId 可省（＝当前会话）；传了 id 就落进那一条——
   * 提问后作者切到别的会话时，晚到的回答不该写进新会话里（那是两个话题）。
   */
  function append(message, sessionId = null) {
    const session = targetSession(sessionId)
    if (!session) return null
    const clean = sanitizeSessionMessage(message)
    if (!clean) return null
    if (!clean.id) clean.id = nextId('m')
    if (!clean.at) clean.at = formatClock(stamp())
    session.messages.push(clean)
    if (session.messages.length > MAX_SESSION_MESSAGES) {
      session.messages.splice(0, session.messages.length - MAX_SESSION_MESSAGES)
    }
    session.updatedAt = stamp()
    if (!session.renamed && !session.autoTitled && clean.role === 'user' && clean.text.trim()) {
      session.title = clean.text.replace(/\s+/gu, ' ').trim().slice(0, SESSION_TITLE_CHARS)
      session.autoTitled = true
    }
    persist()
    notify()
    return copyMessage(clean)
  }

  function updateLast(patch, sessionId = null) {
    const session = targetSession(sessionId)
    const last = session?.messages.at(-1)
    if (!last || !patch || typeof patch !== 'object') return null
    const merged = { ...last }
    for (const [key, value] of Object.entries(patch)) {
      // id 与 role 是这条消息的身份，不允许被一次 patch 换掉。
      if (key === 'id' || key === 'role') continue
      merged[key] = value
    }
    const clean = sanitizeSessionMessage(merged)
    if (!clean) return null
    session.messages[session.messages.length - 1] = clean
    session.updatedAt = stamp()
    persist()
    notify()
    return copyMessage(clean)
  }

  function dropLast(sessionId = null) {
    const session = targetSession(sessionId)
    if (!session?.messages.length) return false
    session.messages.pop()
    persist()
    notify()
    return true
  }

  function setBusy(value) {
    const next = Boolean(value)
    if (next === busy) return
    busy = next
    notify()
  }

  /**
   * 切写模式（会话真值）：未知值回落 review，不猜。切成功写一条会话事件（从什么切到什么、何时），
   * 事件与模式都随会话落盘——徽章显示的是真值，不是组件默认值。
   */
  function setWriteMode(mode, sessionId = null) {
    const session = targetSession(sessionId)
    if (!session) return false
    const next = WRITE_MODES.includes(mode) ? mode : 'review'
    if (next === session.writeMode) return true
    const from = session.writeMode
    session.writeMode = next
    session.events.push({ kind: 'mode', from, to: next, by: 'author', at: formatClock(stamp()) })
    if (session.events.length > MAX_SESSION_EVENTS) {
      session.events.splice(0, session.events.length - MAX_SESSION_EVENTS)
    }
    session.updatedAt = stamp()
    persist()
    notify()
    return true
  }

  /** 通用会话事件入口：目前只有模式切换走它，将来别的「会话级事实」也从这里进。 */
  function recordEvent(event, sessionId = null) {
    const session = targetSession(sessionId)
    // 时刻由存储补：调用方没给 at 时留空会让事件丢掉「何时发生」这半个事实。
    const stamped = event && typeof event === 'object' && !event.at ? { ...event, at: formatClock(stamp()) } : event
    const clean = sanitizeSessionEvent(stamped)
    if (!session || !clean) return null
    session.events.push(clean)
    if (session.events.length > MAX_SESSION_EVENTS) {
      session.events.splice(0, session.events.length - MAX_SESSION_EVENTS)
    }
    session.updatedAt = stamp()
    persist()
    notify()
    return { ...clean }
  }

  // —— 首启：把主进程读回的会话（initial）装进来；一条都没有就建一个空会话 ——
  const stored = options.initial && typeof options.initial === 'object' ? options.initial : null
  if (stored) {
    const seen = new Set()
    for (const raw of Array.isArray(stored.sessions) ? stored.sessions : []) {
      const session = normalizeSession(raw)
      if (!session) continue
      // 同一个 id 出现两次时后一条换新 id：id 是切会话的唯一依据，不许二义。
      if (seen.has(session.id)) session.id = nextId('s')
      seen.add(session.id)
      sessions.push(session)
    }
    if (sessions.length > MAX_SESSIONS) sessions.splice(0, sessions.length - MAX_SESSIONS)
    activeId = seen.has(String(stored.activeId ?? '')) ? String(stored.activeId) : sessions[0]?.id ?? null
  }
  if (!sessions.length) create()

  return {
    list,
    active,
    switchTo,
    create,
    rename,
    remove,
    append,
    updateLast,
    dropLast,
    setWriteMode,
    recordEvent,
    setBusy,
    isBusy: () => busy,
    snapshot,
    subscribe
  }
}
