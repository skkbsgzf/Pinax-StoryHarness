# Agent 对话前端规格：对标 DeepWrite 逆向 ＋ 写作工作流（子 agent）方案（2026-11-03）

> 素材：`D:\deepwrite-main`（DeepWrite 桌面端 v1.7.4，Electron＋Vue3，pnpm monorepo）磁盘源码与 `docs/*.md` 设计文档；我们侧现状以 `D:\Pinax-main\Pinax-main\next/**` 磁盘工作树为唯一凭据（批次 42→76 未入库）。窄屏适配本轮**不做**（作者 2026-11-03 令）。
> 口径：**只逆向规格，不逐细节一一对应**；三块核心（输入区／消息操作件／消息内可视化）给到"能开工"的密度，特色功能（工作流＋子 agent＋验收 skill）给到数据结构与门禁接法。本文件不动代码。

## 结论先行（八条）

1. **我们的对话框目前只有骨架没有肉**：正文是纯文本插值（`next/shell/AssistantDialog.vue:411` 用 `{{ message.text }}`＋`white-space:pre-wrap`，`mdRender.mjs` 只在 `CarrierPaneHost.vue:3` 用），消息级操作件全壳只有 1 枚「重试」（`:408`），复制／分支／token／停止**全查无**；工具调用不渲染，只在 footer 列名（`:448-453`）。
2. **DeepWrite 的输入区规格可以几乎整套搬**：`/`技能、`@`素材、`#`组员共用一个 typeahead 解析器（`apps/desktop/src/renderer/src/utils/composerReferences.ts:4`＋`useConversationComposer.ts:58-62`），**技能只往输入里插一个名字 token，正文由运行时 `load_skill` 按名加载**（`packages/pi-runtime-adapter/src/short-agent-tools/catalog-tools.ts:54`）——这条和我们已有的 `pinax_skill_read`（`next/runtime/skillTools.mjs:12`）是同一套机制，接得上，不用改运行时。
3. **DeepWrite 的消息操作条很克制（3 枚），但它没有我们要的"分支"**：它只有编辑重发（破坏性截断，`send-entrypoints.ts:64`→`send-message.ts:139`）、复制、审批卡展开；`parentId` 只服务于双端同步、UI 不呈现分叉（`packages/contracts/src/device-sync/conversation/schemas.ts:163-166`）。**分支这块我们只能自己设计**，抄不到。
4. **消息内可视化是它最强的部分，值得照抄骨架**：一条助手消息＝「处理时间线＋正文＋审批卡栈」，时间线只有 5 类原子块（thinking／response／tool／subagent／work-group），折叠用原生 `<details>`＋**会话级内存 Map 记展开态**（`renderer/src/composables/conversationDisclosureState.ts:29-37`），图标**不按工具名字典分配而是按名字正则归 5 类**（`conversationToolStatus.ts:132-161`），58 条工具名只维护中文文案与四态。
5. **它的"子智能体抽卡"正好是你推的工作流形态的现成 UI**：同一任务后台跑 2–10 次（缺省 3，`packages/contracts/src/subagent-settings.ts:91-93`），候选＋评估助手压成一张卡，人工选择＝tab 条＋数字键 1–0＋并排两栏对比＋附言（`renderer/src/components/SubagentDrawPickerCard.vue:75-100,177-205`），状态机 `phase: selecting|evaluating|selected|rejected|failed`、`selectedBy: user|evaluator|only-success`（`packages/contracts/src/session/subagent.ts:163-216`）。
6. **我们这边子 agent 是零**：`next/runtime/runnerAdvisor.mjs:29` 自陈"这条 in-process 链上没有子代理、没有 hook、也没有流式 token"；唯一的半成品是会话存储里预留但**无写入方**的 `parent` 字段（`next/sessionStore.mjs:79,95`），而且现有测试**反向钉死** `stage:'subagent'` 必须被丢（`next/tests/agent-sessions.test.mjs:272-273`／`:339`、`trail-tool-events.test.mjs:91`）——做这件事要先反转这三条判据，不是静默改。
7. **文笔／禁用词／去 AI 味这一档，我们提交链路上一个闸都没有**：现有闸只管落不落盘（`next/runtime/writePolicy.mjs:163-196`＋`kernelWriteGuard.mjs`），`acceptance.mjs:272-283` 是 M2 写族闸；相近的三处（`shared/writingSkillMethodContract.js:106`、`server/services/localMirrorService.js:100`、`shared/structuredSettingContract.js:52`）都不在链路上。按你既有的主张（**门禁必须接在提交链路上**），验收 skill 必须接在 `adoptProposal`／写盘那一步，不能做成一个独立 CLI。
8. **可复用的地基比预期好**：`createWritingComplete({ complete = forwardComplete })`（`next/runtime/writingComplete.mjs:27-33`）已经是一条"干净上下文单发补全"通道且返回值自带 `usage`（`:94`）——子 agent 的"每路一次独立调用"直接用它，不必新造模型面；上下文组装 `buildRuntimeEnvelope`（`next/runtime/contextProfiles.mjs`）可以按需裁剪成"只给这一段的素材"。

