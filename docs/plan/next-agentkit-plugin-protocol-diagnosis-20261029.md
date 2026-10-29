# PinaxNext 双线诊断：Agent Kit 与插件协议

> 日期：2026-10-29　状态：调研与诊断，未改动任何代码
> 对照对象：Toonflow 源码（D:\toonflow）、Obsidian 开发者文档、DSH / Community Fabric RFC
> 结论先行，证据按 `path:line` 给到，最后列出需要作者裁定的 10 件事。

## 0. 结论

1. **Agent 今天缺的不是能力，是接线。** 运行时把「内核 19 把工具 ∪ 载体工具」聚合成一张 MCP 面，但这张面只对外部 MCP 客户端开放；进程内的模型运行器一次都没有把工具交给模型。`runnerAdvisor` 组装完只读信封后，调用的是 `runAgent({ providerId, capability, envelope, question, taskMeta })`，没有 `tools` 参数，也没有循环（`next/runtime/runnerAdvisor.mjs:76-82`，`server/services/advisorAgentRunner.js:43`）。反过来说，模型面并不是不会用工具：旧服务端已有 `runKitFunnelProviderTurn`（`server/services/kitModelGateway.js:159`）收 `{ messages, tools, options }`、把上游 `toolCalls` 原样吐回，只是这条回合只挂在旧路由 `server/routes/generationAgent.js:45` 上，Next 的 runner 没接；该合同上限 6 把工具 / 28 条消息 / 24000 字（`shared/generationToolContract.js:21-30`）。
2. **作者点名的三件事，今天一件也做不成。** 大纲没有提案口，正文有提案工具但产品内没有调用者，世界书的写入口只对作者开放。`agentRuntime.propose()` 在整个渲染层没有任何调用者，只有 IPC 分支（`next/runtime/agentRuntime.mjs:136`，`next/shell/ipcContract.mjs:333-334`），所以 `.pinax/proposals/` 目前只能由外部 MCP 客户端或测试写入。
3. **review / auto 徽章是死 UI。** `AssistantDialog` 会 `emit('update:mode')`（`next/shell/AssistantDialog.vue:300-304`），但 `RuntimeDock` 挂载它时既没有传 `:mode`，也没有接 `@update:mode`（`next/shell/RuntimeDock.vue:287-300`），提问载荷里同样没有 mode（`RuntimeDock.vue:217-219`）。所以「自动模式」今天只是文案。
4. **Slash 不是 skill。** 四条斜杠命令是提示词模板加 `context.omit`（`next/shell/slashCommands.mjs:24-42`），没有工具绑定、没有渐进披露、没有产物合同。它解决的是「把话说得更像指令」，解决不了「模型知道该调哪把工具、按什么顺序调、失败后怎么修」。
5. **插件协议在「静态声明」上比 Obsidian 严，在「工作区模型」上比 Obsidian 薄。** 我们有 scopes、依赖闭包、写闸、目录唯一主人，这些 Obsidian 的 manifest 完全没有；但 Obsidian 有 leaf / tabs / 多实例 / 延迟实例化 / 弹出窗口，我们只有一个 pane 对应一个四值形态枚举（`next/kernel/carrierManifest.mjs:24`，`next/shell/paneForms.mjs:21`）。
6. **「悬浮 → 展开 → 缩成气泡」装不进现在的模型。** 气泡不是第五种形态，它和「停靠/分屏/浮窗/全屏」不在同一根轴上。现在的 `form` 是单枚举，已经被迫用 `fullscreenReturn`、`overlay.snap` 两个补丁去记「从哪来、吸在哪」（`next/shell/AppNext.vue:758-772`，`next/shell/FloatingWidget.vue:42-46`）。
7. **形态状态落错了地方。** `paneForm.<paneId>`、`overlay.<paneId>`、`agentSessions.<projectRoot>` 都在 localStorage（`next/shell/paneForms.mjs:74-80`，`FloatingWidget.vue:48-82`，`next/shell/agentSessions.mjs:19-20`），与 U14「Next 不得以浏览器缓存承载业务状态」冲突（`docs/plan/pinax-electron-next-ui-consistency-plan-20261028.md:32`），也与 Desktop 随机端口下 localStorage 按 origin 隔离的事实冲突——用户指南自己写了这件事（`docs/docs_user-guide.md`「本地 Web 端口」一节）。
8. **载体目前不是 UI 插件。** `CarrierPaneHost.vue` 按 pane id 前缀把七种界面写死在外壳里（`next/shell/CarrierPaneHost.vue:40-51`，模板从 272 行起），认不出的前缀一律显示「还没实现」。第三方载体可以声明 pane，但没有办法带来自己的视图，也没有 renderer 注册表（协议 P13 只把 richtext/html 记账，`docs/plan/next-plugin-ui-protocol-20261028.md:59`）。
9. **正确方向不是加形态，而是换坐标。** 把「形态」拆成 placement × minimized × geometry × restore 四轴，状态写进项目级 `workspace.json`；把 pane 升级成可多实例的 leaf；把七种写死的界面抽成宿主提供的六种视图类型（tree / list / editor / reader / diff / graph），再留一个富视图逃生口。这样气泡只是 `minimized: 'bubble'`，展开只是恢复 `restore`，不需要为每种组合立枚举。
10. **两条线要在同一个动作上会合。** Agent 改完大纲，UI 必须自己醒过来；悬浮窗收起成气泡时，气泡上要有「有新提案」的角标；点角标展开，要能定位到被改的节点。这要求三件基础设施：`project.changed` 观察事件、提案采纳闭环、`reveal(paneId, { nodeId })` 宿主动作。缺任何一件，「创作型 Obsidian」就只是把编辑器换成三栏。

---

## 1. 调研范围与证据边界

### 1.1 代码边界：Pinax.Next 到底是哪一坨

本次诊断的对象是 `next/`（近两日的全部新代码），不是旧前端：

```text
D:\Pinax-main\Pinax-main\
├─ next\                    ← Pinax.Next 本体
│  ├─ kernel\               能力词表 / 清单校验 / 注册表 / 骨架 / 授权
│  ├─ runtime\              会话装配、信封、runner、工具面、写闸、导入、历史、知识服务
│  ├─ carriers\             novel / outline / notes / worldbook / script / setting / reference
│  ├─ shell\                主进程入口 main.mjs、IPC 合约、Vue 外壳与全部界面
│  ├─ fs\ project\ history\ 文件服务 / 项目模型 / git 快照
│  ├─ testing\ tests\       验收脚本与门禁（test:next / test:next:ui / lint:next）
│  └─ .build\               打包产物（只用于核对入口名，不读实现）
├─ shared\                  跨代契约（Next 正在用 12 处 import，含 5 处测试）
├─ server\                  旧 Express 服务端（Next 正在用 7 个模块）
├─ src\                     旧渲染层（Next 正在用 3 个 Workbench 组件）
└─ electron\                旧主进程（Next 正在用 projects/fsDurability.mjs）
```

`package.json` 把这套边界钉死了：`next:shell` 直接跑 `next/.build/pinax-next-shell-main.mjs`，`verify:next` 只跑 `next/testing` 与 `next/tests`，不碰 `src/` 的任何测试（`package.json:93-104`）。根目录的 `electron/main.mjs`、`src/` 其余部分、`dist/`、`prototype/` 都不在 Pinax.Next 的运行路径上。

真正跨到旧树的只有下面这些 import，它们是「纯血」还没做到的地方，也是本文唯一引用旧代码的原因：

| 旧模块 | 被谁引 | 作用 | 判断 |
| --- | --- | --- | --- |
| `server/services/advisorAgentRunner.js`（61 行） | `next/runtime/runnerAdvisor.mjs` | 按 capability 选 provider，失败换 fallback | 要留，但它是单轮合同 |
| `server/services/advisorTaskService.js`（330 行） | 同上 | 结构化审稿解析 | 可原样留 |
| `server/services/textModelAgentProvider.js` → `kitModelGateway.js` | 同上 | 真正打模型面 `/v1/pinax/complete` | 模型面；**已有工具回合能力**（见 2.1） |
| `server/mcp/createMcpServer.js`（153 行） | `next/runtime/{mcpSurface,kernelWriteGuard,surfaceAggregate}.mjs` | 内核 19 把工具的定义与 annotations | 工具面事实源 |
| `server/mcp/projectImport.js`、`server/services/{localMirrorService,knowledgeProjectIndex}.js` | `next/runtime/*Adapter*`、`knowledgeService` | 导入与索引 | 逐步内化 |
| `shared/*` 12 处 | 多处 | 信封契约、世界书文件契约、轮数闸、工具回合契约 | 跨代契约，短期不动 |
| `src/components/workbench/{WorkbenchIcon.vue,WorkbenchTooltip.vue,workbenchTooltip.js}` | `next/shell/{ActivityRail,AppNext,AssistantDialog,IndexWindow}.vue` | 图标与提示气泡 | **最后三块旧界面**，批次 C 一并换掉 |

