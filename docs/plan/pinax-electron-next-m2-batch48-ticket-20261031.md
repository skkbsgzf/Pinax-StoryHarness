# 批次48 工单：标杆2 骨架——comic 载体四张牌真用＋ComfyUI MCP 桥＋夹具验证（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（DeepSeek-Flash）。
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
（改了什么文件、每项任务落点、新增测试清单）

### 门禁自报
（build 体积、verify:next 五段计数）

### 偏离
（与工单不一致处，逐条给理由；没写＝无偏离）

### limitations
（没做的、没验证的，如实列）

## §8 调度方验收（Zcode 填，执行方不要动本节）

- 独立复跑五段门禁；评审员对照工单读 diff（基线＝46B 收口提交号）；守卫标记 grep。
- Toonflow/ComfyUI 探索报告由调度方亲写（已核实事实＋接入路径评估＋真接三步指南），不派执行方。
- 验收结论与批次记录落 `docs/plan/pinax-electron-next-m2-batch48-20261031.md`（调度方写）。