## 一、输入区规格（对标第一块）

### DeepWrite 的事实

组件本体 `ConversationComposer.vue:452`（textarea）／`:486`（工具条）／`:564`（发送）／`:574`（停止），样式 `styles/conversation-composer.css:415-429`（`field-sizing:content`，min 53／max 150px，内容列 760px 居中）。快捷键只有 Enter 发送／Shift+Enter 换行（`useConversationComposer.ts:288`，**尊重 `isComposing`**）与菜单四键（`:262-286`），无自定义改键。切换器：模型／思考档／温度／联网收进**一个 trigger 的分页弹层**（`ConversationModelConfigSelect.vue:286-453`），agent 模式＝标准／团队两档（`AgentTeamModeSelect.vue:78-90`），书与段位＝输入框上方的胶囊条（`ComposerContextBar.vue:55-101`），偏好按 `book:<id>`／`library:<domain>:<id>` 作用域存 localStorage（`utils/agentRunPreferences.ts:9-44`）。技能列举＝本书绑定的技能或库代理技能（`useShortConversationCoordinator.ts:347-363`），"风格"不是一个独立开关，而是技能库里的一个 kind（`utilities/folder-catalog-store/library-entries.ts:833` `style:"风格"`）。

### 我们现状

`AssistantDialog.vue`：textarea `:456-467`（rows=1、max-height 160px）、发送钮 1 枚 `:509-519`、**停止钮查无**、工具条只有「会话」＋「模式徽标」两枚（`:316-331`）、slash 4 条（`next/shell/slashCommands.mjs:22-51`，只有 `/大纲` 绑了 skill）、@ 引用 4 类上限 4×600 字（`next/shell/agentReferences.mjs:21-27`）、**附件查无**、全局快捷键仅 3 条（`next/shell/hotkeys.mjs:72-83`）。模式三档词表齐（`next/shell/agentSessions.mjs:291` `review|auto|blocked`）但 **UI 只给两档入口**，`blocked` 没有可点路径。IME 组字保护已有（`:133`）。

### 改法（批次77 任务1）

1. **一个 typeahead 吃三类引用**：`/` 技能、`@` 素材、`#` 工作流角色，替换现有两套并行提示（slash 与 ref 各自一套键盘逻辑，`:135-169`）。选中技能＝**只插 `／技能名` 文本**，运行时用 `pinax_skill_read` 按名取正文——与 DeepWrite 同构，且让"技能注入"这件事不长在对话框里。
2. **发送区补两枚**：停止钮（要新 IPC 通道，见「待裁 3」）＋模型/档位合并弹层（把现在散在 `RuntimeDock` 的模型选择收进一枚 trigger，工具条不膨胀）。
3. **模式徽标补第三档**：`blocked` 上 UI（纯前端，三值轮播＋就地说明），auto 的二次确认口径不动（`:376-380`）。
4. **快捷键白名单扩到 6 条并走既有 `hotkeys.mjs` 持久化**：唤起对话／发送／停止／切模式／唤起技能菜单／提案审阅（`menus.mjs:15-68` 是词表源）。不做用户自定义改键（DeepWrite 也没有，收益低）。
5. 输入法口径：沿用 `isComposing`，另外补 `keyCode === 229` 兜底（老前端 8 处都这么写，`src/components/authoring/AuthoringBlockComposer.vue:202` 等）。

