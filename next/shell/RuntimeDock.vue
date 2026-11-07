<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AssistantDialog from './AssistantDialog.vue'
import { IPC_CHANNELS, IPC_PUSH } from './ipcContract.mjs'
import {
  MAX_TRAIL_EVENTS,
  agentSessionStorageKey,
  createSessionStore,
  describeRuntimeProgress,
  formatClock,
  sanitizeTrailEvent,
  trailStageLabel
} from './agentSessions.mjs'
import { resolveSlash, slashMessageFields } from './slashCommands.mjs'
import { extractSkillToken, skillNameList } from './composerTypeahead.mjs'
import { HOTKEYS_VERSION, defaultBindings, normalizeHotkeys } from './hotkeys.mjs'
import { matchReference, parseRefs, referenceKindLabel, resolveRefs, withRefs } from './agentReferences.mjs'
import { legacyLocalStorage, migrateLegacySessions } from './sessionMigration.mjs'

/**
 * 右栏：Agent 的对话框。
 *
 * 作者口径：Agent 就是一个纯粹的对话框，界面形态直接抽自老前端的作品资料助手
 * （AssistantDialog.vue，从 src/components/authoring/AuthoringKnowledgeAssistant.vue 抽象而来），
 * 不再另起一套「运行时说明书」。
 *
 * 这一层管四件事（批次27 起）：
 *   1) 会话：多会话＋持久化全在 agentSessions（按项目根隔离，键 agentSessions.<projectRoot>），
 *      这里只把快照接进 ref，换项目就换一个 store——两个项目的对话互不串。
 *   2) slash 路由：草稿以命令词开头（或从提示层选了一条）就剥掉命令词，把 omit 并进 runtimeAsk
 *      的 context.omit；命令徽章落在 user 那条消息上。omit 是既有能力，不在这里改内核。
 *   3) @ 引用：拆出 @《…》 → 走已有 runtimeToolCall 取摘要 → 拼进问题原文；取不到的如实标在消息流里。
 *   4) 提问：把问题送进 runtime:ask 通道、把回答排成会话、记住最后一轮以便重试。
 *   5) 运行过程（批次29）：提问期间接主进程推来的真实阶段事件，busy 期换阶段语，
 *      答完把整条轨迹随消息落进会话（答下方的「过程」折叠层），刷新后还在。
 *   6) 〔批次77 任务3〕技能与停止：发送那一刻从正文抽出 `/技能名` token（只认真装载的那份清单，
 *      抽完把字面量从正文里去掉），并把「按 askId 取消」的请求发给主进程——停没停由运行回执说，
 *      这一层不自己把消息改成「已停」。
 *   7) 〔批次77-R2 任务6〕消息树：一条问句之后的历史可以分成好几支。「分一支」＝先把当前支的尾段
 *      存成拷贝、再截断这一支（退路落在盘上，不是只在内存里）；‹ i/n › 只挪会话级的当前支指针，
 *      两支的消息一个字都不动。截断只有 store.dropFrom 这一个入口，与「编辑重发」共用。
 * 工具面之类的开发者向事实折在对话框底部的折叠层里——老版就是这么处理的。
 */
const props = defineProps({
  runtime: { type: Object, required: true },
  bridge: { type: Object, default: null },
  /** 会话按项目根隔离（换项目＝另一份会话）；空串代表还没打开项目，只活在内存里。 */
  projectRoot: { type: String, default: '' },
  /** @ 引用清单：[{ kind, title, path }]，由外壳从 board data 组一份传下来。 */
  references: { type: Array, default: () => [] },
  /** 统一二级页开着时为 true：Esc 先归它，不关会话/引用弹层（照 FloatingWidget 的 suspendEsc 先例）。 */
  suspendEsc: { type: Boolean, default: false }
})

let store = createSessionStore(props.projectRoot)
let unsubscribe = null
/** 换项目/换桥时旧的那次读盘结果不能再盖回来：序号一乱就丢。 */
let hydrateSeq = 0
const snapshot = ref(store.snapshot())
const migrationNotice = ref('')

/** store 是纯数据模块（node:test 直接测），快照经订阅进 ref——与 paneForms 的宿主同一套。 */
function attachStore(projectRoot, options = {}) {
  if (unsubscribe) unsubscribe()
  store = createSessionStore(projectRoot, options)
  snapshot.value = store.snapshot()
  unsubscribe = store.subscribe((next) => { snapshot.value = next })
}

