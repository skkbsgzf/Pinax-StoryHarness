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
 *
 * 〔批次77-R2 任务6〕消息树（分支）。一份会话从「一条串」变成「一棵浅树」：
 *   · 数组仍是**写入顺序**（也是落盘顺序），父子关系由每条自带的 `branch.parentId` 或
 *     「数组里前一条」这两种依据说出来——判读只在 `messageParentKey`／`siblingsAt`／`visibleMessagePath` 三处；
 *   · 界面上看到的是**当前可见支**（`visibleOf`），别处的支不画、也不许被 append/updateLast 顺手写进去；
 *   · 「此刻看哪一支」是会话级指针 `branchChoice`，切支只动它（`cycleBranch`），两支的内容一个字节都不变；
 *   · 分叉＝把可见支的一段**拷贝**成新支（`branchFrom`），既有那条原样留着——这样落盘才能走追加式，
 *     「分叉写入后既有行逐字节不变」（守卫⑩）才有得钉。没分过叉的会话，可见支＝整串消息，行为一字不变。
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

/**
 * 运行过程事件的阶段白名单（与 `next/runtime/runnerAdvisor.mjs`、`next/runtime/toolLoop.mjs` 的发射点一一对应）。
 * 〔批次77 任务4 订正〕这行注释以前写的是「只有这五种阶段」——那是批次29 的事实，M2.5-A 接上工具循环后
 * 早就不是了，本次又加了子代理／工作流两段。名单以外的一律不进轨迹（白名单是闸，不是装饰）：
 * `subagent`／`workflow-step` 现在是**认得**（来了就收、就渲染），但本批运行时还没人发——
 * 这是给批次78 预留的 schema 位，不是造假事件：没人发，屏上就一条都不会多出。
 * 〔批次77 任务3〕`stopped` 与那两段不同：工具循环已经真发它（作者按下停止、轮次边界收手），
 * 白名单不扩这条，轨迹里就永远看不见「收手在哪一轮」。
 */
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
  // 批次77 任务4：子代理／工作流段进白名单（产出方＝批次78）。
  'subagent',
  'workflow-step',
  // 批次77 任务3：作者按停止后，工具循环在轮次边界真发的一条（不扩进来，轨迹里就看不到「收手在哪」）。
  'stopped',
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
  const event = sanitizeTrailEventBody(raw)
  if (!event) return null
  // 〔批次77 任务4〕事件到达时刻：只在给了有限数时才多这一格——老会话（没 at 的 JSONL）读回来形状一字不变。
  // 打点方是 RuntimeDock（外壳收到那一刻），所以它说的是「外壳看到的首尾差」，不是端到端耗时。
  const at = Number(raw?.at)
  return Number.isFinite(at) && at >= 0 ? { ...event, at: Math.round(at) } : event
}