**没在这张表里的旧代码，本文一次都没有引用。** 旧前端页面、`server/routes` 的 Express 路由、IndexedDB 存储轨都不在 Pinax.Next 的运行路径上，也不构成本次诊断的依据。

另外两个目录不属于产品代码：`D:\Pinax-e2e` 是验收工装（`capture-b*.mjs` 逐批截图、`dameng-copy` 测试夹具），`D:\next-preview` 是模型任务面的运行目录（`kit-tasks`、`kit-taskplane.json`，见批次5 文档）。它们出现在证据链里，只作为「跑过什么」的记录，不参与协议诊断。

读过的源码与文档：

| 对象 | 读到的部分 | 没做的事 |
| --- | --- | --- |
| Toonflow（D:\toonflow） | `AGENTS.md`、workspace 结构、`packages/toolScaffold`、`packages/mcp`、`apps/server/src/agent/{runtime,tools,skills,teams}`、`packages/teams/storyboardTeam`、`@earendil-works/pi-coding-agent` 的扩展类型 | 没有安装依赖、没有启动服务、没有跑一遍真实会话 |
| PinaxNext（D:\Pinax-main\Pinax-main） | `next/kernel/*`、`next/runtime/*`、`next/carriers/*`、`next/shell/{AppNext,CarrierPaneHost,RuntimeDock,AssistantDialog,FloatingWidget,paneForms,useBoardData,agentSessions,slashCommands,agentReferences}.vue/mjs`、`server/mcp/*`、`docs/plan/*` | 没有执行门禁、没有启动 Electron、没有实测气泡或浮窗行为 |
| Obsidian 官方文档 | `obsidianmd/obsidian-developer-docs` 仓库中的 Manifest、Views、Workspace、Defer views、Pop-out windows、Manage plugin lifecycle、Commands、Settings、Migrate to declarative settings、Plugin guidelines | 没有安装第三方插件、没有用真实 vault 验证 |
| DSH / Fabric | `docs/plugin-development.md`、`docs/architecture.md`、`docs/user-guide.md`、`docs/plugin-ecosystem.md`、Fabric RFC 0001–0004、`research/mature-plugin-frameworks.md`、`research/dsh-plugin-needs.md`、`docs/plugin-services.md` | 没有运行 DSH Desktop，没有实现 Adapter |

一句必须说清的前提：**DSH 今天官方可用的插件协议是 Cordis 的 `apply(ctx, config)` + `inject` + `ctx.effect`，而 `dsh-plugin.json`、capability、Host Descriptor 这些是社区 Fabric 的 Draft RFC，明说不构成 API 承诺**（`tmp-dsh/docs/docs_plugin-development.md` 开头与 RFC 0001 第 1 节）。下面引用它们时，引的是「设计成熟度」，不是「官方标准」。

---

## 2. Agent Kit 诊断

### 2.1 现状链路

一次提问的完整路径是这样的：

1. `RuntimeDock.ask()` 解析斜杠命令、解析 `@` 引用，把用户消息写进本地会话，然后调 `runQuestion`（`next/shell/RuntimeDock.vue:180-216`）。
2. `runQuestion` 通过 `bridge.request(IPC_CHANNELS.runtimeAsk, { question, askId })` 发到主进程，只有存在 `context.omit` 时才多带一个字段（`RuntimeDock.vue:218-232`）。
3. 主进程转到 `agentRuntime.ask()`，检查 `agent:ask` 授权，再把 `{ question, context, runtime, onEvent }` 交给注入的 runner（`next/runtime/agentRuntime.mjs:108-131`）。
4. `runnerAdvisor` 从运行时取出 `registry / view / fileService`，调 `buildRuntimeEnvelope` 组装只读信封，然后调 `runAgent`（`next/runtime/runnerAdvisor.mjs:43-82`）。
5. `runAdvisorAgent` 只做一件事：按 capability 选 provider，调 `provider.run(envelope, question, taskMeta)`，失败时换 fallback provider 再调一次（`server/services/advisorAgentRunner.js:38-48`）。
6. 模型返回一段文字，`createAdvisorTaskResponse` 尝试把它解析成结构化审稿，解析失败就原样返回（`runnerAdvisor.mjs:102-116`）。

这条链上没有任何一处把工具清单交给模型。工具面 `createRuntimeSurface` 确实把内核 19 把工具和载体工具聚合起来了，也装了写闸（`next/runtime/mcpSurface.mjs:54-72`），但它的消费者是 `connectInProcess` 之后暴露给 MCP 客户端的 server，不是 runner。换句话说：**我们把工具箱摆在了桌上，但没告诉模型桌上有工具箱。**

再往下看一层，有一件容易误判的事：**模型面今天已经会做工具回合。** `server/services/kitModelGateway.js:159` 的 `runKitFunnelProviderTurn` 收的是 `{ messages(parts), tools, options }`，把工具 schema 透传给 `/v1/pinax/complete`，再把上游返回的 `toolCalls` 翻译回统一形状（`:163-168`）；注释写明「单回合：一次转发；工具执行与多回合循环归调用方」（`:153-158`）。它今天的唯一调用方是旧路由 `server/routes/generationAgent.js:45`，Next 的 runner 没有接。

**但它的校验层不能整段复用**：`validateGenerationAgentTurnRequest` 里的 `normalizeTools`（`shared/generationToolContract.js:160-189`）只认 `GENERATION_TOOL_NAMES` 这个闭集（`:9-15`：叙事只读工具 + 节拍规划 + `web_search`），`pinax_*` 一把都过不去，直接报 `GENERATION_TOOL_UNKNOWN`。所以正确的接法是复用它的**传输层** `forwardComplete(payload, { timeoutMs })`（同一个 `/v1/pinax/complete`，请求体形状 `{ messages, tools[{name,description,parameters}], toolChoice }` 不变），校验责任落回 Next 自己：工具名取自运行时面、schema 取自 MCP `inputSchema`、数量由披露层封顶。换句话说，「加一条工具循环」不是发明协议，也不是照抄那条闭集合同，而是把现成的传输回合接进 `next/runtime`，自己持有循环、披露与工具执行。

约束也一并继承：`GENERATION_AGENT_LIMITS` 把每回合工具数封在 6、消息 28 条、单个工具结果 7200 字（`shared/generationToolContract.js:21-30`）。我们今天的工具面是 20 把，所以循环的第一版必须带「按意图选工具」的披露层，不能把整张工具面硬塞进去。

### 2.2 与 Toonflow 的逐项对照

