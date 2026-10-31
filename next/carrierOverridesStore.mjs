import { readFile, writeFile, mkdir, rename as renameFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ok } from './kernel/errors.mjs'

/**
 * 工程级覆盖（批次54 · 任务①）：项目级 `.pinax/carrier-overrides.json`。
 *
 * 为什么单独一份：载体清单是「能力声明」，作者不该为了换一个端口去改插件文件；
 * 但覆盖只能改**值**，不能改声明——adopt／command／env／restart 这些结构性字段
 * 仍然只有清单说了算（否则「声明了却不生效」会从另一个方向重演）。
 *
 * 形状：{ version:1, overrides:{ <pluginId>:{ <paneId|serviceId|settingId>: 值 } } }
 *   服务值：{ port?, healthPath?, args? }
 *   应用面值：字符串（url）或 { url }
 *   设置值：标量（该设置的有效默认值）
 *
 * 合并序＝清单默认 → 工程覆盖（后写胜，只有两级）。调用方只从这里拿合并结果，
 * 不各自再写一份「先看清单再看覆盖」的顺序；覆盖来源用 source='override' 标出来。
 *
 * 三条硬规矩（与 workspaceStore／settingsStore 同款）：
 *   1) 坏文件不崩、不覆盖：读不懂就回空覆盖并记账，作者下次保存时整份重写；
 *   2) 写盘先写 `.tmp` 再 rename（同目录 rename 原子）；
 *   3) 内容没变就不写。
 * 另加一条：覆盖文件里出现 env／command／adopt／secret 之类字段一律拒写——
 * 覆盖不是第二条启用通道，也不是放密钥的地方。
 */

export const OVERRIDES_DIR = '.pinax'
export const OVERRIDES_FILENAME = 'carrier-overrides.json'
export const OVERRIDES_VERSION = 1

export const SERVICE_OVERRIDE_FIELDS = Object.freeze(['port', 'healthPath', 'args'])
export const PANE_OVERRIDE_FIELDS = Object.freeze(['url'])
/** 结构性字段：能出现在清单里，但覆盖文件写了也不生效（拒绝写入并记账）。 */
export const STRUCTURAL_OVERRIDE_KEYS = Object.freeze([
  'command',
  'cwd',
  'env',
  'adopt',
  'restart',
  'autostart',
  'pluginId',
  'dir',
  'secrets',
  'secret',
  'password',
  'token',
  'apiKey',
  'api_key'
])

export const OVERRIDE_SOURCE_LABELS = Object.freeze({
  stored: '项目设置',
  override: '工程覆盖',
  manifest: '清单默认',
  section: '分组节'
})

const APP_PANE_URL_MAX = 300
const OVERRIDE_PORT_MIN = 1
const OVERRIDE_PORT_MAX = 65_535
const OVERRIDE_ARGS_MAX = 32
const OVERRIDE_ARG_MAX = 400
const OVERRIDE_HEALTH_PATH_MAX = 200
const LOOPBACK_URL_PATTERN = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?(?:[/?#][^\s]*)?$/u

export function carrierOverridesPath(root) {
  return join(String(root ?? ''), OVERRIDES_DIR, OVERRIDES_FILENAME)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key)
}

function overridesFail(code, message, details) {
  const error = { code: `PINAX_${code}`, message }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, error }
}

function emptyValue(exists) {
  return { version: OVERRIDES_VERSION, overrides: {}, warnings: [], exists }
}