/**
 * 会话的真相在磁盘（`.pinax/sessions/`，主进程写 JSONL）。
 * 1) 老 localStorage 键迁移：写盘成功才删；失败保留并把原因显示在右栏底部。
 * 2) 读回会话；读不到（没有项目/主进程未接/通道失败）就从空会话起步，不假装有历史。
 * 3) 之后每次状态变化交整份快照给主进程；按顺序串着发，晚到的旧快照不能覆盖新快照。
 */
async function hydrateStore(projectRoot, bridge) {
  const seq = ++hydrateSeq
  if (!projectRoot || !bridge?.request) {
    attachStore(projectRoot)
    return
  }
  const migration = await migrateLegacySessions({
    storage: legacyLocalStorage(),
    key: agentSessionStorageKey(projectRoot),
    importVia: (legacy) => bridge.request(IPC_CHANNELS.sessionsImport, { legacy })
  }).catch(() => null)
  if (seq !== hydrateSeq) return
  migrationNotice.value = migration && !migration.ok && migration.kept
    ? '老会话迁移失败（' + migration.reason + '）：旧数据还留在浏览器缓存里，没有删。'
    : ''

  let initial = null
  try {
    const loaded = await bridge.request(IPC_CHANNELS.sessionsLoad, {})
    if (loaded?.ok && Array.isArray(loaded.value?.sessions)) initial = loaded.value
  } catch {
    initial = null
  }
  if (seq !== hydrateSeq) return

  let saveChain = Promise.resolve()
  attachStore(projectRoot, {
    initial,
    save: (payload) => {
      // 拷贝一份再排队：排队期间状态机还会继续改，交出去的必须是变化发生那一刻的快照。
      const frozen = JSON.parse(JSON.stringify(payload))
      saveChain = saveChain.then(
        () => bridge.request(IPC_CHANNELS.sessionsSave, { snapshot: frozen }),
        () => bridge.request(IPC_CHANNELS.sessionsSave, { snapshot: frozen })
      )
      return saveChain
    }
  })
}
watch(
  [() => props.projectRoot, () => props.bridge],
  ([root, bridge]) => { void hydrateStore(root, bridge) },
  { immediate: true }
)

const messages = computed(() => snapshot.value.messages)
/** 对话框实例：编辑重发要把问句回填输入框，那是它内部的草稿态，只经它 expose 出来的 setDraft。 */
const dialogRef = ref(null)
const sessions = computed(() => snapshot.value.sessions)
const activeSessionId = computed(() => snapshot.value.activeId)
const busy = computed(() => snapshot.value.busy)
const canAsk = computed(() => Boolean(props.bridge?.request))
const tools = computed(() => props.runtime.tools.map((tool) => ({ name: tool.name, title: tool.title ?? '', owner: tool.owner ?? '' })))
/**
 * 〔批次77 任务3〕`/` 菜单要的技能清单：主进程运行时**真装载**的那一份
 * （`surfaceInfo().skills.catalog`，来源是 loadSkills）。整包拒装的那些不在这里——
 * 它们连方法都没有，摆进菜单就是一枚点了会报错的假项；拒装原因归设置里的技能库那一面（任务5）。
 */
const skillCatalog = computed(() => props.runtime?.surface?.skills?.catalog ?? [])
/**
 * 〔批次77 任务3〕键位表：宿主（AppNext）自己已经读过一份，但那份在壳层，
 * 对话框这块要的是同一张表而不是第二份硬编码——这里再读一次（同一条只读通道、同一份净化），
 * 读不到就退回默认表：快捷键是便利，不许因为它把对话卡住。
 */
const hotkeyBindings = ref(defaultBindings())
let hotkeySeq = 0
async function hydrateHotkeys(bridge = props.bridge) {
  const seq = ++hotkeySeq
  if (!bridge?.request) return
  try {
    const result = await bridge.request(IPC_CHANNELS.hotkeysLoad, {})
    if (seq !== hotkeySeq) return
    if (result?.ok && result.value?.bindings) {
      hotkeyBindings.value = normalizeHotkeys({ version: HOTKEYS_VERSION, bindings: result.value.bindings }).bindings
    }
  } catch {
    // 保持默认表：这一条不是数据真相来源。
  }
}
watch(() => props.bridge, (bridge) => { void hydrateHotkeys(bridge) }, { immediate: true })
/** 写模式是**会话真值**（M2.5-B）：徽章显示 store 里那一条，不是组件默认值。 */
const writeMode = computed(() => snapshot.value.writeMode ?? 'review')

function changeMode(next) {
  store.setWriteMode(next)
}

