import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_SESSION_STORAGE_PREFIX,
  DEFAULT_SESSION_TITLE,
  MAX_SESSIONS,
  MAX_SESSION_MESSAGES,
  MAX_TRAIL_EVENTS,
  MESSAGE_STATUSES,
  SESSION_TITLE_CHARS,
  agentSessionStorageKey,
  createSessionStore,
  describeRuntimeProgress,
  describeTrailEvent,
  messageStatus,
  normalizeBranchChoice,
  sanitizeMessageBranch,
  sanitizeSessionMessage,
  sanitizeTrail,
  sanitizeTrailEvent,
  visibleMessagePath
} from '../shell/agentSessions.mjs'

/**
 * 会话存储单测（批次27 · 任务一）。
 * 纯 node:test：agentSessions.mjs 不 import Vue，状态机、上限截断与降级路径都能脱离浏览器直接测。
 */

/**
 * 落盘适配器替身：save 收整份快照（与主进程 sessions:save 同一形状），深拷一份留作断言。
 * M2.5-B 起状态机不再碰 localStorage，持久化只经这一条 save 口。
 */
function recorder() {
  let latest = null
  let calls = 0
  return {
    save(payload) {
      calls += 1
      latest = JSON.parse(JSON.stringify(payload))
    },
    latest: () => latest,
    calls: () => calls
  }
}

/** 单调递增的时钟：会话排序与「最旧」判定都靠时间，测试里不能靠真实毫秒。 */
function stepClock(start = 1_700_000_000_000, step = 1000) {
  let value = start
  return () => {
    value += step
    return value
  }
}

test('会话管理：首启建空会话，可新建／切换／改名／删除', () => {
  const store = createSessionStore('D:/proj', { save: recorder().save, now: stepClock() })

  // 老键名只留给迁移认：新的落盘在 .pinax/sessions/，不再由本模块拼 localStorage 键。
  assert.equal(agentSessionStorageKey('D:/proj'), `${AGENT_SESSION_STORAGE_PREFIX}D:/proj`)
  assert.equal(store.list().length, 1, '无会话时首启自动建一个空会话')
  const first = store.list()[0]
  assert.equal(first.title, DEFAULT_SESSION_TITLE)
  assert.equal(first.messageCount, 0)
  assert.equal(store.active().id, first.id)
  assert.deepEqual(store.active().messages, [])

  store.append({ role: 'user', text: '开场能不能再狠一点？' })
  assert.equal(store.list()[0].title, '开场能不能再狠一点？', '标题自动取第一条 user 消息')
  assert.equal(store.list()[0].messageCount, 1)

  const created = store.create()
  assert.equal(store.list().length, 2, '新建会话进列表')
  assert.equal(store.snapshot().activeId, created.id, '新建的会话立刻成为当前会话')
  assert.deepEqual(store.active().messages, [], '新会话是空的')

  assert.equal(store.switchTo(first.id), true)
  assert.equal(store.active().messages.length, 1)
  assert.equal(store.switchTo('s-不存在'), false, '切到不存在的会话如实拒绝')
  assert.equal(store.active().id, first.id, '拒绝的切换不改当前会话')

  assert.equal(store.rename(first.id, '  雨夜那一场  '), true)
  assert.equal(store.active().title, '雨夜那一场')
  store.append({ role: 'user', text: '第二问不该改标题' })
  assert.equal(store.active().title, '雨夜那一场', '手动 rename 之后不再自动改')
  assert.equal(store.rename(first.id, '   '), false, '空标题拒绝')

  assert.equal(store.remove(created.id), true)
  assert.equal(store.list().length, 1)

  // 删掉当前会话：先切到最近更新的一条；删空则自动补一个空会话。
  assert.equal(store.remove(first.id), true)
  assert.equal(store.list().length, 1, '删空也要留一个能打字的地方')
  assert.deepEqual(store.active().messages, [])
  assert.equal(store.remove('s-不存在'), false)
})

test('上限：30 个会话、每会话 200 条消息，超限丢最旧', () => {
  const store = createSessionStore('D:/cap', { save: recorder().save, now: stepClock() })

  for (let index = 1; index <= MAX_SESSIONS + 5; index += 1) store.create(`标题${index}`)
  const titles = store.list().map((item) => item.title)
  assert.equal(titles.length, MAX_SESSIONS, `会话上限 ${MAX_SESSIONS}`)
  assert.ok(!titles.includes('标题1'), '最旧的会话被丢掉')
  assert.ok(titles.includes(`标题${MAX_SESSIONS + 5}`), '最新的会话还在')

  const session = store.create('消息上限')
  assert.ok(session.id)
  for (let index = 1; index <= MAX_SESSION_MESSAGES + 5; index += 1) {
    store.append({ role: 'user', text: `第${index}条` })
  }
  const messages = store.active().messages
  assert.equal(messages.length, MAX_SESSION_MESSAGES, `每会话上限 ${MAX_SESSION_MESSAGES} 条`)
  assert.equal(messages[0].text, '第6条', '丢的是最旧的那批')
  assert.equal(messages.at(-1).text, `第${MAX_SESSION_MESSAGES + 5}条`)
})

