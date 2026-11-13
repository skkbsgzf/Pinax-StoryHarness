<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'
import {
  canResetSection,
  fieldStyleVars,
  resetSectionDefaults,
  saveModelNote,
  SAVE_MODEL,
  validatePrefsDraft
} from './fields.mjs'

/**
 * 偏好与模型 Section（工单C0 内容组件化 · 批次8① 的弹窗内容原样搬入统一二级页）。
 * 功能语义一字未改，只把状态搬进节内：桥经 props 注入，动作结果经事件上交
 * （theme→外壳换肤、close→关统一弹窗）——抽取模式同 AssistantDialog 从
 * AuthoringKnowledgeAssistant 的抽取（先例见 next/shell/AssistantDialog.vue 头注：
 * 容器持有桥，展示件发事件）。
 *
 * 〔工单 P2〕字段行按统一规范重排（P2-1）：标签在上、控件在下、说明再一行；
 * 度量与默认值全部来自 ./fields.mjs（纯函数，单测对账），这里只负责摆。
 * 保存模型写明在节首（P2-2）：本节的端点/缩放是显式保存；外观主题选完即时换肤，
 * 自带一行说明——作者看这一节就能答「我改的东西什么时候生效」。
 * 保存失败就地报错、草稿原样保留（不整节重置）；本节底部「恢复本节默认」（P2-3）
 * 二次确认后只重置本节字段，缩放等副作用仍由主进程按 prefs:set 的既有链生效。
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
const fieldErrors = ref({})
const confirmReset = ref(false)
const probeState = ref(null)
const fieldVars = fieldStyleVars()
const saveModelText = saveModelNote(SAVE_MODEL.explicit)
const resetAvailable = canResetSection('prefs')
const probeClass = computed(() => ({ ready: 'is-ready', 'no-model': 'is-warn', unreachable: 'is-error' })[probeState.value?.state ?? ''] ?? 'is-warn')
/**
 * 〔批次68-R4 任务2〕探测结果三态是状态层，照留；话术与按钮同一词表（「模型服务」），
 * 机制细节（谁持有端点、进程名叫什么）不再写进常驻句子——挪到这一行的 title。
 * 上游那句真话（detail）原样带出，不加工。
 */
const probeText = computed(() => {
  const state = probeState.value
  if (!state) return ''
  const endpoint = state.endpoint ?? ''
  if (state.state === 'ready') return endpoint ? `模型服务就绪：${endpoint}` : '模型服务就绪'
  if (state.state === 'no-model') return `模型服务可达，但还没有可选的模型：请在模型服务里选定模型${endpoint ? `（${endpoint}）` : ''}`
  return `模型服务不可达${endpoint ? `：${endpoint}` : ''}${state.detail ? `（${state.detail}）` : ''}。请确认服务已经启动，或者改上面的端点再检测一次。`
})
/** 外观主题走 theme.mjs 的 localStorage 契约（与老前端共用 app_theme），偏好面只给它一个入口。 */
const themeDraft = ref(props.scheme)

onMounted(() => {
  // 每次摊开节都从当前偏好取值（原 openSettings 的装载段；v-if 使节随目录切换重挂，状态天然归零）。
  themeDraft.value = props.scheme
  // 〔工单 P2 · Esc 三级〕本节是第二级：恢复默认的二次确认开着时，Esc 先收确认、不关弹窗。
  // 挂 capture 阶段：底座弹窗的 Esc 监听在 window 冒泡阶段（底座组件第 57–62 行），
  // 这里 stopImmediatePropagation 就轮不到它；搜索框那级在 SettingsModal，注册更早、先跑（有词时它先拦）。
  window.addEventListener('keydown', onEscCancel, true)
  if (!props.bridge?.request) return
  void loadPrefs()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onEscCancel, true))

function onEscCancel(event) {
  if (event.key !== 'Escape' || !confirmReset.value) return
  event.stopImmediatePropagation()
  event.preventDefault()
  confirmReset.value = false
}

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

/** 后端拒绝时也落到字段下方：消息里点名哪个字段就归哪个，没点名就留一条总错误。 */
function setErrorsFromMessage(message) {
  const text = String(message ?? '')
  const next = {}
  if (/uiZoom/u.test(text)) next.uiZoom = '界面缩放没被接受：请填 0.5–2.0 之间的数。'
  else if (/modelPlaneEndpoint/u.test(text)) next.modelPlaneEndpoint = '端点没被接受：请写成 http(s)://… 或者留空。'
  return next
}