## 二、消息操作件规格（对标第二块）

### DeepWrite 的事实

常驻极小一行，`opacity:0` ＋ `.message:hover／:focus-within` 显形、140ms 过渡、`min-height:28px` 预留不跳版（`styles.css:1921-1942`）；按钮 3 枚（编辑重发／复制／审批卡展开，`ConversationMessageItem.vue:237-292`），复制走 `navigator.clipboard`＋图标变 check 1.5s＋aria-label 同步变「已复制」（`:109-123`）；时间戳＝绝对本地时间、分钟精度、无 hover 全文（`:96-103`）；**token 不落消息行**——`usage` 由 `run.completed` 事件带（`packages/contracts/src/agent-usage.ts:3-10`，五档 input/output/cacheRead/cacheWrite/total），UI 只在会话级圆环指示器取"最近同模型那条"（`ContextWindowIndicator.vue:27-60`＋`utils/contextWindowUsage.ts:16-97`）；耗时用纯函数 label 工厂（`conversationToolPresentation.ts:315-342`）。元数据"存而不显"（`runtime/usage/retry` 全量落库，UI 只读一处）是它的设计取向。

### 我们现状

消息字段表（`next/shell/agentSessions.mjs:331-342`）：`id/role/text/findings/actions/notes/command/trail/failed/at`——**无 `runId`、无 `usage`、无 `status`**，错误态只有 `failed:boolean`＋trail 里一段 `{stage:'failed',code,atStage}`。落盘是 `.pinax/sessions/<id>.jsonl` 五种行型（`next/sessionStore.mjs:37-39,212`），墓碑与整份原子重写已就绪（`:391-409`／`:423`）。

### 改法（批次77 任务2）

1. **一行常驻元信息＋hover 显形动作条**（抄它的 CSS 口径，`min-height` 预留）：常驻＝时间戳（到分）＋本轮状态（streaming／stopped／error／已完成）；hover／focus-within 显形＝**复制／编辑重发／重新生成／分支／定位到正文／展开过程**六枚，全用原生 `<button>`＋`aria-label`。
2. **token 用量两处显示**：会话级圆环（总量＋上下文占用百分比）照抄；**消息行内加一枚轻量 chip**（`hover 才可见`）——你要的是"每条消息看 token"，DeepWrite 不给这一层，我们给它补上。数据源已现成：`writingComplete` 返回值里已有 `usage`（`next/runtime/writingComplete.mjs:94`），`toolLoop` 侧要把它随事件带出来（见「待裁 3」的同一批 IPC 改动）。
3. **分支必须自己设计**（它没有）：会话记录已有的 `parent` 预留位升级为真消息树——每条 assistant 消息可挂 `parentId`＋`branchIndex/branchCount`，消息行右侧给「‹ 2/3 ›」切换器，落盘走 `.pinax/sessions/*.jsonl` 追加式（不整份重写），墓碑口径不变（`sessionStore.mjs:391-409`）。这是本批最贵的一件，**建议单列为批次77.5**，先做复制／编辑重发／重新生成三枚（三枚都不需要动 schema）。
4. 编辑重发的安全性抄它：重写前校验原文／角色／时间戳（`prepareConversationMessageRewrite`，`renderer/src/composables/agent-conversation/history-rewrite.ts:18-43`），避免竞态下把已漂移的消息覆盖回去。

## 三、消息内可视化规格（对标第三块）

### DeepWrite 的事实

