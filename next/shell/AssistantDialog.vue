<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { SLASH_COMMANDS } from './slashCommands.mjs'
import { REFERENCE_KIND_LABELS, REFERENCE_KIND_ORDER } from './agentReferences.mjs'
import {
  applyComposerToken,
  buildComposerMenu,
  detectComposerToken
} from './composerTypeahead.mjs'
import {
  CHAT_HOTKEY_IDS,
  HOTKEY_CHAT_MODE,
  HOTKEY_CHAT_OPEN,
  HOTKEY_CHAT_SEND,
  HOTKEY_CHAT_STOP,
  HOTKEY_SKILL_MENU,
  matchHotkey
} from './hotkeys.mjs'
import { formatRelativeTime, messageStatus } from './agentSessions.mjs'
import { buildTimelineBlocks, timelinePath } from './conversationTimeline.mjs'
import ConversationTimeline from './ConversationTimeline.vue'
import { renderMarkdown } from './mdRender.mjs'

/**
 * Agent 对话框：从老前端的作品资料助手抽出来的纯会话面。
 *
 * 抽象自 src/components/authoring/AuthoringKnowledgeAssistant.vue（老版真在用的那块问答面板）。
 * 老版有一条规矩原样搬过来：开发者向的事实——工具调用、思考过程、权限、出处、预算——
 * 一律折进折叠的 details，屏上只留「问—答—再问」这一条主线。
 * 于是右栏是一个对话框，不是一份运行时说明书。
 *
 * 类名沿用老版的 authoring-knowledge__* 词汇，度量也沿用老版默认态的数值：
 * 老版把它们做成了 --assistant-* 自定义属性，这里直接落成字面量——
 * 外壳没有 expanded 变体，少一层变量就少一处漂移。
 *
 * 与老版唯一的差别：多了审稿意见／可执行动作两块（模型答的是结构化审稿，
 * 那两块是内容不是备注，摊开是应该的），以及把「工具面」收成底部一个折叠层。
 *
 * 批次27 加的三件（作者原话「底部输入框的 / 弹出 skill，@ 弹出参考」＋「需要有会话管理」）：
 *   - 工具栏「会话」按钮 → 轻量弹层（列表／新建／切换／双击改名／✕ 删除）；
 *   - `/` 提示从「只显示」升级为可点/可 Enter 选中，选中把模板填进草稿（命令词不留在草稿里）；
 *   - `@` 弹层按类列出当前项目内容，点一条把 @《标题》 插进光标处。
 * 本组件不做命令路由与引用解析（那是 RuntimeDock 的事）：它只把草稿与选中的命令交上去。
 */
const props = defineProps({
  /** 会话面：[{ id, role:'user'|'agent', text, findings:[], actions:[], command, notes:[], failed:boolean, at:string }] */
  messages: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  /** busy 期那一行字：外壳按最新一条真实运行事件换（没有事件时是固定语）。 */
  thinking: { type: String, default: '正在核对项目资料…' },
  /**
   * 〔批次77 任务4〕**正在跑的这一问**的运行事件（还没定格的轨迹）。
   * 回答落地后它会被定格进 message.trail，这里就空了——所以这块只在 busy 期出，平铺不折叠：
   * 作者正盯着它跑，再套一层「点开才看得见」等于没做。
   */
  liveTrail: { type: Array, default: () => [] },
  /** 没有桥（渲染层没接主进程）时为真：输入框禁用。 */
  disabled: { type: Boolean, default: false },
  title: { type: String, default: 'Pi-Agent' },
  placeholder: { type: String, default: '就当前项目问一句话…' },
  /** 折叠层的工具名清单（默认不展开）。 */
  tools: { type: Array, default: () => [] },
  /** 当前模式：review（提案制）或 auto（直写）。 */
  mode: { type: String, default: 'review' },
  /** 会话列表摘要：[{ id, title, updatedAt, messageCount }]（agentSessions.list()）。 */
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: String, default: '' },
  /** @ 引用清单：[{ kind, title, path }]，由外壳从 board data 组一份传下来。 */
  references: { type: Array, default: () => [] },
  /** 统一二级页开着时为 true：Esc 先归它（照 FloatingWidget 的 suspendEsc 先例）。 */
  suspendEsc: { type: Boolean, default: false }
})
const emit = defineEmits(['send', 'retry', 'update:mode', 'new-session', 'switch-session', 'rename-session', 'remove-session', 'edit', 'regenerate'])

const draft = ref('')
const threadRef = ref(null)
const textareaRef = ref(null)
const sessionRoot = ref(null)
const mode = computed(() => props.mode)

/**
 * 切到 auto 需要一次显式确认（M2.5-B）：这是「AI 产出直接写正文」的那一档，
 * 一次误点不该把后面所有提问都改成直写。review 回退不需要确认——回到更安全的档位永远允许。
 */
const pendingAuto = ref(false)
const modeLabel = computed(() => ({ review: '审阅', auto: '自动', blocked: '锁定' }[props.mode] ?? '审阅'))
watch(() => props.mode, () => { pendingAuto.value = false })

function requestMode() {
  if (props.mode === 'auto') {
    pendingAuto.value = false
    emit('update:mode', 'review')
    return
  }
  pendingAuto.value = true
}

function confirmAuto() {
  pendingAuto.value = false
  emit('update:mode', 'auto')
}

function cancelAuto() {
  pendingAuto.value = false
}

/**
 * 从提示层选中的命令：作者可能在模板上继续改，所以它不写进草稿（命令词本身不留在草稿里），
 * 只在提交时随草稿一起交给 RuntimeDock 做路由；草稿被清空就作废（那是新的一问）。
 */
const pendingCommand = ref(null)

/* —— / 命令提示：可点、可 Enter 选中 —— */
const slashCommands = SLASH_COMMANDS
const slashClosed = ref(false)
const slashIndex = ref(0)
const slashOpen = computed(() => !slashClosed.value && !refOpen.value && isSlashDraft(draft.value))

/* —— @ 引用弹层 —— */
const MAX_REFERENCE_PER_KIND = 8
const refOpen = ref(false)
const refQuery = ref('')
const refIndex = ref(0)
const referenceGroups = computed(() => {
  const query = refQuery.value.trim()
  const groups = []
  for (const kind of REFERENCE_KIND_ORDER) {
    const items = (props.references ?? [])
      .filter((item) => item?.kind === kind)
      .filter((item) => item?.title && (!query || String(item.title).includes(query)))
      .slice(0, MAX_REFERENCE_PER_KIND)
    if (items.length) groups.push({ kind, label: referenceKindLabel(kind), items })
  }
  return groups
})
const referenceOptions = computed(() => referenceGroups.value.flatMap((group) => group.items))

/* —— 会话弹层 —— */
const sessionOpen = ref(false)
const renamingId = ref(null)
const renameDraft = ref('')

