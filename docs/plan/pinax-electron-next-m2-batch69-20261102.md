# 批次69 记录：MCP 竞态 drain 根治＋fire-and-forget 排查闸（2026-11-03）

> 执行：Qoder CLI。工单：[69](./pinax-electron-next-m2-batch69-ticket-20261102.md)。
> 全程未执行 git、未起 Electron、未加 npm 依赖；`npm run verify:next`（已恢复并行）五段全绿（见「复现」）。
> 一句话结论：**根因在「关链路时还有请求在途，而它的拒绝落在没人 await 的 promise 上」**——本批把这条竞态在唯一同时看得见、管得住的那一层（进程内链路）消掉：关闭前先 drain，超时的硬关，被硬关的拒绝一律转成失败信封并记账；外壳侧的本批允许面内一条未接住的 promise 不留，面外的按文件登记成台账并进闸（只许减不许加）。

## 任务1 关闭前 drain 在途请求（工单给的「二选一」怎么裁的）

工单允许「先等在途请求落定」或「主动拒绝并确保拒绝被接住」二选一。**执行方选的是「drain 为主、拒绝必被接住为兜底」两条都做**，理由不是保险，是这两件事各治一半：drain 只解决「来得及」，解决不了「作者真在跑一条慢工具时关窗」——那种情况下必须硬关，硬关就必然产生拒绝，拒绝没有落点就是本批要根治的那条 Unhandled Rejection。

- **在途表**（`next/runtime/transportInProcess.mjs:62` 起）：`connectInProcess()` 现在把每一次 `callTool`／`listTools` 包进 `tracked(label, run)`，在途项记 `{label, promise}`；`label` 形如 `callTool(pinax_chapter_write)`——报告里能指名是哪条被硬关的，不是只给一个数。
- **drain**（`transportInProcess.mjs:118`）：`close()` 先 `await drain(budgetMs)`，用 `Promise.race([Promise.allSettled(在途), 定时])`＋25ms 轮询等落定；等到干净就正常关，等不到才 `closing = true` 硬关，并把 `forced`／`forcedLabels`／「drain 超时：仍有 N 条在途请求被硬关（…）」写进报告（`transportInProcess.mjs:190-195`）。
- **拒绝必有落点**：链路关上之后，SDK 从 `_onclose()` 打回的 `-32000 Connection closed` 不再沿 await 链外抛——`tracked()` 只把**关闭引起**的拒绝转成失败信封（`{ok:false, code: PINAX_MCP_TRANSPORT_CLOSED / PINAX_MCP_TRANSPORT_CLOSING, message, transport}`）；**非关闭引起的错误照旧抛**（协议语义一字未动，工单禁止项）。转了几条、每条什么名字，全在 `link.stats().converted` 里，渲染层按既有约定直接渲染 `payload.ok === false`，不需要任何新 UI。
- **运行时边界**（`next/runtime/agentRuntime.mjs:370-377`）：`callTool()` 现在 `try/catch` 包住链路调用，抛到外面的错误转成 `fail('PINAX_MCP_CALL_FAILED', …)` 并 `noteFault()` 记一笔（环形 50 条 ＋ 进服务与通知池）。**这条是本批的结构保证**：外壳的 `void`／`watch(async …)` 那批本批不许动的文件，从此拿不到「会拒绝的 promise」——不是靠改它们，是靠它们下面那一层不再往外抛。
- **stop 链不再丢报告**：`agentRuntime.mjs:237` 的 `stop()` 把订阅退订、服务监督器、链路关闭、外部 MCP 关闭四段各自包 try/catch，错误收进 `errors[]`，返回 `ok({stopped, errors, drain})`；`next/index.mjs:72` 新增唯一退役出口 `retireRuntime()`，`open()`／`refresh()`／`close()` 三处统一走它，报告留在 `session.lastRuntimeStop`（`index.mjs:230`）。旧写法 `if (session.runtime) await session.runtime.stop()`（把 stop 的返回丢掉）已消失，并由守卫断言钉住。

## 任务2 外壳 fire-and-forget：排查从「grep 级」做成 AST 级闸

工单写「如可行——grep 级」。grep 拦不住跨行的 `.then().catch()` 链，也分不清「这条调用是不是 promise」，所以本批用**已在 node_modules 里的 `espree` ＋ `@vue/compiler-sfc`**（未新增依赖）写了一条真门禁：`next/tests/floating-promise.test.mjs`。

