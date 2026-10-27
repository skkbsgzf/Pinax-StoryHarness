import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'
import { createFileService } from '../fs/fileService.mjs'
import { buildArchiveView } from './carriers.mjs'
import { readProjectDocument } from './projectManifest.mjs'

/**
 * 打开项目（本地优先：项目＝磁盘上的一个文件夹，`.pinax/` 为标记）。
 * 顺序固定：读合同 → 过闭包闸门 → 建板块目录 → 起文件服务 → 出归档视图。
 * 任何一步不过都返回带修复路径的失败载荷，外壳停在失败界面而不是白屏。
 */
export async function openProject({ root, registry, deps = {} }) {
  const projectRoot = resolve(String(root || ''))
  const makeDir = deps.mkdir || mkdir
  const document = await readProjectDocument(projectRoot)
  if (!document.ok) return document

  if (document.value.needsPrimary) {
    return fail('PRIMARY_CARRIER_MISSING', `《${document.value.name}》还没有主载体——请先选择「创作小说还是剧本」（D2：不猜、不回落）`, {
      root: projectRoot,
      kind: document.value.kind,
      installed: registry.list().map((item) => item.id)
    })
  }

  const activation = registry.activate(document.value.carriers)
  if (!activation.ok) {
    return fail(activation.error.code, activation.error.message, { ...activation.error.details, root: projectRoot })
  }

  for (const dir of activation.value.dirs.owned) {
    await makeDir(join(projectRoot, dir), { recursive: true })
  }

  const fileService = createFileService({ root: projectRoot, registry })
  const initialized = await fileService.init()
  if (!initialized.ok) return initialized

  const archive = await buildArchiveView({ root: projectRoot, view: activation.value, deps: { readdir: deps.readdir } })
  if (!archive.ok) return archive

  return ok({
    root: projectRoot,
    document: document.value,
    view: activation.value,
    fileService,
    archive: archive.value,
    rejectedPlugins: activation.value.rejected
  })
}
