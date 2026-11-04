<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { PAGE_ACTIONS, formMenuItems } from './paneForms.mjs'

/**
 * 形态菜单（批次61 · 作者裁定③「形态切换可以多用右键，不必做成死按钮」）。
 *
 * 页签右键与窗头右键是同一条通路的两个入口，弹的都是这一份。它是**浮层不是窗口壳**：
 * 无拖拽句柄、无缩放角、点外或 Esc 即收、坐标按视口钳住；样式复用索引窗那套
 * `.nx-context-*`（next-shell.css:1111 起），不另起一套弹层。
 *
 * 项的来源只有一处：这块 pane 清单声明的 `forms` ∩ 词表能落地的形态
 * （`dock`／`split`／`overlay`）。批次66 前置裁定 Q2 把两个无落点的旧词从词表删除
 * （登记未采用照 chain 先例），三值与 FORM_ACTIONS 一一同构，菜单里不存在「点了没差别」的项。
 * 「收进悬浮球／关闭这一页」属于页操作，不在 forms 词表里，所以恒在
 * （〔批次76 裁定B〕改的是文案：收起的落点从右缘那一竖列标签换成右下角那颗球，动作键 `tab` 不动）。
 *
 * 〔批次76-R2 任务4 · 越界补登记〕多了一个可选入参 `address`：应用面（内嵌浏览器）那行常驻的
 * 「复制地址单开」随 chrome 减层退役，动作搬进这同一份菜单——作者裁定③「不做常驻死按钮」的落点
 * 就是这里。没有地址（不是应用面）时这一组根本不渲染，普通稿件页的菜单与批次76 一模一样。
 */
const props = defineProps({
  /** 锚点（视口坐标）：{ x, y }，来自 contextmenu 事件。 */
  anchor: { type: Object, default: null },
  /** 这块 pane 清单声明的 forms——形态组的唯一来源。 */
  forms: { type: Array, default: () => [] },
  /** 这一页此刻的形态与所在页组：已经是这个形态的项置灰（点了没变化不给假动作）。 */
  form: { type: String, default: 'page' },
  group: { type: String, default: 'main' },
  /** 应用面的地址（其余页为空）：非空才出「复制地址单开」那一项。 */
  address: { type: String, default: '' },
  /** 地址来源的说法（清单声明／工程覆盖），只进这一项的悬浮提示。 */
  addressNote: { type: String, default: '' }
})
const emit = defineEmits(['action', 'dismiss'])

const root = ref(null)
const MENU_WIDTH = 220
const ITEM_HEIGHT = 30

const formItems = computed(() => formMenuItems(props.forms).map((item) => ({
  ...item,
  disabled: item.action === 'dock'
    ? props.form === 'page'
    : item.action === 'float'
      ? props.form === 'floating'
      : false
})))

const pageItems = computed(() => PAGE_ACTIONS.map((item) => ({
  ...item,
  disabled: item.action === 'tab' && props.form === 'tab'
})))

/** 地址组：只有内嵌浏览器那一面出这一项（「复制」与「拿它去别处单开」一句里说清）。 */
const addressItems = computed(() => (props.address
  ? [{ action: 'copy-url', label: '复制地址单开', note: props.addressNote }]
  : []))

const menuStyle = computed(() => {
  const anchor = props.anchor
  if (!anchor) return {}
  const viewportWidth = Number(globalThis.innerWidth) || 0
  const viewportHeight = Number(globalThis.innerHeight) || 0
  // 分隔条只在「真的有两组」之间出，所以高度按组数算，不按固定 22 硬加。
  const groups = [formItems.value.length, pageItems.value.length, addressItems.value.length].filter(Boolean).length
  const items = formItems.value.length + pageItems.value.length + addressItems.value.length
  const menuHeight = 30 + items * ITEM_HEIGHT + Math.max(0, groups - 1) * 22 + 16
  const left = Math.max(8, Math.min(Number(anchor.x) || 0, Math.max(8, viewportWidth - MENU_WIDTH - 8)))
  const top = Math.max(8, Math.min(Number(anchor.y) || 0, Math.max(8, viewportHeight - menuHeight - 8)))
  return { left: `${left}px`, top: `${top}px` }
})

function onAction(action) {
  emit('action', action)
  emit('dismiss')
}

/** 点菜单外／Esc 收起；右键按在别处也先收（同一时刻只有一份形态菜单）。 */
function onPointerDown(event) {
  if (root.value && !root.value.contains?.(event.target)) emit('dismiss')
}

function onKeydown(event) {
  if (event.key === 'Escape') emit('dismiss')
}

globalThis.addEventListener?.('pointerdown', onPointerDown, true)
globalThis.addEventListener?.('keydown', onKeydown, true)
onBeforeUnmount(() => {
  globalThis.removeEventListener?.('pointerdown', onPointerDown, true)
  globalThis.removeEventListener?.('keydown', onKeydown, true)
})

defineExpose({ formItems, pageItems, addressItems })
</script>

<template>
  <div
    v-if="anchor"
    ref="root"
    class="nx-context-menu nx-form-menu"
    role="menu"
    aria-label="这一页的形态"
    data-test="pane-form-menu"
    :style="menuStyle"
    @contextmenu.prevent.stop
  >
    <template v-if="formItems.length">
      <p class="nx-context-group">形态</p>
      <button
        v-for="item in formItems"
        :key="item.action"
        type="button"
        class="control-quiet nx-context-item nx-form-menu-item"
        role="menuitem"
        :data-form-action="item.action"
        :data-form-word="item.form"
        :data-test="`form-menu-${item.action}`"
        :disabled="item.disabled"
        @click="onAction(item.action)"
      >{{ item.label }}</button>
      <div class="nx-context-separator" role="separator"></div>
    </template>
    <p class="nx-context-group">页</p>
    <button
      v-for="item in pageItems"
      :key="item.action"
      type="button"
      class="control-quiet nx-context-item nx-form-menu-item"
      role="menuitem"
      :data-form-action="item.action"
      :data-test="`form-menu-${item.action}`"
      :disabled="item.disabled"
      @click="onAction(item.action)"
    >{{ item.label }}</button>
    <!-- 〔批次76-R2 任务4〕应用面常驻那行「复制地址单开」搬进来的这一组：没有地址就不渲染，
         普通稿件页看不见多出来的一行——菜单不长成第二套 chrome。 -->
    <template v-if="addressItems.length">
      <div class="nx-context-separator" role="separator"></div>
      <p class="nx-context-group">地址</p>
      <button
        v-for="item in addressItems"
        :key="item.action"
        type="button"
        class="control-quiet nx-context-item nx-form-menu-item"
        role="menuitem"
        :data-form-action="item.action"
        :data-test="`form-menu-${item.action}`"
        :title="item.note ? `${item.label}（${item.note}）` : item.label"
        @click="onAction(item.action)"
      >{{ item.label }}</button>
    </template>
  </div>
</template>
