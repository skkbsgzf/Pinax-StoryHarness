<script setup>
import { computed, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'
import { DECISION_ORDER, IMPORT_CLASSES, folderName } from './wizardKit.mjs'

/**
 * 导入既有稿（前端工单 A-6）：库管理器内的四步整页流——①位置 → ②主模块 → ③选稿 → ④预览。
 * 从原设置弹窗向导（ProjectWizardSection import 模式）迁出，通道与校验合同一字未动
 * （project:import-run 的 sources 逐类多源／单源自动识别，校验在适配器 resolveInputs）。
 * 与弹窗版的唯一行为差：执行导入后**不自动打开**——完成页给「打开这个库」与「回到我的库」两个出口（工单 A-6）。
 * 首屏明示：「导入会新建一个库并把稿子复制进去，原文件不动」。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  primaryCarriers: { type: Array, default: () => [] },
  extraEnabled: { type: Array, default: () => [] },
  /** A-5「导入这个文件夹」的源目录预填（逐类模式的正文类源）。 */
  initialSource: { type: String, default: null }
})
const emit = defineEmits(['done', 'back'])

const STEPS = ['position', 'primary', 'sources', 'review']
const step = ref(props.initialSource ? 'sources' : 'position')
const libraryName = ref('')
const libraryDir = ref(null)
const primaryId = ref(null)
const importStyle = ref('pick')
const autoSourceDir = ref(props.initialSource)
const picked = ref(IMPORT_CLASSES.map((item) => ({ ...item, enabled: false, dir: item.category === 'chapter' && props.initialSource ? props.initialSource : null })))
const plan = ref(null)
const applyResult = ref(null)
const error = ref(null)
const busy = ref('')

const stepIndex = computed(() => STEPS.indexOf(step.value))
const enabledClasses = computed(() => picked.value.filter((item) => item.enabled))
const canNextPosition = computed(() => Boolean(libraryDir.value))
const canNextPrimary = computed(() => Boolean(primaryId.value))
const canNextSources = computed(() => (importStyle.value === 'auto'
  ? Boolean(autoSourceDir.value)
  : enabledClasses.value.length > 0 && enabledClasses.value.every((item) => item.dir)))
const companionIds = computed(() => {
  const ids = new Set(props.extraEnabled ?? [])
  if (importStyle.value === 'pick') {
    for (const item of enabledClasses.value) {
      if (item.carrier && item.carrier !== primaryId.value) ids.add(item.carrier)
    }
  }
  return [...ids]
})
const canPlan = computed(() => Boolean(
  props.bridge?.request && libraryDir.value && primaryId.value && libraryName.value.trim() && !busy.value && canNextSources.value
))
const canApply = computed(() => Boolean(plan.value?.importable && !busy.value && !applyResult.value))
const categoryRows = computed(() => {
  const decisions = plan.value?.decisions ?? {}
  return DECISION_ORDER.filter(([key]) => decisions[key]).map(([key, label]) => ({ key, label, count: decisions[key] }))
})
const skippedPreview = computed(() => (plan.value?.skipped ?? []).slice(0, 20))
const opened = ref(false)
const applySummary = computed(() => {
  const result = applyResult.value
  if (!result) return ''
  return `已导入 ${result.createdCount} 个文件（复用 ${result.reusedCount} 个，失败 ${result.failedCount} 个）。`
})

async function request(channel, payload) {
  if (!props.bridge?.request) {
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '这一步没连上本地服务，暂时办不了。请重启应用后再试。' } }
  }
  const result = await props.bridge.request(channel, payload)
  if (result?.ok) return result
  return { ok: false, error: result?.error ?? { code: 'PINAX_INVALID_INPUT', message: '这一步没有回结果，请稍后再试。' } }
}

function resetResult() {
  plan.value = null
  applyResult.value = null
  error.value = null
}

function goStep(next) {
  error.value = null
  step.value = next
}

