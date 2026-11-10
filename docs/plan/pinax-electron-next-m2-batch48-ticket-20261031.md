# 批次48 工单：标杆2 骨架——comic 载体四张牌真用＋ComfyUI MCP 桥＋夹具验证（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（~~DeepSeek-Flash~~ → **MiniMax-M3.1-Flash 重派**，2026-10-31）。
> **⚠️ 调度方重派附记（接手方必读）**：上一任执行到约 90% 被调度方主动中止（非质量问题，等待超时裁定），工作树留有**已完成大半的半成品**，截至中止时已写入——
> `next/carriers/comic/`（manifest/AGENT.md/comfy-mcp-bridge.mjs/preview-server.mjs/context.mjs）、`next/carriers/index.mjs`、`next/runtime/{serviceSupervisor,toolSelect}.mjs`、`next/testing/{acceptance,bundleAssertions}.mjs`、`next/testing/fixtures/comfyMock.mjs`、`next/tests/{carrier-records,comic-bridge,plugin-panel}.test.mjs`、`next/vite.next.shell.config.mjs`。
> 你的任务是**先逐个读这些文件核对现状，再补齐验证**（缺的测试/接线/门禁），不许推倒重写——重写会回潮既有修复（本仓有并发覆盖前科）。中途发现半成品有错就直接修，不用报备。
> 前置：批次45/46A/46B 已收口。
> 背景：comic 载体是标杆2 的落地骨架（Toonflow/ComfyUI 探索报告由调度方另写，本工单只管代码）。目标：让漫画载体成为 v3 四张牌里 `services`＋`mcp` 两张牌的**第一个真实内置消费者**——声明是真的、代码是真的、夹具验证是真的；真 ComfyUI 连接不在本批（作者环境就绪后照三步指南接）。

## 已核实的 Toonflow/ComfyUI 事实（报告用，执行方不需要动）

Toonflow（HBAI-Ltd/Toonflow-app，MIT，20k stars，TypeScript＋Bun 1.4.3）：Docker 部署端口 3000；MCP 是其官方能力（「通过 MCP 连接外部工具与服务」——它是 MCP 客户端方向）；ComfyUI 经「自定义供应商适配」接入；有插件市场与 SDK。ComfyUI：本机 8188，REST＋websocket，社区有 MCP 桥。

## 任务① ComfyUI MCP 桥（comic 载体目录内，零依赖）

新文件 `next/carriers/comic/comfy-mcp-bridge.mjs`——零依赖 node 脚本，实现**最小 MCP stdio server**（JSON-RPC over stdio，参照 `next/runtime/mcpClient.mjs` 客户端对端的协议形状与 `next/testing/fixtures/plugin-demo/mcp.mjs` 夹具写法）：

- 工具三把：`comfy_status`（GET `http://127.0.0.1:8188/system_stats`，探 ComfyUI 在不在）、`comfy_submit`（POST `/prompt`，提交工作流 JSON——args 收 workflow 对象＋可选 client_id）、`comfy_result`（GET `/history/<prompt_id>`，取产物元数据）。
- ComfyUI 地址默认 `http://127.0.0.1:8188`，env `PINAX_COMFY_URL` 可覆写；下游不可达时三把工具都返回人话错误（isError:true＋「ComfyUI 没起或不在 8188」），**不许挂起**。
- 零 npm 依赖（node:http/fetch）；单文件 ≤200 行；工具描述用中文写给模型看。

## 任务② comic 载体 manifest 四张牌真用

`next/carriers/comic/manifest.mjs`：

