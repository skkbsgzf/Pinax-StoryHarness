import { fail, ok, NEXT_ERROR_CODES } from '../kernel/errors.mjs'
import { MENU_TEMPLATE, flattenMenuIds } from './menus.mjs'
import { RESERVED_SLOTS, orderActivityItems } from './slots.mjs'
import { RUNTIME_CONTRACT } from '../runtime/runtimeContract.mjs'

/**
 * 渲染进程 ↔ 主进程的唯一通道合同（WP4）。
 * 三条硬规矩都写成数据，门禁和单测都按这份核：
 *   1) 渲染层只能调这里的通道，调不到内核实现——所以「插件绕过外壳直接写盘」在通道层就不成立；
 *   2) 通道一律 `pinax:agent:*` 命名空间，运行时（一级公民）占主干，载体的动作全走 `carrier.*`；
 *   3) 每个通道返回的是内核的结果对象（{ok,...} 或失败载荷），失败原样透传给界面渲染，不吞错、不白屏。
 */
export const IPC_NAMESPACE = 'pinax:agent:'

/**
 * 渲染层 → 主进程的通知通道（收口包⑤）：语义是「这件事已经发生了」，不是请求-应答。
 * 渲染层发完就走、不等业务数据；主进程侧只做副作用（重设原生窗控浮层），不写偏好、不进 onPrefsApplied。
 *
 * 为什么仍收进 IPC_CHANNELS：preload 的请求白名单只从这一张表取（preload.mjs 的 ALLOWED_REQUEST），
 * 而本工单的文件面不含 preload；放进同一张表＝不需要动桥就能发。名字与注释把语义钉在「通知」上。
 */
export const IPC_NOTIFY = Object.freeze({
  prefsTheme: 'pinax:agent:prefs:theme'
})

export const IPC_CHANNELS = Object.freeze({
  ...IPC_NOTIFY,
  kernelInfo: 'pinax:agent:kernel-info',
  view: 'pinax:agent:view',
  projectCreate: 'pinax:agent:project:create',
  projectCreateBare: 'pinax:agent:project:create-bare',
  projectPickDir: 'pinax:agent:project:pick-dir',
  projectOpen: 'pinax:agent:project:open',
  projectImportRun: 'pinax:agent:project:import-run',
  projectClose: 'pinax:agent:project:close',
  carrierSetEnabled: 'pinax:agent:carrier:set-enabled',
  carrierSetPrimary: 'pinax:agent:carrier:set-primary',
  runtimeAsk: 'pinax:agent:runtime:ask',
  runtimeToolCall: 'pinax:agent:runtime:tool-call',
  runtimePropose: 'pinax:agent:runtime:propose',
  // H2 知识服务：进程内 knowledgeService（createKnowledgeRuntime），不走 HTTP。
  // entry 恒传当前项目根；不开全局知识面。
  knowledgeSearch: 'pinax:agent:knowledge:search',
  knowledgeIndexStatus: 'pinax:agent:knowledge:index-status',
  // 工单B：索引重建（首次/资料变更后）——主进程内 kb_search 触发 prepare，再盘点 revision。
  knowledgeIndexSync: 'pinax:agent:knowledge:index-sync',
  prefsGet: 'pinax:agent:prefs:get',
  prefsSet: 'pinax:agent:prefs:set',
  prefsProbeModelPlane: 'pinax:agent:prefs:probe-model-plane',
  historyList: 'pinax:agent:history:list',
  historyShow: 'pinax:agent:history:show',
  historyDiff: 'pinax:agent:history:diff',
  historyCommitNow: 'pinax:agent:history:commit-now',
  historyProbe: 'pinax:agent:history:probe',
  backupExport: 'pinax:agent:backup:export',
  backupRestore: 'pinax:agent:backup:restore',
  menuInvoke: 'pinax:agent:menu:invoke'
})

/**
 * 反向通道（主进程推渲染进程）只有这三条，右栏的流式输出靠它们，不给插件开放推送。
 * 名字给出来是为了不靠下标取用——下标一动，调用方的含义就悄悄换了。
 */