async function pickDir() {
  if (busy.value) return
  const result = await request(IPC_CHANNELS.projectPickDir, {})
  if (!result.ok) { error.value = result.error; return }
  if (!result.value?.picked) return
  libraryDir.value = result.value.path
  if (!libraryName.value.trim()) libraryName.value = folderName(result.value.path) || ''
  resetResult()
}

async function pickAutoSource() {
  if (busy.value) return
  const result = await request(IPC_CHANNELS.projectPickDir, { purpose: 'import-source' })
  if (!result.ok) { error.value = result.error; return }
  if (!result.value?.picked) return
  autoSourceDir.value = result.value.path
  resetResult()
}

async function pickClassDir(item) {
  if (busy.value) return
  const result = await request(IPC_CHANNELS.projectPickDir, { purpose: 'import-source' })
  if (!result.ok) { error.value = result.error; return }
  if (!result.value?.picked) return
  item.dir = result.value.path
  resetResult()
}

async function ensureProject() {
  const created = await request(IPC_CHANNELS.projectCreate, {
    name: libraryName.value.trim() || '未命名新书',
    primaryCarrier: primaryId.value,
    extraEnabled: companionIds.value,
    root: libraryDir.value
  })
  if (!created.ok) { error.value = created.error; return false }
  return true
}

function importPayload(dryRun) {
  if (importStyle.value === 'auto') {
    return { sourcePath: autoSourceDir.value, targetPath: libraryDir.value, dryRun }
  }
  return {
    sources: enabledClasses.value.map((item) => ({ category: item.category, path: item.dir })),
    targetPath: libraryDir.value,
    dryRun
  }
}

async function generatePlan() {
  if (!canPlan.value) return
  busy.value = 'plan'
  error.value = null
  const ready = await ensureProject()
  if (!ready) { busy.value = ''; return }
  const planned = await request(IPC_CHANNELS.projectImportRun, importPayload(true))
  busy.value = ''
  if (!planned.ok) { error.value = planned.error; return }
  plan.value = planned.value
  goStep('review')
}

async function runImport() {
  if (!canApply.value) return
  busy.value = 'apply'
  error.value = null
  const applied = await request(IPC_CHANNELS.projectImportRun, importPayload(false))
  busy.value = ''
  if (!applied.ok) { error.value = applied.error; return }
  applyResult.value = applied.value
}

/** 完成页出口一：「打开这个库」。 */
async function openNow() {
  if (!props.bridge?.request || !libraryDir.value) return
  busy.value = 'open'
  const openedResult = await request(IPC_CHANNELS.projectOpen, { root: libraryDir.value })
  busy.value = ''
  if (!openedResult.ok) { error.value = openedResult.error; return }
  opened.value = true
  emit('import-open', { path: libraryDir.value })
}

/** 完成页出口二：「回到我的库」（留在库管理器，列表刷新由外壳负责）。 */
function backToList() {
  emit('done', { root: null })
}

function nextLabel() {
  if (busy.value === 'plan') return '正在生成计划…'
  if (busy.value === 'apply') return '导入中…'
  if (step.value === 'sources') return '生成导入计划'
  if (step.value === 'review') return '执行导入'
  return '下一步'
}

function canNext() {
  if (step.value === 'position') return canNextPosition.value
  if (step.value === 'primary') return canNextPrimary.value
  if (step.value === 'sources') return canNextSources.value && Boolean(libraryName.value.trim())
  if (step.value === 'review') return canApply.value
  return false
}

function next() {
  if (step.value === 'position' && canNextPosition.value) return goStep('primary')
  if (step.value === 'primary' && canNextPrimary.value) return goStep('sources')
  if (step.value === 'sources') return generatePlan()
  if (step.value === 'review') return runImport()
}

function back() {
  if (step.value === 'review') { resetResult(); goStep('sources'); return }
  if (step.value === 'sources') { goStep('primary'); return }
  if (step.value === 'primary') { goStep('position'); return }
  emit('back')
}

function backLabel() {
  return step.value === 'position' ? '回到我的库' : '上一步'
}
</script>

