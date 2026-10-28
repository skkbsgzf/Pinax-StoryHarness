import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import * as gitHistory from '../history/gitHistory.mjs'
import { createNextSession } from '../index.mjs'
import { createAdvisorRunner } from '../runtime/runnerAdvisor.mjs'
import { createAppPreferences } from '../runtime/appPreferences.mjs'
import { createHistoryScheduler } from '../runtime/historyScheduler.mjs'
import { probeModelPlane, applyModelPlaneEndpoint } from '../runtime/modelPlaneProbe.mjs'
import { planImport, runImport } from '../runtime/projectImportAdapter.mjs'
import * as projectBackup from '../runtime/projectBackupService.mjs'
import { createKnowledgeService, setSharedKnowledgeService } from '../runtime/knowledgeService.mjs'
import { IPC_CHANNELS, IPC_EVENT, createIpcDispatcher, shellView, slimForIpc } from './ipcContract.mjs'
import { MENU_TEMPLATE } from './menus.mjs'

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

// 数据/缓存目录跟随 PINAX_APP_DATA（批次16 验收修）。
// 默认 userData（%APPDATA%/Electron）被所有实例共享：一个实例被强杀后残留的缓存锁，
// 会把下一个实例卡死在 renderer 出生之前（症状＝主进程活、无 renderer 子进程、无窗口）。
// setPath 必须在 whenReady 之前：Cache/GPUCache/锁文件全部跟着走，实例之间彻底隔离。
const pinnedAppData = process.env.PINAX_APP_DATA
if (pinnedAppData) app.setPath('userData', pinnedAppData)

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

export async function startNextShell({ root = null, env = process.env.NODE_ENV, preloadPath = null } = {}) {
  await app.whenReady()
  buildMenu()

  // 应用级偏好（批次8①）：启动即读、即生效——模型面端点与界面缩放不再只靠 env。
  const prefs = createAppPreferences({ file: preferencesFile() })
  const storedPrefs = await prefs.read()
  const stored = storedPrefs.ok ? storedPrefs.value : { modelPlaneEndpoint: null, uiZoom: null, historyIntervalMinutes: 5 }
  if (stored.modelPlaneEndpoint) applyModelPlaneEndpoint(stored.modelPlaneEndpoint)
  const uiZoom = resolveUiZoom({ storedZoom: stored.uiZoom })
  // 收口包⑤：窗控浮层的启动态＝已存主题（未迁移过就按渲染层同一个默认值 light）＋实际缩放。
  currentUiZoom = uiZoom
  currentScheme = stored.theme === 'dark' ? 'dark' : 'light'

  /**
   * 项目打开/刷新后的历史接线（D1）：建独立 git 仓库 → 给新 fileService 挂「写成功→标脏」→ 起定时器。
   * 任何一步失败都不拦住写作，只在日志留痕；历史面板经 history:probe 如实显示不可用（绝不静默假装可用）。
   */
  async function beginHistory({ root: projectRoot, fileService } = {}) {
    if (!projectRoot) return
    const ensured = await gitHistory.ensureHistoryRepo({ root: projectRoot })
    if (!ensured.ok) {
      // eslint-disable-next-line no-console -- 主进程没有渲染层可报；历史不可用必须留痕
      console.error('[pinax-next] 历史仓库不可用：', ensured.error?.message ?? ensured.error)
      historyScheduler.stop()
      return
    }
    if (fileService?.setOnWrite) {
      fileService.setOnWrite(async ({ relativePath }) => {
        const marked = await gitHistory.markDirty({ root: projectRoot, paths: [relativePath] })
        if (!marked.ok) {
          // eslint-disable-next-line no-console -- 旁路失败不打断写作，但必须留痕
          console.error('[pinax-next] 历史标脏失败：', marked.error?.message ?? marked.error)
        }
      })
    }
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

  // 运行器只在主进程装：它把提问接到内核任务面漏斗（进程内，不开端口）。
  // 测试与验收一律不注入，那条「未接模型运行器」的如实失败路径要一直留在 CI 里。
  session = await createNextSession({
    root: root || app.getPath('documents'),
    autoOpen: Boolean(root),
    runtimeOptions: { runner: createAdvisorRunner() }
  })
  dispatcher = createIpcDispatcher({
    session,
    prefs,
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
    // 知识服务（H2）：同一枚单例；通道只把 session.projectRoot 交给它，渲染层指定不了别的根。
    knowledgeService,
    // 收口包⑤：渲染层的 prefs:theme 通知——事件不是请求，只重设原生窗控浮层。
    onThemeChanged: async (theme) => {
      updateTitleBarOverlay({ theme, zoom: currentUiZoom })
    },
    // 导入既有稿（E1）：结构动作由作者在向导里显式按两次（计划→执行），与建项目同级走主进程；
    // dryRun≠false 一律当计划，只有显式 false 才落盘。
    importProject: ({ sourcePath, targetPath, dryRun }) => (dryRun ? planImport({ sourcePath, targetPath }) : runImport({ sourcePath, targetPath })),
    onProjectOpened: beginHistory,
    // 工单E3：关项目即停历史定时器。session.close 不清 projectRoot，停表只能在外壳这一层做；
    // 不重启窗口也能让「关掉项目后不再有新快照」成立。
    onProjectClosed: async () => { historyScheduler.stop() },
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
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
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
