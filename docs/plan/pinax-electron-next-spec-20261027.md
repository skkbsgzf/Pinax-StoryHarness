# Pinax-Electron-Next 规范（v1，2026-10-27）

> 本档只定规范，不写实现。执行顺序按作者裁定：**先定规范 → 搭框架（不含任何插件）→ 原 web 组件转成插件边栏逐层填入 → 成熟后平替老代码**。
> 上一轮对顶层文档的逐条核对见 [next-gen-electron-frontend-review-20261027.md](./next-gen-electron-frontend-review-20261027.md)。
>
> **v1 变更（作者 2026-10-27 裁定，已收口；推翻 v0 若干口径）**
> 1. 物理目录用**中文**（R1 已定）。
> 2. Agent 运行时是**一级公民、内置、优先级高于所有功能格对应的插件边栏**；载体（小说/剧本/大纲/漫剧）统一降为**二级公民＝插件边栏**（R2 已定，推翻 v0 的"载体、Agent、文件三者完全平级"）。
> 3. 现有 web 组件（例如正文/Authoring）按新协议**先转化为插件边栏，再填进框架**，不是先把页面搬过来再补协议。
> 4. 开发顺序：**框架先搭全（除插件外的一切），再一层层往里填插件**。
> 5. 每个项目必须指定一个**主载体插件**（作者原话称"一级公民的插件"，例：这个项目要创作小说还是剧本），并保证**依赖闭环**——不能出现"想玩游戏却没有剧本"。

## 0. 结论先行

1. **"平级"改判为"两级"，反而更干净。** v0 把载体、Agent、文件服务写成三者平级，代价是要把小说从内建位置拽下来、还得给运行时找理由。作者的新口径把唯一的特权给了最该有特权的东西：**运行时是一级公民，载体全部是二级插件，而载体之间完全平级**（小说与第三方漫剧用同一份合同、同一个注册入口、同一套权限申请）。"可插拔"由此有了唯一例外，而这个例外不需要再辩护。
2. **优先级要落成机制，不是口号。** 运行时置顶＝五件硬事（第 5 节）：随包常驻不可停用、固定占有右侧运行时栏且插件不得声明 `slot:"right"` 抢占、上下文预算先满足运行时再分给插件、任何插件加载失败都不影响运行时可用、改稿一律走提案链。
3. **每个项目有且只有一个主载体。** 主载体决定项目类型、决定打开项目落在哪个面板、决定默认上下文档案；其余载体是配角，可增可删（第 4 节 D1、第 3 节 C7）。
4. **依赖闭环是硬闸，而且今天在代码里确实会漏。** 取证三条：建项目时能选"剧本"（[ProjectInfoPanel.vue:37](../../src/components/workbench/ProjectInfoPanel.vue) 的 `<option value="screenplay">`），但左侧竖条没有任何剧本载体（[workspaceTabContract.js](../../src/services/workspace/workspaceTabContract.js) 里 `screenplay/剧本` 零命中），剧本资产只剩一个 235 行的只读视图 [ScriptDocumentView.vue](../../src/components/documents/ScriptDocumentView.vue)（仅被 [DocumentReader.vue:399](../../src/components/documents/DocumentReader.vue) 调用）；未知或缺失的 `kind` 会被**静默回落成 novel**（[localMirrorService.js:562](../../server/services/localMirrorService.js)、[:878](../../server/services/localMirrorService.js)）；体验页的 `mode` 直接硬编码 `'novel'`（[Experience.vue:856](../../src/pages/Experience.vue)）。所以"想玩游戏却没有剧本"的真实形态不是报错，是**系统不吭声、按小说跑**。规范定为缺依赖显式失败并给修复路径，禁止静默回落。
5. **框架先于插件。** 第 8 节把"框架完成"单列成里程碑 M1，其验收项**不含任何载体**：只有内核注册与校验、文件服务、运行时进包、外壳、项目合同、主载体向导、Next 自己的 verify 链。M1 的判据是"空框架可跑"——建一个只有 `.pinax/` 的项目、起运行时问一句话、什么都不装也不报错。M2 才填第一个插件（小说/正文），用它验证合同够不够用。
6. **仍未裁的只剩两件**：R3 老 web 数据落到哪个面（可推到 M2 前）、R4 建项目时是否强制装齐依赖闭包（我推荐"装齐"）。其余可照本版开工。

