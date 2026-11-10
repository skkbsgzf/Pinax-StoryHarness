# 批次49 工单：端口状态指示灯＋服务通信公共池（2026-10-31）

> 调度方：Zcode（miniflow 管线）。执行方：Qoder CLI（模型派发时定）。
> 前置：批次48 已收口（comic 载体四张牌＋serviceSupervisor 真消费＋mcp 桥）。
> 作者需求原话：「工具栏侧的图标右上角，能够有一个小点来展示当前端口的服务状态，绿色表明运行中，橙色表明有任务或者提示需要用户确认，红色表示错误，灰色表示端口已关闭。并且在配置面板上以及协议设计上，让每个端口的通信信息有日志，通知等公用的池子。可供 agent 访问，也可供底座发现并通知。」

## 现状地基（批次42/45/48 已有，本批不重建）

- `next/runtime/serviceSupervisor.mjs`：spawn＋健康探针＋崩溃退避重启≤5 次＋**200 行环形日志**（:74-80）＋事件经 `main.mjs:449-451` 推渲染层（IPC_PUSH.runtimeServiceEvent）＋IPC 读状态/重启（`ipcContract.mjs:45-46,:411-415`）。
- `next/runtime/mcpClient.mjs`：连接失败记账（failures 列表）、断线重连、单机 200 工具上限。
- 渲染层 `AppNext.vue` 竖条＝`.nx-ribbon-item[aria-label=板块标题]`。

## 任务① 公共池：`next/runtime/serviceLogPool.mjs`（新，纯模块）

1. 形状：按来源记账的环形池（每来源 200 条封顶，总 1000 条封顶），条目 `{at, source:{kind:'service'|'mcp', id, carrierId}, level:'info'|'warn'|'error'|'confirm', message, data?}`。
2. 写入口：`append(entry)`；supervisor 的服务事件（起/健康/重启/崩溃/退出）与 mcpClient 的连接/断连/调用失败**都改道进池**（原 console/局部记账保留兼容），池子是唯一权威视图。
3. 读出口：`list({source?, level?, limit?})`、`statusByCarrier()`——把 supervisor 实时状态与池内未确认通知合成**每载体一行**的状态快照。
4. 通知确认：条目可带 `confirm:true`（supervisor 的「重启次数用尽」「健康检查持续失败」、mcp 的「连接失败」标 confirm）；确认状态存应用级偏好 `serviceNoticesAckedAt`（时间戳，ack 即认为此前 confirm 条目已读），API `acknowledge(upToAt)`。
5. 事件上抛：`onChange` 回调（main.mjs 接既有 IPC_PUSH.runtimeServiceEvent 通道或新增 push，选一说明理由）——底座发现并通知＝渲染层订阅池变化刷新状态点与设置节。

## 任务② 状态四色与竖条指示点

1. 色映射（`statusByCarrier()` 的输出语义，写进模块头注释）：
   - `green`＝该载体声明了 services/mcp 且全部运行中、最近健康探针 ok；
   - `orange`＝池内该载体有**未确认** confirm/warn 条目，或监督器正在退避重试（restarting 态）；
   - `red`＝任一服务崩溃用尽/健康失败/spawn 失败，或 mcp 连接处于失败记账态；
   - `gray`＝声明了 services/mcp 但未运行（autostart:false 未起/已停/端口关闭）。
   - **未声明任何 services/mcp 的载体不出点**（否则竖条上一片灰噪点——小说/大纲这些无端口载体保持干净）。
2. `AppNext.vue` 竖条图标右上角小点（`next-shell.css` 新 `.nx-rail-status-dot`＋四色修饰类；token 纪律；8px 圆点、右上角 absolute、灰色用描边避免和图标同色淹没）。
3. 数据流：启动拉一次快照（IPC）＋订阅池 onChange 增量刷新；不得轮询。
4. 无项目/载体未启用时不出点。

## 任务③ Agent 访问口：运行时原生只读工具 `pinax_service_log_list`

