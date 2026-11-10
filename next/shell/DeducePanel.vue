<script setup>
import { computed, inject, ref, watch } from 'vue'
import {
  normalizeFactEntries,
  characterOptions,
  povKnown,
  povRelations,
  sceneViewModel,
  archiveSnapshot,
  CANDIDATE_BADGES
} from '../fact/usecases/deduce/deduceView.js'
import { openDeduceSession } from '../fact/usecases/deduce/opening.js'
import { presentTurn, applyDirectorAction } from '../fact/usecases/deduce/turn.js'
import { settleChoice, settleInject, settleHypothesis } from '../fact/usecases/deduce/settle.js'
import { createSessionStore } from '../fact/usecases/deduce/sessionStore.js'
import { addKnownExtra } from '../fact/usecases/deduce/sessionState.js'

/**
 * 推演面板（M1-c · 第一视角）：AppNext 直接挂载的一枚中栏面板，不走新页签、不注册新槽位。
 *
 * 分工：本组件只做「薄接线」——
 *   - 条目归一／POV 裁剪／局面卡与徽章形状 → deduceView.js（fact 纯模块，可 Node 内置测试自验）；
 *   - 开局／呈现／结算／导演动作／事件留档 → M1-a/M1-b 引擎（presentTurn / settle* / createSessionStore）；
 *   - 本组件持有会话的宿主侧状态（ref）、把结果摊成简笔场景卡，并把回执上抛给外壳。
 * 回执不另建通知 UI：emit('receipt') 交给 AppNext 并入既有的 serviceSnapshot（服务与通知那一份状态面）。
 */
const props = defineProps({
  /** 世界书面条目（data.entries，与列表／图谱同源；不新增工具调用）。 */
  entries: { type: Array, default: () => [] },
  /** 可选 LlmPort（{ complete() }）。AppNext 经 fact:llm-complete IPC 注入主进程子 Agent 通道
   *  （M 系接线批）；未注入／通道失败时戏剧✦层如实缺席，必然▮／命运⚙照旧（失败隔离在 fact 消费侧）。 */
  llmPort: { type: [Object, Function], default: null },
  worldName: { type: String, default: '' }
})
const emit = defineEmits(['close', 'receipt'])
const openKnowledge = inject('pinaxOpenKnowledge', null)

const phase = ref('setup') // setup | playing | archived
const mode = ref('player') // player | director
const busy = ref(false)
const error = ref('')
const povChoice = ref('')
const worldScope = ref('all')
const injectName = ref('')
const injectDefinition = ref('')

const factEntries = computed(() => normalizeFactEntries(props.entries))
const characters = computed(() => characterOptions(factEntries.value))
const worldviewEntries = computed(() => factEntries.value.filter((entry) => entry.layer === 'worldview'))
const scopeOptions = computed(() => {
  const counts = new Map()
  for (const entry of worldviewEntries.value) counts.set(entry.slot, (counts.get(entry.slot) ?? 0) + 1)
  return [
    { value: 'all', label: `全部设定 · ${worldviewEntries.value.length}` },
    ...[...counts.entries()].map(([slot, count]) => ({ value: slot, label: `${slot} · ${count}` }))
  ]
})
/** 冻结的世界书＝选中的世界观条目 ＋ 全部角色（绑主角从角色里选）。 */
const frozenEntries = computed(() => {
  const world = worldScope.value === 'all'
    ? worldviewEntries.value
    : worldviewEntries.value.filter((entry) => entry.slot === worldScope.value)
  return [...world, ...factEntries.value.filter((entry) => entry.layer === 'character')]
})

watch(characters, (list) => {
  if (!list.some((item) => item.name === povChoice.value)) povChoice.value = list[0]?.name ?? ''
}, { immediate: true })

const session = ref(null)
const state = ref(null)
const sceneCard = ref(null)
const candidates = ref([])
const view = computed(() => sceneViewModel(sceneCard.value ?? {}, candidates.value))
const known = ref([])
const relationRows = computed(() => povRelations(frozenEntries.value, session.value?.pov ?? '', known.value))
const receipts = ref([])
const snapshot = ref(null)
/** 本拍局面上下文的知情保真度（P-WIRE）：ledger＝按账本裁；world＝账本为空、降级已记账。 */
const sceneContextInfo = ref(null)
/** 知情降级只报一次，别每拍刷一条同样的回执。 */
const knownDegraded = ref(false)

