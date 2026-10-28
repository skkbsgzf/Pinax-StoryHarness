import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createRegistry } from '../kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from '../kernel/projectSkeleton.mjs'
import { createProject } from '../project/createProject.mjs'
import { FIXTURE_NOVEL } from '../testing/fixtures.mjs'
import { createTempWorkspace, pathExists } from '../testing/harness.mjs'
import {
  BACKUP_ERROR_CODES,
  BACKUP_MANIFEST_NAME,
  BACKUP_SCHEMA,
  exportProject,
  readBackupManifest,
  restoreProject
} from '../runtime/projectBackupService.mjs'

/**
 * 工单G2：备份与恢复（零新依赖，整目录复制）。
 * 证的五件事：导出确实把项目树拷全并写对 backup-manifest.json（文件数吻合、默认不含 history.git）；
 * includeHistory=true 时历史仓也进备份；恢复到空目录后文件与骨架目录都回齐、manifest 不落项目根；
 * 非空目标被 BACKUP_TARGET_NOT_EMPTY 拒（现稿一个字节不动）；无 manifest／schema 不符被 BACKUP_INVALID 拒。
 * 全部在 os.tmpdir() 的隔离工装目录里跑，不碰作者原稿与真实注册表。
 */

async function backupFixture(label) {
  const workspace = await createTempWorkspace(label)
  const root = join(workspace.projects, '备份靶子')
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  registry.install(FIXTURE_NOVEL)
  const created = await createProject({ root, name: '备份靶子', primaryCarrier: 'fixture.novel', registry })
  assert.equal(created.ok, true, JSON.stringify(created.error ?? {}))
  // 种子：正文／构思各一份；历史仓里放一个假 git 对象——真历史仓由主进程 gitHistory 建，
  // 这里只验「默认排除 .pinax/history.git」这条判据，不跑 git。
  await writeFile(join(root, '正文', '第001章-入场.md'), '雨从檐口滴下来。\n', 'utf-8')
  await writeFile(join(root, '构思', '雨夜的表.md'), '袖口的表停在十二点差三分。\n', 'utf-8')
  await mkdir(join(root, '.pinax', 'history.git', 'objects', 'ab'), { recursive: true })
  await writeFile(join(root, '.pinax', 'history.git', 'objects', 'ab', 'cdef'), 'git-object', 'utf-8')
  return { workspace, root, targetParent: join(workspace.base, '备份输出'), projectId: created.value.document.projectId }
}

/** 相对路径清单（排序）：断言「拷了什么」比断言计数更硬。 */
async function listFiles(dir, prefix = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...await listFiles(join(dir, entry.name), relative))
    else out.push(relative)
  }
  return out.sort()
}