function sanitizeTrailEventBody(raw) {
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
  if (raw.stage === 'subagent') {
    // 批次78 的产出位：谁在写、哪一次调用、干什么、成了没（ok 只认真布尔）。
    return {
      stage: 'subagent',
      name: cleanText(raw.name, 80),
      callId: cleanText(raw.callId, 80),
      task: cleanText(raw.task, 120),
      ok: raw.ok === true
    }
  }
  if (raw.stage === 'workflow-step') {
    return {
      stage: 'workflow-step',
      name: cleanText(raw.name, 80),
      callId: cleanText(raw.callId, 80),
      step: cleanCount(raw.step)
    }
  }
  if (raw.stage === 'stopped') {
    // 批次77 任务3：只留 step——它说的是「跑完几轮后收的手」。
    // 不带 code、不带原因：停止不是错误，作者是按下钮的那个人，不需要被解释。
    return { stage: 'stopped', step: cleanCount(raw.step) }
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
    subagent: '子代理',
    'workflow-step': '工作流步骤',
    stopped: '已停止',
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
  // 批次77 任务4：这两段本批还没人发（发的人是批次78），但**认得**——判读与渲染先长好，
  // 78 一接上就有色。这里不做任何「没有事件也摆一块」的事：没有就一行都不出。
  if (event.stage === 'subagent') {
    // 名字没有就只说「子代理」，不许拼出「子代理 子代理」这种重复字。
    const who = event.name ? `子代理 ${event.name}` : '子代理'
    return { stage: event.stage, label: who, detail: event.task || (event.ok ? '已完成' : '未回报结果') }
  }
  if (event.stage === 'workflow-step') {
    return { stage: event.stage, label: `工作流第 ${event.step} 步`, detail: event.name }
  }
  // 批次77 任务3：作者按下停止。这一条只说事实——跑完了几轮、之后没再续轮。
  if (event.stage === 'stopped') {
    return {
      stage: event.stage,
      label: '已停止',
      detail: event.step > 0 ? `第 ${event.step} 轮后不再续轮` : '第一轮还没发起就收了手'
    }
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
  // 批次77 任务4：白名单加了段，进度语就得跟着认——「扩白名单不是扩沉默」（trail-tool-events 那条老原则）。
  if (event.stage === 'subagent') return event.name ? `正在交给子代理 ${event.name}` : '正在交给子代理'
  if (event.stage === 'workflow-step') return `工作流第 ${event.step} 步`
  if (event.stage === 'proposal-created') return '已生成提案，等你采纳'
  // 批次77 任务3：停止也是真实事件，进度语要认——不然按下停止后界面还挂着「正在调用某工具」那句旧话。
  if (event.stage === 'stopped') return event.step > 0 ? `已停止（第 ${event.step} 轮后不再续轮）` : '已停止'
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
 * 批次77 任务2 多三格：runId（哪一轮运行产出的这条）、usage（本轮 token 用量，没有就是 null）、
 * status（这一条现在的状态）。failed 保留兼容，读的时候走 messageStatus()。
 * 未知字段一律不带进存储——localStorage 里不该长出一份随版本漂移的影子 schema。
 */

/** 消息状态闭集：流中／完成／被停／出错。写入模式那三档（WRITE_MODES）与它无关。 */
export const MESSAGE_STATUSES = Object.freeze(['streaming', 'completed', 'stopped', 'error'])

/**
 * 用量归一：只认运行时报的 `{ input, output, total }`（正整数），缺 total 时用 input+output 补。
 * 一个数都没有 → null。这里没有任何估算口径：字数不换算成 token。
 */
export function sanitizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const pick = (value) => (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null)
  const input = pick(raw.input)
  const output = pick(raw.output)
  if (input === null && output === null) return null
  const total = pick(raw.total) ?? ((input ?? 0) + (output ?? 0))
  return { input: input ?? 0, output: output ?? 0, total }
}

/**
 * 读出一条消息的状态（批次77 任务2 的兼容口径）：
 * 老存档没有 status，但有 failed——按「出错」读；两者都没有才是 completed。
 * 这一条是唯一的判读处，界面不许再各自 `failed ? … : …` 猜一遍。
 */
export function messageStatus(message) {
  const status = MESSAGE_STATUSES.includes(message?.status) ? message.status : null
  if (status) return status
  return message?.failed === true ? 'error' : 'completed'
}

/**
 * 〔批次77-R2 任务6〕消息级分叉的链接格（工单里写的 `branch:{parentId, index, count}`）。
 *
 * 带这一格的消息说的是一件事：「我是 `<parentId>` 那条下面的第 `index` 支」（`parentId` 为空串＝挂在会话开头）。
 * 为什么非得有这一格：分叉**不许**把会话文件整份重写（守卫⑩「分叉写入后既有行逐字节不变」），
 * 于是既有那一条支的字节都得原样留着——**它没法回头给自己补一个标签**。
 * 规矩就此定死：
 *   · 原始支在盘上就是**不带标签**的那一串（老会话读回来形状一字不变，既有行一行都不用重打）；
 *     没带标签的消息一律按「接着数组里前一条往下长」认父，第 0 条挂在会话开头。
 *   · 新分出去的那一支是整段**拷贝**：头一条带 `{parentId: 分叉点那条的父, index: ≥2}`；
 *     段内后续每条带 `{parentId: 拷贝里前一条的新 id, index: 1}`——落盘是追加式的，
 *     数组位置不能再当父子依据（截断＋追写之后，数组末尾未必是当前看的那一条），所以段内也明写。
 *   · `index`／`count` 都是**写那一刻**的序号与支数：后来又分一叉不会追新老格里的 count，
 *     屏上 ‹i/n› 的 n 用当场数出来的兄弟数（`visibleMessagePath` 算），这一格只留事实不留显示。
 * 形状外的一律读成 null（＝不认得这一格＝按原始支走），不猜。
 */
export function sanitizeMessageBranch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const index = Number(raw.index)
  const count = Number(raw.count)
  if (!Number.isSafeInteger(index) || index < 1) return null
  if (!Number.isSafeInteger(count) || count < index) return null
  const parentId = typeof raw.parentId === 'string' ? cleanText(raw.parentId, 80) : ''
  return { parentId, index, count }
}

/**
 * 〔批次77-R2 任务6〕当前看的是哪一支：会话级的指针表 `{ <父键>: 支序号 }`。
 * 工单只把 `branch` 落在消息行白名单上，但「此刻看哪一支」是**会话级事实**——
 * 它不属于任何一条消息，也不许改写任何一支的内容，所以挂在会话元数据行上（批次记录里已补登记）。
 * 没有这一格＝看原始支（index 1），所以空表就是老行为，零回归。
 */
export function normalizeBranchChoice(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const choice = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || key.length > 80) continue
    const index = Number(value)
    if (Number.isSafeInteger(index) && index >= 1) choice[key] = index
  }
  return choice
}

