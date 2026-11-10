<script setup>
import { computed, onMounted, ref, watch } from 'vue'
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
 *
 * 〔批次76-R2 任务4〕这一面本批被压平：地址行（nx-external-app-head）撤除，应用面＝iframe 独占。
 * 撤的不是信息，是那一行 chrome——地址仍要看得见，只是落点换到「已经在那儿」的两处：
 *   ① 页签的 title tooltip（宿主经 `address` 事件拿去）；
 *   ② 底栏状态栏「载体」那一项里多出的一段（同一份数据）。
 * 抄地址的动作改成页签右键菜单项，不再常驻一行死按钮（作者裁定③）。
 * 根节点上留 data-app-url / data-app-url-source 两个读数，供遍历与测试取证（不是渲染出来的行）。
 */
const props = defineProps({
  /** pane：应用面的地址从 pane.app.url 来（清单里声明，宿主不替插件猜）。 */
  pane: { type: Object, default: null },
  data: { type: Object, default: null }
})

/** 地址上抛：宿主（CarrierPaneHost → AppNext）拿去填页签 tooltip 与状态栏。 */
const emit = defineEmits(['address'])

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

/**
 * 地址上抛（〔批次76-R2 任务4〕）：immediate 是因为覆盖那份是 onMounted 之后才补上的，
 * 少了这一句宿主只会拿到清单那一版；地址为空也照实上报（宿主据此把这一段收起来）。
 */
watch([url, urlSource], ([address, source]) => {
  emit('address', { url: address, source, paneId: String(props.pane?.id ?? '') })
}, { immediate: true })

/** iframe 自己加载失败时不给作者一个空白框：说清是哪个地址、为什么没有画面。 */
const failed = ref(false)
function onFrameError() {
  failed.value = true
}
</script>

<template>
  <!-- 〔批次76-R2 任务4〕地址行撤了：这一面从 iframe 上面一行「网址」压平成 iframe 独占。
       data-app-url / data-app-url-source 是**属性上的读数**（不占版面），遍历取证与测试从这里认
       「这块内嵌浏览器跑的到底是谁的端口、那个地址是清单写的还是工程覆盖改的」。 -->
  <section
    class="nx-external-app"
    data-test="external-app"
    :data-app-url="url || ''"
    :data-app-url-source="url ? urlSource : ''"
  >
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
/* 应用面＝iframe 独占（〔批次76-R2 任务1＋4〕）。
   高度链（〔守卫⑫〕）：根节点 flex 列 + flex:1 1 auto + min-height:0，不许写 height:auto／height:100%；
   iframe 同一族（flex:1 1 auto + min-height:0），于是窗 body 给多少就用多少，半屏下能铺满半栏。
   颜色走 token；字号走 --nx-fs-* 刻度；其余 px 都是布局尺寸。 */
.nx-external-app {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.nx-external-app-frame {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  border: 0;
  background: var(--surface-raised, transparent);
}
</style>