function parseStored(raw) {
  if (!raw || !raw.trim()) return emptyValue(true)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // eslint-disable-next-line no-console -- 主进程没有渲染层可报；坏档必须留痕
    console.error('[pinax-next] 工程覆盖文件不是合法 JSON：按空覆盖继续（下次保存整份重写）')
    return { ...emptyValue(true), warnings: ['OVERRIDES_BAD_JSON'] }
  }
  if (!isPlainObject(parsed)) {
    // eslint-disable-next-line no-console -- 同上
    console.error('[pinax-next] 工程覆盖文件根不是对象：按空覆盖继续（下次保存整份重写）')
    return { ...emptyValue(true), warnings: ['OVERRIDES_NOT_OBJECT'] }
  }
  const warnings = []
  if (parsed.version !== OVERRIDES_VERSION) warnings.push(`OVERRIDES_VERSION_${String(parsed.version)}`)
  const normalized = normalizeRootOverrides(parsed.overrides)
  warnings.push(...normalized.warnings)
  return { version: OVERRIDES_VERSION, overrides: normalized.overrides, warnings, exists: true }
}

/** 只做根形状净化：每条载体一个对象；具体字段类型由各消费点按自己的声明面校验。 */
function normalizeRootOverrides(value) {
  const overrides = {}
  const warnings = []
  if (value === undefined || value === null) return { overrides, warnings }
  if (!isPlainObject(value)) {
    warnings.push('OVERRIDES_ENTRIES_NOT_OBJECT')
    return { overrides, warnings }
  }
  for (const [pluginId, entries] of Object.entries(value)) {
    const id = String(pluginId ?? '').trim()
    if (!id) continue
    if (!isPlainObject(entries)) {
      warnings.push(`OVERRIDES_ENTRIES_NOT_OBJECT:${id}`)
      continue
    }
    overrides[id] = { ...entries }
  }
  return { overrides, warnings }
}

function structuralKeysIn(value) {
  if (!isPlainObject(value)) return []
  return Object.keys(value).filter((key) => STRUCTURAL_OVERRIDE_KEYS.includes(key))
}

function validateWrite(input) {
  if (!isPlainObject(input)) return overridesFail('OVERRIDES_INVALID_SHAPE', '工程覆盖必须是对象')
  const normalized = normalizeRootOverrides(input)
  if (normalized.warnings.length) {
    return overridesFail('OVERRIDES_INVALID_SHAPE', '工程覆盖的每个载体项都必须是对象', { warnings: normalized.warnings })
  }
  for (const [pluginId, entries] of Object.entries(normalized.overrides)) {
    for (const [targetId, value] of Object.entries(entries)) {
      const forbidden = structuralKeysIn(value)
      if (forbidden.length) {
        return overridesFail('OVERRIDE_FORBIDDEN_KEY', `工程覆盖 ${pluginId}/${targetId} 含不可覆盖的字段：${forbidden.join(' / ')}`, {
          pluginId, targetId, fields: forbidden
        })
      }
      if (value === undefined) {
        return overridesFail('OVERRIDES_INVALID_SHAPE', `工程覆盖 ${pluginId}/${targetId} 的值不能是 undefined`, { pluginId, targetId })
      }
    }
  }
  return { ok: true, value: { version: OVERRIDES_VERSION, overrides: normalized.overrides } }
}

function validateSettingNumber(declaration, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'SETTING_TYPE_MISMATCH'
  const min = Number.isFinite(declaration?.min) ? declaration.min : null
  const max = Number.isFinite(declaration?.max) ? declaration.max : null
  if (min !== null && value < min) return 'SETTING_OUT_OF_RANGE'
  if (max !== null && value > max) return 'SETTING_OUT_OF_RANGE'
  const step = Number.isFinite(declaration?.step) && declaration.step > 0 ? declaration.step : null
  if (step !== null) {
    const base = min ?? 0
    const ratio = (value - base) / step
    if (Math.abs(ratio - Math.round(ratio)) > 1e-9) return 'SETTING_STEP_MISMATCH'
  }
  return null
}

/**
 * 声明值域校验的唯一一份：设置写闸（settingsStore）与覆盖合并共用，
 * 避免「界面按 min/max 拦、主进程不拦」或反过来。返回错误码或 null。
 */
