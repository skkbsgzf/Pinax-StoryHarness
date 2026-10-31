<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { pluginEntryUrl } from './pluginProtocol.mjs'
import { PANEL_MESSAGE, parsePanelRequest, panelError, panelResult } from './pluginBridge.mjs'

/**
 * 插件自带面板的宿主（协议 v3 的 `entry` 面）。
 *
 * 面板页跑在沙箱 iframe 里：sandbox="allow-scripts" 且**不给** allow-same-origin，
 * 于是它没有与宿主同源的能力（拿不到 DOM、拿不到 localStorage、拿不到 Node）——
 * 它只能靠 postMessage 与宿主说话，而宿主只给一把**只读**工具。
 *
 * 三条边界：
 *   1) 只认自己那扇 iframe 发来的消息（event.source 必须等于 iframe.contentWindow）；
 *   2) 面板要调工具，走主进程的 plugin:tool-call 通道，宿主不自己拼参数也不自己读文件；
 *   3) 面板页面起不来（entry 路径不对／协议没注册）时如实出占位，不白屏、不假装有面板。
 */
const props = defineProps({
  /** pane 自带的入口信息：{ kind:'iframe', path:'ui/index.html' }。 */
  entry: { type: Object, default: null },
  /** 面板归属的插件 id（工具归属、目录解析都按它算）。 */
  pluginId: { type: String, default: '' },
  /** 面板标题（占位文案用）。 */
  title: { type: String, default: '' }
})

const frame = ref(null)
const ready = ref(false)
const lastError = ref('')
const log = ref([])

const src = computed(() => {
  if (props.entry?.kind !== 'iframe') return ''
  return pluginEntryUrl(props.pluginId, props.entry?.path ?? '') ?? ''
})

/** 面板入口起不来时的如实说明（不给它一句「加载中」骗人）。 */
const unusableReason = computed(() => {
  if (!props.entry) return '这个面板没有声明入口（entry）。'
  if (props.entry.kind !== 'iframe') return `宿主目前只认 iframe 面板，收到 ${String(props.entry.kind)}。`
  if (!src.value) return `面板入口路径不合法：${String(props.entry.path ?? '')}`
  return ''
})

function onMessage(event) {
  const target = frame.value?.contentWindow
  if (!target || event.source !== target) return
  const request = parsePanelRequest(event.data)
  if (!request) {
    post(panelError('这条消息的形状不对：面板只能发 ready 或 callTool'))
    return
  }
  if (request.type === PANEL_MESSAGE.ready) {
    ready.value = true
    post({ type: PANEL_MESSAGE.toolResult, id: request.id, ok: true, payload: { pluginId: props.pluginId }, error: null })
    return
  }
  void callTool(request)
}

async function callTool(request) {
  const bridge = globalThis.pinaxNext
  if (!bridge?.request) {
    post(panelResult(request.id, { ok: false, error: { code: 'PINAX_INVALID_INPUT', message: '宿主通道不可用' } }))
    return
  }
  const result = await bridge.request(bridge.channels?.pluginToolCall ?? 'pinax:agent:plugin:tool-call', {
    pluginId: props.pluginId,
    name: request.name,
    args: request.args
  })
  log.value = [{ tool: request.name, ok: Boolean(result?.ok) }, ...log.value].slice(0, 8)
  post(panelResult(request.id, result))
}

function post(message) {
  frame.value?.contentWindow?.postMessage(message, '*')
}

onMounted(() => {
  globalThis.addEventListener('message', onMessage)
})

onBeforeUnmount(() => {
  globalThis.removeEventListener('message', onMessage)
})
</script>

<template>
  <div class="plugin-panel" data-test="plugin-panel">
    <div v-if="unusableReason" class="pane-note" data-test="plugin-panel-unusable">
      「{{ title || pluginId }}」这块自带面板还用不了：{{ unusableReason }}
    </div>
    <template v-else>
      <div class="plugin-panel-head">
        <span class="plugin-panel-title">{{ title || pluginId }}</span>
        <span class="plugin-panel-state" :class="{ 'is-ready': ready }">{{ ready ? '面板已就绪' : '面板加载中…' }}</span>
      </div>
      <iframe
        ref="frame"
        class="plugin-panel-frame"
        data-test="plugin-panel-frame"
        :src="src"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        title="插件自带面板"
      />
      <p v-if="lastError" class="pane-error">{{ lastError }}</p>
    </template>
  </div>
</template>

<style scoped>
/* 自带面板：内容面整块交给插件的页面，宿主只留一行状态条与一块 iframe。
   不加卡片边框——文档为主合同（P18）说的是「让内容自己铺满」，
   面板型界面（提案审阅）才保留分隔框。 */
.plugin-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.plugin-panel-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 2px 6px;
}

.plugin-panel-title {
  font-size: var(--nx-fs-md);
  color: var(--archive-ink);
}

.plugin-panel-state {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}

.plugin-panel-state.is-ready {
  color: var(--archive-olive);
}

.plugin-panel-frame {
  flex: 1 1 auto;
  width: 100%;
  min-height: 320px;
  border: 0;
  background: transparent;
}
</style>
