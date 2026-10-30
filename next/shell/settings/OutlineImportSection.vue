<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { IPC_CHANNELS, IPC_EVENT } from '../ipcContract.mjs'

/**
 * 大纲转换 Section（批次30 · 任务三；批次37 接事件总线）。
 *
 * 作者真稿是 `大纲/001-004.md` 这种散文章节稿（一份文件里好几章），大纲载体的读工具只认
 * `outline.json`／`大纲.md` 两个名字——所以这里给一个「扫描 → 转换并导入」的入口：
 *   ① 打开本节自动扫描一次（dryRun=true，不写盘）：摊开「N 份 md · M 个章节标题」；
 *   ② 作者按下「转换并导入」才真的落盘（dryRun=false）：转换走主进程的 outline:import 通道
 *      （next/runtime/outlineImportService），现有节点一律不动、只追加缺的章节；
 *   ③ 成功后 emit('changed')，外壳走既有刷新路径，左树立刻长出节点。
 *
 * 批次37 起再多一条路：主进程的项目事件总线把 `outline-changed` 推到这里，本节自动重扫。
 * 所以「别处改了大纲/」不必再手动点「重新扫描」；本节自己按下的转换也发同一条事件，
 * 用 busy 与 1.5 秒窗口避开自我触发（否则刚摊开的结果行会被一次静默重扫冲掉）。
 *
 * 诚实边界：`### 小节` 不立节点；重复章节按 source 判同一节（重跑幂等）；冲突（STALE_REVISION）
 * 原样把 code + message 摊开，不重试、不覆盖。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  /** 当前已打开的项目（只用来显示「转换的是哪个项目的 大纲/」）。 */
  project: { type: Object, default: null },
  /** 转换成功后重列大纲树：同一项目没换根，refresh 的 projectRoot 监听不会触发，必须显式重读。 */
  reload: { type: Function, default: null }
})
const emit = defineEmits(['changed'])

const scan = ref(null)
const result = ref(null)
const error = ref(null)
/** '' | 'scan' | 'apply'——同一时刻只做一件事。 */
const busy = ref('')
/** 本项目最近一次成功转换的时刻：事件驱动的重扫要避开「自己刚发的」那一条。 */
let lastAppliedAt = 0
/** 项目事件退订函数（组件卸载时摘掉，不在弹窗关掉后继续收事件）。 */
let offProjectEvent = null

const projectName = computed(() => props.project?.name ?? null)
const scanSummary = computed(() => (scan.value
  ? `${scan.value.files} 份 md · ${scan.value.chapters} 个章节标题`
  : ''))
const pendingCount = computed(() => scan.value?.imported ?? 0)
const canApply = computed(() => Boolean(scan.value && pendingCount.value > 0 && !busy.value && !result.value))
const itemRows = computed(() => (result.value ?? scan.value)?.items ?? [])

async function request(channel, payload) {
  if (!props.bridge?.request) {
    return { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '渲染层未接主进程桥（preload 的 pinaxNext 通道）' } }
  }
  const called = await props.bridge.request(channel, payload)
  if (called?.ok) return called
  return { ok: false, error: called?.error ?? { code: 'PINAX_INVALID_INPUT', message: `通道 ${channel} 调用失败` } }
}

async function runScan() {
  if (busy.value) return
  busy.value = 'scan'
  result.value = null
  error.value = null
  const scanned = await request(IPC_CHANNELS.outlineImport, { dryRun: true })
  busy.value = ''
  if (!scanned.ok) {
    scan.value = null
    error.value = scanned.error
    return
  }
  scan.value = scanned.value
}

async function apply() {
  if (!canApply.value) return
  busy.value = 'apply'
  error.value = null
  const applied = await request(IPC_CHANNELS.outlineImport, { dryRun: false })
  busy.value = ''
  if (!applied.ok) {
    // 冲突（STALE_REVISION）与其它 typed error 一律原样摊开：不重试、不覆盖。
    error.value = applied.error
    return
  }
  result.value = applied.value
  lastAppliedAt = Date.now()
  // scan 保留为「转换前那一眼」，扫描行改读结果；要再看一次现状按「重新扫描」。
  // 左树立刻长出节点：先重列大纲树（同项目不换根，外壳 refresh 的 projectRoot 监听不会触发），
  // 再走既有 changed → AppNext.refresh 让视图（修订号等）重新读一遍。
  if (typeof props.reload === 'function') await props.reload()
  emit('changed')
}

