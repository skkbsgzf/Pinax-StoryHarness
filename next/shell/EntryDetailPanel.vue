<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { renderMarkdown } from './mdRender.mjs'
import { buildEntryTokenMap, computeBacklinks, linkifyEntryNames, ownEntryTokens } from './wikiLinks.mjs'

/**
 * 条目详情面（批次44 · 从 CarrierPaneHost 里拆出来的独立面板）。
 *
 * 拆出来有两个原因：
 *   1) 世界书的看板区要做成「上＝图表列，下＝详情信息」的竖排（作者 2026-10-31），
 *      详情这一块得能被单独摆到看板区下面，不能只长在 pane 的根上；
 *   2) 蓝色双链要在这里一次修干净（见下面的词表纪律）。
 *
 * 蓝色标签那件事（作者 2026-10-31：「你在前端设计了一些蓝色的标签，看上去能跳转，但是其实不行，
 * 非常矛盾」）：老实说，染成可点色却点不动，比不染更坏。所以这里的纪律是
 * **看着能点就必须点得动**——词表只收「恰好指向一条条目」的词：
 *   - 全名、短名（· 后缀）、别名（aliases／keys）、标签（tags）都算候选；
 *   - 一个词若落在两条以上条目上（通用标签「记忆」「结构」就是这种），它不进词表——
 *     正文里就当普通文字，不染蓝；
 *   - 链进去的每个词都在同一张表里查得到归属条目（buildEntryTokenMap），
 *     点下去走的是同一个 openEntry，不会出现「链出去却打不开」。
 */
const props = defineProps({
  /** useBoardData 的返回值。 */
  data: { type: Object, required: true },
  /** 保存 chip（由 pane 统一管状态，这里只画）：null＝没有可显示的反馈。 */
  chip: { type: Object, default: null },
  chipVisible: { type: Boolean, default: false },
  chipStale: { type: Boolean, default: false },
  chipText: { type: String, default: '' },
  /** 没有选中条目时的那句提示（看板区与独立详情面给的措辞不一样）。 */
  emptyHint: { type: String, default: '从左边索引窗里选一条设定。' }
})
const emit = defineEmits(['chip-action'])

/** 阅读态的 md 渲染：与其它文档面同一条路径（mdRender.mjs）。 */
const entryHtml = computed(() => renderMarkdown(props.data.entry?.content ?? ''))

/**
 * 双链词表：所有条目候选词里，去掉「有多条归属」的，再去掉当前条目自己的词。
 * 一张表两用——链的时候取它的 key，点的时候按同一张表查归属（老做法是链用一份词、
 * 点用另一份匹配规则，两份对不上就出现「蓝的却点不动」）。
 */
const entryTokenMap = computed(() => buildEntryTokenMap(props.data.entries ?? []))
const entryLinkTokens = computed(() => {
  const own = ownEntryTokens(props.data.entry)
  return [...entryTokenMap.value.keys()].filter((token) => !own.has(token))
})

const entryRenderedEl = ref(null)
watch([entryHtml, () => props.data.entry?.name, () => props.data.editingEntry], async () => {
  if (props.data.editingEntry) return
  await nextTick()
  if (entryRenderedEl.value) linkifyEntryNames(entryRenderedEl.value, entryLinkTokens.value, { firstOnly: true })
})

function resolveEntryToken(token) {
  return entryTokenMap.value.get(String(token ?? '')) ?? null
}

function onRenderedClick(event) {
  const link = event.target?.closest?.('.nx-wikilink')
  if (!link) return
  const item = resolveEntryToken(link.dataset.entry)
  if (item) props.data.openEntry(item)
}

const entryBacklinks = computed(() => computeBacklinks(props.data.entries ?? [], props.data.entry?.name, props.data.entry?.path))

async function openBacklink(backlink) {
  const item = props.data.entries.find((candidate) => candidate.path === backlink.path || candidate.name === backlink.name)
  if (item) await props.data.openEntry(item)
}

/**
 * 条目信息折叠层（批次31 · P18 第 4 条）：关键词／标签／摘要／关系默认收起——
 * 编辑面先是正文，元数据是「条目信息」那一行点开才在的字段（照 Obsidian properties）。
 */
const entryMetaOpen = ref(false)
const entryMetaSummary = computed(() => {
  const keys = String(props.data.entryMetaDraft?.keys ?? '')
    .split(/[,，]/u)
    .map((part) => part.trim())
    .filter(Boolean)
  const relations = Array.isArray(props.data.entryMetaDraft?.relations) ? props.data.entryMetaDraft.relations.length : 0
  return `关键词 ${keys.length} · 关系 ${relations}`
})
watch(() => props.data.editingEntry, (editing) => {
  if (!editing) entryMetaOpen.value = false
})

