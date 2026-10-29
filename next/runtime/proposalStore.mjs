import { fail, ok } from '../kernel/errors.mjs'

/**
 * 提案的「调用重放」格式（M2.5-A 任务三）。
 *
 * 今天正文提案是 `content` 字符串（pinax-proposal@1），采纳＝读当前 revision →
 * pinax_chapter_save(expectedRevision)。这条链只对「整章替换」成立，大纲/世界书/规则
 * 没有对应的 content 形状。所以工具循环产出的提案改成「一次待执行的调用」：
 * 记下 tool 与 args（含生成时的 baseRevision），采纳时用当前 revision 重新调同名工具。
 *
 * 三条不变式：
 *   1) 提案只写 .pinax/proposals/，永远走 fileService.writeProposal，不另开写盘通道；
 *   2) 重放不绕过写闸——它就是一次普通 callTool，目录归属、scope、revision 一样要过；
 *   3) revision 不一致就如实报 STALE，不静默合并（与 useBoardData.adoptProposal 同口径）。
 *
 * 章节类提案同时写一份 content：老 UI 的采纳口只认 content，在 UI 迁移完成前
 * 不能出现「点了采纳没反应」。
 */
const SUMMARY_MAX = 160
const CHAPTER_TOOL = 'pinax_chapter_save'

function pad(value) {
  return String(value).padStart(2, '0')
}

/** 文件名：<YYYYMMDD-HHmmss>-<tool 短名>-<4 位后缀>.json（字符集对 writeProposal 的清洗规则安全）。 */
export function proposalFileName({ tool, at = new Date(), suffix = null } = {}) {
  const stamp = [
    at.getFullYear(),
    pad(at.getMonth() + 1),
    pad(at.getDate())
  ].join('') + '-' + [pad(at.getHours()), pad(at.getMinutes()), pad(at.getSeconds())].join('')
  const short = String(tool || 'tool')
    .replace(/^pinax_/u, '')
    .replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/gu, '-')
    .slice(0, 40) || 'tool'
  const tail = suffix ?? Math.random().toString(36).slice(2, 6)
  return `${stamp}-${short}-${tail}.json`
}

/**
 * 组装提案对象。args 是**模型给的原始参数**，这里只做浅拷贝，不改写、不补默认值——
 * 补值会让重放与模型当时的意图不一致。
 */
export function buildToolCallProposal({ tool, args = {}, baseRevision = null, summary = '', target = null, runId = null, id, createdAt } = {}) {
  const proposal = {
    schema: 'pinax-proposal@1',
    kind: 'tool-call',
    id: String(id ?? ''),
    tool: String(tool ?? ''),
    args: { ...(args && typeof args === 'object' ? args : {}) },
    status: 'pending',
    createdAt: String(createdAt ?? '')
  }
  if (Number.isSafeInteger(baseRevision)) proposal.baseRevision = baseRevision
  if (summary) proposal.summary = String(summary).slice(0, SUMMARY_MAX)
  if (runId) proposal.runId = String(runId)

  const text = proposal.args.text
  if (tool === CHAPTER_TOOL && typeof text === 'string') {
    proposal.content = text
    proposal.contentChars = text.length
    proposal.target = {
      file: typeof proposal.args.file === 'string' ? proposal.args.file : (target?.file ?? null),
      chars: text.length
    }
  } else if (target && typeof target === 'object') {
    proposal.target = { ...target }
  }
  return proposal
}

/**
 * @param {object} input
 * @param {{ writeProposal: (request: {name: string, text: string}) => Promise<object> }} input.fileService
 * @param {() => Date} [input.now]
 * @param {() => string} [input.suffix]
 */
export function createProposalStore({ fileService, now = () => new Date(), suffix = undefined } = {}) {
  if (!fileService || typeof fileService.writeProposal !== 'function') {
    throw new TypeError('createProposalStore 需要带 writeProposal 的 fileService')
  }
  return {
    async create({ tool, args = {}, baseRevision = null, summary = '', target = null, runId = null } = {}) {
      if (!tool || typeof tool !== 'string') return fail('INVALID_INPUT', '提案必须写明要重放的工具名')
      if (!args || typeof args !== 'object' || Array.isArray(args)) return fail('INVALID_INPUT', '提案参数必须是对象')
      const at = now()
      const name = proposalFileName({ tool, at, suffix: typeof suffix === 'function' ? suffix() : suffix })
      const proposal = buildToolCallProposal({
        tool,
        args,
        baseRevision,
        summary,
        target,
        runId,
        id: name.replace(/\.json$/iu, ''),
        createdAt: at.toISOString()
      })
      const written = await fileService.writeProposal({ name, text: JSON.stringify(proposal, null, 2) })
      if (!written.ok) return written
      return ok({ name, path: written.value?.path ?? null, proposal })
    }
  }
}

/**
 * 重放一份 tool-call 提案。
 * @param {object} proposal 读回来的提案对象
 * @param {object} ports
 * @param {(name: string, args: object) => Promise<object>} ports.callTool 运行时 callTool
 * @param {() => Promise<{ok: boolean, value?: number, error?: object}>} [ports.readRevision]
 *        目标当前的修订号；提案带 baseRevision 时必填。
 */
export async function applyProposal(proposal, { callTool, readRevision } = {}) {
  if (!proposal || typeof proposal !== 'object' || !proposal.tool) {
    return fail('INVALID_INPUT', '这不是可重放的提案（缺 tool）；正文提案请走章节采纳口')
  }
  if (typeof callTool !== 'function') return fail('INVALID_INPUT', '重放提案需要 callTool')

  const args = { ...(proposal.args && typeof proposal.args === 'object' ? proposal.args : {}) }
  if (Number.isSafeInteger(proposal.baseRevision)) {
    if (typeof readRevision !== 'function') {
      return fail('INVALID_INPUT', '提案带 baseRevision，但没有给出修订号读取口')
    }
    const current = await readRevision()
    if (!current?.ok) return current ?? fail('IO_FAILED', '读不到目标当前修订号，提案未执行')
    if (current.value !== proposal.baseRevision) {
      return fail(
        'STALE_REVISION',
        `提案基于第 ${proposal.baseRevision} 版，当前是第 ${current.value} 版；请重新打开目标再决定，外壳不做静默合并`,
        { proposal: proposal.id ?? null, baseRevision: proposal.baseRevision, currentRevision: current.value }
      )
    }
    args.expectedRevision = current.value
  }
  return callTool(proposal.tool, args)
}
