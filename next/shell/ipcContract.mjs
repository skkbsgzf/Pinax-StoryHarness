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

export const IPC_CHANNELS = Object.freeze({
  kernelInfo: 'pinax:agent:kernel-info',
  view: 'pinax:agent:view',
  projectCreate: 'pinax:agent:project:create',
  projectCreateBare: 'pinax:agent:project:create-bare',
  projectPickDir: 'pinax:agent:project:pick-dir',
  projectOpen: 'pinax:agent:project:open',
  projectClose: 'pinax:agent:project:close',
  carrierSetEnabled: 'pinax:agent:carrier:set-enabled',
  carrierSetPrimary: 'pinax:agent:carrier:set-primary',
  runtimeAsk: 'pinax:agent:runtime:ask',
  runtimeToolCall: 'pinax:agent:runtime:tool-call',
  runtimePropose: 'pinax:agent:runtime:propose',
  prefsGet: 'pinax:agent:prefs:get',
  prefsSet: 'pinax:agent:prefs:set',
  prefsProbeModelPlane: 'pinax:agent:prefs:probe-model-plane',
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
 *   onPrefsApplied   —— 偏好落盘后的生效钩子（主进程：改任务面端点 + 改窗口缩放）；
 *   probeModelPlane  —— 模型面三态探测（next/runtime/modelPlaneProbe）；不注入时探测通道如实报缺。
 */
export function createIpcDispatcher({ session, onMenuInvoke = null, prefs = null, onPrefsApplied = null, probeModelPlane = null, pickProjectDir = null }) {
  const menuIds = new Set(flattenMenuIds(MENU_TEMPLATE).map((item) => item.id))

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
      case IPC_CHANNELS.projectCreate:
        return session.create({ name: input.name, primaryCarrier: input.primaryCarrier, extraEnabled: input.extraEnabled ?? [], root: input.root ?? null })
      case IPC_CHANNELS.projectPickDir:
        return pickProjectDir ? pickProjectDir(input) : fail('INVALID_INPUT', '目录选择未接入（主进程系统对话框不可用）')
      case IPC_CHANNELS.projectCreateBare:
        return session.createBare({ name: input.name })
      case IPC_CHANNELS.projectOpen:
        return session.open(input.root)
      case IPC_CHANNELS.projectClose:
        return session.close()
      case IPC_CHANNELS.carrierSetEnabled:
        return session.setEnabled(input.pluginId, input.enabled, input.expectedRevision)
      case IPC_CHANNELS.carrierSetPrimary:
        return session.setPrimary(input.pluginId, input.expectedRevision)
      case IPC_CHANNELS.runtimeAsk:
        return session.runtime ? session.runtime.ask(input.question, input.context ?? {}) : fail('INVALID_INPUT', '运行时尚未就绪')
      case IPC_CHANNELS.runtimeToolCall:
        return session.runtime ? session.runtime.callTool(input.tool, input.args ?? {}) : fail('INVALID_INPUT', '运行时尚未就绪')
      case IPC_CHANNELS.runtimePropose:
        return session.runtime ? session.runtime.propose({ name: input.name, text: input.text }) : fail('INVALID_INPUT', '运行时尚未就绪')
      case IPC_CHANNELS.prefsGet:
        return prefs ? prefs.read() : fail('INVALID_INPUT', '偏好存储未接入（主进程未创建偏好文件）')
      case IPC_CHANNELS.prefsSet: {
        if (!prefs) return fail('INVALID_INPUT', '偏好存储未接入（主进程未创建偏好文件）')
        const written = await prefs.write({ modelPlaneEndpoint: input.modelPlaneEndpoint, uiZoom: input.uiZoom })
        if (!written.ok) return written
        if (onPrefsApplied) await onPrefsApplied(written.value)
        return ok(written.value)
      }
      case IPC_CHANNELS.prefsProbeModelPlane:
        return probeModelPlane ? await probeModelPlane() : fail('INVALID_INPUT', '模型面探测未接入')
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