test('标题自动生成：只认第一条 user 消息，前 24 字，换行收成空格', () => {
  const store = createSessionStore('D:/title', { save: recorder().save, now: stepClock() })

  store.append({ role: 'user', text: `${'雨'.repeat(SESSION_TITLE_CHARS + 10)}后面还有很长` })
  assert.equal(store.active().title, '雨'.repeat(SESSION_TITLE_CHARS))
  assert.equal(store.active().title.length, SESSION_TITLE_CHARS)

  store.append({ role: 'agent', text: '回答' })
  store.append({ role: 'user', text: '第二问' })
  assert.equal(store.active().title, '雨'.repeat(SESSION_TITLE_CHARS), '标题不跟第二条 user 消息改')

  const multi = store.create()
  store.append({ role: 'user', text: '第一行\n第二行' })
  assert.equal(store.active().title, '第一行 第二行', `换行收成一个空格（会话 ${multi.id}）`)
})

test('落盘失败不崩：降级为内存会话，界面照常（persistent=false）', async () => {
  // 同步抛（IPC 桥没接好）：不拦提问，但如实说没持久化。
  const store = createSessionStore('D:/private', { save: () => { throw new Error('ipc 断了') } })
  assert.doesNotThrow(() => store.append({ role: 'user', text: '隐私模式下也能问' }))
  assert.equal(store.snapshot().persistent, false, '落盘失败要如实说')
  assert.equal(store.active().messages.length, 1, '本次会话里照样生效')

  const created = store.create()
  assert.equal(store.snapshot().activeId, created.id, '内存里照样能新建与切换')
  assert.doesNotThrow(() => store.remove(created.id))

  // 异步写盘失败（磁盘满／主进程拒绝）同样只降级：状态机不等它，也不回滚。
  const tight = createSessionStore('D:/quota', { save: () => Promise.reject(new Error('磁盘满')) })
  assert.doesNotThrow(() => tight.append({ role: 'agent', text: '答' }))
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(tight.snapshot().persistent, false)
  assert.equal(tight.active().messages.length, 1)

  // 没有 save（没打开项目／没桥）：不持久化，但 store 的 API 与状态照常。
  const memoryOnly = createSessionStore('D:/none')
  assert.equal(memoryOnly.snapshot().persistent, false)
  memoryOnly.append({ role: 'user', text: '只活在内存' })
  assert.equal(memoryOnly.active().messages.length, 1)
})

test('projectRoot 隔离：每个项目只收到自己那份快照，互不串；没有 save 时不落盘', () => {
  const saved = new Map()
  const saver = (root) => (payload) => { saved.set(root, JSON.parse(JSON.stringify(payload))) }
  const a = createSessionStore('D:/a', { save: saver('D:/a'), now: stepClock() })
  a.append({ role: 'user', text: 'A 的问题' })
  const b = createSessionStore('D:/b', { save: saver('D:/b'), now: stepClock() })
  assert.equal(b.active().messages.length, 0, '另一个项目读不到 A 的会话')
  b.append({ role: 'user', text: 'B 的问题' })

  assert.deepEqual([...saved.keys()].sort(), ['D:/a', 'D:/b'])
  assert.equal(saved.get('D:/a').sessions[0].messages[0].text, 'A 的问题')
  assert.equal(saved.get('D:/b').sessions[0].messages[0].text, 'B 的问题')

  // 重新打开 A：消息、标题与当前会话都按主进程读回的那份（initial）回来。
  const again = createSessionStore('D:/a', { initial: saved.get('D:/a'), save: saver('D:/a'), now: stepClock() })
  assert.equal(again.active().messages.length, 1)
  assert.equal(again.active().messages[0].text, 'A 的问题')
  assert.equal(again.active().title, 'A 的问题')

  // 还没打开项目（空根、没有 save）：只活在内存里，不新写任何快照。
  const before = saved.size
  const none = createSessionStore('')
  none.append({ role: 'user', text: '无项目' })
  assert.equal(none.snapshot().persistent, false)
  assert.equal(saved.size, before, '没有 save 不新写快照')
})