---

## 1. 命名与边界

**Pinax-Electron-Next 是**：一个本地优先的可插拔前端框架（Electron）。内核由**一级公民 Agent 运行时**与**文件服务底座**构成；所有创作形态（小说/剧本/大纲/漫剧…）都是挂在它上面的**二级插件边栏**。

**它不是**：一次 UI 改版；把现有 Vue 页面塞进 Electron 窗口的包装（这条路已验证过——桌面裸跑只有写作、没有 AI）；也不是新的服务端。

**明确不在本期范围**：联机协作服务、公网部署、移动端。外壳与插件合同不能为它们内建特权。

---

## 2. 公民层级

| 级 | 谁 | 提供什么 | 向谁申请 | 可否停用 | 可否被替换 |
| --- | --- | --- | --- | --- | --- |
| 一级公民（唯一） | **Pi-Agent 运行时**（知识内核、工具调度、上下文包络） | 运行回合、工具调用、按提案写回 `.pinax/proposals/` | 只向文件服务申请作用域读；写只限提案区 | **不可**，随包常驻 | 可换模型后端与推理服务，不可换"是否存在" |
| 内核底座 | **文件服务**（作用域读写、原子落盘、修订并发、备份、完整性） | 唯一写磁盘的出口 | 项目根授权 | 不可 | 可换引擎，仍是文件 |
| 二级公民 | **载体插件边栏**：小说、设定、资料、素材、漫画、视频、剧本、大纲、体验、联机、第三方漫剧… | 面板 panes、数据目录 dataDirs、工具 tools、上下文贡献 context | 文件作用域、运行时调用权、外壳槽位 | 可（项目配置增删） | 能。外壳不含任何载体名 |

**二级公民之间**沿用 v0 的三同原则（这才是"平级"的落点）：

1. **同一注册入口**——内核只有一个 `registerPlugin(manifest, impl)`。现有 [workspaceExtensions.js](../../src/services/workspace/workspaceExtensions.js) 的 `enabled()` 用 `builtin || required` 短路让内置项无法关闭，Next 取消这条特权：小说也是普通插件，只是随包安装，仍可停用。
2. **同一份权限申请**——manifest 声明 `scopes`，未声明即拒绝。基线复用 `projectTarget()` 那套"白名单目录＋绝对路径前缀校验"（[projectImport.js](../../server/mcp/projectImport.js) 的 `projectTarget/writeControlledFile`，已证有效）。
3. **同一条上下文总线**——任何插件都能发布上下文，任何插件都能被运行时读到，走同一套解析。**这条不用从零造**：[agentContextResolver.js:17-40](../../src/services/agents/agentContextResolver.js) 的 `resolveAgentContext({ taskId, request, facade })` 已按 `AGENT_CONTEXT_PROFILES[task.contextProfile].blocks` 逐 kind 向 facade 解析，合同在 `shared/agentContextContract.js`。Next 把 kind 集合交给插件声明（`context.providers`），把优先级归给运行时。今天缺的正是对称入口：只有 Authoring 侧 provider（`src/services/agents/authoring/*Provider.js`）被接进档案，别的形态没有。

层级差落在哪里：常驻性与运行位置（第 5 节）、槽位所有权（第 6 节）、上下文预算（第 5 节）、故障隔离（第 5 节）、信任级（第 7 节）。

---

## 3. 载体清单（Carrier Manifest）合同 v1

项目侧状态落 `.pinax/project.json → carriers`，形如 `{ "primary": "pinax.novel", "enabled": ["pinax.novel","pinax.worldbook"], "revision": 3 }`，对应"可在项目配置里设置"；清单文件在插件包内。

