# 批次77 工单：对话面按 DeepWrite 规格重建（输入区／消息操作件／消息内可视化／技能库／真分支）（2026-11-03）

> 规格来源：[Agent 对话前端规格：对标 DeepWrite 逆向](./pinax-next-agent-chat-spec-vs-deepwrite-20261103.md)（下称「规格账」）。作者 2026-11-03 四裁：**①按 77→78→79 走；②技能加 `domain` 字段；③验收闸＝禁用词拒写＋AI 腔只标记（78 用）；④分支一起做，77 里含真消息树**。窄屏适配本轮**不做**（作者明令）。
> 基线：**开工前现跑的 `npm run verify:next` 为 44/44 · node --test 748 · vitest 206（14 文件）· eslint 0 · renderer js 1191.2 kB · 外壳 bundle 1988.4 kB**（批次76 收口那一次，工作树自后未变代码）。读数只许增不许减；体积线沿用既有口径（外壳 bundle < 2.5 MB、renderer 无硬闸**不自设新线**）。
> git：HEAD `36b0fe2`，批次 42→76 全在工作树未入库；**本批不执行 git、不 commit、不 push**。

## 作者裁定（验收判据来源）

- 输入区要"顺手"：快捷键、快捷切换、agent、**skill／风格切换**都在输入框附近，且能"从编剧／写作／世界书整理多项工作里调对 skill"——这条是**必需项**。
- 每条消息后面要有：**复制、分支、时间戳、token 用量**。
- 消息内可视化要有：**子 agent、workflow、各种工具的图标、可折叠思维链**（子 agent 与 workflow 的实际产生归批次78，本批先把"长出来有地方放"做完）。

## 任务（六条，按依赖排序）

### 任务1　对话正文接 Markdown

现状：助手消息是 `{{ message.text }}`＋`white-space:pre-wrap`（`next/shell/AssistantDialog.vue:411`／`:550`），而 `next/shell/mdRender.mjs` 已在 `CarrierPaneHost.vue:3` 与 `EntryDetailPanel.vue:3` 用着。

1. 助手消息正文改走 `mdRender`，**用户消息保持纯文本**（用户输入里有 Markdown 语法时不许被格式化吃掉）。
2. 双链／蓝链在对话里**暂不接线**（批次44 的"蓝链必须点得动"口径：点不动的就不进词表），先只做 Markdown。
3. XSS 口径沿用 `mdRender.mjs` 现有转义，不新增 `v-html` 直插；若必须 `v-html`，要加一条"渲染前转义"的断言用例（批次44 踩过 `v-html` 不重渲染留旧锚点的坑）。

**验收**：新增一条 vitest 用例：助手消息含 `**粗体**`／列表／代码块时 DOM 出 `<strong>`／`<ul>`／`<code>`，同一用例钉"用户消息里的 `**x**` 原样是文本"。

### 任务2　消息操作件＋元信息（含 token 链路补齐）

**先补数据再画 UI**（不许用估算冒充 token）：`ask` 链今天不带 usage——`next/runtime/runnerAdvisor.mjs:168-176` 的返回里没有 `usage`，而网关 `server/services/kitModelGateway.js:225` 已经把 `inputTokens/outputTokens/totalTokens` 归一化好了。三处补齐：runnerAdvisor 透传 → `next/shell/main.mjs:790` 的 push／返回 → `next/shell/agentSessions.mjs` 的消息字段白名单。

1. 消息 schema 新增三格（`agentSessions.mjs:331-342` 的 `sanitizeMessage` 白名单里加，**整份形状用例外钉住**，沿用批次76 `workspace.test.mjs:106` 那条纪律）：`runId`、`usage:{input,output,total}`、`status:'streaming|completed|stopped|error'`（现有 `failed:boolean` 保留兼容，读出时 `status ?? (failed?'error':'completed')`）。
2. 常驻元信息一行＝时间戳（到分，已有 `:404`）＋本轮状态；**动作条 hover／focus-within 显形**（抄 `styles.css:1921-1942` 口径：`opacity:0`＋`:hover`／`:focus-within` 显形＋`min-height:28px` 预留不跳版）：
   **复制**（`navigator.clipboard`＋图标变 check 1.5s＋`aria-label` 同步变「已复制」）、**编辑重发**（回填输入框并截断该条之后的历史，带乐观失效保护：校验原文＋角色＋时间戳一致才允许）、**重新生成**（同一条用户消息重跑一轮）、**分支**（任务6）、**展开／折叠过程**（任务4）、**token chip**（`N in／M out`，hover 才可见；无 usage 时显示「本轮未回报用量」而不是 0）。
3. 会话级 token／上下文占用指示器放输入区右上（总量口径：取最近一条带 usage 的助手消息），数值**只记账不当闸**。

