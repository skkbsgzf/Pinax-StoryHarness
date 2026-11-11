/**
 * 应用级菜单（规范 v1 第 6 节第 2 条）。
 * 今天整个 electron/ 目录 grep 不到 `Menu`——这是桌面版「Agent 优先级低」的物理症状之一。
 * 本模块只产数据，主进程用 Menu.buildFromTemplate 落；载体不得注入（C5＋保留字 top-menu）。
 *
 * 工单A（作者裁定，2026-10-28）：顶部只留四组——项目／编辑／设置／帮助。
 *   - 「文件」改名「项目」（全是项目级动作）；「最近项目」当时未实现先删（记账），
 *     2026-11-10 作者点名补回——见文件尾 withRecentProjects（清单真值在应用级偏好，不在模板里）。
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
      // 工单B1（协议 v1.1-B）：提案审阅迁出小说板索引窗，落统一二级页「文档 → 提案审阅」。
      // 批次62（裁定 Q3）：accelerator 让位给命令面板——Ctrl+Shift+P 从此是面板的键，
      // 提案审阅改 Ctrl+Shift+R。这一份模板同时是 next/shell/hotkeys.mjs 默认键位的唯一来源。
      { id: 'project.reviewProposals', label: '提案审阅…', accelerator: 'CmdOrCtrl+Shift+R' },
      // 工单A：从「运行时」组迁来（那个组整体删了）。主进程收到后给渲染层发提案目录提示。
      { id: 'project.proposals', label: '打开提案目录' },
      // 库管理器（前端工单 A-1）：有项目时点它＝关闭当前项目回到「我的库」（关闭通道已存在）。
      { id: 'project.library', label: '我的库…' },
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

/* —— 最近打开的项目（作者 2026-11-10 点单；工单A 删掉的「最近项目」按事实补回）—————————
 * 清单本身是应用级偏好（next/runtime/appPreferences.mjs 的 recentProjects 字段）：
 * 主进程在项目真打开成功后记账、变化后重建原生菜单并整份推给渲染层。
 * 本文件只管形状：withRecentProjects 把清单拼进「项目」组，原生菜单（main.mjs buildMenu）
 * 与页内菜单行（AppNext）调的是同一个函数——动态项不另立第二份菜单清单。
 * 分工钉死：
 *   · project.recent（某一项）＝渲染层落点：打开走既有 pick-dir→project:open 链（openProjectRoot），
 *     主进程对「打开哪个目录」没有可代劳的事——不进 dispatcher 接受集、不进命令面板；
 *   · project.recentClear（清空）＝应用菜单动作，主进程落点（清偏好→重建菜单→推渲染层），
 *     所以它进 ipcContract 的接受集（按常量加，模板里没有静态项——列表为空时整个块都不渲染）。
 */
export const RECENT_MENU_ID = 'project.recent'
export const RECENT_CLEAR_ID = 'project.recentClear'

/** 一条最近项目的菜单标签：项目名与目录同名（或没记到名）就只摆路径，否则「名 — 路径」。 */
export function recentProjectLabel(entry) {
  const path = String(entry?.path ?? '')
  const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
  const basename = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  if (!name || name === basename) return path
  return `${name} — ${path}`
}

/**
 * 把最近项目清单拼进「项目」组：project.open 之后插入一段（分隔线＋灰色组头＋条目＋清空＋分隔线）。
 * 清单为空（或没有可用条目）时原样返回——没开过项目就少一块噪音，两个渲染面一致。
 * 纯函数：返回新数组，从不改动传入模板（MENU_TEMPLATE 冻结，调用方还要复用）。
 */
export function withRecentProjects(template = MENU_TEMPLATE, recents = []) {
  const list = (Array.isArray(recents) ? recents : []).filter((entry) => entry && typeof entry.path === 'string' && entry.path)
  if (!list.length) return template
  const block = [
    { type: 'separator' },
    // 组头不是动作：enabled:false 让原生菜单与页内菜单行都渲染成灰行（页内＝无 id 的禁用行）。
    { label: '最近打开', enabled: false },
    ...list.map((entry) => ({
      id: RECENT_MENU_ID,
      label: recentProjectLabel(entry),
      root: entry.path,
      // title 给页内菜单行当 hover 提示（长路径截断时看全名）；原生菜单会忽略这个键。
      title: entry.path
    })),
    { id: RECENT_CLEAR_ID, label: '清除最近打开' },
    { type: 'separator' }
  ]
  return template.map((top) => {
    if (top.label !== '项目' || !Array.isArray(top.submenu)) return top
    const at = top.submenu.findIndex((item) => item.id === 'project.open')
    if (at < 0) return top
    return { ...top, submenu: [...top.submenu.slice(0, at + 1), ...block, ...top.submenu.slice(at + 1)] }
  })
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

/**
 * 展平成一维 {id,label,accelerator}（批次62 任务2／3）。
 * 命令面板与 `command:list` 要能把「这条动作现在挂在哪个键上」如实摊给作者；
 * 键位只在这份模板里写一次，hotkeys 的默认值也从这里取——两处各写一份迟早会飘。
 */
export function flattenMenuEntries(template = MENU_TEMPLATE) {
  const out = []
  const walk = (items) => {
    for (const item of items) {
      if (item.id) out.push({ id: item.id, label: item.label, accelerator: item.accelerator ?? '' })
      if (Array.isArray(item.submenu)) walk(item.submenu)
    }
  }
  walk(template)
  return out
}