export function validateDeclaredValue(declaration, value) {
  const type = declaration?.type ?? 'section'
  if (type === 'section') return 'SETTING_SECTION_NO_VALUE'
  if (type === 'boolean') return typeof value === 'boolean' ? null : 'SETTING_TYPE_MISMATCH'
  if (type === 'number') return validateSettingNumber(declaration, value)
  if (type === 'string') return typeof value === 'string' ? null : 'SETTING_TYPE_MISMATCH'
  if (type === 'enum') {
    const options = Array.isArray(declaration?.options) ? declaration.options : []
    return options.includes(value) ? null : 'SETTING_TYPE_MISMATCH'
  }
  return 'SETTING_TYPE_UNSUPPORTED'
}

/**
 * 单个设置的有效值：项目设置（stored）> 工程覆盖 > 清单默认。
 * stored 由调用方先查；本函数只负责「覆盖 vs 默认」这一层，并返回来源标签。
 */
export function resolveSettingValue(declaration, override) {
  const type = declaration?.type ?? 'section'
  if (type === 'section') return { value: null, source: 'section', warnings: [] }
  const fallback = declaration?.default
  if (override === undefined) return { value: fallback, source: 'manifest', warnings: [] }
  const problem = validateDeclaredValue(declaration, override)
  if (problem) {
    return { value: fallback, source: 'manifest', warnings: [`${problem}:${String(declaration?.id ?? '')}`] }
  }
  return { value: override, source: 'override', warnings: [] }
}

/**
 * 有效设置表：{ carrierId: { settingId: { value, source, label, volatile } } }。
 * storedCarriers 是 `.pinax/settings.json` 的 carriers 映射，overrides 是工程覆盖的映射。
 */
export function buildEffectiveSettings(declarations, storedCarriers = {}, overrides = {}) {
  const effective = {}
  const warnings = []
  for (const [carrierId, list] of Object.entries(declarations ?? {})) {
    if (!Array.isArray(list)) continue
    const stored = isPlainObject(storedCarriers?.[carrierId]) ? storedCarriers[carrierId] : {}
    const carrierOverrides = isPlainObject(overrides?.[carrierId]) ? overrides[carrierId] : {}
    const row = {}
    for (const declaration of list) {
      if (!declaration?.id || declaration.type === 'section') continue
      let resolved
      if (hasOwn(stored, declaration.id)) {
        const problem = validateDeclaredValue(declaration, stored[declaration.id])
        if (problem) {
          warnings.push(`${problem}:${carrierId}/${declaration.id}`)
          resolved = resolveSettingValue(declaration, carrierOverrides[declaration.id])
          warnings.push(...resolved.warnings.map((warning) => `${warning}:${carrierId}/${declaration.id}`))
        } else {
          resolved = { value: stored[declaration.id], source: 'stored', warnings: [] }
        }
      } else {
        resolved = resolveSettingValue(declaration, carrierOverrides[declaration.id])
        warnings.push(...resolved.warnings.map((warning) => `${warning}:${carrierId}/${declaration.id}`))
      }
      row[declaration.id] = {
        value: resolved.value,
        source: resolved.source,
        label: OVERRIDE_SOURCE_LABELS[resolved.source] ?? resolved.source,
        volatile: declaration.volatile === true
      }
    }
    effective[carrierId] = row
  }
  return { effective, warnings }
}

/** 覆盖文件里某个服务的那一条（按 service id 取；不认识的 id 返回 undefined）。 */
export function serviceOverrideFor(overrides, pluginId, serviceId) {
  const entries = isPlainObject(overrides?.[pluginId]) ? overrides[pluginId] : null
  if (!entries || !hasOwn(entries, serviceId)) return undefined
  return entries[serviceId]
}

/**
 * 服务声明的合并：只认 port／healthPath／args；结构字段一律忽略并记账。
 * 返回 { spec, hits, warnings }，hits 是「哪些字段真的被覆盖了」的事实（状态面与诊断都读它）。
 */
