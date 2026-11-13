<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'
import {
  acceleratorFromEvent,
  acceleratorLabel,
  bindableIds,
  defaultBindings,
  findHotkeyConflicts,
  normalizeAccelerator
} from '../hotkeys.mjs'
import { fieldStyleVars, saveModelNote, SAVE_MODEL } from './fields.mjs'

/**
 * 快捷键 Section（工单 P8 · B-8，作者 2026-11-13 设置图谱裁定）。
 *
 * 图谱 5.3：快捷键是库级设置（存档在库内），入口归「库设置·快捷键」，与「库设置（模块管理）」
 * 同组。可改的范围就是 hotkeys.mjs 的白名单（批次62 三条＋批次77 五条，共八条）——
 * 本节不另立第二份清单，行由 bindableIds() 现算。
 *
 * 改键流程：点「点击录入」→ 监听下一个按键 → acceleratorFromEvent／normalizeAccelerator 归一
 * → findHotkeyConflicts 查撞键（撞了就就地报错，一个字节都不写）→ 合法则整表经 hotkeys:save 落盘。
 * 冲突与非法写法都在行内报，不弹目录外弹窗。「恢复默认」二次确认后整表回 defaultBindings()。
 */
const props = defineProps({
  bridge: { type: Object, default: null }
})

const ACTION_LABELS = Object.freeze({
  'palette.open': '打开命令面板',
  'workspace.collapse-top': '收起最上层窗口',
  'project.reviewProposals': '审阅提案',
  'chat.open': '打开对话',
  'chat.send': '发送消息',
  'chat.stop': '停止生成',
  'chat.mode': '切换对话模式',
  'skill.menu': '打开技能菜单'
})
/** 纯修饰键按下不算一个键位：继续等主键，不误报「不能当快捷键」。 */
const MODIFIER_ONLY = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS'])
const isMac = /mac/i.test(globalThis.navigator?.platform ?? '')

const bindings = ref(defaultBindings())
const busy = ref(false)
const feedback = ref(null)
const loadError = ref('')
const recordingId = ref('')
const rowErrors = ref({})
const confirmReset = ref(false)
const fieldVars = fieldStyleVars()
const saveModelText = saveModelNote(SAVE_MODEL.instant)

const rows = computed(() => bindableIds().map((id) => ({
  id,
  label: ACTION_LABELS[id] ?? id,
  key: acceleratorLabel(bindings.value[id], { mac: isMac }),
  error: rowErrors.value[id] ?? ''
})))

let stopRecording = null

onMounted(() => {
  window.addEventListener('keydown', onEscCancelReset, true)
  void load()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEscCancelReset, true)
  cancelRecording()
})

function onEscCancelReset(event) {
  if (event.key !== 'Escape' || !confirmReset.value) return
  event.stopImmediatePropagation()
  event.preventDefault()
  confirmReset.value = false
}

async function load() {
  loadError.value = ''
  if (!props.bridge?.request) return
  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.hotkeysLoad, {})
  } catch (error) {
    loadError.value = String(error?.message || error)
    return
  }
  if (!result?.ok) {
    loadError.value = result?.error?.message ?? '快捷键读取失败。'
    return
  }
  bindings.value = { ...defaultBindings(), ...(result.value?.bindings ?? {}) }
}

function cancelRecording() {
  if (stopRecording) {
    stopRecording()
    stopRecording = null
  }
  recordingId.value = ''
}

