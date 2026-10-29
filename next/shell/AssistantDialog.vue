<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { SLASH_COMMANDS, isSlashDraft } from './slashCommands.mjs'
import { REFERENCE_KIND_ORDER, referenceKindLabel } from './agentReferences.mjs'
import { formatRelativeTime, describeTrailEvent } from './agentSessions.mjs'

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
const emit = defineEmits(['send', 'retry', 'update:mode', 'new-session', 'switch-session', 'rename-session', 'remove-session'])

const draft = ref('')
const threadRef = ref(null)
const textareaRef = ref(null)
const sessionRoot = ref(null)
const mode = computed(() => props.mode)

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

/** 老版的口径：Enter 发送，Shift+Enter 换行，中文输入法组字时不抢键。 */
function onKeydown(event) {
  if (event.isComposing) return
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

/** 答下方「过程」折叠层的数据：每条事件 → 一行（阶段＋关键数字），认不出的阶段跳过。 */
function trailRows(trail) {
  return (Array.isArray(trail) ? trail : []).map(describeTrailEvent).filter(Boolean)
}

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
          @click="emit('update:mode', mode === 'review' ? 'auto' : 'review')"
        >{{ mode === 'review' ? '审阅' : '自动' }}</button>
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

    <div class="authoring-knowledge__body">
      <div v-if="!messages.length" class="authoring-knowledge__intro">
        <h3>接下来，想写什么？</h3>
      </div>

      <div ref="threadRef" class="authoring-knowledge__thread" aria-live="polite">
        <template v-for="message in messages" :key="message.id">
          <div v-if="message.role === 'user'" class="authoring-knowledge__question-row" :data-message-id="message.id">
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
            </div>
            <div v-if="message.failed" class="authoring-knowledge__error" role="alert">
              <span>{{ message.text }}</span>
              <button type="button" class="authoring-knowledge__error-retry" @click="emit('retry')">重试</button>
            </div>
            <template v-else>
              <div class="authoring-knowledge__answer-text">{{ message.text }}</div>
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
            <!-- 批次29：这一问真实的运行过程（阶段＋数字）。开发者向的事实，默认收起——
                 屏上只留问—答主线，要看过程就展开。失败的回答也带这条轨迹（断在哪一步）。 -->
            <details v-if="message.trail?.length" class="authoring-knowledge__trail">
              <summary><WorkbenchIcon name="chevron-down" :size="12" />过程（{{ message.trail.length }} 步）</summary>
              <ul class="authoring-knowledge__trail-list">
                <li v-for="(step, index) in trailRows(message.trail)" :key="`t-${index}`" class="authoring-knowledge__trail-row">
                  <span class="authoring-knowledge__trail-stage">{{ step.label }}</span>
                  <span v-if="step.detail" class="authoring-knowledge__trail-detail">{{ step.detail }}</span>
                </li>
              </ul>
            </details>
          </article>
        </template>

        <div v-if="busy" class="authoring-knowledge__thinking" role="status">
          <span aria-hidden="true"></span>{{ thinking }}
        </div>
      </div>
    </div>

    <footer class="authoring-knowledge__composer">
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
.authoring-knowledge__thinking { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; }
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
.authoring-knowledge__mode-badge { flex: none; padding: 2px 8px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-control, 10px); background: transparent; color: var(--text-muted); font-size: var(--nx-fs-2xs, 11px); cursor: pointer; }
.authoring-knowledge__mode-badge.is-review { color: var(--accent, var(--accent)); border-color: color-mix(in srgb, var(--accent) 32%, transparent); }
.authoring-knowledge__mode-badge.is-auto { color: var(--signal-warm, var(--signal-warm)); border-color: color-mix(in srgb, var(--signal-warm) 32%, transparent); }
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