- **折叠机制**：`<details>`＋会话级 reactive Map（key＝层级路径 JSON），缺省全收起，**只在内存不持久化**；流中不折叠、平铺并在顶部吸一条状态行（`conversation-messages.css:60-71`），结束后整体换成「已处理 N 秒」一条 summary（`ConversationProcessingTimeline.vue:102-114`）。
- **工具行**：图标按名字正则归 5 类（folder/terminal/file/globe/sparkles），**写入类不显示图标**、直接内联预览写入内容与字数（`ConversationProcessingItem.vue:122-126`）；文案＝动作词×四态（preparing／running／completed／error，`:169-247`）；摘要行按优先级取 args／resultSummary（`:271-312`），3000 字截断加省略号、无分页；**连续只读工具自动并成一组**，N 行压成 1 行（`conversationToolPresentation.ts:236-250`）。
- **子 agent 卡**：`SubagentRunCard.vue:59-119`（状态胶囊／耗时／等待依赖／重试 n/m／N 个工具／tokens／待审条数）＋`SubagentRunDetail.vue:41-99`（展开＝它自己的 processingSteps，即独立上下文）＋批量摘要行「N 个子任务 · x 运行中 · y 排队 · z 已结束」；并发上限 5（`packages/contracts/src/agent-team.ts:33`）。
- **抽卡**：见结论 5。
- **看板**：不在消息流里，是独立面板（`extras/agent-team-marketplace`? 实为 `X\DecompositionSubtaskBoard.vue:109-174`）＝主控状态胶囊＋分段筛选（全部/运行中/排队/待分派/已结束带计数）＋**CSS grid 行表（不用 `<table>`，理由在设计文档 `docs/整书拆解子任务看板设计.md:204`）**；数据源是内存 tracker（`subagentRunTracker.ts`），**重启不可回看**（这是它的缺口，我们不抄）。
- **提案／diff**：行内 unified diff（非并排），每行 4 列网格（旧行号 42px／新行号 42px／标记 20px／code），底色 success 11%／danger mix（`AgentEditProposalDiff.vue:33-61`＋`conversation-proposals.css:260-310`）；四动作接受／拒绝／丢弃／定位；运行中编辑正文不丢流＝把审批卡锚进实时时间线原位，冲突标 `staleBase`＋「保留我的／用智能体版本覆盖」（`docs/智能体运行中编辑正文设计.md:74-107`）。
- **防闪烁**：**不做整行虚拟**（为了保住原生全文查找与跨消息选区，`docs/Agent对话性能优化方案.md:223`），改为 ≥512 条才按 16 条一组打 `content-visibility:auto`＋`contain-intrinsic-block-size`；流式 delta 先入 pending 再 rAF 合帧（`streaming.ts:82-138`）、markdown 60ms 定频（`streamingMarkdownScheduler.ts:1-2`）、display item 按 id 复用旧对象、**上滚即永久解锁本轮尾部跟随**、字号重排后 3 帧修位、>10 万字正文降级纯文本节点。

### 我们现状

只有「过程」一段折叠（`AssistantDialog.vue:429-437`），行由 `describeTrailEvent` 生成（阶段名＋关键数字，`agentSessions.mjs:224`）；轨迹白名单其实是 **12 段**（`agentSessions.mjs:40-55`，上限 32 条 `:38`）——`tool-start`／`tool-end`／`tool-denied`／`tool-dropped`／`tool-unknown` 五段**早就在里面**，`describeTrailEvent` 也已经能给它们生成中文 label 与 detail（含每次调用的 `ms`，`:245-252`），只是那行注释仍写「五种阶段」（M2.5-A 扩段后没跟着改，属陈旧注释）。**所以工具可视化缺的是渲染层（图标、四态、并组、参数与结果可展开），不是数据管道**。思维链与提案卡确实没有。

### 改法（批次77 任务3）