- **扫描面**：`next/runtime/**` ＋ `next/shell/**`，实测 **102 个文件**（`.build` 是打包副本，跳过）；解析失败当场抛，不静默跳过——「扫不动」和「没找到」是两回事。
- **三条规则，全是确定性结构判据，不设数值阈值**：R1 语句位置的 promise 调用链没被 await／return／赋值／`.catch`／双参 `.then` 接住；R2 单参 `.then` 且链上没有 `.catch`；R3 async 回调交给不等 promise 的调度器（`setTimeout`/`watch`/事件注册/不带 `Promise.all*` 的数组方法）。判「是不是 promise 调用」只用两条本仓硬事实：链上出现 `request`／`dispatch`（渲染层桥与主进程分发器的入口名），或链根是本文件声明的 async 函数。
- **闸口面（GATED）＝ `next/runtime/**` ＋ `shell/main.mjs` ＋ `shell/AppNext.vue`：命中 0**，红即停。闸口面内本批改掉的 fire-and-forget 点：应用菜单指令回调（`main.mjs:318-320` 成功但回执是失败也记账、抛错另记一条）、外链 `setWindowOpenHandler`（`main.mjs:361`）、`before-quit` 退役链（`main.mjs:930-932`）。**`main.mjs` 现在 `.catch(() => {})` 命中 0**，由第二条守卫断言钉住（本批四个改动文件逐个查空吞，见 `floating-promise.test.mjs` 第三条 test）。
- **面外台账进闸（只许减、不许加）**：`floating-promise.test.mjs` 第四条 test 把闸口外的命中按**文件**登记成台账（不认行号——并行批次在改这些文件，行号漂移会造出假红）。新增一个文件命中即红；老点被清掉不挡路。当前台账 5 个文件、6 处，全是 R3 的 `watch(async …)`：`shell/AssistantDialog.vue`、`shell/CarrierPaneHost.vue`（含 `applyChapterLinks`）、`shell/CommandPalette.vue`、`shell/EntryDetailPanel.vue`（`applyEntryLinks`）、`shell/MaterialGallery.vue`（`ensureRecords`）。

## 任务3 移除临时措施（恢复并行）

`package.json:103` 的 `verify:next` 已去掉 `--no-file-parallelism`，恢复默认并行。移除前按工单口径先连跑 **3 次并行全量**，三次全绿才动脚本；移除后再跑完整五段，仍全绿。

并行全量（`npx vitest run --config next/vitest.next.shell.config.mjs`，无 `--no-file-parallelism`）三次输出：

```
第 1 次  Test Files  14 passed (14)   Tests  201 passed (201)   Duration 9.74s   Start at 10:15:48
第 2 次  Test Files  14 passed (14)   Tests  201 passed (201)   Duration 10.28s  Start at 10:15:59
第 3 次  Test Files  14 passed (14)   Tests  201 passed (201)   Duration 9.97s   Start at 10:16:11
```

三条真链路用例（`carrier-pane-real.spec.mjs`，批次61 报红的那一条就在此文件末尾）逐次 `3 passed`，全程无 Unhandled Rejection 输出。

## 竞态回归测试（并行压力形态，`next/tests/close-drain.test.mjs` 4/4）

自建 MCP `Server` 挂一条 `fast`、一条 `slow`（默认永不返回），四条用例：

1. **drain 等待**：在途时链路未关；关闭后报告 `pendingAtClose=1 / forced=0 / errors=[]`，调用方拿到真结果。
2. **drain 超时**（预算压到 60ms）：`forced=1`、`forcedLabels=['callTool(slow)']`、报告带「drain 超时」；调用方拿到 `PINAX_MCP_TRANSPORT_CLOSED` 失败信封；关闭后再调用得 `PINAX_MCP_TRANSPORT_CLOSING`，`rejectedWhileClosing=1`；**全程 `unhandledRejection` 计数 0**。
3. **批次61 的形态复刻（风暴）**：连发 24 条**不 await** 的 `callTool` 后 `await link.close()`——报告 `forced>0`，`Promise.allSettled(24 条)` 零 rejected，零未接住拒绝。这条就是原来 CI 偶尔红的那个形状，现在是常驻用例。
4. **预算取值**：缺省 2000ms；脏值（非数字／负数）回落缺省，而不是 0 或 NaN。

## 记账指标（工单要求，不进闸）

**① drain 上限为什么是 2000ms。** 在真链路上量了一次（临时工装 `D:/Pinax-main/_tools/batch69-drain-timing.mjs`——仓外一次性脚本，跑完已删；30 轮 × 5 工具，150 次样本，0 失败；重跑要照着「建临时项目 → `session.runtime.callTool()` 计时」重写）：

```
pinax_chapter_list    n=30 p50=0.6ms p95=0.8ms max=2.9ms
pinax_chapter_read    n=30 p50=0.5ms p95=0.7ms max=1.0ms
pinax_worldbook_list  n=30 p50=0.2ms p95=0.3ms max=0.7ms
pinax_outline_read    n=30 p50=0.1ms p95=0.2ms max=0.4ms
pinax_proposal_list   n=30 p50=0.2ms p95=0.3ms max=0.8ms
最慢一次 2.9ms
```

取值口径：进程内链路只跑本地调用，空载最慢 2.9ms，2000ms ≈ 空载最慢的 700 倍；上限不能更大是因为 `close()` 在「换项目」和「关窗」两条链上是**被 await 的**，预算＝作者感知的切换卡顿；外壳退出另给一层兜底（`main.mjs:280` `SHELL_RUNTIME_DRAIN_MS = 3000`，再加 1500ms 看门狗直接退）。**如实**：满载（真并行全量跑时）的单次最大 drain 等待本批没量到——跨进程统计没落盘；`forced>0` 现在会进服务与通知池，出包后能读到真值。

