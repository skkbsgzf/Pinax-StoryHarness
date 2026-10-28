<script setup>
/**
 * 载体管理 Section（工单C0 内容组件化 · 工单A1 的弹窗内容原样搬入统一二级页）。
 * 启停／切主载体是对项目合同的写入：节只发事件（set-enabled／set-primary），
 * 通道调用与 revision 闸留在外壳（同 RuntimeDock 持桥发问、AssistantDialog 发事件的模式）。
 */
defineProps({
  carriers: { type: Array, default: () => [] }
})
const emit = defineEmits(['set-enabled', 'set-primary', 'close', 'changed'])
</script>

<template>
  <div>
    <p class="wizard-note">这个项目装了哪些板块（载体），在这里启用、停用或换主载体。停用不删数据：目录转只读归档，随时可以再启用。</p>
    <div class="carriers-list">
      <div v-for="carrier in carriers" :key="carrier.id" class="carriers-row">
        <div class="carriers-info">
          <span class="carriers-title">
            {{ carrier.title }}
            <span v-if="carrier.isPrimary" class="carriers-badge">主载体</span>
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
            :title="carrier.isPrimary ? '主载体不可停用' : null"
            @click="emit('set-enabled', carrier)"
          >{{ carrier.isEnabled ? '停用' : '启用' }}</button>
          <button
            v-if="!carrier.isPrimary && carrier.primary"
            type="button"
            class="control-quiet carriers-set-primary"
            @click="emit('set-primary', carrier.id)"
          >设为主载体</button>
          <small v-if="carrier.isPrimary" class="carriers-hint">主载体不可停用</small>
        </div>
      </div>
    </div>
    <div class="prefs-actions">
      <button type="button" class="control-quiet" @click="emit('close')">关闭</button>
    </div>
  </div>
</template>
