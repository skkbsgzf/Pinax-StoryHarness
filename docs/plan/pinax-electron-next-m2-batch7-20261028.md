# Pinax-Electron-Next M2 批次7：UI 刻度收口 + 界面缩放 + preload 构建修复（2026-10-28）

> 作者睡前指令：继续在 `feat/pinax-electron-next` 分支上做前端一致性与美化，盘点功能规格、定规范化迁移计划、跑完截图。
> 本批三件事：①把「样式一致性」里最后两块系统性缺口（字号/圆角刻度）收进机器门禁；②落地界面缩放 0.85；③修掉一个真产品缺陷（preload 无构建步骤、重建即静默消失）。
> 配套文档：[frontend-inventory](./pinax-electron-next-frontend-inventory-20261028.md)（功能盘点）、[ui-consistency-plan](./pinax-electron-next-ui-consistency-plan-20261028.md)（规范 v1 + 迁移模板）。

## 1. 改了什么

**UI 刻度（规范 v1 的 U9/U10/U11）**
- `next-shell.css` 新增 `--nx-fs-2xs/md/lg/xl/2xl`（11/13/15/17/19px）与 `--nx-radius-xs`（6px）刻度；21 处裸 px 字号/圆角全部换成 `var(--fs-*)`/`var(--radius-*)`/`--nx-*`。
- `visual-contract.test.mjs` 新增两条门禁：自写样式禁止裸 px 字号/圆角/`font:` 简写（U9/U10）；刻度 token 必须真实定义（防 var() 静默失效）。
- `AssistantDialog.vue` 的样式块拆三块：抄老版度量的两块块首标 `legacy-copied`（显式、可 grep 的豁免，U11），Next 自加的「审稿意见/可执行动作」一块走刻度受门禁管。
- 核心区与右栏滚动条统一 `scrollbar-width: thin`（索引窗原来就是）。

**界面缩放（作者浮过的 0.85，本次代裁落地）**
- `main.mjs`：`webPreferences.zoomFactor` 默认 0.85，`PINAX_NEXT_ZOOM`（0.5–2.0）可覆写；菜单「视图」新增放大/缩小/重置（Electron 原生 role，无 id，不碰菜单合同）。shell-contract 新增测试钉住「默认值存在 + env 可覆写 + 菜单三项」。
- `main.mjs` 同时新增 `PINAX_NEXT_ROOT`：直接打开指定项目（演示/验收用），不设则停在首页向导。

**preload 构建修复（本批最重要的真缺陷）**
- 实测踩中：重建渲染层后真窗口报「渲染层未接主进程桥」，界面空壳。根因＝`next/.build/preload.mjs` 是批次 5 时代的一次性手工产物，**没有构建步骤、没有门禁管它**；preload 源相对引入 ipcContract，裸拷贝会 `ERR_MODULE_NOT_FOUND`。
- 修复：新增 `next/vite.next.preload.config.mjs`（与 main/shell 同两条硬规矩：build.ssr + noExternal:true，electron external）；`next:build:shell` 链上 `next:build:preload`；打包门禁新增 **k：preload 在产物里**（就地构建 + 断言存在 + contextBridge/pinaxNext/`pinax:agent:` 标记齐）。

## 2. 截图证据（明暗双拍，U12 首次执行）

Playwright `_electron.launch`（管道调试，不再受裸 CDP 端口/僵尸实例干扰）驱动真窗口，隔离演示项目（`D:\Pinax-e2e\next-batch7-shots\`：seed-demo.mjs 播种 3 章 + 2 世界书条目 + 1 约束，PINAX_APP_DATA/MIRROR 全隔离）：
- `png/01-light-home.png` 浅色首屏（三栏 + 索引窗章节 + 右栏对话）
- `png/02-light-editor.png` 浅色正文编辑（第 1 版 153 字）
- `png/03-light-dock-question.png` 右栏输入态（只摆状态不发送）
- `png/04-dark-editor.png` 深色正文（全暗无白块，U2 成立）
- `png/05-dark-entry.png` 深色设定条目
- 捕获脚本 `capture.mjs`；视口按 zoom 0.85 折算 1694×1059 CSS px（否则截图底部留白带）。

## 3. 门禁

`verify:next` 五段全绿：验收 16/16、内核单测 **122/122**（＋3：字号圆角门禁、刻度定义门禁、缩放参数）、外壳界面测 27/27、eslint 0 警、打包门禁 **a–k 全过**（主 bundle 860.9 kB、渲染层 js 297.3 kB、CSS 87.3 kB、preload 1.7 kB）。

## 4. 排障账（给下一批留的坑谱）

- 裸 CDP（`--remote-debugging-port` + `/json/list`）在本机反复「零页面目标」：多轮 `&` 启动泄漏的 electron 僵尸互相抢 `%APPDATA%/Electron` 缓存 → network service 启动即崩 → renderer 不出生。Playwright `_electron` 走管道后全消失。**下批截图一律走 `_electron.launch`。**
- 一个外来孤儿 electron 实例（`D:/next-preview`，上个会话遗留，父进程已死）曾长期占着共享缓存目录；本轮发现时已自行退出。作者服务 3001/5173/8451 全程未动。
- `--enable-logging` 会改走 Chromium 日志汇，主进程 console.error 不再出现在终端——排障时别被它骗。

## 5. 诚实边界

- 模型面仍是外部手工进程（`设置 → 偏好与模型…` 死菜单留给批次 8①）；自由问答档未加。
- 缩放/首屏偏好没有持久化界面（当前只有 env + 菜单临时调）。
- 主进程窗口底色 `#101014` 仍是硬编码深色（ready-to-show 前不可感知，严格按 U1 该走主题——与偏好面同批收）。
- 截图 01 显示第 3 章处于打开态：项目视图的选中态随演示项目持久化，属正常行为非缺陷。
- 未做真实模型调用（本批无模型链路改动）；回答质量测量仍未开张。
- 本批未提交前的工作副本无 git（提交走 `feat/pinax-electron-next` 分支，见 STATUS）。