**验收**：复制／编辑重发／重新生成各一条用例（含"缺 usage 时不许显示 0"这条负断言）；`aria-label` 与 `title` 的中文口径进用例；快捷键 Enter 发送仍尊重 `isComposing`，并补 `keyCode === 229` 兜底（老前端 8 处同口径）。

### 任务3　输入区：typeahead 合一＋技能入口＋停止钮＋模式三档

1. **一个 typeahead 吃三类**：`/` 技能与命令、`@` 素材、`#` 工作流角色（78 才产角色清单，本批先出「暂无」空态，不留死钮）。合并现在两套并行键盘逻辑（`AssistantDialog.vue:135-169`），菜单头一行教键位（↑↓／Enter／Tab／Esc）。
   **技能选中＝只插 `／技能名` 文本 token**，正文由运行时 `pinax_skill_read`（`next/runtime/skillTools.mjs:12`）按名取——与 DeepWrite 同构，注入逻辑不长在对话框里。
2. **触发符判定加边界**（DeepWrite 那处 `lastIndexOf` 的已知坑，`composerReferences.ts:28-33`）：只有行首或空白后才认 `/`、`@`、`#`，避免中文正文中段误唤菜单。这条要有用例（输入「第3/章」不出菜单）。
3. **停止钮**：新增中断口。IPC 扩段 `runtimeAskAbort`（`ipcContract.mjs:43`/`:133` 同一命名族，白名单与测试同步），主进程侧按 `runId` 标记取消、在跑的一轮结束后不再续轮；渲染层点停止＝消息落 `status:'stopped'`＋trail 追加一条。上游 fetch 中途掐断**本批不做**（记边界）。
4. **模式徽标补第三档**：`blocked` 上可点路径（词表已有，`agentSessions.mjs:291`；UI 现在只判 review／auto，`AssistantDialog.vue:327`）。auto 的二次确认口径不动。
5. **快捷键白名单扩到 6 条**并走既有 `hotkeys.mjs` 持久化：唤起对话／发送／停止／切模式／唤起技能菜单／提案审阅（词表源 `menus.mjs:15-68`；**不做用户自定义改键**）。

**验收**：typeahead 三类各一条命中用例＋一条"中文正文不误触"负断言；技能项点击后草稿里是 `／技能名` 文本且 `payload.skill` 未被前端硬塞；停止钮用一条用例证明 `status:'stopped'` 能落进会话；blocked 档可点并被会话事件记下。

### 任务4　消息内可视化：处理时间线

新组件 `next/shell/ConversationTimeline.vue`，数据仍走现有 trail（`agentSessions.mjs:40-55` 的 12 段已含 `tool-*` 五段，`describeTrailEvent:224-252` 已能出中文 label＋`ms`——**缺的是渲染，不是管道**）。

1. 块型五类：`thinking`（本批先不产，留位并如实空态）／`response`／`tool`／`tool-group`／`subagent`（78 产）。图标**按名字正则归 5 类**（folder／terminal／file／globe／sparkles），不写 58 条字面量表；**写入类不显图标**、直接给"写入结果已生成／N 字"这一句。
2. 文案四态：preparing／running／completed／error（中文：等待执行／正在 X／已 X／X 失败），纯函数工厂出 label（抄它的"组件只负责摆"口径）。
3. **连续只读工具自动并成一组**，N 行压一行，组行显示「执行中／等待执行」＋计数。
4. 折叠：原生 `<details>` ＋ **会话级内存 Map**（key＝路径，缺省收起，**不落盘**，避免与批次75 的 schema 议题撞车）；流中平铺＋顶部一条状态行，结束后整体收合成「已处理 N 秒」（耗时用 `tool-end` 的 `ms` 累加＋首尾时间差，两个都要在，取时间差为准）。
5. 扩段：`TRAIL_STAGES` 加 `subagent`、`workflow-step`。**这是判据反转**——`next/tests/agent-sessions.test.mjs:272`／`:339` 与 `trail-tool-events.test.mjs:91` 现在反向钉死 `stage:'subagent'` 必须为 null（原注释理由"链上没有子代理就不许造假事件"是对的，77 之后前提变了）；改断言必须写理由，连 `agentSessions.mjs:40` 那行「只有这五种阶段」的陈旧注释一起订正，**不许静默**。

**验收**：新用例覆盖五类块渲染、只读并组、折叠默认收起＋展开态在会话内保留；扩段后两条原反向断言改判据且注释理由；图标按 kind 归类的纯函数单测（新工具名自动落类，不必改表）。

### 任务5　技能库设置面＋`domain` 字段（必需项）

