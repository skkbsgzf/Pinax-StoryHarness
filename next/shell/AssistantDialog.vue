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
 *
 * 〔批次77 任务3〕**两套键盘逻辑合一**：上面那两件（`/` 与 `@`）原本是两块各写一遍的并行状态
 * （各自的 open／query／index／Esc），键位也就各判各的，`Tab` 只有一边有、中文正文中段的 `/`
 * 还会误触。现在三类触发符（`/` 技能与命令、`@` 素材、`#` 工作流角色）走**同一条**判定与菜单：
 * `detectComposerToken` 认光标前那一段（含前导边界），`buildComposerMenu` 出菜单，
 * `applyComposerToken` 管回填。判定全在 `composerTypeahead.mjs`（纯函数，node:test 直测），
 * 这一层只把菜单摆出来并把手上的键分派过去——与任务4 的时间线同一口径「组件只负责摆」。
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
  /** 〔批次68-R2 任务三〕缺省语换成截图那句：三类触发符直接写进占位，菜单不收起来也能被教到。 */
  placeholder: { type: String, default: '发消息或创建任务，/ 调用指令，@ 素材' },
  /** 当前模式：review（提案制）／auto（直写）／blocked（这块目录只读，写入被拒也不出提案）。 */
  mode: { type: String, default: 'review' },
  /** 会话列表摘要：[{ id, title, updatedAt, messageCount }]（agentSessions.list()）。 */
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: String, default: '' },
  /** @ 引用清单：[{ kind, title, path }]，由外壳从 board data 组一份传下来。 */
  references: { type: Array, default: () => [] },
  /**
   * 〔批次77 任务3〕`/` 菜单里的技能清单：运行时装载那一份（surface.skills.catalog）。
   * 只给**真装载**的——整包拒装的（工具不在面上）不该出现在这里，作者要去设置里的技能库看原因。
   */
  skills: { type: Array, default: () => [] },
  /** 〔批次77 任务3〕`#` 工作流角色清单：产出方是批次78，本批恒为空 → 菜单只出那一句「暂无」。 */
  roles: { type: Array, default: () => [] },
  /** 〔批次77 任务3〕键位表（hotkeys.mjs 那张）：宿主读一份经 props 递下来，本组件不硬编码按键。 */
  hotkeys: { type: Object, default: () => ({}) },
  /** 统一二级页开着时为 true：Esc 先归它（照 FloatingWidget 的 suspendEsc 先例）。 */
  suspendEsc: { type: Boolean, default: false },
  /**
   * 〔批次68-R2 任务三〕模型 chip 的清单数据源：运行时模型面真名（surface 侧有清单才传）。
   * 本批探针只有 endpoint 与状态、没有模型名 → 缺省空数组，界面按「无清单时只显示不可点」如实画。
   */
  modelNames: { type: Array, default: () => [] }
})
const emit = defineEmits(['send', 'retry', 'stop', 'update:mode', 'new-session', 'switch-session', 'rename-session', 'remove-session', 'edit', 'regenerate', 'branch', 'switch-branch'])

const draft = ref('')
const threadRef = ref(null)
const textareaRef = ref(null)
const sessionRoot = ref(null)

/**
 * 切到 auto 需要一次显式确认（M2.5-B）：这是「AI 产出直接写正文」的那一档，
 * 一次误点不该把后面所有提问都改成直写。review 回退不需要确认——回到更安全的档位永远允许。
 *
 * 〔批次77 任务3〕第三档 `blocked`（词表源 `writePolicy.WRITE_MODES`，本批之前只有 UI 判前两档）：
 * 「这块目录只读，写入被拒也不出提案」。它**不塞进 auto 那条确认行**当默认项——
 * 确认行讲的那句话是「会直接写入正文」，把最保守的一档挂在同一句下面会读反。
 * 落点是徽标本身：review 点＝开确认行（auto 那一档），blocked 点＝直接回 review（回保守档不设闸），
 * auto 点＝回 review（既有口径一字不动，那条用例钉着）。blocked 的**进**走确认行里新加的那枚钮。
 */
const pendingAuto = ref(false)
const modeLabel = computed(() => ({ review: '审阅', auto: '自动', blocked: '锁定' }[props.mode] ?? '审阅'))
const modeClass = computed(() => (props.mode === 'auto' ? 'is-auto' : props.mode === 'blocked' ? 'is-blocked' : 'is-review'))
const modeTitle = computed(() => ({
  review: '审阅模式：AI 产出走提案，确认后才落盘',
  auto: '自动模式：AI 产出直接写入（慎用）',
  blocked: '锁定模式：写入一律被拒，也不出提案（这块目录只读）'
}[props.mode] ?? '审阅模式：AI 产出走提案，确认后才落盘'))
watch(() => props.mode, () => { pendingAuto.value = false })

