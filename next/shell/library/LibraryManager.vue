<script setup>
import LibraryCard from './LibraryCard.vue'

/**
 * 库管理器（前端重构工单 A：库从设置页的四个配置项提升为一级界面）。
 *
 * 渲染条件＝没有已打开的项目（AppNext 的 v-if 分支）：整窗只留顶栏（品牌＋「我的库」＋设置入口），
 * 不渲染竖条／索引窗／页签／Agent 列（工单 A-1 验收）。有项目时整个组件不出现，工作区照旧。
 *
 * 渲染零 IPC（工单 A-2 验收）：最近清单由外壳以 props 快照传入；打开/新建/导入/移除/显示
 * 都只 emit 事件，通道调用与错误处理全部留在外壳（与菜单同一条分发口径）。
 */
const props = defineProps({
  /** 最近打开的库（appPreferences.recentProjects 快照；{path, name, kind, at}）。 */
  recents: { type: Array, default: () => [] },
  /** 相对时间的基准（默认当下；测试注入固定值）。 */
  now: { type: Object, default: null }
})
const emit = defineEmits(['open', 'reveal', 'remove', 'new-library', 'open-folder', 'import-records', 'open-settings'])

const lead = () => (props.recents.length ? '接着写，或者开个新的。' : '从一个空文件夹开始你的下一本书。')
</script>

<template>
  <div class="lib-manager" data-test="library-manager">
    <header class="lib-topbar">
      <span class="lib-brand">Pinax · Next</span>
      <h1 class="lib-title">我的库</h1>
      <button type="button" class="control-quiet lib-settings" data-test="library-open-settings" @click="emit('open-settings')">设置</button>
    </header>

    <main class="lib-body">
      <p class="lib-lead">{{ lead() }}</p>
      <div class="lib-actions">
        <button type="button" class="control-primary" data-test="library-new" @click="emit('new-library')">新建库</button>
        <button type="button" class="control-secondary" data-test="library-open-folder" @click="emit('open-folder')">打开文件夹</button>
        <button type="button" class="control-secondary" data-test="library-import" @click="emit('import-records')">导入既有稿</button>
      </div>

      <section v-if="recents.length" class="lib-recent" aria-label="最近打开的库">
        <h2 class="lib-section-title">最近打开的库</h2>
        <div class="lib-grid">
          <LibraryCard
            v-for="entry in recents"
            :key="entry.path"
            :entry="entry"
            :now="now"
            @open="(entryItem) => emit('open', entryItem)"
            @reveal="(entryItem) => emit('reveal', entryItem)"
            @remove="(entryItem) => emit('remove', entryItem)"
          />
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* 库管理器（工单 A／C）：整窗一级视图；间距 4 的倍数；字号全走令牌（页面标题新令牌 --nx-fs-hero）。 */
.lib-manager {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--workbench-chrome);
  color: var(--text-secondary);
}
.lib-topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 32px;
  border-bottom: 1px solid var(--hairline-soft);
}
.lib-brand {
  font-size: var(--nx-fs-md);
  color: var(--text-muted);
}
.lib-title {
  flex: 1 1 auto;
  margin: 0;
  font-size: var(--nx-fs-hero);
  line-height: 1.2;
  font-weight: 600;
  color: var(--text-primary);
}
.lib-settings { flex: none; }
.lib-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 24px;
  width: min(960px, 92vw);
  margin: 0 auto;
  padding: 32px 24px 48px;
}
.lib-lead {
  margin: 0;
  font-size: var(--nx-fs-xl);
  color: var(--text-secondary);
}
.lib-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.lib-section-title {
  margin: 0 0 12px;
  font-size: var(--nx-fs-lg);
  font-weight: 600;
  color: var(--text-primary);
}
.lib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
</style>
