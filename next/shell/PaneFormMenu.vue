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
 * 项的来源只有一处：这块 pane 清单声明的 `forms` ∩ 本批能落地的形态
 * （`dock`／`split`／`overlay`）。`fullscreen`／`immersive` 在 v3 状态轴里没有独立落点，
 * 不进菜单——进了就是看着能点、其实没差别的骗人入口（工单 §7 待裁 ④）。
 * 「收成侧缘标签／关闭这一页」属于页操作，不在 forms 词表里，所以恒在。
 */
const props = defineProps({
  /** 锚点（视口坐标）：{ x, y }，来自 contextmenu 事件。 */
  anchor: { type: Object, default: null },
  /** 这块 pane 清单声明的 forms——形态组的唯一来源。 */
  forms: { type: Array, default: () => [] },
  /** 这一页此刻的形态与所在页组：已经是这个形态的项置灰（点了没变化不给假动作）。 */
  form: { type: String, default: 'page' },
  group: { type: String, default: 'main' }
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

const menuStyle = computed(() => {
  const anchor = props.anchor
  if (!anchor) return {}
  const viewportWidth = Number(globalThis.innerWidth) || 0
  const viewportHeight = Number(globalThis.innerHeight) || 0
  const menuHeight = 30 + (formItems.value.length + pageItems.value.length) * ITEM_HEIGHT + (formItems.value.length ? 22 : 0) + 16
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

defineExpose({ formItems, pageItems })
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
  </div>
</template>