function startRecording(id) {
  if (busy.value) return
  cancelRecording()
  recordingId.value = id
  rowErrors.value = { ...rowErrors.value, [id]: '' }
  const handler = (event) => {
    if (MODIFIER_ONLY.has(event.key)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void commitCaptured(id, acceleratorFromEvent(event))
  }
  window.addEventListener('keydown', handler, true)
  stopRecording = () => window.removeEventListener('keydown', handler, true)
}

async function commitCaptured(id, pressed) {
  cancelRecording()
  const canonical = normalizeAccelerator(pressed)
  if (!canonical) {
    rowErrors.value = { ...rowErrors.value, [id]: '这个键不能当快捷键：用带修饰键的组合，或 Esc／Enter 这类单独键。' }
    return
  }
  const next = { ...bindings.value, [id]: canonical }
  const conflicts = findHotkeyConflicts(next)
  if (conflicts.length) {
    const clash = conflicts.find((item) => item.ids.includes(id)) ?? conflicts[0]
    const others = clash.ids.filter((item) => item !== id).map((item) => ACTION_LABELS[item] ?? item)
    rowErrors.value = {
      ...rowErrors.value,
      [id]: `「${acceleratorLabel(canonical, { mac: isMac })}」已经绑给「${others.join('、')}」，换一个。`
    }
    return
  }
  await persist(next, id)
}

/** 整表落盘；失败时就地保留原表（行内报错或节内总错误），不改本地草稿。 */
async function persist(next, targetId) {
  if (!props.bridge?.request || busy.value) return false
  busy.value = true
  feedback.value = null
  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.hotkeysSave, { bindings: next })
  } catch (error) {
    result = { ok: false, error: { message: String(error?.message || error) } }
  }
  busy.value = false
  if (!result?.ok) {
    const message = result?.error?.message ?? '保存失败。'
    if (targetId) rowErrors.value = { ...rowErrors.value, [targetId]: message }
    else feedback.value = { kind: 'error', text: message }
    return false
  }
  bindings.value = { ...defaultBindings(), ...(result.value?.bindings ?? next) }
  feedback.value = { kind: 'ok', text: '已保存并生效。' }
  return true
}

function requestReset() {
  if (busy.value) return
  confirmReset.value = true
  feedback.value = null
}

async function performReset() {
  confirmReset.value = false
  rowErrors.value = {}
  await persist({ ...defaultBindings() }, '')
}
</script>

<template>
  <div class="settings-fields" :style="fieldVars">
    <p class="settings-save-model" data-test="hotkeys-save-model">{{ saveModelText }}</p>
    <p class="wizard-note is-tight" title="键位随当前库保存：换一个库就是另一份键位">本节的键位存在当前库里，随库走。</p>
    <p v-if="loadError" class="settings-field-error" data-test="hotkeys-load-error">{{ loadError }}</p>

    <div class="hotkey-list" data-test="hotkey-list">
      <div v-for="row in rows" :key="row.id" class="hotkey-row" :data-test="`hotkey-row-${row.id}`">
        <span class="hotkey-action">{{ row.label }}</span>
        <kbd class="hotkey-key" :data-test="`hotkey-key-${row.id}`">{{ row.key }}</kbd>
        <button
          type="button"
          class="control-secondary hotkey-record"
          :class="{ 'is-recording': recordingId === row.id }"
          :disabled="busy"
          :aria-label="`录入${row.label}的快捷键`"
          :data-test="`hotkey-record-${row.id}`"
          @click="recordingId === row.id ? cancelRecording() : startRecording(row.id)"
        >{{ recordingId === row.id ? '按下新键…' : '点击录入' }}</button>
        <p v-if="row.error" class="settings-field-error hotkey-error" :data-test="`hotkey-error-${row.id}`">{{ row.error }}</p>
      </div>
    </div>

    <p v-if="feedback" class="prefs-state" :class="feedback.kind === 'ok' ? 'is-ready' : 'is-error'" data-test="hotkeys-feedback">{{ feedback.text }}</p>

    <div class="settings-reset" data-test="hotkeys-reset-block">
      <div v-if="!confirmReset" class="settings-reset-actions">
        <button type="button" class="control-quiet" :disabled="busy" data-test="hotkeys-reset" @click="requestReset">恢复默认</button>
        <span class="settings-field-hint">把八条键位整表恢复成出厂的默认键位。</span>
      </div>
      <div v-else class="settings-reset-confirm" role="alert" data-test="hotkeys-reset-confirm">
        <span>整表恢复默认键位？你改过的键位都会被覆盖。确认？</span>
        <button type="button" class="control-primary" :disabled="busy" data-test="hotkeys-reset-confirm-ok" @click="performReset">确认恢复</button>
        <button type="button" class="control-quiet" data-test="hotkeys-reset-cancel" @click="confirmReset = false">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 字段行与「偏好与模型」同一套 P2 度量；字号与圆角只走 --nx-* token（刻度门禁）。 */
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
.hotkey-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hotkey-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-height: var(--settings-control-height, 36px);
}
.hotkey-action {
  flex: 0 0 160px;
  font-size: var(--nx-fs-md);
  color: var(--text-secondary);
}
.hotkey-key {
  min-width: 120px;
  padding: 4px 10px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-xs);
  background: var(--surface-workbench-muted);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--nx-fs-md);
  text-align: center;
}
.hotkey-record.is-recording {
  font-weight: 600;
}
.hotkey-error {
  flex: 1 1 100%;
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
