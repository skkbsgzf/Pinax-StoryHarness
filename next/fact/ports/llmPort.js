/**
 * LlmPort 端口（Core-shape：补全/校验类需要模型的环节）。
 *
 * 实现方：宿主（agent 运行时）。域内只把「提示词 → 文本」当黑盒用；
 * 模型选择、计费、重试都在适配层，域不感知。
 *
 * @typedef {Object} CompletionRequest
 * @property {string} prompt
 * @property {string} [system]
 * @property {number} [maxTokens]
 * @property {AbortSignal} [signal]
 *
 * @typedef {Object} CompletionResult
 * @property {string} text
 * @property {{promptTokens?: number, completionTokens?: number}} [usage]
 *
 * @typedef {Object} LlmPort
 * @property {(request: CompletionRequest) => Promise<CompletionResult>} complete
 */

export const LLM_PORT_METHODS = Object.freeze(['complete'])

export function isLlmPort(candidate) {
  if (!candidate || typeof candidate !== 'object') return false
  return LLM_PORT_METHODS.every((method) => typeof candidate[method] === 'function')
}

export function assertLlmPort(candidate) {
  if (!isLlmPort(candidate)) {
    throw new TypeError(`LlmPort 端口缺方法：需要 ${LLM_PORT_METHODS.join('/')}`)
  }
  return candidate
}