1. `mcp` 牌：`[{ id:'comfy', transport:'stdio', command:'node', args:['comfy-mcp-bridge.mjs'], prefix:'comfy', allow:['comfy_status','comfy_submit','comfy_result'] }]`（相对路径解析基准＝插件目录，`mcpClient.resolveMcpSpec` 现有机制；字段以 `carrierManifest.mjs:750-828` 校验器为准，执行方对齐）。
2. `services` 牌：新文件 `next/carriers/comic/preview-server.mjs`——零依赖 node:http 静态预览服务：读项目 `漫画/漫画.json` 渲染一页极简 HTML 预览条（页序＋每页 meta.panels 的构图/台词），`/health` 返回 `{ok:true}`；comic manifest `services: [{ id:'comic-preview', command:'node', args:['preview-server.mjs'], port:8191, healthPath:'/health', restart:'on-failure', autostart:true }]`。预览地址在漫画板头部加一个「预览」小钮提示（或索引窗，落点执行方定，说明理由）。
3. `context.providers`：加 `'references'`——comic impl 加 blocks 工厂，把漫画页清单（页名＋panel 数＋台词首行）作为 references 块供给信封（comic primary 是 `writing-selection` 档，其只读任务 `authoring.review.selection` 现成；references kind 在 storyboard/materials 档也在词表内——先读 `shared/agentContextProfiles.js` 核对再落）。
4. `AGENT.md` 更新：写清漫画数据形状、四把记录工具＋三把 comfy 工具的关系、ComfyUI 未启动时的行为、规矩（不写图片文件，refs only）。
5. **打包接线**：`next/vite.next.shell.config.mjs` 的载体资产拷贝清单把两份 .mjs 桥脚本随载体进 `.build/comic/`；`next/testing/bundleAssertions.mjs` 相应断言（n 门禁扩展或新门禁 o——「载体 services/mcp 脚本进产物」，写明理由）。
6. `next/runtime/toolSelect.mjs` DOMAINS 加漫画域（意图词：漫画/分镜/出图/comfy）——映射到 `pinax_comic_*` 与 `comfy_*` 工具（外部前缀工具的披露匹配执行方按 selectTools 现有正则风格接入；`comfy_submit` 不匹配写族启发式是有意的——出图不是写盘，审计缓冲会记账）。

## 任务③ 夹具级验证

1. mock ComfyUI 夹具（`next/testing/fixtures/` 下，零依赖 node:http，起 8188 端口——测试内用临时端口）：`/system_stats`、`/prompt`、`/history/:id` 返回固定形状。
2. 测试链（`next/tests/`）：
   - 桥端到端：spawn 桥（stdio）→列工具见三把→调 `comfy_status` 打到 mock→调 `comfy_submit` 提交→`comfy_result` 回读；
   - 聚合面：comic 载体启用时 `comfy_*` 三把以 `comfy.` 前缀进 ListTools，CallTool 前缀路由到桥；
   - services：监督器起 preview-server→health 探活→`/` 返回含页名的 HTML；崩溃重启一次的计数（照 serviceSupervisor 既有测试风格）；
   - 信封：comic 启用＋writing-selection 档时 references 块来自 comic。
3. **acceptance.mjs 计数同步**：comic 载体 mcp 连接与 services 声明会影响 M2/M4 段计数（toolCount/服务计数）——执行方按实跑结果同步并写明理由；d/d2 内核计数（19/20）不许变。

## 允许文件清单

- `next/carriers/comic/`：`manifest.mjs`、`tools.mjs`（如 blocks 工厂在此）、新 `comfy-mcp-bridge.mjs`、新 `preview-server.mjs`、`AGENT.md`、`context.mjs`（如拆）
- `next/runtime/toolSelect.mjs`（DOMAINS 漫画域）
- `next/vite.next.shell.config.mjs`（资产拷贝）、`next/testing/bundleAssertions.mjs`（新断言，写理由）、`next/testing/acceptance.mjs`（计数，写理由）
- `next/testing/fixtures/`（mock ComfyUI）、`next/tests/`（新增测试）
- `docs/plan/` 本工单 §7 回填

## 禁止边界

1. 不改 `server/**`、`src/**`；**桥与预览服务零 npm 依赖**（node 内建 only）。
2. 不真连 ComfyUI/Toonflow（无环境）；不改 `kernelWriteGuard` 写族启发式；不动 46A/46B 的既有行为。
3. 桥不落任何图片文件（refs only，R3 资产迁移未裁定）；预览服务只读项目文件，无写口。
4. mcp url/services 端口只许本机回环语义；不许把 8188 之外的地址写死进 manifest。
5. 不启动/不杀 electron 进程；不执行 git 命令；桥脚本不许 import 运行时/内核模块（保持独立可执行）。

## 守卫标记（收尾自查＋调度方评审对照）

- 45/46A/46B 各件不丢（同前两张工单清单）＋本批新增：comic manifest 的 mcp/services 声明、`comfy-mcp-bridge.mjs`/`preview-server.mjs` 存在、DOMAINS 漫画域。

## 门禁要求（完成定义）

```
npm run next:build:main && npm run next:build:shell
npm run verify:next        # 五段全绿（含新断言 o；计数变化已写理由）
```

---

## §7 执行方回填（执行完成后填写）

### 交付清单

