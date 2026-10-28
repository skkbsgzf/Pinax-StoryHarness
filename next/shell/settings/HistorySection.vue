<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'

/**
 * 文档历史 Section（D2 · R3-3 裁定的二级页落点）。
 *
 * 语义：
 *   - 左栏＝该文件的快照列表（时间＋摘要＋选中态），右栏＝所选版本相对上一版的 diff；
 *   - 「恢复到这一版」走 history.show 取内容，再交回外壳（props.restore）走载体自己的 save 工具
 *     （chapter／worldbook／notes／outline 各自带 expectedRevision）——恢复＝新增一次版本，
 *     绝不绕过载体的 scope 与并发闸直写文件；
 *   - 二次确认就在本节内（同一枚弹窗里），不另开弹窗（U13：目录外弹窗不允许存在）；
 *   - 不可用（未开项目／仓库缺失／通道未接）与空历史都如实显示，不拿假列表糊弄。
 *
 * 读通道只用 history:probe／list／show／diff 与 commit-now；写动作全部经 props.restore 上交。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  /** 当前文档：{ kind: 'chapter'|'entry'|'note'|'outline', path, title, revision }；无选中时为 null。 */
  target: { type: Object, default: null },
  /** 外壳提供的恢复回调：async ({ target, oid, text }) => { ok, message }。 */
  restore: { type: Function, default: null }
})
const emit = defineEmits(['changed'])

const loading = ref(false)
const probe = ref(null)
const error = ref('')
const commits = ref([])
const selectedOid = ref('')
const diff = ref([])
const diffLabel = ref('')
const restoring = ref(false)
const confirmRestore = ref(false)
const feedback = ref(null)

const targetPath = computed(() => props.target?.path ?? '')
const targetTitle = computed(() => props.target?.title ?? props.target?.path ?? '文档')
const unavailableText = computed(() => {
  const state = probe.value
  if (!state || state.available !== false) return ''
  if (state.reason === 'no-project') return '还没有打开项目，历史不可用。'
  if (state.reason === 'history-repo-missing') return '历史仓库尚未建立（项目打开时初始化失败，或还没打开过项目）。历史不可用。'
  return `历史不可用${state.reason ? `：${state.reason}` : ''}${state.detail ? `（${state.detail}）` : ''}。`
})
const canRestore = computed(() => Boolean(props.target && selectedOid.value && !restoring.value && !unavailableText.value))

onMounted(() => { void loadHistory() })
watch(targetPath, () => { void loadHistory() })

async function request(channel, payload) {
  if (!props.bridge?.request) {
    return { ok: false, error: { message: '渲染层未接主进程桥（preload 的 pinaxNext 通道）。' } }
  }
  try {
    return await props.bridge.request(channel, payload)
  } catch (error_) {
    return { ok: false, error: { message: String(error_?.message ?? error_) } }
  }
}

async function loadHistory() {
  commits.value = []
  selectedOid.value = ''
  diff.value = []
  diffLabel.value = ''
  confirmRestore.value = false
  feedback.value = null
  probe.value = null
  error.value = ''
  if (!targetPath.value) {
    loading.value = false
    return
  }
  loading.value = true
  const probed = await request(IPC_CHANNELS.historyProbe, {})
  probe.value = probed.ok
    ? probed.value
    : { available: false, reason: 'probe-failed', detail: probed.error?.message }
  if (!probed.ok || probe.value?.available === false) {
    loading.value = false
    return
  }
  const listed = await request(IPC_CHANNELS.historyList, { path: targetPath.value, limit: 50 })
  loading.value = false
  if (!listed.ok) {
    error.value = listed.error?.message ?? '读取历史失败'
    return
  }
  commits.value = Array.isArray(listed.value) ? listed.value : []
  if (commits.value.length) await selectCommit(commits.value[0], 0)
}