| 维度 | Toonflow | PinaxNext 现状 | 差距性质 |
| --- | --- | --- | --- |
| 工具定义 | `ToolDefinition`：`name / label / description / promptSnippet / promptGuidelines / parameters / executionMode / execute(id, params, signal, onUpdate) / usage`，且工具元数据里的 `prompt` 会被拼进该工具的 `promptGuidelines`（`apps/server/src/agent/tools/index.ts:98-100`） | 名称、标题、长描述、JSON Schema、`annotations.readOnlyHint`；没有给模型的「何时用/怎么验」提示，没有示例，没有 signal/onUpdate（`next/carriers/outline/tools.mjs:87-107`） | 缺「模型说明书」与执行期反馈 |
| 工具配置 | 工具包带 `configRules`，宿主用表单渲染并校验（`packages/toolScaffold/src/runtime.ts:11-22`） | 载体 `settings` 只登记 `{ id, title }`，没有控件、默认值、校验（`next/kernel/carrierManifest.mjs:256-280`） | 缺声明式设置 |
| 执行循环 | Agent 运行时把工具交给模型，模型可以多轮调用；`subAgent` 还能并行委派（`apps/server/src/agent/runtime/index.ts:138-145`，`agent/tools/subAgent.ts:28-29`） | 单轮直答，没有循环（`runnerAdvisor.mjs:76-82`） | **结构性缺口** |
| 写操作审计 | 工具执行前有 `tool_call` 钩子，可阻断、可就地改参数，后续钩子能看到前序修改（`pi-coding-agent/dist/core/extensions/types.d.ts:679-722`） | 写闸只在工具执行时按目录判定（`next/runtime/kernelWriteGuard.mjs:120-200`），没有「调用前」策略层 | 缺 hook |
| 技能 | `SKILL.md` 带 frontmatter，必须匹配 `name` 与非空 `description`；`list / read / create / update` 四个动作，按需读取（`apps/server/src/agent/skills/index.ts:51-80`） | 四条斜杠命令＝固定提示词模板（`slashCommands.mjs:24-42`） | 缺渐进披露与工具绑定 |
| 子代理 | 子会话、父子链接、事件转发、`report` 上报（`apps/server/src/agent/runtime/delegation.ts`、`sessions.ts:77-109`） | 无 | 可后置 |
| 会话 | JSONL 树，按目录存盘，支持父子、自定义条目、删除墓碑（`sessions.ts:52-109`） | localStorage 数组，30 会话 / 200 消息（`agentSessions.mjs:19-20`） | 存储位置错 |
| 记忆 | 全局记忆，SHA-256 revision 做 CAS，保存必须带回最近读取号（`agent/tools/memory.ts:8,28-33`） | 无 Agent 记忆；项目素材靠信封 | 可后置，但 CAS 思路要借 |
| MCP 面 | `target { connectionId, directory, canvasId }` + `args` 信封，`getAppState` 先发现；读取 64 KiB 上限、分页游标；`appOperation` 管理面；`runAgent` 委托（`packages/mcp/README.md:102-121`） | 同样有 MCP 面，工具描述很细，但没把「先发现、再分页、再局部读」的方法论写进协议 | 方法论可借，结构已具备 |
| 事件 | `text / thinking / tool / subagent / subAgentEvent / report / question / stats / done`（`apps/server/src/agent/runtime/types.ts`） | 五段：`start / envelope / model-round / answer / failed`（`runnerAdvisor.mjs:20-27`） | 粒度停在「轮」 |

这张表最重要的不是「Toonflow 有、我们没有」，而是**Toonflow 的每一层都围绕「模型会连续做错、需要被纠正」设计**：工具带提示与示例，调用前有钩子，调用中有 progress，调用后有结构化结果，失败能委派子代理重做。我们现在的单轮直答假设「模型一次就能答对」，这在问答场景成立，在「重构一本书的大纲」这种多步操作里必然失败。

### 2.3 三个真实操作，逐步找断点

**操作一：更新大纲。**

今天的实际路径是：大纲内容如果被 `outline` 上下文块选中，会进信封；模型看到的是被预算裁剪过的片段，拿不到完整节点树，也拿不到 revision。模型没有 `pinax_outline_read` 可调，所以无法补读；没有 `pinax_outline_save` 可调，所以无法落盘；即使能调，review 模式也没有「大纲提案」这种产物，只有正文提案（`next/carriers/novel/tools.mjs` 的 `pinax_chapter_write`，`server/mcp/createMcpServer.js:43`）。断点有三处：读不全、改不了、存不下。

**操作二：改写文件。**

这条路的「最后一公里」其实是通的：提案文件能列、能读、能审、能采纳，`useBoardData.adoptProposal` 会用 `pinax_chapter_save` 带 `expectedRevision` 写回正文（`next/shell/useBoardData.mjs:632-698`）。断的是第一公里：产品内没有任何入口让模型生成提案。`runtime.propose()` 只有 IPC 分支，渲染层零调用者（`ipcContract.mjs:333-334`）。所以作者现在看到的提案，只可能来自外部 MCP 客户端，或者测试夹具。

**操作三：重构世界书。**

工具面比想象中完整：`pinax_worldbook_save` 支持 `meta.relations` 整份覆盖，最多 32 条，字段是 `to / type / stance / covert / weight`（`next/carriers/worldbook/tools.mjs:22-24,235,352-366`）。缺的是批量语义与提案轨：一次重构往往要改十几条条目和几十条关系边，单轮模型既读不完也写不完；写成 N 次直接保存，作者没有逐条复核的机会；写成一次大保存，又没法只采纳其中三条。这里需要的不是新工具名，而是「批量提案 + 逐条采纳 + 部分失败可重试」。

### 2.4 范式 A：一个循环、一张工具面、三档写策略

**原则：不建第二套工具注册表。** 循环调用的就是 `runtime.callTool`，走同一张聚合面、同一道写闸、同一套归属。这样外部 MCP 客户端和内置 Agent 的行为天然一致，测试夹具也能复用。

新增 `next/runtime/toolLoop.mjs`：

```js
export function createToolLoop({ callTool, runModel, policy, maxSteps = 8, maxToolCalls = 24, onEvent }) {
  return async function loop({ question, envelope, signal }) {
    const messages = [{ role: 'user', content: question }]
    let steps = 0
    let calls = 0

    while (steps < maxSteps) {
      steps += 1
      const turn = await runModel({ envelope, messages, tools: policy.exposedTools(), signal })
      if (!turn.toolCalls?.length) {
        return { text: turn.text ?? '', steps, calls, stopped: 'answer' }
      }
      for (const call of turn.toolCalls) {
        if (++calls > maxToolCalls) return { text: turn.text ?? '', steps, calls, stopped: 'tool-budget' }
        const decided = await policy.beforeTool(call)
        if (decided.kind === 'deny') {
          messages.push(toolResultMessage(call, { ok: false, code: decided.code, message: decided.message }))
          onEvent({ stage: 'tool-denied', callId: call.id, name: call.name, code: decided.code })
          continue
        }
        if (decided.kind === 'proposal') {
          // 提案不是失败：给模型一个“已受理”的成功结果，避免它换参数再试一次。
          messages.push(toolResultMessage(call, {
            ok: true, proposalId: decided.proposal.id,
            message: `已生成提案 ${decided.proposal.id}，等待作者采纳`
          }))
          onEvent({ stage: 'proposal-created', callId: call.id, proposalId: decided.proposal.id })
          continue
        }
        const started = Date.now()
        onEvent({ stage: 'tool-start', callId: call.id, name: call.name, argsDigest: digest(decided.args) })
        const result = await callTool(call.name, decided.args)
        onEvent({ stage: 'tool-end', callId: call.id, name: call.name, ok: result.ok, ms: Date.now() - started })
        messages.push(toolResultMessage(call, result))
      }
    }
    return { text: '', steps, calls, stopped: 'step-budget' }
  }
}
```

`runModel` 第一版不要再造协议：直接包 `forwardComplete`（`server/services/kitModelGateway.js`，与 `runKitFunnelProviderTurn` 同一个 `/v1/pinax/complete`），请求体就是 `{ messages, tools[{name,description,parameters}], toolChoice }`，出参的 `toolCalls` 已经是 `{ id, name, arguments }`。**不要**走 `runKitFunnelProviderTurn`：它前面的 `validateGenerationAgentTurnRequest` 是闭集，只认 `GENERATION_TOOL_NAMES`（`shared/generationToolContract.js:9-15,160-189`），`pinax_*` 会被拒。上限口径照抄 `GENERATION_AGENT_LIMITS`（6 把工具／28 条消息／7200 字结果），但那是数值约定，不是接口绑定。将来要彻底断旧线，把这段传输调用搬进 `next/runtime/toolTurn.mjs` 即可，形状不用改。

工具数受 6 把上限（`shared/generationToolContract.js:21-30`），所以组 `messages` 之前先跑一层 `selectTools(intent, skill, surface)`：命中技能就按技能的 `tools` 声明带，没命中就按任务档给 3–4 把读工具；写工具只在意图里出现「改 / 重写 / 保存」时才披露。这一层不是优化，是硬约束——20 把工具整张塞进去，合同直接拒。

`policy` 是写策略层的入口，新增 `next/runtime/writePolicy.mjs`：

