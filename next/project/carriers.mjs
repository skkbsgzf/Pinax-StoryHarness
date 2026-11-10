import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'
import { METADATA_DIR } from '../kernel/projectSkeleton.mjs'
import { guessCapabilityByDir } from '../kernel/capabilities.vocab.mjs'
import { nextCarriers, readProjectDocument, writeProjectDocument } from './projectManifest.mjs'

/**
 * 启停与切主载体的落盘通道（D3/D5）。
 * 规则：闸门在前（registry 的闭包校验），落盘在后；停用只改 carriers.enabled，目录与文件永不删除。
 */
export async function setCarrierEnabled({ root, registry, pluginId, enabled, expectedRevision }) {
  const doc = await readProjectDocument(root)
  if (!doc.ok) return doc
  const gate = registry.setEnabled(pluginId, doc.value.carriers, enabled)
  if (!gate.ok) return gate
  const merged = nextCarriers(doc.value.carriers, { enabled: gate.value.enabled, expectedRevision })
  if (!merged.ok) return merged
  const document = { ...doc.value, carriers: merged.value }
  return writeProjectDocument(root, document)
}

export async function setPrimaryCarrier({ root, registry, pluginId, expectedRevision }) {
  const doc = await readProjectDocument(root)
  if (!doc.ok) return doc
  const gate = registry.setPrimary(pluginId, doc.value.carriers)
  if (!gate.ok) return gate
  const enabled = new Set(doc.value.carriers.enabled)
  enabled.add(pluginId)
  const merged = nextCarriers(doc.value.carriers, {
    primary: pluginId,
    enabled: [...enabled],
    expectedRevision
  })
  if (!merged.ok) return merged
  // 主载体决定项目类型（D1）：切主载体＝切 kind，但磁盘目录一个都不动（D5）。
  const document = { ...doc.value, kind: gate.value.kind ?? doc.value.kind, carriers: merged.value }
  const written = await writeProjectDocument(root, document)
  if (!written.ok) return written
  // 切主载体后重算视图；闭包已在前一步查过，不会坏数据（D5）。
  const activated = registry.activate(merged.value)
  if (!activated.ok) return activated
  return ok({ document: written.value, view: activated.value, kindChanged: written.value.kind !== doc.value.kind })
}

/**
 * 归档视图（D5）：磁盘上有、但没有任何启用板块认领的目录，一律只读展示。
 * 这里刻意不提供删除/改名接口——作者的稿子永远比代码活得久。
 */
export async function buildArchiveView({ root, view, deps = {} }) {
  const projectRoot = resolve(String(root || ''))
  const list = deps.readdir || readdir
  const owned = new Set(view?.dirs?.owned ?? [])
  const skeleton = new Set(view?.dirs?.skeleton ?? [])
  let entries
  try {
    entries = await list(projectRoot, { withFileTypes: true })
  } catch (error) {
    return fail('IO_FAILED', '读取项目根失败', { cause: String(error?.message || error) })
  }
  const archived = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === METADATA_DIR || entry.name.startsWith('.')) continue
    if (owned.has(entry.name)) continue
    const capability = guessCapabilityByDir(entry.name)
    let files = 0
    try {
      files = (await list(join(projectRoot, entry.name))).length
    } catch {
      files = 0
    }
    archived.push({
      dir: entry.name,
      files,
      inSkeleton: skeleton.has(entry.name),
      capability,
      readOnly: true,
      reason: capability
        ? `该目录承载「${capability}」能力，但当前没有启用中的插件认领它`
        : '该目录不在固化骨架里，也没有插件认领；按外来内容只读展示'
    })
  }
  return ok({ root: projectRoot, archived, owned: [...owned], skeleton: [...skeleton] })
}