async function savePrefs() {
  if (!props.bridge?.request || prefsBusy.value) return
  // 先就地校验：有错不发送，草稿一个字都不动。
  const checked = validatePrefsDraft(prefsDraft.value)
  if (!checked.ok) {
    fieldErrors.value = checked.errors
    prefsFeedback.value = null
    return
  }
  prefsBusy.value = true
  prefsFeedback.value = null
  fieldErrors.value = {}
  const result = await props.bridge.request(IPC_CHANNELS.prefsSet, checked.patch)
  prefsBusy.value = false
  if (result.ok) {
    prefsFeedback.value = { kind: 'ok', text: '已保存并生效。' }
    return
  }
  const message = result.error?.message ?? '保存失败。'
  fieldErrors.value = setErrorsFromMessage(message)
  prefsFeedback.value = { kind: 'error', text: message }
}

/** 偏好面里的主题选择：写回 localStorage 契约的事交回外壳做（竖条的明暗按钮跟着变）。 */
function applyThemeChoice() {
  emit('theme', themeDraft.value)
}

/* —— P2-3 恢复本节默认 ————————————————————————————————————————————
 * 一次点击只是「请求」，摆出二次确认；确认后才写。只发本节默认值这一份 patch，
 * 其余偏好（写作排版／通知水位／最近库）一个都不在载荷里。 */
function requestReset() {
  if (!resetAvailable || prefsBusy.value) return
  confirmReset.value = true
  prefsFeedback.value = null
}

async function performReset() {
  if (!props.bridge?.request || prefsBusy.value) return
  const patch = resetSectionDefaults('prefs')
  if (!patch) return
  confirmReset.value = false
  prefsBusy.value = true
  prefsFeedback.value = null
  fieldErrors.value = {}
  const result = await props.bridge.request(IPC_CHANNELS.prefsSet, patch)
  prefsBusy.value = false
  if (!result.ok) {
    prefsFeedback.value = { kind: 'error', text: result.error?.message ?? '恢复默认失败。' }
    return
  }
  // 默认值回填成草稿的样子：端点空（＝默认地址）、缩放 0.85（存的是 null）。
  prefsDraft.value = { modelPlaneEndpoint: '', uiZoom: 0.85 }
  probeState.value = null
  prefsFeedback.value = { kind: 'ok', text: '已恢复本节默认。' }
}
</script>

