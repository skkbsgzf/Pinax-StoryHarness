# 批次77-R1 工单：任务3 接线收口＋任务5 技能库（对话面·承接批次77）（2026-11-03）

> 调度方：Zcode。执行方：Qoder CLI（Qwen3.8-Flash）。**工单源与规格全部在 [批次77 工单](./pinax-electron-next-m2-batch77-ticket-20261103.md)——本单只缩范围，规格逐字有效。**
> 现场状态：批次77 原执行方停在任务3 接线中途——纯模块 `composerTypeahead.mjs` 与测试（9/9）已落，**接线六件未动**；任务1/2/4 已完成（§7-1/2/3）；任务5/6 未开工；全程未 commit。

## 本单范围＝批次77 的任务3 接线收口＋任务5（任务6 留 R2）

### A. 任务3 接线收口（六件，规格见批次77 工单任务3）

1. **五条新键位进 `hotkeys.mjs`**：唤起对话/发送/停止/切模式/唤起技能菜单（词表源 menus.mjs:15-68；Q3 键位裁定在台账）。
2. **`runtimeAskAbort` IPC 扩段**（ipcContract.mjs:43/:133 同一命名族，白名单与测试同步）——主进程侧按 runId 标记取消、在跑的一轮结束后不再续轮。
3. **abort 链**：`agentRuntime.mjs` 的 `ask()` 把 `options.abort` 原样交给 runner（补登记已写：一行）；`runnerAdvisor.mjs` 收 abort 传给 `toolLoop.run`，`kind:'stopped'` 如实办两件事（正文写「已按作者要求停止（第 N 轮后不再续轮）」、返回带 `stopped:true`）；进程内 advisor 直答链**不假装能停**（不加 stopped）。
4. **`TRAIL_STAGES` 加 `stopped`**：主进程循环真发的事件——白名单不扩真事件会被丢；带 `sanitizeTrailEventBody` 的 stopped 分支（只留 step）与 describeTrailEvent 中文；词表外段型仍落 null 的负断言保持。
5. **`AssistantDialog.vue` 两套并行键盘逻辑合成一个 typeahead**＋停止钮（消息落 `status:'stopped'`＋trail 追加）；`RuntimeDock.vue` 抽技能 token。
6. **守卫⑧负断言**：中文正文中段 `/`、`@`、`#` 不误触（「第3/章」用例）。

### B. 任务5 技能库设置面＋`domain` 字段（规格见批次77 工单任务5，四条全做）

1. `SkillsSection.vue`（新）进设置目录与搜索：装载状态（含「工具不在面上整包不装」的具体原因——批次37 事实可见化）、启停、查看正文、适用任务域。
2. `domain` 字段进 frontmatter：四类词表（screenwriting/prose/worldbook/acceptance 显示中文）；校验在 loadSkills.mjs:101-152，缺字段不报错归「未分域」，非法值报明确原因；内置 5 包各补 domain；风格以 `kind: style` 标、`/` 菜单单列。
3. 启停真值存项目内 `.pinax/skills.json`（carrierOverridesStore 思路）；关掉＝装载清单剔除＋runnerAdvisor.mjs:87-101 渐进披露提示消失（有用例）。
4. 导入＝拷进 `.pinax/skills/` 后校验，不合格逐条列原因；导出不做（记边界）。

### 本单任务3 的验收（批次77 工单任务3 的验收全文有效）

typeahead 三类各一条命中用例＋「中文正文不误触」负断言；技能项点击后草稿里是 `／技能名` 文本且 `payload.skill` 未被前端硬塞；停止钮用例证明 `status:'stopped'` 落进会话；blocked 档可点并被会话事件记下。

### 本单任务5 的验收（批次77 工单任务5 的验收全文有效）

缺 `domain` 仍能装载并进未分域；非法 `domain` 报明确原因；关掉技能后系统提示清单里不再有它；工具不在面上整包拒装时设置面能看到原因。

## 允许文件

批次77 工单「允许文件」全清单有效（AssistantDialog/RuntimeDock/ipcContract/agentSessions/main/mdRender/ConversationTimeline/settings/SkillsSection 新/SettingsModal/hotkeys/menus/slashCommands/agentReferences/next-shell.css/runnerAdvisor/toolLoop/loadSkills/next/skills/*/SKILL.md/sessionStore/next/tests/**/docs/plan/**）＋本批新增登记：`next/shell/composerTypeahead.mjs`、`next/runtime/agentRuntime.mjs`（ask 传 abort 一行）、`next/runtime/toolTurn.mjs`（usage 一行，已落）、`next/shell/conversationTimeline.mjs`（已落）——均为批次77 执行方已申报的补登记件，本批延续。

## 禁止边界

批次77 工单「禁止边界」全文有效（不动协议形态词表与 PANE/PAGE 状态轴语义、不动写族闸与 writePolicy 三档、不加依赖、不自设阈值当闸、server/src 不改、子代理与工作流产生逻辑归批次78、**不 commit**、窄屏不动）＋本批追加：**任务6（真分支/消息树/‹2/3›切换器）不做**（R2 单独派）；`tool-end` 白名单不加字段（「N 字」欠账待裁）。

## 守卫标记

批次77 工单守卫⑥⑦⑨已落地保持；本批交付守卫⑧（typeahead 前导边界）＋⑪（技能未装载可见原因）；守卫⑩随 R2。

## 验收判据（完成定义）

`npm run verify:next` 五段全绿且读数只增不减；任务3 与任务5 的验收用例全落；§7 回填含接线清单与「越界补登记」续表。

## 记账指标（不进闸）

typeahead 三类的菜单条数；技能清单长度与 `/` 菜单滚动；停止钮按下到 status:'stopped' 落盘实测毫秒数。

---

## §7 执行方回填 ／ §8 调度方验收

（批次记录执行方落盘 `docs/plan/pinax-electron-next-m2-batch77r1-20261103.md`；§8 调度方补；diff 指引用临时索引法；**收口后调度方接管真窗口实拍**（批次77 工单指派的实拍义务随本批一并履行）。）
