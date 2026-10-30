# 批次37 执行工单（Qoder）：M2.5 收尾——事件总线＋工具循环接 UI＋技能进打包（2026-10-30）

> 执行方：**Qoder**（作者指令：下一批次使用 Qoder 开发；交接面照批次12 派工单惯例——执行方回填 §7，调度方验收回填 §8）
> 调度方：Zcode（工单撰写、验收、门禁复核、git 提交）
> 依据：M2.5-A/B/C 三批（c89e699）的诚实边界清单＋批次35/36 夜验结论。

## 0. 现状锚点（先读再动手）

- **工具循环默认关**（M2.5-A）：`next/runtime/toolLoop.mjs`/`toolSelect.mjs`/`writePolicy.mjs` 全部就绪，`createAdvisorRunner({ toolLoop })` 注入式——但 `main.mjs:286` 的 `runtimeOptions` 没注入，界面上没有任何调用者。
- **writeMode 是会话真值**（M2.5-B）：会话带 `writeMode`（review/auto），载荷恒带——循环接上后策略档从它读。
- **`subscriptions: ['project.changed']` 只是校验过的声明**（M2.5-C 记账）：宿主没有发布者，载体收不到事件；批次30 导入后的刷新走的是显式 reload。
- **`next/skills/` 没进打包产物**（M2.5-B 记账）：装机后 `loadSkills` 找不到目录 → 技能清单为空（`pinax_skill_read` 工具仍在）。
- 轨迹七段（step/tool-start/tool-end/…）批次35 已进白名单，真链不注入循环就不会发。

## 1. 任务一：项目事件总线（最小实现）

- 新建 `next/runtime/eventBus.mjs`：`emitProjectEvent(root, event)`／`subscribeProjectEvents(root, fn)`——进程内 Map<root, Set<fn>>，事件形状 `{ kind: 'entries-changed' | 'outline-changed' | 'manuscript-changed' | 'sessions-changed', at }`；订阅返回退订函数；同 root 广播、跨 root 隔离。
- 接入点（只发不改行为）：`outlineImportService` 成功后发 `outline-changed`；sessionStore 快照写盘后发 `sessions-changed`；载体 save 通路（fileService.notifyWrite 已有的钩子）按目录映射 kind。
- 消费方一个：设置页的大纲转换节改订阅 `outline-changed` 自动重扫（替代手动重扫的一半场景）；载体 manifest 声明了 `subscriptions` 的插件，宿主在激活时替它挂上投递（M2.5-C 的承诺兑现）。

## 2. 任务二：工具循环接 UI（默认 review 档上线）

- `main.mjs` 的 `createNextSession` 注入 `toolLoop`（**注入即上线，但 writeMode=review 下写工具只转提案不执行**——M2.5-A 的 writePolicy 保证，这正是 review 的定义）。
- 循环开关跟会话：`runtimeAsk` 载荷已有 `writeMode`——`review`＝循环开＋写转提案；`auto`＝循环开＋写直执行（M2.5-B 的确认闸已在 UI 侧）；`blocked` 不存在会话默认档，不需要。
- 轨迹：循环事件（step/tool-start/tool-end/proposal-created）已经走批次29/35 的轨迹白名单——验证 Agent 卡「过程」折叠层能显示工具步骤即可（jsdom 用例）。
- **提案闭环最小步**：`proposal-created` 事件发到事件总线；提案审阅设置节订阅后列表自动刷新（不用重启项目）。

## 3. 任务三：技能目录进打包

- `next/vite.next.shell.config.mjs`（或打包断言脚本）：把 `next/skills/` 随产物拷到 `next/.build/skills/`（构建期 copy，不是 vite 资产——SKILL.md 是运行时读的文件）。
- `loadSkills` 的目录解析支持「开发轨 next/skills/」与「装机轨 .build/skills/」双落点（按 `__dirname` 或既有产物定位惯例）。
- 打包断言加一条：`.build/skills/*/SKILL.md` 存在且 `loadSkills` 在产物路径上能读出 5 个技能（新 needle）。

## 4. 测试

- eventBus：同 root 广播/跨 root 隔离/退订/异常订阅不拦别人。
- 循环接 UI：注入后 review 档写工具转提案（假 turn 单测已有，补一条「会话 writeMode=auto 时直写」的档位联动）。
- 打包：技能目录 needle。
- shell-ui：大纲转换节自动重扫（事件驱动）、提案列表自动刷新。