1. **对话框正文接 `mdRender`**（一行事，收益最大）：助手消息从 `{{ message.text }}` 换成既有 Markdown 渲染，与 `CarrierPaneHost` 同一口径。
2. **处理时间线组件**（新 `next/shell/ConversationTimeline.vue`）：5 类块×四态，折叠状态放**会话级内存 Map**（不新增落盘字段，避免与批次75 的 schema 议题撞车）；图标走 kind 正则归 5 类而不是 N 条字面量表；只读工具连续出现自动并组。
3. **轨迹只补两段**：`TRAIL_STAGES`（`agentSessions.mjs:40-55`）现有 12 段里已含 `tool-*` 五段，本批只加 `subagent` 与 `workflow-step`——**注意 `agent-sessions.test.mjs:272`／`:339` 与 `trail-tool-events.test.mjs:91` 现在反向钉死 `stage:'subagent'` 必须为 null（注释理由：链上没有子代理就不许造假事件，这是对的），扩段即判据反转，须改断言并写理由、连那行「五种阶段」的陈旧注释一起订正，不许静默**（批次76 §7.4 同一纪律）。
4. **提案卡进对话流**：结构化 diff（行内 unified，四列网格）＋接受／拒绝／定位三动作，动作仍走既有 `adoptProposal`（`next/shell/useBoardData.mjs:1328`）与 proposals 链路（`toolLoop.mjs:209-223`→`writePolicy.mjs:184`→`proposalStore.mjs:99`→`.pinax/proposals/`→`proposals-changed`→`useBoardData.mjs:1328`），**不新增第二套落盘路径**。
5. **防闪烁抄三条最便宜的**：rAF 合帧＋markdown 定频＋上滚即解锁尾部跟随；`content-visibility` 分组那条**暂不做**（它的前提是保住原生全文查找，我们现在消息量也远不到 512 条阈值，白付复杂度）。

## 四、必需项 A：技能管理（做得好用才算数）

现状：运行时已经能装载与读取（`next/skills/**` 5 包，`next/skills/loadSkills.mjs:101-152` frontmatter 校验、`:188-196` 工具不在面上就整包不装；渐进披露 `runnerAdvisor.mjs:87-101` 系统提示只给名＋一句；`.build/skills` 双落点由 m/m2/m3 三闸守着，`bundleAssertions.mjs:242/252/260`），但**UI 上唯一入口是 slash 硬绑那 1 条**，技能列表／新建／导入／停用全查无（`settings/` 目录与 CommandPalette grep skill=0）。

设计（批次77 任务4）：

1. **设置里新增「技能库」一节**（`next/shell/settings/SkillsSection.vue`，走既有 settings 面与目录搜索同进同退口径）：列举全部技能（名／一句描述／适用任务域／绑定的工具是否都在面上／当前是否装载），每条给「启停」「查看正文」「在本项目启用」三个动作；装载失败的原因**就地显示**（现在 `:188-196` 是静默不装，作者看不见）。
2. **技能选择进 `/` 菜单并按任务域排序**：`/` 后面的清单不再只有 4 条 slash 命令，而是「本项目可用技能 ＋ 命令」，按任务域分组（编剧／正文写作／世界书整理／审阅验收）——任务域落在技能 frontmatter 新增字段 `domain: [...]`（**这是新增字段，需要作者点头，见待裁 1**；不加则退化成"按名字前缀猜"）。
3. **风格＝技能的一个 kind**，不是独立开关：`kind: style` 的技能（江南／烽火／去 AI 味…）在 `/` 菜单里单列一组「风格」，选中即 `pinax_skill_read` 取正文；同一任务域可绑默认风格（存 per-project 偏好，不写死）。
4. **导入／导出走包目录**：技能目录就是 `.pinax/skills/`（项目级）＋内置 `next/skills/`（产品级），导入＝拷贝目录＋跑一遍 frontmatter 校验并把不合格的具体原因列出来（**拒装是正常态，不假装成功**——批次37 那条"空框架 4 技能拒装"的既有事实）。

## 五、必需项 B：写作工作流（主 agent 框架 → 子 agent 文笔 → 验收 skill）

这是本轮唯一要新增运行时能力的地方。设计成"三层各有一张纸"，前端只呈现这三张纸：