/** 阅读态的关系（批次28 · 工单2b）：一行一条「目标 · 类型 · 立场」。 */
const entryRelations = computed(() => (Array.isArray(props.data.entry?.relations) ? props.data.entry.relations : [])
  .filter((relation) => typeof relation?.to === 'string' && relation.to.trim()))
function relationLine(relation) {
  return [relation?.to, relation?.type, relation?.stance]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}

/** 条目摘要的阅读态预览（收口包②）：meta 行只占一行，超过 80 字就截断并加省略号。 */
const SUMMARY_PREVIEW_CHARS = 80
function clipSummary(value) {
  const text = String(value ?? '').trim()
  return text.length > SUMMARY_PREVIEW_CHARS ? `${text.slice(0, SUMMARY_PREVIEW_CHARS)}…` : text
}

/** 条目底行（批次43）：只剩作者自己写的东西——关键词、摘要。 */
const entryMetaLine = computed(() => {
  const entry = props.data.entry
  if (!entry) return ''
  const parts = []
  if (entry.keys?.length) parts.push(`关键词：${entry.keys.join('、')}`)
  const summary = clipSummary(entry.summary)
  if (summary) parts.push(`摘要：${summary}`)
  if (!entry.contract) parts.push('（未建档）')
  return parts.join(' · ')
})
</script>

