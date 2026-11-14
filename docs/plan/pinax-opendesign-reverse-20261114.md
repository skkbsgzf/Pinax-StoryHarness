# OpenDesign 逆向报告 ＋ Pinax 对接层设计（作者 2026-11-14 点单：rea 逆向对方前后端设计思路）

> 逆向对象：`D:\OpenDesign`（Electron 打包版 v0.27.1，resources 完整可读）。
> 作者点单：①逆向对方前后端设计思路，重点是**前后端对接层**与**设计资源如何规划接入**；②盘点我们项目资产；③用这套思路简化我们的纠结（例：世界书直接嵌原生 HTML，不再做组件前端适配）。

---

## 一、OpenDesign 全景（逆向结果）

```
┌─ Electron 壳（极薄）────────────────────────────┐
│  main.cjs：装窗口 ＋ launchSidecar() 拉起本地 daemon │
└──────────────┬───────────────────────────────┘
               │ HTTP（web/daemon 边界）
┌──────────────▼───────────────────────────────┐
│  本地 daemon（sidecar 进程，端口自动分配）          │
│  better-sqlite3 / node-pty(终端) / puppeteer /    │
│  sharp / ffmpeg —— 重资产全在 daemon 侧            │
└──────────────┬───────────────────────────────┘
               │ @open-design/contracts（纯 TS 契约包）
┌──────────────▼───────────────────────────────┐
│  Web 前端（@open-design/components 0.8.0）        │
│  agui-adapter（Agent-UI 流式协议）＋ hyperframes   │
└───────────────────────────────────────────────┘
```

### 1.1 对接层本体：`@open-design/contracts`（v0.25.1，private 包）

- 自述：「**Shared pure TypeScript contracts for the OpenDesign web/daemon boundary**」——前后端边界的纯契约包，**零逻辑、零 IO**。
- 内容＝巨型词表＋Schema：协议版本常量（`CHAT_SSE_PROTOCOL_VERSION`／`AGENT_ACTIONS_PROTOCOL_VERSION`）、状态机（`CHAT_RUN_STATUSES`／`AGENT_TASK_STATUSES`）、Zod 型 Schema（`AgentCapabilitySnapshotV2Schema` 等）、错误码（`API_ERROR_CODES`／`BROWSER_ACTION_ERROR_CODES`）、甚至 `BASE_SYSTEM_PROMPT`（系统提示词也是契约的一部分！）、`API_ERROR_CODES`、`BRAND_COLOR_ROLES`。
- 按 API 分子入口导出（`./api/connectionTest` 等 10 个域）。
- **为什么这样设计**：web 与 daemon 是两个进程、两个团队（甚至两个技术栈节奏），契约包是唯一共享依赖——前端照契约写 mock，daemon 照契约实现，谁也不等谁。这正是排期文档「契约先行」的成品形态。

### 1.2 进程编排：`@open-design/sidecar`

- 导出即 API：`launchSidecar / bootstrapSidecarProcess / allocatePort / invokeSidecar / handoffCurrentSidecarGeneration / convergeSidecarLaunch / findSidecarProcesses`。
- 模型：**Electron 壳拉起本地 daemon 子进程（sidecar）**，端口自动分配，升级时「代际交接」（handoff＝新 daemon 起来、旧 daemon 交接状态再退场）。
- 重资产全在 daemon 侧：better-sqlite3（本地库）、node-pty（真终端）、puppeteer（浏览器自动化）、sharp（图像）、ffmpeg（视频）——前端零 Native 依赖。

### 1.3 资源体系：`resources/open-design/`（一切皆可插拔目录）

