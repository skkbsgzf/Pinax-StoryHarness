<script setup>
import { computed, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'

/**
 * 新建／导入统一向导（作者 2026-11-11 点单：「项目的新建和导入，考虑周全，做成完整的流，
 * 导入小说，剧本，世界书的一种或几种都可以」）。
 *
 * 一个组件两种入场（settings 目录两节共用，入口步不同）：
 *   · mode="create"：①位置 → ②创作什么（主载体，D2 正式问法）→ 建好即打开；
 *   · mode="import"：①位置 → ②创作什么 → ③选稿（自动识别一个目录，或逐类勾选——
 *     正文／剧本／世界书／大纲／约束／构思／资料／日志，一种或几种，各给一个只读源目录）
 *     → ④预览（dryRun 计划，按类分组）→ 执行 → 打开新项目。
 *
 * 主载体不再由外壳硬编码第一个 primary（旧口径只回小说）：向导从 primaryCarriers 里让作者选，
 * 建出来的项目 kind 跟着走；勾选的稿类会把它所属的载体自动并进伴生启用（extraEnabled）——
 * 剧本项目里勾了正文稿，小说载体也会被带上（正文/ 目录要有认领者）。
 *
 * 结构动作全部走既有通道：projectCreate／projectPickDir／projectImportRun（逐类 sources 由
 * next/runtime/projectImportAdapter 校验：类别闭集、绝对路径、互不包含、.pinax 闸）。
 * 源目录永远只读；执行只新增标准目录里的文件，不覆盖已有内容——与 E1 同一条承诺。
 */
let createdProjectRoot = null

const props = defineProps({
  bridge: { type: Object, default: null },
  /** 'create'＝从空白开始；'import'＝带上已有稿子。 */
  mode: { type: String, default: 'create' },
  /** 清单里声明了 primary 的板块（[{id, title, projectKind}]）——第②步让作者选，不猜。 */
  primaryCarriers: { type: Array, default: () => [] },
  /** 外壳的伴生默认（只读随行）：向导在这个基础上并选稿类对应的载体。 */
  extraEnabled: { type: Array, default: () => [] },
  /** 当前已打开项目的名字：导入会切换到新项目，先给一句明示。 */
  currentProjectName: { type: String, default: null }
})
const emit = defineEmits(['changed'])

/** 逐类清单：顺序即展示顺序；carrier＝勾选后要并进伴生启用的载体（null＝无需额外载体）。 */
const IMPORT_CLASSES = Object.freeze([
  { category: 'chapter', label: '正文（小说稿）', carrier: 'pinax.carrier.novel' },
  { category: 'script', label: '剧本', carrier: 'pinax.carrier.script' },
  { category: 'worldbook', label: '世界书', carrier: 'pinax.carrier.worldbook' },
  { category: 'outline', label: '大纲', carrier: 'pinax.carrier.outline' },
  { category: 'rule', label: '约束', carrier: 'pinax.carrier.dossier' },
  { category: 'idea', label: '构思', carrier: 'pinax.carrier.notes' },
  { category: 'source', label: '资料', carrier: 'pinax.carrier.dossier' },
  { category: 'log', label: '日志', carrier: null }
])

/** 计划按 decision 分组的人话（与适配器的 decision 名一一对应；顺序即展示顺序）。 */
const DECISION_ORDER = [
  ['chapter', '正文'],
  ['script', '剧本'],
  ['outline', '大纲'],
  ['outline-json', '大纲（结构化）'],
  ['worldbook', '世界书'],
  ['rule', '约束'],
  ['idea', '构思'],
  ['source', '资料'],
  ['source-json', '资料（归档 JSON）'],
  ['material', '资料（章节衍生）'],
  ['auxiliary', '资料（世界书辅助）'],
  ['log', '日志']
]

const isImport = computed(() => props.mode === 'import')
const step = ref('position')
const projectName = ref('')
const projectDir = ref(null)
const primaryId = ref(null)
const importStyle = ref('pick')
const autoSourceDir = ref(null)
const picked = ref(IMPORT_CLASSES.map((item) => ({ ...item, enabled: false, dir: null })))
const plan = ref(null)
const applyResult = ref(null)
const openedOk = ref(false)
const error = ref(null)
const busy = ref('')

const stepIndex = computed(() => (isImport.value
  ? ['position', 'primary', 'sources', 'review'].indexOf(step.value)
  : ['position', 'primary'].indexOf(step.value)))
const canNextPosition = computed(() => Boolean(projectDir.value))
const canNextPrimary = computed(() => Boolean(primaryId.value))
const enabledClasses = computed(() => picked.value.filter((item) => item.enabled))
const canNextSources = computed(() => (importStyle.value === 'auto'
  ? Boolean(autoSourceDir.value)
  : enabledClasses.value.length > 0 && enabledClasses.value.every((item) => item.dir)))

/** 伴生启用＝外壳默认 ∪ 勾选稿类对应的载体（主载体自己去重）。 */
const companionIds = computed(() => {
  const ids = new Set(props.extraEnabled ?? [])
  if (importStyle.value === 'pick') {
    for (const item of enabledClasses.value) {
      if (item.carrier && item.carrier !== primaryId.value) ids.add(item.carrier)
    }
  }
  return [...ids]
})

const primaryName = computed(() => props.primaryCarriers.find((item) => item.id === primaryId.value)?.title ?? primaryId.value ?? '')

const canPlan = computed(() => Boolean(
  props.bridge?.request && projectDir.value && primaryId.value && projectName.value.trim() && !busy.value
  && (isImport.value ? canNextSources.value : true)
))
const canApply = computed(() => Boolean(plan.value?.importable && !busy.value && !applyResult.value))
/** 当前这一步的「下一步」闸：每步只看自己要什么（最终动作的 canPlan 只在最后一步生效）。 */
const canNext = computed(() => {
  if (step.value === 'position') return canNextPosition.value
  if (step.value === 'primary') return canNextPrimary.value
  if (step.value === 'sources') return canNextSources.value && Boolean(projectName.value.trim())
  if (step.value === 'review') return canApply.value
  return false
})
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
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '这一步没连上本地服务，暂时办不了。请重启应用后再试。' } }
  }
  const result = await props.bridge.request(channel, payload)
  if (result?.ok) return result
  return { ok: false, error: result?.error ?? { code: 'PINAX_INVALID_INPUT', message: '这一步没有回结果，请稍后再试。' } }
}

