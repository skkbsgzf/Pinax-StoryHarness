<script setup>
import { computed, onMounted, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'

/**
 * 技能库（批次77 任务5 · 设置页）。
 *
 * 这一节只做一件事：把装载层（next/skills/loadSkills.mjs）已经答出来的话摊开——
 * 哪几条装上了、哪几条被作者关了、哪几条装不上**以及为什么**、每一条属于哪个适用任务域。
 * 判定不在这里长第二份：启停真值、两层目录、拒装原因全走 skills:* 四条通道交回装载层，
 * 所以「屏上说的」与「模型看得见的清单」不可能各说一套。
 *
 * 守卫⑪（技能未装载必须可见原因）落在 `rejected` 那一块：整包没装载时这里给的是每一条的
 * code＋原因＋它来自哪层目录，**不是**一句「暂无技能」的空态。
 */
const props = defineProps({
  bridge: { type: Object, default: null }
})

const loading = ref(false)
const busyName = ref('')
const feedback = ref(null)
const snapshot = ref(null)
const openedBody = ref(null)
const importPath = ref('')
const importResult = ref(null)
const importing = ref(false)

const rows = computed(() => (Array.isArray(snapshot.value?.rows) ? snapshot.value.rows : []))
const rejected = computed(() => (Array.isArray(snapshot.value?.rejected) ? snapshot.value.rejected : []))
const layers = computed(() => (Array.isArray(snapshot.value?.layers) ? snapshot.value.layers : []))
const surface = computed(() => snapshot.value?.surface ?? null)

/** 关掉的那几条排在后面：作者每次进这页要先看到「现在生效的是哪些」，再翻剩下的。 */
const enabledRows = computed(() => rows.value.filter((row) => row.enabled))
const disabledRows = computed(() => rows.value.filter((row) => !row.enabled))

function request(channel, payload) {
  if (!props.bridge?.request) return Promise.resolve({ ok: false, error: { message: 'IPC 桥未接入' } })
  return props.bridge.request(channel, payload).then(
    (result) => result ?? { ok: false, error: { message: '技能通道没有回结果' } },
    (error) => ({ ok: false, error: { message: String(error?.message || error) } })
  )
}

async function reload() {
  loading.value = true
  const result = await request(IPC_CHANNELS.skillsList, {})
  loading.value = false
  if (!result.ok) {
    feedback.value = { kind: 'error', text: result?.error?.message ?? '技能清单读不出来。' }
    return
  }
  feedback.value = null
  snapshot.value = result.value ?? null
}

async function toggle(row) {
  if (busyName.value) return
  busyName.value = row.name
  const result = await request(IPC_CHANNELS.skillsToggle, { name: row.name, enabled: !row.enabled })
  busyName.value = ''
  if (!result.ok) {
    feedback.value = { kind: 'error', text: result?.error?.message ?? `「${row.name}」启停失败。` }
    return
  }
  feedback.value = {
    kind: 'ok',
    text: row.enabled
      ? `已停用「${row.name}」：它从提示词的可用技能清单里退出去了，重新打开即时生效。`
      : `已启用「${row.name}」：下一问的清单里就有它。`
  }
  await reload()
}

/** 正文是点开才取的那一份（清单里永远不带 body——渐进披露那道闸）。 */
async function showBody(row) {
  if (busyName.value) return
  if (openedBody.value?.name === row.name) {
    openedBody.value = null
    return
  }
  busyName.value = row.name
  const result = await request(IPC_CHANNELS.skillsBody, { name: row.name })
  busyName.value = ''
  if (!result.ok) {
    feedback.value = { kind: 'error', text: result?.error?.message ?? `读不到「${row.name}」的正文。` }
    openedBody.value = null
    return
  }
  feedback.value = null
  openedBody.value = { name: row.name, ...(result.value ?? {}) }
}

async function runImport() {
  const source = importPath.value.trim()
  if (!source || importing.value) return
  importing.value = true
  importResult.value = null
  const result = await request(IPC_CHANNELS.skillsImport, { sourceDir: source })
  importing.value = false
  if (!result.ok) {
    feedback.value = { kind: 'error', text: result?.error?.message ?? '导入失败。' }
    return
  }
  importResult.value = result.value ?? null
  feedback.value = null
  await reload()
}

onMounted(reload)
</script>

<template>
  <div class="skills-section">
    <p class="wizard-note">
      技能是方法说明书，不是入口：入口仍是斜杠命令与自然语言提问。启停存在<b>本项目</b>的
      <code>.pinax/skills.json</code>，导入的包落在 <code>.pinax/skills/</code>——都不写全局偏好，换项目不该带走上一本书的开关。
    </p>

    <p v-if="surface && !surface.started" class="pane-hint skills-surface-note" data-test="skills-surface-note">{{ surface.note }}</p>

    <div class="skills-toolbar">
      <button type="button" class="control-secondary" data-test="skills-reload" :disabled="loading" @click="reload">
        {{ loading ? '读取中…' : '重新扫描' }}
      </button>
      <span class="pane-hint skills-count" data-test="skills-count">
        生效 {{ enabledRows.length }} 条 · 已停用 {{ disabledRows.length }} 条 · 装不上 {{ rejected.length }} 条
      </span>
    </div>

    <p v-if="feedback" class="prefs-state skills-feedback" :class="feedback.kind === 'ok' ? 'is-ready' : 'is-error'" data-test="skills-feedback">{{ feedback.text }}</p>

    <!-- 装不上的每一条：守卫⑪ 不许这里退化成空态。目录名／来源层／原因码都要在，作者才查得动。 -->
    <ul v-if="rejected.length" class="skills-rejected" data-test="skills-rejected">
      <li v-for="(item, index) in rejected" :key="`${item.dir}:${item.code}:${index}`" class="skills-rejected-row" :data-test="`skills-reject-${item.dir}`">
        <span class="skills-rejected-name">{{ item.dir }}</span>
        <span class="skills-chip skills-chip-error">{{ item.code }}</span>
        <span v-if="item.originLabel" class="skills-chip">{{ item.originLabel }}</span>
        <span class="skills-rejected-message">{{ item.message }}</span>
      </li>
    </ul>

    <p v-if="!rows.length && !rejected.length && !loading" class="pane-hint" data-test="skills-empty">
      当前没有可装载的技能包{{ surface && !surface.started ? '（工具面还没装配，装载校验做不了）' : '' }}
    </p>

    <div v-for="group in [{ label: '生效中', items: enabledRows }, { label: '已停用', items: disabledRows }]" :key="group.label">
      <p v-if="group.items.length" class="skills-group-label" :data-test="`skills-group-${group.label}`">{{ group.label }}</p>
      <div class="prefs-grid">
        <div
          v-for="row in group.items"
          :key="row.name"
          class="prefs-row skills-row"
          :data-test="`skills-row-${row.name}`"
          :data-enabled="row.enabled ? 'true' : 'false'"
        >
          <div class="skills-row-main">
            <span class="skills-row-name">{{ row.name }}</span>
            <span class="skills-chip" data-test="skills-domain-label">{{ row.domainLabel }}</span>
            <span v-if="row.kindLabel" class="skills-chip skills-chip-style" data-test="skills-kind-label">{{ row.kindLabel }}</span>
            <span class="skills-chip">{{ row.originLabel }}</span>
            <span class="skills-chip skills-chip-muted">{{ row.output }}</span>
            <p class="skills-row-desc">{{ row.description }}</p>
            <p class="skills-row-tools">声明工具：{{ row.tools.length ? row.tools.join('、') : '（无）' }}</p>
          </div>
          <span class="prefs-actions skills-actions">
            <button
              type="button"
              class="control-quiet"
              data-test="skills-body-toggle"
              :disabled="!!busyName"
              @click="showBody(row)"
            >{{ openedBody?.name === row.name ? '收起正文' : '查看正文' }}</button>
            <button
              type="button"
              :class="row.enabled ? 'control-secondary' : 'control-primary'"
              :data-test="`skills-toggle-${row.name}`"
              :disabled="!!busyName"
              @click="toggle(row)"
            >{{ row.enabled ? '停用' : '启用' }}</button>
          </span>
          <pre v-if="openedBody?.name === row.name" class="skills-body" data-test="skills-body-view">{{ openedBody.body }}</pre>
        </div>
      </div>
    </div>

    <!-- 导入：源目录可以是「一个包」，也可以是「一层摆着若干个包的父目录」。不合格逐条列原因——拒装是正常态。 -->
    <div class="skills-import" data-test="skills-import">
      <p class="section-title">导入技能包</p>
      <div class="skills-import-row">
        <input
          v-model="importPath"
          class="nx-field skills-import-path"
          type="text"
          placeholder="技能包目录（绝对路径）"
          aria-label="技能包目录"
          data-test="skills-import-path"
        >
        <button type="button" class="control-primary" data-test="skills-import-run" :disabled="importing || !importPath.trim()" @click="runImport">
          {{ importing ? '导入中…' : '导入到本项目' }}
        </button>
      </div>
      <p class="pane-hint">
        这一格还没接系统目录对话框（要接得动 <code>main.mjs</code> 的选目录白名单，批次77 未登记）：先手工粘绝对路径。
        导入只写 <code>.pinax/skills/</code>，随包那份技能永远赢同名仲裁。
      </p>
      <div v-if="importResult" class="skills-import-result" data-test="skills-import-result">
        <p v-if="importResult.imported?.length" data-test="skills-imported">
          拷进来了 {{ importResult.imported.length }} 条：{{ importResult.imported.map((item) => item.name).join('、') }}
        </p>
        <ul v-if="importResult.rejected?.length" data-test="skills-import-rejected">
          <li v-for="(item, index) in importResult.rejected" :key="`${item.dir}:${item.code}:${index}`">
            {{ item.dir }} · {{ item.code }} · {{ item.message }}
          </li>
        </ul>
        <p v-if="!importResult.imported?.length && !importResult.rejected?.length" class="pane-hint">这里没有技能包。</p>
      </div>
    </div>

    <p v-if="layers.length" class="pane-hint skills-layers" data-test="skills-layers">
      扫过的目录：
      <span v-for="layer in layers" :key="layer.dir" class="skills-layer">
        {{ layer.origin === 'project' ? '项目导入层' : '随包层' }} {{ layer.exists ? '有包' : '（没有这一层，属常态）' }}
      </span>
    </p>
  </div>
</template>

<style scoped>
/* 行结构照 ServicesSection／prefs-grid 那一份度量：名字与 chip 一行，描述与声明工具各占一行，动作靠右。 */
.skills-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
}
.skills-count {
  font-size: var(--nx-fs-2xs);
}
.skills-feedback {
  margin: 0 0 10px;
}
.skills-surface-note {
  margin: 0 0 10px;
  color: var(--signal-warm);
}
.skills-rejected {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: var(--nx-radius-xs);
  background: var(--surface-workbench-muted);
  list-style: none;
  font-size: var(--nx-fs-2xs);
}
.skills-rejected-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
}
.skills-rejected-name {
  color: var(--text-primary);
}
.skills-rejected-message {
  flex: 1 1 240px;
  color: var(--text-secondary);
}
.skills-group-label {
  margin: 12px 0 6px;
  color: var(--text-muted);
  font-size: var(--nx-fs-2xs);
  letter-spacing: 0.06em;
}
.skills-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px 12px;
}
.skills-row-main {
  flex: 1 1 320px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.skills-row-name {
  font-size: var(--nx-fs-md);
  color: var(--archive-ink);
}
.skills-row-desc,
.skills-row-tools {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  color: var(--text-secondary);
}
.skills-row-tools {
  color: var(--text-muted);
}
.skills-chip {
  align-self: flex-start;
  padding: 1px 7px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-xs);
  font-size: var(--nx-fs-2xs);
  color: var(--text-secondary);
}
.skills-chip-muted {
  color: var(--text-muted);
}
.skills-chip-error {
  color: var(--control-danger);
  border-color: color-mix(in srgb, var(--control-danger) 40%, transparent);
}
.skills-chip-style {
  color: var(--signal-warm);
  border-color: color-mix(in srgb, var(--signal-warm) 40%, transparent);
}
.skills-actions {
  flex: none;
  display: flex;
  gap: 6px;
}
.skills-body {
  flex: 1 1 100%;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--nx-radius-xs);
  background: var(--surface-workbench-muted);
  color: var(--text-secondary);
  font-size: var(--nx-fs-2xs);
  line-height: 1.7;
  white-space: pre-wrap;
  max-height: 320px;
  overflow-y: auto;
}
.skills-import {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--hairline-soft);
}
.skills-import-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.skills-import-path {
  flex: 1 1 auto;
  min-width: 0;
}
.skills-import-result {
  margin-top: 8px;
  font-size: var(--nx-fs-2xs);
  color: var(--text-secondary);
}
.skills-import-result ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
.skills-layers {
  margin-top: 12px;
}
.skills-layer {
  margin-right: 8px;
}
</style>
