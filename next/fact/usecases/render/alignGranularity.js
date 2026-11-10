/**
 * 粒度对齐（P-ALIGN）：抽取段（100–300 字）→ 成书拍（beat）。
 *
 * 为什么需要这一层：引擎里有两种 plot 粒度，各自都对，但直接对接会错位——
 *   - **抽取**产出段级条目：一条 plot = 一个 100–300 字的段（段内可能有多条 events）。
 *     这个粒度是对的：段落是「信息量可核」的最小单位，再细就是句级噪声。
 *   - **投影**产出拍级节点：一次 settle = 一拍。这个粒度也是对的：拍是「一次决策」的单位。
 * 错位在中间：整本书抽完是「一章 10–20 条段级条目」，而 chapterize 的默认上限是 6 拍／章——
 * 段级条目直接喂进去，原来的一章会被切成三到五章，读者的阅读节奏跟原作完全不是一个东西。
 *
 * 合并规则（本模块唯一职责，确定性，无模型调用）：
 *   1) **不跨章**：validity.from 不同（或 provenance.chapters 不相交）的条目永不合并——
 *      章的边界是作者的意图，不是字数。
 *   2) **不跨视角**：pov 不同即断（多视角重演时同一时段有两份数据，混拍＝上帝视角）。
 *   3) **按信息量累积到目标拍长**：相邻段累加到 `targetChars`（默认 600，约 2–6 段）就收一拍；
 *      不足 `minBeatChars` 时继续吃下一段，但不越过规则 1/2。
 *   4) **悬置伏笔跟着拍走**：段上挂的 hooks 并进拍节点的 openHooks，
 *      不因合并而丢（成书渲染要拿它做「未回收伏笔」注入）。
 *   5) **单条超长自成拍**：一条段已经超过 targetChars 时，它自己就是一拍（不切、不丢）。
 *
 * 产物是 M2 投影器的原生形状（id/title/definition/order/seq/domain/pov/goal/openHooks），
 * 于是「抽取 → 对齐 → chapterize → renderChapter」是一条直链，中间不需要任何转译。
 *
 * 纯函数、零宿主依赖：只 import fact 域内相对路径。
 */
import { sha1Hex } from '../../domain/stableId.js'

export const ALIGN_VERSION = 'plot-align@1'

/** 一拍的目标字数：600 字≈两到三个抽取段，接近一次「场景动作」的信息量。 */
export const BEAT_TARGET_CHARS = 600
/** 一拍的下限：低于这个还继续吃下一段（除非撞上章的边界）。 */
export const BEAT_MIN_CHARS = 300

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function trimmed(value) {
  return str(value).trim()
}

function charsOf(entry) {
  const defined = trimmed(entry?.definition)
  if (defined) return defined.length
  const fact = str(entry?.fact)
  if (fact) return fact.length
  return 0
}

/** 条目所属章序号：validity.from 优先，其次 provenance.chapters 的首个整数。 */
function chapterOf(entry) {
  const from = entry?.validity?.from
  if (Number.isInteger(from)) return from
  const chapters = entry?.provenance?.chapters
  if (Array.isArray(chapters) && chapters.length) {
    const first = chapters.find((item) => Number.isInteger(item))
    if (Number.isInteger(first)) return first
  }
  return null
}

/** 条目视角：provenance.pov 优先，其次顶层 pov（抽取条目没有 pov 时为 null＝未知）。 */
function povOf(entry) {
  return trimmed(entry?.provenance?.pov) || trimmed(entry?.pov) || null
}

/** 段上挂的伏笔（compilePlot 把 row.hooks 落在 plot.hooks）。 */
function hooksOf(entry) {
  const list = Array.isArray(entry?.hooks) ? entry.hooks : []
  return list.map((item) => trimmed(item)).filter(Boolean)
}