**② fire-and-forget 清点总量。**
- 闸口面（runtime＋`main.mjs`＋`AppNext.vue`）：**命中 0**（三条规则全过）。
- 闸口外 R3 命中：**6 处 / 5 个文件**，已登记成台账并进闸。
- `void X(...)` 形态（显式丢弃 promise）：`next/shell/**` 共 **67 处 / 12 个文件**（`AppNext.vue` 29、`IndexWindow.vue` 15、`CarrierPaneHost.vue` 9、`settings/HistorySection.vue` 3，其余 7 个文件各 1-2）。扫描器的 R1 把 `void` 视为「已消费的意图标记」，所以这 67 处不算命中——**这是一个如实登记的判据口径，不是说它们安全**。它们之所以本轮不再能造出未接住的拒绝，是因为拒绝源头已被任务1 的两道边界掐住（链路不抛、运行时必回信封）；`AppNext.vue` 属工单「如需」，本轮**没动**（并行批次正在改它，29 处脚本化改写会互相抹）。
- 历史空 `.catch(() => {})`：**15 处**（`runtime/mcpClient.mjs` 5、`runtime/projectBackupService.mjs` 2、`runtime/surfaceAggregate.mjs` 1、`runtime/serviceLogPool.mjs` 1、`runtime/historyScheduler.mjs` 1、`fs/atomicWrite.mjs` 3、`sessionStore.mjs` 2）。全部在本批允许文件之外，未动。

## 与工单口径的差 ＋ limitations（做不到的都写在这里）

- **工单任务2 写「同类点全清」，本批只清了允许文件里的。** 允许文件清单（`transportInProcess`／`agentRuntime`／`index.mjs` close 链／`main.mjs`／`AppNext.vue`「如需」／`package.json`／`next/tests`/`docs/plan`）与「全仓同类点全清」在本仓现状下直接冲突：那 6 处 R3 与 15 处空 catch 全在清单外，且此刻正被并行批次编辑。**执行方的处置**：面内清零＋面外按文件登记成常驻闸（新增即红），把「清」这件事留在下一批的允许文件里，而不是本批越界抹掉并行改动。这条冲突请调度方裁定是接受还是要求扩面。
- **工单验收「CI 一次绿」自证不了**：本批禁止执行 git，推不上分支，也没有 CI 可跑。能给的等价证据＝本机的并行全量连续 3 次全绿 ＋ 恢复并行后的完整 `verify:next` 一次 exit 0。CI 那一次要等调度方提交后回看。
- **批次61 limitation 4 的闭合是「机理层闭合」**：本批消掉的是这条竞态的产生条件与它的拒绝落点，未做 Electron 真窗口下的关窗复现（工单禁起 Electron）。真机验证口径留给 §8 调度方实览。
- **`ipcContract.mjs` 的 `dispatch()` 没有兜底 try/catch**（`next/shell/ipcContract.mjs:395` 起，全文件只有 3 处 try，都不在分发主干上）。也就是说：任何 case 分支抛出，仍会变成渲染层一条 rejected `ipcRenderer.invoke`。本批该文件不在允许清单内，**登记为批次70 的第一顺位**——那是唯一能一次覆盖全部 67 处 `void` 的修法（一处加闸，而不是 67 处补 `.catch`）。
- **未满载量测、未复现旧红**：本批没有把改动回退去「重现一次并行全量红」再修绿（不允许制造红灯占机器），根治判据用的是压力形态用例（第 3 条）＋ 3 次全绿，两者都不是 CI 的替身。

## 复现

```bash
node next/tests/close-drain.test.mjs                    # 4 pass（含风暴回归）
node next/tests/floating-promise.test.mjs              # 4 pass（闸口面 0 命中＋台账不新增）
node next/tests/floating-promise.test.mjs --audit      # 全树命中：102 文件 / 6 处（闸口 0、面外 6）
npx vitest run --config next/vitest.next.shell.config.mjs   # 并行，201 pass × 3 次
npm run verify:next                                    # 五段全绿（已无 --no-file-parallelism）
```

本批实跑数字：`acceptance.mjs` **44/44**；`node --test "next/tests/*.test.mjs"` **735 pass / 0 fail**（批次66 记的 727 ＋ 本批新增 8 条）；并行 vitest **14 files / 201 tests**；`lint:next` **0 问题**；`bundleAssertions` **全部通过**（未改任何计数）。完整五段输出存档两份（仓外，去改动前后各一次，读数一致）：`D:/Pinax-main/batch69-verify.log`、`D:/Pinax-main/batch69-verify-final.log`。

## §8 调度方验收

（留空，待补。建议重点核三件事：①恢复并行后 CI 连跑是否还红；②「面外台账进闸」这个处置是否算满足任务2 的「同类点全清」；③批次70 是否把 `ipcContract.dispatch()` 兜底与那 6 处 `watch(async …)`、15 处空 catch 一起收。）
