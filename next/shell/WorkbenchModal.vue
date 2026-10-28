<script setup>
import { onBeforeUnmount, onMounted } from 'vue'

/**
 * WorkbenchModal（工单B0 · 作者裁定 U13）：配置项／设置页／顶栏延伸下来的功能配置，
 * 一律收进这枚圆润弹窗统一处理；核心工作区（col-center）保持纯净的文档与组件展示，
 * 不再强插任何按钮与 section。
 *
 * 词汇全部复用老前端，不自造：
 *   - 遮罩 var(--surface-overlay)（src/styles/main.css:153/221 明暗两档）；
 *   - 层级 var(--z-modal-backdrop)（src/styles/main.css:9，与老版弹窗同层）；
 *   - 面板圆角 var(--radius-surface)（src/styles/themes/legacy.css:62，老 .wizard 同款 24px）
 *     ＋底色 var(--surface-workbench-raised)（同文件:55/759）；
 *   - 进出场过渡 .modal-fade-*（src/styles/main.css:527-535）。
 *
 * 不带 Teleport：jsdom 界面测试要在文档流里查得到（next/tests/shell-ui.spec.mjs）。
 * dismissable=false（如 D1 主载体硬闸）时没有关闭钮，Esc 与点遮罩都不关。
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  dismissable: { type: Boolean, default: true }
})
const emit = defineEmits(['close'])

/** Esc 关闭挂在 window 上：焦点落在面板里的输入框时也要能关（仅 dismissable 时）。 */
function onKeydown(event) {
  if (event.key === 'Escape' && props.open && props.dismissable) emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="open" class="workbench-modal" @click.self="dismissable && emit('close')">
      <section class="workbench-modal-panel" role="dialog" aria-modal="true" :aria-label="title">
        <header class="workbench-modal-head">
          <h3 class="workbench-modal-title">{{ title }}</h3>
          <button
            v-if="dismissable"
            type="button"
            class="control-quiet workbench-modal-close"
            aria-label="关闭"
            @click="emit('close')"
          >×</button>
        </header>
        <div class="workbench-modal-body">
          <slot />
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
/* 遮罩：全屏 fixed，颜色与层级都是老前端那枚 token（明暗两档由主题 class 切）。 */
.workbench-modal {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal-backdrop);
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--surface-overlay);
}
/* 面板：圆润弹窗本体——圆角走 --radius-surface（老 .wizard 同款 24px），底色用工作台凸面。 */
.workbench-modal-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(560px, 100%);
  max-height: min(82vh, 100%);
  padding: 18px;
  overflow: auto;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-surface);
  background: var(--surface-workbench-raised);
  color: var(--archive-ink);
}
.workbench-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
/* 标题沿用老 .wizard h3 的那一档（font-display／--nx-fs-xl），不另起刻度。 */
.workbench-modal-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--nx-fs-xl);
  font-weight: 600;
  color: var(--archive-ink);
}
.workbench-modal-close {
  flex: 0 0 auto;
  width: 28px;
  min-height: 28px;
  padding: 0;
  justify-content: center;
  border-radius: var(--nx-radius-xs);
}
.workbench-modal-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