**第一层 · 任务书（主 agent 产出，结构化）**
新模块 `next/runtime/writingWorkflow.mjs`。主 agent 不写正文，只产出一份 JSON 任务书并落 `.pinax/workflow/<runId>.json`：
`{ runId, goal, segments: [{ id, 目标, 视角/人物, 起止情绪, 节拍（起-压-转-落）, 字数档, canon锚点: [条目path|章节锚], 禁则: [...], 风格技能: [名] }], 验收: { 规则技能: [名], 禁用词表: 名 } }`
落点天然接我们已有资产：节拍与 `segments` 对应大纲载体（outline 节点），`canon锚点` 对应世界书条目 path（`openEntry` 同一套寻址），`禁则` 对应条目的 `taboos`（`shared/structuredSettingContract.js:52` 是既有的条目型数据面，不是闸）。任务书在对话里渲染成**可编辑的段落卡列表**（每卡可改目标／字数档／风格技能），确认后才扇出。

**第二层 · 扇出（子 agent，干净上下文）**
每段一次 `createWritingComplete` 形态的独立调用（复用 `next/runtime/writingComplete.mjs:27-33` 那条 `forwardComplete` 通道），**上下文＝该段任务书＋白名单素材，不带上主对话历史**——这就是"干净上下文"的实现口径（关键：`buildRuntimeEnvelope` 要能被"按锚点裁剪"调用，而不是整本书信封）。候选数与并发数是**两条要人裁的数值线**（DeepWrite 缺省 3／上限 10、并发上限 5；本机 RAM 31.8GB／pagefile 0，模型面是外呼，我建议缺省 3／并发 2，但**不自设为闸**，见待裁 2）。每路子 agent 落一条 `subagent` 轨迹段＋一份 `.pinax/workflow/<runId>/candidates/<segmentId>-<n>.md`。

**第三层 · 验收 skill（闸在提交链路上）**
新纯函数模块 `next/runtime/writingAcceptance.mjs`：输入候选文本＋任务书验收节，输出 `{通过|不通过, 命中项: [{类别: 禁用词|AI腔句式|节拍偏离, 位置, 原文, 建议}]}`，规则来源是技能包（`kind: acceptance`）＋项目内一份可编辑的禁用词表 `.pinax/lexicon/*.json`。
**接法（这条最重要）**：闸挂在 `adoptProposal`／写盘那一步（`next/shell/useBoardData.mjs:1328` → proposals→落盘链路），不通过＝**不落盘**，只把命中项渲染成审阅卡；不是再来一个独立 CLI 或一份文档条款（你既有主张：独立 CLI 不算门禁）。
**边界**：命中"禁用词"是确定性的词表匹配，可以当拒写；"AI 腔／文笔"这类是模型判断，**只标记不拒写**，且不许自设分数阈值当隐形闸（同你 2026-10 的裁令）。

**前端呈现**：对话流里一条助手消息长出「任务书卡 → 每段 N 张候选卡（带 token／耗时／验收结论）→ 选定后 1 张提案卡」；右侧一块「写作流水线」pane 当看板（状态胶囊＋分段筛选＋CSS grid 行表），**但数据源落盘**（不抄 DeepWrite 的内存 tracker——它重启就不可回看，这是缺陷）。抽卡的选择交互（tab＋数字键＋并排对比＋附言）照抄，理由正文照抄。

## 六、下轮实测：Toonflow／ComfyUI 原生嵌入

今天探到的事实（读盘＋探端口，未改任何文件）：Toonflow 在 `D:\toonflow`，`http://127.0.0.1:3010` **在跑且回 200 text/html**；ComfyUI `http://127.0.0.1:8188` **在跑（aiohttp／Python 3.12）回 200**；**两者都不发 `X-Frame-Options`，也没有 CSP `frame-ancestors`** → 可以被 iframe 承载。我们侧：CSP 已放行 `frame-src 'self' pinax-plugin: http://127.0.0.1:* http://localhost:*`（`next/shell/index.html:13`），回环双闸在 `carrierManifest.mjs:586`＋`ExternalAppHost.vue:31`，Toonflow 已有一块 pane（`next/carriers/comic/manifest.mjs:61` `comic.canvas`，url `:3010`），**ComfyUI 只有 MCP 只读桥（`carriers/comic/AGENT.md:32-35`），没有 iframe 承载位**。

