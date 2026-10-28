<script setup>
import { ref } from 'vue'
import { IPC_CHANNELS } from '../ipcContract.mjs'

/**
 * 新建项目 Section（工单C0 内容组件化 · 批次9 的弹窗内容原样搬入统一二级页）。
 * 名字可改，目录必须经系统对话框选一个空文件夹——会话根（Documents）几乎必然非空，
 * createProject 的空目录闸会永远拦住默认路径（原注释，语义未改）。
 * 伴生板块勾选状态（extraEnabled）与主载体 id 由外壳经 props 注入；
 * 建成与否都上交 changed 让外壳 refresh（原 createProject 末尾无条件 refresh）。
 */
const props = defineProps({
  bridge: { type: Object, default: null },
  /** 清单里声明了 primary 的板块（外壳从 view.carriers 里取的那一个）。 */
  primaryCarrierId: { type: String, default: null },
  extraEnabled: { type: Array, default: () => [] }
})
const emit = defineEmits(['changed'])

const newProjectName = ref('')
const newProjectDir = ref(null)

async function pickProjectDir() {
  if (!props.bridge?.request) return
  const result = await props.bridge.request(IPC_CHANNELS.projectPickDir, {})
  if (result.ok && result.value?.picked) newProjectDir.value = result.value.path
}

async function createProject() {
  if (!props.bridge?.request || !newProjectDir.value) return
  const primary = props.primaryCarrierId
  if (!primary) return
  const result = await props.bridge.request(IPC_CHANNELS.projectCreate, {
    name: newProjectName.value.trim() || '未命名新书',
    primaryCarrier: primary,
    extraEnabled: props.extraEnabled,
    root: newProjectDir.value
  })
  if (result.ok) {
    newProjectDir.value = null
    newProjectName.value = ''
  }
  emit('changed')
}
</script>

<template>
  <div>
    <p class="wizard-note">新项目是磁盘上的一个文件夹（文件夹即数据）：选一个空目录——也可以在对话框里新建，然后在里面开写。</p>
    <div class="prefs-grid">
      <div class="prefs-row">
        <span class="prefs-row-label">项目名称</span>
        <input v-model="newProjectName" class="nx-field prefs-input" type="text" placeholder="未命名新书">
      </div>
      <div class="prefs-row">
        <span class="prefs-row-label">项目文件夹</span>
        <button type="button" class="control-secondary" @click="pickProjectDir">选择空目录…</button>
        <span class="prefs-row-hint">{{ newProjectDir || '尚未选择' }}</span>
      </div>
      <div class="prefs-actions">
        <button type="button" class="control-primary" :disabled="!newProjectDir" @click="createProject">在所选目录新建项目</button>
      </div>
    </div>
  </div>
</template>
