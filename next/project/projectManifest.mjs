import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'
import { isKnownKind, LEGACY_PROJECT_SPECS, METADATA_DIR, PROJECT_SPEC } from '../kernel/projectSkeleton.mjs'
import { writeFileAtomic } from '../fs/atomicWrite.mjs'

/**
 * `.pinax/project.json` 单一合同（WP5）。
 * 今天两边互不认账：桌面轨写 schemaVersion=1 且不带 spec（electron/projects/projectManifest.mjs），
 * 服务端轨写 spec='pinax-project@1' ＋ kind（server/services/localMirrorService.js:477），
 * 于是服务端打开 Electron 建的项目必抛 ERR_SPEC_MISMATCH（同文件 :496）。
 * Next 统一升 `pinax-project@3`：spec 强制、加 carriers、读侧兼容 @1／@2。
 * @3 与 @2 的字段相同，升的是合同代际：项目引用的载体清单已按 pinax-carrier@3 写，
 * 读到 @3 的老外壳必须显式升级；写回一律 @3（打开只读、不擅自改盘，落盘时机同以往）。
 */
export const PROJECT_DOC_FIELDS = Object.freeze([
  'spec', 'schemaVersion', 'projectId', 'name', 'kind', 'createdAt', 'updatedAt', 'carriers'
])

export function validateProjectDocument(input) {
  if (!isPlainObject(input)) return fail('INVALID_INPUT', 'project.json 必须是对象')
  const doc = input
  if (doc.spec !== PROJECT_SPEC && !LEGACY_PROJECT_SPECS.includes(doc.spec)) {
    return fail('INVALID_INPUT', `项目范式 ${String(doc.spec)} 不在支持范围（${[...LEGACY_PROJECT_SPECS, PROJECT_SPEC].join(' / ')}）`, {
      got: doc.spec, wanted: PROJECT_SPEC
    })
  }
  const legacy = doc.spec !== PROJECT_SPEC
  const carriers = normalizeCarriers(doc.carriers, { legacy })
  if (!carriers.ok) return carriers

  // D2：kind 缺失/未知不再静默回落成 novel。唯一允许空 kind 的形态是「还没有主载体的裸项目」，
  // 它停在「选一个主载体」这一步，而不是猜一个类型把书跑歪。
  if (!isKnownKind(doc.kind)) {
    if (carriers.value.primary) {
      return fail('PRIMARY_CARRIER_MISSING', `项目声明了主载体 ${carriers.value.primary}，但类型缺失或未知：${String(doc.kind)}`, { kind: doc.kind })
    }
    if (carriers.value.enabled.length) {
      return fail('PRIMARY_CARRIER_MISSING', `项目有启用板块却没有项目类型，请重新选择主载体`, { enabled: carriers.value.enabled })
    }
  }
  if (typeof doc.projectId !== 'string' || !doc.projectId.trim()) return fail('INVALID_INPUT', 'projectId 必填')
  if (typeof doc.name !== 'string' || !doc.name.trim() || doc.name.trim().length > 120) {
    return fail('INVALID_INPUT', '项目名称须是 1–120 字')
  }

  return ok({
    spec: PROJECT_SPEC,
    schemaVersion: 3,
    legacySpec: legacy ? doc.spec : null,
    projectId: doc.projectId.trim(),
    name: doc.name.trim(),
    kind: isKnownKind(doc.kind) ? doc.kind : null,
    createdAt: isoOrNow(doc.createdAt),
    updatedAt: isoOrNow(doc.updatedAt),
    carriers: carriers.value,
    needsPrimary: !carriers.value.primary
  })
}

export function buildProjectDocument({ projectId, name, kind, primaryCarrier, enabled = [], now = new Date().toISOString() }) {
  if (!isKnownKind(kind)) return fail('INVALID_INPUT', `未知项目类型：${String(kind)}`)
  if (!primaryCarrier) return fail('PRIMARY_CARRIER_MISSING', '建项目必须指定主载体（D1）')
  const enabledSet = [...new Set([primaryCarrier, ...enabled.filter((id) => id !== primaryCarrier)])]
  return ok({
    spec: PROJECT_SPEC,
    schemaVersion: 3,
    projectId: String(projectId),
    name: String(name).trim(),
    kind,
    createdAt: now,
    updatedAt: now,
    carriers: { primary: primaryCarrier, enabled: enabledSet, revision: 1 }
  })
}