/** 上一问的原文与 omit：重试要一模一样地再问一次（引用摘要已经拼在原文里了）。 */
const lastQuestion = ref(null)

/* —— 运行过程事件（批次29） ——
 * 本轮提问的 askId 由渲染层生成、随载荷交上去：事件在回答之前就到，
 * 只有自己先知道号，才认得出哪条事件属于「这次 busy 期」。上一轮晚到的事件对不上号就丢。
 * 轨迹按 askId 分桶而不是只留一份：作者可以在 A 会话问完切到 B 再问，
 * 两问同时在途时各自的轨迹不能互相污染（上一版的单份 liveTrail 会把 B 的事件记进 A 的回答里）。 */
const DEFAULT_THINKING = '正在核对项目资料…'
/** 在途提问的轨迹：askId → events[]；回答落地时取出并删掉这一桶。 */
const pendingTrails = new Map()
/** 当前显示的那一问（busy 期阶段语只跟最新开的那一问）。 */
const liveTrail = ref([])
const liveAskId = ref('')
let askSeq = 0
let unsubscribeAskEvents = null

function onAskEvent(payload) {
  const askId = String(payload?.askId ?? '')
  const bucket = askId ? pendingTrails.get(askId) : null
  if (!bucket) return
  const event = sanitizeTrailEvent(stampArrival(payload?.event))
  if (!event) return
  bucket.push(event)
  if (bucket.length > MAX_TRAIL_EVENTS) bucket.splice(0, bucket.length - MAX_TRAIL_EVENTS)
  if (askId === liveAskId.value) liveTrail.value = bucket.slice()
}

/**
 * 〔批次77 任务4〕给事件盖上「外壳收到那一刻」的时间戳。
 * 口径要说得准：这一格量的是**外壳看到的首尾差**，主进程内部排队多久不算在里面——
 * 上游自己带了 `at` 就尊重上游的，不覆盖。渲染层拿不到主进程的时刻，所以只补这一种，
 * 别把它当端到端耗时读（工单记账指标里的「停止钮落盘毫秒数」用的也是同一个钟）。
 */
function stampArrival(event) {
  if (!event || typeof event !== 'object') return event
  if (Number.isFinite(Number(event.at))) return event
  return { ...event, at: Date.now() }
}

function bindAskEvents(bridge) {
  if (unsubscribeAskEvents) {
    unsubscribeAskEvents()
    unsubscribeAskEvents = null
  }
  unsubscribeAskEvents = typeof bridge?.onEvent === 'function'
    ? bridge.onEvent(IPC_PUSH.runtimeAskEvent, onAskEvent)
    : null
}

bindAskEvents(props.bridge)
watch(() => props.bridge, (bridge) => bindAskEvents(bridge))
onBeforeUnmount(() => {
  if (unsubscribeAskEvents) unsubscribeAskEvents()
  unsubscribeAskEvents = null
})

/** 开一问：新 askId（自带一个空轨迹桶）＋ 让阶段语跟着这一问走。 */
function beginAsk() {
  askSeq += 1
  const askId = `ask-${Date.now().toString(36)}-${askSeq.toString(36)}`
  pendingTrails.set(askId, [])
  liveAskId.value = askId
  liveTrail.value = []
  return askId
}

/** 收一问：把这桶轨迹定格取走（之后同 askId 的晚到事件找不到桶，直接丢）。 */
function finishAsk(askId) {
  const trail = (pendingTrails.get(askId) ?? []).slice()
  pendingTrails.delete(askId)
  return trail
}

/** busy 期那句语：只按最新一条真实事件换，没有事件就保持老版的固定语。 */
const thinkingText = computed(() => describeRuntimeProgress(liveTrail.value.at(-1)) || DEFAULT_THINKING)

/** 断点的人类说法：模型轮次带上是第几轮，别的阶段直接用阶段名。 */
function brokenStageText(trail, failed) {
  if (!failed) return ''
  if (failed.atStage === 'model-round') {
    const lastRound = [...trail].reverse().find((event) => event.stage === 'model-round')?.round
    if (lastRound) return `模型第 ${lastRound} 轮`
  }
  return trailStageLabel(failed.atStage)
}

/**
 * 在途请求计数：作者可以在 A 会话提问后切到 B 再问一句。
 * 每一问都把结果写回它出发的那个会话（append 的第二参），忙态则等最后一问落地才收。
 */