let store = null
let seq = 1
let seed = 1
let runId = ''

function pushReceipt(level, message, data = {}) {
  receipts.value = [...receipts.value, { level, message }].slice(-12)
  emit('receipt', { level, message, data })
}

function record(type, extra = {}) {
  if (!store || !runId) return
  store.appendEvent(runId, seq++, { type, ...extra })
}

async function openSession() {
  error.value = ''
  if (!povChoice.value) {
    error.value = '先选定主视角角色，再冻结世界书。'
    return
  }
  try {
    const opened = openDeduceSession({ entries: frozenEntries.value, pov: povChoice.value })
    session.value = opened.session
    state.value = opened.state
    runId = opened.session.runId
    store = createSessionStore()
    store.create({ sessionId: runId, pov: opened.session.pov, worldHash: opened.session.worldHash })
    seq = 1
    seed = 1
    known.value = povKnown(frozenEntries.value, opened.session.pov)
    receipts.value = []
    snapshot.value = null
    candidates.value = []
    sceneCard.value = null
    sceneContextInfo.value = null
    knownDegraded.value = false
    record('opening', { pov: opened.session.pov, worldHash: opened.session.worldHash })
    pushReceipt('info', `开局：世界书已冻结（${worldviewEntries.value.length} 条设定），主视角「${opened.session.pov}」。`, { runId })
    phase.value = 'playing'
    await refreshTurn()
  } catch (err) {
    error.value = err?.message ?? String(err)
  }
}

async function refreshTurn() {
  if (!state.value || !session.value) return
  busy.value = true
  try {
    const turn = await presentTurn({
      state: state.value,
      entries: frozenEntries.value,
      pov: session.value.pov,
      llmPort: props.llmPort,
      seed: seed++
    })
    sceneCard.value = turn.sceneCard
    candidates.value = turn.candidates
    sceneContextInfo.value = turn.sceneContext ?? null
    // 知情降级如实上抛一次（每局只报第一次）：账本为空不是错误，但作者要知道视角裁剪没生效。
    const fidelity = turn.sceneContext?.knowledgeFidelity
    if (fidelity === 'world' && !knownDegraded.value) {
      knownDegraded.value = true
      pushReceipt('warn', turn.sceneContext?.warnings?.find((item) => item.code === 'KNOWLEDGE_LEDGER_EMPTY')?.message
        ?? '主视角没有知情账本：本局按世界级可见降级，第一视角裁剪未生效。')
    }
    // 候选明细进事件流（M 系接线批）：M2 投影器吃的是 candidates 数组，
    // 只记 {round,count} 的旧形状喂不饱章纲——明细与来源徽章一并留档，回放/投影同源。
    record('candidates', { round: state.value.round, count: turn.candidates.length, candidates: turn.candidates })
  } catch (err) {
    error.value = err?.message ?? String(err)
  } finally {
    busy.value = false
  }
}

async function choose(option) {
  if (busy.value) return
  const candidate = candidates.value.find((item) => item.id === option.id)
  if (!candidate) return
  const domain = props.worldName || '推演'
  const result = settleChoice({ state: state.value, domain, candidate })
  for (const name of result.knowledgeDelta.gained) {
    if (name && !known.value.includes(name)) known.value = [...known.value, name]
  }
  // P-WIRE：知情增量同时落进会话状态——下一拍的可见域从 state.knownExtra 取，
  // 两处同源才不会「情报面板知道、局面卡不知道」。
  addKnownExtra(state.value, result.knowledgeDelta.gained)
  record('settle', { text: candidate.text, source: candidate.source })
  record('knowledge-delta', { gained: result.knowledgeDelta.gained })
  pushReceipt('info', `第 ${state.value.round} 拍 · ${candidate.badge} ${candidate.source}：${candidate.text}`, { decidedBy: result.entry.provenance.decidedBy })
  const hypothesis = settleHypothesis({ state: state.value, domain, candidate })
  if (hypothesis) pushReceipt('warn', '命运受阻：这一拍留了一条悬而未决的假设。')
  await refreshTurn()
}