1. `next/shell/settings/SkillsSection.vue`（新），进既有设置目录与搜索（沿用批次76 任务4-2 的"左目录与右栏同进同退"口径，关键词字段标签进词表）。每条技能给：**装载状态**（含 `loadSkills.mjs:188-196` 那种"工具不在面上整包不装"的**具体原因**，现在静默不装，作者看不见）、**启停**、**查看正文**、**适用任务域**。
2. `domain` 字段进 frontmatter：词表四类 `screenwriting`（编剧）／`prose`（正文写作）／`worldbook`（世界书整理）／`acceptance`（审阅验收），显示中文。校验加在 `next/skills/loadSkills.mjs:101-152`，**缺字段不报错**（向后兼容，归到「未分域」），非法值才报；内置 5 包各补 `domain`。**"风格"落在 `acceptance`／`prose` 里的 `kind: style` 标**（对标它的 `style:"风格"`），`/` 菜单把风格单列一组。
3. 启停真值存**项目内** `.pinax/skills.json`（沿用既有工程覆盖口思路，如 `carrierOverridesStore.mjs:30`），不写全局设置；关掉＝装载清单里剔除并在 `runnerAdvisor.mjs:87-101` 的渐进披露提示里消失（这条要有用例）。
4. 导入＝把目录拷进 `.pinax/skills/` 后跑一遍校验，不合格**逐条列原因**（拒装是正常态，不假装成功——批次37 的既有事实）；导出本批不做（记边界）。

**验收**：用例钉"缺 `domain` 仍能装载并进未分域"、"非法 `domain` 报明确原因"、"关掉技能后系统提示清单里不再有它"、"工具不在面上整包拒装时，设置面能看到原因"。

### 任务6　真分支（作者点头做，本批最重的一件）

DeepWrite 无可抄 UI（它只有破坏性的编辑重发，`parentId` 仅服务双端同步）。我们把它做成**真消息树**：

1. `next/sessionStore.mjs` 的 `parent` 预留位（`:79`／`:95`，今天**无任何写入方**）语义定为"会话的父会话"，本批不动它；消息级分叉新增 `branch:{parentId, index, count}` 落进消息行的白名单里。
2. **追加式落盘**：分叉不整份重写会话文件（现有 `rewriteSession:423` 是快照整份原子重写，tmp＋rename），分支的新消息走 append 行；墓碑口径不变（`tombstone:391-409`）。
3. UI：消息行右侧「‹ 2/3 ›」切换器（命中区 ≥24×24，走批次76 的度量闸口径）＋同层候选计数；切换只换"此刻看哪一支"，不改写任何一支的内容。
4. 与编辑重发的关系写清：**编辑重发＝截断当前支**（保留 DeepWrite 的乐观失效保护），**分支＝在截断前先存一支**（给用户退路），两个动作共用一次历史重写入口，不许长出第二套。

**验收**：用例覆盖"一条消息分两叉后两叉都在盘上且互不覆盖"、"切换器只改当前支指针"、"分叉后追加式写入不重写既有行"（读文件行数验证）、"墓碑后子会话 re-parent 不回归"（沿用既有断言）。

## 允许文件

`next/shell/AssistantDialog.vue`、`next/shell/RuntimeDock.vue`、`next/shell/ipcContract.mjs`、`next/shell/agentSessions.mjs`、`next/shell/main.mjs`（仅 usage／abort 两段透传）、`next/shell/mdRender.mjs`（只读校，若需转义补强再登记）、`next/shell/ConversationTimeline.vue`（新建）、`next/shell/settings/SkillsSection.vue`（新建）、`next/shell/SettingsModal.vue`（目录注册一节）、`next/shell/hotkeys.mjs`、`next/shell/menus.mjs`、`next/shell/slashCommands.mjs`、`next/shell/agentReferences.mjs`、`next/shell/styles/next-shell.css`、`next/runtime/runnerAdvisor.mjs`（仅 usage 透传＋技能启停读值）、`next/runtime/toolLoop.mjs`（仅 abort 标记位）、`next/skills/loadSkills.mjs`（frontmatter `domain`＋启停）、`next/skills/*/SKILL.md`（补 `domain`，不改正文）、`next/sessionStore.mjs`（分支字段＋追加式写入）、`next/tests/**`（含判据反转与新增）、`docs/plan/**`。

〔越界须先补登记再动手；本批预计需要追加的：若 `next/shell/useBoardData.mjs`（提案采纳）或 `next/carriers/**` 需要动，先在本节补一行写清理由。〕

**补登记（任务2 开工前，作者令「每批单独点头」指的是批次级，文件级越界按本节规则在此留名）**：

