# Toonflow／ComfyUI 接入探索与 Agent Core 关联性评估（2026-10-31）

> 批次48 调度方报告。目的：为标杆2（漫画域外部集成）回答三个问题——Toonflow 是什么、怎么接、我们的 agent core 在这条链上缺什么。**事实与判断分开标注**；所有 Toonflow 数据来自官方仓库（GitHub API＋README 原文，2026-10-31 实测），非转述。

## 结论先说

1. **Toonflow 可以接，而且是标杆2 的理想对象**：MIT 许可（无传染风险）、官方把 MCP 列为一等能力、有插件市场与 SDK 意识、Docker 一条命令起。它的短板恰好是我们的强项（Agent 编排、提案轨、上下文信封），互补性真实存在。
2. **接入路径推荐「两段式」**：第一批用 v3 协议把 ComfyUI 以 `mcp`（stdio 薄桥）＋`services`（预览服务）接进 comic 载体（批次48 骨架已派发）；Toonflow 本体第二批以 **app 档（iframe 回环 3000）** 整体承载＋可选 MCP 桥，不做深度缝合。
3. **Agent core 关联性：协议面已就绪，缺的只是真客户**。v3 的 `mcp` 牌是端到端真接线（连接→聚合面→披露→前缀路由→授权→批次45 后 review 档还管写族），批次45 又补了外部写工具的提案闸与审计环——**标杆2 不需要动 agent core，只需要给它第一批真工具**。

## 一、Toonflow 实测档案（全部核实）

| 项 | 事实 | 出处 |
|---|---|---|
| 仓库 | HBAI-Ltd/Toonflow-app，20,005 stars，TypeScript | GitHub API |
| 许可 | **MIT**（早前情报源称 AGPL-3.0 系误传） | GitHub API license 字段＋README §许可 |
| 定位 | 短剧/漫剧创作工具：无限画布写剧本与分镜、角色与场景资产管理、图像与视频生成 | README:128 |
| MCP | 「通过 MCP 连接外部工具与服务」——**它是 MCP 客户端方向**（连别人的工具进它的画布）；对外暴露 MCP server 未见文档，存疑 | README:211 |
| ComfyUI | 「可配置第三方 API，也可接入本地 ComfyUI」；「通过自定义供应商适配接入已有的 ComfyUI 工作流」 | README:214/:236-238 |
| 部署 | Docker（Bun 1.4.3 基础镜像、内置 FFmpeg）：`docker compose up -d --build` → **http://127.0.0.1:3000**；另有桌面端（Electron）与 Android；数据在 `toonflowData` 卷（`/app/data/`），**禁 `down -v`** | README:325-348 |
| 插件 | 插件市场（节点/工具/创作能力）＋SDK，插件架构在重构中（路线图自述「全自由度插件系统」） | README:152/:474-492 |
| 费用模型 | 本身免费自部署；模型 API 自理（官方示例走远程生成 API，视频是大头）；本地 ComfyUI 自备算力 | README:234 |

**判断（与我们的互补性）**：Toonflow 的 AI 编排是「三类 OpenAI 兼容服务（LLM/图像/视频）＋内置 Agent」的封闭栈；它没有提案审阅、没有逐载体上下文信封、没有本地项目文件真源。我们要它的**画布、分镜、角色一致性资产流**，它要（或至少不排斥）我们的**可控写作管线**。接法上宁可松耦合。

## 二、ComfyUI 实况（标杆2 第一批的真目标）

- 本机服务 `http://127.0.0.1:8188`，REST＋websocket：`GET /system_stats`（探活在）、`POST /prompt`（提交工作流 JSON）、`GET /history/{prompt_id}`（取产物）。工作流是图 JSON（节点＋连线），出图＝提交工作流→轮询/订阅 history。
- 【事实】社区有多个 comfyui-mcp-server 项目可参考，但我们**自写零依赖薄桥**（批次48 的 `comic/comfy-mcp-bridge.mjs`，~200 行，MCP stdio 包装上述三个 REST 口）——理由：桥要保持零 npm 依赖、跟随载体分发、工具面语义（`comfy_status/submit/result`）对我们可审计。
- 【判断】对作者真实价值最大的是「正文→分镜提示词→出图」链：`agentMd` 告诉模型怎么用 comfy 工具，世界书/大纲经 context 信封喂人设与场景——这正是 request→propose→review 纪律的用武之地（出图参数也可以走提案，成本可见）。

