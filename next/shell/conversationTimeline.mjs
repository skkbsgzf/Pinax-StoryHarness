/**
 * 消息内处理时间线（批次77 任务4）——判定与归组的纯函数层。
 *
 * 分工口径：**这里只出判断，`.vue` 只负责摆**（抄 DeepWrite 的 factory 出 label、组件不写文案那一条）。
 * 所以块型、四态文案、图标归类、只读并组、耗时合成都在这份纯模块里，node:test 直接测，不用 jsdom。
 *
 * 数据源仍是既有 trail（`agentSessions.mjs` 的 `sanitizeTrailEvent` 那条链）——
 * 工单说得很直：「缺的是渲染，不是管道」。本文件不新增任何事件类型，也不编任何数。
 */

/** 五类块（词表固定；`thinking`／`subagent` 的产出方另见各自注释）。 */
export const TIMELINE_BLOCK_KINDS = Object.freeze(['thinking', 'response', 'tool', 'tool-group', 'subagent'])

/** 四态（DeepWrite 口径：等待执行／正在 X／已 X／X 失败）。 */
export const TIMELINE_STATES = Object.freeze(['preparing', 'running', 'completed', 'error'])

/** 图标五类——名字是工单给的类名，渲染时再换成我们图标集里真有的名字（见 TIMELINE_ICON_NAMES）。 */
export const TOOL_ICON_CLASSES = Object.freeze(['folder', 'terminal', 'file', 'globe', 'sparkles'])

/**
 * 按**名字正则**归类，不写 58 条字面量表：新工具名自动落类，不改表。
 * 顺序有意义——先判写入（写入类不显图标），再判「跑到外面去」（globe），
 * 再判生成类（sparkles），再判目录／检索，最后才是单文档读写（file）。
 */
const WRITE_NAME_PATTERN = /(?:^|_)(save|write|create|delete|remove|patch|append|update|rename|move|import|export|adopt|submit|apply)(?:_|$)/u
const GLOBE_NAME_PATTERN = /(?:^|_)(web|http|url|fetch|remote|external|mcp|online|browse|network)(?:_|$)/u
const SPARKLES_NAME_PATTERN = /(?:^|_)(skill|generate|rewrite|continue|expand|compress|polish|review|ask|complete|draft|idea)(?:_|$)/u
const FOLDER_NAME_PATTERN = /(?:^|_)(dir|tree|folder|list|catalog|catalogue|index|shelf|skeleton)(?:_|$)/u
const TERMINAL_NAME_PATTERN = /(?:^|_)(search|find|grep|query|scan|run|exec|doctor|count|diff)(?:_|$)/u

/** 非工具的「过程段」：这些进 thinking 块（下面那条注释说清它装的是什么）。 */
const PROCESS_STAGES = Object.freeze(['start', 'envelope', 'model-round', 'step', 'tool-dropped', 'failed'])
/** 一次工具调用的段：同一 callId 收进同一个 tool 块。`tool-dropped` 不在这里——它不是一次调用，是「这轮有工具没披露」那句声明。 */
const TOOL_STAGES = Object.freeze(['tool-start', 'tool-end', 'tool-denied', 'tool-unknown', 'proposal-created'])
/** 子代理／工作流段（产出方是批次78，本批只把面与判读长出来）。 */
const SUBAGENT_STAGES = Object.freeze(['subagent', 'workflow-step'])

/** 图标类名 → WorkbenchIcon 真有的名字（我们的图标集没有 terminal／globe／file 这三个字面名）。 */
export const TIMELINE_ICON_NAMES = Object.freeze({
  folder: 'folder',
  terminal: 'search',
  file: 'document',
  globe: 'network',
  sparkles: 'sparkles'
})

function toolName(event) {
  return String(event?.name ?? '').trim()
}

/** 写入类工具：不显图标，文案走「写入结果已生成」那一句。 */
export function isWriteToolName(name) {
  return WRITE_NAME_PATTERN.test(String(name ?? '').trim())
}

/**
 * 名字 → 图标类。写入类回 null（工单第 1 条：写入类不显图标）。
 * 认不出来落 `file`——单文档读写是这壳里最大的那一类，兜底落这里比落 sparkles 诚实。
 */
