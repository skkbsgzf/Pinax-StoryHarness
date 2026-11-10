# 批次70 工单：未接住的 promise 与错误落点收口（2026-11-03）

> 调度方工单（独立可执行）。来源：批次69 记录留下的尾巴（面外 6 处 `watch(async …)`、67 处 `void`、15 处历史空 catch）＋批次61 竞态的组件链顶。批次69 已在**运行时边界**掐住拒绝外抛，本批把**分发层与组件层**收干净，并把排查闸扩到整个 `next/shell/**`。
> 基线：批次69 收口点（开工时以 git log 现查为准；工作树现状见待裁定第 9 条）。
> **红线**：不改任何通道的成功语义、不动协议与写族闸——本批只让失败**有落点、看得见**，不许把失败改成静默成功。

## 任务（五条）

1. **`dispatch()` 兜底（一处治 67 处）**：`next/shell/ipcContract.mjs:395` 的 `dispatch()` 主干没有 try/catch（全文件仅 3 处 try，都不在分发上）。给 `switch` 外面包一层：抛错转成 `fail('PINAX_IPC_HANDLER_THREW', '通道 X 的处理器抛错：原话', { channel })`，原话照抄不美化。这是唯一能一次覆盖渲染层全部 `void bridge.request(...)` 的修法。
2. **闸口外 6 处 `watch(async …)` 就地收**：`AssistantDialog.vue`、`CarrierPaneHost.vue`（含 `applyChapterLinks`）、`CommandPalette.vue`、`EntryDetailPanel.vue`、`MaterialGallery.vue`——回调内部 try/catch 并记账，行为不变。做完把 `next/tests/floating-promise.test.mjs` 的 `GATED` 扩到 `next/shell/**`、台账 `LEDGER` 清空，断言改成「全 shell 命中必须为 0」。
3. **`void` 改成显式丢弃口**：新增 `next/shell/useShellFaults.mjs`（环形账＋进服务与通知池，接批次69 的 `noteShellAccounting` 口径）。把 `void X(...)` 统一改写成 `detach('label', X(...))`；按文件推进，`AppNext.vue`（29）／`IndexWindow.vue`（15）／`CarrierPaneHost.vue`（9）三件大头本批做，其余 7 个文件（14 处）登记进记录由下批收。**同步把扫描器 R1 的判据从「`void` 算已消费」改成「只认 `detach`」**——这条判据改动必须与改写同批落，否则闸门口径与代码背离。
4. **15 处历史空 catch 逐处判定**：`runtime/mcpClient.mjs` 5、`fs/atomicWrite.mjs` 3、`runtime/projectBackupService.mjs` 2、`sessionStore.mjs` 2、`surfaceAggregate.mjs`/`serviceLogPool.mjs`/`historyScheduler.mjs` 各 1。判定二选一：能失败的改记账；确实「尽力而为、失败无可作为」的写注释说明为什么不接，并进白名单断言（白名单逐条带路径，新增即红）。
5. **满载 drain 真值可读**：批次69 只量到空载（150 样本最慢 2.9ms）。本批把 `link.stats()`／`closeReports()` 的聚合读数汇进 `serviceLogPool`，并跑一次**并行全量**后从池里取 `forced`／`converted` 真值进记录。

## 允许文件

`next/shell/ipcContract.mjs`、`next/shell/useShellFaults.mjs`（新）、第 2/3 条点名的 shell 组件、`next/runtime/transportInProcess.mjs`＋`agentRuntime.mjs`（stats 汇池）、`next/tests/**`（含 `floating-promise.test.mjs` 扩闸）、`docs/plan/**`。

## 禁止边界

不许吞错误不记账；不许给既有断言加宽松；不动协议语义／写族闸／窗口命令面行为；不改 `server/**`、`src/**`；不加 npm 依赖；不起 Electron、不执行 git。

## 守卫标记

批次45–69 全清单继承；本批新守卫：`dispatch()` 兜底 grep 标记、`GATED = next/shell/**` 且命中 0、`LEDGER` 空断言、空 catch 白名单（带路径逐条）、`detach` 是唯一显式丢弃口。

## 验收判据

`npm run verify:next` 五段全绿；并行全量连续 3 次全绿；新增用例覆盖「case 处理器抛错 → 渲染层拿到失败信封，而不是 rejected promise」；满载 `forced`／`converted` 读数进记录（哪怕是 0，也要写明是量到的 0 还是没量）。

## 记账指标（不进闸）

`detach` 改写处数（分文件，本批 53／下批 14）；15 处空 catch 判定表；池里 `runtime-close`／`shell` 两类行的实际条数。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch70-20261102.md`；§8 调度方补。）
