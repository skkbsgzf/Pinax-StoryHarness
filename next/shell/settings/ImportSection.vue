<script setup>
import { computed, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'

/**
 * 导入既有稿 Section（工单E1 · 裁定A：结构动作与建项目同级）。
 *
 * 老作者带稿上车的一次性门槛，形态照「新建项目」那一节：这里只摆三步与结果，
 * 真正的分类/落盘在主进程的 project:import-run 通道（next/runtime/projectImportAdapter）。
 * 不调内核 pinax_project_import：它只认 @1 项目且拒吃「源＝项目根」（见适配器头注）。
 *
 * 三步：
 *   ① 选稿子目录（sourcePath，只读源）；② 选空目录作为新项目位置（先建 @2 骨架，该目录成为项目根）；
 *   ③ 生成导入计划（dryRun，摊开类别计数/warnings/skipped）→ 执行导入（dryRun:false）→ 打开新项目 → 外壳 refresh。
 * 源目录永远只读；执行只新增标准目录里的文件，不覆盖已有内容——这条承诺两边同源。
 *
 * 建项目的记忆放在模块作用域：弹窗切节会卸载本组件，但同一次应用会话里
 * 「这个位置已经建过项目」必须还记得，否则重开这一节会拿「目录非空」把作者挡在门外。
 */
let createdProjectRoot = null

const props = defineProps({
  bridge: { type: Object, default: null },
  /** 清单里声明了 primary 的板块 id（建项目骨架要主载体）。 */
  primaryCarrierId: { type: String, default: null },
  extraEnabled: { type: Array, default: () => [] },
  /** 当前已打开项目的名字：导入会切换到新项目，先给一句明示。 */
  currentProjectName: { type: String, default: null }
})
const emit = defineEmits(['changed'])

/** 类别 → 人话（顺序即展示顺序；与适配器的 decision 名一一对应）。 */
const DECISION_ORDER = [
  ['chapter', '正文'],
  ['outline', '大纲'],
  ['outline-json', '大纲（outline.json）'],
  ['worldbook', '世界书'],
  ['rule', '约束'],
  ['idea', '构思'],
  ['source', '资料'],
  ['source-json', '资料（归档 JSON）'],
  ['material', '资料（章节衍生）'],
  ['auxiliary', '资料（世界书辅助）'],
  ['log', '日志']
]

const sourceDir = ref(null)
const targetDir = ref(null)
const projectName = ref('')
const plan = ref(null)
const applyResult = ref(null)
const openedOk = ref(false)
const error = ref(null)
/** '' | 'plan' | 'apply'——同一时刻只做一件事，按钮的 busy 态从这里来。 */
const busy = ref('')

const canPlan = computed(() => Boolean(
  props.bridge?.request && props.primaryCarrierId && sourceDir.value && targetDir.value
  && projectName.value.trim() && !busy.value
))
const canApply = computed(() => Boolean(plan.value?.importable && !busy.value && !applyResult.value))
const sourceHint = computed(() => sourceDir.value || '只读源目录：导入不改、不删这里任何文件')
const categoryRows = computed(() => {
  const decisions = plan.value?.decisions ?? {}
  return DECISION_ORDER.filter(([key]) => decisions[key]).map(([key, label]) => ({ key, label, count: decisions[key] }))
})
const skippedPreview = computed(() => (plan.value?.skipped ?? []).slice(0, 20))
const applySummary = computed(() => {
  const result = applyResult.value
  if (!result) return ''
  const opened = openedOk.value ? '新项目已打开。' : ''
  return `已导入 ${result.createdCount} 个文件（复用 ${result.reusedCount} 个，失败 ${result.failedCount} 个）。${opened}`
})

function folderName(fullPath) {
  return String(fullPath ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
}

function samePath(a, b) {
  return String(a ?? '').replace(/[\\/]+$/u, '').toLowerCase() === String(b ?? '').replace(/[\\/]+$/u, '').toLowerCase()
}

async function request(channel, payload) {
  if (!props.bridge?.request) {
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '渲染层未接主进程桥（preload 的 pinaxNext 通道）' } }
  }
  const result = await props.bridge.request(channel, payload)
  if (result?.ok) return result
  return { ok: false, error: result?.error ?? { code: 'PINAX_INVALID_INPUT', message: `通道 ${channel} 调用失败` } }
}

function resetResult() {
  plan.value = null
  applyResult.value = null
  openedOk.value = false
  error.value = null
}

async function pickSource() {
  if (busy.value) return
  const result = await request(IPC_CHANNELS.projectPickDir, { purpose: 'import-source' })
  if (!result.ok) { error.value = result.error; return }
  if (!result.value?.picked) return
  sourceDir.value = result.value.path
  if (!projectName.value.trim()) projectName.value = folderName(result.value.path) || '未命名新书'
  resetResult()
}

async function pickTarget() {
  if (busy.value) return
  const result = await request(IPC_CHANNELS.projectPickDir, {})
  if (!result.ok) { error.value = result.error; return }
  if (!result.value?.picked) return
  if (sourceDir.value && samePath(result.value.path, sourceDir.value)) {
    error.value = { code: 'PINAX_INVALID_INPUT', message: '新项目位置不能就是稿子目录：导入是把稿子收进项目的标准目录，两者必须是不同目录。' }
    return
  }
  targetDir.value = result.value.path
  resetResult()
}

/** 建项目骨架（@2）：同一次会话里建过就跳过；失败原样把 typed error 摊开。 */
async function ensureProject() {
  if (createdProjectRoot && samePath(createdProjectRoot, targetDir.value)) return true
  const created = await request(IPC_CHANNELS.projectCreate, {
    name: projectName.value.trim(),
    primaryCarrier: props.primaryCarrierId,
    extraEnabled: props.extraEnabled,
    root: targetDir.value
  })
  if (!created.ok) { error.value = created.error; return false }
  createdProjectRoot = targetDir.value
  return true
}