```js
const WRITE_LANDING = { ...KERNEL_WRITE_CLASS, ...CARRIER_WRITE_CLASS }

export function createWritePolicy({ mode, proposals }) {
  return {
    exposedTools() {
      // 写工具照常暴露：review 下它们不是“不可用”，而是“落地方式不同”。
      return surface.listTools()
    },
    async beforeTool(call) {
      const landing = WRITE_LANDING[call.name]
      if (!landing || landing.derived || landing.structural) return { kind: 'allow', args: call.args }
      if (mode === 'blocked') {
        return { kind: 'deny', code: 'WRITE_BLOCKED', message: `「${landing.dir}」当前为只读；请让作者在设置里切换写入策略` }
      }
      if (mode === 'review') {
        const proposal = await proposals.create({ tool: call.name, args: call.args, dir: landing.dir })
        return { kind: 'proposal', proposal }
      }
      return { kind: 'allow', args: call.args }
    }
  }
}
```

这里有一个关键取舍：**review 模式不要另造一套 `*_write` 工具名，而是让同一把 `*_save` 在策略层改道。** 今天 `pinax_chapter_write`（提案）与 `pinax_chapter_save`（直写）是两把名字，等于把策略写进了工具名，所以 UI 上的 mode 切换无从生效。合并之后，模型只学一把「保存章节」，是否落原稿由策略决定；`pinax_chapter_write` 可以保留为兼容别名，内部转成 review 策略。

**钩子**：`beforeTool` 就是最小可用的 `tool_call` 拦截器链。建议只做两个钩子点，不要一上来做通用事件总线：`beforeToolCall`（允许/拒绝/改参数）与 `beforeWrite`（目录归属、revision 预检、用户确认）。钩子按注册顺序确定性执行，写路径上任何钩子抛错一律 fail closed，读路径 fail open。这一条直接借的是 `pi-coding-agent` 的 `tool_call` 契约（`types.d.ts:679-722`）：参数可就地改写，后续钩子看到前序修改，但改写后不再重新做 schema 校验——所以 Pinax 要在每个钩子返回后自己再跑一次 schema 校验，避免「钩子把合法参数改成非法」。

### 2.5 范式 B：工具说明书三件套

今天工具描述是给「读文档的人」写的，不是给「要动手的模型」写的。以 `pinax_outline_save` 为例，描述里已经写清了「整份覆盖、不接受增量、revision 不对就拒」，这很好；但模型真正会犯的错是：只回传 changed nodes、把 id 重新生成、忘记带 revision、把 edges 丢了。这些应该在工具旁边直接给可复制的示例。

建议在工具 impl 上增加三个字段（不进 manifest，保持清单静态可分析）：

```js
{
  name: 'pinax_outline_save',
  description: '作者确认后的大纲落盘口……',
  guide: {
    when: '作者明确要求调整大纲结构，且你已用 pinax_outline_read 拿到当前 revision。',
    rules: [
      'nodes 是全量：已删除的节点不要出现在数组里，未改动的节点也必须原样带回。',
      '改名保留原 id；新增节点用 `n-<短哈希>`，不要复用已删除的 id。',
      'edges 不传等于清空；不改连线就原样回传 read 的结果。'
    ],
    example: {
      nodes: [{ id: 'n1', title: '第一章 雪夜', type: 'chapter', summary: '……' }],
      edges: [{ from: 'n1', to: 'n2' }],
      expectedRevision: 12
    },
    onError: {
      PINAX_STALE_REVISION: '重新 read 一次，把新 revision 和最新 nodes 一起带回；不要盲重试。'
    }
  }
}
```

宿主在组装系统提示时，只注入「当前工具面里存在」的 guide，并对总量设上限（例如 6000 字），超出按工具优先级截断。这样做的收益是可测的：同一模型、同一任务，带 guide 与不带 guide 的首次成功率可以直接 A/B，不需要靠感觉。

### 2.6 范式 C：技能是包，不是模板

技能的最小结构建议直接对齐 Toonflow / Cursor / Claude 的通用约定，避免自创格式：

```md
---
name: outline-restructure
description: 重构大纲结构：合并、拆分、重排节点，保留 id 与既有摘要。
tools: [pinax_outline_read, pinax_outline_save]
context: [outline.tree, text.chapters]
output: proposal
---
## 步骤
1. 先 read，确认 revision 与节点总数。
2. 给出「保留 / 改名 / 新增 / 删除 / 换序」五类变更表，等作者确认或按指令直接执行。
3. 调 save；review 模式下会自动转成提案。

## 禁止
- 不改正文，不新建章节文件。
- 不删除有子节点的父节点，除非明确要求并给出子节点去向。
```

加载器只做三件事：解析 frontmatter、校验 `tools` 里每一把都在当前工具面、把 `name/description` 放进系统提示的「可用技能」短清单。正文按需读取（模型调新增的 `pinax_skill_read`，或用户点斜杠命令时由宿主注入）。这就是渐进披露：系统提示里永远只有一行描述，不占预算；真正要用时才把全文展开。

第一版建议只做五个技能，全部对应真实操作，不做「万能写作助手」：

| 技能 | 输入 | 工具 | 产物 |
| --- | --- | --- | --- |
| `outline-restructure` | 当前大纲 + 作者指令 | outline_read / outline_save | 大纲提案 |
| `chapter-rewrite` | 选中章节 + 改写要求 | chapter_read / chapter_save | 正文提案（带 diff） |
| `worldbook-refactor` | 条目清单 + 关系边 | worldbook_list / read / save | 批量条目提案 |
| `continuity-check` | 多章正文 + 设定 | chapter_read / worldbook_read | 结构化问题清单，不写盘 |
| `scene-expand` | 大纲节点 + 风格约束 | outline_read / chapter_read / chapter_save | 新章提案 |

斜杠命令保留，但语义改成「技能入口」：`/大纲 重构第三卷` = 选中 `outline-restructure`，把「重构第三卷」作为参数，同时把当前打开的大纲节点作为 invocation 上下文注入。这样命令、技能、工具是三层，而不是今天的「命令就是一段提示词」。

### 2.7 范式 D：提案闭环与「改完就看见」

提案需要从「章节专属的旁路」升级成「所有写工具的通用落地形态」。建议文件格式：

```md
---
id: p-20261029-0007
tool: pinax_outline_save
target: 大纲/outline.json
baseRevision: 12
createdAt: 2026-10-29T14:02:11+08:00
runId: ask-...
summary: 合并第二卷三个重复支线，新增两处伏笔节点
---
{ "nodes": [...], "edges": [...], "expectedRevision": 12 }
```

正文类提案（章节、资料）的 body 是 markdown；结构化类提案（大纲、世界书）的 body 是 JSON，frontmatter 里用 `payloadType: markdown | json` 区分。采纳时不是「把正文抄回去」，而是用提案里的参数重新调一次同名工具，并把 `expectedRevision` 换成当前 revision 做 CAS。这样提案不会绕过写闸、不会绕过归属、不会绕过并发检查；提案只是一个「待执行的调用」。这一点比今天的章节提案更彻底：今天采纳是 UI 自己调 `chapter_save`，将来任何写工具都能走同一条路。

配套三件事：

1. **`project.changed` 观察事件**：文件服务每次成功写入后，按目录发一条 `{ dir, path, revision, tool, runId }`。渲染层订阅后只刷新受影响的板块，不整页 `refresh()`。
2. **回答落地后主动通知**：`RuntimeDock` 在 `runQuestion` 成功后 `emit('changed', { runId, proposals })`，`AppNext` 收到后刷新提案计数与受影响的板块。今天回答落地后什么都不发（`RuntimeDock.vue:231-244`），所以即使外部写入成功，界面也要等下一次手动刷新。
3. **提案角标**：索引窗、竖条格、气泡三处共享同一个未读提案计数，数据源是提案目录，不是会话消息。

### 2.8 范式 E：模式、钩子、AGENTS.md

**模式是策略，不是徽章。** 会话里存 `{ write: 'review' | 'auto' | 'blocked' }`，随每次 ask 传给运行时；切换时写一条会话事件（谁、何时、从什么切到什么）；`auto` 需要一次显式确认，并且只对当前项目生效，不写成全局偏好。UI 徽章显示的是策略真值，不是组件本地默认值。