function submit() {
  const text = draft.value.trim()
  if (!text || props.busy || props.disabled) return
  emit('send', { text, command: pendingCommand.value })
  draft.value = ''
  pendingCommand.value = null
  slashClosed.value = false
  refOpen.value = false
}

/** 老版的口径：Enter 发送，Shift+Enter 换行，中文输入法组字时不抢键。
 *  229 是老 Chromium 在组字期把 keyCode 打成占位值的那条兜底——Safari／旧 Electron 上
 *  event.isComposing 有时是 false 但 keyCode 仍是 229，只判前半个就会把「还没选完的字」当发送按出去。
 *  老前端 8 处同一口径（如 src/components/authoring/AuthoringBlockComposer.vue:202、
 *  AuthoringManuscriptImport.vue:451、AuthoringRehearsalPanel.vue:93），这里照抄不发明。 */
function onKeydown(event) {
  if (event.isComposing || event.keyCode === 229) return
  if (slashOpen.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      slashIndex.value = (slashIndex.value + step + slashCommands.length) % slashCommands.length
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      pickSlash(slashCommands[slashIndex.value])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      slashClosed.value = true
      return
    }
  }
  if (refOpen.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const total = referenceOptions.value.length
      if (!total) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      refIndex.value = (refIndex.value + step + total) % total
      return
    }
    if (event.key === 'Enter') {
      const item = referenceOptions.value[refIndex.value]
      if (!item) return
      event.preventDefault()
      insertReference(item)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      refOpen.value = false
      return
    }
  }
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submit()
}

/** 选中命令：模板填进草稿，命令词不留在草稿里（路由靠 pendingCommand 带过去）。 */
function pickSlash(command) {
  if (!command) return
  pendingCommand.value = command
  draft.value = command.template
  slashClosed.value = true
  nextTick(() => textareaRef.value?.focus?.())
}

/** 每次键入都重算 @ 触发：光标前最后一个 token 形如 `@query` 才弹；敲到空白外就收。 */
function onInput() {
  if (!draft.value.trim()) pendingCommand.value = null
  // 上一轮 Esc 关掉的提示，重新打字就再给一次机会（Esc 只管那一下）。
  slashClosed.value = false
  updateRefMenu()
}

function updateRefMenu() {
  const element = textareaRef.value
  const caret = element?.selectionStart ?? draft.value.length
  const before = draft.value.slice(0, caret)
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(before)
  if (!match) {
    refOpen.value = false
    refQuery.value = ''
    return
  }
  refOpen.value = true
  refQuery.value = match[1] ?? ''
  refIndex.value = 0
}

/** 把 @《标题》 插进光标处，替换掉正在输入的 `@query`。 */
function insertReference(item) {
  const element = textareaRef.value
  const value = draft.value
  const caret = element?.selectionStart ?? value.length
  const before = value.slice(0, caret)
  const after = value.slice(caret)
  const token = `@《${item.title}》`
  const start = Math.max(0, before.length - refQuery.value.length - 1)
  const head = value.slice(0, start)
  draft.value = `${head}${token} ${after.replace(/^\s*/u, '')}`
  refOpen.value = false
  refQuery.value = ''
  const position = head.length + token.length + 1
  nextTick(() => {
    element?.focus?.()
    element?.setSelectionRange?.(position, position)
  })
}

function toggleSessions() {
  sessionOpen.value = !sessionOpen.value
  renamingId.value = null
}

function startRename(session) {
  renamingId.value = session.id
  renameDraft.value = session.title
  nextTick(() => {
    const input = sessionRoot.value?.querySelector?.('.authoring-knowledge__session-rename')
    input?.focus?.()
    input?.select?.()
  })
}

function commitRename() {
  const id = renamingId.value
  const title = renameDraft.value.trim()
  renamingId.value = null
  if (id && title) emit('rename-session', { id, title })
}

function cancelRename() {
  renamingId.value = null
}

function relativeTime(timestamp) {
  return formatRelativeTime(timestamp, Date.now())
}

/**
 * 〔批次77 任务4〕每条回答的运行块序列。判定与归组全在 `conversationTimeline.mjs`（纯函数、node:test 直测），
 * 这里只做一次「按折叠层键索引」的映射：Vue 的 computed 在 messages 没换引用前不重算，
 * 比自建缓存少一处「什么时候作废」要操心（轨迹在回答落地时定格，定格之后不再变）。
 */
const timelines = computed(() => {
  const map = new Map()
  for (const message of (Array.isArray(props.messages) ? props.messages : [])) {
    map.set(timelinePath(message?.id), buildTimelineBlocks(message?.trail))
  }
  return map
})

/** 在途那一问：streaming=true，最后一块没有终态事件就报「正在」，不许替它宣布完成。 */
const liveTimeline = computed(() => buildTimelineBlocks(props.liveTrail, { streaming: true }))

/**
 * 助手消息的正文（批次77 任务1）：走的是与阅读面同一条 mdRender（`mdRender.mjs` 的
 * `renderMarkdown`，marked＋DOMPurify／无 DOM 时走 fallbackSanitize），不在本组件里再拼一套
 * ——守卫⑥「正文渲染单一来源」钉的就是这件事。
 * 用户消息**不**走这里：作者输入的 `**字**` 必须原样是他打的那几个字，不然复制回去就变了味。
 */
function answerHtml(text) {
  return renderMarkdown(String(text ?? ''))
}

/**
 * 正文里的链接（批次77 任务1 附带）：md 一旦渲染成 HTML，`[官网](https://…)` 就是真 <a>。
 * 外壳只装了 `setWindowOpenHandler`（主进程 main.mjs:358，拦新窗口改交系统浏览器），
 * 没有 `will-navigate`——也就是说**同标签**点一下链接会把整个外壳导航掉，一轮会话没了。
 * 所以这里一律拦下默认行为，再把 URL 走 `window.open`：那条通路正好落在已有的
 * openExternal handler 上，作者看到的是系统浏览器，窗口留在原地。
 * 相对链接／页内锚点不开窗（open 它会得到一个无意义的地址），只拦默认行为。
 */
function onAnswerClick(event) {
  const anchor = event.target?.closest?.('a[href]')
  if (!anchor) return
  event.preventDefault()
  const url = String(anchor.getAttribute('href') ?? '').trim()
  if (!/^(?:https?:|mailto:)/i.test(url)) return
  if (typeof globalThis.window?.open !== 'function') return
  globalThis.window.open(url, '_blank', 'noopener,noreferrer')
}

/* —— 消息行上的元信息与动作件（批次77 任务2） ——————————————————————————————
 * 口径抄 DeepWrite：常驻的只有「谁·几点·这一条现在的状态」，动作条 hover／键盘聚焦才显形，
 * 且**预留高度**（min-height）——显形时不许把下面的内容顶一下（跳版＝最廉价的抖动）。
 */

/** 状态那一格的中文字（闭集在 agentSessions.MESSAGE_STATUSES，读判只在 messageStatus 一处）。 */
const STATUS_LABELS = { streaming: '正在写', completed: '已完成', stopped: '已停', error: '出错' }