test('持久化往返：多会话与 activeId 落盘，消息形状是 JSON 安全的固定字段', () => {
  const saver = recorder()
  const store = createSessionStore('D:/round', { save: saver.save, now: stepClock() })
  store.append({
    role: 'user',
    text: '只依据本书资料回答：柯秒是谁？',
    command: '/资料',
    notes: ['（引用取不到：章节《第009章》 项目清单里没有这一条）'],
    // 不该进存储的字段（上游塞进来的临时对象）—— sanitize 会挡掉。
    raw: { big: 'x'.repeat(1000) }
  })
  store.append({
    role: 'agent',
    text: '柯秒是主角。',
    findings: [{ severity: 'low', message: '停摆表没推动动作。', extra: 'drop' }],
    actions: ['补一笔场景细节。']
  })
  const second = store.create()
  store.append({ role: 'user', text: '第二条会话的开头' })

  const saved = saver.latest()
  assert.deepEqual(Object.keys(saved).sort(), ['activeId', 'sessions'])
  assert.equal(saved.activeId, second.id, 'activeId 一起落盘')
  assert.equal(saved.sessions.length, 2)

  const firstMessage = saved.sessions[0].messages[0]
  // 〔批次77 任务2 断言漂移，理由如实记〕schema 多了 runId／usage／status 三格：
  // 「这一条是哪一轮跑的、这轮报了多少 token、现在是什么状态」要能跨刷新说得出，
  // 才有消息行上的状态字与用量 chip。这三格由 sanitizeSessionMessage 统一裁（usage 只能缺省成 null，
  // status 只能落进 MESSAGE_STATUSES 闭集），仍是 JSON 安全的固定字段——不是把未知字段放进来。
  // 〔批次77-R2 任务6 断言漂移，理由如实记〕再多一格 `branch`：消息级分叉的链接格（工单第 1 条），
  // 只认 {parentId,index,count} 三个确定字段，读不出就是 null（＝原始支）。仍是固定字段、
  // 仍由 sanitizeSessionMessage 一处裁——不是把未知字段放进来。
  assert.deepEqual(Object.keys(firstMessage).sort(),
    ['actions', 'at', 'branch', 'command', 'failed', 'findings', 'id', 'notes', 'role', 'runId', 'status', 'text', 'trail', 'usage'],
    '消息只落 schema 里那几个字段（未知字段不进存储）')
  assert.equal(firstMessage.runId, '', '没带 runId 就是空串，不编一个')
  assert.equal(firstMessage.usage, null, '上游没回报用量时是 null，不是 0')
  assert.equal(firstMessage.status, 'completed', '缺 status 的老写法归一成 completed')
  assert.equal(firstMessage.branch, null, '没分过叉的会话读回来就是原始支，不编一个链接格')
  assert.equal(firstMessage.command, '/资料')
  assert.equal(firstMessage.notes.length, 1)
  assert.deepEqual(Object.keys(saved.sessions[0].messages[1].findings[0]).sort(), ['message', 'severity'])

  // 读回来还能接着用：updateLast 只改最后一条、dropLast 去掉它。
  const reopened = createSessionStore('D:/round', { initial: saved, save: saver.save, now: stepClock() })
  assert.equal(reopened.snapshot().activeId, second.id)
  reopened.switchTo(saved.sessions[0].id)
  assert.equal(reopened.active().messages.length, 2)
  reopened.updateLast({ text: '改过的回答' })
  assert.equal(reopened.active().messages.at(-1).text, '改过的回答')
  assert.equal(reopened.active().messages.at(-1).role, 'agent', 'updateLast 不许换掉角色')
  assert.equal(reopened.dropLast(), true)
  assert.equal(reopened.active().messages.length, 1)
  assert.equal(reopened.dropLast(), true)
  assert.equal(reopened.dropLast(), false, '空了就没什么可丢的')

  // 坏数据（不是 JSON／形状不对）当作没存过：不崩、起一个空会话。
  // 旧 localStorage 的解析失败已在迁移那层挡掉；这里兜的是主进程读回结果的形状漂移。
  assert.doesNotThrow(() => createSessionStore('D:/broken', { initial: '{不是 json' }))
  const shaped = createSessionStore('D:/shape', { initial: { sessions: [{ title: '' }, null, 42] } })
  assert.equal(shaped.list().length, 1)
  assert.equal(shaped.active().title, DEFAULT_SESSION_TITLE)
})

test('晚到的回答落回出发的那个会话：切走之后 append(id) 不写进新会话', () => {
  const store = createSessionStore('D:/late', { save: recorder().save, now: stepClock() })
  const first = store.list()[0]
  store.append({ role: 'user', text: 'A 会话的问题' }, first.id)
  const second = store.create('B 会话')
  assert.equal(store.snapshot().activeId, second.id)

  // 回答晚到：带上出发时的会话 id，就落回 A，不落在作者此刻看着的 B。
  store.append({ role: 'agent', text: 'A 会话的回答' }, first.id)
  assert.deepEqual(store.active().messages, [], '当前会话（B）不该收下别处的回答')
  store.switchTo(first.id)
  assert.deepEqual(store.active().messages.map((message) => message.text), ['A 会话的问题', 'A 会话的回答'])

  // 会话被删掉之后晚到的回答无处可去：如实返回 null，不抛、也不落到别人家。
  store.remove(first.id)
  assert.equal(store.append({ role: 'agent', text: '孤儿回答' }, first.id), null)
})

