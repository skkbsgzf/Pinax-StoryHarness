<script setup>
import { computed, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'
import { renderMarkdown } from '../mdRender.mjs'

/**
 * 导出（批次26 · 任务三）：统一二级页「文档」组的一节。
 *
 * 导的是「当前打开的那一份文档」——章节／条目／构思／资料／约束／剧本，方向由外壳给的 props.document 决定
 * （它的 text 就是作者此刻在编辑面看到的那份：编辑态取草稿，阅读态取读回来的正文）。
 * 两种格式（零依赖）：
 *   txt —— 源文本原样写；
 *   doc —— HTML 包 .doc：这里先把 md 渲染成 HTML（与阅读态同一个 mdRender），主进程套 <html><body> 落盘，
 *          Word／WPS 打开就是带标题与粗体的文档，而不是一堆星号。
 * 「另存为」对话框与写盘都在主进程（通道 document:export）：渲染层拿不到 fs，也决定不了落点；
 * 取消是正常结果（不写一个字节），失败把主进程那句话原样摊开。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  /** { kind, title, path, text } 或 null（没打开任何文档）。 */
  document: { type: Object, default: null }
})

const format = ref('txt')
const busy = ref(false)
const feedback = ref(null)

const doc = computed(() => props.document)
const emptyText = computed(() => !doc.value || !String(doc.value.text ?? '').length)
const charCount = computed(() => String(doc.value?.text ?? '').length)

async function runExport() {
  if (busy.value || emptyText.value) return
  if (!props.bridge?.request) {
    feedback.value = { kind: 'error', text: '渲染层未接主进程桥（preload 的 pinaxNext 通道）。' }
    return
  }
  busy.value = true
  feedback.value = null
  const kind = format.value === 'doc' ? 'doc' : 'txt'
  const text = String(doc.value?.text ?? '')
  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.documentExport, {
      content: text,
      format: kind,
      title: doc.value?.title ?? null,
      // doc 用渲染好的 HTML（标题／粗体／列表都保留）；txt 始终写源文本，解析器不参与。
      html: kind === 'doc' ? renderMarkdown(text) : null
    })
  } catch (error) {
    result = { ok: false, error: { message: String(error?.message || error) } }
  }
  busy.value = false
  if (!result?.ok) {
    feedback.value = { kind: 'error', text: result?.error?.message ?? '导出失败。' }
    return
  }
  if (result.value?.canceled) {
    feedback.value = { kind: 'idle', text: '已取消导出，没有写任何文件。' }
    return
  }
  feedback.value = { kind: 'ok', text: `已导出到 ${result.value?.path ?? '（未知路径）'}` }
}
</script>

<template>
  <div>
    <p class="wizard-note">导出当前打开的文档（章节／条目／构思／资料／约束／剧本）。txt 写源文本；doc 用 HTML 包裹，Word 可直接打开。导出不改项目里的原文。</p>
    <p v-if="emptyText" class="prefs-row-hint" data-test="export-empty">
      还没有打开的文档：先在索引窗里点开一章／一条／一篇，再回到这里导出。
    </p>
    <div v-else class="prefs-grid">
      <div class="prefs-row">
        <span class="prefs-row-label">当前文档</span>
        <span class="prefs-row-hint" data-test="export-target">{{ doc.title }} · {{ doc.path }} · {{ charCount }} 字</span>
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">格式</span>
        <select v-model="format" class="nx-field export-format" aria-label="导出格式">
          <option value="txt">纯文本（.txt）</option>
          <option value="doc">Word 文档（.doc）</option>
        </select>
        <span class="prefs-row-hint">txt 原样；doc 保留标题与粗体</span>
      </div>
      <div class="prefs-actions">
        <button type="button" class="control-primary export-run" :disabled="busy" @click="runExport">
          {{ busy ? '导出中…' : '导出…' }}
        </button>
        <span
          v-if="feedback"
          class="prefs-state"
          :class="feedback.kind === 'ok' ? 'is-ready' : feedback.kind === 'error' ? 'is-error' : ''"
          role="status"
          data-test="export-status"
        >{{ feedback.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 格式选择沿用 .nx-field 的输入度量（颜色／圆角／字号都由它带），这里只收宽度——
   布局尺寸不是字号刻度，仍按像素给；下拉箭头交给浏览器原生控件（不自绘第二套选择器）。 */
.export-format {
  flex: 0 0 220px;
  width: 220px;
}
</style>
