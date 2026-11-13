# 工单 S1 · 拆解数据接线（factFileStore ＋ 四通道 ＋ 前端适配器）

> 基线：`D:\Pinax-next` @ HEAD（verify:next 全绿）
> 上游计划：`C:\Users\Administrator\WorkBuddy\2026-11-13-09-19-09\Pinax_工单排期_S0-S5.md` 第 3/5 节（通道契约**已冻结**，照抄不得改签名）
> 真实数据：`D:/Qbook/短篇选题库/拆解/*.json`（19 个文件，单文件 top keys 含 `book/source/entries(291)/index/wiki/quality` 等；`entries[]` 是 fact v3 条目）

## 0. 硬约束

1. `npm run verify:next` EXIT=0 五段全绿。
2. 通道签名**一字不改**（本文 §2 即冻结稿）；响应沿用 `{ok,...}` / `{ok:false, code, error}`，走 `slimForIpc`。
3. **只读**：本阶段不落盘（save 通道挂上但如实报「写协议未启动」typed fail——S2 另开工单）；不碰 `wiki.*` 字段；读文件不触发任何镜像/索引写。
4. 错误码并入 `NEXT_ERROR_CODES`/既有词表（`INVALID_INPUT`/`NO_PROJECT`→用既有说法，**不新造码表**；查无条目用 `NOT_FOUND` 语义时沿用既有 `HISTORY_*` 风格命名并加进 errors 词表注释）。
5. 不执行 git；不启停 electron。

## 1. WO-S1-01 · `next/kernel/factFileStore.mjs`（新建）

- 实现 `createFactFileStore({ root })`：读 `<root>/拆解/*.json`（多文件合并），暴露 `get/list/save/remove` 四方法：
  - `list({ layer?, slot?, status?, offset?, limit? })` → `{ ok, entries[], total, warnings[] }`（entries 合并自全部拆解文件，带 `bookId`/`bookName` 溯源字段；offset/limit 分页在合并后施加；layer/slot/status 过滤在分页前）。
  - `get({ id })` → `{ ok, entry, revision }`（revision＝来源文件的顶层 `revision` 字段，缺省 1）。
  - `save/remove`：本阶段**只实现到校验**（`validateFactEntry` 过验后返回 typed fail `WRITE_PROTOCOL_NOT_STARTED`），不写任何文件——S2 接 writeFactFile。
- 损坏文件：单文件 JSON.parse 失败 → 该文件条目跳过、进 `warnings[]`，**不整体失败**（对齐偏好坏档口径）。
- 读取计数契约：对真实拆解文件 list（无过滤无分页）的 entries 总数＝各文件 `entries.length` 之和。
- 用例：夹具造 2 个拆解文件（含一条损坏文件），断言合并计数/过滤/分页/警告；另用 `D:/Qbook/短篇选题库/拆解/` 真实文件只读抽检（路径从 env `PINAX_FACT_FIXTURE` 读，无 env 则 skip——不许把绝对路径写死进测试）。

## 2. WO-S1-02 · 四通道挂进 `ipcContract.mjs`

签名（冻结稿，照抄）：

| 通道 | 请求 | 成功响应 |
|---|---|---|
| `fact:list` | `{root, layer?, slot?, status?, offset?, limit?}` | `{ok, entries[], total, warnings[]}` |
| `fact:get` | `{root, id}` | `{ok, entry, revision}` |
| `fact:save` | `{root, entry, operationId, expectedRevision?}` | S1 阶段 typed fail `WRITE_PROTOCOL_NOT_STARTED` |
| `fact:search` | `{root, q, layer?, limit?}` | `{ok, hits[{id, name, score, snippet}]}` |

- 命名走既有族：`factList: 'pinax:agent:fact:list'` 等四条，进 `IPC_CHANNELS`；`fact:save` 进 `REQUIRED_PROJECT_CHANNELS`？**不**——它显式收 `root`，与前三个一致：四条都显式收 root，不依赖 session 当前项目。
- `createIpcDispatcher` 新注入 `factStoreFor = null`（`(root) => store`，主进程按 root 建/缓存 store 实例）；未注入时四通道如实报缺（沿用「服务未接入」句式）。
- `fact:search`：q 按 name/keys/summary 子串匹配打分（name 命中 3 分、keys 2 分、summary 1 分），`snippet` 取首命中处前后 40 字；实现放 store 内（`search` 方法），通道只透传。
- main.mjs 注入：`factStoreFor: (root) => createFactFileStore({ root })`（每 root 缓存一个实例，Map 按 resolve 后路径）。

## 3. WO-S1-03 · `factEntriesToHub` 适配器（前端）

- 新 `next/shell/factEntriesToHub.mjs`：把 fact v3 条目数组转成与 `worldbookToHub` 同形的 hub 结构（对齐现有 EntriesBoard 消费形状）。
- 差异字段（来源章节/状态/关系数）放进条目卡新行；映射表注释逐字段写来源。
- 用例：同一条目两条路径（手写 md→hub vs fact→hub）字段形状 deepEqual（差异只在 v3 新增字段）。

## 4. WO-S1-04 · 看板数据源切换

- 判据：库根存在 `拆解/` 目录（`factStoreFor(root)` list 总数 >0）→ 世界书板条目走 fact 通道；否则走既有 `世界书/*.md`（**零回归**）。
- 切换点在数据面（`useBoardData` 的 entries 加载处），EntriesBoard 版式不动。
- 用例：jsdom 双分支（有拆解/无拆解）。

## 5. 验收

- [ ] `fact-file-store.test.mjs` 全绿；真实文件抽检计数一致。
- [ ] 四通道在 Node 侧可调通（ipcContract 级用例）；`fact:save` 如实报 `WRITE_PROTOCOL_NOT_STARTED`。
- [ ] 适配器形状对齐用例绿。
- [ ] 看板双分支切换用例绿；普通项目零回归。
- [ ] `verify:next` EXIT=0。

## 6. 允许改动的文件

```
next/kernel/factFileStore.mjs               （新建）
next/shell/factEntriesToHub.mjs             （新建）
next/shell/ipcContract.mjs                  （四通道＋注入参数）
next/shell/main.mjs                         （factStoreFor 注入）
next/shell/useBoardData.mjs                 （条目数据源分支）
next/tests/fact-file-store.test.mjs         （新建）
next/tests/fact-channels.test.mjs           （新建）
next/tests/fact-adapter.test.mjs            （新建）
next/tests/fact-board.spec.mjs              （新建，UI 级断言放这里——本单不许改 shell-ui.spec.mjs）
next/kernel/errors.mjs                      （如需登记新错误码注释）
```

## 7. 边界（不做）

- 不做写（save 真落盘＝S2）；不碰 `wiki.*`；不做 UI 版式（五页签＝S4）；不做搜索 UI 入口。
- 不改 `server/mcp/**`（A5 对齐另议）。
- 不把 `D:/Qbook` 路径写死进任何源码/测试（env 夹具制）。

## 8. 回填格式

同 P1。