/**
 * 〔批次77 任务2〕dropFrom 是「从某一条起往后截断」的唯一入口（编辑重发用它，
 * 任务6 的「分支＝截断前先把这一支存下」也接在同一处，不长第二套）。
 * 三条都要钉死：命中才动、动多少报多少、点名别的会话时不许动当前会话。
 */
test('dropFrom：从命中那条起往后整段截掉，报出删掉的条数；查无此 id 与会话隔离都不误伤', () => {
  const saver = recorder()
  const store = createSessionStore('D:/dropfrom', { save: saver.save, now: stepClock() })
  const first = store.list()[0]
  const second = store.create('B 会话')
  store.append({ role: 'user', text: 'B 的开头' }, second.id)
  // list() 是摘要面（没有 messages），取 id 要走 active()——create 之后当前会话就是 B。
  const bStartId = store.active().messages[0].id

  // A 会话攒四条：问／答／问／答。
  store.switchTo(first.id)
  store.append({ role: 'user', text: '第一问' })
  store.append({ role: 'agent', text: '第一答' })
  store.append({ role: 'user', text: '第二问' })
  store.append({ role: 'agent', text: '第二答' })
  const anchorId = store.active().messages[1].id

  // 查无此 id：返回 0，一条都不动（编辑重发的过期点击走的就是这一档）。
  assert.equal(store.dropFrom('不存在的 id'), 0)
  assert.equal(store.active().messages.length, 4)

  // 命中：把这一条**连同它之后**的截掉，报出删了几条（这里是「第一答＋第二问＋第二答」＝3）。
  assert.equal(store.dropFrom(anchorId), 3)
  assert.deepEqual(store.active().messages.map((message) => message.text), ['第一问'])

  // 点名别的会话：动 B，A（作者此刻看着的）一根手指都不碰。
  assert.equal(store.snapshot().activeId, first.id, '截 B 之前当前会话仍是 A')
  assert.equal(store.dropFrom(bStartId, second.id), 1)
  assert.deepEqual(store.active().messages.map((message) => message.text), ['第一问'], '别处的 id 不许顺手截当前会话')
  store.switchTo(second.id)
  assert.deepEqual(store.active().messages, [])

  // 截断是一次状态变化：整份快照交出去，落盘的那一份与内存一致。
  const saved = saver.latest()
  const savedFirst = saved.sessions.find((session) => session.id === first.id)
  assert.deepEqual(savedFirst.messages.map((message) => message.text), ['第一问'])
})

test('消息清洗：角色必须是 user/agent，非字符串字段不进存储', () => {
  assert.equal(sanitizeSessionMessage(null), null)
  assert.equal(sanitizeSessionMessage({ role: 'system', text: 'x' }), null)
  // 整份形状钉住（批次77 任务2 加了 runId／usage／status 三格：usage 没回报就是 null，
  // status 缺省按 failed 归位。〔批次77-R2 任务6〕再加一格 branch：分叉链接，没带就是 null。
  // 改名、漏格、把 null 变成 0 都会在这里红，不会静默漂移——沿批次76「整份钉住」那条纪律。）
  assert.deepEqual(sanitizeSessionMessage({ role: 'agent', text: 42, findings: 'nope', actions: [1, 'ok'] }), {
    id: '',
    branch: null,
    role: 'agent',
    text: '',
    findings: [],
    actions: ['ok'],
    notes: [],
    command: '',
    trail: [],
    failed: false,
    at: '',
    runId: '',
    usage: null,
    status: 'completed'
  })
  assert.equal(sanitizeSessionMessage({ role: 'user', failed: 'yes' }).failed, false, 'failed 只认布尔真值')
  assert.equal(sanitizeSessionMessage({ role: 'agent', failed: true }).status, 'error', 'failed 的老存档读成 error')
})