test('导出：整目录复制到 <项目名>-backup-<时间戳>，backup-manifest 内容与文件数吻合，默认不含历史仓', async () => {
  const { workspace, root, targetParent, projectId } = await backupFixture('backup-export')
  try {
    const exported = await exportProject({ root, targetParent })
    assert.equal(exported.ok, true, JSON.stringify(exported.error ?? {}))
    assert.equal(String(exported.value.path).startsWith(join(targetParent, '备份靶子-backup-')), true, exported.value.path)
    assert.match(exported.value.path.split(/[\\/]/).pop(), /^备份靶子-backup-\d{8}-\d{6}(-\d+)?$/)
    assert.equal((await stat(exported.value.path)).isDirectory(), true, '备份目录真的落在磁盘上')

    const manifest = JSON.parse(await readFile(join(exported.value.path, BACKUP_MANIFEST_NAME), 'utf-8'))
    assert.equal(manifest.schema, BACKUP_SCHEMA)
    assert.equal(manifest.projectName, '备份靶子')
    assert.equal(manifest.projectId, projectId, 'projectId 取自 .pinax/project.json')
    assert.match(manifest.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    assert.equal(manifest.sourceRoot, root)
    assert.equal(manifest.includesHistory, false)
    assert.equal(manifest.fileCount, exported.value.fileCount)

    const files = await listFiles(exported.value.path)
    // 项目文件：.pinax/project.json ＋ 正文 ＋ 构思＝3；manifest 自身不算进 fileCount。
    assert.equal(exported.value.fileCount, 3, `实际清单：${files.join(' / ')}`)
    assert.equal(files.filter((file) => file !== BACKUP_MANIFEST_NAME).length, exported.value.fileCount)
    assert.ok(files.includes('正文/第001章-入场.md'))
    assert.ok(files.includes('构思/雨夜的表.md'))
    assert.ok(files.includes('.pinax/project.json'))
    assert.equal(files.some((file) => file.includes('history.git')), false, '默认不拷 .pinax/history.git（体积大头）')
    assert.ok(exported.value.bytes > 0, 'bytes 是真的拷过去的字节数')
    assert.equal((await stat(join(exported.value.path, '日志'))).isDirectory(), true, '空骨架目录也要跟着回')
  } finally {
    await workspace.cleanup()
  }
})

test('导出：includeHistory=true 时历史仓也进备份；同秒重复导出不覆盖上一份', async () => {
  const { workspace, root, targetParent } = await backupFixture('backup-history')
  try {
    const first = await exportProject({ root, targetParent })
    const second = await exportProject({ root, targetParent, includeHistory: true })
    assert.equal(first.ok, true, JSON.stringify(first.error ?? {}))
    assert.equal(second.ok, true, JSON.stringify(second.error ?? {}))
    assert.notEqual(first.value.path, second.value.path, '同一秒内重复导出要换一个目录，不覆盖上一份')
    assert.equal(pathExists(first.value.path), true)

    const manifest = JSON.parse(await readFile(join(second.value.path, BACKUP_MANIFEST_NAME), 'utf-8'))
    assert.equal(manifest.includesHistory, true)
    assert.equal(manifest.fileCount, 4, '多出来的那份就是 .pinax/history.git 里的对象')
    assert.equal(manifest.fileCount, second.value.fileCount)
    const files = await listFiles(second.value.path)
    assert.ok(files.includes('.pinax/history.git/objects/ab/cdef'), `实际清单：${files.join(' / ')}`)
    assert.equal(files.some((file) => file.startsWith('.pinax/history.git')), true)
  } finally {
    await workspace.cleanup()
  }
})

test('导出：备份位置落在项目目录里面直接拒（递归复制会把自己再拷一遍）', async () => {
  const { workspace, root } = await backupFixture('backup-inside')
  try {
    const inside = join(root, '备份')
    const refused = await exportProject({ root, targetParent: inside })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, BACKUP_ERROR_CODES.INVALID)
    assert.match(refused.error.message, /不能在项目目录里面/)
    assert.equal(pathExists(inside), false, '拒的时候一个目录都不建')

    const missing = await exportProject({ root: join(workspace.projects, '没有这个项目'), targetParent: join(workspace.base, 'out') })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, BACKUP_ERROR_CODES.INVALID)
    assert.match(missing.error.message, /不存在/)
  } finally {
    await workspace.cleanup()
  }
})