function requestMode() {
  // 从两档「更 unsafe」的档位回 review 都不设闸：点一下就回，不留确认条（既有口径）。
  if (props.mode === 'auto' || props.mode === 'blocked') {
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

/** 切到锁定：写族一律被拒（主进程 writePolicy 判 blocked），这一档不需要二次确认——它比 review 更保守。 */
function confirmBlocked() {
  pendingAuto.value = false
  emit('update:mode', 'blocked')
}

function cancelAuto() {
  pendingAuto.value = false
}

/**
 * 从提示层选中的命令：作者可能在模板上继续改，所以它不写进草稿（命令词本身不留在草稿里），
 * 只在提交时随草稿一起交给 RuntimeDock 做路由；草稿被清空就作废（那是新的一问）。
 */
const pendingCommand = ref(null)

/* —— 〔批次77 任务3〕一个 typeahead 吃三类：`/` 命令与技能、`@` 素材、`#` 工作流角色 ——
 * 判定／组菜单／回填三件事全在 composerTypeahead.mjs（纯函数）。这里只剩四样状态：
 * 当前 token、菜单是否被 Esc 关掉（只管那一下，重新打字给回一次机会）、高亮序号、草稿。
 */
const composerToken = ref(null)
const menuClosed = ref(false)
const menuIndex = ref(0)

const composerMenu = computed(() => {
  const token = composerToken.value
  if (!token || menuClosed.value) return null
  return buildComposerMenu({
    trigger: token.trigger,
    query: token.query,
    commands: SLASH_COMMANDS,
    skills: props.skills,
    references: props.references,
    roles: props.roles,
    referenceKindOrder: REFERENCE_KIND_ORDER,
    referenceKindLabels: REFERENCE_KIND_LABELS
  })
})
/** 键盘那一条扁平序列（顺序＝屏上顺序，与 buildComposerMenu 同源）。 */
const composerItems = computed(() => composerMenu.value?.items ?? [])

/** 光标前那一段重算一次（输入、点击、键盘移动光标都走这里，判定只有一处）。 */
function refreshComposer() {
  const element = textareaRef.value
  const caret = typeof element?.selectionStart === 'number' ? element.selectionStart : draft.value.length
  const token = detectComposerToken(draft.value, caret)
  const previous = composerToken.value
  composerToken.value = token
  if (!token) {
    menuClosed.value = false
    menuIndex.value = 0
    return
  }
  // 换了一个 token（换触发符或改了查询词）＝作者重新在敲一个东西：上一轮 Esc 关掉的菜单给回一次机会。
  if (previous?.trigger !== token.trigger || previous?.query !== token.query) {
    menuClosed.value = false
    menuIndex.value = 0
    return
  }
  if (menuIndex.value >= Math.max(1, composerItems.value.length)) menuIndex.value = 0
}

function moveComposer(step) {
  const total = composerItems.value.length
  if (!total) return
  menuIndex.value = (menuIndex.value + step + total) % total
}

/**
 * 选中一条菜单项：
 *   · 命令＝老口径（模板填进草稿，命令词不留在草稿里，路由靠 pendingCommand 带过去）；
 *   · 技能／素材／角色＝把正在敲的那一段换成 token 文本（`/技能名`、`@《标题》`），光标落到它后面。
 * 技能那条是工单第 1 条的「只插文本」：正文与注入都不长在这个对话框里。
 */
function pickComposerItem(item) {
  if (!item) return
  if (item.kind === 'command') {
    pendingCommand.value = item.source ?? null
    draft.value = String(item.source?.template ?? '')
    menuClosed.value = true
    caretToEnd()
    return
  }
  const token = composerToken.value
  if (!token || !item.value) return
  const next = applyComposerToken(draft.value, token, item.value)
  draft.value = next.draft
  menuClosed.value = true
  nextTick(() => {
    const element = textareaRef.value
    element?.focus?.()
    element?.setSelectionRange?.(next.caret, next.caret)
    refreshComposer()
  })
}

function caretToEnd() {
  nextTick(() => {
    const element = textareaRef.value
    element?.focus?.()
    element?.setSelectionRange?.(draft.value.length, draft.value.length)
    refreshComposer()
  })
}

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
  composerToken.value = null
  menuClosed.value = false
  menuIndex.value = 0
}

/**
 * 键位合一（工单第 1 条）：菜单开着时 ↑↓ 移动、Enter／Tab 选中、Esc 关菜单；
 * 菜单不在（或那一句是空态、没有可选项）时 Enter 才是发送，Shift+Enter 换行。
 * 中文输入法组字时不抢键：`isComposing` 之外还要兜 `keyCode === 229`——
 * 229 是老 Chromium 在组字期把 keyCode 打成占位值的那条兜底，Safari／旧 Electron 上
 * event.isComposing 有时是 false 但 keyCode 仍是 229，只判前半个就会把「还没选完的字」当发送按出去。
 * 老前端 8 处同一口径（如 src/components/authoring/AuthoringBlockComposer.vue:202、
 * AuthoringManuscriptImport.vue:451、AuthoringRehearsalPanel.vue:93），这里照抄不发明。
 */
function onKeydown(event) {
  if (event.isComposing || event.keyCode === 229) return
  const items = composerItems.value
  if (items.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveComposer(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      menuClosed.value = true
      return
    }
    // Tab＝补全（把高亮那条的文本换进草稿，光标留给作者继续敲）；Enter＝选中同一条。
    // Shift+Enter 不换这条：它是换行，菜单开着也不抢（作者要的就是那一行空白）。
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault()
      pickComposerItem(items[menuIndex.value] ?? items[0])
      return
    }
  }
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submit()
}

/** 每次键入都重算：草稿空了命令就作废，token 没了菜单就收。 */
function onInput() {
  if (!draft.value.trim()) pendingCommand.value = null
  refreshComposer()
}

/** 唤起技能菜单（`skill.menu` 那条键位）：把光标处插进一个 `/`，剩下的交给同一条判定。 */
function openSkillMenu() {
  insertTrigger('/')
}

/**
 * 〔批次68-R2 任务三〕「＋」插入菜单的唯一通路：往光标处插一个触发符，然后交给
 * composerTypeahead 那**同一条**判定与菜单——不新增第二套插入通路（工单原话）。
 * 原来 openSkillMenu 里那一段就地泛化成这个函数，键位那条路（skill.menu）也改走它。
 */
function insertTrigger(char) {
  const element = textareaRef.value
  element?.focus?.()
  if (composerToken.value?.trigger === char) {
    menuClosed.value = false
    return
  }
  const caret = typeof element?.selectionStart === 'number' ? element.selectionStart : draft.value.length
  draft.value = `${draft.value.slice(0, caret)}${char}${draft.value.slice(caret)}`
  menuClosed.value = false
  nextTick(() => {
    element?.setSelectionRange?.(caret + 1, caret + 1)
    refreshComposer()
  })
}

