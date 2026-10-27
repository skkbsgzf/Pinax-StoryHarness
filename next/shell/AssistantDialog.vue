<script setup>
import { nextTick, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'

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
 */
const props = defineProps({
  /** 会话面：[{ id, role:'user'|'agent', text, findings:[], actions:[], failed:boolean, at:string }] */
  messages: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  /** 没有桥（渲染层没接主进程）时为真：输入框禁用。 */
  disabled: { type: Boolean, default: false },
  title: { type: String, default: 'Pi-Agent' },
  placeholder: { type: String, default: '就当前项目问一句话…' },
  /** 折叠层的工具名清单（默认不展开）。 */
  tools: { type: Array, default: () => [] }
})
const emit = defineEmits(['send', 'retry'])

const draft = ref('')
const threadRef = ref(null)

function submit() {
  const text = draft.value.trim()
  if (!text || props.busy || props.disabled) return
  emit('send', text)
  draft.value = ''
}

/** 老版的口径：Enter 发送，Shift+Enter 换行，中文输入法组字时不抢键。 */
function onKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}

watch(() => props.messages.length, async () => {
  await nextTick()
  if (threadRef.value) threadRef.value.scrollTop = threadRef.value.scrollHeight
}, { immediate: true })
</script>

<template>
  <section class="authoring-knowledge" :class="{ 'is-starting': !messages.length }" aria-label="Pi-Agent 对话">
    <header class="authoring-knowledge__toolbar">
      <div class="authoring-knowledge__toolbar-primary">
        <div class="authoring-knowledge__model">
          <strong>{{ title }}</strong>
        </div>
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
              <p>{{ message.text }}</p>
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
          </article>
        </template>

        <div v-if="busy" class="authoring-knowledge__thinking" role="status">
          <span aria-hidden="true"></span>正在核对项目资料…
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
          v-model="draft"
          rows="1"
          :placeholder="placeholder"
          aria-label="向助手提问"
          :disabled="disabled || busy"
          @keydown="onKeydown"
        />
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
   Next 自己加的样式在第二个 style 块（审稿意见／可执行动作），走 --nx-* 刻度，受门禁管。 */
.authoring-knowledge { position: relative; display: flex; min-width: 0; min-height: 0; height: 100%; flex-direction: column; color: var(--text-primary); background: var(--surface-assistant); font: 14px/1.5 var(--font-interface, var(--font-sans)); }
.authoring-knowledge__toolbar { display: flex; min-height: 52px; box-sizing: border-box; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 12px 7px 14px; border-bottom: 0; }
.authoring-knowledge__toolbar-primary { min-width: 0; }
.authoring-knowledge__model { display: grid; min-width: 0; gap: 1px; }
.authoring-knowledge__model strong { overflow: hidden; font-size: 14px; font-weight: 560; text-overflow: ellipsis; white-space: nowrap; }
.authoring-knowledge__body { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
.authoring-knowledge__intro { width: 100%; flex: none; margin: 0 auto 32px; text-align: center; }
.authoring-knowledge__intro h3 { margin: 0; color: var(--archive-ink); font: 500 21px/1.45 var(--font-interface, var(--font-sans)); letter-spacing: -.025em; }
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
