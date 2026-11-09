/**
 * fact.data/v2 hook 契约（ADR S3：只定接口，不接引擎）。
 *
 * 作者口径：fact 能力集成在 agent 底部，与项目唯一绑定；创作动作通过宿主 hook 触发：
 *   - 写大纲 / 续写 → 自动补全数据（suggestCompletion）；
 *   - 产生变更     → 自动 diff 校验（diffValidate）；
 *   - 纯文笔润色   → 不改 data，只提供调用（readOnlyQuery）。
 *
 * 本批交付：接口签名、read-only/write 语义标注、纯函数可测的 plan/registry。
 * 真正的引擎接线（把 handler 注册到 agent 底部）是 P1 Core 批，不在这里。
 */

export const HOOK_INTERFACE_VERSION = 'wikihub-hooks/v1'

/**
 * 目标函数语义：
 *   suggest  —— 产出建议，宿主决定是否落盘（不直接写 data）；
 *   validate —— 只读校验，产出违规清单；
 *   read-only —— 只读查询，绝不改 data。
 */
export const HOOK_TARGETS = Object.freeze({
  suggestCompletion: Object.freeze({ id: 'suggestCompletion', semantics: 'suggest', writesData: false }),
  diffValidate: Object.freeze({ id: 'diffValidate', semantics: 'validate', writesData: false }),
  readOnlyQuery: Object.freeze({ id: 'readOnlyQuery', semantics: 'read-only', writesData: false })
})

/**
 * hook 契约表。
 *   timing：宿主在哪个创作动作的前后触发；
 *   semantics：suggest / validate / read-only；
 *   writesData：hook 本身是否直接改 data（本版全部 false——落盘由宿主或 P1 引擎负责）。
 */
export const HOOK_CONTRACTS = Object.freeze({
  onOutlineWrite: Object.freeze({
    id: 'onOutlineWrite',
    target: 'suggestCompletion',
    timing: 'after-outline-write',
    semantics: 'suggest',
    writesData: false,
    description: '写完大纲后自动补全 fact 数据建议（人物/设定/剧情字段），只给建议不落盘'
  }),
  onContinueWrite: Object.freeze({
    id: 'onContinueWrite',
    target: 'suggestCompletion',
    timing: 'after-continue-write',
    semantics: 'suggest',
    writesData: false,
    description: '续写后自动补全数据建议（知情矩阵、节奏窗口、新意标记），只给建议不落盘'
  }),
  onDataChange: Object.freeze({
    id: 'onDataChange',
    target: 'diffValidate',
    timing: 'after-data-change',
    semantics: 'validate',
    writesData: false,
    description: 'fact 数据变更后做 diff 校验（状态机/视角/粒度/一致性），只读'
  }),
  onPolish: Object.freeze({
    id: 'onPolish',
    target: 'readOnlyQuery',
    timing: 'polish',
    semantics: 'read-only',
    writesData: false,
    description: '纯文笔润色只读查询条目与文风能力包，不改 data'
  })
})

export const HOOK_IDS = Object.freeze(Object.keys(HOOK_CONTRACTS))

export function getHookContract(id) {
  return HOOK_CONTRACTS[str(id)] ?? null
}

/** 只读 hook：validate / read-only 两类都不许写 data；suggest 也只给建议（writesData=false）。 */
export function isReadOnlyHook(id) {
  const contract = getHookContract(id)
  if (!contract) return false
  return contract.semantics !== 'suggest' && contract.writesData === false
}

/**
 * 纯函数：校验一次 hook 调用并给出执行计划（不执行 handler）。
 * 返回 { ok, plan:{hook,target,semantics,writesData,payload} } 或 { ok:false, error }。
 */
export function planHook(id, payload = {}) {
  const contract = getHookContract(id)
  if (!contract) {
    return { ok: false, error: { code: 'UNKNOWN_HOOK', message: `未知 hook：${str(id)}（允许：${HOOK_IDS.join('/')}）` } }
  }
  if (payload !== undefined && payload !== null && !isPlainObject(payload)) {
    return { ok: false, error: { code: 'HOOK_PAYLOAD', message: 'hook payload 必须是对象' } }
  }
  return {
    ok: true,
    plan: {
      hook: contract.id,
      target: contract.target,
      semantics: contract.semantics,
      writesData: contract.writesData === true,
      readOnly: isReadOnlyHook(contract.id),
      payload: payload ?? {}
    }
  }
}

/**
 * 纯函数：登记 handler（P1 才把 registry 接到 agent）。
 * 不接受只读 hook 上声明写数据的 handler——语义冲突直接拒绝，不静默降级。
 */
export function createHookRegistry(handlers = {}) {
  const registered = new Map()
  if (!isPlainObject(handlers)) {
    return { ok: false, error: { code: 'HOOK_REGISTRY', message: 'handlers 必须是 { hookId: fn } 对象' } }
  }
  for (const [id, handler] of Object.entries(handlers)) {
    const contract = getHookContract(id)
    if (!contract) {
      return { ok: false, error: { code: 'UNKNOWN_HOOK', message: `未知 hook：${id}` } }
    }
    if (typeof handler !== 'function') {
      return { ok: false, error: { code: 'HOOK_HANDLER', message: `hook「${id}」的 handler 必须是函数` } }
    }
    if (handler.writesData === true && contract.writesData === false) {
      return { ok: false, error: { code: 'HOOK_WRITE_CONFLICT', message: `hook「${id}」是只读语义，不接受写数据的 handler` } }
    }
    registered.set(id, handler)
  }
  return {
    ok: true,
    has: (id) => registered.has(id),
    list: () => [...registered.keys()],
    contractOf: (id) => getHookContract(id),
    handlerOf: (id) => registered.get(id) ?? null
  }
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function str(value) {
  return String(value ?? '')
}
