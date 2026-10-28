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

// 数据/缓存目录跟随 PINAX_APP_DATA（批次16 验收修）。
// 默认 userData（%APPDATA%/Electron）被所有实例共享：一个实例被强杀后残留的缓存锁，
// 会把下一个实例卡死在 renderer 出生之前（症状＝主进程活、无 renderer 子进程、无窗口）。
// setPath 必须在 whenReady 之前：Cache/GPUCache/锁文件全部跟着走，实例之间彻底隔离。
const pinnedAppData = process.env.PINAX_APP_DATA
if (pinnedAppData) app.setPath('userData', pinnedAppData)

/**
 * 界面缩放：作者口径 0.85（1440×900 下三栏＋右栏的舒适档）。
 * 优先级：env PINAX_NEXT_ZOOM（批次7 的覆写口）＞偏好文件（批次8 偏好面，uiZoom）＞默认 0.85。
 * 菜单「视图」里另有放大/缩小/重置（重置＝100%）。越界值一律回默认，不猜。
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

function createWindow(preloadPath, uiZoom) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Pinax · Next',
    backgroundColor: '#101014',
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
      const title = input?.purpose === 'import-source'
        ? '选择要导入的稿子目录（只读：导入不会改、不会删这里任何文件）'
        : '选择新项目文件夹（需要空目录，可在对话框里新建）'
      const result = await dialog.showOpenDialog(window_, {
        title,
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths?.length) return { ok: true, value: { picked: false, path: null } }
      return { ok: true, value: { picked: true, path: result.filePaths[0] } }
    },
    history: { gitHistory, scheduler: historyScheduler },
    // 导入既有稿（E1）：结构动作由作者在向导里显式按两次（计划→执行），与建项目同级走主进程；
    // dryRun≠false 一律当计划，只有显式 false 才落盘。
    importProject: ({ sourcePath, targetPath, dryRun }) => (dryRun ? planImport({ sourcePath, targetPath }) : runImport({ sourcePath, targetPath })),
    onProjectOpened: beginHistory,
    // 工单E3：关项目即停历史定时器。session.close 不清 projectRoot，停表只能在外壳这一层做；
    // 不重启窗口也能让「关掉项目后不再有新快照」成立。
    onProjectClosed: async () => { historyScheduler.stop() },
    onPrefsApplied: async (value) => {
      // 保存即生效：端点改网关（null 回默认来源），缩放改当前窗口（无需重开）。
      applyModelPlaneEndpoint(value.modelPlaneEndpoint ?? null)
      window_?.webContents.setZoomFactor(value.uiZoom ?? 0.85)
      // 历史间隔同样保存即生效：已绑定项目时按新间隔重起（0＝关闭定时器）。
      const current = historyScheduler.status()
      if (current.ok && current.value.root) {
        await historyScheduler.start({ root: current.value.root, intervalMinutes: value.historyIntervalMinutes ?? 5 })
      }
    },
    onMenuInvoke: async (id) => {
      if (id === 'runtime.tools' || id === 'view.focusRuntime') sendToRenderer(IPC_EVENT.runtimeProgress, { kind: 'tools' })
      if (id === 'runtime.proposals') sendToRenderer(IPC_EVENT.runtimeProgress, { kind: 'proposals', dir: '.pinax/proposals/' })
    }
  })

  // PINAX_NEXT_ROOT 直开的项目也接历史；IPC 打开/新建的项目走 onProjectOpened。
  if (session.project?.ok) {
    await beginHistory({ root: session.projectRoot, fileService: session.project.value?.fileService })
  }

  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.handle(channel, async (_event, payload) => slimForIpc(await dispatcher.dispatch(channel, payload)))
  }

  window_ = createWindow(preloadPath || join(currentDir, 'preload.mjs'), uiZoom)
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
