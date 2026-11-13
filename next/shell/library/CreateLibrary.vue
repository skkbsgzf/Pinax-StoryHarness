<script setup>
import { computed, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'
import { folderName, validateLibraryName } from './wizardKit.mjs'

/**
 * 新建库（前端工单 A-4）：库管理器内的两步整页流——①位置与名称 → ②主模块。
 * 从原设置弹窗向导（ProjectWizardSection create 模式）迁出，行为合同不变：
 *   目录走系统对话框选空目录（createProject 的空目录闸原样）；主模块从声明 primary 的板块里选（D2 不猜）；
 *   建好即打开（projectCreate 通道内部完成），外壳 refresh 后工作区自然接管。
 * 底部「创建并开始写」是本页唯一主按钮（工单 A-4／C-3：一屏一主钮）。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  /** 可任主模块的板块（[{id, title, projectKind}]）。 */
  primaryCarriers: { type: Array, default: () => [] },
  /** 伴生默认（外壳的只读随行）。 */
  extraEnabled: { type: Array, default: () => [] },
  /** 打开失败卡联动的预填目录（A-5「在这里新建库」）。 */
  initialDir: { type: String, default: null },
  /** 相对时间等展示不需要；完成/返回通知。 */
  now: { type: Object, default: null }
})
const emit = defineEmits(['done', 'back'])

const step = ref(props.initialDir ? 'primary' : 'position')
const libraryName = ref('')
const libraryDir = ref(props.initialDir)
const primaryId = ref(null)
const busy = ref(false)
const error = ref(null)

const nameError = computed(() => (libraryName.value ? validateLibraryName(libraryName.value) : null))
const canCreate = computed(() => Boolean(
  props.bridge?.request && libraryDir.value && primaryId.value && !nameError.value && !busy.value
))

async function request(channel, payload) {
  if (!props.bridge?.request) {
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '这一步没连上本地服务，暂时办不了。请重启应用后再试。' } }
  }
  const result = await props.bridge.request(channel, payload)
  if (result?.ok) return result
  return { ok: false, error: result?.error ?? { code: 'PINAX_INVALID_INPUT', message: '这一步没有回结果，请稍后再试。' } }
}

async function pickDir() {
  if (busy.value) return
  const result = await request(IPC_CHANNELS.projectPickDir, {})
  if (!result.ok) { error.value = result.error; return }
  if (!result.value?.picked) return
  libraryDir.value = result.value.path
  if (!libraryName.value.trim()) libraryName.value = folderName(result.value.path) || ''
  error.value = null
}

async function create() {
  if (!canCreate.value) return
  busy.value = true
  error.value = null
  const created = await request(IPC_CHANNELS.projectCreate, {
    name: libraryName.value.trim(),
    primaryCarrier: primaryId.value,
    extraEnabled: props.extraEnabled ?? [],
    root: libraryDir.value
  })
  busy.value = false
  if (!created.ok) { error.value = created.error; return }
  // projectCreate 内部已把项目打开：外壳 refresh 后工作区接管（工单 A-4「创建成功后直接进入工作区」）。
  emit('done', { root: libraryDir.value })
}

function back() {
  if (step.value === 'primary') { step.value = 'position'; return }
  emit('back')
}

function nextLabel() {
  if (busy.value) return '正在创建…'
  return step.value === 'position' ? '下一步' : '创建并开始写'
}

function next() {
  if (step.value === 'position') {
    if (!libraryDir.value || nameError.value) return
    step.value = 'primary'
    return
  }
  void create()
}
</script>

<template>
  <div class="lib-page" data-test="library-create">
    <h2 class="lib-page-title">新建库</h2>
    <p class="lib-page-lead">新库就是磁盘上的一个空文件夹：会在该目录生成 <code>.pinax</code> 标记，不改动已有文件。</p>

    <ol class="lib-steps" data-test="create-steps">
      <li :class="{ 'is-current': step === 'position', 'is-done': step === 'primary' }">1. 位置与名称</li>
      <li :class="{ 'is-current': step === 'primary' }">2. 主模块</li>
    </ol>

    <p v-if="error" class="prefs-state is-error" data-test="create-error">
      <strong>{{ error.code }}</strong>
      <span>{{ error.message }}</span>
    </p>

    <!-- ① 位置与名称 -->
    <div v-if="step === 'position'" class="prefs-grid">
      <div class="prefs-row">
        <span class="prefs-row-label">库名</span>
        <input v-model="libraryName" class="nx-field prefs-input" type="text" placeholder="未命名新书" :disabled="busy">
        <span v-if="nameError" class="prefs-row-hint is-error-text">{{ nameError }}</span>
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">库文件夹</span>
        <button type="button" class="control-secondary" data-test="create-pick-dir" :disabled="busy" @click="pickDir">选择空目录…</button>
        <span class="prefs-row-hint" title="选中后该目录成为库根（需为空目录；也可以在对话框里就地新建）">{{ libraryDir || '尚未选择' }}</span>
      </div>
    </div>

    <!-- ② 主模块（D2 正式问法） -->
    <div v-else class="prefs-grid">
      <p class="lib-page-lead is-tight">这个库要创作什么？决定了主模块；其余模块以后还能加。</p>
      <div class="lib-primary-row">
        <button
          v-for="carrier in primaryCarriers" :key="carrier.id"
          type="button"
          class="control-secondary lib-primary-card"
          :class="{ 'is-picked': primaryId === carrier.id }"
          :data-test="`create-primary-${carrier.projectKind}`"
          :disabled="busy"
          @click="primaryId = carrier.id"
        >
          <strong>{{ carrier.title }}</strong>
          <span>以{{ carrier.title }}为主的{{ carrier.projectKind === 'screenplay' ? '剧本' : '小说' }}库</span>
        </button>
      </div>
      <p v-if="!primaryCarriers.length" class="prefs-row-hint">没有可任主模块的板块：先确认模块装载正常。</p>
      <p v-else class="prefs-row-hint">建好就能写，模块以后还能加。</p>
    </div>

    <div class="prefs-actions">
      <button type="button" class="control-secondary" data-test="create-back" :disabled="busy" @click="back">{{ step === 'position' ? '回到我的库' : '上一步' }}</button>
      <button
        type="button"
        class="control-primary"
        data-test="create-next"
        :disabled="step === 'position' ? (!libraryDir || Boolean(nameError) || busy) : !canCreate"
        @click="next"
      >{{ nextLabel() }}</button>
      <span v-if="step === 'primary' && primaryId" class="prefs-row-hint">主模块：{{ primaryCarriers.find((item) => item.id === primaryId)?.title ?? '' }}</span>
      <span v-else-if="step === 'position' && !libraryDir" class="prefs-row-hint">先选一个空目录，再下一步。</span>
    </div>
  </div>
</template>

<style scoped>
/* 新建库整页（工单 A-4）：步骤条＋卡片单选；间距 4 的倍数；字号全走令牌。 */
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
.lib-page-lead code {
  font-family: inherit;
  background: var(--surface-workbench-muted);
  padding: 0 4px;
  border-radius: var(--nx-radius-xs);
}
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
.is-error-text { color: var(--danger); }
</style>
