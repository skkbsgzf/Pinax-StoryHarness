<script setup>
import { computed, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'

/**
 * 备份与恢复 Section（工单G2 · R3 本地化后解锁的设置节）。
 *
 * 口径（调度方已定）：零新依赖、不做 zip。备份＝把当前项目目录整份复制到一个新文件夹
 * （<项目名>-backup-<YYYYMMDD-HHmmss>）；恢复＝从备份复制回一个**空目录**并打开它。
 * 这里只摆动作与结果，复制/校验在主进程（next/runtime/projectBackupService），
 * 与「导入既有稿」同一分工：结构动作经 shell 通道，不经内核写族闸。
 *
 * 恢复要显示 manifest 摘要（工单要求）：选完备份目录后先发一次「预检」——
 * backup:restore 只带 backupDir 时返回 backup-manifest.json 的内容，不写一个字节；
 * 选好新位置后再发一次完整请求（backupDir + targetRoot）。
 * 失败一律把 typed error（BACKUP_INVALID／BACKUP_TARGET_NOT_EMPTY 等）原样摊开，不吞、不编。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  /** 当前打开的项目：备份的是它；没有项目时导出区给说明，不发一个必被拒的请求。 */
  project: { type: Object, default: null }
})
const emit = defineEmits(['changed'])

/** '' | 'export' | 'inspect' | 'restore'——同一时刻只做一件事，按钮的忙态从这里来。 */
const busy = ref('')

const exportParent = ref(null)
const includeHistory = ref(false)
const exportedPath = ref(null)
const exportedFileCount = ref(0)
const exportedBytes = ref(0)
const exportError = ref(null)

const backupDir = ref(null)
const manifest = ref(null)
const restoreTarget = ref(null)
const restoredRoot = ref(null)
const restoreError = ref(null)

const canExport = computed(() => Boolean(props.bridge?.request && props.project && !busy.value))
const canInspect = computed(() => Boolean(props.bridge?.request && !busy.value))
const canRestore = computed(() => Boolean(
  props.bridge?.request && backupDir.value && manifest.value && restoreTarget.value && !busy.value
))

async function request(channel, payload) {
  if (!props.bridge?.request) {
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '渲染层未接主进程桥（preload 的 pinaxNext 通道）' } }
  }
  const result = await props.bridge.request(channel, payload)
  if (result?.ok) return result
  return { ok: false, error: result?.error ?? { code: 'PINAX_INVALID_INPUT', message: `通道 ${channel} 调用失败` } }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

/** manifest 的导出时刻（精确到分钟就够认）；解析不了就原样退回。 */
function shortStamp(value) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) return String(value ?? '')
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 选备份位置并导出：一次点击走两拍（选目录 → backup:export），按钮文案把这两拍说清楚。 */
async function pickAndExport() {
  if (!canExport.value) return
  exportError.value = null
  exportedPath.value = null
  busy.value = 'export'
  const picked = await request(IPC_CHANNELS.projectPickDir, { purpose: 'backup-target' })
  if (!picked.ok) { busy.value = ''; exportError.value = picked.error; return }
  if (!picked.value?.picked) { busy.value = ''; return }
  exportParent.value = picked.value.path
  const exported = await request(IPC_CHANNELS.backupExport, {
    targetParent: picked.value.path,
    includeHistory: includeHistory.value
  })
  busy.value = ''
  if (!exported.ok) { exportError.value = exported.error; return }
  exportedPath.value = exported.value.path
  exportedFileCount.value = exported.value.fileCount ?? 0
  exportedBytes.value = exported.value.bytes ?? 0
}

/** 选备份目录：选完立刻预检 manifest（摘要先摊给作者看），通过后才允许选恢复位置。 */
async function pickBackupSource() {
  if (!canInspect.value) return
  restoreError.value = null
  restoredRoot.value = null
  const picked = await request(IPC_CHANNELS.projectPickDir, { purpose: 'backup-source' })
  if (!picked.ok) { restoreError.value = picked.error; return }
  if (!picked.value?.picked) return
  backupDir.value = picked.value.path
  // 换了备份目录：上一份摘要与恢复位置都不再成立，等预检通过再放行下一步。
  manifest.value = null
  restoreTarget.value = null
  busy.value = 'inspect'
  const inspected = await request(IPC_CHANNELS.backupRestore, { backupDir: picked.value.path })
  busy.value = ''
  if (!inspected.ok) { restoreError.value = inspected.error; return }
  manifest.value = inspected.value?.manifest ?? null
}

async function pickRestoreTarget() {
  if (busy.value || !manifest.value) return
  restoreError.value = null
  restoredRoot.value = null
  const picked = await request(IPC_CHANNELS.projectPickDir, { purpose: 'restore-target' })
  if (!picked.ok) { restoreError.value = picked.error; return }
  if (!picked.value?.picked) return
  restoreTarget.value = picked.value.path
}