let inflight = 0
function beginWork() {
  inflight += 1
  store.setBusy(true)
}
function endWork() {
  inflight = Math.max(0, inflight - 1)
  if (!inflight) store.setBusy(false)
}

/**
 * 引用的读取口：走已有 runtimeToolCall，不新增通道。
 * 返回 { ok, value }／{ ok:false, message }——失败原因原样交给 resolveRefs 标进消息流。
 */
async function callTool(name, args) {
  if (!props.bridge?.request) return { ok: false, message: '渲染层未接主进程桥（preload 的 pinaxNext 通道）。' }
  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.runtimeToolCall, { tool: name, args })
  } catch (error) {
    return { ok: false, message: String(error?.message || error) }
  }
  if (!result?.ok) return { ok: false, message: result?.error?.message ?? `${name} 调用失败` }
  const payload = result.value?.payload ?? {}
  if (payload.ok === false) return { ok: false, message: payload.message ?? `${name} 被拒绝` }
  return { ok: true, value: payload }
}

/**
 * 提问入口。input 两种形状：
 *   '一句话'                            —— 老路径（兼容直接调用）
 *   { text, command }                   —— 对话框来的：command 是提示层选中那条（可能为 null）
 * 命令路由都在这里做：草稿自带命令词优先，其次才是提示层选中的那条。
 * 〔批次77 任务3〕技能 token 也在这里抽（不在对话框里）：对话框只负责把 `/技能名` 摆进草稿，
 * 「这一问用哪个方法」是发送那一刻从**正文**里认出来的——所以 `payload.skill` 只可能来自真打了的那一个 token，
 * 前端不替作者塞一个默认技能（工单：不硬塞）。
 */
async function ask(input) {
  const draft = String((typeof input === 'string' ? input : input?.text) ?? '').trim()
  const picked = typeof input === 'object' && input ? input.command ?? null : null
  if (!draft || busy.value || !canAsk.value) return

  const routed = resolveSlash(draft) ?? (picked ? { command: picked, rest: draft } : null)
  // 只敲了命令词就发：用模板本身当正文（否则这一问是空的）。
  const body = routed ? (routed.rest || routed.command.template) : draft
  // 只认「装载清单里真有的名字」；整包没装的那个名字不会被当技能（它会原样留在正文里）。
  const skillPick = extractSkillToken(body, skillNameList(skillCatalog.value))
  // 抽完什么都没了（作者只打了个技能 token）就退回原文：那还是一问，不许发一条空问句出去。
  const asked = skillPick.text || body
  const fields = routed
    ? slashMessageFields(routed.command, asked)
    : { text: asked, command: '', omit: [] }
  const skill = skillPick.skill || routed?.command?.skill || null

  // 这一问归哪个会话，此刻就定下：提问后作者换会话，晚到的回答不该落到新会话里。
  const sessionId = snapshot.value.activeId
  store.append({ id: '', role: 'user', text: fields.text, command: fields.command, at: formatClock(Date.now()) }, sessionId)
  beginWork()
  try {
    // 引用：token → 清单里的那一条 → 运行时只读工具取摘要（最多 4 条、每条前 600 字）。
    const refs = parseRefs(fields.text)
      .map((token) => ({ ...token, ...(matchReference(token.title, props.references) ?? {}) }))
    const resolved = refs.length ? await resolveRefs(refs, callTool) : []
    if (resolved.length) {
      const notes = resolved
        .filter((ref) => !ref.ok)
        .map((ref) => `（引用取不到：${referenceKindLabel(ref.kind)}《${ref.title}》 ${ref.note}）`)
      if (notes.length) store.updateLast({ notes }, sessionId)
    }

    await runQuestion(withRefs(fields.text, resolved), fields.omit, sessionId, skill)
  } finally {
    endWork()
  }
}

