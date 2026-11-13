<script setup>
import { computed } from 'vue'
import WorkbenchIcon from '../../src/components/workbench/WorkbenchIcon.vue'
import { describeTrailEvent } from './agentSessions.mjs'
import { TIMELINE_ICON_NAMES, timelineElapsed, timelineSummary } from './conversationTimeline.mjs'
import { humanizeError } from './errorWords.mjs'

/**
 * 消息内处理时间线（批次77 任务4）：**只摆**。
 * 块型、四态文案、图标归类、只读并组、耗时合成都来自 `conversationTimeline.mjs` 的纯函数——
 * 组件里不写一句状态文案，也不数任何数（守卫生效点在那份模块，node:test 直接测）。
 *
 * 折叠口径（工单第 4 条）：原生 `<details>` ＋ **会话级内存 Map**（键＝path，缺省收起，不落盘＝守卫⑨）。
 * 展开态由父级（AssistantDialog）持有并传进来，本组件只把 `toggle` 报上去，自己不存——
 * 组件卸载重挂也不该假装记得，但同一会话里换问再回来还在（内存 Map 的生命周期就是会话面板的生命周期）。
 */
const props = defineProps({
  /** buildTimelineBlocks 的产物。 */
  blocks: { type: Array, default: () => [] },
  /** 原始轨迹（合成就近算，不另存一份）。 */
  trail: { type: Array, default: () => [] },
  /** 这一问还在跑：流中平铺（不套 details）＋顶部一条状态行。 */
  streaming: { type: Boolean, default: false },
  /** 平铺模式（在途那一问）。 */
  flat: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  /** 折叠态内存 Map 的键。 */
  path: { type: String, default: '' },
  /**
   * 〔P9 · 作者 2026-11-13 UX 审计裁定〕失败那一问的原文错误。
   * 主文案在 AssistantDialog 里已翻成人话；原文只放在这一层「过程」折叠里，供反馈开发者。
   */
  errorText: { type: String, default: '' }
})

const emit = defineEmits(['toggle'])

const summaryLine = computed(() => timelineSummary(props.trail, { streaming: props.streaming }))
const hasThinking = computed(() => props.blocks.some((block) => block.kind === 'thinking'))

/**
 * 〔P9 · E3〕收工后不足 0.1 秒的那行「已处理（不足 0.1 秒）」是零信息量的机制话，整行不摆；
 * 读数 ≥0.1 秒才保留。流中那一句是状态语，照旧显示。
 * `timelineElapsed.seconds` 已按 0.1 秒取整，所以这里读的是屏上真会出现的那个数。
 */
const showSummary = computed(() => {
  if (props.streaming) return true
  const elapsed = timelineElapsed(props.trail)
  return !(elapsed.hasTimeDiff && elapsed.seconds !== null && elapsed.seconds < 0.1)
})

/** 错误块的标题先过人话层：原始码／英文错误不占块头（原文仍在下面的过程行里）。 */
function headlineOf(block) {
  if (!block) return ''
  if (block.state !== 'error') return block.headline
  return humanizeError(block.headline).title || block.headline
}

/**
 * 壳子选型（工单第 4 条）：**同一叠块，两种摆法**——
 * 收工后的那一问套在原生 `<details>` 里（缺省收起，屏上只留问—答主线）；
 * 在途那一问平铺在状态行下面（作者正看着它跑，套一层"点开才看得见"等于没做）。
 * 用 `<component :is>` 换壳，是为了让块的那一叠 markup 只有一份：
 * 两处各写一遍，迟早长出一边改了另一边没改的时间线。
 */
const shell = computed(() => (props.flat ? 'div' : 'details'))
const shellClass = computed(() => (props.flat ? 'nx-timeline__open' : 'authoring-knowledge__trail'))
/** details 才吃 `open`；平铺那层是 div，别把折叠状态往它身上硬贴。 */
const shellProps = computed(() => (props.flat ? {} : { open: props.expanded }))

/** 块体那一叠原始行：仍走 describeTrailEvent（中文 label＋关键数字，与批次29 的折叠层同一个口）。 */
function rowsOf(block) {
  return (Array.isArray(block?.events) ? block.events : []).map(describeTrailEvent).filter(Boolean)
}

