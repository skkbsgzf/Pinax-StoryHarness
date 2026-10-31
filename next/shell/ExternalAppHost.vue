<script setup>
import { computed, onMounted, ref } from 'vue'
import { IPC_CHANNELS } from './ipcContract.mjs'

/**
 * 应用面（批次44 · 作者 2026-10-31：「我希望你在**一开始**就想明白，每个类型的组件到底是用文档
 * 还是用 HTML 去实现。原则上来讲，我们鼓励每一种跳转和悬浮的显示，都可以通过一些小窗、弹窗，
 * 以及系统内嵌的一些浏览器去实现。举个例子，后续假如我们真的要把 ComfyUI 挪进来，
 * 那一定是要通过浏览器去把这个端口承载起来，而不可能说我们自己手搓一个组件」）。
 *
 * 这一块就是那个「系统内嵌的浏览器」的落点：外部应用不手搓组件，宿主给一块 iframe，
 * 端口那个页面自己长什么样就是什么样（ComfyUI 的工作流编辑器、别处的看板、任何网页）。
 *
 * 边界（批次44 同批定）：只接**本机回环**的 http/https（127.0.0.1／localhost／::1）——
 * 内嵌浏览器能把本机文件面整个敞给页面，所以不接外网地址；这条约束在清单校验里
 * （next/kernel/carrierManifest.mjs 的 validateAppPane）就拒掉了，不是只靠这里的自觉。
 */
const props = defineProps({
  /** pane：应用面的地址从 pane.app.url 来（清单里声明，宿主不替插件猜）。 */
  pane: { type: Object, default: null },
  data: { type: Object, default: null }
})

const manifestUrl = computed(() => String(props.pane?.app?.url ?? '').trim())

/**
 * 工程覆盖（批次54）：换端口不该改插件文件。这里读 `.pinax/` 覆盖文件的只读 IPC，
 * 按 `插件 → pane id` 取这一条；只认本机回环 http/https（与清单校验同一条边界）。
 * 覆盖读不到／形状不对就按清单声明的地址走——绝不把 url 拼成猜出来的值。
 */
const LOOPBACK_URL_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?(?:[/?#][^\s]*)?$/u
const overrideUrl = ref('')

function pickOverrideUrl(overrides) {
  const pluginId = String(props.pane?.pluginId ?? '')
  const paneId = String(props.pane?.id ?? '')
  const entries = overrides?.[pluginId]
  if (!pluginId || !paneId || !entries || typeof entries !== 'object') return ''
  const entry = entries[paneId]
  const candidate = typeof entry === 'string'
    ? entry
    : entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.url : ''
  const url = typeof candidate === 'string' ? candidate.trim() : ''
  if (!url || url.length > 300 || !LOOPBACK_URL_PATTERN.test(url)) return ''
  return url
}

onMounted(async () => {
  const bridge = globalThis.pinaxNext
  if (!bridge?.request) return
  try {
    const result = await bridge.request(bridge.channels?.carrierOverrides ?? IPC_CHANNELS.carrierOverrides, {})
    if (result?.ok) overrideUrl.value = pickOverrideUrl(result.value?.overrides)
  } catch {
    // 覆盖是旁路：读不到就按清单声明走，不挡应用面。
  }
})

const url = computed(() => overrideUrl.value || manifestUrl.value)
const urlSource = computed(() => (overrideUrl.value ? 'override' : 'manifest'))

/** iframe 自己加载失败时不给作者一个空白框：说清是哪个地址、为什么没有画面。 */
const failed = ref(false)
function onFrameError() {
  failed.value = true
}
</script>

<template>
  <section class="nx-external-app" data-test="external-app">
    <div class="nx-external-app-head">
      <h2 class="doc-title">{{ pane?.title ?? '外部应用' }}</h2>
      <!-- 地址摆出来：内嵌浏览器跑的是谁的端口，作者要能一眼看见（也能自己复制出去单开）。 -->
      <span class="nx-external-app-url" :title="url">{{ url }}</span>
      <!-- 来源层：这个地址是清单写死的还是工程覆盖改过的，作者要能一眼分清。 -->
      <span v-if="urlSource === 'override'" class="nx-external-app-source" data-test="external-app-source">工程覆盖</span>
    </div>
    <iframe
      v-if="url"
      class="nx-external-app-frame"
      data-test="external-app-frame"
      :src="url"
      :title="pane?.title ?? '外部应用'"
      referrerpolicy="no-referrer"
      sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
      @error="onFrameError"
    />
    <p v-else class="pane-hint">这个应用面没有声明地址（app.url）。</p>
    <p v-if="failed" class="pane-notice">这块内嵌浏览器没能载入那个地址：先确认那个端口的服务起没起。</p>
  </section>
</template>

<style scoped>
/* 应用面：地址一行，头下就是那块内嵌浏览器（占满剩余高度）。
   颜色走 token；字号走 --nx-fs-* 刻度；其余 px 都是布局尺寸。 */
.nx-external-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nx-external-app-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: none;
  margin: 0 0 6px;
}

.nx-external-app-url {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nx-external-app-source {
  flex: none;
  padding: 0 6px;
  border-radius: var(--radius-control);
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle, transparent);
}

.nx-external-app-frame {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  border: 0;
  background: var(--surface-raised, transparent);
}
</style>
