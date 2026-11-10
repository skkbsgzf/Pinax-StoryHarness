import { readFile, writeFile, mkdir, rename as renameFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ok } from './kernel/errors.mjs'
import { buildEffectiveSettings, readCarrierOverridesSync, validateDeclaredValue } from './carrierOverridesStore.mjs'

/**
 * 每插件配置命名空间（批次45 · 任务③）：项目级 `.pinax/settings.json`。
 *
 * 形状：{ version:1, carriers:{ <carrierId>:{ <settingId>: value } } }。
 * 为什么每载体一个对象：声明 id 只在载体自己的命名空间里唯一（载体可各有一个 `density`），
 * 平铺到顶层会撞名；载体前缀是目录键，这份文件跟着同一个前缀走。
 *
 * 三条硬规矩（与 workspaceStore 同款）：
 *   1) 坏文件不崩、不覆盖：读不懂就回空配置并按 console 记账，作者下次保存时整份重写；
 *   2) 写盘先写 `.tmp` 再 rename（同目录 rename 原子），半个文件不会被读成「空配置」；
 *   3) 内容没变就不写。
 *
 * 写入只有一个闸：set(carrierId, settingId, value)。只认清单里声明过的 id，
 * 并按声明类型校验——未声明即拒、类型不符即拒、section 不存值。拒的时候一个字节都不落盘。
 * 声明从注册表现取（main.mjs 传入 getter），不在本模块复制第二份清单。
 */

export const SETTINGS_DIR = '.pinax'
export const SETTINGS_FILENAME = 'settings.json'
export const SETTINGS_VERSION = 1

export function settingsPath(root) {
  return join(String(root ?? ''), SETTINGS_DIR, SETTINGS_FILENAME)
}

/** 从注册表收「载体 → 声明列表」表；getter 形式让运行期新增的插件也能被写闸认到。 */
export function collectSettingDeclarations(registry) {
  const declarations = {}
  for (const manifest of registry?.list?.() ?? []) {
    if (Array.isArray(manifest?.settings)) declarations[manifest.id] = manifest.settings
  }
  return declarations
}

/** 设置域的错误壳：沿用 PINAX_ 前缀，但码表归本模块（NEXT_ERROR_CODES 不收录配置域的细分码）。 */
function settingsFail(code, message, details) {
  const error = { code: `PINAX_${code}`, message }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, error }
}

function emptyValue(exists) {
  return { version: SETTINGS_VERSION, carriers: {}, warnings: [], exists }
}

function parseStored(raw) {
  if (!raw || !raw.trim()) return emptyValue(true)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // eslint-disable-next-line no-console -- 主进程没有渲染层可报；坏档必须留痕
    console.error('[pinax-next] 设置文件不是合法 JSON：按空配置继续（下次保存整份重写）')
    return { ...emptyValue(true), warnings: ['SETTINGS_BAD_JSON'] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // eslint-disable-next-line no-console -- 同上
    console.error('[pinax-next] 设置文件根不是对象：按空配置继续（下次保存整份重写）')
    return { ...emptyValue(true), warnings: ['SETTINGS_NOT_OBJECT'] }
  }
  const warnings = []
  if (parsed.version !== SETTINGS_VERSION) warnings.push(`SETTINGS_VERSION_${String(parsed.version)}`)
  const carriers = parsed.carriers && typeof parsed.carriers === 'object' && !Array.isArray(parsed.carriers)
    ? parsed.carriers
    : {}
  if (!parsed.carriers) warnings.push('SETTINGS_CARRIERS_MISSING')
  return { version: SETTINGS_VERSION, carriers, warnings, exists: true }
}

/**
 * 声明值域校验：只做「声明说什么就收什么」，不替作者猜单位或取整。
 * 批次54：number 的 min/max/step 在这里真正拦住——界面只是提前挡，主进程这道闸才是准。
 */
function validateValue(declaration, value) {
  const problem = validateDeclaredValue(declaration, value)
  if (!problem) return ok(value)
  const id = String(declaration?.id ?? '')
  if (problem === 'SETTING_SECTION_NO_VALUE') {
    return settingsFail('SETTING_SECTION_NO_VALUE', `设置「${id}」是分组节，不直接存值`)
  }
  if (problem === 'SETTING_OUT_OF_RANGE') {
    const min = Number.isFinite(declaration?.min) ? declaration.min : '-∞'
    const max = Number.isFinite(declaration?.max) ? declaration.max : '+∞'
    return settingsFail('SETTING_OUT_OF_RANGE', `设置「${id}」须在 ${min}–${max} 之间`, { value })
  }
  if (problem === 'SETTING_STEP_MISMATCH') {
    return settingsFail('SETTING_STEP_MISMATCH', `设置「${id}」的值未对齐步长 ${declaration?.step}`, { value })
  }
  if (problem === 'SETTING_TYPE_UNSUPPORTED') {
    return settingsFail('SETTING_TYPE_UNSUPPORTED', `设置「${id}」的声明类型不受支持：${String(declaration?.type)}`)
  }
  const expected = declaration?.type === 'number' ? '有限数字' : declaration?.type === 'boolean' ? '布尔值' : declaration?.type === 'string' ? '字符串' : '声明的 options 里的值'
  return settingsFail('SETTING_TYPE_MISMATCH', `设置「${id}」需要${expected}`, { value })
}