/** 原始状态值（进 data-status，样式按这一格分色）。判读只走 agentSessions 的 messageStatus 一处。 */
function statusOf(message) {
  return messageStatus(message)
}

function statusLabel(message) {
  return STATUS_LABELS[messageStatus(message)] ?? '已完成'
}

/**
 * token chip（守卫⑦）：上游真回报才有数；没有就是那六个字「本轮未回报用量」。
 * 这里没有任何换算——字数不是 token，缺回报时也不许落一个 0 冒充测过。
 */
function usageText(message) {
  const usage = message?.usage
  if (!usage) return '本轮未回报用量'
  return `${usage.input} in／${usage.output} out`
}

/** 会话级用量指示（输入区右上）：取最近一条**真带 usage** 的助手消息，没有就不画这一格。 */
const sessionUsage = computed(() => {
  const list = Array.isArray(props.messages) ? props.messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (message?.role === 'agent' && message.usage) return message.usage
  }
  return null
})

const copiedId = ref('')
let copyTimer = null

/**
 * 复制这一条原文：图标转 check 1.5 秒，aria-label 同步变「已复制」。
 * 剪贴板不可用／被拒时什么都不假装——不变形、不许「看起来复制成功了」。
 */
function copyMessage(message) {
  const writeText = globalThis.navigator?.clipboard?.writeText
  if (typeof writeText !== 'function') return
  writeText.call(globalThis.navigator.clipboard, String(message?.text ?? '')).then(() => {
    copiedId.value = String(message?.id ?? '')
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copiedId.value = ''
      copyTimer = null
    }, 1500)
  }, () => {
    // 失败留在原地：这一条没被改动，动作条下次还能再点（不弹假提示）。
  })
}

/* 过程折叠层的展开态：**只在组件内存里**（〔批次77 任务4〕守卫⑨——折叠态不进 store、不落 JSONL，
   会话换回来是同一份内存，重开外壳回缺省「收起」）。
   键用 timelinePath（`<messageId>#trail`）而不是裸 message.id：以后一条消息要挂好几层可折叠的东西
   （思维链／子代理明细），键空间先留出，别到时候改一半留一半。
   动作条那个钮与原生 summary 走同一个 details.open，@toggle 是唯一同步口——两条路都点都不会说谎。 */
const trailOpen = ref({})

function onTimelineToggle(path, open) {
  trailOpen.value = { ...trailOpen.value, [String(path)]: Boolean(open) }
}

function isOpen(path) {
  return Boolean(trailOpen.value[timelinePath(path)])
}

/**
 * 钮只管「把那一层翻开/合上」：改 details.open，并把手上的这一次状态同时记进 Map。
 * 为什么两条路都要写——真浏览器里改 `open` 会补发一个 toggle 事件（那时 @toggle 口会再写一次同样的值，幂等），
 * 但 jsdom 不发这一枪：只靠 DOM 事件，钮点完 aria-label 还说「展开过程」，等于界面在说谎。
 */
function toggleTrail(message, event) {
  const host = event?.currentTarget?.closest?.('article')
  const details = host?.querySelector?.('details.authoring-knowledge__trail')
  if (!details) return
  const nextOpen = !details.open
  details.open = nextOpen
  trailOpen.value = { ...trailOpen.value, [timelinePath(message?.id)]: nextOpen }
}

/** 编辑重发：把这一条问句交回宿主（回填输入框＋截断之后的历史由 RuntimeDock 做，那里才有 store）。 */
function editQuestion(message) {
  emit('edit', { id: message.id, text: message.text, at: message.at })
}

/** 重新生成：只对最后一条回答开（把中间的某一条换掉＝把后面的历史弄丢，本批不做）。 */
function regenerate(message) {
  emit('regenerate', { id: message.id })
}

/** 宿主回填输入框用（编辑重发）：不新开一条通道，直接改草稿。 */
function setDraft(text) {
  draft.value = String(text ?? '')
  pendingCommand.value = null
  nextTick(() => textareaRef.value?.focus?.())
}

defineExpose({ setDraft })

/** Esc：会话弹层先收（统一二级页开着时让位，照 FloatingWidget 的 suspendEsc）。 */
function onDocumentKeydown(event) {
  if (event.key !== 'Escape' || props.suspendEsc) return
  if (!sessionOpen.value) return
  event.preventDefault()
  sessionOpen.value = false
  renamingId.value = null
}

/** 点会话弹层外面收起（按钮自己 toggle，不参与这条）。 */
function onDocumentPointerDown(event) {
  if (!sessionOpen.value) return
  if (sessionRoot.value?.contains?.(event.target)) return
  sessionOpen.value = false
  renamingId.value = null
}

watch(() => props.messages.length, async () => {
  await nextTick()
  if (threadRef.value) threadRef.value.scrollTop = threadRef.value.scrollHeight
}, { immediate: true })

watch(slashOpen, (open) => {
  if (open) slashIndex.value = 0
})

watch(referenceOptions, () => {
  refIndex.value = 0
})