export const IPC_EVENT = Object.freeze({
  viewChanged: 'pinax:agent:event:view-changed',
  runtimeProgress: 'pinax:agent:event:runtime-progress',
  menuInvoked: 'pinax:agent:event:menu-invoked'
})

export const IPC_EVENTS = Object.freeze(Object.values(IPC_EVENT))

const SLIM_MAX_DEPTH = 8

function pruneValue(value, depth) {
  if (typeof value === 'function') return undefined
  if (value === null || typeof value !== 'object') return value
  if (depth >= SLIM_MAX_DEPTH) return undefined
  if (Array.isArray(value)) {
    const out = []
    for (const item of value) {
      const pruned = pruneValue(item, depth + 1)
      if (pruned !== undefined) out.push(pruned)
    }
    return out
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    // 非 plain object（Date/Map/类实例）：Date 转 ISO，其余丢弃——IPC 面只该有数据。
    return value instanceof Date ? value.toISOString() : undefined
  }
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function') continue
    const pruned = pruneValue(item, depth + 1)
    if (pruned !== undefined) out[key] = pruned
  }
  return out
}

/**
 * IPC 边界净值裁剪（批次11 验收修复）。
 *
 * session.* 的成功结果（projectCreate/projectOpen/carrierSet* 等）原样带着 fileService 这类
 * 含函数属性的内核对象：进程内分发器与单测从不克隆，所以批次1 起一直没暴露；走真
 * ipcMain.handle 时 Electron 要结构化克隆返回值，函数一进去就「An object could not be cloned」。
 * 这里深剪成功结果的 value（丢函数与不可克隆对象，只留数据），失败载荷与 ok/error 外形原样保留。
 * 只用在主进程 ipcMain.handle 的出线上；进程内分发器与单测保持全值（carrier-pane-real 靠 fileService 走真链路）。
 */
export function slimForIpc(result) {
  if (!result || typeof result !== 'object') return result
  if (result.ok !== true) return result
  const value = pruneValue(result.value, 0)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    // fileService 是内核内部对象（渲染层没有任何合法用途）：顶层显式剪掉，不做「剪掉函数后的空壳」。
    delete value.fileService
  }
  return { ...result, value }
}

// 启停/切主载体是对项目合同的写入，必须先有一个「已经落在某个文件夹上的项目」；
// 注意判据是 projectRoot 而不是 project——裸项目（还没主载体）打开会失败，但主载体向导必须能写这一笔，
// 否则空框架就死在「要先有主载体才能选主载体」上。
// 运行时的三个通道不在此列——一级公民在项目没打开时也要活着（它自己会如实报缺什么）。
const REQUIRED_PROJECT_CHANNELS = new Set([
  IPC_CHANNELS.carrierSetEnabled, IPC_CHANNELS.carrierSetPrimary
])

/**
 * 三栏视图模型：左竖条／中栏来自注册表（主载体置顶），右栏来自运行时合同（不可被占用）。
 * 空插件集也要出得来——M1 的判据就是「不装任何插件，外壳照样能进」。
 */
