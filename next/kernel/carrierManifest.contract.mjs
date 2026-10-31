import { fail, ok } from './errors.mjs'
import { isPlainObject, validatePluginRelativePath } from './carrierManifest.shared.mjs'

/**
 * 合同边界（批次52，对 Cordis `engines.dsh` 的 SemVer 区间）与 license 声明。
 *
 * 内核合同版本只有「下限闸」时有两处漏：只比 major、没有上界。本批：
 *   minKernel  与 maxKernel 成对使用；maxKernel 缺省＝不设上界（既有清单行为不变）
 *   比对粒度   major.minor（patch 不参与：内核合同不靠补丁号区分能力面）
 *   豁免机制   不做（v3 定的「声明了不生效就拒」不允许半成品豁免），登记未采用
 *
 * 硬要求：既有 12 份清单都写 minKernel:'1'，宿主合同 '1' 解析成 1.0，
 * `1.0 <= 1.0` 仍然成立——收紧闸不许误拒老清单。
 */
export const KERNEL_CONTRACT_VERSION = '1'
export const KERNEL_VERSION_PATTERN = /^\d+(\.\d+){0,2}$/u

/** '1' → { major:1, minor:0, patch:0 }；格式不对返回 null。 */
export function parseKernelVersion(value) {
  const raw = String(value ?? '').trim()
  if (!KERNEL_VERSION_PATTERN.test(raw)) return null
  const [major, minor = '0', patch = '0'] = raw.split('.')
  return { major: Number(major), minor: Number(minor), patch: Number(patch), raw }
}

/** 只比 major.minor（patch 不参与）；任一格式不对返回 null。 */
export function compareKernelVersions(a, b) {
  const left = parseKernelVersion(a)
  const right = parseKernelVersion(b)
  if (!left || !right) return null
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  return 0
}

/** 宿主合同是否落在 [minKernel, maxKernel] 内；maxKernel 缺省＝只要不低于下限。 */
export function kernelRangeAllows(minKernel, maxKernel, hostKernel = KERNEL_CONTRACT_VERSION) {
  const lower = compareKernelVersions(minKernel, hostKernel)
  if (lower === null || lower > 0) return false
  if (maxKernel === undefined || maxKernel === null) return true
  const upper = compareKernelVersions(hostKernel, maxKernel)
  return upper !== null && upper <= 0
}

export function validateMaxKernel(value, { pluginId, minKernel } = {}) {
  if (value === undefined || value === null) return ok(null)
  if (typeof value !== 'string' || !KERNEL_VERSION_PATTERN.test(value.trim())) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 maxKernel 须是数字版本（如 "1"／"1.2"），收到 ${String(value)}`, { pluginId, maxKernel: value })
  }
  const max = value.trim()
  if (parseKernelVersion(minKernel)) {
    const compared = compareKernelVersions(max, minKernel)
    if (compared === null || compared < 0) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 maxKernel=${max} 低于 minKernel=${String(minKernel)}：上界不能小于下界`, { pluginId, maxKernel: max, minKernel })
    }
  }
  return ok(max)
}

export const LICENSE_MODES = Object.freeze(['free', 'subscription', 'buyout'])
export const LICENSE_AGREEMENT_EXTS = Object.freeze(['.md', '.txt'])
const LICENSE_AGREEMENT_PATH_MAX = 200
const LICENSE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u

/**
 * license：可选声明（mode 必填）。本批只做声明与校验——
 * 设置面展示与鉴权归批次54，这里只把值归一给宿主读。
 */
export function validateLicense(value, pluginId) {
  if (value === undefined || value === null) return ok(null)
  if (!isPlainObject(value)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 license 必须是对象 { mode, agreement?, version? }`, { pluginId })
  }
  for (const key of Object.keys(value)) {
    if (!['mode', 'agreement', 'version'].includes(key)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 license 含未知字段 "${key}"：可声明 mode / agreement / version`, { pluginId, key })
    }
  }
  if (!LICENSE_MODES.includes(value.mode)) {
    return fail('INVALID_MANIFEST', `${pluginId} 的 license.mode 须是 ${LICENSE_MODES.join(' / ')}，收到 ${String(value.mode)}`, { pluginId, mode: value.mode })
  }
  let agreement = null
  if (value.agreement !== undefined && value.agreement !== null) {
    const path = validatePluginRelativePath(value.agreement, {
      pluginId, field: 'license.agreement', max: LICENSE_AGREEMENT_PATH_MAX
    })
    if (!path.ok) return path
    if (!LICENSE_AGREEMENT_EXTS.includes(path.value.slice(path.value.lastIndexOf('.')).toLowerCase())) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 license.agreement 必须是 ${LICENSE_AGREEMENT_EXTS.join(' / ')} 文件：${path.value}`, { pluginId })
    }
    agreement = path.value
  }
  let version = null
  if (value.version !== undefined && value.version !== null) {
    if (typeof value.version !== 'string' || !LICENSE_VERSION_PATTERN.test(value.version)) {
      return fail('INVALID_MANIFEST', `${pluginId} 的 license.version 须是 x.y.z`, { pluginId, version: value.version })
    }
    version = value.version
  }
  return ok({ mode: value.mode, agreement, version })
}
