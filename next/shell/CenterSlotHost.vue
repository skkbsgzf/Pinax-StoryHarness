<script setup>
import CarrierPaneHost from './CarrierPaneHost.vue'

/**
 * 核心区：正文的唯一位置。
 *
 * 这里只挂 center 槽的 pane（左竖条／索引窗那类目录视图不进这里）——
 * 正文不再被挤在别的功能页面旁边：作者打开一个项目，看到的就是那篇稿子。
 *
 * 批次34：批次33 用样式压掉的核心区面板头（「正文／演示之书 · novel」那一层）整块删除。
 * 作者的原话是「标题栏放一个标题，其他东西就不用放了」：载体身份在竖条上、项目名在标题栏，
 * 文档头只剩文档自己的名字（.doc-title）——这一层没有第二个东西可显示，所以不是隐藏而是不存在。
 *
 * 批次44：项目根往下传一层（看板区用它拼视图记忆的键，换项目＝各记各的），
 * 「历史」事件往上冒一层（看板区的行尾历史钮要走 AppNext 的历史面板）。
 */
const props = defineProps({
  /** 当前板块的 center 面板（AppNext 汇总后给出）。 */
  activePane: { type: Object, default: null },
  /** useBoardData 的返回值：核心区与索引窗看的是同一份数据。 */
  data: { type: Object, required: true },
  /** 当前项目根：看板区的视图记忆按它分键（换项目＝各记各的）。 */
  projectRoot: { type: String, default: '' }
})
const emit = defineEmits(['history'])
</script>

<template>
  <section class="center" aria-label="核心区">
    <CarrierPaneHost
      v-if="activePane"
      :pane="activePane"
      :data="data"
      :project-root="props.projectRoot"
      @history="emit('history', $event)"
    />
    <p v-else class="center-empty">没有已启用的中栏面板。竖条、索引窗和右栏对话照常可用。</p>
  </section>
</template>