onMounted(() => {
  globalThis.document?.addEventListener?.('keydown', onDocumentKeydown)
  globalThis.document?.addEventListener?.('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  globalThis.document?.removeEventListener?.('keydown', onDocumentKeydown)
  globalThis.document?.removeEventListener?.('pointerdown', onDocumentPointerDown)
  // 复制图标那 1.5 秒的回位定时器：组件走了就不能再改响应式状态。
  if (copyTimer) {
    clearTimeout(copyTimer)
    copyTimer = null
  }
})
</script>

<template>
  <section class="authoring-knowledge" :class="{ 'is-starting': !messages.length }" aria-label="Pi-Agent 对话">
    <header ref="sessionRoot" class="authoring-knowledge__toolbar">
      <div class="authoring-knowledge__toolbar-primary">
        <div class="authoring-knowledge__model">
          <strong>{{ title }}</strong>
        </div>
      </div>
      <div class="authoring-knowledge__toolbar-actions">
        <button
          type="button"
          class="authoring-knowledge__session-btn"
          :class="{ 'is-open': sessionOpen }"
          :aria-expanded="sessionOpen.toString()"
          title="会话：切换／新建／改名／删除"
          @click="toggleSessions"
        >会话<span class="authoring-knowledge__session-count">{{ sessions.length }}</span></button>
        <button
          type="button"
          class="authoring-knowledge__mode-badge"
          :class="mode === 'review' ? 'is-review' : 'is-auto'"
          :title="mode === 'review' ? '审阅模式：AI 产出走提案，确认后才落盘' : '自动模式：AI 产出直接写入（慎用）'"
          :aria-pressed="pendingAuto.toString()"
          @click="requestMode"
        >{{ modeLabel }}</button>
      </div>

      <div v-if="sessionOpen" class="authoring-knowledge__sessions" role="dialog" aria-label="会话列表">
        <button type="button" class="authoring-knowledge__session-new" @click="emit('new-session')">＋ 新建会话</button>
        <ul class="authoring-knowledge__session-list">
          <li
            v-for="session in sessions"
            :key="session.id"
            class="authoring-knowledge__session-row"
            :class="{ 'is-active': session.id === activeSessionId }"
          >
            <input
              v-if="renamingId === session.id"
              v-model="renameDraft"
              class="authoring-knowledge__session-rename"
              aria-label="会话标题"
              @keydown.enter.prevent="commitRename"
              @keydown.esc.prevent.stop="cancelRename"
              @blur="commitRename"
            />
            <template v-else>
              <button
                type="button"
                class="authoring-knowledge__session-item"
                :aria-current="session.id === activeSessionId ? 'true' : undefined"
                @click="emit('switch-session', session.id)"
                @dblclick="startRename(session)"
              >
                <span class="authoring-knowledge__session-title">{{ session.title }}</span>
                <span class="authoring-knowledge__session-time">{{ relativeTime(session.updatedAt) }} · {{ session.messageCount }} 条</span>
              </button>
              <button
                type="button"
                class="authoring-knowledge__session-remove"
                :aria-label="`删除会话 ${session.title}`"
                title="删除会话"
                @click.stop="emit('remove-session', session.id)"
              >✕</button>
            </template>
          </li>
        </ul>
      </div>
    </header>

    <div v-if="pendingAuto" class="authoring-knowledge__mode-confirm" role="alertdialog" aria-label="切换到自动模式">
      <span class="authoring-knowledge__mode-confirm-text">自动模式下，AI 的产出会直接写入正文，不再走提案。只对当前项目生效。</span>
      <button type="button" class="authoring-knowledge__mode-confirm-ok" @click="confirmAuto">确认切换</button>
      <button type="button" class="authoring-knowledge__mode-confirm-cancel" @click="cancelAuto">取消</button>
    </div>

    <div class="authoring-knowledge__body">
      <div v-if="!messages.length" class="authoring-knowledge__intro">
        <h3>接下来，想写什么？</h3>
      </div>

      <div ref="threadRef" class="authoring-knowledge__thread" aria-live="polite">
        <template v-for="(message, messageIndex) in messages" :key="message.id">
          <div v-if="message.role === 'user'" class="authoring-knowledge__question-row" :data-message-id="message.id">
            <!-- 批次77 任务2：问句这行的动作件（时间戳＋复制＋编辑重发）平时不占视线，
                 hover／键盘聚焦才显形；位置常驻（min-height 预留），显形不许把气泡顶跳。 -->
            <div class="authoring-knowledge__row-actions">
              <time v-if="message.at" class="authoring-knowledge__row-time">{{ message.at }}</time>
              <button
                type="button"
                class="authoring-knowledge__row-btn"
                data-test="question-copy"
                :aria-label="copiedId === String(message.id) ? '已复制' : '复制这句提问'"
                :title="copiedId === String(message.id) ? '已复制' : '复制这句提问'"
                @click="copyMessage(message)"
              ><WorkbenchIcon :name="copiedId === String(message.id) ? 'check' : 'copy'" :size="13" /></button>
              <button
                type="button"
                class="authoring-knowledge__row-btn"
                data-test="question-edit"
                :disabled="disabled || busy"
                aria-label="编辑重发"
                title="编辑重发（这条之后的历史会截断）"
                @click="editQuestion(message)"
              ><WorkbenchIcon name="pencil" :size="13" /></button>
            </div>
            <div class="authoring-knowledge__question">
              <p>
                <span v-if="message.command" class="authoring-knowledge__command-badge">{{ message.command }}</span>{{ message.text }}
              </p>
              <p
                v-for="note in message.notes"
                :key="note"
                class="authoring-knowledge__question-note"
              >{{ note }}</p>
            </div>
          </div>
          <article v-else class="authoring-knowledge__answer">
            <div class="authoring-knowledge__answer-meta">
              <span>助手</span>
              <time v-if="message.at">{{ message.at }}</time>
              <!-- 批次77 任务2：这一条现在的状态（流中／完成／被停／出错）。读判只在 messageStatus 一处，
                   老的 failed 布尔还在，兼容期两种写法都能出同一个字。 -->
              <span class="authoring-knowledge__answer-status" :data-status="statusOf(message)">{{ statusLabel(message) }}</span>
            </div>
            <div v-if="message.failed" class="authoring-knowledge__error" role="alert">
              <span>{{ message.text }}</span>
              <button type="button" class="authoring-knowledge__error-retry" @click="emit('retry')">重试</button>
            </div>
            <template v-else>
              <div
                class="authoring-knowledge__answer-text authoring-knowledge__markdown nx-rendered-md"
                @click="onAnswerClick"
                v-html="answerHtml(message.text)"
              ></div>
              <div v-if="message.findings?.length" class="authoring-knowledge__findings">
                <p class="authoring-knowledge__findings-label">审稿意见</p>
                <ul class="authoring-knowledge__findings-list">
                  <li v-for="(item, index) in message.findings" :key="`f-${index}`">
                    <span v-if="item.severity" class="authoring-knowledge__findings-sev">{{ item.severity }}</span>{{ item.message }}
                  </li>
                </ul>
              </div>
              <div v-if="message.actions?.length" class="authoring-knowledge__actions">
                <p class="authoring-knowledge__findings-label">可执行动作</p>
                <ul class="authoring-knowledge__findings-list">
                  <li v-for="(item, index) in message.actions" :key="`a-${index}`">{{ item }}</li>
                </ul>
              </div>
            </template>
            <!-- 批次77 任务2：回答这行的动作条（复制／展开过程／重新生成／token chip）。
                 「分支」不在这里——它要等任务6 的消息树一起长出来，先摆一枚点不动的钮正是本批要消灭的东西。 -->
            <div class="authoring-knowledge__row-actions authoring-knowledge__row-actions--answer" data-test="answer-actions">
              <button
                type="button"
                class="authoring-knowledge__row-btn"
                data-test="answer-copy"
                :aria-label="copiedId === String(message.id) ? '已复制' : '复制这条回答'"
                :title="copiedId === String(message.id) ? '已复制' : '复制这条回答'"
                @click="copyMessage(message)"
              ><WorkbenchIcon :name="copiedId === String(message.id) ? 'check' : 'copy'" :size="13" /></button>
              <button
                v-if="message.trail?.length"
                type="button"
                class="authoring-knowledge__row-btn"
                data-test="answer-trail-toggle"
                :aria-label="isOpen(message.id) ? '收起过程' : '展开过程'"
                :title="isOpen(message.id) ? '收起这一问的运行过程' : '展开这一问的运行过程'"
                @click="toggleTrail(message, $event)"
              ><WorkbenchIcon name="list" :size="13" /></button>
              <button
                v-if="!message.failed"
                type="button"
                class="authoring-knowledge__row-btn"
                data-test="answer-regenerate"
                :disabled="disabled || busy || messageIndex !== messages.length - 1"
                :title="messageIndex !== messages.length - 1 ? '只有最后一条回答能重新生成（换中间那条会把后面的历史弄丢，分支还没做）' : '用同一个问题再生成一次'"
                aria-label="重新生成"
                @click="regenerate(message)"
              ><WorkbenchIcon name="refresh" :size="13" /></button>
              <span class="authoring-knowledge__usage" data-test="usage-chip" :title="message.usage ? '本轮模型回报的用量' : '上游这一轮没有回报用量'">{{ usageText(message) }}</span>
            </div>
            <!-- 批次29 起这一层就叫「过程」；〔批次77 任务4〕把它从「一叠事件行」升级成「运行块时间线」：
                 五类块（梳理上下文／给出回答／调用的工具／只读并组／子代理）＋四态文案＋缺省收起的那一层。
                 判定与归组在 conversationTimeline.mjs，本组件只把 blocks 递下去。失败的回答也带这一层（断在哪一步）。 -->
            <ConversationTimeline
              v-if="message.trail?.length"
              :blocks="timelines.get(timelinePath(message.id)) || []"
              :trail="message.trail"
              :expanded="isOpen(message.id)"
              :path="timelinePath(message.id)"
              @toggle="onTimelineToggle"
            />
          </article>
        </template>

        <div v-if="busy" class="authoring-knowledge__thinking" role="status">
          <span aria-hidden="true"></span>{{ thinking }}
        </div>
        <!-- 〔批次77 任务4〕在途那一问：平铺（不折叠）的时间线——作者正看着它跑，
             再套一层「点开才看得见」等于没做。回答落地后这一问定格进上面的 message.trail，这里就空了。 -->
        <div v-if="busy && liveTrail.length" class="authoring-knowledge__live-trail" data-test="live-timeline">
          <ConversationTimeline flat streaming :blocks="liveTimeline" :trail="liveTrail" />
        </div>
      </div>
    </div>

    <footer class="authoring-knowledge__composer">
      <!-- 会话级用量（批次77 任务2）：取最近一条真带 usage 的助手消息——这是 DeepWrite 那条
           「上下文圆环只看最近同模型那一轮」的口径，不做累计估算。数值只记账，不当任何闸。 -->
      <p v-if="sessionUsage" class="authoring-knowledge__composer-usage" data-test="session-usage">
        最近一轮 {{ sessionUsage.input }} in／{{ sessionUsage.output }} out（计 {{ sessionUsage.total }}）
      </p>
      <details v-if="tools.length" class="authoring-knowledge__agent-detail">
        <summary><WorkbenchIcon name="chevron-down" :size="12" />工具面（{{ tools.length }}）</summary>
        <ul class="authoring-knowledge__agent-list">
          <li v-for="tool in tools" :key="tool.name"><code>{{ tool.name }}</code></li>
        </ul>
      </details>

      <div class="authoring-knowledge__input-row">
        <textarea
          ref="textareaRef"
          v-model="draft"
          rows="1"
          :placeholder="placeholder"
          aria-label="向助手提问"
          :disabled="disabled || busy"
          @keydown="onKeydown"
          @input="onInput"
          @click="updateRefMenu"
          @blur="refOpen = false"
        />

        <!-- @ 引用弹层：按类列出当前项目内容（每类最多 8 条），点一条插进光标处。 -->
        <div v-if="refOpen" class="authoring-knowledge__ref-pop" role="listbox" aria-label="引用项目内容">
          <p class="authoring-knowledge__ref-head">引用项目内容（@）</p>
          <p v-if="!referenceOptions.length" class="authoring-knowledge__ref-empty">当前项目还没有可引用的内容（打开对应栏目后这里就有）。</p>
          <template v-for="group in referenceGroups" :key="group.kind">
            <p class="authoring-knowledge__ref-group">{{ group.label }}</p>
            <button
              v-for="item in group.items"
              :key="`${group.kind}-${item.path ?? item.title}`"
              type="button"
              class="authoring-knowledge__ref-item"
              :class="{ 'is-active': referenceOptions[refIndex] === item }"
              role="option"
              :aria-selected="(referenceOptions[refIndex] === item).toString()"
              @mousedown.prevent
              @click="insertReference(item)"
            >
              <span class="authoring-knowledge__ref-title">@《{{ item.title }}》</span>
              <span class="authoring-knowledge__ref-kind">{{ group.label }}</span>
            </button>
          </template>
        </div>

        <!-- / 命令提示：可点、可上下键选、可 Enter 选中（选中把模板填进草稿）。 -->
        <div v-if="slashOpen" class="authoring-knowledge__slash-hint" role="listbox" aria-label="可用命令">
          <button
            v-for="(command, index) in slashCommands"
            :key="command.name"
            type="button"
            class="authoring-knowledge__slash-item"
            :class="{ 'is-active': index === slashIndex }"
            role="option"
            :aria-selected="(index === slashIndex).toString()"
            @mousedown.prevent
            @click="pickSlash(command)"
          >
            <code>{{ command.name }}</code> {{ command.desc }}
          </button>
        </div>

        <div class="authoring-knowledge__composer-actions">
          <button
            type="button"
            class="authoring-knowledge__send"
            aria-label="发送问题"
            :disabled="disabled || busy || !draft.trim()"
            @click="submit"
          >
            <WorkbenchIcon name="arrow-up" :size="19" />
          </button>
        </div>
      </div>
    </footer>
  </section>
</template>

<style scoped>
/* legacy-copied：度量与配色逐条抄自 src/components/authoring/AuthoringKnowledgeAssistant.vue（老版原话）。
   本块在视觉合同里豁免「裸 px 字号/圆角」检查——那是复用老版度量，不是另立刻度；
   Next 自己加的样式在后面的 style 块（审稿意见／会话弹层／slash 命令／@ 引用），走 --nx-* 刻度，受门禁管。 */
.authoring-knowledge { position: relative; display: flex; min-width: 0; min-height: 0; height: 100%; flex-direction: column; color: var(--text-primary); background: var(--surface-assistant); font: 14px/1.5 var(--font-interface, var(--font-sans)); }
.authoring-knowledge__toolbar { display: flex; min-height: 52px; box-sizing: border-box; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 12px 7px 14px; border-bottom: 0; }
.authoring-knowledge__toolbar-primary { min-width: 0; }
.authoring-knowledge__model { display: grid; min-width: 0; gap: 1px; }
.authoring-knowledge__model strong { overflow: hidden; font-size: 14px; font-weight: 560; text-overflow: ellipsis; white-space: nowrap; }
.authoring-knowledge__body { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
.authoring-knowledge__intro { width: 100%; flex: none; margin: 0 auto 32px; text-align: center; }
.authoring-knowledge__intro h3 { margin: 0; color: var(--archive-ink); font: 500 21px/1.45 var(--font-interface, var(--font-sans)); letter-spacing: -.025em; }
/* 起始态那句引导语是老版左对齐的，老版靠 body 的 gutter（--assistant-gutter: 16px）让它离边；
   这份拷贝少了那条 gutter，手机上那句会贴着屏幕边。 */
.authoring-knowledge.is-starting .authoring-knowledge__body { padding-inline: 16px; }
.authoring-knowledge.is-starting .authoring-knowledge__intro { margin-bottom: 20px; }
.authoring-knowledge.is-starting .authoring-knowledge__intro h3 { line-height: 1.55; text-align: start; }
.authoring-knowledge__thread { position: relative; min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 20px 16px 28px; scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
.authoring-knowledge__question-row { display: flex; align-items: center; gap: 6px; width: fit-content; max-width: min(100%, calc(88% + 38px)); margin: 0 0 22px auto; }
.authoring-knowledge__question { min-width: 0; width: fit-content; max-width: 100%; margin: 0; padding: 10px 16px; border-radius: 18px; background: var(--surface-workbench-input); overflow-wrap: anywhere; }
.authoring-knowledge__question p { margin: 0; font: 15px/1.7 var(--font-interface, var(--font-sans)); }
.authoring-knowledge__answer { margin: 0 0 32px; }
.authoring-knowledge__answer-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; color: var(--text-secondary); font: 13px/1.5 var(--font-interface, var(--font-sans)); }
.authoring-knowledge__answer-meta > span { display: inline-flex; align-items: center; gap: 6px; color: var(--text-primary); font-weight: 500; }
.authoring-knowledge__answer-meta time { color: var(--text-muted); font-size: 12px; }
.authoring-knowledge__answer-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 15px/1.85 var(--font-interface, var(--font-sans)); }
/* 批次77 任务1：助手正文走 mdRender（与阅读面同一条渲染链）。下面这一组逐条抄自
   src/components/authoring/AuthoringKnowledgeAssistant.vue:740-757 的 :deep() md 规则——
   老版会话面的 md 度量就是它，不再另立一套。markdown 版式自己管段落间距，
   所以先把上面那条 pre-wrap 关掉（否则 marked 出的 <p> 会把源码里的换行再折一次）。 */
.authoring-knowledge__markdown { white-space: normal; }
.authoring-knowledge__markdown :deep(p) { margin: 0 0 1em; }
.authoring-knowledge__markdown :deep(> :first-child) { margin-top: 0; }
.authoring-knowledge__markdown :deep(> :last-child) { margin-bottom: 0; }
.authoring-knowledge__markdown :deep(h1), .authoring-knowledge__markdown :deep(h2), .authoring-knowledge__markdown :deep(h3), .authoring-knowledge__markdown :deep(h4), .authoring-knowledge__markdown :deep(h5), .authoring-knowledge__markdown :deep(h6) { margin: 1.3em 0 .55em; color: var(--text-primary); font-size: 1.08em; font-weight: 600; line-height: 1.5; }
.authoring-knowledge__markdown :deep(strong) { font-weight: 600; }
.authoring-knowledge__markdown :deep(ul), .authoring-knowledge__markdown :deep(ol) { margin: .6em 0 1em; padding-inline-start: 1.5em; }
.authoring-knowledge__markdown :deep(li) { margin: .35em 0; padding-inline-start: .2em; }
.authoring-knowledge__markdown :deep(li > p) { margin: .35em 0; }
.authoring-knowledge__markdown :deep(hr) { margin: 1.3em 0; border: 0; border-top: 1px solid var(--hairline-soft); }
.authoring-knowledge__markdown :deep(blockquote) { margin: 1em 0; padding-inline-start: 1em; border-inline-start: 2px solid var(--hairline-soft); color: var(--text-secondary); }
.authoring-knowledge__markdown :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.authoring-knowledge__markdown :deep(pre) { max-width: 100%; overflow-x: auto; margin: 1em 0; padding: 12px; background: var(--surface-workbench-muted); border-radius: var(--radius-control); font-size: .88em; line-height: 1.6; }
.authoring-knowledge__markdown :deep(code) { font-family: var(--font-mono, monospace); white-space: pre-wrap; }
.authoring-knowledge__markdown :deep(pre code) { white-space: pre; }
.authoring-knowledge__markdown :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 1em 0; font-size: .92em; }
.authoring-knowledge__markdown :deep(th), .authoring-knowledge__markdown :deep(td) { padding: 6px 10px; border-bottom: 1px solid var(--hairline-soft); text-align: start; }
.authoring-knowledge__markdown :deep(img) { max-width: 100%; height: auto; }
.authoring-knowledge__thinking { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; }
/* 〔批次77 任务4〕在途那一问的平铺时间线：紧跟状态行，自己不额外撑出一段空。 */
.authoring-knowledge__live-trail { margin-top: 4px; }
.authoring-knowledge__thinking span { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-primary, var(--accent)); animation: knowledge-pulse 900ms ease-in-out infinite alternate; }
.authoring-knowledge__error { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; margin-top: 10px; padding: 9px 10px; border: 0; border-radius: 12px; background: var(--archive-paper); color: var(--text-secondary); font-size: 13px; text-align: start; }
.authoring-knowledge__error-retry { border: 0; background: transparent; color: var(--accent-primary, var(--accent)); cursor: pointer; }
</style>