async function veto(option) {
  const candidate = candidates.value.find((item) => item.id === option.id)
  if (!candidate) return
  applyDirectorAction({ state: state.value, action: 'veto', candidate })
  record('director-veto', { candidateId: candidate.id })
  pushReceipt('info', `导演否决了一条 ${candidate.source} 候选。`)
  candidates.value = candidates.value.filter((item) => item.id !== option.id)
  if (!candidates.value.length) await refreshTurn()
}

async function reroll(option) {
  const candidate = candidates.value.find((item) => item.id === option.id)
  applyDirectorAction({ state: state.value, action: 'reroll', candidate })
  record('director-reroll', { candidateId: candidate?.id })
  pushReceipt('info', '导演重掷：换骰重新呈现一拍。')
  await refreshTurn()
}

async function injectBeat() {
  const name = injectName.value.trim()
  const definition = injectDefinition.value.trim()
  if (!name) {
    error.value = '注入需要给出实体名。'
    return
  }
  error.value = ''
  const action = applyDirectorAction({ state: state.value, action: 'inject', name, definition })
  settleInject({ state: state.value, domain: props.worldName || '推演', name: action.entry.name, definition: action.entry.definition })
  record('director-inject', { name })
  record('settle', { text: name, source: '导演注入' })
  if (!known.value.includes(name)) known.value = [...known.value, name]
  addKnownExtra(state.value, [name])
  pushReceipt('info', `导演注入：${name} —— ${definition || '导演注入'}`)
  injectName.value = ''
  injectDefinition.value = ''
  await refreshTurn()
}

function finish(reason) {
  const purpose = reason === 'interrupt' ? 'custom' : 'final'
  store?.checkpoint(runId, seq++, purpose, state.value)
  record('session-end', { reason })
  const events = store?.listEvents(runId).events ?? []
  snapshot.value = archiveSnapshot({ state: state.value, session: session.value, reason, events })
  pushReceipt('info', `${reason === 'interrupt' ? '中断' : '收束'}：本局已留档（第 ${state.value.round} 拍，${snapshot.value.eventCount} 条事件）。`, snapshot.value)
  phase.value = 'archived'
}

function reset() {
  phase.value = 'setup'
  mode.value = 'player'
  session.value = null
  state.value = null
  sceneCard.value = null
  candidates.value = []
  known.value = []
  receipts.value = []
  snapshot.value = null
  sceneContextInfo.value = null
  knownDegraded.value = false
  error.value = ''
  injectName.value = ''
  injectDefinition.value = ''
  store = null
  seq = 1
  seed = 1
  runId = ''
}

/** 悬置伏笔（P-WIRE）：plot 里 hypothesis+open 的条目——推演张力来自上一拍没解决的事。 */
const openHooks = computed(() => sceneContextInfo.value?.openHypotheses ?? [])

/** 已知情报／关系目标点开＝跳世界书条目视图（复用外壳既有的 pinaxOpenKnowledge 蓝链落点）。 */
function jumpTo(name) {
  const item = (props.entries ?? []).find((entry) => String(entry?.name ?? entry?.title ?? '') === name)
  if (!item || typeof openKnowledge !== 'function') return
  openKnowledge({ kind: 'entry', item })
}
</script>

