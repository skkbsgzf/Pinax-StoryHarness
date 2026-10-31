/**
 * 面板桥（插件页面 ↔ 宿主）的一份可断言合同。
 *
 * 面板页跑在沙箱 iframe 里（sandbox="allow-scripts"，没有 allow-same-origin），
 * 所以它拿不到宿主的 DOM、存储与 Node——想跟宿主说话只有这一条 postMessage 通道。
 * 合同只有四个动作，方向写死：
 *   面板 → 宿主：ready（我起来了）、callTool（我要调一把工具）
 *   宿主 → 面板：toolResult（这次调用的结果）、error（形状不对，别等我）
 *
 * 三条边界：
 *   1) 面板能调的只有**只读**工具——写工具（annotations.readOnlyHint === false）一律被主进程拒；
 *   2) 面板只能调**自己那块板**的工具与内核只读工具，别人的板不开放；
 *   3) 载荷形状在这一层校验，形状不对就不往下走（不猜作者/插件想说什么）。
 */
export const PANEL_MESSAGE = Object.freeze({
  ready: 'pinax.panel.ready',
  callTool: 'pinax.panel.callTool',
  toolResult: 'pinax.panel.toolResult',
  error: 'pinax.panel.error'
})

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_.]{1,127}$/u

/** 面板 → 宿主的请求是否形状正确。 */
export function parsePanelRequest(payload) {
  if (!payload || typeof payload !== 'object') return null
  const type = String(payload.type ?? '')
  if (type === PANEL_MESSAGE.ready) return { type, id: String(payload.id ?? '') }
  if (type !== PANEL_MESSAGE.callTool) return null
  const id = String(payload.id ?? '')
  const name = String(payload.name ?? '')
  if (!id || !TOOL_NAME_PATTERN.test(name)) return null
  const args = payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)
    ? payload.arguments
    : {}
  return { type, id, name, args }
}

/** 宿主 → 面板的结果信封。失败也回同一形状：面板不用为两种结果写两套读法。 */
export function panelResult(id, result) {
  const ok = Boolean(result?.ok)
  return {
    type: PANEL_MESSAGE.toolResult,
    id: String(id ?? ''),
    ok,
    payload: ok ? (result?.value?.payload ?? result?.payload ?? null) : null,
    error: ok ? null : (result?.error ?? { code: 'PINAX_INVALID_INPUT', message: '调用失败' })
  }
}

/** 形状不对时的回话（面板不该干等）。 */
export function panelError(message, id = '') {
  return { type: PANEL_MESSAGE.error, id: String(id ?? ''), message: String(message ?? '') }
}