```jsonc
{
  "spec": "pinax-carrier@1",
  "id": "pinax.novel",            // ^[a-z][a-z0-9.-]{0,79}$，沿用现有注册表校验
  "title": "小说",
  "version": "1.0.0",
  "minKernel": "1",               // 外壳合同版本，不兼容即拒装
  "tier": "carrier",              // 固定值；运行时与文件服务不走这份合同
  "primary": {                    // 可被选为主载体（第 4 节 D1）
    "projectKind": "novel",       // 与 KIND_TEMPLATES 对齐；缺失不再回落
    "defaultPane": "editor",
    "contextProfile": "authoring" // 交给 agentContextProfiles 的档案名
  },
  "dataDirs": {                   // 「载体文件夹即数据结构」的声明式表达
    "manuscript": "正文",          // 逻辑名 -> 物理目录（已裁：中文为真源）
    "outline": "大纲",
    "notes": "构思"
  },
  "panes": [                      // 槽位不是路由名；没有 right——右栏归运行时
    { "slot": "left-dock", "id": "chapters", "title": "书稿", "icon": "outline" },
    { "slot": "center",    "id": "editor",   "title": "正文", "icon": "book" }
  ],
  "capabilities": ["text.chapters"],          // 对外提供的能力；依赖按能力而非按插件名
  "requires": [                               // 缺即拒启用，并给修复路径（D3/D4）
    { "capability": "setting.entries", "min": 1,
      "fix": "启用「设定」插件，或让运行时按现有条目生成提案" }
  ],
  "tools": ["chapter.read", "chapter.write", "outline.read"],  // 命名空间内声明，内核代理给运行时
  "context": { "providers": ["chapter", "worldbook"], "budgetChars": 60000 },
  "scopes": ["file:正文:rw", "file:大纲:rw", "agent:ask"]
}
```

规范条款：

- **C1 逻辑名与物理目录解耦。** 内核只认 `dataDirs` 的逻辑名（`manuscript`/`outline`/`notes`…），物理目录由插件声明；已裁物理名为中文真源，英文桌面骨架不再作为布局存在（第 4 节注）。
- **C2 目录不得越出项目根，不得含 `..` 或绝对路径**；错误码统一。
- **C3 一个插件只写自己的 `dataDirs`。** 跨插件读写必须走对方声明的 `tools`——这保证"删掉一个插件不损坏别人的数据"。
- **C4 卸载≠删数据。** 停用只改 `carriers.enabled`，目录与文件留在磁盘上并在"归档"视图可见；作者的稿子永远比代码活得久。
- **C5 面板是槽位不是路由。** 外壳只保证顶栏＋左竖条＋中栏＋右运行时栏；页面内部栅格归插件自己（现状各页面自带 grid）。
- **C6 依赖只按能力声明，不按插件 id 硬连。** `requires` 指向 `capabilities`，于是"剧本能力"可由官方剧本插件提供，也可由第三方剧本插件或运行时的转换提案提供，内核不关心是谁——这是 D4 既有闸又有出路的原因。
- **C7 主载体唯一。** 项目必须有且只有一个 `primary` 插件处于启用态；切换主载体合法，但每次都要过 D3 的闭包校验。
- **C8 第三方兼容插件按同一合同。** 附加要求只三条：`minKernel` 声明、权限显式申请、id 与工具命名空间隔离（`manju.panel` 不能伪装成 `novel.panel`）。信任级见第 7 节。

---

## 4. 主载体与依赖闭环（作者新增要求的落地）

**D1 建项目必须显式指定主载体。** 对应作者说的"这个项目我要创作小说，还是剧本"。主载体决定项目 `kind`、默认落点面板、默认上下文档案。

**D2 禁止静默回落。** 现有两处必须删：未知/缺失 `kind` 回落成 `novel`（[localMirrorService.js:562](../../server/services/localMirrorService.js)、[:878](../../server/services/localMirrorService.js)）；体验任务 `mode` 硬编码 `'novel'`（[Experience.vue:856](../../src/pages/Experience.vue)）。Next 里类型缺失＝打开即报 `PINAX_PRIMARY_CARRIER_MISSING`，停在"选一个主载体"那一步，不猜。

