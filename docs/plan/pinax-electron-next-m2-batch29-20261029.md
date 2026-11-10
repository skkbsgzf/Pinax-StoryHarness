# Pinax-Electron-Next M2 批次29：Agent 运行过程事件流——真实阶段可见（2026-10-29）

> 作者指令：「会话内的思维链，工具，子 agent，hook 等的前端显示」。本批交付这条链上**真实存在**的过程事件。
> 执行方式：**workflow 编排（CreateWorkflow）＋Codebuddy CLI（deepseek-v4.1-flash，78 轮 / 约 2 分钟）**——本批起恢复作者指定的派发方式；门禁独立复跑＋评审员对照工单查 diff 都在 workflow 里完成。

## 1. 交付

**runner 生命周期事件**（`runnerAdvisor.mjs`，Next 层，老线零改动）：五节点真事件——`start`（问题字数）→ `envelope`（任务档/档案/块数/字数/缺席块种，信封组装完的真实统计）→ `model-round`（roundGuard 每次真实轮）→ `answer`（字数/解析是否成功/用轮）→ `failed`（`atStage` 断点＋错误码）。回调抛错只记 warning 不打断提问。

**IPC 事件推送**：通道 `pinax:agent:runtime:ask-event`，payload `{ askId, event }`，主进程走既有 `sendToRenderer`，preload 白名单以 `IPC_PUSH_EVENTS` 收口（该通道名没有 `event:` 段，进不了被 shell-contract 钉死的那张表，单列一张）。askId 渲染层先生成、主进程校验兜底——事件比回执先到，没有号就认不出归属。

**前端过程显示**：busy 期 thinking 行按最新事件换真实阶段语（「正在组装上下文」「模型第 n 轮」「正在整理回答」，无事件回落老固定语）；答后完整轨迹折进 `<details class="authoring-knowledge__trail">过程（N 步）`——默认收起（老版规矩：开发者向事实折折叠层），失败行拼「（断在：…）」；trail 入会话存储（`sanitizeTrail` 逐阶段白名单＋封顶 32 丢最旧），刷新后折叠层还在；askId 分桶（`pendingTrails`/`finishAsk`），上一轮晚到与未知 askId 一律丢。

## 2. 调度方补刀

评审员发现 `shell-ui.spec.mjs` 一处既有断言从载荷全等放宽为 `objectContaining`（askId 进载荷所致，必要但确实放松）——已按评审员建议收紧为 `{ question, askId: expect.any(String) }` 并复跑门禁：仍全绿。

## 3. 门禁（调度方独立复跑，workflow 内）

验收 **16/16** · 内核单测 **289/289**（＋5）· 外壳界面测 **96/96**（＋3）· eslint 0 警 · 打包 a–k 全过。

## 4. 截图

`png/68-light-ask-trail.png`（问一句·模型未配→如实报缺＋「过程（3 步）」展开：开始·问题 14 字 → 组装上下文·5 块 385 字·writing-chapter → 中断·AGENT_PROVIDER_CONFIG_INVALID·断在组装上下文）、`69-dark-ask-trail.png`（深色同界面）。失败路径本身就是事件流的真演示：信封真组了（5 块 385 字），断点真报了。

## 5. 诚实边界

- **子 agent / hook / 流式 token 一律不显示**：这条 in-process 链上不存在这三样（runAgent 一次调用、事件粒度到「轮」）；要显示得先升级 runner/模型面合同，另行排期。
- 轨迹是事后折层不是流式增量：busy 期只有一行阶段语，答完才整条折进 details。
- 在途轨迹只在内存：提问途中换项目/换 bridge/关窗，那一问的事件即丢。
- `failed` 事件键名落 `atStage`（工单字面 `{ stage, stage }` 写不出来），理由在 `runnerAdvisor.mjs:26` 注释。
- 真模型下的实际时序（多轮 model-round 事件）要等模型面配好才能看到——失败路径已实测，成功路径由单测覆盖（真信封 blocks/chars 端到端）。
