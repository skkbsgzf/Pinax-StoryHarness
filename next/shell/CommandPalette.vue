<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { trapFocus } from './focusTrap.mjs'

/**
 * 命令面板（批次62 · 任务三）：一个输入框 + 一张能跑的命令表。
 *
 * 数据从宿主那里拿（`entries`＝应用菜单动作 ∪ 载体命令 ∪ 当前焦点页可用动作），
 * 这里只回答两件事：**过滤**与**选中**。执行一律回宿主经 command 通路（`emit('run', entry)`），
 * 面板自己不认识任何一块载体，也不碰 fs／IPC／状态机——所以它能被整份测掉。
 *
 * 搜索按作者裁定的第一档做：子串包含（不分大小写），命中位置靠前的排前面，同位置短标题优先。
 * 拼音／模糊打分留给后续批次，不在这里假装已经做了。
 *
 * 键盘：↑／↓ 移动，Enter 执行，Esc 关闭；Tab 走统一二级页那份焦点陷阱
 * （focusTrap.mjs 与 SettingsModal 同一枚实现，不另立第二套「关不掉的面板」）。
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  /** [{ id, title, owner, group, accelerator, run }]，顺序＝宿主给的展示序。 */
  entries: { type: Array, default: () => [] },
  placeholder: { type: String, default: '输入命令名…' }
})
const emit = defineEmits(['close', 'run'])

const query = ref('')
const cursor = ref(0)
const panel = ref(null)
const input = ref(null)
let trap = null

/** 子串包含先行：命中位置越靠前越像「作者想输入的那条」，同位置短标题优先（更准的撞名裁决）。 */
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const pool = props.entries.filter((entry) => entry && entry.id)
  if (!needle) return pool
  return pool
    .map((entry, order) => {
      const haystack = `${entry.title} ${entry.id} ${entry.owner ?? ''}`.toLowerCase()
      const at = haystack.indexOf(needle)
      return { entry, order, at, length: String(entry.title ?? '').length }
    })
    .filter((item) => item.at >= 0)
    .sort((a, b) => a.at - b.at || a.length - b.length || a.order - b.order)
    .map((item) => item.entry)
})

const selected = computed(() => filtered.value[cursor.value] ?? filtered.value[0] ?? null)

watch(filtered, () => { cursor.value = 0 })
watch(query, () => { cursor.value = 0 })

function move(step) {
  const total = filtered.value.length
  if (!total) return
  cursor.value = (cursor.value + step + total) % total
}

function run(entry) {
  const target = entry ?? selected.value
  if (!target) return
  emit('run', target)
}

function onKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    run()
  } else if (event.key === 'Escape') {
    // 面板开着时 Esc 归面板：收窗那一条（workspace.collapse-top）由宿主的快捷键总线让位。
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  }
}

function releaseTrap() {
  if (!trap) return
  trap.release()
  trap = null
}

watch(() => props.open, async (isOpen) => {
  if (!isOpen) {
    releaseTrap()
    return
  }
  query.value = ''
  cursor.value = 0
  await nextTick()
  input.value?.focus?.()
  releaseTrap()
  trap = panel.value ? trapFocus(panel.value) : null
}, { immediate: true })

onBeforeUnmount(releaseTrap)

const GROUP_LABELS = { menu: '应用菜单', carrier: '载体命令', page: '当前页' }
function groupLabel(entry) {
  return GROUP_LABELS[entry.group] ?? entry.group ?? ''
}
</script>

<template>
  <div
    v-if="open"
    class="nx-palette"
    data-test="command-palette"
    role="dialog"
    aria-modal="true"
    aria-label="命令面板"
    @pointerdown.self="emit('close')"
  >
    <div ref="panel" class="nx-palette-panel">
      <div class="nx-palette-row">
        <WorkbenchIcon name="search" :size="16" />
        <input
          ref="input"
          v-model="query"
          class="nx-palette-input"
          data-test="palette-input"
          type="text"
          :placeholder="placeholder"
          aria-label="搜索命令"
          aria-controls="nx-palette-list"
          @keydown="onKeydown"
        >
        <span v-if="filtered.length" class="nx-palette-count" data-test="palette-count">{{ filtered.length }}</span>
      </div>
      <ul
        v-if="filtered.length"
        id="nx-palette-list"
        class="nx-palette-list"
        role="listbox"
        aria-label="可用命令"
        data-test="palette-list"
      >
        <li
          v-for="(entry, index) in filtered"
          :key="entry.id"
          class="nx-palette-item-wrap"
          role="option"
          :aria-selected="index === cursor"
        >
          <button
            type="button"
            class="control-quiet nx-palette-item"
            :class="{ 'is-active': index === cursor }"
            :data-palette-id="entry.id"
            :data-palette-group="entry.group"
            @click="run(entry)"
            @pointerenter="cursor = index"
          >
            <span class="nx-palette-title">{{ entry.title }}</span>
            <span class="nx-palette-owner">{{ entry.owner || groupLabel(entry) }}</span>
            <span v-if="entry.accelerator" class="nx-palette-accel" :data-palette-accelerator="entry.accelerator">{{ entry.accelerator }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="nx-palette-empty" data-test="palette-empty">没有匹配的命令。</p>
      <p class="nx-palette-hint">↑↓ 选择 · Enter 执行 · Esc 关闭</p>
    </div>
  </div>
</template>