<template>
  <section class="nx-deduce-layer" data-test="deduce-layer" aria-label="推演面板">
    <header class="nx-deduce-head">
      <span class="nx-deduce-title">推演 · 第一视角</span>
      <span v-if="session" class="nx-deduce-meta">第 {{ state.round }} 拍 · {{ session.pov }} · {{ session.runId }}</span>
      <span v-else class="nx-deduce-meta">待开局</span>
      <span class="nx-deduce-spacer"></span>
      <template v-if="phase === 'playing'">
        <button
          type="button"
          class="control-quiet nx-deduce-mode"
          :class="{ 'is-active': mode === 'player' }"
          data-test="deduce-mode-player"
          @click="mode = 'player'"
        >玩家</button>
        <button
          type="button"
          class="control-quiet nx-deduce-mode"
          :class="{ 'is-active': mode === 'director' }"
          data-test="deduce-mode-director"
          @click="mode = 'director'"
        >导演</button>
        <button type="button" class="control-quiet nx-deduce-act" data-test="deduce-finish" @click="finish('final')">收束本局</button>
        <button type="button" class="control-quiet nx-deduce-act" data-test="deduce-interrupt" @click="finish('interrupt')">中断</button>
      </template>
      <button type="button" class="control-quiet nx-deduce-close" data-test="deduce-close" @click="emit('close')">关闭</button>
    </header>

    <!-- 开局：选世界书范围 → 冻结 → 绑主角 → 进局 -->
    <div v-if="phase === 'setup'" class="nx-deduce-setup" data-test="deduce-setup">
      <p class="nx-deduce-lead">游玩不写正文：一局由简笔场景卡、候选走向与第一视角知情面板组成。</p>
      <div class="nx-deduce-setup-row">
        <label class="nx-deduce-setup-label" for="deduce-scope">冻结范围 · 世界书 {{ factEntries.length }} 条</label>
        <select id="deduce-scope" v-model="worldScope" class="nx-deduce-select" data-test="deduce-scope">
          <option v-for="item in scopeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>
      <div class="nx-deduce-setup-row">
        <label class="nx-deduce-setup-label" for="deduce-pov">主视角角色 · {{ characters.length }} 位</label>
        <select id="deduce-pov" v-model="povChoice" class="nx-deduce-select" data-test="deduce-pov">
          <option v-for="item in characters" :key="item.name" :value="item.name">{{ item.name }}</option>
        </select>
      </div>
      <button type="button" class="control-primary nx-deduce-open" data-test="deduce-open" @click="openSession">冻结世界书并开局</button>
      <p v-if="error" class="nx-deduce-error" data-test="deduce-error">{{ error }}</p>
    </div>

    <!-- 游玩：局面卡 ＋ 候选 ＋ 第一视角两面板 -->
    <div v-else-if="phase === 'playing'" class="nx-deduce-body">
      <div class="nx-deduce-main">
        <div class="nx-deduce-card" data-test="deduce-scene-card">
          <div v-for="field in view.fields" :key="field.key" class="nx-deduce-field" :data-field="field.key">
            <span class="nx-deduce-field-label">{{ field.label }}</span>
            <span class="nx-deduce-field-value">{{ field.value }}</span>
          </div>
          <p
            v-if="sceneContextInfo"
            class="nx-deduce-fidelity"
            :class="{ 'is-degraded': sceneContextInfo.knowledgeFidelity !== 'ledger' }"
            data-test="deduce-fidelity"
          >
            {{ sceneContextInfo.knowledgeFidelity === 'ledger'
              ? `第一视角 · 已知 ${sceneContextInfo.known.length} 项`
              : '知情账本为空 · 本局按世界级可见降级' }}
          </p>
        </div>

        <p class="nx-deduce-legend" data-test="deduce-badge-legend">
          <span v-for="item in CANDIDATE_BADGES" :key="item.source" class="nx-deduce-badge-chip">
            <i class="nx-deduce-badge" aria-hidden="true">{{ item.badge }}</i>{{ item.label }}
          </span>
          <span class="nx-deduce-legend-note">候选 2–4 条 · 命运带 2d6 骰点</span>
        </p>

        <ul class="nx-deduce-candidates" data-test="deduce-candidates">
          <li
            v-for="option in view.options"
            :key="option.id"
            class="nx-deduce-candidate"
            :data-source="option.source"
            :data-test="`deduce-candidate-${option.source}`"
          >
            <span class="nx-deduce-badge" aria-hidden="true">{{ option.badge }}</span>
            <span class="nx-deduce-candidate-source">{{ option.source }}</span>
            <span class="nx-deduce-candidate-text">{{ option.text }}</span>
            <span v-if="option.traceText" class="nx-deduce-trace">{{ option.traceText }}</span>
            <span class="nx-deduce-candidate-actions">
              <button
                v-if="mode === 'player'"
                type="button"
                class="control-primary nx-deduce-pick"
                :data-test="`deduce-pick-${option.source}`"
                @click="choose(option)"
              >选择</button>
              <template v-else>
                <button type="button" class="control-quiet nx-deduce-veto" @click="veto(option)">否决</button>
                <button type="button" class="control-quiet nx-deduce-reroll" data-test="deduce-reroll" @click="reroll(option)">重掷</button>
              </template>
            </span>
          </li>
        </ul>
        <p v-if="!view.options.length" class="nx-deduce-hint">本拍暂无可选走向，重掷或注入一条。</p>

        <div v-if="mode === 'director'" class="nx-deduce-inject" data-test="deduce-inject">
          <input v-model="injectName" class="nx-deduce-input" placeholder="实体名" aria-label="注入实体名" />
          <input v-model="injectDefinition" class="nx-deduce-input" placeholder="发生了什么" aria-label="注入内容" />
          <button type="button" class="control-quiet nx-deduce-inject-go" @click="injectBeat">注入</button>
        </div>
      </div>

      <aside class="nx-deduce-aside">
        <section class="nx-deduce-panel" data-test="deduce-known">
          <h3 class="nx-deduce-panel-title">已知情报 · {{ session.pov }}</h3>
          <ul class="nx-deduce-list">
            <li v-for="name in known" :key="name">
              <button type="button" class="workspace-nav-item nx-deduce-link" @click="jumpTo(name)">{{ name }}</button>
            </li>
          </ul>
          <p v-if="!known.length" class="nx-deduce-hint">本视角暂无已知情报。</p>
        </section>

        <section class="nx-deduce-panel" data-test="deduce-relations">
          <h3 class="nx-deduce-panel-title">人物关系</h3>
          <ul class="nx-deduce-list">
            <li v-for="(row, index) in relationRows" :key="`${row.from}-${row.to}-${index}`" class="nx-deduce-relation">
              <span class="nx-deduce-relation-from">{{ row.from }}</span>
              <span class="nx-deduce-relation-label">{{ row.label }}</span>
              <button type="button" class="workspace-nav-item nx-deduce-link" @click="jumpTo(row.to)">{{ row.to }}</button>
            </li>
          </ul>
          <p v-if="!relationRows.length" class="nx-deduce-hint">本视角暂无可见关系。</p>
        </section>

        <section v-if="openHooks.length" class="nx-deduce-panel" data-test="deduce-open-hooks">
          <h3 class="nx-deduce-panel-title">悬置伏笔 · {{ openHooks.length }}</h3>
          <ul class="nx-deduce-list">
            <li v-for="item in openHooks" :key="item.id" class="nx-deduce-hook">{{ item.definition || item.name }}</li>
          </ul>
        </section>

        <section class="nx-deduce-panel" data-test="deduce-receipts">
          <h3 class="nx-deduce-panel-title">本局回执</h3>
          <ul class="nx-deduce-list nx-deduce-receipts">
            <li v-for="(item, index) in receipts" :key="index" :class="`is-${item.level}`">{{ item.message }}</li>
          </ul>
          <p v-if="!receipts.length" class="nx-deduce-hint">暂无回执。</p>
        </section>
      </aside>
    </div>

    <!-- 收束／中断：快照留档 -->
    <div v-else class="nx-deduce-archived" data-test="deduce-archived">
      <p class="nx-deduce-lead">{{ snapshot?.reason === 'interrupt' ? '本局已中断' : '本局已收束' }}，快照留档如下。</p>
      <dl class="nx-deduce-archive-grid">
        <div><dt>局号</dt><dd>{{ snapshot?.runId }}</dd></div>
        <div><dt>主视角</dt><dd>{{ snapshot?.pov }}</dd></div>
        <div><dt>拍数</dt><dd>{{ snapshot?.round }}</dd></div>
        <div><dt>事件数</dt><dd>{{ snapshot?.eventCount }}</dd></div>
        <div><dt>状态指纹</dt><dd>{{ snapshot?.stateHash }}</dd></div>
      </dl>
      <button type="button" class="control-primary nx-deduce-reopen" data-test="deduce-reopen" @click="reset">重新开局</button>
    </div>

    <p v-if="error && phase !== 'setup'" class="nx-deduce-error">{{ error }}</p>
  </section>
