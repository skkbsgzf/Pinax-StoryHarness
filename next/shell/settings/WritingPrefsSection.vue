<script setup>
import { ref, watch } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'

/**
 * 写作偏好（工单B · P14 注册制的第一个真内容）：novel 载体声明 `novel.writing` 的节内容。
 *
 * 只管正文编辑区的排版：字号（14–22，默认 17＝--nx-fs-lg）与行高（1.6–2.4 步进 0.05，默认 1.9）。
 * 应用级偏好、不随项目走——落 next/runtime/appPreferences 的 writingFontSize／writingLineHeight，
 * 保存走 prefsSet（patch 语义：只写这两个字段，不碰端点/缩放/历史间隔/主题）。
 *
 * 生效方式是 CSS 变量：保存成功后把落地值经 writing-prefs 事件上交外壳，由 AppNext 在根节点
 * setProperty('--writing-font-size'／'--writing-line-height')；next-shell.css 的 .editor-area
 * 只读这两个变量。字号/行高的唯一真相仍是偏好 JSON，DOM 样式只是它的投影。
 *
 * 默认值与 next/runtime/appPreferences.mjs 的 PREFS_DEFAULTS 一致（17／1.9，两处都有测试钉住）。
 * 不做字体族选择（正文字体固定为自托管的霞鹜文楷），也不做 ProseMirror 排版（编辑器还是 textarea）。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  fontSize: { type: Number, default: 17 },
  lineHeight: { type: Number, default: 1.9 },
  paragraphSpacing: { type: Number, default: 0.8 },
  textIndent: { type: Number, default: 2 },
  typewriter: { type: Boolean, default: false },
  focusMode: { type: Boolean, default: false }
})
const emit = defineEmits(['writing-prefs'])

const fontSizeDraft = ref(props.fontSize)
const lineHeightDraft = ref(props.lineHeight)
const paragraphSpacingDraft = ref(props.paragraphSpacing)
const textIndentDraft = ref(props.textIndent)
const typewriterDraft = ref(props.typewriter)
const focusModeDraft = ref(props.focusMode)
const busy = ref(false)
const feedback = ref(null)

/** AppNext 在挂载后才把 prefsGet 的结果灌进来（首帧用默认值）：跟上，不留下过期草稿。 */
watch(() => props.fontSize, (value) => {
  if (Number.isFinite(value)) fontSizeDraft.value = value
})
watch(() => props.lineHeight, (value) => {
  if (Number.isFinite(value)) lineHeightDraft.value = value
})
watch(() => props.paragraphSpacing, (value) => {
  if (Number.isFinite(value)) paragraphSpacingDraft.value = value
})
watch(() => props.textIndent, (value) => {
  if (Number.isFinite(value)) textIndentDraft.value = value
})
watch(() => props.typewriter, (value) => {
  typewriterDraft.value = value === true
})
watch(() => props.focusMode, (value) => {
  focusModeDraft.value = value === true
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
  <div>
    <p class="wizard-note">应用级偏好，不随项目走。只改正文编辑区的排版；正文字体固定为自托管的霞鹜文楷。</p>
    <div class="prefs-grid">
      <div class="prefs-row">
        <span class="prefs-row-label">正文字号</span>
        <input
          v-model.number="fontSizeDraft"
          class="nx-field writing-number writing-font-size"
          type="number"
          min="14"
          max="22"
          step="1"
          aria-label="正文字号（14–22）"
        >
        <span class="prefs-row-hint">14–22 的整数（默认 17）</span>
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">正文行高</span>
        <input
          v-model.number="lineHeightDraft"
          class="nx-field writing-number writing-line-height"
          type="number"
          min="1.6"
          max="2.4"
          step="0.05"
          aria-label="正文行高（1.6–2.4，步进 0.05）"
        >
        <span class="prefs-row-hint">1.6–2.4，步进 0.05（默认 1.9）</span>
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">段落间距</span>
        <input
          v-model.number="paragraphSpacingDraft"
          class="nx-field writing-number writing-paragraph-spacing"
          type="number"
          min="0"
          max="2"
          step="0.1"
          aria-label="段落间距（0–2em，步进 0.1）"
        >
        <span class="prefs-row-hint">0–2em，步进 0.1（默认 0.8）</span>
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">首行缩进</span>
        <input
          v-model.number="textIndentDraft"
          class="nx-field writing-number writing-text-indent"
          type="number"
          min="0"
          max="2"
          step="0.5"
          aria-label="首行缩进（0–2em，步进 0.5）"
        >
        <span class="prefs-row-hint">0–2em，步进 0.5（默认 2）</span>
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">打字机滚动</span>
        <input
          v-model="typewriterDraft"
          class="writing-checkbox writing-typewriter"
          type="checkbox"
          aria-label="打字机滚动（光标保持在视口约 40% 高度）"
        >
        <span class="prefs-row-hint">开：光标始终停在视口偏上，写作时视线不追着屏幕跑</span>
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">段落聚焦</span>
        <input
          v-model="focusModeDraft"
          class="writing-checkbox writing-focus-mode"
          type="checkbox"
          aria-label="段落聚焦（非当前段落变暗）"
        >
        <span class="prefs-row-hint">开：只突出光标所在段落，其余段落退到背景</span>
      </div>
      <div class="prefs-actions">
        <button type="button" class="control-primary" :disabled="busy" @click="save">保存并生效</button>
        <span v-if="feedback" class="prefs-state" :class="feedback.kind === 'ok' ? 'is-ready' : 'is-error'">{{ feedback.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 两个数字框只占固定宽（布局尺寸，不是字号/圆角刻度）；颜色与内边距仍由 .nx-field 带。 */
.writing-number {
  flex: 0 0 110px;
  width: 110px;
}
</style>
