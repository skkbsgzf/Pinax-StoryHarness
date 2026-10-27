<script setup>
import { computed, ref } from 'vue'
import AssistantDialog from './AssistantDialog.vue'
import { IPC_CHANNELS } from './ipcContract.mjs'

/**
 * 右栏：Agent 的对话框。
 *
 * 作者口径：Agent 就是一个纯粹的对话框，界面形态直接抽自老前端的作品资料助手
 * （AssistantDialog.vue，从 src/components/authoring/AuthoringKnowledgeAssistant.vue 抽象而来），
 * 不再另起一套「运行时说明书」。
 *
 * 这一层只管三件事：把提问送进 runtime:ask 通道、把回答排成会话、记住最后一轮以便重试。
 * 工具面之类的开发者向事实折在对话框底部的折叠层里——老版就是这么处理的。
 */
const props = defineProps({
  runtime: { type: Object, required: true },
  bridge: { type: Object, default: null }
})

const messages = ref([])
const busy = ref(false)
const lastQuestion = ref('')
const canAsk = computed(() => Boolean(props.bridge?.request))
const tools = computed(() => props.runtime.tools.map((tool) => ({ name: tool.name })))

let seq = 0
const nextId = () => `m-${++seq}`

function stamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

async function ask(text) {
  const question = String(text ?? '').trim()
  if (!question || busy.value || !canAsk.value) return
  lastQuestion.value = question
  messages.value.push({ id: nextId(), role: 'user', text: question, at: stamp() })
  await runQuestion(question)
}

async function runQuestion(question) {
  busy.value = true
  const result = await props.bridge.request(IPC_CHANNELS.runtimeAsk, { question })
  busy.value = false
  if (result.ok) {
    const value = result.value ?? {}
    const payload = value.result ?? null
    messages.value.push({
      id: nextId(),
      role: 'agent',
      text: value.text ?? '',
      findings: (payload?.issues ?? []).filter((item) => item && typeof item.message === 'string'),
      actions: (payload?.action ?? []).filter((item) => typeof item === 'string'),
      at: stamp()
    })
    return
  }
  messages.value.push({
    id: nextId(),
    role: 'agent',
    failed: true,
    text: result.error?.message ?? '内核拒绝了这一问。',
    at: stamp()
  })
}

function retry() {
  const question = lastQuestion.value
  if (!question || busy.value) return
  // 去掉那条失败的回答重问一遍；提问那一行留在会话里（它已经问过了）。
  if (messages.value.at(-1)?.failed) messages.value.pop()
  void runQuestion(question)
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
      @send="ask"
      @retry="retry"
    />
    <p v-if="!canAsk" class="dock-hint">渲染层未接主进程桥（preload 的 pinaxNext 通道）。</p>
  </aside>
</template>