export function shellView(session) {
  const view = session?.view ?? null
  const project = session?.project?.value ?? null
  const registry = session?.registry
  const primaryId = view?.primary ?? project?.document?.carriers?.primary ?? null
  const openError = session?.lastFailure && !session.lastFailure.ok ? session.lastFailure.error : null

  return {
    kernel: session?.kernel ?? null,
    project: project ? {
      root: project.root,
      name: project.document?.name ?? null,
      kind: project.document?.kind ?? null,
      spec: project.document?.spec ?? null,
      revision: project.document?.carriers?.revision ?? 0
    } : null,
    // 主载体向导的触发条件：合同里明确「还没有主载体」，或打开时被 D1/D2 闸门拦下。
    needsPrimary: Boolean(project?.document?.needsPrimary) || openError?.code === NEXT_ERROR_CODES.PRIMARY_CARRIER_MISSING,
    openError: session?.lastFailure && !session.lastFailure.ok ? session.lastFailure.error : null,
    left: view ? orderActivityItems(view.panes['left-dock'], { primaryPluginId: primaryId }) : [],
    center: view ? view.panes.center : [],
    primary: primaryId ? registry?.get?.(primaryId) ?? null : null,
    carriers: registry ? registry.list().map((manifest) => ({
      id: manifest.id,
      title: manifest.title,
      primary: manifest.primary,
      capabilities: manifest.capabilities,
      requires: manifest.requires,
      scopes: manifest.scopes,
      // 面板要能把「这块板块声明了什么」摊给作者看：目录／权限／工具名／上下文块与预算都是清单里的原话。
      tools: manifest.tools,
      context: manifest.context ?? null,
      panes: manifest.panes,
      // 载体声明的设置节（协议 P14）：统一设置二级页据此出目录项；空声明＝设置页不出这一格。
      settings: manifest.settings ?? [],
      dataDirs: Object.values(manifest.dataDirs),
      isPrimary: manifest.id === primaryId,
      isEnabled: view ? view.enabled.includes(manifest.id) : false
    })) : [],
    archive: view?.archive ?? [],
    skeletonDirs: view?.dirs?.skeleton ?? [],
    ownedDirs: view?.dirs?.owned ?? [],
    rejected: registry?.rejected ?? [],
    runtime: {
      title: RUNTIME_CONTRACT.title,
      builtIn: RUNTIME_CONTRACT.builtIn,
      disableable: RUNTIME_CONTRACT.disableable,
      ownsSlot: RUNTIME_CONTRACT.ownsSlot,
      budgetPriority: RUNTIME_CONTRACT.budgetPriority,
      writeSurface: RUNTIME_CONTRACT.writeSurface,
      reservedSlotReason: RESERVED_SLOTS.right,
      surface: session?.runtime?.surfaceInfo?.() ?? null,
      tools: session?.runtime?.dockViewModel?.().tools ?? [],
      started: Boolean(session?.runtime?.dockViewModel?.().started)
    }
  }
}

/**
 * 纯函数分发器：主进程 ipcMain 与单测共用同一个实现。
 * 第二个参数允许 undefined/null（当作 {}），但拒绝非对象——避免渲染层把字符串塞进 payload 造成内核侧 TypeError。
 *
 * deps 扩展（批次 8①）：
 *   prefs            —— 应用级偏好存储（next/runtime/appPreferences）；不注入时 prefs:* 通道如实报缺。
 *   onPrefsApplied   —— 偏好落盘后的生效钩子（主进程：改任务面端点 + 改窗口缩放 + 重设原生窗控浮层）；
 *   onThemeChanged   —— 主题通知（prefs:theme，收口包⑤）的副作用钩子（主进程：按新主题重设窗控浮层）。
 *                       通知语义：不写偏好、不进 onPrefsApplied；不注入时只记 applied:false，不当作数据请求失败。
 *   probeModelPlane  —— 模型面三态探测（next/runtime/modelPlaneProbe）；不注入时探测通道如实报缺。
 * deps 扩展（D1 历史）：
 *   history          —— { gitHistory, scheduler }；不注入时 history:* 五条通道如实报缺。
 *   onProjectOpened  —— 项目打开/刷新成功后的接线钩子（主进程：建历史仓库 + 起定时器 + 给新 fileService 挂标脏钩子）。
 *   onProjectClosed  —— 项目关闭后的旁路钩子（工单E3：主进程用它停历史定时器）。
 *                       session.close 不清 projectRoot（既有语义不动），所以「停表」这个动作放在外壳层；
 *                       不注入时行为与旧版一致，钩子抛错也不把「已关闭」翻成失败。
 * deps 扩展（E1 导入既有稿）：
 *   importProject    —— ({ sourcePath, targetPath, dryRun }) => { ok, value|error }（next/runtime/projectImportAdapter）；
 *                       不注入时 project:import-run 如实报缺，界面把这句话原样摊开，不假装导入过。
 * deps 扩展（G2 备份与恢复）：
 *   backupService    —— next/runtime/projectBackupService（exportProject／restoreProject／readBackupManifest）；
 *                       不注入时 backup:export／backup:restore 如实报缺，界面不假装备份过。
 *                       backup:restore 只带 backupDir 时是「预检」：返回 manifest 摘要，不写一个字节。
 * deps 扩展（H2 知识服务 all-in-one）：
 *   knowledgeService —— next/runtime/knowledgeService（createKnowledgeService）；search／indexStatus／indexSync
 *                       都在主进程内跑（worker 线程检索，零 HTTP）。不注入时 knowledge:* 三条通道如实报缺；
 *                       三条通道都只认 session.projectRoot，entry 恒传当前项目，不接受渲染层指定别的根。
 */