/** 挂在会话开头的那一层的键：第一句话（或第一个分支头）都认它。 */
export const BRANCH_ROOT_KEY = ''

/** 一条消息的父键：带标签就照标签认；没标签＝数组里前一条（第 0 条挂会话开头）。 */
export function messageParentKey(messages, index) {
  const message = messages?.[index]
  if (!message) return null
  if (message.branch) return message.branch.parentId
  return index > 0 ? String(messages[index - 1]?.id ?? '') : BRANCH_ROOT_KEY
}

/**
 * 某个分叉点上的候选支：键＝支序号，值＝那条支的**头**在数组里的下标。
 * 原始支（无标签的那条后继）先占 1 号位，带标签的按自己的 index 占位并覆盖同号——
 * 显式标签比位置推断更有资格说话。
 */
export function siblingsAt(messages, parentKey) {
  const options = new Map()
  const list = Array.isArray(messages) ? messages : []
  list.forEach((message, index) => {
    if (messageParentKey(list, index) !== parentKey) return
    const rank = message.branch ? message.branch.index : 1
    if (message.branch || !options.has(rank)) options.set(rank, index)
  })
  return options
}

/**
 * 当前可见的那一条路径（＝屏上的一问一答，从会话开头走到没有后继为止）。
 * 每一步都在分叉点上按 `branchChoice` 挑一支；指针指的那一支不在了（被截断／被上限截旧）就回落原始支，
 * 原始支也不在了就**到此为止**——不许把别的一支当成「作者正在看的那一条」画出来，
 * 那是界面在替作者改他看的支（工单第 3 条：切换只换此刻看哪一支，别的一概不动）。
 * `seen` 是环保护：parentId 被人手改坏成指向自己或后代时，宁可在此收住，也不许把这条 while 转成死循环。
 */
