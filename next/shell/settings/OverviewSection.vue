<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'
import { buildOverviewRows, fieldStyleVars, overviewJson } from './fields.mjs'

/**
 * 设置总览（工单 P2-4 · 只读）。
 *
 * 「应用」组最底部的一节：把 prefs:get 拿到的每个键摊成一张只读表——键、所属层、文件、当前值，
 * 外加「复制为 JSON」。用途是排查与迁移（规格 §5.4 / 问题 7：改坏了只能删文件、排查时拿不到
 * 一份可读的当前配置），所以它没有输入控件，也不写任何东西。
 *
 * 数据源＝prefs:get 的返回值＋./fields.mjs 里的静态层/文件映射（纯函数，单测逐键对账）。
 * 文件名与层名只住在 fields.mjs：这里是「按数据摆表」，不在模板里另抄一份键表。
 * 它和其余设置节的「指南层」口径不冲突——其余节不把机制细节摆上常驻版面，这一节本身就是
 * 给排查准备的技术视图（工单 P2-4 点名的例外），文案仍不用黑话。
 */
const props = defineProps({
  bridge: { type: Object, default: null }
})

const rows = ref([])
const loadError = ref('')
const copied = ref('')
const fieldVars = fieldStyleVars()
let copyTimer = null

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  if (copyTimer) globalThis.clearTimeout(copyTimer)
  copyTimer = null
})

async function load() {
  if (!props.bridge?.request) {
    rows.value = buildOverviewRows({})
    return
  }
  loadError.value = ''
  try {
    const result = await props.bridge.request(IPC_CHANNELS.prefsGet, {})
    if (!result?.ok) {
      loadError.value = result?.error?.message ?? '读不到偏好：这一张表暂时是空的。'
      rows.value = buildOverviewRows({})
      return
    }
    rows.value = buildOverviewRows(result.value)
  } catch (error) {
    loadError.value = String(error?.message || error)
    rows.value = buildOverviewRows({})
  }
}

async function copyJson() {
  if (!rows.value.length) return
  try {
    await globalThis.navigator?.clipboard?.writeText?.(overviewJson(rows.value))
  } catch {
    copied.value = '复制没成功：这台机器不允许写入剪贴板。'
    return
  }
  copied.value = '已复制'
  if (copyTimer) globalThis.clearTimeout(copyTimer)
  // 与「已保存」同一个口径：两秒后自己退场，不留一条常驻回执。
  copyTimer = globalThis.setTimeout(() => {
    copied.value = ''
    copyTimer = null
  }, 2000)
}
</script>

<template>
  <div class="settings-overview" :style="fieldVars">
    <p class="settings-save-model" data-test="overview-save-model">只读视图：这里改不了任何东西，改哪一项就回左栏对应的那一节。</p>
    <p class="wizard-note is-tight">列出每个应用级键、它属于哪一层、存在哪个文件、以及当前值。用来排查与迁移。</p>
    <p v-if="loadError" class="settings-field-error" data-test="overview-error">{{ loadError }}</p>

    <div class="overview-scroll">
      <table class="overview-table" data-test="overview-table">
        <thead>
          <tr>
            <th scope="col">键</th>
            <th scope="col">所属层</th>
            <th scope="col">文件</th>
            <th scope="col">当前值</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" :data-test="`overview-row-${row.key}`">
            <td class="overview-key"><code>{{ row.key }}</code></td>
            <td class="overview-layer">{{ row.layer }}</td>
            <td class="overview-file"><code>{{ row.file }}</code></td>
            <td class="overview-value"><code>{{ row.value }}</code></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="overview-actions">
      <button type="button" class="control-secondary" :disabled="!rows.length" data-test="overview-copy" @click="copyJson">复制为 JSON</button>
      <span v-if="copied" class="overview-status" role="status" data-test="overview-copied">{{ copied }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 只读表：等宽键名与值，长值在格子里换行（不撑破右栏）。字号/圆角全部走 token。 */
.settings-overview {
  display: flex;
  flex-direction: column;
  gap: var(--settings-field-gap, 16px);
  min-width: 0;
}
.settings-save-model {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  font-weight: 600;
  color: var(--text-muted);
}
.settings-field-error {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  color: var(--control-danger);
}
.overview-scroll {
  min-width: 0;
  overflow-x: auto;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-xs);
}
.overview-table {
  width: 100%;
  min-width: 520px;
  border-collapse: collapse;
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
}
.overview-table th {
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface-workbench-muted);
  border-bottom: 1px solid var(--hairline-soft);
  white-space: nowrap;
}
.overview-table td {
  padding: 8px 10px;
  vertical-align: top;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--hairline-soft);
  overflow-wrap: anywhere;
}
.overview-table tr:last-child td {
  border-bottom: 0;
}
/* 键名/文件名/值是机器产物，用等宽（门禁⑯的 mono 面只认 code 这类元素，故走 <code>）。 */
.overview-table code {
  font-family: var(--font-mono);
  font-size: inherit;
  font-variant-numeric: tabular-nums;
}
.overview-key {
  color: var(--archive-ink);
}
.overview-value {
  color: var(--archive-ink-soft);
}
.overview-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.overview-status {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
</style>