- `next/runtime/toolLoop.mjs`——工单原文只准「仅 abort 标记位」，实际还加了 **usage 累计**（新导出 `createUsageTally`／`absorbUsage`／`usageOf`，`run()` 的三个返回点各带一份 `usage`）。理由：token 是**逐轮**回报的，累计只能发生在轮次边界那一层；放到 `runnerAdvisor` 或渲染层就看不到每一轮，放到 `server/**` 是禁区。口径仍守纪律：只加真回报，一条都没回报时交 `null`（不是 0），不做任何字数换算。
- `next/runtime/toolTurn.mjs`——原列表未含此文件。加的一行是 `usage: result?.usage ?? null`（把 `kitModelGateway.js:225` 归一化过的那份原样交出来）。不改这一处，上面的累计永远拿到 null，屏上每一条回答都会写「本轮未回报用量」——那不是诚实，那是链路断在自家门口。
- `next/runtime/agentRuntime.mjs` 与 `next/shell/main.mjs` **未改**：前者本来就把 runner 返回值摊进 `value`（`...payload`），后者那段 IPC 是原样透传，usage 顺着既有形状流到屏上。这条不登记为越界，只在此说明「为什么没动它们」。

**补登记（任务4 开工前）**：

- `next/shell/conversationTimeline.mjs`（新建）——工单只列了 `next/shell/ConversationTimeline.vue`，但任务4 自己要求「纯函数工厂出 label」与「图标按 kind 归类的**纯函数单测**（新工具名自动落类，不必改表）」：纯函数放在 SFC 里就得靠 jsdom 才能测，且会把 `next/shell` 的既有习惯（`wikiLinks.mjs`／`entriesView.mjs`／`agentSessions.mjs` 这类纯模块＋薄组件）破掉。所以判定与归组留在 `.mjs`，`.vue` 只摆。
- `next/shell/agentSessions.mjs` 的轨迹事件多留一个 `at`（到达时刻，仅当上游/渲染层给了有限数才留）——任务4 第 4 条要「首尾时间差」，事件不带时刻就算不出时间差。这是白名单扩字段（不是扩沉默），落盘的仍是 JSON 安全整数；`sanitizeTrailEvent` 对没给 `at` 的输入形状一字不变，老断言不受影响。打点方在 `RuntimeDock.onAskEvent`（渲染层收到事件那一刻），语义是**外壳看到的首尾差**，不含主进程内部排队——这条口径在 §7 里如实写明，不当作端到端耗时。

**补登记（任务3 开工前）**：

- `next/shell/composerTypeahead.mjs`（新建）——工单只列了 `slashCommands.mjs`／`agentReferences.mjs`，但任务3 第 1 条要「**一个** typeahead 吃三类」＋第 2 条要「触发符判定加边界」且**这条要有用例**。把三类判定分散在 SFC 里就只能靠 jsdom 测边界，与任务4 已经立下的口径（判定进纯模块、组件只摆）相反。`slashCommands.mjs`／`agentReferences.mjs` 各自的数据与解析留在原文件（不搬、不 duplicat），新模块只做「光标前那一段算不算 token」＋「按触发符组菜单」＋「技能 token 的抽取与剔除」这三件纯事。
- `next/runtime/agentRuntime.mjs`——原列表未含。改动只有一处：`ask()` 把 `options.abort` 原样交给 runner（`{ ..., abort }`）。不加这一处，主进程那个「按 askId 标记取消」的登记表就永远传不到循环里，停止钮是枚假钮。不改判定、不改错误码、不动技能名解析那一段。
- `next/runtime/runnerAdvisor.mjs`——原列表写的是「仅 usage 透传＋技能启停读值」，本次再加 **abort 一路**：收下 `abort` 传给 `toolLoop.run`，并对循环回进来的 `kind:'stopped'` 如实办两件事——正文写「已按作者要求停止（第 N 轮后不再续轮）」而不是编一个回答，返回值带 `stopped: true` 让渲染层把消息落成 `status:'stopped'`。**没有循环那一条链（进程内 advisor 直答）不假装能停**：那条链观测不到这个标记，就不给返回值塞 stopped。
- `next/shell/agentSessions.mjs` 的 `TRAIL_STAGES` 加 `stopped`——任务3 第 3 条明写「trail 追加一条」，而这条**由主进程循环真发**（渲染层不代作者造事件）。白名单不扩，真事件到了只会被丢掉，那就退化成「屏上什么都没变」。同一条改动带 `sanitizeTrailEventBody` 的 `stopped` 分支（只留 `step` 这个真数）与 `describeTrailEvent` 的那一句中文；批次77 任务4 已订正过的「白名单是闸不是装饰」口径继续成立——`stopped-confirmed` 这类词表外的段型仍落 null。

