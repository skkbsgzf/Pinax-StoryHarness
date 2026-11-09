import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { readWorldbookEntries } from '../wikihub/build.mjs'
import { worldbookToHub } from '../wikihub/convert.mjs'
import { diffValidate, readOnlyQuery, suggestCompletion } from '../fact/usecases/hookEngine.js'
import {
  DRAFT_EXTRACTOR,
  WRITE_HOOK_REGISTRY,
  buildDraftEntriesProposal,
  buildSuggestionProposal,
  createWriteHookRegistry,
  draftEntryForEntity,
  filterMissingEntities
} from '../fact/usecases/hookWiring.js'
import { mineNamedEntities } from '../fact/usecases/pipeline/mine.js'
import { proposalFileName } from '../runtime/proposalStore.mjs'

/**
 * S3 hook 的宿主接线（只在主进程装配）。
 *
 * 为什么不在 ipcContract / 渲染层接：hub 快照要读「世界书/」（node:fs），提案要落
 * `.pinax/proposals/`（fileService）。ipcContract 在渲染层的依赖图上，把 fs／转换器拖进去
 * 等于让 renderer bundle 背整包 fact＋wikihub；所以这里沿用 skillsService／knowledgeService
 * 的同款做法——主进程建服务，通道只转调用。
 *
 * 三个 hook（与 fact/usecases/hookEngine.js 的 routes 同口径）：
 *   保存 → diffValidate（hub 快照 before/after ＋ 保存正文预检）＋ 内容管线的实体草案；
 *   续写 → suggestCompletion（只产出提案，不改正文）；
 *   润色 → readOnlyQuery（零写入）。
 *
 * F2 口径：实体识别走内容管线（保存文字 → 切段 → 候选），**不再扫 @《…》**；
 * 触发面由写工具注册表决定（host 注入 writeTools，表外加一行即接，新增写口自动覆盖）。
 *
 * 旁路铁律：钩子失败绝不让已经成功的保存／续写翻成失败；错误如实进服务通知池（warn）。
 * 开关：项目级 `.pinax/fact-hooks.json`，`{ "enabled": false }` 整体关，`hooks.onSave/onContinue/onPolish`
 * 单关；文件缺失或读不懂都按默认全开处理（只认显式 false，避免半截文件意外关掉能力）。
 * 旧档名 `.pinax/pedia-hooks.json` 仍被识别（新档缺失时只读回落，不改写）。
 */

export const FACT_HOOKS_SWITCH_FILE = '.pinax/fact-hooks.json'

export const LEGACY_FACT_HOOKS_SWITCH_FILE = '.pinax/pedia-hooks.json'

export const FACT_HOOK_NAMES = Object.freeze(['onSave', 'onContinue', 'onPolish'])

/** 与 writingActions 的闭集对齐：只有这两类动作各接一个 hook（测试会核对 id 仍存在）。 */
export const HOOKED_WRITING_ACTIONS = Object.freeze(['continue', 'polish'])

const SUGGESTION_PROPOSAL_MAX = 80

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function errorText(error) {
  return String(error?.message || error)
}

/** 只认显式 false：缺字段、坏类型都按「开着」处理。 */
export function normalizeFactHookSwitch(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const hooks = isPlainObject(source.hooks) ? source.hooks : {}
  return {
    enabled: source.enabled !== false,
    hooks: Object.fromEntries(FACT_HOOK_NAMES.map((name) => [name, hooks[name] !== false]))
  }
}

/**
 * @param {Object} deps
 * @param {() => string|null} [deps.getRoot] 当前项目根（与 session.projectRoot 同源）
 * @param {() => object|null} [deps.getFileService] 当前项目文件服务（writeProposal／提案查重）
 * @param {string[]} [deps.writeTools] 宿主侧写工具清单（kernel/carrier 落点表）；表外加一行即接
 * @param {Object|null} [deps.llmPort] 可选的模型口：注入后实体识别多一路 LLM 候选，失败隔离
 * @param {(input: object) => Promise<object>} [deps.mineEntities] 内容管线入口替换（测试注入）
 * @param {(path: string) => Promise<string>} [deps.readSwitchFile] 开关文件读取口（测试注入）
 * @param {(root: string) => Promise<{entries:Object[], book:string, note:string|null}>} [deps.snapshotHub]
 *        世界书 → hub 条目快照（默认现读「世界书/」转换，不写盘）
 * @param {(entry: object) => void} [deps.log] 服务通知池写入口
 * @param {() => Date} [deps.now]
 */