<template>
  <div v-if="data.entry" class="entry-body">
    <div class="doc-head">
      <h2 class="doc-title">{{ data.entry.name }}</h2>
      <span class="nx-pane-actions">
        <!-- 保存 chip：保存的唯一常驻形态（批次31 · P18）。 -->
        <span v-if="chipVisible && chip" class="nx-save-chip" :class="`is-${chip.status}`" role="status" aria-label="保存状态">
          <span class="nx-save-chip-state">{{ chipText }}</span>
          <button v-if="chip.status === 'error'" type="button" class="nx-row nx-save-chip-action" @click="emit('chip-action')">{{ chipStale ? '重新载入' : '重试' }}</button>
          <span v-if="chipStale" class="nx-save-chip-hint">会丢弃未保存修改</span>
        </span>
        <button v-if="!data.editingEntry" type="button" class="control-secondary entry-edit" @click="data.editEntry()">编辑</button>
        <button v-else type="button" class="control-quiet entry-cancel" :disabled="data.busy" @click="data.cancelEditEntry()">取消</button>
      </span>
    </div>
    <!-- 条目信息（批次31 · P18 第 4 条）：关键词／标签／摘要／关系默认收起，编辑面先是正文；
         这一行点开才是字段（照 Obsidian properties）。裸 md 没有 frontmatter：改成一句说明。 -->
    <div v-if="data.editingEntry && data.entry.contract" class="entry-meta-row">
      <button
        type="button"
        class="control-quiet entry-meta-toggle"
        data-test="entry-meta-toggle"
        :aria-expanded="entryMetaOpen ? 'true' : 'false'"
        @click="entryMetaOpen = !entryMetaOpen"
      >
        <span aria-hidden="true" class="entry-meta-caret">{{ entryMetaOpen ? '▾' : '▸' }}</span>
        <span>条目信息</span>
        <span class="entry-meta-hint">{{ entryMetaSummary }}</span>
      </button>
      <div v-if="entryMetaOpen" class="entry-meta-edit" data-test="entry-meta-fields">
        <label class="entry-meta-field">
          <span class="entry-meta-label">关键词</span>
          <input
            class="nx-field"
            :value="data.entryMetaDraft.keys"
            spellcheck="false"
            aria-label="条目关键词（逗号分隔）"
            @input="data.setEntryMeta('keys', $event.target.value)"
          >
        </label>
        <label class="entry-meta-field">
          <span class="entry-meta-label">标签</span>
          <input
            class="nx-field"
            :value="data.entryMetaDraft.tags"
            spellcheck="false"
            aria-label="条目标签（逗号分隔）"
            @input="data.setEntryMeta('tags', $event.target.value)"
          >
        </label>
        <label class="entry-meta-field is-summary">
          <span class="entry-meta-label">摘要</span>
          <textarea
            class="nx-field entry-meta-summary"
            :value="data.entryMetaDraft.summary"
            maxlength="500"
            rows="2"
            spellcheck="false"
            aria-label="条目摘要（最多 500 字）"
            @input="data.setEntryMeta('summary', $event.target.value)"
          />
          <span class="entry-meta-count" aria-hidden="true">{{ data.entryMetaDraft.summary.length }}/500</span>
        </label>
        <!-- 关系（批次28 · 工单2b）：frontmatter 的 relations 一行一条，整份随 meta 落盘。 -->
        <div class="entry-relations" data-test="entry-relations">
          <span class="entry-meta-label">关系</span>
          <ul v-if="data.entryMetaDraft.relations.length" class="entry-relation-rows">
            <li v-for="(relation, index) in data.entryMetaDraft.relations" :key="`rel-${index}`" class="entry-relation-row">
              <input
                class="nx-field entry-relation-target"
                list="entry-relation-targets"
                :value="relation.to"
                spellcheck="false"
                placeholder="目标条目"
                aria-label="关系目标"
                @input="data.setEntryRelation(index, 'to', $event.target.value)"
              >
              <input
                class="nx-field entry-relation-type"
                :value="relation.type ?? ''"
                spellcheck="false"
                placeholder="类型（师徒／敌对／亲属）"
                aria-label="关系类型"
                @input="data.setEntryRelation(index, 'type', $event.target.value)"
              >
              <input
                class="nx-field entry-relation-stance"
                :value="relation.stance ?? ''"
                spellcheck="false"
                placeholder="立场"
                aria-label="关系立场"
                @input="data.setEntryRelation(index, 'stance', $event.target.value)"
              >
              <label class="entry-relation-covert">
                <input
                  type="checkbox"
                  :checked="relation.covert === true"
                  @change="data.setEntryRelation(index, 'covert', $event.target.checked)"
                >
                <span>暗线</span>
              </label>
              <button type="button" class="control-quiet entry-relation-remove" :aria-label="`删除第 ${index + 1} 条关系`" @click="data.removeEntryRelation(index)">删行</button>
            </li>
          </ul>
          <datalist id="entry-relation-targets">
            <option v-for="item in data.entries" :key="item.path" :value="item.name" />
          </datalist>
          <button type="button" class="control-secondary entry-relation-add" @click="data.addEntryRelation()">加一条关系</button>
        </div>
      </div>
    </div>
    <p v-else-if="data.editingEntry" class="entry-meta-bare" data-test="entry-meta-bare">
      这篇没有 frontmatter（未按世界书文件契约建档），关键词／标签／摘要改不了；保存仍按原样整份写正文。
    </p>
    <!-- 阅读态的关系（批次28 · 工单2b）：一行一条「目标 · 类型 · 立场」；没有关系就不摆这块。 -->
    <ul v-if="!data.editingEntry && entryRelations.length" class="entry-relations-read" data-test="entry-relations-read">
      <li v-for="(relation, index) in entryRelations" :key="`rel-read-${index}`">{{ relationLine(relation) }}</li>
    </ul>
    <textarea
      v-if="data.editingEntry"
      class="editor-area"
      :value="data.entryDraft"
      spellcheck="false"
      aria-label="条目编辑器"
      @input="data.setEntryDraft($event.target.value)"
    />
    <!-- 阅读态（批次26）：md 原文渲染成 HTML。批次38：渲染后做 Wiki 双链，点击经 openEntry 跳条目；
         批次44：链出去的词一定点得动（词表与解析器同一张表）。
         key＝当前条目：两条正文恰好一模一样时 v-html 不会重渲染（innerHTML 相同＝不patch），
         上一条留下的蓝链就会留在原地——那正是「看着能跳却跳错」的种子。key 让它整块重来。 -->
    <div
      v-else
      :key="data.entry?.path || data.entry?.name"
      ref="entryRenderedEl"
      class="entry-text nx-rendered-md"
      data-test="entry-rendered"
      @click="onRenderedClick"
      v-html="entryHtml"
    />
    <!-- 反向链接（批次38）：谁提到我（relations 或正文包含），点一下跳过去。 -->
    <div v-if="!data.editingEntry && entryBacklinks.length" class="entry-backlinks" data-test="entry-backlinks">
      <span class="entry-backlinks-label">被引用</span>
      <button
        v-for="backlink in entryBacklinks"
        :key="backlink.path || backlink.name"
        type="button"
        class="control-quiet entry-backlink"
        @click="openBacklink(backlink)"
      >{{ backlink.name }}</button>
    </div>
    <p v-if="data.entry.contentTruncated" class="pane-notice">只显示前 {{ data.entry.content.length }} 字，全篇 {{ data.entry.contentChars }} 字。</p>
    <!-- meta 沉底（批次43）：只剩作者自己的信息——关键词与摘要。 -->
    <p v-if="entryMetaLine" class="doc-meta-hint">{{ entryMetaLine }}</p>
  </div>
  <p v-else-if="!data.busy && !data.error" class="pane-hint">{{ emptyHint }}</p>
  <ul v-if="data.entryWarnings.length" class="pane-warn">
    <li v-for="(warning, index) in data.entryWarnings" :key="`e-${index}`">{{ warning }}</li>
  </ul>
</template>