export function classifyToolIcon(name) {
  const value = String(name ?? '').trim()
  if (!value || isWriteToolName(value)) return null
  if (GLOBE_NAME_PATTERN.test(value)) return 'globe'
  if (SPARKLES_NAME_PATTERN.test(value)) return 'sparkles'
  if (FOLDER_NAME_PATTERN.test(value)) return 'folder'
  if (TERMINAL_NAME_PATTERN.test(value)) return 'terminal'
  return 'file'
}

/** WorkbenchIcon 名（写入类没有图标，回空串）。 */
export function timelineIconName(name) {
  const kind = classifyToolIcon(name)
  return kind ? TIMELINE_ICON_NAMES[kind] ?? '' : ''
}

/**
 * 四态文案工厂：`等待执行`／`正在 X`／`已 X`／`X 失败`。
 * 组件里不许再写一套状态词——改词只改这一处。
 */
export function timelineLabel(state, action) {
  const verb = String(action ?? '').trim()
  if (!verb) return ''
  if (state === 'preparing') return '等待执行'
  if (state === 'running') return `正在${verb}`
  if (state === 'completed') return `已${verb}`
  if (state === 'error') return `${verb}失败`
  return verb
}

/** 块的动作短语（四态文案的那个 X）。 */
function blockAction(block) {
  if (block.kind === 'tool' || block.kind === 'tool-group') {
    if (block.write) return ''
    if (block.kind === 'tool-group') return `读取 ${block.items.length} 项项目内容`
    return `调用 ${block.name || '工具'}`
  }
  if (block.kind === 'response') return '给出回答'
  if (block.kind === 'subagent') {
    if (block.variant === 'workflow-step') {
      return block.step ? `走工作流第 ${block.step} 步` : '走工作流步骤'
    }
    return block.name ? `交给子代理 ${block.name}` : '交给子代理'
  }
  // thinking：本批装的是「非工具的运行过程行」（开始／组装上下文／模型轮次／工具回合／中断）。
  // 模型真正的思维链文本这一批没有来源（上游不回报），所以块在、话不说满。
  return '梳理上下文'
}

/** 写入类那一块的说辞（工单：直接给「写入结果已生成／N 字」这一句）。 */
function writeBlockText(block) {
  // 「N 字」要有真字数才写：tool-end 的白名单里只有 name／callId／ok／ms，没有写入字数，
  // 而上游被 clamp 过的输出长度不是「作者写了多少字」——拿它冒充就是编数。
  // 提案 id 是真的（proposal-created 带着），有就带上。
  const proposal = block.proposalId ? ` · 提案 ${block.proposalId}` : ''
  if (block.state === 'error') return `写入被拒${block.code ? ` · ${block.code}` : ''}`
  if (block.state === 'running') return `正在写入 ${block.name || '工具'}`
  if (block.state === 'preparing') return '等待执行'
  return `写入结果已生成${proposal}`
}

/** 块头那一句：四态文案，写入类走自己的句子。 */
export function blockHeadline(block) {
  if (!block) return ''
  if (block.write) return writeBlockText(block)
  return timelineLabel(block.state, blockAction(block))
}

function toolStateOf(events) {
  const stages = events.map((event) => event?.stage)
  if (stages.includes('failed')) return 'error'
  if (stages.includes('tool-denied') || stages.includes('tool-unknown')) return 'error'
  const end = events.find((event) => event.stage === 'tool-end')
  if (end) return end.ok === true ? 'completed' : 'error'
  if (stages.includes('proposal-created')) return 'completed'
  if (stages.includes('tool-start')) return 'running'
  return 'preparing'
}

function firstAt(events) {
  const values = (Array.isArray(events) ? events : [])
    .map((event) => Number(event?.at))
    .filter((value) => Number.isFinite(value))
  return values.length ? Math.min(...values) : null
}

function lastAt(events) {
  const values = (Array.isArray(events) ? events : [])
    .map((event) => Number(event?.at))
    .filter((value) => Number.isFinite(value))
  return values.length ? Math.max(...values) : null
}