**D3 启用/停用/切主载体都要过依赖闭包校验。** 内核在任何 `carriers` 变更前算传递闭包：所有 `requires.capability` 必须被某个启用插件的 `capabilities` 覆盖；不足即**拒绝该次变更**，列出缺口与修复路径。反向也要查——停用一个插件前，检查是否有启用中的插件依赖它提供的能力。

**D4 不能出现"想玩游戏却没有剧本"。** 具体化：体验（跑团/联机）声明 `requires: [{capability:"script.scenes"}]`。若主载体是小说而剧本插件未启用，启用体验时直接失败，提示"启用剧本插件，或让运行时刻一版剧本提案（写入 `.pinax/proposals/`）"。这条既挡住了今天"不吭声按小说跑"，也留了一条不写新代码就能走通的路——因为剧本能力本身可以由运行时按正文生成（C6）。

**D5 主载体切换不损坏数据。** 中文目录是物理真源，切主载体只改 `carriers`；已被某插件写过、但不再被任何启用插件声明的目录，进"归档"视图只读展示，绝不删除。

**布局裁定（R1 已定）附注**：物理真源是中文标准目录（`正文/大纲/世界书/构思/资料/日志/约束`，另有 screenplay/generic 模板，见 [localMirrorService.js:27-31](../../server/services/localMirrorService.js)）。桌面英文骨架 `manuscript/reference/assets`（[projectManifest.mjs:8-20](../../electron/projects/projectManifest.mjs)）不再作为项目布局存在，只保留 `.pinax/` 作元数据目录；作者 kit 布局（`故事主体/卷一/第00N章/小说.md`）永远是"导入源"，不是存储目标。同时 `.pinax/project.json` 必须收敛成一份合同：`spec` 强制（升 `pinax-project@2`）、加 `carriers`、两边共用 [shared/desktopProjectContract.js](../../shared/desktopProjectContract.js) 单一校验器——今天的**双向坏**是服务端打开 Electron 建的项目必抛 `ERR_SPEC_MISMATCH`（[localMirrorService.js:496](../../server/services/localMirrorService.js)），反方向 Electron 校验器丢弃 `spec/kind`。

---

## 5. 一级公民：Agent 运行时

**已裁（R2）**：运行时内置进包，作为 **Electron 主进程内模块**运行，不 spawn Express；打包纳入 `server/` 里框架无关的服务层，把 Express 与 HTTP 挂载层排除在桌面包外。

取证与推论：

- 打包忽略规则 [forge.config.cjs:16-21](../../forge.config.cjs)（`ignoreUnbundledFiles`，挂在 `packagerConfig.ignore` :29-32）只放行 `/.vite` 与 `node_modules`，例外仅 `better-sqlite3 / bindings / file-uri-to-path`（:10-14）。**`/server` 因此在桌包里不存在**，桌面版才没有 AI——这是"运行时优先级低"的物理原因，不是 UI 问题。原生 SQLite 已在包里，所以下面第 5 条 ABI 断言不是假想风险。
- MCP 现有两传输：stdio 入口 [index.js](../../server/mcp/index.js)（13 行）与挂在 Express 上的 Streamable HTTP（[http.js](../../server/mcp/http.js)，loopback 守卫 :34-41，`advisorBaseUrl` :53-57）。进主进程后，loopback 守卫与"公网禁用模型编辑"这两个补丁在桌面形态可退役。
- 三出口同内核：**in-memory（渲染进程，IPC 命名空间 `pinax:agent:*`）／stdio（外部 Agent、CLI）／http（仅服务端形态，Next 桌面默认不开）**。`server/mcp/tools/*` 的 19 个工具保持不动，但改为"由各插件 `tools` 声明聚合"，内核只管命名空间与权限。
- `pinax_agent_ask` 今天靠自调用 advisor HTTP 端点桥到运行器（[agentAsk.js:329](../../server/mcp/agentAsk.js) 的 `fetch(new URL('/api/advisor/task', baseUrl))`，baseUrl 来自 :384）；Next 改为直调运行器函数，去掉自调用。
- 打包硬约束：`better-sqlite3` ABI 只能一个档位（Node 档 vs Electron 档，实测 `NODE_MODULE_VERSION 146`）。Next 桌面包**必须**是 Electron 档，构建链要在 `verify` 里断言，否则又是"换档陷阱"。