export function createFactHookService({
  getRoot = () => null,
  getFileService = () => null,
  writeTools = Object.keys(WRITE_HOOK_REGISTRY),
  llmPort = null,
  mineEntities = null,
  readSwitchFile = (path) => readFile(path, 'utf8'),
  snapshotHub = null,
  log = null,
  now = () => new Date()
} = {}) {
  const readSnapshot = typeof snapshotHub === 'function' ? snapshotHub : defaultSnapshotHub
  const hooks = createWriteHookRegistry({ writeTools })
  const mine = typeof mineEntities === 'function' ? mineEntities : mineNamedEntities

  function note(level, message, data = {}) {
    if (typeof log !== 'function') return
    try {
      log({ source: { kind: 'service', id: 'fact-hooks', carrierId: null }, level, message, data })
    } catch {
      // 记账失败不改变旁路的结论。
    }
  }

  async function readSwitch(root) {
    if (!root) return { ...normalizeFactHookSwitch(null), note: '没有项目根，钩子不跑' }
    for (const relative of [FACT_HOOKS_SWITCH_FILE, LEGACY_FACT_HOOKS_SWITCH_FILE]) {
      try {
        const text = await readSwitchFile(join(String(root), relative))
        return { ...normalizeFactHookSwitch(JSON.parse(text)), note: null }
      } catch (error) {
        if (error?.code === 'ENOENT') continue
        return {
          ...normalizeFactHookSwitch(null),
          note: `钩子开关文件读不懂，按默认全开处理：${errorText(error)}`
        }
      }
    }
    return { ...normalizeFactHookSwitch(null), note: null }
  }

  async function snapshotSafely(root) {
    try {
      const value = await readSnapshot(root)
      const entries = Array.isArray(value?.entries) ? value.entries.filter(isPlainObject) : []
      return { entries, book: firstText(value?.book), note: value?.note ?? null }
    } catch (error) {
      return { entries: [], book: '', note: `hub 快照没取到：${errorText(error)}` }
    }
  }

  function writeProposal(document) {
    const fileService = typeof getFileService === 'function' ? getFileService() : null
    if (typeof fileService?.writeProposal !== 'function') {
      note('warn', '钩子想落一份提案，但当前项目没有可写的文件服务：提案未写，正文与 hub 都没动。')
      return { ok: false, error: { code: 'UNWIRED', message: '项目文件服务未就绪' } }
    }
    const at = now()
    const name = proposalFileName({ tool: 'fact_hook', at })
    const id = name.replace(/\.json$/iu, '')
    return fileService.writeProposal({ name, text: JSON.stringify({ ...document, id }, null, 2) })
  }

  /**
   * 既有 proposed 草案里的实体名（去重用）：只读提案目录，跳过已弃用的提案。
   * 读不到／读坏都当「没有草案」——最多多造一份草案，不影响旁路结论。
   */
  async function pendingDraftNames() {
    const fileService = typeof getFileService === 'function' ? getFileService() : null
    if (typeof fileService?.listProposals !== 'function' || typeof fileService?.readProposal !== 'function') {
      return { names: [], note: null }
    }
    try {
      const listed = await fileService.listProposals()
      if (!listed?.ok) return { names: [], note: `提案目录读不到，去重降级：${errorText(listed?.error?.message ?? '未知原因')}` }
      const names = []
      for (const item of Array.isArray(listed.value?.proposals) ? listed.value.proposals : []) {
        if (str(item?.status) === 'discarded') continue
        const read = await fileService.readProposal({ name: item.name })
        if (!read?.ok) continue
        if (str(read.value?.proposal?.kind) !== 'fact-draft-entries') continue
        for (const entry of Array.isArray(read.value.proposal.entries) ? read.value.proposal.entries : []) {
          const name = str(entry?.name).trim()
          if (name && !names.includes(name)) names.push(name)
        }
      }
      return { names, note: null }
    } catch (error) {
      return { names: [], note: `提案去重自身出错，按无既有草案处理：${errorText(error)}` }
    }
  }

  /** 保存内容 → 内容管线 → 候选实体名（模型层可选，失败只记 warn）。 */
  async function mineCandidates(draftText, tool) {
    try {
      const mined = await mine({ text: draftText, ...(llmPort ? { llm: llmPort } : {}) })
      for (const failure of Array.isArray(mined?.failures) ? mined.failures.slice(0, 5) : []) {
        note('warn', `fact 实体识别有一段失败（保存不受影响）：${str(failure?.message) || str(failure?.code)}`, { tool })
      }
      return Array.isArray(mined?.candidates) ? mined.candidates.map((item) => str(item?.name).trim()).filter(Boolean) : []
    } catch (error) {
      note('warn', `fact 实体识别自身出错（保存不受影响）：${errorText(error)}`, { tool })
      return []
    }
  }

  /**
   * 包住一次工具调用：只在写类工具上做旁路，其他工具原样透传。
   * 写类工具由注册表判定（宿主注入清单 ＋ 表内配置），与正文里有没有 @《…》 无关。
   * call 必须由调用方给（通道侧就是 session.runtime.callTool），服务不直接碰运行时。
   */
  async function runToolCall({ tool, args = {}, call } = {}) {
    if (typeof call !== 'function') throw new TypeError('factHooks.runToolCall 需要 call()')
    const hook = hooks.resolve(tool)
    if (!hook) return call()
    const root = typeof getRoot === 'function' ? getRoot() : null
    if (!root) return call()

    const switchState = await readSwitch(root)
    if (switchState.note) note('warn', switchState.note, { tool })
    if (!switchState.enabled || !switchState.hooks.onSave) return call()

    const before = await snapshotSafely(root)
    const result = await call()
    if (!result?.ok) return result

    try {
      await observeSave({ root, hook, tool, args: isPlainObject(args) ? args : {}, result, before })
    } catch (error) {
      note('warn', `fact 保存钩子自身出错（已保存的数据不受影响）：${errorText(error)}`, { tool })
    }
    return result
  }

  async function observeSave({ root, hook, tool, args, before }) {
    if (before.note) note('warn', before.note, { tool })
    const draftText = hooks.textOf(tool, args)
    // 世界书保存会改派生源：快照必须重新现读；其余写口不动世界书，沿用保存前那份即为准。
    const after = hook.refreshHub ? await snapshotSafely(root) : before
    const entries = after.entries
    const draft = draftText ? { name: `${tool} 保存`, text: draftText } : null

    const validation = await diffValidate(
      { before: before.entries, after: entries, ...(draft ? { draft } : {}) },
      {}
    )

    let missing = []
    let skipped = { hub: [], proposed: [] }
    if (draftText) {
      const candidates = await mineCandidates(draftText, tool)
      const pending = candidates.length ? await pendingDraftNames() : { names: [], note: null }
      if (pending.note) note('warn', pending.note, { tool })
      const filtered = filterMissingEntities({ candidates, entries, proposed: pending.names })
      missing = filtered.missing
      skipped = filtered.skipped
    }

    let proposal = null
    if (missing.length) {
      const drafts = missing
        .map((name) => draftEntryForEntity(name, {
          domain: firstText(after.book, before.book),
          book: firstText(after.book, before.book),
          extractor: DRAFT_EXTRACTOR,
          source: tool
        }))
        .filter(Boolean)
      const written = await writeProposal(buildDraftEntriesProposal({
        tool,
        entries: drafts,
        missing,
        skipped,
        at: now()
      }))
      if (written?.ok) proposal = written.value?.path ?? null
      else note('warn', `实体草案没落盘（${missing.length} 个）：${errorText(written?.error ?? '未知原因')}`, { tool })
    }

    const skipText = skipped.hub.length || skipped.proposed.length
      ? `（跳过：hub 已有 ${skipped.hub.length}，既有草案 ${skipped.proposed.length}）`
      : ''
    const issues = Array.isArray(validation.issues) ? validation.issues : []
    const warnings = Array.isArray(validation.warnings) ? validation.warnings : []
    if (issues.length || warnings.length || missing.length || skipped.proposed.length) {
      const errors = issues.filter((issue) => issue.severity === 'error').length
      note('warn', `fact 校验（${hook.kind} 保存后）：${issues.length} 条条目级问题（${errors} 条硬伤），${warnings.length} 条预检提示，${missing.length} 个内容实体缺条目${skipText}`, {
        tool,
        file: str(args.file) || null,
        summary: validation.summary ?? null,
        issues: issues.slice(0, 20),
        warnings: warnings.slice(0, 20),
        missing,
        skipped,
        proposal
      })
    } else if (proposal) {
      note('info', `fact 保存钩子：${missing.length} 个内容实体在 hub 里没有条目，已写草案提案${skipText}`, {
        tool,
        missing,
        skipped,
        proposal
      })
    }
    return { issues: issues.length, warnings: warnings.length, missing: missing.length, skipped, proposal }
  }

  /**
   * 写作动作收尾：续写补全建议 / 润色只读查询。只在这些动作成功后才跑，
   * 失败与空结果原样返回，钩子结果作为回执上的旁注（factHook）。
   */
  async function afterComplete({ action } = {}) {
    const actionId = str(action)
    if (!HOOKED_WRITING_ACTIONS.includes(actionId)) return null
    const root = typeof getRoot === 'function' ? getRoot() : null
    if (!root) return null

    const switchState = await readSwitch(root)
    if (switchState.note) note('warn', switchState.note, { action: actionId })
    if (!switchState.enabled) return null
    const hookName = actionId === 'polish' ? 'onPolish' : 'onContinue'
    if (!switchState.hooks[hookName]) return null

    const snapshot = await snapshotSafely(root)
    if (snapshot.note) note('warn', snapshot.note, { action: actionId })

    try {
      if (actionId === 'polish') {
        // 零写入：readOnlyQuery 只出事实包，store／hub／正文都不碰。
        const queried = await readOnlyQuery({ entries: snapshot.entries }, {})
        return {
          kind: 'readOnlyQuery',
          entries: snapshot.entries.length,
          warnings: Array.isArray(queried.warnings) ? queried.warnings.length : 0,
          wroteProposal: false
        }
      }

      const suggested = await suggestCompletion({ entries: snapshot.entries, query: {} }, { useLlm: false })
      const suggestions = Array.isArray(suggested.suggestions)
        ? suggested.suggestions.slice(0, SUGGESTION_PROPOSAL_MAX)
        : []
      if (!suggestions.length) {
        return { kind: 'suggestCompletion', suggestions: 0, proposal: null, wroteProposal: false }
      }
      const written = await writeProposal(buildSuggestionProposal({
        action: actionId,
        suggestions,
        notes: suggested.notes,
        counts: suggested.factPack?.counts ?? null,
        at: now()
      }))
      if (!written?.ok) {
        note('warn', `续写补全建议没落盘：${errorText(written?.error ?? '未知原因')}`, { action: actionId })
        return { kind: 'suggestCompletion', suggestions: suggestions.length, proposal: null, wroteProposal: false }
      }
      return {
        kind: 'suggestCompletion',
        suggestions: suggestions.length,
        proposal: written.value?.path ?? null,
        wroteProposal: true
      }
    } catch (error) {
      note('warn', `fact 写作钩子自身出错（写作结果不受影响）：${errorText(error)}`, { action: actionId })
      return { kind: actionId === 'polish' ? 'readOnlyQuery' : 'suggestCompletion', error: errorText(error) }
    }
  }

  return {
    readSwitch,
    snapshot: readSnapshot,
    runToolCall,
    afterComplete,
    /** 只读：给诊断／测试看当前项目的开关裁决。 */
    async hooksEnabled() {
      const root = typeof getRoot === 'function' ? getRoot() : null
      return readSwitch(root)
    }
  }
}

/**
 * 默认 hub 快照：现读「世界书/」→ worldbookToHub（内存转换，不写 `.pinax/wikihub/`）。
 *
 * 不用现成的 hub.json：它是上一次离线生成时的快照，世界书改过后就旧了；
 * 保存钩子要做的是「此刻 hub 里有什么」，读派生源才不会有陈旧误报。
 * 世界书目录不存在／转换失败都返回空条目＋人话 note，不抛。
 */
async function defaultSnapshotHub(projectRoot) {
  const root = String(projectRoot ?? '')
  if (!root) return { entries: [], book: '', note: '没有项目根，hub 快照为空' }
  const read = await readWorldbookEntries(root)
  if (!read.ok) {
    return { entries: [], book: '', note: read.error?.message ?? '世界书目录读不到，hub 快照为空' }
  }
  const book = basename(root) || '世界书'
  const hub = worldbookToHub({ entries: read.entries }, { book })
  if (!hub?.ok) {
    return { entries: [], book, note: hub?.issues?.[0]?.message ?? '世界书转 hub 失败，hub 快照为空' }
  }
  return { entries: Array.isArray(hub.entries) ? hub.entries : [], book, note: null }
}