export function createFileSettingsStore({ root, declarations = {} } = {}) {
  if (!root) throw new Error('createFileSettingsStore 需要项目根')
  const file = settingsPath(root)
  const tmpFile = `${file}.tmp`
  let queue = Promise.resolve()
  let lastWritten = null

  function declarationTable() {
    return typeof declarations === 'function' ? declarations() : declarations
  }

  function declarationFor(carrierId, settingId) {
    const list = declarationTable()?.[String(carrierId ?? '')]
    if (!Array.isArray(list)) return null
    return list.find((item) => item?.id === settingId) ?? null
  }

  /**
   * 读全量：carriers 仍是 `.pinax/settings.json` 的原文（写闸与迁移都以它为准），
   * 另附 effective＝「项目设置 → 工程覆盖 → 清单默认」的有效值与来源层（批次54）。
   * 覆盖文件的坏档记账一起并进 warnings，界面与 doctor 都能解释值是从哪一层来的。
   */
  async function read() {
    let value
    try {
      const raw = await readFile(file, 'utf-8')
      value = parseStored(raw)
      // 与写盘用同一份序列化（含缩进），否则 read 之后「内容没变不写」永远不会命。
      lastWritten = JSON.stringify({ version: value.version, carriers: value.carriers }, null, 2)
    } catch (error) {
      value = error?.code === 'ENOENT'
        ? emptyValue(false)
        : { ...emptyValue(false), warnings: [`SETTINGS_READ_FAILED_${String(error?.code ?? 'UNKNOWN')}`] }
    }
    const overrideState = readCarrierOverridesSync(root)
    const effectiveState = buildEffectiveSettings(declarationTable(), value.carriers, overrideState.overrides)
    return ok({
      ...value,
      overrides: overrideState.overrides,
      effective: effectiveState.effective,
      warnings: [...value.warnings, ...overrideState.warnings, ...effectiveState.warnings]
    })
  }

  /** 真正落盘的那一步：只由 set 在队列内调用（不要自己再排一次队，会自锁）。 */
  async function persistCarriers(carriers) {
    const text = JSON.stringify({ version: SETTINGS_VERSION, carriers }, null, 2)
    if (lastWritten === text) return ok({ file, skipped: true })
    try {
      await mkdir(join(String(root), SETTINGS_DIR), { recursive: true })
      await writeFile(tmpFile, text, 'utf-8')
      await renameFile(tmpFile, file)
      lastWritten = text
      return ok({ file, skipped: false, bytes: Buffer.byteLength(text) })
    } catch (error) {
      return settingsFail('SETTINGS_WRITE_FAILED', `设置写盘失败：${String(error?.message ?? error)}`)
    }
  }

  /**
   * 写入闸：未声明 / 类型不符 / section 都拒且不落盘；通过后在队列里读改写，
   * 只动目标 carrier 的那一个键，别的载体与同载体其它键原样保留。
   */
  async function set(carrierId, settingId, value) {
    const carrier = String(carrierId ?? '').trim()
    const setting = String(settingId ?? '').trim()
    if (!carrier || !setting) return settingsFail('INVALID_INPUT', '设置写入需要给出载体 id 与设置 id')
    const declaration = declarationFor(carrier, setting)
    if (!declaration) {
      return settingsFail('SETTING_NOT_DECLARED', `载体「${carrier}」没有声明设置「${setting}」：不写盘`, { carrierId: carrier, settingId: setting })
    }
    const validated = validateValue(declaration, value)
    if (!validated.ok) return validated
    // 批次54：只有声明了 volatile 的字段才允许 GUI 写；其余的只读展示，
    // 要改默认值请走工程覆盖（那份文件改的是「默认值」，不是第二条设置库）。
    if (declaration.volatile !== true) {
      return settingsFail('SETTING_NOT_VOLATILE', `设置「${setting}」只读：清单未标 volatile（要改默认值请用工程覆盖）`, {
        carrierId: carrier,
        settingId: setting
      })
    }

    const task = queue.then(async () => {
      const current = await read()
      const carriers = { ...(current.ok ? current.value.carriers : {}) }
      carriers[carrier] = { ...(carriers[carrier] && typeof carriers[carrier] === 'object' ? carriers[carrier] : {}), [setting]: value }
      const written = await persistCarriers(carriers)
      if (!written.ok) return written
      return ok({ ...written.value, carrierId: carrier, settingId: setting, value })
    })
    queue = task.then(() => undefined, () => undefined)
    return task
  }

  return { root: String(root), file, read, set, declarationFor }
}
