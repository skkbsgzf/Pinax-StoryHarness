# 批次76-R2 工单：窗 chrome 压平（浏览器 IDE 式一层页签）＋应用面高度链修复（2026-11-05）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。
> 触发：作者看 Toonflow/ComfyUI 双嵌实拍后的裁定——「你真的理解了浏览器 IDE 是怎么做分屏的吗？这个层级做成很普通的平级就可以了」。**本批是呈现层手术，不动 workspace v3 状态轴语义。**

## 作者裁定（原文要点）

1. 外部应用是 iframe 承载，但**高度被限制死**（实测 iframe 仅 150px）——「你限制了它的宽高，那它怎么去展示出自己」。
2. 右中区域一共**三个层级**：画布页签条 → 页签条 → 窗头标题 → 标题下是网址，网址下才是内容——「浏览器 IDE 的分屏就是普通的平级」。

## 现状诊断（调度方实测，2026-11-05）

- 五层堆叠：`nx-center-tabs`（AppNext.vue:2423，画布/ComfyUI 条）→ `nx-page-tabstrip`（PaneTabStrip.vue）→ `nx-pane-window-head`（PaneWindow.vue:266，标题行「载体 · 面板名」＋×）→ `nx-external-app-head`（ExternalAppHost.vue:71，URL 行）→ `nx-app-pane-foot`（CarrierPaneHost.vue:1503，复制地址单开）。
- 高度链断裂：`.nx-pane-window-body` 830px（有定高）→ 子节点 `.pane`（CarrierPaneHost 根）`height:auto` 实测 216px → `.nx-app-pane` 的 `height:100%` 落空 → `.nx-external-app-frame` 仅 150px，body 剩一大片空白 overflow 区。

## 任务（五条）

1. **高度链修复（先做，独立可验）**：`.pane`（CarrierPaneHost 根）在页态窗 body 内吃满可用高度——窗 body 有定高（flex:1 1 auto），pane 根不得用 content 高度自断链条。修完 `iframe.clientHeight ≥ 500`（对半分屏下）成为测试断言（jsdom 量不到排版，就断样式链：`.pane` 或其页态容器必须有 `height:100%`/`flex:1`＋`min-height:0` 的声明链，写进 visual-contract 机器判据）。
2. **页态窗头行撤除**：`state === 'page'` 时 `nx-pane-window-head` 整行不渲染——活动页签就是标题，×挪到页签上（PaneTabStrip 已有 `nx-page-tab-close`，确认页态的关闭走它而不是窗头），拖拽手柄落在页签上（`startDrag` 的 pointerdown 绑定挪绑或双绑页签行；右键形态菜单跟页签行走）。**floating/maximized 态窗头保留**（浮窗没有页签可代替标题行）。
3. **页签条合一**：`nx-center-tabs`（AppNext.vue:2423）与 `nx-page-tabstrip` 若同时可见且内容重叠，合到 PaneTabStrip 一条——**判定标准：同屏不得出现两条都列出同一 pane 的页签行**。若 nx-center-tabs 承担的是别的职责（如窗头 pane 切换），把该职责并进页签条后整条退役。
4. **应用面 chrome 减层**：`nx-external-app-head`（URL 行）从应用面顶部撤掉——地址进①页签 `title` tooltip、②状态栏既有条目（有载体条，加地址段或 tooltip）；「复制地址单开」（`nx-app-pane-foot`）从常驻脚行改为页签右键菜单项。撤完后应用面 = iframe 独占（空态/失败态文案保留）。
5. **回归口径**：既有页签/窗头的全部测试（批次66/76/77 系）按新 chrome 同步改，**行为语义一条不删**——页签切换、关闭、拖拽换形态、右键菜单、悬浮球收起、守卫④吸附预览，全部要在新层级下继续成立。

## 允许文件

`next/shell/PaneWindow.vue`、`PaneTabStrip.vue`、`AppNext.vue`、`CarrierPaneHost.vue`、`ExternalAppHost.vue`、`StatusBar.vue`、`styles/next-shell.css`、`next/tests/**`、登记格式沿用（越界先补登记再动手）。

## 禁止边界

- **不动 workspace v3 状态轴语义**（page/tab/floating/maximized 四态、main/side 两组、placement 数据形状一字不改——本批只改「page 态谁代表标题」的呈现层）。
- 不动协议形态词表与 PANE/PAGE 轴、写族闸、server/src、窄屏适配（本批不做窄栏新设计）。
- 不加依赖；iframe sandbox/referrerpolicy 等安全属性一字不动；ExternalAppHost 的覆盖 URL 逻辑（批次54）不动。
- 自设阈值当闸禁止；visual-contract 只加机器判据不放宽既有条。

## 守卫标记

守卫④（吸附预览）⑩保持；**新增守卫⑪「页态无窗头」**（`state==='page'` 的窗口 DOM 里不得出现 `nx-pane-window-head`；floating 态必须出现）＋**守卫⑫「应用面独占」**（external-app 页内不得有常驻 URL 行节点，iframe 的声明链必须含 min-height:0 且父链无 height:auto 断点）。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿读数只增不减；真窗口复拍：对半分屏下 Toonflow 与 ComfyUI 两 iframe 均吃满各自半栏高度（clientHeight ≥ 500）；同屏仅一条页签行；页态窗口无标题行。

## 记账指标（不进闸）

chrome 行数前后对比（同屏 chrome 行数 5 → 目标 2）；iframe clientHeight 实测值。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录落盘 `docs/plan/pinax-electron-next-m2-batch76r2-20261105.md`；§8 调度方补。）

**§7 执行方回填（2026-11-05，Qoder CLI）**：五条任务全落地，详见[批次76-R2 执行记录](./pinax-electron-next-m2-batch76r2-20261105.md)（§7-1 任务落点与高度链六环表、§7-2 越界补登记 `PaneFormMenu.vue`、§7-3 记账指标、§7-4 守卫⑪⑫ 机器判据、§7-5 门禁读数表、§7-6 limitations）。**门禁**：`npm run verify:next` exit 0 五段全绿——验收 44/44、内核 **815→817/817**、界面 **235→237/237（15 文件）**、eslint 0 警、打包门禁全过。**同屏 chrome 行数 5 → 页态 1 行／浮窗 2 行**（目标 2，实况压到 1）。**未达成的一条验收判据**：半屏分皮下 iframe `clientHeight ≥ 500` 的真窗口复拍——本会话不启动 Electron，只交付了声明链机器判据（守卫⑫），**实拍归调度方**。未 commit。
