# 批次29 执行工单：Agent 运行过程事件流——真实阶段可见（2026-10-29）

> 执行方：Codebuddy CLI（DeepSeek v4.1 Flash）
> 调度方：Zcode（验收、门禁、提交；本批经 workflow 编排派发）
> 作者指令：「会话内的思维链，工具，子 agent，hook 等的前端显示」。本批交付这条链上**真实存在**的过程事件；不存在的东西不装样子（见边界）。

## 0. 现状锚点（先读这些再动手）

- `next/runtime/runnerAdvisor.mjs`：in-process 运行器，一次 ask＝信封组装（buildRuntimeEnvelope）→ runAgent 一次调用（roundGuard 计轮）→ createAdvisorTaskResponse 解析。**这些阶段现在全部静默**，作者只能看到最终一段字。
- `next/runtime/agentRuntime.mjs`：`ask(question, context)` → `runner({ question, context, runtime })`。
- 推送先例：`next/shell/main.mjs:160` 的 `webContents.send(channel, payload)`；`next/shell/preload.mjs` 的 `onEvent(channel, handler)`＋通道白名单。
- `next/shell/RuntimeDock.vue`：busy 期 AssistantDialog 显示固定语「正在核对项目资料…」。
- `next/shell/agentSessions.mjs`：消息 schema `{ id, role, text, findings, actions, failed, at, command?, notes? }`。

## 1. 任务一：runner 生命周期事件（Next 层，不动老线）

`next/runtime/runnerAdvisor.mjs`：`createAdvisorRunner({ …, onEvent })`——执行过程中在**真实节点**发事件，纯数据 JSON：

```js
{ stage: 'start', questionChars }
{ stage: 'envelope', taskType, profile, blocks, chars, missingKinds }  // 信封组装完的真实统计
{ stage: 'model-round', round }                                        // roundGuard 的每次真实轮
{ stage: 'answer', chars, structured, roundsUsed }                     // structured=解析是否成功
{ stage: 'failed', code, stage }                                       // 失败路径：走到哪、为何断
```

- `agentRuntime.ask` 透传 `onEvent`：放在第三参 `{ onEvent }`，不破坏现有两参调用面（测试/验收零改动），如实现中发现第三参破坏面更大就改挂 `context.onEvent` 并在 limitations 说明。
- 事件发射用 try/catch 包住：回调抛错只记 warning，绝不打断提问本身。
- **不改** `server/services/advisorAgentRunner.js`（老线共用代码）——它只回最终结果，事件全部在 Next 的 runnerAdvisor 层发。

## 2. 任务二：IPC 事件推送

`next/shell/ipcContract.mjs`＋`next/shell/main.mjs`＋`next/shell/preload.mjs`：
- runtimeAsk 处理器为本轮提问生成 `askId`，onEvent 经既有推送机制发 `pinax:agent:runtime:ask-event`，payload `{ askId, event }`
- preload 通道白名单加这条（onEvent 机制已在，只补通道名）

## 3. 任务三：前端过程显示

`next/shell/RuntimeDock.vue`＋`next/shell/AssistantDialog.vue`＋`next/shell/agentSessions.mjs`：
- **busy 期**：thinking 行按最新事件换真实阶段语——「正在组装上下文（N 块 · M 字）」「模型第 n 轮」「正在整理回答」；没有事件时保持现有固定语
- **答后**：完整事件轨迹折进答下方的 `<details class="authoring-knowledge__trail">`「过程」——每事件一行（阶段＋关键数字），默认收起（照老版规矩：开发者向事实折折叠层，屏上只留问—答主线）
- **失败**：failed 事件让错误信息带上「走到哪一步断的」
- **持久化**：消息 schema 加 `trail`（事件数组，封顶 32 条，JSON 安全），随会话存储走——刷新后折叠层还在；agent-sessions 的清洗/上限逻辑同步
- askId 关联：渲染层只认「本次 busy 期」的事件（上一轮晚到的事件不串进新提问）

**测试**：`next/tests/runner-events.test.mjs`（新）——成功路径事件序（start→envelope→answer）、失败路径 failed 事件、回调抛错不打断；agent-sessions 扩 trail 清洗/封顶；shell-ui.spec 扩阶段语切换＋details 折叠。

## 4. 门禁

完成后：`npm run verify:next` 五段全绿。

## 5. 边界

- **不新增 npm 依赖**；**不改老线**（server/services/**、src/** 一律不碰）
- 不做子Agent/hook 的假显示：这条 in-process 链上不存在子代理与 hook，就不显示——诚实边界写进记录，真要显示得等 runner 链升级，另行排期
- 不做流式 token（那是模型面合同升级，另行排期）；事件粒度到「轮」为止
- 新增 CSS 全走 token；执行方不 commit/push、不启停 electron