/** 「＋」弹层那三项：全部指向既有触发符（@素材 / /技能与命令 / #工作流角色），点了就插、菜单自己唤起。 */
const INSERT_TRIGGERS = [
  { char: '@', label: '引用素材', hint: '@' },
  { char: '/', label: '技能与命令', hint: '/' },
  { char: '#', label: '工作流角色', hint: '#' }
]
const plusOpen = ref(false)
const plusRoot = ref(null)

function pickInsert(trigger) {
  plusOpen.value = false
  insertTrigger(trigger.char)
}

/**
 * 〔批次68-R2 任务三〕模型 chip：有真清单才点得开（点开只是把清单摆出来读，
 * 切模型不归这块界面管）；没清单它就是一行如实的显示件——disabled，不装能点。
 */
const modelOpen = ref(false)
const modelRoot = ref(null)
const modelChipText = computed(() => (props.modelNames.length ? String(props.modelNames[0] ?? '') : '模型未回报'))

/**
 * 〔批次77 任务3〕宿主键位表落点（六条里除「提案审阅」走原生菜单外，这五条都归对话框）：
 * 键位串只在 hotkeys.mjs 那张表里有一份，这里只按 id 分派到上面那几个既有动作，
 * 不在这儿重打一遍按键——作者改了键位，屏上这条也跟着变。
 */
function onChatHotkey(event) {
  if (props.suspendEsc) return false
  const id = matchHotkey(event, props.hotkeys)
  if (!id || !CHAT_HOTKEY_IDS.includes(id)) return false
  if (id === HOTKEY_CHAT_OPEN) {
    event.preventDefault()
    textareaRef.value?.focus?.()
    return true
  }
  if (id === HOTKEY_CHAT_SEND) {
    if (props.busy || props.disabled) return true
    event.preventDefault()
    submit()
    return true
  }
  if (id === HOTKEY_CHAT_STOP) {
    // 停止只在真有一问在途时才有意义：没在跑的时候按它，不许把「停了」这件事演出来。
    if (!props.busy) return true
    event.preventDefault()
    emit('stop')
    return true
  }
  if (id === HOTKEY_CHAT_MODE) {
    if (props.disabled) return true
    event.preventDefault()
    requestMode()
    return true
  }
  if (id === HOTKEY_SKILL_MENU) {
    if (props.busy || props.disabled) return true
    event.preventDefault()
    openSkillMenu()
    return true
  }
  return false
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
  if (!usage) return '这一轮没有用量'
  return `${usage.input} in／${usage.output} out`
}

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

/* —— 〔批次77-R2 任务6〕消息树：分支钮与 ‹i/n› 切换器 ————————————————
 * 这一层仍只管「摆」与「把手上的键／点击交出去」：存一支、截断、拨指针全在 agentSessions，
 * 与任务4 的时间线、任务3 的 typeahead 同一口径。
 */

/** 这一行右边要不要长切换器：同一层只有一支时不画（画一枚点了没反应的钮＝本批要消灭的死钮）。 */
function branchCount(message) {
  return Number(message?.branchNav?.count) || 0
}

function branchIndex(message) {
  return Number(message?.branchNav?.index) || 1
}

/** 分一支：与编辑重发同样只交「哪一条、原文、时刻」三要素，宿主拿去做乐观校验后再动历史。 */
function branchQuestion(message) {
  emit('branch', { id: message.id, text: message.text, at: message.at })
}

/** ‹ › 只说一件事：此刻想看这一层的哪一支（step＝往后挪几位）。内容不归这里管。 */
function cycleBranch(message, step) {
  emit('switch-branch', { id: message.id, step })
}

/** 重新生成：只对最后一条回答开（把中间的某一条换掉＝把后面的历史弄丢，要先分一支留退路）。 */
function regenerate(message) {
  emit('regenerate', { id: message.id })
}

/** 宿主回填输入框用（编辑重发）：不新开一条通道，直接改草稿。 */
function setDraft(text) {
  draft.value = String(text ?? '')
  pendingCommand.value = null
  menuClosed.value = false
  nextTick(() => {
    const element = textareaRef.value
    element?.focus?.()
    element?.setSelectionRange?.(draft.value.length, draft.value.length)
    refreshComposer()
  })
}

defineExpose({ setDraft })

/** 文档级键盘口：先给宿主键位表（对话面那五条），没命中再走老那条「Esc 收会话弹层」。 */
function onDocumentKeydown(event) {
  if (onChatHotkey(event)) return
  if (event.key !== 'Escape' || props.suspendEsc) return
  // 〔批次68-R2 任务三〕「＋」与模型 chip 那两个小弹层也归 Esc 先收（在会话弹层之前收，谁开着收谁）。
  if (plusOpen.value) {
    event.preventDefault()
    plusOpen.value = false
    return
  }
  if (modelOpen.value) {
    event.preventDefault()
    modelOpen.value = false
    return
  }
  if (!sessionOpen.value) return
  event.preventDefault()
  sessionOpen.value = false
  renamingId.value = null
}

/** 点弹层外面收起（按钮自己 toggle，不参与这条）。〔批次68-R2 任务三〕会话／＋／模型三层同一条口。 */
function onDocumentPointerDown(event) {
  if (plusOpen.value && !plusRoot.value?.contains?.(event.target)) plusOpen.value = false
  if (modelOpen.value && !modelRoot.value?.contains?.(event.target)) modelOpen.value = false
  if (!sessionOpen.value) return
  if (sessionRoot.value?.contains?.(event.target)) return
  sessionOpen.value = false
  renamingId.value = null
}

watch(() => props.messages.length, async () => {
  await nextTick()
  if (threadRef.value) threadRef.value.scrollTop = threadRef.value.scrollHeight
}, { immediate: true })

