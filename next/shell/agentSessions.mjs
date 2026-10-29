/**
 * Agent 会话存储（批次27 · 任务一）：多会话 ＋ localStorage 持久化。
 *
 * 作者原话：「参考 dsh，需要有会话管理」。批次25 之前右栏只有一份内存里的 messages，
 * 刷新即丢、也开不了第二个话题。这份模块把会话做成一个真正的存储：
 *   - 按项目根隔离：键 `agentSessions.<projectRoot>`（与 paneForm.<paneId> / overlay.<paneId>
 *     同一先例：渲染层的 localStorage 例外，键由本模块按项目根拼出，别处不另写键）；
 *   - 上限：30 个会话、每会话 200 条消息，超限丢最旧（丢的是「最早的」，不是「正在看的」）；
 *   - 标题：自动取第一条 user 消息前 24 字；手动 rename 之后不再自动改；
 *   - 首启自动建一个空会话；没有项目根时不落盘（没有身份可归属），照样能问。
 *
 * 落盘失败（隐私模式／配额／沙箱 SecurityError）不崩：降级为内存会话，界面照常，
 * 只是这次关掉窗口就没了——`snapshot().persistent` 如实报这件事。
 *
 * 纯数据模块，不 import Vue：node:test 能直接测状态机、上限截断与降级路径；
 * 渲染层用 subscribe() 把快照接进 ref（与 paneForms.mjs 同一套「宿主一份真相」）。
 */

/** 持久化键前缀：`agentSessions.<projectRoot>`（键名带项目根，由本模块拼）。 */
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
export const TRAIL_STAGES = Object.freeze(['start', 'envelope', 'model-round', 'answer', 'failed'])

/** 还没有人说话时的会话名。 */
export const DEFAULT_SESSION_TITLE = '新会话'

export function agentSessionStorageKey(projectRoot) {
  return `${AGENT_SESSION_STORAGE_PREFIX}${String(projectRoot ?? '').trim()}`
}

/** 取浏览器存储：属性访问本身也可能抛（沙箱 iframe 的 SecurityError），拿不到就按「不持久化」跑。 */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
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
  return {
    stage: 'failed',
    code: cleanText(raw.code, 80),
    atStage: TRAIL_STAGES.includes(raw.atStage) && raw.atStage !== 'failed' ? raw.atStage : 'start'
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
  if (event.stage === 'answer') return '正在整理回答'
  if (event.stage === 'failed') return '这一步中断了'
  return ''
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
    messageCount: session.messages.length
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
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const clock = typeof options.now === 'function' ? options.now : () => Date.now()
  const root = String(projectRoot ?? '').trim()
  const storageKey = root ? agentSessionStorageKey(root) : null
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

  function readStored() {
    if (!storageKey || !storage) return null
    try {
      const raw = storage.getItem(storageKey)
      if (typeof raw !== 'string' || !raw) return null
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }

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
    return {
      id: cleanText(raw.id, 80).trim() || nextId('s'),
      title,
      createdAt,
      updatedAt,
      renamed,
      // 名字不是缺省名又没被手动改过 → 只可能是自动标题，别让下一条 user 消息把它重写。
      autoTitled: raw.autoTitled === true || (!renamed && title !== DEFAULT_SESSION_TITLE),
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
      messages: session.messages.map(copyMessage)
    }
  }

  function snapshot() {
    const current = active()
    return {
      projectRoot: root,
      storageKey,
      persistent: Boolean(storageKey && storage) && !degraded,
      sessions: list(),
      activeId: current?.id ?? null,
      title: current?.title ?? '',
      messages: current?.messages ?? [],
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

  function persist() {
    if (!storageKey || !storage) return false
    try {
      storage.setItem(storageKey, JSON.stringify({ sessions, activeId }))
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

  // —— 首启：把已存的会话读回来；一条都没有就建一个空会话 ——
  const stored = readStored()
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
    storageKey,
    list,
    active,
    switchTo,
    create,
    rename,
    remove,
    append,
    updateLast,
    dropLast,
    setBusy,
    isBusy: () => busy,
    snapshot,
    subscribe
  }
}
