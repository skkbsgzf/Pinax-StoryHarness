> ⚠️ 已被并行链吸收（2026-11-03）：本工单的范围由并行会话的批次69/70–76 执行覆盖（69=drain 根治已落，见 batch69-20261102.md；74=样式清账；72=键位闭环）。残留独有价值以并行链实况为准，本单保留作对照，不再派发。

# 批次69 工单：MCP 竞态 drain 修复——CI 偶发红的根治（2026-11-02）

> 调度方工单（独立可执行）。来源：批次61 记录 limitation 4 ＋ CI run 124 实证（同树重跑两次全绿＝偶发，非代码回归）。**当前止血措施**：verify:next 的 vitest 段已改 `--no-file-parallelism`（批次63 后临时措施）——本批验收＝根治后**移除临时措施恢复并行仍全绿**。
> 优先级：CI 稳定性（当前 CI 是硬币）——建议排在 67/68 之前或并行。

## 现象与已核机理（批次61 执行方核到 SDK 源码层，如实转述）

全量 vitest **并行**跑时，`carrier-pane-real.spec.mjs` 末尾**偶发**一条 Unhandled Rejection：`MCP error -32000: Connection closed`——栈：`@modelcontextprotocol/sdk` → `next/runtime/transportInProcess.mjs:25` → `agentRuntime.mjs:211 stop()` → `index.mjs:209 close()`。机理：会话关闭时 `Protocol._onclose()` 给每个在途请求打回 `Connection closed`，而其中一条请求的调用方 promise 没人 await（外壳里一条 fire-and-forget 的 IPC 在会话关闭后才落地）。负载相关：并行全量 2 次红、串行与单文件全绿。

## 任务（三条）

1. **运行时关闭前 drain 在途请求**：`next/index.mjs:209 close()` → `agentRuntime stop()` → `transportInProcess` 关闭链路上，先等在途工具调用/请求落定（带上限超时，超时才硬关），或主动拒绝并**确保拒绝被接住**——二选一由执行方按代码实况裁，验收看「并行全量不再偶发」。
2. **外壳侧 fire-and-forget 清零**：全仓排查「调用 promise 未接住」的 IPC/运行时调用点（`next/shell/` 优先），每处补 `.catch()` 或改 await——**不许未接住的 promise 存在**；同类点全清（这是一条一类修复，不是单点）。
3. **移除临时措施**：`package.json` 的 verify:next 恢复并行 vitest（去掉 `--no-file-parallelism`）；**验证强度＝并行全量连续 3 次全绿＋CI 一次绿**，不达标不得移除。

## 允许文件

`next/runtime/transportInProcess.mjs`、`next/runtime/agentRuntime.mjs`、`next/index.mjs`（close 链）、`next/shell/main.mjs`（fire-and-forget 点）、`next/shell/AppNext.vue`（如需）、`package.json`（移除临时措施）、`next/tests/`（竞态回归测试——并行压力形态）、`docs/plan/` 本工单 §7＋批次记录（执行方落盘）。

## 禁止边界

**不许掩盖**（不许吞错误不记账、不许给断言加宽松）；不动协议语义与写族闸；不改窗口系统/命令面行为；不改 `server/**`、`src/**`、外部三目录；不加 npm 依赖；不起 Electron、不执行 git。

## 守卫标记

批次45–68 全清单继承；本批新守卫：close 链 drain 逻辑存在且带超时、fire-and-forget 清零的排查断言（如可行——grep 级）。

## 验收判据（完成定义）

并行全量 vitest **连续 3 次**全绿；CI 一次绿；`--no-file-parallelism` 已移除且 verify:next 恢复并行仍绿；批次61 limitation 4 闭合（记录更新）。

## 记账指标（不进闸）

drain 超时上限的选择依据；fire-and-forget 清点的总量。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch69-20261102.md`；§8 调度方补；**验收含压力形态**——并行连跑 3 次的输出要进记录。）