〔以上四条是本批预计的第二批越界；`hotkeys.mjs`／`toolLoop.mjs`／`ipcContract.mjs`／`AssistantDialog.vue`／`RuntimeDock.vue` 都在原列表内。AppNext.vue **不动**——六条键位里四条落在对话框自己那块（宿主键位表经 props 递下去），「唤起对话」落点是组件内的文档级监听，不为一条键位去动壳层。〕

## 禁止边界

不动协议形态词表与 PANE／PAGE 状态轴语义；不动写族闸与 `writePolicy` 三档判定；不新增 npm 依赖；不自设数值阈值当隐形闸（命中区下限与体积线属既有规范口径；**token 数、上下文占用百分比、耗时只记账**）；`server/**` 与 `src/**` 不改（`kitModelGateway.js` 已给归一化 usage，够读）；子 agent／工作流的**产生逻辑**不在本批（批次78），本批只交付能放它的渲染面与 schema 位；**不 commit**；窄屏排布不动。

## 守卫标记

本批新守卫：**⑥正文渲染单一来源**（对话正文只走 `mdRender`，出现第二处 Markdown 拼装即红）；**⑦usage 缺失不许显 0**（负断言：无 usage 时 DOM 里不出现 `0 tokens`）；**⑧typeahead 必须有前导边界**（中文正文中段 `/`、`@`、`#` 不误触）；**⑨折叠态不落盘**（会话 JSONL 里不许出现 `expanded` 一类字段）；**⑩分支非破坏**（分叉写入后既有行逐字节不变，用行数＋首行内容双断言）；**⑪技能未装载必须可见原因**（拒装时设置面出具体原因，不许空态）。

## 验收判据

`npm run verify:next` 五段全绿且读数只增不减（基线见工单头）；守卫⑥–⑪各至少一条用例；`eslint` 0 问题；任务2／任务4／任务6 属界面变化，**实拍交调度方**（Electron＋CDP 口径仍等作者点头，见待裁定 5）；未真机复核的条目在 §7 如实标注。

## 记账指标（不进闸）

对话消息平均 trail 条数与并组后行数（前后对比）；token chip 覆盖率（多少比例助手消息真有 usage，取决于上游是否回报）；技能清单长度与 `/` 菜单滚不滚；分支深度分布；新增代码行与外壳 bundle 增量（对照 1988.4 kB 基线）；停止钮从按下到 `status:'stopped'` 落盘的实测毫秒数。

## §7 执行方回填 ／ §8 调度方验收

（执行后回填。）

### §7-1 任务1（对话正文接 Markdown）已落地

改动面只有 `next/shell/AssistantDialog.vue` 一个文件加两条用例：助手正文走 `mdRender.renderMarkdown`（与阅读面同一条函数，不在对话框里再拼一套），类名挂 `authoring-knowledge__markdown nx-rendered-md`，样式从老版 `AuthoringKnowledgeAssistant.vue:740-757` 整段搬进 `legacy-copied` 标记块（不新造裸 px 词汇，视觉门禁 ①–⑤ 一字未动就过了）。用户气泡**不**渲染 Markdown——作者打的 `**三件事**` 必须原样回显，复制回去才不变味，这条正反都钉了。

v-html 带进来的新风险是「点一下链接把整个外壳导航掉」：主进程只装了 `setWindowOpenHandler`（`next/shell/main.mjs:358`，新窗口转系统浏览器），**没有** `will-navigate`，同标签点 `<a>` 的默认行为就是整窗导航。处置是在对话框上拦默认＋走 `window.open(url,'_blank','noopener,noreferrer')`——正好落在既有 openExternal 通路上，**主进程零改动**。页内锚点与相对链接只拦不开窗。

守卫⑥（正文渲染单一来源）进 `next/tests/visual-contract.test.mjs`：扫 `next/shell` 全部 `.vue/.mjs`，出现 `v-html` 却没 import `mdRender.mjs` 即红；绕过它直接 import `marked`／`dompurify` 或调 `marked.parse(` 即红；正反两面还钉住「用户气泡里没有 v-html、必须是 `{{ message.text }}`」。

### §7-2 任务2（消息操作件＋元信息＋token 链路）已落地

**用量链路（本任务真正的硬活）**：`toolTurn.mjs` 交出单轮 `usage` → `toolLoop.mjs` 按轮累计（三个导出 `createUsageTally`／`absorbUsage`／`usageOf`，`run()` 三个返回点各带一份，步数耗尽那一档也照报——花了就是花了）→ `runnerAdvisor.mjs` 挂到返回值 → `agentRuntime` 既有 `...payload` 摊进 `value`（未改）→ IPC 原样透传（未改）→ `RuntimeDock` 存进会话 → 界面读 `message.usage`。全链在 `next/**` 内闭合，`server/**` 一个字节没动。