<style scoped>
/* Next 自己加的：结构化审稿（模型给的是「意见＋动作」，只显示 summary 一行等于把回答丢了）。
   字号走 --nx-* 刻度，受 visual-contract 门禁管。 */
.authoring-knowledge__findings { margin-top: 12px; }
.authoring-knowledge__findings-label { margin: 0 0 4px; font-size: var(--nx-fs-2xs); font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); }
.authoring-knowledge__findings-list { margin: 0; padding-left: 18px; font-size: var(--nx-fs-md); line-height: 1.7; color: var(--archive-ink); }
.authoring-knowledge__findings-sev { margin-right: 5px; font-size: var(--nx-fs-2xs); color: var(--text-muted); }
.authoring-knowledge__actions { margin-top: 12px; }

/* 批次29：运行过程轨迹（答下方的「过程」折叠层）。开发者向的事实，默认收起；
   字号/圆角一律走刻度 token（visual-contract 受管）。 */
.authoring-knowledge__trail { margin-top: 14px; color: var(--text-muted); font-size: var(--nx-fs-2xs); }
.authoring-knowledge__trail summary { display: flex; min-height: 26px; align-items: center; gap: 6px; list-style: none; cursor: pointer; }
.authoring-knowledge__trail summary::-webkit-details-marker { display: none; }
.authoring-knowledge__trail[open] summary svg { transform: rotate(180deg); }
.authoring-knowledge__trail-list { display: grid; gap: 2px; margin: 4px 0 0; padding-left: 4px; list-style: none; font-size: var(--nx-fs-2xs); line-height: 1.6; }
.authoring-knowledge__trail-row { display: flex; gap: 8px; }
.authoring-knowledge__trail-stage { min-width: 88px; flex: none; color: var(--text-secondary); }
.authoring-knowledge__trail-detail { color: var(--text-muted); }
</style>

