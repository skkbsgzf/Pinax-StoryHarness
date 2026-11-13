<script setup>
import { computed } from 'vue'

/**
 * 库设置（前端工单 A-7）：模块管理＋主模块，从设置页迁出的容器（措辞按术语表：
 * 模块／主模块，不再出现载体）。启停／切主模块是对项目合同的写入：本组件只发事件，
 * 通道调用与 revision 闸留在外壳（同设置节的既有模式）。
 * 停用当前主模块给阻断提示，不允许静默停用（工单 A-7）。
 */
const props = defineProps({
  carriers: { type: Array, default: () => [] },
  primaryCarriers: { type: Array, default: () => [] }
})
const emit = defineEmits(['set-enabled', 'set-primary', 'close', 'changed'])

/** 停用当前主模块＝阻断（不是静默失败）：给出提示文案。 */
const blockedHint = computed(() => {
  const primary = props.carriers.find((item) => item.isPrimary)
  return primary ? `「${primary.title}」是这个库的主模块，不能停用；要换主模块先在下面选另一个。` : null
})
</script>

<template>
  <div data-test="library-settings">
    <p class="wizard-note" title="停用不删数据：目录转只读归档，随时可以再启用；主模块决定这个库创作哪一类内容">
      这个库装了哪些模块，在这里启用、停用或换主模块。
    </p>
    <p v-if="blockedHint" class="prefs-state" data-test="library-settings-blocked">{{ blockedHint }}</p>
    <div class="carriers-list">
      <div v-for="carrier in carriers" :key="carrier.id" class="carriers-row">
        <div class="carriers-info">
          <span class="carriers-title">
            {{ carrier.title }}
            <span v-if="carrier.isPrimary" class="carriers-badge">主模块</span>
          </span>
          <small class="carriers-meta">
            <span>{{ (carrier.dataDirs || []).join(' / ') || '无数据目录' }}</span>
            <span v-if="(carrier.scopes || []).length">权限：{{ carrier.scopes.join('、') }}</span>
            <span class="carriers-tools">工具 {{ (carrier.tools || []).length }}</span>
          </small>
        </div>
        <div class="carriers-actions">
          <button
            type="button"
            class="control-secondary carriers-toggle"
            :disabled="carrier.isPrimary"
            :title="carrier.isPrimary ? '主模块不可停用' : null"
            @click="emit('set-enabled', carrier)"
          >{{ carrier.isEnabled ? '停用' : '启用' }}</button>
          <button
            v-if="!carrier.isPrimary && carrier.primary"
            type="button"
            class="control-quiet carriers-set-primary"
            @click="emit('set-primary', carrier.id)"
          >设为主模块</button>
          <small v-if="carrier.isPrimary" class="carriers-hint">主模块不可停用</small>
        </div>
      </div>
    </div>
  </div>
</template>
