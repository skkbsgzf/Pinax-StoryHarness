<script setup>
import { computed, ref } from 'vue'
import PrimaryCarrierSection from './PrimaryCarrierSection.vue'
import { describeOpenFailure } from './wizardKit.mjs'

/**
 * 打开失败修复卡（前端工单 A-5）：错误码 → 人话与下一步动作。
 * 四类修复：目录空→在此新建库；目录有稿→导入这个文件夹；缺主模块→内嵌主模块选择；
 * 缺依赖→打开模块管理。错误码原文只出现在可展开的详情里，不上主文案。
 */
const props = defineProps({
  failure: { type: Object, required: true },
  primaryCarriers: { type: Array, default: () => [] },
  carriers: { type: Array, default: () => [] },
  companions: { type: Array, default: () => [] },
  extraEnabled: { type: Array, default: () => [] }
})
const emit = defineEmits(['create-here', 'import-here', 'set-primary', 'toggle-companion', 'open-modules', 'dismiss'])

const pickingPrimary = ref(false)
const showDetail = ref(false)

const verdict = computed(() => describeOpenFailure(props.failure?.error ?? {}, props.failure?.details ?? {}))
const primaryKind = computed(() => props.failure?.error?.code ?? '')
</script>

<template>
  <div class="lib-fail" data-test="library-open-failure">
    <div class="lib-fail-head">
      <strong class="lib-fail-title" data-test="open-failure-title">{{ verdict.title }}</strong>
      <button type="button" class="lib-menu-item" data-test="open-failure-dismiss" @click="emit('dismiss')">知道了</button>
    </div>
    <p class="lib-fail-detail">{{ verdict.detail }}</p>
    <p class="lib-fail-path">{{ failure?.path }}</p>

    <!-- 缺主模块：主模块选择直接内嵌在卡里（选完走 set-primary 通道，外壳 refresh 后工作区接管） -->
    <div v-if="verdict.action === 'pick-primary' && pickingPrimary" class="lib-fail-primary" data-test="open-failure-primary">
      <PrimaryCarrierSection
        :carriers="carriers"
        :companions="companions"
        :extra-enabled="extraEnabled"
        @set-primary="(pluginId) => emit('set-primary', pluginId)"
        @toggle-companion="(pluginId) => emit('toggle-companion', pluginId)"
      />
    </div>
    <div v-else-if="verdict.action" class="lib-fail-actions">
      <button
        v-if="verdict.action === 'pick-primary'"
        type="button"
        class="control-primary"
        data-test="open-failure-action"
        @click="pickingPrimary = true"
      >{{ verdict.actionLabel }}</button>
      <button
        v-else
        type="button"
        class="control-primary"
        data-test="open-failure-action"
        @click="emit(verdict.action === 'create-here' ? 'create-here' : verdict.action === 'import-here' ? 'import-here' : 'open-modules', failure?.path)"
      >{{ verdict.actionLabel }}</button>
    </div>

    <button type="button" class="lib-fail-detail-toggle" @click="showDetail = !showDetail">技术详情</button>
    <p v-if="showDetail" class="lib-fail-raw" data-test="open-failure-raw">{{ primaryKind }} — {{ failure?.error?.message ?? '' }}</p>
  </div>
</template>

<style scoped>
/* 打开失败修复卡（工单 A-5）：错误条内嵌于库管理器顶部，不用 toast 承载需要动作的错误。 */
.lib-fail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--danger);
  border-radius: var(--radius-surface);
  background: var(--surface-workbench-raised);
}
.lib-fail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.lib-fail-title {
  font-size: var(--nx-fs-lg);
  color: var(--text-primary);
}
.lib-fail-detail {
  margin: 0;
  font-size: var(--nx-fs-md);
  color: var(--text-secondary);
}
.lib-fail-path {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.lib-fail-actions { display: flex; gap: 12px; }
.lib-fail-primary {
  padding: 8px 0 0;
  border-top: 1px solid var(--hairline-soft);
}
.lib-fail-detail-toggle {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--nx-fs-2xs);
  cursor: pointer;
  text-decoration: underline;
}
.lib-fail-raw {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  font-family: inherit;
  word-break: break-all;
}
</style>
