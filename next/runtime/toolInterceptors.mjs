/**
 * 工具执行拦截点（批次50 · 线A）。
 *
 * 要治的是什么：工具的「执行前判定」与「执行后记账」散在工具循环里——写策略在 toolLoop 的
 * try 块里直接调，写族审计又要各自记一份。加一层环绕式拦截点之后：
 *   - runBefore(name, args, ctx)：顺序执行，任一拦截器返回 { veto:true, reason } 即拒，
 *     被否决的调用不会交给后面的拦截器，也不会执行；
 *   - runAfter(name, result, ctx)：不改结果、只记账，记账失败不改变执行结果。
 *
 * 两条纪律：
 *   1) 不新建第二条执行路——工具循环仍是唯一执行处，拦截点只是它内部的一层；
 *   2) 内置消费者必须真有用（写族闸 / 审计环各一个），不做空框架。
 */
function toolOf(ctx, name) {
  const tools = Array.isArray(ctx?.tools) ? ctx.tools : []
  for (const tool of tools) {
    if (typeof tool === 'string') {
      if (tool === name) return { name }
      continue
    }
    if (tool && tool.name === name) return tool
  }
  return null
}

/** 取这次调用的工具元数据：优先调用方直接给的 annotations，其次从本回合工具面里查。 */
export function annotationsOf(ctx, name) {
  if (ctx?.annotations && typeof ctx.annotations === 'object') return ctx.annotations
  const tool = toolOf(ctx, name)
  return tool?.annotations && typeof tool.annotations === 'object' ? tool.annotations : null
}

/**
 * 拦截器链。interceptors 每项形如 { name?, before?, after? }；
 * before 返回 { veto:true, reason, code?, decision?, proposal? } 即否决，
 * 返回 { args } 可替换入参（写闸注入 projectPath 之外的改写只走这一条），返回 void 表示放行。
 */
export function createInterceptorChain({ interceptors = [] } = {}) {
  const list = (Array.isArray(interceptors) ? interceptors : []).filter((item) => item && typeof item === 'object')

  return {
    interceptors: list,

    async runBefore(name, args = {}, ctx = {}) {
      let current = args && typeof args === 'object' ? args : {}
      let guardDecision = null
      const ran = []
      for (const interceptor of list) {
        if (typeof interceptor.before !== 'function') continue
        ran.push(String(interceptor.name ?? 'anonymous'))
        const outcome = await interceptor.before({ name, args: current, ctx })
        if (!outcome || typeof outcome !== 'object') continue
        if (outcome.guardDecision) guardDecision = outcome.guardDecision
        if (outcome.veto === true) {
          return {
            veto: true,
            reason: String(outcome.reason ?? `被拦截点「${interceptor.name ?? 'anonymous'}」否决`),
            code: String(outcome.code ?? 'TOOL_VETOED'),
            decision: outcome.decision ?? 'deny',
            proposal: outcome.proposal ?? null,
            guardDecision,
            interceptor: interceptor.name ?? null,
            ran,
            args: current
          }
        }
        if (outcome.args && typeof outcome.args === 'object') current = outcome.args
      }
      return { veto: false, args: current, guardDecision, ran }
    },

    async runAfter(name, result, ctx = {}) {
      for (const interceptor of list) {
        if (typeof interceptor.after !== 'function') continue
        try {
          await interceptor.after({ name, result, ctx })
        } catch {
          // 记账失败不改变执行结果：审计是旁路，不是执行的一部分。
        }
      }
      return result
    }
  }
}

/**
 * 消费者①：写族闸。把原先散在工具循环里的写策略判定收进 runBefore，
 * 返回体带 guardDecision（判读／判写、依据是落点表／annotations／后缀兜底），供测试与事件定位。
 */
export function createWriteGuardInterceptor({ policy = null, policyFor = null } = {}) {
  return {
    name: 'write-guard',
    async before({ name, args, ctx = {} }) {
      // 模型回合不是工具执行：写策略只裁决工具调用（toolTurn 的接线只把回合带过链，不在这里判写）。
      if (ctx?.kind === 'model-turn') return null
      const active = typeof policyFor === 'function' ? policyFor({ ...ctx, name }) : policy
      if (!active || typeof active.beforeTool !== 'function') return null
      const annotations = annotationsOf(ctx, name)
      const classified = typeof active.classify === 'function' ? active.classify(name, annotations) : null
      const decided = await active.beforeTool({ id: ctx?.call?.id, name, arguments: args, annotations })
      const guardDecision = {
        ...(classified ?? {}),
        kind: String(decided?.kind ?? 'allow'),
        ...(decided?.code ? { code: String(decided.code) } : {})
      }
      if (decided?.kind === 'deny') {
        return { veto: true, decision: 'deny', code: decided.code, reason: decided.message, guardDecision }
      }
      if (decided?.kind === 'proposal') {
        const proposal = decided.proposal ?? {}
        return {
          veto: true,
          decision: 'proposal',
          proposal,
          reason: `已转成提案 ${proposal.id ?? proposal.name ?? ''}，等待作者采纳`,
          guardDecision
        }
      }
      return { args: decided?.args ?? args, guardDecision }
    }
  }
}

/**
 * 提交类外部工具：会对外部世界产生副作用、但明确不写本地盘（readOnlyHint:false 且未声明
 * destructiveHint）。先例是漫画桥的 comfy_submit——出图不是写盘，不能因为它「非只读」就把
 * 一次提交当成改稿；但这类调用必须留痕，所以归审计环而不是写盘账。
 */
export function isSubmitToolCall(name, annotations) {
  const declared = annotations && typeof annotations === 'object' ? annotations : null
  if (!declared) return false
  if (declared.readOnlyHint !== false) return false
  if (declared.destructiveHint === true) return false
  return true
}

/**
 * 消费者②：审计环。把「review 档里直执行的提交类工具」记进公共池（批次49 的 serviceLogPool），
 * 替掉零散 console 记账——作者在设置「服务与通知」里能看见，pinax_service_log_list 也读得到。
 * auto 档直执行本来就是预期行为，不往池里刷；未知写模式照记（宁可多留一条痕）。
 */
export function createWriteAuditInterceptor({ pool = null, mode = null } = {}) {
  const resolvePool = () => (typeof pool === 'function' ? pool() : pool)
  return {
    name: 'write-audit',
    async after({ name, result, ctx = {} }) {
      if (!isSubmitToolCall(name, annotationsOf(ctx, name))) return
      const writeMode = ctx.writeMode ?? mode ?? 'unknown'
      if (writeMode !== 'review' && writeMode !== 'unknown') return
      const target = resolvePool()
      if (!target || typeof target.append !== 'function') return
      const ok = !(result && typeof result === 'object' && result.ok === false)
      const dot = name.indexOf('.')
      const prefix = dot > 0 ? name.slice(0, dot) : 'tool-audit'
      target.append({
        source: { kind: 'mcp', id: prefix, carrierId: '' },
        level: ok ? 'info' : 'warn',
        message: `提交类外部工具「${name}」已直接执行（写模式 ${writeMode}，${ok ? '成功' : '失败'}）`,
        data: { tool: name, mode: writeMode, ok }
      })
    }
  }
}
