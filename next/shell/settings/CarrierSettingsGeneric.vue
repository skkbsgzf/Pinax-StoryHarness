<script setup>
import { computed, onMounted, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'

/**
 * 通用载体设置渲染器（批次45 · 任务③）：按清单声明出控件，不按载编写死任何一节。
 *
 * 五类声明：
 *   string  → 文本输入
 *   number  → 数字输入（声明里带 min / max / step 就照搬，不带交给浏览器默认）
 *   boolean → 开关（checkbox + role="switch"）
 *   enum    → 下拉（选项就是声明里的 options）
 *   section → 分组标题（不存值，也不出保存按钮）
 *
 * 值的落点是项目级 `.pinax/settings.json`，每载体一个命名空间（`carriers.<carrierId>`）。
 * 读走 settings:load（取全量 carriers 映射与 effective 有效值），写走 settings:save
 * （主进程按清单声明白名单校验；未声明／类型不符／越界的拒绝原样显示在这里，不假装保存成功）。
 * 保存反馈沿用 `.nx-save-chip` 词汇。
 *
 * 批次54 · 任务③④：有效值＝项目设置 → 工程覆盖 → 清单默认（`effective` 那一份带来源层），
 * 只有清单标了 `volatile` 的字段可写；其余只读展示，改默认值请走工程覆盖。
 * number 的 min/max/step 在界面先挡一次，主进程那道闸才是准（两边同一套判据）。
 *
 * novel.writing 不走这里：它仍是应用级偏好（WritingPrefsSection），由 SettingsModal 的
 * carrierSectionComponents 硬映射优先命中——本组件只接「没有专属内容组件」的声明。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  carrierId: { type: String, default: '' },
  carrierTitle: { type: String, default: '' },
  /** 一条 settings 声明：{ id, title, type, default?, options?, volatile?, min?, max?, step? }。 */
  setting: { type: Object, default: () => ({}) }
})

const type = computed(() => props.setting?.type ?? 'section')

function defaultValue(setting) {
  if (setting?.default !== undefined) return setting.default
  if (setting?.type === 'boolean') return false
  if (setting?.type === 'number') return 0
  if (setting?.type === 'enum') return Array.isArray(setting.options) ? setting.options[0] : ''
  return ''
}

const draft = ref(defaultValue(props.setting))
const busy = ref(false)
const feedback = ref(null)
/** 可写性以主进程算出的 effective 为准；IPC 没接上时退回清单声明的 volatile。 */
const volatile = ref(props.setting?.volatile === true)
const sourceLabel = ref('清单默认')

onMounted(async () => {
  if (!props.bridge?.request || !props.carrierId || !props.setting?.id) return
  const result = await props.bridge.request(IPC_CHANNELS.settingsLoad, {})
  if (!result?.ok) return
  const row = result.value?.effective?.[props.carrierId]?.[props.setting.id]
  if (row) {
    if (row.value !== undefined) draft.value = row.value
    volatile.value = row.volatile === true
    sourceLabel.value = row.label ?? sourceLabel.value
    return
  }
  const stored = result.value?.carriers?.[props.carrierId]?.[props.setting.id]
  if (stored !== undefined) draft.value = stored
})

/** 界面先挡一次范围／步长：与主进程 validateDeclaredValue 同一套判据（min 为步长基准）。 */
function rangeProblem(value) {
  if (type.value !== 'number') return ''
  if (!Number.isFinite(value)) return '请输入一个有效数字。'
  const min = Number.isFinite(props.setting?.min) ? props.setting.min : null
  const max = Number.isFinite(props.setting?.max) ? props.setting.max : null
  if (min !== null && value < min) return `不能小于 ${min}。`
  if (max !== null && value > max) return `不能大于 ${max}。`
  const step = Number.isFinite(props.setting?.step) && props.setting.step > 0 ? props.setting.step : null
  if (step !== null) {
    const base = min ?? 0
    const ratio = (value - base) / step
    if (Math.abs(ratio - Math.round(ratio)) > 1e-9) return `步长是 ${step}：请按 ${base} + n×${step} 取值。`
  }
  return ''
}