## 三、三条接入路径评估

| 路径 | 形态牌 | 优点 | 代价/风险 | 裁定 |
|---|---|---|---|---|
| A. ComfyUI 直连薄桥 | `mcp`（stdio）＋`services`（预览） | 零外部安装（有 ComfyUI 即用）；协议四张牌全部得到真消费；审计/授权/提案全吃到 | 桥只包三个 REST 口，复杂工作流管理（存/改 workflow JSON）另说 | **第一批做**（批次48） |
| B. Toonflow iframe 整体承载 | `pinax.view.app`（app 档，回环 3000） | 一次拿到画布/分镜/资产全套；零缝合成本；符合「应用面归宿主」的形态裁定 | 要用户先装 Docker/桌面端 Toonflow；iframe 内外的数据互通只有复制粘贴级 | **第二批做**（真接批），manifest `services` 可顺带声明拉起 `docker compose up`（仅当检测到 Docker） |
| C. Toonflow 深度缝合（桥它的 REST 进我们的 MCP 面） | `mcp` 桥包 Toonflow API | Agent 能直接驱动 Toonflow 的分镜/资产生成 | Toonflow 无公开稳定 REST 合同＋插件架构在重构——**现在缝合等于把接口钉在流沙上**；且与 B 重复 | **不做**，等它的插件 SDK 稳定再评估 |

**推荐节奏**：A（批次48，已派发）→ B（作者环境就绪后一批，含「真接三步」验收）→ C 观望。

## 四、Agent core 关联性（作者第二问的正面回答）

链条现状（批次42/45 后全部为真，均有测试）：

```
v3 manifest.mcp 声明（prefix+allow 白名单）
  → mcpClient stdio/SSE 真起子进程（失败记账不拖垮运行时）
  → 聚合面 ListTools 以 <prefix>.<remote> 并入、CallTool 按前缀路由
  → selectTools 按意图域披露给模型（批次48 加漫画域）
  → agentRuntime ownerOf 认主＋agent:ask 授权卡
  → 批次45：写族后缀启发式进 writePolicy（review 档转提案）；50 条写调用审计环
```

**缺的只有三样，全部已在批次48 工单里**：①第一批真声明（12 载体 services/mcp 全空、唯一消费者是测试夹具——comic 载体补上）；②漫画域意图词（selectTools DOMAINS）；③外部工具的用户可见性（服务状态/审计在设置面的呈现，标杆2 验收后另批）。

**给协议的一句话评估**：诉求1 的「跨插件访问走 MCP、不注册不行动」在**模型轨**上已经成立（未声明的工具不进面、越权写被提案闸拦）；在**面板轨**上成立（面板桥只读＋自有板）；真正还没闭合的是「面板 JS 想调另一块载体的工具」的跨板授权声明制——目前靠桥的只读限制兜着，建议作为标杆2 交付后的下一个协议议题（v3.1：`permissions` 加 `tools:<namespace>` 声明），不急在本批。

## 五、真接三步指南（作者环境就绪后照做）

1. **准备 ComfyUI**：本机起 ComfyUI（默认 8188），确认 `http://127.0.0.1:8188/system_stats` 能开。
2. **启用漫画载体**：项目 `.pinax/project.json` 的 enabled 加 `pinax.carrier.comic`（《大梦》工作副本现未启用漫画，加一块即可）；Next 重开项目后批次48 的桥会随载体自动装载（services 的 preview-server 起 8191，mcp 桥按声明起 stdio）。
3. **验收动作**：右栏问「当前 ComfyUI 状态」→ 模型应披露并调用 `comfy.comfy_status`；再喂一段章节让它出分镜提示词并 `comfy_submit`（review 档下提交会先进提案审阅——看一眼再放行）。设置 → 载体管理应能看到 comic 的服务状态与工具清单。

## 六、边界（如实记）

- Toonflow 未在本机部署实测（作者环境未就绪）；3000 端口/MCP 能力方向均以官方 README 为据，部署后的第一件事是核实它「MCP 客户端」能否反向被我们当 server 用（判断：不能，见路径 C）。
- ComfyUI 工作流 JSON 的实际形状（节点图）未在桥里做校验——桥只透传，错误如实上抛。
- 本报告不替代批次48 的代码交付（comic 骨架＋夹具验证另有工单与记录）。