下轮（批次79）摸底清单：给 comic 板加一块 `comic.engine`（url `http://127.0.0.1:8188`）与 ComfyUI 的 pane；逐屏实测**能不能点**（iframe 内快捷键会不会被外壳抢走——外壳有全局 keydown 总线，批次76 已踩过同节点监听器的坑）、滚轮与拖节点、ComfyUI 的 WebSocket 是否同回环 origin 可连、外壳明暗主题与内嵌页冲突、首屏耗时与内存占用、Toonflow 的深链（能不能带项目/节点定位过去）、以及"端口没起时"的空态文案（现在只有 iframe，不探活就是白屏）。**只摸底不改协议**，实测出问题时再定改法。

## 七、批次拆分与建议顺序

| 批 | 内容 | 主要面 | 需真窗实测 | 前置裁定 |
|---|---|---|---|---|
| **77** | 对话前端对标三块＋技能库 UI：typeahead 合一、停止钮、模式三档、消息操作条＋token chip、mdRender 接入、处理时间线（5 类块／图标按 kind／只读并组）、提案卡进对话流、防闪烁三件套 | `next/shell/AssistantDialog.vue`＋新组件＋`agentSessions.mjs` 扩段＋`settings/SkillsSection.vue` | 是（消息流视觉，截图不可省） | 待裁 1（domain 字段） |
| **77.5** | 分支（消息树＋切换器＋追加式落盘）——DeepWrite 无 UI 可抄，自建 | `next/sessionStore.mjs`（`parent` 转正）＋对话流 | 是 | 待裁 4（要不要真分支） |
| **78** | 写作工作流：任务书／扇出／验收闸＋流水线看板＋抽卡 UI | 新 `writingWorkflow.mjs`／`writingAcceptance.mjs`／workflow pane／IPC 扩段 | 是（要真模型跑《大梦》一段） | 待裁 2（缺省候选数／并发）＋待裁 5（禁用词表是否当拒写） |
| **79** | Toonflow／ComfyUI 原生嵌入摸底 | `comic/manifest.mjs` 加 pane＋空态与探活 | 是（本质就是实测批） | 无（摸底不动协议） |

推进顺序 **77 → 78 → 79 → 77.5**：77 把"看得见的假"先修掉（纯文本消息是当前最扎眼的），78 是产品特色、依赖 77 的时间线渲染才能显示子 agent；79 只摸底、成本最低可以插队；77.5 最贵且抄不到，放最后。

## 八、待裁定（2026-11-03 作者已裁四条，剩三条）

1. ~~技能要不要新增 `domain` 字段~~ → **已裁：加**（编剧／正文写作／世界书整理／审阅验收四类，落 `loadSkills.mjs:101-152` 校验，缺字段向后兼容归「未分域」）。
2. **扇出缺省候选数与并发数**（仍待裁，批次78 用）：DeepWrite 是 3／上限 10、并发上限 5。本机 RAM 31.8GB 且 pagefile 实测 0，模型面是外呼（不吃本机显存），我倾向**缺省 3／并发 2**；一旦当闸用就属"人裁留名"的数值线，请点名。
3. **停止／abort 通道**：现在整条链没有中断口（`RuntimeDock`／`ipcContract` grep abort 零命中）。新增 IPC 段牵 `ipcContract.mjs` 白名单与轨迹段——批次77 工单里我按"做"来写（长任务不可中断在写作场景很伤），上游 fetch 的中途掐断留边界。若你认为该先只做前端置灰，说一声我改单。
4. ~~要不要真分支~~ → **已裁：做，含在批次77**（DeepWrite 无 UI 可抄，自建消息树＋追加式落盘）。
5. ~~验收 skill 的拒写口径~~ → **已裁：禁用词命中＝拒落盘；AI 腔／文笔＝只标记不拒写**，闸接在 `adoptProposal`→写盘那一步（批次78）。
6. **禁用词表放哪、谁维护**：建议 `.pinax/lexicon/*.json`（项目级、作者可编辑、可多份）；不做产品级内置词表（避免我们替作者定义"禁词"）。
7. **批次75 与 78 的撞车**：75 要升 workspace v4，78 要新增 `.pinax/workflow/**`——两条都要动项目内目录约定，开工前先定"谁先定形"。

