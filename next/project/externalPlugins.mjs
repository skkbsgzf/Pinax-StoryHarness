import { existsSync } from 'node:fs'
import { mkdir, readFile, rename } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { fail, ok } from '../kernel/errors.mjs'
import { METADATA_DIR } from '../kernel/projectSkeleton.mjs'
import { loadDeclarativeFromDir } from '../kernel/pluginLoader.mjs'
import { writeFileAtomic } from '../fs/atomicWrite.mjs'
import { nextCarriers, readProjectDocument, writeProjectDocument } from './projectManifest.mjs'

/**
 * 批次65a · 外部声明型插件的项目层接线（打开路径触发装载 ＋ 卸载移 .trash）。
 *
 * 三个事实源，各司其职：
 *   `.pinax/plugins/<id>/manifest.json` —— 插件本体（声明型，见 kernel/pluginLoader.mjs）；
 *   `.pinax/plugins/ledger.json` —— 内核账本：哪些 id 曾从盘上成功装载过。它只回答「是不是新插件」，
 *     不存启停状态——启停的唯一真源仍是 project.json 的 carriers.enabled（C7 不双写）；
 *   `project.json` 的 carriers.enabled —— 启停落盘，走 nextCarriers 乐观并发，revision 照加。
 * 为什么要 ledger：没有它，「作者停用过的外部插件」在下次打开时会被当成新插件重新塞回 enabled，
 * 停用等于没停；有了它，「新装自动启用、停用保持停用」两种意图才分得开。
 *
 * 落盘时机：打开路径里注册新 id 会写 project.json——与批次16「@1 文档打开即升代」同一先例：
 * 这是结构登记（新板块进启用集），不是猜默认值。写失败就带着失败载荷返回，不带半截状态继续开。
 */

export const EXTERNAL_PLUGINS_SUBDIR = join(METADATA_DIR, 'plugins')
export const LEDGER_FILENAME = 'ledger.json'
export const LEDGER_VERSION = 1
export const TRASH_DIRNAME = '.trash'

export function externalPluginsDir(root) {
  return join(resolve(String(root ?? '')), METADATA_DIR, 'plugins')
}

/** 账本只管 plugins 目录里出现过的 id：读不懂按空账（下次整份重写），绝不崩打开路径。 */
async function readLedger(pluginsDir) {
  let raw
  try {
    raw = await readFile(join(pluginsDir, LEDGER_FILENAME), 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: LEDGER_VERSION, ids: [] }
    return { version: LEDGER_VERSION, ids: [], unreadable: String(error?.message ?? error) }
  }
  try {
    const parsed = JSON.parse(raw)
    const ids = Array.isArray(parsed?.ids) ? [...new Set(parsed.ids.filter((id) => typeof id === 'string' && id))] : []
    return { version: LEDGER_VERSION, ids }
  } catch {
    return { version: LEDGER_VERSION, ids: [], unreadable: '账本不是合法 JSON：按空账继续，本次装载重写整份' }
  }
}

async function writeLedger(pluginsDir, ids) {
  await writeFileAtomic(join(pluginsDir, LEDGER_FILENAME), `${JSON.stringify({ version: LEDGER_VERSION, ids }, null, 2)}\n`)
}

/**
 * 目录冲突预判：candidate 的 dataDirs 若被启用集中另一块板块认领，自动启用会把 activate 的
 * DIR_CONFLICT 闸撞响——那是整项目打不开的量级。所以自动启用前逐块核：撞了就不自动启用，
 * 记一条 note（作者处理完冲突可在载体管理面板手动启用，那条链自带同一道闸）。
 */
function dirConflictWithEnabled(registry, enabledIds, candidateId) {
  const candidate = registry.get(candidateId)
  if (!candidate) return null
  const mine = new Set(Object.values(candidate.dataDirs ?? {}))
  for (const id of enabledIds) {
    if (id === candidateId) continue
    const other = registry.get(id)
    for (const dir of Object.values(other?.dataDirs ?? {})) {
      if (mine.has(dir)) return { dir, holder: id }
    }
  }
  return null
}

/**
 * 打开路径入口：装载声明型插件 → 新 id 登记进 ledger → 未登记过的新插件自动启用并落盘。
 * 单份坏清单只进 skipped 账，不挡开项目（故障隔离口径与 M1 验收第 6 条一致）。
 * document 必须是已过 validateProjectDocument 的那份（openProject 在主载体闸之后调用，kind/primary 都在）。
 */