export function visibleMessagePath(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const choice = session?.branchChoice ?? {}
  const path = []
  const seen = new Set()
  let parentKey = BRANCH_ROOT_KEY
  for (;;) {
    const options = siblingsAt(messages, parentKey)
    if (!options.size) break
    const wanted = Number(choice[parentKey])
    let rank = Number.isSafeInteger(wanted) && wanted >= 1 ? wanted : 1
    if (!options.has(rank)) {
      if (options.has(1)) rank = 1
      else break
    }
    const index = options.get(rank)
    const message = messages[index]
    if (!message || seen.has(message.id)) break
    seen.add(message.id)
    path.push({ message, index, parentKey, rank, count: options.size })
    parentKey = message.id
  }
  return path
}

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
    // 〔批次77-R2 任务6〕分叉链接格：没有就是 null（＝原始支），有就只认那三个确定字段。
    branch: sanitizeMessageBranch(raw.branch),
    role,
    text: cleanText(raw.text, 200_000),
    findings,
    actions: cleanList(raw.actions),
    notes: cleanList(raw.notes),
    command: typeof raw.command === 'string' ? cleanText(raw.command, 40) : '',
    trail: sanitizeTrail(raw.trail),
    failed: raw.failed === true,
    at: cleanText(raw.at, 40),
    runId: typeof raw.runId === 'string' ? cleanText(raw.runId, 80) : '',
    usage: sanitizeUsage(raw.usage),
    // 没写 status 的旧消息按 failed 归位，落盘一次就把三态补齐（读侧仍走 messageStatus，双保险）。
    status: MESSAGE_STATUSES.includes(raw.status) ? raw.status : (raw.failed === true ? 'error' : 'completed')
  }
}