test('〔批次77 任务2〕用量与状态：只认回报的数，缺回报是 null 不是 0；状态闭集外回落', () => {
  const withUsage = sanitizeSessionMessage({ role: 'agent', text: '答', usage: { input: 1200, output: 380 } })
  assert.deepEqual(withUsage.usage, { input: 1200, output: 380, total: 1580 }, 'total 缺时用 input+output 补')
  assert.deepEqual(sanitizeSessionMessage({ role: 'agent', usage: { input: 5, output: 2, total: 9 } }).usage, { input: 5, output: 2, total: 9 })
  // 负断言：没有回报／回报不是数／负数／小数——一律 null，界面不许拿它当 0 用。
  assert.equal(sanitizeSessionMessage({ role: 'agent', usage: null }).usage, null)
  assert.equal(sanitizeSessionMessage({ role: 'agent', usage: { chars: 900 } }).usage, null, '字数不换算成 token')
  assert.equal(sanitizeSessionMessage({ role: 'agent', usage: { input: -3 } }).usage, null)
  assert.equal(sanitizeSessionMessage({ role: 'agent', usage: { input: 1.5 } }).usage, null, '非整数不认')
  assert.equal(sanitizeSessionMessage({ role: 'agent', usage: { input: 0, output: 0 } }).usage.input, 0, '真回报的 0 保留')
  // runId 与 status：闭集外的值不进气泡，只回落归位。
  assert.equal(sanitizeSessionMessage({ role: 'agent', runId: 'ask-7' }).runId, 'ask-7')
  assert.equal(sanitizeSessionMessage({ role: 'agent', runId: 42 }).runId, '', '非字符串 runId 不进存储')
  assert.equal(sanitizeSessionMessage({ role: 'agent', status: 'stopped' }).status, 'stopped')
  assert.equal(sanitizeSessionMessage({ role: 'agent', status: 'paused' }).status, 'completed', '闭集外当 completed 读')
  assert.deepEqual(MESSAGE_STATUSES, ['streaming', 'completed', 'stopped', 'error'])
  assert.equal(messageStatus({ status: 'streaming' }), 'streaming')
  assert.equal(messageStatus({ failed: true }), 'error', '没有 status 的旧消息按 failed 判读')
  assert.equal(messageStatus({}), 'completed')
})