<template>
  <div class="settings-fields" :style="fieldVars">
    <p class="settings-save-model" data-test="prefs-save-model">{{ saveModelText }}</p>
    <p class="wizard-note is-tight" title="模型凭据仍由模型服务自己持有——这里只决定「在哪个端点」与界面观感">应用级偏好，不随库走。</p>

    <!-- 外观主题：选完即生效，属于本节唯一一条即时生效的字段（自带说明，不混进「保存」）。 -->
    <div class="settings-field" data-test="prefs-field-theme">
      <span id="prefs-theme-label" class="settings-field-label">外观主题</span>
      <div class="settings-segmented" role="group" aria-labelledby="prefs-theme-label">
        <label class="wizard-companion"><input v-model="themeDraft" type="radio" name="prefs-theme" value="light" @change="applyThemeChoice"> 浅色</label>
        <label class="wizard-companion"><input v-model="themeDraft" type="radio" name="prefs-theme" value="dark" @change="applyThemeChoice"> 深色</label>
      </div>
      <!-- 〔批次68-R4 任务2〕存储机制（与老前端共用一份偏好）退到 title，正文给作者视角那句。 -->
      <p class="settings-field-hint" title="与老前端共用同一份偏好，改了那边也跟着变">选完立刻换肤，不用保存。</p>
    </div>

    <div class="settings-field" data-test="prefs-field-endpoint">
      <label class="settings-field-label" for="prefs-endpoint">模型服务端点</label>
      <div class="settings-field-row">
        <input
          id="prefs-endpoint"
          v-model="prefsDraft.modelPlaneEndpoint"
          class="nx-field prefs-input"
          type="text"
          placeholder="http://127.0.0.1:8451（留空＝默认 8451）"
          title="留空回到默认端点；模型凭据仍由模型服务自己持有，这里只改地址"
          :aria-invalid="fieldErrors.modelPlaneEndpoint ? 'true' : undefined"
          data-test="prefs-endpoint"
        >
        <button type="button" class="control-secondary" :disabled="prefsBusy" @click="probePlane">检测模型服务</button>
      </div>
      <p v-if="fieldErrors.modelPlaneEndpoint" class="settings-field-error" data-test="prefs-error-endpoint">{{ fieldErrors.modelPlaneEndpoint }}</p>
      <p class="settings-field-hint">留空＝默认 8451；改完点下面的「保存并生效」。</p>
    </div>

    <p v-if="probeState" class="prefs-state" :class="probeClass" title="模型服务＝本机 pi-agent 任务面（serve:pinax，默认 8451）；这一行只报它当前通不通">
      {{ probeText }}
    </p>

    <div class="settings-field" data-test="prefs-field-zoom">
      <label class="settings-field-label" for="prefs-zoom">界面缩放</label>
      <input
        id="prefs-zoom"
        v-model.number="prefsDraft.uiZoom"
        class="nx-field prefs-zoom"
        type="number"
        min="0.5"
        max="2"
        step="0.05"
        title="0.5–2.0，保存即生效"
        :aria-invalid="fieldErrors.uiZoom ? 'true' : undefined"
        data-test="prefs-zoom"
      >
      <p v-if="fieldErrors.uiZoom" class="settings-field-error" data-test="prefs-error-zoom">{{ fieldErrors.uiZoom }}</p>
      <p class="settings-field-hint">0.5–2.0，保存后窗口跟着缩放。</p>
    </div>

    <div class="settings-field-actions">
      <button type="button" class="control-primary" :disabled="prefsBusy" @click="savePrefs">保存并生效</button>
      <button type="button" class="control-quiet" @click="emit('close')">关闭</button>
      <span v-if="prefsFeedback" class="prefs-state" :class="prefsFeedback.kind === 'ok' ? 'is-ready' : 'is-error'">{{ prefsFeedback.text }}</span>
    </div>

    <!-- P2-3：每个应用级节底部的「恢复本节默认」，二次确认就在本节内（U13：目录外不许另开弹窗）。 -->
    <div v-if="resetAvailable" class="settings-reset" data-test="prefs-reset-block">
      <div v-if="!confirmReset" class="settings-reset-actions">
        <button type="button" class="control-quiet" :disabled="prefsBusy" data-test="prefs-reset" @click="requestReset">恢复本节默认</button>
        <span class="settings-field-hint">只重置本节：模型端点回到默认、界面缩放回到 85%。</span>
      </div>
      <div v-else class="settings-reset-confirm" role="alert" data-test="prefs-reset-confirm">
        <span>只重置本节：模型端点回到默认、界面缩放回到 85%；写作排版、通知水位与最近库都不动。外观主题选完即生效，不在此列。确认？</span>
        <button type="button" class="control-primary" :disabled="prefsBusy" data-test="prefs-reset-confirm-ok" @click="performReset">确认重置</button>
        <button type="button" class="control-quiet" data-test="prefs-reset-cancel" @click="confirmReset = false">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 〔工单 P2-1〕字段行：标签在上（2xs／600／muted）、控件在下（高 36）、说明再一行。
   间距与宽度全部引 fields.mjs 注入的变量；字号与圆角只走 --nx-* token（刻度门禁）。 */
.settings-fields {
  display: flex;
  flex-direction: column;
  gap: var(--settings-field-gap, 16px);
}
.settings-save-model {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  font-weight: 600;
  color: var(--text-muted);
}
.settings-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.settings-field-label {
  font-size: var(--nx-fs-2xs);
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}
.settings-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.settings-field-hint {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  color: var(--text-muted);
}
.settings-field-error {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  color: var(--control-danger);
}
/* 控件高度统一 36（规范二选一里的「高 36」）；输入类宽 ≤480，缩放是短数字仍留窄档。 */
.settings-field .nx-field {
  min-height: var(--settings-control-height, 36px);
}
.settings-field .prefs-input {
  flex: 0 1 var(--settings-input-max, 480px);
  max-width: var(--settings-input-max, 480px);
  width: auto;
}
.settings-segmented {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: var(--settings-control-height, 36px);
}
.settings-field-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.settings-reset {
  margin-top: var(--settings-field-gap, 16px);
  padding-top: var(--settings-field-gap, 16px);
  border-top: 1px solid var(--hairline-soft);
}
.settings-reset-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.settings-reset-confirm {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: var(--nx-fs-2xs);
  line-height: 1.7;
  color: var(--text-secondary);
}
</style>
