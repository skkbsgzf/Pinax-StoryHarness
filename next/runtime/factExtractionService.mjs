import { mkdir, readFile, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFileAtomic } from '../fs/atomicWrite.mjs'
import { assertNoSymlinkEscape, isSameProjectRoot } from '../fs/projectPath.mjs'
import { segmentText } from '../fact/domain/segment.js'
import { validateProduces } from '../fact/usecases/skillContract.js'
import { SKILL_CONTRACTS } from '../skills/contracts.mjs'
import { sha1Hex } from '../fact/domain/stableId.js'
import { buildExtractionSource, validateExtractionRows, compileExtractionEntries, EXTRACTION_CHAIN_VERSION } from '../fact/usecases/pipeline/extractionChain.js'
import { buildEnvelopeFacts, buildSegmentIndex, leanDatasetEntries, normalizeDatasetEntries, LEAN_FORMAT } from '../fact/usecases/pipeline/leanEntries.js'
import { checkConsistency } from '../fact/usecases/consistency.js'

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
  const output = compileExtractionEntries({ ...input, sources: input.sources.map(({ id, chapterNo, hash, segments }) => ({ id, chapterNo, hash, segments })) })
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
  async function readSource(ref) {
    if (!ref || !['pluginId', 'dir', 'file'].every((key) => typeof ref[key] === 'string' && ref[key].trim()) || !Number.isInteger(ref.chapterNo) || ref.chapterNo < 1) {
      reject('INVALID_INPUT', '每份源须带pluginId、dir、file与正整数chapterNo。')
    }
    if (view?.enabled && !view.enabled.includes(ref.pluginId)) reject('SOURCE_NOT_ENABLED', '源板块未在当前项目启用。')
    const result = await fileService.readRange({ pluginId: ref.pluginId, dir: ref.dir, file: ref.file, from: 0, to: Number.MAX_SAFE_INTEGER })
    if (!result.ok) reject(result.error.code, result.error.message, result.error.details)
    const id = result.value.relativePath.replaceAll('\\', '/')
    const source = buildExtractionSource({ id, text: result.value.text, chapterNo: ref.chapterNo })
    source.ref = { pluginId: ref.pluginId, dir: ref.dir, file: ref.file, chapterNo: ref.chapterNo }
    return { source, text: result.value.text }
  }
  async function verifySources(run, ids = null) {
    const texts = new Map()
    for (const source of run.sources) {
      if (ids && !ids.includes(source.id)) continue
      const live = await readSource(source.ref)
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
    const segments = segmentText(texts.get(source.id))
    const task = { dataset: state.dataset, runId: run.id, revision: run.revision, phase, taskId: '', source: { id: source.id, chapterNo: source.chapterNo }, units: [] }
    const candidateIds = new Set(candidates.map((item) => item.id))
    let chars = 0
    for (const meta of source.segments.filter((item) => candidateIds.has(item.id))) {
      if (task.units.length && chars + meta.chars > run.batchChars) break
      const unit = { id: meta.id, index: meta.index, chars: meta.chars, text: segments.find((item) => item.index === meta.index).text }
      if (JSON.stringify({ ...task, units: [...task.units, unit] }).length > RESULT_CHARS - 100) break
      task.units.push(unit)
      chars += meta.chars
    }
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
        if (typeof spec.domain !== 'string' || !spec.domain.trim() || typeof spec.book !== 'string' || !spec.book.trim()) reject('INVALID_INPUT', '首次抽取须给domain和book。')
        if (baseline && ['domain', 'book', 'bookId'].some((key) => args[key] !== undefined && args[key] !== spec[key])) reject('DATASET_IDENTITY_CHANGED', '更新不能静默改书名/domain/bookId；另建数据集。')
        const refs = args.sources ?? baseline?.sources.map((source) => source.ref)
        if (!Array.isArray(refs) || !refs.length) reject('INVALID_INPUT', '需要非空sources清单；update传入的清单代表完整范围，不是新增项列表。')
        const sources = []
        for (const ref of refs) sources.push((await readSource(ref)).source)
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
          receipts: {}, batchChars: args.batchChars ?? 3600, finished: false }
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
        if (task.done || task.taskId !== args.taskId) reject('TASK_STALE', 'taskId不属于当前批次。')
        const ids = task.units.map((unit) => unit.id)
        const check = validateExtractionRows(args.rows ?? [], allSegments(run).filter((unit) => ids.includes(unit.id)))
        if (!check.ok) reject(check.error.code, check.error.message, check.error.details)
        const corrected = check.value.map((row) => row.segmentId)
        if (!corrected.length) reject('EMPTY_SUBMISSION', '未交任何结果，不推进断点。')
        // 在保存链路上构造并校验三层产物；非法结果在这里拒绝，不留到finish才爆炸。
        const merged = { ...run.rows, ...Object.fromEntries(check.value.map((row) => [row.segmentId, row])) }
        compile({ sources: run.sources, rows: Object.values(merged), ...run.spec })
        run.rows = merged
        run.receipts[args.submissionId] = hash
        run.revision += 1
        return { state, value: summary(state, run) }
      })
    },
    async finish({ dataset, runId, expectedRevision }) {
      return write(dataset, async (state) => {
        const run = getRun(state, runId)
        if (run.finished) return { value: { ...summary(state, run), duplicate: true } }
        if (run.revision !== expectedRevision) reject('STALE_REVISION', '断点版本已变化。')
        if (pending(run).length) reject('INCOMPLETE_COVERAGE', '还有未抽取的单元；不能用计数自报完整。', { pending: pending(run).length })
        if (state.revision !== run.baseRevision) reject('DATASET_CONFLICT', '另一运行已发布新版；用update重新对齐基线。')
        await verifySources(run)
        const output = compile({ sources: run.sources, rows: Object.values(run.rows), ...run.spec })
        const oldEntries = state.current?.entries ?? []
        const changed = output.entries.filter((entry) => {
          const old = oldEntries.find((item) => item.id === entry.id)
          return !old || digest(old) !== digest(entry)
        }).map((entry) => ({ id: entry.id, kind: oldEntries.some((old) => old.id === entry.id) ? 'changed' : 'added' }))
        const removed = oldEntries.filter((entry) => !output.entries.some((item) => item.id === entry.id)).map((entry) => ({ id: entry.id, kind: 'source-removed', action: 'review-only' }))
        state.revision += 1
        state.current = { version: EXTRACTION_CHAIN_VERSION, runId, revision: state.revision, spec: run.spec, sources: run.sources, rows: run.rows,
          entries: output.entries, warnings: output.warnings, index: output.index, changes: [...changed, ...removed], removedSources: run.removedSources }
        run.finished = true
        run.revision += 1
        return { state, value: { ...summary(state, run), entries: output.entries.length, warnings: output.warnings.length, changes: changed.length + removed.length, index: output.index,
          publication: 'draft-proposal-snapshot', adopted: 0, instruction: '用status(view:entries/entry/changes/warnings)读取完整成果。尚未写入作者事实库或自动采纳。' } }
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
      if (kind === 'summary') return ok(run ? summary(state, run) : page(Object.values(state.runs).map((item) => ({ runId: item.id, revision: item.revision, finished: item.finished, requestId: item.requestId })), offset, { dataset: state.dataset, revision: state.revision, entries: state.current?.entries.length ?? 0 }))
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