// 菜单项数量随 query 变（过滤后可能一条不剩）：高亮序号不许停在越界的那一格上。
watch(() => composerItems.value.length, (total) => {
  if (menuIndex.value >= total) menuIndex.value = 0
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
        <!-- 〔批次68-R2 任务三〕模式徽标从页眉收进 composer 控件排（写模式 chip ▾）：
             requestMode／modeClass／确认行逻辑与禁用态口径一字未动，只是长在了它管的这件事旁边。 -->
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
              <!-- 〔批次77-R2 任务6〕分一支＝先把这条之后的历史存成另一支，再在这儿改问法。
                   与「编辑重发」的分工要说清：直接编辑＝旧的那条之后的历史没了；分支＝旧的那条变成退路，
                   两支都在，切换器随时回得去。图标取现成的那张节点树（图标表在老 web 轨的文件里，本批不许动它）。 -->
              <button
                type="button"
                class="authoring-knowledge__row-btn"
                data-test="question-branch"
                :disabled="disabled || busy"
                aria-label="分一支"
                title="分一支（把这条之后的历史存成另一支，再改这一问）"
                @click="branchQuestion(message)"
              ><WorkbenchIcon name="network" :size="13" /></button>
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
            <!-- ‹ 2/3 ›：这一层的候选支计数＋当前指针。切换只换「此刻看哪一支」，
                 两支的内容一个字节都不动（所以它只 emit，不在这儿动 messages）。
                 摆在气泡右侧、且**不**跟着动作区那层 opacity 走：「我正在看第几支」是常驻事实，
                 hover 才显形的一闪而过等于没告诉人；只有真分了叉的那几行才会多出这一格。 -->
            <span
              v-if="branchCount(message) > 1"
              class="authoring-knowledge__branch-nav"
              data-test="branch-nav"
              :title="`这一层共 ${branchCount(message)} 支，正在看第 ${branchIndex(message)} 支`"
            >
              <button
                type="button"
                class="authoring-knowledge__branch-step"
                data-test="branch-prev"
                :disabled="disabled || busy"
                aria-label="看上一支"
                title="看上一支"
                @click="cycleBranch(message, -1)"
              >‹</button>
              <span class="authoring-knowledge__branch-count" data-test="branch-count">{{ branchIndex(message) }}/{{ branchCount(message) }}</span>
              <button
                type="button"
                class="authoring-knowledge__branch-step"
                data-test="branch-next"
                :disabled="disabled || busy"
                aria-label="看下一支"
                title="看下一支"
                @click="cycleBranch(message, 1)"
              >›</button>
            </span>
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
                 〔批次77-R2 任务6〕分支不在这里：分叉点是问句那一层（同一问才有「另一支」可言），
                 所以「分一支」与 ‹i/n› 切换器长在上面的 question-row 动作区，回答这行只留再生成。 -->
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
                :title="messageIndex !== messages.length - 1 ? '只有最后一条回答能重新生成（换中间那条会把后面的历史弄丢；想留退路就在那句问句上分一支）' : '用同一个问题再生成一次'"
                aria-label="重新生成"
                @click="regenerate(message)"
              ><WorkbenchIcon name="refresh" :size="13" /></button>
              <span class="authoring-knowledge__usage" data-test="usage-chip" :title="message.usage ? '这一轮模型给出的用量' : '这一轮没有给出用量'">{{ usageText(message) }}</span>
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
      <!-- 〔批次68-R2 任务三〕composer 卡片三层（参照 Linear 风截图）：
           ①输入行（typeahead 弹层原地不动，判定/回填仍是 composerTypeahead 那一条纯通路）
           ②控件排（卡片内底部）：左「＋」插入菜单与写模式 chip，右模型 chip 与发送位。
             麦克风**不摆死钮**——语音后端本批不做，这一排就没有它。 -->
      <div class="nx-composer-card" data-test="composer-card">
        <div class="authoring-knowledge__input-row">
          <!-- 〔批次77 任务3〕typeahead 弹层：三类触发符共用这一层（判定与菜单在 composerTypeahead.mjs）。
               头一行教键位——↑↓／Enter／Tab／Esc 这四件事在老版是两套各写一遍的键盘逻辑，
               谁能用哪个键没人说得清；现在只有一条序列，就把那条序列写在菜单头上。 -->
          <div
            v-if="composerMenu"
            class="authoring-knowledge__typeahead"
            data-test="composer-menu"
            role="listbox"
            :aria-label="`补全菜单（${composerToken?.trigger ?? ''}）`"
          >
            <p class="authoring-knowledge__typeahead-keys">↑↓ 移动 · Enter 选中 · Tab 补全 · Esc 关闭</p>
            <p v-if="composerMenu.empty" class="authoring-knowledge__typeahead-empty" data-test="composer-empty">{{ composerMenu.empty.label }}</p>
            <template v-for="group in composerMenu.groups" :key="`${group.kind}-${group.label}`">
              <p class="authoring-knowledge__typeahead-group">{{ group.label }}</p>
              <button
                v-for="item in group.items"
                :key="item.key"
                type="button"
                class="authoring-knowledge__typeahead-item"
                :class="{ 'is-active': composerItems[menuIndex] === item }"
                role="option"
                :aria-selected="(composerItems[menuIndex] === item).toString()"
                :data-item-kind="item.kind"
                @mousedown.prevent
                @click="pickComposerItem(item)"
              >
                <span class="authoring-knowledge__typeahead-label">{{ item.label }}</span>
                <span v-if="item.hint" class="authoring-knowledge__typeahead-hint">{{ item.hint }}</span>
              </button>
            </template>
          </div>

          <textarea
            ref="textareaRef"
            v-model="draft"
            rows="1"
            :placeholder="placeholder"
            aria-label="向助手提问"
            :disabled="disabled || busy"
            @keydown="onKeydown"
            @input="onInput"
            @click="refreshComposer"
            @keyup.arrow-left="refreshComposer"
            @keyup.arrow-right="refreshComposer"
            @blur="composerToken = null"
          />
        </div>

        <div class="nx-composer-controls" data-test="composer-controls">
          <div class="nx-composer-controls-primary">
            <div ref="plusRoot" class="nx-composer-plus-wrap">
              <button
                type="button"
                class="control-icon nx-composer-plus"
                data-test="composer-plus"
                :aria-expanded="plusOpen.toString()"
                :disabled="disabled || busy"
                title="插入：@素材 · / 技能与命令 · #工作流角色"
                @click="plusOpen = !plusOpen"
              >＋</button>
              <div v-if="plusOpen" class="nx-composer-plus-menu" data-test="composer-plus-menu" role="menu" aria-label="插入菜单">
                <button
                  v-for="trigger in INSERT_TRIGGERS"
                  :key="trigger.char"
                  type="button"
                  class="nx-row nx-composer-plus-item"
                  role="menuitem"
                  @click="pickInsert(trigger)"
                ><span class="nx-composer-plus-char">{{ trigger.char }}</span>{{ trigger.label }}</button>
              </div>
            </div>
            <!-- 写模式 chip：原页眉那枚徽标收进来（类名与 requestMode／确认行／禁用态口径一字不动）。 -->
            <!-- 写模式 chip：原页眉那枚徽标收进来（类名与 requestMode／确认行口径一字不动，也不新加禁用态；
                 那个 ▾ 走 CSS ::after——文本读数钉着「审阅／自动／锁定」三个词，不许把箭头混进读数里）。 -->
            <button
              type="button"
              class="authoring-knowledge__mode-badge"
              :class="modeClass"
              :title="modeTitle"
              :aria-pressed="pendingAuto.toString()"
              @click="requestMode"
            >{{ modeLabel }}</button>
          </div>

          <div class="nx-composer-controls-secondary">
            <!-- 模型 chip：显示当前模型名，点开列运行时模型面清单——**无清单时只显示不可点（不编造）**。
                 本批探针通路只有 endpoint 与状态、没有模型名，运行时多半传下来空数组，画的就是那行如实的「模型未回报」。 -->
            <div ref="modelRoot" class="nx-composer-model-wrap">
              <button
                type="button"
                class="control-quiet nx-composer-model"
                data-test="composer-model-chip"
                :disabled="!modelNames.length"
                :aria-expanded="modelOpen ? 'true' : 'false'"
                :title="modelNames.length ? '运行时模型面清单' : '运行时未回报模型清单（只显示，不当死钮）'"
                @click="modelOpen = !modelOpen"
              >{{ modelChipText }}<span v-if="modelNames.length" aria-hidden="true" class="nx-composer-caret">▾</span></button>
              <ul v-if="modelOpen && modelNames.length" class="nx-composer-model-list" data-test="composer-model-list">
                <li v-for="name in modelNames" :key="name">{{ name }}</li>
              </ul>
            </div>
            <!-- 〔批次77 任务3〕停止钮：只在真有一问在途时出现，且就站在发送钮那一格。点下去的动作是
                 「问主进程把这一问标成已取消」，落不落得停由运行那条链在轮次边界上说了算——界面不自己先把状态改成「已停」。 -->
            <button
              v-if="busy"
              type="button"
              class="authoring-knowledge__stop"
              data-test="composer-stop"
              aria-label="停止这一问"
              title="停止：这一轮跑完后不再续轮（已跑的部分照常留在会话里）"
              :disabled="disabled"
              @click="emit('stop')"
            >
              <WorkbenchIcon name="stop" :size="17" />
            </button>
            <button
              v-else
              type="button"
              class="authoring-knowledge__send"
              aria-label="发送问题"
              :disabled="disabled || !draft.trim()"
              @click="submit"
            >
              <WorkbenchIcon name="arrow-up" :size="19" />
            </button>
          </div>
        </div>
      </div>

      <!-- 自动档确认行（M2.5-B）：文案与三枚钮一字未动，只是挪到卡片下方——chip 长在卡里，确认就该跟在卡后。 -->
      <div v-if="pendingAuto" class="authoring-knowledge__mode-confirm" role="alertdialog" aria-label="切换写模式">
        <span class="authoring-knowledge__mode-confirm-text">自动模式下，AI 的产出会直接写入正文，不再走提案。只对当前项目生效。</span>
        <button type="button" class="authoring-knowledge__mode-confirm-ok" @click="confirmAuto">确认切换</button>
        <!-- 〔批次77 任务3〕第三档 blocked 的入口（词表已有、UI 只判前两档那处补齐）：
             它与 auto 是相反方向（更保守），所以不进那句「直接写入」的确认语，单列一枚钮说明白。 -->
        <button
          type="button"
          class="authoring-knowledge__mode-confirm-blocked"
          data-test="mode-blocked"
          title="锁定模式：写入一律被拒，也不出提案（比审阅更保守，不需要确认）"
          @click="confirmBlocked"
        >切到锁定（只读）</button>
        <button type="button" class="authoring-knowledge__mode-confirm-cancel" @click="cancelAuto">取消</button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
/* legacy-copied：度量与配色逐条抄自 src/components/authoring/AuthoringKnowledgeAssistant.vue（老版原话）。
   〔批次68-R1 任务2〕这一块**字号不再享受 legacy-copied 的裸 px 豁免**：复用老版的是形态与间距，字号刻度必须和壳层同一本——
   14/13/12/11 与 .88em／.92em／1.08em 那些散档全部归进 --nx-* 五档，`font:` 简写拆成三行
   （var() 进简写在部分解析路径不可靠，拆行后门禁也能逐条数）。老版那几档圆角仍是原度量，走 legacy-copied 例外。
   判据见 next/tests/visual-contract.test.mjs 的门禁⑭（字号单轨，整块不跳过）。 */
.authoring-knowledge { position: relative; display: flex; min-width: 0; min-height: 0; height: 100%; flex-direction: column; color: var(--text-primary); background: var(--surface-assistant); font-family: var(--font-interface); font-size: var(--nx-fs-md); line-height: 1.5; }
.authoring-knowledge__toolbar { display: flex; min-height: 52px; box-sizing: border-box; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 12px 7px 14px; border-bottom: 0; }
.authoring-knowledge__toolbar-primary { min-width: 0; }
.authoring-knowledge__model { display: grid; min-width: 0; gap: 1px; }
.authoring-knowledge__model strong { overflow: hidden; font-size: var(--nx-fs-md); font-weight: 560; text-overflow: ellipsis; white-space: nowrap; }
.authoring-knowledge__body { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
.authoring-knowledge__intro { width: 100%; flex: none; margin: 0 auto 32px; text-align: center; }
.authoring-knowledge__intro h3 { margin: 0; color: var(--archive-ink); font-family: var(--font-interface); font-size: var(--nx-fs-2xl); font-weight: 500; line-height: 1.45; letter-spacing: -.025em; }
/* 起始态那句引导语是老版左对齐的，老版靠 body 的 gutter（--assistant-gutter: 16px）让它离边；
   这份拷贝少了那条 gutter，手机上那句会贴着屏幕边。 */
.authoring-knowledge.is-starting .authoring-knowledge__body { padding-inline: 16px; }
.authoring-knowledge.is-starting .authoring-knowledge__intro { margin-bottom: 20px; }
.authoring-knowledge.is-starting .authoring-knowledge__intro h3 { line-height: 1.55; text-align: start; }
.authoring-knowledge__thread { position: relative; min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 20px 16px 28px; scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
.authoring-knowledge__question-row { display: flex; align-items: center; gap: 6px; width: fit-content; max-width: min(100%, calc(88% + 38px)); margin: 0 0 22px auto; }
.authoring-knowledge__question { min-width: 0; width: fit-content; max-width: 100%; margin: 0; padding: 10px 16px; border-radius: 18px; background: var(--surface-workbench-input); overflow-wrap: anywhere; }
.authoring-knowledge__question p { margin: 0; font-family: var(--font-interface); font-size: var(--nx-fs-lg); line-height: 1.7; }
.authoring-knowledge__answer { margin: 0 0 32px; }
.authoring-knowledge__answer-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; color: var(--text-secondary); font-family: var(--font-interface); font-size: var(--nx-fs-md); line-height: 1.5; }
.authoring-knowledge__answer-meta > span { display: inline-flex; align-items: center; gap: 6px; color: var(--text-primary); font-weight: 500; }
.authoring-knowledge__answer-meta time { color: var(--text-muted); font-size: var(--nx-fs-2xs); }
.authoring-knowledge__answer-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-interface); font-size: var(--nx-fs-lg); line-height: 1.85; }
/* 批次77 任务1：助手正文走 mdRender（与阅读面同一条渲染链）。下面这一组逐条抄自
   src/components/authoring/AuthoringKnowledgeAssistant.vue:740-757 的 :deep() md 规则——
   老版会话面的 md 度量就是它，不再另立一套。markdown 版式自己管段落间距，
   所以先把上面那条 pre-wrap 关掉（否则 marked 出的 <p> 会把源码里的换行再折一次）。 */
.authoring-knowledge__markdown { white-space: normal; }
.authoring-knowledge__markdown :deep(p) { margin: 0 0 1em; }
.authoring-knowledge__markdown :deep(> :first-child) { margin-top: 0; }
.authoring-knowledge__markdown :deep(> :last-child) { margin-bottom: 0; }
.authoring-knowledge__markdown :deep(h1) { font-size: var(--nx-fs-2xl); }
.authoring-knowledge__markdown :deep(h2) { font-size: var(--nx-fs-xl); }
.authoring-knowledge__markdown :deep(h3) { font-size: var(--nx-fs-lg); }
.authoring-knowledge__markdown :deep(h4), .authoring-knowledge__markdown :deep(h5), .authoring-knowledge__markdown :deep(h6) { font-size: var(--nx-fs-md); }
.authoring-knowledge__markdown :deep(h1), .authoring-knowledge__markdown :deep(h2), .authoring-knowledge__markdown :deep(h3), .authoring-knowledge__markdown :deep(h4), .authoring-knowledge__markdown :deep(h5), .authoring-knowledge__markdown :deep(h6) { margin: 1.3em 0 .55em; color: var(--text-primary); font-weight: 600; line-height: 1.5; }
.authoring-knowledge__markdown :deep(strong) { font-weight: 600; }
.authoring-knowledge__markdown :deep(ul), .authoring-knowledge__markdown :deep(ol) { margin: .6em 0 1em; padding-inline-start: 1.5em; }
.authoring-knowledge__markdown :deep(li) { margin: .35em 0; padding-inline-start: .2em; }
.authoring-knowledge__markdown :deep(li > p) { margin: .35em 0; }
.authoring-knowledge__markdown :deep(hr) { margin: 1.3em 0; border: 0; border-top: 1px solid var(--hairline-soft); }
.authoring-knowledge__markdown :deep(blockquote) { margin: 1em 0; padding-inline-start: 1em; border-inline-start: 2px solid var(--hairline-soft); color: var(--text-secondary); }
.authoring-knowledge__markdown :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.authoring-knowledge__markdown :deep(pre) { max-width: 100%; overflow-x: auto; margin: 1em 0; padding: 12px; background: var(--surface-workbench-muted); border-radius: var(--radius-control); font-size: var(--nx-fs-md); line-height: 1.6; }
.authoring-knowledge__markdown :deep(code) { font-family: var(--font-mono); font-size: var(--nx-fs-md); white-space: pre-wrap; }
.authoring-knowledge__markdown :deep(pre code) { white-space: pre; }
.authoring-knowledge__markdown :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 1em 0; font-size: var(--nx-fs-md); }
.authoring-knowledge__markdown :deep(th), .authoring-knowledge__markdown :deep(td) { padding: 6px 10px; border-bottom: 1px solid var(--hairline-soft); text-align: start; }
.authoring-knowledge__markdown :deep(img) { max-width: 100%; height: auto; }
.authoring-knowledge__thinking { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: var(--nx-fs-md); }
/* 〔批次77 任务4〕在途那一问的平铺时间线：紧跟状态行，自己不额外撑出一段空。 */
.authoring-knowledge__live-trail { margin-top: 4px; }
.authoring-knowledge__thinking span { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-primary, var(--accent)); animation: knowledge-pulse 900ms ease-in-out infinite alternate; }
.authoring-knowledge__error { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; margin-top: 10px; padding: 9px 10px; border: 0; border-radius: 12px; background: var(--archive-paper); color: var(--text-secondary); font-size: var(--nx-fs-md); text-align: start; }
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
.authoring-knowledge__input-row textarea { display: block; box-sizing: border-box; flex: none; width: 100%; min-width: 0; min-height: 28px; max-height: 160px; resize: none; border: 0; outline: 0; padding: 0 4px; background: transparent; color: var(--text-primary); font-family: var(--font-interface); font-size: var(--nx-fs-lg); line-height: 28px; }
.authoring-knowledge__input-row textarea::placeholder { color: var(--text-muted); opacity: 1; }
.authoring-knowledge__composer-actions { display: flex; min-width: 0; align-items: center; flex-wrap: nowrap; gap: 4px; }
.authoring-knowledge__send { display: grid; flex: none; width: var(--workspace-control-height, 36px); height: var(--workspace-control-height, 36px); margin-inline-start: auto; place-items: center; border: 0; border-radius: 50%; background: var(--workbench-action); color: var(--workbench-action-text); cursor: pointer; }
.authoring-knowledge__send:hover:not(:disabled) { background: var(--workbench-action-hover); color: var(--workbench-action-text); }
.authoring-knowledge__send:disabled { background: var(--nav-hover); color: var(--text-muted); cursor: default; }
.authoring-knowledge button:focus-visible, .authoring-knowledge summary:focus-visible { outline: 2px solid var(--workbench-focus); outline-offset: 3px; }
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
/* 〔批次77 任务3〕第三档 blocked：徽标与确认行都认得它（老代码只判 review／auto，
   锁定时徽标会错着 auto 的色）。这一档比审阅更保守，所以它是冷色，不借用 auto 那支暖色。 */