test('运行过程轨迹（批次29）：事件按白名单清洗、封顶 32 条、随消息持久化', () => {
  // 〔批次77 任务4 改断言·理由写在下面〕这两条原来是反向断言：
  //   assert.equal(sanitizeTrailEvent({ stage: 'subagent', name: '研究员' }), null)
  // 理由是批次29 那句「链上不存在的子代理／hook 不许在这里长出假事件」。本批按工单把
  // `subagent`／`workflow-step` 进了白名单（产出方＝批次78），**认得**它们不再是造假：
  // 没人发时轨迹里仍是一条都不多（反向断言换成了下面的「未知段仍不认」），
  // 一旦 78 开始发，渲染侧已经长好了，不必再动 schema。
  assert.deepEqual(sanitizeTrailEvent({ stage: 'subagent', name: '研究员' }), {
    stage: 'subagent',
    name: '研究员',
    callId: '',
    task: '',
    ok: false
  })
  assert.deepEqual(sanitizeTrailEvent({ stage: 'workflow-step', name: '分段执笔', step: '2', junk: 1 }), {
    stage: 'workflow-step',
    name: '分段执笔',
    callId: '',
    step: 2
  })
  // 白名单仍是闸：名单外的段（哪怕是「听起来像子代理」的）照旧丢掉。
  assert.equal(sanitizeTrailEvent({ stage: 'subagent-start', name: '研究员' }), null)
  assert.equal(sanitizeTrailEvent(null), null)
  assert.deepEqual(
    sanitizeTrailEvent({
      stage: 'envelope',
      taskType: 'authoring.review.chapter',
      profile: 'writing-chapter',
      blocks: '6',
      chars: 18_240,
      missingKinds: ['outline', 42],
      extra: 'drop'
    }),
    {
      stage: 'envelope',
      taskType: 'authoring.review.chapter',
      profile: 'writing-chapter',
      blocks: 6,
      chars: 18_240,
      missingKinds: ['outline']
    },
    '计数收成整数、未知字段不进存储'
  )
  assert.deepEqual(
    sanitizeTrailEvent({ stage: 'failed', code: 'AGENT_PROVIDER_CONFIG_INVALID', atStage: 'model-round' }),
    { stage: 'failed', code: 'AGENT_PROVIDER_CONFIG_INVALID', atStage: 'model-round' }
  )
  assert.equal(sanitizeTrailEvent({ stage: 'failed', atStage: 'failed' }).atStage, 'start', '断点只认前四步，failed 不能自己当断点')

  const long = Array.from({ length: MAX_TRAIL_EVENTS + 8 }, (_item, index) => ({ stage: 'model-round', round: index + 1 }))
  const capped = sanitizeTrail(long)
  assert.equal(capped.length, MAX_TRAIL_EVENTS, `轨迹封顶 ${MAX_TRAIL_EVENTS} 条`)
  assert.equal(capped[0].round, 9, '丢的是最旧的')
  assert.equal(capped.at(-1).round, MAX_TRAIL_EVENTS + 8)

  // 随消息落盘再读回来：轨迹还在、形状仍是固定字段（刷新后折叠层不会消失）。
  const saver = recorder()
  const store = createSessionStore('D:/trail', { save: saver.save, now: stepClock() })
  store.append({ role: 'user', text: '这一章怎么样？' })
  store.append({
    role: 'agent',
    text: '节奏偏慢。',
    trail: [
      { stage: 'start', questionChars: 7 },
      { stage: 'envelope', taskType: 'authoring.review.chapter', profile: 'writing-chapter', blocks: 6, chars: 18_240, missingKinds: [] },
      { stage: 'model-round', round: 1 },
      { stage: 'answer', chars: 5, structured: true, roundsUsed: 1 }
    ]
  })
  const reopened = createSessionStore('D:/trail', { initial: saver.latest(), now: stepClock() })
  const trail = reopened.active().messages.at(-1).trail
  assert.equal(trail.length, 4)
  assert.deepEqual(trail.map((event) => event.stage), ['start', 'envelope', 'model-round', 'answer'])
  assert.equal(trail[1].blocks, 6)
  assert.equal(trail.at(-1).structured, true)

  // 界面那两句：busy 期阶段语与折叠层一行，数字都来自事件本身。
  assert.equal(describeRuntimeProgress({ stage: 'envelope', blocks: 6, chars: 18_240 }), '正在组装上下文（6 块 · 18240 字）')
  assert.equal(describeRuntimeProgress({ stage: 'model-round', round: 2 }), '模型第 2 轮')
  assert.equal(describeRuntimeProgress({ stage: 'answer' }), '正在整理回答')
  assert.equal(describeRuntimeProgress({ stage: 'start', questionChars: 3 }), '', 'start 没有更好的话就回空串，让界面保留固定语')
  assert.equal(describeRuntimeProgress(null), '')
  assert.deepEqual(describeTrailEvent({ stage: 'failed', code: 'PINAX_DEPENDENCY_UNMET', atStage: 'model-round' }), {
    stage: 'failed',
    label: '中断',
    detail: 'PINAX_DEPENDENCY_UNMET · 断在模型轮次'
  })
  // 〔批次77 任务4 改断言·理由〕原来这条是 `describeTrailEvent({ stage: 'subagent' }) === null`，
  // 挂在同一条老原则上（「链上不存在的段不认」）。段现在在册，判读要跟着长出来——
  // 「扩白名单不是扩沉默」是 trail-tool-events 那份测试立的老规矩；无名时不许拼成「子代理 子代理」。
  assert.deepEqual(describeTrailEvent({ stage: 'subagent', name: '研究员', task: '查前三章伏笔' }), {
    stage: 'subagent',
    label: '子代理 研究员',
    detail: '查前三章伏笔'
  })
  assert.equal(describeTrailEvent({ stage: 'subagent' }).label, '子代理')
  assert.deepEqual(describeTrailEvent({ stage: 'workflow-step', name: '分段执笔', step: 3 }), {
    stage: 'workflow-step',
    label: '工作流第 3 步',
    detail: '分段执笔'
  })
  // 真·不认的段仍然一行都不出（白名单没被放宽成「什么都收」）。
  assert.equal(describeTrailEvent({ stage: 'subagent-start' }), null)
  assert.equal(describeRuntimeProgress({ stage: 'subagent', name: '研究员' }), '正在交给子代理 研究员')
  assert.equal(describeRuntimeProgress({ stage: 'workflow-step', step: 2 }), '工作流第 2 步')
})

/**
 * 〔批次77-R2 任务6〕消息树（分支）。工单四条验收在这里钉前三条：
 *   1) 分叉不改写既有那一条支（`branch` 只长在新拷贝上，原始支在盘上就是不带标签的一串）；
 *   2) ‹ › 切换只改「此刻看哪一支」，两支的内容一字不差；
 *   3) 分支与编辑重发共用 `dropFrom` 这一个历史入口，截断只截看得见的那一段，别支不陪葬。
 * 第四条（追加式落盘、守卫⑩既有行逐字节不变）在盘那侧，见 session-store.test.mjs。
 */
test('批次77-R2 任务6：branch 格只认三个确定字段，读不出就按原始支走', () => {
  assert.deepEqual(sanitizeMessageBranch({ parentId: 'm-1', index: 2, count: 3, junk: 'drop' }), { parentId: 'm-1', index: 2, count: 3 })
  assert.equal(sanitizeMessageBranch(null), null)
  assert.equal(sanitizeMessageBranch('m-1'), null, '一个字符串不是一格链接')
  assert.equal(sanitizeMessageBranch([]), null, '数组也不是一格链接')
  assert.equal(sanitizeMessageBranch({ parentId: 'm-1', index: 0, count: 2 }), null, '支序号从 1 起')
  assert.equal(sanitizeMessageBranch({ parentId: 'm-1', index: 3, count: 2 }), null, '序号不许超过支数')
  assert.deepEqual(sanitizeMessageBranch({ index: 2, count: 2 }), { parentId: '', index: 2, count: 2 }, '没带 parentId＝挂在会话开头那一层，不是把整格丢掉')
  assert.deepEqual(
    sanitizeSessionMessage({ role: 'user', text: 'q', branch: { parentId: 'm-1', index: 2, count: 2, extra: 1 } }).branch,
    { parentId: 'm-1', index: 2, count: 2 },
    '多余字段不进这一格')
})

