/**
 * 应用级菜单（规范 v1 第 6 节第 2 条）。
 * 今天整个 electron/ 目录 grep 不到 `Menu`——这是桌面版「Agent 优先级低」的物理症状之一。
 * 本模块只产数据，主进程用 Menu.buildFromTemplate 落；载体不得注入（C5＋保留字 top-menu）。
 */
export const MENU_TEMPLATE = Object.freeze([
  {
    label: '文件',
    submenu: [
      { id: 'project.create', label: '新建项目…', accelerator: 'CmdOrCtrl+Shift+N' },
      { id: 'project.open', label: '打开项目文件夹…', accelerator: 'CmdOrCtrl+O' },
      // 工单E1：老作者带稿上车的一次性门槛。入口只负责摊开统一二级页（导入既有稿），
      // 真正的计划/落盘在主进程的 project:import-run 通道里（不经模型侧写族闸）。
      { id: 'project.import', label: '导入既有稿…' },
      { id: 'project.history', label: '当前文档历史…', accelerator: 'CmdOrCtrl+Shift+H' },
      { type: 'separator' },
      { id: 'project.recent', label: '最近项目', role: null, submenu: [] },
      { type: 'separator' },
      { id: 'app.quit', label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
    ]
  },
  {
    label: '编辑',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]
  },
  {
    label: '视图',
    submenu: [
      { id: 'view.focusLeft', label: '焦点：载体竖条', accelerator: 'CmdOrCtrl+1' },
      { id: 'view.focusCenter', label: '焦点：主面板', accelerator: 'CmdOrCtrl+2' },
      { id: 'view.focusRuntime', label: '焦点：运行时栏', accelerator: 'CmdOrCtrl+3' },
      { type: 'separator' },
      { role: 'resetZoom', label: '重置缩放（100%）' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' },
      { type: 'separator' },
      { role: 'toggleDevTools' },
      { role: 'reload' }
    ]
  },
  {
    label: '运行时',
    submenu: [
      { id: 'runtime.ask', label: '就当前上下文提问…', accelerator: 'CmdOrCtrl+Shift+A' },
      { id: 'runtime.tools', label: '查看工具面' },
      { id: 'runtime.proposals', label: '打开提案目录' }
    ]
  },
  {
    label: '窗口',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
  },
  {
    label: '设置',
    submenu: [
      { id: 'settings.theme', label: '切换明暗主题' },
      { id: 'settings.preferences', label: '偏好与模型…' },
      { id: 'settings.carriers', label: '载体管理…' }
    ]
  },
  {
    label: '帮助',
    submenu: [
      { id: 'help.spec', label: 'Next 规范 v1' },
      { id: 'help.gate', label: '运行 M1 门禁' }
    ]
  }
])

/** 载体注入顶层菜单的尝试在这里就被挡掉（与 kernel 的 RESERVED_SLOTS 同一口径）。 */
export function canCarrierInjectMenu(carrierManifest) {
  return {
    allowed: false,
    reason: `载体「${carrierManifest?.title ?? '(未命名)'}」不能注入顶层菜单；可注入自己面板的上下文菜单（C5）`
  }
}

/** 展平成一维 {id,label}，供主进程分发点击与单测核对。 */
export function flattenMenuIds(template = MENU_TEMPLATE) {
  const out = []
  const walk = (items) => {
    for (const item of items) {
      if (item.id) out.push({ id: item.id, label: item.label })
      if (Array.isArray(item.submenu)) walk(item.submenu)
    }
  }
  walk(template)
  return out
}
