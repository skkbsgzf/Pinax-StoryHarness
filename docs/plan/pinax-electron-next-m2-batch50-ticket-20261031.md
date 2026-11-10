# 批次50 工单：工具执行拦截点＋写族判定去启发化（Cordis 路线·线A）（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
> 前置：批次49 已收口（tip `3dfd12f`，验收 23/23、内核 562/562、界面 179/179、a–n3＋l 系全过）。工作树除两份 Cordis 调研文档（随本批入库）外干净。
> 工单源：`docs/plan/pinax-carrier-kernel-roadmap-tickets-20261031.md` §2（Cordis 评估裁定甲＋乙的线A第一批）。本文把该节落成执行格式，实质任务一字不改。

## 背景（为什么是最实在的一扇门）

现状外部 MCP 工具的写族判定靠名字后缀：`next/runtime/kernelWriteGuard.mjs:48` `EXTERNAL_WRITE_HINT = /_(save|write|import|delete|create|update)$/u`，writePolicy 第三支引用。两个真实误判：真写盘却叫 `comfy_submit` 的工具绕过写族闸（review 档直执行）；只读却叫 `xxx_save` 的工具被拖进 review。开发者指南 §6 自己承认这是无奈之举。本批换成工具自带 MCP annotations（`readOnlyHint`/`destructiveHint`），后缀降为最后兜底。

## 任务（照 roadmap §2，四条）

1. **拦截点模块** `next/runtime/toolInterceptors.mjs`（新）：`createInterceptorChain({ interceptors })`，导出 `runBefore(name, args, ctx)`（任一返回 `{ veto: true, reason }` 即拒，顺序执行）、`runAfter(name, result, ctx)`（不改结果只记账）。接入 `next/runtime/toolLoop.mjs` 与 `next/runtime/toolTurn.mjs` 的实际调用处，**不新建第二条执行路**。
2. **写族判定改锚 annotations**：`next/runtime/mcpClient.mjs` 连上后把每工具的 annotations 挂进工具元数据；`writePolicy.mjs` 第三支改三级优先——① `annotations.readOnlyHint === true` → 判读；② `destructiveHint === true` 或非只读 → 判写；③ 两者全无 → 回落 `EXTERNAL_WRITE_HINT` 并经 `serviceLogPool` 记一条 `level:'warn'`（「该工具无写声明，按后缀兜底」，作者在设置节可见）。
3. **拦截点装两个内置消费者**（不许空框架）：① 写族闸消费者——执行路里散着的写策略判定收进 `runBefore`，返回体带 `guardDecision`；② 审计环消费者——`runAfter` 把 review 档直执行的提交类工具（先例 `comfy_submit`）记进池，替掉零散 console 记账。
4. **反向断言进验收**：`next/tests/tool-interceptors.test.mjs`（新）≥6 条，必含「annotations 与后缀不一致时以 annotations 为准」（夹具：只声明 `readOnlyHint:true` 却叫 `fake_save` → 判读）与「全无声明回落后缀且记账」两条。

## 允许文件

`next/runtime/toolInterceptors.mjs`（新）、`next/runtime/kernelWriteGuard.mjs`、`next/runtime/writePolicy.mjs`、`next/runtime/mcpClient.mjs`、`next/runtime/toolLoop.mjs`、`next/runtime/toolTurn.mjs`、`next/shell/main.mjs`（接线）、`next/tests/tool-interceptors.test.mjs`（新）＋受影响测试、`next/testing/acceptance.mjs`（计数同步写理由）。

## 禁止边界

不改 `server/**`、`src/**`；不加 npm 依赖；**不动清单 schema**（@4 是批次52 的事）；不改 `expectedRevision` 语义与 `STALE_REVISION` 行为；`server/mcp` 19 工具合规面不动；不启动/不杀 Electron；不执行 git 命令。

## 守卫标记（既有修复不许丢）

- 批次45–49 全清单：immersive 词表／settingsStore／disposeOwner 接线／`pinax_chapter_delete·rename`／审查本章钮／bookText 拆分／comic 四张牌（comfy-mcp-bridge.mjs 与 preview-server.mjs 在）／`nx-rail-status-dot`／serviceLogPool 存在且 supervisor、mcpClient 都有进池调用；
- 本批新守卫：`EXTERNAL_WRITE_HINT` 收敛为「kernelWriteGuard 定义＋writePolicy 兜底支引用」两处，测试引用除外不许再扩散。

## 验收判据（完成定义）

`npm run next:build:main && npm run next:build:shell && npm run verify:next` 五段全绿；新增内核用例 ≥6；「annotations 优先」与「无声明回落并记账」两条断言非空转；grep 确认 `EXTERNAL_WRITE_HINT` 运行时引用只剩 writePolicy 兜底支一处。

## 记账指标（不进闸，需人裁留名）

现网 annotations 缺失的外部工具条数；后缀兜底命中次数。「外部 MCP 工具必须声明 annotations」是否升拒装级＝作者点名（调度方建议：先记账一个周期）。

---

## §7 执行方回填（执行完成后填写）

### 交付清单 ／ 门禁自报 ／ 偏离 ／ limitations
（同前几张工单格式；门禁计数变化必须写理由）

## §8 调度方验收（Zcode 填，执行方不要动本节）

- 独立复跑五段门禁＋评审员对照工单（diff 指引：临时索引 read-tree 基线后 add -A 再 diff，别用裸 diff）＋守卫标记 grep。
- 真窗口验证归调度方（本批无新 UI，重点在池里的 warn 记账可见）。
- 批次记录落 `docs/plan/pinax-electron-next-m2-batch50-20261031.md`。