export async function registerExternalPluginsOnOpen(root, registry, document) {
  const projectRoot = resolve(String(root ?? ''))
  const pluginsDir = externalPluginsDir(projectRoot)
  const run = await loadDeclarativeFromDir(pluginsDir, { registry })
  if (!run.loaded.length && !run.skipped.length) {
    // 目录不存在或空货架：不建文件、不动 project.json，打开路径零副作用。
    return ok({ carriers: document.carriers, external: { loaded: [], skipped: [], addedToEnabled: [], notes: [] } })
  }
  const ledger = await readLedger(pluginsDir)
  const known = new Set(ledger.ids)
  const notes = []
  const addedToEnabled = []
  if (ledger.unreadable) notes.push({ code: 'LEDGER_RESET', reason: String(ledger.unreadable) })

  const enabled = [...document.carriers.enabled]
  // 自动启用按 id 字典序逐条裁决：readdir 顺序不保证（换文件系统就变），
  // 而「地盘冲突时谁先占上」必须是一个可复现的答案——与 claims 裁决同一个「同样的清单永远得到同样的赢家」纪律。
  for (const entry of [...run.loaded].sort((a, b) => (a.carrierId < b.carrierId ? -1 : 1))) {
    if (entry.alreadyInstalled || known.has(entry.carrierId)) continue
    known.add(entry.carrierId)
    // project.json 本来就启用了它（作者建项目时就写了 id）：只补账本，不重复登记、不算自动启用。
    if (enabled.includes(entry.carrierId)) continue
    const conflict = dirConflictWithEnabled(registry, enabled, entry.carrierId)
    if (conflict) {
      notes.push({
        pluginId: entry.carrierId,
        code: 'DIR_CONFLICT_NOT_ENABLED',
        reason: `目录「${conflict.dir}」已被启用中的「${conflict.holder}」认领：不自动启用，处理冲突后请在载体管理面板手动启用`
      })
    } else {
      enabled.push(entry.carrierId)
      addedToEnabled.push(entry.carrierId)
    }
  }

  let carriers = document.carriers
  if (addedToEnabled.length) {
    const next = nextCarriers(carriers, { enabled })
    if (!next.ok) return next
    const persisted = await writeProjectDocument(projectRoot, { ...document, carriers: next.value })
    if (!persisted.ok) return persisted
    carriers = persisted.value.carriers
  }

  // 账本修剪：只剪「盘上目录已不存在」的 id（目录删了/卸载了）。
  // 本次拒装（manifest 坏/校验拒）但目录还在的，账必须留着——否则作者修好清单后
  // 会被当「新插件」自动启用，击穿「停用过保持停用」（批次65a 评审补刀）。
  const prunedIds = [...known].filter((id) => {
    if (registry.get(id) !== null) return true
    try { return existsSync(join(pluginsDir, id)) } catch { return true }
  })
  const changed = prunedIds.length !== ledger.ids.length || prunedIds.some((id) => !ledger.ids.includes(id))
  if (changed || ledger.unreadable) await writeLedger(pluginsDir, prunedIds)

  return ok({
    carriers,
    external: {
      loaded: run.loaded.map((entry) => entry.carrierId),
      skipped: run.skipped,
      addedToEnabled,
      notes
    }
  })
}

/**
 * 卸载＝目录移进 `.pinax/plugins/.trash/<时间戳>/<id>`，不是真删——作者数据安全的下限：
 * 目录里可能有作者放的素材，删错一次不可逆，挪进回收站永远还能拿回来。
 * 链序：先验形态（只动 .pinax/plugins 直下的一层目录；主载体不许卸）→ registry.uninstall
 * → 跑完 dispose 链才动盘 → 再收 ledger 与 enabled（停用状态从 project.json 摘掉，走同一条乐观并发）。
 */
export async function uninstallExternalPlugin(root, registry, pluginId, { deps = {} } = {}) {
  const projectRoot = resolve(String(root ?? ''))
  const id = String(pluginId ?? '')
  const move = deps.rename || rename
  const makeDir = deps.mkdir || mkdir
  if (!registry.get(id)) return fail('INVALID_INPUT', `卸载对象不在注册表里：${id}`, { pluginId: id })
  const pluginsDir = externalPluginsDir(projectRoot)
  const dir = registry.dirOf(id)
  if (!dir) return fail('INVALID_INPUT', `插件「${id}」没有登记安装目录，无法卸载`, { pluginId: id })
  const rel = resolve(dir).slice(resolve(pluginsDir).length + sep.length)
  if (!resolve(dir).startsWith(resolve(pluginsDir) + sep) || rel.includes(sep)) {
    return fail('INVALID_INPUT', `只允许卸载 ${EXTERNAL_PLUGINS_SUBDIR}/ 直下的外部插件；内置载体不归本通道管`, { pluginId: id, dir })
  }
  const document = await readProjectDocument(projectRoot)
  if (!document.ok) return document
  if (document.value.carriers.primary === id) {
    return fail('PRIMARY_CARRIER_MISSING', `「${id}」是本项目主载体：先切换主载体，再卸载`, { pluginId: id })
  }

  const removed = registry.uninstall(id)
  if (!removed.ok) return removed

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/u, 'Z')
  let trashTarget = join(pluginsDir, TRASH_DIRNAME, stamp, rel)
  let moved = false
  for (let attempt = 0; attempt < 60 && !moved; attempt += 1) {
    try {
      await makeDir(join(trashTarget, '..'), { recursive: true })
      await move(dir, trashTarget)
      moved = true
    } catch (error) {
      // 同一秒里连续卸载两个插件会撞同名回收站目录：EEXIST 就换个后缀再试，其余错误如实报。
      if (error?.code !== 'EEXIST') {
        return fail('IO_FAILED', `卸载已生效但目录没进回收站：${String(error?.message ?? error)}`, { pluginId: id })
      }
      trashTarget = join(pluginsDir, TRASH_DIRNAME, `${stamp}-${attempt + 1}`, rel)
    }
  }
  if (!moved) return fail('IO_FAILED', `卸载已生效但目录没进回收站：重试 60 次仍撞名`, { pluginId: id })

  const ledger = await readLedger(pluginsDir)
  await writeLedger(pluginsDir, ledger.ids.filter((ledgerId) => ledgerId !== id))

  let carriers = document.value.carriers
  if (carriers.enabled.includes(id)) {
    const next = nextCarriers(carriers, { enabled: carriers.enabled.filter((enabledId) => enabledId !== id) })
    if (!next.ok) return next
    const persisted = await writeProjectDocument(projectRoot, { ...document.value, carriers: next.value })
    if (!persisted.ok) return persisted
    carriers = persisted.value.carriers
  }
  return ok({ pluginId: id, trashPath: trashTarget, disposed: removed.value.disposed, carriers })
}