function copyMessage(message) {
  return {
    ...message,
    branch: message.branch ? { ...message.branch } : null,
    findings: message.findings.map((item) => ({ ...item })),
    actions: [...message.actions],
    notes: [...message.notes],
    trail: message.trail.map((event) => ({ ...event })),
    usage: message.usage ? { ...message.usage } : null
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
 *   append(message, id?)    → 落进 id 那条会话（缺省＝当前会话）；上限截断、标题自动生成；
 *                             接着**当前可见支**的尾巴长（〔批次77-R2 任务6〕）
 *   updateLast(patch, id?)  → 改那条会话可见支的最后一条（回答晚到、引用标注都走它）
 *   dropLast(id?)           → 重试时去掉那条失败的回答（去掉的是看得见的那条）
 *   dropFrom(id, id?)       → 从那条起把可见支往后截掉；唯一的破坏性历史入口（编辑重发与分支共用）
 *   branchFrom(id, id?)     → 〔任务6〕把可见支从那条起的整段存成另一支（一条既有消息都不动）
 *   cycleBranch(id, step, id?) → 〔任务6〕‹ › 切支：只改当前支指针，不改任何一支的内容
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
      // 〔批次77-R2 任务6〕当前看的是哪一支（会话级指针，不落进任何一条消息）。
      branchChoice: normalizeBranchChoice(raw.branchChoice),
      events,
      messages
    }
  }

  /**
   * 屏上那一条路径：当前可见支上的每条消息，外加「这一层共几支、此刻第几支」。
   * `branchNav` 只在**显示面**长出来（内部 messages 与落盘 payload 都没有它），
   * 所以形状钉用例钉的那份 schema 不会因为一个显示用的派生格而漂。
   */
  function visibleOf(session) {
    return visibleMessagePath(session).map((entry) => ({
      ...copyMessage(entry.message),
      branchNav: { index: entry.rank, count: entry.count }
    }))
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
      // 〔批次77-R2 任务6〕界面拿的是**当前可见支**，不是数组全量：分叉出去的那一支不在这条路径上，
      // 就不该跟在这一支后面一起画出来。没有分叉的会话，这条路径＝原来的整串消息，一字不差。
      messages: visibleOf(session)
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
      branchChoice: {},
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
   *
   * 〔批次77-R2 任务6〕落点从「数组末尾」改成「**当前可见支的末尾**」：
   * 作者切到分出去的那一支接着问，新这条得跟在那一支后面，不能因为数组末尾正好是别处的拷贝
   * 就长错地方。父链接什么时候明写、什么时候不写，只有一条判据——
   * **可见支的尾巴是不是数组的最后一条**：是（老会话、没分过叉）就不写，落盘形状与批次77 之前一字不变；
   * 不是才写 `{parentId, index, count}`，因为这时候靠数组位置猜会猜歪。
   */
  function append(message, sessionId = null) {
    const session = targetSession(sessionId)
    if (!session) return null
    const clean = sanitizeSessionMessage(message)
    if (!clean) return null
    if (!clean.id) clean.id = nextId('m')
    if (!clean.at) clean.at = formatClock(stamp())
    const path = visibleMessagePath(session)
    const tail = path.at(-1)
    if (session.messages.length && (!tail || session.messages.at(-1)?.id !== tail.message.id)) {
      const parentKey = tail ? tail.message.id : BRANCH_ROOT_KEY
      const options = siblingsAt(session.messages, parentKey)
      // 1 号位空着就回 1 号（截断之后接着问＝这一层的原始支重新长出来，不新开支、也不留空洞）；
      // 1 号位有人了才往后排一位，并把指针拨过去，否则刚写的这条看不见。
      const rank = options.has(1) ? Math.max(...options.keys()) + 1 : 1
      // count 记的是「这一层到这儿一共几支」：正常就是 rank，只有早先的兄弟被上限挤掉时才取现数。
      clean.branch = { parentId: parentKey, index: rank, count: Math.max(rank, options.size + 1) }
      // 序号不是 1（＝不是这一层的原始支）就得把指针拨过来，否则刚写的这条看不见。
      if (rank !== 1) branchChoiceOf(session)[parentKey] = rank
    }
    session.messages.push(clean)
    if (session.messages.length > MAX_SESSION_MESSAGES) {
      // 上限截的是**最早写入**的那些：拷贝支与原始支一起排在一起，谁老谁先出。
      // 被截掉的那几条要是正挂着指针，一并抹掉（留着也读不到，别把元数据行越拖越长）。
      session.messages.splice(0, session.messages.length - MAX_SESSION_MESSAGES)
      pruneBranchChoice(session)
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

  /** 指针表只留还认得出的那些分叉点（父消息已经不在了的引用是脏数据，不是事实）。 */
  function pruneBranchChoice(session) {
    const choice = branchChoiceOf(session)
    for (const key of Object.keys(choice)) {
      if (key === BRANCH_ROOT_KEY) continue
      if (!session.messages.some((message) => message.id === key)) delete choice[key]
    }
  }

  /** 会话级的分叉指针表（拿到的是内部对象，只给本 store 自己写）。 */
  function branchChoiceOf(session) {
    if (!session.branchChoice || typeof session.branchChoice !== 'object') session.branchChoice = {}
    return session.branchChoice
  }

  /**
   * 分一支（〔批次77-R2 任务6〕工单第 4 条的「在截断前先存一支」）。
   *
   * 做法＝把**当前可见支从这一条往后的整段**原样拷贝一份，挂到同一个分叉点上的新序号（≥2）：
   *   · 一条既有消息都不动、不重打、不改标签——所以落盘能走追加式（守卫⑩「既有行逐字节不变」）；
   *   · 拷完也不拨指针——作者要的是「老的还在，我在这一支接着改」，看的新支就是原来那条；
   *     想回头看退路，用 ‹i/n› 自己切（切换只改当前支指针，这是工单第 3 条）。
   * 段内每条拷贝都明写 parentId（认拷贝里前一条的新 id）：数组位置在追加式落盘之后不再能当父子依据。
   * 明写的 `count` 只说**本层**有几支可切：支头是第 index 支（这一层共 index 支，因为序号从不留洞），
   * 段内那些是拷贝自己长的独生子（count=1）。读侧一律按 siblingsAt 现算，不拿这个字段当依据。
   * 找不到那条消息（不在当前可见支上／已被截掉）就返回 null，一个字节都不动。
   */
  function branchFrom(messageId, sessionId = null) {
    const session = targetSession(sessionId)
    if (!session?.messages.length) return null
    const path = visibleMessagePath(session)
    const start = path.findIndex((entry) => entry.message.id === messageId)
    if (start < 0) return null
    const anchorKey = path[start].parentKey
    const index = Math.max(1, ...siblingsAt(session.messages, anchorKey).keys()) + 1
    const copies = []
    let parentKey = anchorKey
    for (const entry of path.slice(start)) {
      const id = nextId('m')
      copies.push({
        ...copyMessage(entry.message),
        id,
        branch: { parentId: parentKey, index: copies.length ? 1 : index, count: copies.length ? 1 : index }
      })
      parentKey = id
    }
    session.messages.push(...copies)
    if (session.messages.length > MAX_SESSION_MESSAGES) {
      session.messages.splice(0, session.messages.length - MAX_SESSION_MESSAGES)
      pruneBranchChoice(session)
    }
    session.updatedAt = stamp()
    persist()
    notify()
    return { headId: copies[0].id, parentId: anchorKey, index, count: index, copied: copies.length }
  }

  /**
   * ‹ › 切支（工单第 3 条）：**只**改当前支指针。
   * 任何一支的内容都不因此被读写——这就是「切换只换此刻看哪一支」的实现口径，
   * 也是它必须落在 store（而不是对话框）的原因：指针要随会话落盘，刷新后回来还在这一支上。
   * 这一层不足两支、或者那条消息不在当前可见支上，一律返回 null 不动（不演一次「切了」）。
   */
  function cycleBranch(messageId, step, sessionId = null) {
    const session = targetSession(sessionId)
    if (!session?.messages.length) return null
    const entry = visibleMessagePath(session).find((item) => item.message.id === messageId)
    if (!entry || entry.count < 2) return null
    const ranks = [...siblingsAt(session.messages, entry.parentKey).keys()].sort((a, b) => a - b)
    const at = ranks.indexOf(entry.rank)
    if (at < 0) return null
    const move = Number(step)
    if (!Number.isSafeInteger(move) || move === 0) return null
    const next = ranks[((at + move) % ranks.length + ranks.length) % ranks.length]
    const changed = next !== entry.rank
    if (changed) {
      branchChoiceOf(session)[entry.parentKey] = next
      session.updatedAt = stamp()
      persist()
      notify()
    }
    return { index: next, count: ranks.length, changed }
  }

  function updateLast(patch, sessionId = null) {
    const session = targetSession(sessionId)
    // 「最后一条」指的是**当前可见支**的最后一条：作者切进分出去的那一支时，晚到的引用标注
    // 得落在他看着的那条上，不能落进数组末尾那条别的支的拷贝里。
    const spot = visibleMessagePath(session).at(-1)
    const last = spot?.message
    if (!last || !patch || typeof patch !== 'object') return null
    const merged = { ...last }
    for (const [key, value] of Object.entries(patch)) {
      // id 与 role 是这条消息的身份，不允许被一次 patch 换掉。
      if (key === 'id' || key === 'role') continue
      merged[key] = value
    }
    const clean = sanitizeSessionMessage(merged)
    if (!clean) return null
    session.messages[spot.index] = clean
    session.updatedAt = stamp()
    persist()
    notify()
    return copyMessage(clean)
  }

  function dropLast(sessionId = null) {
    const session = targetSession(sessionId)
    const spot = visibleMessagePath(session).at(-1)
    if (!spot) return false
    session.messages.splice(spot.index, 1)
    pruneBranchChoice(session)
    persist()
    notify()
    return true
  }

  /**
   * 从某一条开始（含它）把**当前可见支**往后截掉——批次77 任务2「编辑重发」那一步的历史动作，
   * 〔批次77-R2 任务6〕也是分支动作的前半（`branchFrom` 先把这一串存成另一支，这里再截）。
   * 返回截掉的条数；找不到那个 id 就回 0，调用方据此决定要不要动（不静默改历史）。
   *
   * 只截看得见的那一段：分出去的那一支不在这条路径上，一根手指都不碰——
   * 「编辑重发把退路删了」就是把分支存的意义删干净了。
   * 这是本 store 唯一的破坏性动作（守卫：不许长出第二套历史重写入口）。
   */
  function dropFrom(messageId, sessionId = null) {
    const session = targetSession(sessionId)
    if (!session?.messages.length) return 0
    const path = visibleMessagePath(session)
    const start = path.findIndex((entry) => entry.message.id === messageId)
    if (start < 0) return 0
    const doomed = path.slice(start).map((entry) => entry.index).sort((a, b) => b - a)
    for (const index of doomed) session.messages.splice(index, 1)
    pruneBranchChoice(session)
    session.updatedAt = stamp()
    persist()
    notify()
    return doomed.length
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
    dropFrom,
    branchFrom,
    cycleBranch,
    setWriteMode,
    recordEvent,
    setBusy,
    isBusy: () => busy,
    snapshot,
    subscribe
  }
}
