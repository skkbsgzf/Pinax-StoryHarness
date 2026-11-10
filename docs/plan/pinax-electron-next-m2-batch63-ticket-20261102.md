# 批次63 工单：状态栏＋故障隔离＋批次62 四笔收编（Obsidian 框架轮·桩1 续）（2026-11-02）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。工单源：框架计划 §6 桩1⑤＋§11 批次63；并收编批次62 评审的四笔已披露账。

## 任务（四条）

1. **StatusBar.vue（新，底栏常驻）**：服务灯（复用批次49 serviceLogPool 状态）＋当前载体/页组＋「1＋N 的 N」（N＝在册窗数，数据从 workspace v3 现取）＋焦点文档字数；文本对比 ≥4.5:1、可点件 ≥24×24（审计 H 判据）；**不做死按钮**（作者裁定③——可点件限于既有语义：服务灯点击开服务与通知节）。
2. **故障隔离回归**（规范 §9.3 从未实现那条）：全部载体 enabled=[] 时——外壳不白屏、竖条仍显、**Ctrl+P 面板仍可唤起可执行**（面板列应用菜单动作）；spec 钉住。这是「停用全部插件后运行时仍可用」的可见形态。
3. **收编 a（批次62 medium）——hotkeys 主进程接线**：main.mjs 建 hotkeysStore（照 settingsStore/carrierOverridesStore 模式：`.pinax/hotkeys.json`、原子写、坏档回默认记账）注入 session，hotkeysLoad/Save 两通道落真盘；**裸单字符键位白名单收窄到 SPECIAL_KEYS**（Esc/Enter/Tab/Space——hotkeys.mjs:147 的 `name.length===1` 放行改掉），存档里出现裸字母键一律拒并记账。
4. **收编 b/c/d（批次62 low 三笔）**：①menu:invoke 对载体命令 id 不再假成功——渲染层 runMenuAction 对载体 id 走 palette 同款执行通路（command run），主进程侧维持接受集；②Ctrl+Shift+R 单点化——保留原生菜单 accelerator，渲染层 matchHotkey 排除已有原生 accelerator 的菜单项（对照表一处）；③两项均带测试调整与理由。

## 允许文件

`next/shell/StatusBar.vue`（新）、`next/shell/main.mjs`（hotkeysStore＋状态栏数据源）、`next/shell/hotkeys.mjs`（白名单收窄）、`next/shell/ipcContract.mjs`（如需）、`next/shell/AppNext.vue`（挂载＋runMenuAction）、`next/shell/menus.mjs`（如需）、`next/runtime/serviceLogPool.mjs`（如只读透出）、`next/tests/`＋受影响 spec、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（计数写理由）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不改协议 schema；不动写族闸/文件服务；不加 npm 依赖；状态栏不做新按钮/新动作（只承载既有语义的可见性）；不动 `server/**`、`src/**`、外部三目录；不起 Electron、不执行 git。

## 守卫标记

批次45–62 全清单继承；本批新守卫：StatusBar 组件存在且四要素齐、裸单字符拒用例、全载体停用不白屏用例。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿；真窗口实拍（状态栏四要素＋全载体停用后面板可唤起）调度方接管；hotkeys.json 真盘往返用例在。

## 记账指标（不进闸）

状态栏对比度实测值；停用全部载体的面板枚举数。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch63-20261102.md`；§8 调度方补；diff 指引用临时索引法。）

### §7 执行方回填（Qoder CLI，2026-11-03）

四条任务全做完。`npm run verify:next` 五段全绿（`EXIT=0`）：acceptance **39/39**（＋2 条：状态栏在位／对比度实测）、node:test **694**（批次62 基线 689，＋5 条合同用例）、vitest **200**（14 文件，`shell-ui.spec.mjs` **89** 例，＋4 例）、`lint:next` 零告警、bundleAssertions 全过（计数一个字没改，理由见记录 §6）。

落点速览：状态栏 `next/shell/StatusBar.vue`（新）＋挂载与取数 `AppNext.vue:2408`/`:444-486`；故障隔离 `next/tests/shell-ui.spec.mjs` 末段 describe（生产代码未改）；收编 a `main.mjs:617/650/655` ＋ `hotkeys.mjs:155/185/385`；收编 b `AppNext.vue:684`；收编 c `hotkeys.mjs:99-106`（实测 `nativeAcceleratedIds()` ＝ `['project.reviewProposals']`）。

记账指标（不进闸）：状态栏文本对比 **6.14:1（明亮）／7.56:1（深色）**，色值从 `legacy.css` 现读、按 WCAG 公式实测；**全部载体停用后的面板枚举数 ≈ 19**（应用菜单动作，载体 53 条此刻一条都不出现）。

三条要调度方过目的（全文见记录 §7）：
1. **「1＋N 的 N」口径冲突**：工单＝在册窗数，`spec v2:337`＝启用载体数。按工单实现，统一方向待裁。
2. **状态栏样式没进 `next-shell.css`**：该文件不在允许清单内，`.nx-statusbar` 收进组件 `<style scoped>`；代价是底栏高度 26px 只能就地写死（门禁只认布局层里的 token 定义）。
3. **真窗口实拍交调度方**：本批未起 Electron，24×24 在真 DPI 下的实际像素这条只有实拍能给。另记一次与批次无关的 vitest 抖动（`carrier-pane-real.spec.mjs` 偶发 unhandled `McpError -32000`，复跑绿），见记录 §7.6。

