/**
 * 写策略（M2.5-A 任务二）。
 *
 * 要治的是什么：今天「改哪块目录」只由写闸在工具执行时判定（kernelWriteGuard），
 * 调用之前没有策略层，于是 mode 徽章无处生效，`*_write`（提案）与 `*_save`（直写）
 * 被做成了两把工具名——等于把策略写进了名字里。
 *
 * 这一层只回答一个问题：这一次工具调用，**现在落不落**。
 *   review  → 不落，转成提案（提案必须按成功结果回给模型，否则它会换参数重试）
 *   auto    → 落
 *   blocked → 不落，也不出提案，如实告诉模型这块目录只读
 *
 * 三条必须守住的边界：
 *   1) 落点事实源只有一个：调用方把 { ...KERNEL_WRITE_CLASS, ...CARRIER_WRITE_CLASS }
 *      传进来，本模块不复制那张表；
 *   2) structural（建项目/整目录导入）与 derived（索引 sync）不算「改某块目录」，不拦；
 *   3) 未知名字一律 allow——读工具不在表里，误拦会把整条链堵死。
 */
export const WRITE_MODES = Object.freeze(['review', 'auto', 'blocked'])

/** 未知值一律回落 review：宁可多一步确认，不可因为拼错一个词直写原稿。 */
export function normalizeWriteMode(value) {
  const mode = String(value ?? '')
  return WRITE_MODES.includes(mode) ? mode : 'review'
}

/** 写某块目录的所有工具名（拒绝提示用，按落点表反查，不手写名单）。 */
export function writersForDir(dir, landing = {}) {
  return Object.entries(landing)
    .filter(([, klass]) => klass && klass.dir === dir)
    .map(([name]) => name)
}

function blockedMessage(name, klass, landing) {
  const dir = klass?.dir
  if (!dir) {
    return `「${name}」此刻不允许落盘：当前写入策略是只读。请让作者在设置里切回审阅或自动。`
  }
  const writers = writersForDir(dir, landing)
  const tail = writers.length ? `写「${dir}/」只有 ${writers.join(' / ')}。` : ''
  return `「${dir}/」当前为只读：${tail}请让作者在设置里把写入策略切回审阅或自动。`
}

/**
 * @param {object} input
 * @param {'review'|'auto'|'blocked'} [input.mode]
 * @param {Record<string, {dir?: string|null, structural?: boolean, derived?: boolean}>} [input.landing]
 * @param {(request: {tool: string, args: object, dir: string|null}) => Promise<object>} [input.createProposal]
 *        返回 { ok:true, value:{ id?, name, path? } }；失败原样透传。
 */
export function createWritePolicy({ mode = 'review', landing = {}, createProposal = null } = {}) {
  const resolved = normalizeWriteMode(mode)
  return {
    mode: resolved,
    async beforeTool(call = {}) {
      const name = String(call.name ?? '')
      const args = call.arguments && typeof call.arguments === 'object' ? call.arguments : {}
      const klass = landing[name] ?? null
      if (!klass || klass.structural || klass.derived) return { kind: 'allow', args }
      if (resolved === 'blocked') {
        return { kind: 'deny', code: 'WRITE_BLOCKED', message: blockedMessage(name, klass, landing) }
      }
      if (resolved === 'review') {
        if (typeof createProposal !== 'function') {
          return {
            kind: 'deny',
            code: 'PROPOSAL_UNAVAILABLE',
            message: `「${name}」会改盘，但审阅模式没有提案出口；请让作者切到自动模式或修好提案目录。`
          }
        }
        const created = await createProposal({ tool: name, args, dir: klass.dir ?? null })
        if (!created || created.ok === false) {
          return {
            kind: 'deny',
            code: created?.error?.code ?? 'PROPOSAL_FAILED',
            message: created?.error?.message ?? '提案没能落盘，这一次改动没有生效'
          }
        }
        const proposal = created.value ?? created
        return { kind: 'proposal', proposal }
      }
      return { kind: 'allow', args }
    }
  }
}