/** 段内事件 → 拍定义（保留 who/channel 前缀，成书渲染要看得出是谁做了什么）。 */
function definitionOf(entry) {
  const events = Array.isArray(entry?.events) ? entry.events.filter(isPlainObject) : []
  if (events.length) {
    return events
      .map((event) => `${trimmed(event.who) ? `${trimmed(event.who)}：` : ''}${trimmed(event.content)}`)
      .filter(Boolean)
      .join('；')
  }
  return trimmed(entry?.definition) || str(entry?.fact).trim()
}

/**
 * 段级 plot 条目 → 拍级节点。
 *
 * @param {Object[]} entries fact.data/v2 条目（只取 layer==='plot' 的 fact 轨；hypothesis+open 不算拍）
 * @param {Object} [options]
 *   targetChars  拍目标字数（默认 600）
 *   minBeatChars 拍下限（默认 300）
 *   domain       缺省域（条目自带 domain 优先）
 * @returns {{ok:true, version, nodes, spans, counts, warnings}}
 *   nodes  可直接喂 chapterize / renderChapter 的拍节点数组
 *   spans  每拍覆盖的源条目 id 清单（可追溯「这一拍是哪几段合起来的」）
 */
export function foldSegmentsToBeats(entries, options = {}) {
  const source = Array.isArray(entries) ? entries.filter(isPlainObject) : []
  const targetChars = Number.isInteger(options.targetChars) && options.targetChars > 0 ? options.targetChars : BEAT_TARGET_CHARS
  const minBeatChars = Number.isInteger(options.minBeatChars) && options.minBeatChars > 0 ? options.minBeatChars : BEAT_MIN_CHARS
  const fallbackDomain = trimmed(options.domain)
  const warnings = []

  // 只取 fact 轨：悬置假设（hypothesis+open）不是「已经发生的事」，混进拍序会把没发生的事写成正文。
  const candidates = source.filter((entry) => {
    if (entry.layer !== 'plot') return false
    if (entry.hypothesis === true && entry.open === true) return false
    return true
  })
  // 稳定性：按 validity 章序、再按 provenance 里的段序（extractor 顺序）排。
  // 没有章序的条目排最后（保持输入顺序），不猜它属于哪一章。
  const ordered = candidates
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const chapterLeft = chapterOf(left.entry)
      const chapterRight = chapterOf(right.entry)
      if (chapterLeft !== null && chapterRight !== null && chapterLeft !== chapterRight) return chapterLeft - chapterRight
      if (chapterLeft !== null && chapterRight === null) return -1
      if (chapterLeft === null && chapterRight !== null) return 1
      return left.index - right.index
    })
    .map((row) => row.entry)

  const nodes = []
  const spans = []
  let bucket = []
  let bucketChars = 0
  let bucketChapter = null
  let bucketPov = null

  const flush = () => {
    if (!bucket.length) return
    const order = nodes.length + 1
    const definition = bucket.map(definitionOf).filter(Boolean).join('；')
    const hooks = [...new Set(bucket.flatMap(hooksOf))]
    const domain = trimmed(bucket[0]?.domain) || fallbackDomain
    // 拍 id 用「源条目 id 的稳定哈希」而非序号：同一批段重跑对齐得到同一 id（可重渲染的前提）。
    const key = bucket.map((entry) => str(entry.id)).join('|')
    const node = {
      id: `beat-${sha1Hex(`align|${key}`).slice(0, 10)}`,
      title: `第${order}拍·${definition.slice(0, 18)}${definition.length > 18 ? '…' : ''}`,
      definition,
      intent: definition,
      summary: definition,
      status: 'adopted',
      order,
      seq: order,
      domain,
      fromEntries: bucket.map((entry) => str(entry.id)),
      chars: bucketChars
    }
    if (bucketPov) node.pov = bucketPov
    // 目标弧：抽取数据里没有显式 goal 时留空——chapterize 会退回「同视角连续拍＋拍数上限」，
    // 不拿章名硬当目标（那会把每章切成一拍一章）。
    const goals = bucket.map((entry) => trimmed(entry.goal)).filter(Boolean)
    if (goals.length) {
      const uniqueGoals = [...new Set(goals)]
      if (uniqueGoals.length > 1) {
        warnings.push({ code: 'BEAT_GOAL_CONFLICT', message: `一拍里出现多个目标（${uniqueGoals.join(' / ')}），取第一个；段级数据的目标字段可能不一致` })
      }
      node.goal = uniqueGoals[0]
    }
    if (hooks.length) node.openHooks = hooks
    nodes.push(node)
    spans.push({ beatId: node.id, order, entryIds: node.fromEntries, chars: bucketChars, chapter: bucketChapter })
    bucket = []
    bucketChars = 0
    bucketChapter = null
    bucketPov = null
  }

  for (const entry of ordered) {
    const chapter = chapterOf(entry)
    const pov = povOf(entry)
    const size = charsOf(entry)
    const crossesChapter = bucket.length > 0 && chapter !== null && bucketChapter !== null && chapter !== bucketChapter
    const crossesPov = bucket.length > 0 && pov !== null && bucketPov !== null && pov !== bucketPov
    // 规则 1/2：章或视角变了立刻收拍（新的一拍从这条段开始）。
    if (crossesChapter || crossesPov) flush()
    if (!bucket.length) {
      bucketChapter = chapter
      bucketPov = pov
    }
    // 规则 5：单条就超过目标长度 → 自成拍。
    // 先把已经攒着的短段收掉：否则「短段＋超长段」会粘成一拍，短段等于被动吞进别人的拍里。
    if (size >= targetChars) {
      if (bucket.length) {
        flush()
        bucketChapter = chapter
        bucketPov = pov
      }
      bucket.push(entry)
      bucketChars += size
      flush()
      continue
    }
    bucket.push(entry)
    bucketChars += size
    // 规则 3：够长了就收——但若还没到下限，继续吃下一段。
    if (bucketChars >= targetChars && bucketChars >= minBeatChars) flush()
  }
  flush()

  const sizes = nodes.map((node) => node.chars)
  const chapters = new Set(spans.map((span) => span.chapter))
  return {
    ok: true,
    version: ALIGN_VERSION,
    nodes,
    spans,
    counts: {
      entries: candidates.length,
      skipped: source.filter((entry) => entry.layer === 'plot').length - candidates.length,
      beats: nodes.length,
      chapters: chapters.size,
      targetChars,
      minBeatChars,
      avgBeatChars: nodes.length ? Math.round(sizes.reduce((sum, value) => sum + value, 0) / nodes.length) : 0,
      minBeatCharsActual: sizes.length ? Math.min(...sizes) : 0,
      maxBeatCharsActual: sizes.length ? Math.max(...sizes) : 0
    },
    warnings
  }
}

/**
 * 反向核对：拍序列是否忠实覆盖了源条目（一条不丢、一条不重）。
 * 用于抽取→对齐→成书这条链的验收，也用于作者改了段之后确认没有静默丢数据。
 */
export function verifyAlignment(entries, alignment) {
  const source = (Array.isArray(entries) ? entries : [])
    .filter((entry) => isPlainObject(entry) && entry.layer === 'plot' && !(entry.hypothesis === true && entry.open === true))
    .map((entry) => str(entry.id))
  const covered = []
  for (const span of Array.isArray(alignment?.spans) ? alignment.spans : []) {
    for (const id of Array.isArray(span.entryIds) ? span.entryIds : []) covered.push(id)
  }
  const coveredSet = new Set(covered)
  const sourceSet = new Set(source)
  const missing = source.filter((id) => !coveredSet.has(id))
  const duplicated = [...new Set(covered.filter((id, index) => covered.indexOf(id) !== index))]
  const unknown = covered.filter((id) => !sourceSet.has(id))
  return {
    ok: missing.length === 0 && duplicated.length === 0 && unknown.length === 0,
    counts: { source: source.length, covered: covered.length, beats: alignment?.nodes?.length ?? 0 },
    missing,
    duplicated,
    unknown
  }
}
