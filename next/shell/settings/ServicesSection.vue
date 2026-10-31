<script setup>
import { computed, ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'

/**
 * 服务与通知（批次49 · 设置页「应用」组）。
 *
 * 读数全部来自 serviceLogPool 的整份快照（props.snapshot，AppNext 首次 IPC 取一次 + 池变化推送），
 * 这一节不轮询、也不各扫监督器／MCP 客户端：池是唯一权威视图。
 * 每一行＝一个声明的服务或外部 MCP：载体名、id、端口／传输、四色状态、最近 5 条日志尾巴；
 * 「重启」只对服务出现（重启走既有 runtimeServiceRestart，外部 MCP 没有这条手动口），
 * 「知道了」把确认水位推到当下（只落应用级偏好，不进项目 .pinax/），橙色点随之回落。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  /** serviceLogPool.snapshot()：{ at, ackedAt, carriers: [{ carrierId, carrierTitle, color, unackedNotices, items }], entries }。 */
  snapshot: { type: Object, default: () => ({ ackedAt: null, carriers: [] }) },
  /** 重取快照的回调（AppNext 提供）：确认／重启之后调一次，竖条点与本节同步刷新。 */
  reload: { type: Function, default: null }
})

const busy = ref(false)
const feedback = ref(null)

const rows = computed(() => {
  const carriers = Array.isArray(props.snapshot?.carriers) ? props.snapshot.carriers : []
  return carriers.flatMap((carrier) => (Array.isArray(carrier?.items) ? carrier.items : []).map((item) => ({
    ...item,
    carrierId: carrier.carrierId,
    carrierTitle: carrier.carrierTitle,
    unackedNotices: carrier.unackedNotices ?? 0
  })))
})

function metaText(item) {
  return item.kind === 'mcp'
    ? `外部 MCP · ${item.transport ?? '未知传输'}`
    : `服务 · 端口 ${item.port ?? '未声明'}`
}

function clockOf(at) {
  const stamp = new Date(at)
  return Number.isNaN(stamp.getTime()) ? '' : stamp.toLocaleTimeString('zh-CN', { hour12: false })
}

async function request(channel, payload) {
  if (!props.bridge?.request) return { ok: false, error: { message: 'IPC 桥未接入' } }
  try {
    return await props.bridge.request(channel, payload)
  } catch (error) {
    return { ok: false, error: { message: String(error?.message || error) } }
  }
}

async function acknowledge() {
  if (busy.value) return
  busy.value = true
  feedback.value = null
  const result = await request(IPC_CHANNELS.runtimeServiceLogAck, { upToAt: new Date().toISOString() })
  busy.value = false
  if (!result?.ok) {
    feedback.value = { kind: 'error', text: result?.error?.message ?? '确认失败。' }
    return
  }
  feedback.value = { kind: 'ok', text: '已确认：这条时间之前的通知都不再计为未读。' }
  await props.reload?.()
}

async function restart(item) {
  if (busy.value || item.kind !== 'service') return
  busy.value = true
  feedback.value = null
  const result = await request(IPC_CHANNELS.runtimeServiceRestart, { id: item.id })
  busy.value = false
  if (!result?.ok) {
    feedback.value = { kind: 'error', text: result?.error?.message ?? `重启 ${item.id} 失败。` }
    return
  }
  feedback.value = { kind: 'ok', text: `已请求重启 ${item.id}：状态变化会从池里推过来。` }
  await props.reload?.()
}
</script>

<template>
  <div class="services-section">
    <p class="wizard-note">服务与外部 MCP 的运行状态、最近日志与待确认通知。确认只记在这台机器上，不随项目走。</p>
    <p v-if="!rows.length" class="pane-hint" data-test="services-empty">当前项目没有声明任何服务或外部 MCP</p>
    <div v-else class="prefs-grid">
      <div
        v-for="item in rows"
        :key="`${item.kind}:${item.carrierId}:${item.id}`"
        class="prefs-row services-row"
        :data-test="`service-row-${item.id}`"
      >
        <span class="prefs-row-label services-name">
          <span class="services-title">{{ item.carrierTitle }}</span>
          <span class="services-id">{{ item.id }}</span>
        </span>
        <span class="services-meta">{{ metaText(item) }}</span>
        <span
          class="services-status"
          :class="`is-${item.color}`"
          :data-status="item.color"
          :data-test="`service-status-${item.id}`"
        >{{ item.statusText }}</span>
        <ol
          class="services-logs"
          :data-test="`service-log-tail-${item.id}`"
          aria-label="最近日志"
        >
          <li v-for="(line, index) in item.logs.slice(-5)" :key="`${line.at}:${index}`" :class="`is-${line.level}`">
            <time>{{ clockOf(line.at) }}</time>
            <span>{{ line.message }}</span>
          </li>
          <li v-if="!item.logs?.length" class="services-log-empty">暂无日志</li>
        </ol>
        <span class="prefs-actions services-actions">
          <button
            v-if="item.kind === 'service'"
            type="button"
            class="control-quiet"
            :disabled="busy"
            :data-test="`service-restart-${item.id}`"
            @click="restart(item)"
          >重启</button>
          <button
            type="button"
            class="control-primary"
            :disabled="busy || !item.unackedNotices"
            data-test="service-ack"
            @click="acknowledge"
          >知道了</button>
        </span>
      </div>
      <div class="prefs-actions">
        <span v-if="feedback" class="prefs-state" :class="feedback.kind === 'ok' ? 'is-ready' : 'is-error'">{{ feedback.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 行内是「名字 → 元信息 → 状态 → 日志尾巴 → 动作」五段；日志尾巴独占一行（窄屏也不挤掉动作）。 */
.services-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.services-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.services-title {
  font-size: var(--nx-fs-md);
  color: var(--archive-ink);
}
.services-id,
.services-meta {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.services-status {
  padding: 2px 8px;
  border-radius: var(--nx-radius-xs);
  font-size: var(--nx-fs-2xs);
  border: 1px solid transparent;
}
.services-status.is-green { color: var(--success); border-color: color-mix(in srgb, var(--success) 40%, transparent); }
.services-status.is-orange { color: var(--signal-warm); border-color: color-mix(in srgb, var(--signal-warm) 40%, transparent); }
.services-status.is-red { color: var(--control-danger); border-color: color-mix(in srgb, var(--control-danger) 40%, transparent); }
.services-status.is-gray { color: var(--text-muted); border-color: var(--hairline-soft); }
.services-logs {
  flex: 1 1 100%;
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--nx-radius-xs);
  background: var(--surface-workbench-muted);
  font-size: var(--nx-fs-2xs);
  line-height: 1.7;
  list-style: none;
  max-height: 140px;
  overflow-y: auto;
}
.services-logs li {
  display: flex;
  gap: 8px;
  color: var(--text-secondary);
}
.services-logs time {
  flex: none;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.services-logs li.is-warn { color: var(--signal-warm); }
.services-logs li.is-error { color: var(--control-danger); }
.services-logs li.is-confirm { color: var(--signal-warm); }
.services-log-empty { color: var(--text-muted); }
.services-actions {
  flex: none;
}
</style>
