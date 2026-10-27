import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createNextSession } from '../index.mjs'
import { createAdvisorRunner } from '../runtime/runnerAdvisor.mjs'
import { IPC_CHANNELS, IPC_EVENT, createIpcDispatcher, shellView } from './ipcContract.mjs'
import { MENU_TEMPLATE } from './menus.mjs'

/**
 * Next 桌面外壳的主进程入口（WP4）。
 * 三件事是这层的全部职责，且都是「今天整个 electron/ 目录里不存在」的东西：
 *   1) 建立应用级菜单（Menu 在本仓第一次落地——运行时因此有菜单栏归属，不再只能靠渲染层堆按钮）；
 *   2) 起内核会话（主进程内装配，无 Express、无端口）；
 *   3) 把内核能力按通道名挂到 ipcMain（渲染层只认 next/shell/ipcContract 的通道，碰不到实现）。
 * 窗口文件由打包侧注入：dev 走 vite dev server，prod 走打包后的 renderer html。
 */
const currentDir = dirname(fileURLToPath(import.meta.url))

/**
 * 界面缩放：作者口径 0.85（1440×900 下三栏＋右栏的舒适档），可用 PINAX_NEXT_ZOOM 覆写，
 * 菜单「视图」里另有放大/缩小/重置（重置＝100%）。越界值回默认，不猜。
 */
function resolveUiZoom() {
  const parsed = Number.parseFloat(process.env.PINAX_NEXT_ZOOM ?? '0.85')
  return Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2 ? parsed : 0.85
}

let session = null
let dispatcher = null
let window_ = null

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

function createWindow(preloadPath) {
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
      zoomFactor: resolveUiZoom()
    }
  })
  win.once('ready-to-show', () => win.show())
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

  // 运行器只在主进程装：它把提问接到内核任务面漏斗（进程内，不开端口）。
  // 测试与验收一律不注入，那条「未接模型运行器」的如实失败路径要一直留在 CI 里。
  session = await createNextSession({
    root: root || app.getPath('documents'),
    autoOpen: Boolean(root),
    runtimeOptions: { runner: createAdvisorRunner() }
  })
  dispatcher = createIpcDispatcher({
    session,
    onMenuInvoke: async (id) => {
      if (id === 'runtime.tools' || id === 'view.focusRuntime') sendToRenderer(IPC_EVENT.runtimeProgress, { kind: 'tools' })
      if (id === 'runtime.proposals') sendToRenderer(IPC_EVENT.runtimeProgress, { kind: 'proposals', dir: '.pinax/proposals/' })
    }
  })

  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.handle(channel, async (_event, payload) => dispatcher.dispatch(channel, payload))
  }

  window_ = createWindow(preloadPath || join(currentDir, 'preload.mjs'))
  window_.on('closed', () => { window_ = null })
  await loadRenderer(window_, env)
  sendToRenderer(IPC_EVENT.viewChanged, shellView(session))
  return { session, dispatcher, window: window_ }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 只有作为 Forge/Node 的直接入口运行时才自启，单测与 bundle 构建 import 它不应拉起 Electron。
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  // PINAX_NEXT_ROOT：直接打开指定项目（演示/验收用），不设则停在首页向导。
  startNextShell({ root: process.env.PINAX_NEXT_ROOT || null }).catch((error) => {
    // eslint-disable-next-line no-console -- 启动阶段的崩溃必须留在 stdout/日志里，这里是主进程，没有渲染层可报
    console.error('[pinax-next] 外壳启动失败：', error)
    app.quit()
  })
}
