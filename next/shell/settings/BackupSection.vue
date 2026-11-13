<script setup>
import { computed, onMounted, ref } from 'vue'
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

/**
 * 〔工单 P8 · B-10，作者 2026-11-13 设置图谱裁定〕定时快照间隔：应用级偏好
 * historyIntervalMinutes，0–120 的整数分钟，0＝关闭。写走 prefs:set；主进程的
 * onPrefsApplied 已经在同一拍里按新值重排快照调度器，本节不再另发一条重启指令。
 */
const INTERVAL_DEFAULT = 5
const INTERVAL_MAX = 120
const intervalDraft = ref(INTERVAL_DEFAULT)
const intervalBusy = ref(false)
const intervalFeedback = ref(null)
const intervalError = ref('')

onMounted(async () => {
  if (!props.bridge?.request) return
  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.prefsGet, {})
  } catch {
    return
  }
  if (!result?.ok) return
  const value = Number(result.value?.historyIntervalMinutes)
  if (Number.isFinite(value) && value >= 0 && value <= INTERVAL_MAX) intervalDraft.value = value
})

async function saveInterval() {
  if (!props.bridge?.request || intervalBusy.value) return
  const minutes = Number(intervalDraft.value)
  if (intervalDraft.value === '' || intervalDraft.value === null || !Number.isInteger(minutes) || minutes < 0 || minutes > INTERVAL_MAX) {
    intervalError.value = `间隔要是 0–${INTERVAL_MAX} 之间的整数分钟（0＝关闭）。`
    intervalFeedback.value = null
    return
  }
  intervalBusy.value = true
  intervalError.value = ''
  intervalFeedback.value = null
  let result
  try {
    result = await props.bridge.request(IPC_CHANNELS.prefsSet, { historyIntervalMinutes: minutes })
  } catch (error) {
    result = { ok: false, error: { message: String(error?.message || error) } }
  }
  intervalBusy.value = false
  if (!result?.ok) {
    intervalFeedback.value = { kind: 'error', text: result?.error?.message ?? '保存失败。' }
    return
  }
  const applied = Number(result.value?.historyIntervalMinutes)
  if (Number.isFinite(applied)) intervalDraft.value = applied
  intervalFeedback.value = {
    kind: 'ok',
    text: minutes === 0 ? '已保存并生效：定时快照已关闭。' : `已保存并生效：每 ${minutes} 分钟快照一次。`
  }
}

const canExport = computed(() => Boolean(props.bridge?.request && props.project && !busy.value))
const canInspect = computed(() => Boolean(props.bridge?.request && !busy.value))
const canRestore = computed(() => Boolean(
  props.bridge?.request && backupDir.value && manifest.value && restoreTarget.value && !busy.value
))

async function request(channel, payload) {
  if (!props.bridge?.request) {
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '这一步没连上本地服务，暂时办不了。请重启应用后再试。' } }
  }
  const result = await props.bridge.request(channel, payload)
  if (result?.ok) return result
  return { ok: false, error: result?.error ?? { code: 'PINAX_INVALID_INPUT', message: '这一步没有回结果，请稍后再试。' } }
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
    <!-- 〔批次68-R3 指南层〕节首只留一句白话；机制细节（目录名、文件名、历史仓路径）进「细节」折叠。
         〔工单 P8 · B-10〕本节新增定时快照间隔：显式保存；导出／恢复仍是点下就做。 -->
    <p class="settings-save-model" data-test="backup-save-model">定时快照间隔改完点「保存间隔」才写入；备份与恢复是点下就做。</p>
    <p class="wizard-note">备份＝整份复制项目文件夹；恢复只回空目录，不覆盖现稿。</p>
    <details class="nx-note-details">
      <summary>细节</summary>
      <p>备份文件夹命名为「项目名-backup-时间戳」，不压缩、不做增量。历史仓默认不进备份——体积大，
        时间线另由「文档历史」负责；要连历史一起带走就勾选下面的选项（历史仓即 .pinax/history.git）。</p>
    </details>

    <section class="backup-block">
      <h3 class="settings-panel-heading">定时快照</h3>
      <div class="prefs-grid">
        <div class="prefs-row">
          <label class="prefs-row-label" for="backup-interval">间隔（分钟）</label>
          <input
            id="backup-interval"
            v-model.number="intervalDraft"
            class="nx-field backup-interval"
            type="number"
            min="0"
            max="120"
            step="1"
            :aria-invalid="intervalError ? 'true' : undefined"
            data-test="backup-interval"
          >
          <button type="button" class="control-secondary" :disabled="intervalBusy" data-test="backup-interval-save" @click="saveInterval">
            {{ intervalBusy ? '正在保存…' : '保存间隔' }}
          </button>
        </div>
        <p v-if="intervalError" class="settings-field-error" data-test="backup-interval-error">{{ intervalError }}</p>
        <p class="prefs-row-hint" data-test="backup-interval-hint">应用级，不随库走；0＝关闭定时快照。</p>
        <p v-if="intervalFeedback" class="prefs-state" :class="intervalFeedback.kind === 'ok' ? 'is-ready' : 'is-error'" data-test="backup-interval-feedback">{{ intervalFeedback.text }}</p>
      </div>
    </section>

    <section class="backup-block">
      <h3 class="settings-panel-heading">导出备份</h3>
      <p v-if="!project" class="prefs-row-hint" data-test="backup-no-project" title="先打开一个项目，备份的就是它">还没有打开项目。</p>
      <div class="prefs-grid">
        <div class="prefs-row">
          <span class="prefs-row-label">备份位置</span>
          <button type="button" class="control-secondary" data-test="backup-pick-target" :disabled="!canExport" @click="pickAndExport">
            {{ busy === 'export' ? '正在复制…' : '选择备份位置并导出' }}
          </button>
          <span class="prefs-row-hint" data-test="backup-target" title="请选一个项目之外的文件夹，备份会落在它下面的新子目录里">{{ exportParent || '尚未选择' }}</span>
        </div>
        <label class="backup-toggle" title=".pinax/history.git，体积大">
          <input v-model="includeHistory" type="checkbox" data-test="backup-include-history" :disabled="Boolean(busy) || !project">
          包含历史仓（体积大）
        </label>
        <!-- P2-1：开关类字段标签与控件同行，说明另起一行。 -->
        <p class="settings-field-hint">历史仓体积大；不勾选也能完整恢复正文与设定，只是版本时间线不跟着走。</p>
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
      <p class="wizard-note is-tight" title="选备份文件夹时凭包内的 backup-manifest.json 核对身份">三步：选备份 → 核对摘要 → 选空目录恢复；恢复完会打开这个项目。</p>
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
          <span class="prefs-row-hint" data-test="backup-restore-target" title="恢复只支持空目录（防止覆盖现稿）">{{ restoreTarget || '尚未选择' }}</span>
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
/* 〔工单 P2-2〕保存模型：这一节只有结构动作（导出／恢复），没有可保存的设置值，
   所以不摆「保存」按钮，也不走字段行三段式；说清「点下就做」即可。 */
.settings-save-model {
  margin: 0 0 8px;
  font-size: var(--nx-fs-2xs);
  font-weight: 600;
  color: var(--text-muted);
}
/* 字段说明（P2-1）：与标签同一档、比正文小一号，开关类字段的说明另起一行。 */
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
/* 间隔数字框只占固定宽（布局尺寸，不是字号/圆角刻度）。 */
.backup-interval {
  flex: 0 0 110px;
  width: 110px;
}
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