.authoring-knowledge__mode-badge.is-blocked { color: var(--control-danger); border-color: color-mix(in srgb, var(--control-danger) 32%, transparent); }
.authoring-knowledge__mode-confirm-blocked { flex: none; display: inline-flex; align-items: center; min-height: 24px; padding: 2px 8px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-control, 10px); background: transparent; color: var(--text-muted); font-size: var(--nx-fs-2xs, 11px); cursor: pointer; }
.authoring-knowledge__mode-confirm-blocked:hover { color: var(--control-danger); border-color: color-mix(in srgb, var(--control-danger) 32%, transparent); }
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

/* 〔批次77 任务3〕typeahead 弹层：三类触发符共用这一层（老版是 ref-pop 与 slash-hint 两层、两套键盘）。
   位置仍贴输入行上缘（input-row 已是 relative），词汇与层序沿用那一份。 */
.authoring-knowledge__typeahead { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); z-index: var(--z-popover); max-height: 300px; overflow-y: auto; padding: 6px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-control); background: var(--surface-workbench-raised); box-shadow: 0 10px 28px color-mix(in srgb, var(--archive-ink) 18%, transparent); scrollbar-width: thin; }
.authoring-knowledge__typeahead-keys { margin: 2px 8px 4px; color: var(--text-muted); font-size: var(--nx-fs-2xs); letter-spacing: .04em; }
.authoring-knowledge__typeahead-group { margin: 6px 8px 2px; color: var(--text-muted); font-size: var(--nx-fs-2xs); }
.authoring-knowledge__typeahead-item { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; padding: 5px 8px; border: 0; border-radius: var(--nx-radius-xs); background: transparent; color: var(--archive-ink); font-size: var(--nx-fs-md); text-align: start; cursor: pointer; }
.authoring-knowledge__typeahead-item.is-active, .authoring-knowledge__typeahead-item:hover { background: var(--nav-hover); }
.authoring-knowledge__typeahead-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.authoring-knowledge__typeahead-hint { flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: var(--nx-fs-2xs); }
/* 空态那一行是**一句实话**，不是一枚点不动的钮（工单：不留死钮）——所以它没有 button 皮，也不参与高亮序列。 */
.authoring-knowledge__typeahead-empty { margin: 4px 8px; color: var(--text-muted); font-size: var(--nx-fs-2xs); line-height: 1.6; }
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
/* 〔批次77-R2 任务6〕分支切换器：‹› 两个字符本体很小，命中区靠固定 24×24 撑开
   （批次76 那条度量闸按 min-width/min-height: 24px 量，不靠 padding 猜——padding 会随字号漂）。
   整条不跟随 .row-actions 的 opacity：分叉后「看的是第几支」要一直在眼前。 */
