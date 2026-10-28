<script setup>
import { computed, onMounted, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'

/**
 * 偏好与模型 Section（工单C0 内容组件化 · 批次8① 的弹窗内容原样搬入统一二级页）。
 * 功能语义一字未改，只把状态搬进节内：桥经 props 注入，动作结果经事件上交
 * （theme→外壳换肤、close→关统一弹窗）——抽取模式同 AssistantDialog 从
 * AuthoringKnowledgeAssistant 的抽取（先例见 next/shell/AssistantDialog.vue 头注：
 * 容器持有桥，展示件发事件）。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  /** 当前主题（浅/深），节挂载时作为单选的初值。 */
  scheme: { type: String, default: 'light' }
})
const emit = defineEmits(['theme', 'close', 'changed'])

const prefsDraft = ref({ modelPlaneEndpoint: '', uiZoom: 0.85 })
const prefsBusy = ref(false)
const prefsFeedback = ref(null)
const probeState = ref(null)
const probeClass = computed(() => ({ ready: 'is-ready', 'no-model': 'is-warn', unreachable: 'is-error' })[probeState.value?.state ?? ''] ?? 'is-warn')
const probeText = computed(() => {
  const state = probeState.value
  if (!state) return ''
  if (state.state === 'ready') return `模型面就绪：${state.endpoint}`
  if (state.state === 'no-model') return `任务面可达但未配模型：请在 serve:pinax 一侧选择模型（${state.endpoint}）`
  return `模型面不可达：${state.endpoint}${state.detail ? `（${state.detail}）` : ''}。请启动 pi-agent 任务面（serve:pinax）或修改端点。`
})
/** 外观主题走 theme.mjs 的 localStorage 契约（与老前端共用 app_theme），偏好面只给它一个入口。 */
const themeDraft = ref(props.scheme)

onMounted(() => {
  // 每次摊开节都从当前偏好取值（原 openSettings 的装载段；v-if 使节随目录切换重挂，状态天然归零）。
  themeDraft.value = props.scheme
  if (!props.bridge?.request) return
  void loadPrefs()
})

async function loadPrefs() {
  const result = await props.bridge.request(IPC_CHANNELS.prefsGet, {})
  if (result.ok) {
    prefsDraft.value = {
      modelPlaneEndpoint: result.value.modelPlaneEndpoint ?? '',
      uiZoom: result.value.uiZoom ?? 0.85
    }
  }
}

async function probePlane() {
  if (!props.bridge?.request || prefsBusy.value) return
  prefsBusy.value = true
  probeState.value = null
  const result = await props.bridge.request(IPC_CHANNELS.prefsProbeModelPlane, {})
  prefsBusy.value = false
  probeState.value = result.ok ? result.value : { state: 'unreachable', endpoint: '', detail: result.error?.message ?? '探测失败' }
}

async function savePrefs() {
  if (!props.bridge?.request || prefsBusy.value) return
  prefsBusy.value = true
  prefsFeedback.value = null
  const result = await props.bridge.request(IPC_CHANNELS.prefsSet, {
    modelPlaneEndpoint: String(prefsDraft.value.modelPlaneEndpoint || '').trim() || null,
    uiZoom: Number(prefsDraft.value.uiZoom)
  })
  prefsBusy.value = false
  prefsFeedback.value = result.ok
    ? { kind: 'ok', text: '已保存并生效。' }
    : { kind: 'error', text: result.error?.message ?? '保存失败。' }
}

/** 偏好面里的主题选择：写回 localStorage 契约的事交回外壳做（竖条的明暗按钮跟着变）。 */
function applyThemeChoice() {
  emit('theme', themeDraft.value)
}
</script>

<template>
  <div>
    <p class="wizard-note">应用级偏好，不随项目走。模型凭据仍由任务面（serve:pinax）持有——这里只决定「任务面在哪个端点」与界面观感。</p>
    <div class="prefs-grid">
      <div class="prefs-row">
        <span class="prefs-row-label">外观主题</span>
        <label class="wizard-companion"><input v-model="themeDraft" type="radio" name="prefs-theme" value="light" @change="applyThemeChoice"> 浅色</label>
        <label class="wizard-companion"><input v-model="themeDraft" type="radio" name="prefs-theme" value="dark" @change="applyThemeChoice"> 深色</label>
        <span class="prefs-row-hint">与老前端共用同一份偏好，改了那边也跟着变</span>
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">模型面端点</span>
        <input v-model="prefsDraft.modelPlaneEndpoint" class="nx-field prefs-input" type="text" placeholder="http://127.0.0.1:8451（留空＝默认 8451）">
        <button type="button" class="control-secondary" :disabled="prefsBusy" @click="probePlane">检测模型面</button>
      </div>
      <p v-if="probeState" class="prefs-state" :class="probeClass">{{ probeText }}</p>
      <div class="prefs-row">
        <span class="prefs-row-label">界面缩放</span>
        <input v-model.number="prefsDraft.uiZoom" class="nx-field prefs-zoom" type="number" min="0.5" max="2" step="0.05">
        <span class="prefs-row-hint">0.5–2.0，保存即生效</span>
      </div>
      <div class="prefs-actions">
        <button type="button" class="control-primary" :disabled="prefsBusy" @click="savePrefs">保存并生效</button>
        <button type="button" class="control-quiet" @click="emit('close')">关闭</button>
        <span v-if="prefsFeedback" class="prefs-state" :class="prefsFeedback.kind === 'ok' ? 'is-ready' : 'is-error'">{{ prefsFeedback.text }}</span>
      </div>
    </div>
  </div>
</template>