**允许文件**：`next/runtime/eventBus.mjs`（新）、`next/runtime/outlineImportService.mjs`、`next/sessionStore.mjs`、`next/shell/main.mjs`、`next/shell/ipcContract.mjs`（如需）、`next/shell/settings/OutlineImportSection.vue`、`next/shell/settings/ProposalsSection.vue`、`next/vite.next.shell.config.mjs`、`next/testing/bundleAssertions.mjs`、`next/skills/loadSkills.mjs`、`next/runtime/agentRuntime.mjs`（如注入需）、`next/tests/*`（对应新增/扩展）。**不许改**：server/**、src/**、内核合同、fileService 语义、package.json（不加依赖）。

## 5. 门禁

`npm run verify:next` 五段全绿（基线：内核 412、界面 120、打包 a–l）。

## 6. 边界

- **不新增 npm 依赖**；不改内核合同与 fileService 语义
- auto 档的直写仍受三道闸（归属/scope/修订）与写族闸约束——循环不绕过任何安全层
- 事件总线是**进程内**的：不持久化、不跨进程（多窗口竞态照旧后写者赢，记账在案）
- 不做：命令面板、图上编辑关系、DSL 式筛选（各自另批）
- 执行方不 commit/push、不启停 electron；回填 §7

## 7. 执行方回填（Qoder 填这里）

### 7.0 授权与执行口径（2026-10-30，作者口头点头）

- 作者指令（原话）：「可以，你备注好，然后从没有完成的部分往下做。原则上细节可以后期不断微调，框架侧的问题需要细致，尽快补全逻辑、流转，对齐 pinax 原版代码。我们做的工作本质是一个搬家工作，现在底装修已经需要进入收尾，后续就是每个细节的搬迁工作。」
- 本批范围＝工单 §1–§3 三项，**外加单实例锁附条**（作者在盘点讨论中同意并入本批）：`main.mjs` 启动即 `app.requestSingleInstanceLock()`，抢不到锁的第二个进程把已开窗口提到前台后退出；理由是两个实例同时写同一个项目的 `.pinax/workspace.json`／`sessions/*.jsonl` 是批次 C 已记账的竞态面，单实例锁是成本最低、不新增依赖的收口。
- 纪律：只动工单「允许文件」清单内文件（单实例锁只加在 `next/shell/main.mjs`）；门禁基线 412 内核／120 界面／打包 a–l 不得回退，新增断言只加不减；不 commit／不 push、不启停 Electron、不新增 npm 依赖。

### 7.1 逐任务交付

**任务一 · 项目事件总线**

- 新建 `next/runtime/eventBus.mjs`：`Map<root, Set<fn>>`，root 先 `path.resolve` 归一；`emitProjectEvent(root, {kind, at})` 返回送达数，缺 `at` 自动补 ISO 时刻，每次投递发独立拷贝；`subscribeProjectEvents` 返回幂等退订；单订阅者抛错被吞但计入「未送达」，不拦其余订阅者；`projectEventKindForPath` 把 `notifyWrite` 的 relativePath 映射成类别（正斜杠/反斜杠/`./` 都归一，认不出返回 null 不发无信息量事件）；另有 `projectEventSubscriberCount` / `clearProjectEvents` 供诊断与测试。
- 接入点：`outlineImportService` 成功落盘后发 `outline-changed`（dryRun/空操作不发）；`sessionStore.saveSnapshot` 写盘成功后发 `sessions-changed`；`main.mjs` 的 `fileService.setOnWrite`（唯一钩子槽，与 git 标脏合并）按目录发 `manuscript-changed / outline-changed / entries-changed`，`.pinax/proposals/*` 发 `proposals-changed`，`.pinax/sessions/*` 发 `sessions-changed`。
- 宿主投递：`createRuntimeSurface` 输出 `subscribedCarriers`（启用载体里 manifest `subscriptions` 含 `project.changed` 的）；`agentRuntime.start()` 对当前项目根订阅一次，逐块调 `impl.onProjectEvent(event, {pluginId})`，单个处理器同步抛错或返回 rejected Promise 都不外溢；`stop()` 先退订；`surfaceInfo()` 摊出名单。
- 消费方：`OutlineImportSection.vue` 订阅 `outline-changed` 自动重扫（busy 中与「刚转换完 1.5s 内」跳过，避免冲掉刚摊开的结果）；`ProposalsSection.vue` 订阅 `proposals-changed`，150ms 防抖后只调 `data.loadProposals()` 重列，不新增取数路径。

**任务二 · 工具循环接真链**

- `main.mjs` 新增 `createProjectToolLoop()`：`createToolLoop({ turn: createKitToolTurn(), selectTools, callTool: session.runtime.callTool, policy: ({writeMode}) => createWritePolicy({mode: writeMode, landing: {...KERNEL_WRITE_CLASS, ...CARRIER_WRITE_CLASS}, createProposal}) , emitRuntimeEvent, ... })`；提案店与 runtime 都按「此刻的会话」懒取，换项目（runtime 重建）不会写错项目。`createNextSession` 的 `runtimeOptions` 注入 `createAdvisorRunner({ toolLoop: createProjectToolLoop() })`。
- review 档：写工具不执行，`createProposal` 写 `.pinax/proposals/`，工具结果以 `ok:true + proposalId` 回给模型（避免重试环）；auto 档直写，仍过归属/scope/修订与写族闸；blocked 档拒绝并把 `WRITE_BLOCKED` 作为 isError 工具结果回给模型。
- 轨迹：`emitRuntimeEvent` 把循环的 step/tool-start/tool-end/tool-denied/proposal-created 推给渲染层；`proposal-created` 同时 `emitProjectEvent(..., 'proposals-changed')`。Agent 卡「过程」折叠层新增 jsdom 用例，验证四种工具事件都可见。

**任务三 · 技能进打包**

- `vite.next.shell.config.mjs` 加 `copySkillsPlugin()`（`closeBundle` 先 `rm` 再 `cp next/skills → next/.build/skills`，排除 `loadSkills.mjs`）；`bundleAssertions.mjs` 跑门禁前也先拷一份，保证断言读的是产物路径。
- `loadSkills.resolveSkillsDir`：候选顺序 `PINAX_NEXT_SKILLS_DIR` → `<moduleDir>/skills`（装机轨）→ `<moduleDir>`（源码轨）→ `<moduleDir>/../skills`；空目录/不可读一律返回 null 并让装载如实记账。
- 新增三条打包 needle：`m` 产物目录与源码技能目录逐一对应；`m2` 在 `.build/skills` 按「项目打开、七块载体均在」的完整工具面装载，技能数＝源码目录数且零拒装；`m3` 外壳 bundle 保留 `PINAX_NEXT_SKILLS_DIR` 覆盖口。

**附条 · 单实例锁**

- `main.mjs` 在 `app.setPath('userData')` 之后立即 `app.requestSingleInstanceLock()`（非 Electron 环境兜底为 true）；抢不到锁 `app.quit()`；`second-instance` 还原并聚焦已有窗口；底部装配入口改为 `if (invokedDirectly && singleInstanceLock)`，锁不住就不建窗、不装配会话。应用级锁，不是项目级锁——多窗口仍属未做项。

**偏差与边界（如实记账）**

1. **第五类事件 `proposals-changed`**：工单只列四类，但提案目录不属于任何载体 dataDir，而「提案列表自动刷新」是本批验收条件；单列一类比塞进 entries 诚实（已在 `eventBus.mjs` 头注释说明）。文件写盘与工具循环 `proposal-created` 两路都会发，UI 侧 150ms 防抖，重复刷新幂等。
2. **`AppNext.vue` 改 1 行**（不在允许文件清单内）：给 `ProposalsSection` 传入 `bridge`，否则它拿不到事件订阅口（备选是从 `window.pinaxNext` 直取，会绕过测试注入桥，更差）。
3. **`bundleAssertions` 的 m2 从源码 `carriers/index.mjs` 取工具名**：主进程 bundle 入口 `mainEntry.mjs` 未导出 `BUILT_IN_CARRIER_PLUGINS`，而清单本身不在本批允许文件内；文件拷贝本身由 m 核，装载由 m2 核，工具面只是「项目打开时」的输入。空框架下 d2 仍会如实记 4 条 `SKILL_TOOLS_NOT_ON_SURFACE`（载体保存工具不在面上时的正确行为），不算失败。
4. **顺手修了 `next/tests/carrier-pane.spec.mjs:1506` 的一处正则转义**：`</h1>` 里的 `/` 未转义，整个文件语法错误、collect 阶段直接崩（疑为并行批次 38 的编辑残留）。只改 `<\/h1>`，不动其断言语义；不改则 `verify:next` 的界面段无法收集。
5. **`shell-contract.test.mjs` 的旧断言同步**：原来钉的是 `createAdvisorRunner()` 空参，本批接线后改为钉「`toolLoop: createProjectToolLoop()`」，并新增一条批次37 主进程三件接线（单实例锁／事件转推送／循环策略与提案店）。
6. **没有载体实现 `onProjectEvent`**：今天七块内置载体只声明订阅，投递路径真实但为空；`surfaceInfo().subscribedCarriers` 打开项目时能报出名单，未来某块载体加一个方法即生效，清单不用改。
7. **未起 Electron、未肉眼验收窗口**（按工单纪律）；单实例锁只有源码级断言与语法级兜底，真机双开行为待验收方在出包后核。
8. **技能双落点的装机证据**：d2 在 `.build` 上跑默认解析，已从 `.build/skills` 读到 1 份可装载技能（另 4 份因空框架缺载体保存工具被如实拒装），说明默认解析在产物目录生效；m2 用显式目录核满装载。

**门禁实测（`npm run verify:next`，2026-10-30，rc=0）**

- acceptance：16/16 通过。
- 内核 node 测试：433/433 通过（基线 412 未回退；本批新增 7 条：事件总线 5、主进程接线 1、循环×写策略接线 1）。
- 界面 vitest：123/123 通过（基线 120；新增 3 条：过程层工具事件、大纲自动重扫、提案自动重列）。
- `lint:next`：0 error / 0 warning（`--max-warnings 0`）。
- 打包断言：全部通过（a–l ＋ 本批 m/m2/m3）。主进程 bundle 1018.2 kB（< 6 MB）、外壳 1750.9 kB（< 2.5 MB）、渲染层 872.7 kB；`d` 内核 19 工具、`d2` 运行时面 20 工具；`m` 5 个技能目录、`m2` 5/5 装载零拒装、`m3` 覆盖口在、`j` 模型面三标记齐、`k` preload 3.6 kB。

## 8. 调度方验收回填（Zcode 填这里）

-（验收后回填：独立复跑门禁数字、dameng-px 真数据验收结论、截图编号、提交哈希）
