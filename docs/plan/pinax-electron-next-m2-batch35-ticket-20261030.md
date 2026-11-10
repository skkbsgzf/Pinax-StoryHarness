# 批次35 执行工单：浮窗控件组归位＋分屏一等公民＋钉住（2026-10-30 夜）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash），经 workflow 编排派发
> 调度方：Zcode（验收、门禁、提交；夜间自主推进）
> 作者指令（原话）：「缺少分屏设计：我之前一直强调要做分屏，你没有做，只是设计了卡片索引。但实际上，那个卡片索引大部分时候没有办法展示，也没有『钉子』可以去固定。」「按钮逻辑混乱：你做了一个加号或减号，但是没有删除按钮。理论上来讲，这里应该是放大、缩小、吸附、固定这几个按钮。」

## 0. 现状锚点（先读再动手）

- `next/shell/FloatingWidget.vue`：标题条按钮现为 `+1`（再开一份）／`●`（气泡）／`全屏`／`–`（收起）——语义乱：没有删除实例、没有吸附按钮（吸附只能拖到边缘）、没有固定（pin）。
- 分屏后端已在：paneForms 的 `split` 形态＋AppNext 的分屏副栏（P11/P21，`splitOf`/摆放优先级 fullscreen > split > dock）——但**入口只有竖条右键的「打开方式」**，浮窗上没有去分屏的路。
- 悬浮卡片数据：「悬浮大纲」卡只有在该板块被访问过之后才有树可画（loadOutline 只在板激活时跑）——先开浮窗就是空卡，这就是作者说的「大部分时候没有办法展示」。
- `next/workspaceStore.mjs`（.pinax/workspace.json）：实例状态持久层；geometry/minimized/restore 已有。

## 1. 任务一：浮窗标题条按钮组归位（作者点名的五钮＋关闭）

按钮组（全部 WorkbenchIcon 或单字 quiet，顺序固定，带 aria-label＋tooltip）：

| 钮 | 动作 | 状态语义 |
|---|---|---|
| 放大 | expand | 全屏 ↔ 还原（toggle，已全屏时显示「还原」） |
| 缩小 | bubble | 缩成气泡（既有） |
| 吸附 | snap | 左右吸附半屏 ↔ 解除（toggle；与拖到边缘同状态机，按当前吸附边高亮） |
| 固定 | pin | 钉住：位置锁定（禁拖）＋状态进 workspace.json；再点解除 |
| 再开一份 | duplicate | 既有 +1，文案改「＋」＋tooltip |
| 关闭 | close | 关闭浮窗实例回到停靠（删除该 overlay 实例，不是收起） |

- `–`（收起）与 `+1` 并入上表语义；拆掉旧四钮。
- **pin 持久化**：workspace store 实例状态加可选 `pinned: true`（additive，workspaceStore 的读写容忍新字段须验证；schema version 不动）。钉住的实例拖拽禁用（`startDrag` 直接 return），标题条钉钮高亮。
- 样式全 token；按钮 hover 显形逻辑保留（标题条常驻的是这组小钮，hover 前弱化）。

## 2. 任务二：分屏一等公民

- 浮窗按钮组**加「分屏」**：把该 pane 的 form 从 overlay 切到 split（走既有 paneForms/工作区切换通路）——浮窗内容落进中栏右侧副栏，浮窗实例关闭。
- 竖条右键「打开方式」菜单确认含 分屏（既有）；文案与顺序：停靠／分屏／浮窗／全屏。
- 分屏副栏空态：没有 split pane 时中栏右侧不占位（现状保持）；首次切分屏给出宽度的默认值沿用 P11。

## 3. 任务三：悬浮卡片「空白卡」修复

- overlay pane 挂载即加载数据：悬浮卡用的板块数据未加载时**先跑对应 loadXxx**（大纲 → loadOutline；世界书 → loadEntries 等，与停靠板同一取数口），加载中显示既有 busy 语，不显示空树。
- 卡内行为与停靠索引窗一致（点击打开、右键菜单），不是第二套只读缩印。

## 4. 测试

- shell-ui：按钮组六钮在场＋aria；pin 切换 → workspace.json 存档有 pinned、拖拽禁用；snap 钮 toggle；分屏钮 → pane form 变 split＋浮窗关闭；悬浮卡未访问板块时挂载即触发 loadXxx（fake bridge 断言通道调用）。
- workspace.test：pinned 字段往返、未知字段容忍。

**允许文件**：`next/shell/FloatingWidget.vue`、`next/shell/AppNext.vue`、`next/shell/workspace.mjs`、`next/workspaceStore.mjs`、`next/shell/ActivityRail.vue`（右键菜单如需）、`next/shell/useBoardData.mjs`、`next/shell/styles/next-shell.css`、`next/tests/shell-ui.spec.mjs`、`next/tests/workspace.test.mjs`、`next/tests/visual-contract.test.mjs`（如需登记）。**不许改**：内核/工具/fileService、package.json。

## 5. 门禁

`npm run verify:next` 五段全绿（基线：内核 409、界面 111、打包 a–l）。

## 6. 边界

- 不新增 npm 依赖；不改内核与工具面
- 多实例（#2/#3）与既有四轴（placement/minimized/geometry/restore）不动，只加 pinned
- 真实保存对话框/electron 不启停；执行方不 commit/push