export function applyServiceOverride(spec, override) {
  const merged = { ...(isPlainObject(spec) ? spec : {}) }
  const hits = []
  const warnings = []
  if (override === undefined) return { spec: merged, hits, warnings }
  if (!isPlainObject(override)) {
    warnings.push('OVERRIDE_NOT_OBJECT')
    return { spec: merged, hits, warnings }
  }
  for (const key of Object.keys(override)) {
    const value = override[key]
    if (STRUCTURAL_OVERRIDE_KEYS.includes(key)) {
      warnings.push(`OVERRIDE_STRUCTURAL_FIELD_IGNORED:${key}`)
      continue
    }
    if (!SERVICE_OVERRIDE_FIELDS.includes(key)) {
      warnings.push(`OVERRIDE_UNKNOWN_SERVICE_FIELD:${key}`)
      continue
    }
    if (key === 'port') {
      if (!Number.isSafeInteger(value) || value < OVERRIDE_PORT_MIN || value > OVERRIDE_PORT_MAX) {
        warnings.push('OVERRIDE_INVALID_PORT')
        continue
      }
      if (merged.port !== value) hits.push({ field: 'port', from: Number.isSafeInteger(merged.port) ? merged.port : null, to: value })
      merged.port = value
      continue
    }
    if (key === 'healthPath') {
      if (typeof value !== 'string' || !value.startsWith('/') || value.length > OVERRIDE_HEALTH_PATH_MAX) {
        warnings.push('OVERRIDE_INVALID_HEALTH_PATH')
        continue
      }
      if (merged.healthPath !== value) hits.push({ field: 'healthPath', from: merged.healthPath ?? null, to: value })
      merged.healthPath = value
      continue
    }
    if (key === 'args') {
      if (!Array.isArray(value) || value.length > OVERRIDE_ARGS_MAX || value.some((arg) => typeof arg !== 'string' || arg.length > OVERRIDE_ARG_MAX)) {
        warnings.push('OVERRIDE_INVALID_ARGS')
        continue
      }
      const before = JSON.stringify(Array.isArray(merged.args) ? merged.args : [])
      const after = JSON.stringify(value)
      if (before !== after) hits.push({ field: 'args', from: Array.isArray(merged.args) ? [...merged.args] : [], to: [...value] })
      merged.args = [...value]
    }
  }
  return { spec: merged, hits, warnings }
}

/** 批量合并：调用方给完整服务声明表，返回合并后的表与逐服务的命中记账。 */
export function applyServiceOverrides(services, overrides, { pluginId = null } = {}) {
  const out = []
  const warnings = []
  for (const service of Array.isArray(services) ? services : []) {
    const owner = String(service?.pluginId ?? pluginId ?? '')
    const override = serviceOverrideFor(overrides, owner, String(service?.id ?? ''))
    const applied = applyServiceOverride(service, override)
    out.push({ ...applied.spec, overrideFields: applied.hits.map((hit) => hit.field) })
    for (const warning of applied.warnings) warnings.push(`${owner}/${String(service?.id ?? '?')}:${warning}`)
  }
  return { services: out, warnings }
}

/**
 * 应用面 pane 的地址覆盖：只认 url。字符串与 { url } 两种写法都收，
 * 但都必须是本机回环 http/https——与清单校验同一条边界（内嵌浏览器不接外网）。
 */
export function applyPaneOverride(pane, override) {
  const base = isPlainObject(pane) ? pane : {}
  const manifestUrl = String(base?.app?.url ?? '')
  if (override === undefined) return { url: manifestUrl, source: 'manifest', warnings: [] }
  const warnings = []
  if (!(base.kind === 'external-app' || base.view === 'pinax.view.app')) {
    warnings.push('OVERRIDE_PANE_NOT_APP')
    return { url: manifestUrl, source: 'manifest', warnings }
  }
  const candidate = typeof override === 'string' ? override : isPlainObject(override) ? override.url : undefined
  if (typeof candidate !== 'string' || !candidate.trim()) {
    warnings.push('OVERRIDE_INVALID_PANE_URL')
    return { url: manifestUrl, source: 'manifest', warnings }
  }
  const url = candidate.trim()
  if (url.length > APP_PANE_URL_MAX || !LOOPBACK_URL_PATTERN.test(url)) {
    warnings.push('OVERRIDE_INVALID_PANE_URL')
    return { url: manifestUrl, source: 'manifest', warnings }
  }
  if (isPlainObject(override)) {
    for (const key of Object.keys(override)) {
      if (key !== 'url') warnings.push(`OVERRIDE_UNKNOWN_PANE_FIELD:${key}`)
    }
  }
  return { url, source: 'override', warnings }
}

