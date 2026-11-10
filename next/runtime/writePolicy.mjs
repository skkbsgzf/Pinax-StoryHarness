/**
 * 写策略（M2.5-A 任务二；批次50 写族判定去启发化）。
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
 *   3) 读工具一律 allow——不在落点表、也判不出写口的，误拦会把整条链堵死。
 *
 * 批次50：外部 MCP 工具（协议 v3）的写族判定**改锚工具自带的 annotations**，后缀只做兜底。
 * 三级优先：
 *   ① annotations.readOnlyHint === true              → 判读（哪怕名字叫 xxx_save）；
 *   ② destructiveHint === true 或非只读（readOnlyHint === false）→ 判写；
 *   ③ readOnlyHint／destructiveHint 两者全无声明      → 回落 EXTERNAL_WRITE_HINT，
 *      并经公共池（serviceLogPool）记一条 level:'warn'（「该工具无写声明，按后缀兜底」）。
 * 这样「真写盘却叫 comfy_submit」会被 annotations 判进写族（提交类另走直执行＋审计），
 * 「只读却叫 xxx_save」也不会被拖进 review。
 *
 * 提交类豁免（批次45 的既有口径）：已声明 readOnlyHint:false、且没有声明 destructiveHint:true
 * 的外部工具（先例 comfy_submit——出图不是写盘）判写但不进 review 提案，直执行并由审计环记账。
 * 若作者要求 review 档也拦提交类，删掉 beforeTool 里那条 submit 放行即可。
 */
import { hasWriteDeclaration, isExternalWriteToolName } from './kernelWriteGuard.mjs'

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

/**
 * 外部工具写族判定（批次50 的三级优先，独立成函数便于测试与诊断）：
 *   { write, source: 'annotations'|'suffix', readOnly, destructive, fallback, submit }
 * 只有 `fallback:true` 才代表「工具没声明，靠后缀猜」——调用方据此记 warn。
 * `submit:true`＝声明了非只读、但未声明破坏性：判写，且走直执行＋审计（提交类豁免）。
 */
export function classifyExternalTool(name, annotations) {
  if (hasWriteDeclaration(annotations)) {
    if (annotations.readOnlyHint === true) {
      return { write: false, source: 'annotations', readOnly: true, destructive: annotations.destructiveHint === true, fallback: false, submit: false }
    }
    const destructive = annotations.destructiveHint === true
    return { write: true, source: 'annotations', readOnly: false, destructive, fallback: false, submit: !destructive }
  }
  return { write: isExternalWriteToolName(name), source: 'suffix', readOnly: false, destructive: false, fallback: true, submit: false }
}

function blockedMessage(name, klass, landing) {
  const dir = klass?.dir
  if (!dir) {
    const external = klass?.external ? '（外部 MCP 写工具）' : ''
    return `「${name}」${external}此刻不允许落盘：当前写入策略是只读。请让作者在设置里切回审阅或自动。`
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
 * @param {object|null} [input.serviceLogPool] 批次50：后缀兜底的 warn 进这里（作者在设置节可见）。
 */
export function createWritePolicy({ mode = 'review', landing = {}, createProposal = null, serviceLogPool = null } = {}) {
  const resolved = normalizeWriteMode(mode)
  const warnedFallbacks = new Set()

  function warnFallback(name, decision) {
    // 只有外部 MCP 工具（聚合面按 `<prefix>.<name>` 命名）才需要作者补声明；
    // 内建／载体工具的名字不带点，误报会给设置页添噪音。
    if (!name.includes('.')) return
    if (warnedFallbacks.has(name)) return
    warnedFallbacks.add(name)
    if (!serviceLogPool || typeof serviceLogPool.append !== 'function') return
    const dot = name.indexOf('.')
    const prefix = dot > 0 ? name.slice(0, dot) : 'tool-policy'
    try {
      serviceLogPool.append({
        source: { kind: 'mcp', id: prefix, carrierId: '' },
        level: 'warn',
        message: `外部工具「${name}」该工具无写声明，按后缀兜底判为${decision.write ? '写' : '读'}工具；请在 MCP 服务端补 annotations（readOnlyHint／destructiveHint）`,
        data: { tool: name, fallback: decision.write ? 'write' : 'read' }
      })
    } catch {
      // 记账坏掉不影响策略判定本身。
    }
  }

  /**
   * 判一次调用的写族归属。landing 命中优先（内建落点表是权限事实源），
   * 未命中才看 annotations（外部工具），最后才是后缀兜底。
   */
  function classify(name, annotations = null) {
    const klass = landing?.[name]
    if (klass) {
      const write = !klass.structural && !klass.derived
      return {
        klass,
        write,
        source: 'landing',
        dir: klass.dir ?? null,
        external: false,
        structural: Boolean(klass.structural),
        derived: Boolean(klass.derived),
        destructive: false,
        submit: false
      }
    }
    const external = classifyExternalTool(name, annotations)
    if (external.fallback) warnFallback(name, external)
    return {
      klass: external.write ? { dir: null, external: true } : null,
      write: external.write,
      source: external.source,
      dir: null,
      external: true,
      structural: false,
      derived: false,
      destructive: external.destructive,
      submit: external.submit
    }
  }

  return {
    mode: resolved,

    /** guardDecision 的判定面（拦截点与测试读它，不改变 beforeTool 的返回形状）。 */
    classify(name, annotations = null) {
      const result = classify(name, annotations)
      return {
        write: result.write,
        source: result.source,
        dir: result.dir,
        external: result.external,
        structural: result.structural,
        derived: result.derived,
        destructive: result.destructive,
        submit: result.submit
      }
    },

    async beforeTool(call = {}) {
      const name = String(call.name ?? '')
      const args = call.arguments && typeof call.arguments === 'object' ? call.arguments : {}
      const annotations = call.annotations && typeof call.annotations === 'object'
        ? call.annotations
        : null
      const result = classify(name, annotations)
      if (!result.klass || !result.write) return { kind: 'allow', args }
      // 提交类豁免：出图这类外部副作用不是改本地盘，review 档也直执行；留痕交给审计环。
      if (result.submit && resolved === 'review') return { kind: 'allow', args }
      if (resolved === 'blocked') {
        return { kind: 'deny', code: 'WRITE_BLOCKED', message: blockedMessage(name, result.klass, landing) }
      }
      if (resolved === 'review') {
        if (typeof createProposal !== 'function') {
          return {
            kind: 'deny',
            code: 'PROPOSAL_UNAVAILABLE',
            message: `「${name}」会改盘，但审阅模式没有提案出口；请让作者切到自动模式或修好提案目录。`
          }
        }
        const created = await createProposal({ tool: name, args, dir: result.klass.dir ?? null })
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