export function createIpcDispatcher({ session, onMenuInvoke = null, prefs = null, onPrefsApplied = null, onThemeChanged = null, probeModelPlane = null, pickProjectDir = null, history = null, onProjectOpened = null, onProjectClosed = null, importProject = null, backupService = null, knowledgeService = null }) {
  const menuIds = new Set(flattenMenuIds(MENU_TEMPLATE).map((item) => item.id))

  /** 项目（重新）打开后通知主进程接线；历史接线失败不能把「项目已打开」翻成失败。 */
  async function notifyProjectOpened(result) {
    if (!onProjectOpened || !result?.ok) return
    try {
      await onProjectOpened({ root: session.projectRoot, fileService: result.value?.fileService ?? null })
    } catch {
      // 历史是旁路：probe 会如实显示不可用，项目本身照常可用。
    }
  }

  async function dispatch(channel, payload) {
    if (!Object.values(IPC_CHANNELS).includes(channel)) {
      return fail('INVALID_INPUT', `未注册的 IPC 通道：${String(channel)}`, { channel })
    }
    const input = payload ?? {}
    if (typeof input !== 'object' || Array.isArray(input)) {
      return fail('INVALID_INPUT', `通道 ${channel} 的载荷必须是对象`, { channel })
    }
    if (REQUIRED_PROJECT_CHANNELS.has(channel) && !session.projectRoot) {
      return fail('INVALID_INPUT', `通道 ${channel} 需要先有一个项目（新建或打开项目文件夹）`)
    }

    switch (channel) {
      case IPC_CHANNELS.kernelInfo:
        return ok(session.kernel)
      case IPC_CHANNELS.view:
        return ok(shellView(session))
      case IPC_CHANNELS.projectCreate: {
        const created = await session.create({ name: input.name, primaryCarrier: input.primaryCarrier, extraEnabled: input.extraEnabled ?? [], root: input.root ?? null })
        if (created.ok) await notifyProjectOpened(created)
        return created
      }
      case IPC_CHANNELS.projectPickDir:
        return pickProjectDir ? pickProjectDir(input) : fail('INVALID_INPUT', '目录选择未接入（主进程系统对话框不可用）')
      case IPC_CHANNELS.projectCreateBare:
        return session.createBare({ name: input.name })
      // E1 导入既有稿：结构动作与 projectCreate 同级——作者在统一二级页里显式按下，
      // 不经写族闸（那条闸拦的是模型侧的内核写族），也不碰 server/mcp 的导入语义。
      case IPC_CHANNELS.projectImportRun:
        return importProject
          ? importProject({ sourcePath: input.sourcePath, targetPath: input.targetPath, dryRun: input.dryRun !== false })
          : fail('INVALID_INPUT', '导入适配器未接入（主进程未注入 projectImportAdapter）：这条通道现在只报缺，不落盘')
      case IPC_CHANNELS.projectOpen: {
        const opened = await session.open(input.root)
        if (opened.ok) await notifyProjectOpened(opened)
        return opened
      }
      case IPC_CHANNELS.projectClose: {
        const closed = await session.close()
        // 工单E3：关项目后停历史定时器。session.close 不清 projectRoot（既有语义不动），
        // 停表只能由外壳做；回调是旁路——抛错也不把「已关闭」翻成失败（probe 会如实显示不可用）。
        if (onProjectClosed) {
          try {
            await onProjectClosed()
          } catch {
            // 历史是旁路：停表失败不该挡住关项目。
          }
        }
        return closed
      }
      case IPC_CHANNELS.carrierSetEnabled: {
        const result = await session.setEnabled(input.pluginId, input.enabled, input.expectedRevision)
        // 启停会重建 fileService（session.refresh）：新实例必须重新挂上标脏钩子，否则之后的写入不进历史。
        if (result.ok) await notifyProjectOpened(result)
        return result
      }
      case IPC_CHANNELS.carrierSetPrimary: {
        const result = await session.setPrimary(input.pluginId, input.expectedRevision)
        if (result.ok) await notifyProjectOpened(result)
        return result
      }
      case IPC_CHANNELS.runtimeAsk:
        return session.runtime ? session.runtime.ask(input.question, input.context ?? {}) : fail('INVALID_INPUT', '运行时尚未就绪')
      case IPC_CHANNELS.runtimeToolCall:
        return session.runtime ? session.runtime.callTool(input.tool, input.args ?? {}) : fail('INVALID_INPUT', '运行时尚未就绪')
      case IPC_CHANNELS.runtimePropose:
        return session.runtime ? session.runtime.propose({ name: input.name, text: input.text }) : fail('INVALID_INPUT', '运行时尚未就绪')
      // H2／工单B：知识服务 all-in-one。三条都只认当前项目根——渲染层传什么 root 都不采信。
      case IPC_CHANNELS.knowledgeSearch: {
        if (!knowledgeService?.search) return fail('INVALID_INPUT', '知识服务未接入（主进程未创建 knowledgeService）：这条通道现在只报缺，不检索任何资料')
        if (!session.projectRoot) return fail('INVALID_INPUT', '知识检索需要先打开一个项目：只检索当前项目，不做全局知识面')
        return knowledgeService.search({ ...input, root: session.projectRoot })
      }
      case IPC_CHANNELS.knowledgeIndexStatus: {
        // 旧注入服务只有 exportProjectKnowledge（H2 的旧名）；新服务用 indexStatus。
        const status = knowledgeService?.indexStatus ?? knowledgeService?.exportProjectKnowledge
        if (typeof status !== 'function') return fail('INVALID_INPUT', '知识服务未接入（主进程未创建 knowledgeService）：这条通道现在只报缺，不盘点任何资料')
        if (!session.projectRoot) return fail('INVALID_INPUT', '资料盘点需要先打开一个项目：只盘点当前项目')
        return status.call(knowledgeService, { root: session.projectRoot })
      }
      case IPC_CHANNELS.knowledgeIndexSync: {
        if (!knowledgeService?.indexSync) return fail('INVALID_INPUT', '知识服务未接入（主进程未创建 knowledgeService）：这条通道现在只报缺，不重建索引')
        if (!session.projectRoot) return fail('INVALID_INPUT', '索引重建需要先打开一个项目：只索引当前项目')
        // probe 只是触发索引的那一次检索词；服务侧会截断到 200 字，空值回落「设定」。
        return knowledgeService.indexSync({ root: session.projectRoot, probe: input.probe })
      }
      case IPC_CHANNELS.prefsGet:
        return prefs ? prefs.read() : fail('INVALID_INPUT', '偏好存储未接入（主进程未创建偏好文件）')
      case IPC_CHANNELS.prefsSet: {
        if (!prefs) return fail('INVALID_INPUT', '偏好存储未接入（主进程未创建偏好文件）')
        // 只写载荷真的带了的字段：D2 起外壳会单独写 theme（主题切换），
        // 若把 modelPlaneEndpoint/uiZoom 以 undefined 一并塞进去，会把用户已存的端点/缩放重置回默认。
        const patch = {}
        if ('modelPlaneEndpoint' in input) patch.modelPlaneEndpoint = input.modelPlaneEndpoint
        if ('uiZoom' in input) patch.uiZoom = input.uiZoom
        if ('historyIntervalMinutes' in input) patch.historyIntervalMinutes = input.historyIntervalMinutes
        // 工单B 写作偏好（调度方裁定）：正文字号／行高也是 prefs:set 的合法载荷，
        // 与上面四个字段同一套「带了才写」语义——漏抄就等于保存链路在 IPC 层断掉。
        if ('writingFontSize' in input) patch.writingFontSize = input.writingFontSize
        if ('writingLineHeight' in input) patch.writingLineHeight = input.writingLineHeight
        if ('theme' in input) patch.theme = input.theme
        const written = await prefs.write(patch)
        if (!written.ok) return written
        if (onPrefsApplied) await onPrefsApplied(written.value)
        return ok(written.value)
      }
      case IPC_CHANNELS.prefsProbeModelPlane:
        return probeModelPlane ? await probeModelPlane() : fail('INVALID_INPUT', '模型面探测未接入')
      // 收口包⑤：主题通知（不是请求）。渲染层 writeScheme 落完主题就发一次；
      // 主进程只重设原生窗控浮层的 symbolColor／height，不写偏好、不碰项目。
      case IPC_CHANNELS.prefsTheme: {
        if (input.theme !== 'light' && input.theme !== 'dark') {
          return fail('INVALID_INPUT', 'theme 必须是 light／dark', { theme: input.theme ?? null })
        }
        if (onThemeChanged) await onThemeChanged(input.theme)
        return ok({ theme: input.theme, applied: Boolean(onThemeChanged) })
      }
      case IPC_CHANNELS.historyList:
        if (!history?.gitHistory) return fail('INVALID_INPUT', '历史引擎未接入（主进程未创建历史服务）')
        if (!session.projectRoot) return fail('INVALID_INPUT', '历史查询需要先打开一个项目')
        return history.gitHistory.listFileHistory({ root: session.projectRoot, path: input.path, limit: input.limit })
      case IPC_CHANNELS.historyShow:
        if (!history?.gitHistory) return fail('INVALID_INPUT', '历史引擎未接入（主进程未创建历史服务）')
        if (!session.projectRoot) return fail('INVALID_INPUT', '历史查询需要先打开一个项目')
        return history.gitHistory.readVersion({ root: session.projectRoot, oid: input.oid, path: input.path })
      case IPC_CHANNELS.historyDiff:
        if (!history?.gitHistory) return fail('INVALID_INPUT', '历史引擎未接入（主进程未创建历史服务）')
        if (!session.projectRoot) return fail('INVALID_INPUT', '历史查询需要先打开一个项目')
        return history.gitHistory.diffVersions({ root: session.projectRoot, a: input.a, b: input.b, path: input.path })
      case IPC_CHANNELS.historyCommitNow:
        return history?.scheduler
          ? history.scheduler.requestCommit(input.message)
          : fail('INVALID_INPUT', '历史调度未接入（主进程未创建历史服务）')
      case IPC_CHANNELS.historyProbe:
        return history?.scheduler
          ? history.scheduler.probe()
          : fail('INVALID_INPUT', '历史探测未接入（主进程未创建历史服务）')
      case IPC_CHANNELS.backupExport: {
        if (!backupService?.exportProject) return fail('INVALID_INPUT', '备份服务未接入（主进程未注入 projectBackupService）：这条通道现在只报缺，不复制任何文件')
        if (!session.projectRoot) return fail('INVALID_INPUT', '备份需要先打开一个项目：备份的是当前打开的项目目录')
        return backupService.exportProject({
          root: session.projectRoot,
          targetParent: input.targetParent,
          includeHistory: input.includeHistory === true
        })
      }
      case IPC_CHANNELS.backupRestore: {
        if (!backupService?.restoreProject) return fail('INVALID_INPUT', '备份服务未接入（主进程未注入 projectBackupService）：这条通道现在只报缺，不写任何文件')
        // 恢复区的预检（工单G2）：只给 backupDir 时先把 manifest 摘要摊给作者，不要求 targetRoot、不写盘。
        if (!input.targetRoot) {
          return backupService.readBackupManifest
            ? backupService.readBackupManifest({ backupDir: input.backupDir })
            : fail('INVALID_INPUT', '备份服务未提供 readBackupManifest：恢复区的预检不可用')
        }
        return backupService.restoreProject({ backupDir: input.backupDir, targetRoot: input.targetRoot })
      }
      case IPC_CHANNELS.menuInvoke: {
        if (!menuIds.has(input.id)) {
          return fail('INVALID_INPUT', `菜单项 ${String(input.id)} 不在应用菜单模板里；载体不得注入顶层菜单（C5）`, { id: input.id })
        }
        if (onMenuInvoke) await onMenuInvoke(input.id)
        return ok({ id: input.id, handled: true })
      }
      default:
        return fail('INVALID_INPUT', `通道 ${channel} 未接线`)
    }
  }

  return { dispatch, menuIds: [...menuIds] }
}
