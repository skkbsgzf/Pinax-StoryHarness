# Pinax-Electron-Next M2 批次39：项目事件消费端——板块树自动重扫（2026-10-30）

> 作者指令：批次38 收口后选「事件消费端」作为下一批。范围：把批次37 的真实但空的投递路径接到界面，
> 让 Agent／另一窗口写盘后，索引窗的树自己跟上——不再靠关弹窗、换板、手动重开。

## 1. 交付

**映射（纯函数）** `next/shell/projectEventRefresh.mjs`：

- `PROJECT_EVENT_TARGETS` 闭集：`manuscript-changed → chapters`；`outline-changed → outline`；
  `entries-changed → entries / notes / rules / documents / scripts`（总线只发 kind，一条条目型变更可能落在五棵树里）；
  `proposals-changed / sessions-changed` 不在这里消费（前者归提案审阅节，后者暂无界面消费者）。
- `refreshTargetsFor(kind, loadedTrees)`：只留**已经取过数**的树；省略 loadedTrees 返回完整目标（订阅口判断有没有人消费）。

**数据层** `next/shell/useBoardData.mjs`：

- 五个 loadX 增加 `syncCurrent`（默认 true，行为不变）：`loadNotes / loadRules / loadDocuments / loadScripts / loadEntries`
  在 `false` 时只重建树——不重读当前正文、不替作者打开第一条。
- 新增 `refreshFromProjectEvent(kind)`：
  ① 只刷 `loadedTrees` 里为 true 的树；
  ② 草稿脏（draft ≠ 读到的正文）或编辑态时只重建树，草稿一个字不动；
  ③ 大纲草稿开着（`outlineDraft` 非空）整棵跳过——大纲保存是整份覆盖，事件不能冲掉作者手上的版本；
  ④ 正文只重建索引（章节没有编辑态开关，重读当前章会冲掉正在写的草稿）；
  ⑤ `busy` 或上一轮未结束时直接跳过（事件是旁路，宁可漏一轮不并发重读）。

**外壳** `next/shell/AppNext.vue`：

- 挂载时经 `bridge.onEvent(IPC_EVENT.projectEvent)` 订阅，卸载退订并清定时器；
- 同类事件 150ms 合并成一次刷新（一次保存常连发两三条）；
- 没有消费者的 kind 在入口就丢掉，不做空转。

## 2. 测试

- `next/tests/project-events.test.mjs`（新，3 条）：映射闭集与未知 kind；loadedTrees 过滤；返回副本且常量冻结。
- `next/tests/carrier-pane.spec.mjs`「项目事件消费端（批次39）」（新，2 条）：
  ① 一棵树没取过数时事件不开任何东西；世界书编辑中刷新只重建树、`entry/entryDraft` 原样；大纲草稿开着不重读；正文草稿不被重读冲掉。
  ② 真挂 AppNext：订阅在、两条同类事件只发一次 list、未载入的正文树不刷、卸载退订。

## 3. 门禁（`npm run verify:next`）

- 验收 **16/16**；内核单测 **436/436**（批次38 后 433，＋3）；外壳界面测 **127/127**（125，＋2）；eslint **0 警**。
- 打包 a–l＋m/m2/m3 全过：主进程 1018.2 kB／外壳 1751.1 kB／渲染 876.1 kB／preload 3.6 kB。

## 4. 诚实边界

- **载体 impl.onProjectEvent 仍是空路径**：七块载体都没有项目级缓存（工具与上下文块每次现读），
  加 no-op 只是假接线；投递路径保留为扩展点，等某块载体真的需要「盘变了就重算缓存」再实现。
- 正文（章节）事件只重建索引，不重读当前章；作者要看最新正文仍靠点开／重载。骨架没有章节脏标记，不能安全判断是否可重读。
- 大纲在草稿开着时整棵跳过；关掉草稿（保存后 `outlineDraft` 仍开）不会自动重读，要等下次点开或保存。
- `sessions-changed` 没有界面消费者：多窗口会话快照仍后写者赢（M2.5-C 已知边界）。
- 事件是进程内的，只认当前项目根；换项目由主进程重绑，渲染层订阅不换。
- 事件由「任何写盘」触发（含本窗口自己的保存），会有一次自触发重列；`busy` 闸挡掉保存进行中的那一下，其余按设计重列。
- 世界书的 `entries-changed` 刷新会走 `enrichEntryRelations()`（每条一次 read）；条目多时这是一笔真实开销，debounce 只合并同一拍。
- 未起 Electron、未肉眼验收自动刷新的观感；全部证据为单测与 jsdom。未 commit／push。