/** 真正发出去的那一下（重试也走这里）：只管请求与记录，忙态由调用方包住。 */
async function runQuestion(question, omit = [], sessionId = null, skill = null) {
  lastQuestion.value = { question, omit: Array.isArray(omit) ? [...omit] : [], sessionId, skill }
  const askId = beginAsk()
  // writeMode 每一问都带上：写策略在主进程现造，切了模式立刻生效，不靠缓存。
  const payload = { question, askId, writeMode: writeMode.value }
  // omit／skill 只在真有时才进载荷：没有剪裁与方法的提问保持老的 { question, askId } 形状。
  if (lastQuestion.value.omit.length) payload.context = { omit: lastQuestion.value.omit }
  if (skill) payload.skill = skill

  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.runtimeAsk, payload)
  } catch (error) {
    result = { ok: false, error: { message: String(error?.message || error) } }
  }

  // 这一问的轨迹在回答落地时定格：之后同 askId 的晚到事件不再改动这条回答。
  const trail = finishAsk(askId)

  if (result?.ok) {
    const value = result.value ?? {}
    const answer = value.result ?? null
    store.append({
      id: '',
      role: 'agent',
      text: value.text ?? '',
      findings: (answer?.issues ?? []).filter((item) => item && typeof item.message === 'string'),
      actions: (answer?.action ?? []).filter((item) => typeof item === 'string'),
      trail,
      at: formatClock(Date.now()),
      // 批次77 任务2：这一条是哪一轮跑出来的、这轮真报了多少 token。
      // usage 可能是 null（上游没回报／非工具循环那条链）——原样存 null，界面不替它编一个 0。
      runId: value.askId ?? '',
      usage: value.usage ?? null,
      // 批次77 任务3：被作者按停的那一问落 `stopped`，不是 completed。
      // 判据是**运行那条链的回执**（只有工具循环那条链观测得到轮次边界，才会回 stopped:true）；
      // 渲染层不因为「我点过停止」就先把这条改成已停——按了没停下来才是真的按下钮说谎。
      status: value.stopped ? 'stopped' : 'completed'
    }, sessionId)
    return
  }
  // 失败：把「走到哪一步断的」写进错误那行（失败是给人看的，不能只说「内核拒绝了」）。
  const broken = brokenStageText(trail, trail.find((event) => event.stage === 'failed'))
  const message = result?.error?.message ?? '内核拒绝了这一问。'
  store.append({
    id: '',
    role: 'agent',
    failed: true,
    status: 'error',
    text: broken ? `${message}（断在：${broken}）` : message,
    trail,
    at: formatClock(Date.now())
  }, sessionId)
}

/**
 * 〔批次77 任务3〕停止这一问：把「按 askId 标记取消」这条请求发给主进程，别的什么都不做。
 * 口径要说清两件事，否则这枚钮就是假的：
 *   1) 这里**不**改会话状态。真正收手发生在主进程那条工具循环的轮次边界上，
 *      它会把这一问以 `stopped:true` 答回来，消息那一条的 status 由回执落成 stopped（见 runQuestion）；
 *      正在跑的这一轮照常跑完，只是之后不再续轮。
 *   2) 请求发不出去（没桥／通道报错）就当没停成：不许界面先把「已停」画出来再等现实追上。
 */
async function stopAsk() {
  const askId = String(liveAskId.value ?? '')
  if (!askId || !busy.value || !canAsk.value) return
  try {
    await props.bridge.request(IPC_CHANNELS.runtimeAskAbort, { askId })
  } catch {
    // 停不停由那条在途的回答自己说：这里连「失败」都不许冒充成「已停止」。
  }
}

function retry() {
  const last = lastQuestion.value
  if (!last || busy.value || !canAsk.value) return
  // 去掉那条失败的回答重问一遍；提问那一行留在会话里（它已经问过了）。
  if (messages.value.at(-1)?.failed) store.dropLast()
  beginWork()
  // 重试发生在作者此刻看着的会话里：这条失败的回答就在这儿。
  void runQuestion(last.question, last.omit, snapshot.value.activeId, last.skill ?? null).finally(() => endWork())
}

/**
 * 编辑重发（批次77 任务2）：把这句问句回填输入框，并截掉这一条之后的历史。
 *
 * 乐观失效保护（抄 DeepWrite 那条）：调用方给的原文＋角色＋时间戳必须还能对上会话里那一条，
 * 对不上就一个字节都不动。理由很具体——动作条是 hover 才显形的，作者点下去的那一瞬间
 * 会话可能已经被另一问推进／被别的会话切换换过内容，拿一次过期点击去截现在是破坏。
 * 截断走 store.dropFrom 这一个入口（任务6 的「分支＝截断前先存一支」也接在同一处，不长第二套）。
 */
function editQuestion(payload) {
  if (busy.value || !canAsk.value) return
  const id = String(payload?.id ?? '')
  const target = messages.value.find((message) => message.id === id)
  if (!target) return
  if (target.role !== 'user') return
  if (target.text !== payload?.text || target.at !== payload?.at) return
  const sessionId = snapshot.value.activeId
  if (!store.dropFrom(id, sessionId)) return
  dialogRef.value?.setDraft?.(String(payload.text ?? ''))
}

