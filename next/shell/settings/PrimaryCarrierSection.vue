<script setup>
import { computed } from 'vue'

/**
 * 主载体选择 Section（工单C0 内容组件化 · D1 硬闸搬入统一二级页）。
 * needsPrimary 时统一弹窗自动打开、落在本节且 dismissable=false——
 * 选定主载体之前作者不离开这枚弹窗；目录里其它节可看，但弹窗关不了。
 * 「这个项目要创作什么？」原是弹窗头标题，归一后随本节走（面板标题）。
 * 选择与伴生勾选都只发事件，通道调用与 refresh 留在外壳。
 */
const props = defineProps({
  carriers: { type: Array, default: () => [] },
  kinds: { type: Array, default: () => [] },
  /** 只申请只读作用域的伴生板块（外壳按同一口径筛好传入）。 */
  companions: { type: Array, default: () => [] },
  /** 新建项目时随行的伴生板块 id（与新建项目节共用一份，状态在外壳）。 */
  extraEnabled: { type: Array, default: () => [] }
})
const emit = defineEmits(['set-primary', 'toggle-companion'])

/** 清单里声明了 primary 的板块才配当主载体：没有就明说空框架，不让作者点一个假的。 */
const canPickPrimary = computed(() => props.carriers.some((item) => item.primary))
const primaryCapable = computed(() => props.carriers.filter((item) => item.primary))
</script>

<template>
  <div>
    <h3 class="settings-panel-heading">这个项目要创作什么？</h3>
    <p class="wizard-note">
      主载体决定这个项目是哪一类（{{ kinds.join(' / ') }}）。
    </p>
    <div v-if="canPickPrimary" class="wizard-list">
      <button
        v-for="carrier in primaryCapable"
        :key="carrier.id"
        type="button"
        class="wizard-item control-secondary"
        @click="emit('set-primary', carrier.id)"
      >
        {{ carrier.title }} <small>{{ carrier.primary.projectKind }}</small>
      </button>
    </div>
    <p v-else class="wizard-empty">
      当前没有可担任主载体的插件板块。不装载体也能进来、能开项目、右栏能提问；
      随框架发布的小说／设定板块从 M2 起填在这里。
    </p>
    <div v-if="canPickPrimary && companions.length" class="wizard-companions">
      <p class="wizard-note is-tight">伴生板块（默认随行，只读权限——它们给正文补背景，不跟主载体抢写盘）：</p>
      <label v-for="carrier in companions" :key="carrier.id" class="wizard-companion">
        <input type="checkbox" :checked="extraEnabled.includes(carrier.id) || carrier.isEnabled" :disabled="carrier.isEnabled" @change="emit('toggle-companion', carrier.id)">
        {{ carrier.title }}
        <small>{{ carrier.isEnabled ? '已启用' : (carrier.dataDirs || []).join(' / ') }}</small>
      </label>
    </div>
  </div>
</template>
