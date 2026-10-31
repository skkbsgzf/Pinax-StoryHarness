# 批次59d 工单：carrier-pane 三条旧语义断言对齐窗口模型（2026-11-01）

> 调度方：Zcode。执行方：Qoder CLI。
> 背景：批次59 窗口模型落地后，`carrier-pane.spec.mjs`（:1127/:1656 两条）与 `carrier-pane-real.spec.mjs`（:139 一条）仍断言旧语义「中栏按 paneId 前缀换面」——59b/59c 均无权动它们，批次59 记录 §10.4 已登记待授权。**本批授权改写这三条，仅此三处。**

## 任务

1. **按窗口模型改写三条断言**（每条附一行理由注释「批次59 窗口模型：中栏换面语义退役，改为窗口在册/聚焦断言」）：
   - carrier-pane.spec.mjs :1127「世界书是 web 模板（批次59）：不渲染左树…」——期望值里的旧文本断言按批次59 后的实际渲染修正（保持「不渲染左树」的意图不变）；
   - carrier-pane.spec.mjs :1656「竖条七格；中栏按 paneId 前缀换面」——「换面」改为「窗口在册/聚焦」断言（开大纲窗后 outline 窗在册）；
   - carrier-pane-real.spec.mjs :139——同口径修正。
2. **不改任何行为代码**；除这三条外不动其他测试。

## 允许文件

仅 `next/tests/carrier-pane.spec.mjs`、`next/tests/carrier-pane-real.spec.mjs`。

## 禁止边界

不改行为代码；不动其他测试；不加依赖；不起 Electron、不执行 git。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿（界面 197/197）。

---

## §7 执行方回填 ／ §8 调度方验收

（同前格式。）