<style scoped>
/* legacy-copied（续）：composer／输入行／工具面折叠的度量同样逐条抄自老版原件。 */
.authoring-knowledge__composer { position: relative; z-index: 1; flex: none; padding: 10px 16px 16px; background: var(--surface-assistant); }
.authoring-knowledge__input-row { position: relative; box-sizing: border-box; display: flex; min-height: 98px; flex-direction: column; align-items: stretch; gap: 12px; padding: 14px; border: 1px solid var(--hairline-soft); border-radius: 20px; background: var(--surface-workbench-input); box-shadow: none; }
.authoring-knowledge__input-row:focus-within { outline: 2px solid var(--workbench-focus); outline-offset: 1px; border-color: transparent; }
.authoring-knowledge__input-row textarea { display: block; box-sizing: border-box; flex: none; width: 100%; min-width: 0; min-height: 28px; max-height: 160px; resize: none; border: 0; outline: 0; padding: 0 4px; background: transparent; color: var(--text-primary); font: 15px/28px var(--font-interface, var(--font-sans)); }
.authoring-knowledge__input-row textarea::placeholder { color: var(--text-muted); opacity: 1; }
.authoring-knowledge__composer-actions { display: flex; min-width: 0; align-items: center; flex-wrap: nowrap; gap: 4px; }
.authoring-knowledge__send { display: grid; flex: none; width: var(--workspace-control-height, 36px); height: var(--workspace-control-height, 36px); margin-inline-start: auto; place-items: center; border: 0; border-radius: 50%; background: var(--workbench-action); color: var(--workbench-action-text); cursor: pointer; }
.authoring-knowledge__send:hover:not(:disabled) { background: var(--workbench-action-hover); color: var(--workbench-action-text); }
.authoring-knowledge__send:disabled { background: var(--nav-hover); color: var(--text-muted); cursor: default; }
.authoring-knowledge button:focus-visible, .authoring-knowledge summary:focus-visible { outline: 2px solid var(--workbench-focus); outline-offset: 3px; }
.authoring-knowledge__agent-detail { margin: 0 0 8px; padding: 0; border: 0; background: transparent; color: var(--text-muted); font-size: 12px; }
.authoring-knowledge__agent-detail summary { cursor: pointer; min-height: 30px; padding: 0; display: flex; align-items: center; gap: 6px; line-height: 1.5; list-style: none; }
.authoring-knowledge__agent-detail[open] summary svg { transform: rotate(180deg); }
.authoring-knowledge__agent-detail summary::-webkit-details-marker { display: none; }
.authoring-knowledge__agent-detail summary:focus-visible { outline: 2px solid var(--workbench-focus); outline-offset: 2px; }
.authoring-knowledge__agent-list { margin: 4px 0 0; padding-left: 18px; }
.authoring-knowledge__agent-list code { color: var(--accent); font-size: 11px; }
@keyframes knowledge-pulse { to { opacity: .28; transform: scale(.72); } }
@media (pointer: coarse) {
  .authoring-knowledge__send { width: 44px; height: 44px; }
}
</style>

