import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import * as gitHistory from '../history/gitHistory.mjs'
import { createNextSession } from '../index.mjs'
import { fail } from '../kernel/errors.mjs'
import { createAdvisorRunner } from '../runtime/runnerAdvisor.mjs'
import { createToolLoop } from '../runtime/toolLoop.mjs'
import { createKitToolTurn } from '../runtime/toolTurn.mjs'
import { selectTools } from '../runtime/toolSelect.mjs'
import { createWritePolicy } from '../runtime/writePolicy.mjs'
import { createProposalStore } from '../runtime/proposalStore.mjs'
import { CARRIER_WRITE_CLASS, KERNEL_WRITE_CLASS } from '../runtime/kernelWriteGuard.mjs'
import { createInterceptorChain, createWriteAuditInterceptor, createWriteGuardInterceptor } from '../runtime/toolInterceptors.mjs'
import { emitProjectEvent, projectEventKindForPath, subscribeProjectEvents } from '../runtime/eventBus.mjs'
import { createAppPreferences } from '../runtime/appPreferences.mjs'
import { createServiceLogPool } from '../runtime/serviceLogPool.mjs'
import { createHistoryScheduler } from '../runtime/historyScheduler.mjs'
import { probeModelPlane, applyModelPlaneEndpoint } from '../runtime/modelPlaneProbe.mjs'
import { planImport, runImport } from '../runtime/projectImportAdapter.mjs'
import { importOutlineChapters } from '../runtime/outlineImportService.mjs'
import * as projectBackup from '../runtime/projectBackupService.mjs'
import { createKnowledgeService, setSharedKnowledgeService } from '../runtime/knowledgeService.mjs'
import { createWritingComplete } from '../runtime/writingComplete.mjs'
import { collectSettingDeclarations, createFileSettingsStore } from '../settingsStore.mjs'
import { IPC_CHANNELS, IPC_EVENT, IPC_PUSH, createIpcDispatcher, shellView, slimForIpc } from './ipcContract.mjs'
import { EXPORT_EXTENSIONS, exportBook, exportDocument } from './exportService.mjs'
import { MENU_TEMPLATE } from './menus.mjs'
import { PLUGIN_PROTOCOL } from './pluginProtocol.mjs'
import { createPluginFileHandler } from './pluginFileServer.mjs'

/**
 * Next 桌面外壳的主进程入口（WP4）。
 * 三件事是这层的全部职责，且都是「今天整个 electron/ 目录里不存在」的东西：
 *   1) 建立应用级菜单（Menu 在本仓第一次落地——运行时因此有菜单栏归属，不再只能靠渲染层堆按钮）；
 *   2) 起内核会话（主进程内装配，无 Express、无端口）；
 *   3) 把内核能力按通道名挂到 ipcMain（渲染层只认 next/shell/ipcContract 的通道，碰不到实现）；
 *   4) 历史快照（R3/D1）：项目打开后建独立 git 仓库并起定时提交，关窗前兜底再存一次。
 * 窗口文件由打包侧注入：dev 走 vite dev server，prod 走打包后的 renderer html。
 */
const currentDir = dirname(fileURLToPath(import.meta.url))

/**
 * 自绘标题栏（工单F · 作者反馈①②）：原生窗控浮层。
 *
 * BrowserWindow 的 titleBarOverlay 只吃真实颜色值——渲染层的 CSS token（--workbench-chrome 等）
 * 在主进程里取不到，所以这里落一份常量，写明它与 token 的对应关系：
 *   - color: '#00000000'：透明底，让渲染层 .nx-titlebar 的 --workbench-chrome 透上来
 *     （明暗两套主题里这枚 token 分别是 #f3f3f2 / #1b1c1e，见 src/styles/themes/legacy.css:65/764）；
 *   - symbolColor：窗控符号取 --text-muted 的两档——light: '#6b6b6b'（legacy.css:14 #6b7078 的
 *     窗控安全档）/ dark: '#9b9b9b'（legacy.css:714 #969ba3）；由 updateTitleBarOverlay 随主题重设；
 *   - height: 36 与 next-shell.css 的 --nx-titlebar-height 一致（overlay 只能给 DIP），
 *     实际值按界面缩放折算：height = Math.round(36 * zoom)，与渲染层 CSS px 对齐。
 *
 * 收口包⑤：主题/缩放变化时经 updateTitleBarOverlay 重设（启动、onPrefsApplied、prefs:theme 通知三处触发）。
 */
const TITLEBAR_OVERLAY = Object.freeze({
  color: '#00000000',
  height: 36
})
const TITLEBAR_SYMBOL_COLOR = Object.freeze({
  light: '#6b6b6b',
  dark: '#9b9b9b'
})

/** 当前主题与缩放：窗控浮层的重设只依赖这两个状态（缩放以偏好节为准，主题以偏好/通知为准）。 */
let currentUiZoom = 0.85
let currentScheme = 'light'

