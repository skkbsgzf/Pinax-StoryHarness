# Pinax-Electron-Next M2.5-A：进程内工具循环（默认关）＋写策略＋提案回放（2026-10-29）

> 对应工单：`docs/plan/pinax-electron-next-m25-a-tool-loop-ticket-20261029.md`
> 依据诊断：`docs/plan/next-agentkit-plugin-protocol-diagnosis-20261029.md` §2.1–2.3
> 边界：本批只做内核与运行器，不接 UI、不改 `server/**`／`src/**`、不加依赖、不启停 Electron。

## 1. 交付

**工具披露层**（`next/runtime/toolSelect.mjs`）：按作者这句话的意图把工具面收窄到 ≤6 把。技能声明的工具优先且不进 dropped；命中领域（大纲/世界书/章节/剧本/约束/构思/资料）时，写意图额外给 ≤2 把写工具，其余名额按工具面原序补只读工具；返还的 `tools` 保持面上顺序，重复调用同一输入结果逐字相同。

**写策略**（`next/runtime/writePolicy.mjs`）：`review`（默认）/`auto`/`blocked` 三档，落点表直接读 `KERNEL_WRITE_CLASS`／`CARRIER_WRITE_CLASS`，不手写名单。`review` 下写工具不执行、转提案，提案落盘失败按拒绝回（带原始错误码）；`blocked` 拒写并点名该目录的写工具；结构动作（`structural`）与派生（`derived`）不拦。

**提案存储与回放**（`next/runtime/proposalStore.mjs`）：沿用 `pinax-proposal@1`，新增 `kind:'tool-call'` ＋ `tool`／`args`／`baseRevision`。`applyProposal` 先读当前 revision：与 `baseRevision` 不一致返回 `STALE_REVISION` 且**一次都不调** `callTool`；一致时替换 `expectedRevision` 再执行。章节类提案同时带 `content` 与 `target{file,chars}`，采纳后不必再解析一遍正文。

**工具循环**（`next/runtime/toolLoop.mjs`）：`final_ready` 直接收工；`tool_calls` 逐条过策略——allow 执行、deny 回 `isError` 工具结果、proposal 回 `ok:true + proposalId`（防模型以为失败而重试）。每次调用发 `tool-start`／`tool-end`，每步发 `step`；越界工具不执行并记 `tool-unknown`；消息超 26 条时保留最新的整轮、丢掉开头的孤立工具结果；步数用尽返回 `kind:'step-budget'`、`text:''`，不编总结。

**模型回合适配**（`next/runtime/toolTurn.mjs`）：消息压成 `{role,toolCallId,toolName,output,isError}`／`{role:'assistant',content,toolCalls}`，工具 schema 从 MCP `inputSchema` 映射到 `parameters`，按 6 把截断，调 `forwardComplete` 后归一成 `{kind,calls,text,finishReason}`。

**运行器接线（默认关）**（`next/runtime/runnerAdvisor.mjs`）：`createAdvisorRunner({ toolLoop = null })`。不注入时调用面与事件序与批次29 一字不差；注入后由循环接管模型往返，回答仍走 `createAdvisorTaskResponse`。`meta.toolLoop` 记 `{kind,steps,calls,dropped}`，`roundsUsed` 与步数同口径；`step-budget` 时给作者一句截断说明、不送结构化解析、`meta.resultParsing` 写明原因；循环抛错按失败上报，错误码取上游，断点不冒充模型轮。

**轨迹白名单**（`next/shell/agentSessions.mjs`）：阶段表白名单加 `step`／`tool-start`／`tool-end`／`tool-denied`／`tool-dropped`／`tool-unknown`／`proposal-created`，每段只留确定字段；断点单独用 `TRAIL_BREAKPOINT_STAGES`（仍只认 start/envelope/model-round/answer），工具事件不能冒充 `failed.atStage`；折叠层与 busy 期进度语同步认识新段；封顶 32 条不变。

## 2. 途中改掉的工单错判

工单与诊断原写着「复用 `runKitFunnelProviderTurn` + `validateGenerationAgentTurnRequest`」。实读 `shared/generationToolContract.js:160-189` 发现其 `normalizeTools` 只认 `GENERATION_TOOL_NAMES` 这个闭集（叙事只读工具＋节拍规划＋`web_search`），`pinax_*` 一律 `GENERATION_TOOL_UNKNOWN`。于是改用同一传输层的 `forwardComplete`，请求体形状不变，校验责任落回 Next（工具名来自运行时面、schema 来自 MCP、数量由 `selectTools` 封顶）。工单 §0／§5／§9、诊断 §1 结论／§2.1／§2.3／证据索引均已按实况订正。

## 3. 门禁（本地独立复跑）

`npm run verify:next` 一次链路全绿：

- 验收 **16/16**
- 内核单测 **327/327**（批次29 的 289 → 本批 +38）
- 外壳界面测 **96/96**
- eslint **0 警**（`--max-warnings 0`）
- 打包断言 **a–k 全过**（主进程 952.9 kB、外壳 1650.2 kB、渲染层 646.2 kB）

新增测试：`tool-select`(6)、`write-policy`(7)、`proposal-store`(6)、`tool-loop`(8)、`tool-turn`(3)、`runner-tool-loop`(4)、`trail-tool-events`(4)。

## 4. 诚实边界

- **默认关，界面上看不到任何变化。** 运行器不注入 `toolLoop`，`agentRuntime` 也未构造它；本批只证明「接上之后行为可测」，不证明「作者已经能用工具」。
- 真模型下的多轮工具时序没有实测：本机模型面未配置时这一链仍如实报缺；成功路径由注入假 `turn` 的单测覆盖。
- 提案只到「落盘 + 可回放」：没有采纳按钮、没有角标、没有 `project.changed` 刷新，这些属 B 批与后续小步。
- `toolTurn.mjs` 仍是旧线 import（`server/services/kitModelGateway.js` 的 `forwardComplete`），只读调用；「纯血 Electron」在模型传输这一环尚未成立，内化路径是把这段搬进 `next/runtime`。
- 轨迹新增七段目前只在内核测试里被驱动：真链不注入循环就不会发，扩白名单不等于界面上已有工具过程可看。