test('恢复：复制回不存在的空目录与已存在的空目录都行；文件回齐、manifest 不落项目根', async () => {
  const { workspace, root, targetParent } = await backupFixture('backup-restore')
  try {
    const exported = await exportProject({ root, targetParent })
    assert.equal(exported.ok, true, JSON.stringify(exported.error ?? {}))
    const before = await readFile(join(root, '.pinax', 'project.json'), 'utf-8')

    // ① 目标不存在：直接建出来。
    const targetRoot = join(workspace.projects, '恢复出来的项目')
    const restored = await restoreProject({ backupDir: exported.value.path, targetRoot })
    assert.equal(restored.ok, true, JSON.stringify(restored.error ?? {}))
    assert.equal(restored.value.root, targetRoot)
    assert.equal(await readFile(join(targetRoot, '正文', '第001章-入场.md'), 'utf-8'), '雨从檐口滴下来。\n')
    assert.equal(await readFile(join(targetRoot, '构思', '雨夜的表.md'), 'utf-8'), '袖口的表停在十二点差三分。\n')
    assert.equal(await readFile(join(targetRoot, '.pinax', 'project.json'), 'utf-8'), before, '项目合同原样回')
    assert.equal((await stat(join(targetRoot, '日志'))).isDirectory(), true, '空骨架目录也要建回来')
    assert.equal(pathExists(join(targetRoot, BACKUP_MANIFEST_NAME)), false, 'backup-manifest.json 是备份的凭据，不是项目文件')

    // ② 目标已存在但空：同样放行。
    const emptyDir = join(workspace.projects, '已建的空目录')
    await mkdir(emptyDir, { recursive: true })
    const intoEmpty = await restoreProject({ backupDir: exported.value.path, targetRoot: emptyDir })
    assert.equal(intoEmpty.ok, true, JSON.stringify(intoEmpty.error ?? {}))
    assert.equal(await readFile(join(emptyDir, '正文', '第001章-入场.md'), 'utf-8'), '雨从檐口滴下来。\n')
  } finally {
    await workspace.cleanup()
  }
})

test('恢复：非空目标被 BACKUP_TARGET_NOT_EMPTY 拒，现稿一个字节不动', async () => {
  const { workspace, root, targetParent } = await backupFixture('backup-dirty')
  try {
    const exported = await exportProject({ root, targetParent })
    const dirty = await workspace.dirtyDir('非空的恢复目标')
    const rejected = await restoreProject({ backupDir: exported.value.path, targetRoot: dirty })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.error.code, BACKUP_ERROR_CODES.TARGET_NOT_EMPTY)
    assert.match(rejected.error.message, /只支持空目录/)
    assert.equal(await readFile(join(dirty, '已存在', 'notes.md'), 'utf-8'), '外来内容', '拒绝时不覆盖、不删除目标里的东西')
    assert.deepEqual(await readdir(dirty), ['已存在'])
  } finally {
    await workspace.cleanup()
  }
})

test('恢复：无 backup-manifest.json 与 schema 不符都是 BACKUP_INVALID，且不创建目标目录', async () => {
  const { workspace, root, targetParent } = await backupFixture('backup-invalid')
  try {
    const exported = await exportProject({ root, targetParent })
    const noManifest = join(workspace.base, '不是备份')
    await mkdir(noManifest, { recursive: true })
    await writeFile(join(noManifest, '正文.md'), '这不是一份备份。\n', 'utf-8')
    const targetA = join(workspace.projects, '不该建出来的项目')
    const missing = await restoreProject({ backupDir: noManifest, targetRoot: targetA })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, BACKUP_ERROR_CODES.INVALID)
    assert.match(missing.error.message, new RegExp(BACKUP_MANIFEST_NAME))
    assert.equal(pathExists(targetA), false, '校验在写盘之前：目标目录不会被建出来')

    const wrongSchema = join(workspace.base, '坏清单备份')
    await mkdir(wrongSchema, { recursive: true })
    await writeFile(join(wrongSchema, BACKUP_MANIFEST_NAME), JSON.stringify({ schema: 'pinax-backup@0' }), 'utf-8')
    const mismatched = await restoreProject({ backupDir: wrongSchema, targetRoot: join(workspace.projects, '另一个不该建出来的项目') })
    assert.equal(mismatched.ok, false)
    assert.equal(mismatched.error.code, BACKUP_ERROR_CODES.INVALID)
    assert.match(mismatched.error.message, /schema 不匹配/)

    // 恢复区的「预检」：读一份真备份的 manifest，形状与导出时一致。
    const preview = await readBackupManifest({ backupDir: exported.value.path })
    assert.equal(preview.ok, true, JSON.stringify(preview.error ?? {}))
    assert.equal(preview.value.manifest.schema, BACKUP_SCHEMA)
    assert.equal(preview.value.manifest.projectName, '备份靶子')
  } finally {
    await workspace.cleanup()
  }
})
