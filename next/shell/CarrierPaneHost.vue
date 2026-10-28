<script setup>
import { computed } from 'vue'

/**
 * 核心区里的载体面板：正文的编辑面、条目的阅读与编辑面（工单A2 起条目可改）。
 *
 * 数据不在这里自己取——索引窗与核心区共用 useBoardData 的同一份对象，
 * 所以「索引窗列着第 1 版、正文存成了第 2 版」这种不同步不会发生。
 * 认不出的 pane id 不空白、不假装能编辑：如实说这块视图还没实现。
 */
const props = defineProps({
  pane: { type: Object, default: null },
  /** useBoardData 的返回值。 */
  data: { type: Object, required: true }
})

const paneId = computed(() => props.pane?.id ?? '')
const viewKind = computed(() => {
  if (paneId.value === 'novel.editor') return 'chapter-editor'
  if (paneId.value === 'setting.entries') return 'entry-detail'
  return 'placeholder'
})
</script>

<template>
  <div v-if="!pane" class="pane pane-empty">
    <p>没有已启用的中栏面板。竖条、索引窗和右栏对话照常可用。</p>
  </div>

  <div v-else class="pane" :data-pane-id="pane.id">
    <div v-if="data.error" class="pane-error">{{ data.error }}</div>
    <div v-if="data.notice" class="pane-notice">{{ data.notice }}</div>

    <template v-if="viewKind === 'chapter-editor'">
      <div v-if="data.chapter" class="editor">
        <div class="editor-head">
          <h4 class="pane-sub">{{ data.chapter.title }}</h4>
          <span class="editor-meta">
            {{ data.chapter.file }} · 第 {{ data.chapter.revision }} 版 · {{ data.chapter.totalChars }} 字
            <em v-if="data.chapter.truncated">（当前只载入前段）</em>
          </span>
        </div>
        <textarea
          class="editor-area"
          :value="data.draft"
          spellcheck="false"
          aria-label="正文编辑器"
          @input="data.setDraft($event.target.value)"
        />
        <div class="editor-foot">
          <button type="button" class="pane-btn is-primary control-primary" :disabled="data.busy || !data.draft" @click="data.save()">
            {{ data.busy ? '写入中…' : `保存为第 ${(data.chapter?.revision ?? 0) + 1} 版` }}
          </button>
        </div>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一章，或在那里新建一章。</p>
    </template>

    <template v-else-if="viewKind === 'entry-detail'">
      <div v-if="data.entry" class="entry-body">
        <div class="entry-head">
          <h4 class="pane-sub">{{ data.entry.name }}</h4>
          <span class="entry-meta">{{ data.entry.path }} · 第 {{ data.entry.revision }} 版 · {{ data.entry.contentChars }} 字<template v-if="!data.entry.contract">（未建档）</template></span>
          <button v-if="!data.editingEntry" type="button" class="control-secondary entry-edit" @click="data.editEntry()">编辑</button>
        </div>
        <textarea
          v-if="data.editingEntry"
          class="editor-area"
          :value="data.entryDraft"
          spellcheck="false"
          aria-label="条目编辑器"
          @input="data.setEntryDraft($event.target.value)"
        />
        <pre v-else class="entry-text">{{ data.entry.content }}</pre>
        <div v-if="data.editingEntry" class="editor-foot">
          <button type="button" class="pane-btn is-primary control-primary" :disabled="data.busy || !data.entryDraft" @click="data.saveEntry()">
            {{ data.busy ? '写入中…' : '保存为新版本' }}
          </button>
          <button type="button" class="control-quiet entry-cancel" :disabled="data.busy" @click="data.cancelEditEntry()">取消</button>
        </div>
        <p v-if="data.entry.contentTruncated" class="pane-notice">只显示前 {{ data.entry.content.length }} 字，全篇 {{ data.entry.contentChars }} 字。</p>
      </div>
      <p v-else-if="!data.busy && !data.error" class="pane-hint">从左边索引窗里选一条设定。</p>
      <p v-if="data.entry?.relations?.length" class="pane-hint">关系字段 {{ data.entry.relations.length }} 条（面板第一批只列不画图）。</p>
      <ul v-if="data.entryWarnings.length" class="pane-warn">
        <li v-for="(warning, index) in data.entryWarnings" :key="`e-${index}`">{{ warning }}</li>
      </ul>
    </template>

    <p v-else class="pane-note">
      「{{ pane.pluginTitle }}」这块板块的面板视图还没做出来。它的工具和上下文块照常可用——先在右栏问 Pi-Agent。
    </p>
  </div>
</template>