**AGENTS.md 分三层**：应用级（内置行为准则，随版本发布）、项目级（`.pinax/AGENTS.md`，作者可编辑，进 git）、载体级（载体声明的片段，例如「大纲节点的 id 一旦发布不得更改」）。三层按优先级拼接，带来源标记与字数上限，作者能在设置里看到「这一问到底注入了哪些规则」。Toonflow 的做法是 workspace `AGENTS.md` 加全局记忆（`apps/server/src/agent/runtime/resources.ts`），结构可以直接借，但来源可见性要做得更好。

**钩子的失败策略要写死**：读工具上的钩子失败 → 记 warning，放行；写工具上的钩子失败 → 拒绝，并给修复路径。不要留「看情况」的模糊地带，否则一次钩子异常就会变成一次静默写坏。

### 2.9 范式 F：事件与会话落盘

事件模型建议从五段扩到十段，但**不要暴露原始思维链**。产品需要的是「可审计的决策轨迹」，不是模型自言自语：

```json
{ "seq": 7, "runId": "ask-01J...", "stage": "tool-end", "callId": "c2",
  "name": "pinax_outline_read", "ok": true, "ms": 12,
  "result": { "nodes": 24, "edges": 31, "chars": 3800 } }
```

十段是：`run-start / context-built / plan / tool-start / tool-progress / tool-end / proposal-created / answer / run-end / failed`。每条带 `seq` 与 `runId`，工具事件带 `callId`，失败带 `atStage`。如果 provider 真的返回了 thinking，单独走 `thinking` 通道并标明「模型原文」，不混进决策轨迹。

会话从 localStorage 搬到 `.pinax/sessions/<id>.jsonl`，一行一个条目：`session / message / event / proposal / tombstone`。父子会话用 `parent` 字段，未来做子代理时不需要换存储。这样 U14 的「项目数据只落磁盘」才真正成立，备份、迁移、诊断包也都能带走会话。

### 2.10 Agent Kit 的门禁（逐条断言，不设总量）

- 假模型先请求 `pinax_outline_read` 再请求 `pinax_outline_save`：review 下磁盘文件不变、提案目录多一条、模型收到带 `proposalId` 的成功结果（不是错误，避免它换参数重试）；auto 下文件 revision +1；blocked 下收到 `WRITE_BLOCKED` 且带修复路径。
- 同一工具调用在钩子链里被改参数后，执行前重新过 schema；非法改写必须被拒，不能把错误参数送进文件服务。
- 写钩子抛错 → 拒绝；读钩子抛错 → 放行并记 warning。
- 事件 `seq` 单调递增；每个 `tool-start` 有且只有一个配对的 `tool-end`；失败事件的 `atStage` 落在已发生的阶段上。
- 预算耗尽时返回 `stopped: 'step-budget' | 'tool-budget'`，不返回空字符串冒充回答。
- 每个技能的 `tools` 声明都能在工具面里找到；每个技能有一条夹具，跑完必须产出提案或结构化清单。
- 会话 JSONL 往返一致；父会话删除时子会话按墓碑规则处理；源码里不再出现 `localStorage` 承载会话。
- 回答成功后 `RuntimeDock` 必发 `changed`；`project.changed` 到达时只刷新受影响板块。

---

## 3. 插件协议诊断

### 3.1 现状模型

今天一条载体清单要过 `validateCarrierManifest`，字段的去向是这样的：

```text
manifest (pinax-carrier@1)
  ├─ id / version / minKernel / tier      → 注册表身份与兼容闸
  ├─ primary { projectKind, defaultPane, contextProfile } → 项目类型与默认面
  ├─ dataDirs { 逻辑名: 物理目录 }        → 一块文件夹的所有权
  ├─ panes [{ slot, id, title, icon, width? }] → 外壳渲染的视图
  ├─ capabilities[]                        → 依赖闭包里的“我提供什么”
  ├─ requires [{ capability, min, fix }]   → 依赖闭包里的“我需要什么”
  ├─ tools[]                               → 运行时工具面 + 命名空间查重
  ├─ context { providers, budgetChars }    → 信封素材块
  ├─ scopes [file/agent/state/net]         → 授权表
  └─ settings [{ id, title }]              → 统一设置页的目录项
```

这套校验在「静态可分析」上确实领先 Obsidian：Obsidian 的 `manifest.json` 只有 `author / minAppVersion / name / version / description / id / isDesktopOnly` 七个必填项，没有权限、没有依赖、没有贡献点（`obs/Reference__Manifest.md:11-31`）。但领先只发生在「声明」这一层，运行时和 UI 层反而更薄。

### 3.2 与 Obsidian 的对照

| 维度 | Obsidian | PinaxNext | 判断 |
| --- | --- | --- | --- |
| 清单 | 极简，无权限声明，靠「插件是受信代码 + 目录审核」 | 有 scopes、依赖闭包、目录唯一主人、写闸 | 我们更严，保留 |
| 生命周期 | `onload/onunload` + `Component` 层级，`registerEvent/registerInterval/registerDomEvent/addChild` 自动清理（`obs/Plugins__Guides__Manage plugin lifecycle.md:60-80,192-217`） | 注册表 `install/uninstall` 只释放工具与命名空间认领，载体 impl 没有 `dispose`（`next/kernel/pluginRegistry.mjs:35-70`） | 缺激活作用域清理 |
| 视图 | `ItemView` + `registerView(type, factory)`，按类型取实例，禁止插件自己持有视图引用（`obs/Plugins__User interface__Views.md:45-99`） | pane 是清单里的静态 id，界面由外壳按前缀写死（`CarrierPaneHost.vue:40-51`） | 缺视图注册制 |
| 工作区 | split / tabs / leaf 树，left/right/root 三个特殊 split，`getLeaf / getLeftLeaf / getRightLeaf / createLeafInParent / detach / detachLeavesOfType / setGroup`（`obs/Plugins__User interface__Workspace.md:3-48,115-134`） | 一条竖条 + 一个索引窗 + 一个中栏 + 一个右栏；中栏最多主 pane + 一个副 pane | 缺通用工作区树 |
| 延迟实例化 | v1.7.2 起不可见视图是 `DeferredView`，`revealLeaf` 或 `loadIfDeferred` 才实例化（`obs/Plugins__Guides__Defer views.md:6-30`） | 内容随 `v-if` 卸载，没有「可见才挂载」的合同，也没有状态保留声明 | 缺延迟合同 |
| 弹出窗口 | 独立 `Window/Document`，`activeWindow/activeDocument`、`element.win/doc`、跨窗 `instanceOf`、`onWindowMigrated`（`obs/Plugins__Guides__Support pop-out windows.md:8-61`） | `FloatingWidget` 是 `.next-shell` 内的 absolute 卡片，不能出应用窗口 | 明确不支持，写进描述符 |
| 命令 | `addCommand({ id, name, callback })`，`checkCallback` 两段式，`editorCallback` 拿当前编辑器（`obs/Plugins__User interface__Commands.md:1-60`） | 协议 P15 只立了方向，未实现（`docs/plan/next-plugin-ui-protocol-20261028.md:64`） | 缺命令注册制 |
| 设置 | 1.13 起 `getSettingDefinitions()` 声明式，宿主负责渲染、搜索、持久化、校验（`obs/Plugins__Guides__Migrate to declarative settings.md:8-10`） | 只登记节标题，没有控件与值（`carrierManifest.mjs:256-280`） | 缺声明式设置 |
| 内容渲染 | 插件自己决定 DOM，宿主提供 CSS 变量与 `MarkdownRenderer` | 宿主手写 md 渲染，载体不能换渲染器（P13 记账） | 缺 renderer 注册 |

Obsidian 最值得学的不是它的 manifest，而是三件事：**工作区是一棵树、视图按类型注册且不持有实例、不可见视图延迟实例化**。这三件事共同保证了「同一块内容可以同时出现在侧栏、分屏、浮窗，插件不需要为每种形态写一遍」。这也正是作者要的「大纲可以浮于小说、可以展开、可以缩成气泡」的底层条件。

Obsidian 最不该学的是它的信任模型：没有权限声明、没有作用域，插件代码就是应用代码。Pinax 的 scopes 和写闸是资产，不能为了「生态开放」把它削平。正确说法是 DSH Fabric 的四段式：支持、请求、授权、强制执行是四件事；同进程 JavaScript 里，前三件能做，第四件做不了（RFC 0001 第 5 节）。所以我们的 scopes 要在设置页明确写成「兼容与审计声明」，不能写成「安全沙箱」。

