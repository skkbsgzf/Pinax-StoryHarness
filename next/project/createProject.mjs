import { mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'
import { ensureSkeleton, METADATA_DIR } from '../kernel/projectSkeleton.mjs'
import { resolveClosure } from '../kernel/capabilityGraph.mjs'
import { buildBareProjectDocument, buildProjectDocument, writeProjectDocument } from './projectManifest.mjs'

/**
 * 建项目（D1 主载体显式 ＋ R4 装齐依赖闭包）。
 * 目录 = 固化中文骨架 ∪ 每个启用板块自己认领的文件夹；只建不删。
 */
export async function createProject({ root, name, primaryCarrier, registry, extraEnabled = [], deps = {} }) {
  const prepared = await prepareRoot({ root, name, deps })
  if (!prepared.ok) return prepared
  const { projectRoot, makeDir } = prepared.value

  if (!primaryCarrier) {
    return fail('PRIMARY_CARRIER_MISSING', '建项目必须指定主载体：这个项目要创作小说还是剧本？（D1）')
  }
  const primary = registry.get(primaryCarrier)
  if (!primary) {
    return fail('PRIMARY_CARRIER_MISSING', `主载体插件未安装：${primaryCarrier}`, {
      installed: registry.list().map((item) => item.id),
      hint: registry.rejected.length ? `装载失败的插件：${registry.rejected.map((item) => item.pluginId).join(' / ')}` : null
    })
  }

  const closure = resolveClosure(registry.manifests(), [primaryCarrier, ...extraEnabled])
  if (closure.unresolvable.length) {
    return fail('DEPENDENCY_UNMET', `主载体 ${primary.title} 的依赖闭包装不齐，拒绝建项目（D4：宁可先拦住，也不留下「想玩游戏却没有剧本」的空壳）`, {
      primary: primaryCarrier,
      unresolvable: closure.unresolvable,
      repairs: [...new Set(closure.unresolvable.map((item) => item.fix).filter(Boolean))]
    })
  }

  const skeleton = ensureSkeleton(primary.primary.projectKind, projectRoot, {
    mkdirSync: (target) => makeDir(target, { recursive: true })
  })
  if (!skeleton.ok) return skeleton

  await makeMetadataDirs(projectRoot, makeDir)

  const pluginDirs = []
  for (const id of closure.enabled) {
    for (const dir of Object.values(registry.get(id).dataDirs)) {
      if (skeleton.value.dirs.includes(dir) || pluginDirs.some((item) => item.dir === dir)) continue
      await makeDir(join(projectRoot, dir), { recursive: true })
      pluginDirs.push({ pluginId: id, dir })
    }
  }

  const document = buildProjectDocument({
    projectId: makeProjectId(),
    name: name.trim(),
    kind: primary.primary.projectKind,
    primaryCarrier,
    enabled: closure.enabled
  })
  if (!document.ok) return document
  const written = await writeProjectDocument(projectRoot, document.value)
  if (!written.ok) return written

  return ok({
    root: projectRoot,
    document: written.value,
    dirs: { skeleton: skeleton.value.dirs, pluginRegistered: pluginDirs.map((item) => item.dir) },
    enabled: closure.enabled
  })
}

/** 空框架形态（M1 验收）：只落 .pinax/ 与元数据，停在选主载体那一步，不报错、不猜类型。 */
export async function initBareProject({ root, name, deps = {} }) {
  const prepared = await prepareRoot({ root, name, deps })
  if (!prepared.ok) return prepared
  const { projectRoot, makeDir } = prepared.value
  await makeMetadataDirs(projectRoot, makeDir)
  const document = buildBareProjectDocument({ projectId: makeProjectId(), name: name.trim() })
  if (!document.ok) return document
  const written = await writeProjectDocument(projectRoot, document.value)
  if (!written.ok) return written
  return ok({ root: projectRoot, document: written.value, needsPrimary: true, dirs: { skeleton: [], pluginRegistered: [] } })
}

async function prepareRoot({ root, name, deps }) {
  const projectRoot = resolve(String(root || ''))
  const list = deps.readdir || readdir
  const makeDir = deps.mkdir || mkdir
  if (typeof name !== 'string' || !name.trim()) return fail('INVALID_INPUT', '项目名称必填')
  try {
    const entries = await list(projectRoot)
    if (entries.length > 0) {
      return fail('INVALID_INPUT', `目标目录非空：${projectRoot}。新项目请指向空目录；已有稿子先走 pinax_project_import 映射再打开`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') return fail('IO_FAILED', '目标目录不可用', { cause: String(error?.message || error) })
    await makeDir(projectRoot, { recursive: true })
  }
  return ok({ projectRoot, makeDir })
}

async function makeMetadataDirs(projectRoot, makeDir) {
  await makeDir(join(projectRoot, METADATA_DIR), { recursive: true })
  await makeDir(join(projectRoot, METADATA_DIR, 'proposals'), { recursive: true })
  await makeDir(join(projectRoot, METADATA_DIR, 'state'), { recursive: true })
}

function makeProjectId() {
  return `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