**"拉高优先级"的机制化定义**：

1. **常驻**：运行时不注册为插件、不进 `carriers`、没有开关；项目配置页只暴露模型与预算，不暴露"启用 Agent"。
2. **槽位固定**：右侧运行时栏是外壳一等区域，插件不得声明 `slot:"right"`；主载体只决定中栏。
3. **预算优先**：上下文包络先满足运行时档案（`agentContextProfiles` 的优先级），再按插件 `budgetChars` 分配；插件之间主载体优先。
4. **故障隔离**：插件加载失败、越权被拒、版本不兼容时，运行时与文件服务必须仍可进入；外壳显示"插件 X 未加载"，而不是白屏。
5. **写回口径**：运行时写盘只经文件服务，改稿一律走 `.pinax/proposals/`（`pinax_chapter_write` 现有语义升格为内核级约束）；插件若声明"改写既有稿件"类工具，同样必须走提案链，否则拒装。

---

## 6. 外壳规范（对应顶层文档的五条约束）

1. **本地 Electron 优先**：项目＝磁盘上一个文件夹，`.pinax/` 为标记；浏览器缓存轨降级为"只读迁移源"，Next 不往里写。
2. **顶部经典菜单横条**：现在 [main.mjs](../../electron/main.mjs) 全文 113 行没有 `Menu`（整个 electron/ 目录 grep 不到）。规范：应用级菜单由主进程建（文件/编辑/视图/窗口/帮助），**插件不得注入顶层菜单**，只能注入自己面板的上下文菜单；运行时独占"Agent"入口。
3. **左侧故事载体竖条**：条目来自插件注册表，**主载体置顶**，顺序与启停由项目配置决定。今天竖条写死四项（文件/搜索/书稿/扩展，[WorkspaceContentGroups.vue:23](../../src/components/workbench/WorkspaceContentGroups.vue) 的 `activityItems`，渲染于 :149），surface 名硬编码在 [workspaceTabContract.js](../../src/services/workspace/workspaceTabContract.js)（10 项目＋8 全局＋3 双模式），落到路由表是 17 条扁平子路由（[router/index.js](../../src/router/index.js)）。Next 里 surface 名不再出现在路由表。
4. **载体文件夹即数据结构**：由 C1 的 `dataDirs` 表达，物理名中文；元数据只允许进 `.pinax/`。
5. **三栏工作区**：左＝载体竖条＋目录树，中＝主载体面板，右＝**运行时栏（固定，不可被插件占用）**。今天右栏最完整的实现是 Authoring 检查器（[AuthoringKnowledgeAssistant.vue](../../src/components/authoring/AuthoringKnowledgeAssistant.vue) 950 行）；而 [AuthoringDock.vue:26-42](../../src/components/authoring/AuthoringDock.vue) 已定义「会话／执行／工具／Agent」四页签常驻右栏（182 行，含宽度偏好与 SSE 保活约束），**全仓没有任何 .vue 引用它**，唯一提到它的是 [useAuthoringDockPreferences.js:1](../../src/composables/useAuthoringDockPreferences.js) 的一行注释。Next 的运行时栏以这个孤儿组件的意图为蓝本重写——蓝本已经写好，只是没接上。

---

## 7. 权限模型与信任级

| 级 | 谁能用 | 能力 | 判定 |
| --- | --- | --- | --- |
| T0 一级公民 | 内置运行时＋文件服务 | 上下文总线全量、工具调度、提案写回 | 随包发布，无开关 |
| T1 官方载体插件 | 本仓维护 | 自己的 dataDirs/tools/panes；禁改别人的目录 | manifest `tier:"carrier"` ＋ `minKernel` |
| T2 第三方插件 | 外部开发者 | 同上，但文件写限自己声明的目录与 `.pinax/plugin-data/<id>/`；网络需显式声明 | 装载时向作者展示 scope 摘要，作者点头才启用 |

