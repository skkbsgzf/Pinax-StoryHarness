/** 结算落库（M1-a）：作者选择 → 事件条目（plot）＋知情增量＋假设轨；导演三动作。
 * 事件带 runId/pov/fate|author provenance（成书渲染与「命运之笔/作者之笔」的数据地基）。 */
import { FACT_SCHEMA } from '../../domain/vocabulary.js'
import { stableEntryId } from '../../domain/stableId.js'
import { pushLog } from './sessionState.js'

function trunc(text, n) {
  const s = String(text ?? '')
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

function beatEntry({ state, domain, candidate, decidedBy, extra = {} }) {
  const name = `第${state.round}拍·${trunc(candidate.text, 18)}`
  return {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain, slot: '', name }),
    layer: 'plot',
    name,
    domain,
    status: 'adopted',
    definition: candidate.text,
    provenance: {
      mode: 'author',
      book: domain,
      book_id: state.worldHash.slice(0, 8),
      chapters: [], scenes: [],
      extractor: `deduce/${state.runId}@1`,
      runId: state.runId,
      pov: state.pov,
      source: candidate.source,
      decidedBy
    },
    fingerprint: { vec: null, metrics: {} },
    trace: candidate.trace ?? null,
    ...extra
  }
}

/** 作者选择一个候选 → 事件落库（必然/命运 fate 笔；戏剧被选中＝作者之笔）＋ POV 知情增量。 */
export function settleChoice({ state, domain, candidate, seedPrompt } = {}) {
  const decidedBy = candidate.proposed ? 'author' : 'fate'
  const entry = beatEntry({ state, domain, candidate, decidedBy })
  const gained = [...(candidate.refs ?? []), ...(seedPrompt ? [seedPrompt] : [])].filter((n) => n && n !== state.pov)
  const knowledgeDelta = { pov: state.pov, gained: [...new Set(gained)] }
  // P-WIRE：事件流带 pov/goal——M2 投影器把它落进节点、M3 chapterize 才能按「视角∷目标」分章。
  // 旧形状只有 text/source/decidedBy，多视角重演时所有拍都退回按 domain 分组＝分不出章。
  pushLog(state, 'settle', { text: candidate.text, source: candidate.source, decidedBy, pov: state.pov, goal: goalOf(candidate) })
  return { entry, knowledgeDelta }
}

/**
 * 拍的目标标记：只认候选显式给的 goal/objective。
 * 不从 refs 猜——每拍引用不同实体，猜出来的目标每拍都变，chapterize 会按「视角∷目标」
 * 一拍切一章（M3 的分章语义是「目标确立→转折/了结＝一章」，目标必须跨拍稳定）。
 * 缺显式目标时留空，分章退回「同视角连续拍 ＋ 拍数上限」，等 M4 的目标弧来填。
 */
function goalOf(candidate) {
  return String(candidate?.goal ?? candidate?.objective ?? '').trim()
}

/** 导演注入：author 事件直落（命运之笔之外的作者之笔）。 */
export function settleInject({ state, domain, name, definition }) {
  const candidate = { text: `${name}——${definition ?? '导演注入'}`, refs: [name], trace: null }
  const entry = beatEntry({ state, domain, candidate, decidedBy: 'author' })
  entry.name = `第${state.round}拍·${trunc(name, 18)}`
  entry.definition = definition ?? '导演注入'
  entry.provenance.source = '导演注入'
  pushLog(state, 'settle', { text: entry.name, source: '导演注入', decidedBy: 'author', pov: state.pov })
  return { entry, knowledgeDelta: { pov: state.pov, gained: [name] } }
}

/** 命运受阻 → 假设轨（open 事件：留给后续拍/其他 POV 去解释——叠加微调的钩子）。 */
export function settleHypothesis({ state, domain, candidate }) {
  if (!candidate.trace || candidate.trace.success) return null
  const name = `第${state.round}拍·悬而未决`
  const entry = {
    schema: FACT_SCHEMA,
    id: stableEntryId({ layer: 'plot', domain, slot: '', name }),
    layer: 'plot', name, domain,
    status: 'adopted',
    definition: candidate.text,
    hypothesis: true, open: true,
    fingerprint: { vec: null, metrics: {} },
    provenance: {
      mode: 'author', book: domain, book_id: state.worldHash.slice(0, 8),
      chapters: [], scenes: [], extractor: `deduce/${state.runId}@1`,
      runId: state.runId, pov: state.pov, source: candidate.source, decidedBy: 'fate'
    },
    trace: candidate.trace
  }
  pushLog(state, 'hypothesis', { text: candidate.text })
  return entry
}