/** 图标名（写入类 block.icon 是 null，就不画图标——工单第 1 条）。 */
function iconName(block) {
  if (!block?.icon) return ''
  return TIMELINE_ICON_NAMES[block.icon] ?? ''
}

function onToggle(event) {
  // 平铺那一层是 <div>，浏览器不会给它发 toggle；防御一句，别把 undefined 当「收起」写进 Map。
  if (props.flat || !props.path) return
  emit('toggle', props.path, Boolean(event?.target?.open))
}
</script>

<template>
  <div class="nx-timeline" :class="{ 'is-flat': flat }" data-test="conversation-timeline">
    <!-- 顶部那一条状态行：收工后合成「已处理 N 秒 · 工具累计 Xms」；流中就报实时那一句。
         〔P9 · E3〕不足 0.1 秒时整行不摆（showSummary）。 -->
    <p v-if="showSummary" class="nx-timeline__summary" data-test="timeline-summary">{{ summaryLine }}</p>

    <!-- 块的那一叠只有一份：收工后套原生 details（缺省收起），在途那问直接平铺（换壳不换内容）。 -->
    <component :is="shell" class="nx-timeline__body" :class="shellClass" v-bind="shellProps" @toggle="onToggle">
      <template v-if="!flat">
        <summary><WorkbenchIcon name="chevron-down" :size="12" />过程（{{ blocks.length }} 段）</summary>
        <p class="nx-timeline__fold-hint">展开看这一问真实跑过哪几步；默认收起，屏上只留问—答主线。</p>
      </template>

      <!-- 〔P9〕失败那一问的原文错误只活在这一层折叠里：主文案说人话，技术原文留给反馈开发者。 -->
      <p v-if="errorText" class="nx-timeline__error-raw" data-test="timeline-error-raw">{{ errorText }}</p>

      <ol v-if="blocks.length" class="nx-timeline__list">
      <li
        v-for="(block, blockIndex) in blocks"
        :key="`${block.kind}-${blockIndex}`"
        class="nx-timeline__block"
        :data-kind="block.kind"
        :data-state="block.state"
      >
        <p class="nx-timeline__head">
          <WorkbenchIcon v-if="iconName(block)" :name="iconName(block)" :size="12" />
          <span class="nx-timeline__title">{{ headlineOf(block) }}</span>
          <span v-if="block.kind === 'tool-group'" class="nx-timeline__count">{{ block.items.length }} 项</span>
        </p>

        <!-- 只读并组：N 行压成组行，明细折进组里（原生 details，缺省收起）。 -->
        <details v-if="block.kind === 'tool-group'" class="nx-timeline__group">
          <summary>{{ block.groupLine }}</summary>
          <ul class="nx-timeline__rows">
            <li v-for="(item, itemIndex) in block.items" :key="`g-${item.callId || itemIndex}`" class="nx-timeline__group-item">
              <p class="nx-timeline__subhead">
                <WorkbenchIcon v-if="iconName(item)" :name="iconName(item)" :size="12" />
                <span>{{ item.headline }}</span>
              </p>
              <ul class="nx-timeline__raw">
                <li v-for="(row, rowIndex) in rowsOf(item)" :key="`r-${rowIndex}`" class="authoring-knowledge__trail-row">
                  <span class="authoring-knowledge__trail-stage">{{ row.label }}</span>
                  <span v-if="row.detail" class="authoring-knowledge__trail-detail">{{ row.detail }}</span>
                </li>
              </ul>
            </li>
          </ul>
        </details>

        <!-- 其余四型：块头一句话，底下仍是原始行（数字全来自事件本身）。 -->
        <ul v-else class="nx-timeline__raw">
          <li v-for="(row, rowIndex) in rowsOf(block)" :key="`r-${rowIndex}`" class="authoring-knowledge__trail-row">
            <span class="authoring-knowledge__trail-stage">{{ row.label }}</span>
            <span v-if="row.detail" class="authoring-knowledge__trail-detail">{{ row.detail }}</span>
          </li>
        </ul>
      </li>
      </ol>
      <p v-else class="nx-timeline__note" data-test="timeline-empty">这一问没有留下运行过程。</p>

      <!-- thinking 块型装的是「非工具的运行过程行」；模型真正的思维链文本这一问没有来源，
           就照实说没有（工单实锤的那句行话文案已换成作者语言）。 -->
      <p v-if="hasThinking" class="nx-timeline__note" data-test="timeline-thinking-note">
        这一轮没有思维链文本，只记录了运行过程。
      </p>
    </component>
  </div>