| 目录 | 内容 | 包装合同 |
|---|---|---|
| **agent-runtimes/** | **唯一内置＝deepseek-harness**（`@open-design/dsh-runtime` 0.1.0 tgz） | `manifest.json`：`{file, packageName, schemaVersion, sha256, version}`——运行时就是一个 **npm tgz 资源包**，与普通包同待遇 |
| **design-systems/** | 几十套（airbnb/ant/apple/arc/bento…）＋`_schema/` | **`DESIGN.md`＝给 Agent 读的设计散文**（提示词素材）；`manifest.json`＝发现层（picker/daemon/importer 用）；来源四类：bundled/local/github/shadcn；含 compiled tokens |
| **skills/** | 海量技能包（ad-creative/agent-browser/algorithmic-art…） | 目录即包 |
| **plugins/** | `_official`＋`registry` | 注册表协议（registry-protocol 0.5.0） |
| **craft/** | 设计纪律散文（anti-ai-slop/color/animation-discipline/accessibility-baseline） | 给 Agent 读的「品味」资源 |
| **frames/** | 设备框**原生 HTML**（browser-chrome.html/iphone-15-pro.html/macbook.html…） | 原生 HTML 直接当资源，预览时嵌入 |
| design-templates/ prompt-templates/ data/ | 模板与数据 | — |

### 1.4 对作者六点观察的一一对答

| 作者观察 | 逆向证实 |
|---|---|
| 本地几乎无原生 agent 运行时，提供 tool chain 与资源包 | ✅ agent-runtimes 里只有一个 tgz；skills/design-systems/craft 全是可插拔目录 |
| 左下角色板选设计体系 | ✅ design-systems picker（manifest 发现层＋DESIGN.md） |
| DSH 原生运行时接进来 | ✅ **OpenDesign 自己就这么干的**：唯一内置运行时就是 deepseek-harness tgz |
| 别人的 CLI 嫁接 | ✅ node-pty＋sidecar：终端与外部进程是 daemon 一等公民 |
| 插件工作台形式（DSH/WorkBuddy） | ✅ plugins/registry＋plugin-runtime 0.5.0＋agui-adapter |
| 文件中心＋文件会话、形态灵活 | ✅ craft/frames/设计文件会话；frames 就是原生 HTML 文件资源 |
| HTML 工作台用户/Agent/社区定制 | ✅ DESIGN.md 给 Agent、craft 纪律文档管 Agent 品味、shadcn registry 来源＝社区分发通道已有先例 |

---

## 二、我们项目资产盘点（对照）

### 2.1 已对齐（不需要重做）

| OpenDesign 概念 | Pinax 现状 |
|---|---|
| 固定本地文件绑定 API | **S1 fact 四通道 ＋ S2 writeFactFile（原子/幂等/revision）刚落**——这就是我们的「contracts 地基」，且走 IPC＋文件而非 HTTP daemon（单机更简） |
| 文件中心 | 库管理器（PR-1~3）：一级视图＋最近库＋建/开/导三流 |
| 插件体系 | pinax-carrier@4（12 载体、services/mcp/settings/agentMd 四张牌、plugin-loader、pinax-plugin:// 沙箱 iframe 协议——**沙箱 iframe 嵌 HTML 的能力已经存在**） |
| 宿主极薄 | P10 顶栏重排（菜单退役/载体上栏/设置齿轮） |
| 技能/资源包目录 | skills 装载器（loadSkills）＋ AGENTS.md 口径 |
| 进程即沙箱 | 作者已有裁定（services 解禁） |
| 风格系统 | P6 珊瑚红令牌（第一个风格包的值） |

### 2.2 缺口（OpenDesign 有、我们没有）

| 缺口 | OpenDesign 的做法 | 我们的落法建议 |
|---|---|---|
| **契约包** | @open-design/contracts：纯 TS 词表＋Schema，web/daemon 共享 | 把 `next/shell/ipcContract.mjs` 的通道表＋错误码＋状态机**拆成纯契约包**（next/contracts），主进程与渲染层共享；现在 ipcContract 混着 dispatcher 逻辑——拆开 |
| **运行时可插拔** | agent-runtimes/ 目录＋tgz 包＋manifest（packageName/sha256/schemaVersion） | **运行时端口**：pi 运行时降为第一个内置包；DSH/外部 CLI 各做一个 tgz 适配器（我们派单管线已验证三家的进程接法） |
| **风格包/色板** | design-systems 目录＋DESIGN.md＋picker | **风格包目录**（对标作品 token 集）＋左下角色板 UI；P6 珊瑚红＝内置包 |
| **给 Agent 读的资源散文** | DESIGN.md＋craft/ 纪律文档 | agentMd 牌已有机制；缺「设计纪律/写作纪律」散文包内容 |
| **文件会话形态自加** | craft/frames：浏览器/设备框 HTML 资源 | pane 形态用户自加（R4） |

### 2.3 世界书嵌原生 HTML（作者点名的简化，具体落法）

现状纠结：wiki 展示要做 Vue 组件适配（S4-02 五页签）＝每派生一种视图就要写一轮前端组件＋门禁。

**OpenDesign 式简化**（三步，全部是现成能力拼装）：

1. **派生产出改双格式**：`wikiDerive` 本来就是纯计算——在 S4 的 JSON 之外**同时产原生 HTML**（我们手里有现成的 `devtools/build-wiki.mjs` 静态 HTML 生成器，94bc145 两本书验证过——它就是要保留的「对照版」，现在升格为 HTML 资源生成器）。
2. **嵌入走既有沙箱**：`pinax-plugin://` 协议＋沙箱 iframe（批次42 建的）直接装这个 HTML；数据刷新＝重新派生（writeFactFile→derive→新 HTML），iframe reload。
3. **前端零适配**：世界书板的 wiki 入口从「五页签 Vue」换成「一个 iframe 容器＋派生/刷新钮」——组件前端适配问题整类消失；S4-02 的 Vue 五页签**降级为对照实现保留**（与 devtools 版同待遇）。

这个模式的通用化：**任何重展示轻交互的视图（wiki/图谱/统计/时间线）都走「派生 HTML 资源＋iframe」；重交互的（编辑器/看板）才走 Vue 组件**——组件适配的战场缩小到真正需要它的地方。

---

## 三、工单重审表（OpenDesign 镜头）

| 工单 | 原方向 | 新裁定 |
|---|---|---|
| S1/S2（fact 通道/writeFactFile） | 拆解接线 | **升格为「固定文件 API」地基**——R 系一切包都吃它 |
| S4-02（wiki 五页签 Vue） | 组件适配 | **降级为对照实现**；主路线改「派生 HTML＋iframe」（见 §2.3） |
| S4-01（wikiDerive JSON） | 保留 | 追加 HTML 输出（双格式） |
| S5 任务队列/管线进产品 | 运行时内置 | 保留，但作业 runner 按「运行时无关」设计 |
| 批次78（pi 运行时内子代理编排） | 反转（前案已裁） | 维持：编排走运行时端口（DSH/CLI） |
| dsh 右栏插件线 | 右栏开放 | **并入运行时可插拔**：DSH 既是运行时也是插件 |
| B5 tiptap／世界书结构化编辑 | 组件路线 | 重新归堆到「单页工作台＋HTML 资源」路线下再评估 |
| UX 审计遗留 | 展示层 | 不受影响，照做 |

---

## 四、R 系批次（修订版）

| 批 | 内容 | 依赖 |
|---|---|---|
| R0 | fact 通道/writeFactFile/库管理器/顶栏薄壳/P9 人话 | ✅ 已落 |
| **R1** | **契约包拆分**：ipcContract 的通道表/错误码/状态机拆 `next/contracts/`（纯数据，主进程渲染层共享）——对接层定型 | 无 |
| **R2** | **wiki 原生 HTML 嵌入**：wikiDerive 双格式＋iframe 容器（验证「组件适配整类消失」的样板） | S4（已落） |
| **R3** | **运行时端口**：Runtime Port 契约＋pi 运行时参考实现适配＋左列会话集读端口 | R1 |
| **R4** | **运行时可插拔**：agent-runtimes 目录＋manifest（packageName/sha256）＋DSH tgz 适配器＋CLI 适配器＋选择器 UI | R3 ＋ DSH 规格 |
| **R5** | **风格包/色板**：design-systems 式目录＋DESIGN.md（给 Agent 的风格散文）＋左下角色板 | P6 |
| **R6** | **文件会话自加**：pane 形态用户自加（浏览器/草图/文档） | 库管理器 |
| **R7** | **小说单页工作台**：卷/章/节单页封装＋HTML 工作台定制 API | R2/R4 |

---

## 五、要作者裁定的

1. **世界书路线切换确认**：S4-02 的 Vue 五页签降级为对照实现、主路线改「派生 HTML＋iframe」——确认后 R2 开工。
2. **契约包拆分时机**：R1（先拆再接运行时）还是随用随拆。
3. **DSH 规格来源**：DeepSeek Harness 装在 `C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness`——授权我逆向它的接口（与 OpenDesign 同法），还是你给文档。

## 六、诚实边界

- 本报告基于打包产物的静态逆向（结构/清单/导出面）；**sidecar 与 web 的运行时协议细节（SSE 帧格式/会话握手）未动态抓包**——需要的话下一步挂代理抓。
- OpenDesign 版本 0.27.1，演进快，契约词表会漂。
- `@open-design/*` 全部 private 未发布 npm——只能逆向不能引用。


---

## 七、DSH 会话挖掘（REA 第二层：作者与 DSH 的设计演进史全记录）

来源：~/.dsh/sessions/（DSH CLI 会话，zstd 多帧拼接，Node zlib 逐帧解压）；4b493fc7 项目（＝原型包 UUID）下 2 会话、1771 帧、16316KB 解压、3239 行事件；真对话 45 条（其余为系统注入/压缩检查点/工具调用 597 条）。

### 7.1 设计演进全弧线（从检查点还原）

1. 起点：「帮我看下 Pinax-next 这个目录下的一些前端问题」→ 升级为「全面产品诊断，对标 Obsidian」→「先捋清项目管理和用户生命周期，再谈布局」→「@Airbnb 画一版草图」→「搞一个试试」→「加项目类别管理（剧本/小说/漫剧），继续往下做」→「脱离我的原始代码了，结合已有面板再设计」→「这不是真实的面板，我的原版是 wiki-like 的 web——需要条目页，不是桌面 IDE 壳」。
2. 产出：pinax-writing-screen（已演进到 **8 板**：novel/outline/world/material/dossier/comic/trpg/deduce——DSH 已把推演/漫画/跑团三板做进原型，含 demo 数据与交互）、pinax-agent-first（Agent 全高左列）、library-view 修复（撤 drawer+scrim→栈列两视图、三组展开、状态保留、min-height 修复）、设置（外观/界面缩放/模型服务/自动快照/写作偏好/技能库 六节）。
3. **确立的设计哲学**（作者与 DSH 达成，与我们 P 系完全同向）：「settings contain preferences only; commands belong to menus, library, or panels」；Agent 列全高三档响应式（≥1240 全宽/1080–1240 收 320/<1080 隐藏）；极简主面＋插件补全；作者拒绝过：环形设置导航、单列极简设置、发明模块字段。

### 7.2 DSH 沙箱限制（如实）

- D:Pinax-next 沙箱内只读（写 EPERM）——DSH 的实现产物全留在 OD 项目目录；读侧只读了 ~2000 行（<1%）并如实声明。
- 无法截图（Electron 拒 --no-sandbox、headless Edge 拒绝访问、无 VM）——「用户截图 remain unread; state this honestly」。
- 与我们 P 系的关系：**同一设计弧线的两条平行实现**——P 系落在产品代码，DSH 线落在原型 HTML；二者已收敛到同一形态（Agent 在左/极简顶栏/wiki-like/珊瑚红）。未重复劳动的部分＝DSH 的 8 板原型（我们的载体板实现可照其交互规格做）。

## 八、结论修订（并入 §四 R 系）

- R 系不变，追加一条：**载体板（推演/漫画/跑团）的 Vue 实现可直接照 pinax-writing-screen.html 最新版（8 板形态）的交互规格做**——DSH 已把设计做完并获作者逐轮点头，省一轮设计工。
- 世界书 HTML 嵌入（§2.3）维持：S4-02 五页签降级为对照实现。
- DSH（agent-runtimes/deepseek-harness）是 OpenDesign 的内置运行时＝**R4 可插拔运行时的现成参照**（manifest: packageName/sha256/schemaVersion）。
