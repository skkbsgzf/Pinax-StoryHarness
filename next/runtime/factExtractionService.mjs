import { mkdir, readFile, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFileAtomic } from '../fs/atomicWrite.mjs'
import { assertNoSymlinkEscape, isSameProjectRoot } from '../fs/projectPath.mjs'
import { segmentText } from '../fact/domain/segment.js'
import { validateProduces } from '../fact/usecases/skillContract.js'
import { SKILL_CONTRACTS } from '../skills/contracts.mjs'
import { sha1Hex } from '../fact/domain/stableId.js'
import { buildExtractionSource, validateExtractionRows, compileExtractionEntries, buildIndex, EXTRACTION_CHAIN_VERSION } from '../fact/usecases/pipeline/extractionChain.js'
import { buildEnvelopeFacts, buildSegmentIndex, leanDatasetEntries, normalizeDatasetEntries, LEAN_FORMAT } from '../fact/usecases/pipeline/leanEntries.js'
import { consolidateEntries } from '../fact/usecases/pipeline/consolidate.js'
import {
  CACHE_TIER_VERSION, buildKnowledgeMap, normalizeFlushPolicy, planFlush, workingLevel
} from '../fact/usecases/pipeline/cacheTier.js'
import { checkConsistency } from '../fact/usecases/consistency.js'
import { segmentBlocks } from '../fact/usecases/pipeline/blocks.js'
import { bindSegment, resolveSegmentId } from '../fact/usecases/pipeline/bindRows.js'
import {
  normalizeExtractionProfile, saliencePolicyOf, flushPolicyOf, profileDigest, DEFAULT_EXTRACTION_PROFILE
} from '../fact/usecases/pipeline/extractionProfile.js'

// 派生数据与作者 FactStore 分开：finish 发布待审快照，不采纳、不写正文/世界书。
// 一个 dataset 一份原子文件，包含已发布快照和运行断点，避免“两文件只写成一半”。
// v2 起 current.entries 落瘦条目（P-TRIM Track 1，见 leanEntries.js）：落盘瘦、读时归一，
// v1 文件（current.entries 全形状）照常可读——不迁移存量，读时归一就是兼容层。
const SCHEMA = 'pinax-extraction-dataset/v2'
const LEGACY_SCHEMAS = ['pinax-extraction-dataset/v1']
const RESULT_CHARS = 6400 // 为 MCP 信封留余量，小于 toolLoop 的 7200 字符传输上限。
const validKey = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(value)
const fail = (code, message, details = null) => ({ ok: false, error: { code, message, details } })
const ok = (value) => ({ ok: true, value })
const reject = (code, message, details) => { throw Object.assign(new Error(message), { code, details }) }
function compile(input) {
  // v3 瘦编译（作者 2026-11-11 裁定升 v3）：只做减法——不生成 fact / events[].title
  // （两者都能从 events 确定性重建）。v3 契约一律 minimal，读方按 events 回退。
  const output = compileExtractionEntries({ ...input, minimal: true, sources: input.sources.map(({ id, chapterNo, hash, segments }) => ({ id, chapterNo, hash, segments })) })
  const checked = validateProduces(SKILL_CONTRACTS['fact-extract'], output.entries)
  if (!checked.ok) reject('INVALID_EXTRACTION', '抽取产物未通过Skill契约。', checked.errors)
  return output
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}
const digest = (value) => sha1Hex(JSON.stringify(canonical(value)))
const allSegments = (run) => run.sources.flatMap((source) => source.segments)
const pending = (run) => allSegments(run).filter((segment) => !Object.hasOwn(run.rows, segment.id))
function summary(state, run) {
  return {
    dataset: state.dataset, datasetRevision: state.revision, runId: run.id, revision: run.revision,
    state: run.finished ? 'finished' : 'running', phase: pending(run).length ? 'extract' : 'ready',
    sources: run.sources.length, segments: allSegments(run).length, extracted: Object.keys(run.rows).length,
    reusedSources: run.reusedSources, removedSources: run.removedSources.length,
    submissions: Object.keys(run.receipts).length, usage: null,
    costNote: '工具内部模型调用为0；外层模型用量由运行时usage报告，不能由工具次数换算。',
    resultPath: `.pinax/extractions/${state.dataset}.json`
  }
}
function page(items, offset = 0, envelope = {}) {
  const result = { ...envelope, items: [], total: items.length, nextOffset: null }
  for (let index = offset; index < items.length; index += 1) {
    const candidate = { ...result, items: [...result.items, items[index]], nextOffset: index + 1 < items.length ? index + 1 : null }
    if (JSON.stringify(candidate).length > RESULT_CHARS) {
      if (!result.items.length) reject('RESULT_TOO_LARGE', '单项摘要超过传输上限；请用按ID读取口。')
      result.nextOffset = index
      break
    }
    Object.assign(result, candidate)
  }
  return result
}