</template>

<style scoped>
/* 批次77 任务4：时间线只加排版，不加新配色——一律走老 token，字号走 --nx-* 刻度。
   门禁口径同批次76：不写裸色值，不自造控件词汇（这里没有 button，展开收起全靠原生 details）。 */
.nx-timeline { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 0; color: var(--text-muted); }
.nx-timeline.is-flat { border: 1px solid var(--hairline-soft); border-radius: var(--nx-radius-xs); padding: 4px 6px; background: color-mix(in srgb, var(--nav-hover) 40%, transparent); }
.nx-timeline__summary { margin: 0; font-size: var(--nx-fs-2xs); font-variant-numeric: tabular-nums; letter-spacing: .02em; }
.nx-timeline__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.nx-timeline__block { display: flex; flex-direction: column; gap: 1px; padding: 1px 0; }
.nx-timeline__head { display: flex; align-items: center; gap: 4px; margin: 0; font-size: var(--nx-fs-2xs); color: var(--text-muted); }
.nx-timeline__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nx-timeline__count { flex: none; padding: 0 4px; border-radius: var(--nx-radius-xs); background: var(--nav-hover); font-size: var(--nx-fs-2xs); font-variant-numeric: tabular-nums; }
.nx-timeline__block[data-state='running'] .nx-timeline__title { color: var(--accent-text); }
.nx-timeline__block[data-state='error'] .nx-timeline__title { color: var(--danger); }
.nx-timeline__block[data-state='completed'] .nx-timeline__title { color: var(--text-muted); }
.nx-timeline__group { margin-inline-start: 4px; }
.nx-timeline__group summary { cursor: pointer; list-style: none; font-size: var(--nx-fs-2xs); color: var(--text-muted); }
.nx-timeline__group summary::-webkit-details-marker { display: none; }
.nx-timeline__group-item { display: flex; flex-direction: column; gap: 1px; }
.nx-timeline__subhead { display: flex; align-items: center; gap: 4px; margin: 0; font-size: var(--nx-fs-2xs); }
.nx-timeline__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
/* 原始行沿用批次29 那两个类名（stage／detail）：过程行的字与数在屏上只有一种长相。
   这些元素都由本组件自己渲染，不用 :deep——:deep 是给子组件内部留的口子，这里没有子组件的内部。 */
.nx-timeline__raw { list-style: none; margin: 0; padding: 0 0 0 6px; display: flex; flex-direction: column; gap: 1px; }
.authoring-knowledge__trail-row { display: flex; align-items: baseline; gap: 6px; font-size: var(--nx-fs-2xs); line-height: 1.6; }
.authoring-knowledge__trail-stage { flex: none; color: var(--text-secondary); }
.authoring-knowledge__trail-detail { min-width: 0; color: var(--text-muted); font-variant-numeric: tabular-nums; word-break: break-word; }
.nx-timeline__note { margin: 2px 0 0; font-size: var(--nx-fs-2xs); line-height: 1.6; color: var(--text-muted); }
/* 〔P9〕技术原文行：只在过程折叠里出现，小一号、可折行，不抢主线的读。 */
.nx-timeline__error-raw { margin: 2px 0 0; padding: 4px 6px; border-radius: var(--nx-radius-xs); background: color-mix(in srgb, var(--archive-paper) 70%, transparent); color: var(--text-muted); font-size: var(--nx-fs-2xs); line-height: 1.6; word-break: break-word; }
/* 折叠那一层：批次29 的类名留在 details 上（别处的 querySelector 认它），度量也照批次29 那条抄——
   父组件的 scoped 样式进不了子组件内部，所以这一层的 summary 长相在本文件里再讲一遍，词与数不变。 */
.nx-timeline__body { margin: 2px 0 0; color: var(--text-muted); font-size: var(--nx-fs-2xs); }
.nx-timeline__body > summary { display: flex; min-height: 26px; align-items: center; gap: 6px; list-style: none; cursor: pointer; }
.nx-timeline__body > summary::-webkit-details-marker { display: none; }
.nx-timeline__body[open] > summary svg { transform: rotate(180deg); }
.nx-timeline__fold-hint { margin: 2px 0 0; font-size: var(--nx-fs-2xs); color: var(--text-muted); }
</style>