/** 事件驱动重扫：只认 outline-changed；自己正在转换／刚转换完的那一下跳过（见文件头注释）。 */
function onProjectEvent(payload) {
  if (payload?.kind !== 'outline-changed') return
  if (busy.value) return
  if (result.value && Date.now() - lastAppliedAt < 1500) return
  result.value = null
  void runScan()
}

onMounted(() => {
  if (typeof props.bridge?.onEvent === 'function') {
    offProjectEvent = props.bridge.onEvent(IPC_EVENT.projectEvent, onProjectEvent)
  }
  void runScan()
})

onUnmounted(() => {
  if (offProjectEvent) {
    offProjectEvent()
    offProjectEvent = null
  }
})
</script>

<template>
  <div>
    <p class="wizard-note">
      把 大纲/ 目录里的散文章节稿（md）转成大纲节点：一份文件可以含多章，按「## 章节标题」拆节点，
      小节内容进节点备注。现有节点一律不动——只追加还没导入过的章节，重复点不会重复追加。
    </p>
    <p v-if="projectName" class="wizard-note is-tight">
      当前项目《{{ projectName }}》：转换的是这个项目 大纲/ 目录，源 md 一个字节都不改。
    </p>

    <div class="prefs-grid">
      <div class="prefs-row">
        <span class="prefs-row-label">扫描结果</span>
        <span class="prefs-row-hint" data-test="outline-scan">
          <template v-if="busy === 'scan'">正在扫描 大纲/ …</template>
          <template v-else-if="result">{{ result.files }} 份 md · {{ result.chapters }} 个章节标题（本次导入 {{ result.imported }} 章，复用 {{ result.reused }} 章）</template>
          <template v-else-if="scan">{{ scanSummary }}（待追加 {{ scan.imported }} 章，复用 {{ scan.reused }} 章）</template>
          <template v-else>还没有扫描结果</template>
        </span>
        <button type="button" class="control-secondary" data-test="outline-rescan" :disabled="Boolean(busy)" @click="runScan">重新扫描</button>
      </div>
      <div class="prefs-actions">
        <button type="button" class="control-primary" data-test="outline-apply" :disabled="!canApply" @click="apply">
          {{ busy === 'apply' ? '转换中…' : '转换并导入' }}
        </button>
        <span v-if="scan && !pendingCount" class="prefs-row-hint">没有新章节：现有节点已覆盖这些章节稿（重跑幂等，不会重复追加）。</span>
        <span v-else-if="!scan && !error" class="prefs-row-hint">先扫描，再决定是否转换。</span>
      </div>
    </div>

    <p v-if="error" class="prefs-state is-error" data-test="outline-error">
      <strong>{{ error.code }}</strong>
      <span>{{ error.message }}</span>
    </p>

    <p v-if="result" class="prefs-state is-ready" data-test="outline-done">
      导入 {{ result.imported }} 章 / 复用 {{ result.reused }} 章（共 {{ result.files }} 份 md，大纲现有 {{ result.nodeTotal }} 个节点）。
    </p>

    <ul v-if="itemRows.length" class="outline-import-list" data-test="outline-items">
      <li v-for="(item, index) in itemRows" :key="`${item.source}-${index}`">
        {{ item.status === 'imported' ? '导入' : '复用' }} · {{ item.title }}
      </li>
    </ul>

    <p v-for="(warning, index) in (result ?? scan)?.warnings ?? []" :key="`w${index}`" class="prefs-row-hint" data-test="outline-warning">
      {{ warning }}
    </p>
  </div>
</template>

<style scoped>
/* 只补清单排布；字号/颜色一律走 token（Next 自写样式禁裸 px 字号与圆角）。 */
.outline-import-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 12px 0 0;
  padding-left: 18px;
  font-size: var(--nx-fs-md);
  color: var(--text-secondary);
}
</style>