**开工单已落**：[批次77 工单](./pinax-electron-next-m2-batch77-ticket-20261103.md)（六任务＋守卫⑥–⑪，基线 44/748/206/lint 0/renderer 1191.2 kB/外壳 1988.4 kB）。批次78（工作流＋子 agent＋验收闸）与批次79（Toonflow／ComfyUI 嵌入摸底）待 77 收口后开单。

## 九、证据与复量口径

DeepWrite 侧关键文件（相对 `D:\deepwrite-main`，均已逐个开过核实行号）：`apps/desktop/src/renderer/src/components/{ConversationComposer,ConversationMessageItem,ConversationProcessingTimeline,ConversationProcessingItem,SubagentRunCard,SubagentDrawGroup,SubagentDrawPickerCard,SubagentDrawCompareDialog,ContextWindowIndicator,conversationToolStatus}.vue|.ts`（注意 `conversationToolStatus.ts` 在 `components/` 不在 `utils/`）、`apps/desktop/src/renderer/src/composables/useConversationComposer.ts`、`.../composables/conversationDisclosureState.ts`、`.../composables/agent-conversation/{streaming,send-entrypoints,history-rewrite}.ts`、`.../composables/useConversationContentGroups.ts`（组 16 条／阈值 512）、`apps/desktop/src/renderer/src/utils/{composerReferences,conversationToolPresentation,subagentRunPresentation,contextWindowUsage,agentTeamMemberReferences}.ts`、`packages/contracts/src/{agent-usage,subagent-settings,agent-team,workspace}.ts`、`packages/contracts/src/session/subagent.ts`、`packages/pi-runtime-adapter/src/short-agent-tools/catalog-tools.ts`、`apps/desktop/src/utilities/conversation-storage/schema.ts`、`apps/desktop/src/renderer/src/styles.css:1921-1960`（操作条 hover／focus-within）、`docs/{子智能体抽卡模式设计,整书拆解子任务看板设计,智能体运行中编辑正文设计,Agent对话性能优化方案,context-compaction,双端同步对话记录计划,素材库与技能库导出导入设计}.md`。

我们侧关键落点：`next/shell/AssistantDialog.vue:125-185`（键盘）／`:316-331`（工具条）／`:408`（唯一动作钮）／`:411`（纯文本）／`:429-453`（折叠与工具面）／`:456-467`（textarea）／`:509-519`（发送钮）；`next/shell/{slashCommands,agentReferences,hotkeys,menus,mdRender}.mjs`；`next/shell/agentSessions.mjs:41-55`（轨迹白名单）／`:224`／`:291`（模式词表）／`:331-342`（消息字段表）；`next/sessionStore.mjs:37-39`／`:79`／`:95`／`:212`／`:391-409`；`next/skills/loadSkills.mjs:101-152`／`:188-196`；`next/runtime/{skillTools,runnerAdvisor,toolLoop,writePolicy,writingComplete,contextProfiles}.mjs`；`next/shell/useBoardData.mjs:1328`（adoptProposal）；`next/shell/ExternalAppHost.vue:31/52/79-88`；`next/carriers/comic/manifest.mjs:61`；`next/shell/index.html:13`（CSP）。

复量：`curl -sI http://127.0.0.1:3010/`、`curl -sI http://127.0.0.1:8188/`（今天都 200 且无 `X-Frame-Options`／`frame-ancestors`）；`node next/testing/acceptance.mjs`；`npm run verify:next`（基线以开工现跑为准，本文件成文时上一轮收口读数为 44/748/206/lint 0/renderer 1191.2 kB/外壳 bundle 1988.4 kB——批次77 的新组件要盯这条线）。
