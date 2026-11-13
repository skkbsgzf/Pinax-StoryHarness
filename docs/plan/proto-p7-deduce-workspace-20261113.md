# 工单 P7 · 推演工作区（demo「Agent 在左」布局）

> 基线：`D:\Pinax-next` @ `6ecba29`（verify:next 全绿：验收 42/42、内核 1321/1321、界面 289/289、lint 0、打包过）
> 原型：`D:\Pinax-e2e\proto-v1\pinax-agent-first.html`（标题「Pinax · Agent 在左」）
> 作者 2026-11-13 裁定：按 demo 实现；环形图不做。

## 0. 硬约束

1. `npm run verify:next` EXIT=0 五段全绿。
2. **零重挂载铁律**：换位只能用 CSS（flex `order` / 显隐），禁止移动组件在模板中的位置、禁止 v-if 包裹 `RuntimeDock`/`CollapseOrb`/`DeducePanel` 的挂载处——守卫⑰④（挂载处禁 v-if）与 Esc 分层教训直接适用。Agent 会话状态（在途提问/轨迹）不容因换位丢失。
3. 令牌纪律同前；明暗两套成立。
4. 不执行 git；不启停 electron。

## 1. 行为规格

- 标题栏既有「推演」开关（`toggleDeduce`／`deduceOpen`，AppNext.vue:442-447）语义升级：**中栏覆盖层开关 → 工作区布局模式开关**。
- **ON（推演模式）**：壳根挂 `nx-deduce-mode` 类——
  - Agent 列（`.col-dock`）换到**左位**（竖条之后、中栏之前）：`.nx-ribbon { order: -2 }`、`.col-dock { order: -1 }`；
  - 索引窗与其拖拽把手隐藏（`display:none`；模板顺序 IndexWindow 紧邻其 resizer，用相邻选择器）；
  - 中栏吃满剩余宽度；Agent 列宽沿用既有 `dockWidth` 拖拽记忆（320–680，位置无关）；
  - 页签／页组／浮窗／收起球语义**全部不变**。
- **OFF**：回到现三栏，一切如旧。
- 模式状态**会话内记忆**（`deduceOpen` 现状即如此），不落 workspace.json（v3 不动，落盘另议）。
- `DeducePanel` 本批**不改内部**：推演模式下仍由「推演」钮唤出（浮层职责照旧）；demo 中栏的「推演稿」页签是未来文档形态，不做。

## 2. 明确不做（demo 里看到但本批不实现的）

- 左栏顶「第3章·夜航＋世界书3条＋推演1条」章节 chips（需幕次/推演数据模型，批次78 域）。
- 底部快捷 chips「继续写第3章／查世界书／开一段推演」（命令语义未建）。
- 底部状态条（作者底栏裁定已全局退役，**不得复活**）。
- 中栏「推演稿」文档页签。

以上逐条写进 limitations 回填。

## 3. 允许改动的文件

```
next/shell/AppNext.vue                 （壳根 class 绑定＋注释；净增 ≤ 20 行）
next/shell/styles/next-shell.css       （.nx-deduce-mode 布局段）
next/tests/shell-ui.spec.mjs
next/tests/visual-contract.test.mjs    （如需钉模式态样式声明）
```

## 4. 验收

- [ ] 点「推演」：Agent 列出现在左位（DOM x 坐标在竖条右侧、中栏左侧），索引窗不可见，中栏页签照常可点。
- [ ] 再点：回到三栏，索引窗恢复，Agent 会话消息**一条不丢**（同一 wrapper 内断言消息数前后一致）。
- [ ] 推演模式下拖 Agent 列把手仍可调宽；CollapseOrb/DeducePanel 挂载处无 v-if（源码级断言）。
- [ ] 明暗两套截图中布局都不破。
- [ ] `verify:next` EXIT=0；新增用例 ≥3。

## 5. 回填格式

同 P1。