纪律落到代码上的样子：`absorbUsage` 只加**真回报**（非有限值／负数整块忽略；全 0 那一轮计轮次但不算「有回报」），一条都没回报时 `usageOf` 回 `null`；`sanitizeUsage` 同样只认安全整数，缺 `total` 才用 `input+output` 补，字数从不换算成 token；界面上 `null` 显示的是「本轮未回报用量」六个字，不是 0。守卫⑦的负断言（DOM 里不许出现 `0 tokens`、不许出现 `0 in`）与「会话级那一格没数就不画」都钉住了。

**动作件**（全部点得动，没有一枚是摆设）：问句行＝时间戳＋复制＋编辑重发；回答行＝复制＋展开过程（有轨迹才出）＋重新生成（**只对最后一条开**，禁用那枚的 title 把理由摊在屏上：换中间那条＝把后面历史弄丢，那要等任务6 的分支）＋用量 chip。会话级那一格在输入区上方，取最近一条真带 usage 的回答（DeepWrite「上下文圆环只看最近同模型那一轮」的口径，不做累计估算）。动作条 `opacity` 显形但 `min-height` 预留高度——显形不许把下面内容顶跳。「分支」这枚**故意没上**：它跟任务6 的消息树一起长出来。

**编辑重发**走 `store.dropFrom(messageId, sessionId?)` 这个新入口（从命中那条起整段截掉，报出删掉的条数；查无此 id 返回 0；点名别的会话时不许动当前会话——三条都有 node:test 用例）。乐观失效保护照抄 DeepWrite：`id`＋`text`＋`at` 三者必须还能对上屏上那一条，对不上一个字节都不动（动作条是 hover 才显形的，点下去那一下会话可能已经变了）。截断与「分支前先存一支」（任务6）共用这一次历史重写入口，没长第二套。

**Enter 与输入法**：`onKeydown` 原来是 `if (event.isComposing) return`，补成 `isComposing || keyCode === 229`——老前端 8 处同一口径（`AuthoringBlockComposer.vue:202`、`AuthoringManuscriptImport.vue:451`、`AuthoringRehearsalPanel.vue:93` 等），后者是老 Chromium 组字期 `isComposing` 仍为 false 只把 `keyCode` 打成 229 的那条兜底。用例四档全钉：isComposing／keyCode 229／Shift+Enter 都不发，普通 Enter 照发（不然这条守卫只是在把发送键打死）。

**断言漂移如实记**：`agent-sessions.test.mjs:183` 那份「消息形状是 JSON 安全的固定字段」原封钉的是 10 个键，schema 多了 `runId`／`usage`／`status` 后必须改断言——改的是期望值（13 键）并加了三格各自的缺省断言（`runId:''`、`usage:null`、`status:'completed'`），理由写在断言上方注释里，不是为了让测试变绿而放宽。

`aria-label` 与 `title` 的中文口径按工单要求进了用例：复制（「复制这条回答」→成功转「已复制」）、编辑重发（「编辑重发（这条之后的历史会截断）」）、重新生成（「用同一个问题再生成一次」／禁用态那句解释）、chip（「本轮模型回报的用量」vs「上游这一轮没有回报用量」）。剪贴板不可用那一档也钉了：点下去不报错、标签不动、不弹「已复制」的谎。

### §7-3 任务4（消息内处理时间线）已落地

**分工按工单口径落到底**：判定与归组全在纯模块 `next/shell/conversationTimeline.mjs`（块型、四态文案工厂、图标按名字正则归类、只读并组、耗时合成），`ConversationTimeline.vue` 只摆——所以这套判读用 `node --test` 直测，不靠 jsdom。组件对外只吃 `blocks`／`trail`／`expanded`／`flat`／`path` 五个 props，屏上没有一处现造的中文状态词；改词只改工厂那一处。

**五类块都长出来了**：`thinking`／`response`／`tool`／`tool-group`／`subagent`。`subagent` 与 `workflow-step` 走的是既有白名单扩段（工单第 5 条要求的判据反转，理由见下），**本批没有新增任何事件类型、也没有编一条子代理事件**——面与判读先到位，产出方仍是批次78。图标那条按工单要求走名字正则（写入→globe→sparkles→folder→terminal，认不出来落 `file`），58 条字面量表没长出来；新工具名自动落类，`classifyToolIcon('pinax_chapter_read')==='file'` 这种用例钉着。写入类不显图标也钉了负断言。

**与工单文案的一处偏差（如实报，不冒充做完）**：第 1 条要「写入结果已生成／**N 字**」，`N 字` **没做**。`tool-end` 白名单里只有 `name`／`callId`／`ok`／`ms`，没有写入字数；上游被 clamp 过的输出长度不是「作者写了多少字」，拿它填进那句就是编数——工单禁止边界里「不许自设数值当闸」同一条。现在写入块说的是「正在写入 X」／「写入结果已生成」／「写入被拒 · 码」，真有提案时在后面带「· 提案 <id>」（`proposal-created` 带出来的真 id）。要补 `N 字` 得先让 `tool-end` 真回报字数，那是**白名单扩字段**，需作者点头，已列入 §7-5 欠账。

