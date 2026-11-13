<script setup>
import { onMounted, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'
import { fieldStyleVars, saveModelNote, SAVE_MODEL } from './fields.mjs'

/**
 * 写作 Section（工单 P8 · B-7，作者 2026-11-13 设置图谱裁定）。
 *
 * 图谱 5.3：写作排版是应用级偏好，入口归「设置·应用·写作」——不再挂在小说载体声明的
 * `novel.writing` 下（清单声明保留，但 UI 不再从载体组发出）。六项字段（字号／行高／段距／
 * 缩进／打字机／聚焦）的存储键、载荷形状与生效链一字未改：prefs:set 写 writing*，
 * 保存成功后经 writing-prefs 事件交回外壳，由 AppNext 写根节点 CSS 变量与 dataset。
 *
 * 数据自读：目录注册点在 SettingsModal（宿主 AppNext 不在本工单允许文件里），
 * 本节挂载时自己经 bridge 读一次 prefs:get，首帧用 PREFS_DEFAULTS 的镜像值。
 */
const props = defineProps({
  bridge: { type: Object, default: null }
})
const emit = defineEmits(['writing-prefs'])

const FONT_SIZE_DEFAULT = 17
const LINE_HEIGHT_DEFAULT = 1.9
const PARAGRAPH_SPACING_DEFAULT = 0.8
const TEXT_INDENT_DEFAULT = 2

const fontSizeDraft = ref(FONT_SIZE_DEFAULT)
const lineHeightDraft = ref(LINE_HEIGHT_DEFAULT)
const paragraphSpacingDraft = ref(PARAGRAPH_SPACING_DEFAULT)
const textIndentDraft = ref(TEXT_INDENT_DEFAULT)
const typewriterDraft = ref(false)
const focusModeDraft = ref(false)
const busy = ref(false)
const feedback = ref(null)
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
  const value = result.value ?? {}
  if (Number.isFinite(value.writingFontSize)) fontSizeDraft.value = value.writingFontSize
  if (Number.isFinite(value.writingLineHeight)) lineHeightDraft.value = value.writingLineHeight
  if (Number.isFinite(value.writingParagraphSpacing)) paragraphSpacingDraft.value = value.writingParagraphSpacing
  if (Number.isFinite(value.writingTextIndent)) textIndentDraft.value = value.writingTextIndent
  if (typeof value.writingTypewriter === 'boolean') typewriterDraft.value = value.writingTypewriter
  if (typeof value.writingFocusMode === 'boolean') focusModeDraft.value = value.writingFocusMode
})

async function save() {
  if (!props.bridge?.request || busy.value) return
  busy.value = true
  feedback.value = null
  const fontSize = Number(fontSizeDraft.value)
  const lineHeight = Number(lineHeightDraft.value)
  const paragraphSpacing = Number(paragraphSpacingDraft.value)
  const textIndent = Number(textIndentDraft.value)
  const typewriter = typewriterDraft.value === true
  const focusMode = focusModeDraft.value === true
  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.prefsSet, {
      writingFontSize: fontSize,
      writingLineHeight: lineHeight,
      writingParagraphSpacing: paragraphSpacing,
      writingTextIndent: textIndent,
      writingTypewriter: typewriter,
      writingFocusMode: focusMode
    })
  } catch (error) {
    result = { ok: false, error: { message: String(error?.message || error) } }
  }
  busy.value = false
  if (!result?.ok) {
    feedback.value = { kind: 'error', text: result?.error?.message ?? '保存失败。' }
    return
  }
  // 以偏好存储回写的值为准（normalize 会把 1.9000000001 这类浮点尾巴收成 1.9）；
  // 存储没回这个字段（旧 mock/旧版本）就按提交值显示。
  const value = result.value ?? {}
  const appliedFontSize = Number.isFinite(value.writingFontSize) ? value.writingFontSize : fontSize
  const appliedLineHeight = Number.isFinite(value.writingLineHeight) ? value.writingLineHeight : lineHeight
  const appliedParagraphSpacing = Number.isFinite(value.writingParagraphSpacing) ? value.writingParagraphSpacing : paragraphSpacing
  const appliedTextIndent = Number.isFinite(value.writingTextIndent) ? value.writingTextIndent : textIndent
  const appliedTypewriter = typeof value.writingTypewriter === 'boolean' ? value.writingTypewriter : typewriter
  const appliedFocusMode = typeof value.writingFocusMode === 'boolean' ? value.writingFocusMode : focusMode
  fontSizeDraft.value = appliedFontSize
  lineHeightDraft.value = appliedLineHeight
  paragraphSpacingDraft.value = appliedParagraphSpacing
  textIndentDraft.value = appliedTextIndent
  typewriterDraft.value = appliedTypewriter
  focusModeDraft.value = appliedFocusMode
  feedback.value = { kind: 'ok', text: `已保存并生效：正文 ${appliedFontSize} 号字 · 行高 ${appliedLineHeight} · 段距 ${appliedParagraphSpacing}em · 缩进 ${appliedTextIndent}em。` }
  emit('writing-prefs', {
    fontSize: appliedFontSize,
    lineHeight: appliedLineHeight,
    paragraphSpacing: appliedParagraphSpacing,
    textIndent: appliedTextIndent,
    typewriter: appliedTypewriter,
    focusMode: appliedFocusMode
  })
}
</script>