async function save() {
  if (!props.bridge?.request || busy.value || !volatile.value) return
  feedback.value = null
  const value = type.value === 'number' ? Number(draft.value) : draft.value
  const problem = rangeProblem(value)
  if (problem) {
    feedback.value = { kind: 'error', text: problem }
    return
  }
  busy.value = true
  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.settingsSave, {
      carrierId: props.carrierId,
      settingId: props.setting.id,
      value
    })
  } catch (error) {
    result = { ok: false, error: { message: String(error?.message || error) } }
  }
  busy.value = false
  if (!result?.ok) {
    feedback.value = { kind: 'error', text: result?.error?.message ?? '保存失败。' }
    return
  }
  if (result.value?.value !== undefined) draft.value = result.value.value
  feedback.value = { kind: 'ok', text: '已保存' }
}

function optionLabel(option) {
  if (option && typeof option === 'object') return option.label ?? String(option.value ?? '')
  return String(option)
}
</script>

<template>
  <div
    class="carrier-settings-generic"
    :data-carrier="carrierId"
    :data-setting="setting.id"
  >
    <p v-if="type === 'section'" class="settings-group-title" :data-test="`generic-section-${setting.id}`">
      {{ setting.title }}
    </p>
    <template v-else>
      <p class="wizard-note">{{ carrierTitle || '该载体' }} 的项目级配置，存在当前项目的 .pinax/settings.json。</p>
      <div class="prefs-row">
        <span class="prefs-row-label">{{ setting.title }}</span>
        <input
          v-if="type === 'string'"
          v-model="draft"
          class="nx-field generic-string"
          type="text"
          :data-test="`generic-string-${setting.id}`"
          :aria-label="setting.title"
          :disabled="!volatile"
        >
        <input
          v-else-if="type === 'number'"
          v-model.number="draft"
          class="nx-field generic-number"
          type="number"
          :data-test="`generic-number-${setting.id}`"
          :aria-label="setting.title"
          :min="setting.min"
          :max="setting.max"
          :step="setting.step"
          :disabled="!volatile"
        >
        <label v-else-if="type === 'boolean'" class="generic-switch">
          <input
            v-model="draft"
            class="generic-boolean"
            type="checkbox"
            role="switch"
            :data-test="`generic-boolean-${setting.id}`"
            :disabled="!volatile"
          >
          <span class="generic-switch-state">{{ draft ? '开' : '关' }}</span>
        </label>
        <select
          v-else-if="type === 'enum'"
          v-model="draft"
          class="nx-field generic-enum"
          :data-test="`generic-enum-${setting.id}`"
          :aria-label="setting.title"
          :disabled="!volatile"
        >
          <option v-for="option in setting.options ?? []" :key="String(option)" :value="option">{{ optionLabel(option) }}</option>
        </select>
        <!-- 来源层：这一项的有效值是项目设置、工程覆盖还是清单默认。 -->
        <span class="generic-source" :data-test="`generic-source-${setting.id}`">{{ sourceLabel }}</span>
        <button
          v-if="volatile"
          type="button"
          class="control-primary"
          :disabled="busy"
          :data-test="`generic-save-${setting.id}`"
          @click="save"
        >保存</button>
        <span
          v-else
          class="generic-readonly"
          :data-test="`generic-readonly-${setting.id}`"
        >只读（清单未标 volatile）</span>
        <span
          v-if="feedback"
          class="nx-save-chip"
          :class="feedback.kind === 'ok' ? 'is-saved' : 'is-error'"
          role="status"
          :data-test="`generic-save-chip-${setting.id}`"
        >
          <span class="nx-save-chip-state">{{ feedback.text }}</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.settings-group-title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--nx-fs-lg);
  font-weight: 500;
}
.carrier-settings-generic .prefs-row {
  margin-top: 10px;
}
.generic-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--nx-fs-md);
  color: var(--text-secondary);
}
.generic-switch-state {
  color: var(--text-muted);
}
.generic-source,
.generic-readonly {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  white-space: nowrap;
}
/* 保存 chip 词汇与 CarrierPaneHost 一致（类名同款，配色走 token）。 */
.nx-save-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-control);
  border: 1px solid var(--archive-olive);
  background: color-mix(in srgb, var(--bg-secondary) 70%, var(--archive-olive) 8%);
  font-size: var(--nx-fs-2xs);
  color: var(--text-primary);
  white-space: nowrap;
}
.nx-save-chip.is-error {
  border-color: var(--archive-rose);
  background: color-mix(in srgb, var(--archive-rose) 12%, var(--bg-secondary));
  color: var(--archive-rose);
}
.nx-save-chip-state {
  font-family: var(--font-display);
  font-weight: 500;
  color: var(--archive-olive);
}
</style>