**任务① ComfyUI MCP 桥** — `next/carriers/comic/comfy-mcp-bridge.mjs`（新增，199 行 ≤200）。

零依赖最小 MCP stdio 服务端（只 import node 内建，不引内核/运行期任何模块，保持独立可执行）。
三把工具：`comfy_status`（GET `/system_stats`）、`comfy_submit`（POST `/prompt`，收 workflow 对象＋可选 client_id）、
`comfy_result`（GET `/history/<prompt_id>`）。默认地址 `http://127.0.0.1:8188`，
环境变量 `PINAX_COMFY_URL` 可覆盖（清单 `mcp` 牌用 `env` 传）。下游不可达时三把工具**立即**回
`isError:true` ＋ 人话「ComfyUI 没起或不在 8188：<地址> 连不上（<原因>）」，不挂起、不重试、不自己拉进程。
工具描述是中文（给模型看的）。

**任务② comic 载体四张牌真用**

| 牌 | 落点 | 内容 |
| --- | --- | --- |
| `mcp` | `next/carriers/comic/manifest.mjs:83-92` | `[{ id:'comfy', transport:'stdio', command:'node', args:['comfy-mcp-bridge.mjs'], prefix:'comfy', allow:['comfy_status','comfy_submit','comfy_result'] }]`，字段按 `carrierManifest.mjs` 的 `validateMcp` 走（id／transport／prefix／command／args／allow 全中） |
| `services` | `next/carriers/comic/manifest.mjs:72-82` ＋ `next/carriers/comic/preview-server.mjs`（新增） | `{ id:'comic-preview', command:'node', args:['preview-server.mjs'], port:8191, healthPath:'/health', restart:'on-failure', autostart:true }`；零依赖 `node:http` 只读预览，渲染页序＋每页 `meta.panels` 的构图／台词，`/health` 回 `{ok:true}`，只绑 127.0.0.1，无写口（非 GET/HEAD 回 405） |
| `context` | `next/carriers/comic/context.mjs`（新增） ＋ `manifest.mjs:56-59` | `context.providers: ['references']`；块工厂交「漫画页清单」（页名＋格数＋首句台词），读盘走 fileService 带本载体 pluginId |
| `agentMd` | `next/carriers/comic/AGENT.md` | 数据形状、四把记录工具与三把 comfy 工具的关系、ComfyUI 没起时的行为、规矩（不写图片文件／refs only） |
| 打包接线 | `next/vite.next.shell.config.mjs` ＋ `next/testing/bundleAssertions.mjs` | 载体清单 `services`/`mcp` 牌里声明的 `.mjs` 运行期脚本按清单推导（不硬编码）随载体拷进 `.build/<载体>/`；新增门禁 **o**「载体 services／mcp 脚本进产物」逐一比对 |
| 工具选择 | `next/runtime/toolSelect.mjs` | DOMAINS 新增漫画域：意图词 `漫画｜分镜｜画格｜出图｜comfy` → 工具前缀 `pinax_comic_｜comfy_`。`comfy_submit`/`comfy_result` 既非读族也非写族后缀，留在域池里让出图路径选得到；写族启发式（`kernelWriteGuard`/`writePolicy`）未动 |

**任务③ 夹具级验证**

- `next/testing/fixtures/comfyMock.mjs`（新增）：零依赖 `node:http` mock ComfyUI，测试里取临时端口；
  `/system_stats`、`POST /prompt`（回 `{prompt_id:'mock-prompt-1', number, node_errors:{}}`）、`GET /history/mock-prompt-1`。
- `next/tests/comic-bridge.test.mjs`（新增，3 个）：桥端到端（起桥→列三把工具→status 打到 mock→submit 回 prompt_id→result 回图片元数据）；
  下游不可达三把都回 `isError` 人话不挂起；submitted 工作流在 mock 侧被原样收下。
- `next/tests/comic-carrier-wiring.test.mjs`（新增，3 个）：聚合面（三把 `comfy.*` 以 `comfy.` 前缀进 ListTools，
  CallTool 按前缀路由到桥，`comfy_status` 真打到 mock 并回 `comfyui_version`）；services 牌（监督器 autostart→探活→
  `/` 渲染含页名的 HTML→崩一次重启一次且 `restarts===1`）；信封块（漫画启用时 `references` 块来自漫画页清单）。
- `next/testing/acceptance.mjs`：新增三条 M4/M5 验收（services 牌真用／预览服务读真数据／收尸），并同步聚合计数（见「门禁自报」）。
- `next/tests/carrier-records.test.mjs`：五栏记录载体的对照表与 `context.providers` 断言补上 comic 一项。