function resetResult() {
  plan.value = null
  applyResult.value = null
  openedOk.value = false
  error.value = null
}

function goStep(next) {
  error.value = null
  step.value = next
}

async function pickProjectDir() {
  if (busy.value) return
  const result = await request(IPC_CHANNELS.projectPickDir, {})
  if (!result.ok) { error.value = result.error; return }
  if (!result.value?.picked) return
  projectDir.value = result.value.path
  if (!projectName.value.trim()) projectName.value = folderName(result.value.path) || '未命名新书'
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
  if (!projectName.value.trim() && enabledClasses.value[0] === item) projectName.value = folderName(item.dir) || '未命名新书'
  resetResult()
}

/** 建项目骨架：同一次会话里建过就跳过；失败原样把 typed error 摊开。 */
async function ensureProject() {
  if (createdProjectRoot && samePath(createdProjectRoot, projectDir.value)) return true
  const created = await request(IPC_CHANNELS.projectCreate, {
    name: projectName.value.trim() || '未命名新书',
    primaryCarrier: primaryId.value,
    extraEnabled: companionIds.value,
    root: projectDir.value
  })
  if (!created.ok) { error.value = created.error; return false }
  createdProjectRoot = projectDir.value
  return true
}

function importPayload(dryRun) {
  if (importStyle.value === 'auto') {
    return { sourcePath: autoSourceDir.value, targetPath: projectDir.value, dryRun }
  }
  return {
    sources: enabledClasses.value.map((item) => ({ category: item.category, path: item.dir })),
    targetPath: projectDir.value,
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
  if (!applied.ok) { busy.value = ''; error.value = applied.error; return }
  applyResult.value = applied.value
  // 导入是主进程直接写盘，不带修订号：完事再打开一次，视图与修订号重新读一遍。
  const opened = await request(IPC_CHANNELS.projectOpen, { root: projectDir.value })
  busy.value = ''
  if (!opened.ok) {
    error.value = { code: opened.error.code, message: `稿子已导入，但打开新项目失败：${opened.error.message}` }
    return
  }
  openedOk.value = true
  emit('changed')
}

async function createNow() {
  if (!canPlan.value) return
  busy.value = 'create'
  error.value = null
  const ready = await ensureProject()
  busy.value = ''
  if (!ready) return
  openedOk.value = true
  emit('changed')
}

function nextLabel() {
  if (!isImport.value) return busy.value === 'create' ? '正在创建…' : '创建并打开项目'
  if (step.value === 'sources') return busy.value === 'plan' ? '正在生成计划…' : '生成导入计划'
  if (step.value === 'review') return busy.value === 'apply' ? '导入中…' : '执行导入'
  return '下一步'
}

async function next() {
  if (step.value === 'position' && canNextPosition.value) return goStep('primary')
  if (step.value === 'primary' && canNextPrimary.value) {
    if (!isImport.value) return createNow()
    return goStep('sources')
  }
  if (step.value === 'sources') return generatePlan()
  if (step.value === 'review') return runImport()
}
</script>

<template>
  <div data-test="project-wizard">
    <p class="wizard-note" data-test="wizard-note">
      {{ isImport
        ? '带稿上车：位置 → 创作什么 → 选稿（小说／剧本／世界书等，一种或几种）→ 先看计划再执行，原文件只新增不修改。'
        : '新项目就是磁盘上的一个文件夹：选好位置、说清要创作什么，建好即打开。' }}
    </p>
    <p v-if="currentProjectName" class="wizard-note is-tight">
      当前打开的是《{{ currentProjectName }}》：向导会新建并切换到新项目，先把手上未保存的改动存好。
    </p>

    <ol class="wiz-steps" data-test="wizard-steps">
      <li v-for="(label, index) in (isImport ? ['位置', '创作什么', '选稿', '预览'] : ['位置', '创作什么'])"
        :key="label" :class="{ 'is-current': index === stepIndex, 'is-done': index < stepIndex }">
        {{ index + 1 }}. {{ label }}
      </li>
    </ol>

    <p v-if="error" class="prefs-state is-error" data-test="wizard-error">
      <strong>{{ error.code }}</strong>
      <span>{{ error.message }}</span>
    </p>

    <!-- ① 位置 -->
    <div v-if="step === 'position'" class="prefs-grid">
      <div class="prefs-row">
        <span class="prefs-row-label">项目名称</span>
        <input v-model="projectName" class="nx-field prefs-input" type="text" placeholder="未命名新书" :disabled="Boolean(busy)">
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">项目文件夹</span>
        <button type="button" class="control-secondary" data-test="wizard-pick-dir" :disabled="Boolean(busy)" @click="pickProjectDir">选择空目录…</button>
        <span class="prefs-row-hint" title="选中后该目录成为项目根（需为空目录；也可以在对话框里就地新建）">{{ projectDir || '尚未选择' }}</span>
      </div>
    </div>

    <!-- ② 创作什么（D2 正式问法；从声明了 primary 的板块里选，不猜） -->
    <div v-else-if="step === 'primary'" class="prefs-grid">
      <p class="wizard-note is-tight">这个项目要创作什么？决定了项目的主板块；其余板块随时可以在「载体管理」里补开。</p>
      <div class="wiz-primary-row">
        <button
          v-for="carrier in primaryCarriers" :key="carrier.id"
          type="button"
          class="control-secondary wiz-primary-card"
          :class="{ 'is-picked': primaryId === carrier.id }"
          :data-test="`wizard-primary-${carrier.projectKind}`"
          :disabled="Boolean(busy)"
          @click="primaryId = carrier.id"
        >
          <strong>{{ carrier.title }}</strong>
          <span>以{{ carrier.title }}为主的{{ carrier.projectKind === 'screenplay' ? '剧本' : '小说' }}项目</span>
        </button>
      </div>
      <p v-if="!primaryCarriers.length" class="prefs-row-hint">没有可任主载体的板块：先确认载体装载正常。</p>
    </div>

    <!-- ③ 选稿（仅导入）：自动识别一个目录，或逐类勾选（一种或几种） -->
    <div v-else-if="step === 'sources'" class="prefs-grid">
      <div class="prefs-row" role="radiogroup" aria-label="选稿方式">
        <label class="wiz-mode"><input v-model="importStyle" type="radio" value="pick" :disabled="Boolean(busy)">逐类勾选（一种或几种）</label>
        <label class="wiz-mode"><input v-model="importStyle" type="radio" value="auto" :disabled="Boolean(busy)">一个目录自动识别</label>
      </div>

      <template v-if="importStyle === 'pick'">
        <p class="prefs-row-hint">勾哪类就给哪类一个只读目录；目录里的文件按这一类收进项目的标准位置（正文章节仍要认得出章节号，世界书仍要合规，认不出的会如实跳过并列在计划里）。</p>
        <div v-for="item in picked" :key="item.category" class="prefs-row wiz-class-row" data-test="wizard-class-row">
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
        <button type="button" class="control-secondary" data-test="wizard-pick-source" :disabled="Boolean(busy)" @click="pickAutoSource">选择稿子目录…</button>
        <span class="prefs-row-hint" data-test="wizard-source">{{ autoSourceDir || '只读源目录：按顶层目录名与文件形态自动分类，认不出的如实跳过' }}</span>
      </div>
    </div>

    <!-- ④ 预览（仅导入）：dryRun 计划按类分组 -->
    <section v-else-if="step === 'review' && plan" class="import-plan" data-test="wizard-plan-view">
      <p class="prefs-state">
        这是预览，还没有写入任何文件：可导入 {{ plan.importable }} 个，跳过 {{ plan.skippedCount }} 个<span v-if="plan.collapsedCount">（同源重复 {{ plan.collapsedCount }} 个已合并）</span>。
      </p>
      <ul v-if="categoryRows.length" class="import-plan-list">
        <li v-for="row in categoryRows" :key="row.key" data-test="wizard-category">{{ row.label }}：{{ row.count }}</li>
      </ul>
      <p v-else class="prefs-row-hint">没有可导入的文件：回到上一步核对目录，或按跳过原因整理源目录后重新生成计划。</p>
      <p v-for="(warning, index) in plan.warnings" :key="`w${index}`" class="prefs-row-hint">{{ warning }}</p>
      <div v-if="skippedPreview.length" class="import-skipped">
        <p class="prefs-row-label">跳过 {{ plan.skippedCount }} 个，前 {{ skippedPreview.length }} 条：</p>
        <ul class="import-plan-list">
          <li v-for="item in skippedPreview" :key="item.file" data-test="wizard-skipped">
            {{ item.file }} — {{ item.reason }}<span v-if="item.detail">（{{ item.detail }}）</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- 完成态 -->
    <p v-if="openedOk" class="prefs-state is-ready" data-test="wizard-done">
      {{ isImport && applyResult ? applySummary : '项目已创建并打开。' }}
    </p>

    <div class="prefs-actions">
      <button v-if="stepIndex > 0" type="button" class="control-secondary" :disabled="Boolean(busy)" @click="goStep(isImport ? ['position', 'primary', 'sources', 'review'][stepIndex - 1] : ['position', 'primary'][stepIndex - 1])">上一步</button>
      <button
        type="button"
        class="control-primary"
        data-test="wizard-next"
        :disabled="!canNext || openedOk"
        @click="next"
      >{{ nextLabel() }}</button>
      <span v-if="step === 'review'" class="prefs-row-hint">执行会按计划写进项目：只新增标准目录里的文件，不覆盖已有内容。</span>
      <span v-else-if="step === 'primary' && primaryId" class="prefs-row-hint">主板块：{{ primaryName }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 步骤条／主载体卡／逐类行的排布补齐；字号与颜色一律走 token（禁裸 px 字号与圆角）。 */
.wiz-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
  font-size: var(--nx-fs-md);
  color: var(--text-muted);
}
.wiz-steps .is-current { color: var(--text-primary); font-weight: 600; }
.wiz-steps .is-done { color: var(--text-secondary); }
.wiz-primary-row { display: flex; gap: 10px; flex-wrap: wrap; }
.wiz-primary-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 180px;
  padding: 10px 14px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-raised);
  color: var(--text-secondary);
  font-size: var(--nx-fs-md);
  cursor: pointer;
  text-align: left;
}
.wiz-primary-card.is-picked { border-color: var(--workbench-selected); color: var(--text-primary); }
.wiz-primary-card span { font-size: var(--nx-fs-2xs); color: var(--text-muted); }
.wiz-mode { display: inline-flex; align-items: center; gap: 6px; font-size: var(--nx-fs-md); color: var(--text-secondary); }
.wiz-class-row { align-items: center; }
.wiz-class-toggle { display: inline-flex; align-items: center; gap: 8px; min-width: 150px; font-size: var(--nx-fs-md); color: var(--text-secondary); }
.import-plan { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
.import-plan-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding-left: 18px; font-size: var(--nx-fs-md); color: var(--text-secondary); }
.import-skipped { display: flex; flex-direction: column; gap: 6px; }
</style>