1. **照 `pinax_skill_read` 的运行时原生注册路**（`next/runtime/skillTools.mjs` nativeMap 同款出口、归 `kernel.runtime.services`）——**不许改 `server/mcp/createMcpServer.js` 或 tools/**（那会动独立 MCP server 的 19 工具合规面）。
2. 工具语义：`pinax_service_log_list` args `{source?, level?, limit?}`（默认 limit 50，封顶 200）→ 池内条目（时间/来源/级别/消息）；annotations 只读。描述写给模型看：「查服务与外部 MCP 的运行日志、告警与待确认通知」。
3. `next/runtime/toolSelect.mjs`：意图词「服务/端口/日志/通知/状态」命中该工具（读工具位）。
4. **门禁计数同步**：d2 运行时面 20→21（19 内核＋skill_read＋service_log_list）、acceptance 聚合面相应 +1——写明理由；`server/mcp` 的 EXPECTED_TOOL_COUNT 不动。

## 任务④ 配置面板：「服务与通知」节

1. `next/shell/settings/ServicesSection.vue`（新，登记进 SettingsModal 应用组）：每服务/MCP 一行＝载体名、id、端口/传输、四色状态、最近日志尾（5 条，池 list 拉取）＋「知道了」确认钮（ack）＋「重启」钮（复用既有 IPC :411-415，仅 service 有）。
2. 样式走既有 settings 节词汇与 token；空态＝「当前项目没有声明任何服务或外部 MCP」。
3. spec：四控件渲染＋ack 后橙点消退（jsdom 用伪造池）。
4. **批次48 挂账收编（调度方裁）**：漫画板头部加「预览」小钮——宿主行为（formTaxonomy 跳转三去处纪律）：点击经宿主 `shell.openExternal` 打开 `http://127.0.0.1:8191`（地址从该载体 services 声明现取，不硬编码）；服务未运行时按钮禁用态＋tooltip「服务未运行」。允许文件相应加 `next/shell/CarrierPaneHost.vue`。

## 允许文件清单

- `next/runtime/serviceLogPool.mjs`（新）、`next/runtime/serviceSupervisor.mjs`（事件改道进池）、`next/runtime/mcpClient.mjs`（事件进池）
- `next/runtime/skillTools.mjs` 或同款原生注册文件、`next/runtime/surfaceAggregate.mjs`（如需）、`next/runtime/toolSelect.mjs`
- `next/shell/AppNext.vue`（状态点）、`next/shell/styles/next-shell.css`、`next/shell/main.mjs`（池接线＋快照 IPC）、`next/shell/ipcContract.mjs`（通道）
- `next/shell/settings/ServicesSection.vue`（新）、`next/shell/SettingsModal.vue`
- 测试：`next/tests/service-log-pool.test.mjs`（新）＋受影响测试；`next/testing/acceptance.mjs`、`next/testing/bundleAssertions.mjs`（计数同步，写理由）

## 禁止边界

1. 不改 `server/**`、`src/**`；不加 npm 依赖。
2. 不动 manifest schema（池子按声明 id 记账，不加协议字段）；不动 supervisor 的 spawn/退避语义（只接事件出口）。
3. 状态点不得轮询（事件驱动＋首拉）；确认状态只存应用级偏好，不进项目 `.pinax/`。
4. agent 工具只读池——不许提供任何写/重启类的 agent 工具（重启是作者的手，走设置面）。
5. 不启动/不杀 electron 进程；不执行 git 命令。

## 守卫标记

- 45–48 各批守卫清单全部继承（immersive 词表/EXTERNAL_WRITE_HINT/settingsStore/disposeOwner 接线/pinax_chapter_delete·rename/审查本章钮/bookText 拆分/comic 四张牌/comfy 桥文件存在）；
- 本批新守卫：serviceLogPool 存在且 supervisor/mcpClient 都有进池调用、AppNext 状态点类名在 css 里、`pinax_service_log_list` 在原生注册表里。

## 门禁要求（完成定义）

```
npm run next:build:main && npm run next:build:shell
npm run verify:next        # 五段全绿；计数同步已写理由
```

---

## §7 执行方回填（执行完成后填写）

### 交付清单 / 门禁自报 / 偏离 / limitations
（同前几张工单格式）

## §8 调度方验收（Zcode 填，执行方不要动本节）

- 独立复跑＋评审＋守卫 grep；真窗口实拍四色点（dameng-px：无服务灰点/素材自带面板；comic 启用后 preview-server 绿点、停掉 ComfyUI 场景的红色/橙色路径按池事件核）。
- 验收结论与批次记录落 `docs/plan/pinax-electron-next-m2-batch49-20261031.md`（调度方写）。
