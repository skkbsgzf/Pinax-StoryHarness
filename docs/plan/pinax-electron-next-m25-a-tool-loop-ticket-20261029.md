# M2.5-A 执行工单：工具循环——把已经存在的工具回合接进 Next（2026-10-29）

> 执行方：Qoder（主 agent，本批不走 CodeBuddy 派发）
> 调度方：作者（逐批点头；本工单批准后开工）
> 作者指令：「做好文档工单的标准交付，然后开始逐一实现」；病根见 `next-agentkit-plugin-protocol-diagnosis-20261029.md` 结论 1。

## 0. 现状锚点（先读这些再动手）

- `next/runtime/runnerAdvisor.mjs:76-82`：`runAgent({ providerId, capability, envelope, question, taskMeta })` —— 没有 `tools`，没有循环，一次提问＝一次模型往返。
- `next/runtime/agentRuntime.mjs:65-78`：`listTools()` 返回面上全部工具（MCP `listTools` 原样），`callTool(name, args)` 已做载体 `agent:ask` 授权与写闸；这是循环唯一该用的执行口。
- `next/runtime/mcpSurface.mjs:54-72`：`createRuntimeSurface` 聚合内核 19 把 ∪ 载体工具，写闸装在聚合面内核兜底那一支。
- `server/services/kitModelGateway.js:159-232`：`runKitFunnelProviderTurn(request)` 已支持工具回合——入参 `{ messages(parts), tools, options }`，出参 `{ kind: 'tool_calls' | 'final_ready', calls[{id,name,arguments}], text, usage }`。**单回合**，循环归调用方。唯一调用方是旧路由 `server/routes/generationAgent.js:45`。
- **但它的校验层不能直接复用**：`runKitFunnelProviderTurn` 前面是 `validateGenerationAgentTurnRequest`，其 `normalizeTools`（`shared/generationToolContract.js:160-189`）只认 `GENERATION_TOOL_NAMES` 这个**闭集**（`:9-15`：叙事只读工具 + 节拍规划 + `web_search`），`pinax_*` 工具一把都过不去（直接 `GENERATION_TOOL_UNKNOWN`）。所以任务五走**同一传输层的下层函数** `forwardComplete(payload, {timeoutMs})`，请求体形状不变（`{messages, tools[{name,description,parameters}], toolChoice}`），校验归 Next 自己：名字取自运行时面、schema 取自 MCP `inputSchema`、数量由 `selectTools` 封顶。
- 上限仍照抄 `shared/generationToolContract.js:21-30` 的 `GENERATION_AGENT_LIMITS`：`maxTools: 6`、`maxMessages: 28`、`maxToolResultChars: 7200`、`maxInputChars: 24000`。这是**数值口径**，不是接口绑定。
- `next/fs/fileService.mjs:170-180`：`writeProposal({ name, text })` 只写 `.pinax/proposals/`；`:189+` 的 `listProposals` 把 `.json` 解析成提案对象（`schema/id/status/target/content/contentChars/createdAt/note`），非 JSON 归 `raw`。
- `next/shell/useBoardData.mjs:632-698`：今天采纳＝读当前 `revision` → `pinax_chapter_save(expectedRevision)`；`STALE_REVISION` 原样摊开，不静默合并。
- `next/runtime/kernelWriteGuard.mjs:40-49,66-76`：`KERNEL_WRITE_CLASS` / `CARRIER_WRITE_CLASS` 是「哪把工具写哪块目录」的唯一事实源，策略层不许另抄一份。
- 门禁：`npm run test:next`、`npm run test:next:ui`、`npm run lint:next`；全量 `npm run verify:next`（含两次 vite 打包，约数分钟）。

## 1. 任务一：工具披露 `next/runtime/toolSelect.mjs`

模型面每回合只收 6 把工具，面上有 20 把，所以必须有确定性的选择层——**不调模型、可单测**。

```js
selectTools({ tools, intent = '', skill = null, limit = 6 }) → { tools, dropped, reason }
```

规则（按序执行，先到先得）：

1. `skill?.tools` 非空 → 按声明顺序取，只留面里存在的；缺的记进 `dropped`。
2. 无技能 → 恒定带 `pinax_project_context`（有就带）。
3. 写意图判定：`intent` 命中 `改|重写|改写|更新|保存|重构|调整|合并|拆分|新增|删除|落盘` 才算写意图。
4. 写意图 → 按关键词选域：`大纲|节点|卷章|结构`→outline；`世界书|条目|关系`→worldbook；`章节|正文|稿`→chapter；`剧本|场次|台词`→script；`设定|约束|禁忌`→rule；`构思|灵感`→notes。每域最多 2 把写工具（`*_save` / `*_write`）。
5. 其余名额给读工具：`*_read` / `*_list` / `*_search` / `*_status`，按域相关度排，读工具总数不超过 `limit - 已选`。
6. 结果永远 ≤ `limit`；返回的名字保持面里的原顺序（模型对顺序敏感度低，但测试要可复现）。