### 3.3 与 DSH Fabric 的对照

| 维度 | DSH Fabric | PinaxNext | 建议 |
| --- | --- | --- | --- |
| 声明分类 | 五类：`requires / permissions / provides / contributes / subscriptions`，语义互不混用（RFC 0001 第 7.1 节） | `capabilities`（提供）、`requires`（需要）、`scopes`（权限）、`panes/settings/tools`（贡献）混在一个对象里 | 拆成五类，v1 读入时做映射 |
| 宿主描述符 | 机器可读，声明 API 范围、执行环境、信任模式、能力、平台；市场区分「声明兼容 / 待授权 / 已测试 / 不兼容 / 未知」五态 | 只有 `KERNEL_CONTRACT_VERSION = '1'` 与 `minKernel` 的 major 比较（`carrierManifest.mjs:9-10,96-100`） | 加 `host-descriptor.json` 与 `doctor` |
| UI 分层 | 四层：声明式贡献 / 类型化 provider / 沙箱富视图 / 宿主扩展（`research/mature-plugin-frameworks.md:129-155`） | 只有第三层，而且是在宿主组件里写死的 | 先补一二层，三层留逃生口 |
| 业务协议 | 五类：观察流 / 命令动作 / 拦截器 / 上下文贡献 / 持久任务（同上 157-178） | 有上下文贡献（blocks）与动作（tools），缺观察、拦截器、任务 | 先做观察，再做拦截器 |
| 权限 | 四段式，明确 in-process 不是沙箱 | scopes 语义接近，但没有「用户授权」这一段的记录与撤销 | 加授权记录与撤销 |
| 激活作用域 | Koishi/Cordis 的 `ctx.effect`，注册随激活销毁（`research/mature-plugin-frameworks.md:21-49`） | 注册表没有 `dispose`，工具调用没有 AbortSignal 贯穿 | 加 `impl.dispose()` 与每次调用的 signal |
| 运行时/呈现分离 | Runtime / Presentation / Control / Transport / Invocation 五轴，呈现能力是每次调用快照，不能缓存成激活全局（RFC 0002） | 单窗口单呈现，但工具已经在假设「有一个当前界面」 | 加 `ui.reveal` 动作，别让工具碰 pane |

这里有一个容易被忽略的点：DSH 的 `contributes` 是「代码执行前就能发现的声明」，工具实现只在代码里绑定。Pinax 现在把 `tools` 名字写进清单、实现放在 impl，方向是对的；但 `panes` 同时承担了「发现」和「渲染」两件事，导致第三方无法只声明一个「树视图」就获得宿主渲染。拆开之后，`contributes.panes[].view` 指向宿主视图类型，`dataSource` 指向载体提供的数据函数，才是 VS Code 那种「声明 + 绑定」的形态。

### 3.4 五个结构性缺口

1. **pane 不是 leaf。** 一个 pane 同时只能有一个实例、一个形态、一个位置。作者想要「同一份大纲同时出现在浮窗和分屏」时，状态会互相覆盖。
2. **form 是枚举不是状态。** `dock / split / overlay / fullscreen` 四值把「放哪」「多大」「是否最小化」「从哪恢复」压成一个值，于是代码里长出了 `fullscreenReturn`、`snap`、`paneFormOf(side) === 'dock'` 这些补丁（`AppNext.vue:668-706,758-772`）。
3. **状态落错地方。** 形态与位置进 localStorage，会话也进 localStorage；U14 已经裁定业务状态不落浏览器缓存，且 Desktop 随机端口下 origin 会变。这不是风格问题，是数据会丢的问题。
4. **capability 语义混用。** 词表里既有「章节正文」「大纲节点树」这种数据域，又有「词汇表口径」「约束与禁忌」这种规则域，它们全部被当作依赖闭包里的 provider（`next/kernel/capabilities.vocab.mjs:9-26`）。将来要表达「我提供一个工具结果渲染器」「我订阅文件变化」时，没有位置放。
5. **没有协商与诊断。** 只有 `minKernel` 的 major 比较；插件为什么没加载、缺什么、是声明不兼容还是没授权，作者只能看一条 `rejected` 横幅（`AppNext.vue:1203-1206`）。市场与启动器更无从判断。

### 3.5 形态专项：悬浮、展开、气泡怎么装

先把三件事分开：

- **放置（placement）**：dock / split / overlay / fullscreen。它回答「这块内容占哪个容器」。
- **最小化（minimized）**：none / tab / bubble / hidden。它回答「不占容器时以什么形式存在」。
- **几何（geometry）**：`{ x, y, w, h, snap }`。它只对 overlay 有意义。

「气泡」属于第二轴，是 overlay 或 dock 的最小化态，不是第五种放置。把它塞进 `PANE_FORMS` 会立刻产生两个新问题：气泡点开回哪？气泡能不能同时是「收起的分屏」？用两轴表达，这两个问题都不存在：

```json
{
  "version": 1,
  "floating": [
    {
      "instance": "outline.tree#1",
      "pane": "outline.tree",
      "placement": "overlay",
      "minimized": "bubble",
      "geometry": { "x": 1180, "y": 96, "w": 320, "h": 520, "snap": "right" },
      "restore": "overlay",
      "z": 3
    }
  ],
  "center": { "tabs": ["novel.chapter", "outline.tree#2"], "active": "novel.chapter" }
}
```

气泡的交互规格建议写死，避免每个载体自己发明：44×44 圆形按钮，贴右缘或左缘，显示载体图标 + 未读角标；单击恢复 `restore` 形态并 `reveal` 最近变更；长按或右键出「展开 / 停靠 / 关闭」；拖出边缘 32px 自动解除吸附（沿用现有 `SNAP_EDGE`）。这些都在宿主，载体不参与。

多浮窗要现在就想清楚，否则第二个载体声明 overlay 时会被 `carrierManifest.mjs:171-178` 的「每载体至多一枚」挡住。建议宿主上限 3 枚（含气泡），z 序可调，重叠时做边界钳制；每枚有自己的 `instance` 与 geometry。这个上限写进宿主描述符，而不是散落在代码里。

延迟实例化要成为合同：`minimized !== 'none'` 或不在当前 tab 的 pane 不挂载内容组件；展开时挂载；关闭时卸载。滚动位置、选中节点这类视图状态由载体通过 `viewState` 存取，宿主只负责持久化。Obsidian 的 `DeferredView` 证明这件事对启动性能是必要的，我们的七块板同时挂载也已经不轻。

OS 级弹出窗口（真正浮在桌面其他应用之上）不在这一版：`FloatingWidget` 是窗口内 absolute 定位，做不到跨应用。如果将来要做，先把 Obsidian 那份检查单过一遍：独立 `Window/Document`、活动窗口 API、`element.win/doc`、跨窗 `instanceOf`、窗口迁移回调。现在就在描述符里写 `supportsPopout: false`，比将来悄悄不支持要诚实。

### 3.6 范式 G：Workspace v2（leaf / tabs / 实例）

数据结构不必一步做到 Obsidian 的任意嵌套，但要有三样东西：实例 id、容器树、状态文件。