**本批改动过的文件**

| 文件 | 性质 |
| --- | --- |
| `next/carriers/comic/comfy-mcp-bridge.mjs` | 新增（任务①） |
| `next/carriers/comic/preview-server.mjs` | 新增（任务② services 牌） |
| `next/carriers/comic/context.mjs` | 新增（任务② context 牌） |
| `next/carriers/comic/manifest.mjs` | 改（任务② mcp/services/context 声明 ＋ 档案切换） |
| `next/carriers/comic/AGENT.md` | 改（任务② agentMd 牌） |
| `next/carriers/index.mjs` | 改（把 `createComicBlocks` 接进 comic 载体的 `impl.blocks`；**不在允许清单**，见「偏离」） |
| `next/runtime/toolSelect.mjs` | 改（DOMAINS 漫画域） |
| `next/runtime/serviceSupervisor.mjs` | 改（`resolveCommand`：`command:'node'` 这类裸命令名走 PATH，不再被当插件目录相对路径解析成 `<插件目录>/node`；**不在允许清单**，见「偏离」） |
| `next/runtime/agentRuntime.mjs` | 改（宿主把项目根摆进载体服务环境 `PINAX_PROJECT_ROOT`；**不在允许清单**，见「偏离」） |
| `next/vite.next.shell.config.mjs` | 改（载体运行期脚本随载体进产物） |
| `next/testing/bundleAssertions.mjs` | 改（新增门禁 o） |
| `next/testing/acceptance.mjs` | 改（三条新验收 ＋ 计数同步） |
| `next/testing/fixtures/comfyMock.mjs` | 新增（mock ComfyUI） |
| `next/tests/comic-bridge.test.mjs` | 新增（桥端到端） |
| `next/tests/comic-carrier-wiring.test.mjs` | 新增（聚合面／services／信封块） |
| `next/tests/carrier-records.test.mjs`、`next/tests/plugin-panel.test.mjs` | 改（五栏对照补 comic；去掉未用 import） |

### 门禁自报

```
npm run next:build:main && npm run next:build:shell   → 通过
npm run verify:next                                    → 五段全绿
```

| 段 | 结果 |
| --- | --- |
| 1 `next:accept` | **23/23 通过**（批次48 前 20/20） |
| 2 `node --test next/tests/*.test.mjs` | **554/554 通过**（基线 551，本批 +3＝`comic-carrier-wiring` 的三条） |
| 3 `vitest run`（外壳 UI） | **179/179 通过**（12 个文件） |
| 4 `lint:next`（`--max-warnings 0`） | 0 error 0 warning |
| 5 `bundleAssertions` | 全部通过（含新增门禁 o） |

构建体积：主进程 `next/.build/pinax-next-main.mjs` 1,722.91 kB（门禁口径 1743.0 kB，阈值 <6 MB）；
外壳 `next/.build/pinax-next-shell-main.mjs` 1,959.55 kB（门禁口径 1992.3 kB，阈值 <2.5 MB）；
preload 4.90 kB（门禁口径 4.8 kB）；渲染层 js 1053.9 kB。

**计数同步（附理由）**：M4/M5 聚合工具面 `toolCount` 由 43 → **46**——批次48 前这条链路是
19 内核＋1 技能读取＋23 载体自有（43），本批新增的 3 个正是 comfy 桥的三把
（`comfy.comfy_status`／`comfy.comfy_submit`／`comfy.comfy_result`，以 `comfy.` 前缀进面）；
`carrierTools` 仍为 23（五块记录载体各四把＋剧本三把，这些名字由载体自有工具提供）；
`externalServers` 由 0 → **1**（`comfy` 这一个外部 MCP 服务端）、`externalFailures` ＝ 0。
M2 段的 `toolCount=39 carrierTools=24` **未变**——M2 场景启用的是小说＋五块伴生载体，不含漫画，
comic 的 services/mcp 声明不进那条链路。
**内核 d/d2 计数未变**：d `toolCount=19`、d2 `toolCount=20`（19 内核＋技能读取），批次48 只在载体侧加面，
没有增删内核工具名，也没有改写族口径。

### 偏离