test('批次77-R2 任务6：指针表只认正整数序号，坏值不进存储也不参与判读', () => {
  assert.deepEqual(normalizeBranchChoice(null), {})
  assert.deepEqual(normalizeBranchChoice([1, 2]), {}, '数组不是一张表')
  assert.deepEqual(normalizeBranchChoice({ a: 2, b: 0, c: 1.5, d: '3' }), { a: 2, d: 3 }, '0／小数不算支序号，字符串数字归一成整数')
  assert.deepEqual(normalizeBranchChoice({ ['x' + 'y'.repeat(90)]: 2 }), {}, '键是消息 id，长过 80 的不认')
})

test('批次77-R2 任务6：分一支是把可见支那一段存成新支，既有那几条一字不动，‹ › 只动当前支指针', () => {
  const saver = recorder()
  const store = createSessionStore('D:/branch', { save: saver.save, now: stepClock() })
  store.append({ role: 'user', text: '第一问' })
  store.append({ role: 'agent', text: '第一答' })
  store.append({ role: 'user', text: '第二问' })
  store.append({ role: 'agent', text: '第二答' })
  const visible = store.active().messages
  const anchor = visible[2]
  const anchorParent = visible[1].id

  const fork = store.branchFrom(anchor.id)
  assert.equal(fork.copied, 2, '这一问和它的答案一起存成另一支')
  assert.equal(fork.index, 2, '原始支天生占 1 号位，新支排到 2')
  assert.deepEqual(store.active().messages.map((message) => message.text),
    ['第一问', '第一答', '第二问', '第二答'], '分叉不切支：屏上仍是作者正在看的那一条串')

  const stored = saver.latest().sessions[0].messages
  assert.equal(stored.length, 6, '分叉只是多出两条拷贝，一条既有的都没动')
  assert.deepEqual(stored.slice(0, 4).map((message) => [message.text, message.branch]),
    [['第一问', null], ['第一答', null], ['第二问', null], ['第二答', null]],
    '原始支在盘上就是不带标签的那一串（既有行才能逐字节不变）')
  assert.deepEqual(stored[4].branch, { parentId: anchorParent, index: 2, count: 2 }, '拷贝的头一条认分叉点')
  assert.deepEqual(stored[5].branch, { parentId: stored[4].id, index: 1, count: 1 },
    '落盘是追加式的，数组位置不能当父子依据：段内也明写；这一层只有它一个孩子，count 就写 1（候选数只说本层）')
  assert.notEqual(stored[4].id, anchor.id, '拷贝是新的 id，不与原来那条抢身份')

  // 分支的后半＝截断（与编辑重发同一个 dropFrom），接着再问一次，两支并存在同一个分叉点下。
  assert.equal(store.dropFrom(anchor.id), 2)
  store.append({ role: 'user', text: '第二问（改过的）' })
  store.append({ role: 'agent', text: '新的答案' })
  assert.deepEqual(store.active().messages.map((message) => message.text),
    ['第一问', '第一答', '第二问（改过的）', '新的答案'])
  const switchable = store.active().messages.at(-2)
  assert.deepEqual(switchable.branchNav, { index: 1, count: 2 }, '新长的问句占回 1 号位，屏上才有 ‹1/2› 可点')
  assert.deepEqual(saver.latest().sessions[0].branchChoice, {}, '分叉＋截断＋再问＝一次开关都没拨，指针表就该是空的')

  assert.equal(store.cycleBranch(switchable.id, 1).index, 2)
  assert.deepEqual(store.active().messages.map((message) => message.text),
    ['第一问', '第一答', '第二问', '第二答'], '切到退路那一支：这一支的内容一字不差')
  assert.equal(store.cycleBranch(store.active().messages.at(-2).id, -1).index, 1)
  assert.deepEqual(store.active().messages.map((message) => message.text),
    ['第一问', '第一答', '第二问（改过的）', '新的答案'], '切回来：另一支同样一字不差')

  // 指针是会话真值：拨过开关就随会话落盘，读回来还在作者挑的那一支上。
  assert.equal(store.cycleBranch(store.active().messages.at(-2).id, 1).index, 2)
  assert.equal(saver.latest().sessions[0].branchChoice[anchorParent], 2, '拨到第 2 支：这一步落盘')
  const reopened = createSessionStore('D:/branch', { initial: saver.latest(), save: recorder().save, now: stepClock() })
  assert.deepEqual(reopened.active().messages.map((message) => message.text),
    ['第一问', '第一答', '第二问', '第二答'], '重开外壳不许把挑好的那一支抹回默认')
})

