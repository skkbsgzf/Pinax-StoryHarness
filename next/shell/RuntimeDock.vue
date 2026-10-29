<script setup>
import { computed, ref, watch } from 'vue'
import AssistantDialog from './AssistantDialog.vue'
import { IPC_CHANNELS } from './ipcContract.mjs'
import { createSessionStore, formatClock } from './agentSessions.mjs'
import { resolveSlash, slashMessageFields } from './slashCommands.mjs'
import { matchReference, parseRefs, referenceKindLabel, resolveRefs, withRefs } from './agentReferences.mjs'

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
const snapshot = ref(store.snapshot())

/** store 是纯数据模块（node:test 直接测），快照经订阅进 ref——与 paneForms 的宿主同一套。 */
function bindStore(projectRoot) {
  if (unsubscribe) unsubscribe()
  store = createSessionStore(projectRoot)
  snapshot.value = store.snapshot()
  unsubscribe = store.subscribe((next) => { snapshot.value = next })
}
bindStore(props.projectRoot)
watch(() => props.projectRoot, (root) => bindStore(root))

const messages = computed(() => snapshot.value.messages)
const sessions = computed(() => snapshot.value.sessions)
const activeSessionId = computed(() => snapshot.value.activeId)
const busy = computed(() => snapshot.value.busy)
const canAsk = computed(() => Boolean(props.bridge?.request))
const tools = computed(() => props.runtime.tools.map((tool) => ({ name: tool.name })))

/** 上一问的原文与 omit：重试要一模一样地再问一次（引用摘要已经拼在原文里了）。 */
const lastQuestion = ref(null)

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
 */
async function ask(input) {
  const draft = String((typeof input === 'string' ? input : input?.text) ?? '').trim()
  const picked = typeof input === 'object' && input ? input.command ?? null : null
  if (!draft || busy.value || !canAsk.value) return

  const routed = resolveSlash(draft) ?? (picked ? { command: picked, rest: draft } : null)
  // 只敲了命令词就发：用模板本身当正文（否则这一问是空的）。
  const body = routed ? (routed.rest || routed.command.template) : draft
  const fields = routed
    ? slashMessageFields(routed.command, body)
    : { text: body, command: '', omit: [] }

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

    await runQuestion(withRefs(fields.text, resolved), fields.omit, sessionId)
  } finally {
    endWork()
  }
}

/** 真正发出去的那一下（重试也走这里）：只管请求与记录，忙态由调用方包住。 */
async function runQuestion(question, omit = [], sessionId = null) {
  lastQuestion.value = { question, omit: Array.isArray(omit) ? [...omit] : [], sessionId }
  const payload = { question }
  // omit 只在真的有条目时才进载荷：没有剪裁的提问保持老的 { question } 形状。
  if (lastQuestion.value.omit.length) payload.context = { omit: lastQuestion.value.omit }

  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.runtimeAsk, payload)
  } catch (error) {
    result = { ok: false, error: { message: String(error?.message || error) } }
  }

  if (result?.ok) {
    const value = result.value ?? {}
    const answer = value.result ?? null
    store.append({
      id: '',
      role: 'agent',
      text: value.text ?? '',
      findings: (answer?.issues ?? []).filter((item) => item && typeof item.message === 'string'),
      actions: (answer?.action ?? []).filter((item) => typeof item === 'string'),
      at: formatClock(Date.now())
    }, sessionId)
    return
  }
  store.append({
    id: '',
    role: 'agent',
    failed: true,
    text: result?.error?.message ?? '内核拒绝了这一问。',
    at: formatClock(Date.now())
  }, sessionId)
}

function retry() {
  const last = lastQuestion.value
  if (!last || busy.value || !canAsk.value) return
  // 去掉那条失败的回答重问一遍；提问那一行留在会话里（它已经问过了）。
  if (messages.value.at(-1)?.failed) store.dropLast()
  beginWork()
  // 重试发生在作者此刻看着的会话里：这条失败的回答就在这儿。
  void runQuestion(last.question, last.omit, snapshot.value.activeId).finally(() => endWork())
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
      :messages="messages"
      :busy="busy"
      :disabled="!canAsk"
      :title="runtime.title"
      :tools="tools"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :references="references"
      :suspend-esc="suspendEsc"
      @send="ask"
      @retry="retry"
      @new-session="newSession"
      @switch-session="switchSession"
      @rename-session="renameSession"
      @remove-session="removeSession"
    />
    <p v-if="!canAsk" class="dock-hint">渲染层未接主进程桥（preload 的 pinaxNext 通道）。</p>
  </aside>
</template>
