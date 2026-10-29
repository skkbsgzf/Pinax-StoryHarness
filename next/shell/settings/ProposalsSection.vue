<script setup>
import { onMounted, ref } from 'vue'

/**
 * 提案审阅 Section（工单B1：协议 v1.1-B 的落点）。
 *
 * 为什么要搬来这里：v1.1-A 要小说栏只留正文一棵内容树，提案不进索引窗；
 * v1.1-B 把它迁到统一二级页「文档」组新节「提案审阅」——列提案 → 点开 → 中栏对照＋采纳，
 * 与「文档历史」同一形态（列表在设置里选，正文区的审阅面仍是既有那一块）。
 *
 * 数据只有一条路：props.data 就是外壳的 useBoardData（与索引窗／核心区同一份对象），
 * 这里调 data.loadProposals()（经 runtimeToolCall 走载体自有的 pinax_proposal_list），
 * 不另开第二条取数路径。点一条提案交给 props.open（AppNext 注入）：
 * 关弹窗 → 把 selection 置为该提案 → 核心区渲染既有 CarrierPaneHost 的 proposal-review 分支。
 * 采纳／弃用仍在那块审阅面上，本节只做列表与导航（不复制一套采纳逻辑）。
 *
 * 只读边界：本节的「点开」不改任何文件；采纳要作者在审阅面按下去，才走 pinax_chapter_save
 * （带当前章节修订号，提案状态由文件服务原子写回）。
 */
const props = defineProps({
  /** useBoardData 的返回值：proposals／proposalsError／proposalWarnings 都是它维护的那一份。 */
  data: { type: Object, default: null },
  /** 点开一条提案：async (item) => void（外壳负责关弹窗并置 selection）。 */
  open: { type: Function, default: null }
})

const loading = ref(false)

onMounted(() => { void reload() })

async function reload() {
  if (typeof props.data?.loadProposals !== 'function') return
  loading.value = true
  try {
    await props.data.loadProposals()
  } finally {
    loading.value = false
  }
}

function openProposal(item) {
  if (!item?.name) return
  if (typeof props.open === 'function') props.open(item)
}

/** 行的 createdAt 短格式（模型写提案的时刻，精确到分钟就够认了；解析不了就原样退回空串）。 */
function shortStamp(value) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function statusText(status) {
  if (status === 'adopted') return '已采纳'
  if (status === 'discarded') return '已弃用'
  return ''
}
</script>

<template>
  <div class="proposals-section" data-test="proposals-section">
    <p class="wizard-note">
      这里列 .pinax/proposals/ 里的模型改稿。点一条会关闭设置，并在正文栏打开审阅面
      （当前正文与提案新文对照，采纳／弃用在那边）；采纳前正文一个字都不动。
    </p>

    <p v-if="loading" class="proposals-state" role="status">正在读取提案…</p>
    <div v-else-if="data?.proposalsError" class="proposals-state is-error" role="alert">
      <span>{{ data.proposalsError }}</span>
      <button type="button" class="control-secondary proposals-retry" @click="reload()">重试</button>
    </div>
    <template v-else>
      <p v-if="!data?.proposals?.length" class="proposals-state proposals-empty">
        还没有提案。模型改稿或运行时写下的提案会落在这里。
      </p>
      <div v-else class="proposals-list" aria-label="提案列表">
        <button
          v-for="item in data.proposals"
          :key="item.name"
          type="button"
          class="workspace-nav-item workspace-nav-item--tree nx-tree-row proposals-row"
          :data-test="`proposal-row-${item.name}`"
          :aria-label="`打开提案「${item.target?.title ?? item.name}」的审阅面`"
          @click="openProposal(item)"
        >
          <span class="workspace-nav-label proposals-row-title">{{ item.target?.title ?? item.name }}</span>
          <span class="workspace-nav-meta proposals-row-meta">
            {{ shortStamp(item.createdAt) }}<template v-if="statusText(item.status)"> · {{ statusText(item.status) }}</template>
          </span>
        </button>
      </div>
      <!-- 运行时轨的纯文本散件不进审阅面（不是 JSON 提案），但要如实报数，别让作者以为目录是空的。 -->
      <p v-if="data?.proposalRaw?.length" class="proposals-state">
        另有 {{ data.proposalRaw.length }} 份运行时散件（纯文本，不参与审阅）。
      </p>
      <ul v-if="data?.proposalWarnings?.length" class="proposals-warn">
        <li v-for="(warning, index) in data.proposalWarnings" :key="`w-${index}`">{{ warning }}</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.proposals-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.proposals-state {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  line-height: 1.7;
}
.proposals-state.is-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: var(--control-danger);
}
.proposals-empty {
  padding: 10px 2px;
}
.proposals-retry {
  flex: none;
}
.proposals-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--hairline-soft);
  border-radius: var(--radius-control);
  background: var(--surface-workbench-muted);
}
.proposals-row {
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}
.proposals-row-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--archive-ink);
  font-size: var(--fs-sm);
}
.proposals-row-meta {
  flex: none;
  color: var(--text-muted);
  font-size: var(--nx-fs-2xs);
}
.proposals-warn {
  margin: 0;
  padding: 0 0 0 18px;
  color: var(--signal-warm);
  font-size: var(--nx-fs-2xs);
  line-height: 1.7;
}
</style>