今天 [workspaceExtensions.js](../../src/services/workspace/workspaceExtensions.js) 顶部注释明写"不加载 URL、不授予工具/模型/文件系统访问"。Next 要引入真插件，所以把这句话换成**显式 scope 审批**，而不是一句"信任"。`PINAX_PUBLIC_ORIGINS` 那套开关继续生效于服务端形态；桌面形态天然没有这个问题。

---

## 8. 开发顺序：框架先搭全，插件再逐层填

**M1 框架里程碑（不含任何插件，验收也不看插件）**

1. 内核：`registerPlugin`、manifest 校验（C1–C8）、scope 校验、能力依赖闭包计算（D3/D4）、`capabilities` 词表定稿。
2. 文件服务：中文目录真源；原子写＋`wx` 临时＋`fsync`＋`rename`、`expectedRevision` 乐观并发、备份与 `recoverInterruptedWrites()` 直接继承桌面轨现成实现（[projectFiles.mjs](../../electron/projects/projectFiles.mjs)、[projectBackup.mjs](../../electron/projects/projectBackup.mjs)、[fsDurability.mjs](../../electron/projects/fsDurability.mjs)）。
3. 运行时进包：主进程内模块＋in-memory/stdio 双出口、工具命名空间聚合、上下文档案优先级。
4. 外壳：顶部菜单（主进程建）、左竖条来自注册表、中栏槽位、右运行时栏、三栏可拖拽。
5. 项目合同：`.pinax/project.json` 升 `pinax-project@2`，`spec` 强制、加 `carriers{primary,enabled,revision}`、共用单一校验器，消灭 `ERR_SPEC_MISMATCH` 双向坏。
6. 主载体向导＋依赖闭包失败界面（D1/D2/D4 的可见形态）。
7. Next 自己的 verify 链：类型＋合同单测＋打包 ABI 断言，**接在提交链路上**。

M1 判据：**空框架可跑**——能建一个只有 `.pinax/` 的项目、能起运行时问一句话、任何插件都不装也不报错。

**M2 起：把现有 web 组件转成二级插件边栏填进来**（顺序按读者价值×迁移阻力；体量来自上一轮取证）

| 阶段 | 插件 | 现有体量 | 转化要点 |
| --- | --- | --- | --- |
| M2 | 小说（正文／Authoring） | 页面＋检查器 950 行 | 第一个插件，用来验证合同够不够用；`正文/大纲/构思` 落 `dataDirs`，工具映射 `chapter.*` |
| M3 | 设定（世界书）＋资料 | worldbook 37 组件 / 9,351 行 | 数据已在 `世界书/`、`资料/`，映射最直白；顺带裁《大梦》13 组同名条目 |
| M4 | 素材 / 漫画 / 视频 | comics 23 文件 / 12,526 行 | 体量最大，且依赖本地图片与 ComfyUI 出片链路，必须晚于合同稳定 |
| M5 | 体验 / 联机 | experience 单页 3,549 行＋42 服务 / 10,928 行 | 按"依赖 `script.scenes` 能力"声明（D4）；联机按外部服务插件处理，不进内核 |
| M6 | 剧本 / 大纲（**新写**，不是迁移） | 剧本只有 235 行只读视图；大纲是 `outline.json` 节点树 | 顶层文档以为"剧本可直接成为载体"，实测不成立。剧本插件提供 `script.scenes`，M5 的依赖才闭得上 |

每个插件的固定三步：① 写 manifest（dataDirs/panes/capabilities/requires/tools/scopes）→ ② 面板挂槽位、把直接 import 的服务改成 scope 调用 → ③ 双跑核对（同一本书，老 web 与 Next 读出的章节数、条目数、字数一致）。

数据面迁移（**R3 未裁**）：localStorage 67 个文件、IndexedDB 8 个文件。推荐"一次性导入 → 落 `.pinax/` → 老存储留一份备份不删"；修订态进 `.pinax/state/`、媒体进 `assets/`，联机协作那套 SQLite 不进 Next。

