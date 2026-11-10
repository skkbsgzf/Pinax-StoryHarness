import { fail, ok } from './errors.mjs'
import { isPlainObject } from './carrierManifest.shared.mjs'

/**
 * 槽语义四态（批次52，对 Cordis `ctx.slots` 的 SlotKind）：
 *
 *   multiplicity  single | list | keyed   这块 pane 允许开几份
 *   scope         project | entry | session  绑什么上下文
 *   keyField      只有 keyed 才认：多实例按哪个字段区分
 *
 * `chain` 登记为未采用（宿主没有链式槽的消费点），写进清单就拒——
 * 与「声明了却不生效」同一条纪律，避免以后有人照着抄出第五态。
 *
 * 缺省：@4 清单未写时归一成 single／project（旧行为就是一块 pane 一份）；
 * @1/@2/@3 不经过本校验器，归一结果也不会多出这些字段（读侧保持字节不变）。
 */
export const PANE_MULTIPLICITIES = Object.freeze(['single', 'list', 'keyed'])
export const PANE_SCOPES = Object.freeze(['project', 'entry', 'session'])
/** 登记未采用：宿主没有消费点，写进清单即拒。 */
export const UNSUPPORTED_PANE_MULTIPLICITIES = Object.freeze(['chain'])
export const DEFAULT_PANE_MULTIPLICITY = 'single'
export const DEFAULT_PANE_SCOPE = 'project'

const KEY_FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/u

export function validatePaneSemantics(pane, { pluginId } = {}) {
  if (!isPlainObject(pane)) return fail('INVALID_MANIFEST', `${pluginId} 的 pane 必须是对象`)
  const paneId = String(pane.id ?? '?')
  const multiplicity = pane.multiplicity === undefined ? DEFAULT_PANE_MULTIPLICITY : pane.multiplicity
  if (UNSUPPORTED_PANE_MULTIPLICITIES.includes(multiplicity)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」声明 multiplicity=${multiplicity}：链式槽登记未采用，可用 ${PANE_MULTIPLICITIES.join(' / ')}`, { pluginId, paneId, multiplicity })
  }
  if (typeof multiplicity !== 'string' || !PANE_MULTIPLICITIES.includes(multiplicity)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」multiplicity 须是 ${PANE_MULTIPLICITIES.join(' / ')}，收到 ${String(multiplicity)}`, { pluginId, paneId, multiplicity })
  }
  const scope = pane.scope === undefined ? DEFAULT_PANE_SCOPE : pane.scope
  if (typeof scope !== 'string' || !PANE_SCOPES.includes(scope)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」scope 须是 ${PANE_SCOPES.join(' / ')}，收到 ${String(scope)}`, { pluginId, paneId, scope })
  }
  let keyField = null
  if (multiplicity === 'keyed') {
    if (typeof pane.keyField !== 'string' || !KEY_FIELD_PATTERN.test(pane.keyField)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」multiplicity=keyed 时必须给 keyField（须匹配 ${KEY_FIELD_PATTERN}）`, { pluginId, paneId, keyField: pane.keyField })
    }
    keyField = pane.keyField
  } else if (pane.keyField !== undefined) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 pane「${paneId}」只有 multiplicity=keyed 才认 keyField（当前 ${multiplicity}）`, { pluginId, paneId })
  }
  return ok({ multiplicity, scope, keyField })
}