/** 浮层参数：symbolColor 随主题、height 随缩放（DIP 对齐渲染层 CSS px）。 */
function titleBarOverlayOptions({ theme, zoom }) {
  const scheme = theme === 'dark' ? 'dark' : 'light'
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return {
    color: TITLEBAR_OVERLAY.color,
    symbolColor: TITLEBAR_SYMBOL_COLOR[scheme],
    height: Math.round(TITLEBAR_OVERLAY.height * scale)
  }
}

/**
 * 重设原生窗控浮层（收口包⑤）：窗口没了、或平台不提供 setTitleBarOverlay（非 Windows）时静默跳过。
 * 三个触发点：启动建窗后、偏好保存回调（uiZoom/theme 变化）、渲染层的 prefs:theme 通知。
 */
function updateTitleBarOverlay({ theme, zoom } = {}) {
  const scheme = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : currentScheme
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : currentUiZoom
  currentScheme = scheme
  currentUiZoom = scale
  const win = window_
  if (!win || win.isDestroyed() || typeof win.setTitleBarOverlay !== 'function') return
  win.setTitleBarOverlay(titleBarOverlayOptions({ theme: scheme, zoom: scale }))
}

/**
 * 系统目录对话框的标题按用途分支（工单G2 扩到备份／恢复三种）。
 * 每个 purpose 都把「这个目录会被怎么用」写在标题里——目录选择是不可撤销的一步，
 * 作者在对话框里就该知道选中的是不是项目落点、会不会被写。
 */
const PICK_DIR_TITLES = Object.freeze({
  default: '选择新项目文件夹（需要空目录，可在对话框里新建）',
  // E1 导入向导：源目录只读。
  'import-source': '选择要导入的稿子目录（只读：导入不会改、不会删这里任何文件）',
  // G2 备份：选的是「放到哪儿」，真正的备份是它下面的一个新子目录。
  'backup-target': '选择备份保存位置（会在其中新建 <项目名>-backup-<时间戳> 子文件夹）',
  // G2 恢复：选的是已有的备份目录（凭 backup-manifest.json 认）。
  'backup-source': '选择要恢复的备份文件夹（需含 backup-manifest.json）',
  // G2 恢复：选的是恢复后的新项目位置（必须是空目录）。
  'restore-target': '选择恢复后的新项目位置（需要空目录，可在对话框里新建）'
})

/**
 * 导出对话框的默认文件名（批次26）：文档标题里 Windows 不允许的字符换空格，截到 80 字；
 * 标题为空就退回「未命名文档」——对话框里给一个能直接用的名字，而不是让作者从空串开始敲。
 */