function makeToolBlock(events, streaming, isLast) {
  const name = toolName(events[0])
  const state = toolStateOf(events)
  const block = {
    kind: 'tool',
    name,
    callId: String(events.find((event) => event.callId)?.callId ?? ''),
    write: isWriteToolName(name),
    icon: classifyToolIcon(name),
    state,
    events,
    proposalId: '',
    code: '',
    ms: 0
  }
  const proposal = events.find((event) => event.stage === 'proposal-created')
  if (proposal) block.proposalId = String(proposal.proposalId ?? '')
  const denied = events.find((event) => event.stage === 'tool-denied')
  if (denied) block.code = String(denied.code ?? '')
  const end = events.find((event) => event.stage === 'tool-end')
  if (end) block.ms = Number(end.ms) || 0
  // 还在跑的那一问：最后一块没有终态事件就报 running（不假装已完成）。
  if (streaming && isLast && state === 'preparing') block.state = 'running'
  return block
}

function makeBlock(kind, events, extra = {}) {
  return { kind, events, ...extra }
}

/** 只读工具（非写入类）才有并组资格。 */
function isReadOnlyToolBlock(block) {
  return block.kind === 'tool' && !block.write
}

/**
 * 连续只读工具并成一组（工单第 3 条）：两把及以上才并，一把不并——
 * 「执行中／等待执行＋计数」那条组行替掉 N 行，但每把工具的原文仍在组里展开得到。
 */
function groupReadOnly(runs) {
  const out = []
  let run = []
  const flush = () => {
    if (run.length >= 2) {
      const events = run.flatMap((block) => block.events)
      const worst = run.some((block) => block.state === 'error')
        ? 'error'
        : run.every((block) => block.state === 'completed')
          ? 'completed'
          : run.some((block) => block.state === 'running')
            ? 'running'
            : 'preparing'
      out.push({ kind: 'tool-group', items: run, events, state: worst, ms: run.reduce((sum, block) => sum + (block.ms || 0), 0) })
    } else if (run.length === 1) {
      out.push(run[0])
    }
    run = []
  }
  for (const item of runs) {
    if (isReadOnlyToolBlock(item)) run.push(item)
    else {
      flush()
      out.push(item)
    }
  }
  flush()
  return out
}

/**
 * trail → 块序列。这一段是纯读侧变换：不改事件、不补事件、不重排（顺序就是运行顺序）。
 * `streaming` 只影响「最后一块还没终态时怎么说」，不改任何已发生的数字。
 */
export function buildTimelineBlocks(trail, { streaming = false } = {}) {
  const events = Array.isArray(trail) ? trail.filter((event) => event && typeof event === 'object') : []
  const runs = []
  const toolByCallId = new Map()
  let processRun = null
  let subagentRun = null

  const closeProcess = () => { processRun = null }
  const closeSubagent = () => { subagentRun = null }

  for (const [index, event] of events.entries()) {
    const stage = String(event.stage ?? '')
    if (TOOL_STAGES.includes(stage)) {
      closeProcess()
      closeSubagent()
      const key = String(event.callId ?? '') || `#${index}`
      let block = toolByCallId.get(key)
      if (!block) {
        block = makeToolBlock([], streaming, false)
        toolByCallId.set(key, block)
        runs.push(block)
      }
      block.events.push(event)
      // callId 得落在块上：块是先建后灌事件的，不补这一句，组里的「明细」就没有身份（渲染层按 callId 出 key）。
      if (event.callId) block.callId = String(event.callId)
      const name = toolName(event)
      if (name) {
        block.name = name
        block.write = isWriteToolName(name)
        block.icon = classifyToolIcon(name)
      }
      const proposal = event.stage === 'proposal-created' ? String(event.proposalId ?? '') : ''
      if (proposal) block.proposalId = proposal
      if (event.stage === 'tool-denied') block.code = String(event.code ?? '')
      if (event.stage === 'tool-end') block.ms = Number(event.ms) || 0
      block.state = toolStateOf(block.events)
      continue
    }
    if (stage === 'answer') {
      closeProcess()
      closeSubagent()
      runs.push(makeBlock('response', [event], { state: 'completed' }))
      continue
    }
    if (SUBAGENT_STAGES.includes(stage)) {
      closeProcess()
      const name = toolName(event)
      // 合并条件带上段型：同名的「子代理」与「工作流步骤」是两件事，不许并成一块（文案不一样）。
      if (subagentRun && subagentRun.name === name && subagentRun.variant === stage) {
        subagentRun.events.push(event)
        if (stage === 'workflow-step') subagentRun.step = Number(event.step) || subagentRun.step
        continue
      }
      subagentRun = makeBlock('subagent', [event], {
        name,
        variant: stage,
        step: stage === 'workflow-step' ? Number(event.step) || 0 : 0,
        state: 'running'
      })
      runs.push(subagentRun)
      continue
    }
    if (PROCESS_STAGES.includes(stage)) {
      closeSubagent()
      if (!processRun) {
        processRun = makeBlock('thinking', [], { state: 'completed' })
        runs.push(processRun)
      }
      processRun.events.push(event)
      if (stage === 'failed') processRun.state = 'error'
    }
  }

  const withState = groupReadOnly(runs)
  const last = withState.length - 1
  // 子代理／工作流块：本批没有「这一路回来了」的终态事件，能确定的只有「这一问还在不在跑」。
  // 所以在途＝正在、收工＝已——「已交给子代理 研究员」说的是那次移交真发生过，不替它宣布成功与否。
  if (!streaming) {
    for (const block of withState) {
      if (block.kind === 'subagent') block.state = 'completed'
    }
  }
  if (streaming && last >= 0) {
    const tail = withState[last]
    if (tail.kind === 'thinking' && tail.state !== 'error') tail.state = 'running'
  }
  // 每块补一句头（组件只摆，不现造文案）。
  for (const block of withState) {
    block.headline = blockHeadline(block)
    if (block.kind === 'tool-group') {
      block.groupLine = `${block.headline || timelineLabel(block.state, blockAction(block))}（${block.items.length} 项）`
    }
  }
  return withState
}