---

## 9. 平替老代码的收口判据（Definition of Done）

下列全绿才允许删除老代码：

1. **M1 空框架可跑**，不装任何插件不报错。
2. **载体齐**：M2–M4 全部以 manifest 注册，外壳里 `grep` 不到任何 surface 字面量。
3. **两级模型成立**：停用全部插件后运行时仍可用；把小说换成 mock 插件、把第三方漫剧按同合同装进来，外壳都不改一行；插件抢占右栏或注入顶层菜单的尝试被拒且有可见记账。
4. **依赖闭环生效**：主载体为小说、剧本未启用时启用体验，必须失败且给出修复路径；代码里不再有 `|| 'novel'` 式静默回落。
5. **合同一致**：`.pinax/project.json` 单一校验器、`spec@2` 强制；Electron 建的项目 `pinax_project_open` 不再 `ERR_SPEC_MISMATCH`。
6. **门禁接在提交链路上**：类型＋合同单测＋真稿子双跑核对＋打包 ABI 断言，在 CI 里跑。
7. **数据不丢**：《大梦》真实稿子双跑核对通过（章数/字数/条目数一致），RAG 索引 fresh 且检索命中；已知缺陷显式记账，例如 `python3` 默认值在 Windows 上坏（[knowledgeProjectIndex.js:112](../../server/services/knowledgeProjectIndex.js)），现在靠缓存命中掩盖，必须修或明确禁用，不能带进 Next。
8. **退出条件**：作者本人用 Next 完成一次真实创作回合（读稿→提问→改稿提案→落盘），才谈"平替"。

---

## 10. 裁定状态

| 编号 | 事项 | 状态 |
| --- | --- | --- |
| R1 | 物理目录中文还是英文 | **已裁：中文真源**（2026-10-27） |
| R2 | 运行时进不进包、优先级 | **已裁：内置一级公民，高于所有插件边栏**（2026-10-27） |
| R3 | 老 web 数据（localStorage/IndexedDB）迁到哪个面 | 未裁，可推到 M2 前 |
| R4 | 建项目时强制装齐依赖闭包，还是允许先建后补 | 未裁，推荐"建时按主载体闭包装齐，之后增删每次都查闭包" |

## 11. 下一步

按作者口径，下一件事是出 **M1 框架骨架的实现方案与目录结构**（独立目录，与现有 `src/` 并行、互不引用；不含任何插件）。开工前先打两个桩验证未证实项：`@modelcontextprotocol/sdk` 的 in-memory 传输能否在主进程内跑通；`server/services/` 纯服务模块能否打进主进程 bundle 且 `better-sqlite3` 落在 Electron ABI 档。

## 12. 本档未验证 / 已知风险

- in-memory MCP 传输在主进程的可用性**未实测**，只有接口层推断；这是 M1 第一个要打的桩。
- 把 `server/services/` 打进主进程 bundle 的可行性未验证（Vite 主进程入口、原生依赖、ABI）。
- 插件 `tools` 与现有 19 个 `pinax_*` 工具的一对一映射是提案，尚未逐工具核对；`pinax_project_import` 的分类器在 C1 解耦后要重写常量表（[projectImport.js:16-31](../../server/mcp/projectImport.js)）。
- `capabilities` 词表（`text.chapters`/`script.scenes`/`setting.entries`…）目前只是我拟的三个示例，不是完整枚举；M1 必须把词表定死，否则 D3 的闭包校验无法实现。
- "主载体"与作者原话"一级公民的插件"存在措辞差：本档解释为「层级上运行时唯一置顶，项目内主载体唯一」。若作者本意是把主载体也升为一级公民，需要改第 2 节表格与第 5 节第 2 条槽位规则。
- 文中行数与文件数来自上一轮 Explore 取证与本人实测，属当前工作副本状态；`D:\Pinax-main\Pinax-main` 不是 git 仓库，合入主干后需以真实仓库复核。
