# Pinax-Electron-Next M2 批次15：提案审阅最小面＋壳层对齐小包（2026-10-28）

> 执行模式不变：调度方（Zcode）调研派单 → coder（DeepSeek `deepseek/deepseek-flash`）执行 → 调度方验收修复提交。
> 工单来源：MCP 工具面对账的 **A 级缺口**（提案审阅）＋壳层差异清单的 **B 类两项**（#6 右栏宽度、#10 焦点陷阱）。

## 1. 交付

**工单A：提案审阅最小面（AI 协作闭环收口）**
- `fileService` 新增 `.pinax/proposals/` 元数据的列/读/弃/标记（listProposals 解析 pinax-proposal@1、坏 JSON 跳过计警、raw 散件列出；markProposalStatus 只认 proposed/adopted/discarded 三档，原子写回）。
- novel 载体自有工具 +3：`pinax_proposal_list/read/discard`（聚合面 24→27）。
- UI：索引窗小说板「提案」区（标题＋时间，空/警告各有形态）→ 中栏审阅面（提案头部＋说明、**当前正文与提案新文上下堆叠**、采纳/弃用）。截图 `png/27/28`。
- 采纳语义：先读目标章拿当前数字修订号 → `pinax_chapter_save` 落盘 → 同层把提案标 adopted（状态写失败只降级为 proposalWarning，不把已落盘的正文翻成失败）；弃用＝删文件。
- **端到端实证（调度方）**：按 MCP `chapter_write` 产物语义真写一份提案进演示项目 → 真窗口列表→审阅→采纳 → 磁盘核对：正文含采纳新增段、提案 `status: "adopted"`。

**执行方上报的一处设计偏离（调度方裁定：认可）**：工单字面要求"采纳后经姊妹逻辑置 status"，但三把工具的授权面下渲染层触达不到 fileService。落法＝`markProposalStatus` 挂在载体 `pinax_chapter_save` 的可选 `proposal` 参数上——采纳那次正文写入成功后同层标记。判定：三把工具语义不变（read 只读/discard 只删）、渲染层无需第 4 把工具，且"正文写入与状态标记同层原子完成"比独立通道更内聚。

**工单B：对齐小包**
- 右栏宽度钳制 260–640 → **320–680**（对齐老版 `useWorkspaceHost.js:286`；索引窗 200–360 不动）。
- 焦点陷阱 `next/shell/focusTrap.mjs`（约 40 行纯 DOM）：Tab 循环＋打开即收焦＋release 归还，接进 `WorkbenchModal` 底座——所有统一弹窗（含设置二级页）一并吃到。
- 测试：`focus-trap.test.mjs`（node:test + jsdom，6 例，含 AppNext 源码断言拒绝旧 640/260 残值）；shell-ui 补「弹窗打开 Tab 不出面板」。

## 2. 门禁与验收

- 调度方独立复跑 `verify:next`：验收 16/16、内核单测 **164/164**、外壳界面测 **52/52**、eslint 0 警、打包 a–k 全过。
- 工单侧每单后门禁一次实跑全绿。
- 执行方零升级（断言同步预授权覆盖：聚合面 24→27 的 8 处断言同步逐处列明）。

## 3. 验收期调度方另修

- **占位文案泄漏**：CarrierPaneHost 第二条模板链（新建构思行）的 `v-else` 占位在提案审阅态也渲染（截图可见于审阅面之下）——改为显式 `v-else-if="viewKind === 'placeholder'"`。

## 4. 执行方上报、调度方已认可/待办

1. **SettingsModal.vue 头注过时**（写着"焦点陷阱不在 Next 落地"）——不在工单允许清单，**下批同步**（一句话注释修正）。
2. 焦点陷阱含"打开即收焦"（工单未要求，照老版 useTransientLayer 惯例补）——保留，删除开关已注明。
3. 提案目标章超 200000 字时对照面只显示前段（读工具上限），采纳不截断。
4. `writeProposal` 的旧名字清洗与新严格校验并存：运行时轨散件以 raw 形态可见。

## 5. 诚实边界

- 提案间 diff、部分采纳不做（边界）；对照面的行级 diff 可复用历史面板能力（后续候选）。
- 采纳/弃用的真链路在演示项目实测通过；深色截图未重拍（上一批 26 号已验深色主题正确性，本批面板词汇全 token）。
- 世界书/设定侧的提案（若未来 chapter_write 之外的写口出现）不在本面覆盖。
- 提案审阅的采纳后「撤销」走历史面板恢复（批次14 能力），两处联动未专门串联测试。
