<script setup>
import CarrierPaneHost from './CarrierPaneHost.vue'

/**
 * 核心区：正文的唯一位置。
 *
 * 这里只挂 center 槽的 pane（左竖条／索引窗那类目录视图不进这里）——
 * 正文不再被挤在别的功能页面旁边：作者打开一个项目，看到的就是那篇稿子。
 */
defineProps({
  /** 当前板块的 center 面板（AppNext 汇总后给出）。 */
  activePane: { type: Object, default: null },
  /** useBoardData 的返回值：核心区与索引窗看的是同一份数据。 */
  data: { type: Object, required: true },
  project: { type: Object, default: null }
})
</script>

<template>
  <section class="center" aria-label="核心区">
    <header class="center-head">
      <h2 class="center-title">{{ activePane ? activePane.title : '工作区' }}</h2>
      <p v-if="project" class="center-sub">{{ project.name }} · {{ project.kind || '未定类型' }}</p>
      <p v-else class="center-sub">尚未打开项目</p>
    </header>

    <CarrierPaneHost
      v-if="activePane"
      :pane="activePane"
      :data="data"
    />
    <p v-else class="center-empty">没有已启用的中栏面板。竖条、索引窗和右栏对话照常可用。</p>
  </section>
</template>
