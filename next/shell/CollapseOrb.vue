<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'

/**
 * 右下角悬浮球＝收起态的唯一呈现（批次76 · 作者〔裁定B〕原文口径）。
 *
 * 「侧边的吸附卡片……做的丑，用文字代表吸附，还存在堆叠，看不清也点不到。我的一个建议是，
 *   把所有的可吸附的内容统一放到一个右下角的悬浮球上管理，点击悬浮球弹出所有被收起的插件面板，
 *   点击插件则弹出到上次记忆的位置，收起面板后，插件自动回到悬浮球里。这样美观又统一。
 *   如果插件有通知需要告知，也可以统一由悬浮球进行管理。」
 *
 * 于是这一枚球只干三件事：
 *   ① 一颗球＋数量徽标（收起几扇就写几）——原来的竖排缘签整列删除，堆叠问题从源头消失；
 *   ② 点开＝列出所有 `form === 'tab'` 的页（标题＝`载体 · 文档`，与窗头同一个口径），
 *      点一条＝交回宿主走 workspace.expand 回到**收起前**那一档（不是硬写页态）；每行一枚关闭钮；
 *   ③ 通知这一节只**转述**：读数来自状态栏服务灯那份（serviceLogPool 快照），点开的落点是
 *      设置里既有的「服务与通知／提案审阅」两节——球不产生通知，也不另记一份未读账。
 *
 * 两条写死的边界：
 * · 层级不新增档位：球与浮层都用既有的 `--z-floating-action`（260，`src/styles/main.css` 档位表），
 *   与状态栏／右栏／设置弹窗的相对高低照旧，本批不动那张表。
 * · 命中区按判据下限：球本体 48×48，列表每一条整行 ≥44×44（外部审计 H／OD craft 口径里的「主键」档），
 *   度量在 `styles/next-shell.css` 里（缘签那一段随缘签一起撤，这一段换上来）。
 */
const props = defineProps({
  /** 收起态的页：[{ instance, title, paneId }]，顺序＝工作区里的叠序。 */
  items: { type: Array, default: () => [] },
  /** 服务灯读数：[{ id, title, color, notices }]，与状态栏同一份来源（不另起一处真相）。 */
  notices: { type: Array, default: () => [] }
})
const emit = defineEmits(['expand', 'close', 'open-services', 'open-proposals'])

const open = ref(false)
const orb = ref(null)

const count = computed(() => props.items.length)
const noticeRows = computed(() => props.notices
  .filter((light) => Number(light?.notices) > 0)
  .map((light) => ({ id: light.id, title: String(light?.title ?? light?.id ?? ''), notices: Number(light.notices) })))
const hasNotice = computed(() => noticeRows.value.length > 0)
const totalNotices = computed(() => noticeRows.value.reduce((sum, row) => sum + row.notices, 0))

const ORB_LABEL = computed(() => {
  const parts = [`悬浮球：收起 ${count.value} 扇面板`]
  if (hasNotice.value) parts.push(`${totalNotices.value} 条待确认通知`)
  return `${parts.join('，')}（点开管理）`
})

/** 球没内容时也不藏起来：作者要的是「所有可吸附的内容统一在这里」，常驻才有落点可拖。 */
function toggle() {
  open.value = !open.value
}

function pickRow(instance) {
  emit('expand', instance)
  open.value = false
}

function onDocPointerDown(event) {
  if (!open.value) return
  if (orb.value?.contains?.(event.target)) return
  open.value = false
}

/**
 * 浮层开着时 Esc 先关浮层：这是「收起来的一层」自己的退出键，不改窗口的 Esc 语义（收窗）。
 * 用 stopImmediatePropagation 而不是 stopPropagation——宿主的快捷键总线登记在同一枚 window 上，
 * 同节点的其余监听器只会被前者打断，后者照旧收到（真窗口上就成了「关面板顺手又收了一扇窗」）。
 */