<style scoped>
/* 批次22：模式标签（审阅/自动）＋ slash 命令提示。全 token。 */
/* 〔批次76 任务4-4〕模式徽标实测 40×23、确认行那两枚 40 上下×22：都差纵向那 1–2px。
   抬到 min-height 24 并 inline-flex 居中（padding 与字号不动，徽标不会被撑成两行）。 */
.authoring-knowledge__mode-badge { flex: none; display: inline-flex; align-items: center; min-height: 24px; padding: 2px 8px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-control, 10px); background: transparent; color: var(--text-muted); font-size: var(--nx-fs-2xs, 11px); cursor: pointer; }
.authoring-knowledge__mode-badge.is-review { color: var(--accent, var(--accent)); border-color: color-mix(in srgb, var(--accent) 32%, transparent); }
.authoring-knowledge__mode-badge.is-auto { color: var(--signal-warm, var(--signal-warm)); border-color: color-mix(in srgb, var(--signal-warm) 32%, transparent); }
.authoring-knowledge__mode-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid color-mix(in srgb, var(--signal-warm, currentColor) 32%, transparent); border-radius: var(--nx-radius-xs, 8px); background: color-mix(in srgb, var(--signal-warm, currentColor) 6%, transparent); font-size: var(--nx-fs-2xs, 11px); color: var(--text-muted); }
.authoring-knowledge__mode-confirm-text { flex: 1 1 180px; }
.authoring-knowledge__mode-confirm-ok, .authoring-knowledge__mode-confirm-cancel { flex: none; display: inline-flex; align-items: center; min-height: 24px; padding: 2px 8px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-control, 10px); background: transparent; color: var(--text-muted); font-size: var(--nx-fs-2xs, 11px); cursor: pointer; }
.authoring-knowledge__mode-confirm-ok { color: var(--signal-warm, currentColor); border-color: color-mix(in srgb, var(--signal-warm, currentColor) 32%, transparent); }
.authoring-knowledge__slash-hint { display: flex; flex-wrap: wrap; gap: 6px 8px; padding: 6px 4px 0; font-size: var(--nx-fs-2xs, 11px); color: var(--text-muted); }
.authoring-knowledge__slash-item { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-control); background: transparent; color: var(--text-muted); font-size: var(--nx-fs-2xs); cursor: pointer; }
.authoring-knowledge__slash-item.is-active, .authoring-knowledge__slash-item:hover { color: var(--archive-ink); background: var(--nav-hover); border-color: var(--border-strong); }
.authoring-knowledge__slash-item code { color: var(--accent, var(--accent)); font-weight: 600; margin-right: 4px; }
</style>

<style scoped>
/* 批次27：会话管理（工具栏按钮＋轻量弹层）、命令徽章、@ 引用弹层。全 token，受 visual-contract 门禁管。 */
.authoring-knowledge__toolbar { position: relative; }
.authoring-knowledge__toolbar-actions { display: flex; flex: none; align-items: center; gap: 6px; }
.authoring-knowledge__session-btn { display: inline-flex; align-items: center; gap: 4px; flex: none; min-height: 24px; padding: 2px 8px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-control); background: transparent; color: var(--text-muted); font-size: var(--nx-fs-2xs); cursor: pointer; }
.authoring-knowledge__session-btn.is-open, .authoring-knowledge__session-btn:hover { color: var(--archive-ink); background: var(--nav-hover); border-color: var(--border-strong); }
.authoring-knowledge__session-count { color: var(--text-muted); font-size: var(--nx-fs-2xs); }