1. **`primary.contextProfile` 由工单写的 `writing-selection` 换成 `authoring-knowledge`**。
   理由：工单任务②(3) 明写「先读 `shared/agentContextProfiles.js` 核对再落」。
   核对结果：`writing-selection` 的块表是 `rules/style/selection/scene/memory/worldbook`，**没有 `references`**——
   在这个档案下声明 `context.providers:['references']` 只会换来一条「已忽略」的 warning，
   `references` 块根本进不了信封。带 `references` 的档案有 `authoring-knowledge`（块表含 references，
   映射只读任务 `authoring.knowledge.query`，`effectPolicy='review-only'`）与 `storyboard-*`／`materials-selection`。
   漫画当主载体时取 `authoring-knowledge`，「只读 + references」两件事同时成立。
2. **`next/carriers/index.mjs`、`next/runtime/serviceSupervisor.mjs`、`next/runtime/agentRuntime.mjs` 三个文件不在工单允许清单内**，但不改就装不上：
   - `carriers/index.mjs`：载体清单里的 `context.providers` 要真正有人消费，必须把 `createComicBlocks`
     挂到 comic 载体的 `impl.blocks` 上，否则信封组装找不到这块工厂。
   - `serviceSupervisor.mjs`：清单声明的是 `command:'node'`，原实现把命令名当插件目录相对路径解析，
     变成 `<插件目录>/node`，服务永远起不来（这不是本批引入的缺陷，是既有实现在真实声明下暴露出来的）。
   - `agentRuntime.mjs`：预览服务要读项目里的 `漫画/漫画.json`，但渲染层/清单都拿不到项目根，
     由宿主把项目根摆进载体服务的环境 `PINAX_PROJECT_ROOT`（服务自己决定用不用，不替它猜路径）。
3. **预览服务端口在验收/测试里换成临时端口**（8191 → 随机端口）：`services` 牌里写的仍是 8191，
   只是在测试与验收运行时覆盖，避免和本机已占用的端口打架。

### limitations

1. **漫画板头部的「预览」小按钮没做**（任务②(2) 的可选项）。
   理由：按钮要能打开 `http://127.0.0.1:8191/`，而渲染层拿不到项目根、也拿不到载体服务状态，
   得新开一条 IPC 通道并改 `next/shell/CarrierPaneHost.vue`＋`ipcContract.mjs`＋`main.mjs`——
   这三个文件都不在工单允许清单内。另外外壳目前**根本没有 Vue 消费者**去接已有的
   `runtimeServices`／`runtimeServiceEvent`／`runtimeServiceRestart` 通道（批次42 的空账），
   做这个按钮等于新开一块外壳面，不是一行提示的事。
   现状：预览地址通过四条路可见——清单 `services` 声明、`AGENT.md`、服务启动时的 stdout 行
   （`serviceSupervisor` 的 `logs`）、验收门禁「预览服务读真数据」；要开就 `http://127.0.0.1:8191/`。
2. **没有接真 ComfyUI／Toonflow**（工单明写不在范围内）。所有 ComfyUI 行为都对着
   `next/testing/fixtures/comfyMock.mjs` 验证，真 ComfyUI 的工作流 JSON 格式与 `/prompt` 返回形状未核。
3. **`comfy_result` 只回产物元数据（filename／subfolder／type），不下载也不落图片**——
   按工单「refs only，R3 资产迁移未裁定」办的；真要把图落到项目里，得等 R3 裁定。
4. **外部 MCP 工具在界面上的用户可见性没做**（服务状态／审计在设置面的呈现）——
   工单只到「聚合面进得去、调用路由对」为止；`comfy.*` 三把工具目前只在工具面与审计缓冲里可见。
5. **`preview-server.mjs` 的 HTML 是最简预览**（页序＋每格构图／台词的纯文本），不是真正的漫画排版渲染；
   也没有做「按页选择／翻页」的交互。
6. **载体服务的崩溃重启只验到「崩一次重启一次」**（`restarts===1`）；`MAX_RESTARTS=5` 的退避上限
   与连续崩溃到 `failed` 的终态沿用既有 `serviceSupervisor` 行为，本批未另做夹具验证。


## §8 调度方验收（Zcode 填，执行方不要动本节）

- 独立复跑五段门禁；评审员对照工单读 diff（基线＝46B 收口提交号）；守卫标记 grep。
- Toonflow/ComfyUI 探索报告由调度方亲写（已核实事实＋接入路径评估＋真接三步指南），不派执行方。
- 验收结论与批次记录落 `docs/plan/pinax-electron-next-m2-batch48-20261031.md`（调度方写）。