**耗时是两条读数，不是一条**（工单第 4 条：两个都要在，取时间差为准）：`timelineElapsed().seconds` 量的是事件 `at` 的首尾差——`at` 由 `RuntimeDock.stampArrival` 在**渲染层收到那一刻**打点，口径就是「外壳看到的时间差」，不含主进程内部排队，不当端到端耗时用；`toolMs` 是 `tool-end` 自报时长累加，与时间差不是一回事，所以顶行两条都写（`已处理 0.9 秒 · 工具累计 20ms`）。缺哪个就如实说缺哪个：老 JSONL 会话没 `at` → 只说工具累计并补一句「外壳没记到事件时刻」；两者都没有 → 「这一问没留下耗时读数」；真跑但首尾差不足 0.1 秒 → 「已处理（不足 0.1 秒）」。**没有一处把 ms 冒充秒，也没有一处报 0 秒**，三条都有用例。

**折叠是真折叠**：块列表在文件里只有一份，外面套一个可换的壳——`flat`（流中）套 `div` 平铺，其余套原生 `<details>`。展开态是 `AssistantDialog` 内部一张 Map，key 走 `timelinePath(messageId)`，切会话回来还在，**不落盘**：守卫⑨那条用例既断「换会话再换回来展开态还在」，又断此刻交出去的最后一份 `sessionsSave` 快照 JSON 里不含 `expanded`／`trailOpen`／`"open"`。流中那一条（`busy && liveTrail.length`）平铺在状态行下面，回答落地即撤，同一叠事件定格进这条回答的折叠层、缺省收起——作者跑的时候不需要点第二下。

**`tool-dropped` 改判（实现 bug，被纯函数用例抓到）**：它原先被当成一次工具调用收进 `tool` 块，并组资格判定只认「非写入类」，于是「被丢弃、根本没执行」的项会被并进「已读取 N 项项目内容」——那是拿没发生的事报完成。现在它归 `PROCESS_STAGES`（进 `thinking` 块），且没有终态也没有开始时说「等待执行」，不宣布已完成；用例两档都钉着。同类被抓到的还有：`tool` 块漏带 `callId`（并组展开后无法对应原文）、`workflow-step` 被误标成「交给子代理」（现分两种说法：`正在走工作流第 N 步`／`正在交给子代理 <name>`）、子代理块收工后永远停在「正在」（现在非流中一律归 `completed`，但仍只照实说「已交给子代理」，不替它宣布产出）。

**判据反转（工单第 5 条要求连注释一起订正、不许静默）**：`next/tests/agent-sessions.test.mjs:272`／`:339` 与 `next/tests/trail-tool-events.test.mjs:91` 那三条反向断言改为正向（`stage:'subagent'` 现在必须被识别），改动理由写在断言上方的注释里；`agentSessions.mjs` 上那句「只有这五种阶段」的陈旧注释同步订正。**白名单仍然是闸**——`subagent-start` 这种词表外的段型依旧落 null，正向用例旁边就钉着这条负断言，不是把判据放宽成「什么都收」。

**一处刻意没动**：`TRAIL_BREAKPOINT_STAGES`（`['start','envelope','model-round','answer']`）保持原样。子代理段要不要当断点行，决定的是「重开会话时轨迹从哪一步重建」，那要等批次78 真产出这两类事件才知道形状对不对——本批擅自扩等于给一条没有生产方的路径预先定语义，列入 §7-5 待裁。

**jsdom 事实两条（踩坑账，都落在代码注释里）**：① 程序化给 `details.open` 赋值**不会触发 `toggle` 事件**（jsdom 只在用户交互路径上发），所以动作条那枚「展开过程」的钮不能靠 `@toggle` 回调回写状态——改成钮自己读写那张 Map 并直接翻 `details.open`，`aria-label` 才跟着翻（先它停在「展开过程」，用例假失败）。② `wrapper.text()` 把相邻 `<span>` 无分隔粘起来，块头与原始行是两个节点，所以「已调用 pinax_chapter_read」与「pinax_chapter_read · 9ms」必须分两条断言；写成一句人话会假失败——这是断言层的事实，不是文案口径。