</template>

<style scoped>
/* 颜色／字号／圆角一律走老前端 token 与 --nx-* 刻度（门禁见 visual-contract.test.mjs）。
   面板由 AppNext 直接挂在 .col-center 内：绝对定位盖住窗口层，不与右栏占位列争版面。 */
.nx-deduce-layer {
  position: absolute;
  inset: 0;
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px;
  overflow: auto;
  background: var(--surface-workbench-muted);
  color: var(--archive-ink);
  font-family: var(--font-interface);
  font-size: var(--nx-fs-md);
}
.nx-deduce-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--hairline-soft);
}
.nx-deduce-title {
  font-size: var(--nx-fs-xl);
  font-weight: 600;
  white-space: nowrap;
}
.nx-deduce-meta {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
  white-space: nowrap;
}
.nx-deduce-spacer {
  flex: 1 1 auto;
}
.nx-deduce-mode.is-active {
  border-color: var(--accent);
  color: var(--accent);
}
.nx-deduce-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 280px);
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}
.nx-deduce-main,
.nx-deduce-aside {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.nx-deduce-card {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  padding: 14px 16px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-raised);
}
.nx-deduce-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.nx-deduce-field-label {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.nx-deduce-field-value {
  font-size: var(--nx-fs-lg);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
/* 知情保真度读数：跨两列贴在卡片底部——作者一眼看得出这一局是「按账本裁」还是「降级」。
   降级用弱化文案而非警示色（不是错误，是数据不全）。 */
.nx-deduce-fidelity {
  grid-column: 1 / -1;
  margin: 0;
  padding-top: 8px;
  border-top: 1px solid var(--hairline-soft);
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.nx-deduce-fidelity.is-degraded {
  color: var(--text-muted);
  font-style: italic;
}
.nx-deduce-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin: 0;
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.nx-deduce-badge-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.nx-deduce-badge {
  font-style: normal;
  color: var(--accent);
}
.nx-deduce-legend-note {
  margin-left: auto;
}
.nx-deduce-candidates {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.nx-deduce-candidate {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-xs);
  background: var(--surface-workbench-raised);
}
.nx-deduce-candidate-source {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.nx-deduce-candidate-text {
  flex: 1 1 200px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.nx-deduce-trace {
  flex: 0 0 auto;
  font-size: var(--nx-fs-2xs);
  color: var(--signal-warm);
}
.nx-deduce-candidate-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}
.nx-deduce-inject {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--hairline-soft);
  border-radius: var(--nx-radius-xs);
}
.nx-deduce-input {
  flex: 1 1 160px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-xs);
  background: var(--surface-workbench-muted);
  color: var(--archive-ink);
  font-family: var(--font-interface);
  font-size: var(--nx-fs-md);
}
.nx-deduce-panel {
  padding: 12px 14px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-raised);
}
.nx-deduce-panel-title {
  margin: 0 0 8px;
  font-size: var(--nx-fs-xl);
  font-weight: 600;
}
.nx-deduce-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.nx-deduce-link {
  width: 100%;
  text-align: left;
  color: var(--accent);
}
.nx-deduce-relation {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: var(--nx-fs-2xs);
}
.nx-deduce-relation-from {
  color: var(--text-muted);
}
.nx-deduce-relation-label {
  color: var(--text-muted);
}
.nx-deduce-receipts li {
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.nx-deduce-receipts li.is-warn {
  color: var(--signal-warm);
}
.nx-deduce-hint,
.nx-deduce-lead {
  margin: 0;
  font-size: var(--nx-fs-2xs);
  line-height: 1.6;
  color: var(--text-muted);
}
.nx-deduce-error {
  margin: 0;
  font-size: var(--nx-fs-md);
  color: var(--signal-warm);
}
.nx-deduce-setup,
.nx-deduce-archived {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  max-width: 560px;
}
.nx-deduce-setup-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.nx-deduce-setup-label {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.nx-deduce-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--nx-radius-xs);
  background: var(--surface-workbench-raised);
  color: var(--archive-ink);
  font-family: var(--font-interface);
  font-size: var(--nx-fs-md);
}
.nx-deduce-archive-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 18px;
  width: 100%;
  margin: 0;
}
.nx-deduce-archive-grid dt {
  font-size: var(--nx-fs-2xs);
  color: var(--text-muted);
}
.nx-deduce-archive-grid dd {
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}
@media (max-width: 860px) {
  .nx-deduce-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
