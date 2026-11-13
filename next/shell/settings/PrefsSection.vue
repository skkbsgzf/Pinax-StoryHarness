<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'
import {
  fieldStyleVars,
  saveModelNote,
  SAVE_MODEL
} from './fields.mjs'

/**
 * 偏好与模型 Section（工单C0 内容组件化 · 批次8① 的弹窗内容原样搬入统一二级页）。
 *
 * 〔工单 P8 · B-6，作者 2026-11-13 设置图谱裁定〕主题与界面缩放迁出本节，落新节「外观」；
 * 本节只剩模型服务端点。主题真相仍是偏好 JSON，本节不再持有一份主题草稿，也不再发 theme 事件。
 * 保存模型写明在节首（P2-2）：端点是显式保存；底部「恢复本节默认」（P2-3）二次确认后
 * 只重置本节字段（端点回默认），缩放／写作排版／主题／通知水位／最近库都不在载荷里。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  /** 外壳传下来的当前主题：B-6 起本节不再使用，保留以免 prop 落到根节点当 DOM attribute。 */
  scheme: { type: String, default: 'light' }
})
const emit = defineEmits(['close', 'changed'])

const prefsDraft = ref({ modelPlaneEndpoint: '' })
const prefsBusy = ref(false)
const prefsFeedback = ref(null)
const fieldErrors = ref({})
const confirmReset = ref(false)
const probeState = ref(null)
const fieldVars = fieldStyleVars()
const saveModelText = saveModelNote(SAVE_MODEL.explicit)
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

onMounted(() => {
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
  if (result?.ok) {
    prefsDraft.value = {
      modelPlaneEndpoint: result.value?.modelPlaneEndpoint ?? ''
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

/** 端点合法性：留空＝默认地址；否则必须是 http(s)://…。 */
function isHttpEndpoint(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** 后端拒绝时也落到字段下方：消息里点名哪个字段就归哪个，没点名就留一条总错误。 */
function setErrorsFromMessage(message) {
  const text = String(message ?? '')
  return /modelPlaneEndpoint/u.test(text)
    ? { modelPlaneEndpoint: '端点没被接受：请写成 http(s)://… 或者留空。' }
    : {}
}

async function savePrefs() {
  if (!props.bridge?.request || prefsBusy.value) return
  // 先就地校验：有错不发送，草稿一个字都不动。
  const endpoint = String(prefsDraft.value.modelPlaneEndpoint ?? '').trim()
  if (endpoint && !isHttpEndpoint(endpoint)) {
    fieldErrors.value = { modelPlaneEndpoint: '端点要写成 http(s)://… 的形式，或者留空用默认地址。' }
    prefsFeedback.value = null
    return
  }
  prefsBusy.value = true
  prefsFeedback.value = null
  fieldErrors.value = {}
  const result = await props.bridge.request(IPC_CHANNELS.prefsSet, { modelPlaneEndpoint: endpoint || null })
  prefsBusy.value = false
  if (result.ok) {
    prefsFeedback.value = { kind: 'ok', text: '已保存并生效。' }
    return
  }
  const message = result.error?.message ?? '保存失败。'
  fieldErrors.value = setErrorsFromMessage(message)
  prefsFeedback.value = { kind: 'error', text: message }
}

/* —— P2-3 恢复本节默认 ————————————————————————————————————————————
 * 一次点击只是「请求」，摆出二次确认；确认后才写。只发本节默认值这一份 patch，
 * 主题／缩放／写作排版／通知水位／最近库一个都不在载荷里。 */
function requestReset() {
  if (prefsBusy.value) return
  confirmReset.value = true
  prefsFeedback.value = null
}

async function performReset() {
  if (!props.bridge?.request || prefsBusy.value) return
  const patch = { modelPlaneEndpoint: null }
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
  prefsDraft.value = { modelPlaneEndpoint: '' }
  probeState.value = null
  prefsFeedback.value = { kind: 'ok', text: '已恢复本节默认。' }
}
</script>

<template>
  <div class="settings-fields" :style="fieldVars">
    <p class="settings-save-model" data-test="prefs-save-model">{{ saveModelText }}</p>
    <p class="wizard-note is-tight" title="模型凭据仍由模型服务自己持有——这里只决定「在哪个端点」">应用级偏好，不随库走。</p>

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

    <div class="settings-field-actions">
      <button type="button" class="control-primary" :disabled="prefsBusy" @click="savePrefs">保存并生效</button>
      <button type="button" class="control-quiet" @click="emit('close')">关闭</button>
      <span v-if="prefsFeedback" class="prefs-state" :class="prefsFeedback.kind === 'ok' ? 'is-ready' : 'is-error'">{{ prefsFeedback.text }}</span>
    </div>

    <!-- P2-3：每个应用级节底部的「恢复本节默认」，二次确认就在本节内（U13：目录外不许另开弹窗）。 -->
    <div class="settings-reset" data-test="prefs-reset-block">
      <div v-if="!confirmReset" class="settings-reset-actions">
        <button type="button" class="control-quiet" :disabled="prefsBusy" data-test="prefs-reset" @click="requestReset">恢复本节默认</button>
        <span class="settings-field-hint">只重置本节：模型端点回到默认。</span>
      </div>
      <div v-else class="settings-reset-confirm" role="alert" data-test="prefs-reset-confirm">
        <span>只重置本节：模型端点回到默认；外观（主题与缩放）、写作排版、通知水位与最近库都不动。确认？</span>
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
/* 控件高度统一 36（规范二选一里的「高 36」）；输入类宽 ≤480。 */
.settings-field .nx-field {
  min-height: var(--settings-control-height, 36px);
}
.settings-field .prefs-input {
  flex: 0 1 var(--settings-input-max, 480px);
  max-width: var(--settings-input-max, 480px);
  width: auto;
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