function exportFileName(title) {
  const cleaned = String(title ?? '')
    .replace(/[\\/:*?"<>|]/gu, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '')
    .slice(0, 80)
  return cleaned || '未命名文档'
}

// 数据/缓存目录跟随 PINAX_APP_DATA（批次16 验收修）。
// 默认 userData（%APPDATA%/Electron）被所有实例共享：一个实例被强杀后残留的缓存锁，
// 会把下一个实例卡死在 renderer 出生之前（症状＝主进程活、无 renderer 子进程、无窗口）。
// setPath 必须在 whenReady 之前：Cache/GPUCache/锁文件全部跟着走，实例之间彻底隔离。
const pinnedAppData = process.env.PINAX_APP_DATA
if (pinnedAppData) app.setPath('userData', pinnedAppData)

/**
 * 协议 v3 的自带面板：自定义协议 `pinax-plugin://<pluginId>/<相对路径>`。
 *
 * 必须在 app ready 之前登记为特权协议（否则 iframe 里当普通外链处理，页面起不来）。
 * 特权里只开四样：standard（当正经 origin 解析）、secure（不落到不安全上下文）、
 * supportFetchAPI（面板里的 fetch 能用）、corsEnabled（同源资源互取）。
 * 不开 stream、不开 bypassCSP——面板页的 CSP 由我们在响应头里给死。
 */
protocol.registerSchemesAsPrivileged([{
  scheme: PLUGIN_PROTOCOL,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}])

/**
 * 单实例锁（批次37 附条，作者在盘点讨论中同意并入本批）。
 *
 * 为什么必须在这一层：M2.5-C 已记账「两个应用实例同时写同一个项目的 .pinax/workspace.json
 * 与 .pinax/sessions/*.jsonl，后写者赢」——那是界面层修不了的竞态面。成本最低的收口是
 * 不让第二个实例起来：抢不到锁的进程不建窗、不装配会话，直接退出；已有窗口由 first-instance
 * 的 second-instance 事件提到前台（最小化就还原），作者看到的是「窗口跳出来了」而不是两个一样的应用。
 *
 * 边界：这是**应用级**锁，不是项目级锁——两个实例开两个不同项目仍不被允许（单窗口外壳的既有形态）；
 * 想并行开两个项目，先把「多窗口」做成真功能（M2.5-C 记账的未做项），而不是绕过锁。
 * 测试/构建 import 本文件不会走到这里：requestSingleInstanceLock 只在 Electron 运行时存在。
 */
const singleInstanceLock = typeof app.requestSingleInstanceLock === 'function'
  ? app.requestSingleInstanceLock()
  : true
if (!singleInstanceLock) app.quit()

app.on('second-instance', () => {
  const win = window_
  if (!win || win.isDestroyed()) return
  if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

/**
 * 界面缩放：作者口径 0.85（1440×900 下三栏＋右栏的舒适档）。
 * 优先级：env PINAX_NEXT_ZOOM（批次7 的覆写口）＞偏好文件（批次8 偏好面，uiZoom）＞默认 0.85。
 * 缩放的唯一入口是偏好节（PrefsSection 的 uiZoom，保存即经 onPrefsApplied 改窗口）。
 * 工单A 删掉「视图」组时一并删了菜单里的 native zoom（resetZoom/zoomIn/zoomOut）——
 * 它与 zoomFactor 双轨，两边各改一份会互相覆盖。越界值一律回默认，不猜。
 */
function resolveUiZoom({ storedZoom = null } = {}) {
  const fromEnv = Number.parseFloat(process.env.PINAX_NEXT_ZOOM ?? '')
  if (Number.isFinite(fromEnv) && fromEnv >= 0.5 && fromEnv <= 2) return fromEnv
  const fromPrefs = Number(storedZoom)
  if (Number.isFinite(fromPrefs) && fromPrefs >= 0.5 && fromPrefs <= 2) return fromPrefs
  return 0.85
}

/** 偏好文件位置：PINAX_APP_DATA（隔离/验收）优先，否则 Electron 用户数据目录。 */
function preferencesFile() {
  return join(process.env.PINAX_APP_DATA || app.getPath('userData'), 'next-preferences.json')
}

/**
 * 编辑组五个系统级编辑命令（工单A）：页内菜单行点击走 menuInvoke → 这里落到当前窗口 webContents。
 * 原生菜单那一半是 role（menus.mjs），由 Electron 直接办——两条路都通，互不依赖。
 */
const EDIT_MENU_COMMANDS = Object.freeze({
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'edit.cut': 'cut',
  'edit.copy': 'copy',
  'edit.paste': 'paste',
  'edit.selectAll': 'selectAll'
})

let session = null
let dispatcher = null
let window_ = null

/** 项目事件总线订阅（批次37）：换项目/关项目时退订，跨项目不串台。 */
let detachProjectEvents = null
/** 历史仓库是否就绪：写入钩子同时服务总线与历史，只有就绪时才标脏（没仓时不刷错误日志）。 */
let historyWired = false

/** 历史定时调度（D1）：单例；项目打开后绑定，关窗前兜底提交。 */
const historyScheduler = createHistoryScheduler()

function sendToRenderer(channel, payload) {
  if (window_ && !window_.isDestroyed()) window_.webContents.send(channel, payload)
}

function buildMenu() {
  const template = MENU_TEMPLATE.map((top) => ({
    ...top,
    submenu: top.submenu.map((item) => {
      if (item.role || item.type) return item
      return {
        ...item,
        click: () => {
          sendToRenderer(IPC_EVENT.menuInvoked, { id: item.id })
          dispatcher?.dispatch(IPC_CHANNELS.menuInvoke, { id: item.id }).catch(() => {})
        }
      }
    })
  }))
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(preloadPath, uiZoom, theme) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Pinax · Next',
    backgroundColor: '#101014',
    // 工单F：标题栏交给渲染层自绘（AppNext 的 .nx-titlebar 行），原生窗控以浮层形式保留在右上角。
    // 原生应用菜单不删：accelerator（Ctrl+O / Ctrl+Q 等）仍由 Menu.setApplicationMenu 提供。
    // 收口包⑤：首帧就按已存主题与缩放给浮层，随后 updateTitleBarOverlay 再对齐一次（幂等）。
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayOptions({ theme, zoom: uiZoom }),
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      zoomFactor: uiZoom
    }
  })
  win.once('ready-to-show', () => {
    win.show()
    // 启动器（launch-next-dameng.mjs）轮询这行标记判断「窗口真的出来了」——
    // 本机裸 spawn electron 约一半概率丢 renderer，重试是这个启动器的自愈手段。
    // eslint-disable-next-line no-console -- 主进程没有渲染层可报，这行标记必须留在 stderr
    console.error('[pinax-next] 窗口已显示')
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  return win
}

async function loadRenderer(win, env) {
  if (env === 'development') {
    const devServerUrl = process.env.PINAX_NEXT_RENDERER_URL || 'http://127.0.0.1:5273'
    await win.loadURL(devServerUrl)
    return
  }
  // 入口只有打包产物那一条（package.json 的 next:shell → next/.build/pinax-next-shell-main.mjs），
  // 渲染层产物就在这个 bundle 旁边的 renderer-next/ 里，所以相对当前模块目录取。
  await win.loadFile(join(currentDir, 'renderer-next', 'index.html'))
}

/**
 * 进程内工具循环（批次37 · 任务二）：注入即上线，但**默认 review 档**。
 *
 * 与 M2.5-A 的设计逐条对齐：
 *   - 模型回合走 createKitToolTurn（任务面 /v1/pinax/complete 的同一份请求体）；
 *   - 披露按意图选 6 把（selectTools），不整张塞给模型；
 *   - 写工具落不落由写策略按**会话真值**决定：review＝转提案、auto＝直写、blocked＝拒。
 *     auto 的直写仍过写入钩子之外的三道闸（归属/scope/修订）与内核写族闸——循环不绕过任何安全层。
 *
 * callTool 与提案出口都按「此刻的会话」现取：工具循环在应用生命周期里只建一次，
 * 而项目会被换掉（session.refresh 会重建 runtime），把 runtime/fileService 绑死在工厂里就会写错项目。
 *
 * 批次50：执行前的写族判定与执行后的提交审计收进同一条拦截点链（toolInterceptors）——
 * 工具循环仍是唯一执行处；策略按写模式缓存，后缀兜底的 warn 进公共池（serviceLogPool）。
 */
function createProjectToolLoop({ serviceLogPool = null } = {}) {
  const proposals = createProposalStore({
    fileService: {
      async writeProposal(request) {
        const fileService = session?.project?.value?.fileService ?? null
        if (!fileService?.writeProposal) {
          return fail('INVALID_INPUT', '提案目录不可写：项目还没完整打开（没有文件服务）')
        }
        return fileService.writeProposal(request)
      }
    }
  })
  // 写策略按写模式缓存：同一模式共享一份（后缀兜底的 warn 只记一次），换模式换一份。
  const policies = new Map()
  const policyFor = ({ writeMode }) => {
    const key = String(writeMode ?? '')
    if (!policies.has(key)) {
      policies.set(key, createWritePolicy({
        mode: writeMode,
        // 落点事实源只有一个：内核写族 ＋ 载体写工具，不在这里复制第三张表。
        landing: { ...KERNEL_WRITE_CLASS, ...CARRIER_WRITE_CLASS },
        serviceLogPool,
        createProposal: async ({ tool, args = {}, dir }) => {
          // baseRevision 取模型当次看到的修订号（写工具的 expectedRevision）：重放时按它判 STALE，
          // 不静默合并。没有修订号的写工具不做这层判定（applyProposal 自会如实说明）。
          const baseRevision = Number.isSafeInteger(args?.expectedRevision) ? args.expectedRevision : null
          const label = String(args?.title ?? args?.file ?? args?.name ?? '').slice(0, 80)
          return proposals.create({
            tool,
            args,
            baseRevision,
            summary: label ? `${tool}：${label}` : tool,
            target: dir ? { dir, file: typeof args?.file === 'string' ? args.file : null } : null
          })
        }
      }))
    }
    return policies.get(key)
  }
  const toolInterceptors = createInterceptorChain({
    interceptors: [
      createWriteGuardInterceptor({ policyFor }),
      // 审阅档下直接执行的提交类外部工具（先例 comfy_submit）在这里留痕，替代零散 console 记账。
      createWriteAuditInterceptor({ pool: () => serviceLogPool })
    ]
  })
  return createToolLoop({
    turn: createKitToolTurn({ interceptors: toolInterceptors }),
    selectTools: ({ tools, intent, skill }) => selectTools({ tools, intent, skill }),
    callTool: async (name, args) => {
      if (!session?.runtime) return fail('INVALID_INPUT', '运行时尚未就绪：这一轮工具调用没有执行')
      return session.runtime.callTool(name, args)
    },
    interceptors: toolInterceptors
  })
}

export async function startNextShell({ root = null, env = process.env.NODE_ENV, preloadPath = null } = {}) {
  await app.whenReady()

  /**
   * 面板协议（协议 v3 的 entry 面）：`pinax-plugin://<pluginId>/<相对路径>`。
   * 面板页只能读**自己那个插件目录**里的文件——越界的路径 403，未知插件 404。
   * 响应头里带一份 CSP：面板页不许向外发请求（connect-src 'none'），
   * 脚本与样式只能取自己目录里的（script-src 'self'）。
   */
  const pluginFileHandler = createPluginFileHandler({
    resolvePluginDir: (pluginId) => session?.registry?.dirOf?.(pluginId) ?? null
  })
  if (typeof protocol.isProtocolHandled === 'function' && !protocol.isProtocolHandled(PLUGIN_PROTOCOL)) {
    protocol.handle(PLUGIN_PROTOCOL, async (request) => {
      const result = await pluginFileHandler(request.url)
      return new Response(result.body, {
        status: result.status,
        headers: {
          'content-type': result.contentType,
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'"
        }
      })
    })
  }

  buildMenu()

  // 应用级偏好（批次8①）：启动即读、即生效——模型面端点与界面缩放不再只靠 env。
  const prefs = createAppPreferences({ file: preferencesFile() })
  const storedPrefs = await prefs.read()
  const stored = storedPrefs.ok ? storedPrefs.value : { modelPlaneEndpoint: null, uiZoom: null, historyIntervalMinutes: 5 }
  if (stored.modelPlaneEndpoint) applyModelPlaneEndpoint(stored.modelPlaneEndpoint)
  const uiZoom = resolveUiZoom({ storedZoom: stored.uiZoom })
  // 服务与外部 MCP 的公共池（批次49）：应用级一份，跨项目共用；确认水位随偏好落盘。
  // 每次池变化推一份全量快照（服务＋MCP＋未确认通知），竖条与设置页据此刷新，不轮询。
  const serviceLogPool = createServiceLogPool({
    ackAt: stored.serviceNoticesAckedAt ?? null,
    onAckPersist: async (at) => {
      await prefs.write({ serviceNoticesAckedAt: at })
    },
    onChange: (snapshot) => sendToRenderer(IPC_PUSH.runtimeServiceLogChanged, snapshot)
  })
  // 收口包⑤：窗控浮层的启动态＝已存主题（未迁移过就按渲染层同一个默认值 light）＋实际缩放。
  currentUiZoom = uiZoom
  currentScheme = stored.theme === 'dark' ? 'dark' : 'light'

  /**
   * 项目事件接线（批次37）：同一时刻只认当前项目根的一份订阅。
   * 总线在进程内，渲染层看不到它——这里把每一次变更转成一条 IPC 推送（{ kind, at }），
   * 设置页的大纲转换节与提案审阅节据此自动刷新。换项目先退旧订阅，跨项目不串台。
   */
  function bindProjectEvents({ root: projectRoot } = {}) {
    if (detachProjectEvents) {
      detachProjectEvents()
      detachProjectEvents = null
    }
    historyWired = false
    if (!projectRoot) return
    detachProjectEvents = subscribeProjectEvents(projectRoot, (event) => {
      sendToRenderer(IPC_EVENT.projectEvent, { kind: event.kind, at: event.at })
    })
  }

  /**
   * 项目打开/刷新后的历史接线（D1）：建独立 git 仓库 → 给新 fileService 挂「写成功→标脏」→ 起定时器。
   * 任何一步失败都不拦住写作，只在日志留痕；历史面板经 history:probe 如实显示不可用（绝不静默假装可用）。
   *
   * 批次37 起同一个写入钩子还要发项目事件（fileService.notifyWrite 是唯一接入点）：
   * 钩子只有一个槽位，所以「总线」与「历史标脏」必须合在一处——先发事件，再按历史仓库是否就绪决定标脏。
   */
  async function beginHistory({ root: projectRoot, fileService } = {}) {
    if (!projectRoot) return
    bindProjectEvents({ root: projectRoot })
    if (fileService?.setOnWrite) {
      fileService.setOnWrite(async ({ relativePath }) => {
        const kind = projectEventKindForPath(relativePath)
        if (kind) emitProjectEvent(projectRoot, { kind })
        if (!historyWired) return
        const marked = await gitHistory.markDirty({ root: projectRoot, paths: [relativePath] })
        if (!marked.ok) {
          // eslint-disable-next-line no-console -- 旁路失败不打断写作，但必须留痕
          console.error('[pinax-next] 历史标脏失败：', marked.error?.message ?? marked.error)
        }
      })
    }
    const ensured = await gitHistory.ensureHistoryRepo({ root: projectRoot })
    if (!ensured.ok) {
      // eslint-disable-next-line no-console -- 主进程没有渲染层可报；历史不可用必须留痕
      console.error('[pinax-next] 历史仓库不可用：', ensured.error?.message ?? ensured.error)
      historyScheduler.stop()
      return
    }
    historyWired = true
    const storedNow = await prefs.read()
    const interval = storedNow.ok ? storedNow.value.historyIntervalMinutes : 5
    const started = await historyScheduler.start({ root: projectRoot, intervalMinutes: interval })
    if (!started.ok) {
      // eslint-disable-next-line no-console -- 定时器起不来也要留痕（手动/关窗快照仍可用）
      console.error('[pinax-next] 历史定时器启动失败：', started.error?.message ?? started.error)
    }
  }

  // 知识服务（工单H2）：主进程单例，一个底座同时供 IPC（资料板检索/盘点）与资料载体的
  // pinax_reference_search 使用。runtimeRoot／cacheRoot 走 env 或 createKnowledgeRuntime 的默认；
  // 真正执行在 worker 线程里（零 HTTP、零端口），这里只等 Promise。
  const knowledgeService = createKnowledgeService({
    runtimeRoot: process.env.PINAX_KNOWLEDGE_RUNTIME,
    cacheRoot: process.env.PINAX_KNOWLEDGE_CACHE_ROOT
  })
  setSharedKnowledgeService(knowledgeService)

  // 写作动作（批次41）：走同一个模型漏斗（writingComplete 内部默认 forwardComplete → 任务面 /v1/pinax/complete）。
  // 90 秒超时：老前端续写也在这个量级，短了长段落会被腰斩；不可达时通道如实报错，不编字。
  // 批次46A：参考块与 ask 链同一套取数面（registry／view／fileService），运行时没打开项目就降级裸补全。
  const writingComplete = createWritingComplete({
    timeoutMs: 90_000,
    contextSources: () => {
      const sources = session?.runtime?.contextSources?.() ?? {}
      return { registry: sources.registry, view: sources.view, fileService: sources.fileService }
    }
  })

  /**
   * 每插件配置（批次45）：项目级 `.pinax/settings.json`，换项目就换一份。
   * 声明白名单用 getter 从注册表现取——装配期之后再加的插件也不会被写闸漏掉。
   * 缓存实例只为「内容没变不写盘」的 lastWritten 记账；根一变就重建。
   */
  let settingsStore = null
  function settingsStoreFor(projectRoot) {
    if (!projectRoot) return null
    if (!settingsStore || settingsStore.root !== String(projectRoot)) {
      settingsStore = createFileSettingsStore({
        root: projectRoot,
        declarations: () => collectSettingDeclarations(session?.registry)
      })
    }
    return settingsStore
  }

  // 运行器只在主进程装：它把提问接到内核任务面漏斗（进程内，不开端口）。
  // 测试与验收一律不注入，那条「未接模型运行器」的如实失败路径要一直留在 CI 里。
  session = await createNextSession({
    root: root || app.getPath('documents'),
    autoOpen: Boolean(root),
    // 批次37：工具循环接上真链。默认档是会话的 writeMode（review 时写工具只转提案），
    // 这一层不替作者猜档位——review/auto 的真值在会话 JSONL 与界面开关里。
    runtimeOptions: {
      runner: createAdvisorRunner({ toolLoop: createProjectToolLoop({ serviceLogPool }) }),
      // 协议 v3 的 services 面：服务状态变化推给渲染层（起停／崩溃／就绪），右栏不必轮询。
      onServiceEvent: (payload) => sendToRenderer(IPC_PUSH.runtimeServiceEvent, payload),
      // 批次49：同一个池交给运行时——声明与实时状态由它同步，日志由监督器／MCP 客户端写入。
      serviceLogPool
    }
  })
  dispatcher = createIpcDispatcher({
    session,
    prefs,
    serviceLogPool,
    probeModelPlane: () => probeModelPlane(),
    pickProjectDir: async (input = {}) => {
      // 新项目落点（批次9）：createProject 只吃空目录，Documents 这种会话根永远非空——
      // 必须让作者经系统对话框选/建一个空文件夹（createDirectory 允许就地新建）。
      // E1 导入向导复用同一枚对话框：purpose=import-source 时标题要如实说「这是只读的稿子目录」，
      // 别让作者以为选中的稿子目录会被当成新项目落点。
      // G2 备份／恢复也复用：backup-target／backup-source／restore-target 三种标题见 PICK_DIR_TITLES。
      const title = PICK_DIR_TITLES[input?.purpose] ?? PICK_DIR_TITLES.default
      const result = await dialog.showOpenDialog(window_, {
        title,
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths?.length) return { ok: true, value: { picked: false, path: null } }
      return { ok: true, value: { picked: true, path: result.filePaths[0] } }
    },
    history: { gitHistory, scheduler: historyScheduler },
    // 备份与恢复（G2）：整目录复制，零新依赖；服务只管文件，通道只管把当前项目根交给它。
    backupService: projectBackup,
    // 导出当前文档（批次26）：系统「另存为」对话框 → next/shell/exportService 落盘。
    // 后缀以对话框过滤为准：作者自己敲掉了扩展名就补上，敲了别的后缀则按所选格式再补一层（不猜）。
    exportFile: async ({ content, format, title, html } = {}) => {
      const kind = format === 'doc' ? 'doc' : 'txt'
      const extension = EXPORT_EXTENSIONS[kind]
      const result = await dialog.showSaveDialog(window_, {
        title: kind === 'doc' ? '导出为 Word 文档（.doc）' : '导出为纯文本（.txt）',
        defaultPath: `${exportFileName(title)}${extension}`,
        filters: [{ name: kind === 'doc' ? 'Word 文档' : '纯文本', extensions: [kind] }]
      })
      if (result.canceled || !result.filePath) return { ok: true, value: { canceled: true, path: null, format: kind } }
      const targetPath = result.filePath.toLowerCase().endsWith(extension)
        ? result.filePath
        : `${result.filePath}${extension}`
      return exportDocument({ content, format: kind, targetPath, title: title ?? '', html })
    },
    // 单篇导入（批次46B · 任务③）：系统对话框选 .txt／.md，读成文本交给通道。
    // 解析标题、排顺序号、落盘都在通道／文件服务那侧——这里只负责「从磁盘取一份文本」。
    pickBookDocument: async () => {
      const result = await dialog.showOpenDialog(window_, {
        title: '选择要导入的文稿（.txt / .md，导入后并入当前书的正文）',
        properties: ['openFile'],
        filters: [
          { name: '文稿', extensions: ['txt', 'md'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePaths?.length) return { ok: true, value: { canceled: true, path: null, name: null, text: null } }
      const filePath = result.filePaths[0]
      try {
        const text = await readFile(filePath, 'utf-8')
        return { ok: true, value: { canceled: false, path: filePath, name: basename(filePath), text } }
      } catch (error) {
        return { ok: false, error: { code: 'PINAX_IO_FAILED', message: `读取「${basename(filePath)}」失败：${String(error?.message || error)}` } }
      }
    },
    // 整本导出（批次46B · 任务③）：另存为对话框 → exportService.exportBook 聚合 正文/ 全部章节。
    exportBookFile: async ({ root: projectRoot, format = 'txt', title = null } = {}) => {
      const kind = format === 'doc' ? 'doc' : 'txt'
      const extension = EXPORT_EXTENSIONS[kind]
      const bookTitle = title || session?.project?.value?.name || '整本书'
      const result = await dialog.showSaveDialog(window_, {
        title: kind === 'doc' ? '导出整本为 Word 文档（.doc）' : '导出整本为纯文本（.txt）',
        defaultPath: `${exportFileName(`${bookTitle}-${kind === 'doc' ? '整本' : '全文'}`)}${extension}`,
        filters: [{ name: kind === 'doc' ? 'Word 文档' : '纯文本', extensions: [kind] }]
      })
      if (result.canceled || !result.filePath) return { ok: true, value: { canceled: true, path: null, format: kind } }
      const targetPath = result.filePath.toLowerCase().endsWith(extension)
        ? result.filePath
        : `${result.filePath}${extension}`
      return exportBook({ root: projectRoot, format: kind, targetPath, title: bookTitle })
    },
    // 知识服务（H2）：同一枚单例；通道只把 session.projectRoot 交给它，渲染层指定不了别的根。
    knowledgeService,
    writingComplete,
    settingsStoreFor,
    // 运行过程事件（批次29）：runtimeAsk 期间把运行器的真实阶段推给渲染层。
    // 走既有推送机制（sendToRenderer → webContents.send），通道名在 ipcContract 里；窗口不在时静默丢弃。
    emitRuntimeEvent: (payload) => {
      sendToRenderer(IPC_PUSH.runtimeAskEvent, payload)
      // 批次37：工具循环写出提案那一刻，提案审阅节要能自动刷新。文件服务路径上的那一条
      // （notifyWrite → proposals-changed）也发同一类事件；两次都只是「重读一次」，不合并也不去重——
      // 少刷新一次比多刷新一次难查。
      if (payload?.event?.stage === 'proposal-created' && session?.projectRoot) {
        emitProjectEvent(session.projectRoot, { kind: 'proposals-changed' })
      }
    },
    // 收口包⑤：渲染层的 prefs:theme 通知——事件不是请求，只重设原生窗控浮层。
    onThemeChanged: async (theme) => {
      updateTitleBarOverlay({ theme, zoom: currentUiZoom })
    },
    // 导入既有稿（E1）：结构动作由作者在向导里显式按两次（计划→执行），与建项目同级走主进程；
    // dryRun≠false 一律当计划，只有显式 false 才落盘。
    importProject: ({ sourcePath, targetPath, dryRun }) => (dryRun ? planImport({ sourcePath, targetPath }) : runImport({ sourcePath, targetPath })),
    // 批次30：大纲转换（散文章节稿 → 大纲/outline.json）。源 md 只读、现有节点不动；
    // dryRun 缺省由通道按 true 传进来，只扫描不写盘。
    outlineImport: (args) => importOutlineChapters(args),
    onProjectOpened: beginHistory,
    // 工单E3：关项目即停历史定时器。session.close 不清 projectRoot，停表只能在外壳这一层做；
    // 不重启窗口也能让「关掉项目后不再有新快照」成立。
    // 批次37：同时退订项目事件并摘掉写入钩子（关项目后旧根的事件不该再推给渲染层）。
    onProjectClosed: async () => {
      historyScheduler.stop()
      historyWired = false
      if (detachProjectEvents) {
        detachProjectEvents()
        detachProjectEvents = null
      }
      session?.project?.value?.fileService?.setOnWrite?.(null)
    },
    onPrefsApplied: async (value) => {
      // 保存即生效：端点改网关（null 回默认来源），缩放改当前窗口与原生窗控浮层（无需重开）。
      applyModelPlaneEndpoint(value.modelPlaneEndpoint ?? null)
      if (value.theme === 'light' || value.theme === 'dark') currentScheme = value.theme
      currentUiZoom = value.uiZoom ?? 0.85
      window_?.webContents.setZoomFactor(currentUiZoom)
      // 收口包⑤：偏好保存这条路也会改主题/缩放，浮层跟着走（与 prefs:theme 通知同一个函数）。
      updateTitleBarOverlay({ theme: currentScheme, zoom: currentUiZoom })
      // 历史间隔同样保存即生效：已绑定项目时按新间隔重起（0＝关闭定时器）。
      const current = historyScheduler.status()
      if (current.ok && current.value.root) {
        await historyScheduler.start({ root: current.value.root, intervalMinutes: value.historyIntervalMinutes ?? 5 })
      }
    },
    onMenuInvoke: async (id) => {
      // 工单A：「打开提案目录」从「运行时」组并入「项目」组，id 随组改名；处理方式不变。
      if (id === 'project.proposals') sendToRenderer(IPC_EVENT.runtimeProgress, { kind: 'proposals', dir: '.pinax/proposals/' })
      // 工单A：「编辑」组补了 id，页内菜单行的撤销/剪贴板经这里落到当前窗口的编辑命令。
      // 原生菜单那一半仍是 role（Electron 直办）；窗口可能已经关了，这里判空、不抛。
      const editCommand = EDIT_MENU_COMMANDS[id]
      if (editCommand) {
        const contents = window_ && !window_.isDestroyed() ? window_.webContents : null
        contents?.[editCommand]?.()
      }
      // 工单F：页内菜单行里的「退出」走同一条 menuInvoke 分发（原生菜单那一半仍由 role:'quit' 直办）。
      // 放到下一拍再退：让这次 IPC 的回执先发出去，再进 before-quit 的历史兜底。
      if (id === 'app.quit') setImmediate(() => app.quit())
    }
  })

  // PINAX_NEXT_ROOT 直开的项目也接历史；IPC 打开/新建的项目走 onProjectOpened。
  if (session.project?.ok) {
    await beginHistory({ root: session.projectRoot, fileService: session.project.value?.fileService })
  }

  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.handle(channel, async (_event, payload) => slimForIpc(await dispatcher.dispatch(channel, payload)))
  }

  window_ = createWindow(preloadPath || join(currentDir, 'preload.mjs'), uiZoom, currentScheme)
  // 收口包⑤：启动触发点——首帧浮层已按常量给过，这里再按实际状态对齐一次（幂等）。
  updateTitleBarOverlay({ theme: currentScheme, zoom: currentUiZoom })
  window_.on('closed', () => { window_ = null })
  await loadRenderer(window_, env)
  sendToRenderer(IPC_EVENT.viewChanged, shellView(session))
  return { session, dispatcher, window: window_ }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 关窗兜底（D1）：先补一次历史快照再退出。
// 最多等 10 秒——仓库/磁盘异常也不能把应用卡死在退出流程里；超时照样退出。
let quittingAfterHistory = false
app.on('before-quit', (event) => {
  if (quittingAfterHistory) return
  quittingAfterHistory = true
  event.preventDefault()
  const deadline = new Promise((resolveDeadline) => {
    const timer = setTimeout(resolveDeadline, 10_000)
    timer.unref?.()
  })
  Promise.race([historyScheduler.beforeQuit(), deadline])
    .catch(() => {})
    .finally(() => app.quit())
})

// 只有作为 Forge/Node 的直接入口运行时才自启，单测与 bundle 构建 import 它不应拉起 Electron。
// 判据不是「argv[1] 恰好是本文件」——带参数的启动器（Playwright 的 --inspect、electron-forge、
// 打包后的 exe）都会改写 argv 的形状，照旧判就会永远不起窗。现在：argv 里任何一项指到本文件即算，
// 打包态（app.isPackaged）直接算——那时 argv 里根本没有脚本路径。
const entryFile = fileURLToPath(import.meta.url)
const invokedDirectly = app.isPackaged === true || process.argv.slice(1).some((arg) => {
  try {
    return resolve(String(arg)) === entryFile
  } catch {
    return false
  }
})
// 抢不到单实例锁的进程已经在上面 app.quit()：不再装配会话、不再建窗（second-instance 负责提窗）。
if (invokedDirectly && singleInstanceLock) {
  // 直开项目的两个入口（取先到）：位置参数（启动器传绝对路径，UTF-16 传递不吃编码）或
  // PINAX_NEXT_ROOT env。位置参数必须长得像绝对路径才认——argv 形态随打包方式变，宁缺毋滥。
  const cliRootArg = process.argv[2]
  const cliRoot = typeof cliRootArg === 'string' && /^[A-Za-z]:[\\/]/.test(cliRootArg) ? cliRootArg : null
  startNextShell({ root: cliRoot || process.env.PINAX_NEXT_ROOT || null }).catch((error) => {
    // eslint-disable-next-line no-console -- 启动阶段的崩溃必须留在 stdout/日志里，这里是主进程，没有渲染层可报
    console.error('[pinax-next] 外壳启动失败：', error)
    app.quit()
  })
}