<template>
  <div class="lib-page" data-test="library-import-page">
    <h2 class="lib-page-title">导入既有稿</h2>
    <p class="lib-page-lead" data-test="import-lead">导入会新建一个库并把稿子复制进去，原文件不动。</p>

    <ol class="lib-steps" data-test="import-steps">
      <li v-for="(label, index) in ['位置', '主模块', '选稿', '预览']" :key="label"
        :class="{ 'is-current': index === stepIndex, 'is-done': index < stepIndex }">{{ index + 1 }}. {{ label }}</li>
    </ol>

    <p v-if="error" class="prefs-state is-error" data-test="import-error">
      <strong>{{ error.code }}</strong>
      <span>{{ error.message }}</span>
    </p>

    <!-- ① 位置 -->
    <div v-if="step === 'position'" class="prefs-grid">
      <div class="prefs-row">
        <span class="prefs-row-label">库名</span>
        <input v-model="libraryName" class="nx-field prefs-input" type="text" placeholder="未命名新书" :disabled="Boolean(busy)">
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">库文件夹</span>
        <button type="button" class="control-secondary" data-test="import-pick-dir" :disabled="Boolean(busy)" @click="pickDir">选择空目录…</button>
        <span class="prefs-row-hint" title="选中后该目录成为库根（需为空目录）">{{ libraryDir || '尚未选择' }}</span>
      </div>
    </div>

    <!-- ② 主模块 -->
    <div v-else-if="step === 'primary'" class="prefs-grid">
      <p class="lib-page-lead is-tight">这个库要创作什么？主模块决定项目形态；勾选的稿类所属模块会自动带上。</p>
      <div class="lib-primary-row">
        <button
          v-for="carrier in primaryCarriers" :key="carrier.id"
          type="button"
          class="control-secondary lib-primary-card"
          :class="{ 'is-picked': primaryId === carrier.id }"
          :data-test="`import-primary-${carrier.projectKind}`"
          :disabled="Boolean(busy)"
          @click="primaryId = carrier.id"
        >
          <strong>{{ carrier.title }}</strong>
          <span>以{{ carrier.title }}为主的{{ carrier.projectKind === 'screenplay' ? '剧本' : '小说' }}库</span>
        </button>
      </div>
    </div>

    <!-- ③ 选稿：逐类勾选（一种或几种）或一个目录自动识别 -->
    <div v-else-if="step === 'sources'" class="prefs-grid">
      <div class="prefs-row" role="radiogroup" aria-label="选稿方式">
        <label class="wiz-mode"><input v-model="importStyle" type="radio" value="pick" :disabled="Boolean(busy)">逐类勾选（一种或几种）</label>
        <label class="wiz-mode"><input v-model="importStyle" type="radio" value="auto" :disabled="Boolean(busy)">一个目录自动识别</label>
      </div>

      <template v-if="importStyle === 'pick'">
        <p class="prefs-row-hint">勾哪类就给哪类一个只读目录；正文章节仍要认得出章节号，世界书仍要合规，认不出的会如实跳过并列在计划里。</p>
        <div v-for="item in picked" :key="item.category" class="prefs-row wiz-class-row" data-test="import-class-row">
          <label class="wiz-class-toggle">
            <input v-model="item.enabled" type="checkbox" :disabled="Boolean(busy)">
            <span>{{ item.label }}</span>
          </label>
          <button v-if="item.enabled" type="button" class="control-secondary" :disabled="Boolean(busy)" @click="pickClassDir(item)">选择目录…</button>
          <span v-if="item.enabled" class="prefs-row-hint">{{ item.dir || '尚未选择' }}</span>
        </div>
      </template>
      <div v-else class="prefs-row">
        <span class="prefs-row-label">稿子目录</span>
        <button type="button" class="control-secondary" data-test="import-pick-source" :disabled="Boolean(busy)" @click="pickAutoSource">选择稿子目录…</button>
        <span class="prefs-row-hint" data-test="import-source">{{ autoSourceDir || '只读源目录：按顶层目录名与文件形态自动分类，认不出的如实跳过' }}</span>
      </div>
    </div>

    <!-- ④ 预览 -->
    <section v-else-if="step === 'review' && plan" class="import-plan" data-test="import-plan-view">
      <p class="prefs-state">
        这是预览，还没有写入任何文件：可导入 {{ plan.importable }} 个，跳过 {{ plan.skippedCount }} 个<span v-if="plan.collapsedCount">（同源重复 {{ plan.collapsedCount }} 个已合并）</span>。
      </p>
      <ul v-if="categoryRows.length" class="import-plan-list">
        <li v-for="row in categoryRows" :key="row.key" data-test="import-category">{{ row.label }}：{{ row.count }}</li>
      </ul>
      <p v-else class="prefs-row-hint">没有可导入的文件：回到上一步核对目录，或按跳过原因整理源目录后重新生成计划。</p>
      <p v-for="(warning, index) in plan.warnings" :key="`w${index}`" class="prefs-row-hint">{{ warning }}</p>
      <div v-if="skippedPreview.length" class="import-skipped">
        <p class="prefs-row-label">跳过 {{ plan.skippedCount }} 个，前 {{ skippedPreview.length }} 条：</p>
        <ul class="import-plan-list">
          <li v-for="item in skippedPreview" :key="item.file" data-test="import-skipped">
            {{ item.file }} — {{ item.reason }}<span v-if="item.detail">（{{ item.detail }}）</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- 完成页（工单 A-6：两个出口） -->
    <div v-if="applyResult" class="prefs-grid" data-test="import-done">
      <p class="prefs-state is-ready">{{ applySummary }}</p>
      <div class="prefs-actions">
        <button type="button" class="control-primary" data-test="import-open-now" :disabled="busy === 'open'" @click="openNow">打开这个库</button>
        <button type="button" class="control-secondary" data-test="import-back-list" @click="backToList">回到我的库</button>
      </div>
    </div>

    <div v-if="!applyResult" class="prefs-actions">
      <button type="button" class="control-secondary" data-test="import-back" :disabled="Boolean(busy)" @click="back">{{ backLabel() }}</button>
      <button
        type="button"
        class="control-primary"
        data-test="import-next"
        :disabled="!canNext() || Boolean(busy)"
        @click="next"
      >{{ nextLabel() }}</button>
      <span v-if="step === 'review'" class="prefs-row-hint">执行会按计划写进库：只新增标准目录里的文件，不覆盖已有内容。</span>
    </div>
  </div>