async function generatePlan() {
  if (!canPlan.value) return
  busy.value = 'plan'
  plan.value = null
  applyResult.value = null
  openedOk.value = false
  error.value = null
  const ready = await ensureProject()
  if (!ready) { busy.value = ''; return }
  const planned = await request(IPC_CHANNELS.projectImportRun, {
    sourcePath: sourceDir.value,
    targetPath: targetDir.value,
    dryRun: true
  })
  busy.value = ''
  if (!planned.ok) { error.value = planned.error; return }
  plan.value = planned.value
}

async function runImport() {
  if (!canApply.value) return
  busy.value = 'apply'
  error.value = null
  const applied = await request(IPC_CHANNELS.projectImportRun, {
    sourcePath: sourceDir.value,
    targetPath: targetDir.value,
    dryRun: false
  })
  if (!applied.ok) { busy.value = ''; error.value = applied.error; return }
  applyResult.value = applied.value
  // 导入是主进程直接写盘，不带 fileService 的修订号：完事再打开一次，让视图与修订号重新读一遍。
  const opened = await request(IPC_CHANNELS.projectOpen, { root: targetDir.value })
  busy.value = ''
  if (!opened.ok) {
    error.value = { code: opened.error.code, message: `稿子已导入，但打开新项目失败：${opened.error.message}` }
    return
  }
  openedOk.value = true
  emit('changed')
}
</script>

<template>
  <div>
    <p class="wizard-note">
      带稿上车三步：①选稿子目录（只读源）→ ②选一个空目录作为新项目位置（该目录会成为项目根）→ ③先看导入计划，确认后才执行。
      稿子按类别收进 正文／大纲／世界书／构思／资料／日志／约束 标准目录；原文件只新增不修改。
    </p>
    <p v-if="currentProjectName" class="wizard-note is-tight">
      当前打开的是《{{ currentProjectName }}》：导入会新建并切换到新项目，先把手上未保存的改动存好。
    </p>

    <div class="prefs-grid">
      <div class="prefs-row">
        <span class="prefs-row-label">① 稿子目录</span>
        <button type="button" class="control-secondary" data-test="import-pick-source" :disabled="Boolean(busy)" @click="pickSource">选择稿子目录…</button>
        <span class="prefs-row-hint" data-test="import-source">{{ sourceHint }}</span>
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">项目名称</span>
        <input v-model="projectName" class="nx-field prefs-input" type="text" placeholder="未命名新书" :disabled="Boolean(busy)">
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">② 项目位置</span>
        <button type="button" class="control-secondary" data-test="import-pick-target" :disabled="Boolean(busy)" @click="pickTarget">选择空目录…</button>
        <span class="prefs-row-hint" data-test="import-target">{{ targetDir || '尚未选择——选中后该目录成为项目根（需为空目录）' }}</span>
      </div>
      <div class="prefs-actions">
        <button type="button" class="control-primary" data-test="import-plan" :disabled="!canPlan" @click="generatePlan">
          {{ busy === 'plan' ? '正在生成计划…' : '生成导入计划' }}
        </button>
        <span v-if="!primaryCarrierId" class="prefs-row-hint">没有可任主载体的板块：导入要先能建项目。</span>
      </div>
    </div>

    <p v-if="error" class="prefs-state is-error" data-test="import-error">
      <strong>{{ error.code }}</strong>
      <span>{{ error.message }}</span>
    </p>

    <section v-if="plan" class="import-plan" data-test="import-plan-view">
      <p class="prefs-state">
        计划模式（dryRun）：还没有写入任何文件。可导入 {{ plan.importable }} 个文件，跳过 {{ plan.skippedCount }} 个<span v-if="plan.collapsedCount">（同源重复 {{ plan.collapsedCount }} 个已合并）</span>。
      </p>
      <ul v-if="categoryRows.length" class="import-plan-list">
        <li v-for="row in categoryRows" :key="row.key" data-test="import-category">{{ row.label }}：{{ row.count }}</li>
      </ul>
      <p v-else class="prefs-row-hint">没有可导入的文件：按下面 skipped 的原因整理源目录后重新生成计划。</p>
      <p v-for="(warning, index) in plan.warnings" :key="`w${index}`" class="prefs-row-hint">{{ warning }}</p>
      <div v-if="skippedPreview.length" class="import-skipped">
        <p class="prefs-row-label">跳过 {{ plan.skippedCount }} 个，前 {{ skippedPreview.length }} 条：</p>
        <ul class="import-plan-list">
          <li v-for="item in skippedPreview" :key="item.file" data-test="import-skipped">
            {{ item.file }} — {{ item.reason }}<span v-if="item.detail">（{{ item.detail }}）</span>
          </li>
        </ul>
      </div>
      <div class="prefs-actions">
        <button type="button" class="control-primary" data-test="import-apply" :disabled="!canApply" @click="runImport">
          {{ busy === 'apply' ? '导入中…' : '执行导入' }}
        </button>
        <span class="prefs-row-hint">执行会按计划落盘：只新增标准目录里的文件，不覆盖已有内容。</span>
      </div>
    </section>

    <p v-if="applyResult" class="prefs-state is-ready" data-test="import-done">{{ applySummary }}</p>
  </div>
</template>

<style scoped>
/* 只补计划清单的排布；字号/颜色一律走 token（Next 自写样式禁裸 px 字号与圆角）。 */
.import-plan {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}
.import-plan-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  font-size: var(--nx-fs-md);
  color: var(--text-secondary);
}
.import-skipped {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