写工具**照常暴露**：review 模式下它不是不可用，而是落地方式不同（见任务二）。所以 `selectTools` 不读 mode。

## 2. 任务二：写策略 `next/runtime/writePolicy.mjs`

```js
createWritePolicy({ mode = 'review', landing, createProposal }) → { beforeTool(call), mode }
beforeTool(call) → { kind: 'allow', args } | { kind: 'deny', code, message } | { kind: 'proposal', proposal }
```

- `landing` 由调用方传 `{ ...KERNEL_WRITE_CLASS, ...CARRIER_WRITE_CLASS }`，**本模块不复制那张表**；表里没有的名字一律 `allow`（读工具）。
- `structural`（建项目/导入）与 `derived`（索引 sync）不拦：它们不是「改某块目录」，拦了反而挡住合法初始化。
- `review`：写工具不执行，改生成提案（任务三），返回 `kind:'proposal'`。**提案必须按成功结果回给模型**（`ok:true, proposalId`），不能按拒绝回——按拒绝模型会换个参数重试，产出三四份重复提案。
- `auto`：直接 `allow`。
- `blocked`：`deny`，`code:'WRITE_BLOCKED'`，message 点名「写「正文/」请让作者在设置里切换写入策略」，并列出该目录的写工具（从 landing 表反查，不手写）。
- 参数预检不在这层做：`expectedRevision` 缺省由工具自己拒（`PINAX_STALE_REVISION`），策略层只负责「落不落、怎么落」。

## 3. 任务三：提案的「调用重放」格式 `next/runtime/proposalStore.mjs`

现有提案是 `content` 字符串；工具循环产生的提案要能**重放到同一把工具**，所以扩成同 schema 的两种 `kind`：

```json
{
  "schema": "pinax-proposal@1",
  "kind": "tool-call",
  "id": "p-20261029-1201",
  "tool": "pinax_outline_save",
  "args": { "nodes": [], "edges": [], "expectedRevision": 12 },
  "baseRevision": 12,
  "summary": "合并第二卷三个重复支线，新增两处伏笔节点",
  "target": { "file": "大纲/outline.json", "chars": 1840 },
  "status": "pending",
  "createdAt": "2026-10-29T12:01:00+08:00",
  "runId": "ask-…"
}
```

规则：

- 文件名 `<YYYYMMDD-HHmmss>-<tool 短名>-<4 位随机>.json`，字符集沿用 `writeProposal` 的清洗规则。
- 章节类工具（`pinax_chapter_save`）的 `args.text` **同时**写一份到 `content` 与 `target.file/chars`——老 UI 的 `adoptProposal` 不认识 `tool/args`，但认 `content`，这样在 UI 改造完成前不会出现「点了采纳没反应」。
- 重放函数 `applyProposal(proposal, { callTool, readRevision })`：先读当前 revision → 与 `baseRevision` 比对 → 不一致返回 `PINAX_STALE_REVISION`（不静默合并）→ 一致则把 `args.expectedRevision` 换成当前值再 `callTool`。**提案永远不绕过写闸**：它只是「把参数换个时机再调一次」。
- 提案写入沿用 `fileService.writeProposal`，不新增写盘通道。

## 4. 任务四：循环本体 `next/runtime/toolLoop.mjs`

纯函数式，依赖全部注入，单测里不需要模型面：

```js
createToolLoop({ turn, callTool, selectTools, policy, onEvent = null, maxSteps = 8 })
run({ question, envelope, tools, runId }) → { kind: 'final' | 'step-budget', text, steps, calls }
```

一轮的协议：

1. `turn({ messages, tools })` → `{ kind, calls, text }`。
2. `kind === 'final_ready'` → 收工，返回 `text`。
3. `kind === 'tool_calls'`：逐调用 `policy.beforeTool`——
   - `allow`：`callTool`，把 `{ ok, payload }` 压成工具结果消息；
   - `deny`：压一条 `isError:true` 的工具结果（模型看得到原因），发 `tool-denied`；
   - `proposal`：压一条 `ok:true` 的工具结果，含 `proposalId` 与「等待作者采纳」，发 `proposal-created`。
4. 每次调用发 `tool-start` / `tool-end`（含 `ms`）；每轮发 `step`。
5. 步数用尽 → `kind:'step-budget'`，`text` 为空字符串，不发假总结。
6. 任何策略/执行异常 → 转成 `isError` 工具结果继续，不让一次坏调用炸掉整轮对话；只有 `turn` 抛错才上抛。