/* 会话弹层：轻量一枚（不是二级页），贴着工具栏下缘。层序走 --z-popover（低于统一二级页）。 */
.authoring-knowledge__sessions { position: absolute; top: calc(100% - 4px); right: 8px; z-index: var(--z-popover); width: min(280px, 92vw); max-height: 340px; overflow-y: auto; padding: 6px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-control); background: var(--surface-workbench-raised); box-shadow: 0 10px 28px color-mix(in srgb, var(--archive-ink) 18%, transparent); scrollbar-width: thin; }
.authoring-knowledge__session-new { display: flex; width: 100%; min-height: 30px; align-items: center; padding: 5px 8px; margin-bottom: 4px; border: 0; border-radius: var(--nx-radius-xs); background: transparent; color: var(--accent); font-size: var(--nx-fs-md); text-align: start; cursor: pointer; }
.authoring-knowledge__session-new:hover { background: var(--nav-hover); }
.authoring-knowledge__session-list { list-style: none; margin: 0; padding: 0; }
.authoring-knowledge__session-row { display: flex; align-items: center; gap: 2px; border-radius: var(--nx-radius-xs); }
.authoring-knowledge__session-row.is-active { background: var(--nav-selected); }
.authoring-knowledge__session-item { display: flex; flex: 1 1 auto; min-width: 0; flex-direction: column; gap: 2px; padding: 6px 8px; border: 0; border-radius: var(--nx-radius-xs); background: transparent; color: var(--archive-ink); font-size: var(--nx-fs-md); text-align: start; cursor: pointer; }
.authoring-knowledge__session-item:hover { background: var(--nav-hover); }
.authoring-knowledge__session-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.authoring-knowledge__session-time { color: var(--text-muted); font-size: var(--nx-fs-2xs); }
.authoring-knowledge__session-remove { flex: none; width: 24px; height: 24px; border: 0; border-radius: var(--nx-radius-xs); background: transparent; color: var(--text-muted); font-size: var(--nx-fs-2xs); cursor: pointer; opacity: .35; }
.authoring-knowledge__session-row:hover .authoring-knowledge__session-remove, .authoring-knowledge__session-remove:focus-visible { opacity: 1; }
.authoring-knowledge__session-remove:hover { color: var(--control-danger); background: var(--nav-hover); }
.authoring-knowledge__session-rename { width: 100%; min-height: 28px; padding: 2px 8px; border: 1px solid var(--border-strong); border-radius: var(--nx-radius-xs); background: var(--surface-workbench-input); color: var(--text-primary); font-size: var(--nx-fs-md); }

/* 命令徽章与引用标注：一条 user 消息上的两个小字。 */
.authoring-knowledge__command-badge { margin-right: 6px; padding: 1px 6px; border-radius: var(--nx-radius-xs); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); font-size: var(--nx-fs-2xs); }
p.authoring-knowledge__question-note { margin: 4px 0 0; color: var(--text-muted); font-size: var(--nx-fs-2xs); line-height: 1.5; }

/* @ 引用弹层：贴在输入行上缘（弹层在输入行内部，input-row 已是 relative）。 */
.authoring-knowledge__ref-pop { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); z-index: var(--z-popover); max-height: 300px; overflow-y: auto; padding: 6px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-control); background: var(--surface-workbench-raised); box-shadow: 0 10px 28px color-mix(in srgb, var(--archive-ink) 18%, transparent); scrollbar-width: thin; }
.authoring-knowledge__ref-head { margin: 2px 8px 4px; color: var(--text-muted); font-size: var(--nx-fs-2xs); letter-spacing: .04em; }
.authoring-knowledge__ref-group { margin: 6px 8px 2px; color: var(--text-muted); font-size: var(--nx-fs-2xs); }
.authoring-knowledge__ref-item { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 8px; border: 0; border-radius: var(--nx-radius-xs); background: transparent; color: var(--archive-ink); font-size: var(--nx-fs-md); text-align: start; cursor: pointer; }
.authoring-knowledge__ref-item.is-active, .authoring-knowledge__ref-item:hover { background: var(--nav-hover); }
.authoring-knowledge__ref-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.authoring-knowledge__ref-kind { flex: none; color: var(--text-muted); font-size: var(--nx-fs-2xs); }
.authoring-knowledge__ref-empty { margin: 4px 8px; color: var(--text-muted); font-size: var(--nx-fs-2xs); line-height: 1.6; }
</style>

<style scoped>
/* —— 批次77 任务2：消息行的元信息与动作条 ————————————————————————————————
   抄的是 DeepWrite renderer/src/styles.css:1921-1960 那条口径：动作件缺省不可见，
   行 hover 或键盘聚焦（:focus-within，纯键盘也点得着）才显形；但**位置常驻**——
   预留 min-height 让显形时不把他条内容顶一下。配色一律走老 token，字号一律走 --nx-* 刻度。
   命中区按批次76 那条度量口径给到 28×28（图标 13px，钮自己撑开）。 */
.authoring-knowledge__row-actions { display: flex; align-items: center; gap: 2px; min-height: 28px; opacity: 0; transition: opacity 120ms ease; }
.authoring-knowledge__row-actions--answer { justify-content: flex-end; margin-top: 2px; }
.authoring-knowledge__question-row:hover > .authoring-knowledge__row-actions,
.authoring-knowledge__answer:hover .authoring-knowledge__row-actions,
.authoring-knowledge__row-actions:focus-within { opacity: 1; }
/* 键盘 Tab 进来也要看得见：这一条不是装饰，是「点得到」的底线。 */
.authoring-knowledge__row-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--nx-radius-xs); background: transparent; color: var(--text-muted); cursor: pointer; }
.authoring-knowledge__row-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--nav-hover); }
.authoring-knowledge__row-btn:focus-visible { outline: 2px solid var(--workbench-selected); outline-offset: 1px; color: var(--text-primary); }
.authoring-knowledge__row-btn:disabled { cursor: not-allowed; opacity: 0.45; }
.authoring-knowledge__row-time { margin-inline-end: 4px; color: var(--text-muted); font-size: var(--nx-fs-2xs); font-variant-numeric: tabular-nums; }
/* token chip：也是 hover 才现的一格。没有回报时是那六个字，不是 0（守卫⑦）。 */
.authoring-knowledge__usage { margin-inline-start: 6px; color: var(--text-muted); font-size: var(--nx-fs-2xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 状态那一格（常驻）：盖过 legacy-copied 块里 `.answer-meta > span` 的那一份强调样式。 */
.authoring-knowledge__answer-meta > .authoring-knowledge__answer-status { margin-inline-start: auto; color: var(--text-muted); font-weight: 400; font-size: var(--nx-fs-2xs); letter-spacing: .02em; }
.authoring-knowledge__answer-meta > .authoring-knowledge__answer-status[data-status='error'] { color: var(--danger); }
.authoring-knowledge__answer-meta > .authoring-knowledge__answer-status[data-status='stopped'] { color: var(--signal-warm); }
.authoring-knowledge__answer-meta > .authoring-knowledge__answer-status[data-status='streaming'] { color: var(--accent); }
/* 会话级用量（输入区右上）：一行的极淡小字，数值只记账、不当任何闸。 */
.authoring-knowledge__composer-usage { margin: 0 2px 4px; text-align: end; color: var(--text-muted); font-size: var(--nx-fs-2xs); font-variant-numeric: tabular-nums; }
</style>
