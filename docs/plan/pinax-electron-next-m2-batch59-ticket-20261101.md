# 批次59 工单 v2：统一窗口化＋布局模板地基——去左栏硬编码（2026-11-01）

> 调度方：Zcode。执行方：Qoder CLI。作者两段原话（设计裁定，全文有效）：
> ①「浏览器或者代码的 IDE，直接把一个带标题的页面分屏贴上去，这就是分屏。做了那么多按钮，转换的时候思路不流畅。所有分屏不应该是每页独立开发的叉叉/缩小/收起按钮。中间的 doc 栏是允许多种载体同时存在的那部分，它是浮窗的形式，甚至还不占页。」
> ②「不是所有组件都是左中右结构。世界书可以把上半 90% 呈现图表列，下方小卡片/横条呈现词条，为什么还要左边一个栏？这个栏设计之初就是服务正文剧本题材的。现在所有插件全部写死了左边有栏。资料和设定应合并到一起，跟正文一样是文件夹类型的产物。素材更像图库。」
> **v1 只做窗口化被否——本 v2 把「布局模板＋去左栏硬编码」一并纳入。**

## 设计铁律（五条，实现与测试对着验）

1. **窗口唯一化**：任何打开的内容＝一个带标题的 PaneWindow；chrome 归宿主**一个组件**；右上角统一钮＝收起（侧缘标签）／分屏（当前窗连标题对半贴）／×关闭；浮窗态有拖拽移动与边角缩放。
2. **中间 doc 区＝窗口管理器**：多载体共存；打开文档＝开浮窗，默认不占页；分屏＝对半贴；收起＝侧缘标签点还原。
3. **转换流畅**：浮窗↔分屏↔收起↔关闭＝同一扇窗同一 chrome 的状态变化，零菜单零模式切换。
4. **布局按载体性质走模板，左栏不是标配**：folder 型（正文／剧本／设定与资料合并体）＝左树＋文档窗；board 型（世界书，批次60 落地）＝左肥右窄——左大块图表列主体、右窄条条目详情卡，无树；图库型（素材，批次60 落地）＝无左栏网格。**IndexWindow 的左树从「每载体标配」降级为 folder 模板的一个 pane 组件。**
5. **按钮唯一化**：删除批次35 七钮、竖条右键「打开方式」菜单、各 pane 定制窗口按钮——窗口动作只存在于统一 chrome。

## 任务

1. **`next/shell/PaneWindow.vue`（新）**：标题栏＋统一右上角钮（收起/分屏/×）＋浮窗拖拽＋边角缩放＋分屏对半贴（自身区域一分为二，新窗承接新内容）。所有窗走这一个组件。
2. **center 窗口管理器**：打开文档＝开浮窗（自由几何可叠）；分屏对半贴；收起＝侧缘标签堆；×＝关窗；竖条图标点击＝开/还原该载体文档窗。
3. **布局模板机制**：宿主按载体 pane 组合选模板——`folder`（树＋doc 窗）、`web`（全宽 board＋底条）、`gallery`（网格）——**模板注册制**（host 侧词表，@4 schema 不动）；`IndexWindow` 的左树拆成 folder 模板的树 pane 组件，世界书/素材等不再被塞进左中右。
4. **删除清单（删完断言不存在）**：批次35 七钮；竖条右键「打开方式」forms 菜单；FloatingWidget 特例容器（并入 PaneWindow）；`immersive/fullscreen/overlay/dock/split` 独立入口与状态机（收编为窗态：最大化钮＝铺满中间区；placement 四轴退役）。
5. **workspace v2 迁移**：placement＋minimized → 窗口状态（几何/z/minimized: none|tab/tiledWith）；旧文件读侧迁移；`multiplicity/scope` 继续管开窗数量。
6. **断言重写**：35/44/45/58 的分屏/浮窗/沉浸用例按新模型重写（每条被删用例在 §7 写替代物）；visual-contract 窗控断言改指 PaneWindow；「打开方式」菜单零命中；**「非 folder 载体窗内不渲染树 pane」零硬编码断言**。

## 允许文件

`next/shell/PaneWindow.vue`（新）、`next/shell/layoutTemplates.mjs`（新，模板注册表）、`next/shell/AppNext.vue`、`next/shell/workspace.mjs`＋`workspaceStore.mjs`（v2）、`next/shell/FloatingWidget.vue`（删/并）、`next/shell/CarrierPaneHost.vue`（头部按钮撤除）、`next/shell/IndexWindow.vue`（拆树 pane 组件）、`next/shell/paneForms.mjs`（词表退役或兼容读）、`next/shell/formTaxonomy.mjs`（如需对齐）、`next/shell/styles/next-shell.css`、`next/tests/`＋受影响 spec、`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（计数写理由）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

不动协议 schema（@4 一字不改；multiplicity/scope 语义保持）；不动右 Agent 栏结构；不动编辑面本体（textarea/阅读态/自动保存）与写族闸；不改 `server/**`、`src/**`；不加 npm 依赖；**不动 12 份清单**（布局模板是宿主渲染层机制，载体形体重排在批次60）；不起 Electron、不执行 git。

## 守卫标记

批次45–58 全清单继承；本批新守卫：PaneWindow 存在、七钮与「打开方式」菜单零命中、workspace v2 迁移用例、非 folder 载体零树 pane 断言。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿；真窗口实拍四张（多载体浮窗共存／分屏对半贴／收起标签＋还原／×关闭）调度方接管；五条铁律逐条有测试对应；`grep "打开方式"` 与七钮零命中。

## 记账指标（不进闸）

旧 placement 用例删改对照表；大梦 @3 首次打开的 workspace v2 映射结果。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch59-20261101.md`；§8 调度方补；diff 指引用临时索引法。）