消息形状（循环内部用 parts 合同；交给 `toolTurn` 时由它压成 `forwardComplete` 的请求体）：

- assistant 轮：`{ role:'assistant', content: text, parts:[{type:'text',text}, ...calls.map(c=>({type:'tool-call', toolCallId:c.id, toolName:c.name, input:c.arguments}))] }`
- 工具轮：`{ role:'tool', parts:[{type:'tool-result', toolCallId, toolName, output, isError}] }`

`output` 序列化后截断到 `maxToolResultChars`（7200），截断要在字符串层做，不能先 JSON 再截出半个对象。

## 5. 任务五：模型回合适配 `next/runtime/toolTurn.mjs`

- `createKitToolTurn({ complete = forwardComplete, timeoutMs, maxTools = 6 })` → `turn({ messages, tools, options })`：
  1. 消息映射：tool 轮 → `{ role:'tool', toolCallId, toolName, output, isError }`；assistant 轮 → `{ role:'assistant', content, toolCalls }`；
  2. 工具映射：`{ name, description, parameters: inputSchema }`，按 `maxTools` 截断；
  3. 调 `complete({ messages, tools, toolChoice, maxTokens? }, { timeoutMs })`；
  4. 归一成 `{ kind: 'tool_calls' | 'final_ready', calls, text, finishReason }`。
- **不**经过 `validateGenerationAgentTurnRequest`：那条合同是闭集，见上文现状锚点。校验责任在 Next 侧的三道：`selectTools`（≤6 且都在面上）、循环里的「未声明工具一律不执行」、以及工具执行本身。
- 首轮 user 消息用 `buildOpenClawUserMessage(envelope, question, { taskType, target })` 生成，与单轮路径**同一段文字**，不另写一套上下文拼装。
- 这是本批唯一的旧线 import（只读调用，不改 `server/**`）。将来内化时把这段传输调用搬进本文件，形状不变。

## 6. 任务六：runner 可选接线（默认关）

`createAdvisorRunner({ toolLoop = null, toolSelect = null, writeMode = 'review' })`：

- `toolLoop` 为 `null`（默认）→ 今天的行为一个字节都不变，`runner-events.test.mjs` 与既有 289 条内核测试原样通过。
- 注入后：信封组装完 → `selectTools({ tools: runtime.listTools(), intent: question })` → `toolLoop.run(...)` → 回答仍走 `createAdvisorTaskResponse` 解析；事件在五段基础上加 `tool-start/tool-end/tool-denied/proposal-created/step`（`sanitizeTrailEvent` 的批次29 白名单同步扩，封顶 32 条不变）。
- `writeMode` 本批只从函数参数进，**不从 UI 进**——模式徽章的接线属于 B 批，避免一批改两处。

## 7. 测试

新增：

- `next/tests/tool-select.test.mjs`：技能声明优先；无技能恒定带 context；写意图命中大纲；上限 6；缺工具进 dropped；顺序可复现。
- `next/tests/write-policy.test.mjs`：review → proposal；auto → allow；blocked → deny 且 message 点名目录写工具；非写工具一律 allow；表外名字不误伤。
- `next/tests/tool-loop.test.mjs`：final_ready 直接收工；一次 tool_calls → 执行 → 第二轮 final；deny 产生 isError 消息且循环继续；proposal 按成功回给模型（断言 `ok:true` + proposalId，防模型重试）；步数耗尽返回 step-budget 且不编总结；`turn` 抛错上抛；工具结果截断 7200。
- `next/tests/proposal-store.test.mjs`：提案 JSON 形状（含 `kind/tool/args/baseRevision`）；章节类同时写 `content`；`applyProposal` 在 revision 不一致时返回 STALE 且**不调用** callTool；一致时替换 `expectedRevision` 后调用。

不改既有测试；若既有断言因新增文件而红，先查是不是把新模块拖进了渲染层依赖（渲染层必须保持薄）。

## 8. 门禁

`npm run test:next` → `npm run test:next:ui` → `npm run lint:next` 全绿；最后跑一次 `npm run verify:next`（含打包断言 a–k）。

## 9. 边界

- **不改** `server/**`、`src/**`；`forwardComplete` 只调用，不修改。
- **不新增 npm 依赖**。
- 默认关闭：不注入 `toolLoop` 时行为与今天完全一致；不启停 electron、不写作者原稿目录。
- 本批不做：模式徽章进 UI、技能加载器、提案角标、`project.changed`——分别在 B 批与 A 批后续小步里做。
