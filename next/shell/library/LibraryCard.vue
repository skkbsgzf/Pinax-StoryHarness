<script setup>
import { ref } from 'vue'
import WorkbenchIcon from '../../../src/components/workbench/WorkbenchIcon.vue'
import { formatLibraryCardMeta, libraryKindLabel } from './libraryFilters.mjs'

/**
 * 库卡片（库管理器工单 A-3）：标题＋类型胶囊＋路径＋相对时间，整卡可点（回车/空格打开）。
 * 「更多」菜单只放两个记录级动作：在文件管理器中显示、从列表移除（只移除记录，不删盘）。
 * 渲染零 IPC：路径/类型/时间/篇数全部来自 props 里的最近清单快照（工单 A-2 验收）。
 * 范围 P1：类型胶囊与筛选条共用 libraryFilters 的同一张映射表；第三行补「N 篇 · 时间」
 * （旧记录没有 count 时只显示时间，不扫盘、不猜数）。
 * P6（作者 2026-11-13 按 demo 裁定）：卡片圆角 14；悬停＝描边加深不改字色；
 * 最近打开的第一张画墨色选中环（外层 1px 描边＋inset 1px，合成 demo 的 2px 墨环）。
 */
const props = defineProps({
  entry: { type: Object, required: true },
  /** 相对时间的基准（默认当下；测试可注入）。 */
  now: { type: Object, default: null },
  /** 是否是「最近打开的第一张」（库管理器按整份清单首条算，不按筛选后首条）。 */
  current: { type: Boolean, default: false }
})
const emit = defineEmits(['open', 'reveal', 'remove'])

const menuOpen = ref(false)

const kindLabel = libraryKindLabel(props.entry?.kind)

function metaText() {
  return formatLibraryCardMeta(props.entry, props.now ?? undefined)
}
</script>

<template>
  <div class="lib-card-wrap">
    <button
      type="button"
      class="lib-card"
      :data-test="`library-card`"
      :title="entry?.path ?? ''"
      :aria-current="current ? 'true' : undefined"
      @click="emit('open', entry)"
    >
      <span class="lib-card-head">
        <span class="lib-card-title" :title="entry?.name ?? entry?.path ?? ''">{{ entry?.name ?? entry?.path }}</span>
        <span v-if="kindLabel" class="lib-card-kind">{{ kindLabel }}</span>
      </span>
      <span class="lib-card-path" :title="entry?.path ?? ''">{{ entry?.path }}</span>
      <span class="lib-card-meta">{{ metaText() }}</span>
    </button>
    <button
      type="button"
      class="lib-card-more"
      aria-label="库记录的更多操作"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      @click.stop="menuOpen = !menuOpen"
    >
      <WorkbenchIcon name="chevron-down" :size="14" />
    </button>
    <div v-if="menuOpen" class="lib-card-menu" role="menu" @click.stop>
      <button type="button" role="menuitem" class="lib-menu-item" @click="menuOpen = false; emit('reveal', entry)">在文件管理器中显示</button>
      <button type="button" role="menuitem" class="lib-menu-item is-danger" @click="menuOpen = false; emit('remove', entry)">从列表移除</button>
    </div>
  </div>
</template>

<style scoped>
/* 库卡片（工单 A-3/C-3/P6）：悬停只动描边不动文字色；长名长路径单行省略。字号/颜色全走令牌。 */
.lib-card-wrap {
  position: relative;
  display: flex;
  min-width: 0;
}
.lib-card {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-lg);
  background: var(--surface-workbench-raised);
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.lib-card:hover { border-color: var(--text-primary); }
/* 〔P6〕最近打开的第一张＝墨色选中环：外层描边 1px＋inset 1px，合起来 2px 墨环（demo 原样）。 */
.lib-card[aria-current="true"] {
  border-color: var(--text-primary);
  box-shadow: inset 0 0 0 1px var(--text-primary);
}
.lib-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
}
.lib-card-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--nx-fs-lg);
  color: var(--text-primary);
  font-weight: 600;
}
.lib-card-kind {
  flex: none;
  padding: 1px 8px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-pill);
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.lib-card-path {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-interface);
  font-size: var(--nx-fs-2xs);
  line-height: 1.5;
  color: var(--text-muted);
}
.lib-card-meta {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.lib-card-more {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--nx-radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.lib-card-menu {
  position: absolute;
  top: 34px;
  right: 10px;
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  min-width: 160px;
  padding: 4px;
  list-style: none;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-raised);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--archive-ink) 18%, transparent);
}
.lib-menu-item {
  min-height: 30px;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--nx-radius-xs);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--nx-fs-md);
  text-align: left;
  cursor: pointer;
}
.lib-menu-item:hover { background: var(--nav-hover); }
.lib-menu-item.is-danger { color: var(--danger); }
</style>