async function selectCommit(entry, index) {
  if (!entry?.oid) return
  selectedOid.value = entry.oid
  confirmRestore.value = false
  feedback.value = null
  diff.value = []
  const older = commits.value[index + 1]
  if (older?.oid) {
    const result = await request(IPC_CHANNELS.historyDiff, { a: older.oid, b: entry.oid, path: targetPath.value })
    if (!result.ok) {
      error.value = result.error?.message ?? '读取版本差异失败'
      return
    }
    diff.value = result.value?.hunks ?? []
    diffLabel.value = `第 ${commits.value.length - index} 版相对上一版的改动`
    return
  }
  // 最早一版没有更早的版本可对比：正文按上下文行摊开，仍让人看得到内容。
  const shown = await request(IPC_CHANNELS.historyShow, { oid: entry.oid, path: targetPath.value })
  if (!shown.ok) {
    error.value = shown.error?.message ?? '读取版本内容失败'
    return
  }
  diff.value = textLines(shown.value).map((text, lineIndex) => ({ type: 'ctx', line: lineIndex + 1, text }))
  diffLabel.value = '最早一版全文（没有更早的版本可对比）'
}

function textLines(value) {
  const text = String(value ?? '')
  if (!text) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function requestRestore() {
  if (!canRestore.value) return
  if (!confirmRestore.value) {
    confirmRestore.value = true
    feedback.value = null
    return
  }
  void performRestore()
}

async function performRestore() {
  if (!canRestore.value) return
  restoring.value = true
  feedback.value = null
  try {
    // 设计 §2：恢复前先存现场；历史是旁路，存不下也不拦恢复。
    await request(IPC_CHANNELS.historyCommitNow, { message: `恢复前快照 · ${targetTitle.value}` })
    const shown = await request(IPC_CHANNELS.historyShow, { oid: selectedOid.value, path: targetPath.value })
    if (!shown.ok) {
      feedback.value = { kind: 'error', text: shown.error?.message ?? '读取该版本失败' }
      return
    }
    const result = props.restore
      ? await props.restore({ target: props.target, oid: selectedOid.value, text: shown.value })
      : { ok: false, message: '恢复通道未接入（外壳没有提供载体保存回调）' }
    if (!result?.ok) {
      feedback.value = { kind: 'error', text: result?.message ?? '恢复失败' }
      return
    }
    // 恢复＝新增一次版本：立刻补一次快照，历史列表马上看得到（失败不拦，定时器稍后也会存）。
    await request(IPC_CHANNELS.historyCommitNow, { message: `恢复 · ${targetTitle.value} → ${selectedOid.value.slice(0, 7)}` })
    confirmRestore.value = false
    emit('changed')
    await loadHistory()
    feedback.value = { kind: 'ok', text: result.message ?? '已恢复；恢复会记为一条新版本。' }
  } finally {
    restoring.value = false
  }
}

function summary(message) {
  const line = String(message ?? '').split('\n').find((item) => item.trim())
  return line ? line.trim() : '(无提交摘要)'
}

function formatWhen(when) {
  const date = new Date(when)
  if (Number.isNaN(date.getTime())) return String(when ?? '')
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
</script>

<template>
  <div class="history-section">
    <p class="wizard-note">
      这里看「{{ targetTitle }}」的快照历史。选中一版可以看它相对上一版的改动；
      恢复会写成一个新版本，不删除任何旧版本。
    </p>

    <div v-if="!target" class="history-state history-empty">
      先在索引窗选择一个文档（章节／条目／构思／大纲），再看它的历史。
    </div>

    <template v-else>
      <p v-if="loading" class="history-state">正在读取历史…</p>
      <div v-else-if="unavailableText" class="history-state history-unavailable" role="status">
        <span>{{ unavailableText }}</span>
        <button type="button" class="control-secondary history-retry" @click="loadHistory()">重试</button>
      </div>
      <p v-else-if="error" class="history-state is-error">{{ error }}</p>
      <p v-else-if="!commits.length" class="history-state history-empty">
        这个文档还没有历史快照。下一次定时快照（默认 5 分钟）会把它记进来。
      </p>

      <div v-else class="history-layout">
        <div class="history-list" aria-label="历史快照列表">
          <p class="history-list-head">快照</p>
          <button
            v-for="(entry, index) in commits"
            :key="entry.oid"
            type="button"
            class="workspace-nav-item workspace-nav-item--tree nx-tree-row history-row"
            :class="{ 'is-active': entry.oid === selectedOid }"
            :aria-current="entry.oid === selectedOid ? 'true' : null"
            @click="selectCommit(entry, index)"
          >
            <span class="history-row-main">
              <span class="history-row-summary">{{ summary(entry.message) }}</span>
              <span class="history-row-time">{{ formatWhen(entry.when) }}</span>
            </span>
            <span class="history-row-author">{{ entry.author }}</span>
          </button>
        </div>

        <div class="history-detail">
          <div class="history-detail-head">
            <span class="history-diff-label">{{ diffLabel }}</span>
            <button
              type="button"
              class="control-primary history-restore"
              :disabled="!canRestore"
              @click="requestRestore"
            >恢复到这一版</button>
          </div>

          <div v-if="confirmRestore" class="history-confirm" role="alert">
            <span>恢复会把「{{ targetTitle }}」写成这一版的内容（新增一个版本，旧版本都保留）。确认执行？</span>
            <button type="button" class="control-primary" :disabled="restoring" @click="performRestore">确认恢复</button>
            <button type="button" class="control-quiet" :disabled="restoring" @click="confirmRestore = false">取消</button>
          </div>

          <p v-if="restoring" class="history-state">正在恢复…</p>
          <p v-if="feedback" class="history-feedback" :class="feedback.kind === 'ok' ? 'is-ok' : 'is-error'">{{ feedback.text }}</p>

          <div v-if="diff.length" class="history-diff" role="group" aria-label="版本差异">
            <p
              v-for="(hunk, index) in diff"
              :key="`${index}-${hunk.line}`"
              class="history-diff-line"
              :class="`is-${hunk.type}`"
            >
              <span class="history-diff-sign">{{ hunk.type === 'add' ? '+' : (hunk.type === 'del' ? '-' : ' ') }}</span>
              <span class="history-diff-text">{{ hunk.text }}</span>
            </p>
          </div>
          <p v-else class="history-state history-empty">选中一版后，这里显示它相对上一版的改动。</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.history-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.history-state {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  line-height: 1.7;
}
.history-unavailable {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: var(--signal-warm);
}
.history-state.is-error {
  color: var(--control-danger);
}
.history-empty {
  padding: 10px 2px;
}
.history-layout {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}
.history-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-muted);
}
.history-list-head {
  margin: 4px 8px;
  color: var(--text-muted);
  font-size: var(--nx-fs-2xs);
  letter-spacing: 0.04em;
}
.history-row {
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
}
.history-row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.history-row-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
}
.history-row-time {
  color: var(--text-muted);
  font-size: var(--nx-fs-2xs);
}
.history-row-author {
  flex: none;
  color: var(--text-muted);
  font-size: var(--nx-fs-2xs);
}
.history-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.history-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.history-diff-label {
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
.history-confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--signal-warm);
  border-radius: var(--radius-control);
  color: var(--signal-warm);
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.history-feedback {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.history-feedback.is-ok {
  color: var(--success);
}
.history-feedback.is-error {
  color: var(--control-danger);
}
.history-diff {
  max-height: 360px;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-muted);
}
.history-diff-line {
  display: flex;
  gap: 8px;
  margin: 0;
  color: var(--archive-ink);
  font-family: var(--font-mono);
  font-size: var(--nx-fs-md);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.history-diff-line.is-add {
  color: var(--signal-warm);
}
.history-diff-line.is-del {
  color: var(--control-danger);
}
.history-diff-sign {
  flex: none;
  width: 1.2em;
  text-align: right;
  opacity: 0.8;
}
.history-diff-text {
  min-width: 0;
}
.history-retry {
  flex: none;
}
@media (max-width: 760px) {
  .history-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .history-list {
    max-height: 200px;
  }
}
</style>