/**
 * 设置 schema（离线诊断用）：把清单默认与工程覆盖合并后输出成 JSON Schema。
 * 只描述可写的设置项（section 是分组标题，不是值）；来源与 volatile 落在 x-pinax-* 扩展键里。
 */
export function buildSettingsSchema(manifests, overrides = {}) {
  const properties = {}
  const warnings = []
  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    const pluginId = String(manifest?.id ?? '')
    if (!pluginId) continue
    const declarations = Array.isArray(manifest?.settings)
      ? manifest.settings
      : Array.isArray(manifest?.contributes?.settings) ? manifest.contributes.settings : []
    const settingProperties = {}
    const carrierOverrides = isPlainObject(overrides?.[pluginId]) ? overrides[pluginId] : {}
    for (const declaration of declarations) {
      if (!declaration?.id || (declaration.type ?? 'section') === 'section') continue
      const resolved = resolveSettingValue(declaration, carrierOverrides[declaration.id])
      for (const warning of resolved.warnings) warnings.push(`${pluginId}/${declaration.id}:${warning}`)
      const property = {
        title: declaration.title ?? declaration.id,
        default: resolved.value,
        'x-pinax-source': resolved.source,
        'x-pinax-source-label': OVERRIDE_SOURCE_LABELS[resolved.source] ?? resolved.source,
        'x-pinax-volatile': declaration.volatile === true
      }
      if (declaration.type === 'number') {
        property.type = 'number'
        if (Number.isFinite(declaration.min)) property.minimum = declaration.min
        if (Number.isFinite(declaration.max)) property.maximum = declaration.max
        if (Number.isFinite(declaration.step) && declaration.step > 0) property.multipleOf = declaration.step
      } else if (declaration.type === 'boolean') {
        property.type = 'boolean'
      } else if (declaration.type === 'string') {
        property.type = 'string'
      } else if (declaration.type === 'enum') {
        property.enum = [...(declaration.options ?? [])]
        const kinds = new Set(property.enum.map((option) => typeof option))
        if (kinds.size === 1) property.type = [...kinds][0] === 'boolean' ? 'boolean' : [...kinds][0] === 'number' ? 'number' : 'string'
      }
      settingProperties[declaration.id] = property
    }
    properties[pluginId] = {
      type: 'object',
      title: manifest.title ?? pluginId,
      properties: settingProperties,
      additionalProperties: false
    }
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Pinax 项目配置（清单默认 → 工程覆盖）',
    type: 'object',
    properties,
    'x-pinax-layers': ['manifest', 'override'],
    warnings
  }
}

/** 同步读（监督器在装配期要用；坏档照旧回空并记账，绝不抛）。 */
export function readCarrierOverridesSync(root) {
  if (!root) return emptyValue(false)
  try {
    const raw = readFileSync(carrierOverridesPath(root), 'utf-8')
    return parseStored(raw)
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyValue(false)
    return { ...emptyValue(false), warnings: [`OVERRIDES_READ_FAILED_${String(error?.code ?? 'UNKNOWN')}`] }
  }
}