</template>

<style scoped>
/* 导入整页（工单 A-6）：与新建库同一套页面词汇；间距 4 的倍数；字号全走令牌。 */
.lib-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.lib-page-title {
  margin: 0;
  font-size: var(--nx-fs-xl);
  font-weight: 600;
  color: var(--text-primary);
}
.lib-page-lead {
  margin: 0;
  font-size: var(--nx-fs-md);
  color: var(--text-secondary);
}
.lib-page-lead.is-tight { margin: 0; }
.lib-steps {
  display: flex;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--nx-fs-md);
  color: var(--text-muted);
}
.lib-steps .is-current { color: var(--text-primary); font-weight: 600; }
.lib-steps .is-done { color: var(--text-secondary); }
.lib-primary-row { display: flex; gap: 12px; flex-wrap: wrap; }
.lib-primary-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 180px;
  padding: 12px 16px;
  text-align: left;
}
.lib-primary-card.is-picked { border-color: var(--workbench-selected); color: var(--text-primary); }
.lib-primary-card span { font-size: var(--nx-fs-2xs); color: var(--text-muted); }
.wiz-mode { display: inline-flex; align-items: center; gap: 6px; font-size: var(--nx-fs-md); color: var(--text-secondary); }
.wiz-class-row { align-items: center; }
.wiz-class-toggle { display: inline-flex; align-items: center; gap: 8px; min-width: 150px; font-size: var(--nx-fs-md); color: var(--text-secondary); }
.import-plan { display: flex; flex-direction: column; gap: 10px; }
.import-plan-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding-left: 18px; font-size: var(--nx-fs-md); color: var(--text-secondary); }
.import-skipped { display: flex; flex-direction: column; gap: 6px; }
</style>
