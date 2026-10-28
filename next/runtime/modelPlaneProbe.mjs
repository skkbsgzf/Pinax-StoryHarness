import { ok, fail } from '../kernel/errors.mjs'
import { getTaskPlaneEndpoint as gatewayEndpoint, setTaskPlaneEndpoint } from '../../server/services/kitModelGateway.js'

/**
 * 模型面三态探测（批次 8①：把「模型面不可达」和「可达但没配模型」分开报，不再一句
 * 「未检测到可用模型」糊过去——作者排的批次8④）。
 *
 * 探的是任务面的 GET /model（kitFunnelAvailable 同一端点、同 2s 级超时口径）：
 *   ready       —— 端点可达且 /model 正常应答（模型配置由任务面持有并自证）；
 *   no-model    —— 可达，但应答体明确说没配模型（约定字段：model 为空 / configured=false / models 空）；
 *   unreachable —— 连不上或应答异常。
 *
 * 诚实边界：任务面 /model 的应答体契约未逐字段取证（内核在 pinned 仓库里），
 * no-model 只在应答体「明确声明没配」时给出；读不出就如实给 ready，不猜。
 */
const PROBE_TIMEOUT_MS = 2500

function classifyModelBody(body) {
  if (!body || typeof body !== 'object') return 'ready'
  if (body.model === null || body.model === undefined) return 'no-model'
  if (body.configured === false) return 'no-model'
  if (Array.isArray(body.models) && body.models.length === 0) return 'no-model'
  return 'ready'
}

export async function probeModelPlane({ fetchImpl = fetch } = {}) {
  const endpoint = gatewayEndpoint()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(new URL('/model', endpoint), { signal: controller.signal })
    if (!response.ok) {
      return ok({ state: 'unreachable', endpoint, detail: `HTTP ${response.status}` })
    }
    const body = await response.json().catch(() => null)
    return ok({ state: classifyModelBody(body), endpoint, detail: null })
  } catch (error) {
    const reason = error?.name === 'AbortError' ? `超过 ${PROBE_TIMEOUT_MS}ms 无应答` : String(error?.message || error)
    return ok({ state: 'unreachable', endpoint, detail: reason })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 应用偏好里的模型面端点（批次8①）：null/空＝回到默认来源（env PINAX_ADAPTER_ENDPOINT 仍最高优先）。
 * 外壳 main.mjs 只许经这里碰网关——next/shell 不得直接 import server/（渲染侧依赖薄守卫），
 * 端点 setter 的所有权住在 runtime 层，与 probe 同址。
 */
export function applyModelPlaneEndpoint(endpoint) {
  try {
    return ok({ endpoint: setTaskPlaneEndpoint(endpoint ?? null) })
  } catch (error) {
    return fail('INVALID_INPUT', String(error?.message || error))
  }
}

export { gatewayEndpoint as getTaskPlaneEndpoint }