.authoring-knowledge__branch-nav { display: inline-flex; align-items: center; gap: 1px; flex: none; color: var(--text-muted); }
.authoring-knowledge__branch-step { display: inline-flex; align-items: center; justify-content: center; width: 24px; min-width: 24px; height: 24px; min-height: 24px; padding: 0; border: 0; border-radius: var(--nx-radius-xs); background: transparent; color: var(--text-muted); font-size: var(--nx-fs-md); line-height: 1; cursor: pointer; }
.authoring-knowledge__branch-step:hover:not(:disabled) { color: var(--text-primary); background: var(--nav-hover); }
.authoring-knowledge__branch-step:focus-visible { outline: 2px solid var(--workbench-selected); outline-offset: 1px; color: var(--text-primary); }
.authoring-knowledge__branch-step:disabled { cursor: not-allowed; opacity: 0.45; }
.authoring-knowledge__branch-count { min-width: 24px; min-height: 24px; display: inline-flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; font-size: var(--nx-fs-2xs); }
.authoring-knowledge__row-time { margin-inline-end: 4px; color: var(--text-muted); font-size: var(--nx-fs-2xs); font-variant-numeric: tabular-nums; }
/* token chip：也是 hover 才现的一格。没有回报时是那六个字，不是 0（守卫⑦）。 */
.authoring-knowledge__usage { margin-inline-start: 6px; color: var(--text-muted); font-size: var(--nx-fs-2xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 状态那一格（常驻）：盖过 legacy-copied 块里 `.answer-meta > span` 的那一份强调样式。 */
.authoring-knowledge__answer-meta > .authoring-knowledge__answer-status { margin-inline-start: auto; color: var(--text-muted); font-weight: 400; font-size: var(--nx-fs-2xs); letter-spacing: .02em; }
.authoring-knowledge__answer-meta > .authoring-knowledge__answer-status[data-status='error'] { color: var(--danger); }
.authoring-knowledge__answer-meta > .authoring-knowledge__answer-status[data-status='stopped'] { color: var(--signal-warm); }
.authoring-knowledge__answer-meta > .authoring-knowledge__answer-status[data-status='streaming'] { color: var(--accent); }

/* 〔批次77 任务3〕停止钮：与发送钮同族同尺寸（命中区走既有 --workspace-control-height，
   不自立一档数值），只是配色取「会被拒」那一支——它是收手，不是提交。 */
.authoring-knowledge__stop { display: grid; flex: none; width: var(--workspace-control-height, 36px); height: var(--workspace-control-height, 36px); place-items: center; border: 1px solid color-mix(in srgb, var(--control-danger) 32%, transparent); border-radius: 50%; background: transparent; color: var(--control-danger); cursor: pointer; }
.authoring-knowledge__stop:hover:not(:disabled) { background: color-mix(in srgb, var(--control-danger) 10%, transparent); }
.authoring-knowledge__stop:disabled { color: var(--text-muted); border-color: var(--hairline-soft); cursor: default; }
</style>

<style scoped>
/* 〔批次68-R2 任务三〕composer 卡片三层（参照 Linear 风截图逐项）：卡片自己吃边框与圆角，
   老 input-row 那一份度量在卡内让位（选择器家族 .authoring-knowledge__input-row textarea 原样保留，
   钉着它的三十多条用例一条不动）。字号/圆角一律走 token 刻度——visual-contract 门禁⑭⑮受管。
   麦克风不摆死钮：语音后端本批不做，这一排没有它，屏上也不许出现点了没反应的占位。 */
.nx-composer-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--hairline-soft); border-radius: var(--radius-surface); background: var(--surface-workbench-input); }
.nx-composer-card:focus-within { outline: 2px solid var(--workbench-focus); outline-offset: 1px; border-color: transparent; }
.nx-composer-card .authoring-knowledge__input-row { min-height: 0; padding: 0; border: 0; background: transparent; box-shadow: none; }
.nx-composer-card .authoring-knowledge__input-row:focus-within { outline: 0; }
.nx-composer-controls { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; }
.nx-composer-controls-primary { display: flex; align-items: center; min-width: 0; gap: 6px; flex: none; }
.nx-composer-controls-secondary { display: flex; align-items: center; justify-content: flex-end; min-width: 0; gap: 6px; flex: 1 1 auto; }
.nx-composer-plus-wrap, .nx-composer-model-wrap { position: relative; flex: none; }
.nx-composer-plus { display: grid; width: 28px; height: 28px; place-items: center; padding: 0; border: 1px solid var(--hairline-soft); border-radius: var(--nx-radius-xs); background: transparent; color: var(--text-secondary); font-size: var(--nx-fs-lg); line-height: 1; cursor: pointer; }
.nx-composer-plus:hover:not(:disabled) { background: var(--nav-hover); color: var(--text-primary); }
.nx-composer-plus:disabled { color: var(--text-muted); cursor: default; }
.nx-composer-plus-menu { position: absolute; z-index: var(--z-popover, 30); bottom: calc(100% + 6px); left: 0; display: flex; min-width: 172px; flex-direction: column; gap: 2px; padding: 6px; border: 1px solid var(--hairline-soft); border-radius: var(--nx-radius-xs); background: var(--surface-workbench-raised); }
.nx-composer-plus-item { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 8px; border: 0; border-radius: var(--nx-radius-xs); background: transparent; color: var(--text-primary); font-family: var(--font-interface); font-size: var(--nx-fs-md); text-align: start; cursor: pointer; }
.nx-composer-plus-item:hover { background: var(--nav-hover); }
.nx-composer-plus-char { flex: none; width: 18px; color: var(--accent); font-family: var(--font-interface); font-size: var(--nx-fs-md); font-weight: 600; text-align: center; }
.nx-composer-caret { margin-left: 4px; font-size: var(--nx-fs-2xs); }
/* 写模式 chip 的 ▾ 走伪元素：徽标的文本读数被用例钉着「审阅／自动／锁定」三个词，箭头不许混进读数。 */
.authoring-knowledge__mode-badge::after { content: '▾'; margin-left: 4px; font-size: var(--nx-fs-2xs); }
.nx-composer-model { display: inline-flex; max-width: 168px; min-height: 24px; align-items: center; padding: 2px 8px; border: 1px solid var(--hairline-soft); border-radius: var(--nx-radius-pill); background: transparent; color: var(--text-muted); font-size: var(--nx-fs-2xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nx-composer-model:not(:disabled) { color: var(--text-secondary); cursor: pointer; }
.nx-composer-model-list { position: absolute; z-index: var(--z-popover, 30); right: 0; bottom: calc(100% + 6px); display: flex; min-width: 168px; flex-direction: column; gap: 2px; margin: 0; padding: 6px; list-style: none; border: 1px solid var(--hairline-soft); border-radius: var(--nx-radius-xs); background: var(--surface-workbench-raised); color: var(--text-primary); font-size: var(--nx-fs-md); }
</style>