export function createFileCarrierOverridesStore({ root } = {}) {
  if (!root) throw new Error('createFileCarrierOverridesStore 需要项目根')
  const file = carrierOverridesPath(root)
  const tmpFile = `${file}.tmp`
  let queue = Promise.resolve()
  let lastWritten = null

  async function read() {
    try {
      const raw = await readFile(file, 'utf-8')
      const value = parseStored(raw)
      // 与写盘用同一份序列化（含缩进），否则「内容没变不写」永远不会命。
      lastWritten = JSON.stringify({ version: value.version, overrides: value.overrides }, null, 2)
      return ok(value)
    } catch (error) {
      if (error?.code === 'ENOENT') return ok(emptyValue(false))
      return ok({ ...emptyValue(false), warnings: [`OVERRIDES_READ_FAILED_${String(error?.code ?? 'UNKNOWN')}`] })
    }
  }

  async function persistOverrides(overrides) {
    const text = JSON.stringify({ version: OVERRIDES_VERSION, overrides }, null, 2)
    if (lastWritten === text) return ok({ file, skipped: true })
    try {
      await mkdir(join(String(root), OVERRIDES_DIR), { recursive: true })
      await writeFile(tmpFile, text, 'utf-8')
      await renameFile(tmpFile, file)
      lastWritten = text
      return ok({ file, skipped: false, bytes: Buffer.byteLength(text) })
    } catch (error) {
      return overridesFail('OVERRIDES_WRITE_FAILED', `工程覆盖写盘失败：${String(error?.message ?? error)}`)
    }
  }

  /** 整份替换（作者编辑后的落盘口）：形状不过、含结构字段的都拒，一个字节不写。 */
  async function write(overrides) {
    const validated = validateWrite(overrides)
    if (!validated.ok) return validated
    const task = queue.then(() => persistOverrides(validated.value.overrides))
    queue = task.then(() => undefined, () => undefined)
    return task
  }

  /** 单值写入：读改写只在队列内做，别的载体与同载体其它键原样保留。 */
  async function set(pluginId, targetId, value) {
    const carrier = String(pluginId ?? '').trim()
    const target = String(targetId ?? '').trim()
    if (!carrier || !target) return overridesFail('INVALID_INPUT', '工程覆盖写入需要给出载体 id 与目标 id')
    const forbidden = structuralKeysIn(value)
    if (forbidden.length) {
      return overridesFail('OVERRIDE_FORBIDDEN_KEY', `工程覆盖不允许改结构字段：${forbidden.join(' / ')}`, { pluginId: carrier, targetId: target, fields: forbidden })
    }
    if (value === undefined) return overridesFail('INVALID_INPUT', '工程覆盖的值不能是 undefined')
    const task = queue.then(async () => {
      const current = await read()
      const overrides = { ...(current.ok ? current.value.overrides : {}) }
      overrides[carrier] = {
        ...(isPlainObject(overrides[carrier]) ? overrides[carrier] : {}),
        [target]: value
      }
      const written = await persistOverrides(overrides)
      if (!written.ok) return written
      return ok({ ...written.value, pluginId: carrier, targetId: target, value })
    })
    queue = task.then(() => undefined, () => undefined)
    return task
  }

  async function remove(pluginId, targetId) {
    const carrier = String(pluginId ?? '').trim()
    const target = String(targetId ?? '').trim()
    if (!carrier || !target) return overridesFail('INVALID_INPUT', '工程覆盖删除需要给出载体 id 与目标 id')
    const task = queue.then(async () => {
      const current = await read()
      const overrides = { ...(current.ok ? current.value.overrides : {}) }
      if (isPlainObject(overrides[carrier]) && hasOwn(overrides[carrier], target)) {
        const entries = { ...overrides[carrier] }
        delete entries[target]
        if (Object.keys(entries).length) overrides[carrier] = entries
        else delete overrides[carrier]
      }
      const written = await persistOverrides(overrides)
      return written.ok ? ok({ ...written.value, pluginId: carrier, targetId: target }) : written
    })
    queue = task.then(() => undefined, () => undefined)
    return task
  }

  return { root: String(root), file, read, write, set, remove }
}
