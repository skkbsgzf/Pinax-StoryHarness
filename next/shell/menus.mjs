/**
 * 应用级菜单（规范 v1 第 6 节第 2 条）。
 * 今天整个 electron/ 目录 grep 不到 `Menu`——这是桌面版「Agent 优先级低」的物理症状之一。
 * 本模块只产数据，主进程用 Menu.buildFromTemplate 落；载体不得注入（C5＋保留字 top-menu）。
 *
 * 工单A（作者裁定，2026-10-28）：顶部只留四组——项目／编辑／设置／帮助。
 *   - 「文件」改名「项目」（全是项目级动作）；「最近项目」未实现，删（记账）。
 *   - 「视图」删组：焦点×3 是键盘少数派（记账）；缩放已在偏好节（native zoom 与 zoomFactor
 *     双轨冲突）；DevTools/重载迁入帮助组。
 *   - 「运行时」删组：提问＝右栏输入框、工具面＝右栏折叠；「打开提案目录」并入项目组。
 *   - 「窗口」删组：最小化/关闭＝系统窗控 overlay（main.mjs 的 titleBarOverlay）。
 *   - 「编辑」补 id：页内菜单行（AppNext）只认有 id 的项，补上之后撤销/剪贴板在页内也能点；
 *     原生那一半仍是 role，由 Electron 直办（accelerator 也由 role 默认值提供）。
 */
export const MENU_TEMPLATE = Object.freeze([
  {
    label: '项目',
    submenu: [
      { id: 'project.create', label: '新建项目…', accelerator: 'CmdOrCtrl+Shift+N' },
      { id: 'project.open', label: '打开项目文件夹…', accelerator: 'CmdOrCtrl+O' },
      // 工单E1：老作者带稿上车的一次性门槛。入口只负责摊开统一二级页（导入既有稿），
      // 真正的计划/落盘在主进程的 project:import-run 通道里（不经模型侧写族闸）。
      { id: 'project.import', label: '导入既有稿…' },
      // 工单G2：整目录复制到作者选定的位置／从备份复制回空目录（零新依赖，不做 zip）。
      { id: 'project.backup', label: '备份与恢复…' },
      { id: 'project.history', label: '当前文档历史…', accelerator: 'CmdOrCtrl+Shift+H' },
      // 工单A：从「运行时」组迁来（那个组整体删了）。主进程收到后给渲染层发提案目录提示。
      { id: 'project.proposals', label: '打开提案目录' },
      { type: 'separator' },
      { id: 'app.quit', label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
    ]
  },
  {
    label: '编辑',
    submenu: [
      { id: 'edit.undo', label: '撤销', role: 'undo' },
      { id: 'edit.redo', label: '重做', role: 'redo' },
      { type: 'separator' },
      { id: 'edit.cut', label: '剪切', role: 'cut' },
      { id: 'edit.copy', label: '复制', role: 'copy' },
      { id: 'edit.paste', label: '粘贴', role: 'paste' },
      { id: 'edit.selectAll', label: '全选', role: 'selectAll' }
    ]
  },
  {
    label: '设置',
    submenu: [
      { id: 'settings.preferences', label: '偏好与模型…' },
      { id: 'settings.carriers', label: '载体管理…' },
      { id: 'settings.theme', label: '切换明暗主题' }
    ]
  },
  {
    label: '帮助',
    submenu: [
      { id: 'help.spec', label: 'Next 规范 v1' },
      { id: 'help.gate', label: '运行 M1 门禁' },
      { type: 'separator' },
      // 工单A：从「视图」组迁来；没有 id，页内菜单行渲染为禁用行（原生菜单与快捷键照常）。
      { role: 'toggleDevTools', label: '开发者工具' },
      { role: 'reload', label: '重载' }
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
