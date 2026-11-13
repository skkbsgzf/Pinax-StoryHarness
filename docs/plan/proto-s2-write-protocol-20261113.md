# 工单 S2 · 写协议收口（writeFactFile ＋ wiki 分离 ＋ devtools 脚本迁移）

> 基线：`D:\Pinax-next` @ HEAD（含 S1：factFileStore 只读 ＋ 四通道；verify:next 全绿）
> 上游计划：`Pinax_工单排期_S0-S5.md` 第 6 节（WO-S2-01/02/03）
> 纪律（排期文档第 10 节）：**一处真源**＝`拆解/<id>.json` 只能由 `writeFactFile()` 写入；**派生可删**＝wiki.json/hub/索引删掉不报错、重建一致。

## 0. 硬约束

1. `npm run verify:next` EXIT=0 五段全绿。
2. `next/fact/**` 的抽取管线逻辑、提示词、schema **一字不动**（S2 只动写入与文件组织）。
3. **不迁移存量**：已存在的含 wiki 信封文件保持原样可读（读侧兼容两代：信封内 wiki / 兄弟 wiki.json）。
4. 不执行 git；不启停 electron。

## 1. WO-S2-01 · `writeFactFile()`（放 `next/kernel/factFileStore.mjs` 内导出）

签名：`writeFactFile({ root, bookId | id, entry?, patch?, operationId, expectedRevision? })`

- **原子替换**：写 `<target>.tmp` → `os.replace` 到 `拆解/<id>.json`（Windows 上 replace 原子）。
- **revision 自增**：写前重读磁盘当前文件，顶层 `revision` 若与内存认知（或 expectedRevision）不符 → fail `REVISION_MISMATCH`；成功则顶层 `revision + 1`。
- **operationId 旁路日志**：追加 `<root>/拆解/.operations.jsonl`（一行一条：`{at, operationId, bookId, revision, outcome}`）；重复 `operationId` → 不重写，返回 `{ok, duplicate: true}`。
- **并发**：同进程内按文件路径排队（Promise 串行闸）；跨进程靠 os.replace 原子性＋写前 revision 复核——两个写者并发，后者得 `REVISION_MISMATCH`，无丢数据。
- `entries[]` 内按 `id` 定位替换/追加/删除；文件顶层 `updatedAt` 刷新。

## 2. WO-S2-02 · devtools 两脚本迁移

- `devtools/run-extract-library.mjs`（写点 ≈451 行 `writeFile(outPath, JSON.stringify(result...))`）与 `devtools/wiki-enrich-run.mjs`（≈448 行同类）改走 `writeFactFile`（import 自 next/kernel——devtools 已有 import next 的先例）。
- 迁移后脚本连跑 3 次：JSON 不损坏、`revision` 单调递增、`.operations.jsonl` 追加 3 行。
- `拆解汇总.json`（聚合产物）不在真源范围，保持原样。

## 3. WO-S2-03 · wiki 分离（只管新写，不迁存量）

- `writeFactFile` 写主 JSON 时**剥离 `wiki` 字段**，另写兄弟文件 `拆解/<id>.wiki.json`，头部：
  `{ derivedFrom: { factRevision: <写前 revision>, schema: 'pinax-wiki-derived@1' }, ...wiki 内容 }`
- **读侧兼容两代**：`devtools/build-wiki.mjs`（与任何读 wiki 的消费者）改为「优先读兄弟 wiki.json，无则回落信封内 `wiki` 字段」——存量文件（wiki 在信封里）照常工作。
- `factFileStore` 的 list/get 本就不吐 wiki（S1 已隔离），确认回归。
- 删掉 `<id>.wiki.json` 后主 JSON 校验照过（派生可删）。

## 4. 通道收口

- S1 挂的 `fact:save`/`fact:remove`（现为 `WRITE_PROTOCOL_NOT_STARTED`）接真实现：save→`writeFactFile`（upsert 语义），remove→按 id 删除条目；`operationId` 必填校验照旧。
- `fact:get` 的 revision 语义随写协议成立（get 回的就是最新 revision）。

## 5. 验收

- [ ] `writeFactFile` 单测：原子写、revision 自增、expectedRevision 冲突拒绝、operationId 幂等、并发双写后者 `REVISION_MISMATCH`、崩溃残留 .tmp 不影响主文件（≥8 条）。
- [ ] 两个 devtools 脚本迁移后各跑 3 次（可用夹具目录，不跑真模型——脚本有 dryRun/夹具路径；做不到就写 limitations 并用单测覆盖写路径）。
- [ ] wiki 分离：新写文件对（主 JSON 无 wiki＋wiki.json 有 derivedFrom）；读侧两代兼容用例；删 wiki.json 主文件仍过 validate。
- [ ] `fact:save` 通道级用例：真实落盘＋幂等＋REVISION_MISMATCH。
- [ ] `verify:next` EXIT=0。

## 6. 允许改动的文件

```
next/kernel/factFileStore.mjs               （writeFactFile＋save/remove 实现）
next/shell/ipcContract.mjs                  （save/remove 通道接真实现）
devtools/run-extract-library.mjs
devtools/wiki-enrich-run.mjs
devtools/build-wiki.mjs                     （读侧两代兼容）
next/tests/fact-file-store.test.mjs         （扩展）
next/tests/fact-write-protocol.test.mjs     （新建）
next/tests/fact-channels.test.mjs           （扩展）
```

## 7. 边界（不做）

- 不迁移存量拆解文件（读侧兼容即可，迁移器另开工单）。
- 不改抽取管线/提示词/schema（next/fact/** 一字不动）。
- 不做跨进程文件锁（os.replace 原子性＋revision 复核已够单机）。
- 不做 wiki 派生进 kernel（S4-01 另单）。

## 8. 回填格式

同 P1。