```js
// next/shell/workspace.mjs
export function createWorkspace({ persist, views }) {
  const state = { center: { tabs: [], active: null }, side: { tabs: [], active: null, width: 420 }, floating: [] }

  return {
    open(paneId, { placement = 'dock', instance = `${paneId}#1` } = {}) { /* … */ },
    reveal(paneId, { nodeId = null, select = true } = {}) { /* 找到实例 → 激活 tab / 恢复 minimized → 传给视图 */ },
    setPlacement(instance, placement) { /* 只改 placement，不丢 geometry */ },
    minimize(instance, mode) { /* none | tab | bubble | hidden */ },
    close(instance) { /* 移除实例与状态 */ },
    snapshot() { return structuredClone(state) }
  }
}
```

关键约束：

- 组件不持有视图实例，只按 `instance` 从 store 取数据；这与 Obsidian「不要自己管视图引用」是同一条纪律（`Views.md:90-99`）。
- `reveal` 是唯一允许「从外部把某块内容推到用户眼前」的入口。Agent 只能调 `ui.reveal` 这个宿主动作，不能直接改 pane 状态。
- `snapshot()` 写到项目 `.pinax/workspace.json`，应用级窗口尺寸写偏好 JSON；两者都不进 localStorage。
- 每个 pane 声明 `accepts: { reveal: ['nodeId'], selection: true }`，宿主据此决定 `reveal` 能不能带定位参数。没声明的 pane 收到 `reveal` 只激活、不定位。

### 3.7 范式 H：Manifest v2（五类声明）

```json
{
  "spec": "pinax-carrier@2",
  "id": "pinax.carrier.outline",
  "title": "大纲",
  "version": "1.0.0",
  "minKernel": "2",
  "primary": { "projectKind": "novel", "defaultPane": "outline.tree", "contextProfile": "authoring-knowledge" },
  "provides": [{ "id": "outline.tree", "version": "1" }],
  "requires": [{ "id": "text.chapters", "min": 1, "fix": "启用小说载体后再启用大纲" }],
  "permissions": ["file:大纲:rw", "agent:ask"],
  "contributes": {
    "panes": [{
      "id": "outline.tree",
      "title": "大纲",
      "view": "pinax.view.tree",
      "dataSource": "outline.tree",
      "slots": ["left-dock", "center", "overlay"],
      "defaultForm": "dock",
      "forms": { "placement": ["dock", "split", "overlay", "fullscreen"], "minimized": ["tab", "bubble"] },
      "accepts": { "reveal": ["nodeId"], "selection": true }
    }],
    "commands": [{ "id": "outline.restructure", "title": "重构大纲", "when": "pane:outline.*", "skill": "outline-restructure" }],
    "settings": [{ "id": "outline.indent", "title": "缩进", "control": { "type": "number", "min": 1, "max": 8, "default": 2 } }],
    "renderers": [{ "id": "outline.diff", "kind": "tool-result", "for": ["pinax_outline_save"] }]
  },
  "tools": ["pinax_outline_read", "pinax_outline_save"],
  "context": { "providers": ["outline"], "budgetChars": 20000 }
}
```

v1 → v2 的映射规则要写死并测试：`capabilities` → `provides`，`scopes` → `permissions`，`panes` / `settings` → `contributes`，`requires[].capability` → `requires[].id`。v1 清单仍然能装，内核读入时升级；写回时只写 v2。这样七个内置载体不需要一次性重写，第三方也不会因为升级被挡在门外。

`view` 词表先给六个，覆盖现有七块板的九成界面：

| view | 用途 | 现有对应 |
| --- | --- | --- |
| `pinax.view.tree` | 节点树 + 选中 + 改名 + 拖拽排序 | 大纲、世界书列表 |
| `pinax.view.list` | 平铺清单 + 搜索 | 构思、资料、剧本列表 |
| `pinax.view.editor` | 纯文本编辑 + 保存 chip + Ctrl+S | 正文、构思、大纲、约束、剧本 |
| `pinax.view.reader` | md 渲染只读 | 条目、资料、剧本阅读态 |
| `pinax.view.diff` | 提案对照 + 采纳 | 正文提案审阅 |
| `pinax.view.graph` | 关系边视图 | 世界书关系（批次 28） |

第三方的「大纲类」载体只要声明 `view: pinax.view.tree` + `dataSource`，就能获得与内置大纲一致的交互，不需要写 Vue。这是把「开放性」落在可维护的地方：宿主维护六种视图，插件组合它们。

### 3.8 范式 I：四层 UI 与注册制

- **第一层 声明式贡献**：命令、设置、状态项、通知。宿主渲染、宿主校验、宿主持久化。命令的 `when` 由宿主求值，不能让插件用 CSS 藏按钮。
- **第二层 类型化 provider**：`pinax.view.*` 与工具结果 renderer。插件给 DTO，不给组件。
- **第三层 富视图**：确实需要自定义 DOM 的载体，声明 `view: pinax.view.rich` + 模块路径，宿主在受控容器里挂载，只给一个版本化 API：读数据源、调自己的工具、订阅观察事件、`reveal`。不给 fs、不给 net、不给任意 IPC。这一层是逃生口，不是默认路径。
- **第四层 宿主扩展**：`x-*` 能力，比如 Electron 托盘、原生菜单。市场不把它标成可移植。

与 DSH 的研究结论一致：一个 `panel.render()` 想同时服务设置开关、diff、命令面板、侧栏工作台和 TUI，最后一定变成「每个插件自己写一套 UI」（`research/mature-plugin-frameworks.md:129-155`）。我们现在的 `CarrierPaneHost` 正是这个反例的镜像：宿主替所有插件写 UI，插件反而不能写。

### 3.9 范式 J：宿主描述符与兼容五态

新增 `next/host-descriptor.json`，随包发布，运行时也通过 `doctor` 输出：

```json
{
  "descriptorVersion": "1.0.0",
  "host": { "id": "pinax.next", "version": "0.5.0" },
  "kernelContract": "2",
  "trustMode": "trusted-in-process",
  "slots": ["left-dock", "center", "overlay"],
  "forms": { "placement": ["dock", "split", "overlay", "fullscreen"], "minimized": ["tab", "bubble"] },
  "views": ["pinax.view.tree", "pinax.view.list", "pinax.view.editor", "pinax.view.reader", "pinax.view.diff", "pinax.view.graph"],
  "uiLayers": ["declarative", "provider"],
  "supportsPopout": false,
  "platforms": ["win32-x64", "darwin-arm64", "linux-x64"]
}
```

`doctor` 对每个已安装载体输出五态之一：`declared-compatible / awaiting-authorization / tested / incompatible / unknown`，并附缺口与修复路径。设置页的载体管理直接消费这份 JSON；将来的市场与启动器也读同一份。这样「为什么这个插件是灰的」不再靠猜。

### 3.10 插件协议的门禁

- v1 清单仍能通过校验并被升级为 v2；升级前后 `provides / permissions / contributes` 一一对应。
- 第三方示例载体只声明 `tree` 视图 + 一个命令 + 一项设置，不改外壳代码即可打开、执行、保存。
- 气泡态不挂载内容组件（用挂载计数器断言）；展开后 `reveal(nodeId)` 能选中目标节点。
- 两枚浮窗可以同时存在，z 序与 geometry 各自独立；重启后从 `workspace.json` 还原。
- 未知 `view` 不白屏、不崩溃：显示宿主占位并说明「宿主未实现该视图类型」。
- `workspace.json` 损坏时回落到默认布局并保留一份 `.bak`，不阻塞打开项目。
- 源码中 `paneForm.* / overlay.* / agentSessions.*` 三组 localStorage 键全部消失。

---

## 4. 两线交汇：三个闭环

**大纲重构。** 作者在竖条上右键大纲，选「重构大纲」，命令触发 `outline-restructure` 技能；运行时读出当前树与 revision，模型给出变更表并调 `pinax_outline_save`；review 策略把这次调用转成提案；`project.changed` 让索引窗、打开的大纲面板、气泡角标同时更新；作者点气泡上的「1」，浮窗展开到被改的节点，diff 视图给出增删改；采纳后写回，git 快照留一版。

**正文改写。** 作者选中一段，`/改写 更冷一点` 触发 `chapter-rewrite`；模型读章节、写提案；提案审阅面用 `pinax.view.diff` 对照原文与提案；采纳走 `chapter_save` + `expectedRevision`；写成功后 `project.changed` 只刷新这一章，正文面板的保存 chip 显示「第 N 版」。

**世界书重构。** 作者在关系图上框选一组条目，`/重构设定 合并这三个门派`；模型先列清单，再逐条调 `worldbook_save`，每条一个提案；提案面板支持「全选 / 只采纳这几条」；部分失败时保留成功项的提案，失败项带 `PINAX_STALE_REVISION` 与重读建议。关系边随条目一起进提案，采纳后图视图局部重绘。

这三个闭环共用同一组基础设施：工具循环、写策略、提案存储、观察事件、`reveal`、气泡角标。先把这六件做出来，形态上的「可玩」才有内容可玩；否则气泡只是一个更小的空窗口。

---

## 5. 落地批次

**批次 A（Agent Kit 内核，先做，能独立验收）**

新增 `next/runtime/toolLoop.mjs`、`toolTurn.mjs`（薄包 `forwardComplete`，预备内化）、`toolSelect.mjs`（≤6 把披露）、`toolGuides.mjs`、`writePolicy.mjs`、`proposalStore.mjs`、`events.mjs`；改 `agentRuntime.mjs`、`runnerAdvisor.mjs`、`ipcContract.mjs`、`main.mjs`、`RuntimeDock.vue`。

验收：2.10 的前五条断言全绿；默认关闭新循环（`next.experimental.toolLoop = false`），打开后旧单轮路径仍可回退。

**批次 B（技能、模式、会话）**

新增 `next/skills/`（五个技能 + 加载器）、`next/sessionStore.mjs`；改 `slashCommands.mjs`、`agentSessions.mjs`、`AssistantDialog.vue`、`AppNext.vue`。

验收：技能夹具全部产出提案或清单；模式切换有事件、有确认、有真值显示；会话 JSONL 落盘且 localStorage 键消失。

**批次 C（插件协议 v2 与工作区）**

新增 `next/kernel/manifestV2.mjs`、`next/shell/workspace.mjs`、`next/shell/views/*`、`next/host-descriptor.json`、`next/doctor.mjs`；改 `carrierManifest.mjs`、`pluginRegistry.mjs`、`CarrierPaneHost.vue`、`AppNext.vue`、`useBoardData.mjs`（拆分）。

验收：3.10 的七条断言全绿；七个内置载体全部迁到 v2 清单，但 v1 读取路径保留一个版本周期。

不改的东西：`server/mcp` 旧轨不动；`正文/` 原稿仍只通过带 revision 的写工具修改；不引入新的运行时依赖；不为了形态改造去重写编辑器。

---

## 6. 待裁定

| 编号 | 问题 | 选项 | 推荐 | 影响 |
| --- | --- | --- | --- | --- |
| R1 | 写工具是否合并为「一把工具 + 策略改道」 | 合并 / 保留 `*_write` 与 `*_save` 双名 | 合并，保留别名兼容 | 决定 auto 模式能否真正生效 |
| R2 | auto 模式授权粒度 | 项目级 / 会话级 / 每次确认 | 会话级 + 首次确认 | 安全与手感 |
| R3 | 工作区状态存哪 | 项目 `workspace.json` / 应用偏好 / 继续 localStorage | 项目级，窗口尺寸进偏好 | 可迁移、可备份、符合 U14 |
| R4 | 同一 pane 是否允许多实例 | 允许 / 仅 split 与 tabs 允许 / 不允许 | 允许，overlay 每 pane 一枚 | 决定 leaf 模型复杂度 |
| R5 | 浮窗上限 | 1 / 3 / 不限 | 3（含气泡） | 小屏可用性 |
| R6 | 是否做 OS 级弹出窗口 | v1 做 / v2 做 / 不做 | v2，先写 `supportsPopout: false` | Electron 工作量 |
| R7 | capability 词表是否拆三类 | 拆 `data / provider / ui` / 维持单表 | 拆，v1 映射 | 依赖闭包与市场表达 |
| R8 | 提案是否覆盖所有写工具 | 全部 / 仅正文与大纲 / 维持仅正文 | 全部写工具 | 与 R1 联动 |
| R9 | 子代理是否进 v1 | 进 / v1.5 / 不进 | v1.5，先单 Agent + 技能 | 复杂度 |
| R10 | 会话是否进 git 快照 | 进 / 不进，只留磁盘 | 不进，单独备份 | 仓库体积与隐私 |

---

## 7. 证据索引

**Agent Kit**

- 工具面聚合与写闸：`next/runtime/mcpSurface.mjs:54-72`；工具提示表 `:18-36`
- 单轮直答：`next/runtime/runnerAdvisor.mjs:76-82`；`server/services/advisorAgentRunner.js:43`
- 模型面现成的工具回合：`server/services/kitModelGateway.js:153-168`（`runKitFunnelProviderTurn`）；闭集校验 `shared/generationToolContract.js:9-15,160-189`（`pinax_*` 过不去）；数值上限 `:21-30`；唯一调用方 `server/routes/generationAgent.js:45`；Next 侧改走 `forwardComplete`（`next/runtime/toolTurn.mjs:1-18`）
- Next 与旧树的边界：`package.json:93-104`；import 清单见 1.1 表
- 事件五段与「没有子代理/hook/流式」：`next/runtime/runnerAdvisor.mjs:20-31`
- `propose` 仅 IPC：`next/runtime/agentRuntime.mjs:136`；`next/shell/ipcContract.mjs:333-334`
- 模式徽章未被接：`next/shell/RuntimeDock.vue:287-300`；`next/shell/AssistantDialog.vue:41-42,300-304`
- 斜杠模板：`next/shell/slashCommands.mjs:24-42`
- 会话 localStorage：`next/shell/agentSessions.mjs:19-20`
- 大纲整份覆盖与 revision：`next/carriers/outline/tools.mjs:87-107`
- 世界书 meta.relations：`next/carriers/worldbook/tools.mjs:22-24,235,352-366`
- 正文只出提案：`server/mcp/createMcpServer.js:43`
- 写闸分类：`next/runtime/kernelWriteGuard.mjs:40-49,66-76`
- 提案采纳最后一公里：`next/shell/useBoardData.mjs:632-698`
- Toonflow 工具提示注入：`apps/server/src/agent/tools/index.ts:98-100`
- Toonflow 工具元数据与配置：`packages/toolScaffold/src/runtime.ts:11-22`
- Toonflow 技能 frontmatter：`apps/server/src/agent/skills/index.ts:51-80`
- Toonflow 子代理：`apps/server/src/agent/tools/subAgent.ts:28-29`；`apps/server/src/agent/runtime/sessions.ts:77-109`
- Toonflow 记忆 CAS：`apps/server/src/agent/tools/memory.ts:8,28-33`
- Toonflow MCP 目标与分页：`packages/mcp/README.md:102-121`
- pi-coding-agent 工具钩子：`node_modules/.bun/@earendil-works+pi-coding-agent@0.85.1.../dist/core/extensions/types.d.ts:679-722`

**插件协议**

- 清单校验：`next/kernel/carrierManifest.mjs:24-25,32-93,96-100,142-190,256-280,282-324`
- 能力词表：`next/kernel/capabilities.vocab.mjs:9-26`
- 注册表无 dispose：`next/kernel/pluginRegistry.mjs:35-70`
- 形态枚举与 localStorage：`next/shell/paneForms.mjs:21,74-80,182`
- 浮窗位置/吸附：`next/shell/FloatingWidget.vue:42-46,48-82,149-167`
- 全屏/分屏互斥与返回记忆：`next/shell/AppNext.vue:668-706,758-772`
- 宿主写死七种界面：`next/shell/CarrierPaneHost.vue:40-51,272-704`
- 数据单例：`next/shell/useBoardData.mjs`（1256 行，七个板块共用一个 state）
- 协议 P13/P15/P18–P21：`docs/plan/next-plugin-ui-protocol-20261028.md:59,64,123-126`
- U14：`docs/plan/pinax-electron-next-ui-consistency-plan-20261028.md:32`
- Obsidian 清单：`obs/Reference__Manifest.md:11-31`
- Obsidian 视图/工作区：`obs/Plugins__User interface__Views.md:45-99`；`obs/Plugins__User interface__Workspace.md:3-48,115-134`
- Obsidian 延迟视图：`obs/Plugins__Guides__Defer views.md:6-30`
- Obsidian 弹出窗口：`obs/Plugins__Guides__Support pop-out windows.md:8-61`
- Obsidian 生命周期：`obs/Plugins__Guides__Manage plugin lifecycle.md:60-80,192-217`
- Obsidian 声明式设置：`obs/Plugins__Guides__Migrate to declarative settings.md:8-10`
- DSH 五类声明与四段信任：`tmp-dsh/docs/dsh-community-fabric_docs_rfcs_0001-plugin-manifest-capabilities-events.md` 第 5、7.1 节
- DSH 运行时/呈现分离：`tmp-dsh/docs/dsh-community-fabric_docs_rfcs_0002-runtime-presentation-invocation-transport.md` 第 0、2 节
- DSH 四层 UI 与五类协议：`tmp-dsh/docs/dsh-community-fabric_docs_research_mature-plugin-frameworks.md:129-178`
- DSH 插件真实需求：`tmp-dsh/docs/dsh-community-fabric_docs_research_dsh-plugin-needs.md:37-114`