/** 恢复：复制回空目录 → 打开这个项目 → 通知外壳刷新（与导入向导的最后一步同一口径）。 */
async function restore() {
  if (!canRestore.value) return
  restoreError.value = null
  restoredRoot.value = null
  busy.value = 'restore'
  const restored = await request(IPC_CHANNELS.backupRestore, {
    backupDir: backupDir.value,
    targetRoot: restoreTarget.value
  })
  if (!restored.ok) { busy.value = ''; restoreError.value = restored.error; return }
  const opened = await request(IPC_CHANNELS.projectOpen, { root: restored.value.root })
  busy.value = ''
  if (!opened.ok) {
    restoreError.value = {
      code: opened.error.code,
      message: `已恢复到「${restored.value.root}」，但打开这个项目失败：${opened.error.message}`
    }
    return
  }
  restoredRoot.value = restored.value.root
  emit('changed')
}
</script>

<template>
  <div>
    <p class="wizard-note">
      备份＝把当前项目目录整份复制成一个新文件夹（项目名-backup-时间戳），不压缩、不做增量；
      恢复＝从备份复制回一个空目录，绝不覆盖现稿。历史仓（.pinax/history.git）默认不进备份——体积大，
      而时间线另由「文档历史」负责；要连历史一起带走就勾上下面的选项。
    </p>

    <section class="backup-block">
      <h3 class="settings-panel-heading">导出备份</h3>
      <p v-if="!project" class="prefs-row-hint" data-test="backup-no-project">还没有打开项目：先打开一个项目，备份的是它。</p>
      <div class="prefs-grid">
        <div class="prefs-row">
          <span class="prefs-row-label">备份位置</span>
          <button type="button" class="control-secondary" data-test="backup-pick-target" :disabled="!canExport" @click="pickAndExport">
            {{ busy === 'export' ? '正在复制…' : '选择备份位置并导出' }}
          </button>
          <span class="prefs-row-hint" data-test="backup-target">{{ exportParent || '尚未选择——请选一个项目之外的文件夹，备份会落在它下面的新子目录里' }}</span>
        </div>
        <label class="backup-toggle">
          <input v-model="includeHistory" type="checkbox" data-test="backup-include-history" :disabled="Boolean(busy) || !project">
          包含历史仓（.pinax/history.git，体积大）
        </label>
      </div>
      <p v-if="exportedPath" class="prefs-state is-ready" data-test="backup-done">
        已导出到 {{ exportedPath }}（{{ exportedFileCount }} 个文件 · {{ formatBytes(exportedBytes) }}）
      </p>
      <p v-if="exportError" class="prefs-state is-error" data-test="backup-error">
        <strong>{{ exportError.code }}</strong>
        <span>{{ exportError.message }}</span>
      </p>
    </section>

    <section class="backup-block">
      <h3 class="settings-panel-heading">从备份恢复</h3>
      <p class="wizard-note is-tight">
        三步：①选备份文件夹（凭 backup-manifest.json 认）→ ②核对摘要 → ③选一个新的空目录并恢复；恢复完会打开这个项目。
      </p>
      <div class="prefs-grid">
        <div class="prefs-row">
          <span class="prefs-row-label">① 备份文件夹</span>
          <button type="button" class="control-secondary" data-test="backup-pick-source" :disabled="!canInspect" @click="pickBackupSource">
            {{ busy === 'inspect' ? '正在核对…' : '选择备份文件夹…' }}
          </button>
          <span class="prefs-row-hint" data-test="backup-source">{{ backupDir || '尚未选择' }}</span>
        </div>
        <p v-if="manifest" class="prefs-state" data-test="backup-manifest">
          项目 {{ manifest.projectName || '（未署名）' }} · 导出于 {{ shortStamp(manifest.exportedAt) }} ·
          {{ manifest.fileCount }} 个文件 · {{ manifest.includesHistory ? '含历史仓' : '不含历史仓' }}
        </p>
        <div class="prefs-row">
          <span class="prefs-row-label">② 恢复位置</span>
          <button type="button" class="control-secondary" data-test="backup-pick-restore-target" :disabled="!manifest || Boolean(busy)" @click="pickRestoreTarget">
            选择新的空目录…
          </button>
          <span class="prefs-row-hint" data-test="backup-restore-target">{{ restoreTarget || '尚未选择——恢复只支持空目录（防止覆盖现稿）' }}</span>
        </div>
        <div class="prefs-actions">
          <button type="button" class="control-primary" data-test="backup-restore" :disabled="!canRestore" @click="restore">
            {{ busy === 'restore' ? '恢复中…' : '从备份恢复并打开' }}
          </button>
        </div>
      </div>
      <p v-if="restoredRoot" class="prefs-state is-ready" data-test="backup-restored">
        已恢复到 {{ restoredRoot }}，项目已打开。
      </p>
      <p v-if="restoreError" class="prefs-state is-error" data-test="backup-restore-error">
        <strong>{{ restoreError.code }}</strong>
        <span>{{ restoreError.message }}</span>
      </p>
    </section>
  </div>
</template>

<style scoped>
/* 两个动作块之间的留白与勾选行的排布；字号/颜色一律走 token（Next 自写样式禁裸 px 字号与圆角）。 */
.backup-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}
.backup-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--nx-fs-md);
  color: var(--text-secondary);
}
</style>