/** 裸项目（M1 空框架形态）：只有 .pinax/ 与元数据，停在「选主载体」那一步。 */
export function buildBareProjectDocument({ projectId, name, now = new Date().toISOString() }) {
  if (typeof name !== 'string' || !name.trim()) return fail('INVALID_INPUT', '项目名称必填')
  return ok({
    spec: PROJECT_SPEC,
    schemaVersion: 3,
    projectId: String(projectId),
    name: name.trim(),
    kind: null,
    createdAt: now,
    updatedAt: now,
    carriers: { primary: null, enabled: [], revision: 0 }
  })
}

export function normalizeCarriers(value, { legacy = false } = {}) {
  if (value === undefined || value === null) {
    if (legacy) return ok({ primary: null, enabled: [], revision: 0, migrated: true })
    return fail('INVALID_INPUT', `${PROJECT_SPEC} 必须带 carriers（{primary,enabled,revision}）`)
  }
  if (!isPlainObject(value)) return fail('INVALID_INPUT', 'carriers 必须是对象')
  const enabled = Array.isArray(value.enabled) ? value.enabled.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()) : []
  const primary = typeof value.primary === 'string' && value.primary.trim() ? value.primary.trim() : null
  if (primary && !enabled.includes(primary)) {
    return fail('PRIMARY_CARRIER_NOT_ENABLED', `主载体 ${primary} 必须同时处于启用态（C7）`, { primary, enabled })
  }
  const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0
  return ok({ primary, enabled, revision })
}

/** 启停/切主载体的落盘：带 revision 乐观并发，冲突即拒。 */
export function nextCarriers(current, { primary = null, enabled = null, expectedRevision }) {
  const normalized = normalizeCarriers(current)
  if (!normalized.ok) return normalized
  if (Number.isSafeInteger(expectedRevision) && expectedRevision !== normalized.value.revision) {
    return fail('STALE_REVISION', `carriers 已推进到第 ${normalized.value.revision} 版，本次基于第 ${expectedRevision} 版的变更被拒绝`, {
      expected: expectedRevision, actual: normalized.value.revision
    })
  }
  const nextEnabled = Array.isArray(enabled) ? [...new Set(enabled.map((id) => String(id).trim()).filter(Boolean))] : normalized.value.enabled
  const nextPrimary = primary ?? normalized.value.primary
  if (nextPrimary && !nextEnabled.includes(nextPrimary)) {
    return fail('PRIMARY_CARRIER_NOT_ENABLED', `主载体 ${nextPrimary} 未启用，切换被拒绝`, { primary: nextPrimary, enabled: nextEnabled })
  }
  return ok({ primary: nextPrimary, enabled: nextEnabled, revision: normalized.value.revision + 1 })
}

export function projectMarkerPath(root) {
  return join(resolve(String(root || '')), METADATA_DIR, 'project.json')
}

export async function readProjectDocument(root) {
  let raw
  try {
    raw = await readFile(projectMarkerPath(root), 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return fail('INVALID_INPUT', `目标目录不是 pinax 项目（缺 ${METADATA_DIR}/project.json）`)
    return fail('IO_FAILED', `读取 project.json 失败`, { cause: String(error?.message || error) })
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return fail('INVALID_INPUT', `project.json 不是合法 JSON`, { cause: String(error?.message) })
  }
  return validateProjectDocument(parsed)
}

export async function writeProjectDocument(root, document) {
  const validated = document.spec === PROJECT_SPEC ? ok(document) : validateProjectDocument(document)
  if (!validated.ok) return validated
  const payload = {
    spec: PROJECT_SPEC,
    schemaVersion: 3,
    projectId: validated.value.projectId,
    name: validated.value.name,
    kind: validated.value.kind,
    createdAt: validated.value.createdAt,
    updatedAt: new Date().toISOString(),
    carriers: validated.value.carriers
  }
  try {
    await writeFileAtomic(projectMarkerPath(root), `${JSON.stringify(payload, null, 2)}\n`)
    return ok(payload)
  } catch (error) {
    return fail('IO_FAILED', '写入 project.json 失败', { cause: String(error?.message || error) })
  }
}

function isoOrNow(value) {
  if (typeof value !== 'string') return new Date().toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