<template>
  <div class="settings-fields" :style="fieldVars">
    <p class="settings-save-model" data-test="writing-save-model">{{ saveModelText }}</p>
    <p class="wizard-note is-tight" title="只改正文编辑区的排版；正文字体固定为自托管的霞鹜文楷">应用级写作偏好，不随库走。</p>

    <div class="settings-field">
      <label class="settings-field-label" for="writing-font-size">正文字号</label>
      <input
        id="writing-font-size"
        v-model.number="fontSizeDraft"
        class="nx-field writing-number writing-font-size"
        type="number"
        min="14"
        max="22"
        step="1"
        aria-label="正文字号（14–22）"
        title="14–22 的整数，默认 17"
      >
      <p class="settings-field-hint">14–22，默认 17。</p>
    </div>

    <div class="settings-field">
      <label class="settings-field-label" for="writing-line-height">正文行高</label>
      <input
        id="writing-line-height"
        v-model.number="lineHeightDraft"
        class="nx-field writing-number writing-line-height"
        type="number"
        min="1.6"
        max="2.4"
        step="0.05"
        aria-label="正文行高（1.6–2.4，步进 0.05）"
        title="1.6–2.4，步进 0.05，默认 1.9"
      >
      <p class="settings-field-hint">1.6–2.4，步进 0.05，默认 1.9。</p>
    </div>

    <div class="settings-field">
      <label class="settings-field-label" for="writing-paragraph-spacing">段落间距</label>
      <input
        id="writing-paragraph-spacing"
        v-model.number="paragraphSpacingDraft"
        class="nx-field writing-number writing-paragraph-spacing"
        type="number"
        min="0"
        max="2"
        step="0.1"
        aria-label="段落间距（0–2em，步进 0.1）"
        title="0–2em，步进 0.1，默认 0.8"
      >
      <p class="settings-field-hint">0–2em，步进 0.1，默认 0.8。</p>
    </div>

    <div class="settings-field">
      <label class="settings-field-label" for="writing-text-indent">首行缩进</label>
      <input
        id="writing-text-indent"
        v-model.number="textIndentDraft"
        class="nx-field writing-number writing-text-indent"
        type="number"
        min="0"
        max="2"
        step="0.5"
        aria-label="首行缩进（0–2em，步进 0.5）"
        title="0–2em，步进 0.5，默认 2（0＝不缩进）"
      >
      <p class="settings-field-hint">0–2em，步进 0.5，默认 2（0＝不缩进）。</p>
    </div>

    <div class="settings-field">
      <span class="settings-field-label">打字机滚动</span>
      <div class="settings-field-row">
        <input
          v-model="typewriterDraft"
          class="writing-checkbox writing-typewriter"
          type="checkbox"
          aria-label="打字机滚动（光标保持在视口约 40% 高度）"
        >
        <span class="settings-field-hint">开：光标始终停在视口偏上，写作时视线不追着屏幕跑。</span>
      </div>
    </div>

    <div class="settings-field">
      <span class="settings-field-label">段落聚焦</span>
      <div class="settings-field-row">
        <input
          v-model="focusModeDraft"
          class="writing-checkbox writing-focus-mode"
          type="checkbox"
          aria-label="段落聚焦（非当前段落变暗）"
        >
        <span class="settings-field-hint">开：只突出光标所在段落，其余段落退到背景。</span>
      </div>
    </div>

    <div class="settings-field-actions">
      <button type="button" class="control-primary" :disabled="busy" @click="save">保存并生效</button>
      <span v-if="feedback" class="prefs-state" :class="feedback.kind === 'ok' ? 'is-ready' : 'is-error'">{{ feedback.text }}</span>
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
.settings-field .nx-field {
  min-height: var(--settings-control-height, 36px);
}
/* 数字框只占固定宽（布局尺寸，不是字号/圆角刻度）；颜色与内边距仍由 .nx-field 带。 */
.writing-number {
  flex: 0 0 120px;
  width: 120px;
}
.settings-field-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
