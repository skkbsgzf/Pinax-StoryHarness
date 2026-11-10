# Pinax-Electron-Next M2 批次17：统一标题栏＋打开项目接线＋无项目竖条常驻（2026-10-28）

> 作者三条真窗口反馈的一次性收口（原话见工单）：①顶部工具与 logo 平齐＋该位置展示项目信息；
> ②「打开项目」行不通；③无项目时左侧按钮没了。
> 执行：workflow coder（DeepSeek flash）单工单全绿；调度方验收（独立门禁 181/181＋59/59、重建重拍真窗口截图）。

## 1. 交付

**统一标题栏**：`main.mjs` BrowserWindow 加 `titleBarStyle:'hidden'`＋`titleBarOverlay`（Windows 窗控保留：透明底让 `--workbench-chrome` 透上来、symbolColor 取明暗两档 `--text-muted` 中间值、height 36——与 token 的对应关系逐条注释；随主题实时切换记账未做）。AppNext 根节点加全宽 `.nx-titlebar`（整条 drag、按钮/下拉 no-drag、Esc/点外部收起）：品牌「Pinax · Next」＋**MENU_TEMPLATE 页内菜单行**（与原生菜单同走 menuInvoke 分发；accelerator 仍由保留的原生 ApplicationMenu 提供）＋**项目信息 chip**（`{name} · {kind} · 第 {revision} 版`；无项目「未打开项目」）＋原生窗控占位 138px。
**project.open 接线**：menuInvoke `project.open` → `projectPickDir` → `projectOpen({root})` → refresh；openError 走既有 banner（D2 闸的如实文案可见）。
**无项目竖条常驻**：ActivityRail 加无项目形态——载体格来自 registry.list()（与 view 无关），禁用态＋tooltip「打开项目后可用」；顶部「打开项目…」「新建项目…」两枚动作；主题钮保留。有项目时恢复既有形态。

## 2. 门禁与截图

- 调度方独立复跑 `verify:next`：验收 16/16、内核单测 **181/181**、外壳界面测 **59/59**、eslint 0 警、打包 a–k 全过（工单侧亦一次全绿）。
- 截图（真窗口，`png/`）：`32-light-titlebar-dameng.png`（浅色·大梦全文载入＋标题栏）、`33-dark-titlebar-dameng.png`（深色）、`34-light-no-project.png`（无项目态：竖条常驻＋标题栏「未打开项目」chip）。

## 3. 执行方上报、调度方已核

1. 页内菜单「悬停即展开」比 Windows 原生（已展开才跟随）激进——保留，作者嫌扫过弹开可改保守（一行）。
2. `projectPickDir` 对「打开项目」沿用共享对话框标题（语义略偏）——下一批加 purpose 分支。
3. uiZoom=0.85 时渲染层 36 CSS px ≈ 30.6 DIP，与 overlay height 36 DIP 有 5px 级偏差——可用 `setTitleBarOverlay` 跟随 zoom 修（记账）。
4. overlay 色不随主题实时切换（记账）。
5. 无 id 的原生 role 项（撤销/复制等）在页内渲染为禁用行——原生菜单与快捷键照常可用；「退出」经 main.mjs onMenuInvoke 补 app.quit 已可用。
6. 既有 `console.error('窗口已显示')` 的 no-console 警告补了 eslint-disable（启动器自愈依赖这行输出）。

## 4. 诚实边界

- 真窗口观感由调度方截图确认（本批截图即真窗口）；悬停底色、caption 按钮与 36px 条的对齐等细节未逐像素核。
- 窄屏（<860px）下标题栏品牌＋菜单行＋chip 可能横向溢出，未为标题栏写窄屏规则（窄屏线的领地，归批次9 线）。
- macOS/Linux 的 hidden titlebar 行为未验证（本批只给 Windows overlay 值，未按平台分支）。
- 无项目竖条的载体格图标取清单 panes 的 left-dock icon，缺失退回 library。