**用例落点**：`next/tests/conversation-timeline.test.mjs`（新，10 条 node:test：词表闭合／图标归类含写入 null／四态文案／块序列与块头／写入类措辞含「不含字数」负断言／只读并组含打断与 worst-of 与 ms 求和／子代理两型与流中流后／流中语义含 `tool-dropped`／耗时与顶行如实性／`timelinePath`）；`next/tests/shell-ui.spec.mjs` 三条（五类块真渲染含计数 chip 与组内图标与 `flat` 平铺／折叠默认收起＋钮翻 `aria-label`＋切会话保留＋落盘无展开态／流中平铺无 `details` 且落地后撤掉）。守卫⑨ 至此有用例，守卫⑥⑦ 已在任务1／2。

**记账（不进闸）**：`shell-ui.spec.mjs` 那条十事件的夹具（`envelope`／`model-round`／两把只读各 start＋end／一把写入 start＋denied／`subagent`／`answer`）并组后落 **5 块**（`thinking`／`tool-group(2 项)`／`tool`／`subagent`／`response`）——「连续两把只读压成一行」的计数收益在这里是 4 事件 → 1 组行（明细仍在组里展开得到，一条原文不丢）。这只是夹具样本，工单「记账指标」要的真会话前后分布还没取。


### §7-4 门禁读数（只增不减，逐段现跑）

| 段 | 基线 | 现值 | 判定 |
| --- | --- | --- | --- |
| `node next/testing/acceptance.mjs` | 44/44 | 44/44 | 持平 |
| `node --test "next/tests/*.test.mjs"` | 748 | **763**（0 失败） | ＋15（任务2 期间 ＋5；任务4 的纯函数层 ＋10） |
| vitest（`next/vitest.next.shell.config.mjs`） | 206（14 文件） | **217**（14 文件） | ＋11（任务1 两条＋任务2 六条＋任务4 三条） |
| `npm run lint:next` | 0 问题 | 0 问题 | 持平 |
| 打包门禁（bundleAssertions） | 全过 | 全过 | 持平 |
| 外壳 bundle | 1988.4 kB | **1991.6 kB** | ＋3.2 kB（记账，非闸） |
| renderer js | 1191.2 kB | **1224.9 kB** | ＋33.7 kB（md 渲染链＋动作条＋时间线组件进面；体积线沿用既有 <2.5 MB 口径，未新增数值线） |
| 主进程 bundle | — | 1680.8 kB | 记账 |

**上一轮那条 exit 134 的读数问题本轮已消解**：本轮 `npm run verify:next` 官方命令**原样跑到 exit 0**（vitest 用缺省 pool，14 文件 217 用例全绿）。此前记录的「第四段 vitest 崩 134（worker `JavaScript heap out of memory`，两次可复现）」经实证是本机 **commit space 见底**的间歇态（pagefile 0；当时 PowerShell 实测 `FreeCommit 2.0 GB｜TotalCommit 63.8 GB`），与已入账的「满载假红」同一根因，**不是用例坏**。`--pool=forks --poolOptions.forks.singleFork=true` 单进程跑法保留为空间见底时的取读数手段，两种跑法读数一致（本轮 105 用例先按单进程跑过一遍，再随官方命令复跑）。也就是说：**工单验收判据要的「官方命令五段全绿」本轮已满足**。

### §7-5 未做／未验证（不冒充已完成）

- 真机窗口没看：任务2／任务4 都属界面变化，工单写明**实拍交调度方**（Electron＋CDP 口径仍等作者点头）。上面所有断言来自 jsdom＋真 DOM 结构，不是像素级确认；hover 显形的动作条在实际窗口里的观感未拍过，时间线那一片的行距／图标尺寸（`--nx-fs-2xs` 刻度＋13px 图标）在真窗口里是否偏小也未拍。
- 真模型回报的 usage 覆盖率**不可考**：链路已通，但 `usage` 到底有多少比例的真回答带回来，取决于上游网关回报与否——本机模型面没跑这条统计（工单「记账指标」里的 token chip 覆盖率因此仍是空的）。
- 任务4 的三条待裁／欠账：①「写入结果已生成／**N 字**」缺字数来源，补它要给 `tool-end` 白名单加字段（扩白名单＝需作者点头，见 §7-3）；② `subagent`／`workflow-step` 的**生产方在批次78**，本批只交付了渲染面与判读，那两类块今天只存在于用例夹具里，屏上不会出现——不拿夹具当已上线；③ `TRAIL_BREAKPOINT_STAGES` 未扩，重开会话时子代理段能否重建轨迹要等 78 有真事件再裁。另外老会话（`.pinax/sessions/*.jsonl` 里没有 `at` 的那些）走的是「只有工具自报时长」那一句文案，用例钉了判读、真数据没验过。
- 任务3／5／6 未开工；守卫⑧⑩⑪还没有用例（守卫⑨ 已随任务4 落地）。
- 未 commit（作者纪律：无明确指令不 commit）。