function onKeydown(event) {
  if (open.value && event.key === 'Escape') {
    event.stopImmediatePropagation?.()
    event.preventDefault?.()
    open.value = false
  }
}

globalThis.addEventListener?.('pointerdown', onDocPointerDown, true)
globalThis.addEventListener?.('keydown', onKeydown, true)
onBeforeUnmount(() => {
  globalThis.removeEventListener?.('pointerdown', onDocPointerDown, true)
  globalThis.removeEventListener?.('keydown', onKeydown, true)
})
</script>

<template>
  <div class="nx-collapse-orb" ref="orb" data-test="collapse-orb" :data-orb-count="count">
    <button
      type="button"
      class="control-quiet nx-collapse-orb-button"
      data-test="orb-button"
      :class="{ 'is-open': open }"
      :aria-label="ORB_LABEL"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="dialog"
      :title="ORB_LABEL"
      @click="toggle"
    >
      <WorkbenchIcon name="archive" :size="20" />
      <span v-if="count" class="nx-collapse-orb-badge" data-test="orb-badge" :aria-hidden="true">{{ count }}</span>
      <span v-if="hasNotice" class="nx-collapse-orb-dot" data-test="orb-dot" :aria-hidden="true" />
    </button>

    <div
      v-if="open"
      class="nx-collapse-orb-panel"
      data-test="orb-panel"
      role="dialog"
      :aria-label="`悬浮球面板（收起 ${count} 扇）`"
    >
      <section v-if="count" class="nx-collapse-orb-group" data-test="orb-collapsed-group">
        <h3 class="nx-collapse-orb-group-title">收起的面板</h3>
        <ul class="nx-collapse-orb-list">
          <li
            v-for="item in items"
            :key="item.instance"
            class="nx-collapse-orb-row"
            :data-orb-item="item.instance"
          >
            <button
              type="button"
              class="control-quiet nx-collapse-orb-open"
              data-test="orb-item"
              :data-orb-instance="item.instance"
              :title="`回到收起前的位置：${item.title}`"
              @click="pickRow(item.instance)"
            >
              <span class="nx-collapse-orb-name">{{ item.title || item.paneId }}</span>
            </button>
            <button
              type="button"
              class="control-quiet nx-collapse-orb-close"
              data-test="orb-close"
              :aria-label="`关闭${item.title || item.paneId}这一页`"
              title="关闭这一页"
              @click="emit('close', item.instance)"
            >
              <WorkbenchIcon name="close" :size="13" />
            </button>
          </li>
        </ul>
      </section>
      <p v-else class="nx-collapse-orb-empty">现在没有收起的面板。把窗口拖到右下角这颗球上，或右键选「收进悬浮球」。</p>

      <section class="nx-collapse-orb-group" data-test="orb-notice-group">
        <h3 class="nx-collapse-orb-group-title">通知</h3>
        <ul v-if="noticeRows.length" class="nx-collapse-orb-list">
          <li v-for="row in noticeRows" :key="row.id" class="nx-collapse-orb-row" :data-orb-notice="row.id">
            <button
              type="button"
              class="control-quiet nx-collapse-orb-open"
              data-test="orb-notice"
              :title="`${row.title}：${row.notices} 条未确认通知（打开通知与日志）`"
              @click="emit('open-services')"
            >
              <span class="nx-collapse-orb-name">{{ row.title }}</span>
              <span class="nx-collapse-orb-count">{{ row.notices }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="nx-collapse-orb-empty">服务侧没有待确认通知。</p>
        <button
          type="button"
          class="control-quiet nx-collapse-orb-jump"
          data-test="orb-open-services"
          title="打开设置里的「服务与通知」"
          @click="emit('open-services')"
        >
          看通知与日志
        </button>
        <button
          type="button"
          class="control-quiet nx-collapse-orb-jump"
          data-test="orb-open-proposals"
          title="打开设置里的「提案审阅」（模型改稿待确认）"
          @click="emit('open-proposals')"
        >
          看 AI 产出待确认
        </button>
      </section>
    </div>
  </div>
</template>