test('批次77-R2 任务6：截断与追写只碰看得见的那一段，别的一支不陪葬', () => {
  const store = createSessionStore('D:/isolate', { save: recorder().save, now: stepClock() })
  store.append({ role: 'user', text: '甲' })
  store.append({ role: 'agent', text: '乙' })
  const fork = store.branchFrom(store.active().messages[0].id)
  assert.equal(fork.parentId, '', '从第一句分叉＝挂在会话开头那一层')
  assert.equal(store.dropFrom(store.active().messages[0].id), 2, '截掉的是可见支那两条')

  // 截完屏上是空的（原始支被截了、指针没记 → 不擅自把拷贝那一支当成「正在看的那一支」画出来），
  // 再问一次就占回 1 号位：两支并存，切换器才有得切。
  store.append({ role: 'user', text: '丙' })
  store.append({ role: 'agent', text: '丁' })
  const current = store.active().messages
  assert.deepEqual(current.map((message) => message.text), ['丙', '丁'])
  assert.deepEqual(current[0].branchNav, { index: 1, count: 2 })

  // 此刻数组末尾是「丁」，而另一支的拷贝在数组中间：追写与 updateLast 必须落在看得见的那条上。
  store.updateLast({ notes: ['这一条落在丁上'] })
  assert.deepEqual(store.active().messages.at(-1).notes, ['这一条落在丁上'])
  assert.equal(store.active().messages.at(-1).text, '丁')
  const before = store.active()
  assert.equal(store.cycleBranch(current[0].id, 1).index, 2)
  assert.deepEqual(store.active().messages.map((message) => message.text), ['甲', '乙'], '切过去就是那一支，一条不缺')
  // 切回来仍要点那一支的**头**（切换器就长在这一行上）：支与支的开关是分叉点那一层的事，不是叶子的事。
  assert.equal(store.cycleBranch(store.active().messages[0].id, -1).index, 1, '切回来')
  assert.equal(store.cycleBranch(store.active().messages[1].id, -1), null, '那一层只有一支：不演一次「切了」')
  assert.deepEqual(before.messages.map((message) => message.text), ['丙', '丁'], '刚才那次切换没动这一支的内容')
  assert.equal(store.dropLast(), true, 'dropLast 去掉的也是看得见的那条')
  assert.deepEqual(store.active().messages.map((message) => message.text), ['丙'])
})

test('批次77-R2 任务6：没分过叉的会话，可见支就是整串消息，派生格不进存储', () => {
  const saver = recorder()
  const store = createSessionStore('D:/plain', { save: saver.save, now: stepClock() })
  store.append({ role: 'user', text: '问' })
  store.append({ role: 'agent', text: '答' })
  assert.deepEqual(store.active().messages.map((message) => message.branch), [null, null])
  assert.deepEqual(store.active().messages.map((message) => message.branchNav), [{ index: 1, count: 1 }, { index: 1, count: 1 }])
  assert.equal(saver.latest().sessions[0].messages.every((message) => !('branchNav' in message)), true,
    'branchNav 是显示面派生格，不进存储（钉住形状的那两条用例才不会莫名多一格）')
  // 只有一支时切换器无处可切：返回 null，不演一次「切了」。
  assert.equal(store.cycleBranch(store.active().messages[1].id, 1), null)
  assert.equal(store.branchFrom('查无此 id'), null)
})

test('批次77-R2 任务6：指针落空不擅自换支，那一条支被截了路径就到头为止', () => {
  const messages = [
    { id: 'a', role: 'user', text: '原始问' },
    { id: 'b', role: 'user', text: '拷贝问', branch: { parentId: '', index: 2, count: 2 } }
  ]
  // 指针指着一支不存在的序号，但原始支还在 → 看原始支（不跳到拷贝那支上去）。
  assert.deepEqual(visibleMessagePath({ messages, branchChoice: { '': 9 } }).map((entry) => entry.message.text), ['原始问'])
  // 原始支本身也没了（截断之后）：路径为空，界面上就是一句都不画，别支不能冒充「正在看的那一支」。
  assert.deepEqual(visibleMessagePath({ messages: messages.slice(1), branchChoice: {} }).map((entry) => entry.message.text), [])
  // 挑了第 2 支就看得见那一支。
  assert.deepEqual(visibleMessagePath({ messages, branchChoice: { '': 2 } }).map((entry) => entry.message.text), ['拷贝问'])
})
