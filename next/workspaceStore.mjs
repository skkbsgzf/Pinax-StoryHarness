import { readFile, writeFile, mkdir, rename as renameFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 工作区状态的磁盘层（M2.5-C 任务一）：项目级 `.pinax/workspace.json`。
 *
 * 为什么归主进程：渲染层不该碰文件系统（通道合同第一条）。渲染层把整份状态交过来，
 * 这里只做三件事——读、写、记账；形状净化归 next/shell/workspace.mjs（纯函数，两边同一份）。
 *
 * 三条硬规矩：
 *   1) 坏文件不崩、不覆盖：读不懂就回空工作区并带 warnings，作者下次改形态时整份重写；
 *   2) 写盘先写 `.tmp` 再 rename（同目录 rename 是原子的），半个文件不会被读成「空工作区」；
 *   3) 内容没变就不写（拖动结束时可能连着发几次相同坐标），省盘也省历史噪音。
 */

export const WORKSPACE_DIR = '.pinax'
export const WORKSPACE_FILENAME = 'workspace.json'
export const WORKSPACE_VERSION = 1

export function workspacePath(root) {
  return join(String(root ?? ''), WORKSPACE_DIR, WORKSPACE_FILENAME)
}

function emptyValue(exists) {
  return { version: WORKSPACE_VERSION, entries: {}, warnings: [], exists }
}

/** 主进程侧的形状把关：不做逐条净化（那是渲染层 workspace.mjs 的活），只拒「根本不是工作区」的东西。
 *  条目里的字段一律原样透传——新增的加法字段（批次35 的 `pinned`，以后的同类）不在这里被洗掉，
 *  也不在这里校验（逐条净化只有一处：next/shell/workspace.mjs 的 normalizeEntry）。 */
function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: '工作区快照必须是对象' } }
  }
  if (snapshot.version !== WORKSPACE_VERSION) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: `工作区快照 version 必须是 ${WORKSPACE_VERSION}` } }
  }
  if (!snapshot.entries || typeof snapshot.entries !== 'object' || Array.isArray(snapshot.entries)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: '工作区快照 entries 必须是对象' } }
  }
  return { ok: true, value: { version: WORKSPACE_VERSION, entries: snapshot.entries } }
}

function parseStored(raw) {
  if (!raw || !raw.trim()) return emptyValue(true)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...emptyValue(true), warnings: ['WORKSPACE_BAD_JSON'] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...emptyValue(true), warnings: ['WORKSPACE_NOT_OBJECT'] }
  }
  const warnings = []
  if (parsed.version !== WORKSPACE_VERSION) warnings.push(`WORKSPACE_VERSION_${String(parsed.version)}`)
  const entries = parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries) ? parsed.entries : {}
  if (!parsed.entries) warnings.push('WORKSPACE_ENTRIES_MISSING')
  return { version: WORKSPACE_VERSION, entries, warnings, exists: true }
}

export function createFileWorkspaceStore({ root } = {}) {
  if (!root) throw new Error('createFileWorkspaceStore 需要项目根')
  const file = workspacePath(root)
  const tmpFile = `${file}.tmp`
  /** 串行化写盘：同一项目两次快速切换形态不该互相踩到临时文件。 */
  let queue = Promise.resolve()
  /** 上一次成功写盘的内容：相同就跳过（读回来时清空，确保外部改动后还能再写）。 */
  let lastWritten = null

  async function read() {
    try {
      const raw = await readFile(file, 'utf-8')
      const value = parseStored(raw)
      lastWritten = JSON.stringify({ version: value.version, entries: value.entries })
      return { ok: true, value }
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: true, value: emptyValue(false) }
      return { ok: true, value: { ...emptyValue(false), warnings: [`WORKSPACE_READ_FAILED_${String(error?.code ?? 'UNKNOWN')}`] } }
    }
  }

  async function write(snapshot) {
    const validated = validateSnapshot(snapshot)
    if (!validated.ok) return validated
    const text = JSON.stringify(validated.value, null, 2)
    const task = queue.then(async () => {
      if (lastWritten === text) return { ok: true, value: { file, skipped: true } }
      await mkdir(join(String(root), WORKSPACE_DIR), { recursive: true })
      await writeFile(tmpFile, text, 'utf-8')
      await renameFile(tmpFile, file)
      lastWritten = text
      return { ok: true, value: { file, skipped: false, bytes: Buffer.byteLength(text), entries: Object.keys(validated.value.entries).length } }
    })
    queue = task.then(() => undefined, () => undefined)
    return task.catch((error) => ({
      ok: false,
      error: { code: 'WORKSPACE_WRITE_FAILED', message: `工作区写盘失败：${String(error?.message ?? error)}` }
    }))
  }

  return { root: String(root), file, read, write }
}
