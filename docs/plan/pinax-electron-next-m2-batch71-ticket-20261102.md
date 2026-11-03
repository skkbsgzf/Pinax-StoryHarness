# 批次71 工单：宿主接线三笔（破图／外部 pane 空态／卸载入口）（2026-11-02）

> 调度方工单（独立可执行）。来源：批次65a 记录里三笔明写「交调度方」、后续 65b/66 无人认领的宿主缺口（外部载体装了但用不了，是目标①「高可玩性」的直接反面）。
> 基线：批次69 收口点（开工时以 git log 现查为准）。
> **前置裁定**：本批验收要真窗口实拍三张，需作者放行执行方用 Playwright＋vite 真浏览器（协议 v3 那轮的工装）或 Electron。不放行则本批只能做到「代码＋jsdom 断言」，实拍继续挂调度方。

## 任务（五条）

1. **竖条缺省图标不再破图**：因果链实测过——`next/kernel/carrierManifest.mjs:616` 把未声明 icon 的 pane 归一成 `'plugin'`；`ActivityRail.vue:40-43` 直接取 `pane.icon`（`'plugin'` 是真值，走不到它自己的 `'library'` 兜底）；图标组件是 **`src/components/workbench/WorkbenchIcon.vue`**（`ActivityRail.vue:3` 从老前端 import 本体，字表里有 `library`／`character`／`collaboration`… **没有 `plugin`**），`:180` 的 `icons[name] || FileQuestion` 于是渲染成问号。
   **注意边界**：字表在 `src/**`，与本族工单的禁止面冲突。所以本批的修法只能在 Next 侧二选一：①把归一缺省值改成一个**已存在**的字形（建议 `library`，与 `ActivityRail.vue:43` 的自有兜底一致）；②在 Next 侧加一张「外部/未知图标名 → 已存在字形」的解析表。**不许为了一个图标去改老前端 CSS/组件**——真要动 `src/**` 那张字表，请作者另开口子。守卫加一条断言：**每一块载体最终解析出的图标名都必须 ∈ 字表**（防「新增字形又漏」）。
2. **外部载体的自定义视图有渲染出口**：实测今天不是「白屏」而是**诚实占位**——`CarrierPaneHost.vue:1727` 显示「这块板块的面板视图还没做出来，工具和上下文块照常可用」；根因在视图解析层：`viewRegistry.mjs:33` 只给第三方一个 `pinax.view.custom` 类型名（`:122` 起宿主视图名一律保留、`registerView` 拒重名），富视图沙箱从未落地。本批要让外部插件声明的 custom view **真解析出组件并渲染**（走 `registerViewEffect`／`disposeOwner` 既有效应栈，不新开注册通道）。**〔订正〕**原工单写的「`CarrierPaneHost` 不认外部插件 `dataDirs`」经查不成立：`AppNext.vue:1008` 已把 `carrier.dataDirs` 带进 board、`IndexWindow.vue:258` 也在消费——所以取数面不是缺口，视图渲染才是。
3. **卸载有通道也有按钮**：kernel 与 project 两层都齐——`next/kernel/pluginRegistry.mjs:161 uninstall()`（跑清理钩子＋效应栈逆序拆）、`next/project/externalPlugins.mjs:146`（移进 `.pinax/plugins/.trash/<时间戳>/<id>`，非真删）、`acceptance.mjs:732` 已在门禁里测过；`next/doctor.mjs:67` 的提示语甚至已经写了「卸载请走载体管理面板」。**但实测 `next/shell/**` 内 `uninstall` 0 命中**——没有 IPC 通道注册、设置页「载体管理」也没有那颗按钮，等于让作者按一句提示去手工挪目录。补齐：`IPC_CHANNELS` 加通道＋主进程接 `externalPlugins` 的卸载口＋`settings/CarriersSection.vue` 加按钮。要做二次确认、显示回收站实际路径、失败如实（不许「点了没反应」）。
4. **同秒双卸载并发**：回收站目录名撞名会报 `IO_FAILED`、「卸载已生效但目录没进回收站」。给目录名加随机段或上文件锁（本机无跨进程锁基建，优先目录名方案），并把这条从「极端情况」降级成「测过的行为」。
5. **`registerEffect` 失败是否整体回滚**（批次64 记录留的判定）：今天不回滚已成功的 install。本批要么实现「效应失败＝整体卸载」，要么按「保留已装＋效应记账」定口径——**执行方按代码实况裁并把理由写进记录**，因为两种都要有守卫断言，不能停留在口头。

## 允许文件

`next/kernel/carrierManifest.mjs`（缺省图标值）、`next/shell/ActivityRail.vue`（图标解析兜底）、`next/shell/viewRegistry.mjs`＋`next/shell/CarrierPaneHost.vue`（custom view 解析与渲染）、`next/shell/ipcContract.mjs`（卸载通道）、`next/shell/main.mjs`（卸载分发）、`next/shell/settings/CarriersSection.vue`（卸载按钮＋回收站路径显示）、`next/project/externalPlugins.mjs`＋`next/kernel/pluginRegistry.mjs`（卸载与并发段）、`next/testing/bundleAssertions.mjs`（图标 ∈ 字表的守卫）、`next/tests/**`、`docs/plan/**`。**`src/**` 不在允许面**（含 `src/components/workbench/WorkbenchIcon.vue` 那张字表）——要动它得作者另开口子。

## 禁止边界

不动 12 份载体清单的语义字段（只允许图标名缺省的解析结果变化）；不动协议版本／写族闸／窗口命令面；不改 `server/**`、`src/**`；不加 npm 依赖；不执行 git；截图用既有 Playwright 工装，不新建服务常驻（收口即停）。

## 守卫标记

批次45–70 全清单继承；本批新守卫：图标名 ∈ 字表的全量断言、卸载通道在 `IPC_CHANNELS` 里且已注册、外部载体 dataDirs 解析断言（jsdom 层可测）。

## 验收判据

`npm run verify:next` 五段全绿；三张实拍（修复前问号／修复后图标；外部 pane 空态／有内容；卸载点下去后进回收站且设置页有记录）进记录——若窗口未放行，记录里必须明写「实拍未做，随调度方实览」，不许用 jsdom 断言冒充。

## 记账指标（不进闸）

外部声明型插件的装载→开窗→卸载全链路读数（几块、哪几块破图被修）；`registerEffect` 失败样本的实际计数（可能为 0，写「量到的 0」）。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch71-20261102.md`；§8 调度方补。）