/**
 * 分一支（批次77-R2 任务6）：工单那句「分支＝在截断前先存一支，给用户留退路」的两步走。
 *
 * 顺序不能反：branchFrom 拷的是**当前可见支**从这条往后的整段，dropFrom 之后就没了。
 * 两次动作都只走 store 的那一个历史入口（dropFrom 截、branchFrom 拷），界面上「编辑重发」和
 * 「分一支」因此共用同一套乐观失效保护——三要素（原文/时间戳/角色）对不上就一个字节都不动。
 * 分完不自动切到新支：作者改的是**这一问**，看得见的应该是重新长出来的那一支，
 * 退路留在 ‹ 2/3 › 里随时回得去（切支只动指针，见 cycleBranch）。
 */
function branchQuestion(payload) {
  if (busy.value || !canAsk.value) return
  const id = String(payload?.id ?? '')
  const target = messages.value.find((message) => message.id === id)
  if (!target) return
  if (target.role !== 'user') return
  if (target.text !== payload?.text || target.at !== payload?.at) return
  const sessionId = snapshot.value.activeId
  if (!store.branchFrom(id, sessionId)) return
  if (!store.dropFrom(id, sessionId)) return
  dialogRef.value?.setDraft?.(String(payload.text ?? ''))
}

/** ‹ › 切支：只动那一条会话元数据里的当前支指针，两支的消息一个字都不改（口径见 store.cycleBranch）。 */
function switchBranch(payload) {
  store.cycleBranch(String(payload?.id ?? ''), Number(payload?.step) || 0, snapshot.value.activeId)
}

/**
 * 重新生成（批次77 任务2）：最后一条回答用同一个问题再跑一轮。
 *
 * 只对最后一条开（界面上那枚钮也是这么禁的）：换掉中间某一条＝把后面的历史丢掉。
 * 〔批次77-R2 任务6〕消息树已经长出来了，但「重跑中间这一条」仍不开这个口子——
 * 想要退路就在那句问句上按「分一支」，那才是把后面历史保住的正路；这里的再生成是**就地替换**，
 * 走 dropLast 一条路径，不碰任何一支的内容与指针。
 * 问题原文优先用本轮记住的那一问（omit／skill 都在里面）；重开窗口后内存清了，
 * 就退回用会话里那条问句原文再问一次——slash 剪裁与引用摘要不再重放，这一条如实记账。
 */
function regenerateAnswer(payload) {
  if (busy.value || !canAsk.value) return
  const list = messages.value
  const index = list.findIndex((message) => message.id === String(payload?.id ?? ''))
  if (index < 0 || index !== list.length - 1) return
  const question = [...list.slice(0, index)].reverse().find((message) => message.role === 'user')
  if (!question) return
  const sessionId = snapshot.value.activeId
  const remembered = lastQuestion.value
  const reuse = remembered && String(remembered.question ?? '').includes(question.text) ? remembered : null
  store.dropLast(sessionId)
  beginWork()
  if (reuse) {
    void runQuestion(reuse.question, reuse.omit, sessionId, reuse.skill ?? null).finally(() => endWork())
    return
  }
  void runQuestion(question.text, [], sessionId, null).finally(() => endWork())
}

function newSession() {
  store.create()
}

function switchSession(id) {
  store.switchTo(id)
}

function renameSession(payload) {
  store.rename(payload?.id, payload?.title)
}

function removeSession(id) {
  store.remove(id)
}
</script>

<template>
  <aside class="dock" aria-label="Agent 对话">
    <AssistantDialog
      ref="dialogRef"
      :messages="messages"
      :busy="busy"
      :disabled="!canAsk"
      :title="runtime.title"
      :thinking="thinkingText"
      :live-trail="liveTrail"
      :tools="tools"
      :mode="writeMode"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :references="references"
      :skills="skillCatalog"
      :hotkeys="hotkeyBindings"
      :suspend-esc="suspendEsc"
      @send="ask"
      @retry="retry"
      @stop="stopAsk"
      @edit="editQuestion"
      @branch="branchQuestion"
      @switch-branch="switchBranch"
      @regenerate="regenerateAnswer"
      @update:mode="changeMode"
      @new-session="newSession"
      @switch-session="switchSession"
      @rename-session="renameSession"
      @remove-session="removeSession"
    />
    <p v-if="!canAsk" class="dock-hint">渲染层未接主进程桥（preload 的 pinaxNext 通道）。</p>
    <p v-if="migrationNotice" class="dock-hint dock-hint--warn">{{ migrationNotice }}</p>
  </aside>
</template>