export function createFactExtractionService({ root = null, fileService = null, registry = null, view = null } = {}) {
  function requireProject() {
    if (!root || !fileService?.readRange || !isSameProjectRoot(root, fileService.root)) {
      reject('PROJECT_UNAVAILABLE', '抽取需要当前项目及其文件服务；不能从任意绝对路径读稿。')
    }
  }
  async function safePath(dataset) {
    requireProject()
    if (!validKey(dataset)) reject('INVALID_INPUT', 'dataset须为1–80位字母、数字、下划线或连字符。')
    const target = join(root, '.pinax', 'extractions', `${dataset}.json`)
    const safe = await assertNoSymlinkEscape(root, target)
    if (!safe.ok) reject(safe.error.code, safe.error.message)
    return target
  }
  async function load(dataset) {
    const target = await safePath(dataset)
    let text
    try { text = await readFile(target, 'utf8') } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    let state
    try { state = JSON.parse(text) } catch { reject('CHECKPOINT_CORRUPT', '抽取断点不是合法JSON；保留现场，不自动清空重抽。') }
    if (!state || ![SCHEMA, ...LEGACY_SCHEMAS].includes(state.schema) || state.dataset !== dataset || !state.runs || !Number.isInteger(state.revision)) {
      reject('CHECKPOINT_CORRUPT', '抽取断点结构不匹配；保留现场。')
    }
    // 读时归一（P-TRIM Track 1）：v2 的 current.entries 是瘦条目，归一回全形状后进内存——
    // 本服务内所有消费方（finish 对账／check／status view）拿到的永远是 fact.data/v2 全形状；
    // v1 文件（条目自带 schema）原样过。归一只在 load 这一层，不散在消费点。
    if (state.current?.entries) {
      const envelope = buildEnvelopeFacts(state.current.entries, state.current.spec ?? {}, {
        mode: state.current.mode, extractor: state.current.extractor
      })
      const segIndex = buildSegmentIndex(state.current.sources)
      state.current.entries = normalizeDatasetEntries(state.current.entries, envelope, segIndex)
    }
    return state
  }
  function persist(state) {
    // 落盘前瘦化（write 侧统一出口）：current.entries → lean；信封补 v2 常量段。
    // prepare/submit 只动 runs；只有 current 存在时才有条目要瘦。
    if (state.current?.entries) {
      const envelope = buildEnvelopeFacts(state.current.entries, state.current.spec ?? {}, {
        mode: 'analyze', extractor: state.current.version ?? EXTRACTION_CHAIN_VERSION
      })
      state.current.mode = envelope.mode
      state.current.extractor = envelope.extractor
      state.current.statusByLayer = envelope.statusByLayer
      state.current.entriesFormat = LEAN_FORMAT
      state.current.entries = leanDatasetEntries(state.current.entries, envelope)
    }
    state.schema = SCHEMA
    return state
  }
  async function write(dataset, action) {
    const target = await safePath(dataset)
    // 跨实例/进程互斥；不自动抢过陈旧锁。崩溃遗留锁需人工核实，不可能因此双写。
    await mkdir(join(root, '.pinax', 'extractions'), { recursive: true })
    const lockPath = `${target}.lock`
    const safe = await assertNoSymlinkEscape(root, lockPath)
    if (!safe.ok) reject(safe.error.code, safe.error.message)
    let lock
    try { lock = await open(lockPath, 'wx') } catch (error) {
      if (error.code === 'EEXIST') reject('EXTRACTION_BUSY', '该数据集正被写入或留有中断锁。停止重试；确认没有写进程后再处理锁。')
      throw error
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
      const state = await load(dataset)
      const result = await action(state)
      if (result.state) await writeFileAtomic(target, JSON.stringify(persist(result.state)))
      return ok(result.value)
    } finally { await lock.close(); await unlink(lockPath) }
  }
  async function readSource(ref, segmentLimits = undefined) {
    if (!ref || !['pluginId', 'dir', 'file'].every((key) => typeof ref[key] === 'string' && ref[key].trim()) || !Number.isInteger(ref.chapterNo) || ref.chapterNo < 1) {
      reject('INVALID_INPUT', '每份源须带pluginId、dir、file与正整数chapterNo。')
    }
    if (view?.enabled && !view.enabled.includes(ref.pluginId)) reject('SOURCE_NOT_ENABLED', '源板块未在当前项目启用。')
    const result = await fileService.readRange({ pluginId: ref.pluginId, dir: ref.dir, file: ref.file, from: 0, to: Number.MAX_SAFE_INTEGER })
    if (!result.ok) reject(result.error.code, result.error.message, result.error.details)
    const id = result.value.relativePath.replaceAll('\\', '/')
    // 分段档位在建来源时定死（段 id 由分段结果算出）：run 内不换档，避免 id 漂移。
    const source = buildExtractionSource({ id, text: result.value.text, chapterNo: ref.chapterNo, segment: segmentLimits })
    source.ref = { pluginId: ref.pluginId, dir: ref.dir, file: ref.file, chapterNo: ref.chapterNo }
    return { source, text: result.value.text }
  }
  async function verifySources(run, ids = null) {
    const texts = new Map()
    for (const source of run.sources) {
      if (ids && !ids.includes(source.id)) continue
      // 校验也按 run 的档位重新分段：否则段 id 会与建来源时算出的不一致，误报 SOURCE_STALE。
      const live = await readSource(source.ref, run.spec.profile?.segment)
      if (live.source.id !== source.id || live.source.hash !== source.hash) reject('SOURCE_STALE', '原稿已变化；本次提交不生效。用update准备新运行，不续交旧稿结果。', { sourceId: source.id })
      texts.set(source.id, live.text)
    }
    return texts
  }
  function getRun(state, runId) {
    if (!state) reject('DATASET_NOT_FOUND', '尚未建立该数据集。')
    if (!validKey(runId) || !Object.hasOwn(state.runs, runId)) reject('RUN_NOT_FOUND', '找不到这个runId；先用status查看断点。')
    const run = state.runs[runId]
    if (run.version !== EXTRACTION_CHAIN_VERSION) reject('CHAIN_VERSION_CHANGED', '抽取契约版本已变化；用update重新准备，不复用旧格式。')
    return run
  }
  async function nextTask(state, run) {
    if (run.finished) return { ...summary(state, run), done: true }
    // 单轮扫描：只派未抽取的段；抽完即 ready，没有第二轮复核。
    const candidates = pending(run)
    const phase = 'extract'
    if (!candidates.length) return { ...summary(state, run), done: true, phase: 'ready' }
    const source = run.sources.find((item) => item.segments.some((unit) => unit.id === candidates[0].id))
    const texts = await verifySources(run, [source.id])
    // 分段也走档位（非虚构要长段、剧本要短段）——这里只影响派发时的块切分视图；
    // source.segments 的 id 由 buildExtractionSource 在 prepare 时按当时档位算定，不在此漂移。
    const segments = segmentText(texts.get(source.id), run.spec.profile?.segment ?? {})
    // P-1：下一批直接**带上切好的块**（零模型），模型只需给 {id,who,ch} 绑定。
    // 这就是「LLM 只做机械流水线」在产品链路上的落点：agent 不再自己判批、自己切句、自己写事件文本。
    const knownNames = Array.isArray(run.nameTable) ? run.nameTable : []
    const batchChars = run.spec.profile?.bind?.batchChars ?? run.batchChars
    const task = {
      dataset: state.dataset, runId: run.id, revision: run.revision, phase,
      taskId: '', source: { id: source.id, chapterNo: source.chapterNo },
      units: [], knownNames: []
    }
    const candidateIds = new Set(candidates.map((item) => item.id))
    let chars = 0
    for (const meta of source.segments.filter((item) => candidateIds.has(item.id))) {
      if (task.units.length && chars + meta.chars > batchChars) break
      const text = segments.find((item) => item.index === meta.index).text
      const { blocks } = segmentBlocks(text, { knownNames, ...(run.spec.profile?.blocks ?? {}) })
      const unit = { id: meta.id, index: meta.index, chars: meta.chars, text, blocks: blocks.map((block) => ({
        id: block.id, kind: block.kind, text: block.text,
        hint: block.channelHint, speakerHint: block.speakerHint ?? null
      })) }
      if (JSON.stringify({ ...task, units: [...task.units, unit] }).length > RESULT_CHARS - 100) break
      task.units.push(unit)
      chars += meta.chars
    }
    // B1 预筛（ADR §5.2）：名表不下发全量——只下发**在本批段文本里字面出现**的名字。
    // 长篇名表可能上千，全量下发既挤爆预算也稀释注意力；而模型绑定只需要「这一段里可能的人」。
    // 命中数上限仍保留（防极端长段），但那是防御性上限，不是规模开关。
    const batchText = task.units.map((unit) => unit.text).join('\n')
    task.knownNames = knownNames
      .filter((name) => name && batchText.includes(name))
      .slice(0, 60)
    if (!task.units.length) reject('RESULT_TOO_LARGE', '当前单元超出回包上限，未截断、未标成已读。')
    task.taskId = digest({ runId: run.id, revision: run.revision, phase, ids: task.units.map((item) => item.id) })
    return task
  }

  const methods = {
    async prepare(args) {
      const { dataset, requestId, mode = 'initialize' } = args
      if (!validKey(requestId) || !['initialize', 'update', 'repair'].includes(mode)) reject('INVALID_INPUT', 'prepare需要requestId和合法mode。恢复用next(runId)，不要重新初始化。')
      if (args.batchChars !== undefined && (!Number.isInteger(args.batchChars) || args.batchChars < 300 || args.batchChars > 12000)) reject('INVALID_INPUT', 'batchChars为300–12000的显式传输参数，不是质量门槛。')
      const requestHash = digest(args)
      return write(dataset, async (stored) => {
        const state = stored ?? { schema: SCHEMA, dataset, revision: 0, current: null, runs: {} }
        const replay = Object.values(state.runs).find((run) => run.requestId === requestId)
        if (replay) {
          if (replay.requestHash !== requestHash) reject('IDEMPOTENCY_CONFLICT', '同一个requestId不能换参数。')
          return { value: { ...summary(state, replay), duplicate: true } }
        }
        if (mode === 'initialize' && state.current) reject('DATASET_EXISTS', '已有快照；请用update，不清空存量。')
        const baseline = args.fromRunId ? getRun(state, args.fromRunId) : state.current
        if (args.fromRunId && baseline.baseRevision !== state.revision) reject('DATASET_CONFLICT', '旧运行的基线已过时，请从已发布快照update。')
        if (mode !== 'initialize' && !baseline) reject('DATASET_NOT_FOUND', '没有已完成基线；恢复用原runId，原稿变更可用update加fromRunId。')
        const spec = baseline?.spec ?? { domain: args.domain, book: args.book, bookId: args.bookId ?? dataset }
        // 抽取档位（作者 2026-11-11「不同体裁采集节奏不一样，参数化」）：
        // 首次运行写进 spec 固化——同一 run 内不改档（改档等于换采集口径，应另起 dataset）。
        if (!spec.profile) {
          const normalized = normalizeExtractionProfile(args.profile ?? DEFAULT_EXTRACTION_PROFILE)
          if (!normalized.ok) reject(normalized.error.code, '抽取档位无效', normalized.error.details)
          spec.profile = normalized.value
        } else if (args.profile !== undefined) {
          const normalized = normalizeExtractionProfile(args.profile)
          if (!normalized.ok) reject(normalized.error.code, '抽取档位无效', normalized.error.details)
          if (digest(normalized.value) !== digest(spec.profile)) reject('PROFILE_CHANGED', '同一数据集不能改抽取档位；另建 dataset。', { current: profileDigest(spec.profile) })
        }
        if (typeof spec.domain !== 'string' || !spec.domain.trim() || typeof spec.book !== 'string' || !spec.book.trim()) reject('INVALID_INPUT', '首次抽取须给domain和book。')
        if (baseline && ['domain', 'book', 'bookId'].some((key) => args[key] !== undefined && args[key] !== spec[key])) reject('DATASET_IDENTITY_CHANGED', '更新不能静默改书名/domain/bookId；另建数据集。')
        const refs = args.sources ?? baseline?.sources.map((source) => source.ref)
        if (!Array.isArray(refs) || !refs.length) reject('INVALID_INPUT', '需要非空sources清单；update传入的清单代表完整范围，不是新增项列表。')
        const sources = []
        // 档位已在上面写进 spec：建来源时就要用它分段（段 id 由分段结果算出，之后不能再变）。
        const segmentLimits = spec.profile?.segment
        for (const ref of refs) sources.push((await readSource(ref, segmentLimits)).source)
        if (new Set(sources.map((source) => source.id)).size !== sources.length) reject('INVALID_INPUT', 'sources含重复路径。')
        const targets = args.sourceIds ?? []
        if (mode === 'repair' && (!targets.length || targets.some((id) => !sources.some((source) => source.id === id)))) reject('INVALID_INPUT', 'repair须点名存在的sourceIds。')
        const rows = {}; let reusedSources = 0
        for (const source of sources) {
          const old = baseline?.sources.find((item) => item.id === source.id)
          if (mode === 'repair' && !targets.includes(source.id) && (old?.hash !== source.hash || old?.chapterNo !== source.chapterNo)) reject('SOURCE_STALE', '非补抽目标原稿已变化；请用update显式更新整个范围。', { sourceId: source.id })
          if (baseline?.version === EXTRACTION_CHAIN_VERSION && old?.hash === source.hash && old.chapterNo === source.chapterNo && !targets.includes(source.id)) {
            for (const segment of source.segments) {
              const row = baseline.rows[segment.id]
              if (row) rows[segment.id] = row // 存量复用：单轮模式下已抽行直接沿用，不再等复核
            }
            reusedSources += 1
          }
        }
        const id = randomUUID()
        const run = { id, requestId, requestHash, version: EXTRACTION_CHAIN_VERSION, revision: 1, baseRevision: state.revision, spec, sources, rows, reusedSources,
          removedSources: (state.current?.sources ?? []).filter((old) => !sources.some((source) => source.id === old.id)).map((source) => source.id),
          receipts: {}, batchChars: args.batchChars ?? 3600, finished: false,
          // P-3/P-4：跨批累积名表（供切块器找说话人）与 run 级时间地点默认值（段级可覆盖）。
          nameTable: [],
          timeDefaults: { when: args.timeDefaults?.when ?? null, where: args.timeDefaults?.where ?? null } }
        state.runs[id] = run
        return { state, value: summary(state, run) }
      })
    },
    async next({ dataset, runId }) {
      const state = await load(dataset)
      return ok(await nextTask(state, getRun(state, runId)))
    },
    async submit(args) {
      return write(args.dataset, async (state) => {
        const run = getRun(state, args.runId)
        if (!validKey(args.submissionId)) reject('INVALID_INPUT', 'submit需要稳定submissionId；同一载荷重试沿用，不换号。')
        const hash = digest(args)
        const replay = Object.hasOwn(run.receipts, args.submissionId) ? run.receipts[args.submissionId] : null
        if (replay) {
          if (replay !== hash) reject('IDEMPOTENCY_CONFLICT', '同一submissionId的内容不同。')
          return { value: { ...summary(state, run), duplicate: true } }
        }
        if (run.finished) reject('RUN_FINISHED', '该运行已完成，不能再提交。')
        if (run.revision !== args.expectedRevision) reject('STALE_REVISION', '断点版本已变化；先next读取最新任务。', { actual: run.revision })
        const task = await nextTask(state, run)
        // 关系窄窗（B4）：关系必须单独一轮问——真跑实测主绑定从不在同一次请求里产关系（0/130 段），
        // 但单独问就很好（7 条/段）。这一形态只补关系、不推进抽取进度，所以 taskId 允许留空。
        if (args.relationsOnly) {
          const ids = Array.isArray(args.segmentIds) ? args.segmentIds : []
          if (!ids.length) reject('INVALID_INPUT', 'relationsOnly 需要 segmentIds。')
          if (run.revision !== args.expectedRevision) reject('STALE_REVISION', '断点版本已变化。', { actual: run.revision })
          const applied = []
          const dropped = { missing: 0, hallucinated: 0, self: 0, titleTarget: 0 }
          for (const id of ids) {
            const row = run.rows[id]
            if (!row) { dropped.missing += 1; continue }
            const source = run.sources.find((item) => item.segments.some((segment) => segment.id === id))
            if (!source) { dropped.missing += 1; continue }
            const texts = await verifySources(run, [source.id])
            const parsed = segmentText(texts.get(source.id), run.spec.profile?.segment ?? {})
            const meta = source.segments.find((segment) => segment.id === id)
            const text = parsed.find((item) => item.index === meta.index)?.text ?? ''
            const { blocks } = segmentBlocks(text, { knownNames: run.nameTable ?? [], ...(run.spec.profile?.blocks ?? {}) })
            const provided = (args.relationsBySegment && typeof args.relationsBySegment === 'object') ? args.relationsBySegment[id] : null
            const { row: cleaned, stats } = bindSegment(
              { id, index: meta.index, chars: meta.chars, text, blocks },
              { id, relations: Array.isArray(provided) ? provided : [] },
              { knownNames: run.nameTable ?? [] }
            )
            for (const key of Object.keys(dropped)) dropped[key] += stats.relationDropped?.[key] ?? 0
            if (cleaned.relations.length) {
              run.rows = { ...run.rows, [id]: { ...row, relations: cleaned.relations } }
              applied.push(id)
            }
          }
          compile({ sources: run.sources, rows: Object.values(run.rows), ...run.spec, policy: saliencePolicyOf(run.spec.profile) })
          run.receipts[args.submissionId] = hash
          run.revision += 1
          return { state, value: { ...summary(state, run), relationsOnly: true, applied: applied.length, relationDropped: dropped } }
        }
        if (task.done || task.taskId !== args.taskId) reject('TASK_STALE', 'taskId不属于当前批次。')
        const ids = task.units.map((unit) => unit.id)
        // 双形态提交（P-1）：rows＝完整行（兼容既有用法）；bindings＝窄绑定（服务端零模型回组装）。
        // 两者可同时给：bindings 先按段回组装，rows 再覆盖同段（便于「绑定没好的一两段手工补」）。
        const hasBindings = Array.isArray(args.bindings) && args.bindings.length > 0
        if (!args.relationsOnly && !hasBindings && !Array.isArray(args.rows)) reject('INVALID_INPUT', 'submit需要rows或bindings之一（或 relationsOnly）。')
        const assembled = []
        const bindStats = { segments: 0, blocks: 0, bound: 0, hallucinated: 0, ruleFallback: 0, unknownChannel: 0, akaPairs: 0 }
        if (hasBindings) {
          // 段 id 容错对齐：模型会改写 id（排版前缀／唯一前缀截断／改用「第N段」序号）。
          // 四种可确定性还原的形态在 resolveSegmentId 里抹平；对不上才走规则兜底。
          const matchable = task.units.map((unit) => ({ id: unit.id, index: unit.index }))
          const byId = new Map()
          let unmatchedBindings = 0
          for (const item of args.bindings) {
            if (!item || typeof item !== 'object') continue
            const resolved = resolveSegmentId(item.id, matchable)
            if (resolved) byId.set(resolved, item)
            else unmatchedBindings += 1
          }
          for (const unit of task.units) {
            const { row, stats } = bindSegment(unit, byId.get(unit.id) ?? {}, {
              knownNames: [...(task.knownNames ?? []), ...run.nameTable ?? []],
              when: run.timeDefaults?.when,
              where: run.timeDefaults?.where,
              limits: run.spec.profile?.bind?.maxIncrementsPerSegment
            })
            assembled.push(row)
            bindStats.segments += 1
            bindStats.blocks += stats.blocks
            bindStats.bound += stats.bound
            bindStats.hallucinated += stats.hallucinated
            bindStats.ruleFallback += stats.ruleFallback
            bindStats.unknownChannel += stats.unknownChannel
            bindStats.akaPairs += stats.akaPairs
            bindStats.relations = (bindStats.relations ?? 0) + (stats.relations ?? 0)
          }
          // 对齐失败的绑定数要暴露出来——静默降级会让「模型没回绑定」看起来像「抽了但没主体」。
          bindStats.unmatchedBindings = unmatchedBindings
          if (!assembled.length) reject('EMPTY_SUBMISSION', 'bindings里没有可对齐的段。')
        }
        // rows 显式覆盖同段：先按段号合并（bindings 产物在前、rows 在后），再交校验——
        // 否则同一段两份行会让校验如实报「重复段」，而用户的意图明明是「这段我手工补」。
        const submitted = new Map()
        for (const row of assembled) submitted.set(row.segmentId, row)
        for (const row of Array.isArray(args.rows) ? args.rows : []) {
          const id = row && typeof row === 'object' ? row.segmentId : null
          if (typeof id === 'string') submitted.set(id, row)
          else submitted.set(`__unkeyed_${submitted.size}`, row) // 无段号的行交回校验如实拒
        }
        const check = validateExtractionRows([...submitted.values()],
          allSegments(run).filter((unit) => ids.includes(unit.id)))
        if (!check.ok) reject(check.error.code, check.error.message, check.error.details)
        const corrected = check.value.map((row) => row.segmentId)
        if (!corrected.length) reject('EMPTY_SUBMISSION', '未交任何结果，不推进断点。')
        // 在保存链路上构造并校验三层产物；非法结果在这里拒绝，不留到finish才爆炸。
        const merged = { ...run.rows, ...Object.fromEntries(check.value.map((row) => [row.segmentId, row])) }
        // 编译策略（作者 2026-11-11 规模裁定）：
        //   full       —— 每次 submit 全量重算（短篇/中篇足够；最简单、无状态）；
        //   incremental —— 只在「周期性校正」与 finish 时全量算，平时跳过。
        // 长篇全量重算的成本实测是线性的：4000 段 ≈533ms/次 × 334 次 submit ≈178 秒纯 CPU。
        // 跳过是安全的：行级校验已在上面做完，编译产物只在 finish 发布时被消费；
        // 中途 status(view:entries) 读的是上一次快照（如实标注，不假装实时）。
        const compileStrategy = run.spec.profile?.scale?.compileStrategy ?? 'full'
        const every = run.spec.profile?.scale?.fullRecompileEvery ?? 20
        run.submitCount = (run.submitCount ?? 0) + 1
        const mustCompile = compileStrategy === 'full' || run.submitCount % every === 0
        if (mustCompile) {
          compile({ sources: run.sources, rows: Object.values(merged), ...run.spec, policy: saliencePolicyOf(run.spec.profile) })
        }
        run.rows = merged
        run.receipts[args.submissionId] = hash
        // P-3：跨批名表累积（只增名，不带证据）——下一批的切块器能立刻用它找说话人。
        if (hasBindings) {
          run.nameTable = [...new Set([...(run.nameTable ?? []), ...corrected.flatMap((id) => merged[id]?.who ?? [])])]
        }
        run.revision += 1
        return { state, value: { ...summary(state, run), ...(hasBindings ? { bindStats } : {}) } }
      })
    },
    async finish({ dataset, runId, expectedRevision, flushPolicy }) {
      return write(dataset, async (state) => {
        const run = getRun(state, runId)
        if (run.finished) return { value: { ...summary(state, run), duplicate: true } }
        if (run.revision !== expectedRevision) reject('STALE_REVISION', '断点版本已变化。')
        if (pending(run).length) reject('INCOMPLETE_COVERAGE', '还有未抽取的单元；不能用计数自报完整。', { pending: pending(run).length })
        if (state.revision !== run.baseRevision) reject('DATASET_CONFLICT', '另一运行已发布新版；用update重新对齐基线。')
        await verifySources(run)
        const output = compile({ sources: run.sources, rows: Object.values(run.rows), ...run.spec, policy: saliencePolicyOf(run.spec.profile) })
        // P-TRIM Track 3（T-1.5）：批后巩固——编译产物折进已发布快照（命中即合并），不再整表替换。
        // 纯确定性零模型（B8）；id/L0 别名/L1 词法三级匹配，fold 语义见 consolidate.js。
        const existingEntries = state.current?.entries ?? []
        const segmentChars = new Map()
        for (const source of [...(state.current?.sources ?? []), ...run.sources]) {
          for (const segment of source.segments ?? []) segmentChars.set(segment.id, segment.chars)
        }
        const fold = consolidateEntries(existingEntries, output.entries, { segmentChars })
        const existingIds = new Map(existingEntries.map((entry) => [entry.id, JSON.stringify(entry)]))
        const afterById = new Map(fold.entries.map((entry) => [entry.id, JSON.stringify(entry)]))
        const changed = []
        const mergedRecords = []
        const seenChange = new Set()
        for (const assignment of fold.assignments) {
          const { incomingId, targetId } = assignment
          const wasExisting = existingIds.has(targetId)
          const changedContent = wasExisting && existingIds.get(targetId) !== afterById.get(targetId)
          if (!wasExisting) {
            if (!seenChange.has(`added|${targetId}`)) { seenChange.add(`added|${targetId}`); changed.push({ id: targetId, kind: 'added' }) }
          } else if (changedContent && !seenChange.has(`changed|${targetId}`)) {
            seenChange.add(`changed|${targetId}`)
            changed.push({ id: targetId, kind: 'changed' })
          }
          if (incomingId !== targetId && !seenChange.has(`merged|${incomingId}`)) {
            seenChange.add(`merged|${incomingId}`)
            mergedRecords.push({ id: incomingId, kind: 'merged', into: targetId, matchedBy: assignment.matchedBy, action: 'review-only' })
          }
        }
        // removed＝既有条目的来源**全部**不在新范围内（整表替换语义的等价物）——
        // 未命中但来源在范围内的条目由 fold 原样保留（L1 歧义等场景不越权删）。
        const inRange = new Set(run.sources.map((source) => source.id))
        const removedIds = new Set(
          existingEntries
            .filter((entry) => {
              const refs = Array.isArray(entry.sources) ? entry.sources : []
              return refs.length > 0 && !refs.some((ref) => inRange.has(ref.sourceId))
            })
            .map((entry) => entry.id)
        )
        const removed = existingEntries.filter((entry) => removedIds.has(entry.id)).map((entry) => ({ id: entry.id, kind: 'source-removed', action: 'review-only' }))
        const finalEntries = fold.entries.filter((entry) => !removedIds.has(entry.id))

        // P-TRIM Track 4（作者 2026-11-11 缓存池裁定）：archive＝RAG 硬存储（SSD），current.entries＝working（DDR）。
        // working 达水位就把这一批**折进 archive**（命中即合并，复用 consolidate），working 只留最近一章接续，
        // 并产出 knowledgeMap（archive 的词法索引，供字面命中检索）。不达水位则全部留在 working。
        // 档位里给了缓存水位就以它为底，显式 flushPolicy 仍可临时覆写（运维调参口）。
        const lockPolicy = normalizeFlushPolicy({ ...(flushPolicyOf(run.spec.profile) ?? {}), ...(flushPolicy ?? {}) })
        const mergedWorking = finalEntries // 本 run 的产物先进 working
        const level = workingLevel(mergedWorking, lockPolicy)
        const archiveBefore = Array.isArray(state.archive?.entries) ? state.archive.entries : []
        let archiveAfter = archiveBefore
        let working = mergedWorking
        let flushReport = null
        if (level.shouldFlush) {
          const plan = planFlush({ working: mergedWorking, policy: lockPolicy })
          // archive ← 本批下沉条目（命中即合并，与 run 内 fold 同一套语义）
          const archiveSegChars = new Map()
          for (const source of [...(state.archive?.sources ?? []), ...run.sources]) {
            for (const segment of source.segments ?? []) archiveSegChars.set(segment.id, segment.chars)
          }
          const archived = consolidateEntries(archiveBefore, plan.move, { segmentChars: archiveSegChars })
          archiveAfter = archived.entries
          working = plan.stay
          flushReport = {
            reason: plan.reason,
            moved: plan.move.length,
            stayed: plan.stay.length,
            consolidated: archived.stats,
            knowledgeMap: buildKnowledgeMap(archiveAfter).size
          }
        }

        state.revision += 1
        state.current = { version: EXTRACTION_CHAIN_VERSION, runId, revision: state.revision, spec: run.spec, sources: run.sources, rows: run.rows,
          entries: working, warnings: fold.warnings, index: buildIndex(working), changes: [...changed, ...mergedRecords, ...removed], removedSources: run.removedSources }
        // archive 单独一层：不随 working 清空，下一次检索/推演从这里取（不进 prompt 除非被检索窗口选中）
        state.archive = {
          version: EXTRACTION_CHAIN_VERSION,
          revision: state.revision,
          entries: archiveAfter,
          sources: [...(state.archive?.sources ?? []), ...run.sources.filter((source) => !(state.archive?.sources ?? []).some((old) => old.id === source.id))],
          knowledgeMap: buildKnowledgeMap(archiveAfter).size,
          flushes: [...(state.archive?.flushes ?? []), ...(flushReport ? [{ revision: state.revision, ...flushReport }] : [])]
        }
        state.cacheTier = { version: CACHE_TIER_VERSION, working: workingLevel(working, lockPolicy), archive: archiveAfter.length }
        run.finished = true
        run.revision += 1
        // entries 报**总量**（working＋archive）并拆开写清：只报 working 会让 10 章发布看起来
        // 只有 18 条（其余 137 条是达水位折进 archive 的，不是丢了）。
        return { state, value: { ...summary(state, run),
          entries: working.length + archiveAfter.length,
          entriesWorking: working.length,
          entriesArchive: archiveAfter.length,
          warnings: fold.warnings.length, changes: changed.length + mergedRecords.length + removed.length, index: buildIndex(working),
          consolidation: { ...fold.stats, version: fold.version }, cacheTier: { level: workingLevel(working, lockPolicy), archive: archiveAfter.length, flush: flushReport }, publication: 'draft-proposal-snapshot', adopted: 0, instruction: '用status(view:entries/entry/changes/warnings)读取完整成果；working 层是快层（进 prompt），archive 层是冷层（按检索取）。尚未写入作者事实库或自动采纳。' } }
      })
    },
    /** 一致性检测（工具名 pinax_fact_check）：对已发布快照整库过一遍（也可指定 runId 用该运行已交的行现场编译）。只读，不写断点。
     * 方法名与工具对齐为 fact_check——旧名 check 从未被任何调用方走过（guimi 轮测试实测：工具一直报「未知抽取操作」）。 */
    async fact_check(args) {
      const state = await load(args.dataset)
      if (!state) reject('DATASET_NOT_FOUND', '尚未建立该数据集。')
      let entries = state.current?.entries ?? []
      if (args.runId) {
        const run = getRun(state, args.runId)
        const output = compile({ sources: run.sources, rows: Object.values(run.rows), ...run.spec })
        entries = output.entries
      }
      if (!entries.length) reject('RESULT_NOT_READY', '没有可检测的条目：先 finish 发布快照，或带 runId 检测进行中的已完成行。')
      const report = checkConsistency(entries)
      const scope = args.scope ?? 'summary'
      if (scope === 'summary') {
        return ok({ dataset: args.dataset, revision: state.revision, runId: args.runId ?? state.current?.runId ?? null, ...report, conflicts: report.conflicts.slice(0, 20), warnings: report.warnings.slice(0, 20) })
      }
      return ok({ dataset: args.dataset, revision: state.revision, ...report })
    },
    async status(args) {
      requireProject()
      const kind = args.view ?? 'summary'
      const offset = args.offset ?? 0
      if (!Number.isSafeInteger(offset) || offset < 0) reject('INVALID_INPUT', 'offset须为非负整数。')
      if (kind === 'sources') {
        if (args.pluginId && args.dir) {
          const listed = await fileService.list({ pluginId: args.pluginId, dir: args.dir })
          if (!listed.ok) return listed
          return ok(page(listed.value.entries, offset, { pluginId: args.pluginId, dir: args.dir }))
        }
        const dirs = (view?.enabled ?? []).flatMap((pluginId) => Object.values(registry?.get?.(pluginId)?.dataDirs ?? {}).map((dir) => ({ pluginId, dir })))
        return ok(page(dirs, offset, { instruction: '传pluginId与dir继续列目录；prepare前明确完整源范围与chapterNo。' }))
      }
      const state = await load(args.dataset)
      if (!state) return ok({ dataset: args.dataset, exists: false })
      const run = args.runId ? getRun(state, args.runId) : null
      if (kind === 'summary') {
        // 档位随 summary 披露（只列与默认档不同的覆写）：作者一眼能确认自己的参数真的生效了。
        const digest = run?.spec?.profile ? profileDigest(run.spec.profile) : null
        return ok(run
          ? { ...summary(state, run), profile: digest }
          : page(Object.values(state.runs).map((item) => ({ runId: item.id, revision: item.revision, finished: item.finished, requestId: item.requestId })), offset, { dataset: state.dataset, revision: state.revision, entries: state.current?.entries.length ?? 0 }))
      }
      if (kind === 'row' || kind === 'entry') {
        const value = kind === 'row' ? (run?.rows ?? state.current?.rows)?.[args.id] : state.current?.entries.find((entry) => entry.id === args.id)
        if (!value) reject('RESULT_NOT_FOUND', '找不到该结果ID。')
        const text = JSON.stringify(value)
        const chunk = text.slice(offset, offset + 2400)
        return ok({ id: args.id, encoding: 'json-fragment', text: chunk, offset, nextOffset: offset + chunk.length < text.length ? offset + chunk.length : null, totalChars: text.length })
      }
      if (kind === 'manifest') return ok(page((run?.sources ?? state.current?.sources ?? []).map(({ id, hash, chapterNo, ref, segments }) => ({ id, hash, chapterNo, ref, segments: segments.length })), offset))
      const current = state.current
      if (!current) reject('RESULT_NOT_READY', '尚未finish发布快照；用runId查看断点。')
      if (kind === 'entries') return ok(page(current.entries.map(({ id, layer, name, status }) => ({ id, layer, name, status })), offset, { revision: current.revision }))
      if (kind === 'changes' || kind === 'warnings') return ok(page(current[kind], offset, { revision: current.revision }))
      if (kind === 'index') return ok({ revision: current.revision, ...current.index })
      // Track 4：冷层（archive＝RAG 硬存储）读口——working 之外的已 flush 条目，分页读
      if (kind === 'archive') {
        const archive = state.archive ?? { entries: [], knowledgeMap: 0, flushes: [] }
        return ok(page(archive.entries.map(({ id, layer, name, status }) => ({ id, layer, name, status })), offset, {
          revision: state.revision, total: archive.entries.length, knowledgeMap: archive.knowledgeMap, flushes: archive.flushes.length,
          cacheTier: state.cacheTier ?? null
        }))
      }
      reject('INVALID_INPUT', '不支持的status view。')
    }
  }
  return {
    async call(method, args = {}) {
      try {
        requireProject()
        if (!Object.hasOwn(methods, method)) reject('INVALID_INPUT', '未知抽取操作。')
        return await methods[method](args)
      } catch (error) { return fail(error.code ?? 'EXTRACTION_FAILED', String(error.message ?? error), error.details ?? null) }
    }
  }
}