/**
 * 耗时（工单第 4 条：两个都要在，取时间差为准）。
 * - `seconds`：事件 `at` 的首尾差（**外壳看到的那一刻**，不含主进程内部排队；口径就这么写）。
 * - `toolMs`：tool-end 的 ms 累加（上游自报的执行时长，与时间差不是一回事，所以两条都留）。
 * 没有 at 就回 null——不许用 toolMs 冒充时间差，也不许报 0 秒。
 */
export function timelineElapsed(trail) {
  const events = Array.isArray(trail) ? trail : []
  const start = firstAt(events)
  const end = lastAt(events)
  const toolMs = events
    .filter((event) => event?.stage === 'tool-end')
    .reduce((sum, event) => sum + (Number(event.ms) || 0), 0)
  const span = start !== null && end !== null && end >= start ? end - start : null
  return {
    seconds: span === null ? null : Math.max(0, Math.round(span / 100) / 10),
    toolMs,
    hasTimeDiff: span !== null
  }
}

/**
 * 顶部那一行：流中给状态语（平铺阶段），收工后合成为「已处理 N 秒 · 工具累计 X ms」。
 * 时间差没有就只说工具累计，并如实标「外壳没记到时刻」——不是所有会话都有 at（老 JSONL）。
 */
export function timelineSummary(trail, { streaming = false } = {}) {
  const elapsed = timelineElapsed(trail)
  if (streaming) {
    // 同一毫秒里连着来几条事件时首尾差是 0——「已过 0 秒」既没用又晃眼，宁可不报。
    if (elapsed.hasTimeDiff && elapsed.seconds > 0) return `正在处理（已过 ${elapsed.seconds} 秒）`
    return '正在处理'
  }
  const parts = []
  if (elapsed.hasTimeDiff) parts.push(elapsed.seconds > 0 ? `已处理 ${elapsed.seconds} 秒` : '已处理（不足 0.1 秒）')
  if (elapsed.toolMs > 0) parts.push(`工具累计 ${elapsed.toolMs}ms`)
  if (!parts.length) return '这一问没留下耗时读数'
  if (!elapsed.hasTimeDiff) return `${parts.join(' · ')}（外壳没记到事件时刻，只有工具自报时长）`
  return parts.join(' · ')
}

/** 折叠层的 key（会话内存 Map 的键；守卫⑨：这份状态只活在内存，不落盘）。 */
export function timelinePath(messageId, suffix = 'trail') {
  return `${String(messageId ?? '')}#${suffix}`
}
