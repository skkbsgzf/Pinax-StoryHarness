<script setup>
import { onMounted, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'
import {
  fieldStyleVars,
  saveModelNote,
  SAVE_MODEL,
  ZOOM_MAX,
  ZOOM_MIN
} from './fields.mjs'

/**
 * 外观 Section（工单 P8 · B-6，作者 2026-11-13 设置图谱裁定）。
 *
 * 主题与界面缩放从「偏好与模型」迁出，单独成为「外观」节：图谱 5.3 把这两项归在
 * 「设置·应用·外观」。主题的真相仍是偏好 JSON 的 theme（D2／R3-1），这里只换入口——
 * 选完立刻通过 theme 事件上交外壳换肤，不经过本节的保存线；界面缩放是显式保存。
 *
 * 数据自读：目录注册点在 SettingsModal（宿主 AppNext 不在本工单允许文件里），
 * 所以本节挂载时自己经 bridge 读一次 prefs:get，不依赖外壳灌 props。
 */
const props = defineProps({
  bridge: { type: Object, default: null }
})
const emit = defineEmits(['theme'])

const themeDraft = ref('light')
const zoomDraft = ref(0.85)
const busy = ref(false)
const feedback = ref(null)
const fieldError = ref('')
const fieldVars = fieldStyleVars()
const saveModelText = saveModelNote(SAVE_MODEL.explicit)

onMounted(async () => {
  if (!props.bridge?.request) return
  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.prefsGet, {})
  } catch {
    return
  }
  if (!result?.ok) return
  const theme = result.value?.theme
  if (theme === 'light' || theme === 'dark') themeDraft.value = theme
  const zoom = Number(result.value?.uiZoom)
  if (Number.isFinite(zoom)) zoomDraft.value = zoom
})

/** 主题选完即生效：写偏好与双写老键的事交回外壳（竖条的明暗按钮跟着变）。 */
function chooseTheme() {
  emit('theme', themeDraft.value)
}

async function saveZoom() {
  if (!props.bridge?.request || busy.value) return
  const zoom = Number(zoomDraft.value)
  if (zoomDraft.value === '' || zoomDraft.value === null || !Number.isFinite(zoom) || zoom < ZOOM_MIN || zoom > ZOOM_MAX) {
    fieldError.value = `界面缩放要在 ${ZOOM_MIN}–${ZOOM_MAX} 之间。`
    feedback.value = null
    return
  }
  busy.value = true
  feedback.value = null
  fieldError.value = ''
  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.prefsSet, { uiZoom: zoom })
  } catch (error) {
    result = { ok: false, error: { message: String(error?.message || error) } }
  }
  busy.value = false
  if (!result?.ok) {
    const message = result?.error?.message ?? '保存失败。'
    fieldError.value = /uiZoom/u.test(String(message)) ? '界面缩放没被接受：请填 0.5–2.0 之间的数。' : ''
    feedback.value = { kind: 'error', text: message }
    return
  }
  const applied = Number(result.value?.uiZoom)
  if (Number.isFinite(applied)) zoomDraft.value = applied
  feedback.value = { kind: 'ok', text: '已保存并生效。' }
}
</script>

<template>
  <div class="settings-fields" :style="fieldVars">
    <p class="settings-save-model" data-test="appearance-save-model">{{ saveModelText }}</p>
    <p class="wizard-note is-tight" title="应用级偏好，不随库走">主题选完立刻换肤；缩放保存后窗口跟着变。</p>

    <div class="settings-field" data-test="appearance-field-theme">
      <span id="appearance-theme-label" class="settings-field-label">外观主题</span>
      <div class="settings-segmented" role="group" aria-labelledby="appearance-theme-label">
        <label class="wizard-companion"><input v-model="themeDraft" type="radio" name="prefs-theme" value="light" @change="chooseTheme"> 浅色</label>
        <label class="wizard-companion"><input v-model="themeDraft" type="radio" name="prefs-theme" value="dark" @change="chooseTheme"> 深色</label>
      </div>
      <p class="settings-field-hint" title="与老前端共用同一份偏好，改了那边也跟着变">选完立刻换肤，不用保存。</p>
    </div>

    <div class="settings-field" data-test="appearance-field-zoom">
      <label class="settings-field-label" for="appearance-zoom">界面缩放</label>
      <input
        id="appearance-zoom"
        v-model.number="zoomDraft"
        class="nx-field prefs-zoom"
        type="number"
        :min="ZOOM_MIN"
        :max="ZOOM_MAX"
        step="0.05"
        title="0.5–2.0，保存即生效"
        :aria-invalid="fieldError ? 'true' : undefined"
        data-test="prefs-zoom"
      >
      <p v-if="fieldError" class="settings-field-error" data-test="appearance-error-zoom">{{ fieldError }}</p>
      <p class="settings-field-hint">0.5–2.0，保存后窗口跟着缩放。</p>
    </div>

    <div class="settings-field-actions">
      <button type="button" class="control-primary" :disabled="busy" @click="saveZoom">保存并生效</button>
      <span v-if="feedback" class="prefs-state" :class="feedback.kind === 'ok' ? 'is-ready' : 'is-error'">{{ feedback.text }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 字段行与「偏好与模型」同一套 P2 度量（16／36／480 由 fields.mjs 注入），字号与圆角只走 --nx-* token。 */
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
.settings-field .nx-field {
  min-height: var(--settings-control-height, 36px);
}
.settings-field .prefs-zoom {
  flex: 0 0 120px;
  width: 120px;
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
</style>
